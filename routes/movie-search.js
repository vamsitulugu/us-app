// ════════════════════════════════════════════════════════════════
//  routes/movie-search.js — TMDB proxy (free movie search + metadata)
//  Register in server.js:
//    app.use('/api/movie-search', require('./routes/movie-search'));
//
//  Uses TMDB API (https://www.themoviedb.org/) — free tier, no credit card.
//  Get your free API key at https://www.themoviedb.org/settings/api
//  Set TMDB_API_KEY in your .env / Render env vars.
//  All API calls go through this server so your key never reaches the browser.
// ════════════════════════════════════════════════════════════════
const express = require('express');
const supabase = require('../middleware/supabase');
const router = express.Router();

// Render env is often mistyped as TMDB_APT_KEY. Also accept the long
// "API Read Access Token" (JWT) via TMDB_READ_TOKEN or if the key itself
// looks like a JWT. Fall back to the v3 key shipped in .env.example.
function envTrim(...names) {
  for (const n of names) {
    const v = (process.env[n] || '').trim().replace(/^['"]|['"]$/g, '');
    if (v) return v;
  }
  return '';
}

function getCredentials() {
  let apiKey = envTrim('TMDB_API_KEY', 'TMDB_APT_KEY', 'THEMOVIEDB_API_KEY');
  let readToken = envTrim('TMDB_READ_TOKEN', 'TMDB_ACCESS_TOKEN');
  if (apiKey.startsWith('eyJ') && !readToken) {
    readToken = apiKey;
    apiKey = '';
  }
  return { apiKey, readToken };
}

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE = 'https://image.tmdb.org/t/p/';

function requireKey(res) {
  const { apiKey, readToken } = getCredentials();
  if (!apiKey && !readToken) {
    res.status(503).json({
      error: 'TMDB API key not configured. Set TMDB_API_KEY in server env vars.',
      setup: 'Get a free key at https://www.themoviedb.org/settings/api'
    });
    return false;
  }
  return true;
}

async function tmdbRequest(path, params, { bearer, apiKey }) {
  const qs = new URLSearchParams({ ...params, language: 'en-US' });
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'TwinHearts-MovieSearch/1.0'
  };
  if (bearer) headers.Authorization = 'Bearer ' + bearer;
  else if (apiKey) qs.set('api_key', apiKey);
  else throw new Error('TMDB_API_KEY not set');
  const r = await fetch(`${TMDB_BASE}${path}?${qs}`, {
    headers,
    signal: AbortSignal.timeout(15000)
  });
  return r;
}

async function tmdbFetch(path, params = {}) {
  const { apiKey, readToken } = getCredentials();
  if (!apiKey && !readToken) throw new Error('TMDB_API_KEY not set');

  // Prefer the v3 api_key query (what TMDB dashboard calls "API Key").
  // If that 401s, retry with the read-access JWT as Bearer.
  const attempts = [];
  if (apiKey) attempts.push({ apiKey });
  if (readToken) attempts.push({ bearer: readToken });
  if (apiKey && !readToken) attempts.push({ bearer: apiKey });

  let lastStatus = 0;
  for (let i = 0; i < attempts.length; i++) {
    const r = await tmdbRequest(path, params, attempts[i]);
    lastStatus = r.status;
    if (r.ok) return r.json();
    if (r.status !== 401 && r.status !== 403) {
      throw new Error(`TMDB ${r.status}`);
    }
  }
  throw new Error(
    lastStatus === 401
      ? 'TMDB rejected the API key (401). On Render the variable must be named TMDB_API_KEY (not TMDB_APT_KEY) and the value must be the short API Key from themoviedb.org/settings/api'
      : `TMDB ${lastStatus}`
  );
}

// ── GET /api/movie-search/search?q= ─────────────────────────────────
// Search movies by title. Returns TMDB results with poster paths.
router.get('/search', async (req, res) => {
  if (!requireKey(res)) return;
  const { q, page = 1 } = req.query;
  if (!q || !q.trim()) return res.status(400).json({ error: 'q required' });
  try {
    const data = await tmdbFetch('/search/movie', { query: q.trim(), page: Math.max(1, parseInt(page, 10) || 1) });
    res.json({
      results: (data.results || []).map((m) => ({
        id: m.id,
        tmdb_id: String(m.id),
        title: m.title,
        year: m.release_date ? m.release_date.slice(0, 4) : '',
        genre: '', // TMDB search doesn't return genres; fill on details
        poster_url: m.poster_path ? TMDB_IMAGE + 'w500' + m.poster_path : null,
        backdrop_url: m.backdrop_path ? TMDB_IMAGE + 'w780' + m.backdrop_path : null,
        overview: m.overview || '',
        rating: m.vote_average || null,
        source: 'tmdb'
      })),
      page: data.page,
      total_pages: data.total_pages,
      total_results: data.total_results
    });
  } catch (e) {
    console.error('[movie-search] search failed:', e.message);
    res.status(502).json({ error: 'Movie search failed — ' + e.message });
  }
});

// ── GET /api/movie-search/:tmdbId/details ────────────────────────────
// Get full movie details including genres, runtime, etc.
router.get('/:tmdbId/details', async (req, res) => {
  if (!requireKey(res)) return;
  const { tmdbId } = req.params;
  try {
    const m = await tmdbFetch(`/movie/${tmdbId}`, { append_to_response: 'credits' });
    const genres = (m.genres || []).map((g) => g.name).join(', ');
    const director = (m.credits && m.credits.crew && m.credits.crew.find((c) => c.job === 'Director')) || {};
    res.json({
      id: m.id,
      tmdb_id: String(m.id),
      title: m.title,
      year: m.release_date ? m.release_date.slice(0, 4) : '',
      genre: genres || '',
      poster_url: m.poster_path ? TMDB_IMAGE + 'w500' + m.poster_path : null,
      backdrop_url: m.backdrop_path ? TMDB_IMAGE + 'w780' + m.backdrop_path : null,
      overview: m.overview || '',
      rating: m.vote_average || null,
      runtime: m.runtime || null,
      director: director.name || '',
      source: 'tmdb'
    });
  } catch (e) {
    console.error('[movie-search] details failed:', e.message);
    res.status(502).json({ error: 'Movie details failed — ' + e.message });
  }
});

// ── GET /api/movie-search/:tmdbId/providers ──────────────────────────
// Where to watch (streaming providers) — for "free movies" section.
router.get('/:tmdbId/providers', async (req, res) => {
  if (!requireKey(res)) return;
  const { tmdbId } = req.params;
  try {
    const data = await tmdbFetch(`/movie/${tmdbId}/watch/providers`);
    const results = data.results || {};
    // Flatten all regions into a simple list
    const providers = [];
    for (const region of Object.keys(results)) {
      const reg = results[region];
      for (const tier of ['free', 'flatrate', 'ads']) {
        if (reg[tier]) {
          for (const p of reg[tier]) {
            providers.push({
              provider_id: p.provider_id,
              provider_name: p.provider_name,
              logo_path: p.logo_path ? 'https://image.tmdb.org/t/p/original' + p.logo_path : null,
              tier, // free / flatrate / ads
              region
            });
          }
        }
      }
    }
    res.json({ providers });
  } catch (e) {
    console.error('[movie-search] providers failed:', e.message);
    res.status(502).json({ error: 'Providers failed — ' + e.message });
  }
});

module.exports = router;
