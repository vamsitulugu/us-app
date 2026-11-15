// Run: node tests/cinema.test.js   (no database needed — Supabase is faked in memory)
const assert = require('assert');
const path = require('path');

/* ---- tiny in-memory Supabase fake (just what routes/cinema.js uses) ---- */
const tables = { cinema_sessions: [], watch_sessions: [], movie_favorites: [], couples: [{ id: 'C1', user1_name: 'Asha', user2_name: 'Ravi', user1_avatar: null, user2_avatar: null }] };
let idn = 0, jitter = false;      // jitter = random latency per query, so two requests really interleave like a network database
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
    then(res, rej) { return (jitter ? new Promise(r => setTimeout(r, Math.random() * 6)) : Promise.resolve()).then(run).then(res, rej); }
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
require.cache[libPath] = { id: libPath, filename: libPath, loaded: true, exports: { cinema: { calls: [], async init(c, r, b) { this.calls.push(['init', c, r, b.size]); return b.size > 5e9 ? { status: 413, body: { error: 'too large', code: 'TOO_LARGE' } } : { status: 200, body: { movieId: 'MX', partSize: 16777216, totalParts: 2 } }; }, async parts(c, id, n) { this.calls.push(['parts', c, id, n]); return { status: 200, body: { urls: { 1: 'https://r2.example/put1' } } }; }, async complete(c, id, p) { this.calls.push(['complete', c, id, p.length]); tables.watch_sessions.find(w => w.couple_id === c).shared_movie_id = 'M1'; return { status: 200, body: { ok: true, movieId: id } }; }, async abort() { return { status: 200, body: { ok: true } }; } }, listReady: async c => c === 'C1' ? [{ id: 'M1', title: 'Cloud Film', durationSec: 5400, sizeBytes: 1e9 }] : [], signedPlaybackUrl: async (c, id) => id === 'M1' ? { url: 'https://r2.example/film.mp4?sig=1', title: 'Cloud Film', durationSec: 5400 } : null } };

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
    // the partner can get back in after Accept (rejoin card), it is not hidden any more
    const p = (await call('GET', '/api/cinema/pending/C1?role=user2')).j.invite;
    assert.ok(p && p.id === sid && p.status === 'accepted');
  });
  await t('rejoin mid-movie: partner still sees the session, host /create reuses it', async () => {
    await call('POST', `/api/cinema/${sid}/status`, { coupleId: 'C1', role: 'user1', status: 'started' });
    const p = (await call('GET', '/api/cinema/pending/C1?role=user2')).j.invite;
    assert.ok(p && p.id === sid && p.status === 'started');
    assert.equal((await call('POST', `/api/cinema/${sid}/accept`, { coupleId: 'C1', role: 'user2' })).s, 200);   // rejoin returns a URL, status stays started
    const c = await call('POST', '/api/cinema/create', { coupleId: 'C1', role: 'user1', slot: 1 });
    assert.equal(c.j.session.id, sid); assert.equal(tables.cinema_sessions.length, 1);   // same room, no second session
    tables.cinema_sessions[0].status = 'accepted';
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
  await t('auto-share: guarded by session + couple + role, then init / parts / complete; the room then answers cloud for BOTH phones', async () => {
    const lib = require('../routes/movie-library').cinema; lib.calls.length = 0;
    tables.watch_sessions.length = 0; tables.watch_sessions.push({ couple_id: 'C1', user1_movie_title: 'Film', user1_duration_sec: 5400, user2_duration_sec: 5400, shared_movie_id: null });
    assert.equal((await call('POST', `/api/cinema/${sid}/share/init`, { coupleId: 'OTHER', role: 'user1', size: 1e6 })).s, 404);       // other couples
    assert.equal((await call('POST', `/api/cinema/${sid}/share/init`, { coupleId: 'C1', role: 'admin', size: 1e6 })).s, 400);          // bad role
    assert.equal((await call('POST', '/api/cinema/not-a-uuid/share/init', { coupleId: 'C1', role: 'user1' })).s, 400);
    assert.equal((await call('POST', `/api/cinema/${sid}/share/init`, { coupleId: 'C1', role: 'user2', size: 6e9, durationSec: 5400 })).j.code, 'TOO_LARGE');
    const i = await call('POST', `/api/cinema/${sid}/share/init`, { coupleId: 'C1', role: 'user2', title: 'Film', size: 20e6, mime: 'video/mp4', durationSec: 5400 });
    assert.equal(i.s, 200); assert.equal(i.j.movieId, 'MX');
    assert.equal((await call('POST', `/api/cinema/${sid}/share/MX/parts`, { coupleId: 'C1', role: 'user2', partNumbers: [1] })).j.urls[1], 'https://r2.example/put1');
    // before the upload finishes the phones still get "device"; after it, both get the signed cloud url
    assert.equal((await call('GET', `/api/cinema/${sid}/movie?coupleId=C1&role=user1`)).j.mode, 'device');
    assert.equal((await call('POST', `/api/cinema/${sid}/share/MX/complete`, { coupleId: 'C1', role: 'user2', parts: [{ PartNumber: 1, ETag: 'a' }, { PartNumber: 2, ETag: 'b' }] })).s, 200);
    for (const role of ['user1', 'user2']) { const m = (await call('GET', `/api/cinema/${sid}/movie?coupleId=C1&role=${role}`)).j; assert.equal(m.mode, 'cloud'); assert.ok(m.url.startsWith('https://r2.example/')); }
  });
  await t('cinema cloud picker: lists the couple\'s ready movies and gives each phone a fresh signed url; other couples / unknown movies are refused', async () => {
    const l = await call('GET', `/api/cinema/${sid}/cloud?coupleId=C1&role=user2`);
    assert.equal(l.s, 200); assert.deepEqual(l.j.movies.map(m => [m.id, m.title, m.durationSec]), [['M1', 'Cloud Film', 5400]]);
    const u = await call('GET', `/api/cinema/${sid}/cloud/M1/url?coupleId=C1&role=user2`);
    assert.equal(u.s, 200); assert.ok(u.j.url.startsWith('https://r2.example/')); assert.equal(u.j.title, 'Cloud Film');
    assert.equal((await call('GET', `/api/cinema/${sid}/cloud/GONE/url?coupleId=C1&role=user1`)).s, 404);
    assert.equal((await call('GET', `/api/cinema/${sid}/cloud?coupleId=OTHER&role=user1`)).s, 404);
    assert.equal((await call('GET', `/api/cinema/${sid}/cloud?coupleId=C1`)).s, 400);
  });
  await t('bad ids and solo accounts are rejected', async () => {
    assert.equal((await call('GET', '/api/cinema/not-a-uuid?coupleId=C1')).s, 400);
    assert.equal((await call('POST', '/api/cinema/create', { coupleId: 'solo_1', role: 'user1' })).s, 400);
  });

  /* ---- both partners entering the cinema (the "one sees Invite, the other sees Waiting" bug) ---- */
  const reset = () => { tables.cinema_sessions.length = 0; };
  const live = () => tables.cinema_sessions.filter(r => !['ended', 'expired'].includes(r.status));
  await t('both open the cinema at the SAME moment: one room, one host, one guest (no invite needed)', async () => {
    reset();
    const [a, b] = await Promise.all([
      call('POST', '/api/cinema/create', { coupleId: 'C1', role: 'user1', slot: 1 }),
      call('POST', '/api/cinema/create', { coupleId: 'C1', role: 'user2', slot: 2 })]);
    assert.equal(a.s, 200); assert.equal(b.s, 200);
    assert.equal(a.j.session.id, b.j.session.id, 'both phones must land in the same session');
    assert.equal(live().length, 1, 'exactly one live row');
    assert.deepEqual([a.j.role, b.j.role].sort(), ['guest', 'host']);
    const host = a.j.role === 'host' ? a : b, guest = a.j.role === 'host' ? b : a;
    assert.ok(host.j.url.includes('h=1') && guest.j.url.includes('h=0'));
    assert.notEqual(new URLSearchParams(host.j.url.split('#')[1]).get('r'), new URLSearchParams(guest.j.url.split('#')[1]).get('r'), 'different avatars');
  });
  await t('partner opens the cinema while the other is already in the lobby: joins as guest straight away', async () => {
    reset();
    const h = await call('POST', '/api/cinema/create', { coupleId: 'C1', role: 'user2', slot: 2 });
    assert.equal(h.j.role, 'host');
    const g = await call('POST', '/api/cinema/create', { coupleId: 'C1', role: 'user1', slot: 1 });
    assert.equal(g.j.role, 'guest'); assert.equal(g.j.session.id, h.j.session.id); assert.equal(live().length, 1);
    assert.ok(g.j.url.includes('r=1') && g.j.url.includes('h=0') && g.j.url.includes('u=user1'));
    assert.equal(tables.cinema_sessions[0].status, 'accepted');
    // the guest tapping the card again (double tap / reopen) still lands in the same room as guest
    const g2 = await call('POST', '/api/cinema/create', { coupleId: 'C1', role: 'user1', slot: 1 });
    assert.equal(g2.j.role, 'guest'); assert.equal(live().length, 1);
  });
  await t('invite still works as before when the partner is not there yet, and the host can invite again any time', async () => {
    reset();
    const h = await call('POST', '/api/cinema/create', { coupleId: 'C1', role: 'user1', slot: 1 }), id = h.j.session.id;
    assert.equal((await call('POST', `/api/cinema/${id}/invite`, { coupleId: 'C1', role: 'user1' })).s, 200);
    assert.equal((await call('POST', `/api/cinema/${id}/invite`, { coupleId: 'C1', role: 'user1' })).s, 200);   // second tap / retry is fine
    assert.equal((await call('GET', '/api/cinema/pending/C1?role=user2')).j.invite.id, id);
  });
  await t('invite works even when the previous movie night was left in "started" (was a 409 = "invite not going")', async () => {
    reset();
    const h = await call('POST', '/api/cinema/create', { coupleId: 'C1', role: 'user1', slot: 1 }), id = h.j.session.id;
    await call('POST', `/api/cinema/${id}/status`, { coupleId: 'C1', role: 'user1', status: 'started' });
    assert.equal(tables.cinema_sessions[0].status, 'started');
    const r = await call('POST', `/api/cinema/${id}/invite`, { coupleId: 'C1', role: 'user1' });
    assert.equal(r.s, 200);
    assert.equal((await call('GET', '/api/cinema/pending/C1?role=user2')).j.invite.id, id);
  });
  await t('an ended or timed-out movie night gives a readable error and the next create opens a fresh room', async () => {
    reset();
    const h = await call('POST', '/api/cinema/create', { coupleId: 'C1', role: 'user1', slot: 1 }), id = h.j.session.id;
    await call('POST', `/api/cinema/${id}/status`, { coupleId: 'C1', role: 'user1', status: 'ended' });
    assert.equal((await call('POST', `/api/cinema/${id}/invite`, { coupleId: 'C1', role: 'user1' })).s, 409);
    const n = await call('POST', '/api/cinema/create', { coupleId: 'C1', role: 'user2', slot: 2 });
    assert.equal(n.j.role, 'host'); assert.notEqual(n.j.session.id, id);
  });
  await t('a dead session (host vanished, nobody pinged for 30 min) is NOT joined: the new arrival becomes host', async () => {
    reset();
    const h = await call('POST', '/api/cinema/create', { coupleId: 'C1', role: 'user2', slot: 2 });
    tables.cinema_sessions[0].expires_at = new Date(Date.now() - 1000).toISOString();
    const n = await call('POST', '/api/cinema/create', { coupleId: 'C1', role: 'user1', slot: 1 });
    assert.equal(n.j.role, 'host'); assert.notEqual(n.j.session.id, h.j.session.id);
  });
  await t('heartbeat keeps a session alive, only the host can end it, ended stays ended', async () => {
    reset();
    const h = await call('POST', '/api/cinema/create', { coupleId: 'C1', role: 'user1', slot: 1 }), id = h.j.session.id;
    tables.cinema_sessions[0].expires_at = new Date(Date.now() + 1000).toISOString();
    assert.equal((await call('POST', `/api/cinema/${id}/status`, { coupleId: 'C1', role: 'user2', status: 'ping' })).s, 200);
    assert.ok(new Date(tables.cinema_sessions[0].expires_at).getTime() > Date.now() + 20 * 60 * 1000);
    await call('POST', `/api/cinema/${id}/status`, { coupleId: 'C1', role: 'user2', status: 'ended' });      // the guest leaving must not end the host's night
    assert.notEqual(tables.cinema_sessions[0].status, 'ended');
    await call('POST', `/api/cinema/${id}/status`, { coupleId: 'C1', role: 'user1', status: 'ended' });
    assert.equal(tables.cinema_sessions[0].status, 'ended');
    await call('POST', `/api/cinema/${id}/status`, { coupleId: 'C1', role: 'user2', status: 'started' });    // cannot revive an ended night
    assert.equal(tables.cinema_sessions[0].status, 'ended');
  });
  await t('create with invite:true opens the room AND sends the invite+push in one call; the host url says the invite is out (i=1)', async () => {
    reset(); pushes.length = 0;
    const h = await call('POST', '/api/cinema/create', { coupleId: 'C1', role: 'user1', slot: 1, invite: true });
    assert.equal(h.j.role, 'host'); assert.equal(h.j.invited, true); assert.ok(h.j.url.includes('i=1'));
    assert.equal(tables.cinema_sessions[0].status, 'invited');
    await new Promise(r => setTimeout(r, 20));
    assert.ok(pushes.some(x => x[0] === 'web' && x[3] === 'cinema-invite'));
    assert.equal((await call('GET', '/api/cinema/pending/C1?role=user2')).j.invite.id, h.j.session.id);
    // partner already in the room + invite:true from the partner's side = just join, no invite to nobody
    const g = await call('POST', '/api/cinema/create', { coupleId: 'C1', role: 'user2', slot: 2, invite: true });
    assert.equal(g.j.role, 'guest'); assert.ok(!g.j.url.includes('i=1'));
  });
  await t('stress: 40 simultaneous double-entries always end with ONE live room, ONE host, ONE guest', async () => {
    let raced = 0; jitter = true;
    for (let i = 0; i < 40; i++) {
      reset();
      const [a, b] = await Promise.all([
        call('POST', '/api/cinema/create', { coupleId: 'C1', role: 'user1', slot: 1 }),
        call('POST', '/api/cinema/create', { coupleId: 'C1', role: 'user2', slot: 2 })]);
      assert.equal(a.j.session.id, b.j.session.id); assert.equal(live().length, 1);
      assert.deepEqual([a.j.role, b.j.role].sort(), ['guest', 'host']);
      if (tables.cinema_sessions.length > 1) raced++;          // a second row was inserted and then dropped = the tie-break path ran
    }
    jitter = false;
    console.log('    (tie-break path exercised in ' + raced + ' of 40 rounds)');
    assert.ok(raced > 3, 'the race must actually have been exercised');
  });
  console.log(`\n${ok} passed`); srv.close(); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
