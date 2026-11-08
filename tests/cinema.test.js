// Run: node tests/cinema.test.js   (no database needed — Supabase is faked in memory)
const assert = require('assert');
const path = require('path');

/* ---- tiny in-memory Supabase fake (just what routes/cinema.js uses) ---- */
const tables = { cinema_sessions: [], watch_sessions: [], movie_favorites: [], couples: [{ id: 'C1', user1_name: 'Asha', user2_name: 'Ravi', user1_avatar: null, user2_avatar: null }] };
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

const libPath = require.resolve('../routes/movie-library');
require.cache[libPath] = { id: libPath, filename: libPath, loaded: true, exports: { signedPlaybackUrl: async (c, id) => id === 'M1' ? { url: 'https://r2.example/film.mp4?sig=1', title: 'Cloud Film', durationSec: 5400 } : null } };

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
  await t('movie lookup: nothing picked -> none', async () => {
    assert.equal((await call('GET', `/api/cinema/${sid}/movie?coupleId=C1&role=user2`)).j.mode, 'none');
  });
  await t('movie lookup: each phone has its own copy -> device (title + length)', async () => {
    tables.watch_sessions.push({ couple_id: 'C1', shared_movie_id: null, user1_movie_title: 'Titanic', user2_movie_title: 'Titanic', user1_duration_sec: 11640, user2_duration_sec: 11641 });
    const j = (await call('GET', `/api/cinema/${sid}/movie?coupleId=C1&role=user2`)).j;
    assert.deepEqual([j.mode, j.title, j.dur, j.url], ['device', 'Titanic', 11641, undefined]);
  });
  await t('movie lookup: shared cloud movie -> cloud with a signed url', async () => {
    Object.assign(tables.watch_sessions[0], { shared_movie_id: 'M1' });
    const j = (await call('GET', `/api/cinema/${sid}/movie?coupleId=C1&role=user1`)).j;
    assert.equal(j.mode, 'cloud'); assert.ok(j.url.startsWith('https://r2.example/')); assert.equal(j.title, 'Titanic');
  });
  await t('movie lookup: a missing cloud movie falls back to device; other couples get nothing', async () => {
    tables.watch_sessions[0].shared_movie_id = 'GONE';
    assert.equal((await call('GET', `/api/cinema/${sid}/movie?coupleId=C1&role=user1`)).j.mode, 'device');
    assert.equal((await call('GET', `/api/cinema/${sid}/movie?coupleId=OTHER&role=user1`)).s, 404);
  });
  await t('library: no movies -> empty list; own movies newest first with all details; other couples blocked', async () => {
    assert.deepEqual((await call('GET', `/api/cinema/${sid}/library?coupleId=C1`)).j.movies, []);
    tables.movie_favorites.push(
      { id: 'F1', couple_id: 'C1', title: 'La La Land', year: '2016', genre: 'Romance', poster_url: 'https://image.tmdb.org/t/p/w500/a.jpg', backdrop_url: null, overview: 'Dreamers.', rating: 8.1, status: 'watchlist', created_at: '2026-01-01T00:00:00Z' },
      { id: 'F2', couple_id: 'C1', title: 'Before Sunrise', year: null, genre: null, poster_url: null, backdrop_url: null, overview: null, rating: null, status: 'watched', created_at: '2026-02-01T00:00:00Z' },
      { id: 'F3', couple_id: 'OTHER', title: 'Not yours', created_at: '2026-03-01T00:00:00Z' });
    const r = await call('GET', `/api/cinema/${sid}/library?coupleId=C1`);
    assert.equal(r.s, 200); assert.deepEqual(r.j.movies.map(m => m.title), ['Before Sunrise', 'La La Land']);
    assert.deepEqual([r.j.movies[1].year, r.j.movies[1].genre, r.j.movies[1].posterUrl, r.j.movies[1].overview, r.j.movies[1].rating, r.j.movies[1].status], ['2016', 'Romance', 'https://image.tmdb.org/t/p/w500/a.jpg', 'Dreamers.', 8.1, 'watchlist']);
    assert.equal((await call('GET', `/api/cinema/${sid}/library?coupleId=OTHER`)).s, 404);
    assert.equal((await call('GET', '/api/cinema/not-a-uuid/library?coupleId=C1')).s, 400);
  });
  await t('bad ids and solo accounts are rejected', async () => {
    assert.equal((await call('GET', '/api/cinema/not-a-uuid?coupleId=C1')).s, 400);
    assert.equal((await call('POST', '/api/cinema/create', { coupleId: 'solo_1', role: 'user1' })).s, 400);
  });
  console.log(`\n${ok} passed`); srv.close(); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
