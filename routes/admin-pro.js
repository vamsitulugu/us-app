// ════════════════════════════════════════════════════════════════
//  routes/admin-pro.js — Admin review of Pro upgrade requests
//  Register in server.js:
//    app.use('/api/admin/pro', require('./routes/admin-pro'));
//  Every route requires a valid admin session (requireAdmin).
// ════════════════════════════════════════════════════════════════
const express = require('express');
const supabase = require('../middleware/supabase');
const { requireAdmin, logAudit } = require('../middleware/adminAuth');
const router = express.Router();
router.use(requireAdmin);

// ── GET /api/admin/pro ────────────────────────────────────────────
// List all Pro upgrade requests (newest first), enriched with couple names.
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('pro_upgrade_requests')
      .select('*')
      .order('requested_at', { ascending: false });
    if (error) throw error;

    const coupleIds = [...new Set((data || []).map(r => r.couple_id).filter(Boolean))];
    let couplesById = {};
    if (coupleIds.length) {
      const { data: couples } = await supabase
        .from('couples')
        .select('id, user1_name, user2_name, paired')
        .in('id', coupleIds);
      couplesById = Object.fromEntries((couples || []).map(c => [c.id, c]));
    }

    res.json({
      requests: (data || []).map(r => ({
        ...r,
        couple: couplesById[r.couple_id] || null
      }))
    });
  } catch (e) {
    console.error('[admin-pro] list failed:', e.message);
    res.status(500).json({ error: 'Failed to load Pro requests' });
  }
});

// ── POST /api/admin/pro/:id/approve ───────────────────────────────
// Body: { plan: 'monthly' | 'lifetime' }
// Activates Pro on the couple and marks the request approved.
router.post('/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { plan } = req.body || {};
    if (!['monthly', 'lifetime'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const { data: reqRow, error: ferr } = await supabase
      .from('pro_upgrade_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (ferr) throw ferr;
    if (!reqRow) return res.status(404).json({ error: 'Pro request not found' });

    const expiresAt = plan === 'monthly'
      ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      : null; // lifetime → no expiry

    const { error: uErr } = await supabase
      .from('couples')
      .update({
        pro_plan: plan,
        pro_expires_at: expiresAt,
        pro_activated_at: new Date().toISOString(),
        pro_activated_by: req.adminEmail
      })
      .eq('id', reqRow.couple_id);
    if (uErr) throw uErr;

    const { error: rErr } = await supabase
      .from('pro_upgrade_requests')
      .update({
        status: 'approved',
        reviewed_at: new Date().toISOString(),
        reviewed_by: req.adminEmail
      })
      .eq('id', id);
    if (rErr) throw rErr;

    await logAudit(req.adminEmail, 'pro.approve', 'couple', reqRow.couple_id, {
      plan, requestId: id, paidBy: reqRow.paid_by_name
    });

    res.json({ ok: true, plan, expiresAt });
  } catch (e) {
    console.error('[admin-pro] approve failed:', e.message);
    res.status(500).json({ error: 'Failed to approve Pro request' });
  }
});

// ── POST /api/admin/pro/:id/reject ────────────────────────────────
// Body: { note?: string }
router.post('/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body || {};

    const { error } = await supabase
      .from('pro_upgrade_requests')
      .update({
        status: 'rejected',
        reviewed_at: new Date().toISOString(),
        reviewed_by: req.adminEmail,
        review_note: note || null
      })
      .eq('id', id);
    if (error) throw error;

    await logAudit(req.adminEmail, 'pro.reject', 'pro_upgrade_request', id, { note });
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin-pro] reject failed:', e.message);
    res.status(500).json({ error: 'Failed to reject Pro request' });
  }
});

module.exports = router;
