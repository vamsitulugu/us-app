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

async function buildSummary(user, coupleId, today = istDay(0)) {
  const since = new Date(Date.parse(today + 'T00:00:00Z') - 70 * 86400000).toISOString().slice(0, 10);
  const [wallet, mine, couple, cycle] = await Promise.all([
    supabase.from('reward_wallets').select('balance, lifetime_earned').eq('user_id', user.id).maybeSingle(),
    supabase.from('reward_checkins').select('day, streak').eq('user_id', user.id).gte('day', since).order('day', { ascending: false }),
    supabase.from('reward_checkins').select('user_id, day').eq('couple_id', String(coupleId)).gte('day', since).order('day', { ascending: false }),
    getCycle(),
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

module.exports = router;
module.exports._test = { streakFromDays, istDay, prevDay, DEFAULT_CYCLE };
