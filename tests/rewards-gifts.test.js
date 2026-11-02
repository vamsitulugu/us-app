// Gift Shop server test with an in-memory fake Supabase.  Run: node tests/rewards-gifts.test.js
// (needs `express` — already a dependency of the app). No real database is touched.
const Module = require('module');
const path = require('path');
const assert = require('assert');
const http = require('http');
const express = require('express');

// ── fake database ──────────────────────────────────────────────
const db = { users: [], couples: [], reward_wallets: [], coin_transactions: [], reward_checkins: [], reward_config: [], chat_messages: [], gifts_sent: [] };
let nextId = 1;
function builder(table) {
  const st = { filters: [], mode: 'select', row: null, opts: null, single: false, maybe: false };
  const rows = () => db[table].filter(r => st.filters.every(f => f(r)));
  const run = () => {
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
    w.balance += a.p_amount; return { data: [{ applied: true, balance: w.balance }], error: null };
  },
};

// ── stub the app's own modules ─────────────────────────────────
const pushes = [];
const stubs = {
  '../middleware/supabase': fake,
  '../middleware/pro': { loadMember: async (req, coupleId) => { const u = db.users.find(x => x.id === req.get('x-user-id')); return u && String(u.couple_id) === String(coupleId) ? u : null; } },
  './presence': { isViewingChat: () => false },
  './auth': { sendPushToPartner: async (...a) => pushes.push(['web', ...a]), sendFCMToPartner: async (...a) => pushes.push(['fcm', ...a]) },
};
const orig = Module._load;
Module._load = function (req, parent, ...r) { return stubs[req] || orig.call(this, req, parent, ...r); };
const rewards = require('../routes/rewards.js');
// stubs stay active: notifyGift() requires "./auth" lazily

function call(server, method, url, body, uid) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const rq = http.request({ port: server.address().port, path: url, method, headers: { 'content-type': 'application/json', 'x-user-id': uid } }, rs => {
      let t = ''; rs.on('data', c => t += c); rs.on('end', () => resolve({ status: rs.statusCode, json: t ? JSON.parse(t) : {} }));
    });
    rq.on('error', reject); if (data) rq.write(data); rq.end();
  });
}

function fund(id, n) { let w = db.reward_wallets.find(x => x.user_id === id); if (!w) { w = { user_id: id, couple_id: 'c1', balance: 0, lifetime_earned: 0 }; db.reward_wallets.push(w); } w.balance = n; }
const wal = id => db.reward_wallets.find(x => x.user_id === id).balance;

(async () => {
  db.users.push({ id: 'u1', name: 'Ravi', role: 'user1', couple_id: 'c1' }, { id: 'u2', name: 'Sita', role: 'user2', couple_id: 'c1' }, { id: 'x9', name: 'Other', role: 'user1', couple_id: 'c2' });
  db.couples.push({ id: 'c1', paired: true, user1_name: 'Ravi', user2_name: 'Sita', user1_avatar: null, user2_avatar: null });
  const app = express(); app.use(express.json()); app.use('/api/rewards', rewards);
  const server = app.listen(0);
  const g = (cid, body, uid = 'u1') => call(server, 'POST', '/api/rewards/gift', { coupleId: 'c1', userId: uid, clientId: cid, ...body }, uid);

  // catalog
  let r = await call(server, 'GET', '/api/rewards/gifts?coupleId=c1&userId=u1', null, 'u1');
  assert.strictEqual(r.status, 200); assert.strictEqual(r.json.balance, 0); assert.ok(r.json.gifts.length >= 8);
  assert.ok(r.json.gifts.every(x => x.price > 0 && x.id && x.emoji));
  console.log('ok  catalog loads, balance 0');

  // wrong couple → refused
  r = await call(server, 'GET', '/api/rewards/gifts?coupleId=c1&userId=x9', null, 'x9'); assert.strictEqual(r.status, 403);
  console.log('ok  stranger refused');

  // not enough coins → 402, nothing sent, nothing charged
  r = await g('tap_000001', { giftId: 'rose' });
  assert.strictEqual(r.status, 402); assert.strictEqual(r.json.code, 'insufficient');
  assert.strictEqual(db.chat_messages.length, 0); assert.strictEqual(db.coin_transactions.length, 0);
  console.log('ok  too few coins → 402, no message, no charge');

  // fund wallet, buy a Rose (20)
  fund('u1', 50);
  r = await g('tap_000002', { giftId: 'rose' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json)); assert.strictEqual(r.json.balance, 30); assert.strictEqual(r.json.duplicate, false);
  assert.strictEqual(db.chat_messages.length, 1);
  const m = db.chat_messages[0];
  assert.strictEqual(m.type, 'gift'); assert.strictEqual(m.sender_role, 'user1'); assert.strictEqual(m.effect, 'hearts');
  assert.deepStrictEqual([m.media_meta.emoji, m.media_meta.name, m.media_meta.paid, m.media_meta.price], ['🌹', 'Rose', true, 20]);
  assert.strictEqual(db.gifts_sent.length, 1);
  await new Promise(r => setTimeout(r, 20));
  assert.strictEqual(pushes.length, 2); assert.ok(pushes[0][3].body.includes('Ravi sent you Rose'), pushes[0][3].body);
  console.log('ok  Rose bought: -20 coins, chat message + effect, push to partner');

  // same tap again (double tap / retry) → no second charge, no second message, no second push
  r = await g('tap_000002', { giftId: 'rose' });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.json.duplicate, true); assert.strictEqual(r.json.balance, 30);
  assert.strictEqual(db.chat_messages.length, 1); assert.strictEqual(db.coin_transactions.length, 1); assert.strictEqual(pushes.length, 2);
  console.log('ok  double tap / retry never charges or sends twice');

  // the app cannot choose the price
  r = await g('tap_000003', { giftId: 'ring', price: 1, amount: 1 });
  assert.strictEqual(r.status, 402);   // ring is 100, wallet 30
  console.log('ok  price comes from the server only');

  // unknown gift
  r = await g('tap_000004', { giftId: 'free-diamond' }); assert.strictEqual(r.status, 404);
  console.log('ok  unknown gift refused');

  // bad client id
  r = await g('x', { giftId: 'rose' }); assert.strictEqual(r.status, 400);
  console.log('ok  bad client id refused');

  // partner sends one back
  fund('u2', 10);
  r = await g('tap_000005', { giftId: 'chocolate' }, 'u2');
  assert.strictEqual(r.status, 200); assert.strictEqual(db.chat_messages[1].sender_role, 'user2'); assert.strictEqual(r.json.balance, 0);
  console.log('ok  partner can send one back (user2 → user1)');

  // not paired
  db.couples[0].paired = false; fund('u1', 99);
  r = await g('tap_000006', { giftId: 'kiss' }); assert.strictEqual(r.status, 409);
  assert.strictEqual(wal('u1'), 99);
  db.couples[0].paired = true;
  console.log('ok  unpaired couple refused before any charge');

  // catalog override from reward_config; disabled gift hidden
  db.reward_config.push({ key: 'gift_catalog', value: [{ id: 'rose', name: 'Rose', emoji: '🌹', price: 15, effect: 'hearts', tier: 'special' }, { id: 'cake', name: 'Cake', emoji: '🎂', price: 30, enabled: false }, { id: 'bad', name: 'x', emoji: 'y', price: -5 }] });
  r = await call(server, 'GET', '/api/rewards/gifts?coupleId=c1&userId=u1', null, 'u1');
  assert.deepStrictEqual(r.json.gifts.map(x => [x.id, x.price]), [['rose', 15]]);
  console.log('ok  reward_config can reprice / disable gifts (bad rows ignored)');

  // chat insert failure → coins refunded
  const before = wal('u1');
  const realFrom = fake.from;
  fake.from = t => { const b = realFrom(t); if (t === 'chat_messages') { b.upsert = () => ({ select: () => ({ single: async () => ({ data: null, error: new Error('db down') }) }) }); } return b; };
  r = await g('tap_000007', { giftId: 'rose' });
  fake.from = realFrom;
  assert.strictEqual(r.status, 500); assert.strictEqual(wal('u1'), before);
  assert.ok(db.coin_transactions.some(t => t.kind === 'gift_refund' && t.amount === 15));
  console.log('ok  chat failure → coins refunded');

  server.close(); console.log('\nALL GIFT SHOP TESTS PASSED');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
