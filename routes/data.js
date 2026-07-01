// ═══════════════════════════════════════════════════════
//  Data Routes — All couple data synced via Supabase
// ═══════════════════════════════════════════════════════
const express  = require('express');
const supabase = require('../middleware/supabase');
const router   = express.Router();
let _sendPushToPartner;
try { _sendPushToPartner = require('./auth').sendPushToPartner; } catch(_) {}
// ─── FULL STATE (save/load entire app) ─────────────────

router.get('/state/:coupleId', async (req, res) => {
  const { data, error } = await supabase
    .from('app_state')
    .select('state')
    .eq('couple_id', req.params.coupleId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    return res.status(500).json({ error: error.message });
  }
  return res.json(data?.state || null);
});

router.post('/state', async (req, res) => {
  const { coupleId, state } = req.body;
  if (!coupleId || !state) return res.status(400).json({ error: 'Missing data' });

  const { error } = await supabase.from('app_state').upsert({
    couple_id:  coupleId,
    state:      state,
    updated_at: new Date().toISOString()
  }, { onConflict: 'couple_id' });
if (_sendPushToPartner && coupleId && state) {
  const role = state.role;
  // Only push for real actions, not background heartbeat saves
  const lastMsg = (state.chatMessages || []).filter(m => !m._deleted).slice(-1)[0];
  if (lastMsg && lastMsg.by === role) {
    _sendPushToPartner(coupleId, role, {
      title: '💬 New message',
      body: lastMsg.text ? lastMsg.text.slice(0, 80) : (lastMsg.mediaUrl ? '📷 Photo' : '🎙️ Voice'),
      icon: '/icons/icon-192.png',
      tag: 'chat-msg',
      url: '/?page=chat'
    }).catch(() => {});
  }
  if (state.touch && state.touch.from === role) {
    _sendPushToPartner(coupleId, role, {
      title: '💓 Touch',
      body: (state.myName || 'Your partner') + ' sent you a touch',
      icon: '/icons/icon-192.png',
      tag: 'touch'
    }).catch(() => {});
  }
  if (state.missYou && state.missYou.from === role) {
    _sendPushToPartner(coupleId, role, {
      title: '💔 Miss You',
      body: (state.myName || 'Your partner') + ' misses you',
      icon: '/icons/icon-192.png',
      tag: 'missyou'
    }).catch(() => {});
  }
  if (state.hug && state.hug.from === role && state.hug.status === 'pending') {
    _sendPushToPartner(coupleId, role, {
      title: '🤗 Virtual Hug',
      body: (state.myName || 'Your partner') + ' sent you a hug!',
      icon: '/icons/icon-192.png',
      tag: 'hug'
    }).catch(() => {});
  }
}
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, savedAt: new Date().toISOString() });
});

// ─── CHAT MESSAGES ─────────────────────────────────────

router.get('/chat/:coupleId', async (req, res) => {
  let query = supabase
    .from('messages')
    .select('*')
    .eq('couple_id', req.params.coupleId)
    .order('created_at', { ascending: true })
    .limit(200);

  if (req.query.since) query = query.gt('created_at', req.query.since);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/chat', async (req, res) => {
  const { coupleId, text, senderRole, mediaUrl, mediaType } = req.body;
  if (!coupleId || (!text && !mediaUrl)) return res.status(400).json({ error: 'Missing data' });

  const { data, error } = await supabase.from('messages').insert({
    couple_id:   coupleId,
    text:        text || '',
    sender_role: senderRole || 'user1',
    media_url:   mediaUrl || null,
    media_type:  mediaType || null,
    created_at:  new Date().toISOString()
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/chat/:messageId', async (req, res) => {
  const { coupleId } = req.body;
  await supabase.from('messages').delete()
    .eq('id', req.params.messageId).eq('couple_id', coupleId);
  return res.json({ ok: true });
});

// ─── EVENTS / CALENDAR ─────────────────────────────────

router.get('/events/:coupleId', async (req, res) => {
  const { data, error } = await supabase
    .from('events').select('*').eq('couple_id', req.params.coupleId)
    .order('date', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/events', async (req, res) => {
  const { coupleId, title, date, time, note, cat } = req.body;
  if (!coupleId || !title || !date) return res.status(400).json({ error: 'Missing data' });
  const { data, error } = await supabase.from('events').insert({
    couple_id: coupleId, title, date,
    time: time || null, note: note || null, cat: cat || 'Other',
    created_at: new Date().toISOString()
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/events/:id', async (req, res) => {
  const { coupleId } = req.body;
  await supabase.from('events').delete()
    .eq('id', req.params.id).eq('couple_id', coupleId);
  return res.json({ ok: true });
});

// ─── BUCKET LIST ───────────────────────────────────────

router.get('/bucket/:coupleId', async (req, res) => {
  const { data, error } = await supabase
    .from('bucket_items').select('*').eq('couple_id', req.params.coupleId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/bucket', async (req, res) => {
  const { coupleId, title, cat, date } = req.body;
  if (!coupleId || !title) return res.status(400).json({ error: 'Missing data' });
  const { data, error } = await supabase.from('bucket_items').insert({
    couple_id: coupleId, title, cat: cat || 'Other',
    target_date: date || null, done: false,
    created_at: new Date().toISOString()
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.patch('/bucket/:id', async (req, res) => {
  const { coupleId, done } = req.body;
  const { data, error } = await supabase.from('bucket_items')
    .update({ done, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).eq('couple_id', coupleId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/bucket/:id', async (req, res) => {
  const { coupleId } = req.body;
  await supabase.from('bucket_items').delete()
    .eq('id', req.params.id).eq('couple_id', coupleId);
  return res.json({ ok: true });
});

// ─── JOURNAL ───────────────────────────────────────────

router.get('/journal/:coupleId', async (req, res) => {
  const { data, error } = await supabase
    .from('journal_entries').select('*').eq('couple_id', req.params.coupleId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/journal', async (req, res) => {
  const { coupleId, body, mood, authorRole } = req.body;
  if (!coupleId || !body) return res.status(400).json({ error: 'Missing data' });
  const { data, error } = await supabase.from('journal_entries').insert({
    couple_id:   coupleId, body, mood: mood || null,
    author_role: authorRole || 'user1',
    date:        new Date().toISOString().slice(0, 10),
    created_at:  new Date().toISOString()
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/journal/:id', async (req, res) => {
  const { coupleId } = req.body;
  await supabase.from('journal_entries').delete()
    .eq('id', req.params.id).eq('couple_id', coupleId);
  return res.json({ ok: true });
});

// ─── HABITS ────────────────────────────────────────────

router.get('/habits/:coupleId', async (req, res) => {
  const { data, error } = await supabase
    .from('habits').select('*').eq('couple_id', req.params.coupleId)
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/habits', async (req, res) => {
  const { coupleId, name, emoji, goal, authorRole } = req.body;
  if (!coupleId || !name) return res.status(400).json({ error: 'Missing data' });
  const { data, error } = await supabase.from('habits').insert({
    couple_id:   coupleId, name, emoji: emoji || '✅',
    goal:        goal || 1, author_role: authorRole || 'user1',
    done_dates:  [], created_at: new Date().toISOString()
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.patch('/habits/:id/toggle', async (req, res) => {
  const { coupleId, date } = req.body;
  const { data: habit } = await supabase.from('habits')
    .select('done_dates').eq('id', req.params.id).eq('couple_id', coupleId).maybeSingle();
  if (!habit) return res.status(404).json({ error: 'Not found' });

  const dates = habit.done_dates || [];
  const updated = dates.includes(date) ? dates.filter(d => d !== date) : [...dates, date];

  const { data, error } = await supabase.from('habits')
    .update({ done_dates: updated }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/habits/:id', async (req, res) => {
  const { coupleId } = req.body;
  await supabase.from('habits').delete()
    .eq('id', req.params.id).eq('couple_id', coupleId);
  return res.json({ ok: true });
});

// ─── NOTES ─────────────────────────────────────────────

router.get('/notes/:coupleId', async (req, res) => {
  const { data, error } = await supabase
    .from('notes').select('*').eq('couple_id', req.params.coupleId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/notes', async (req, res) => {
  const { coupleId, text, authorRole, color } = req.body;
  if (!coupleId || !text) return res.status(400).json({ error: 'Missing data' });
  const { data, error } = await supabase.from('notes').insert({
    couple_id:   coupleId, text, author_role: authorRole || 'user1',
    color:       color || '#FDF2F6', created_at: new Date().toISOString()
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/notes/:id', async (req, res) => {
  const { coupleId } = req.body;
  await supabase.from('notes').delete()
    .eq('id', req.params.id).eq('couple_id', coupleId);
  return res.json({ ok: true });
});

// ─── TRANSACTIONS (Money) ──────────────────────────────

router.get('/transactions/:coupleId', async (req, res) => {
  const { data, error } = await supabase
    .from('transactions').select('*').eq('couple_id', req.params.coupleId)
    .order('date', { ascending: false }).limit(100);
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/transactions', async (req, res) => {
  const { coupleId, type, desc, amt, category, date } = req.body;
  if (!coupleId || !desc || !amt) return res.status(400).json({ error: 'Missing data' });
  const { data, error } = await supabase.from('transactions').insert({
    couple_id: coupleId, type: type || 'expense',
    description: desc, amount: parseFloat(amt),
    category: category || 'Other',
    date: date || new Date().toISOString().slice(0, 10),
    created_at: new Date().toISOString()
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/transactions/:id', async (req, res) => {
  const { coupleId } = req.body;
  await supabase.from('transactions').delete()
    .eq('id', req.params.id).eq('couple_id', coupleId);
  return res.json({ ok: true });
});

// ─── MILESTONES ────────────────────────────────────────

router.get('/milestones/:coupleId', async (req, res) => {
  const { data, error } = await supabase
    .from('milestones').select('*').eq('couple_id', req.params.coupleId)
    .order('date', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/milestones', async (req, res) => {
  const { coupleId, title, date, note } = req.body;
  if (!coupleId || !title || !date) return res.status(400).json({ error: 'Missing data' });
  const { data, error } = await supabase.from('milestones').insert({
    couple_id: coupleId, title, date, note: note || null,
    created_at: new Date().toISOString()
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/milestones/:id', async (req, res) => {
  const { coupleId } = req.body;
  await supabase.from('milestones').delete()
    .eq('id', req.params.id).eq('couple_id', coupleId);
  return res.json({ ok: true });
});

// ─── WELLNESS ──────────────────────────────────────────

router.get('/wellness/:coupleId', async (req, res) => {
  const { data, error } = await supabase
    .from('wellness').select('*').eq('couple_id', req.params.coupleId)
    .gte('date', new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/wellness', async (req, res) => {
  const { coupleId, date, water, sleep, exercise, mood, authorRole } = req.body;
  if (!coupleId || !date) return res.status(400).json({ error: 'Missing data' });
  const { data, error } = await supabase.from('wellness').upsert({
    couple_id:   coupleId, date,
    water:       water || 0, sleep: sleep || 0, exercise: exercise || 0,
    mood:        mood || null, author_role: authorRole || 'user1',
    updated_at:  new Date().toISOString()
  }, { onConflict: 'couple_id,date,author_role' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ─── PROFILE ───────────────────────────────────────────

router.patch('/profile/:coupleId', async (req, res) => {
  const { myBio, partnerBio, user1Avatar, user2Avatar, myName, partnerName, anniversary } = req.body;
  const updates = {};
  if (myName      !== undefined) updates.user1_name   = myName;
  if (partnerName !== undefined) updates.user2_name   = partnerName;
  if (anniversary !== undefined) updates.anniversary  = anniversary;
  if (myBio       !== undefined) updates.user1_bio    = myBio;
  if (partnerBio  !== undefined) updates.user2_bio    = partnerBio;
  if (user1Avatar)               updates.user1_avatar = user1Avatar;
  if (user2Avatar)               updates.user2_avatar = user2Avatar;
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('couples').update(updates).eq('id', req.params.coupleId)
    .select('id, connect_code, user1_name, user2_name, anniversary, user1_bio, user2_bio, user1_avatar, user2_avatar')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

module.exports = router;