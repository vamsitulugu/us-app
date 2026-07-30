// ═══════════════════════════════════════════════════════
//  Auth Routes — Email/password auth + phone-based partner
//  invitations. The `couples` table remains the shared-data
//  container used by chat/location/tracking/music/etc (all still
//  keyed by couple_id + role) — see routes/partner.js for how a
//  couple row gets created/joined now that there is no connect code.
// ═══════════════════════════════════════════════════════
const express  = require('express');
const bcrypt   = require('bcryptjs');
const { v4: uuid } = require('uuid');
const supabase = require('../middleware/supabase');

const router = express.Router();

// Normalizes a phone number to digits-only for consistent lookups/uniqueness.
function normalizePhone(phone) {
  return String(phone || '').replace(/[^\d]/g, '');
}

// ── POST /api/auth/verify-pin ──────────────────────────
router.post('/verify-pin', async (req, res) => {
  const { coupleId, pin } = req.body;
  if (!coupleId || !pin) return res.status(400).json({ error: 'Missing data' });

  const { data: couple } = await supabase
    .from('couples').select('vault_pin').eq('id', coupleId).maybeSingle();

  if (!couple) return res.status(404).json({ error: 'Not found' });

  const match = await bcrypt.compare(String(pin), couple.vault_pin);
  if (!match) return res.status(401).json({ error: 'Wrong PIN' });

  return res.json({ ok: true });
});

// ── POST /api/auth/change-pin ──────────────────────────
router.post('/change-pin', async (req, res) => {
  const { coupleId, currentPin, newPin } = req.body;
  if (!coupleId || !currentPin || !newPin) return res.status(400).json({ error: 'Missing data' });

  const { data: couple } = await supabase
    .from('couples').select('vault_pin').eq('id', coupleId).maybeSingle();
  if (!couple) return res.status(404).json({ error: 'Not found' });

  const match = await bcrypt.compare(String(currentPin), couple.vault_pin);
  if (!match) return res.status(401).json({ error: 'Current PIN is wrong' });

  const hashed = await bcrypt.hash(String(newPin), 10);
  await supabase.from('couples').update({ vault_pin: hashed }).eq('id', coupleId);

  return res.json({ ok: true });
});

// ── GET /api/auth/couple/:id ───────────────────────────
// Used both for profile display and for polling real pairing status
router.get('/couple/:id', async (req, res) => {
  const { data: couple, error } = await supabase
    .from('couples')
    .select('id, user1_name, user2_name, anniversary, paired, created_at')
    .eq('id', req.params.id)
    .maybeSingle();

  if (error || !couple) return res.status(404).json({ error: 'Not found' });
  return res.json(couple);
});

// ── GET /api/auth/session/:userId ──────────────────────
// Lightweight session-restore validator used on app startup / reinstall.
// It does NOT introduce any new auth mechanism — it simply confirms the
// userId remembered on-device still corresponds to a real account, and
// returns the latest user + couple + partner snapshot so the client never
// has to render the dashboard from stale cached data. No schema changes,
// no tokens: this reuses the exact same `users` / `couples` tables and
// fields already used by /login and /register.
router.get('/session/:userId', async (req, res) => {
  const { userId } = req.params;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  const { data: user, error } = await supabase
    .from('users')
    .select('id, name, email, phone_number, couple_id, role')
    .eq('id', userId)
    .maybeSingle();

  // Invalid / deleted account — the client is expected to treat this as
  // "session expired" and clear all local auth data for this account.
  if (error || !user) return res.status(401).json({ error: 'Session no longer valid' });

  let partnerName = 'Partner', anniversary = '', paired = false;
  if (user.couple_id) {
    const { data: couple } = await supabase
      .from('couples').select('user1_name, user2_name, anniversary, paired')
      .eq('id', user.couple_id).maybeSingle();
    if (couple) {
      partnerName = user.role === 'user1' ? couple.user2_name : couple.user1_name;
      anniversary = couple.anniversary || '';
      paired = couple.paired || false;
    }
  }

  return res.json({
    userId: user.id,
    coupleId: user.couple_id,
    myName: user.name,
    email: user.email,
    phoneNumber: user.phone_number,
    partnerName: partnerName || 'Partner',
    anniversary,
    paired,
    role: user.role || 'user1'
  });
});

// ── POST /api/auth/unpair ──────────────────────────────
// Removes the partner relationship ONLY. Never touches
// app_state, messages, photos, journal, transactions, etc —
// all of it stays attached to coupleId untouched.
//
// The requesting user keeps their existing coupleId (and all its
// data). The ex-partner is detached and given a brand-new, empty
// solo couple space so they're never left without one — matching
// what happened automatically at registration before pairing.
router.post('/unpair', async (req, res) => {
  const { coupleId, requestingRole } = req.body;
  if (!coupleId) return res.status(400).json({ error: 'coupleId required' });

  const { data: couple, error: fetchErr } = await supabase
    .from('couples')
    .select('id, paired, user1_name, user2_name')
    .eq('id', coupleId)
    .maybeSingle();

  if (fetchErr || !couple) return res.status(404).json({ error: 'Couple not found' });
  if (!couple.paired) return res.status(409).json({ error: 'No active partner to remove' });

  const otherRole = requestingRole === 'user1' ? 'user2' : 'user1';

  // Give the ex-partner (if they have a user account) a fresh solo couple space
  const { data: otherUser } = await supabase
    .from('users').select('id, name').eq('couple_id', coupleId).eq('role', otherRole).maybeSingle();

  if (otherUser) {
    const newCoupleId = uuid();
    const { error: newCoupleErr } = await supabase.from('couples').insert({
      id: newCoupleId,
      user1_name: otherUser.name,
      user2_name: 'Partner',
      paired: false,
      created_at: new Date().toISOString()
    });
    if (!newCoupleErr) {
      await supabase.from('users').update({
        couple_id: newCoupleId, role: 'user1', updated_at: new Date().toISOString()
      }).eq('id', otherUser.id);
    }
  }

  const { error: updateErr } = await supabase
    .from('couples')
    .update({
      paired: false,
      [otherRole === 'user1' ? 'user1_name' : 'user2_name']: 'Partner',
      updated_at: new Date().toISOString()
    })
    .eq('id', coupleId);

  if (updateErr) return res.status(500).json({ error: updateErr.message });

  return res.json({ ok: true, unpairedBy: requestingRole || null });
});

// ── POST /api/push/subscribe ───────────────────────────
// Saves a Web Push subscription for a device.
// Requires VAPID keys in .env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL
const webpush = require('web-push');
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:' + (process.env.VAPID_EMAIL || 'admin@usapp.love'),
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

router.post('/push/subscribe', async (req, res) => {
  const { coupleId, role, userId, subscription } = req.body;
  if (!subscription || (!coupleId && !userId)) return res.status(400).json({ error: 'Missing fields' });

  // ROOT CAUSE FIX: every user gets a solo `couple_id` at signup (role
  // 'user1'), so this always had coupleId+role and took this branch —
  // meaning `user_id` was NEVER written here. sendPushToUser() (used for
  // partner-invitation pushes, which must reach someone BEFORE they're
  // paired) looks up strictly by user_id, so it always found nothing and
  // silently sent nothing. Storing user_id here too (whenever the caller
  // has it) fixes that without touching the couple_id+role lookup path
  // that chat/calls/touch/etc already rely on.
  if (coupleId && role) {
    const row = {
      couple_id: coupleId,
      role,
      subscription: JSON.stringify(subscription),
      updated_at: new Date().toISOString()
    };
    if (userId) row.user_id = userId;
    const { error } = await supabase.from('push_subscriptions').upsert(row, { onConflict: 'couple_id,role' });
    if (error) return res.status(500).json({ error: error.message });
    // Also upsert the user_id-only row so sendPushToUser's lookup works
    // even if the couple_id+role upsert above didn't have a user_id
    // column to write to (e.g. constraint mismatch on older rows).
    if (userId) {
      // NOTE: supabase-js query builders are thenable (implement .then())
      // but do NOT implement .catch()/.finally() as standalone methods —
      // calling .catch() on one throws a synchronous TypeError. That
      // crashed the whole Node process on every push-token registration
      // that reached this branch, which is why partner requests were
      // intermittently slow: Render was cold-restarting the free
      // instance (30-90s) after each crash, not a partner-request bug.
      try {
        await supabase.from('push_subscriptions').upsert({
          user_id: userId,
          subscription: JSON.stringify(subscription),
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
      } catch (e) { console.error('[push/subscribe] secondary user_id upsert failed:', e.message); }
    }
  } else {
    const { error } = await supabase.from('push_subscriptions').upsert({
      user_id: userId,
      subscription: JSON.stringify(subscription),
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (error) return res.status(500).json({ error: error.message });
  }
  return res.json({ ok: true });
});

router.get('/push/vapidkey', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

// ── Helper: send push to partner ─────────────────────
// Call this from data.js whenever state is saved
// UNCHANGED SIGNATURE — chat.js, call.js, data.js, globe.js, home.js,
// location.js, meetplanner.js, music.js, signal.js, tracking.js all
// depend on this exact (coupleId, senderRole, payload) shape.
async function sendPushToPartner(coupleId, senderRole, payload) {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  const partnerRole = senderRole === 'user1' ? 'user2' : 'user1';
  const { data } = await supabase.from('push_subscriptions')
    .select('subscription').eq('couple_id', coupleId).eq('role', partnerRole).maybeSingle();
  if (!data) return;
  try {
    await webpush.sendNotification(JSON.parse(data.subscription), JSON.stringify(payload));
  } catch (err) {
    // Subscription expired — remove it
    if (err.statusCode === 410) {
      await supabase.from('push_subscriptions').delete()
        .eq('couple_id', coupleId).eq('role', partnerRole);
    }
  }
}

module.exports = router;
module.exports.sendPushToPartner = sendPushToPartner;

// ── FCM (native Android push) ──────────────────────────
const { initializeApp: initFirebaseApp, cert: firebaseCert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
let fcmReady = false;
let fcmMessaging = null;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const firebaseApp = initFirebaseApp({
      credential: firebaseCert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
    });
    fcmMessaging = getMessaging(firebaseApp);
    fcmReady = true;
  } catch (e) {
    console.error('Firebase init failed:', e.message);
  }
}
router.post('/register-fcm-token', async (req, res) => {
  const { coupleId, role, userId, token } = req.body;
  if (!token || (!coupleId && !userId)) return res.status(400).json({ error: 'Missing fields' });

  // Same root-cause fix as /push/subscribe above: store user_id too so
  // sendPushToUser() (partner-invitation pushes) can find this token.
  if (coupleId && role) {
    const row = {
      couple_id: coupleId,
      role,
      token,
      updated_at: new Date().toISOString()
    };
    if (userId) row.user_id = userId;
    const { error } = await supabase.from('fcm_tokens').upsert(row, { onConflict: 'couple_id,role' });
    if (error) return res.status(500).json({ error: error.message });
    if (userId) {
      try {
        await supabase.from('fcm_tokens').upsert({
          user_id: userId,
          token,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
      } catch (e) { console.error('[register-fcm-token] secondary user_id upsert failed:', e.message); }
    }
  } else {
    const { error } = await supabase.from('fcm_tokens').upsert({
      user_id: userId,
      token,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (error) return res.status(500).json({ error: error.message });
  }
  return res.json({ ok: true });
});

// Must match MainActivity.TOUCH_CHANNEL_ID (android/app/src/main/java/com/uswithlove/app/MainActivity.java).
// That channel is created natively with a locked-in 10-second vibration
// pattern — Android ignores per-message vibration once a channel exists,
// so the channel is what actually makes the phone buzz while the app
// is fully closed. The message-level vibrateTimingsMillis below is only
// a fallback for the (pre-Android 8) devices that predate channels.
const TOUCH_CHANNEL_ID = 'touch_channel_v1';

// Must match MainActivity.CALLS_CHANNEL_ID. This channel is created
// natively with RingtoneManager's default ringtone attached and
// IMPORTANCE_HIGH, so an incoming call actually loops the device's real
// ringtone instead of falling into Android's generic default notification
// channel (which only ever plays a short "ding"). Only the initial
// incoming-call alert needs this — a missed-call notice arrives after the
// call is already over, so it stays on the default channel.
const CALLS_CHANNEL_ID = 'calls_channel_v1';

async function sendFCMToPartner(coupleId, senderRole, payload) {
  if (!fcmReady) return;
  const partnerRole = senderRole === 'user1' ? 'user2' : 'user1';
  const { data } = await supabase.from('fcm_tokens')
    .select('token').eq('couple_id', coupleId).eq('role', partnerRole).maybeSingle();
  if (!data) return;
  const isTouch = payload.tag === 'touch';
  const isIncomingCall = payload.tag === 'incoming-call';
  try {
    await fcmMessaging.send({
      token: data.token,
      notification: { title: payload.title || 'Twin Hearts 💕', body: payload.body || '' },
      data: {
        url: payload.url || '/',
        tag: payload.tag || ''
      },
      android: {
        priority: isIncomingCall ? 'high' : undefined,
        notification: {
          icon: 'ic_stat_notify',
          color: '#1a0010',
          ...(isTouch ? {
            channelId: TOUCH_CHANNEL_ID,
            defaultVibrateTimings: false,
            vibrateTimingsMillis: [0, 10000]
          } : {}),
          ...(isIncomingCall ? {
            channelId: CALLS_CHANNEL_ID,
            priority: 'max'
          } : {})
        }
      }
    });
  } catch (err) {
    if (err.code === 'messaging/registration-token-not-registered') {
      await supabase.from('fcm_tokens').delete().eq('couple_id', coupleId).eq('role', partnerRole);
    }
  }
}

module.exports.sendFCMToPartner = sendFCMToPartner;

// ── Helper: send push/FCM to a user directly by user_id ──────────
// Used for partner-invitation notifications, which must reach someone
// BEFORE they have a couple_id/role (i.e. before they're paired).
// ── Helper: send push/FCM to a user directly by user_id ──────────
// Used for partner-invitation notifications, which must reach someone
// BEFORE they have a couple_id/role (i.e. before they're paired).
async function sendPushToUser(userId, payload) {
  const t0 = Date.now();
  const result = { webpush: null, fcm: null };
  console.log(`[push:start] user=${userId} tag=${payload.tag || ''} t=${t0}`);

  if (process.env.VAPID_PUBLIC_KEY) {
    const { data, error: lookupErr } = await supabase
      .from('push_subscriptions').select('subscription, updated_at').eq('user_id', userId).maybeSingle();
    if (lookupErr) {
      console.error(`[push:webpush] user=${userId} token lookup failed:`, lookupErr.message);
    } else if (!data) {
      console.warn(`[push:webpush] user=${userId} no subscription on file — device never registered, or registered before the userId fix (run migration 004)`);
    } else {
      const ageMin = data.updated_at ? Math.round((Date.now() - new Date(data.updated_at).getTime()) / 60000) : null;
      console.log(`[push:webpush] user=${userId} subscription found, last updated ${ageMin}min ago`);
      try {
        const sendRes = await webpush.sendNotification(JSON.parse(data.subscription), JSON.stringify(payload));
        result.webpush = { sent: true, statusCode: sendRes.statusCode };
        console.log(`[push:webpush] user=${userId} sent OK statusCode=${sendRes.statusCode} (${Date.now() - t0}ms)`);
      } catch (err) {
        result.webpush = { sent: false, statusCode: err.statusCode, error: err.body || err.message };
        console.error(`[push:webpush] user=${userId} FAILED statusCode=${err.statusCode} body=${err.body || err.message}`);
        if (err.statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('user_id', userId);
          console.log(`[push:webpush] user=${userId} subscription expired (410) — removed`);
        }
      }
    }
  } else {
    console.warn('[push:webpush] VAPID_PUBLIC_KEY not set — web push disabled entirely');
  }

  if (fcmReady) {
    const { data, error: lookupErr } = await supabase
      .from('fcm_tokens').select('token, updated_at').eq('user_id', userId).maybeSingle();
    if (lookupErr) {
      console.error(`[push:fcm] user=${userId} token lookup failed:`, lookupErr.message);
    } else if (!data) {
      console.warn(`[push:fcm] user=${userId} no FCM token on file — device never registered, or registered before the userId fix (run migration 004)`);
    } else {
      const ageMin = data.updated_at ? Math.round((Date.now() - new Date(data.updated_at).getTime()) / 60000) : null;
      console.log(`[push:fcm] user=${userId} token found, last updated ${ageMin}min ago`);
      try {
        const messageId = await fcmMessaging.send({
          token: data.token,
          notification: { title: payload.title || 'Twin Hearts 💕', body: payload.body || '' }
        });
        result.fcm = { sent: true, messageId };
        console.log(`[push:fcm] user=${userId} sent OK messageId=${messageId} (${Date.now() - t0}ms)`);
      } catch (err) {
        result.fcm = { sent: false, code: err.code, error: err.message };
        console.error(`[push:fcm] user=${userId} FAILED code=${err.code} message=${err.message}`);
        if (err.code === 'messaging/registration-token-not-registered') {
          await supabase.from('fcm_tokens').delete().eq('user_id', userId);
          console.log(`[push:fcm] user=${userId} token stale — removed`);
        }
      }
    }
  } else if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.warn('[push:fcm] FIREBASE_SERVICE_ACCOUNT not set — native push disabled entirely');
  }

  console.log(`[push:done] user=${userId} total=${Date.now() - t0}ms result=${JSON.stringify(result)}`);
  return result;
}
module.exports.sendPushToUser = sendPushToUser;
// ── Realtime broadcast helper (mirrors routes/location.js's pattern) ──
// Stateless Broadcast-over-HTTP: no server-side websocket to maintain.
// Fire-and-forget — if it fails, the existing polling loop still covers
// it, so nothing is ever blocked on this.
async function broadcastEvent(topic, event, payload) {
  try {
    await fetch(`${process.env.SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({ messages: [{ topic, event, payload: payload || {} }] })
    });
  } catch (e) { /* fire-and-forget — polling fallback covers this */ }
}
module.exports.broadcastEvent = broadcastEvent;

module.exports.normalizePhone = normalizePhone;

// ── POST /api/auth/register ────────────────────────────
router.post('/register', async (req, res) => {
  const { email, password, myName, phoneNumber } = req.body;
  if (!email || !password || !myName || !phoneNumber) {
    return res.status(400).json({ error: 'Name, email, password and phone number are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const normalizedPhone = normalizePhone(phoneNumber);
  if (normalizedPhone.length < 7) {
    return res.status(400).json({ error: 'Enter a valid phone number' });
  }

  // Check if email already used
  const { data: existingEmail } = await supabase
    .from('users').select('id').eq('email', normalizedEmail).maybeSingle();
  if (existingEmail) return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });

  // Check if phone already used
  const { data: existingPhone } = await supabase
    .from('users').select('id').eq('phone_number', normalizedPhone).maybeSingle();
  if (existingPhone) return res.status(409).json({ error: 'An account with this phone number already exists.' });

  const hashedPassword = await bcrypt.hash(password, 10);
  const hashedPin = await bcrypt.hash('1234', 10);
  const coupleId = uuid();
  const userId = uuid();

  // Every user gets their own solo couple space at signup — this stays
  // the shared-data container for chat/location/tracking/etc, and
  // becomes the joint space once a partner request is accepted.
  const { error: coupleError } = await supabase.from('couples').insert({
    id: coupleId,
    user1_name: myName,
    user2_name: 'Partner',
    vault_pin: hashedPin,
    paired: false,
    created_at: new Date().toISOString()
  });
  if (coupleError) {
    console.error('Register error (couple):', coupleError);
    return res.status(500).json({ error: 'Failed to create account: ' + coupleError.message });
  }

  const { error: userError } = await supabase.from('users').insert({
    id: userId,
    name: myName,
    email: normalizedEmail,
    password_hash: hashedPassword,
    phone_number: normalizedPhone,
    couple_id: coupleId,
    role: 'user1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
  if (userError) {
    console.error('Register error (user):', userError);
    await supabase.from('couples').delete().eq('id', coupleId); // roll back the orphaned couple row
    return res.status(500).json({ error: 'Failed to create account: ' + userError.message });
  }

  return res.json({
    userId, coupleId, myName, phoneNumber: normalizedPhone,
    partnerName: 'Partner', role: 'user1', paired: false
  });
});

// ── POST /api/auth/login ───────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const { data: user, error } = await supabase
    .from('users')
    .select('id, name, email, phone_number, password_hash, couple_id, role')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();

  if (error || !user) return res.status(401).json({ error: 'No account found with this email.' });

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).json({ error: 'Incorrect password.' });

  let partnerName = 'Partner', anniversary = '', paired = false;
  if (user.couple_id) {
    const { data: couple } = await supabase
      .from('couples').select('user1_name, user2_name, anniversary, paired')
      .eq('id', user.couple_id).maybeSingle();
    if (couple) {
      partnerName = user.role === 'user1' ? couple.user2_name : couple.user1_name;
      anniversary = couple.anniversary || '';
      paired = couple.paired || false;
    }
  }

  return res.json({
    userId: user.id,
    coupleId: user.couple_id,
    myName: user.name,
    email: user.email,
    phoneNumber: user.phone_number,
    partnerName: partnerName || 'Partner',
    anniversary,
    paired,
    role: user.role || 'user1'
  });
});

module.exports = router;