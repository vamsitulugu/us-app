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
const { removeObjects } = require('../lib/storage');
const router   = express.Router();

// Best-effort storage cleanup. Only ever removes objects under the caller's
// own `${coupleId}/` prefix, so a forged storage_path can't reach other files.
function removeRecordingFiles(paths, coupleId) {
  const safe = (paths || []).filter((p) => p && !String(p).includes('..') && String(p).startsWith(`${coupleId}/`));
  return removeObjects(supabase, 'couple-recordings', safe);
}

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
    durationSec, note, kind, songId
  } = req.body;

  if (!coupleId || !userId || !mediaType || !mediaUrl || !storagePath) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (mediaType !== 'audio' && mediaType !== 'video') {
    return res.status(400).json({ error: 'mediaType must be audio or video' });
  }
  if (userId !== 'user1' && userId !== 'user2') {
    return res.status(400).json({ error: 'userId must be user1 or user2' });
  }
  // The file must be one this couple uploaded through /api/media/upload-recording.
  if (String(storagePath).includes('..') || !String(storagePath).startsWith(`${coupleId}/`)) {
    return res.status(400).json({ error: 'storagePath does not belong to this couple' });
  }

  const row = {
    couple_id:    coupleId,
    user_id:      userId,
    title:        String(title || 'Untitled').trim().slice(0, 120) || 'Untitled',
    media_type:   mediaType,
    media_url:    mediaUrl,
    storage_path: storagePath,
    duration_sec: Math.max(0, Math.round(Number(durationSec) || 0)),
    note:         note ? String(note).slice(0, 500) : null,
  };
  // kind/song_id come from migrations/music_v2.sql — if that has not been
  // applied yet, retry without them so recording never fails because of it.
  const extended = { ...row, kind: kind === 'karaoke' ? 'karaoke' : 'voice', song_id: songId ? String(songId) : null };
  let { data, error } = await supabase.from('personal_recordings').insert(extended).select().single();
  if (error && /kind|song_id|column|schema cache/i.test(error.message || '')) {
    ({ data, error } = await supabase.from('personal_recordings').insert(row).select().single());
  }
  if (error) return res.status(500).json({ error: error.message });

  // Best-effort push to partner — reuse the same helper songs use.
  try {
    const { sendPushToPartner } = require('./auth');
    if (sendPushToPartner) {
      sendPushToPartner(coupleId, userId, {
        title: mediaType === 'video' ? '🎥 New Recording' : '🎙 New Recording',
        body: row.title === 'Untitled' ? 'Your partner recorded a new song' : row.title,
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
  const { coupleId, userId, ...fields } = req.body;
  if (!coupleId) return res.status(400).json({ error: 'coupleId required' });

  const updates = {};
  if (fields.title      !== undefined) updates.title       = String(fields.title).trim().slice(0, 120) || 'Untitled';
  if (fields.note       !== undefined) updates.note        = fields.note ? String(fields.note).slice(0, 500) : null;
  if (fields.isFavorite !== undefined) updates.is_favorite  = !!fields.isFavorite;
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });

  // Renaming / editing the note is the owner's call; either partner can favourite.
  if (updates.title !== undefined || updates.note !== undefined) {
    const { data: existing } = await supabase.from('personal_recordings')
      .select('user_id').eq('id', req.params.id).eq('couple_id', coupleId).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Recording not found' });
    if (existing.user_id !== userId) return res.status(403).json({ error: 'Only the person who recorded this can edit it' });
  }

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
  await removeRecordingFiles([existing.storage_path], coupleId);
  return res.json({ ok: true, storagePath: existing.storage_path });
});

// DELETE every recording the caller made (Settings → "Delete all my recordings").
// Only ever touches rows owned by `userId`; the partner's recordings are never affected.
router.delete('/:coupleId/mine', async (req, res) => {
  const { userId } = req.body || {};
  const coupleId = req.params.coupleId;
  if (userId !== 'user1' && userId !== 'user2') return res.status(400).json({ error: 'userId required' });

  const { data: rows, error } = await supabase.from('personal_recordings')
    .select('id, storage_path').eq('couple_id', coupleId).eq('user_id', userId);
  if (error) return res.status(500).json({ error: error.message });
  if (!rows || !rows.length) return res.json({ ok: true, deleted: 0 });

  const { error: delErr } = await supabase.from('personal_recordings')
    .delete().eq('couple_id', coupleId).eq('user_id', userId);
  if (delErr) return res.status(500).json({ error: delErr.message });
  await removeRecordingFiles(rows.map((r) => r.storage_path), coupleId);
  return res.json({ ok: true, deleted: rows.length });
});

module.exports = router;
