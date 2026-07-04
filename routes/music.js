// ═══════════════════════════════════════════════════════
//  Music Routes — song metadata CRUD (Supabase-backed).
//  Place at: routes/music.js
//  Wire up in server.js:  app.use('/api/music', require('./routes/music'));
// ═══════════════════════════════════════════════════════
const express  = require('express');
const supabase = require('../middleware/supabase');
const router   = express.Router();

let _sendPushToPartner;
try { _sendPushToPartner = require('./auth').sendPushToPartner; } catch (_) {}

// GET all songs for a couple
router.get('/:coupleId', async (req, res) => {
  const { data, error } = await supabase
    .from('songs')
    .select('*')
    .eq('couple_id', req.params.coupleId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST create song metadata (call AFTER audio+cover are uploaded to storage)
router.post('/', async (req, res) => {
  const { coupleId, title, artist, audioUrl, coverUrl, durationSec, lyrics, visibility, uploadedBy } = req.body;
  if (!coupleId || !title || !audioUrl || !uploadedBy) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const { data, error } = await supabase.from('songs').insert({
    couple_id:    coupleId,
    title,
    artist:       artist || 'Unknown Artist',
    audio_url:    audioUrl,
    cover_url:    coverUrl || null,
    duration_sec: durationSec || 0,
    lyrics:       lyrics || '',
    visibility:   visibility || 'both',
    uploaded_by:  uploadedBy,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Notify partner about the new shared song (skip if kept private to sender)
  if (_sendPushToPartner && visibility !== 'self') {
    _sendPushToPartner(coupleId, uploadedBy, {
      title: '🎵 New Song Shared',
      body: title + (artist ? ' — ' + artist : ''),
      icon: '/icons/icon-192.png',
      tag: 'music-song',
      url: '/?page=music'
    }).catch(() => {});
  }

  return res.json(data);
});

// PATCH update song (favorite, lyrics, play count, edit title/artist, etc.)
router.patch('/:id', async (req, res) => {
  const { coupleId, ...fields } = req.body;
  if (!coupleId) return res.status(400).json({ error: 'coupleId required' });

  const updates = {};
  if (fields.title       !== undefined) updates.title        = fields.title;
  if (fields.artist      !== undefined) updates.artist       = fields.artist;
  if (fields.lyrics      !== undefined) updates.lyrics       = fields.lyrics;
  if (fields.visibility  !== undefined) updates.visibility   = fields.visibility;
  if (fields.favorite    !== undefined) updates.favorite     = fields.favorite;
  if (fields.coverUrl    !== undefined) updates.cover_url    = fields.coverUrl;
  if (fields.incrementPlay) {
    updates.play_count  = supabase.raw ? undefined : undefined; // handled below
  }

  // increment play_count safely via read-modify-write (small table, fine)
  if (fields.incrementPlay) {
    const { data: existing } = await supabase.from('songs').select('play_count').eq('id', req.params.id).single();
    updates.play_count  = (existing?.play_count || 0) + 1;
    updates.last_played = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('songs')
    .update(updates)
    .eq('id', req.params.id)
    .eq('couple_id', coupleId)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// DELETE song (metadata row — caller should also delete storage files via /api/media/delete)
router.delete('/:id', async (req, res) => {
  const { coupleId } = req.body;
  if (!coupleId) return res.status(400).json({ error: 'coupleId required' });
  await supabase.from('songs').delete().eq('id', req.params.id).eq('couple_id', coupleId);
  return res.json({ ok: true });
});

module.exports = router;