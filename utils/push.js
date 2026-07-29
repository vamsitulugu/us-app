// ═══════════════════════════════════════════════════════
//  Per-user push notifications — used for partner invite /
//  accept / decline events, i.e. before a couple_id exists.
//  (routes/auth.js has its own couple+role-based push/FCM
//  helpers for post-pairing features; this is the pre-pairing
//  equivalent, keyed by user_id instead.)
// ═══════════════════════════════════════════════════════
const supabase = require('../middleware/supabase');
const webpush  = require('web-push');

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:' + (process.env.VAPID_EMAIL || 'admin@usapp.love'),
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// firebase-admin only supports a single initialized app per process —
// routes/auth.js may have already initialized it, so reuse that app
// instead of calling initializeApp() a second time.
let fcmMessaging = null;
function getFcmMessaging() {
  if (fcmMessaging) return fcmMessaging;
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) return null;
  try {
    const { initializeApp, cert, getApps } = require('firebase-admin/app');
    const { getMessaging } = require('firebase-admin/messaging');
    const existing = getApps();
    const app = existing.length
      ? existing[0]
      : initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    fcmMessaging = getMessaging(app);
    return fcmMessaging;
  } catch (e) {
    console.error('Firebase init failed (utils/push.js):', e.message);
    return null;
  }
}

async function saveUserPushSubscription(userId, subscription) {
  return supabase.from('user_push_subscriptions').upsert({
    user_id: userId,
    subscription: JSON.stringify(subscription),
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' });
}

async function saveUserFcmToken(userId, token) {
  return supabase.from('user_fcm_tokens').upsert({
    user_id: userId,
    token,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' });
}

// Sends via whichever channel(s) the user has registered. Never throws —
// notification delivery failures should never fail the calling request
// (an invite/accept/decline must still succeed even if push fails).
async function notifyUser(userId, payload) {
  await Promise.all([
    sendWebPushToUser(userId, payload).catch(err => console.error('Web push failed:', err.message)),
    sendFcmToUser(userId, payload).catch(err => console.error('FCM push failed:', err.message))
  ]);
}

async function sendWebPushToUser(userId, payload) {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  const { data } = await supabase.from('user_push_subscriptions').select('subscription').eq('user_id', userId).maybeSingle();
  if (!data) return;
  try {
    await webpush.sendNotification(JSON.parse(data.subscription), JSON.stringify(payload));
  } catch (err) {
    if (err.statusCode === 410) {
      await supabase.from('user_push_subscriptions').delete().eq('user_id', userId);
    } else {
      throw err;
    }
  }
}

async function sendFcmToUser(userId, payload) {
  const messaging = getFcmMessaging();
  if (!messaging) return;
  const { data } = await supabase.from('user_fcm_tokens').select('token').eq('user_id', userId).maybeSingle();
  if (!data) return;
  try {
    await messaging.send({
      token: data.token,
      notification: { title: payload.title || 'Twin Hearts 💕', body: payload.body || '' },
      android: { notification: { icon: 'ic_stat_notify', color: '#1a0010' } }
    });
  } catch (err) {
    if (err.code === 'messaging/registration-token-not-registered') {
      await supabase.from('user_fcm_tokens').delete().eq('user_id', userId);
    } else {
      throw err;
    }
  }
}

module.exports = { saveUserPushSubscription, saveUserFcmToken, notifyUser };
