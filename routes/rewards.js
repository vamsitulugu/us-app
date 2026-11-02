// ════════════════════════════════════════════════════════════════
//  routes/rewards.js — Twin Rewards (Step 1: wallet, daily check-in, streaks)
//    GET  /api/rewards/summary?coupleId=&userId=   balance, streaks, 7-day cycle
//    POST /api/rewards/checkin  { coupleId, userId }   claim today's coins (once a day)
//    GET  /api/rewards/history?coupleId=&userId=&limit=   coin history
//
//  Mount in server.js:  app.use('/api/rewards', require('./routes/rewards'));
//
//  Rules: the apps never send an amount. The server decides every reward,
//  counts days in India time, and changes coins only through reward_credit().
//  Same sign-in check as Pro: x-user-id (or userId) must belong to the couple.
// ════════════════════════════════════════════════════════════════
const express = require('express');
const supabase = require('../middleware/supabase');
const { loadMember } = require('../middleware/pro');

const router = express.Router();

// Defaults. A row in reward_config (key 'checkin_cycle') overrides them, so prizes can be tuned without a release.
const DEFAULT_CYCLE = [10, 10, 15, 15, 20, 25, 50]; // coins for day 1..7, then it repeats

async function getCycle() {
  try {
    const { data } = await supabase.from('reward_config').select('value').eq('key', 'checkin_cycle').maybeSingle();
    const v = data && data.value;
    if (Array.isArray(v) && v.length === 7 && v.every(n => Number.isInteger(n) && n >= 0 && n <= 1000)) return v;
  } catch (_) {}
  return DEFAULT_CYCLE;
}

// ── India calendar day helpers (YYYY-MM-DD) ───────────────────────
function istDay(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function prevDay(d) { return new Date(Date.parse(d + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10); }

/**
 * Consecutive-day streak. `daysDesc` = claimed days, newest first.
 * A streak is still alive if the newest day is today OR yesterday (today not claimed yet).
 */
function streakFromDays(daysDesc, today) {
  if (!daysDesc.length) return { current: 0, claimedToday: false };
  const claimedToday = daysDesc[0] === today;
  let expect = claimedToday ? today : prevDay(today);
  if (daysDesc[0] !== expect) return { current: 0, claimedToday: false };
  let n = 0;
  for (const d of daysDesc) {
    if (d === expect) { n++; expect = prevDay(expect); } else if (d < expect) break;
  }
  return { current: n, claimedToday };
}

async function member(req, res, coupleId) {
  if (!coupleId) { res.status(400).json({ error: 'coupleId required' }); return null; }
  const user = await loadMember(req, coupleId);
  if (!user) { res.status(403).json({ error: 'Please sign in again.' }); return null; }
  return user;
}

// Defaults for Step 3: Spin & Win and Scratch cards
const DEFAULT_SLICES = [
  { index: 0, coins: 10, label: '10 Coins', emoji: '🪙', color: '#F59E0B', weight: 30 },
  { index: 1, coins: 25, label: '25 Coins', emoji: '✨', color: '#EC4899', weight: 20 },
  { index: 2, coins: 15, label: '15 Coins', emoji: '🪙', color: '#8B5CF6', weight: 25 },
  { index: 3, coins: 50, label: '50 Coins', emoji: '🎉', color: '#10B981', weight: 10 },
  { index: 4, coins: 20, label: '20 Coins', emoji: '🪙', color: '#3B82F6', weight: 25 },
  { index: 5, coins: 100, label: '100 Coins', emoji: '💎', color: '#F43F5E', weight: 5 },
  { index: 6, coins: 15, label: '15 Coins', emoji: '🪙', color: '#06B6D4', weight: 20 },
  { index: 7, coins: 30, label: '30 Coins', emoji: '🌟', color: '#EAB308', weight: 15 },
];

const DEFAULT_SCRATCH_PRIZES = [
  { id: 'fortune_1', coins: 15, title: 'Sweet Whispers', message: 'Send a voice note telling them your favorite memory together 💕', emoji: '💌', weight: 25 },
  { id: 'fortune_2', coins: 20, title: 'Warm Embrace', message: 'A surprise hug is due! Redeem it next time you meet 🤗', emoji: '🫂', weight: 25 },
  { id: 'fortune_3', coins: 25, title: 'Cupid\u2019s Secret', message: 'Ask your partner one question you\u2019ve never asked before 💘', emoji: '🏹', weight: 20 },
  { id: 'fortune_4', coins: 35, title: 'Date Night Spark', message: 'Pick a movie or song together tonight 🍿', emoji: '🎬', weight: 15 },
  { id: 'fortune_5', coins: 50, title: 'Golden Fortune', message: 'You two are meant to be! Double love points today ✨', emoji: '💖', weight: 10 },
  { id: 'fortune_6', coins: 100, title: 'Twin Jackpot', message: 'Mega luck! Your love is unmatched! 💍', emoji: '👑', weight: 5 },
];

function pickWeighted(items) {
  const total = items.reduce((sum, item) => sum + (item.weight || 1), 0);
  let r = Math.random() * total;
  for (const item of items) {
    const w = item.weight || 1;
    if (r < w) return item;
    r -= w;
  }
  return items[0];
}

async function getSlices() {
  try {
    const { data } = await supabase.from('reward_config').select('value').eq('key', 'spin_slices').maybeSingle();
    if (data && Array.isArray(data.value) && data.value.length === 8) return data.value;
  } catch (_) {}
  return DEFAULT_SLICES;
}

async function getScratchPrizes() {
  try {
    const { data } = await supabase.from('reward_config').select('value').eq('key', 'scratch_prizes').maybeSingle();
    if (data && Array.isArray(data.value) && data.value.length > 0) return data.value;
  } catch (_) {}
  return DEFAULT_SCRATCH_PRIZES;
}

async function buildSummary(user, coupleId, today = istDay(0)) {
  const since = new Date(Date.parse(today + 'T00:00:00Z') - 70 * 86400000).toISOString().slice(0, 10);
  const [wallet, mine, couple, cycle, spinsToday, scratchesToday, slices] = await Promise.all([
    supabase.from('reward_wallets').select('balance, lifetime_earned').eq('user_id', user.id).maybeSingle(),
    supabase.from('reward_checkins').select('day, streak').eq('user_id', user.id).gte('day', since).order('day', { ascending: false }),
    supabase.from('reward_checkins').select('user_id, day').eq('couple_id', String(coupleId)).gte('day', since).order('day', { ascending: false }),
    getCycle(),
    supabase.from('reward_spins').select('slice_index, coins').eq('user_id', user.id).eq('day', today),
    supabase.from('reward_scratches').select('prize_id, coins').eq('user_id', user.id).eq('day', today),
    getSlices(),
  ]);
  if (mine.error) throw mine.error;
  if (couple.error) throw couple.error;

  const { current, claimedToday } = streakFromDays((mine.data || []).map(r => r.day), today);

  // Couple streak: days when BOTH partners checked in.
  const byDay = new Map();
  for (const r of couple.data || []) { if (!byDay.has(r.day)) byDay.set(r.day, new Set()); byDay.get(r.day).add(r.user_id); }
  const bothDays = [...byDay.entries()].filter(([, s]) => s.size >= 2).map(([d]) => d).sort().reverse();
  const cs = streakFromDays(bothDays, today);
  const partnerToday = [...(byDay.get(today) || [])].some(id => id !== user.id);

  // Position in the 7-day cycle = the box being claimed next.
  const nextStreak = claimedToday ? current : current + 1;
  const pos = ((nextStreak - 1) % 7) + 1;           // 1..7
  const doneInCycle = claimedToday ? pos : pos - 1; // boxes already ticked

  const spunToday = !!(spinsToday.data && spinsToday.data.length > 0);
  const scratchedToday = !!(scratchesToday.data && scratchesToday.data.length > 0);

  return {
    balance: (wallet.data && wallet.data.balance) || 0,
    lifetimeEarned: (wallet.data && wallet.data.lifetime_earned) || 0,
    streak: current,
    checkedInToday: claimedToday,
    todayCoins: cycle[pos - 1],
    cyclePosition: pos,
    cycle: cycle.map((coins, i) => ({ day: i + 1, coins, done: i < doneInCycle, today: i + 1 === pos && !claimedToday })),
    coupleStreak: cs.current,
    coupleDoneToday: cs.claimedToday,
    partnerCheckedInToday: partnerToday,
    spinsAvailable: spunToday ? 0 : 1,
    spunToday,
    scratchesAvailable: scratchedToday ? 0 : 1,
    scratchedToday,
    wheelSlices: slices,
    today,
  };
}

// ── GET /summary ───────────────────────────────────────────────────
router.get('/summary', async (req, res) => {
  try {
    const coupleId = req.query.coupleId;
    const user = await member(req, res, coupleId); if (!user) return;
    res.json(await buildSummary(user, coupleId));
  } catch (e) {
    console.error('[rewards] summary failed:', e.message);
    res.status(500).json({ error: 'Could not load rewards. Please try again.' });
  }
});

// ── POST /checkin ──────────────────────────────────────────────────
router.post('/checkin', async (req, res) => {
  try {
    const coupleId = req.body && req.body.coupleId;
    const user = await member(req, res, coupleId); if (!user) return;
    const today = istDay(0);

    const before = await buildSummary(user, coupleId, today);
    if (before.checkedInToday) return res.json({ ...before, claimed: false, earned: 0 });

    const streak = before.streak + 1;
    const coins = before.todayCoins;

    // The key is per user + day, so a double tap or a retry can never pay twice.
    const { data: credit, error: cErr } = await supabase.rpc('reward_credit', {
      p_user: user.id, p_couple: String(coupleId), p_amount: coins,
      p_kind: 'checkin', p_idem: 'checkin:' + today, p_meta: { streak, cycleDay: before.cyclePosition },
    });
    if (cErr) throw cErr;
    const row = Array.isArray(credit) ? credit[0] : credit;
    const applied = !!(row && row.applied);

    // Record the day even if a previous attempt paid but failed to log it (keeps streaks right).
    const { error: iErr } = await supabase.from('reward_checkins')
      .upsert({ user_id: user.id, couple_id: String(coupleId), day: today, streak, coins }, { onConflict: 'user_id,day' });
    if (iErr) throw iErr;

    const after = await buildSummary(user, coupleId, today);
    res.json({ ...after, claimed: applied, earned: applied ? coins : 0 });
  } catch (e) {
    console.error('[rewards] checkin failed:', e.message);
    res.status(500).json({ error: 'Could not claim your reward. Please try again.' });
  }
});

// ── GET /history ───────────────────────────────────────────────────
router.get('/history', async (req, res) => {
  try {
    const coupleId = req.query.coupleId;
    const user = await member(req, res, coupleId); if (!user) return;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
    const { data, error } = await supabase.from('coin_transactions')
      .select('id, amount, kind, meta, created_at').eq('user_id', user.id)
      .order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    res.json({ items: data || [] });
  } catch (e) {
    console.error('[rewards] history failed:', e.message);
    res.status(500).json({ error: 'Could not load history.' });
  }
});

// ════════════════════════════════════════════════════════════════
//  STEP 2 — GIFT SHOP
//  Coins buy a gift. The gift lands in the partner's chat as a normal
//  chat message (type 'gift'), with a full-screen effect and a push.
//  The price always comes from this server catalog, never from the app.
// ════════════════════════════════════════════════════════════════

// Default catalog. A reward_config row (key 'gift_catalog', a JSON array of the same shape) overrides it,
// so prices can be changed — or gifts switched off with "enabled": false — without releasing an app.
// effect must be one of the chat effects both apps already play: confetti | hearts | balloons.
const DEFAULT_GIFTS = [
  { id: 'kiss',      name: 'Sweet Kiss',    emoji: '😘', price: 5,   effect: 'hearts',   tier: 'sweet',   blurb: 'A little kiss' },
  { id: 'chocolate', name: 'Chocolate',     emoji: '🍫', price: 10,  effect: 'hearts',   tier: 'sweet',   blurb: 'Something sweet' },
  { id: 'rose',      name: 'Rose',          emoji: '🌹', price: 20,  effect: 'hearts',   tier: 'special', blurb: 'Classic and romantic' },
  { id: 'balloons',  name: 'Balloons',      emoji: '🎈', price: 25,  effect: 'balloons', tier: 'special', blurb: 'Make them smile' },
  { id: 'teddy',     name: 'Teddy Bear',    emoji: '🧸', price: 30,  effect: 'hearts',   tier: 'special', blurb: 'A cuddly hug' },
  { id: 'bouquet',   name: 'Rose Bouquet',  emoji: '💐', price: 40,  effect: 'hearts',   tier: 'special', blurb: 'A whole bunch of love' },
  { id: 'cake',      name: 'Birthday Cake', emoji: '🎂', price: 40,  effect: 'confetti', tier: 'special', blurb: 'Let\u2019s celebrate' },
  { id: 'magicheart',name: 'Magic Heart',   emoji: '💝', price: 50,  effect: 'hearts',   tier: 'premium', blurb: 'A special heart animation' },
  { id: 'surprise',  name: 'Surprise Box',  emoji: '🎁', price: 60,  effect: 'confetti', tier: 'premium', blurb: 'Open it together' },
  { id: 'ring',      name: 'Diamond Ring',  emoji: '💍', price: 100, effect: 'confetti', tier: 'premium', blurb: 'For a big moment' },
];
const GIFT_EFFECTS = new Set(['confetti', 'hearts', 'balloons']);
const GIFT_TIERS = new Set(['sweet', 'special', 'premium']);

function cleanGift(g) {
  if (!g || typeof g !== 'object') return null;
  const id = typeof g.id === 'string' && /^[a-z0-9_-]{1,32}$/.test(g.id) ? g.id : null;
  const name = typeof g.name === 'string' ? g.name.trim().slice(0, 40) : '';
  const emoji = typeof g.emoji === 'string' ? g.emoji.trim().slice(0, 16) : '';
  const price = Number.isInteger(g.price) ? g.price : -1;
  if (!id || !name || !emoji || price < 1 || price > 5000) return null;
  if (g.enabled === false) return null;
  return {
    id, name, emoji, price,
    effect: GIFT_EFFECTS.has(g.effect) ? g.effect : 'hearts',
    tier: GIFT_TIERS.has(g.tier) ? g.tier : 'special',
    blurb: typeof g.blurb === 'string' ? g.blurb.slice(0, 60) : '',
  };
}

async function getGifts() {
  try {
    const { data } = await supabase.from('reward_config').select('value').eq('key', 'gift_catalog').maybeSingle();
    if (data && Array.isArray(data.value)) {
      const list = data.value.map(cleanGift).filter(Boolean);
      if (list.length) return list;
    }
  } catch (_) {}
  return DEFAULT_GIFTS.map(cleanGift).filter(Boolean);
}

async function walletBalance(userId) {
  const { data } = await supabase.from('reward_wallets').select('balance').eq('user_id', userId).maybeSingle();
  return (data && data.balance) || 0;
}

// ── GET /gifts ─────────────────────────────────────────────────────
router.get('/gifts', async (req, res) => {
  try {
    const coupleId = req.query.coupleId;
    const user = await member(req, res, coupleId); if (!user) return;
    const [gifts, balance] = await Promise.all([getGifts(), walletBalance(user.id)]);
    res.json({ balance, gifts });
  } catch (e) {
    console.error('[rewards] gifts failed:', e.message);
    res.status(500).json({ error: 'Could not load the Gift Shop. Please try again.' });
  }
});

// ── POST /gift ─────────────────────────────────────────────────────
router.post('/gift', async (req, res) => {
  const body = req.body || {};
  try {
    const coupleId = body.coupleId;
    const user = await member(req, res, coupleId); if (!user) return;

    const giftId = typeof body.giftId === 'string' ? body.giftId : '';
    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
    if (!giftId || !/^[A-Za-z0-9_.:-]{6,80}$/.test(clientId)) return res.status(400).json({ error: 'Missing data' });

    const gift = (await getGifts()).find(g => g.id === giftId);
    if (!gift) return res.status(404).json({ error: 'That gift is not available right now.' });

    // Who am I, and is my partner paired? (a gift needs somebody to receive it)
    const [{ data: me }, { data: couple }] = await Promise.all([
      supabase.from('users').select('role, name').eq('id', user.id).maybeSingle(),
      supabase.from('couples').select('paired, user1_name, user2_name, user1_avatar, user2_avatar').eq('id', coupleId).maybeSingle(),
    ]);
    const role = me && me.role === 'user2' ? 'user2' : 'user1';
    if (!couple || couple.paired === false) return res.status(409).json({ error: 'Pair with your partner first, then you can send gifts.' });
    const partnerName = (role === 'user1' ? couple.user2_name : couple.user1_name) || 'your partner';
    const myName = (role === 'user1' ? couple.user1_name : couple.user2_name) || (me && me.name) || 'Your partner';

    // 1) Spend the coins. The key is per gift tap, so a retry / double tap can never charge twice.
    const idem = 'gift:' + clientId;
    const { data: spent, error: sErr } = await supabase.rpc('reward_credit', {
      p_user: user.id, p_couple: String(coupleId), p_amount: -gift.price,
      p_kind: 'gift', p_idem: idem, p_meta: { giftId: gift.id, name: gift.name, emoji: gift.emoji },
    });
    if (sErr) throw sErr;
    const row = Array.isArray(spent) ? spent[0] : spent;
    let alreadyPaid = false;
    if (!(row && row.applied)) {
      // Either the wallet is too small, or this same tap was already paid (a retry after a lost answer).
      const { data: prior } = await supabase.from('coin_transactions').select('id').eq('user_id', user.id).eq('idem_key', idem).maybeSingle();
      if (!prior) {
        const balance = row ? row.balance : await walletBalance(user.id);
        return res.status(402).json({ error: 'Not enough Gold Coins for this gift.', code: 'insufficient', balance, need: gift.price });
      }
      alreadyPaid = true;
    }

    // 2) Put the gift in the chat. Same client_id → the same row (a retry never sends it twice).
    const msg = {
      couple_id: String(coupleId), client_id: clientId, sender_role: role, type: 'gift',
      text: null, media_url: null,
      media_meta: { emoji: gift.emoji, name: gift.name, giftId: gift.id, tier: gift.tier, price: gift.price, paid: true },
      reply_to: null, forwarded: false, delivered: false, read: false, view_once: false, effect: gift.effect,
    };
    const { data: saved, error: mErr } = await supabase.from('chat_messages')
      .upsert(msg, { onConflict: 'couple_id,client_id' }).select().single();
    if (mErr || !saved) {
      // The gift never reached the chat → give the coins back (once).
      if (!alreadyPaid) {
        try {
          await supabase.rpc('reward_credit', {
            p_user: user.id, p_couple: String(coupleId), p_amount: gift.price,
            p_kind: 'gift_refund', p_idem: 'gift-refund:' + clientId, p_meta: { giftId: gift.id },
          });
        } catch (rErr) { console.error('[rewards] gift refund failed:', rErr.message); }
      }
      throw mErr || new Error('chat insert failed');
    }

    // 3) Log it (stats / abuse checks). Never blocks the gift.
    supabase.from('gifts_sent').upsert({
      couple_id: String(coupleId), sender_id: user.id, sender_role: role, gift_id: gift.id,
      price: gift.price, message_id: saved.id, client_id: clientId,
    }, { onConflict: 'sender_id,client_id', ignoreDuplicates: true })
      .then(({ error }) => { if (error) console.error('[rewards] gifts_sent log failed:', error.message); });

    // 4) Tell the partner: live message + push (the push is skipped if they are already looking at the chat).
    if (!alreadyPaid) notifyGift({ coupleId, role, myName, gift, avatar: role === 'user1' ? couple.user1_avatar : couple.user2_avatar });

    const balance = await walletBalance(user.id);
    res.json({ ok: true, duplicate: alreadyPaid, message: saved, gift, balance, partnerName });
  } catch (e) {
    console.error('[rewards] gift failed:', e.message);
    res.status(500).json({ error: 'Could not send the gift. Your coins were not charged. Please try again.' });
  }
});

function notifyGift({ coupleId, role, myName, gift, avatar }) {
  try {
    const receiverRole = role === 'user1' ? 'user2' : 'user1';
    let viewing = false;
    try { viewing = require('./presence').isViewingChat(coupleId, receiverRole); } catch (_) {}
    if (viewing) return;
    const auth = require('./auth');
    const payload = {
      title: '🎁 ' + myName,
      body: gift.emoji + ' ' + myName + ' sent you ' + gift.name,
      icon: '/icons/icon-192.png',
      tag: 'chat-msg',          // same channel / tap target as a chat message
      url: '/?page=chat',
      senderName: myName || undefined,
      senderAvatar: avatar || undefined,
    };
    if (auth.sendPushToPartner) auth.sendPushToPartner(coupleId, role, payload).catch(err => console.error('[rewards] web push failed:', err.message));
    if (auth.sendFCMToPartner) auth.sendFCMToPartner(coupleId, role, payload).catch(err => console.error('[rewards] fcm failed:', err.message));
  } catch (e) { console.error('[rewards] gift notify failed:', e.message); }
}

// ════════════════════════════════════════════════════════════════
//  STEP 3 — SPIN & WIN and SCRATCH CARDS
//  Server decides every spin slice and scratch prize.
//  Daily limits enforced; double taps / retries are idempotent.
// ════════════════════════════════════════════════════════════════

// ── POST /spin ─────────────────────────────────────────────────────
router.post('/spin', async (req, res) => {
  const body = req.body || {};
  try {
    const coupleId = body.coupleId;
    const user = await member(req, res, coupleId); if (!user) return;
    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
    if (!/^[A-Za-z0-9_.:-]{6,80}$/.test(clientId)) return res.status(400).json({ error: 'Missing or invalid clientId' });

    const today = istDay(0);

    // 1) Idempotency check: did this exact tap already spin?
    const { data: prior } = await supabase.from('reward_spins')
      .select('slice_index, coins, label')
      .eq('user_id', user.id).eq('client_id', clientId).maybeSingle();
    if (prior) {
      const balance = await walletBalance(user.id);
      return res.json({
        ok: true, duplicate: true,
        sliceIndex: prior.slice_index, coins: prior.coins, label: prior.label,
        balance, spinsAvailable: 0,
      });
    }

    // 2) Daily limit check: max 1 free spin per day
    const { data: todaySpins } = await supabase.from('reward_spins')
      .select('id')
      .eq('user_id', user.id).eq('day', today);
    if (todaySpins && todaySpins.length > 0) {
      return res.status(400).json({
        error: "You've already used your free spin today. Come back tomorrow!",
        code: 'spin_limit_reached',
      });
    }

    // 3) Server decides outcome
    const slices = await getSlices();
    const slice = pickWeighted(slices);

    // 4) Credit coins atomically with idem_key
    const idem = 'spin:' + clientId;
    const { data: credit, error: cErr } = await supabase.rpc('reward_credit', {
      p_user: user.id, p_couple: String(coupleId), p_amount: slice.coins,
      p_kind: 'spin', p_idem: idem,
      p_meta: { sliceIndex: slice.index, coins: slice.coins, label: slice.label },
    });
    if (cErr) throw cErr;

    // 5) Log the spin
    const { error: sErr } = await supabase.from('reward_spins').insert({
      user_id: user.id, couple_id: String(coupleId), day: today,
      slice_index: slice.index, coins: slice.coins, label: slice.label,
      source: 'daily', client_id: clientId,
    });
    if (sErr) console.error('[rewards] reward_spins log error:', sErr.message);

    const balance = await walletBalance(user.id);
    res.json({
      ok: true, duplicate: false,
      sliceIndex: slice.index, coins: slice.coins, label: slice.label,
      balance, spinsAvailable: 0,
    });
  } catch (e) {
    console.error('[rewards] spin failed:', e.message);
    res.status(500).json({ error: 'Could not complete your spin. Please try again.' });
  }
});

// ── POST /scratch ──────────────────────────────────────────────────
router.post('/scratch', async (req, res) => {
  const body = req.body || {};
  try {
    const coupleId = body.coupleId;
    const user = await member(req, res, coupleId); if (!user) return;
    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
    if (!/^[A-Za-z0-9_.:-]{6,80}$/.test(clientId)) return res.status(400).json({ error: 'Missing or invalid clientId' });

    const today = istDay(0);

    // 1) Idempotency check: did this exact tap already scratch?
    const { data: prior } = await supabase.from('reward_scratches')
      .select('prize_id, coins, title, message')
      .eq('user_id', user.id).eq('client_id', clientId).maybeSingle();
    if (prior) {
      const balance = await walletBalance(user.id);
      return res.json({
        ok: true, duplicate: true,
        prizeId: prior.prize_id, coins: prior.coins, title: prior.title, message: prior.message,
        balance, scratchesAvailable: 0,
      });
    }

    // 2) Daily limit check: max 1 free scratch per day
    const { data: todayScratches } = await supabase.from('reward_scratches')
      .select('id')
      .eq('user_id', user.id).eq('day', today);
    if (todayScratches && todayScratches.length > 0) {
      return res.status(400).json({
        error: "You've already scratched your card today. Come back tomorrow!",
        code: 'scratch_limit_reached',
      });
    }

    // 3) Server decides outcome
    const prizes = await getScratchPrizes();
    const prize = pickWeighted(prizes);

    // 4) Credit coins atomically with idem_key
    const idem = 'scratch:' + clientId;
    const { data: credit, error: cErr } = await supabase.rpc('reward_credit', {
      p_user: user.id, p_couple: String(coupleId), p_amount: prize.coins,
      p_kind: 'scratch', p_idem: idem,
      p_meta: { prizeId: prize.id, coins: prize.coins, title: prize.title },
    });
    if (cErr) throw cErr;

    // 5) Log the scratch
    const { error: scErr } = await supabase.from('reward_scratches').insert({
      user_id: user.id, couple_id: String(coupleId), day: today,
      prize_id: prize.id, coins: prize.coins, title: prize.title, message: prize.message,
      source: 'daily', client_id: clientId,
    });
    if (scErr) console.error('[rewards] reward_scratches log error:', scErr.message);

    const balance = await walletBalance(user.id);
    res.json({
      ok: true, duplicate: false,
      prizeId: prize.id, coins: prize.coins, title: prize.title, message: prize.message, emoji: prize.emoji,
      balance, scratchesAvailable: 0,
    });
  } catch (e) {
    console.error('[rewards] scratch failed:', e.message);
    res.status(500).json({ error: 'Could not claim scratch card reward. Please try again.' });
  }
});

module.exports = router;
module.exports._test = {
  streakFromDays, istDay, prevDay, DEFAULT_CYCLE, DEFAULT_GIFTS, cleanGift,
  DEFAULT_SLICES, DEFAULT_SCRATCH_PRIZES, pickWeighted,
};
