// ═══════════════════════════════════════════════════════
//  Auth Routes — Real couple setup & pairing
// ═══════════════════════════════════════════════════════
const express  = require('express');
const bcrypt   = require('bcryptjs');
const { v4: uuid } = require('uuid');
const supabase = require('../middleware/supabase');

const router = express.Router();

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ── POST /api/auth/setup ───────────────────────────────
router.post('/setup', async (req, res) => {
  const { myName, partnerName, anniversary, vaultPin } = req.body;
  if (!myName) return res.status(400).json({ error: 'Name required' });

  // Generate unique connect code
  let connectCode;
  for (let i = 0; i < 10; i++) {
    connectCode = genCode();
    const { data } = await supabase
      .from('couples')
      .select('id')
      .eq('connect_code', connectCode)
      .maybeSingle();
    if (!data) break;
  }

  const hashedPin = await bcrypt.hash(String(vaultPin || '1234'), 10);
  const coupleId  = uuid();

  const { error } = await supabase.from('couples').insert({
    id:           coupleId,
    connect_code: connectCode,
    user1_name:   myName,
    user2_name:   partnerName || 'Partner',
    anniversary:  anniversary || null,
    vault_pin:    hashedPin,
    paired:       false, // becomes true only when a partner actually joins via /pair
    created_at:   new Date().toISOString()
  });

  if (error) {
    console.error('Setup error:', error);
    return res.status(500).json({ error: 'Failed to create couple space: ' + error.message });
  }

  return res.json({
    coupleId, connectCode, myName,
    partnerName: partnerName || 'Partner',
    paired: false
  });
});

// ── POST /api/auth/verify-pin ──────────────────────────
router.post('/verify-pin', async (req, res) => {
  const { coupleId, pin } = req.body;
  if (!coupleId || !pin) return res.status(400).json({ error: 'Missing data' });

  const { data: couple } = await supabase
    .from('couples').select('vault_pin').eq('id', coupleId).maybeSingle();

  if (!couple) return res.status(404).json({ error: 'Not found' });

  const match = await bcrypt.compare(String(pin), couple.vault_pin);
  if (!match) return res.status(401).json({ error: 'Wrong PIN' });

  return res.json({ ok: true });
});

// ── POST /api/auth/change-pin ──────────────────────────
router.post('/change-pin', async (req, res) => {
  const { coupleId, currentPin, newPin } = req.body;
  if (!coupleId || !currentPin || !newPin) return res.status(400).json({ error: 'Missing data' });

  const { data: couple } = await supabase
    .from('couples').select('vault_pin').eq('id', coupleId).maybeSingle();
  if (!couple) return res.status(404).json({ error: 'Not found' });

  const match = await bcrypt.compare(String(currentPin), couple.vault_pin);
  if (!match) return res.status(401).json({ error: 'Current PIN is wrong' });

  const hashed = await bcrypt.hash(String(newPin), 10);
  await supabase.from('couples').update({ vault_pin: hashed }).eq('id', coupleId);

  return res.json({ ok: true });
});

// ── GET /api/auth/couple/:id ───────────────────────────
// Used both for profile display and for polling real pairing status
router.get('/couple/:id', async (req, res) => {
  const { data: couple, error } = await supabase
    .from('couples')
    .select('id, connect_code, user1_name, user2_name, anniversary, paired, created_at')
    .eq('id', req.params.id)
    .maybeSingle();

  if (error || !couple) return res.status(404).json({ error: 'Not found' });
  return res.json(couple);
});
// ── POST /api/auth/pair ────────────────────────────────
// Called by the partner (user2) to join an existing couple space
router.post('/pair', async (req, res) => {
  const { connectCode, myName } = req.body;
  if (!connectCode || !myName) {
    return res.status(400).json({ error: 'Connect code and name required' });
  }

  // Find the couple by connect code
  const { data: couple, error } = await supabase
    .from('couples')
    .select('id, connect_code, user1_name, user2_name, anniversary, paired')
    .eq('connect_code', connectCode.toUpperCase())
    .maybeSingle();

  if (error || !couple) {
    return res.status(404).json({ error: 'Invalid connect code. Ask your partner to check their code.' });
  }

  if (couple.paired) {
    return res.status(409).json({ error: 'This couple space is already paired with another device.' });
  }

  // Mark as paired and set user2's name
  const { error: updateError } = await supabase
    .from('couples')
    .update({
      user2_name: myName,
      paired: true,
      updated_at: new Date().toISOString()
    })
    .eq('id', couple.id);

  if (updateError) {
    return res.status(500).json({ error: 'Failed to pair: ' + updateError.message });
  }

  return res.json({
    coupleId: couple.id,
    connectCode: couple.connect_code,
    myName: myName,
    partnerName: couple.user1_name,
    anniversary: couple.anniversary || '',
    paired: true
  });
});
// ── POST /api/auth/unpair ──────────────────────────────
// Removes the partner relationship ONLY. Never touches
// app_state, messages, photos, journal, transactions, etc —
// all of it stays attached to coupleId untouched.
router.post('/unpair', async (req, res) => {
  const { coupleId, requestingRole } = req.body;
  if (!coupleId) return res.status(400).json({ error: 'coupleId required' });

  const { data: couple, error: fetchErr } = await supabase
    .from('couples')
    .select('id, paired, connect_code')
    .eq('id', coupleId)
    .maybeSingle();

  if (fetchErr || !couple) return res.status(404).json({ error: 'Couple not found' });
  if (!couple.paired) return res.status(409).json({ error: 'No active partner to remove' });

  let newCode;
  for (let i = 0; i < 10; i++) {
    newCode = genCode();
    const { data } = await supabase.from('couples').select('id').eq('connect_code', newCode).maybeSingle();
    if (!data) break;
  }

  const { error: updateErr } = await supabase
    .from('couples')
    .update({
      paired: false,
      user2_name: 'Partner',
      connect_code: newCode,
      updated_at: new Date().toISOString()
    })
    .eq('id', coupleId);

  if (updateErr) return res.status(500).json({ error: updateErr.message });

  return res.json({ ok: true, newConnectCode: newCode, unpairedBy: requestingRole || null });
});
// ── POST /api/push/subscribe ───────────────────────────
// Saves a Web Push subscription for a device.
// Requires VAPID keys in .env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL
const webpush = require('web-push');
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:' + (process.env.VAPID_EMAIL || 'admin@usapp.love'),
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

router.post('/push/subscribe', async (req, res) => {
  const { coupleId, role, subscription } = req.body;
  if (!coupleId || !role || !subscription) return res.status(400).json({ error: 'Missing fields' });

  const { error } = await supabase.from('push_subscriptions').upsert({
    couple_id: coupleId,
    role,
    subscription: JSON.stringify(subscription),
    updated_at: new Date().toISOString()
  }, { onConflict: 'couple_id,role' });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
});

router.get('/push/vapidkey', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

// ── Helper: send push to partner ─────────────────────
// Call this from data.js whenever state is saved
async function sendPushToPartner(coupleId, senderRole, payload) {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  const partnerRole = senderRole === 'user1' ? 'user2' : 'user1';
  const { data } = await supabase.from('push_subscriptions')
    .select('subscription').eq('couple_id', coupleId).eq('role', partnerRole).maybeSingle();
  if (!data) return;
  try {
    await webpush.sendNotification(JSON.parse(data.subscription), JSON.stringify(payload));
  } catch (err) {
    // Subscription expired — remove it
    if (err.statusCode === 410) {
      await supabase.from('push_subscriptions').delete()
        .eq('couple_id', coupleId).eq('role', partnerRole);
    }
  }
}

// ── POST /api/auth/register ────────────────────────────
router.post('/register', async (req, res) => {
  const { email, password, myName, partnerName, anniversary } = req.body;
  if (!email || !password || !myName) {
    return res.status(400).json({ error: 'Email, password and name required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  // Check if email already used
  const { data: existing } = await supabase
    .from('couples')
    .select('id')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();
  if (existing) return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });

  let connectCode;
  for (let i = 0; i < 10; i++) {
    connectCode = genCode();
    const { data } = await supabase.from('couples').select('id').eq('connect_code', connectCode).maybeSingle();
    if (!data) break;
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const hashedPin = await bcrypt.hash('1234', 10);
  const coupleId = uuid();

  const { error } = await supabase.from('couples').insert({
    id: coupleId,
    connect_code: connectCode,
    email: email.toLowerCase().trim(),
    password_hash: hashedPassword,
    user1_name: myName,
    user2_name: partnerName || 'Partner',
    anniversary: anniversary || null,
    vault_pin: hashedPin,
    paired: false,
    created_at: new Date().toISOString()
  });

  if (error) {
    console.error('Register error:', error);
    return res.status(500).json({ error: 'Failed to create account: ' + error.message });
  }

  return res.json({ coupleId, connectCode, myName, partnerName: partnerName || 'Partner', paired: false });
});

// ── POST /api/auth/login ───────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const { data: couple, error } = await supabase
    .from('couples')
    .select('id, connect_code, user1_name, user2_name, anniversary, paired, password_hash, email')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();

  if (error || !couple) return res.status(401).json({ error: 'No account found with this email.' });
  if (!couple.password_hash) return res.status(401).json({ error: 'This account was created without a password. Use your connect code to sign in.' });

  const match = await bcrypt.compare(password, couple.password_hash);
  if (!match) return res.status(401).json({ error: 'Incorrect password.' });

  return res.json({
    coupleId: couple.id,
    connectCode: couple.connect_code,
    myName: couple.user1_name,
    partnerName: couple.user2_name,
    anniversary: couple.anniversary || '',
    paired: couple.paired || false,
    role: 'user1'
  });
});
module.exports = router;
module.exports.sendPushToPartner = sendPushToPartner;