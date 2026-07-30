// ═══════════════════════════════════════════════════════
//  Partner Routes — Phone Number Invitation System
//  Replaces the old 6-digit Connect Code pairing flow.
//
//  A user is invited by phone number; if found, an invitation is
//  stored in `partner_requests`. The receiver sees it automatically
//  on next app launch/resume/refresh (GET /pending) — no typing,
//  no codes. Accepting merges the receiver into the sender's
//  existing `couples` row (the shared-data container used by
//  chat/location/tracking/music/etc, unchanged).
// ═══════════════════════════════════════════════════════
const express  = require('express');
const supabase = require('../middleware/supabase');
const { sendPushToUser, normalizePhone } = require('./auth');

const router = express.Router();

// ── POST /api/partner/request ──────────────────────────
router.post('/request', async (req, res) => {
  const { userId, partnerPhone } = req.body;
  if (!userId || !partnerPhone) return res.status(400).json({ error: 'Missing data' });

  const normalizedPhone = normalizePhone(partnerPhone);

  const { data: sender } = await supabase
    .from('users').select('id, name, couple_id, phone_number').eq('id', userId).maybeSingle();
  if (!sender) return res.status(404).json({ error: 'Account not found' });

  // Already connected?
  if (sender.couple_id) {
    const { data: couple } = await supabase.from('couples').select('paired').eq('id', sender.couple_id).maybeSingle();
    if (couple && couple.paired) return res.status(409).json({ error: 'You are already connected with a partner.' });
  }

  if (normalizedPhone === sender.phone_number) {
    return res.status(400).json({ error: 'You cannot invite yourself.' });
  }

  const { data: receiver } = await supabase
    .from('users').select('id, name, couple_id').eq('phone_number', normalizedPhone).maybeSingle();
  if (!receiver) {
    return res.status(404).json({ error: 'No Twin Hearts account found with this phone number.' });
  }

  if (receiver.couple_id) {
    const { data: rCouple } = await supabase.from('couples').select('paired').eq('id', receiver.couple_id).maybeSingle();
    if (rCouple && rCouple.paired) return res.status(409).json({ error: 'This person is already connected with someone else.' });
  }

  // No duplicate pending invitation between the same two users (either direction)
  const { data: existingReq } = await supabase
    .from('partner_requests')
    .select('id, sender_id, receiver_id')
    .or(`and(sender_id.eq.${sender.id},receiver_id.eq.${receiver.id}),and(sender_id.eq.${receiver.id},receiver_id.eq.${sender.id})`)
    .eq('status', 'pending')
    .maybeSingle();
  if (existingReq) {
    return res.status(409).json({ error: 'There is already a pending invitation between you two.' });
  }

  const { data: request, error } = await supabase.from('partner_requests').insert({
    sender_id: sender.id,
    receiver_id: receiver.id,
    status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }).select('id').single();

  if (error) return res.status(500).json({ error: 'Failed to send invitation: ' + error.message });

  // Push notification is only a convenience — the database is the source of truth.
  sendPushToUser(receiver.id, {
    title: 'Twin Hearts ❤️',
    body: (sender.name || 'Someone') + ' wants to connect with you.',
    icon: '/icons/icon-192.png',
    tag: 'partner-request'
  }).catch(() => {});

  return res.json({ ok: true, requestId: request.id });
});

// ── GET /api/partner/pending/:userId ───────────────────
// Polled on every app launch/resume/refresh.
router.get('/pending/:userId', async (req, res) => {
  const { data: request, error } = await supabase
    .from('partner_requests')
    .select('id, sender_id, created_at')
    .eq('receiver_id', req.params.userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !request) return res.json({ request: null });

  const { data: sender } = await supabase.from('users').select('name, phone_number').eq('id', request.sender_id).maybeSingle();

  return res.json({
    request: {
      id: request.id,
      senderName: sender ? sender.name : 'Someone',
      senderPhone: sender ? sender.phone_number : '',
      createdAt: request.created_at
    }
  });
});

// ── GET /api/partner/status/:userId ────────────────────
// Used by Settings > Partner Connection Status.
router.get('/status/:userId', async (req, res) => {
  const { data: user } = await supabase
    .from('users').select('id, couple_id, role').eq('id', req.params.userId).maybeSingle();
  if (!user) return res.status(404).json({ error: 'Account not found' });

  if (user.couple_id) {
    const { data: couple } = await supabase
      .from('couples').select('user1_name, user2_name, paired, updated_at').eq('id', user.couple_id).maybeSingle();
    if (couple && couple.paired) {
      const partnerName = user.role === 'user1' ? couple.user2_name : couple.user1_name;
      return res.json({ status: 'connected', partnerName, connectedSince: couple.updated_at });
    }
  }

  const { data: sent } = await supabase
    .from('partner_requests').select('id').eq('sender_id', user.id).eq('status', 'pending').maybeSingle();
  if (sent) return res.json({ status: 'waiting' });

  const { data: received } = await supabase
    .from('partner_requests').select('id, sender_id').eq('receiver_id', user.id).eq('status', 'pending').maybeSingle();
  if (received) {
    const { data: sender } = await supabase.from('users').select('name').eq('id', received.sender_id).maybeSingle();
    return res.json({ status: 'invitation_received', senderName: sender ? sender.name : 'Someone' });
  }

  return res.json({ status: 'not_connected' });
});

// ── POST /api/partner/accept ───────────────────────────
// Maps the Postgres error codes raised inside accept_partner_request()
// back to the same HTTP status/messages the old inline logic returned,
// so the API contract for callers/frontend doesn't change.
const ACCEPT_RPC_ERROR_MAP = {
  P0001: { status: 404, message: 'Invitation not found' },
  P0002: { status: 403, message: 'This invitation is not for you' },
  P0003: { status: 409, message: 'This invitation is no longer pending' },
  P0004: { status: 404, message: 'Account not found' },
  P0005: { status: 409, message: 'That person is already connected with someone else.' }
};

router.post('/accept', async (req, res) => {
  const { requestId, userId } = req.body;
  if (!requestId || !userId) return res.status(400).json({ error: 'Missing data' });

  // The entire merge (validation + both users' updates + couple update +
  // partner_requests cleanup) runs inside a single Postgres transaction
  // via this RPC. Postgres functions are atomic: if any step raises,
  // everything prior in the same call is rolled back automatically, so
  // there's no window where one account is linked and the other isn't.
  const { data, error } = await supabase.rpc('accept_partner_request', {
    p_request_id: requestId,
    p_user_id: userId
  });

  if (error) {
    const mapped = ACCEPT_RPC_ERROR_MAP[error.code];
    if (mapped) return res.status(mapped.status).json({ error: mapped.message });
    return res.status(500).json({ error: error.message });
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result) return res.status(500).json({ error: 'Accept failed unexpectedly' });

  const {
    couple_id: coupleId,
    role,
    partner_name: partnerName,
    sender_id: senderId,
    receiver_name: receiverName
  } = result;

  sendPushToUser(senderId, {
    title: 'Twin Hearts ❤️',
    body: (receiverName || 'Your partner') + ' accepted your connection request!',
    icon: '/icons/icon-192.png',
    tag: 'partner-accepted'
  }).catch(() => {});

  return res.json({
    ok: true,
    coupleId,
    role,
    partnerName
  });
});

// ── POST /api/partner/reject ────────────────────────────
router.post('/reject', async (req, res) => {
  const { requestId, userId } = req.body;
  if (!requestId || !userId) return res.status(400).json({ error: 'Missing data' });

  const { data: request } = await supabase
    .from('partner_requests').select('id, receiver_id, status').eq('id', requestId).maybeSingle();
  if (!request) return res.status(404).json({ error: 'Invitation not found' });
  if (request.receiver_id !== userId) return res.status(403).json({ error: 'This invitation is not for you' });
  if (request.status !== 'pending') return res.status(409).json({ error: 'This invitation is no longer pending' });

  await supabase.from('partner_requests').update({
    status: 'declined', updated_at: new Date().toISOString()
  }).eq('id', requestId);

  return res.json({ ok: true });
});

// ── POST /api/partner/cancel ────────────────────────────
// Lets the sender cancel their own pending invitation from the
// "Invitation Sent — Waiting for your partner" screen.
router.post('/cancel', async (req, res) => {
  const { requestId, userId } = req.body;
  if (!requestId || !userId) return res.status(400).json({ error: 'Missing data' });

  const { data: request } = await supabase
    .from('partner_requests').select('id, sender_id, status').eq('id', requestId).maybeSingle();
  if (!request) return res.status(404).json({ error: 'Invitation not found' });
  if (request.sender_id !== userId) return res.status(403).json({ error: 'This invitation is not yours to cancel' });
  if (request.status !== 'pending') return res.status(409).json({ error: 'This invitation is no longer pending' });

  await supabase.from('partner_requests').update({
    status: 'cancelled', updated_at: new Date().toISOString()
  }).eq('id', requestId);

  return res.json({ ok: true });
});

module.exports = router;