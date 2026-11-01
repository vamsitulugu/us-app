// ═══════════════════════════════════════════════════════════════
//  Admin Health + Audit Log routes
//  ─────────────────────────────────────────────────────────────
//  app_error_log is operational only (source/message/severity/context)
//  — never message/journal/chat content. It's populated by calling
//  logAppError() from lib/errorLog.js from other routes as they adopt
//  it; this file only reads it.
// ═══════════════════════════════════════════════════════════════
const express = require('express');
const supabase = require('../middleware/supabase');
const { requireAdmin, logAudit } = require('../middleware/adminAuth');

const router = express.Router();
router.use(requireAdmin);

// ── GET /api/admin/health/errors ────────────────────────────────
router.get('/errors', async (req, res) => {
  try {
    const severity = (req.query.severity || '').trim();
    const platform = (req.query.platform || '').trim(); // '', 'android', 'web', 'server'
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));

    let query = supabase.from('app_error_log').select('*').order('created_at', { ascending: false }).limit(limit);
    if (['info', 'warning', 'critical'].includes(severity)) query = query.eq('severity', severity);

    if (['android', 'web', 'server'].includes(platform)) query = query.eq('platform', platform);

    let { data, error } = await query;
    if (error && /platform/.test(error.message || '')) {
      // admin_telemetry.sql not run yet: fall back to the unfiltered list.
      ({ data, error } = await supabase.from('app_error_log').select('*').order('created_at', { ascending: false }).limit(limit));
    }
    if (error) throw error;

    const counts = { info: 0, warning: 0, critical: 0 };
    (data || []).forEach(r => { if (counts[r.severity] !== undefined) counts[r.severity]++; });

    res.json({ errors: data || [], counts });
  } catch (e) {
    console.error('[admin-health] errors failed:', e.message);
    res.status(500).json({ error: 'Failed to load error log' });
  }
});

// ── DELETE /api/admin/health/errors?olderThanDays=30 ────────────
// Clears old noise. olderThanDays is required so one click can never wipe everything by accident.
router.delete('/errors', async (req, res) => {
  try {
    const days = parseInt(req.query.olderThanDays, 10);
    if (!Number.isFinite(days) || days < 1) return res.status(400).json({ error: 'olderThanDays (1 or more) is required' });
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const { error, count } = await supabase.from('app_error_log').delete({ count: 'exact' }).lt('created_at', cutoff);
    if (error) throw error;
    await logAudit(req.adminEmail, 'health.clear', 'error_log', null, { olderThanDays: days, deleted: count || 0 });
    res.json({ ok: true, deleted: count || 0 });
  } catch (e) {
    console.error('[admin-health] clear failed:', e.message);
    res.status(500).json({ error: 'Failed to clear error log' });
  }
});

// ── GET /api/admin/health/audit ─────────────────────────────────
router.get('/audit', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 25));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, error, count } = await supabase
      .from('admin_audit_log').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(from, to);
    if (error) throw error;

    res.json({ entries: data || [], page, pageSize, total: count || 0, totalPages: Math.max(1, Math.ceil((count || 0) / pageSize)) });
  } catch (e) {
    console.error('[admin-health] audit failed:', e.message);
    res.status(500).json({ error: 'Failed to load audit log' });
  }
});

module.exports = router;
