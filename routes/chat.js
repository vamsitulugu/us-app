const express = require('express');
const supabase = require('../middleware/supabase');
const router = express.Router();

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

module.exports = router;