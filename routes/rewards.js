// ════════════════════════════════════════════════════════════════
//  routes/rewards.js — Twin Rewards (Step 1: wallet, daily check-in, streaks)
//    GET  /api/rewards/summary?coupleId=&userId=   balance, streaks, 7-day cycle
//    POST /api/rewards/checkin  { coupleId, userId }   claim today's coins (once a day)
//    GET  /api/rewards/history?coupleId=&userId=&limit=   coin history
//    GET/POST /api/rewards/earn...  Phase 1: small daily-capped coins for everyday actions
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

// Defaults for Step 4: Twin Store catalog
const DEFAULT_STORE_ITEMS = [
  // ── Chat Themes ── (100 coins)
  {
    id: 'theme_sunset',
    name: 'Sunset Romance',
    category: 'theme',
    price: 100,
    emoji: '🌅',
    description: 'Warm golden sunset gradient for your couple chat',
    previewColor: 'linear-gradient(135deg, #f97316, #ec4899)',
  },
  {
    id: 'theme_midnight',
    name: 'Midnight Galaxy',
    category: 'theme',
    price: 100,
    emoji: '🌌',
    description: 'Deep starlight navy with glowing violet accents',
    previewColor: 'linear-gradient(135deg, #1e1b4b, #6366f1)',
  },
  {
    id: 'theme_rose',
    name: 'Rose Garden',
    category: 'theme',
    price: 100,
    emoji: '🌹',
    description: 'Soft pastel crimson & rose petal elegance',
    previewColor: 'linear-gradient(135deg, #be123c, #fb7185)',
  },
  {
    id: 'theme_emerald',
    name: 'Emerald Aurora',
    category: 'theme',
    price: 100,
    emoji: '🌲',
    description: 'Enchanting mystic green & aurora borealis glow',
    previewColor: 'linear-gradient(135deg, #064e3b, #10b981)',
  },

  // ── Profile Frames ── (80–120 coins)
  {
    id: 'frame_gold_heart',
    name: 'Golden Hearts',
    category: 'frame',
    price: 80,
    emoji: '💛',
    description: 'Glowing twin golden hearts circling your avatar',
    previewColor: '#F5B83D',
  },
  {
    id: 'frame_neon_pulse',
    name: 'Neon Glow Pulse',
    category: 'frame',
    price: 80,
    emoji: '⚡',
    description: 'Vibrant animated neon border that pulses with love',
    previewColor: '#A855F7',
  },
  {
    id: 'frame_royal_crown',
    name: 'Royal Couple Crown',
    category: 'frame',
    price: 120,
    emoji: '👑',
    description: 'Sparkling royal crown framing your profile picture',
    previewColor: '#EAB308',
  },
  {
    id: 'frame_sparkle_ring',
    name: 'Diamond Halo',
    category: 'frame',
    price: 120,
    emoji: '✨',
    description: 'Glistening diamond sparkles surrounding your photo',
    previewColor: '#38BDF8',
  },

  // ── Virtual Home Decor ── (120–150 coins)
  {
    id: 'decor_fairy_lights',
    name: 'Fairy String Lights',
    category: 'decor',
    price: 150,
    emoji: '💡',
    description: 'Cozy warm fairy lights strung across your Virtual Home',
    previewColor: '#FEF08A',
  },
  {
    id: 'decor_fireplace',
    name: 'Cozy Fireplace',
    category: 'decor',
    price: 150,
    emoji: '🔥',
    description: 'A crackling rustic fireplace for warm evenings together',
    previewColor: '#EA580C',
  },
  {
    id: 'decor_love_plant',
    name: 'Eternal Love Plant',
    category: 'decor',
    price: 120,
    emoji: '🪴',
    description: 'Heart-leafed monstera plant that blooms every milestone',
    previewColor: '#16A34A',
  },
  {
    id: 'decor_teddy_corner',
    name: 'Giant Teddy Corner',
    category: 'decor',
    price: 140,
    emoji: '🧸',
    description: 'An adorable jumbo cuddle teddy for your virtual room',
    previewColor: '#B45309',
  },

  // ── Game Packs ── (80–90 coins)
  {
    id: 'pack_deep_love',
    name: 'Deep Intimacy Deck',
    category: 'game',
    price: 80,
    emoji: '🔮',
    description: '50 soul-connecting questions for late night talks',
    previewColor: '#8B5CF6',
  },
  {
    id: 'pack_spicy_dares',
    name: 'Spicy Couple Dares',
    category: 'game',
    price: 90,
    emoji: '🌶️',
    description: 'Fun & thrilling dares designed exclusively for two',
    previewColor: '#EF4444',
  },
  {
    id: 'pack_future_dreams',
    name: 'Future & Dreams Deck',
    category: 'game',
    price: 80,
    emoji: '✈️',
    description: 'Bucket list adventures and shared life goals',
    previewColor: '#0EA5E9',
  },
];

async function getStoreItems() {
  try {
    const { data } = await supabase.from('reward_config').select('value').eq('key', 'store_catalog').maybeSingle();
    if (data && Array.isArray(data.value) && data.value.length > 0) return data.value;
  } catch (_) {}
  return DEFAULT_STORE_ITEMS;
}

// ── PHASE 2: spend coins on extras ─────────────────────────────────
// After the free daily spin / scratch is used, coins can buy a few more. The price and the daily cap come
// from here (reward_config key 'spend_rules' overrides: {"spin":{"price":20,"daily":3},"scratch":{...}}).
const DEFAULT_SPEND_RULES = { spin: { price: 20, daily: 3 }, scratch: { price: 15, daily: 2 } };

function cleanSpendRules(v) {
  const out = {};
  for (const k of Object.keys(DEFAULT_SPEND_RULES)) {
    const d = DEFAULT_SPEND_RULES[k];
    const o = (v && typeof v === 'object' && v[k] && typeof v[k] === 'object') ? v[k] : {};
    const price = Number.isInteger(o.price) && o.price >= 1 && o.price <= 1000 ? o.price : d.price;
    const daily = Number.isInteger(o.daily) && o.daily >= 0 && o.daily <= 10 ? o.daily : d.daily;
    out[k] = { price, daily };
  }
  return out;
}

async function getSpendRules() {
  try {
    const { data } = await supabase.from('reward_config').select('value').eq('key', 'spend_rules').maybeSingle();
    return cleanSpendRules(data && data.value);
  } catch (_) {}
  return cleanSpendRules(null);
}

/** Take coins. { applied, balance }: applied=false + balance < price means "not enough coins". */
async function chargeCoins(user, coupleId, price, kind, idem, meta) {
  const { data, error } = await supabase.rpc('reward_credit', {
    p_user: user.id, p_couple: String(coupleId), p_amount: -price, p_kind: kind, p_idem: idem, p_meta: meta || {},
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

async function refundCoins(user, coupleId, price, kind, idem, meta) {
  try {
    await supabase.rpc('reward_credit', { p_user: user.id, p_couple: String(coupleId), p_amount: price, p_kind: kind, p_idem: idem, p_meta: meta || {} });
  } catch (e) { console.error('[rewards] refund failed:', e.message); }
}

// ── PHASE 3: rewarded ads (Android) ────────────────────────────────
// "Watch an ad" -> +coins, or a free extra spin. Flow: /ad/start gives a signed one-time ticket; the app shows the
// ad; /ad/claim (or /spin with adToken) cashes the ticket in. The ticket is signed by the server, tied to this
// person + day + slot number, and is single use (the slot number is part of the idempotency key).
// Limits come from reward_config key 'ad_rules': {"coins":10,"daily":5,"spinDaily":3,"minSeconds":5}.
// HARDENING TODO: AdMob "server-side verification" (Google signs a callback to the server) would prove the ad
// really finished. Until it is switched on, the daily caps below are what limit abuse.
const crypto = require('crypto');
const DEFAULT_AD_RULES = { coins: 10, daily: 5, spinDaily: 3, minSeconds: 5 };

function cleanAdRules(v) {
  const o = (v && typeof v === 'object') ? v : {};
  const pick = (k, lo, hi) => (Number.isInteger(o[k]) && o[k] >= lo && o[k] <= hi ? o[k] : DEFAULT_AD_RULES[k]);
  return { coins: pick('coins', 1, 100), daily: pick('daily', 0, 20), spinDaily: pick('spinDaily', 0, 10), minSeconds: pick('minSeconds', 0, 60) };
}
async function getAdRules() {
  try {
    const { data } = await supabase.from('reward_config').select('value').eq('key', 'ad_rules').maybeSingle();
    return cleanAdRules(data && data.value);
  } catch (_) {}
  return cleanAdRules(null);
}

function adSecret() {
  return process.env.REWARD_AD_SECRET || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || 'dev-only-ad-secret';
}
function signAdToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', adSecret()).update(body).digest('base64url');
}
function readAdToken(token) {
  if (typeof token !== 'string' || token.length > 600) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', adSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString()); } catch (_) { return null; }
}
/** Checks a ticket belongs to this person, today, this purpose and is old enough (the ad had time to play). */
function checkAdToken(token, user, purpose, today, rules, nowMs = Date.now()) {
  const t = readAdToken(token);
  if (!t || t.u !== user.id || t.p !== purpose || t.d !== today || !Number.isInteger(t.n) || t.n < 1) return { ok: false, code: 'bad_ad_ticket' };
  const age = nowMs - t.t;
  if (age < rules.minSeconds * 1000) return { ok: false, code: 'ad_too_fast' };
  if (age > 15 * 60 * 1000) return { ok: false, code: 'ad_ticket_expired' };
  return { ok: true, n: t.n };
}
/** How many ad rewards were already cashed in today: markers are transactions of kind 'ad' (coins) / 'ad_spin'. */
async function adCountsToday(userId, today) {
  const { data } = await supabase.from('coin_transactions').select('kind')
    .eq('user_id', userId).gte('created_at', today + 'T00:00:00+05:30');
  let coins = 0, spins = 0;
  for (const r of data || []) { if (r.kind === 'ad') coins++; else if (r.kind === 'ad_spin') spins++; }
  return { coins, spins };
}

async function buildSummary(user, coupleId, today = istDay(0)) {
  const since = new Date(Date.parse(today + 'T00:00:00Z') - 70 * 86400000).toISOString().slice(0, 10);
  const [wallet, mine, couple, cycle, spinsToday, scratchesToday, slices, purchases, equipped, spendRules, adRules, adCounts] = await Promise.all([
    supabase.from('reward_wallets').select('balance, lifetime_earned').eq('user_id', user.id).maybeSingle(),
    supabase.from('reward_checkins').select('day, streak').eq('user_id', user.id).gte('day', since).order('day', { ascending: false }),
    supabase.from('reward_checkins').select('user_id, day').eq('couple_id', String(coupleId)).gte('day', since).order('day', { ascending: false }),
    getCycle(),
    supabase.from('reward_spins').select('slice_index, coins, source').eq('user_id', user.id).eq('day', today),
    supabase.from('reward_scratches').select('prize_id, coins, source').eq('user_id', user.id).eq('day', today),
    getSlices(),
    supabase.from('reward_purchases').select('item_id').eq('couple_id', String(coupleId)),
    supabase.from('reward_equipped').select('category, item_id, user_id').eq('couple_id', String(coupleId)),
    getSpendRules(),
    getAdRules(),
    adCountsToday(user.id, today),
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

  const isFree = r => r.source === 'daily';
  const spunToday = (spinsToday.data || []).some(isFree);
  const scratchedToday = (scratchesToday.data || []).some(isFree);
  const paidSpins = (spinsToday.data || []).filter(r => r.source === 'paid').length;
  const paidScratches = (scratchesToday.data || []).filter(r => r.source === 'paid').length;

  const unlockedItemIds = (purchases.data || []).map(p => p.item_id);
  const equippedMap = {};
  for (const eq of (equipped.data || [])) {
    if (!eq.user_id || eq.user_id === user.id) equippedMap[eq.category] = eq.item_id;
  }

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
    paidSpinPrice: spendRules.spin.price,
    paidSpinsLeft: spunToday ? Math.max(0, spendRules.spin.daily - paidSpins) : 0,
    paidScratchPrice: spendRules.scratch.price,
    paidScratchesLeft: scratchedToday ? Math.max(0, spendRules.scratch.daily - paidScratches) : 0,
    adCoinsReward: adRules.coins,
    adCoinsLeft: Math.max(0, adRules.daily - adCounts.coins),
    adSpinsLeft: spunToday ? Math.max(0, adRules.spinDaily - adCounts.spins) : 0,
    wheelSlices: slices,
    unlockedItemIds,
    equipped: equippedMap,
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

    // 2) Daily limits: 1 free spin a day; after that, optional paid spins (price + cap from spend rules)
    const adToken = typeof body.adToken === 'string' ? body.adToken : '';
    const paid = body.paid === true && !adToken;
    const { data: todaySpins } = await supabase.from('reward_spins')
      .select('source').eq('user_id', user.id).eq('day', today);
    const freeUsed = (todaySpins || []).some(r => r.source === 'daily');
    const paidUsed = (todaySpins || []).filter(r => r.source === 'paid').length;
    const spend = (await getSpendRules()).spin;
    if (!paid && !adToken && freeUsed) {
      return res.status(400).json({
        error: "You've already used your free spin today. Come back tomorrow!",
        code: 'spin_limit_reached',
      });
    }
    if (paid && !freeUsed) {
      return res.status(400).json({ error: 'Use your free spin first.', code: 'free_spin_first' });
    }
    if (paid && paidUsed >= spend.daily) {
      return res.status(400).json({ error: "You've used all extra spins for today. Come back tomorrow!", code: 'spin_limit_reached' });
    }

    // 2a) Spin earned by watching an ad: the ticket replaces the coins (one use only)
    if (adToken) {
      if (!freeUsed) return res.status(400).json({ error: 'Use your free spin first.', code: 'free_spin_first' });
      const adRules = await getAdRules();
      const chk = checkAdToken(adToken, user, 'spin', today, adRules);
      if (!chk.ok) return res.status(400).json({ error: 'The ad reward could not be confirmed. Please try again.', code: chk.code });
      if (chk.n > adRules.spinDaily) return res.status(400).json({ error: 'No more ad spins today. Come back tomorrow!', code: 'ad_limit_reached' });
      const mark = await supabase.rpc('reward_credit', {
        p_user: user.id, p_couple: String(coupleId), p_amount: 0, p_kind: 'ad_spin', p_idem: 'adspin:' + today + ':' + chk.n, p_meta: { n: chk.n },
      });
      if (mark.error) throw mark.error;
      const mrow = Array.isArray(mark.data) ? mark.data[0] : mark.data;
      if (mrow && !mrow.applied) return res.status(400).json({ error: 'That ad reward was already used.', code: 'ad_ticket_used' });
    }

    // 2b) Paid spin: take the coins first (same tap id can never be charged twice)
    if (paid) {
      const row = await chargeCoins(user, coupleId, spend.price, 'spin_buy', 'spin-buy:' + clientId, { price: spend.price });
      if (row && !row.applied && row.balance < spend.price) {
        return res.status(400).json({ error: 'Not enough coins for another spin.', code: 'not_enough_coins', balance: row.balance, price: spend.price });
      }
    }

    // 3) Server decides outcome
    const slices = await getSlices();
    const slice = pickWeighted(slices);

    // 4) Credit coins atomically with idem_key
    const idem = 'spin:' + clientId;
    const { error: cErr } = await supabase.rpc('reward_credit', {
      p_user: user.id, p_couple: String(coupleId), p_amount: slice.coins,
      p_kind: 'spin', p_idem: idem,
      p_meta: { sliceIndex: slice.index, coins: slice.coins, label: slice.label, paid, ad: !!adToken },
    });
    if (cErr) {
      if (paid) await refundCoins(user, coupleId, spend.price, 'spin_refund', 'spin-refund:' + clientId, {});
      throw cErr;
    }

    // 5) Log the spin
    const { error: sErr } = await supabase.from('reward_spins').insert({
      user_id: user.id, couple_id: String(coupleId), day: today,
      slice_index: slice.index, coins: slice.coins, label: slice.label,
      source: adToken ? 'ad' : (paid ? 'paid' : 'daily'), client_id: clientId,
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

    // 2) Daily limits: 1 free card a day; after that, optional paid cards (price + cap from spend rules)
    const paid = body.paid === true;
    const { data: todayScratches } = await supabase.from('reward_scratches')
      .select('source').eq('user_id', user.id).eq('day', today);
    const freeUsed = (todayScratches || []).some(r => r.source === 'daily');
    const paidUsed = (todayScratches || []).filter(r => r.source === 'paid').length;
    const spend = (await getSpendRules()).scratch;
    if (!paid && freeUsed) {
      return res.status(400).json({
        error: "You've already scratched your card today. Come back tomorrow!",
        code: 'scratch_limit_reached',
      });
    }
    if (paid && !freeUsed) return res.status(400).json({ error: 'Scratch your free card first.', code: 'free_scratch_first' });
    if (paid && paidUsed >= spend.daily) {
      return res.status(400).json({ error: "You've used all extra cards for today. Come back tomorrow!", code: 'scratch_limit_reached' });
    }
    if (paid) {
      const row = await chargeCoins(user, coupleId, spend.price, 'scratch_buy', 'scratch-buy:' + clientId, { price: spend.price });
      if (row && !row.applied && row.balance < spend.price) {
        return res.status(400).json({ error: 'Not enough coins for another card.', code: 'not_enough_coins', balance: row.balance, price: spend.price });
      }
    }

    // 3) Server decides outcome
    const prizes = await getScratchPrizes();
    const prize = pickWeighted(prizes);

    // 4) Credit coins atomically with idem_key
    const idem = 'scratch:' + clientId;
    const { error: cErr } = await supabase.rpc('reward_credit', {
      p_user: user.id, p_couple: String(coupleId), p_amount: prize.coins,
      p_kind: 'scratch', p_idem: idem,
      p_meta: { prizeId: prize.id, coins: prize.coins, title: prize.title, paid },
    });
    if (cErr) {
      if (paid) await refundCoins(user, coupleId, spend.price, 'scratch_refund', 'scratch-refund:' + clientId, {});
      throw cErr;
    }

    // 5) Log the scratch
    const { error: scErr } = await supabase.from('reward_scratches').insert({
      user_id: user.id, couple_id: String(coupleId), day: today,
      prize_id: prize.id, coins: prize.coins, title: prize.title, message: prize.message,
      source: paid ? 'paid' : 'daily', client_id: clientId,
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

// ════════════════════════════════════════════════════════════════
//  STEP 4 — TWIN STORE & SPEND SINKS
//  Coins unlock Chat Themes, Profile Frames, Virtual Decor, Game Packs.
//  Server enforces pricing and unlocks are saved per couple.
// ════════════════════════════════════════════════════════════════

// ── GET /store ─────────────────────────────────────────────────────
router.get('/store', async (req, res) => {
  try {
    const coupleId = req.query.coupleId;
    const user = await member(req, res, coupleId); if (!user) return;
    const [items, purchases, equipped, balance] = await Promise.all([
      getStoreItems(),
      supabase.from('reward_purchases').select('item_id').eq('couple_id', String(coupleId)),
      supabase.from('reward_equipped').select('category, item_id, user_id').eq('couple_id', String(coupleId)),
      walletBalance(user.id),
    ]);
    const unlockedItemIds = (purchases.data || []).map(p => p.item_id);
    const equippedMap = {};
    for (const eq of (equipped.data || [])) {
      if (!eq.user_id || eq.user_id === user.id) equippedMap[eq.category] = eq.item_id;
    }
    res.json({ balance, items, unlockedItemIds, equipped: equippedMap });
  } catch (e) {
    console.error('[rewards] store failed:', e.message);
    res.status(500).json({ error: 'Could not load Twin Store. Please try again.' });
  }
});

// ── POST /buy ──────────────────────────────────────────────────────
router.post('/buy', async (req, res) => {
  const body = req.body || {};
  try {
    const coupleId = body.coupleId;
    const user = await member(req, res, coupleId); if (!user) return;
    const itemId = typeof body.itemId === 'string' ? body.itemId.trim() : '';
    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
    if (!itemId || !/^[A-Za-z0-9_.:-]{6,80}$/.test(clientId)) return res.status(400).json({ error: 'Missing or invalid data' });

    const items = await getStoreItems();
    const item = items.find(i => i.id === itemId);
    if (!item) return res.status(404).json({ error: 'Store item not found.' });

    // Check if already unlocked for this couple
    const { data: prior } = await supabase.from('reward_purchases')
      .select('item_id')
      .eq('couple_id', String(coupleId))
      .eq('item_id', itemId)
      .maybeSingle();
    if (prior) {
      const balance = await walletBalance(user.id);
      const { data: allP } = await supabase.from('reward_purchases').select('item_id').eq('couple_id', String(coupleId));
      return res.json({ ok: true, duplicate: true, itemId: item.id, item, balance, unlockedItemIds: (allP || []).map(p => p.item_id) });
    }

    // Spend coins
    const idem = 'buy:' + clientId;
    const { data: credit, error: cErr } = await supabase.rpc('reward_credit', {
      p_user: user.id, p_couple: String(coupleId), p_amount: -item.price,
      p_kind: 'store_purchase', p_idem: idem,
      p_meta: { itemId: item.id, name: item.name, category: item.category, emoji: item.emoji },
    });
    if (cErr) throw cErr;
    const row = Array.isArray(credit) ? credit[0] : credit;
    if (!(row && row.applied)) {
      const { data: paidBefore } = await supabase.from('coin_transactions').select('id').eq('user_id', user.id).eq('idem_key', idem).maybeSingle();
      if (!paidBefore) {
        const balance = row ? row.balance : await walletBalance(user.id);
        return res.status(402).json({ error: 'Not enough Gold Coins for this item.', code: 'insufficient', balance, need: item.price });
      }
    }

    // Record purchase
    const { error: pErr } = await supabase.from('reward_purchases').upsert({
      couple_id: String(coupleId), user_id: user.id, item_id: item.id,
      category: item.category, price: item.price, client_id: clientId,
    }, { onConflict: 'couple_id,item_id' });
    if (pErr) console.error('[rewards] purchase insert error:', pErr.message);

    const balance = await walletBalance(user.id);
    const { data: allP } = await supabase.from('reward_purchases').select('item_id').eq('couple_id', String(coupleId));
    const unlockedItemIds = (allP || []).map(p => p.item_id);

    res.json({ ok: true, duplicate: false, itemId: item.id, category: item.category, item, balance, unlockedItemIds });
  } catch (e) {
    console.error('[rewards] buy failed:', e.message);
    res.status(500).json({ error: 'Purchase failed. Your coins were not charged. Please try again.' });
  }
});

// ── POST /store/equip ──────────────────────────────────────────────
router.post('/store/equip', async (req, res) => {
  const body = req.body || {};
  try {
    const coupleId = body.coupleId;
    const user = await member(req, res, coupleId); if (!user) return;
    const category = typeof body.category === 'string' ? body.category.trim() : '';
    const itemId = typeof body.itemId === 'string' ? body.itemId.trim() : '';
    if (!['theme', 'frame', 'decor', 'game'].includes(category)) return res.status(400).json({ error: 'Invalid category' });

    // If equipping an item (not unequipping), verify couple has unlocked it
    if (itemId) {
      const { data: owned } = await supabase.from('reward_purchases')
        .select('id').eq('couple_id', String(coupleId)).eq('item_id', itemId).maybeSingle();
      if (!owned) return res.status(403).json({ error: 'You need to unlock this item from the Twin Store first.' });
    }

    const uid = category === 'frame' ? user.id : '';
    await supabase.from('reward_equipped').upsert({
      couple_id: String(coupleId), category, user_id: uid, item_id: itemId, updated_at: new Date().toISOString(),
    }, { onConflict: 'couple_id,category,user_id' });

    res.json({ ok: true, category, itemId });
  } catch (e) {
    console.error('[rewards] equip failed:', e.message);
    res.status(500).json({ error: 'Could not equip item. Please try again.' });
  }
});

// ════════════════════════════════════════════════════════════════
//  PHASE 1 — EARN COINS ACROSS THE APP
//    GET  /api/rewards/earn/status?coupleId=&userId=     what can be earned today and what is left
//    POST /api/rewards/earn { coupleId, userId, action } small daily-capped coins for everyday actions
//
//  The apps send only the ACTION NAME, never an amount. The server owns the amount and the daily cap
//  (per person, India day). A reward_config row (key 'earn_rules') overrides these defaults, so values
//  can be tuned or an action switched off ("enabled": false) without releasing an app.
//  The cap is atomic: every payout uses the idem key  earn:<action>:<day>:<n>  (n = 1..cap), so two
//  fast taps can never pay the same slot twice and no new table is needed.
// ════════════════════════════════════════════════════════════════
const DEFAULT_EARN_RULES = {
  mood:    { coins: 2, daily: 1, label: 'Log your mood',            emoji: '😊' },
  love:    { coins: 2, daily: 3, label: 'Send a Hug / Touch / Miss You', emoji: '🤗' },
  memory:  { coins: 5, daily: 3, label: 'Add a memory',             emoji: '📸' },
  routine: { coins: 3, daily: 1, label: 'Complete your daily routine', emoji: '🌞' },
  game:    { coins: 5, daily: 3, label: 'Win a couple game',        emoji: '🎮' },
};

function cleanEarnRules(v) {
  const out = {};
  for (const k of Object.keys(DEFAULT_EARN_RULES)) {
    const d = DEFAULT_EARN_RULES[k];
    const o = (v && typeof v === 'object' && v[k] && typeof v[k] === 'object') ? v[k] : {};
    const coins = Number.isInteger(o.coins) && o.coins >= 0 && o.coins <= 100 ? o.coins : d.coins;
    const daily = Number.isInteger(o.daily) && o.daily >= 0 && o.daily <= 20 ? o.daily : d.daily;
    out[k] = { coins, daily, label: d.label, emoji: d.emoji, enabled: o.enabled !== false && coins > 0 && daily > 0 };
  }
  return out;
}

async function getEarnRules() {
  try {
    const { data } = await supabase.from('reward_config').select('value').eq('key', 'earn_rules').maybeSingle();
    return cleanEarnRules(data && data.value);
  } catch (_) {}
  return cleanEarnRules(null);
}

async function earnedTodayCounts(userId, today) {
  const counts = {};
  const { data } = await supabase.from('coin_transactions').select('idem_key')
    .eq('user_id', userId).like('idem_key', 'earn:%:' + today + ':%');
  for (const r of data || []) {
    const a = String(r.idem_key).split(':')[1];
    counts[a] = (counts[a] || 0) + 1;
  }
  return counts;
}

router.get('/earn/status', async (req, res) => {
  try {
    const coupleId = req.query.coupleId;
    const user = await member(req, res, coupleId); if (!user) return;
    const today = istDay(0);
    const [rules, counts] = await Promise.all([getEarnRules(), earnedTodayCounts(user.id, today)]);
    const items = Object.keys(rules).filter(k => rules[k].enabled).map(k => ({
      action: k, label: rules[k].label, emoji: rules[k].emoji, coins: rules[k].coins, daily: rules[k].daily,
      remaining: Math.max(0, rules[k].daily - (counts[k] || 0)),
    }));
    res.json({ items });
  } catch (e) {
    console.error('[rewards] earn status failed:', e.message);
    res.status(500).json({ error: 'Could not load earning options.' });
  }
});

router.post('/earn', async (req, res) => {
  const body = req.body || {};
  try {
    const coupleId = body.coupleId;
    const user = await member(req, res, coupleId); if (!user) return;
    const action = typeof body.action === 'string' ? body.action.trim() : '';
    const rules = await getEarnRules();
    const rule = rules[action];
    if (!rule || !rule.enabled) return res.status(400).json({ error: 'Unknown action', code: 'unknown_action' });

    const today = istDay(0);
    const counts = await earnedTodayCounts(user.id, today);
    for (let n = (counts[action] || 0) + 1; n <= rule.daily; n++) {
      const { data: credit, error } = await supabase.rpc('reward_credit', {
        p_user: user.id, p_couple: String(coupleId), p_amount: rule.coins,
        p_kind: 'earn', p_idem: 'earn:' + action + ':' + today + ':' + n,
        p_meta: { action, label: rule.label, n },
      });
      if (error) throw error;
      const row = Array.isArray(credit) ? credit[0] : credit;
      if (row && row.applied) {
        return res.json({ ok: true, earned: rule.coins, capped: false, remaining: rule.daily - n, balance: row.balance, action });
      }
      // slot already taken (a parallel tap) -> try the next one
    }
    const balance = await walletBalance(user.id);
    res.json({ ok: true, earned: 0, capped: true, remaining: 0, balance, action });
  } catch (e) {
    console.error('[rewards] earn failed:', e.message);
    res.status(500).json({ error: 'Could not add coins. Please try again.' });
  }
});

router.post('/ad/start', async (req, res) => {
  try {
    const coupleId = (req.body || {}).coupleId;
    const user = await member(req, res, coupleId); if (!user) return;
    const purpose = (req.body || {}).purpose;
    if (purpose !== 'coins' && purpose !== 'spin') return res.status(400).json({ error: 'Unknown purpose', code: 'unknown_purpose' });
    const today = istDay(0);
    const [rules, counts] = await Promise.all([getAdRules(), adCountsToday(user.id, today)]);
    const used = purpose === 'coins' ? counts.coins : counts.spins;
    const cap = purpose === 'coins' ? rules.daily : rules.spinDaily;
    if (used >= cap) return res.status(400).json({ error: 'No more ad rewards today. Come back tomorrow!', code: 'ad_limit_reached' });
    const token = signAdToken({ u: user.id, c: String(coupleId), p: purpose, d: today, n: used + 1, t: Date.now() });
    res.json({ ok: true, token, minSeconds: rules.minSeconds, coins: rules.coins });
  } catch (e) {
    console.error('[rewards] ad start failed:', e.message);
    res.status(500).json({ error: 'Could not start the ad reward.' });
  }
});

router.post('/ad/claim', async (req, res) => {
  try {
    const coupleId = (req.body || {}).coupleId;
    const user = await member(req, res, coupleId); if (!user) return;
    const today = istDay(0);
    const rules = await getAdRules();
    const chk = checkAdToken((req.body || {}).token, user, 'coins', today, rules);
    if (!chk.ok) return res.status(400).json({ error: 'The ad reward could not be confirmed. Please try again.', code: chk.code });
    if (chk.n > rules.daily) return res.status(400).json({ error: 'No more ad rewards today. Come back tomorrow!', code: 'ad_limit_reached' });
    const { data, error } = await supabase.rpc('reward_credit', {
      p_user: user.id, p_couple: String(coupleId), p_amount: rules.coins, p_kind: 'ad',
      p_idem: 'ad:' + today + ':' + chk.n, p_meta: { n: chk.n },
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    const balance = row ? row.balance : await walletBalance(user.id);
    if (row && !row.applied) return res.json({ ok: true, earned: 0, duplicate: true, balance, remaining: Math.max(0, rules.daily - chk.n) });
    res.json({ ok: true, earned: rules.coins, duplicate: false, balance, remaining: Math.max(0, rules.daily - chk.n) });
  } catch (e) {
    console.error('[rewards] ad claim failed:', e.message);
    res.status(500).json({ error: 'Could not add the ad reward. Please try again.' });
  }
});

module.exports = router;
module.exports._test = {
  streakFromDays, istDay, prevDay, DEFAULT_CYCLE, DEFAULT_GIFTS, cleanGift,
  DEFAULT_SLICES, DEFAULT_SCRATCH_PRIZES, pickWeighted,
  DEFAULT_STORE_ITEMS, DEFAULT_EARN_RULES, cleanEarnRules, DEFAULT_SPEND_RULES, cleanSpendRules,
  DEFAULT_AD_RULES, cleanAdRules, signAdToken, readAdToken, checkAdToken,
};
