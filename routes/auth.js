// ═══════════════════════════════════════════════════════
//  Auth Routes — Email/password auth + phone-based partner
//  invitations. The `couples` table remains the shared-data
//  container used by chat/location/tracking/music/etc (all still
//  keyed by couple_id + role) — see routes/partner.js for how a
//  couple row gets created/joined now that there is no connect code.
// ═══════════════════════════════════════════════════════
const express  = require('express');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const rateLimit = require('express-rate-limit');
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
    .select('id, name, email, phone_number, couple_id, role, account_status')
    .eq('id', userId)
    .maybeSingle();

  // Invalid / deleted account — the client is expected to treat this as
  // "session expired" and clear all local auth data for this account.
  if (error || !user) return res.status(401).json({ error: 'Session no longer valid' });

  // Enforced here too (not just at /login) since the app restores an
  // existing session from a locally-stored userId on every startup —
  // an admin suspending/disabling an account must take effect immediately,
  // not just the next time that person happens to type their password in.
  if (user.account_status === 'suspended') {
    return res.status(403).json({ error: 'This account has been suspended. Contact support if you believe this is a mistake.' });
  }
  if (user.account_status === 'disabled') {
    return res.status(403).json({ error: 'This account has been disabled.' });
  }

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
  const t0 = Date.now();
  const tag = payload.tag || '';
  console.log(`[NOTIF-DEBUG][webpush] Stage3 start couple=${coupleId} sender=${senderRole} tag=${tag}`);

  if (!process.env.VAPID_PUBLIC_KEY) {
    console.warn(`[NOTIF-DEBUG][webpush] FAILED HERE: Stage3 — VAPID_PUBLIC_KEY not set in this environment. Web push is entirely disabled. Fix: set VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY in Render env vars.`);
    return;
  }
  const partnerRole = senderRole === 'user1' ? 'user2' : 'user1';
  const { data, error: lookupErr } = await supabase.from('push_subscriptions')
    .select('subscription, updated_at').eq('couple_id', coupleId).eq('role', partnerRole).maybeSingle();

  if (lookupErr) {
    console.error(`[NOTIF-DEBUG][webpush] FAILED HERE: Stage2 — DB lookup errored for couple=${coupleId} role=${partnerRole}:`, lookupErr.message);
    return;
  }
  if (!data) {
    console.warn(`[NOTIF-DEBUG][webpush] FAILED HERE: Stage2 — no push_subscriptions row for couple=${coupleId} role=${partnerRole}. Partner's browser never completed registerPushSubscription(), or it was deleted after a prior 410. Fix: confirm that device has Notification permission=granted and reload it once so registerPushSubscription() re-runs.`);
    return;
  }
  console.log(`[NOTIF-DEBUG][webpush] Stage2 OK — subscription found for couple=${coupleId} role=${partnerRole}, last updated ${data.updated_at}`);

  // Same centralized sender-avatar lookup as sendFCMToPartner below —
  // fills in payload.senderAvatar/senderName from the couples table when
  // the caller hasn't already resolved it, so sw.js's push handler has a
  // photo to use as the browser notification's icon for every
  // notification type (not just chat/call/partner, which already
  // attach it themselves). Best-effort, never blocks the push.
  let webPayload = payload;
  if (!payload.senderAvatar || !payload.senderName) {
    try {
      const { data: couple } = await supabase.from('couples')
        .select('user1_name, user2_name, user1_avatar, user2_avatar').eq('id', coupleId).maybeSingle();
      if (couple) {
        webPayload = {
          ...payload,
          senderName: payload.senderName || (senderRole === 'user1' ? couple.user1_name : couple.user2_name),
          senderAvatar: payload.senderAvatar || (senderRole === 'user1' ? couple.user1_avatar : couple.user2_avatar)
        };
      }
    } catch (_) { /* non-fatal — sw.js falls back to the app icon */ }
  }

  try {
    const sendRes = await webpush.sendNotification(JSON.parse(data.subscription), JSON.stringify(webPayload));
    console.log(`[NOTIF-DEBUG][webpush] Stage4 OK — push provider accepted, statusCode=${sendRes.statusCode} (${Date.now() - t0}ms) couple=${coupleId} role=${partnerRole}`);
  } catch (err) {
    console.error(`[NOTIF-DEBUG][webpush] FAILED HERE: Stage4 — push provider rejected send. statusCode=${err.statusCode} body=${err.body || err.message} couple=${coupleId} role=${partnerRole}`);
    // Subscription expired — remove it
    if (err.statusCode === 410) {
      console.log(`[NOTIF-DEBUG][webpush] subscription gone (410) — deleting stale row for couple=${coupleId} role=${partnerRole}`);
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

  // fcm_tokens has TWO separate unique constraints: (couple_id, role) and
  // user_id (uniq_fcm_tokens_user). Upserting with onConflict:'couple_id,role'
  // only resolves conflicts on that target — if a row with the same user_id
  // already exists under a different couple_id/role (common while testing,
  // or after re-pairing/re-login), Postgres tries to INSERT a new row and
  // hits the OTHER constraint (uniq_fcm_tokens_user) instead, causing a 500
  // and silently leaving this device's token unsaved. Since user_id is the
  // one constraint guaranteed to exist whenever we have it, upsert on that
  // single target and store couple_id/role alongside it.
  if (userId) {
    const { error } = await supabase.from('fcm_tokens').upsert({
      user_id: userId,
      ...(coupleId ? { couple_id: coupleId } : {}),
      ...(role ? { role } : {}),
      token,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (error) return res.status(500).json({ error: error.message });
  } else if (coupleId && role) {
    // No userId available (legacy/older client) — fall back to the
    // couple_id/role target, which is fine as long as no user_id row
    // for the same person already exists.
    const { error } = await supabase.from('fcm_tokens').upsert({
      couple_id: coupleId,
      role,
      token,
      updated_at: new Date().toISOString()
    }, { onConflict: 'couple_id,role' });
    if (error) return res.status(500).json({ error: error.message });
  } else {
    return res.status(400).json({ error: 'Missing fields' });
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

// Remaining per-category channels — must match the constants of the same
// name created natively in MainActivity.java. Every notification tag in
// the app is classified below so it lands on the right Android channel
// (own mute switch, own importance, own vibration) instead of all falling
// into FCM's shared default "Miscellaneous" bucket, which is what was
// happening for everything except Touch and Calls before this.
const MESSAGES_CHANNEL_ID = 'messages_channel_v1';
const PARTNER_CHANNEL_ID = 'partner_requests_channel_v1';
const MEMORIES_CHANNEL_ID = 'memories_channel_v1';
const GAMES_CHANNEL_ID = 'games_channel_v1';
const REMINDERS_CHANNEL_ID = 'reminders_channel_v1';
const SAFETY_CHANNEL_ID = 'safety_channel_v1';
const GENERAL_CHANNEL_ID = 'general_channel_v1';

// Deep-red brand accent used as the notification accent color across
// every channel (small-icon tint on Android 8+, ticker/LED tint on
// older devices) — replaces the old near-black #1a0010, which read as
// "no color" in the status bar and didn't match the black/deep-red
// brand described for this notification system.
const BRAND_ACCENT_COLOR = '#B30000';

// tag -> channelId. Matched by exact tag first, then by prefix for the
// families of tags that share a channel (e.g. every 'home-*' / 'globe-*'
// memory tag, every 'safety-*' alert).
function channelForTag(tag) {
  tag = tag || '';
  if (tag === 'touch') return TOUCH_CHANNEL_ID;
  if (tag === 'incoming-call') return CALLS_CHANNEL_ID;
  if (tag === 'missed-call' || tag === 'chat-msg' || tag === 'missyou' || tag === 'hug') return MESSAGES_CHANNEL_ID;
  if (tag === 'partner-request' || tag === 'partner-accepted' || tag === 'paired' || tag === 'ck-invite') return PARTNER_CHANNEL_ID;
  if (tag.startsWith('safety-')) return SAFETY_CHANNEL_ID;
  if (tag === 'events' || tag === 'reminder' || tag === 'meetplan' || tag === 'meetup-complete') return REMINDERS_CHANNEL_ID;
  if (tag === 'photos' || tag.startsWith('globe-') || tag.startsWith('home-') || tag === 'journal' || tag === 'milestone' || tag === 'capsule') return MEMORIES_CHANNEL_ID;
  if (tag.startsWith('music-') || tag === 'song' || tag === 'karaoke-rec') return GAMES_CHANNEL_ID;
  return GENERAL_CHANNEL_ID;
}
module.exports.channelForTag = channelForTag;

async function sendFCMToPartner(coupleId, senderRole, payload) {
  const t0 = Date.now();
  const tag = payload.tag || '';
  console.log(`[NOTIF-DEBUG][fcm] Stage3 start couple=${coupleId} sender=${senderRole} tag=${tag}`);

  if (!fcmReady) {
    console.warn(`[NOTIF-DEBUG][fcm] FAILED HERE: Stage4 — Firebase Admin never initialized (fcmReady=false). Check FIREBASE_SERVICE_ACCOUNT env var on Render — either missing or failed JSON.parse/cert() at boot (see "Firebase init failed" in earlier logs at server start).`);
    return;
  }
  const partnerRole = senderRole === 'user1' ? 'user2' : 'user1';
  const { data: tokenRow, error: lookupErr } = await supabase.from('fcm_tokens')
    .select('token, updated_at').eq('couple_id', coupleId).eq('role', partnerRole).maybeSingle();

  if (lookupErr) {
    console.error(`[NOTIF-DEBUG][fcm] FAILED HERE: Stage2 — DB lookup errored for couple=${coupleId} role=${partnerRole}:`, lookupErr.message);
    return;
  }
  if (!tokenRow) {
    console.warn(`[NOTIF-DEBUG][fcm] FAILED HERE: Stage2 — no fcm_tokens row for couple=${coupleId} role=${partnerRole}. That device's app never completed setupNativeNotifications()/register-fcm-token, or the token was deleted after a prior "not-registered" error. Fix: open the app on that device once (it re-registers on every login) and re-check this table.`);
    return;
  }
  console.log(`[NOTIF-DEBUG][fcm] Stage2 OK — token found for couple=${coupleId} role=${partnerRole}, last updated ${tokenRow.updated_at}`);

  const isIncomingCall = payload.tag === 'incoming-call';

  // CENTRALIZED sender identity lookup — every notification type in the
  // app funnels through here with (coupleId, senderRole), so this is the
  // single place to resolve "whose avatar goes on the left" instead of
  // duplicating the same couples-table lookup in globe.js/home.js/
  // meetplanner.js/music.js/signal.js/data.js/location.js/tracking.js.
  // Callers that already resolved this themselves (chat.js, call.js) pass
  // it on payload.senderName/senderAvatar and we simply respect that —
  // this only fills the gap for everyone else. Best-effort: a lookup
  // failure here must never block the push itself.
  let senderName = payload.senderName;
  let senderAvatar = payload.senderAvatar;
  if (!senderAvatar || !senderName) {
    try {
      const { data: couple } = await supabase.from('couples')
        .select('user1_name, user2_name, user1_avatar, user2_avatar').eq('id', coupleId).maybeSingle();
      if (couple) {
        if (!senderName) senderName = senderRole === 'user1' ? couple.user1_name : couple.user2_name;
        if (!senderAvatar) senderAvatar = senderRole === 'user1' ? couple.user1_avatar : couple.user2_avatar;
      }
    } catch (_) { /* non-fatal — native side falls back to a plain badge circle */ }
  }

  // Data-only message (no top-level "notification" field): this is what
  // guarantees TwinHeartsMessagingService.onMessageReceived() runs and
  // builds the styled notification every time, even while the app is
  // fully backgrounded/killed. A "notification" field would instead let
  // Android auto-display a plain system notification and skip our
  // service's onMessageReceived() for that message when the app isn't
  // in the foreground. Every string value below becomes a String extra
  // the native action buttons (Accept/Decline/Reply/Mark as Read/…)
  // read directly off the tapped notification's Intent.
  const fcmData = {
    title: payload.title || 'Twin Hearts 💕',
    body: payload.body || '',
    url: payload.url || '/',
    tag: payload.tag || '',
    coupleId: String(coupleId),
    myRole: partnerRole,       // the recipient's own role — needed to send a Reply or mark-as-read as themselves
    senderRole: senderRole,
    ...(senderName ? { senderName } : {}),
    // Sender's profile photo URL — used by TwinHeartsMessagingService to
    // build the left-side circular avatar (+ Twin Hearts badge) shown on
    // every notification type. Falls back cleanly (native side already
    // handles a missing/failed value with a plain badge circle) if absent.
    ...(senderAvatar ? { senderAvatar } : {}),
    ...(isIncomingCall ? { callerRole: senderRole, type: payload.type || (payload.title && payload.title.includes('Video') ? 'video' : 'voice') } : {})
  };
  console.log(`[NOTIF-DEBUG][fcm] Stage3 payload built for couple=${coupleId} role=${partnerRole}: tag=${fcmData.tag} title="${fcmData.title}"`);

  try {
    const messageId = await fcmMessaging.send({
      token: tokenRow.token,
      data: fcmData,
      android: {
        priority: isIncomingCall ? 'high' : undefined,
      }
    });
    console.log(`[NOTIF-DEBUG][fcm] Stage4 OK — Firebase accepted, messageId=${messageId} (${Date.now() - t0}ms) couple=${coupleId} role=${partnerRole}`);
  } catch (err) {
    console.error(`[NOTIF-DEBUG][fcm] FAILED HERE: Stage4 — Firebase rejected send. code=${err.code} message=${err.message} couple=${coupleId} role=${partnerRole}`);
    if (err.code === 'messaging/registration-token-not-registered') {
      console.log(`[NOTIF-DEBUG][fcm] token stale/uninstalled — deleting row for couple=${coupleId} role=${partnerRole}`);
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
        // Data-only, same reasoning as sendFCMToPartner above. Any extra
        // fields the caller put on payload (e.g. requestId/userId for a
        // partner-request push — see routes/partner.js) are passed
        // straight through so the notification's action buttons
        // (Accept/Decline) have what they need without a second lookup.
        const extra = {};
        for (const [k, v] of Object.entries(payload)) {
          if (['title', 'body', 'icon', 'url', 'tag'].includes(k)) continue;
          if (v !== undefined && v !== null) extra[k] = String(v);
        }
        const messageId = await fcmMessaging.send({
          token: data.token,
          data: {
            title: payload.title || 'Twin Hearts 💕',
            body: payload.body || '',
            url: payload.url || '/',
            tag: payload.tag || '',
            ...extra
          }
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
    .select('id, name, email, phone_number, password_hash, couple_id, role, account_status')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();

  if (error || !user) return res.status(401).json({ error: 'No account found with this email.' });

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).json({ error: 'Incorrect password.' });

  // Blocked here (not at signup or anywhere else) so an admin-suspended
  // account fails cleanly at the one place a session actually begins,
  // with a message that doesn't imply the account was deleted.
  if (user.account_status === 'suspended') {
    return res.status(403).json({ error: 'This account has been suspended. Contact support if you believe this is a mistake.' });
  }
  if (user.account_status === 'disabled') {
    return res.status(403).json({ error: 'This account has been disabled.' });
  }

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

// ═══════════════════════════════════════════════════════
//  FORGOT PASSWORD — Email + Phone verification flow.
//  Uses the existing `users` table and the existing
//  reset_token_hash / reset_token_expires columns (same ones the
//  prior email-link flow used) — no schema changes required.
//  Does not touch signup, signin, or partner-connection logic
//  anywhere above.
// ═══════════════════════════════════════════════════════
const RESET_TOKEN_TTL_MINUTES = 10; // reset token is valid for 10 minutes

// Rate limiters — same two limiters as before, reused for the new routes.
const resetRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,                   // 5 identity-verification requests per IP per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a while and try again.' }
});
const resetSubmitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // password-update attempts per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a while and try again.' }
});

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

// ── POST /api/auth/verify-reset-identity ────────────────
// Body: { email, phone }
// Verifies BOTH email and phone number against the same user row.
// Never reveals which field (or whether the account itself) was wrong —
// same generic error either way, exactly like the old flow's
// no-enumeration guarantee.
router.post('/verify-reset-identity', resetRequestLimiter, async (req, res) => {
  const { email, phone } = req.body;
  const GENERIC_ERROR = 'The provided information does not match our records.';

  if (!email || !phone) {
    return res.status(400).json({ error: GENERIC_ERROR });
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  const normalizedPhone = normalizePhone(phone);

  const { data: user, error } = await supabase
    .from('users')
    .select('id')
    .eq('email', normalizedEmail)
    .eq('phone_number', normalizedPhone)
    .maybeSingle();

  if (error) console.error('verify-reset-identity: user lookup error', error);

  // No match, or lookup error: respond identically either way.
  if (error || !user) {
    return res.status(400).json({ error: GENERIC_ERROR });
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000).toISOString();

  // Overwrites any previous token for this user, so old tokens are
  // implicitly invalidated the moment a new one is issued.
  const { error: updateErr } = await supabase
    .from('users')
    .update({ reset_token_hash: tokenHash, reset_token_expires: expiresAt })
    .eq('id', user.id);

  if (updateErr) {
    console.error('verify-reset-identity: failed to store reset token', updateErr);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }

  // Token is returned directly to the client (no email involved) so the
  // SPA can move straight to the Change Password screen. It never touches
  // localStorage — the frontend keeps it in memory only for this step.
  return res.json({ resetToken: rawToken });
});

// ── POST /api/auth/reset-password ───────────────────────
// Body: { token, newPassword }
router.post('/reset-password', resetSubmitLimiter, async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Missing token or new password' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const tokenHash = hashToken(token);
  const { data: user, error } = await supabase
    .from('users')
    .select('id, reset_token_expires')
    .eq('reset_token_hash', tokenHash)
    .maybeSingle();

  if (error || !user || !user.reset_token_expires || new Date(user.reset_token_expires) < new Date()) {
    return res.status(400).json({ error: 'This password reset link has expired.' });
  }

  // Hash exactly like the existing signup/login flow (bcryptjs, cost 10).
  const hashedPassword = await bcrypt.hash(newPassword, 10);

  // Update password AND invalidate the token in the same write so it
  // can never be reused (single-use tokens).
  const { error: updateErr } = await supabase
    .from('users')
    .update({
      password_hash: hashedPassword,
      reset_token_hash: null,
      reset_token_expires: null,
      updated_at: new Date().toISOString()
    })
    .eq('id', user.id);

  if (updateErr) {
    console.error('reset-password: failed to update password', updateErr);
    return res.status(500).json({ error: 'Could not update password. Please try again.' });
  }

  return res.json({ message: 'Password updated' });
});

module.exports = router;