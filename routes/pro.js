// ════════════════════════════════════════════════════════════════
//  routes/pro.js — Pro subscription (₹99/month · ₹499 lifetime)
//  Register in server.js:
//    app.use('/api/pro', require('./routes/pro'));
//
//  Pro is per-couple: when either partner pays, BOTH partners get Pro.
//  Payment is "show QR → pay → submit proof" so the admin can verify
//  and approve manually (no payment gateway keys required).
// ════════════════════════════════════════════════════════════════
const express = require('express');
const multer  = require('multer');
const { v4: uuid } = require('uuid');
const supabase = require('../middleware/supabase');
const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }, // 12MB max for payment proof screenshot
});

// ── GET /api/pro/status?coupleId= ─────────────────────────────────
// Returns whether this couple has active Pro and which plan.
router.get('/status', async (req, res) => {
  try {
    const { coupleId } = req.query;
    if (!coupleId) return res.status(400).json({ error: 'coupleId required' });

    const { data: couple, error } = await supabase
      .from('couples')
      .select('id, pro_plan, pro_expires_at')
      .eq('id', coupleId)
      .maybeSingle();
    if (error) throw error;
    if (!couple) return res.status(404).json({ error: 'Couple not found' });

    let isPro = false, plan = null, expiresAt = null;
    if (couple.pro_plan === 'lifetime') {
      isPro = true; plan = 'lifetime';
    } else if (couple.pro_plan === 'monthly' && couple.pro_expires_at &&
               new Date(couple.pro_expires_at) > new Date()) {
      isPro = true; plan = 'monthly'; expiresAt = couple.pro_expires_at;
    }

    res.json({ isPro, plan, expiresAt });
  } catch (e) {
    console.error('[pro] status failed:', e.message);
    res.status(500).json({ error: 'Failed to load Pro status' });
  }
});

// ── POST /api/pro/upgrade-request ─────────────────────────────────
// Body (multipart): coupleId, plan, paidByName, paidByPhone,
// partnerName, partnerPhone, transactionId, notes, paymentProof (file)
router.post('/upgrade-request', upload.single('paymentProof'), async (req, res) => {
  try {
    const {
      coupleId, plan, paidByName, paidByPhone,
      partnerName, partnerPhone, transactionId, notes
    } = req.body || {};

    if (!coupleId || !plan) {
      return res.status(400).json({ error: 'coupleId and plan are required' });
    }
    if (!['monthly', 'lifetime'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    let paymentProofUrl = null;
    if (req.file) {
      const safeName = String(req.file.originalname || 'payment').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
      const fileName = `pro-payments/${coupleId}/${uuid()}_${safeName}`;
      const { error: upErr } = await supabase.storage
        .from('pro-payments')
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype || 'application/octet-stream',
          cacheControl: '3600',
          upsert: false
        });
      if (upErr) throw upErr;
      const { data: pub } = await supabase.storage
        .from('pro-payments')
        .getPublicUrl(fileName);
      paymentProofUrl = pub.publicUrl;
    }

    const { data, error } = await supabase
      .from('pro_upgrade_requests')
      .insert({
        couple_id: coupleId,
        plan,
        status: 'pending',
        paid_by_name: paidByName || null,
        paid_by_phone: paidByPhone || null,
        partner_name: partnerName || null,
        partner_phone: partnerPhone || null,
        transaction_id: transactionId || null,
        payment_proof_url: paymentProofUrl || null,
        notes: notes || null,
        requested_at: new Date().toISOString()
      })
      .select()
      .maybeSingle();
    if (error) throw error;

    res.json({ ok: true, requestId: data.id, status: data.status });
  } catch (e) {
    console.error('[pro] upgrade-request failed:', e.message);
    res.status(500).json({ error: e.message || 'Failed to create upgrade request' });
  }
});

module.exports = router;
