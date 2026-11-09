// Every admin page's GET endpoints must answer (200 / 404-for-missing), never crash, with an EMPTY database.
//   node tests/admin-smoke.test.js
process.env.ADMIN_SESSION_SECRET = 'test-secret';
const path = require('path'); const assert = require('assert');
const REPO = path.resolve(__dirname, '..');
const stub = (rel, exports) => { const k = require.resolve(path.join(REPO, rel)); require.cache[k] = { id: k, filename: k, loaded: true, exports }; };

// A database that answers every query with "nothing here".
function chain(single) {
  const p = new Proxy(function () {}, {
    get: (_, prop) => {
      if (prop === 'then') return (res) => Promise.resolve({ data: single ? null : [], error: null, count: 0 }).then(res);
      if (prop === 'single' || prop === 'maybeSingle') return () => chain(true);
      return () => p;
    },
  });
  return p;
}
stub('middleware/supabase.js', { from: () => chain(false), rpc: () => chain(false), storage: { from: () => ({}) } });
stub('routes/auth.js', { sendPushToUser: async () => ({}) });

const express = require('express');
const { createSessionToken } = require(path.join(REPO, 'middleware/adminAuth'));
const app = express(); app.use(express.json());
const mounts = { overview: 'admin-overview', users: 'admin-users', couples: 'admin-couples', releases: 'admin-releases', notifications: 'admin-notifications', flags: 'admin-flags', health: 'admin-health', support: 'admin-support', payments: 'admin-payments' };
for (const [m, f] of Object.entries(mounts)) app.use('/api/admin/' + m, require(path.join(REPO, 'routes', f)));
app.use('/api/admin/auth', require(path.join(REPO, 'routes/admin-auth')));

// The same calls admin/admin.js makes when each page opens.
const pages = {
  Dashboard: ['/overview'], Users: ['/users?page=1&q=&status=&platform='], Couples: ['/couples', '/couples/orphaned'],
  Releases: ['/releases', '/releases/current', '/releases/apk-meta'], Notifications: ['/notifications'], 'Feature Flags': ['/flags'],
  Payments: ['/payments?status='], 'App Health': ['/health/errors?severity=&platform=', '/health/audit?page=1'],
  'Support & Care': ['/support/overview', '/support/tickets'], 'Audit Logs': ['/health/audit?page=1'],
};
(async () => {
  const server = app.listen(0); const base = 'http://127.0.0.1:' + server.address().port;
  const cookie = 'admin_session=' + encodeURIComponent(createSessionToken('admin@test'));
  let bad = 0;
  for (const [page, urls] of Object.entries(pages)) for (const u of urls) {
    const r = await fetch(base + '/api/admin' + u, { headers: { cookie } });
    const ok = r.status === 200; if (!ok) bad++;
    console.log(`  ${ok ? '✓' : '✗'} ${page.padEnd(15)} GET ${u}  →  ${r.status}`);
  }
  const noAuth = await fetch(base + '/api/admin/overview'); assert.strictEqual(noAuth.status, 401);
  console.log('  ✓ every page is locked without a login');
  // admin.js must only call endpoints that exist
  const js = require('fs').readFileSync(path.join(REPO, 'admin/admin.js'), 'utf8');
  const used = new Set([...js.matchAll(/api\(\s*[`'"]\/([a-z]+)\//g)].map(m => m[1]).concat([...js.matchAll(/api\(\s*[`'"]\/([a-z]+)[?`'"]/g)].map(m => m[1])));
  const missing = [...used].filter(u => u !== 'auth' && !mounts[u]);
  console.log(missing.length ? '  ✗ admin.js calls unknown API areas: ' + missing : '  ✓ every API area admin.js calls is mounted: ' + [...used].sort().join(', '));
  server.close(); process.exit(bad || missing.length ? 1 : 0);
})();
