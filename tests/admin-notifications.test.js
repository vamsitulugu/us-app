// Admin notifications (image + schedule + repeat) and the release check.
// Runs the REAL routes against an in-memory database. No network, no Firebase.
//   node tests/admin-notifications.test.js
process.env.ADMIN_SESSION_SECRET = 'test-secret';
process.env.CRON_SECRET = 'cron-test-secret';
const path = require('path');
const assert = require('assert');
const REPO = path.resolve(__dirname, '..');

// ── tiny in-memory Supabase ───────────────────────────────────
const db = { users: [], admin_notifications: [], admin_audit_log: [], app_releases: [] };
const uploads = [];
class Q {
  constructor(t) { this.t = t; this.op = 'select'; this.f = []; this.ord = null; this.lim = null; this.one = null; this.payload = null; }
  select() { return this; }
  insert(p) { this.op = 'insert'; this.payload = p; return this; }
  update(p) { this.op = 'update'; this.payload = p; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c, v) { this.f.push(r => String(r[c]) === String(v)); return this; }
  lte(c, v) { this.f.push(r => r[c] != null && r[c] <= v); return this; }
  in(c, vs) { this.f.push(r => vs.includes(r[c])); return this; }
  order(c, o) { this.ord = { c, asc: !o || o.ascending !== false }; return this; }
  limit(n) { this.lim = n; return this; }
  single() { this.one = 'single'; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  then(res, rej) { return Promise.resolve(this.run()).then(res, rej); }
  run() {
    const rows = db[this.t]; const m = r => this.f.every(f => f(r)); let out = [];
    if (this.op === 'insert') {
      const defaults = this.t === 'admin_notifications' ? { status: 'draft', run_count: 0, image_url: null, start_at: null, repeat_every_hours: null, repeat_until: null, next_run_at: null, last_run_at: null, sent_at: null, result: null, last_error: null } : {};
      (Array.isArray(this.payload) ? this.payload : [this.payload]).forEach(p => { const r = { id: 'id' + (rows.length + 1) + '-' + Math.random().toString(36).slice(2, 7), created_at: new Date().toISOString(), ...defaults, ...p }; rows.push(r); out.push(r); });
    } else if (this.op === 'update') { rows.filter(m).forEach(r => { Object.assign(r, this.payload); out.push(r); }); }
    else if (this.op === 'delete') { for (let i = rows.length - 1; i >= 0; i--) if (m(rows[i])) { out.push(rows[i]); rows.splice(i, 1); } }
    else { out = rows.filter(m); if (this.ord) out = out.slice().sort((a, b) => (a[this.ord.c] > b[this.ord.c] ? 1 : -1) * (this.ord.asc ? 1 : -1)); if (this.lim != null) out = out.slice(0, this.lim); }
    out = out.map(r => ({ ...r }));
    if (this.one === 'single') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: 'no single row' } };
    if (this.one === 'maybe') return { data: out[0] || null, error: null };
    return { data: out, error: null };
  }
}
const fakeSupabase = {
  from: (t) => new Q(t),
  storage: { from: () => ({ upload: async (name, buf, opts) => { uploads.push({ name, bytes: buf.length, type: opts.contentType }); return { error: null }; }, getPublicUrl: (name) => ({ data: { publicUrl: 'https://cdn.test/couple-photos/' + name } }) }) },
};
const pushes = [];
const stub = (rel, exports) => { const k = require.resolve(path.join(REPO, rel)); require.cache[k] = { id: k, filename: k, loaded: true, exports }; };
stub('middleware/supabase.js', fakeSupabase);
stub('routes/auth.js', { sendPushToUser: async (userId, payload) => { pushes.push({ userId, payload }); return { webpush: null, fcm: { sent: true, messageId: 'm' } }; } });

const express = require('express');
const { createSessionToken } = require(path.join(REPO, 'middleware/adminAuth'));
const notif = require(path.join(REPO, 'routes/admin-notifications'));
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use('/api/admin/notifications', notif);
app.use('/api/cron', require(path.join(REPO, 'routes/cron')));
app.use('/api/releases', require(path.join(REPO, 'routes/releases')));

const cookie = 'admin_session=' + encodeURIComponent(createSessionToken('admin@test'));
let base;
async function call(method, url, body, headers = {}) {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', cookie, ...headers }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { status: r.status, body: j };
}
const H = 3600 * 1000;
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const row = (id) => db.admin_notifications.find(n => n.id === id);
const jpeg = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg-bytes').toString('base64');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('needs an admin login', async () => {
  const r = await call('GET', '/api/admin/notifications', null, { cookie: '' });
  assert.strictEqual(r.status, 401);
});

test('image upload: accepts a picture, rejects other files and huge ones', async () => {
  const ok = await call('POST', '/api/admin/notifications/upload-image', { dataUrl: jpeg });
  assert.strictEqual(ok.status, 200);
  assert.ok(/^https:\/\/cdn\.test\/couple-photos\/admin-notifications\/.+\.jpg$/.test(ok.body.url), ok.body.url);
  assert.strictEqual((await call('POST', '/api/admin/notifications/upload-image', { dataUrl: 'data:application/pdf;base64,AAAA' })).status, 400);
  const big = 'data:image/png;base64,' + Buffer.alloc(3 * 1024 * 1024 + 10).toString('base64');
  assert.strictEqual((await call('POST', '/api/admin/notifications/upload-image', { dataUrl: big })).status, 400);
});

test('send now with a picture: push carries the image, row becomes sent', async () => {
  db.users.push({ id: 'u1', role: 'user1', account_status: 'active', last_platform: 'android' }, { id: 'u2', role: 'user2', account_status: 'active', last_platform: 'web' }, { id: 'u3', role: 'user1', account_status: 'suspended', last_platform: 'android' });
  pushes.length = 0;
  const r = await call('POST', '/api/admin/notifications', { title: 'Hi', message: 'Look', audience: 'android', image_url: 'https://cdn.test/x.jpg', mode: 'now' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.notification.status, 'sent');
  assert.strictEqual(r.body.notification.result.recipientCount, 1);   // only the active android user
  assert.strictEqual(r.body.notification.result.deliveredCount, 1);
  assert.strictEqual(pushes.length, 1);
  assert.strictEqual(pushes[0].payload.image, 'https://cdn.test/x.jpg');
  assert.strictEqual(pushes[0].payload.id, r.body.notification.id);
});

test('bad image link and bad schedules are refused', async () => {
  const base = { title: 'T', message: 'M', mode: 'schedule' };
  assert.strictEqual((await call('POST', '/api/admin/notifications', { ...base, image_url: 'javascript:alert(1)' })).status, 400);
  assert.strictEqual((await call('POST', '/api/admin/notifications', { ...base, repeat_every_hours: 4 })).status, 400);                              // no "until"
  assert.strictEqual((await call('POST', '/api/admin/notifications', { ...base, repeat_every_hours: 4, repeat_until: iso(-H) })).status, 400);     // until in the past
  assert.strictEqual((await call('POST', '/api/admin/notifications', { ...base, repeat_every_hours: 0.1, repeat_until: iso(48 * H) })).status, 400); // too frequent
  assert.strictEqual((await call('POST', '/api/admin/notifications', { ...base, repeat_until: iso(48 * H) })).status, 400);                         // until without interval
});

let campaign;
test('repeat every 4 h until a date: first push goes out at once, next one is 4 h later', async () => {
  pushes.length = 0;
  const r = await call('POST', '/api/admin/notifications', { title: 'Update!', message: 'New version', audience: 'all', image_url: 'https://cdn.test/y.jpg', mode: 'schedule', repeat_every_hours: 4, repeat_until: iso(3 * 24 * H) });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  campaign = r.body.notification;
  assert.strictEqual(campaign.status, 'scheduled');
  assert.strictEqual(campaign.run_count, 1);
  assert.strictEqual(pushes.length, 2);                                   // u1 + u2 (suspended u3 skipped)
  const gap = new Date(campaign.next_run_at) - new Date(campaign.last_run_at);
  assert.ok(Math.abs(gap - 4 * H) < 5000, 'next run should be 4 h after last: ' + gap);
});

test('nothing is sent before the next run is due', async () => {
  pushes.length = 0;
  assert.deepStrictEqual(await notif.runDueNotifications(), []);
  assert.strictEqual(pushes.length, 0);
});

test('two schedulers at the same moment send a due push only once', async () => {
  pushes.length = 0;
  row(campaign.id).next_run_at = iso(-1000);
  const [a, b] = await Promise.all([notif.runDueNotifications(), notif.runDueNotifications()]);
  assert.strictEqual(a.length + b.length, 1);
  assert.strictEqual(pushes.length, 2);
  assert.strictEqual(row(campaign.id).run_count, 2);
});

test('changing 4 h to 5 h re-times the next push from the last one', async () => {
  const r = await call('PUT', '/api/admin/notifications/' + campaign.id, { repeat_every_hours: 5 });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const n = row(campaign.id);
  const gap = new Date(n.next_run_at) - new Date(n.last_run_at);
  assert.ok(Math.abs(gap - 5 * H) < 5000, 'gap ' + gap);
  assert.strictEqual(Number(n.repeat_every_hours), 5);
});

test('pause stops sending, resume restarts one interval later', async () => {
  assert.strictEqual((await call('POST', `/api/admin/notifications/${campaign.id}/pause`)).status, 200);
  row(campaign.id).next_run_at = iso(-1000);          // even if it was due
  pushes.length = 0;
  assert.deepStrictEqual(await notif.runDueNotifications(), []);
  assert.strictEqual(pushes.length, 0);
  const r = await call('POST', `/api/admin/notifications/${campaign.id}/resume`);
  assert.strictEqual(r.status, 200);
  const gap = new Date(row(campaign.id).next_run_at) - Date.now();
  assert.ok(Math.abs(gap - 5 * H) < 5000, 'resume gap ' + gap);
});

test('the last push completes the campaign (next one would pass the end date)', async () => {
  const n = row(campaign.id);
  n.repeat_until = iso(2 * H);        // only 2 h left but interval is 5 h
  n.next_run_at = iso(-1000);
  pushes.length = 0;
  await notif.runDueNotifications();
  assert.strictEqual(pushes.length, 2);
  assert.strictEqual(row(campaign.id).status, 'completed');
  assert.strictEqual(row(campaign.id).next_run_at, null);
  pushes.length = 0;
  await notif.runDueNotifications();
  assert.strictEqual(pushes.length, 0);
});

test('one-time scheduled push in the future waits, then becomes sent', async () => {
  const r = await call('POST', '/api/admin/notifications', { title: 'Later', message: 'x', mode: 'schedule', start_at: iso(2 * H) });
  assert.strictEqual(r.body.notification.status, 'scheduled');
  assert.strictEqual(r.body.notification.run_count, 0);
  const id = r.body.notification.id;
  row(id).next_run_at = iso(-1000);
  await notif.runDueNotifications();
  assert.strictEqual(row(id).status, 'sent');
});

test('stop, and delete rules', async () => {
  const r = await call('POST', '/api/admin/notifications', { title: 'S', message: 'x', mode: 'schedule', start_at: iso(H), repeat_every_hours: 4, repeat_until: iso(24 * H) });
  const id = r.body.notification.id;
  assert.strictEqual((await call('DELETE', '/api/admin/notifications/' + id)).status, 400);   // must stop first
  assert.strictEqual((await call('POST', `/api/admin/notifications/${id}/stop`)).status, 200);
  assert.strictEqual(row(id).status, 'cancelled');
  assert.strictEqual((await call('DELETE', '/api/admin/notifications/' + id)).status, 200);
  assert.strictEqual((await call('DELETE', '/api/admin/notifications/' + campaign.id)).status, 400);  // history is kept
});

test('cron endpoint: off without secret match, on with it', async () => {
  assert.strictEqual((await call('POST', '/api/cron/notifications', null, { cookie: '' })).status, 401);
  assert.strictEqual((await call('POST', '/api/cron/notifications', null, { cookie: '', 'x-cron-secret': 'wrong' })).status, 401);
  const ok = await call('POST', '/api/cron/notifications', null, { cookie: '', 'x-cron-secret': 'cron-test-secret' });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.body.ok, true);
});

test('release check: Android popup logic and APK-link fallback', async () => {
  db.app_releases.push({ id: 'r1', version: '0.3.0', build: 3, title: 'Three', message: 'Update please', notes: null, update_type: 'recommended', update_url: null, min_supported_version: null, platform: 'all', status: 'published', published_at: new Date().toISOString() });
  const old = await call('GET', '/api/releases/check?version=0.1.0&platform=android', null, { cookie: '' });
  assert.strictEqual(old.body.updateAvailable, true);
  assert.strictEqual(old.body.updateType, 'recommended');
  assert.ok(/^https:\/\/.+twin-hearts\.apk/.test(old.body.release.updateUrl), 'falls back to the uploaded APK link: ' + old.body.release.updateUrl);
  const same = await call('GET', '/api/releases/check?version=0.3.0&platform=android', null, { cookie: '' });
  assert.strictEqual(same.body.updateAvailable, false);                    // after updating, the popup stops
  const newer = await call('GET', '/api/releases/check?version=0.10.0&platform=android', null, { cookie: '' });
  assert.strictEqual(newer.body.updateAvailable, false);                   // 0.10.0 is newer than 0.3.0
  const web = await call('GET', '/api/releases/check?version=0.2.0&platform=web', null, { cookie: '' });
  assert.strictEqual(web.body.updateAvailable, true);
  assert.strictEqual(web.body.release.updateUrl, null);                    // web never gets an APK link
});

(async () => {
  const server = app.listen(0); base = 'http://127.0.0.1:' + server.address().port;
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('  ✓ ' + t.name); }
    catch (e) { failed++; console.log('  ✗ ' + t.name + '\n      ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n      ')); }
  }
  server.close();
  console.log(failed ? `\n${failed} FAILED` : `\nAll ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
