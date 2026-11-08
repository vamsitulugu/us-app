// ═══════════════════════════════════════════════════════
//  routes/cinema.js — Twin Cinema movie-night invites
//
//  The 3D theatre lives in a separate Vercel project (twin-cinemas). This
//  file only manages the INVITE: host opens a session, taps Invite, the
//  partner gets a card (+ push), taps Accept, and both open the cinema with
//  the session id as the private room. Realtime (presence, Start, playback)
//  is handled inside the cinema over Supabase Realtime.
//
//  Identity follows the rest of this app: coupleId + role (user1|user2).
//  Wire up in server.js:  app.use('/api/cinema', require('./routes/cinema'));
// ═══════════════════════════════════════════════════════
const express  = require('express');
const supabase = require('../middleware/supabase');
const router   = express.Router();

let _sendPushToPartner, _sendFCMToPartner;
try { _sendPushToPartner = require('./auth').sendPushToPartner; } catch (_) {}
try { _sendFCMToPartner  = require('./auth').sendFCMToPartner;  } catch (_) {}
let _lib; try { _lib = require('./movie-library'); } catch (_) {}

const CINEMA_URL    = (process.env.CINEMA_URL || 'https://twin-cinemas.vercel.app').replace(/\/+$/, '');
const INVITE_TTL_MS = 10 * 60 * 1000;     // an invite stays open for 10 minutes
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = new Set(['user1', 'user2']);
const other = r => (r === 'user1' ? 'user2' : 'user1');

const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
router.use(noStore);

// The cinema room code is the session id (an unguessable UUID). slot 1 = girl avatar, 2 = boy avatar.
// Everything goes in the URL HASH (never sent to any server / referrer); the cinema strips it after reading.
function cinemaUrl(session, slot, name, coupleId, role, isHost) {
  const q = new URLSearchParams({ s: session.id, r: String(slot), n: name || '', c: coupleId, u: role, h: isHost ? '1' : '0' });
  return `${CINEMA_URL}/#${q.toString()}`;
}

async function loadSession(id, coupleId) {
  if (!UUID_RE.test(String(id || ''))) return { error: 'Invalid session', code: 400 };
  const { data, error } = await supabase.from('cinema_sessions').select('*').eq('id', id).maybeSingle();
  if (error) return { error: error.message, code: 500 };
  if (!data || data.couple_id !== coupleId) return { error: 'Session not found', code: 404 };   // other couples can never see it
  // lazily expire stale invites / old sessions
  const now = Date.now();
  const stale = (data.status === 'invited' && now - new Date(data.invited_at).getTime() > INVITE_TTL_MS)
             || (['lobby', 'invited', 'accepted'].includes(data.status) && now > new Date(data.expires_at).getTime());
  if (stale) {
    await supabase.from('cinema_sessions').update({ status: 'expired' }).eq('id', id);
    data.status = 'expired';
  }
  return { session: data };
}

async function names(coupleId) {
  const { data } = await supabase.from('couples')
    .select('user1_name, user2_name, user1_avatar, user2_avatar').eq('id', coupleId).maybeSingle();
  return data || {};
}

function pushToPartner(coupleId, senderRole, payload) {
  if (_sendPushToPartner) _sendPushToPartner(coupleId, senderRole, payload).catch(() => {});
  if (_sendFCMToPartner)  _sendFCMToPartner(coupleId, senderRole, payload).catch(() => {});
}

// POST /api/cinema/create  { coupleId, role, slot, movie }
// Reuses the host's still-open session so double taps never create duplicates.
router.post('/create', async (req, res) => {
  const { coupleId, role, movie } = req.body || {};
  const slot = Number(req.body && req.body.slot) === 2 ? 2 : 1;
  if (!coupleId || !ROLES.has(role)) return res.status(400).json({ error: 'Missing coupleId/role' });
  if (String(coupleId).indexOf('solo_') === 0) return res.status(400).json({ error: 'Connect your partner first' });
  try {
    const { data: open } = await supabase.from('cinema_sessions').select('*')
      .eq('couple_id', coupleId).eq('host_role', role).in('status', ['lobby', 'invited', 'accepted'])
      .gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1);
    let session = open && open[0];
    if (session) {
      const patch = { host_slot: slot, movie: movie || session.movie || null };
      if (session.status === 'invited' && Date.now() - new Date(session.invited_at).getTime() > INVITE_TTL_MS) patch.status = 'lobby';
      const { data } = await supabase.from('cinema_sessions').update(patch).eq('id', session.id).select().single();
      session = data || session;
    } else {
      const { data, error } = await supabase.from('cinema_sessions')
        .insert({ couple_id: coupleId, host_role: role, host_slot: slot, movie: movie || null }).select().single();
      if (error) return res.status(500).json({ error: error.message });
      session = data;
    }
    const n = await names(coupleId);
    const myName = role === 'user1' ? n.user1_name : n.user2_name;
    return res.json({ session, url: cinemaUrl(session, session.host_slot, myName, coupleId, role, true) });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// POST /api/cinema/:id/invite  { coupleId, role }   host → partner gets a card + push
router.post('/:id/invite', async (req, res) => {
  const { coupleId, role } = req.body || {};
  if (!coupleId || !ROLES.has(role)) return res.status(400).json({ error: 'Missing coupleId/role' });
  const r = await loadSession(req.params.id, coupleId);
  if (r.error) return res.status(r.code).json({ error: r.error });
  const s = r.session;
  if (s.host_role !== role) return res.status(403).json({ error: 'Only the host can invite' });
  if (['started', 'ended'].includes(s.status)) return res.status(409).json({ error: 'Session already ' + s.status });
  // re-inviting after decline / expiry is allowed and simply re-opens the card
  const { data, error } = await supabase.from('cinema_sessions')
    .update({ status: 'invited', invited_at: new Date().toISOString(), expires_at: new Date(Date.now() + 2 * 3600 * 1000).toISOString() })
    .eq('id', s.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  const n = await names(coupleId);
  const hostName = role === 'user1' ? n.user1_name : n.user2_name;
  pushToPartner(coupleId, role, {
    title: '🎬 Movie night invite',
    body: `${hostName || 'Your partner'} is waiting for you in Twin Cinema${s.movie ? ' · ' + s.movie : ''}`,
    icon: '/icons/icon-192.png', tag: 'cinema-invite', renotify: true,
    url: '/?cinema=' + s.id, type: 'cinema_invite',
    senderName: hostName || undefined, senderAvatar: (role === 'user1' ? n.user1_avatar : n.user2_avatar) || undefined
  });
  return res.json({ session: data });
});

// GET /api/cinema/pending/:coupleId?role=user2   → the invite waiting for ME (or null)
router.get('/pending/:coupleId', async (req, res) => {
  const { coupleId } = req.params, role = req.query.role;
  if (!ROLES.has(role)) return res.status(400).json({ error: 'Missing role' });
  const since = new Date(Date.now() - INVITE_TTL_MS).toISOString();
  const { data, error } = await supabase.from('cinema_sessions').select('*')
    .eq('couple_id', coupleId).eq('host_role', other(role)).eq('status', 'invited')
    .gt('invited_at', since).order('invited_at', { ascending: false }).limit(1);
  if (error) return res.status(500).json({ error: error.message });
  const s = data && data[0];
  if (!s) return res.json({ invite: null });
  const n = await names(coupleId);
  return res.json({ invite: {
    id: s.id, movie: s.movie, invitedAt: s.invited_at,
    hostName: (s.host_role === 'user1' ? n.user1_name : n.user2_name) || 'Your partner',
    hostAvatar: (s.host_role === 'user1' ? n.user1_avatar : n.user2_avatar) || null
  } });
});

// GET /api/cinema/:id/movie?coupleId=...&role=user1
// The movie the couple picked on the Watch Together page, so the cinema can play the same one:
//   { mode:'cloud',  title, dur, url }  shared cloud movie → the cinema streams it from a short-lived signed URL
//   { mode:'device', title, dur }       each phone has its own copy → the cinema asks both to choose their file (length must match)
//   { mode:'none' }                     nothing picked (cinema opened from Together) → cinema works as before
router.get('/:id/movie', async (req, res) => {
  const coupleId = req.query.coupleId, role = ROLES.has(req.query.role) ? req.query.role : 'user1';
  const r = await loadSession(req.params.id, coupleId);
  if (r.error) return res.status(r.code).json({ error: r.error });
  try {
    const { data: w } = await supabase.from('watch_sessions').select('*').eq('couple_id', coupleId).maybeSingle();
    if (!w) return res.json({ mode: 'none' });
    const title = w[role + '_movie_title'] || w[other(role) + '_movie_title'] || r.session.movie || '';
    const dur = Number(w[role + '_duration_sec'] || w[other(role) + '_duration_sec']) || 0;
    if (w.shared_movie_id && _lib && _lib.signedPlaybackUrl) {
      const u = await _lib.signedPlaybackUrl(coupleId, w.shared_movie_id).catch(() => null);
      if (u && u.url) return res.json({ mode: 'cloud', title: title || u.title || '', dur: dur || u.durationSec || 0, url: u.url });
    }
    if (dur) return res.json({ mode: 'device', title, dur });
    return res.json({ mode: 'none' });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// GET /api/cinema/:id/library?coupleId=...
// The couple's Twin Hearts movie library (Movie → Library = movie_favorites) for the movie frames in the cinema lobby.
// Same guard as the other cinema calls: the unguessable session id AND the couple id must match.
//   { movies:[{ id, title, year, genre, posterUrl, backdropUrl, overview, rating, status }] }   newest first, max 60
router.get('/:id/library', async (req, res) => {
  const coupleId = req.query.coupleId;
  const r = await loadSession(req.params.id, coupleId);
  if (r.error) return res.status(r.code).json({ error: r.error });
  try {
    const { data, error } = await supabase.from('movie_favorites')
      .select('id, title, year, genre, poster_url, backdrop_url, overview, rating, status, created_at')
      .eq('couple_id', coupleId).order('created_at', { ascending: false }).limit(60);
    if (error) throw error;
    return res.json({ movies: (data || []).map(m => ({
      id: m.id, title: m.title, year: m.year || '', genre: m.genre || '',
      posterUrl: m.poster_url || '', backdropUrl: m.backdrop_url || '',
      overview: m.overview || '', rating: m.rating, status: m.status
    })) });
  } catch (e) { return res.status(500).json({ error: 'Could not load the movie library' }); }
});

// ── Gold Coins at the cinema canteen ───────────────────────────────────────────────────────────────
// Same guard as the other cinema calls (unguessable session id + couple id). The person is the couple's user with that role.
// The server re-prices the order itself (lib/canteen-price.js) and spends the coins through reward_credit(), so a double tap
// (same clientId) never pays twice and nobody can spend more than the wallet holds.
//   GET  /api/cinema/:id/wallet?coupleId=&role=                      → { balance }
//   POST /api/cinema/:id/canteen/order { coupleId, role, clientId, for, lines:[{id,qty,sel}] } → { ok, total, balance } | 402 { code:'insufficient', balance, need }
const { priceOrder } = require('../lib/canteen-price');
async function walletUser(coupleId, role) {
  if (!ROLES.has(role)) return null;
  const { data } = await supabase.from('users').select('id, account_status').eq('couple_id', coupleId).eq('role', role).maybeSingle();
  if (!data || data.account_status === 'suspended' || data.account_status === 'disabled') return null;
  return data;
}
async function balanceOf(userId) {
  const { data } = await supabase.from('reward_wallets').select('balance').eq('user_id', userId).maybeSingle();
  return (data && data.balance) || 0;
}
router.get('/:id/wallet', async (req, res) => {
  const coupleId = String(req.query.coupleId || '');
  const r = await loadSession(req.params.id, coupleId);
  if (r.error) return res.status(r.code).json({ error: r.error });
  try {
    const u = await walletUser(coupleId, req.query.role);
    if (!u) return res.status(403).json({ error: 'Please sign in again.' });
    return res.json({ balance: await balanceOf(u.id) });
  } catch (e) { return res.status(500).json({ error: 'Could not load your Gold Coins' }); }
});
router.post('/:id/canteen/order', async (req, res) => {
  const b = req.body || {}, coupleId = String(b.coupleId || '');
  const r = await loadSession(req.params.id, coupleId);
  if (r.error) return res.status(r.code).json({ error: r.error });
  if (r.session.status === 'expired') return res.status(410).json({ error: 'This cinema session has ended.' });
  const clientId = typeof b.clientId === 'string' ? b.clientId.trim() : '';
  if (!/^[A-Za-z0-9_.:-]{6,80}$/.test(clientId)) return res.status(400).json({ error: 'Missing or invalid data' });
  const priced = priceOrder(b.lines);
  if (!priced.ok) return res.status(400).json({ error: priced.error });
  try {
    const u = await walletUser(coupleId, b.role);
    if (!u) return res.status(403).json({ error: 'Please sign in again.' });
    const idem = 'canteen:' + clientId;
    const { data, error } = await supabase.rpc('reward_credit', {
      p_user: u.id, p_couple: coupleId, p_amount: -priced.total, p_kind: 'canteen_order', p_idem: idem,
      p_meta: { session: req.params.id, for: ['me', 'partner', 'both'].includes(b.for) ? b.for : 'me', lines: priced.lines.map(l => ({ name: l.name, qty: l.qty, unit: l.unit })) }
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!(row && row.applied)) {
      const { data: prior } = await supabase.from('coin_transactions').select('id').eq('user_id', u.id).eq('idem_key', idem).maybeSingle();
      if (!prior) return res.status(402).json({ error: 'Not enough Gold Coins for this order.', code: 'insufficient', balance: row ? row.balance : await balanceOf(u.id), need: priced.total });
      return res.json({ ok: true, duplicate: true, total: priced.total, balance: await balanceOf(u.id) });
    }
    return res.json({ ok: true, total: priced.total, balance: await balanceOf(u.id) });
  } catch (e) {
    console.error('[cinema] canteen order failed:', e.message);
    return res.status(500).json({ error: 'Payment failed. Your coins were not charged. Please try again.' });
  }
});

// GET /api/cinema/:id?coupleId=...   → status (the host polls this to see accepted / declined)
router.get('/:id', async (req, res) => {
  const r = await loadSession(req.params.id, req.query.coupleId);
  if (r.error) return res.status(r.code).json({ error: r.error });
  return res.json({ status: r.session.status, session: r.session });
});

// POST /api/cinema/:id/accept  { coupleId, role }   guest → returns the guest's own cinema URL
router.post('/:id/accept', async (req, res) => {
  const { coupleId, role } = req.body || {};
  if (!coupleId || !ROLES.has(role)) return res.status(400).json({ error: 'Missing coupleId/role' });
  const r = await loadSession(req.params.id, coupleId);
  if (r.error) return res.status(r.code).json({ error: r.error });
  const s = r.session;
  if (s.host_role === role) return res.status(403).json({ error: 'The host cannot accept their own invite' });
  if (s.status === 'expired') return res.status(410).json({ error: 'This invite expired — ask your partner to invite you again' });
  if (s.status === 'declined' || s.status === 'ended') return res.status(409).json({ error: 'This invite is no longer open' });
  if (s.status === 'invited') await supabase.from('cinema_sessions').update({ status: 'accepted' }).eq('id', s.id);
  const n = await names(coupleId);
  const myName = role === 'user1' ? n.user1_name : n.user2_name;
  return res.json({ ok: true, url: cinemaUrl(s, 3 - s.host_slot, myName, coupleId, role, false) });   // guest always gets the OTHER avatar
});

router.post('/:id/decline', async (req, res) => {
  const { coupleId, role } = req.body || {};
  if (!coupleId || !ROLES.has(role)) return res.status(400).json({ error: 'Missing coupleId/role' });
  const r = await loadSession(req.params.id, coupleId);
  if (r.error) return res.status(r.code).json({ error: r.error });
  if (r.session.host_role === role) return res.status(403).json({ error: 'Not your invite to decline' });
  if (r.session.status === 'invited') await supabase.from('cinema_sessions').update({ status: 'declined' }).eq('id', r.session.id);
  return res.json({ ok: true });
});

// POST /api/cinema/:id/status { coupleId, role, status: 'started' | 'ended' }   (best-effort bookkeeping from the cinema/app)
router.post('/:id/status', async (req, res) => {
  const { coupleId, role, status } = req.body || {};
  if (!coupleId || !ROLES.has(role) || !['started', 'ended'].includes(status)) return res.status(400).json({ error: 'Bad request' });
  const r = await loadSession(req.params.id, coupleId);
  if (r.error) return res.status(r.code).json({ error: r.error });
  await supabase.from('cinema_sessions').update({ status }).eq('id', r.session.id);
  return res.json({ ok: true });
});

module.exports = router;
