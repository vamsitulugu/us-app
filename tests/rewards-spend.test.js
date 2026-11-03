// Phase 1 earn + Phase 2 paid spin/scratch server test with an in-memory fake Supabase. Run: node tests/rewards-spend.test.js
const Module = require('module');
const assert = require('assert');
const http = require('http');
const express = require('express');

// ── fake database ──────────────────────────────────────────────
const db = {
  users: [], couples: [], reward_wallets: [], coin_transactions: [],
  reward_checkins: [], reward_config: [], chat_messages: [], gifts_sent: [],
  reward_spins: [], reward_scratches: [],
};
let nextId = 1;
function builder(table) {
  if (!db[table]) db[table] = [];
  const st = { filters: [], mode: 'select', row: null, opts: null, single: false, maybe: false };
  const rows = () => db[table].filter(r => st.filters.every(f => f(r)));
  const run = () => {
    if (st.mode === 'insert') {
      const row = { id: nextId++, ...st.row };
      db[table].push(row);
      return { data: row, error: null };
    }
    if (st.mode === 'upsert') {
      const keys = (st.opts && st.opts.onConflict || 'id').split(',');
      let ex = db[table].find(r => keys.every(k => String(r[k]) === String(st.row[k])));
      if (ex) { if (!(st.opts && st.opts.ignoreDuplicates)) Object.assign(ex, st.row); }
      else { ex = { id: nextId++, ...st.row }; db[table].push(ex); }
      return { data: ex, error: null };
    }
    const list = rows();
    if (st.single || st.maybe) return { data: list[0] || null, error: null };
    return { data: list, error: null };
  };
  const b = {
    select() { return b; }, order() { return b; }, limit() { return b; },
    eq(k, v) { st.filters.push(r => String(r[k]) === String(v)); return b; },
    gte(k, v) { st.filters.push(r => r[k] >= v); return b; },
    like(k, pat) { const re = new RegExp('^' + pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$'); st.filters.push(r => re.test(String(r[k]))); return b; },
    insert(row) { st.mode = 'insert'; st.row = row; return Promise.resolve(run()); },
    upsert(row, opts) { st.mode = 'upsert'; st.row = row; st.opts = opts; return b; },
    maybeSingle() { st.maybe = true; return Promise.resolve(run()); },
    single() { st.single = true; return Promise.resolve(run()); },
    then(res, rej) { return Promise.resolve(run()).then(res, rej); },
  };
  return b;
}

const fake = {
  from: builder,
  rpc: async (name, a) => {
    assert.strictEqual(name, 'reward_credit');
    let w = db.reward_wallets.find(x => x.user_id === a.p_user);
    if (!w) { w = { user_id: a.p_user, couple_id: a.p_couple, balance: 0, lifetime_earned: 0 }; db.reward_wallets.push(w); }
    if (a.p_amount < 0 && w.balance + a.p_amount < 0) return { data: [{ applied: false, balance: w.balance }], error: null };
    if (db.coin_transactions.find(t => t.user_id === a.p_user && t.idem_key === a.p_idem)) return { data: [{ applied: false, balance: w.balance }], error: null };
    db.coin_transactions.push({ id: nextId++, user_id: a.p_user, amount: a.p_amount, kind: a.p_kind, idem_key: a.p_idem, meta: a.p_meta, created_at: rewards._test.istDay(0) + 'T12:00:00+05:30' });
    w.balance += a.p_amount;
    if (a.p_amount > 0) w.lifetime_earned += a.p_amount;
    return { data: [{ applied: true, balance: w.balance }], error: null };
  },
};

// ── stub the app's own modules ─────────────────────────────────
const stubs = {
  '../middleware/supabase': fake,
  '../middleware/pro': { loadMember: async (req, coupleId) => { const u = db.users.find(x => x.id === req.get('x-user-id')); return u && String(u.couple_id) === String(coupleId) ? u : null; } },
  './presence': { isViewingChat: () => false },
  './auth': { sendPushToPartner: async () => {}, sendFCMToPartner: async () => {} },
};
const orig = Module._load;
Module._load = function (req, parent, ...r) { return stubs[req] || orig.call(this, req, parent, ...r); };
const rewards = require('../routes/rewards.js');

function call(server, method, url, body, uid) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const rq = http.request({ port: server.address().port, path: url, method, headers: { 'content-type': 'application/json', 'x-user-id': uid } }, rs => {
      let t = ''; rs.on('data', c => t += c); rs.on('end', () => resolve({ status: rs.statusCode, json: t ? JSON.parse(t) : {} }));
    });
    rq.on('error', reject); if (data) rq.write(data); rq.end();
  });
}

(async () => {
  db.users.push({ id: 'u1', name: 'Ravi', role: 'user1', couple_id: 'c1' }, { id: 'u2', name: 'Sita', role: 'user2', couple_id: 'c1' });
  db.couples.push({ id: 'c1', paired: true, user1_name: 'Ravi', user2_name: 'Sita' });
  const app = express(); app.use(express.json()); app.use('/api/rewards', rewards);
  const server = app.listen(0);
  const P = (path, body) => call(server, 'POST', '/api/rewards/' + path, { coupleId: 'c1', userId: 'u1', ...body }, 'u1');
  const bal = () => (db.reward_wallets.find(w => w.user_id === 'u1') || { balance: 0 }).balance;

  // ── Phase 1: earn ──
  let r = await P('earn', { action: 'mood' });
  assert.strictEqual(r.json.earned, 2); assert.strictEqual(bal(), 2);
  r = await P('earn', { action: 'mood' });
  assert.strictEqual(r.json.earned, 0); assert.strictEqual(r.json.capped, true); assert.strictEqual(bal(), 2);
  console.log('ok  earn: mood pays once a day, then capped');

  for (let i = 0; i < 3; i++) await P('earn', { action: 'love' });
  r = await P('earn', { action: 'love' });
  assert.strictEqual(r.json.capped, true); assert.strictEqual(bal(), 2 + 6);
  console.log('ok  earn: love pays 3 times then capped');

  r = await P('earn', { action: 'hack', coins: 9999 });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(bal(), 8);
  console.log('ok  earn: unknown action refused, the app can never send an amount');

  r = await call(server, 'GET', '/api/rewards/earn/status?coupleId=c1&userId=u1', null, 'u1');
  const love = r.json.items.find(i => i.action === 'love'), mood = r.json.items.find(i => i.action === 'mood');
  assert.strictEqual(love.remaining, 0); assert.strictEqual(mood.remaining, 0);
  assert.strictEqual(r.json.items.find(i => i.action === 'memory').remaining, 3);
  console.log('ok  earn status shows what is left today');

  // ── Phase 2: paid spin ──
  r = await P('spin', { clientId: 'paid_try_0001', paid: true });
  assert.strictEqual(r.status, 400); assert.strictEqual(r.json.code, 'free_spin_first');
  console.log('ok  paid spin refused before the free spin is used');

  r = await P('spin', { clientId: 'free_spin_001' });
  assert.strictEqual(r.status, 200);
  let wallet = bal();

  r = await call(server, 'GET', '/api/rewards/summary?coupleId=c1&userId=u1', null, 'u1');
  assert.strictEqual(r.json.spunToday, true);
  assert.strictEqual(r.json.paidSpinPrice, 20); assert.strictEqual(r.json.paidSpinsLeft, 3);
  console.log('ok  summary: free spin used, 3 paid spins at 20 coins');

  db.reward_wallets.find(w => w.user_id === 'u1').balance = 5;
  r = await P('spin', { clientId: 'paid_spin_001', paid: true });
  assert.strictEqual(r.status, 400); assert.strictEqual(r.json.code, 'not_enough_coins');
  assert.strictEqual(bal(), 5);
  assert.ok(!db.reward_spins.find(s => s.client_id === 'paid_spin_001'));
  console.log('ok  paid spin with too few coins: refused, nothing charged');

  db.reward_wallets.find(w => w.user_id === 'u1').balance = 100;
  r = await P('spin', { clientId: 'paid_spin_001', paid: true });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.json.duplicate, false);
  const afterOne = r.json.balance;
  assert.strictEqual(afterOne, 100 - 20 + r.json.coins);
  console.log('ok  paid spin: charged 20, prize ' + r.json.coins + ' credited, balance ' + afterOne);

  r = await P('spin', { clientId: 'paid_spin_001', paid: true });
  assert.strictEqual(r.json.duplicate, true); assert.strictEqual(bal(), afterOne);
  console.log('ok  paid spin double tap is not charged twice');

  await P('spin', { clientId: 'paid_spin_002', paid: true });
  await P('spin', { clientId: 'paid_spin_003', paid: true });
  r = await P('spin', { clientId: 'paid_spin_004', paid: true });
  assert.strictEqual(r.status, 400); assert.strictEqual(r.json.code, 'spin_limit_reached');
  r = await call(server, 'GET', '/api/rewards/summary?coupleId=c1&userId=u1', null, 'u1');
  assert.strictEqual(r.json.paidSpinsLeft, 0); assert.strictEqual(r.json.spunToday, true);
  console.log('ok  paid spins stop at the daily cap (3)');

  // ── Phase 2: paid scratch ──
  r = await P('scratch', { clientId: 'paid_scr_0001', paid: true });
  assert.strictEqual(r.json.code, 'free_scratch_first');
  r = await P('scratch', { clientId: 'free_scr_0001' }); assert.strictEqual(r.status, 200);
  const before = bal();
  r = await P('scratch', { clientId: 'paid_scr_0002', paid: true });
  assert.strictEqual(r.status, 200); assert.strictEqual(bal(), before - 15 + r.json.coins);
  console.log('ok  paid scratch: free card first, then 15 coins for another');

  // ── Phase 3: rewarded ads ──
  const T = rewards._test, today = T.istDay(0);
  const aged = (purpose, n, ageMs = 10000, user = 'u1') => T.signAdToken({ u: user, c: 'c1', p: purpose, d: today, n, t: Date.now() - ageMs });

  r = await P('ad/start', { purpose: 'coins' });
  assert.strictEqual(r.status, 200); assert.ok(r.json.token); assert.strictEqual(r.json.minSeconds, 5);
  r = await P('ad/claim', { token: r.json.token });
  assert.strictEqual(r.status, 400); assert.strictEqual(r.json.code, 'ad_too_fast');
  console.log('ok  ad: a ticket cashed in instantly (ad cannot have played) is refused');

  const b0 = bal();
  r = await P('ad/claim', { token: aged('coins', 1) });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.json.earned, 10); assert.strictEqual(bal(), b0 + 10);
  r = await P('ad/claim', { token: aged('coins', 1) });
  assert.strictEqual(r.json.duplicate, true); assert.strictEqual(r.json.earned, 0); assert.strictEqual(bal(), b0 + 10);
  console.log('ok  ad: +10 coins once, the same ticket cannot be cashed twice');

  const good = aged('coins', 2);
  r = await P('ad/claim', { token: good.slice(0, -2) + 'xx' });
  assert.strictEqual(r.json.code, 'bad_ad_ticket');
  r = await call(server, 'POST', '/api/rewards/ad/claim', { coupleId: 'c1', userId: 'u2', token: aged('coins', 2, 10000, 'u1') }, 'u2');
  assert.strictEqual(r.json.code, 'bad_ad_ticket');
  r = await P('ad/claim', { token: aged('spin', 1) });
  assert.strictEqual(r.json.code, 'bad_ad_ticket');
  console.log('ok  ad: forged, someone else\'s, or wrong-purpose tickets are refused');

  for (let n = 2; n <= 5; n++) { r = await P('ad/claim', { token: aged('coins', n) }); assert.strictEqual(r.json.earned, 10); }
  r = await P('ad/start', { purpose: 'coins' });
  assert.strictEqual(r.status, 400); assert.strictEqual(r.json.code, 'ad_limit_reached');
  r = await call(server, 'GET', '/api/rewards/summary?coupleId=c1&userId=u1', null, 'u1');
  assert.strictEqual(r.json.adCoinsLeft, 0); assert.strictEqual(r.json.adCoinsReward, 10);
  console.log('ok  ad: 5 coin ads a day, then ad_limit_reached');

  // ad spin: no coins charged, single use
  r = await call(server, 'GET', '/api/rewards/summary?coupleId=c1&userId=u1', null, 'u1');
  assert.strictEqual(r.json.adSpinsLeft, 3);
  const bs = bal();
  r = await P('spin', { clientId: 'ad_spin_0001', adToken: aged('spin', 1) });
  assert.strictEqual(r.status, 200); assert.strictEqual(bal(), bs + r.json.coins);
  assert.strictEqual(db.reward_spins.find(x => x.client_id === 'ad_spin_0001').source, 'ad');
  r = await P('spin', { clientId: 'ad_spin_0002', adToken: aged('spin', 1) });
  assert.strictEqual(r.status, 400); assert.strictEqual(r.json.code, 'ad_ticket_used');
  r = await P('spin', { clientId: 'ad_spin_0003', adToken: aged('spin', 1, 100) });
  assert.strictEqual(r.json.code, 'ad_too_fast');
  r = await call(server, 'GET', '/api/rewards/summary?coupleId=c1&userId=u1', null, 'u1');
  assert.strictEqual(r.json.adSpinsLeft, 2); assert.strictEqual(r.json.spunToday, true);
  console.log('ok  ad spin: free extra spin, nothing charged, ticket is single use, free-spin flag untouched');

  assert.deepStrictEqual(T.cleanAdRules({ coins: 0, daily: 999, spinDaily: 'x' }), T.DEFAULT_AD_RULES);
  assert.strictEqual(T.cleanAdRules({ coins: 20 }).coins, 20);
  console.log('ok  ad_rules overrides are validated');

  // ── config validation ──
  const t = rewards._test;
  assert.deepStrictEqual(t.cleanSpendRules({ spin: { price: 0, daily: 99 }, scratch: 'x' }), t.DEFAULT_SPEND_RULES);
  assert.deepStrictEqual(t.cleanSpendRules({ spin: { price: 30, daily: 1 } }).spin, { price: 30, daily: 1 });
  console.log('ok  spend_rules overrides are validated');

  console.log('\nALL PHASE 1 + 2 + 3 BACKEND TESTS PASSED');
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
