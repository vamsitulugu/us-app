// Game scratch cards server test with an in-memory fake Supabase. Run: node tests/rewards-cards.test.js
const Module = require('module');
const assert = require('assert');
const http = require('http');
const express = require('express');

const db = { users: [], couples: [], reward_wallets: [], coin_transactions: [], reward_config: [], reward_cards: [] };
let nextId = 1;
function builder(table) {
  if (!db[table]) db[table] = [];
  const st = { filters: [], mode: 'select', row: null, opts: null, head: false, count: false };
  const rows = () => db[table].filter(r => st.filters.every(f => f(r)));
  const run = (one) => {
    if (st.mode === 'insert') {
      if (table === 'reward_cards' && db[table].find(r => r.user_id === st.row.user_id && r.session_id === st.row.session_id)) {
        return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
      }
      const row = { id: nextId++, status: 'new', skipped: false, created_at: new Date().toISOString(), ...st.row };
      db[table].push(row); return { data: row, error: null };
    }
    if (st.mode === 'update') {
      const list = rows(); list.forEach(r => Object.assign(r, st.row));
      return { data: one ? (list[0] || null) : list, error: null };
    }
    const list = rows();
    if (st.count) return { data: st.head ? null : list, count: list.length, error: null };
    return { data: one ? (list[0] || null) : list, error: null };
  };
  const b = {
    select(_c, o) { if (o && o.count) { st.count = true; st.head = !!o.head; } return b; },
    order() { return b; }, limit() { return b; },
    eq(k, v) { st.filters.push(r => String(r[k]) === String(v)); return b; },
    gte(k, v) { st.filters.push(r => r[k] >= v); return b; },
    insert(row) { st.mode = 'insert'; st.row = row; return Promise.resolve(run()); },
    update(row) { st.mode = 'update'; st.row = row; return b; },
    maybeSingle() { return Promise.resolve(run(true)); },
    then(res, rej) { return Promise.resolve(run(false)).then(res, rej); },
  };
  return b;
}
const fake = {
  from: builder,
  rpc: async (name, a) => {
    let w = db.reward_wallets.find(x => x.user_id === a.p_user);
    if (!w) { w = { user_id: a.p_user, balance: 0 }; db.reward_wallets.push(w); }
    if (db.coin_transactions.find(t => t.user_id === a.p_user && t.idem_key === a.p_idem)) return { data: [{ applied: false, balance: w.balance }], error: null };
    db.coin_transactions.push({ user_id: a.p_user, amount: a.p_amount, idem_key: a.p_idem });
    w.balance += a.p_amount;
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
const cards = require('../routes/rewards-cards.js');

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
  db.users.push({ id: 'u1', couple_id: 'c1' }, { id: 'u2', couple_id: 'c1' });
  db.couples.push({ id: 'c1', paired: true });
  db.reward_config.push({ key: 'card_rules', value: { daily: 3, minGapSeconds: 0 } });
  const app = express(); app.use(express.json()); app.use('/api/rewards/cards', cards);
  const server = app.listen(0);
  const P = '/api/rewards/cards';

  let r = await call(server, 'POST', P + '/grant', { coupleId: 'c1', game: 'ludo', sessionId: 'ludo_session_1' }, 'u1');
  assert.strictEqual(r.json.granted, true);
  assert.strictEqual(db.reward_cards.length, 2);
  console.log('ok  one finished game puts a card in BOTH partners\' pages');

  r = await call(server, 'POST', P + '/grant', { coupleId: 'c1', game: 'ludo', sessionId: 'ludo_session_1' }, 'u1');
  assert.strictEqual(r.json.granted, false); assert.strictEqual(db.reward_cards.length, 2);
  console.log('ok  same game reported twice does not give extra cards');

  r = await call(server, 'GET', P + '?coupleId=c1', null, 'u2');
  assert.strictEqual(r.json.count, 1); assert.strictEqual(r.json.cards[0].game, 'ludo');
  console.log('ok  partner sees the unscratched card');

  const id = r.json.cards[0].id;
  r = await call(server, 'POST', P + '/open', { coupleId: 'c1', cardId: id, skip: true }, 'u2');
  assert.strictEqual(r.json.ok, true); assert.ok(r.json.coins > 0); assert.strictEqual(r.json.skipped, true);
  assert.strictEqual(r.json.balance, r.json.coins); assert.strictEqual(r.json.cardsLeft, 0);
  const won = r.json.coins;
  console.log('ok  Skip opens the card and pays ' + won + ' coins');

  r = await call(server, 'POST', P + '/open', { coupleId: 'c1', cardId: id }, 'u2');
  assert.strictEqual(r.json.duplicate, true); assert.strictEqual(r.json.balance, won);
  assert.strictEqual(db.coin_transactions.length, 1);
  console.log('ok  opening the same card twice never pays twice');

  const other = db.reward_cards.find(c => c.user_id === 'u1').id;
  r = await call(server, 'POST', P + '/open', { coupleId: 'c1', cardId: other }, 'u2');
  assert.strictEqual(r.status, 404);
  console.log('ok  you cannot open your partner\'s card');

  await call(server, 'POST', P + '/grant', { coupleId: 'c1', game: 'ttt', sessionId: 'ttt_session_2' }, 'u1');
  await call(server, 'POST', P + '/grant', { coupleId: 'c1', game: 'draw', sessionId: 'draw_session_3' }, 'u1');
  r = await call(server, 'POST', P + '/grant', { coupleId: 'c1', game: 'memory', sessionId: 'mem_session_4' }, 'u1');
  assert.strictEqual(r.json.granted, false); assert.strictEqual(r.json.reason, 'daily_limit');
  console.log('ok  daily limit stops card farming');

  db.couples[0].paired = false;
  r = await call(server, 'POST', P + '/grant', { coupleId: 'c1', game: 'ttt', sessionId: 'ttt_session_9' }, 'u1');
  assert.strictEqual(r.json.granted, false); assert.strictEqual(r.json.reason, 'not_paired');
  console.log('ok  no card without two paired people');

  r = await call(server, 'GET', P + '?coupleId=c1', null, 'stranger');
  assert.strictEqual(r.status, 403);
  console.log('ok  strangers are refused');
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
