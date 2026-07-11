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

let _sendPushToPartner;
try { _sendPushToPartner = require('./auth').sendPushToPartner; } catch (_) {}

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

  // Mark delivered immediately (partner will mark read when they open chat)
  await supabase.from('chat_messages').update({
    delivered: true, delivered_at: new Date().toISOString()
  }).eq('id', data.id);

  // Push notify partner
  if (_sendPushToPartner) {
    _sendPushToPartner(coupleId, senderRole, {
      title: '💬 New message',
      body: text ? text.slice(0, 80) : (type === 'image' ? '📷 Photo' : type === 'video' ? '🎬 Video' : '🎙️ Voice message'),
      icon: '/icons/icon-192.png',
      tag: 'chat-msg',
      url: '/?page=chat'
    }).catch(() => {});
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
      .select('sender_role').eq('id', req.params.id).eq('couple_id', coupleId).maybeSingle();
    if (!msg) return res.status(404).json({ error: 'Not found' });
    if (msg.sender_role !== senderRole) return res.status(403).json({ error: 'Not your message' });
    const { error } = await supabase.from('chat_messages')
      .update({ deleted: true, deleted_for: 'everyone', text: null, media_url: null })
      .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
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

  const { error } = await supabase.from('chat_messages')
    .update({ read: true, read_at: new Date().toISOString() })
    .eq('couple_id', coupleId)
    .eq('sender_role', otherRole(role))
    .eq('read', false);

  if (error) return res.status(500).json({ error: error.message });
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

module.exports = router;