// ═══════════════════════════════════════════════════════════════
//  Admin session auth
//  ─────────────────────────────────────────────────────────────
//  Deliberately independent of the app's normal user auth (which has
//  no server-verified session at all — the client just sends a raw
//  userId). Admin sessions are a signed, HttpOnly cookie: the browser
//  never sees or can forge the signature, and every /api/admin/*
//  route re-verifies it server-side via requireAdmin below.
//
//  No new npm dependency: cookies are parsed/built by hand (a couple
//  of lines) instead of pulling in cookie-parser, and the session
//  token is signed with Node's built-in crypto (HMAC-SHA256) instead
//  of adding jsonwebtoken.
// ═══════════════════════════════════════════════════════════════
const crypto = require('crypto');
const supabase = require('./supabase');

const COOKIE_NAME = 'admin_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function getSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) {
    // Fail loudly rather than silently signing with a guessable
    // fallback — an admin auth system with a weak/default secret is
    // worse than one that refuses to start.
    throw new Error('ADMIN_SESSION_SECRET environment variable is not set');
  }
  return secret;
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payloadB64) {
  return crypto.createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');
}

// ── Create a signed session token for a given admin email ─────────
function createSessionToken(email) {
  const payload = { email, exp: Date.now() + SESSION_TTL_MS };
  const payloadB64 = base64url(JSON.stringify(payload));
  const sig = sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

// ── Verify a session token; returns { email } or null ──────────────
function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;

  let expectedSig;
  try {
    expectedSig = sign(payloadB64);
  } catch (e) {
    return null; // secret missing/misconfigured
  }

  // Constant-time comparison to avoid timing side-channels on the signature check.
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
  if (!payload || !payload.email || !payload.exp) return null;
  if (Date.now() > payload.exp) return null; // expired

  return { email: payload.email };
}

// ── Minimal cookie parsing (no cookie-parser dependency) ───────────
function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

// ── Build the Set-Cookie header value for a session token ──────────
function buildSessionCookie(token) {
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  ];
  // Secure requires HTTPS — Render/Vercel are always HTTPS in prod;
  // omitted in non-prod so local http://localhost testing still works.
  if (isProd) parts.push('Secure');
  return parts.join('; ');
}

// ── Build the Set-Cookie header value that clears the session ──────
function buildClearCookie() {
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0'
  ];
  if (isProd) parts.push('Secure');
  return parts.join('; ');
}

// ── Express middleware: blocks the request unless a valid admin
//    session cookie is present. Attaches req.adminEmail on success. ─
function requireAdmin(req, res, next) {
  const cookies = parseCookies(req);
  const session = verifySessionToken(cookies[COOKIE_NAME]);
  if (!session) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  req.adminEmail = session.email;
  next();
}

// ── Shared audit-log writer, used by every admin route file so the
//    logging shape/behavior stays identical everywhere. Best-effort:
//    a logging failure must never break the admin action it describes. ─
async function logAudit(adminEmail, action, targetType, targetId, metadata) {
  try {
    await supabase.from('admin_audit_log').insert({
      admin_email: adminEmail,
      action,
      target_type: targetType || null,
      target_id: targetId ? String(targetId) : null,
      metadata: metadata || {}
    });
  } catch (e) {
    console.error('[admin-audit] failed to write audit log:', e.message);
  }
}

module.exports = {
  COOKIE_NAME,
  createSessionToken,
  verifySessionToken,
  parseCookies,
  buildSessionCookie,
  buildClearCookie,
  requireAdmin,
  logAudit
};
