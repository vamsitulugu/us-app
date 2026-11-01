// ═══════════════════════════════════════════════════════════════
//  middleware/platform.js — which app is calling us?
//  ─────────────────────────────────────────────────────────────
//  Sets req.client = { platform, kind, version }.
//    platform : 'android' | 'web'            (what the admin filters by)
//    kind     : 'android_native' | 'android_capacitor' | 'web'
//    version  : app version string or null
//  New builds send  X-App-Platform / X-App-Version  headers.
//  Older builds are recognised from the User-Agent so they are not lost.
// ═══════════════════════════════════════════════════════════════
const KINDS = ['android_native', 'android_capacitor', 'web'];

function detectClient(req) {
  const h = (n) => String(req.get(n) || '').trim();
  let kind = h('x-app-platform').toLowerCase().replace(/-/g, '_');
  const ua = h('user-agent');

  if (!KINDS.includes(kind)) {
    if (/okhttp/i.test(ua) || /twinhearts/i.test(ua)) kind = 'android_native';
    else if (/Android/i.test(ua) && /;\s*wv\)|Version\/[\d.]+ Chrome/i.test(ua)) kind = 'android_capacitor';
    else kind = 'web';
  }
  const version = h('x-app-version').slice(0, 32) || null;
  return { kind, platform: kind === 'web' ? 'web' : 'android', version };
}

function platformMiddleware(req, res, next) {
  req.client = detectClient(req);
  next();
}

module.exports = platformMiddleware;
module.exports.detectClient = detectClient;
