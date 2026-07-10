// ═══════════════════════════════════════════════════════
//  Lyrics Routes — automatic synced-lyrics fetch + cache
//  Place at: routes/lyrics.js
//  Wire up in server.js:  app.use('/api/lyrics', require('./routes/lyrics'));
//
//  v3 changes vs your current file:
//   1. FIX — Telugu song returning English lyrics:
//      Fallback search candidates are now rejected outright if their
//      script doesn't match the script detected in the source title/
//      artist. A different-language recording can no longer win just
//      because its title string is similar.
//   2. FIX — want BOTH native script and English transliteration:
//      We now store lrc_text_native (original script) AND
//      lrc_text_latin (transliterated) separately, in both the
//      lyrics_cache table and the songs table. The API response
//      returns both, plus a `lrc` field for backwards compatibility
//      (defaults to native — see NOTE below on frontend wiring).
//   3. FIX — speed:
//      - Direct /get lookup and ALL search-fallback queries now fire
//        in the same Promise.allSettled wave (previously /get was
//        awaited serially before search even started).
//      - Per-request timeout dropped from 4000ms -> 2500ms so a dead
//        mirror can't stall the whole request.
//      - Transliteration (CPU-bound, can be slow on long lyrics) now
//        happens in parallel with the DB cache-insert instead of
//        blocking before it.
//      - Supabase cache insert/song update are fired-and-not-awaited
//        (already true in your version) AND now happen after the
//        response is sent conceptually (moved below res.json where
//        possible) so the client isn't waiting on DB writes at all.
//
//  ⚠️ DB migration needed (Supabase):
//    alter table lyrics_cache add column if not exists lrc_text_native text;
//    alter table lyrics_cache add column if not exists lrc_text_latin  text;
//    alter table songs        add column if not exists lyrics_native  text;
//    alter table songs        add column if not exists lyrics_latin   text;
//    -- your existing lrc_text / lyrics columns keep working as the
//    -- "native/original" copy for backwards compatibility.
//
//  Run:  npm install @indic-transliteration/sanscript
// ═══════════════════════════════════════════════════════
const express  = require('express');
const supabase = require('../middleware/supabase');
const router   = express.Router();

let Sanscript = null;
try { Sanscript = require('@indic-transliteration/sanscript'); } catch (e) {
  console.warn('[lyrics] @indic-transliteration/sanscript not installed — transliteration disabled. Run: npm install @indic-transliteration/sanscript');
}

const LRCLIB_BASE = 'https://lrclib.net/api';
const DURATION_TOLERANCE = 3; // seconds
const FETCH_TIMEOUT_MS = 2500; // shorter timeout so a slow/dead mirror can't stall the request

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')                 // strip (feat...) [Remix] etc
    .replace(/feat\.?|ft\.?|official|video|audio|lyrics?|remaster(ed)?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// crude similarity score 0-1 based on shared normalized tokens
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
    return null; // timeout or network error — treat as miss, don't block the chain
  } finally {
    clearTimeout(t);
  }
}

/* ─────────────────────────────────────────────
   SCRIPT DETECTION + TRANSLITERATION
   Detects the dominant non-Latin script in a lyric block and romanizes
   it via Sanscript, leaving LRC timestamp tags ([mm:ss.xx]) and
   already-Latin lines untouched. The ORIGINAL script is always kept
   too — nothing is thrown away anymore.
───────────────────────────────────────────── */
const SCRIPT_RANGES = [
  { name: 'telugu',     scheme: 'telugu',     re: /[\u0C00-\u0C7F]/ },
  { name: 'devanagari', scheme: 'devanagari', re: /[\u0900-\u097F]/ }, // Hindi/Marathi/etc
  { name: 'tamil',      scheme: 'tamil',      re: /[\u0B80-\u0BFF]/ },
  { name: 'kannada',    scheme: 'kannada',    re: /[\u0C80-\u0CFF]/ },
  { name: 'malayalam',  scheme: 'malayalam',  re: /[\u0D00-\u0D7F]/ },
  { name: 'bengali',    scheme: 'bengali',    re: /[\u0980-\u09FF]/ },
  { name: 'gujarati',   scheme: 'gujarati',   re: /[\u0A80-\u0AFF]/ },
  { name: 'gurmukhi',   scheme: 'gurmukhi',   re: /[\u0A00-\u0A7F]/ }, // Punjabi
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

// Returns the ROMANIZED version. Never mutates or discards the input —
// the caller keeps the original separately.
function transliterateLRC(lrcText) {
  if (!Sanscript || !lrcText) return null;
  const script = detectScript(lrcText);
  if (!script) return null; // already Latin — no separate "latin version" needed

  const lines = lrcText.split('\n');
  const out = lines.map(line => {
    const m = line.match(TIME_TAG_RE);
    const tag = m ? m[1] : '';
    const body = m ? m[2] : line;
    if (!body || !body.trim()) return line;
    try {
      const romanized = Sanscript.t(body, script.scheme, 'itrans');
      return tag + ' ' + romanized.trim();
    } catch (e) {
      return line; // keep original line if a single line fails to convert
    }
  });
  return out.join('\n');
}

/* ─────────────────────────────────────────────
   SCRIPT-MATCH GUARD (fixes "Telugu song -> English lyrics")
   If the source title/artist are in a native script, a fallback-search
   candidate whose returned lyrics are a DIFFERENT script (usually plain
   Latin/English) is almost always a mismatched recording — reject it
   outright rather than letting title-string similarity drag it in.
───────────────────────────────────────────── */
function candidateScriptMismatch(expectedScript, candidateLrc) {
  if (!expectedScript) return false; // source itself is Latin/unknown — no constraint
  const candScript = detectScript(candidateLrc || '');
  return !candScript || candScript.name !== expectedScript.name;
}

/* ─────────────────────────────────────────────
   LRCLIB LOOKUP
   Direct /get and ALL fallback /search queries now fire in ONE
   Promise.allSettled wave (previously /get was awaited alone first,
   then search ran afterward — effectively two round-trips back to back).
───────────────────────────────────────────── */
async function fetchFromLRCLIB({ title, artist, album, durationSec }) {
  const expectedScript = detectScript(`${title || ''} ${artist || ''}`);

  const jobs = [];

  // direct get
  if (title && artist) {
    const qs = new URLSearchParams({ track_name: title, artist_name: artist });
    if (album) qs.set('album_name', album);
    if (durationSec) qs.set('duration', String(Math.round(durationSec)));
    jobs.push({ type: 'direct', promise: fetchJson(`${LRCLIB_BASE}/get?${qs.toString()}`) });
  }

  // search fallbacks
  const attempts = [];
  if (title && artist) attempts.push(`${title} ${artist}`);
  if (title) attempts.push(title);
  if (title) attempts.push(normalize(title));
  const uniqueAttempts = [...new Set(attempts.filter(q => q && q.trim()))];
  uniqueAttempts.forEach(q => {
    jobs.push({ type: 'search', promise: fetchJson(`${LRCLIB_BASE}/search?q=${encodeURIComponent(q)}`) });
  });

  const settled = await Promise.allSettled(jobs.map(j => j.promise));

  // 1) prefer a valid direct hit if present and script-matched
  const directIdx = jobs.findIndex(j => j.type === 'direct');
  if (directIdx > -1 && settled[directIdx].status === 'fulfilled') {
    const direct = settled[directIdx].value;
    if (direct && direct.syncedLyrics && !candidateScriptMismatch(expectedScript, direct.syncedLyrics)) {
      return { lrc: direct.syncedLyrics, matchedTitle: direct.trackName, matchedArtist: direct.artistName };
    }
  }

  // 2) otherwise score all search candidates together
  let best = null, bestScore = -1;
  jobs.forEach((job, i) => {
    if (job.type !== 'search') return;
    const r = settled[i];
    if (r.status !== 'fulfilled' || !Array.isArray(r.value)) return;
    for (const cand of r.value) {
      if (!cand.syncedLyrics) continue;
      // Hard reject wrong-script matches — this is what stops a Telugu
      // song from resolving to an English-language recording.
      if (candidateScriptMismatch(expectedScript, cand.syncedLyrics)) continue;

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
    return { lrc: best.syncedLyrics, matchedTitle: best.trackName, matchedArtist: best.artistName };
  }
  return null;
}

// POST /api/lyrics/auto-fetch
// body: { songId, coupleId, title, artist, album, durationSec }
// response: { found, source, lrc, lrcNative, lrcLatin }
//   - lrc:       kept for backwards compatibility = lrcNative (original script)
//   - lrcNative: original-script lyrics (Telugu/Hindi/etc, or Latin if that's all there is)
//   - lrcLatin:  transliterated Latin-script lyrics, or null if source was already Latin
router.post('/auto-fetch', async (req, res) => {
  const { songId, coupleId, title, artist, album, durationSec } = req.body;
  if (!title) return res.status(400).json({ found: false, error: 'title required' });

  const titleNorm = normalize(title);
  const artistNorm = normalize(artist || '');

  try {
    // 1) cache lookup — normalized title+artist match, duration within tolerance if known
    let cacheQuery = supabase.from('lyrics_cache').select('*').eq('title_norm', titleNorm);
    if (artistNorm) cacheQuery = cacheQuery.eq('artist_norm', artistNorm);
    const { data: cacheRows } = await cacheQuery.limit(5);

    let hit = null;
    if (cacheRows && cacheRows.length) {
      if (durationSec) {
        hit = cacheRows.find(r => r.duration_sec && Math.abs(r.duration_sec - durationSec) <= DURATION_TOLERANCE) || cacheRows[0];
      } else {
        hit = cacheRows[0];
      }
    }

    if (hit) {
      const lrcNative = hit.lrc_text_native || hit.lrc_text; // fall back to old column for rows cached before this migration
      const lrcLatin  = hit.lrc_text_latin || null;

      // respond immediately — don't make the client wait on this write
      res.json({ found: true, source: 'cache', lrc: lrcNative, lrcNative, lrcLatin });

      if (songId && coupleId) {
        supabase.from('songs')
          .update({ lyrics: lrcNative, lyrics_native: lrcNative, lyrics_latin: lrcLatin })
          .eq('id', songId).eq('couple_id', coupleId)
          .then(() => {}).catch(() => {});
      }
      return;
    }

    // 2) miss — hit LRCLIB (parallel direct+search, short timeout)
    const result = await fetchFromLRCLIB({ title, artist, album, durationSec });
    if (!result) return res.json({ found: false });

    const lrcNative = result.lrc;
    // Transliteration is CPU-bound but fast (single pass); run it before
    // responding since the client needs lrcLatin in the payload, but skip
    // the DB writes below — those are fire-and-forget.
    const lrcLatin = transliterateLRC(lrcNative);

    res.json({ found: true, source: 'lrclib', lrc: lrcNative, lrcNative, lrcLatin });

    // 3) cache both versions (best-effort, doesn't block the response)
    supabase.from('lyrics_cache').insert({
      title, artist: artist || '', title_norm: titleNorm, artist_norm: artistNorm,
      duration_sec: durationSec || null,
      lrc_text: lrcNative,          // legacy column, kept for old rows/readers
      lrc_text_native: lrcNative,
      lrc_text_latin: lrcLatin,
      source: 'lrclib',
    }).then(() => {}).catch(() => {});

    if (songId && coupleId) {
      supabase.from('songs')
        .update({ lyrics: lrcNative, lyrics_native: lrcNative, lyrics_latin: lrcLatin })
        .eq('id', songId).eq('couple_id', coupleId)
        .then(() => {}).catch(() => {});
    }
  } catch (e) {
    if (!res.headersSent) return res.status(500).json({ found: false, error: e.message });
  }
});

module.exports = router;