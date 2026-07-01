const express = require('express');
const supabase = require('../middleware/supabase');
const router = express.Router();
const crypto = require('crypto');
// Cursor pagination: ?before=<iso>&limit=40
router.get('/:coupleId', async (req, res) => {
  const { coupleId } = req.params;
  const { before, limit } = req.query;
  let q = supabase.from('chat_messages')
    .select('*')
    .eq('couple_id', coupleId)
    .order('created_at', { ascending: false })
    .limit(Math.min(parseInt(limit) || 40, 100));
  if (before) q = q.lt('created_at', before);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json((data || []).reverse());
});

// Optimistic insert — idempotent on client_id
router.post('/', async (req, res) => {
  const { coupleId, clientId, senderRole, type, text, mediaUrl, audioData, duration, replyTo } = req.body;
  if (!coupleId || !clientId || !senderRole) return res.status(400).json({ error: 'Missing fields' });

  const { data, error } = await supabase.from('chat_messages')
    .upsert({
      client_id: clientId,
      couple_id: coupleId,
      sender_role: senderRole,
      type: type || 'text',
      text: text || null,
      media_url: mediaUrl || null,
      audio_data: audioData || null,
      duration: duration || null,
      reply_to: replyTo || null
    }, { onConflict: 'couple_id,client_id' })
    .select().single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { coupleId, ...fields } = req.body;
  const allowed = ['pinned', 'starred', 'reactions', 'read', 'deleted', 'text'];
  const updates = {};
  for (const k of allowed) if (k in fields) updates[k] = fields[k];
  if (updates.deleted) { updates.text = ''; updates.media_url = null; updates.audio_data = null; updates.type = 'deleted'; }

  const { data, error } = await supabase.from('chat_messages')
    .update(updates).eq('id', id).eq('couple_id', coupleId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.post('/:id/read', async (req, res) => {
  const { coupleId } = req.body;
  await supabase.from('chat_messages').update({ read: true })
    .eq('couple_id', coupleId).eq('read', false).neq('sender_role', req.body.myRole);
  return res.json({ ok: true });
});
// Deliver ack — call when a client receives a message it didn't send
router.post('/:id/delivered', async (req, res) => {
  const { id } = req.params;
  const { coupleId } = req.body;
  const { data, error } = await supabase.from('chat_messages')
    .update({ delivered: true, delivered_at: new Date().toISOString() })
    .eq('id', id).eq('couple_id', coupleId).eq('delivered', false)
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || { ok: true });
});

// Batch delivered — call once on reconnect for all undelivered msgs from partner
router.post('/:coupleId/deliver-all', async (req, res) => {
  const { coupleId } = req.params;
  const { myRole } = req.body;
  const { data, error } = await supabase.from('chat_messages')
    .update({ delivered: true, delivered_at: new Date().toISOString() })
    .eq('couple_id', coupleId).eq('delivered', false).neq('sender_role', myRole)
    .select('id');
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ids: (data || []).map(r => r.id) });
});

// Batch read — extends existing /:id/read logic to also set read_at
router.post('/:coupleId/read-all', async (req, res) => {
  const { coupleId } = req.params;
  const { myRole } = req.body;
  const { data, error } = await supabase.from('chat_messages')
    .update({ read: true, read_at: new Date().toISOString(), delivered: true, delivered_at: new Date().toISOString() })
    .eq('couple_id', coupleId).eq('read', false).neq('sender_role', myRole)
    .select('id');
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ids: (data || []).map(r => r.id) });
});

// Forward — creates new message row(s) referencing original content
router.post('/forward', async (req, res) => {
  const { coupleId, senderRole, messageIds } = req.body; // messageIds: array of source ids
  if (!coupleId || !senderRole || !Array.isArray(messageIds) || !messageIds.length)
    return res.status(400).json({ error: 'coupleId, senderRole, messageIds required' });

  const { data: sources, error: e1 } = await supabase.from('chat_messages')
    .select('*').in('id', messageIds).eq('couple_id', coupleId);
  if (e1) return res.status(500).json({ error: e1.message });

  const rows = (sources || []).map(s => ({
    client_id: crypto.randomUUID(),
    couple_id: coupleId,
    sender_role: senderRole,
    type: s.type,
    text: s.text,
    media_url: s.media_url,
    audio_data: s.audio_data,
    duration: s.duration,
    forwarded: true
  }));
  const { data, error } = await supabase.from('chat_messages').insert(rows).select();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// Message info — single row with all timestamps + reactions
router.get('/:coupleId/info/:id', async (req, res) => {
  const { coupleId, id } = req.params;
  const { data, error } = await supabase.from('chat_messages')
    .select('id, created_at, delivered_at, read_at, edited, edited_at, reactions, sender_role')
    .eq('id', id).eq('couple_id', coupleId).single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});
module.exports = router;