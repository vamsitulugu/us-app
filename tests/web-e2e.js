// Run: NODE_PATH=<dir with express + jsdom> node tests/web-e2e.js
// Two real copies of public/movie.js (jsdom) talk to the real routes/routes-movie.js. Each page has a fake <video>
// that can stall, and its own wrong clock. Checks the three things that were broken: start, pause/resume, stalls.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const { tables } = require('./support/fake-watch-db');
const express = require('express');
const app = express(); app.use(express.json()); app.use('/api/movie', require('../routes/routes-movie'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HTML = fs.readFileSync(path.join(__dirname, '../public/movie.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const JS = fs.readFileSync(path.join(__dirname, '../public/movie.js'), 'utf8');
const hub = new Set();   // fake realtime: broadcasts between the two pages (disable with USE_RT=0)
const USE_RT = process.env.USE_RT !== '0';

function makeClient(port, role, skewMs) {
  const errors = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(String(e.message).slice(0, 160)));
  const dom = new JSDOM(HTML, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.S = { coupleId: 'couple1', role }; w.API = 'http://127.0.0.1:' + port;
  w.fetch = async (u, o) => {
    if (/\/url$/.test(u)) return { ok: true, json: async () => ({ url: 'https://cdn.example/film.mp4' }) };
    return fetch(u, o);
  };
  // skewed device clock
  w.eval(`(function(){const D=Date;const K=${skewMs};class SD extends D{constructor(...a){a.length?super(...a):super(D.now()+K)} static now(){return D.now()+K}};Date=SD;})()`);
  // fake <video>
  const list = new Set(); let last = performance.now();
  const P = w.HTMLMediaElement.prototype;
  const M = el => el.__m || (el.__m = { t: 0, paused: true, ready: true, rate: 1, seeks: 0, src: null });
  const fire = (el, t) => el.dispatchEvent(new w.Event(t));
  const def = (k, g, s) => Object.defineProperty(P, k, { configurable: true, get: g, set: s });
  def('currentTime', function () { list.add(this); return M(this).t; }, function (v) { list.add(this); const m = M(this); m.t = Number(v); m.seeks++; });
  def('paused', function () { return M(this).paused; });
  def('readyState', function () { return M(this).ready ? 4 : 2; });
  def('duration', function () { return 5400; });
  def('ended', function () { return false; });
  def('seeking', function () { return false; });
  def('playbackRate', function () { return M(this).rate; }, function (v) { M(this).rate = v; });
  def('buffered', function () { const m = M(this); return { length: 1, start: () => 0, end: () => m.t + (m.ready ? 30 : 0) }; });
  def('src', function () { return this.getAttribute('src') || ''; }, function (v) { list.add(this); this.setAttribute('src', v); setTimeout(() => { fire(this, 'loadedmetadata'); fire(this, 'canplay'); }, 50); });
  P.play = function () { list.add(this); const m = M(this); m.paused = false; fire(this, 'play'); fire(this, m.ready ? 'playing' : 'waiting'); return Promise.resolve(); };
  P.pause = function () { const m = M(this); if (!m.paused) { m.paused = true; fire(this, 'pause'); } };
  P.load = function () {};
  setInterval(() => { const n = performance.now(), dt = (n - last) / 1000; last = n; list.forEach(el => { const m = M(el); if (!m.paused && m.ready) m.t += dt * m.rate; }); }, 40);
  // fake realtime channel
  if (USE_RT) {
    const me = { handlers: {}, w };
    w.supabase = { createClient: () => ({ channel: () => { const ch = { on(_t, f, cb) { me.handlers[f.event] = cb; return ch; }, subscribe(cb) { hub.add(me); setTimeout(() => cb('SUBSCRIBED'), 10); return ch; }, track: async () => {}, presenceState: () => ({}),
      send({ event, payload }) { setTimeout(() => hub.forEach(o => { if (o !== me && o.handlers[event]) o.handlers[event]({ payload: JSON.parse(JSON.stringify(payload)) }); }), 30); } }; return ch; }, removeChannel() {} }) };
  }
  w.eval(JS);
  const v = () => w.document.getElementById('wtVideo');
  return { w, errors, role, v, m: () => M(v()), stall() { const m = M(v()); m.ready = false; fire(v(), 'waiting'); }, unstall() { const m = M(v()); m.ready = true; fire(v(), 'canplay'); if (!m.paused) fire(v(), 'playing'); },
    click: id => w.document.getElementById(id).click(), uiState: () => w.document.getElementById('stateWatching').hidden ? 'not-watching' : 'watching' };
}

(async () => {
  const srv = app.listen(0); const port = srv.address().port; const base = `http://127.0.0.1:${port}/api/movie`;
  const post = (u, b) => fetch(base + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
  tables.watch_sessions.push({ couple_id: 'couple1', status: 'start_requested', start_requested_by: 'user1', user1_ready: true, user2_ready: true, movies_match: true,
    user1_movie_title: 'Film', user2_movie_title: 'Film', user1_duration_sec: 5400, user2_duration_sec: 5400, shared_movie_id: 'M1', playing: false, position_sec: 0, action_seq: 5 });
  const acc = await post('/couple1/accept-start', { role: 'user2', countdownMs: 3000 });
  const startMs = new Date(acc.scheduled_start_at).getTime();
  // A's clock is 2.5 s FAST, B's is 1.8 s SLOW — the kind of skew phones really have
  const A = makeClient(port, 'user1', 2500), B = makeClient(port, 'user2', -1800);
  const ok = n => console.log('  ✓', n);
  const pos = c => c.m().t, expectedNow = () => (Date.now() - startMs) / 1000;
  const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a.toFixed(2)} vs ${b.toFixed(2)} (tol ${tol})`);

  await sleep(startMs - Date.now() + 2500);
  assert.strictEqual(A.uiState(), 'watching', 'A watching'); assert.strictEqual(B.uiState(), 'watching', 'B watching');
  assert.ok(!A.m().paused && !B.m().paused, 'both playing');
  close(pos(A), pos(B), 0.8, 'start: both phones at the same position'); close(pos(A), expectedNow(), 1.0, 'start: position matches the shared start time');
  ok(`start: both playing, A=${pos(A).toFixed(2)}s B=${pos(B).toFixed(2)}s (clocks 4.3 s apart)`);
  assert.ok(A.m().seeks <= 2 && B.m().seeks <= 2, `no seek storm at start (A ${A.m().seeks}, B ${B.m().seeks})`); ok('start: no seek storm');

  A.click('btnPlayPause'); await sleep(2600);
  assert.ok(A.m().paused && B.m().paused, 'pause reaches the partner'); close(pos(A), pos(B), 0.6, 'paused position'); ok('A pauses → B pauses at the same spot');
  B.click('btnPlayPause'); await sleep(2600);
  assert.ok(!A.m().paused && !B.m().paused, 'resume reaches the partner'); close(pos(A), pos(B), 0.8, 'resumed position'); ok('B resumes → both play, in sync');

  // B's video stalls for 4 s: A must wait, nobody thrashes, both resume together
  const seeksBefore = A.m().seeks + B.m().seeks;
  B.stall(); await sleep(2800);
  assert.ok(A.m().paused, 'A waits while B buffers'); ok('B stalls → A pauses and waits');
  await sleep(1500); B.unstall(); await sleep(3200);
  assert.ok(!A.m().paused && !B.m().paused, 'both resumed after the stall'); close(pos(A), pos(B), 0.9, 'after stall'); ok('B recovers → both resume together, in sync');
  assert.ok(A.m().seeks + B.m().seeks - seeksBefore <= 4, 'few seeks during the stall'); ok('no repeated seeking during a stall');

  // A drifts 3 s ahead (e.g. a hiccup): it is pulled back once, gently
  A.m().t += 3; await sleep(3200);
  close(pos(A), pos(B), 1.0, 'drift correction'); ok('3 s drift corrected');

  const errs = [...A.errors, ...B.errors].filter(e => !/Not implemented|lucide|canvas/i.test(e));
  if (errs.length) console.log('  (page errors, informational):', [...new Set(errs)].slice(0, 4));
  console.log('web-e2e: all passed'); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
