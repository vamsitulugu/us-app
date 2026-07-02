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
    const r = await fetch(`https://us-app.metered.live/api/v1/turn/credentials?apiKey=${key}`);
    const iceServers = await r.json();
    return res.json({ iceServers, turnConfigured: true });
  } catch (e) {
    return res.json({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], turnConfigured: false });
  }
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

module.exports = router;