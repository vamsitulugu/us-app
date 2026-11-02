// Spin & Scratch server test with an in-memory fake Supabase. Run: node tests/rewards-spin-scratch.test.js
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
    db.coin_transactions.push({ id: nextId++, user_id: a.p_user, amount: a.p_amount, kind: a.p_kind, idem_key: a.p_idem, meta: a.p_meta });
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

  // 1) Summary includes spinsAvailable = 1, scratchesAvailable = 1 initially
  let r = await call(server, 'GET', '/api/rewards/summary?coupleId=c1&userId=u1', null, 'u1');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.spinsAvailable, 1);
  assert.strictEqual(r.json.spunToday, false);
  assert.strictEqual(r.json.scratchesAvailable, 1);
  assert.strictEqual(r.json.scratchedToday, false);
  assert.strictEqual(r.json.wheelSlices.length, 8);
  console.log('ok  summary reports 1 free spin and 1 free scratch available');

  // 2) Spin wheel successfully
  const spinTap = 'spin_tap_001';
  r = await call(server, 'POST', '/api/rewards/spin', { coupleId: 'c1', userId: 'u1', clientId: spinTap }, 'u1');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.ok, true);
  assert.strictEqual(r.json.duplicate, false);
  assert.ok(r.json.sliceIndex >= 0 && r.json.sliceIndex < 8);
  assert.ok(r.json.coins > 0);
  assert.strictEqual(r.json.spinsAvailable, 0);
  const coinsWon = r.json.coins;
  assert.strictEqual(r.json.balance, coinsWon);
  assert.strictEqual(db.reward_spins.length, 1);
  assert.strictEqual(db.coin_transactions.length, 1);
  console.log('ok  spin succeeded: slice ' + r.json.sliceIndex + ' (' + coinsWon + ' coins won), balance = ' + r.json.balance);

  // 3) Retry same clientId -> idempotent (no double payout)
  r = await call(server, 'POST', '/api/rewards/spin', { coupleId: 'c1', userId: 'u1', clientId: spinTap }, 'u1');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.duplicate, true);
  assert.strictEqual(r.json.balance, coinsWon);
  assert.strictEqual(db.coin_transactions.length, 1);
  console.log('ok  spin retry / double tap is idempotent');

  // 4) Second spin with different clientId today -> rejected (daily limit)
  r = await call(server, 'POST', '/api/rewards/spin', { coupleId: 'c1', userId: 'u1', clientId: 'spin_tap_002' }, 'u1');
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.json.code, 'spin_limit_reached');
  assert.strictEqual(db.coin_transactions.length, 1);
  console.log('ok  second spin on same day refused with spin_limit_reached');

  // 5) Scratch card successfully
  const scratchTap = 'scratch_tap_001';
  r = await call(server, 'POST', '/api/rewards/scratch', { coupleId: 'c1', userId: 'u1', clientId: scratchTap }, 'u1');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.ok, true);
  assert.strictEqual(r.json.duplicate, false);
  assert.ok(r.json.coins > 0);
  assert.ok(r.json.title);
  assert.ok(r.json.message);
  assert.strictEqual(r.json.scratchesAvailable, 0);
  const scratchCoins = r.json.coins;
  assert.strictEqual(r.json.balance, coinsWon + scratchCoins);
  assert.strictEqual(db.reward_scratches.length, 1);
  assert.strictEqual(db.coin_transactions.length, 2);
  console.log('ok  scratch card succeeded: ' + r.json.title + ' (' + scratchCoins + ' coins won), balance = ' + r.json.balance);

  // 6) Scratch card retry -> idempotent
  r = await call(server, 'POST', '/api/rewards/scratch', { coupleId: 'c1', userId: 'u1', clientId: scratchTap }, 'u1');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.duplicate, true);
  assert.strictEqual(r.json.balance, coinsWon + scratchCoins);
  assert.strictEqual(db.coin_transactions.length, 2);
  console.log('ok  scratch retry / double tap is idempotent');

  // 7) Second scratch today -> rejected
  r = await call(server, 'POST', '/api/rewards/scratch', { coupleId: 'c1', userId: 'u1', clientId: 'scratch_tap_002' }, 'u1');
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.json.code, 'scratch_limit_reached');
  console.log('ok  second scratch on same day refused with scratch_limit_reached');

  // 8) Summary now shows 0 spins and 0 scratches available
  r = await call(server, 'GET', '/api/rewards/summary?coupleId=c1&userId=u1', null, 'u1');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.spinsAvailable, 0);
  assert.strictEqual(r.json.spunToday, true);
  assert.strictEqual(r.json.scratchesAvailable, 0);
  assert.strictEqual(r.json.scratchedToday, true);
  console.log('ok  summary reflects spunToday=true and scratchedToday=true');

  server.close();
  console.log('\nALL STEP 3 BACKEND TESTS PASSED');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
