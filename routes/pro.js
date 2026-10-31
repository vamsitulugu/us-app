// ════════════════════════════════════════════════════════════════
//  routes/pro.js — Pro subscription paid through Razorpay
//    GET  /api/pro/plans               plan list (for the UI)
//    GET  /api/pro/status?coupleId=    { isPro, plan, expiresAt }
//    POST /api/pro/create-order        start a payment (server sets the price)
//    POST /api/pro/verify              check the payment signature, grant Pro
//    GET  /api/pro/history?coupleId=   this couple's paid receipts
//    POST /api/pro/webhook             Razorpay → us (backup if the app closed)
//
//  Pro belongs to the COUPLE: when either partner pays, both get it.
//  Money rules: the browser/app never sends a price, and Pro is granted only
//  after an HMAC signature from Razorpay is verified on this server.
// ════════════════════════════════════════════════════════════════
const express = require('express');
const supabase = require('../middleware/supabase');
const { getProStatus, loadMember } = require('../middleware/pro');
const { PLANS, isValidPlan, applyPurchase } = require('../lib/pro-plans');
const rzp = require('../lib/razorpay');

const router = express.Router();

// ── GET /plans ────────────────────────────────────────────────────
router.get('/plans', (req, res) => {
  res.json({
    currency: 'INR',
    plans: Object.values(PLANS).map(p => ({
      id: p.id, label: p.label, amount: p.amountPaise / 100, days: p.days
    }))
  });
});

// ── GET /status?coupleId= ─────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const { coupleId } = req.query;
    if (!coupleId) return res.status(400).json({ error: 'coupleId required' });
    const { data: couple, error } = await supabase
      .from('couples').select('id').eq('id', coupleId).maybeSingle();
    if (error) throw error;
    if (!couple) return res.status(404).json({ error: 'Couple not found' });
    res.json(await getProStatus(coupleId));
  } catch (e) {
    console.error('[pro] status failed:', e.message);
    res.status(500).json({ error: 'Failed to load Pro status' });
  }
});

// ── POST /create-order  { coupleId, userId, plan } ────────────────
router.post('/create-order', async (req, res) => {
  try {
    const { coupleId, plan } = req.body || {};
    if (!coupleId || !isValidPlan(plan)) return res.status(400).json({ error: 'coupleId and a valid plan are required' });
    if (!rzp.isConfigured()) return res.status(503).json({ error: 'Payments are not set up yet.' });

    const user = await loadMember(req, coupleId);
    if (!user) return res.status(403).json({ error: 'Please sign in again.' });

    const current = await getProStatus(coupleId);
    if (current.plan === 'lifetime') {
      return res.status(409).json({ error: 'You already have Lifetime Pro.' });
    }

    const p = PLANS[plan];
    const order = await rzp.createOrder({
      amountPaise: p.amountPaise,
      receipt: `th_${Date.now().toString(36)}_${String(coupleId).slice(0, 8)}`,
      notes: { couple_id: String(coupleId), user_id: String(user.id), plan }
    });

    const { error } = await supabase.from('pro_payments').insert({
      couple_id: String(coupleId), user_id: String(user.id), plan,
      amount_paise: p.amountPaise, currency: 'INR', status: 'created',
      razorpay_order_id: order.id
    });
    if (error) throw error;

    res.json({
      keyId: rzp.keyId(),
      orderId: order.id,
      amount: p.amountPaise,
      currency: 'INR',
      plan,
      planLabel: p.label,
      prefill: { name: user.name || '', contact: user.phone_number || '' }
    });
  } catch (e) {
    console.error('[pro] create-order failed:', e.message);
    res.status(500).json({ error: 'Could not start the payment. Please try again.' });
  }
});

// Marks the order paid and extends the couple's Pro. Safe to call twice
// (app verify + webhook can both arrive): only the call that flips the order
// from 'created' to 'paid' grants Pro, so it is never granted twice.
async function grantForOrder(orderId, paymentId, source) {
  const { data: won, error: upErr } = await supabase
    .from('pro_payments')
    .update({ status: 'paid', razorpay_payment_id: paymentId, source, paid_at: new Date().toISOString() })
    .eq('razorpay_order_id', orderId).neq('status', 'paid')
    .select().maybeSingle();
  if (upErr) throw upErr;

  const { data: row, error: rowErr } = await supabase
    .from('pro_payments').select('*').eq('razorpay_order_id', orderId).maybeSingle();
  if (rowErr) throw rowErr;
  if (!row) return { found: false };
  if (!won) return { found: true, granted: false, row };   // already paid earlier

  try {
    const { data: couple, error: cErr } = await supabase
      .from('couples').select('id, pro_plan, pro_expires_at').eq('id', row.couple_id).maybeSingle();
    if (cErr) throw cErr;
    if (!couple) throw new Error('Couple not found');
    const next = applyPurchase(couple, row.plan);
    const { error: uErr } = await supabase.from('couples').update({
      ...next, pro_activated_at: new Date().toISOString(), pro_activated_by: 'razorpay'
    }).eq('id', row.couple_id);
    if (uErr) throw uErr;
  } catch (e) {
    // Undo the "paid" mark so a retry (or the webhook) can grant it.
    await supabase.from('pro_payments').update({ status: 'created', paid_at: null })
      .eq('razorpay_order_id', orderId);
    throw e;
  }
  return { found: true, granted: true, row };
}

// ── POST /verify  { coupleId, userId, razorpay_order_id, razorpay_payment_id, razorpay_signature }
router.post('/verify', async (req, res) => {
  try {
    const { coupleId, razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sig } = req.body || {};
    if (!coupleId || !orderId || !paymentId || !sig) return res.status(400).json({ error: 'Missing payment details' });
    if (!rzp.verifyPaymentSignature(orderId, paymentId, sig)) {
      return res.status(400).json({ error: 'Payment could not be verified.' });
    }
    const user = await loadMember(req, coupleId);
    if (!user) return res.status(403).json({ error: 'Please sign in again.' });

    const { data: order } = await supabase
      .from('pro_payments').select('couple_id').eq('razorpay_order_id', orderId).maybeSingle();
    if (!order || String(order.couple_id) !== String(coupleId)) {
      return res.status(404).json({ error: 'Order not found for this couple.' });
    }

    await grantForOrder(orderId, paymentId, 'verify');
    res.json({ ok: true, ...(await getProStatus(coupleId)) });
  } catch (e) {
    console.error('[pro] verify failed:', e.message);
    res.status(500).json({ error: 'Payment received, but activating Pro failed. It will activate shortly — or tap Restore.' });
  }
});

// ── GET /history?coupleId=  (member only) ─────────────────────────
router.get('/history', async (req, res) => {
  try {
    const { coupleId } = req.query;
    const user = await loadMember(req, coupleId);
    if (!user) return res.status(403).json({ error: 'Please sign in again.' });
    const { data, error } = await supabase
      .from('pro_payments')
      .select('plan, amount_paise, razorpay_payment_id, paid_at')
      .eq('couple_id', String(coupleId)).eq('status', 'paid')
      .order('paid_at', { ascending: false }).limit(20);
    if (error) throw error;
    res.json({ payments: (data || []).map(p => ({
      plan: p.plan, amount: p.amount_paise / 100, paymentId: p.razorpay_payment_id, paidAt: p.paid_at
    })) });
  } catch (e) {
    console.error('[pro] history failed:', e.message);
    res.status(500).json({ error: 'Failed to load payment history' });
  }
});

// ── POST /webhook (mounted in server.js with a RAW body parser) ───
// Razorpay dashboard → Webhooks → URL: https://<your-server>/api/pro/webhook
// Events: payment.captured, order.paid.  Secret = RAZORPAY_WEBHOOK_SECRET.
async function webhook(req, res) {
  try {
    const raw = req.body; // Buffer (express.raw)
    if (!Buffer.isBuffer(raw) || !rzp.verifyWebhookSignature(raw, req.get('x-razorpay-signature'))) {
      return res.status(400).json({ error: 'Bad signature' });
    }
    const event = JSON.parse(raw.toString('utf8'));
    if (event.event === 'payment.captured' || event.event === 'order.paid') {
      const pay = event.payload && event.payload.payment && event.payload.payment.entity;
      const orderId = pay && pay.order_id;
      if (orderId && pay.id) await grantForOrder(orderId, pay.id, 'webhook');
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[pro] webhook failed:', e.message);
    res.status(500).json({ error: 'retry' }); // Razorpay retries on non-2xx
  }
}

module.exports = router;
module.exports.webhook = webhook;
module.exports.grantForOrder = grantForOrder;
