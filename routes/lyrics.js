// ═══════════════════════════════════════════════════════
//  Lyrics Routes — automatic synced-lyrics fetch + cache
//  Place at: routes/lyrics.js
//  Wire up in server.js:  app.use('/api/lyrics', require('./routes/lyrics'));
//
//  Does NOT touch routes/music.js or the existing PATCH lyrics
//  flow — this only adds a new automatic source that ALSO writes
//  into songs.lyrics via the existing update, so the existing
//  player/parser picks it up exactly like a manually pasted lyric.
// ═══════════════════════════════════════════════════════
const express  = require('express');
const supabase = require('../middleware/supabase');
const router   = express.Router();

const LRCLIB_BASE = 'https://lrclib.net/api';
const DURATION_TOLERANCE = 3; // seconds

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

async function fetchJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'US-Couple-App/1.0' } });
  if (!r.ok) return null;
  try { return await r.json(); } catch (e) { return null; }
}

// Try LRCLIB direct /get (exact-ish match), then /search with fuzzy scoring.
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

  // 2) fallback search — try title+artist, then title alone, then normalized title
  const attempts = [];
  if (title && artist) attempts.push(`${title} ${artist}`);
  if (title) attempts.push(title);
  if (title) attempts.push(normalize(title));

  for (const q of attempts) {
    if (!q || !q.trim()) continue;
    const results = await fetchJson(`${LRCLIB_BASE}/search?q=${encodeURIComponent(q)}`);
    if (!Array.isArray(results) || !results.length) continue;

    // score candidates: title similarity + artist similarity + duration closeness
    let best = null, bestScore = -1;
    for (const r of results) {
      if (!r.syncedLyrics) continue;
      const titleScore = similarity(title || '', r.trackName || '');
      const artistScore = artist ? similarity(artist, r.artistName || '') : 0.5;
      let durScore = 0.5;
      if (durationSec && r.duration) {
        durScore = Math.abs(r.duration - durationSec) <= DURATION_TOLERANCE ? 1 : Math.max(0, 1 - Math.abs(r.duration - durationSec) / 30);
      }
      const score = titleScore * 0.5 + artistScore * 0.3 + durScore * 0.2;
      if (score > bestScore) { bestScore = score; best = r; }
    }
    if (best && bestScore >= 0.35) {
      return { lrc: best.syncedLyrics, matchedTitle: best.trackName, matchedArtist: best.artistName };
    }
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

    // 2) miss — hit LRCLIB
    const result = await fetchFromLRCLIB({ title, artist, album, durationSec });
    if (!result) return res.json({ found: false });

    // 3) store in cache (best-effort, ignore failures)
    supabase.from('lyrics_cache').insert({
      title, artist: artist || '', title_norm: titleNorm, artist_norm: artistNorm,
      duration_sec: durationSec || null, lrc_text: result.lrc, source: 'lrclib',
    }).then(() => {}).catch(() => {});

    // 4) also cache directly onto the song row so next play is instant, no network
    if (songId && coupleId) {
      supabase.from('songs').update({ lyrics: result.lrc }).eq('id', songId).eq('couple_id', coupleId).then(() => {}).catch(() => {});
    }

    return res.json({ found: true, source: 'lrclib', lrc: result.lrc });
  } catch (e) {
    return res.status(500).json({ found: false, error: e.message });
  }
});

module.exports = router;