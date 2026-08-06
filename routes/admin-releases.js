// ═══════════════════════════════════════════════════════════════
//  Admin Releases routes
//  ─────────────────────────────────────────────────────────────
//  Manages the app_releases table (see migrations/admin_system.sql).
//  This is the ADMIN side only — creating/editing/publishing releases.
//  The public-facing "what should the app show right now" endpoint
//  the client actually polls on startup is a separate file
//  (routes/releases.js, not built yet) that reads from this same
//  table read-only and with no admin auth required, since the app
//  itself needs to call it. Kept deliberately separate so the
//  write-path (this file) and the read-path (public, next) have
//  completely different trust boundaries.
// ═══════════════════════════════════════════════════════════════
const express = require('express');
const supabase = require('../middleware/supabase');
const { requireAdmin, logAudit } = require('../middleware/adminAuth');

const router = express.Router();
router.use(requireAdmin);

const UPDATE_TYPES = ['optional', 'recommended', 'required'];
const STATUSES = ['draft', 'published', 'archived'];
const PLATFORMS = ['all', 'android', 'web'];

function validateReleaseBody(body, { partial } = {}) {
  const errors = [];
  const out = {};

  const need = (key) => !partial || body[key] !== undefined;

  if (need('version')) {
    if (!body.version || typeof body.version !== 'string' || !body.version.trim()) errors.push('version is required');
    else out.version = body.version.trim();
  }
  if (body.build !== undefined) {
    const b = parseInt(body.build, 10);
    if (body.build !== null && Number.isNaN(b)) errors.push('build must be an integer or null');
    else out.build = body.build === null ? null : b;
  }
  if (need('title')) {
    if (!body.title || typeof body.title !== 'string' || !body.title.trim()) errors.push('title is required');
    else out.title = body.title.trim();
  }
  if (body.message !== undefined) out.message = body.message ? String(body.message).trim() : null;
  if (body.notes !== undefined) out.notes = body.notes ? String(body.notes) : null;
  if (body.update_type !== undefined) {
    if (!UPDATE_TYPES.includes(body.update_type)) errors.push('update_type must be one of ' + UPDATE_TYPES.join(', '));
    else out.update_type = body.update_type;
  }
  if (body.update_url !== undefined) out.update_url = body.update_url ? String(body.update_url).trim() : null;
  if (body.min_supported_version !== undefined) out.min_supported_version = body.min_supported_version ? String(body.min_supported_version).trim() : null;
  if (body.platform !== undefined) {
    if (!PLATFORMS.includes(body.platform)) errors.push('platform must be one of ' + PLATFORMS.join(', '));
    else out.platform = body.platform;
  }

  return { errors, out };
}

// ── GET /api/admin/releases ─────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const status = (req.query.status || '').trim();
    let query = supabase.from('app_releases').select('*').order('created_at', { ascending: false });
    if (STATUSES.includes(status)) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ releases: data || [] });
  } catch (e) {
    console.error('[admin-releases] list failed:', e.message);
    res.status(500).json({ error: 'Failed to load releases' });
  }
});

// ── GET /api/admin/releases/current ─────────────────────────────
// The release the admin UI should show as "currently active production
// version" on the overview dashboard — newest published release,
// resolved consistently (never assumes only one row can be published).
router.get('/current', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('app_releases')
      .select('*')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    res.json({ release: data || null });
  } catch (e) {
    console.error('[admin-releases] current lookup failed:', e.message);
    res.status(500).json({ error: 'Failed to load current release' });
  }
});

// ── GET /api/admin/releases/:id ─────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('app_releases').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Release not found' });
    res.json({ release: data });
  } catch (e) {
    console.error('[admin-releases] detail failed:', e.message);
    res.status(500).json({ error: 'Failed to load release' });
  }
});

// ── POST /api/admin/releases ────────────────────────────────────
// Always creates as a draft — publishing is a deliberate separate
// step (POST /:id/publish), never implicit in creation.
router.post('/', async (req, res) => {
  try {
    const { errors, out } = validateReleaseBody(req.body || {}, { partial: false });
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    out.update_type = out.update_type || 'optional';
    out.platform = out.platform || 'all';
    out.status = 'draft';

    const { data, error } = await supabase.from('app_releases').insert(out).select().single();
    if (error) throw error;

    await logAudit(req.adminEmail, 'release.create', 'release', data.id, { version: data.version, update_type: data.update_type });
    res.json({ release: data });
  } catch (e) {
    console.error('[admin-releases] create failed:', e.message);
    res.status(500).json({ error: 'Failed to create release' });
  }
});

// ── PUT /api/admin/releases/:id ─────────────────────────────────
// Editing an already-published release is allowed (e.g. fixing a typo
// in the notes or a broken download URL) — status/lifecycle changes
// go through the dedicated endpoints below instead, never through here.
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: existing } = await supabase.from('app_releases').select('id, status').eq('id', id).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Release not found' });
    if (existing.status === 'archived') {
      return res.status(400).json({ error: 'Archived releases are read-only. Nothing was changed.' });
    }

    const { errors, out } = validateReleaseBody(req.body || {}, { partial: true });
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
    if (Object.keys(out).length === 0) return res.status(400).json({ error: 'No valid fields to update' });

    const { data, error } = await supabase.from('app_releases').update(out).eq('id', id).select().single();
    if (error) throw error;

    await logAudit(req.adminEmail, 'release.update', 'release', id, { fields: Object.keys(out) });
    res.json({ release: data });
  } catch (e) {
    console.error('[admin-releases] update failed:', e.message);
    res.status(500).json({ error: 'Failed to update release' });
  }
});

// ── POST /api/admin/releases/:id/publish ────────────────────────
router.post('/:id/publish', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: existing } = await supabase.from('app_releases').select('id, status, version, update_url, update_type').eq('id', id).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Release not found' });
    if (existing.status === 'archived') return res.status(400).json({ error: 'Cannot publish an archived release' });

    // A required or recommended update with no update_url would strand
    // users on a blocking screen with nothing to tap — refuse rather
    // than publish something broken.
    if (['required', 'recommended'].includes(existing.update_type) && !existing.update_url) {
      return res.status(400).json({ error: `Cannot publish a ${existing.update_type} update with no update_url set` });
    }

    const { data, error } = await supabase
      .from('app_releases')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .eq('id', id).select().single();
    if (error) throw error;

    await logAudit(req.adminEmail, 'release.publish', 'release', id, { version: existing.version });
    res.json({ release: data });
  } catch (e) {
    console.error('[admin-releases] publish failed:', e.message);
    res.status(500).json({ error: 'Failed to publish release' });
  }
});

// ── POST /api/admin/releases/:id/unpublish ──────────────────────
// Reverts to draft. Safe because the public read-path (routes/releases.js,
// next file) always resolves the release by querying status='published'
// live — nothing caches "this release is active" anywhere the app
// would keep using it after this call.
router.post('/:id/unpublish', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: existing } = await supabase.from('app_releases').select('id, status, version').eq('id', id).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Release not found' });
    if (existing.status !== 'published') return res.status(400).json({ error: 'Only published releases can be unpublished' });

    const { data, error } = await supabase.from('app_releases').update({ status: 'draft' }).eq('id', id).select().single();
    if (error) throw error;

    await logAudit(req.adminEmail, 'release.unpublish', 'release', id, { version: existing.version });
    res.json({ release: data });
  } catch (e) {
    console.error('[admin-releases] unpublish failed:', e.message);
    res.status(500).json({ error: 'Failed to unpublish release' });
  }
});

// ── POST /api/admin/releases/:id/archive ────────────────────────
router.post('/:id/archive', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: existing } = await supabase.from('app_releases').select('id, status, version').eq('id', id).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Release not found' });

    const { data, error } = await supabase.from('app_releases').update({ status: 'archived' }).eq('id', id).select().single();
    if (error) throw error;

    await logAudit(req.adminEmail, 'release.archive', 'release', id, { version: existing.version, previousStatus: existing.status });
    res.json({ release: data });
  } catch (e) {
    console.error('[admin-releases] archive failed:', e.message);
    res.status(500).json({ error: 'Failed to archive release' });
  }
});

// ── DELETE /api/admin/releases/:id ──────────────────────────────
// Only drafts can be hard-deleted — published/archived releases are
// kept forever as history (the Admin section spec explicitly wants
// "release timeline/history", which a deletable published release
// would undermine).
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: existing } = await supabase.from('app_releases').select('id, status, version').eq('id', id).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Release not found' });
    if (existing.status !== 'draft') {
      return res.status(400).json({ error: 'Only draft releases can be deleted — archive published releases instead to preserve history' });
    }

    const { error } = await supabase.from('app_releases').delete().eq('id', id);
    if (error) throw error;

    await logAudit(req.adminEmail, 'release.delete', 'release', id, { version: existing.version });
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin-releases] delete failed:', e.message);
    res.status(500).json({ error: 'Failed to delete release' });
  }
});

module.exports = router;
