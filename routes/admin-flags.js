// ═══════════════════════════════════════════════════════════════
//  Admin Feature Flags routes
//  ─────────────────────────────────────────────────────────────
//  Flags control FUNCTIONALITY, releases (routes/admin-releases.js)
//  control app VERSIONS — kept as separate concepts per spec. Flags
//  are also explicitly NOT a security/authorization mechanism: any
//  route gating a sensitive action must still check real permissions
//  server-side regardless of what a flag says.
// ═══════════════════════════════════════════════════════════════
const express = require('express');
const supabase = require('../middleware/supabase');
const { requireAdmin, logAudit } = require('../middleware/adminAuth');

const router = express.Router();
router.use(requireAdmin);

const ROLLOUT_TYPES = ['everyone', 'test_users', 'percentage'];

function validateBody(body, { partial } = {}) {
  const errors = [];
  const out = {};
  const need = (k) => !partial || body[k] !== undefined;

  if (need('key')) {
    if (!body.key || !/^[a-z][a-z0-9_]*$/.test(body.key)) {
      errors.push('key is required and must be lowercase_snake_case (e.g. ai_both_mode)');
    } else out.key = body.key;
  }
  if (need('name')) {
    if (!body.name || !String(body.name).trim()) errors.push('name is required');
    else out.name = String(body.name).trim();
  }
  if (body.description !== undefined) out.description = body.description ? String(body.description).trim() : null;
  if (body.enabled !== undefined) out.enabled = !!body.enabled;
  if (body.rollout_type !== undefined) {
    if (!ROLLOUT_TYPES.includes(body.rollout_type)) errors.push('rollout_type must be one of ' + ROLLOUT_TYPES.join(', '));
    else out.rollout_type = body.rollout_type;
  }
  if (body.rollout_value !== undefined) {
    // Shape depends on rollout_type: percentage -> {percentage:0-100},
    // test_users -> {userIds:[...]}. Not strictly enforced here since
    // rollout_type may be set in the same or a different request, but
    // basic shape sanity is checked to avoid storing garbage.
    if (body.rollout_value !== null && typeof body.rollout_value !== 'object') {
      errors.push('rollout_value must be an object');
    } else out.rollout_value = body.rollout_value || {};
  }
  return { errors, out };
}

// ── GET /api/admin/flags ────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('feature_flags').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ flags: data || [] });
  } catch (e) {
    console.error('[admin-flags] list failed:', e.message);
    res.status(500).json({ error: 'Failed to load feature flags' });
  }
});

// ── POST /api/admin/flags ───────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { errors, out } = validateBody(req.body || {}, { partial: false });
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    const { data: dupe } = await supabase.from('feature_flags').select('id').eq('key', out.key).maybeSingle();
    if (dupe) return res.status(409).json({ error: `A flag with key "${out.key}" already exists` });

    out.enabled = out.enabled ?? false;
    out.rollout_type = out.rollout_type || 'everyone';
    out.rollout_value = out.rollout_value || {};

    const { data, error } = await supabase.from('feature_flags').insert(out).select().single();
    if (error) throw error;

    await logAudit(req.adminEmail, 'flag.create', 'flag', data.id, { key: data.key });
    res.json({ flag: data });
  } catch (e) {
    console.error('[admin-flags] create failed:', e.message);
    res.status(500).json({ error: 'Failed to create feature flag' });
  }
});

// ── PUT /api/admin/flags/:id ─────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: existing } = await supabase.from('feature_flags').select('id').eq('id', id).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Flag not found' });

    const { errors, out } = validateBody(req.body || {}, { partial: true });
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
    if (Object.keys(out).length === 0) return res.status(400).json({ error: 'No valid fields to update' });
    out.updated_at = new Date().toISOString();

    const { data, error } = await supabase.from('feature_flags').update(out).eq('id', id).select().single();
    if (error) throw error;

    await logAudit(req.adminEmail, 'flag.update', 'flag', id, { fields: Object.keys(out) });
    res.json({ flag: data });
  } catch (e) {
    console.error('[admin-flags] update failed:', e.message);
    res.status(500).json({ error: 'Failed to update feature flag' });
  }
});

// ── POST /api/admin/flags/:id/toggle ────────────────────────────
// Convenience one-click on/off, separate from the general PUT so the
// dashboard's toggle switch is a single unambiguous call.
router.post('/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: existing } = await supabase.from('feature_flags').select('id, key, enabled').eq('id', id).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Flag not found' });

    const { data, error } = await supabase
      .from('feature_flags')
      .update({ enabled: !existing.enabled, updated_at: new Date().toISOString() })
      .eq('id', id).select().single();
    if (error) throw error;

    await logAudit(req.adminEmail, 'flag.toggle', 'flag', id, { key: existing.key, enabled: data.enabled });
    res.json({ flag: data });
  } catch (e) {
    console.error('[admin-flags] toggle failed:', e.message);
    res.status(500).json({ error: 'Failed to toggle feature flag' });
  }
});

// ── DELETE /api/admin/flags/:id ─────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: existing } = await supabase.from('feature_flags').select('id, key').eq('id', id).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Flag not found' });

    const { error } = await supabase.from('feature_flags').delete().eq('id', id);
    if (error) throw error;

    await logAudit(req.adminEmail, 'flag.delete', 'flag', id, { key: existing.key });
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin-flags] delete failed:', e.message);
    res.status(500).json({ error: 'Failed to delete feature flag' });
  }
});

module.exports = router;
