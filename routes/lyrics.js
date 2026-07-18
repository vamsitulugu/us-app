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
const FETCH_TIMEOUT_MS = 2500;
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
    .replace(/[^a-z0-9]+/g, ' ')
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
async function fetchJson(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'US-Couple-App/1.0' }, signal: controller.signal });
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
   PROVIDERS — searched in priority order. Each provider function:
     - never throws (catches its own errors)
     - returns { lrc, syncType } on success, or null on miss/failure
     - logs its own attempt to lyrics_search_history via logAttempt()
───────────────────────────────────────────── */
async function logAttempt({ songId, provider, query, success, responseTimeMs }) {
  try {
    await supabase.from('lyrics_search_history').insert({
      song_id: songId || null, provider, query, success, response_time: responseTimeMs,
    });
  } catch (e) { /* logging must never break the search */ }
}

// Priority 1 — LRCLIB (synced, free, no key required)
async function providerLRCLIB({ songId, title, artist, album, durationSec }) {
  const started = Date.now();
  const expectedScript = detectScript(`${title || ''} ${artist || ''}`);
  const jobs = [];

  if (title && artist) {
    const qs = new URLSearchParams({ track_name: title, artist_name: artist });
    if (album) qs.set('album_name', album);
    if (durationSec) qs.set('duration', String(Math.round(durationSec)));
    jobs.push({ type: 'direct', promise: fetchJson(`${LRCLIB_BASE}/get?${qs.toString()}`) });
  }
  const attempts = [];
  if (title && artist) attempts.push(`${title} ${artist}`);
  if (title) attempts.push(title);
  [...new Set(attempts.filter(Boolean))].forEach(q => {
    jobs.push({ type: 'search', promise: fetchJson(`${LRCLIB_BASE}/search?q=${encodeURIComponent(q)}`) });
  });

  const settled = await Promise.allSettled(jobs.map(j => j.promise));
  const directIdx = jobs.findIndex(j => j.type === 'direct');
  if (directIdx > -1 && settled[directIdx].status === 'fulfilled') {
    const direct = settled[directIdx].value;
    if (direct && direct.syncedLyrics && !candidateScriptMismatch(expectedScript, direct.syncedLyrics)) {
      await logAttempt({ songId, provider: 'lrclib', query: `${title} ${artist || ''}`, success: true, responseTimeMs: Date.now() - started });
      return { lrc: direct.syncedLyrics, syncType: 'synced' };
    }
  }
  let best = null, bestScore = -1;
  jobs.forEach((job, i) => {
    if (job.type !== 'search') return;
    const r = settled[i];
    if (r.status !== 'fulfilled' || !Array.isArray(r.value)) return;
    for (const cand of r.value) {
      if (!cand.syncedLyrics || candidateScriptMismatch(expectedScript, cand.syncedLyrics)) continue;
      const titleScore = similarity(title || '', cand.trackName || '');
      const artistScore = artist ? similarity(artist, cand.artistName || '') : 0.5;
      let durScore = 0.5;
      if (durationSec && cand.duration) {
        durScore = Math.abs(cand.duration - durationSec) <= DURATION_TOLERANCE ? 1 : Math.max(0, 1 - Math.abs(cand.duration - durationSec) / 30);
      }
      const score = titleScore * 0.5 + artistScore * 0.3 + durScore * 0.2;
      if (score > bestScore) { bestScore = score; best = cand; }
    }
  });
  if (best && bestScore >= 0.35) {
    await logAttempt({ songId, provider: 'lrclib', query: `${title} ${artist || ''}`, success: true, responseTimeMs: Date.now() - started });
    return { lrc: best.syncedLyrics, syncType: 'synced' };
  }
  await logAttempt({ songId, provider: 'lrclib', query: `${title} ${artist || ''}`, success: false, responseTimeMs: Date.now() - started });
  return null;
}

// Priority 2 — LRCMUX (community synced-lyrics mirror). Endpoint shape
// varies by deployment — wrapped in try/catch so a dead/misconfigured
// mirror just counts as a miss and the chain moves on, per Step 14.
async function providerLRCMUX({ songId, title, artist, durationSec }) {
  const started = Date.now();
  if (!title || !artist) { await logAttempt({ songId, provider: 'lrcmux', query: title, success: false, responseTimeMs: 0 }); return null; }
  try {
    const qs = new URLSearchParams({ title, artist });
    if (durationSec) qs.set('duration', String(Math.round(durationSec)));
    const data = await fetchJson(`https://lrcmux.deno.dev/api/search?${qs.toString()}`);
    const lrc = data && (data.syncedLyrics || data.lrc || (Array.isArray(data.results) && data.results[0] && data.results[0].syncedLyrics));
    if (lrc) {
      await logAttempt({ songId, provider: 'lrcmux', query: `${title} ${artist}`, success: true, responseTimeMs: Date.now() - started });
      return { lrc, syncType: 'synced' };
    }
  } catch (e) { /* fall through to miss */ }
  await logAttempt({ songId, provider: 'lrcmux', query: `${title} ${artist || ''}`, success: false, responseTimeMs: Date.now() - started });
  return null;
}

// Priority 3 — lyrics.ovh (free, plain/unsynced text only). Last-resort
// fallback so "no lyrics at all" is rarer, clearly marked sync_type='plain'
// so the player can show it without pretending it's timestamp-synced.
async function providerLyricsOvh({ songId, title, artist }) {
  const started = Date.now();
  if (!title || !artist) { await logAttempt({ songId, provider: 'lyricsovh', query: title, success: false, responseTimeMs: 0 }); return null; }
  try {
    const data = await fetchJson(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
    if (data && data.lyrics && data.lyrics.trim()) {
      await logAttempt({ songId, provider: 'lyricsovh', query: `${title} ${artist}`, success: true, responseTimeMs: Date.now() - started });
      return { lrc: data.lyrics.trim(), syncType: 'plain' };
    }
  } catch (e) { /* fall through to miss */ }
  await logAttempt({ songId, provider: 'lyricsovh', query: `${title} ${artist || ''}`, success: false, responseTimeMs: Date.now() - started });
  return null;
}

const PROVIDERS = [
  { id: 'lrclib', run: providerLRCLIB },
  { id: 'lrcmux', run: providerLRCMUX },
  { id: 'lyricsovh', run: providerLyricsOvh },
];

/* ─────────────────────────────────────────────
   SMART SEARCH ENGINE — Step 5 multi-attempt strategy, run once
   PER PROVIDER, in priority order, stopping at the first success
   across the whole provider list.
───────────────────────────────────────────── */
function fuzzyTitle(title) {
  if (!title) return title;
  return title.replace(/\s*[\(\[][^()\[\]]*[\)\]]\s*$/g, '').trim() || title;
}

async function smartSearch({ songId, title, artist, album, durationSec }) {
  const attempts = [
    { title, artist },
    { title, artist: undefined },
    { title, artist: undefined, album },
    { title, artist: undefined, durationSec },
    { title: fuzzyTitle(title), artist },
  ];
  for (const provider of PROVIDERS) {
    for (const attempt of attempts) {
      const result = await provider.run({
        songId, title: attempt.title, artist: attempt.artist, album: attempt.album, durationSec,
      });
      if (result && result.lrc) return { ...result, provider: provider.id };
    }
  }
  return null;
}

/* ─────────────────────────────────────────────
   POST /api/lyrics/auto-fetch
   Called ONLY from the import background worker (never from playback).
   body: { songId, coupleId, title, artist, album, durationSec }
───────────────────────────────────────────── */
router.post('/auto-fetch', async (req, res) => {
  const { songId, coupleId, title, artist, album, durationSec } = req.body;
  if (!title) return res.status(400).json({ found: false, error: 'title required' });

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

    const result = await smartSearch({ songId, title, artist, album, durationSec });

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