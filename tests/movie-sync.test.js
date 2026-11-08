// Run: node tests/movie-sync.test.js   (no database — Supabase is faked in memory)
// Covers the Watch Together sync rules: server-started movie, shared anchor, stale-action protection.
const assert = require('assert');
const { tables } = require('./support/fake-watch-db');
const express = require('express');
const app = express(); app.use(express.json()); app.use('/api/movie', require('../routes/routes-movie'));
let base;
const call = async (m, u, b) => { const r = await fetch(base + u, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json() }; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv = app.listen(0); base = 'http://127.0.0.1:' + srv.address().port + '/api/movie';
  const C = 'couple1';
  let t = 0; const ok = (n) => console.log('  ✓', n);

  // lobby → both ready → request → accept
  await call('POST', `/${C}/movie`, { role: 'user1', title: 'Film', durationSec: 5400 });
  await call('POST', `/${C}/movie`, { role: 'user2', title: 'Film', durationSec: 5401 });
  await call('POST', `/${C}/ready`, { role: 'user1', ready: true });
  await call('POST', `/${C}/ready`, { role: 'user2', ready: true });
  await call('POST', `/${C}/request-start`, { role: 'user1' });
  let r = await call('POST', `/${C}/accept-start`, { role: 'user2', countdownMs: 3000 });
  assert.strictEqual(r.j.status, 'countdown'); assert.ok(r.j.server_now > 0); ok('accept-start opens a countdown and returns server_now');

  // an action during the countdown is ignored (it used to be accepted and break the start)
  r = await call('PATCH', `/${C}/state`, { role: 'user1', playing: true, positionSec: 50, actionSeq: Date.now() });
  assert.strictEqual(r.j.status, 'countdown'); assert.strictEqual(r.j.position_sec, 0); ok('actions during the countdown are ignored');

  // before the start time, GET does not start the movie
  r = await call('GET', `/${C}`); assert.strictEqual(r.j.status, 'countdown'); ok('GET before start keeps countdown');

  // force the start into the past: the SERVER must start the movie anchored at scheduled_start_at
  const row = tables.watch_sessions[0]; const startMs = Date.now() - 2000; row.scheduled_start_at = new Date(startMs).toISOString();
  r = await call('GET', `/${C}`);
  assert.strictEqual(r.j.status, 'watching'); assert.strictEqual(r.j.playing, true); assert.strictEqual(r.j.position_sec, 0);
  assert.strictEqual(new Date(r.j.updated_at).getTime(), startMs); ok('GET after the start time: server starts the movie, anchored at scheduled_start_at');
  const seqAfterStart = r.j.action_seq;
  r = await call('GET', `/${C}`); assert.strictEqual(r.j.action_seq, seqAfterStart); ok('settling happens once');

  // two phones poll at once: still one start
  row.status = 'countdown'; row.playing = false; row.action_seq = 10; row.scheduled_start_at = new Date(Date.now() - 500).toISOString();
  const both = await Promise.all([call('GET', `/${C}`), call('GET', `/${C}`)]);
  assert.ok(both.every(x => x.j.status === 'watching' && x.j.playing)); ok('two simultaneous polls agree');

  // pause is applied and the status is 'watching' (not stuck on countdown) so pollers see it
  const seq = Date.now();
  const clientTs = Date.now() - 400;
  r = await call('PATCH', `/${C}/state`, { role: 'user1', playing: false, positionSec: 123.4, actionSeq: seq, clientTs });
  assert.strictEqual(r.j.playing, false); assert.strictEqual(r.j.status, 'watching'); assert.strictEqual(r.j.position_sec, 123.4);
  assert.strictEqual(new Date(r.j.updated_at).getTime(), clientTs); ok('pause applied; anchor = client capture time, not arrival time');

  // stale action never overwrites a newer one
  r = await call('PATCH', `/${C}/state`, { role: 'user2', playing: true, positionSec: 5, actionSeq: seq - 1000 });
  assert.strictEqual(r.j.playing, false); assert.strictEqual(r.j.position_sec, 123.4); ok('stale action ignored');

  // absurd anchor (device clock hours off) falls back to server time
  r = await call('PATCH', `/${C}/state`, { role: 'user2', playing: true, positionSec: 130, actionSeq: seq + 1, clientTs: Date.now() - 3 * 3600e3 });
  assert.ok(Math.abs(new Date(r.j.updated_at).getTime() - Date.now()) < 3000); ok('absurd client anchor ignored');

  // bad numbers
  r = await call('PATCH', `/${C}/state`, { role: 'user2', playing: true, positionSec: 'abc', actionSeq: seq + 2 });
  assert.strictEqual(r.s, 200); assert.ok(Number.isFinite(r.j.position_sec)); ok('garbage position does not corrupt the room');

  // ended rooms ignore actions
  await call('POST', `/${C}/end`, { role: 'user1' });
  r = await call('PATCH', `/${C}/state`, { role: 'user2', playing: true, positionSec: 1, actionSeq: seq + 3 });
  assert.strictEqual(r.j.status, 'ended'); ok('actions after the end are ignored');

  console.log('movie-sync: all passed'); srv.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
