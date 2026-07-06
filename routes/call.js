//routs/call.js

const express = require('express');
const supabase = require('../middleware/supabase');
const router = express.Router();

let _sendPushToPartner;
try { _sendPushToPartner = require('./auth').sendPushToPartner; } catch (_) {}

// GET /api/call/turn-creds — fetch short-lived TURN credentials
router.get('/turn-creds', async (req, res) => {
  try {
    const key = process.env.METERED_API_KEY;
    if (!key) {
      // Fallback to public STUN only — calls will work on same-network / good NAT, may fail cross-network
      return res.json({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        turnConfigured: false
      });
    }
    const r = await fetch(`https://twinhearts.metered.live/api/v1/turn/credentials?apiKey=${key}`);
    const iceServers = await r.json();
    return res.json({ iceServers, turnConfigured: true });
  } catch (e) {
    return res.json({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], turnConfigured: false });
  }
});

// POST /api/call/notify — push an incoming-call alert to the partner
router.post('/notify', async (req, res) => {
  const { coupleId, callerRole, type } = req.body;
  if (!coupleId || !callerRole) return res.status(400).json({ error: 'Missing data' });
  if (_sendPushToPartner) {
    _sendPushToPartner(coupleId, callerRole, {
      title: type === 'video' ? '📹 Incoming video call' : '🎙️ Incoming voice call',
      body: 'Tap to answer',
      icon: '/icons/icon-192.png',
      tag: 'incoming-call',
      renotify: true,
      url: '/?page=chat'
    }).catch(() => {});
  }
  return res.json({ ok: true });
});

// POST /api/call/log — log a call to chat history (missed / ended / duration)
router.post('/log', async (req, res) => {
  const { coupleId, callerRole, type, status, duration } = req.body;
  if (!coupleId || !callerRole) return res.status(400).json({ error: 'Missing data' });

  const icon = type === 'video' ? '📹' : '🎙️';
  let text;
  if (status === 'missed') text = `${icon} Missed ${type} call`;
  else if (status === 'declined') text = `${icon} ${type === 'video' ? 'Video' : 'Voice'} call declined`;
  else if (status === 'ended') {
    const m = Math.floor((duration || 0) / 60), s = (duration || 0) % 60;
    text = `${icon} ${type === 'video' ? 'Video' : 'Voice'} call · ${m}:${String(s).padStart(2, '0')}`;
  } else text = `${icon} ${type} call`;

  const clientId = 'call_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  const { data, error } = await supabase.from('chat_messages').insert({
    couple_id: coupleId, client_id: clientId, sender_role: callerRole,
    type: 'call_log', text, media_meta: { callType: type, status, duration: duration || 0 },
    delivered: true, read: false
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  if (status === 'missed' && _sendPushToPartner) {
    _sendPushToPartner(coupleId, callerRole, {
      title: `${icon} Missed ${type} call`,
      body: 'Tap to call back',
      icon: '/icons/icon-192.png', tag: 'missed-call', url: '/?page=chat'
    }).catch(() => {});
  }
  return res.json(data);
});
router.post('/signal', async (req, res) => {
  const { coupleId, role, payload } = req.body;
  if (!coupleId || !role || !payload) return res.status(400).json({ error: 'Missing data' });
  const { error } = await supabase.from('call_signals').insert({ couple_id: coupleId, role, payload });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
});

// POST /api/call/signal — unchanged, just make sure the table has created_at default now()

router.get('/signal/:coupleId', async (req, res) => {
  const { role, after } = req.query;
  let q = supabase.from('call_signals').select('*')
    .eq('couple_id', req.params.coupleId).eq('role', role);
  if (after) q = q.gt('id', parseInt(after));
  const { data, error } = await q.order('id', { ascending: true }).limit(50);
  if (error) return res.status(500).json({ error: error.message });

  // Discard anything older than 30s — an offer/answer/ice signal has no business
  // being acted on if it's been sitting in the table that long.
  const fresh = (data || []).filter(row => {
    const age = Date.now() - new Date(row.created_at).getTime();
    return age < 30000;
  });

  return res.json(fresh);
});

// Add a cleanup endpoint (or a cron/trigger) to delete old rows so the table doesn't grow forever
router.post('/signal/cleanup', async (req, res) => {
  const cutoff = new Date(Date.now() - 5 * 60000).toISOString();
  await supabase.from('call_signals').delete().lt('created_at', cutoff);
  res.json({ ok: true });
});
module.exports = router;