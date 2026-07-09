// ═══════════════════════════════════════════════════════
//  Signal Routes — small, high-frequency realtime signals
//  (karaoke invites, touch, hug, miss-you) stored in their
//  OWN tiny row, completely separate from app_state so they
//  never trigger a full-blob rewrite of photos/vault/etc.
// ═══════════════════════════════════════════════════════
const express  = require('express');
const supabase = require('../middleware/supabase');
const router   = express.Router();

let _sendPushToPartner;
try { _sendPushToPartner = require('./auth').sendPushToPartner; } catch (_) {}

// GET /api/signal/:coupleId/:key -> returns the stored value (array or object), or [] if none
router.get('/:coupleId/:key', async (req, res) => {
  const { coupleId, key } = req.params;
  const { data, error } = await supabase
    .from('signals')
    .select('value')
    .eq('couple_id', coupleId)
    .eq('key', key)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') return res.status(500).json({ error: error.message });
  return res.json(data ? data.value : []);
});

// POST /api/signal  { coupleId, key, value, senderRole, myName }
// Upserts a single small row keyed by (coupleId, key). Value is a small
// JSON array/object — never the full app state.
router.post('/', async (req, res) => {
  const { coupleId, key, value, senderRole, myName } = req.body;
  if (!coupleId || !key) return res.status(400).json({ error: 'Missing data' });

  const { error } = await supabase.from('signals').upsert({
    couple_id:  coupleId,
    key,
    value:      value ?? [],
    updated_at: new Date().toISOString()
  }, { onConflict: 'couple_id,key' });

  if (error) return res.status(500).json({ error: error.message });

  // Push notification for karaoke invites, same behavior as before
  try {
    if (_sendPushToPartner && key.startsWith('ck_') && Array.isArray(value) && value.length) {
      const last = value[value.length - 1];
      if (last && last.type === 'invite' && last.from === senderRole) {
        _sendPushToPartner(coupleId, senderRole, {
          title: '🎤 Sing Together',
          body: (myName || 'Your partner') + ' invited you to sing "' + (last.songTitle || 'a song') + '"',
          icon: '/icons/icon-192.png',
          tag: 'ck-invite',
          url: '/#music'
        }).catch(() => {});
      }
    }
  } catch (e) { /* notification failure should never break the save */ }

  return res.json({ ok: true, savedAt: new Date().toISOString() });
});

module.exports = router;