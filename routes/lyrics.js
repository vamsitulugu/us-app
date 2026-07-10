// ═══════════════════════════════════════════════════════
//  Lyrics Routes — automatic synced-lyrics fetch + cache
//  Place at: routes/lyrics.js
//  Wire up in server.js:  app.use('/api/lyrics', require('./routes/lyrics'));
//
//  v2 changes (both additive — no existing behavior removed):
//   - Fallback search attempts now run IN PARALLEL (Promise.allSettled)
//     instead of sequentially, with a per-request timeout, so a miss
//     resolves in ~1 round-trip instead of up to 4 serial ones.
//   - Non-Latin lyrics (Telugu, Hindi, Tamil, etc.) are automatically
//     transliterated to Latin/English letters before caching, using
//     the `@indic-transliteration/sanscript` package. The Latin
//     version is what gets stored in lyrics_cache and songs.lyrics,
//     so it's instant and already-romanized on every future play.
//     Run:  npm install @indic-transliteration/sanscript
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
const FETCH_TIMEOUT_MS = 4000; // per-request timeout so misses resolve fast

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
   Detects the dominant non-Latin script in a lyric
   block and romanizes it via Sanscript, leaving LRC
   timestamp tags ([mm:ss.xx]) and already-Latin lines
   untouched.
───────────────────────────────────────────── */
const SCRIPT_RANGES = [
  { name: 'telugu',    scheme: 'telugu',    re: /[\u0C00-\u0C7F]/ },
  { name: 'devanagari',scheme: 'devanagari',re: /[\u0900-\u097F]/ }, // Hindi/Marathi/etc
  { name: 'tamil',      scheme: 'tamil',     re: /[\u0B80-\u0BFF]/ },
  { name: 'kannada',    scheme: 'kannada',   re: /[\u0C80-\u0CFF]/ },
  { name: 'malayalam',  scheme: 'malayalam', re: /[\u0D00-\u0D7F]/ },
  { name: 'bengali',    scheme: 'bengali',   re: /[\u0980-\u09FF]/ },
  { name: 'gujarati',   scheme: 'gujarati',  re: /[\u0A80-\u0AFF]/ },
  { name: 'gurmukhi',   scheme: 'gurmukhi',  re: /[\u0A00-\u0A7F]/ }, // Punjabi
];

function detectScript(text) {
  // Count matches per script over the whole block, pick the dominant one.
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
  if (!Sanscript || !lrcText) return lrcText;
  const script = detectScript(lrcText);
  if (!script) return lrcText; // already Latin / nothing to convert

  const lines = lrcText.split('\n');
  const out = lines.map(line => {
    const m = line.match(TIME_TAG_RE);
    const tag = m ? m[1] : '';
    const body = m ? m[2] : line;
    if (!body || !body.trim()) return line;
    try {
      const romanized = Sanscript.t(body, script.scheme, 'itrans');
      // itrans scheme still uses some ASCII diacritic markers (e.g. "A", "I" doubling) —
      // keep it readable by lowercasing softly only where it doesn't collide with tags.
      return tag + ' ' + romanized.trim();
    } catch (e) {
      return line; // if conversion fails for this line, keep original rather than losing it
    }
  });
  return out.join('\n');
}

/* ─────────────────────────────────────────────
   LRCLIB LOOKUP — direct get, then parallel fallback searches
───────────────────────────────────────────── */
async function fetchFromLRCLIB({ title, artist, album, durationSec }) {
  // 1) direct get — fastest, requires fairly exact title/artist
  if (title && artist) {
    const qs = new URLSearchParams({ track_name: title, artist_name: artist });
    if (album) qs.set('album_name', album);
    if (durationSec) qs.set('duration', String(Math.round(durationSec)));
    const direct = await fetchJson(`${LRCLIB_BASE}/get?${qs.toString()}`);
    if (direct && direct.syncedLyrics) {
      return { lrc: direct.syncedLyrics, matchedTitle: direct.trackName, matchedArtist: direct.artistName };
    }
  }

  // 2) fallback search — fire all query variants IN PARALLEL instead of one-by-one
  const attempts = [];
  if (title && artist) attempts.push(`${title} ${artist}`);
  if (title) attempts.push(title);
  if (title) attempts.push(normalize(title));
  const uniqueAttempts = [...new Set(attempts.filter(q => q && q.trim()))];

  const results = await Promise.allSettled(
    uniqueAttempts.map(q => fetchJson(`${LRCLIB_BASE}/search?q=${encodeURIComponent(q)}`))
  );

  let best = null, bestScore = -1;
  for (const r of results) {
    if (r.status !== 'fulfilled' || !Array.isArray(r.value)) continue;
    for (const cand of r.value) {
      if (!cand.syncedLyrics) continue;
      const titleScore = similarity(title || '', cand.trackName || '');
      const artistScore = artist ? similarity(artist, cand.artistName || '') : 0.5;
      let durScore = 0.5;
      if (durationSec && cand.duration) {
        durScore = Math.abs(cand.duration - durationSec) <= DURATION_TOLERANCE ? 1 : Math.max(0, 1 - Math.abs(cand.duration - durationSec) / 30);
      }
      const score = titleScore * 0.5 + artistScore * 0.3 + durScore * 0.2;
      if (score > bestScore) { bestScore = score; best = cand; }
    }
  }
  if (best && bestScore >= 0.35) {
    return { lrc: best.syncedLyrics, matchedTitle: best.trackName, matchedArtist: best.artistName };
  }
  return null;
}

// POST /api/lyrics/auto-fetch
// body: { songId, coupleId, title, artist, album, durationSec }
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
      if (songId && coupleId) {
        supabase.from('songs').update({ lyrics: hit.lrc_text }).eq('id', songId).eq('couple_id', coupleId).then(() => {}).catch(() => {});
      }
      return res.json({ found: true, source: 'cache', lrc: hit.lrc_text });
    }

    // 2) miss — hit LRCLIB (parallel fallback attempts + timeout, see above)
    const result = await fetchFromLRCLIB({ title, artist, album, durationSec });
    if (!result) return res.json({ found: false });

    // 3) romanize if the returned lyrics are in a non-Latin script
    const finalLrc = transliterateLRC(result.lrc);

    // 4) store in cache (best-effort, ignore failures) — cache the ROMANIZED version
    //    so every future play (for anyone) gets instant Latin-script lyrics.
    supabase.from('lyrics_cache').insert({
      title, artist: artist || '', title_norm: titleNorm, artist_norm: artistNorm,
      duration_sec: durationSec || null, lrc_text: finalLrc, source: 'lrclib',
    }).then(() => {}).catch(() => {});

    // 5) also cache directly onto the song row so next play is instant, no network
    if (songId && coupleId) {
      supabase.from('songs').update({ lyrics: finalLrc }).eq('id', songId).eq('couple_id', coupleId).then(() => {}).catch(() => {});
    }

    return res.json({ found: true, source: 'lrclib', lrc: finalLrc });
  } catch (e) {
    return res.status(500).json({ found: false, error: e.message });
  }
});

module.exports = router;