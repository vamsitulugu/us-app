// ═══════════════════════════════════════════════════════
//  Personal Recordings Routes — individual voice/video
//  recordings metadata CRUD (Supabase-backed).
//  Mirrors routes/music.js. Wire up in server.js:
//    app.use('/api/recordings', require('./routes/recordings'));
//
//  Media bytes themselves go through the existing
//  /api/media/upload-recording endpoint (routes/media.js) —
//  this route only stores/reads the metadata row afterward,
//  same "upload media first, then create the DB record" flow
//  already used for songs.
// ═══════════════════════════════════════════════════════
const express  = require('express');
const supabase = require('../middleware/supabase');
const router   = express.Router();

// GET all individual recordings for a couple (both partners)
router.get('/:coupleId', async (req, res) => {
  const { data, error } = await supabase
    .from('personal_recordings')
    .select('*')
    .eq('couple_id', req.params.coupleId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST create a recording's metadata row (call AFTER the file has been
// uploaded to storage via /api/media/upload-recording)
router.post('/', async (req, res) => {
  const {
    coupleId, userId, title, mediaType, mediaUrl, storagePath,
    durationSec, note
  } = req.body;

  if (!coupleId || !userId || !mediaType || !mediaUrl || !storagePath) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (mediaType !== 'audio' && mediaType !== 'video') {
    return res.status(400).json({ error: 'mediaType must be audio or video' });
  }

  const row = {
    couple_id:    coupleId,
    user_id:      userId,
    title:        title || 'Untitled',
    media_type:   mediaType,
    media_url:    mediaUrl,
    storage_path: storagePath,
    duration_sec: durationSec || 0,
    note:         note || null,
  };

  const { data, error } = await supabase.from('personal_recordings').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Best-effort push to partner — reuse the same helper songs use.
  try {
    const { sendPushToPartner } = require('./auth');
    if (sendPushToPartner) {
      sendPushToPartner(coupleId, userId, {
        title: mediaType === 'video' ? '🎥 New Recording' : '🎙 New Recording',
        body: title || 'Your partner recorded a new song',
        icon: '/icons/icon-192.png',
        tag: 'my-recordings',
        url: '/?page=music'
      }).catch(() => {});
    }
  } catch (_) {}

  return res.json(data);
});

// PATCH update a recording (favorite, rename, note)
router.patch('/:id', async (req, res) => {
  const { coupleId, ...fields } = req.body;
  if (!coupleId) return res.status(400).json({ error: 'coupleId required' });

  const updates = {};
  if (fields.title      !== undefined) updates.title       = fields.title;
  if (fields.note       !== undefined) updates.note        = fields.note;
  if (fields.isFavorite !== undefined) updates.is_favorite  = fields.isFavorite;

  const { data, error } = await supabase
    .from('personal_recordings')
    .update(updates)
    .eq('id', req.params.id)
    .eq('couple_id', coupleId)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// DELETE a recording — only the owner (userId) may delete their own.
// Caller should also call /api/media/delete-recording with storage_path
// (the client already has it from the GET list) to clean up storage.
router.delete('/:id', async (req, res) => {
  const { coupleId, userId } = req.body;
  if (!coupleId) return res.status(400).json({ error: 'coupleId required' });
  if (!userId)   return res.status(400).json({ error: 'userId required' });

  const { data: existing, error: findErr } = await supabase
    .from('personal_recordings')
    .select('id, user_id, storage_path')
    .eq('id', req.params.id)
    .eq('couple_id', coupleId)
    .single();
  if (findErr || !existing) return res.status(404).json({ error: 'Recording not found' });
  if (existing.user_id !== userId) return res.status(403).json({ error: 'Not authorized to delete this recording' });

  await supabase.from('personal_recordings').delete().eq('id', req.params.id).eq('couple_id', coupleId);
  return res.json({ ok: true, storagePath: existing.storage_path });
});

module.exports = router;
