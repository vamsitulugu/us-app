// ═══════════════════════════════════════════════════════
//  Phone-Number Authentication (Phase 1 of migration away
//  from Couple Code). Mounted at /api/auth-phone — runs
//  alongside the existing /api/auth (couple-code) routes
//  until the frontend cutover (Phase 3) and cleanup
//  (Phase 4) are complete.
// ═══════════════════════════════════════════════════════
const express  = require('express');
const bcrypt   = require('bcryptjs');
const { v4: uuid } = require('uuid');
const supabase = require('../middleware/supabase');
const { requireAuth } = require('../middleware/requireAuth');
const { signAccessToken, generateRefreshToken, hashRefreshToken, REFRESH_TTL_DAYS } = require('../utils/jwt');
const { OTP_TTL_MINUTES, MAX_ATTEMPTS, generateOtp, hashOtp, verifyOtp, sendOtpSms } = require('../utils/otp');

const router = express.Router();

// ── helpers ─────────────────────────────────────────────
function normalizePhone(phone) {
  if (!phone) return null;
  const trimmed = String(phone).trim();
  // Require E.164-ish format: leading + and 8-15 digits.
  if (!/^\+[1-9]\d{7,14}$/.test(trimmed)) return null;
  return trimmed;
}

async function issueTokenPair(res, user) {
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
      phoneNumber: user.phone_number,
      name: user.name,
      coupleId: user.couple_id || null,
      role: user.role || null
    }
  };
}

// ── POST /api/auth-phone/signup ────────────────────────
// Creates the user record (unverified) and sends a signup OTP.
router.post('/signup', async (req, res) => {
  try {
    const phoneNumber = normalizePhone(req.body.phoneNumber);
    const { name, password } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'Valid phone number required, e.g. +14155551234' });
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const { data: existing } = await supabase.from('users').select('id, phone_verified').eq('phone_number', phoneNumber).maybeSingle();
    if (existing && existing.phone_verified) {
      return res.status(409).json({ error: 'An account with this phone number already exists. Please log in.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    if (existing) {
      // Re-signup attempt on an unverified number — update and re-send OTP.
      await supabase.from('users').update({ name: name.trim(), password_hash: passwordHash, updated_at: new Date().toISOString() }).eq('id', existing.id);
    } else {
      const { error } = await supabase.from('users').insert({
        id: uuid(),
        phone_number: phoneNumber,
        name: name.trim(),
        password_hash: passwordHash,
        phone_verified: false
      });
      if (error) return res.status(500).json({ error: 'Failed to create account: ' + error.message });
    }

    await issueAndSendOtp(phoneNumber, 'signup');
    return res.json({ ok: true, phoneNumber, otpSent: true, expiresInMinutes: OTP_TTL_MINUTES });
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ error: 'Signup failed' });
  }
});

// ── shared OTP issuance ─────────────────────────────────
async function issueAndSendOtp(phoneNumber, purpose) {
  const code = generateOtp();
  const codeHash = await hashOtp(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  const { error } = await supabase.from('otp_verifications').insert({
    id: uuid(),
    phone_number: phoneNumber,
    code_hash: codeHash,
    purpose,
    expires_at: expiresAt.toISOString()
  });
  if (error) throw new Error('Failed to store OTP: ' + error.message);

  await sendOtpSms(phoneNumber, code);
}

// ── POST /api/auth-phone/otp/request ───────────────────
// Requests a fresh OTP for an existing flow (signup resend, or OTP login).
router.post('/otp/request', async (req, res) => {
  try {
    const phoneNumber = normalizePhone(req.body.phoneNumber);
    const purpose = ['signup', 'login', 'reset'].includes(req.body.purpose) ? req.body.purpose : 'login';
    if (!phoneNumber) return res.status(400).json({ error: 'Valid phone number required' });

    const { data: user } = await supabase.from('users').select('id').eq('phone_number', phoneNumber).maybeSingle();
    if (purpose !== 'signup' && !user) {
      return res.status(404).json({ error: 'No account found with this phone number' });
    }

    await issueAndSendOtp(phoneNumber, purpose);
    return res.json({ ok: true, otpSent: true, expiresInMinutes: OTP_TTL_MINUTES });
  } catch (err) {
    console.error('OTP request error:', err);
    return res.status(500).json({ error: 'Failed to send code' });
  }
});

// ── POST /api/auth-phone/verify-otp ────────────────────
// Verifies a code for signup or OTP-login and issues tokens on success.
router.post('/verify-otp', async (req, res) => {
  try {
    const phoneNumber = normalizePhone(req.body.phoneNumber);
    const { code } = req.body;
    const purpose = ['signup', 'login', 'reset'].includes(req.body.purpose) ? req.body.purpose : 'signup';
    if (!phoneNumber || !code) return res.status(400).json({ error: 'Phone number and code required' });

    const { data: otpRow, error } = await supabase
      .from('otp_verifications')
      .select('*')
      .eq('phone_number', phoneNumber)
      .eq('purpose', purpose)
      .eq('verified', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !otpRow) return res.status(400).json({ error: 'No pending verification found. Please request a new code.' });
    if (new Date(otpRow.expires_at) < new Date()) return res.status(400).json({ error: 'Code expired. Please request a new one.' });
    if (otpRow.attempts >= MAX_ATTEMPTS) return res.status(429).json({ error: 'Too many attempts. Please request a new code.' });

    const match = await verifyOtp(String(code), otpRow.code_hash);
    if (!match) {
      await supabase.from('otp_verifications').update({ attempts: otpRow.attempts + 1 }).eq('id', otpRow.id);
      return res.status(401).json({ error: 'Incorrect code' });
    }

    await supabase.from('otp_verifications').update({ verified: true }).eq('id', otpRow.id);

    const { data: user, error: userErr } = await supabase.from('users').select('*').eq('phone_number', phoneNumber).maybeSingle();
    if (userErr || !user) return res.status(404).json({ error: 'Account not found' });

    if (!user.phone_verified) {
      await supabase.from('users').update({ phone_verified: true, updated_at: new Date().toISOString() }).eq('id', user.id);
      user.phone_verified = true;
    }

    const tokens = await issueTokenPair(res, user);
    return res.json(tokens);
  } catch (err) {
    console.error('Verify OTP error:', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
});

// ── POST /api/auth-phone/login ─────────────────────────
// Password login (JWT issued directly, no OTP needed here).
router.post('/login', async (req, res) => {
  try {
    const phoneNumber = normalizePhone(req.body.phoneNumber);
    const { password } = req.body;
    if (!phoneNumber || !password) return res.status(400).json({ error: 'Phone number and password required' });

    const { data: user, error } = await supabase.from('users').select('*').eq('phone_number', phoneNumber).maybeSingle();
    if (error || !user) return res.status(401).json({ error: 'No account found with this phone number' });
    if (!user.phone_verified) return res.status(403).json({ error: 'Phone number not verified yet', code: 'PHONE_NOT_VERIFIED' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Incorrect password' });

    const tokens = await issueTokenPair(res, user);
    return res.json(tokens);
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// ── POST /api/auth-phone/refresh ───────────────────────
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

    // Rotate: revoke the used token, issue a brand new pair.
    await supabase.from('refresh_tokens').update({ revoked: true }).eq('id', tokenRow.id);
    const tokens = await issueTokenPair(res, user);
    return res.json(tokens);
  } catch (err) {
    console.error('Refresh error:', err);
    return res.status(500).json({ error: 'Failed to refresh session' });
  }
});

// ── POST /api/auth-phone/logout ────────────────────────
router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    const hash = hashRefreshToken(refreshToken);
    await supabase.from('refresh_tokens').update({ revoked: true }).eq('token_hash', hash);
  }
  return res.json({ ok: true });
});

// ── GET /api/auth-phone/me ──────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  const { data: user, error } = await supabase.from('users').select('id, phone_number, name, couple_id, role, phone_verified, created_at').eq('id', req.user.id).maybeSingle();
  if (error || !user) return res.status(404).json({ error: 'Account not found' });
  return res.json(user);
});

// ═══════════════════════════════════════════════════════
//  Partner search / invite / accept / decline
//  (replaces the Couple Code "connect code" flow)
// ═══════════════════════════════════════════════════════

// ── GET /api/auth-phone/partner/search?phone=+1... ─────
router.get('/partner/search', requireAuth, async (req, res) => {
  const phoneNumber = normalizePhone(req.query.phone);
  if (!phoneNumber) return res.status(400).json({ error: 'Valid phone number required' });
  if (phoneNumber === req.user.phoneNumber) return res.status(400).json({ error: "That's your own number" });

  const { data: user, error } = await supabase
    .from('users').select('id, name, phone_number, couple_id').eq('phone_number', phoneNumber).eq('phone_verified', true).maybeSingle();

  if (error || !user) return res.status(404).json({ error: 'No verified account found with that phone number' });
  if (user.couple_id) return res.status(409).json({ error: 'That person is already paired with a partner' });

  return res.json({ id: user.id, name: user.name, phoneNumber: user.phone_number });
});

// ── POST /api/auth-phone/partner/invite { targetPhoneNumber } ─
router.post('/partner/invite', requireAuth, async (req, res) => {
  try {
    if (req.user.coupleId) return res.status(409).json({ error: 'You are already paired with a partner' });

    const targetPhone = normalizePhone(req.body.targetPhoneNumber);
    if (!targetPhone) return res.status(400).json({ error: 'Valid target phone number required' });
    if (targetPhone === req.user.phoneNumber) return res.status(400).json({ error: "You can't invite yourself" });

    const { data: target, error: targetErr } = await supabase
      .from('users').select('id, couple_id').eq('phone_number', targetPhone).eq('phone_verified', true).maybeSingle();
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

    return res.json({ ok: true, invitation: invite });
  } catch (err) {
    console.error('Invite error:', err);
    return res.status(500).json({ error: 'Failed to send invitation' });
  }
});

// ── GET /api/auth-phone/partner/invitations ────────────
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

// ── POST /api/auth-phone/partner/invitations/:id/accept ─
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
    // (which key off coupleId) keep working unchanged for phone-auth users.
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

    return res.json({ ok: true, coupleId });
  } catch (err) {
    console.error('Accept invite error:', err);
    return res.status(500).json({ error: 'Failed to accept invitation' });
  }
});

// ── POST /api/auth-phone/partner/invitations/:id/decline ─
router.post('/partner/invitations/:id/decline', requireAuth, async (req, res) => {
  const { data: invite, error } = await supabase
    .from('partner_invitations').select('id').eq('id', req.params.id).eq('target_id', req.user.id).eq('status', 'pending').maybeSingle();
  if (error || !invite) return res.status(404).json({ error: 'Invitation not found' });

  await supabase.from('partner_invitations').update({ status: 'declined', updated_at: new Date().toISOString() }).eq('id', invite.id);
  return res.json({ ok: true });
});

module.exports = router;
