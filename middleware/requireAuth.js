// ═══════════════════════════════════════════════════════
//  Session middleware — verifies the JWT access token sent
//  as `Authorization: Bearer <token>` and attaches req.user.
// ═══════════════════════════════════════════════════════
const { verifyAccessToken } = require('../utils/jwt');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing access token' });

  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      phoneNumber: payload.phone,
      coupleId: payload.coupleId,
      role: payload.role
    };
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Access token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid access token' });
  }
}

// Same as requireAuth, but doesn't fail the request if there's no/invalid
// token — just leaves req.user undefined. Useful for routes that behave
// differently for logged-in vs anonymous callers.
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();
  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      phoneNumber: payload.phone,
      coupleId: payload.coupleId,
      role: payload.role
    };
  } catch (_) { /* ignore — treat as anonymous */ }
  return next();
}

module.exports = { requireAuth, optionalAuth };
