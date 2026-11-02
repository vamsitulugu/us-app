// Twin Store server test with an in-memory fake Supabase. Run: node tests/rewards-store.test.js
const Module = require('module');
const assert = require('assert');
const http = require('http');
const express = require('express');

// ── fake database ──────────────────────────────────────────────
const db = {
  users: [], couples: [], reward_wallets: [], coin_transactions: [],
  reward_checkins: [], reward_config: [], chat_messages: [], gifts_sent: [],
  reward_spins: [], reward_scratches: [], reward_purchases: [], reward_equipped: [],
};
let nextId = 1;
function builder(table) {
  if (!db[table]) db[table] = [];
  const st = { filters: [], mode: 'select', row: null, opts: null, single: false, maybe: false };
  const rows = () => db[table].filter(r => st.filters.every(f => f(r)));
  const run = () => {
    if (st.mode === 'insert' || st.mode === 'upsert') {
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

function fund(id, amount) {
  let w = db.reward_wallets.find(x => x.user_id === id);
  if (!w) { w = { user_id: id, couple_id: 'c1', balance: 0, lifetime_earned: 0 }; db.reward_wallets.push(w); }
  w.balance = amount;
}

(async () => {
  db.users.push({ id: 'u1', name: 'Ravi', role: 'user1', couple_id: 'c1' }, { id: 'u2', name: 'Sita', role: 'user2', couple_id: 'c1' });
  db.couples.push({ id: 'c1', paired: true, user1_name: 'Ravi', user2_name: 'Sita' });
  const app = express(); app.use(express.json()); app.use('/api/rewards', rewards);
  const server = app.listen(0);

  // 1) Load store catalog
  let r = await call(server, 'GET', '/api/rewards/store?coupleId=c1&userId=u1', null, 'u1');
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.items.length >= 10);
  assert.strictEqual(r.json.unlockedItemIds.length, 0);
  console.log('ok  Twin Store catalog loaded (' + r.json.items.length + ' items)');

  // 2) Buy without coins -> 402 Insufficient
  r = await call(server, 'POST', '/api/rewards/buy', { coupleId: 'c1', userId: 'u1', itemId: 'theme_sunset', clientId: 'buy_001' }, 'u1');
  assert.strictEqual(r.status, 402);
  assert.strictEqual(r.json.code, 'insufficient');
  console.log('ok  insufficient coins returns 402');

  // 3) Fund wallet, buy Sunset theme (100 coins)
  fund('u1', 250);
  r = await call(server, 'POST', '/api/rewards/buy', { coupleId: 'c1', userId: 'u1', itemId: 'theme_sunset', clientId: 'buy_001' }, 'u1');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.ok, true);
  assert.strictEqual(r.json.duplicate, false);
  assert.strictEqual(r.json.balance, 150);
  assert.ok(r.json.unlockedItemIds.includes('theme_sunset'));
  console.log('ok  bought theme_sunset: -100 coins, balance 150, unlocked');

  // 4) Duplicate tap -> idempotent
  r = await call(server, 'POST', '/api/rewards/buy', { coupleId: 'c1', userId: 'u1', itemId: 'theme_sunset', clientId: 'buy_001' }, 'u1');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.duplicate, true);
  assert.strictEqual(r.json.balance, 150);
  console.log('ok  buy retry is idempotent');

  // 5) Equip unlocked theme
  r = await call(server, 'POST', '/api/rewards/store/equip', { coupleId: 'c1', userId: 'u1', category: 'theme', itemId: 'theme_sunset' }, 'u1');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.ok, true);
  assert.strictEqual(r.json.itemId, 'theme_sunset');
  console.log('ok  equipped theme_sunset');

  // 6) Equip locked item -> 403 refused
  r = await call(server, 'POST', '/api/rewards/store/equip', { coupleId: 'c1', userId: 'u1', category: 'theme', itemId: 'theme_midnight' }, 'u1');
  assert.strictEqual(r.status, 403);
  console.log('ok  equipping locked item refused (403)');

  // 7) Summary includes unlockedItemIds
  r = await call(server, 'GET', '/api/rewards/summary?coupleId=c1&userId=u1', null, 'u1');
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.unlockedItemIds.includes('theme_sunset'));
  assert.strictEqual(r.json.equipped.theme, 'theme_sunset');
  console.log('ok  summary reports unlockedItemIds and equipped theme');

  server.close();
  console.log('\nALL STEP 4 BACKEND TESTS PASSED');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
