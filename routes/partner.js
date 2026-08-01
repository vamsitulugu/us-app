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
const { sendPushToUser, normalizePhone, broadcastEvent } = require('./auth');

const router = express.Router();

// ── POST /api/partner/request ──────────────────────────
router.post('/request', async (req, res) => {
  const t0 = Date.now();
  console.log(`[partner:request] backend received t=${t0}`);

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
    return res.status(400).json({ error: 'You cannot connect with yourself.' });
  }

  const { data: receiver } = await supabase
    .from('users').select('id, name, couple_id').eq('phone_number', normalizedPhone).maybeSingle();
  if (!receiver) {
    return res.status(404).json({ error: 'No Twin Hearts account found with this phone number.' });
  }

  if (receiver.couple_id) {
    const { data: rCouple } = await supabase.from('couples').select('paired').eq('id', receiver.couple_id).maybeSingle();
    if (rCouple && rCouple.paired) return res.status(409).json({ error: 'This Twin Hearts account is already connected to another partner.' });
  }

  // No duplicate pending invitation between the same two users (either direction)
  const { data: existingReq } = await supabase
    .from('partner_requests')
    .select('id, sender_id, receiver_id')
    .or(`and(sender_id.eq.${sender.id},receiver_id.eq.${receiver.id}),and(sender_id.eq.${receiver.id},receiver_id.eq.${sender.id})`)
    .eq('status', 'pending')
    .maybeSingle();
  if (existingReq) {
    return res.status(409).json({ error: 'You already have a pending request.' });
  }

  const tInsertStart = Date.now();
  console.log(`[partner:request] db insert start t=${tInsertStart} (+${tInsertStart - t0}ms validation)`);

  const { data: request, error } = await supabase.from('partner_requests').insert({
    sender_id: sender.id,
    receiver_id: receiver.id,
    status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }).select('id').single();

  const tInsertDone = Date.now();
  console.log(`[partner:request] db insert done t=${tInsertDone} (+${tInsertDone - tInsertStart}ms)`);

  if (error) return res.status(500).json({ error: 'Failed to send invitation: ' + error.message });

  // Response goes back to the sender NOW — push delivery and the
  // realtime broadcast below both happen after this, unawaited, so
  // neither can add latency to the sender's "Invitation sent" moment.
  res.json({ ok: true, requestId: request.id });
  console.log(`[partner:request] HTTP response sent t=${Date.now()} (+${Date.now() - tInsertDone}ms since insert done, total ${Date.now() - t0}ms)`);

  // Realtime: tell the receiver's client instantly if it's online,
  // instead of waiting for the next 5s poll tick (this app's existing
  // polling loop — see startSyncLoop() in index.html — is what caused
  // the reported 3-6s "appears" delay). The DB row above is already the
  // source of truth; this broadcast is purely a latency shortcut, and
  // polling still covers it if the broadcast is missed or the receiver
  // is offline.
  broadcastEvent(`partner_requests:${receiver.id}`, 'new_request', { requestId: request.id })
    .then(() => console.log(`[partner:request] realtime broadcast sent t=${Date.now()}`));

  // Push notification is only a convenience — the database is the source of truth.
  const tPushStart = Date.now();
  console.log(`[partner:request] push start t=${tPushStart}`);
  sendPushToUser(receiver.id, {
    title: '💕 New Partner Request',
    body: (sender.name || 'Someone') + ' sent you a partner request. Tap to review and accept.',
    icon: '/icons/icon-192.png',
    tag: 'partner-request',
    requestId: request.id,
    userId: receiver.id
  }).then(result => {
    console.log(`[partner:request] push done t=${Date.now()} (+${Date.now() - tPushStart}ms) result=${JSON.stringify(result)}`);
  }).catch(err => {
    console.error(`[partner:request] push threw unexpectedly:`, err.message);
  });
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

  const { data: sender } = await supabase
    .from('users').select('name, phone_number, couple_id, role').eq('id', request.sender_id).maybeSingle();

  let senderAvatar = null;
  if (sender && sender.couple_id) {
    const { data: couple } = await supabase
      .from('couples').select('user1_avatar, user2_avatar').eq('id', sender.couple_id).maybeSingle();
    if (couple) senderAvatar = sender.role === 'user2' ? (couple.user2_avatar || null) : (couple.user1_avatar || null);
  }

  return res.json({
    request: {
      id: request.id,
      senderName: sender ? sender.name : 'Someone',
      senderPhone: sender ? sender.phone_number : '',
      senderAvatar,
      createdAt: request.created_at
    }
  });
});

// ── GET /api/partner/pending-list/:userId ──────────────
// All pending invitations addressed to this user (Partner Requests
// section). GET /pending/:userId above stays as-is for the popup
// (most recent single request) so nothing existing breaks.
router.get('/pending-list/:userId', async (req, res) => {
  const { data: requests, error } = await supabase
    .from('partner_requests')
    .select('id, sender_id, created_at')
    .eq('receiver_id', req.params.userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  if (!requests || !requests.length) return res.json({ requests: [] });

  const senderIds = requests.map(r => r.sender_id);
  const { data: senders } = await supabase
    .from('users').select('id, name, phone_number, couple_id, role').in('id', senderIds);
  const senderMap = {};
  (senders || []).forEach(s => { senderMap[s.id] = s; });

  // Avatars live on couples.user1_avatar/user2_avatar (keyed by role),
  // not on the users table — look those up too.
  const coupleIds = [...new Set((senders || []).map(s => s.couple_id).filter(Boolean))];
  let coupleMap = {};
  if (coupleIds.length) {
    const { data: couples } = await supabase
      .from('couples').select('id, user1_avatar, user2_avatar').in('id', coupleIds);
    (couples || []).forEach(c => { coupleMap[c.id] = c; });
  }
  const avatarFor = s => {
    const c = s && coupleMap[s.couple_id];
    if (!c) return null;
    return s.role === 'user2' ? (c.user2_avatar || null) : (c.user1_avatar || null);
  };

  return res.json({
    requests: requests.map(r => ({
      id: r.id,
      senderName: senderMap[r.sender_id]?.name || 'Someone',
      senderPhone: senderMap[r.sender_id]?.phone_number || '',
      senderAvatar: avatarFor(senderMap[r.sender_id]),
      createdAt: r.created_at
    }))
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
    .from('partner_requests').select('id, receiver_id, created_at').eq('sender_id', user.id).eq('status', 'pending').maybeSingle();
  if (sent) {
    const { data: receiver } = await supabase.from('users').select('name, phone_number').eq('id', sent.receiver_id).maybeSingle();
    return res.json({
      status: 'waiting',
      requestId: sent.id,
      receiverName: receiver ? receiver.name : 'Someone',
      receiverPhone: receiver ? receiver.phone_number : '',
      createdAt: sent.created_at
    });
  }

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
  P0005: { status: 409, message: 'This Twin Hearts account is already connected to another partner.' }
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
    out_couple_id: coupleId,
    out_role: role,
    out_partner_name: partnerName,
    out_sender_id: senderId,
    out_receiver_name: receiverName
  } = result;

  broadcastEvent(`partner_requests:${senderId}`, 'partner_accepted', { coupleId })
    .then(() => console.log(`[partner:accept] realtime broadcast sent to sender=${senderId}`));

  sendPushToUser(senderId, {
    title: 'Twin Hearts ❤️',
    body: (receiverName || 'Your partner') + ' accepted your connection request!',
    icon: '/icons/icon-192.png',
    tag: 'partner-accepted'
  }).then(result => {
    console.log(`[partner:accept] push done result=${JSON.stringify(result)}`);
  }).catch(err => console.error('[partner:accept] push threw unexpectedly:', err.message));

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