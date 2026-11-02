// ═══════════════════════════════════════════════════════
//  Highlights Routes — Instagram-style circles on Our Profile.
//  Each highlight = a named, categorised group of photo/video clips
//  that belongs to one partner (role user1/user2). Both partners can
//  see all of the couple's highlights; only the owner can change them.
//
//  Used by BOTH the web app (public/highlights.js) and the Android app.
//  Wire up in server.js:
//    app.use('/api/highlights', require('./routes/highlights'));
//  Tables: migrations/highlights.sql
//
//  Flow: one clip per POST /upload. The first clip creates the highlight
//  (title + category); further clips send highlightId instead.
// ═══════════════════════════════════════════════════════
const express  = require('express');
const multer   = require('multer');
const crypto   = require('crypto');
const supabase = require('../middleware/supabase');
const { removeObjects } = require('../lib/storage');
const router   = express.Router();

const BUCKET = 'couple-photos';
const CATEGORIES = ['travel', 'love', 'dates', 'friends', 'family', 'food', 'events', 'fun', 'other'];
const ROLES = ['user1', 'user2'];

// Only real photos/videos; the stored extension comes from the mime type,
// never from the client-supplied file name.
const MIME_EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/heic': 'heic', 'image/heif': 'heif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'video/3gpp': '3gp', 'video/x-matroska': 'mkv'
};
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 150 * 1024 * 1024 }, // same ceiling as /api/media/upload (phone videos)
  fileFilter: (req, file, cb) => {
    if (!MIME_EXT[String(file.mimetype || '').toLowerCase()]) return cb(new Error('Unsupported file type'));
    cb(null, true);
  }
});
function handleUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That file is too large (150 MB max).' });
    if (err.message === 'Unsupported file type') return res.status(415).json({ error: 'Please choose a photo or a video.' });
    return res.status(400).json({ error: err.message || 'Upload failed' });
  });
}

const cleanTitle = (t) => String(t == null ? '' : t).trim().slice(0, 24);
const cleanCategory = (c) => (CATEGORIES.includes(String(c)) ? String(c) : 'other');

// Best-effort storage cleanup, restricted to this couple's own prefix.
function removeFiles(paths, coupleId) {
  const safe = (paths || []).filter((p) => p && !String(p).includes('..') && String(p).startsWith(`${coupleId}/highlights/`));
  return removeObjects(supabase, BUCKET, safe);
}

// GET every highlight of the couple (both partners) with its clips, oldest clip first.
router.get('/:coupleId', async (req, res) => {
  const { coupleId } = req.params;
  const { data: groups, error } = await supabase
    .from('highlights').select('*').eq('couple_id', coupleId)
    .order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  if (!groups || !groups.length) return res.json([]);

  const { data: items, error: itemErr } = await supabase
    .from('highlight_items').select('*').eq('couple_id', coupleId)
    .order('created_at', { ascending: true });
  if (itemErr) return res.status(500).json({ error: itemErr.message });

  const byGroup = {};
  (items || []).forEach((it) => { (byGroup[it.highlight_id] = byGroup[it.highlight_id] || []).push(it); });
  return res.json(groups.map((g) => ({ ...g, items: byGroup[g.id] || [] })));
});

// POST one clip. multipart: file, coupleId, userId(role), durationSec?,
//   + EITHER highlightId (add to an existing highlight of mine)
//   +    OR  title + category (start a new highlight)
router.post('/upload', handleUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });
  const { coupleId, userId, highlightId, title, category, durationSec } = req.body || {};
  if (!coupleId) return res.status(400).json({ error: 'coupleId required' });
  if (!ROLES.includes(userId)) return res.status(400).json({ error: 'userId must be user1 or user2' });
  if (!req.file.size) return res.status(400).json({ error: 'That file is empty' });

  let group = null;
  if (highlightId) {
    const { data, error } = await supabase.from('highlights').select('*')
      .eq('id', highlightId).eq('couple_id', coupleId).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Highlight not found' });
    if (data.user_id !== userId) return res.status(403).json({ error: 'You can only add to your own highlights' });
    group = data;
  }

  const mime = String(req.file.mimetype).toLowerCase();
  const mediaType = mime.startsWith('video/') ? 'video' : 'image';
  const path = `${coupleId}/highlights/${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${MIME_EXT[mime]}`;

  const { error: upErr } = await supabase.storage.from(BUCKET)
    .upload(path, req.file.buffer, { contentType: mime, upsert: false });
  if (upErr) return res.status(500).json({ error: upErr.message });
  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);

  if (!group) {
    const { data, error } = await supabase.from('highlights').insert({
      couple_id: coupleId, user_id: userId,
      title: cleanTitle(title) || 'Highlights', category: cleanCategory(category)
    }).select().single();
    if (error) { removeFiles([path], coupleId); return res.status(500).json({ error: error.message }); }
    group = data;
  }

  const { data: item, error: itemErr } = await supabase.from('highlight_items').insert({
    highlight_id: group.id, couple_id: coupleId, user_id: userId,
    media_type: mediaType, media_url: urlData.publicUrl, storage_path: path,
    duration_sec: Math.max(0, Math.min(3600, Math.round(Number(durationSec) || 0)))
  }).select().single();
  if (itemErr) { removeFiles([path], coupleId); return res.status(500).json({ error: itemErr.message }); }

  await supabase.from('highlights').update({ updated_at: new Date().toISOString() }).eq('id', group.id);
  return res.json({ highlight: group, item });
});

// PATCH rename / change category — owner only.
router.patch('/:id', async (req, res) => {
  const { coupleId, userId, title, category } = req.body || {};
  if (!coupleId) return res.status(400).json({ error: 'coupleId required' });
  const { data: existing } = await supabase.from('highlights').select('user_id')
    .eq('id', req.params.id).eq('couple_id', coupleId).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Highlight not found' });
  if (existing.user_id !== userId) return res.status(403).json({ error: 'Only the owner can edit this highlight' });

  const updates = { updated_at: new Date().toISOString() };
  if (title !== undefined) updates.title = cleanTitle(title) || 'Highlights';
  if (category !== undefined) updates.category = cleanCategory(category);
  const { data, error } = await supabase.from('highlights').update(updates)
    .eq('id', req.params.id).eq('couple_id', coupleId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// DELETE one clip — owner only. Removing the last clip removes the highlight.
router.delete('/item/:itemId', async (req, res) => {
  const { coupleId, userId } = req.body || {};
  if (!coupleId) return res.status(400).json({ error: 'coupleId required' });
  const { data: item } = await supabase.from('highlight_items').select('*')
    .eq('id', req.params.itemId).eq('couple_id', coupleId).maybeSingle();
  if (!item) return res.status(404).json({ error: 'Clip not found' });
  if (item.user_id !== userId) return res.status(403).json({ error: 'Only the owner can delete this clip' });

  const { error } = await supabase.from('highlight_items').delete().eq('id', item.id);
  if (error) return res.status(500).json({ error: error.message });
  removeFiles([item.storage_path], coupleId);

  const { count } = await supabase.from('highlight_items')
    .select('id', { count: 'exact', head: true }).eq('highlight_id', item.highlight_id);
  let highlightDeleted = false;
  if (!count) {
    await supabase.from('highlights').delete().eq('id', item.highlight_id);
    highlightDeleted = true;
  }
  return res.json({ ok: true, highlightDeleted });
});

// DELETE a whole highlight — owner only. Clip rows go with it (cascade).
router.delete('/:id', async (req, res) => {
  const { coupleId, userId } = req.body || {};
  if (!coupleId) return res.status(400).json({ error: 'coupleId required' });
  const { data: group } = await supabase.from('highlights').select('user_id')
    .eq('id', req.params.id).eq('couple_id', coupleId).maybeSingle();
  if (!group) return res.status(404).json({ error: 'Highlight not found' });
  if (group.user_id !== userId) return res.status(403).json({ error: 'Only the owner can delete this highlight' });

  const { data: items } = await supabase.from('highlight_items').select('storage_path').eq('highlight_id', req.params.id);
  const { error } = await supabase.from('highlights').delete().eq('id', req.params.id).eq('couple_id', coupleId);
  if (error) return res.status(500).json({ error: error.message });
  removeFiles((items || []).map((i) => i.storage_path), coupleId);
  return res.json({ ok: true });
});

module.exports = router;
