// ═══════════════════════════════════════════════════════════════
//  Admin auth routes — login/logout for the Admin Control Center.
//  Deliberately NOT mounted under /api/auth (the normal-user auth
//  routes) — this checks credentials against env vars only, never
//  the `users` table, so there is no path from a normal account to
//  an admin session no matter what values are sent.
// ═══════════════════════════════════════════════════════════════
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { createSessionToken, buildSessionCookie, buildClearCookie, requireAdmin, logAudit } = require('../middleware/adminAuth');

const router = express.Router();

// Same shape as the existing authLimiter in server.js, kept local so
// this file has no dependency on server.js internals — a brute-force
// attempt against the admin login gets shut down hard: 10 tries / 15min / IP.
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Please wait 15 minutes.' }
});

// ── POST /api/admin/auth/login ──────────────────────────────────
router.post('/login', adminLoginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;
  if (!adminEmail || !adminPasswordHash) {
    console.error('[admin-auth] ADMIN_EMAIL / ADMIN_PASSWORD_HASH not configured');
    return res.status(500).json({ error: 'Admin login is not configured' });
  }

  // Normalize case for the email compare only — never for the password.
  const emailMatches = String(email).toLowerCase().trim() === adminEmail.toLowerCase().trim();

  // Always run bcrypt.compare even when the email is already wrong, using
  // the real hash either way — this keeps response timing the same for
  // "wrong email" vs "wrong password" so neither can be distinguished
  // by an attacker measuring response time.
  const passwordMatches = await bcrypt.compare(String(password), adminPasswordHash);

  if (!emailMatches || !passwordMatches) {
    await logAudit(String(email).toLowerCase().trim(), 'admin.login_failed', null, null, {});
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = createSessionToken(adminEmail);
  res.setHeader('Set-Cookie', buildSessionCookie(token));
  await logAudit(adminEmail, 'admin.login', null, null, {});
  return res.json({ ok: true, email: adminEmail });
});

// ── POST /api/admin/auth/logout ─────────────────────────────────
router.post('/logout', requireAdmin, async (req, res) => {
  res.setHeader('Set-Cookie', buildClearCookie());
  await logAudit(req.adminEmail, 'admin.logout', null, null, {});
  return res.json({ ok: true });
});

// ── GET /api/admin/auth/me ──────────────────────────────────────
// Lets the admin frontend check "am I already logged in?" on load
// without re-submitting credentials, and re-validates the cookie
// server-side every time rather than trusting anything cached client-side.
router.get('/me', requireAdmin, (req, res) => {
  res.json({ email: req.adminEmail });
});

module.exports = router;
