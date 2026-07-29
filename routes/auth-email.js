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
const { signAccessToken, generateRefreshToken, hashRefreshToken, REFRESH_TTL_DAYS } = require('../utils/jwt');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../utils/mailer');
const { saveUserPushSubscription, saveUserFcmToken, notifyUser } = require('../utils/push');

const router = express.Router();

const TOKEN_TTL_MINUTES = 30;
const APP_URL = process.env.APP_URL || 'https://us-app-av6d.onrender.com';
// Partner discovery is still phone-based (searchable profile field only —
// NOT an auth method). Same normalization rule the old phone-auth module used.
const DEFAULT_COUNTRY_CODE = process.env.DEFAULT_COUNTRY_CODE || '+91';

function normalizePhone(phone) {
  if (!phone) return null;
  let trimmed = String(phone).trim().replace(/[\s\-()]/g, '');
  if (!trimmed) return null;
  if (!trimmed.startsWith('+')) {
    if (!/^\d{6,14}$/.test(trimmed)) return null;
    trimmed = DEFAULT_COUNTRY_CODE + trimmed;
  }
  if (!/^\+[1-9]\d{7,14}$/.test(trimmed)) return null;
  return trimmed;
}

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
    const phoneNumber = normalizePhone(req.body.phoneNumber);
    if (!email) return res.status(400).json({ error: 'Valid email required' });
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (!phoneNumber) return res.status(400).json({ error: 'Valid phone number required' });

    const { data: existing } = await supabase.from('users').select('id, email_verified').eq('email', email).maybeSingle();
    if (existing && existing.email_verified) {
      return res.status(409).json({ error: 'An account with this email already exists. Please log in.' });
    }

    // Phone number is a profile field, not an auth method — but it must
    // stay unique so partner search resolves to exactly one account.
    const { data: phoneOwner } = await supabase.from('users').select('id').eq('phone_number', phoneNumber).maybeSingle();
    if (phoneOwner && (!existing || phoneOwner.id !== existing.id)) {
      return res.status(409).json({ error: 'That phone number is already registered to another account.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    let userId;

    if (existing) {
      // Re-signup on an unverified email — update and re-send the link.
      userId = existing.id;
      await supabase.from('users').update({ name: name.trim(), password_hash: passwordHash, phone_number: phoneNumber, updated_at: new Date().toISOString() }).eq('id', userId);
    } else {
      userId = uuid();
      const { error } = await supabase.from('users').insert({
        id: userId,
        email,
        name: name.trim(),
        password_hash: passwordHash,
        phone_number: phoneNumber,
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

// ── POST /api/auth-email/refresh { refreshToken } ──────
// Rotates the refresh token and issues a new access token.
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

    const hash = hashRefreshToken(refreshToken);
    const { data: tokenRow, error } = await supabase
      .from('refresh_tokens').select('*').eq('token_hash', hash).eq('revoked', false).maybeSingle();

    if (error || !tokenRow) return res.status(401).json({ error: 'Invalid refresh token' });
    if (new Date(tokenRow.expires_at) < new Date()) return res.status(401).json({ error: 'Refresh token expired' });

    const { data: user, error: userErr } = await supabase.from('users').select('*').eq('id', tokenRow.user_id).maybeSingle();
    if (userErr || !user) return res.status(401).json({ error: 'Account not found' });

    await supabase.from('refresh_tokens').update({ revoked: true }).eq('id', tokenRow.id);
    const tokens = await issueTokenPair(user);
    return res.json(tokens);
  } catch (err) {
    console.error('Refresh error:', err);
    return res.status(500).json({ error: 'Failed to refresh session' });
  }
});

// ── POST /api/auth-email/logout { refreshToken } ───────
router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    const hash = hashRefreshToken(refreshToken);
    await supabase.from('refresh_tokens').update({ revoked: true }).eq('token_hash', hash);
  }
  return res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════
//  Per-user push registration — needed so a partner invite /
//  accept / decline notification can reach someone before
//  they have a couple_id.
// ═══════════════════════════════════════════════════════

// ── GET /api/auth-email/push/vapidkey ──────────────────
router.get('/push/vapidkey', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

// ── POST /api/auth-email/push/subscribe { subscription } ─
router.post('/push/subscribe', requireAuth, async (req, res) => {
  const { subscription } = req.body;
  if (!subscription) return res.status(400).json({ error: 'subscription required' });
  const { error } = await saveUserPushSubscription(req.user.id, subscription);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
});

// ── POST /api/auth-email/fcm/register { token } ────────
router.post('/fcm/register', requireAuth, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });
  const { error } = await saveUserFcmToken(req.user.id, token);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════
//  Partner search / invite / accept / decline
//  (moved from routes/auth-phone.js; now gated on
//  email_verified instead of phone_verified — phone number
//  is only a searchable profile field, not an auth method)
// ═══════════════════════════════════════════════════════

// ── GET /api/auth-email/partner/search?phone=+1... ─────
router.get('/partner/search', requireAuth, async (req, res) => {
  const phoneNumber = normalizePhone(req.query.phone);
  if (!phoneNumber) return res.status(400).json({ error: 'Valid phone number required' });

  const { data: me } = await supabase.from('users').select('phone_number').eq('id', req.user.id).maybeSingle();
  if (me && me.phone_number === phoneNumber) return res.status(400).json({ error: "That's your own number" });

  const { data: user, error } = await supabase
    .from('users').select('id, name, phone_number, couple_id').eq('phone_number', phoneNumber).eq('email_verified', true).maybeSingle();

  if (error || !user) return res.status(404).json({ error: 'No verified account found with that phone number' });
  if (user.couple_id) return res.status(409).json({ error: 'That person is already paired with a partner' });

  return res.json({ id: user.id, name: user.name, phoneNumber: user.phone_number });
});

// ── POST /api/auth-email/partner/invite { targetPhoneNumber } ─
router.post('/partner/invite', requireAuth, async (req, res) => {
  try {
    if (req.user.coupleId) return res.status(409).json({ error: 'You are already paired with a partner' });

    const targetPhone = normalizePhone(req.body.targetPhoneNumber);
    if (!targetPhone) return res.status(400).json({ error: 'Valid target phone number required' });

    const { data: me } = await supabase.from('users').select('id, name, phone_number').eq('id', req.user.id).maybeSingle();
    if (me && me.phone_number === targetPhone) return res.status(400).json({ error: "You can't invite yourself" });

    const { data: target, error: targetErr } = await supabase
      .from('users').select('id, couple_id').eq('phone_number', targetPhone).eq('email_verified', true).maybeSingle();
    if (targetErr || !target) return res.status(404).json({ error: 'No verified account found with that phone number' });
    if (target.couple_id) return res.status(409).json({ error: 'That person is already paired' });

    const { data: existingInvite } = await supabase
      .from('partner_invitations').select('id').eq('requester_id', req.user.id).eq('target_id', target.id).eq('status', 'pending').maybeSingle();
    if (existingInvite) return res.status(409).json({ error: 'Invitation already sent and pending' });

    const { data: invite, error } = await supabase.from('partner_invitations').insert({
      id: uuid(),
      requester_id: req.user.id,
      target_id: target.id,
      status: 'pending'
    }).select().single();
    if (error) return res.status(500).json({ error: 'Failed to send invitation: ' + error.message });

    notifyUser(target.id, {
      title: 'Partner request 💌',
      body: `${(me && me.name) || 'Someone'} wants to connect with you on Twin Hearts.`,
      tag: 'partner-invite'
    });

    return res.json({ ok: true, invitation: invite });
  } catch (err) {
    console.error('Invite error:', err);
    return res.status(500).json({ error: 'Failed to send invitation' });
  }
});

// ── GET /api/auth-email/partner/invitations ────────────
// Lists invitations the current user has received (pending) and sent.
router.get('/partner/invitations', requireAuth, async (req, res) => {
  const { data: incoming } = await supabase
    .from('partner_invitations')
    .select('id, status, created_at, requester:requester_id (id, name, phone_number)')
    .eq('target_id', req.user.id).eq('status', 'pending');

  const { data: outgoing } = await supabase
    .from('partner_invitations')
    .select('id, status, created_at, target:target_id (id, name, phone_number)')
    .eq('requester_id', req.user.id).eq('status', 'pending');

  return res.json({ incoming: incoming || [], outgoing: outgoing || [] });
});

// ── POST /api/auth-email/partner/invitations/:id/accept ─
router.post('/partner/invitations/:id/accept', requireAuth, async (req, res) => {
  try {
    const { data: invite, error } = await supabase
      .from('partner_invitations').select('*').eq('id', req.params.id).eq('target_id', req.user.id).eq('status', 'pending').maybeSingle();
    if (error || !invite) return res.status(404).json({ error: 'Invitation not found' });

    const { data: requester, error: reqErr } = await supabase.from('users').select('*').eq('id', invite.requester_id).maybeSingle();
    if (reqErr || !requester) return res.status(404).json({ error: 'Requesting user no longer exists' });
    if (requester.couple_id) return res.status(409).json({ error: 'That person already paired with someone else' });

    const { data: me } = await supabase.from('users').select('*').eq('id', req.user.id).maybeSingle();
    if (me.couple_id) return res.status(409).json({ error: 'You are already paired' });

    // Create a couples row so all the existing app_state/messages/etc
    // (which key off coupleId) keep working unchanged.
    const coupleId = uuid();
    const { error: coupleErr } = await supabase.from('couples').insert({
      id: coupleId,
      connect_code: null,
      user1_name: requester.name,
      user2_name: me.name,
      paired: true,
      created_at: new Date().toISOString()
    });
    if (coupleErr) return res.status(500).json({ error: 'Failed to create couple space: ' + coupleErr.message });

    await supabase.from('users').update({ couple_id: coupleId, role: 'user1', updated_at: new Date().toISOString() }).eq('id', requester.id);
    await supabase.from('users').update({ couple_id: coupleId, role: 'user2', updated_at: new Date().toISOString() }).eq('id', me.id);
    await supabase.from('partner_invitations').update({ status: 'accepted', updated_at: new Date().toISOString() }).eq('id', invite.id);

    // Any other pending invitations either party sent/received become moot.
    await supabase.from('partner_invitations').update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .in('requester_id', [requester.id, me.id]).eq('status', 'pending');
    await supabase.from('partner_invitations').update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .in('target_id', [requester.id, me.id]).eq('status', 'pending');

    notifyUser(requester.id, {
      title: "You're paired! 💕",
      body: `${me.name} accepted your invitation. You're now connected on Twin Hearts.`,
      tag: 'partner-accepted'
    });

    return res.json({ ok: true, coupleId });
  } catch (err) {
    console.error('Accept invite error:', err);
    return res.status(500).json({ error: 'Failed to accept invitation' });
  }
});

// ── POST /api/auth-email/partner/invitations/:id/decline ─
router.post('/partner/invitations/:id/decline', requireAuth, async (req, res) => {
  const { data: invite, error } = await supabase
    .from('partner_invitations').select('id').eq('id', req.params.id).eq('target_id', req.user.id).eq('status', 'pending').maybeSingle();
  if (error || !invite) return res.status(404).json({ error: 'Invitation not found' });

  await supabase.from('partner_invitations').update({ status: 'declined', updated_at: new Date().toISOString() }).eq('id', invite.id);

  notifyUser(invite.requester_id, {
    title: 'Invitation declined',
    body: 'Your partner request was declined.',
    tag: 'partner-declined'
  });

  return res.json({ ok: true });
});

module.exports = router;