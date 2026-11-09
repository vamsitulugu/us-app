// Run: node tests/canteen-order.test.js   (no database needed — Supabase is faked in memory)
const assert = require('assert');
const SID = '00000000-0000-4000-8000-000000000001';
const tables = {
  cinema_sessions: [{ id: SID, couple_id: 'C1', status: 'lobby' }],
  users: [{ id: 'U1', couple_id: 'C1', role: 'user1', account_status: 'active' }, { id: 'U2', couple_id: 'C1', role: 'user2', account_status: 'active' }],
  reward_wallets: [{ user_id: 'U1', balance: 40 }, { user_id: 'U2', balance: 0 }],
  coin_transactions: []
};
function query(table) {
  const filters = []; let maybe = false;
  const api = { select() { return api; }, eq(k, v) { filters.push(r => r[k] === v); return api; }, maybeSingle() { maybe = true; return api; },
    then(res, rej) { const m = tables[table].filter(r => filters.every(f => f(r))); return Promise.resolve({ data: maybe ? (m[0] || null) : m, error: null }).then(res, rej); } };
  return api;
}
const rpc = async (fn, a) => {   // same rules as reward_credit()
  const w = tables.reward_wallets.find(x => x.user_id === a.p_user);
  if (a.p_amount < 0 && w.balance + a.p_amount < 0) return { data: [{ applied: false, balance: w.balance }], error: null };
  if (tables.coin_transactions.some(t => t.user_id === a.p_user && t.idem_key === a.p_idem)) return { data: [{ applied: false, balance: w.balance }], error: null };
  tables.coin_transactions.push({ id: tables.coin_transactions.length + 1, user_id: a.p_user, idem_key: a.p_idem, amount: a.p_amount, kind: a.p_kind, meta: a.p_meta });
  w.balance += a.p_amount; return { data: [{ applied: true, balance: w.balance }], error: null };
};
const sbPath = require.resolve('../middleware/supabase');
require.cache[sbPath] = { id: sbPath, filename: sbPath, loaded: true, exports: { from: query, rpc } };
const authPath = require.resolve('../routes/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign(() => {}, {}) };
const libPath = require.resolve('../routes/movie-library');
require.cache[libPath] = { id: libPath, filename: libPath, loaded: true, exports: {} };

const express = require('express');
const app = express(); app.use(express.json()); app.use('/api/cinema', require('../routes/cinema'));
let base;
// like the real app: every wallet / order call carries the signed-in user's id in x-user-id (override with hdr; null = no header)
const call = async (m, u, b, hdr) => {
  const role = (b && b.role) || (u.match(/role=(\w+)/) || [])[1], uid = hdr === undefined ? ({ user1: 'U1', user2: 'U2' })[role] : hdr;
  const h = { 'content-type': 'application/json' }; if (uid) h['x-user-id'] = uid;
  const r = await fetch(base + u, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json() };
};
const order = (over = {}) => call('POST', `/api/cinema/${SID}/canteen/order`, { coupleId: 'C1', role: 'user1', clientId: 'order-aaaa-1', for: 'me',
  lines: [{ id: 'popcorn:Popcorn', qty: 1, sel: [[0], [1], []] }], ...over });   // Salted, Medium = 10 + 5 = 15 coins

(async () => {
  const srv = app.listen(0); base = 'http://127.0.0.1:' + srv.address().port;
  let ok = 0; const t = (n, f) => f().then(() => { ok++; console.log('  ✓', n); });
  await t('wallet shows the balance of the right person', async () => {
    const a = await call('GET', `/api/cinema/${SID}/wallet?coupleId=C1&role=user1`); assert.equal(a.j.balance, 40);
    const b = await call('GET', `/api/cinema/${SID}/wallet?coupleId=C1&role=user2`); assert.equal(b.j.balance, 0);
  });
  await t('other couples / wrong role cannot use the session', async () => {
    assert.equal((await call('GET', `/api/cinema/${SID}/wallet?coupleId=C2&role=user1`)).s, 404);
    assert.equal((await call('GET', `/api/cinema/${SID}/wallet?coupleId=C1&role=admin`)).s, 403);
  });
  await t('knowing the session id is not enough: no / wrong x-user-id is refused', async () => {
    assert.equal((await call('GET', `/api/cinema/${SID}/wallet?coupleId=C1&role=user1`, null, null)).s, 403);
    assert.equal((await call('GET', `/api/cinema/${SID}/wallet?coupleId=C1&role=user1`, null, 'U2')).s, 403);   // partner's id, wrong role
    assert.equal((await call('GET', `/api/cinema/${SID}/wallet?coupleId=C1&role=user1`, null, 'nobody')).s, 403);
    const r = await order({ clientId: 'order-noauth-9' }); assert.equal(r.s, 200); tables.reward_wallets[0].balance += 15;   // (control: signed-in order works; refund the 15 to keep later numbers)
    const bad = await call('POST', `/api/cinema/${SID}/canteen/order`, { coupleId: 'C1', role: 'user1', clientId: 'order-noauth-8', for: 'me', lines: [{ id: 'popcorn:Popcorn', qty: 1, sel: [[0], [1], []] }] }, null);
    assert.equal(bad.s, 403); assert.equal(tables.reward_wallets[0].balance, 40);
  });
  await t('an order is priced by the server and charged once', async () => {
    const r = await order(); assert.equal(r.s, 200); assert.equal(r.j.total, 15); assert.equal(r.j.balance, 25);
  });
  await t('the same tap twice never pays twice', async () => {
    const r = await order(); assert.equal(r.s, 200); assert.equal(r.j.duplicate, true); assert.equal(r.j.balance, 25);
  });
  await t('not enough coins -> 402 and nothing is charged', async () => {
    const r = await order({ clientId: 'order-bbbb-2', lines: [{ id: 'combo:Date Night Combo', qty: 1, sel: [[0], [0], [0], [0]] }] });
    assert.equal(r.s, 402); assert.equal(r.j.code, 'insufficient'); assert.equal(r.j.balance, 25); assert.equal(tables.reward_wallets[0].balance, 25);
  });
  await t('a partner with no coins cannot order', async () => {
    assert.equal((await order({ role: 'user2', clientId: 'order-cccc-3' })).s, 402);
  });
  await t('tampered orders are refused (no price from the client, bad options, bad item, bad quantity)', async () => {
    assert.equal((await order({ clientId: 'order-dddd-4', lines: [{ id: 'popcorn:Popcorn', qty: 1, sel: [[], [1], []] }] })).s, 400);   // required flavour missing
    assert.equal((await order({ clientId: 'order-dddd-5', lines: [{ id: 'popcorn:Popcorn', qty: 1, sel: [[99], [1], []] }] })).s, 400);
    assert.equal((await order({ clientId: 'order-dddd-6', lines: [{ id: 'fake:Item', qty: 1, sel: [] }] })).s, 400);
    assert.equal((await order({ clientId: 'order-dddd-7', lines: [{ id: 'popcorn:Popcorn', qty: -3, sel: [[0], [1], []] }] })).s, 400);
    assert.equal((await order({ clientId: 'x' })).s, 400);
    assert.equal(tables.reward_wallets[0].balance, 25);
  });
  await t('no orders once the movie has ended or expired', async () => {
    for (const st of ['ended', 'expired']) {
      tables.cinema_sessions[0].status = st;
      assert.equal((await order({ clientId: 'order-late-' + st })).s, 410);
    }
    assert.equal(tables.reward_wallets[0].balance, 25);
  });
  console.log(`\n${ok} passed`); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
