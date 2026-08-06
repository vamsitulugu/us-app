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
const { requireAdmin } = require('../middleware/adminAuth');

const router = express.Router();
router.use(requireAdmin);

// ── GET /api/admin/health/errors ────────────────────────────────
router.get('/errors', async (req, res) => {
  try {
    const severity = (req.query.severity || '').trim();
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));

    let query = supabase.from('app_error_log').select('*').order('created_at', { ascending: false }).limit(limit);
    if (['info', 'warning', 'critical'].includes(severity)) query = query.eq('severity', severity);

    const { data, error } = await query;
    if (error) throw error;

    const counts = { info: 0, warning: 0, critical: 0 };
    (data || []).forEach(r => { if (counts[r.severity] !== undefined) counts[r.severity]++; });

    res.json({ errors: data || [], counts });
  } catch (e) {
    console.error('[admin-health] errors failed:', e.message);
    res.status(500).json({ error: 'Failed to load error log' });
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
