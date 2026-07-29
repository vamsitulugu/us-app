// ═══════════════════════════════════════════════════════
//  Email Authentication — alternate login + recovery method
//  on the SAME `users` table / JWT system as phone auth.
//  One account, optional phone AND/OR optional verified email.
//  Partner discovery stays phone-only (see routes/auth-phone.js);
//  this file never creates or reads partner/couple data.
// ═══════════════════════════════════════════════════════
const express = require('express');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const { v4: uuid } = require('uuid');
const supabase = require('../middleware/supabase');
const { requireAuth } = require('../middleware/requireAuth');
const { signAccessToken, generateRefreshToken, REFRESH_TTL_DAYS } = require('../utils/jwt');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../utils/mailer');

const router = express.Router();

const TOKEN_TTL_MINUTES = 30;
const APP_URL = process.env.APP_URL || 'https://us-app-av6d.onrender.com';

// ── helpers ─────────────────────────────────────────────
function normalizeEmail(email) {
  if (!email) return null;
  const trimmed = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

function makeToken() {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);
  return { raw, hash, expiresAt };
}
function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function issueTokenPair(user) {
  const accessToken = signAccessToken(user);
  const { raw, hash, expiresAt } = generateRefreshToken();

  const { error } = await supabase.from('refresh_tokens').insert({
    id: uuid(),
    user_id: user.id,
    token_hash: hash,
    expires_at: expiresAt.toISOString()
  });
  if (error) throw new Error('Failed to persist refresh token: ' + error.message);

  return {
    accessToken,
    refreshToken: raw,
    refreshTokenExpiresInDays: REFRESH_TTL_DAYS,
    user: {
      id: user.id,
      email: user.email,
      phoneNumber: user.phone_number || null,
      name: user.name,
      coupleId: user.couple_id || null,
      role: user.role || null
    }
  };
}

async function issueAndSendVerification(userId, email) {
  const { raw, hash, expiresAt } = makeToken();
  const { error } = await supabase.from('email_verifications').insert({
    id: uuid(),
    user_id: userId,
    token_hash: hash,
    purpose: 'verify',
    expires_at: expiresAt.toISOString()
  });
  if (error) throw new Error('Failed to store verification token: ' + error.message);

  const link = `${APP_URL}/verify-email.html?token=${raw}`;
  await sendVerificationEmail(email, link);
}

// ── POST /api/auth-email/signup { email, name, password } ──
router.post('/signup', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { name, password } = req.body;
    if (!email) return res.status(400).json({ error: 'Valid email required' });
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const { data: existing } = await supabase.from('users').select('id, email_verified').eq('email', email).maybeSingle();
    if (existing && existing.email_verified) {
      return res.status(409).json({ error: 'An account with this email already exists. Please log in.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    let userId;

    if (existing) {
      // Re-signup on an unverified email — update and re-send the link.
      userId = existing.id;
      await supabase.from('users').update({ name: name.trim(), password_hash: passwordHash, updated_at: new Date().toISOString() }).eq('id', userId);
    } else {
      userId = uuid();
      const { error } = await supabase.from('users').insert({
        id: userId,
        email,
        name: name.trim(),
        password_hash: passwordHash,
        email_verified: false
      });
      if (error) return res.status(500).json({ error: 'Failed to create account: ' + error.message });
    }

    await issueAndSendVerification(userId, email);
    return res.json({ ok: true, email, verificationSent: true });
  } catch (err) {
    console.error('Email signup error:', err);
    return res.status(500).json({ error: 'Signup failed' });
  }
});

// ── POST /api/auth-email/resend { email } ──────────────
router.post('/resend', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email) return res.status(400).json({ error: 'Valid email required' });

    const { data: user } = await supabase.from('users').select('id, email_verified').eq('email', email).maybeSingle();
    if (!user) return res.status(404).json({ error: 'No account found with this email' });
    if (user.email_verified) return res.status(409).json({ error: 'This email is already verified. Please log in.' });

    await issueAndSendVerification(user.id, email);
    return res.json({ ok: true, verificationSent: true });
  } catch (err) {
    console.error('Resend verification error:', err);
    return res.status(500).json({ error: 'Failed to resend verification link' });
  }
});

// ── POST /api/auth-email/verify { token } ──────────────
// Confirms the email and signs the user in immediately.
router.post('/verify', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token required' });

    const hash = hashToken(token);
    const { data: row, error } = await supabase
      .from('email_verifications').select('*').eq('token_hash', hash).eq('purpose', 'verify').eq('used', false).maybeSingle();
    if (error || !row) return res.status(400).json({ error: 'Invalid or already-used verification link' });
    if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: 'This link has expired. Please request a new one.' });

    const { data: user, error: userErr } = await supabase.from('users').select('*').eq('id', row.user_id).maybeSingle();
    if (userErr || !user) return res.status(404).json({ error: 'Account not found' });

    await supabase.from('email_verifications').update({ used: true }).eq('id', row.id);
    if (!user.email_verified) {
      await supabase.from('users').update({ email_verified: true, updated_at: new Date().toISOString() }).eq('id', user.id);
      user.email_verified = true;
    }

    const tokens = await issueTokenPair(user);
    return res.json(tokens);
  } catch (err) {
    console.error('Verify email error:', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
});

// ── POST /api/auth-email/login { email, password } ─────
router.post('/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const { data: user, error } = await supabase.from('users').select('*').eq('email', email).maybeSingle();
    if (error || !user) return res.status(401).json({ error: 'No account found with this email' });
    if (!user.email_verified) return res.status(403).json({ error: 'Email not verified yet', code: 'EMAIL_NOT_VERIFIED' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Incorrect password' });

    const tokens = await issueTokenPair(user);
    return res.json(tokens);
  } catch (err) {
    console.error('Email login error:', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// ── POST /api/auth-email/forgot-password { email } ─────
// Always returns ok:true regardless of whether the email exists,
// so the endpoint can't be used to enumerate accounts.
router.post('/forgot-password', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email) return res.status(400).json({ error: 'Valid email required' });

    const { data: user } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
    if (user) {
      const { raw, hash, expiresAt } = makeToken();
      const { error } = await supabase.from('email_verifications').insert({
        id: uuid(),
        user_id: user.id,
        token_hash: hash,
        purpose: 'reset',
        expires_at: expiresAt.toISOString()
      });
      if (!error) {
        const link = `${APP_URL}/reset-password.html?token=${raw}`;
        await sendPasswordResetEmail(email, link).catch(e => console.error('Reset email send failed:', e.message));
      }
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({ error: 'Failed to process request' });
  }
});

// ── POST /api/auth-email/reset-password { token, newPassword } ─
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password required' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const hash = hashToken(token);
    const { data: row, error } = await supabase
      .from('email_verifications').select('*').eq('token_hash', hash).eq('purpose', 'reset').eq('used', false).maybeSingle();
    if (error || !row) return res.status(400).json({ error: 'Invalid or already-used reset link' });
    if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: 'This link has expired. Please request a new one.' });

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await supabase.from('users').update({ password_hash: passwordHash, updated_at: new Date().toISOString() }).eq('id', row.user_id);
    await supabase.from('email_verifications').update({ used: true }).eq('id', row.id);
    // Revoke all existing sessions on password reset for security.
    await supabase.from('refresh_tokens').update({ revoked: true }).eq('user_id', row.user_id);

    return res.json({ ok: true });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ error: 'Failed to reset password' });
  }
});

// ── POST /api/auth-email/link { email } (requireAuth) ───
// Lets an already-signed-in (e.g. phone-auth) user attach a
// recovery email to their existing account — same user_id,
// no duplicate account created.
router.post('/link', requireAuth, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email) return res.status(400).json({ error: 'Valid email required' });

    const { data: existing } = await supabase.from('users').select('id, email_verified').eq('email', email).maybeSingle();
    if (existing && existing.email_verified && existing.id !== req.user.id) {
      return res.status(409).json({ error: 'That email is already linked to another account' });
    }

    await supabase.from('users').update({ email, email_verified: false, updated_at: new Date().toISOString() }).eq('id', req.user.id);
    await issueAndSendVerification(req.user.id, email);
    return res.json({ ok: true, verificationSent: true });
  } catch (err) {
    console.error('Link email error:', err);
    return res.status(500).json({ error: 'Failed to link email' });
  }
});

// ── GET /api/auth-email/me (requireAuth) ────────────────
router.get('/me', requireAuth, async (req, res) => {
  const { data: user, error } = await supabase
    .from('users').select('id, email, phone_number, name, couple_id, role, email_verified, phone_verified, created_at').eq('id', req.user.id).maybeSingle();
  if (error || !user) return res.status(404).json({ error: 'Account not found' });
  return res.json(user);
});

module.exports = router;