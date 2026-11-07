// Run: node tests/cinema.test.js   (no database needed — Supabase is faked in memory)
const assert = require('assert');
const path = require('path');

/* ---- tiny in-memory Supabase fake (just what routes/cinema.js uses) ---- */
const tables = { cinema_sessions: [], couples: [{ id: 'C1', user1_name: 'Asha', user2_name: 'Ravi', user1_avatar: null, user2_avatar: null }] };
let idn = 0;
function query(table) {
  let rows = tables[table], op = 'select', patch = null, filters = [], lim = null, single = false, maybe = false, ord = null;
  const api = {
    select() { return api; },
    insert(v) { op = 'insert'; patch = v; return api; },
    update(v) { op = 'update'; patch = v; return api; },
    eq(k, v) { filters.push(r => r[k] === v); return api; },
    in(k, a) { filters.push(r => a.includes(r[k])); return api; },
    gt(k, v) { filters.push(r => r[k] > v); return api; },
    order(k, o) { ord = [k, o.ascending]; return api; },
    limit(n) { lim = n; return api; },
    single() { single = true; return api; },
    maybeSingle() { maybe = true; return api; },
    then(res, rej) { return Promise.resolve(run()).then(res, rej); }
  };
  function run() {
    let m = rows.filter(r => filters.every(f => f(r)));
    if (op === 'insert') {
      const row = { id: '00000000-0000-4000-8000-' + String(++idn).padStart(12, '0'), status: 'lobby', created_at: new Date().toISOString(),
        invited_at: null, expires_at: new Date(Date.now() + 7200e3).toISOString(), ...patch };
      rows.push(row); m = [row];
    } else if (op === 'update') { m.forEach(r => Object.assign(r, patch)); }
    if (ord) m = m.slice().sort((a, b) => (a[ord[0]] > b[ord[0]] ? 1 : -1) * (ord[1] ? 1 : -1));
    if (lim) m = m.slice(0, lim);
    if (single || maybe) return { data: m[0] || null, error: null };
    return { data: m, error: null };
  }
  return api;
}
const sbPath = require.resolve('../middleware/supabase');
require.cache[sbPath] = { id: sbPath, filename: sbPath, loaded: true, exports: { from: query } };
const authPath = require.resolve('../routes/auth');
const pushes = [];
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign(() => {}, {
  sendPushToPartner: async (c, r, p) => pushes.push(['web', c, r, p.tag]), sendFCMToPartner: async (c, r, p) => pushes.push(['fcm', c, r, p.tag]) }) };

const express = require('express');
const app = express(); app.use(express.json()); app.use('/api/cinema', require('../routes/cinema'));
let base;
const call = async (m, u, b) => { const r = await fetch(base + u, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json() }; };

(async () => {
  const srv = app.listen(0); base = 'http://127.0.0.1:' + srv.address().port;
  let ok = 0; const t = (n, f) => f().then(() => { ok++; console.log('  ✓', n); });

  let sid;
  await t('host creates a session and gets a cinema url with their avatar', async () => {
    const r = await call('POST', '/api/cinema/create', { coupleId: 'C1', role: 'user1', slot: 1, movie: 'Titanic' });
    assert.equal(r.s, 200); sid = r.j.session.id;
    assert.ok(r.j.url.includes('#') && !r.j.url.includes('?') && r.j.url.includes('r=1') && r.j.url.includes('s='+sid) && r.j.url.includes('n=Asha') && r.j.url.includes('c=C1') && r.j.url.includes('u=user1'));
  });
  await t('double tap reuses the same session', async () => {
    const r = await call('POST', '/api/cinema/create', { coupleId: 'C1', role: 'user1', slot: 1 });
    assert.equal(r.j.session.id, sid); assert.equal(tables.cinema_sessions.length, 1);
  });
  await t('partner sees nothing before the invite', async () => {
    assert.equal((await call('GET', '/api/cinema/pending/C1?role=user2')).j.invite, null);
  });
  await t('only the host can invite; partner gets card + push', async () => {
    assert.equal((await call('POST', `/api/cinema/${sid}/invite`, { coupleId: 'C1', role: 'user2' })).s, 403);
    assert.equal((await call('POST', `/api/cinema/${sid}/invite`, { coupleId: 'C1', role: 'user1' })).s, 200);
    const p = (await call('GET', '/api/cinema/pending/C1?role=user2')).j.invite;
    assert.equal(p.id, sid); assert.equal(p.hostName, 'Asha'); assert.equal(p.movie, 'Titanic');
    assert.ok(pushes.some(x => x[0] === 'web' && x[3] === 'cinema-invite'));
    assert.equal((await call('GET', '/api/cinema/pending/C1?role=user1')).j.invite, null);   // host doesn't get their own invite
  });
  await t('another couple cannot read, accept or invite', async () => {
    assert.equal((await call('GET', `/api/cinema/${sid}?coupleId=OTHER`)).s, 404);
    assert.equal((await call('POST', `/api/cinema/${sid}/accept`, { coupleId: 'OTHER', role: 'user2' })).s, 404);
    assert.equal((await call('GET', '/api/cinema/pending/OTHER?role=user2')).j.invite, null);
  });
  await t('host cannot accept their own invite', async () => {
    assert.equal((await call('POST', `/api/cinema/${sid}/accept`, { coupleId: 'C1', role: 'user1' })).s, 403);
  });
  await t('decline is seen by the host, and the host can re-invite', async () => {
    await call('POST', `/api/cinema/${sid}/decline`, { coupleId: 'C1', role: 'user2' });
    assert.equal((await call('GET', `/api/cinema/${sid}?coupleId=C1`)).j.status, 'declined');
    assert.equal((await call('POST', `/api/cinema/${sid}/accept`, { coupleId: 'C1', role: 'user2' })).s, 409);
    await call('POST', `/api/cinema/${sid}/invite`, { coupleId: 'C1', role: 'user1' });
    assert.equal((await call('GET', `/api/cinema/${sid}?coupleId=C1`)).j.status, 'invited');
  });
  await t('accept returns the OTHER avatar and marks accepted', async () => {
    const r = await call('POST', `/api/cinema/${sid}/accept`, { coupleId: 'C1', role: 'user2' });
    assert.equal(r.s, 200); assert.ok(r.j.url.includes('r=2') && r.j.url.includes('n=Ravi') && r.j.url.includes('s='+sid) && r.j.url.includes('u=user2'));
    assert.equal((await call('GET', `/api/cinema/${sid}?coupleId=C1`)).j.status, 'accepted');
    assert.equal((await call('GET', '/api/cinema/pending/C1?role=user2')).j.invite, null);
  });
  await t('an invite older than 10 minutes expires', async () => {
    tables.cinema_sessions[0].status = 'invited';
    tables.cinema_sessions[0].invited_at = new Date(Date.now() - 11 * 60e3).toISOString();
    assert.equal((await call('GET', '/api/cinema/pending/C1?role=user2')).j.invite, null);
    assert.equal((await call('POST', `/api/cinema/${sid}/accept`, { coupleId: 'C1', role: 'user2' })).s, 410);
  });
  await t('bad ids and solo accounts are rejected', async () => {
    assert.equal((await call('GET', '/api/cinema/not-a-uuid?coupleId=C1')).s, 400);
    assert.equal((await call('POST', '/api/cinema/create', { coupleId: 'solo_1', role: 'user1' })).s, 400);
  });
  console.log(`\n${ok} passed`); srv.close(); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
