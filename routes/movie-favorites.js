// ════════════════════════════════════════════════════════════════
//  routes/movie-favorites.js — Couple movie watchlist / favorites
//  Register in server.js:
//    app.use('/api/movie-fav', require('./routes/movie-favorites'));
//
//  Per-couple list stored in Supabase (movie_favorites table).
//  Both partners see the same list.
// ════════════════════════════════════════════════════════════════
const express = require('express');
const supabase = require('../middleware/supabase');
const router = express.Router();

// ── GET /api/movie-fav?coupleId= ─────────────────────────────────────
// List all favorite movies for a couple, newest first.
router.get('/', async (req, res) => {
  try {
    const { coupleId } = req.query;
    if (!coupleId) return res.status(400).json({ error: 'coupleId required' });
    const { data, error } = await supabase
      .from('movie_favorites')
      .select('*')
      .eq('couple_id', coupleId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ favorites: data || [] });
  } catch (e) {
    console.error('[movie-fav] list failed:', e.message);
    res.status(500).json({ error: 'Failed to load favorites' });
  }
});

// ── POST /api/movie-fav ─────────────────────────────────────────────
// Body: { coupleId, tmdbId?, title, year, genre, posterUrl, backdropUrl, overview, rating?, status?, addedBy }
// Adds a movie to the couple's watchlist. Dedupes by couple_id + tmdb_id.
router.post('/', async (req, res) => {
  try {
    const {
      coupleId, tmdbId, title, year, genre, posterUrl,
      backdropUrl, overview, rating, status = 'watchlist', addedBy
    } = req.body || {};
    if (!coupleId || !title) return res.status(400).json({ error: 'coupleId and title required' });

    // Dedup: if tmdbId given, don't add duplicate
    if (tmdbId) {
      const { data: existing } = await supabase
        .from('movie_favorites')
        .select('id')
        .eq('couple_id', coupleId)
        .eq('tmdb_id', String(tmdbId))
        .maybeSingle();
      if (existing) return res.status(409).json({ error: 'Already in your list', id: existing.id });
    }

    const { data, error } = await supabase
      .from('movie_favorites')
      .insert({
        couple_id: coupleId,
        tmdb_id: tmdbId || null,
        title,
        year: year || null,
        genre: genre || null,
        poster_url: posterUrl || null,
        backdrop_url: backdropUrl || null,
        overview: overview || null,
        rating: rating || null,
        status,
        added_by: addedBy || null,
        created_at: new Date().toISOString()
      })
      .select()
      .single();
    if (error) throw error;
    res.json({ ok: true, favorite: data });
  } catch (e) {
    console.error('[movie-fav] add failed:', e.message);
    res.status(500).json({ error: 'Failed to add favorite' });
  }
});

// ── PATCH /api/movie-fav/:id ─────────────────────────────────────────
// Body: { status?, rating?, review?, ... } — update watch status etc.
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rating } = req.body || {};
    const patch = { updated_at: new Date().toISOString() };
    if (status) patch.status = status;
    if (rating !== undefined) patch.rating = rating;
    const { data, error } = await supabase
      .from('movie_favorites')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, favorite: data });
  } catch (e) {
    console.error('[movie-fav] update failed:', e.message);
    res.status(500).json({ error: 'Failed to update' });
  }
});

// ── DELETE /api/movie-fav/:id ────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('movie_favorites').delete().eq('id', id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    console.error('[movie-fav] delete failed:', e.message);
    res.status(500).json({ error: 'Failed to delete' });
  }
});

module.exports = router;
