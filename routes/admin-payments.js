// ═══════════════════════════════════════════════════════════════
//  Admin Payments routes — Razorpay revenue + "paid but no Pro" recovery
//    GET  /api/admin/payments            summary + recent payments
//    POST /api/admin/payments/:orderId/recheck   ask Razorpay, grant Pro if it was paid
//  Reads the pro_payments table only (no card data is ever stored).
// ═══════════════════════════════════════════════════════════════
const express = require('express');
const supabase = require('../middleware/supabase');
const { requireAdmin, logAudit } = require('../middleware/adminAuth');
const rzp = require('../lib/razorpay');

const router = express.Router();
router.use(requireAdmin);

router.get('/', async (req, res) => {
  try {
    const status = (req.query.status || '').trim();
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));

    const { data: all, error } = await supabase
      .from('pro_payments').select('plan, amount_paise, status, created_at, paid_at');
    if (error) throw error;

    const now = Date.now();
    const monthAgo = now - 30 * 86400000;
    const sum = { revenueTotal: 0, revenue30d: 0, paidCount: 0, failedCount: 0, pendingCount: 0, byPlan: {} };
    for (const p of all || []) {
      if (p.status === 'paid') {
        const rupees = p.amount_paise / 100;
        sum.paidCount++; sum.revenueTotal += rupees;
        if (p.paid_at && new Date(p.paid_at).getTime() >= monthAgo) sum.revenue30d += rupees;
        sum.byPlan[p.plan] = (sum.byPlan[p.plan] || 0) + 1;
      } else if (p.status === 'failed') sum.failedCount++;
      else if (new Date(p.created_at).getTime() < now - 15 * 60000) sum.pendingCount++; // abandoned checkouts
    }

    let q = supabase.from('pro_payments')
      .select('id, couple_id, user_id, plan, amount_paise, status, razorpay_order_id, razorpay_payment_id, source, created_at, paid_at')
      .order('created_at', { ascending: false }).limit(limit);
    if (['created', 'paid', 'failed'].includes(status)) q = q.eq('status', status);
    const { data: rows, error: e2 } = await q;
    if (e2) throw e2;

    // Platform split: use the paying user's last known platform.
    const uids = [...new Set((rows || []).map(r => r.user_id).filter(Boolean))];
    let plat = {};
    if (uids.length) {
      const { data: us } = await supabase.from('users').select('id, last_platform').in('id', uids);
      plat = Object.fromEntries((us || []).map(u => [u.id, u.last_platform || null]));
    }
    const payments = (rows || []).map(r => ({
      id: r.id, coupleId: r.couple_id, plan: r.plan, amount: r.amount_paise / 100, status: r.status,
      orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, source: r.source,
      createdAt: r.created_at, paidAt: r.paid_at, platform: plat[r.user_id] || null
    }));
    const platformSplit = { android: 0, web: 0, unknown: 0 };
    payments.filter(p => p.status === 'paid').forEach(p => { platformSplit[p.platform || 'unknown']++; });

    const { data: pro } = await supabase.from('couples').select('pro_plan, pro_expires_at')
      .not('pro_plan', 'is', null);
    const activePro = (pro || []).filter(c => c.pro_plan === 'lifetime' || (c.pro_expires_at && new Date(c.pro_expires_at) > new Date())).length;

    res.json({ summary: { ...sum, activeProCouples: activePro, platformSplit }, payments, razorpayConfigured: rzp.isConfigured() });
  } catch (e) {
    console.error('[admin-payments] list failed:', e.message);
    res.status(500).json({ error: 'Failed to load payments' });
  }
});

router.post('/:orderId/recheck', async (req, res) => {
  try {
    if (!rzp.isConfigured()) return res.status(503).json({ error: 'Razorpay is not configured on the server.' });
    const orderId = String(req.params.orderId);
    const { data: row } = await supabase.from('pro_payments').select('id, status').eq('razorpay_order_id', orderId).maybeSingle();
    if (!row) return res.status(404).json({ error: 'Order not found' });

    const r = await rzp.fetchOrderPayments(orderId);
    const captured = (r.items || []).find(p => p.status === 'captured');
    if (!captured) return res.json({ ok: true, granted: false, message: 'Razorpay shows no captured payment for this order.' });

    const { grantForOrder } = require('./pro'); // lazy: avoids a circular import at load time
    const out = await grantForOrder(orderId, captured.id, 'admin-recheck');
    await logAudit(req.adminEmail, 'payment.recheck', 'payment', row.id, { orderId, granted: !!out.granted });
    res.json({ ok: true, granted: !!out.granted,
      message: out.granted ? 'Payment confirmed — Pro activated.' : 'Already paid and activated earlier.' });
  } catch (e) {
    console.error('[admin-payments] recheck failed:', e.message);
    res.status(500).json({ error: 'Re-check failed: ' + e.message });
  }
});

module.exports = router;
