// ═══════════════════════════════════════════════════════
//  routes/chat.js — Full couple chat backend
//  Save as: routes/chat.js
//  Register in server entry file:
//    app.use('/api/chat', require('./routes/chat'));
// ═══════════════════════════════════════════════════════
const express  = require('express');
const crypto   = require('crypto');
const supabase = require('../middleware/supabase');
const router   = express.Router();

let _sendPushToPartner, _sendFCMToPartner, _broadcastEvent;
try {
  _sendPushToPartner = require('./auth').sendPushToPartner;
  console.log('[NOTIF-DEBUG][chat] sendPushToPartner loaded OK:', typeof _sendPushToPartner === 'function');
} catch (e) {
  console.error('[NOTIF-DEBUG][chat] FAILED HERE: Stage0 — require("./auth").sendPushToPartner threw at module load:', e.message);
}
try {
  _sendFCMToPartner = require('./auth').sendFCMToPartner;
  console.log('[NOTIF-DEBUG][chat] sendFCMToPartner loaded OK:', typeof _sendFCMToPartner === 'function');
} catch (e) {
  console.error('[NOTIF-DEBUG][chat] FAILED HERE: Stage0 — require("./auth").sendFCMToPartner threw at module load:', e.message);
}
try {
  _broadcastEvent = require('./auth').broadcastEvent;
} catch (e) {
  console.error('[chat] FAILED to load broadcastEvent from ./auth:', e.message);
}
const { isViewingChat } = require('./presence');

function otherRole(role) { return role === 'user1' ? 'user2' : 'user1'; }

// ─── GET messages (initial load + polling fallback) ─────
// GET /api/chat/:coupleId?after=<id>&limit=100
router.get('/:coupleId', async (req, res) => {
  const { coupleId } = req.params;
  const afterTs = req.query.after; // ISO timestamp string now, not a numeric id
  const limit = Math.min(parseInt(req.query.limit) || 200, 300);

  const validAfter = afterTs && afterTs !== 'NaN' && afterTs !== 'null' && afterTs !== '0';

  if (validAfter) {
    // Polling for new messages only
    const { data, error } = await supabase
      .from('chat_messages').select('*').eq('couple_id', coupleId)
      .gt('created_at', afterTs)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }

  // Initial load — must be the most RECENT `limit` messages, not the oldest.
  const { data, error } = await supabase
    .from('chat_messages').select('*').eq('couple_id', coupleId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  return res.json((data || []).reverse());
});

// ─── POST send message ────────────────────────────────
// body: { coupleId, clientId, senderRole, type, text, mediaUrl, mediaMeta, replyTo }
router.post('/', async (req, res) => {
  const { coupleId, clientId, senderRole, type, text, mediaUrl, mediaMeta, replyTo, forwarded } = req.body;
  if (!coupleId || !senderRole || !clientId) return res.status(400).json({ error: 'Missing data' });
  if (!text && !mediaUrl && !mediaMeta) return res.status(400).json({ error: 'Empty message' });

  const row = {
    couple_id:   coupleId,
    client_id:   clientId,
    sender_role: senderRole,
    type:        type || 'text',
    text:        text || null,
    media_url:   mediaUrl || null,
    media_meta:  mediaMeta || null,
    reply_to:    replyTo || null,
    forwarded:   !!forwarded,
    delivered:   false,
    read:        false,
  };

  // Upsert on (couple_id, client_id) so retried/optimistic sends never duplicate
  const { data, error } = await supabase
    .from('chat_messages')
    .upsert(row, { onConflict: 'couple_id,client_id' })
    .select().single();

  if (error) return res.status(500).json({ error: error.message });

  // ── DELIVERED must reflect REAL partner connectivity, not be faked. ──
  // A message is only "delivered" once it has actually reached the
  // partner's active client. We approximate that using chat_presence
  // (updated by the partner's own 20s heartbeat, see startPresence() in
  // public/chat/chat.js): if their last heartbeat is fresh (<35s old,
  // same threshold the client itself uses to show "Online"), their
  // Supabase Realtime socket is almost certainly still connected, so the
  // INSERT they just received over that socket counts as delivery.
  // If they're stale/offline, the row stays delivered:false (single ✓)
  // — the presence heartbeat POST handler below is what flips it to
  // delivered once they actually reconnect, so nothing here fakes it.
  const receiverRoleForDelivery = senderRole === 'user1' ? 'user2' : 'user1';
  let delivered = false, deliveredAt = null;
  try {
    const { data: presenceRow } = await supabase.from('chat_presence')
      .select('status,last_seen').eq('couple_id', coupleId).eq('role', receiverRoleForDelivery).maybeSingle();
    if (presenceRow && presenceRow.status === 'online' &&
        (Date.now() - new Date(presenceRow.last_seen).getTime()) < 35000) {
      delivered = true;
      deliveredAt = new Date().toISOString();
    }
  } catch (e) { console.error('presence lookup for delivery failed:', e.message); }

  if (delivered) {
    // Fire-and-forget: the client only needs to know the message SAVED,
    // not that this follow-up flag write finished too. Awaiting it here
    // would force every send through two sequential DB round-trips.
    supabase.from('chat_messages')
      .update({ delivered: true, delivered_at: deliveredAt })
      .eq('id', data.id)
      .then(({ error: dErr }) => { if (dErr) console.error('mark-delivered failed:', dErr.message); });
    data.delivered = true;
    data.delivered_at = deliveredAt;

    // Push the delivered flag over Realtime Broadcast (not just relying on
    // the chat_messages postgres_changes/replication stream). Broadcast-
    // over-HTTP always fires regardless of whether the table's Realtime
    // replication publication has UPDATE events enabled in the Supabase
    // dashboard — that setting lives outside this repo and isn't something
    // the app can verify or configure itself, so this makes delivered/read
    // ticks work correctly even if that dashboard setting is off.
    // Topic MUST match the client's channel name exactly: 'chat-' + coupleId
    // (see startRealtime() in public/chat/chat.js).
    if (_broadcastEvent) {
      _broadcastEvent(`chat-${coupleId}`, 'message_status', { id: data.id, delivered: true, delivered_at: deliveredAt });
    }
  }
  // else: row stays delivered:false (single ✓ in the UI). See the
  // presence POST handler below — the moment the partner's client sends
  // its next "online" heartbeat, any of their pending undelivered
  // messages get flipped to delivered and broadcast from there.

  // Push notify partner — but only if they're NOT currently looking at
  // this same conversation. Real-time (Supabase Realtime, already wired
  // up above) delivers the message to them either way; this only
  // decides whether to ALSO interrupt them with a system notification.
  // See routes/presence.js — the client sends a heartbeat with its
  // current page whenever it's open, so "viewing chat right now" is
  // just "their last heartbeat says page === 'chat'".
  const receiverRole = senderRole === 'user1' ? 'user2' : 'user1';
  const viewingChat = isViewingChat(coupleId, receiverRole);
  console.log(`[NOTIF-DEBUG][chat] Stage1 message saved couple=${coupleId} sender=${senderRole} receiver=${receiverRole} receiverViewingThisChat=${viewingChat}`);
  if (viewingChat) {
    console.log(`[NOTIF-DEBUG][chat] Stage1 SKIPPED — receiver's presence heartbeat says they're already on this chat. No push sent (by design — real-time already delivered it).`);
  }
  if (!viewingChat) {
    // Best-effort sender name for the notification body/MessagingStyle
    // (see TwinHeartsMessagingService reading data.senderName). Never
    // blocks or fails the send — a lookup error just falls back to the
    // generic "New message" title already used everywhere else.
    let senderName = null;
    let senderAvatar = null;
    try {
      const { data: couple } = await supabase.from('couples')
        .select('user1_name, user2_name, user1_avatar, user2_avatar').eq('id', coupleId).maybeSingle();
      senderName = couple ? (senderRole === 'user1' ? couple.user1_name : couple.user2_name) : null;
      senderAvatar = couple ? (senderRole === 'user1' ? couple.user1_avatar : couple.user2_avatar) : null;
    } catch (_) {}
    console.log(`[NOTIF-DEBUG][chat] Stage1b avatar lookup couple=${coupleId} sender=${senderRole} senderAvatar=${senderAvatar ? senderAvatar : 'NULL — couples.' + (senderRole === 'user1' ? 'user1_avatar' : 'user2_avatar') + ' is empty, notification will fall back to letter avatar'}`);
    const chatPayload = {
      title: senderName ? `💬 ${senderName}` : '💬 New message',
      body: text ? text.slice(0, 80) : (type === 'image' ? '📷 Photo' : type === 'image_group' ? `📷 ${(mediaMeta?.items?.length) || 1} Photos` : type === 'video' ? '🎬 Video' : '🎙️ Voice message'),
      icon: '/icons/icon-192.png',
      tag: 'chat-msg',
      url: '/?page=chat',
      senderName: senderName || undefined,
      senderAvatar: senderAvatar || undefined
    };
    if (_sendPushToPartner) {
      _sendPushToPartner(coupleId, senderRole, chatPayload).catch(err =>
        console.error(`[NOTIF-DEBUG][chat] sendPushToPartner threw unexpectedly:`, err.message));
    } else {
      console.error(`[NOTIF-DEBUG][chat] FAILED HERE: Stage0 — sendPushToPartner is undefined, webpush skipped entirely for couple=${coupleId}`);
    }
    if (_sendFCMToPartner) {
      _sendFCMToPartner(coupleId, senderRole, chatPayload).catch(err =>
        console.error(`[NOTIF-DEBUG][chat] sendFCMToPartner threw unexpectedly:`, err.message));
    } else {
      console.error(`[NOTIF-DEBUG][chat] FAILED HERE: Stage0 — sendFCMToPartner is undefined, FCM skipped entirely for couple=${coupleId}`);
    }
  }

  return res.json(data);
});

// ─── PATCH edit message ───────────────────────────────
router.patch('/:id', async (req, res) => {
  const { coupleId, senderRole, text } = req.body;
  if (!coupleId || !text) return res.status(400).json({ error: 'Missing data' });

  const { data: msg } = await supabase.from('chat_messages')
    .select('sender_role').eq('id', req.params.id).eq('couple_id', coupleId).maybeSingle();
  if (!msg) return res.status(404).json({ error: 'Not found' });
  if (msg.sender_role !== senderRole) return res.status(403).json({ error: 'Not your message' });

  const { data, error } = await supabase.from('chat_messages')
    .update({ text, edited: true, edited_at: new Date().toISOString() })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ─── DELETE message (for-me or for-everyone) ──────────
// body: { coupleId, senderRole, mode: 'everyone' | 'me' }
router.delete('/:id', async (req, res) => {
  const { coupleId, senderRole, mode } = req.body;
  if (!coupleId || !senderRole) return res.status(400).json({ error: 'Missing data' });

  if (mode === 'everyone') {
    const { data: msg } = await supabase.from('chat_messages')
      .select('sender_role, type, media_meta').eq('id', req.params.id).eq('couple_id', coupleId).maybeSingle();
    if (!msg) return res.status(404).json({ error: 'Not found' });
    if (msg.sender_role !== senderRole) return res.status(403).json({ error: 'Not your message' });
    const { error } = await supabase.from('chat_messages')
      .update({ deleted: true, deleted_for: 'everyone', text: null, media_url: null })
      .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    // Voice messages store their storage path in media_meta.path (set at
    // send time) — remove the audio file itself now that no message
    // references it, instead of leaving it orphaned in the bucket.
    if (msg.type === 'voice' && msg.media_meta && msg.media_meta.path) {
      supabase.storage.from('voice-messages').remove([msg.media_meta.path])
        .then(({ error: rmErr }) => { if (rmErr) console.error('voice storage cleanup failed:', rmErr.message); });
    }
  } else {
    // delete-for-me: append role to deleted_for (comma list stored in deleted_for as csv)
    const { data: msg } = await supabase.from('chat_messages')
      .select('deleted_for').eq('id', req.params.id).eq('couple_id', coupleId).maybeSingle();
    if (!msg) return res.status(404).json({ error: 'Not found' });
    const existing = (msg.deleted_for || 'none') === 'none' ? [] : msg.deleted_for.split(',');
    if (!existing.includes(senderRole)) existing.push(senderRole);
    const { error } = await supabase.from('chat_messages')
      .update({ deleted_for: existing.join(',') })
      .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
  }
  return res.json({ ok: true });
});

// ─── POST mark-read (all partner messages up to latest) ─
router.post('/:coupleId/read', async (req, res) => {
  const { coupleId } = req.params;
  const { role } = req.body;
  if (!role) return res.status(400).json({ error: 'Missing role' });

  const readAt = new Date().toISOString();
  const { data: updated, error } = await supabase.from('chat_messages')
    .update({ read: true, read_at: readAt })
    .eq('couple_id', coupleId)
    .eq('sender_role', otherRole(role))
    .eq('read', false)
    .select('id');

  if (error) return res.status(500).json({ error: error.message });

  // Same reasoning as the delivered-flag broadcast above: push the read
  // receipt over Realtime Broadcast so the SENDER's ticks flip to blue
  // instantly, without depending on chat_messages' Postgres replication
  // publication settings (which can't be verified/configured from here).
  if (_broadcastEvent && updated && updated.length) {
    _broadcastEvent(`chat-${coupleId}`, 'message_status', {
      ids: updated.map(m => m.id), read: true, read_at: readAt
    });
  }

  return res.json({ ok: true });
});

// ─── POST toggle reaction ──────────────────────────────
// body: { coupleId, role, emoji }
router.post('/:id/react', async (req, res) => {
  const { coupleId, role, emoji } = req.body;
  if (!coupleId || !role || !emoji) return res.status(400).json({ error: 'Missing data' });

  const { data: msg } = await supabase.from('chat_messages')
    .select('reactions').eq('id', req.params.id).eq('couple_id', coupleId).maybeSingle();
  if (!msg) return res.status(404).json({ error: 'Not found' });

  const reactions = msg.reactions || {};
  // Remove this role's existing reaction on any emoji first
  Object.keys(reactions).forEach(e => {
    reactions[e] = (reactions[e] || []).filter(r => r !== role);
    if (!reactions[e].length) delete reactions[e];
  });
  // Toggle: if the same emoji+role existed we've already removed it (acts as un-react)
  const already = (msg.reactions?.[emoji] || []).includes(role);
  if (!already) {
    reactions[emoji] = [...(reactions[emoji] || []), role];
  }

  const { data, error } = await supabase.from('chat_messages')
    .update({ reactions }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ─── POST toggle pin ────────────────────────────────────
router.post('/:id/pin', async (req, res) => {
  const { coupleId, pinned } = req.body;
  const { data, error } = await supabase.from('chat_messages')
    .update({ pinned: !!pinned }).eq('id', req.params.id).eq('couple_id', coupleId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ─── POST toggle star ───────────────────────────────────
router.post('/:id/star', async (req, res) => {
  const { coupleId, role } = req.body;
  if (!coupleId || !role) return res.status(400).json({ error: 'Missing data' });

  const { data: msg } = await supabase.from('chat_messages')
    .select('starred_by').eq('id', req.params.id).eq('couple_id', coupleId).maybeSingle();
  if (!msg) return res.status(404).json({ error: 'Not found' });

  let starred = msg.starred_by || [];
  starred = starred.includes(role) ? starred.filter(r => r !== role) : [...starred, role];

  const { data, error } = await supabase.from('chat_messages')
    .update({ starred_by: starred }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ─── PRESENCE — GET / POST ──────────────────────────────
router.get('/:coupleId/presence', async (req, res) => {
  const { data, error } = await supabase.from('chat_presence')
    .select('*').eq('couple_id', req.params.coupleId);
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/:coupleId/presence', async (req, res) => {
  const { role, status } = req.body;
  if (!role) return res.status(400).json({ error: 'Missing role' });
  const { error } = await supabase.from('chat_presence').upsert({
    couple_id: req.params.coupleId, role,
    status: status || 'online', last_seen: new Date().toISOString()
  }, { onConflict: 'couple_id,role' });
  if (error) return res.status(500).json({ error: error.message });

  // This role just told us it's online (heartbeat, or coming back from
  // background/reconnect) — this is the REAL "message reached the
  // partner's active client" moment for anything the OTHER role sent
  // while this role was offline/away, so flip those from single ✓ to
  // double ✓ now instead of only faking it at send time. Fire-and-forget:
  // the presence write itself already succeeded and shouldn't wait on this.
  if ((status || 'online') === 'online') {
    const coupleId = req.params.coupleId;
    supabase.from('chat_messages')
      .update({ delivered: true, delivered_at: new Date().toISOString() })
      .eq('couple_id', coupleId)
      .eq('sender_role', otherRole(role))
      .eq('delivered', false)
      .select('id')
      .then(({ data: flipped, error: fErr }) => {
        if (fErr) { console.error('presence-driven delivery flip failed:', fErr.message); return; }
        if (_broadcastEvent && flipped && flipped.length) {
          _broadcastEvent(`chat-${coupleId}`, 'message_status', {
            ids: flipped.map(m => m.id), delivered: true, delivered_at: new Date().toISOString()
          });
        }
      });
  }

  return res.json({ ok: true });
});

// ─── SEARCH within chat ─────────────────────────────────
router.get('/:coupleId/search', async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 1) return res.json([]);
  const { data, error } = await supabase.from('chat_messages')
    .select('*').eq('couple_id', req.params.coupleId)
    .ilike('text', `%${q}%`).order('created_at', { ascending: false }).limit(50);
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ─── WALLPAPER — shared mode, synced across both devices ─
// GET returns the couple's shared wallpaper row (or a default shape if
// they've never set one). POST upserts it — the client's own Supabase
// realtime channel (already subscribed to this couple's changes, see
// chat.js's startRealtime()) picks up the change and applies it instantly
// on the partner's device without a refresh, since chat_wallpaper is
// added to the same realtime publication as chat_messages.
router.get('/:coupleId/wallpaper', async (req, res) => {
  const { data, error } = await supabase.from('chat_wallpaper')
    .select('*').eq('couple_id', req.params.coupleId).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || { couple_id: req.params.coupleId, mode: 'default', swatch: null, image_url: null, dim: 0 });
});

router.post('/:coupleId/wallpaper', async (req, res) => {
  const { mode, swatch, image_url, dim, role } = req.body;
  if (!mode || !['default', 'swatch', 'custom'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode' });
  }
  const { data, error } = await supabase.from('chat_wallpaper').upsert({
    couple_id: req.params.coupleId,
    mode, swatch: swatch || null, image_url: image_url || null,
    dim: Number.isFinite(dim) ? Math.max(0, Math.min(90, dim)) : 0,
    updated_by: role || null,
    updated_at: new Date().toISOString()
  }, { onConflict: 'couple_id' }).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

module.exports = router;