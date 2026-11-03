// Access passes (free daily uses + coin pass) server test with an in-memory fake Supabase. Run: node tests/rewards-spend.test.js
const Module = require('module');
const assert = require('assert');
const http = require('http');
const express = require('express');

// ── fake database ──────────────────────────────────────────────
const db = {
  users: [], couples: [], reward_wallets: [], coin_transactions: [],
  reward_checkins: [], reward_config: [], chat_messages: [], gifts_sent: [],
  reward_spins: [], reward_scratches: [], reward_access: [],
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
  '../middleware/pro': { getProStatus: async (id) => ({ isPro: !!(db.couples.find(c => c.id === id) || {}).isPro }), loadMember: async (req, coupleId) => { const u = db.users.find(x => x.id === req.get('x-user-id')); return u && String(u.couple_id) === String(coupleId) ? u : null; } },
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
  db.users.push({ id: 'u1', couple_id: 'c1' }, { id: 'u2', couple_id: 'c1' }, { id: 'u3', couple_id: 'c2' });
  db.couples.push({ id: 'c1' }, { id: 'c2', isPro: true });
  const app = express(); app.use(express.json()); app.use('/api/rewards', rewards);
  const server = app.listen(0);
  const P = (uid, cid, path, body) => call(server, 'POST', '/api/rewards/' + path, { coupleId: cid, userId: uid, ...body }, uid);
  const bal = u => (db.reward_wallets.find(w => w.user_id === u) || { balance: 0 }).balance;
  const give = (u, n) => { const w = db.reward_wallets.find(x => x.user_id === u); if (w) w.balance = n; else db.reward_wallets.push({ user_id: u, couple_id: 'c1', balance: n, lifetime_earned: n }); };

  // movie: 1 free a day, then a 20-coin pass
  let r = await P('u1', 'c1', 'access/use', { feature: 'movie' });
  assert.strictEqual(r.json.allowed, true); assert.strictEqual(r.json.via, 'free'); assert.strictEqual(r.json.freeLeft, 0);
  r = await P('u1', 'c1', 'access/use', { feature: 'movie' });
  assert.strictEqual(r.json.allowed, false); assert.strictEqual(r.json.needsCoins, true);
  assert.strictEqual(r.json.price, 20); assert.strictEqual(r.json.hours, 12);
  console.log('ok  movie: first one free, second asks for the pass');

  // songs: 5 free
  for (let i = 0; i < 5; i++) { r = await P('u1', 'c1', 'access/use', { feature: 'songs' }); assert.strictEqual(r.json.via, 'free'); }
  assert.strictEqual(r.json.freeLeft, 0);
  r = await P('u1', 'c1', 'access/use', { feature: 'songs' });
  assert.strictEqual(r.json.needsCoins, true); assert.strictEqual(r.json.price, 10);
  console.log('ok  songs: 5 free, then asks once');

  r = await P('u1', 'c1', 'access/use', { feature: 'hack' });
  assert.strictEqual(r.status, 400);
  console.log('ok  unknown feature refused');

  // buy with too few coins
  give('u1', 5);
  r = await P('u1', 'c1', 'access/pass', { feature: 'movie', clientId: 'pass_movie_001' });
  assert.strictEqual(r.status, 402); assert.strictEqual(r.json.code, 'not_enough_coins'); assert.strictEqual(bal('u1'), 5);
  assert.strictEqual(db.reward_access.filter(a => a.kind === 'pass').length, 0);
  console.log('ok  pass with too few coins: refused, nothing charged');

  // buy for real
  give('u1', 50);
  r = await P('u1', 'c1', 'access/pass', { feature: 'movie', clientId: 'pass_movie_002' });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.json.duplicate, false);
  assert.strictEqual(bal('u1'), 30);
  const left = Date.parse(r.json.expiresAt) - Date.now();
  assert.ok(left > 11.9 * 3600000 && left <= 12 * 3600000 + 1000);
  console.log('ok  pass bought: 20 coins taken once, runs 12 hours');

  // retry / second tap must not charge again
  r = await P('u1', 'c1', 'access/pass', { feature: 'movie', clientId: 'pass_movie_003' });
  assert.strictEqual(r.json.duplicate, true); assert.strictEqual(bal('u1'), 30);
  console.log('ok  second tap while a pass runs is free (no double charge)');

  // everyone in the couple rides the pass, nobody is asked again
  for (const u of ['u1', 'u2']) { r = await P(u, 'c1', 'access/use', { feature: 'movie' }); assert.strictEqual(r.json.via, 'pass'); }
  console.log('ok  both partners ride the pass, no more asking');

  // other features are not unlocked by the movie pass
  r = await P('u2', 'c1', 'access/use', { feature: 'games' });
  assert.strictEqual(r.json.via, 'free');
  console.log('ok  movie pass does not unlock games');

  // expired pass asks again
  db.reward_access.filter(a => a.kind === 'pass').forEach(a => { a.expires_at = new Date(Date.now() - 1000).toISOString(); });
  r = await P('u1', 'c1', 'access/use', { feature: 'movie' });
  assert.strictEqual(r.json.needsCoins, true);
  console.log('ok  expired pass asks again');

  // idempotent retry of the very same purchase
  give('u1', 50);
  r = await P('u1', 'c1', 'access/pass', { feature: 'pins', clientId: 'pass_pins_0001' });
  assert.strictEqual(r.status, 200); const afterBuy = bal('u1');
  db.reward_access.length = 0;
  r = await P('u1', 'c1', 'access/pass', { feature: 'pins', clientId: 'pass_pins_0001' });
  assert.strictEqual(r.status, 200); assert.strictEqual(bal('u1'), afterBuy);
  console.log('ok  same purchase retried: charged only once');

  // Pro couples are never asked
  r = await P('u3', 'c2', 'access/use', { feature: 'movie' }); assert.strictEqual(r.json.via, 'pro');
  r = await P('u3', 'c2', 'access/use', { feature: 'movie' }); assert.strictEqual(r.json.via, 'pro');
  console.log('ok  Pro couple: always allowed');

  // wrong couple refused
  r = await P('u3', 'c1', 'access/use', { feature: 'movie' }); assert.strictEqual(r.status, 403);
  console.log('ok  someone from another couple refused');

  // status
  r = await call(server, 'GET', '/api/rewards/access/status?coupleId=c1&userId=u2', null, 'u2');
  assert.strictEqual(r.status, 200); assert.strictEqual(r.json.features.songs.free, 5);
  console.log('ok  status lists every feature');

  // rule overrides are validated
  const c = rewards._test.cleanAccessRules({ movie: { free: 2, price: 30, hours: 6 }, songs: { free: -1, price: 'x', hours: 999 } });
  assert.deepStrictEqual(c.movie, { free: 2, price: 30, hours: 6 });
  assert.deepStrictEqual(c.songs, rewards._test.DEFAULT_ACCESS_RULES.songs);
  console.log('ok  access_rules overrides are validated');

  server.close();
  console.log('\nALL ACCESS PASS TESTS PASSED');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
