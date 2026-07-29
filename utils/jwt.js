// ═══════════════════════════════════════════════════════
//  JWT helpers — access + refresh tokens
// ═══════════════════════════════════════════════════════
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');

const ACCESS_SECRET  = process.env.JWT_ACCESS_SECRET  || process.env.JWT_SECRET || 'dev-access-secret-change-me';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me';

const ACCESS_TTL  = '15m';   // short-lived access token
const REFRESH_TTL_DAYS = 30; // refresh token lifetime

if (!process.env.JWT_ACCESS_SECRET) {
  console.warn('⚠️  JWT_ACCESS_SECRET not set in env — using an insecure dev default. Set it before deploying to production.');
}

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, phone: user.phone_number, coupleId: user.couple_id || null, role: user.role || null },
    ACCESS_SECRET,
    { expiresIn: ACCESS_TTL }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

// Refresh tokens are opaque random strings, hashed before storage —
// the DB never holds a usable token, only its hash (like a password).
function generateRefreshToken() {
  const raw = crypto.randomBytes(48).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  return { raw, hash, expiresAt };
}

function hashRefreshToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  REFRESH_TTL_DAYS
};
