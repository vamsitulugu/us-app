// ═══════════════════════════════════════════════════════
//  Lyrics Routes — Smart Lyrics Engine (v4, full rewrite)
//  Place at: routes/lyrics.js
//  Wire up in server.js:  app.use('/api/lyrics', require('./routes/lyrics'));
//
//  ARCHITECTURE (matches the Smart Lyrics Engine master spec):
//  - Playback NEVER calls a provider. The player only ever calls
//    GET /api/lyrics/status/:songId, which is a pure cache read
//    (cached_lyrics / missing_lyrics), no network egress at all.
//  - Providers are only ever contacted from:
//      POST /api/lyrics/auto-fetch     (called by the import background
//                                       worker right after a song is saved)
//      POST /api/lyrics/refresh-missing (admin "Refresh Missing Lyrics")
//  - Every provider attempt (success or failure) is logged to
//    lyrics_search_history for the admin dashboard.
//  - A song that has already failed recently is NOT re-searched on
//    every import retry — missing_lyrics has a cooldown window.
// ═══════════════════════════════════════════════════════
const express  = require('express');
const supabase = require('../middleware/supabase');
const router   = express.Router();

let Sanscript = null;
try { Sanscript = require('@indic-transliteration/sanscript'); } catch (e) {
  console.warn('[lyrics] @indic-transliteration/sanscript not installed — transliteration disabled.');
}

const LRCLIB_BASE = 'https://lrclib.net/api';
const DURATION_TOLERANCE = 3; // seconds
const FETCH_TIMEOUT_MS = 4000;
const MISSING_RETRY_COOLDOWN_MS = 24 * 60 * 60 * 1000; // don't re-hit providers for a song that failed <24h ago

/* ─────────────────────────────────────────────
   TEXT UTILS
───────────────────────────────────────────── */
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/feat\.?|ft\.?|official|video|audio|lyrics?|remaster(ed)?/g, ' ')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
function similarity(a, b) {
  const ta = new Set(normalize(a).split(' ').filter(Boolean));
  const tb = new Set(normalize(b).split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  ta.forEach(t => { if (tb.has(t)) shared++; });
  return shared / Math.max(ta.size, tb.size);
}
async function fetchJson(url, timeoutMs = FETCH_TIMEOUT_MS, extraHeaders = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'US-Couple-App/1.0', ...extraHeaders }, signal: controller.signal });
    if (!r.ok) return null;
    try { return await r.json(); } catch (e) { return null; }
  } catch (e) {
    return null;
  } finally { clearTimeout(t); }
}

/* ─────────────────────────────────────────────
   SCRIPT DETECTION + TRANSLITERATION (unchanged from prior version)
───────────────────────────────────────────── */
const SCRIPT_RANGES = [
  { name: 'telugu',     scheme: 'telugu',     re: /[\u0C00-\u0C7F]/ },
  { name: 'devanagari', scheme: 'devanagari', re: /[\u0900-\u097F]/ },
  { name: 'tamil',      scheme: 'tamil',      re: /[\u0B80-\u0BFF]/ },
  { name: 'kannada',    scheme: 'kannada',    re: /[\u0C80-\u0CFF]/ },
  { name: 'malayalam',  scheme: 'malayalam',  re: /[\u0D00-\u0D7F]/ },
  { name: 'bengali',    scheme: 'bengali',    re: /[\u0980-\u09FF]/ },
  { name: 'gujarati',   scheme: 'gujarati',   re: /[\u0A80-\u0AFF]/ },
  { name: 'gurmukhi',   scheme: 'gurmukhi',   re: /[\u0A00-\u0A7F]/ },
];
function detectScript(text) {
  let best = null, bestCount = 0;
  for (const s of SCRIPT_RANGES) {
    const matches = text.match(new RegExp(s.re, 'g'));
    const count = matches ? matches.length : 0;
    if (count > bestCount) { bestCount = count; best = s; }
  }
  return bestCount > 0 ? best : null;
}
const TIME_TAG_RE = /^(\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\])(.*)$/;
function transliterateLRC(lrcText) {
  if (!Sanscript || !lrcText) return null;
  const script = detectScript(lrcText);
  if (!script) return null;
  const lines = lrcText.split('\n');
  const out = lines.map(line => {
    const m = line.match(TIME_TAG_RE);
    const tag = m ? m[1] : '';
    const body = m ? m[2] : line;
    if (!body || !body.trim()) return line;
    try { return tag + ' ' + Sanscript.t(body, script.scheme, 'itrans').trim(); }
    catch (e) { return line; }
  });
  return out.join('\n');
}
function candidateScriptMismatch(expectedScript, candidateLrc) {
  if (!expectedScript) return false;
  const candScript = detectScript(candidateLrc || '');
  return !candScript || candScript.name !== expectedScript.name;
}

/* ─────────────────────────────────────────────
   LYRICS ENGINE v5 — identify the song first, then search every
   provider IN PARALLEL with every candidate name, score each result
   (title + artist + duration), and take the best synced match.
───────────────────────────────────────────── */
async function logAttempt({ songId, provider, query, success, responseTimeMs }) {
  try {
    await supabase.from('lyrics_search_history').insert({
      song_id: songId || null, provider, query, success, response_time: responseTimeMs,
    });
  } catch (e) { /* logging must never break the search */ }
}

// Strip website junk ("Rock On Bro - .Co", "SenSongsMp3.Co", "(From "Peddi")", "320kbps", "01 - ")
const JUNK_RE = /\b[\w-]+\.(com|co|in|net|org|me|fm|info|mobi)\b|\b(sensongsmp3|naasongs|masstamilan|isaimini|starmusiq|pagalworld|mrjatt|djpunjab|tamilwire|kuttyweb|moviesda|songspk|wapking|downloadming|raagtunes|a2zwap|naa\s*songs)\b|\b\d{2,3}\s*kbps\b|\b(official|lyrical?|full|audio|video|song|hd|hq)\b(\s+(audio|video|song))?/gi;
function stripJunk(s) {
  let t = String(s || '').replace(/_/g, ' ');
  t = t.replace(/^\s*\d{1,3}\s*[-._)]\s*/, '');                       // leading track number
  t = t.split(/\s[-–—|:]\s/).filter(p => p.trim() && !/^\.?(com|co|in|net|org|me|fm)$/i.test(p.trim())).join(' - ');
  t = t.replace(JUNK_RE, ' ');
  t = t.replace(/\(\s*\)|\[\s*\]/g, ' ').replace(/\s{2,}/g, ' ');
  return t.replace(/^[\s\-–—:|,._]+|[\s\-–—:|,._]+$/g, '').trim();
}
function movieFrom(s) {
  const m = String(s || '').match(/[\(\[]\s*(?:from|movie|film)?\s*[:\-]?\s*["“']?([^()\[\]"”']{2,60})["”']?\s*[\)\]]/i);
  return m && /from|movie|film/i.test(m[0]) ? m[1].trim() : null;
}
function stripBrackets(s) { return String(s || '').replace(/\s*[\(\[][^()\[\]]*[\)\]]/g, ' ').replace(/\s{2,}/g, ' ').trim(); }
function firstArtist(a) { return String(a || '').split(/,|&|\bfeat\.?\b|\bft\.?\b|\band\b|;|\//i)[0].trim(); }

function buildCandidates({ title, artist, album, filename }) {
  const out = [];
  const add = (t, a) => {
    t = stripJunk(stripBrackets(t)); a = a ? stripJunk(a) : '';
    if (!t || t.length < 2) return;
    out.push({ title: t, artist: a });
    if (a && firstArtist(a) !== a) out.push({ title: t, artist: firstArtist(a) });
    out.push({ title: t, artist: '' });
  };
  add(title, artist);
  if (filename) {
    const base = String(filename).replace(/\.[a-z0-9]{2,4}$/i, '');
    const parts = stripJunk(base).split(/\s[-–]\s/);
    if (parts.length >= 2) { add(parts[1], parts[0]); add(parts[0], parts[1]); }
    add(base, artist);
  }
  const movie = movieFrom(title) || movieFrom(filename);
  if (movie) add(title, movie);
  // dedupe
  const seen = new Set();
  return out.filter(c => { const k = normalize(c.title) + '|' + normalize(c.artist); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 6);
}

function scoreCandidate(want, got, durationSec) {
  const t = similarity(want.title, got.title);
  const a = want.artist ? Math.max(similarity(want.artist, got.artist), similarity(firstArtist(want.artist), got.artist)) : 0.5;
  let d = 0.5, durOk = true;
  if (durationSec && got.duration) {
    const diff = Math.abs(got.duration - durationSec);
    d = diff <= DURATION_TOLERANCE ? 1 : Math.max(0, 1 - diff / 30);
    if (diff > 8) durOk = false;
  }
  return { score: t * 0.55 + a * 0.2 + d * 0.25, titleScore: t, durOk };
}

// ── Provider: LRCLIB (all candidates, in parallel) ──
async function searchLRCLIB(cands, durationSec, album) {
  const jobs = [];
  cands.forEach(c => {
    if (c.artist) {
      const qs = new URLSearchParams({ track_name: c.title, artist_name: c.artist });
      if (album) qs.set('album_name', stripJunk(album));
      if (durationSec) qs.set('duration', String(Math.round(durationSec)));
      jobs.push(fetchJson(`${LRCLIB_BASE}/get?${qs}`).then(r => r ? [r] : []));
    }
    jobs.push(fetchJson(`${LRCLIB_BASE}/search?q=${encodeURIComponent((c.title + ' ' + c.artist).trim())}`).then(r => Array.isArray(r) ? r : []));
    jobs.push(fetchJson(`${LRCLIB_BASE}/search?track_name=${encodeURIComponent(c.title)}`).then(r => Array.isArray(r) ? r : []));
  });
  const all = (await Promise.all(jobs)).flat();
  return all.map(r => ({
    provider: 'lrclib', title: r.trackName || '', artist: r.artistName || '', duration: r.duration || 0,
    synced: r.syncedLyrics || null, plain: r.plainLyrics || null,
  })).filter(r => r.synced || r.plain);
}

// ── Provider: NetEase (big catalogue incl. Indian film songs, synced) ──
async function searchNetEase(cands, durationSec) {
  const H = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://music.163.com/' };
  const queries = [...new Set(cands.slice(0, 3).map(c => (c.title + ' ' + c.artist).trim()))];
  const found = [];
  await Promise.all(queries.map(async q => {
    const r = await fetchJson(`https://music.163.com/api/search/get?s=${encodeURIComponent(q)}&type=1&limit=6`, 4000, H);
    ((r && r.result && r.result.songs) || []).forEach(s => found.push({
      id: s.id, title: s.name || '', artist: (s.artists || []).map(x => x.name).join(', '), duration: (s.duration || 0) / 1000,
    }));
  }));
  const uniq = [...new Map(found.map(f => [f.id, f])).values()];
  const want = cands[0];
  const ranked = uniq.map(u => ({ u, ...scoreCandidate(want, u, durationSec) })).sort((a, b) => b.score - a.score).slice(0, 2);
  const out = [];
  await Promise.all(ranked.map(async ({ u }) => {
    const l = await fetchJson(`https://music.163.com/api/song/lyric?id=${u.id}&lv=1&kv=1&tv=-1`, 4000, H);
    const lrc = l && l.lrc && l.lrc.lyric;
    if (lrc && /\[\d{1,2}:\d{2}/.test(lrc)) out.push({ provider: 'netease', ...u, synced: lrc, plain: null });
  }));
  return out;
}

// ── Provider: lyrics.ovh (plain text last resort) ──
async function searchOvh(cands) {
  const c = cands.find(x => x.artist);
  if (!c) return [];
  const d = await fetchJson(`https://api.lyrics.ovh/v1/${encodeURIComponent(c.artist)}/${encodeURIComponent(c.title)}`, 4000);
  return d && d.lyrics && d.lyrics.trim() ? [{ provider: 'lyricsovh', title: c.title, artist: c.artist, duration: 0, synced: null, plain: d.lyrics.trim() }] : [];
}

async function smartSearch({ songId, title, artist, album, durationSec, filename }) {
  const started = Date.now();
  const cands = buildCandidates({ title, artist, album, filename });
  if (!cands.length) return null;
  const want = cands[0];
  const expectedScript = detectScript(`${title || ''} ${artist || ''}`);

  const [lr, ne] = await Promise.all([
    searchLRCLIB(cands, durationSec, album).catch(() => []),
    searchNetEase(cands, durationSec).catch(() => []),
  ]);
  const pool = [...lr, ...ne];
  let best = null;
  for (const r of pool) {
    if (!r.synced) continue;
    if (candidateScriptMismatch(expectedScript, r.synced)) continue;
    // best score over every candidate name we generated
    const s = Math.max(...cands.map(c => scoreCandidate(c, r, durationSec).score));
    const t = Math.max(...cands.map(c => scoreCandidate(c, r, durationSec).titleScore));
    const durOk = scoreCandidate(want, r, durationSec).durOk;
    if (t < 0.5 || !durOk || s < 0.5) continue;
    if (!best || s > best.s) best = { s, r };
  }
  const log = (p, ok) => logAttempt({ songId, provider: p, query: `${want.title} ${want.artist}`, success: ok, responseTimeMs: Date.now() - started });
  if (best) { log(best.r.provider, true); return { lrc: best.r.synced, syncType: 'synced', provider: best.r.provider }; }

  // plain-text fallback (LRCLIB plain first, then lyrics.ovh)
  const plainLr = pool.filter(r => r.plain && Math.max(...cands.map(c => scoreCandidate(c, r, durationSec).titleScore)) >= 0.6)[0];
  if (plainLr) { log('lrclib', true); return { lrc: plainLr.plain, syncType: 'plain', provider: 'lrclib' }; }
  const ovh = await searchOvh(cands).catch(() => []);
  if (ovh[0]) { log('lyricsovh', true); return { lrc: ovh[0].plain, syncType: 'plain', provider: 'lyricsovh' }; }
  log('all', false);
  return null;
}


/* ─────────────────────────────────────────────
   POST /api/lyrics/auto-fetch
   Called ONLY from the import background worker (never from playback).
   body: { songId, coupleId, title, artist, album, durationSec }
───────────────────────────────────────────── */
router.post('/auto-fetch', async (req, res) => {
  const { songId, coupleId, title, artist, album, durationSec, filename } = req.body;
  if (!title && !filename) return res.status(400).json({ found: false, error: 'title required' });

  try {
    if (songId) {
      const { data: existing } = await supabase.from('cached_lyrics').select('provider, lrc_text, lrc_text_latin, sync_type').eq('song_id', songId).maybeSingle();
      if (existing) {
        supabase.from('cached_lyrics').update({ last_used: new Date().toISOString() }).eq('song_id', songId).then(() => {}).catch(() => {});
        return res.json({ found: true, source: 'cache', provider: existing.provider, lrc: existing.lrc_text, lrcNative: existing.lrc_text, lrcLatin: existing.lrc_text_latin, syncType: existing.sync_type });
      }
      const { data: missing } = await supabase.from('missing_lyrics').select('last_attempt, attempts').eq('song_id', songId).maybeSingle();
      if (missing && (Date.now() - new Date(missing.last_attempt).getTime()) < MISSING_RETRY_COOLDOWN_MS) {
        return res.json({ found: false, cooldown: true, attempts: missing.attempts });
      }
    }

    const result = await smartSearch({ songId, title, artist, album, durationSec, filename });

    if (result) {
      const lrcLatin = transliterateLRC(result.lrc);
      if (songId && coupleId) {
        await supabase.from('cached_lyrics').upsert({
          song_id: songId, couple_id: coupleId, title, artist: artist || '', album: album || null,
          duration: durationSec || null, provider: result.provider, lrc_text: result.lrc,
          lrc_text_latin: lrcLatin, sync_type: result.syncType, updated_at: new Date().toISOString(),
        }, { onConflict: 'song_id' });
        await supabase.from('missing_lyrics').delete().eq('song_id', songId);
        await supabase.from('songs').update({
          lyrics: result.lrc, lyrics_native: result.lrc, lyrics_latin: lrcLatin,
          lyrics_cached: true, lyrics_source: result.provider, lyrics_updated_at: new Date().toISOString(),
        }).eq('id', songId).eq('couple_id', coupleId);
      }
      return res.json({ found: true, source: 'provider', provider: result.provider, lrc: result.lrc, lrcNative: result.lrc, lrcLatin, syncType: result.syncType });
    }

    if (songId && coupleId) {
      const { data: existingMissing } = await supabase.from('missing_lyrics').select('attempts').eq('song_id', songId).maybeSingle();
      await supabase.from('missing_lyrics').upsert({
        song_id: songId, couple_id: coupleId, title, artist: artist || '', album: album || null,
        duration: durationSec || null, attempts: (existingMissing ? existingMissing.attempts + 1 : 1),
        last_attempt: new Date().toISOString(), failure_reason: 'no provider match',
      }, { onConflict: 'song_id' });
    }
    return res.json({ found: false });
  } catch (e) {
    if (!res.headersSent) return res.status(500).json({ found: false, error: e.message });
  }
});

/* ─────────────────────────────────────────────
   GET /api/lyrics/status/:songId
   PURE CACHE READ — no provider calls, ever. This is the ONLY lyrics
   endpoint the player is allowed to call.
───────────────────────────────────────────── */
router.get('/status/:songId', async (req, res) => {
  try {
    const { data: cached } = await supabase.from('cached_lyrics').select('provider, lrc_text, lrc_text_latin, sync_type').eq('song_id', req.params.songId).maybeSingle();
    if (cached) {
      supabase.from('cached_lyrics').update({ last_used: new Date().toISOString() }).eq('song_id', req.params.songId).then(() => {}).catch(() => {});
      return res.json({ state: 'cached', provider: cached.provider, lrc: cached.lrc_text, lrcLatin: cached.lrc_text_latin, syncType: cached.sync_type });
    }
    const { data: missing } = await supabase.from('missing_lyrics').select('attempts, last_attempt').eq('song_id', req.params.songId).maybeSingle();
    if (missing) return res.json({ state: 'missing', attempts: missing.attempts, lastAttempt: missing.last_attempt });
    return res.json({ state: 'unknown' });
  } catch (e) {
    return res.status(500).json({ state: 'unknown', error: e.message });
  }
});

/* ─────────────────────────────────────────────
   POST /api/lyrics/refresh-missing  (Step 11 — admin "Refresh Missing Lyrics")
   body: { coupleId, limit }
───────────────────────────────────────────── */
router.post('/refresh-missing', async (req, res) => {
  const { coupleId, limit } = req.body;
  if (!coupleId) return res.status(400).json({ error: 'coupleId required' });
  try {
    const { data: rows } = await supabase.from('missing_lyrics').select('*').eq('couple_id', coupleId).order('last_attempt', { ascending: true }).limit(limit || 20);
    const results = [];
    for (const row of (rows || [])) {
      const result = await smartSearch({ songId: row.song_id, title: row.title, artist: row.artist, album: row.album, durationSec: row.duration });
      if (result) {
        const lrcLatin = transliterateLRC(result.lrc);
        await supabase.from('cached_lyrics').upsert({
          song_id: row.song_id, couple_id: coupleId, title: row.title, artist: row.artist, album: row.album,
          duration: row.duration, provider: result.provider, lrc_text: result.lrc, lrc_text_latin: lrcLatin,
          sync_type: result.syncType, updated_at: new Date().toISOString(),
        }, { onConflict: 'song_id' });
        await supabase.from('missing_lyrics').delete().eq('song_id', row.song_id);
        await supabase.from('songs').update({
          lyrics: result.lrc, lyrics_native: result.lrc, lyrics_latin: lrcLatin,
          lyrics_cached: true, lyrics_source: result.provider, lyrics_updated_at: new Date().toISOString(),
        }).eq('id', row.song_id).eq('couple_id', coupleId);
        results.push({ songId: row.song_id, title: row.title, found: true, provider: result.provider });
      } else {
        await supabase.from('missing_lyrics').update({ attempts: row.attempts + 1, last_attempt: new Date().toISOString() }).eq('song_id', row.song_id);
        results.push({ songId: row.song_id, title: row.title, found: false });
      }
    }
    return res.json({ processed: results.length, found: results.filter(r => r.found).length, results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* ─────────────────────────────────────────────
   GET /api/lyrics/missing/:coupleId — dashboard list
───────────────────────────────────────────── */
router.get('/missing/:coupleId', async (req, res) => {
  const { data, error } = await supabase.from('missing_lyrics').select('*').eq('couple_id', req.params.coupleId).order('last_attempt', { ascending: false }).limit(100);
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

/* ─────────────────────────────────────────────
   GET /api/lyrics/stats/:coupleId — admin dashboard (Step 16)
───────────────────────────────────────────── */
router.get('/stats/:coupleId', async (req, res) => {
  try {
    const coupleId = req.params.coupleId;
    const [{ count: cachedCount }, { count: missingCount }, { data: history }] = await Promise.all([
      supabase.from('cached_lyrics').select('id', { count: 'exact', head: true }).eq('couple_id', coupleId),
      supabase.from('missing_lyrics').select('id', { count: 'exact', head: true }).eq('couple_id', coupleId),
      supabase.from('lyrics_search_history').select('provider, success, response_time').order('created_at', { ascending: false }).limit(1000),
    ]);
    const byProvider = {};
    (history || []).forEach(h => {
      const p = byProvider[h.provider] || (byProvider[h.provider] = { attempts: 0, successes: 0, totalMs: 0 });
      p.attempts++; if (h.success) p.successes++; p.totalMs += (h.response_time || 0);
    });
    Object.keys(byProvider).forEach(p => {
      const s = byProvider[p];
      s.successRate = s.attempts ? Math.round((s.successes / s.attempts) * 100) : 0;
      s.avgResponseMs = s.attempts ? Math.round(s.totalMs / s.attempts) : 0;
      delete s.totalMs;
    });
    const { data: sizeRows } = await supabase.from('cached_lyrics').select('lrc_text, lrc_text_latin').eq('couple_id', coupleId);
    const cacheSizeBytes = (sizeRows || []).reduce((sum, r) => sum + (r.lrc_text ? r.lrc_text.length : 0) + (r.lrc_text_latin ? r.lrc_text_latin.length : 0), 0);
    return res.json({ cachedCount: cachedCount || 0, missingCount: missingCount || 0, providerStats: byProvider, cacheSizeBytes });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* ─────────────────────────────────────────────
   POST /api/lyrics/clear-cache — admin "Clear Cache"
   body: { coupleId }
───────────────────────────────────────────── */
router.post('/clear-cache', async (req, res) => {
  const { coupleId } = req.body;
  if (!coupleId) return res.status(400).json({ error: 'coupleId required' });
  try {
    await supabase.from('cached_lyrics').delete().eq('couple_id', coupleId);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;