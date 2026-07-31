// ═══════════════════════════════════════════════════════
//  Profile Routes — single source of truth for user profiles
//  Backs public/js/avatar-system.js's ProfileStore.
//
//  Table: public.profiles (id, display_name, avatar_url, bio,
//  status, updated_at) — see migrations/001_create_profiles.sql.
//
//  Every write here:
//    1. Checks ownership (requestingUserId === :userId)
//    2. Persists to Postgres (the ONLY place profile data lives)
//    3. Broadcasts profile_updated on `profile:{userId}` so the
//       partner's ProfileStore updates instantly, no refresh.
// ═══════════════════════════════════════════════════════
const express  = require('express');
const multer   = require('multer');
const supabase = require('../middleware/supabase');
const { broadcastEvent } = require('./auth');

const router = express.Router();

const ALLOWED_AVATAR_MIME = /^image\/(jpeg|png|gif|webp|heic|heif)$/i;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max for an avatar
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_AVATAR_MIME.test(file.mimetype)) return cb(new Error('Unsupported file type'));
    cb(null, true);
  }
});

// ── GET /api/profile/:userId ────────────────────────────
// Fetch a user's own profile row. Auto-creates it on the fly if the
// user predates the 001_create_profiles.sql backfill.
router.get('/:userId', async (req, res) => {
  const { userId } = req.params;

  let { data: profile, error } = await supabase
    .from('profiles').select('*').eq('id', userId).maybeSingle();

  if (error) return res.status(500).json({ error: error.message });

  if (!profile) {
    const { data: user } = await supabase.from('users').select('name').eq('id', userId).maybeSingle();
    const { data: created, error: createErr } = await supabase
      .from('profiles')
      .insert({ id: userId, display_name: (user && user.name) || '' })
      .select('*').single();
    if (createErr) return res.status(500).json({ error: createErr.message });
    profile = created;
  }

  res.json(profile);
});

// ── GET /api/profile/:userId/partner ────────────────────
// Resolve :userId's partner via couples/users, then return the
// partner's profile row.
router.get('/:userId/partner', async (req, res) => {
  const { userId } = req.params;

  const { data: me, error: meErr } = await supabase
    .from('users').select('couple_id, role').eq('id', userId).maybeSingle();
  if (meErr) return res.status(500).json({ error: meErr.message });
  if (!me || !me.couple_id) return res.json({ profile: null });

  const otherRole = me.role === 'user1' ? 'user2' : 'user1';
  const { data: partnerUser, error: partnerErr } = await supabase
    .from('users').select('id').eq('couple_id', me.couple_id).eq('role', otherRole).maybeSingle();
  if (partnerErr) return res.status(500).json({ error: partnerErr.message });
  if (!partnerUser) return res.json({ profile: null });

  let { data: profile, error } = await supabase
    .from('profiles').select('*').eq('id', partnerUser.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });

  if (!profile) {
    const { data: created } = await supabase
      .from('profiles').insert({ id: partnerUser.id }).select('*').single();
    profile = created || null;
  }

  res.json({ profile });
});

// ── PATCH /api/profile/:userId ──────────────────────────
// Update display_name / bio / status. Ownership is enforced here —
// this is the server-side guarantee that a partner's profile can
// never be written by anyone but its owner (RLS is the backstop for
// any future direct-from-client Supabase call; this check is what
// actually protects the service-key-backed route in normal use).
router.patch('/:userId', async (req, res) => {
  const { userId } = req.params;
  const { requestingUserId, display_name, bio, status } = req.body;

  if (requestingUserId !== userId) {
    return res.status(403).json({ error: 'You can only edit your own profile' });
  }

  const patch = {};
  if (display_name !== undefined) patch.display_name = display_name;
  if (bio !== undefined) patch.bio = bio;
  if (status !== undefined) patch.status = status;

  const { data: saved, error } = await supabase
    .from('profiles').update(patch).eq('id', userId).select('*').single();
  if (error) return res.status(500).json({ error: error.message });

  broadcastEvent(`profile:${userId}`, 'profile_updated', { profile: saved });
  res.json(saved);
});

// ── POST /api/profile/:userId/avatar ────────────────────
// Real file upload to Storage (never base64-into-JSON). Path
// convention: avatars/{userId}.{ext}, upsert so re-uploading
// replaces the old file at the same stable URL — updated_at (bumped
// by the trigger) is what cache-busts it on the client.
router.post('/:userId/avatar', upload.single('avatar'), async (req, res) => {
  const { userId } = req.params;
  const { requestingUserId } = req.body;

  if (requestingUserId !== userId) {
    return res.status(403).json({ error: 'You can only edit your own avatar' });
  }
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const extFromName = (req.file.originalname || '').split('.').pop();
  const ext = /^[a-z0-9]{2,5}$/i.test(extFromName) ? extFromName : 'jpg';
  const path = `${userId}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from('avatars')
    .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
  if (uploadErr) return res.status(500).json({ error: uploadErr.message });

  const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
  // Cache-bust with a version query param so every client picks up the
  // new image immediately instead of serving a browser-cached copy of
  // the old file at the same URL.
  const avatarUrl = `${urlData.publicUrl}?v=${Date.now()}`;

  const { data: saved, error } = await supabase
    .from('profiles').update({ avatar_url: avatarUrl }).eq('id', userId).select('*').single();
  if (error) return res.status(500).json({ error: error.message });

  broadcastEvent(`profile:${userId}`, 'profile_updated', { profile: saved });
  res.json(saved);
});

module.exports = router;
