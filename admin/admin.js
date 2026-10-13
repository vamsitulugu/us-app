'use strict';
/* ═══════════════════════════════════════════════════════════════
   Twin Hearts Admin Control Center — frontend
   No build step, no framework: vanilla JS talking to /api/admin/*.
   Every fetch uses credentials:'include' so the HttpOnly session
   cookie is sent — this page is same-origin with the API by design
   (see server.js comments), so that just works without CORS config.
   ═══════════════════════════════════════════════════════════════ */

const ICONS = {
  overview: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
  users: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/><path d="M16 3.5a4 4 0 0 1 0 7.5"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/>',
  couples: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>',
  releases: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12h8M12 8v8"/>',
  notifications: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  flags: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22V15"/>',
  health: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  support: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/><path d="M9.5 13a3.5 3.5 0 0 0 5 0"/>',
  audit: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15h6M9 11h2"/>'
};

const NAV = [
  { id: 'overview', label: 'Dashboard', icon: 'overview' },
  { id: 'users', label: 'Users', icon: 'users' },
  { id: 'couples', label: 'Couples', icon: 'couples' },
  { id: 'releases', label: 'Releases', icon: 'releases' },
  { id: 'notifications', label: 'Notifications', icon: 'notifications' },
  { id: 'flags', label: 'Feature Flags', icon: 'flags' },
  { id: 'health', label: 'App Health', icon: 'health' },
  { id: 'support', label: 'Support & Care', icon: 'support' },
  { id: 'audit', label: 'Audit Logs', icon: 'audit' }
];

let state = { adminEmail: null, currentPage: 'overview' };

/* ── API helper ─────────────────────────────────────────────── */
async function api(path, opts = {}) {
  const res = await fetch('/api/admin' + path, {
    credentials: 'include',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    ...opts
  });
  let body = null;
  try { body = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    const err = new Error((body && body.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}

/* ── Toasts ─────────────────────────────────────────────────── */
function toast(message, type = 'success') {
  const host = document.getElementById('toastHost');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

/* ── Confirm modal (with optional type-to-confirm) ─────────────── */
function confirmDialog({ title, body, requireTypeMatch = null, confirmLabel = 'Confirm' }) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirmOverlay');
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmBody').textContent = body;
    const typeWrap = document.getElementById('confirmTypeWrap');
    const typeInput = document.getElementById('confirmTypeInput');
    const okBtn = document.getElementById('confirmOkBtn');
    okBtn.textContent = confirmLabel;
    typeInput.value = '';

    if (requireTypeMatch) {
      typeWrap.style.display = 'block';
      document.getElementById('confirmTypeLabel').textContent = `Type "${requireTypeMatch}" to confirm`;
      okBtn.disabled = true;
    } else {
      typeWrap.style.display = 'none';
      okBtn.disabled = false;
    }

    const onInput = () => { okBtn.disabled = requireTypeMatch ? (typeInput.value !== requireTypeMatch) : false; };
    typeInput.oninput = onInput;

    function cleanup(result) {
      overlay.classList.remove('active');
      okBtn.onclick = null;
      document.getElementById('confirmCancelBtn').onclick = null;
      resolve(result);
    }
    okBtn.onclick = () => cleanup(true);
    document.getElementById('confirmCancelBtn').onclick = () => cleanup(false);
    overlay.classList.add('active');
  });
}

/* ── Drawer (detail panel) ─────────────────────────────────────── */
function openDrawer(html) {
  document.getElementById('drawer').innerHTML = `<button class="drawer-close" id="drawerCloseBtn">&times;</button>${html}`;
  document.getElementById('drawer').classList.add('active');
  document.getElementById('drawerOverlay').classList.add('active');
  document.getElementById('drawerCloseBtn').onclick = closeDrawer;
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('active');
  document.getElementById('drawerOverlay').classList.remove('active');
}
document.getElementById('drawerOverlay').addEventListener('click', closeDrawer);

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtDate(d) { if (!d) return '—'; try { return new Date(d).toLocaleString(); } catch (e) { return d; } }

/* ── Auth ─────────────────────────────────────────────────────── */
async function checkAuth() {
  try {
    const me = await api('/auth/me');
    state.adminEmail = me.email;
    showApp();
  } catch (e) {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appShell').classList.remove('active');
}

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appShell').classList.add('active');
  document.getElementById('adminEmailLabel').textContent = state.adminEmail;
  buildNav();
  navigate('overview');
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    const res = await fetch('/api/admin/auth/login', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('loginEmail').value,
        password: document.getElementById('loginPassword').value
      })
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Login failed');
    state.adminEmail = body.email;
    showApp();
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  try { await api('/auth/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
  showLogin();
});

/* ── Sidebar / routing ────────────────────────────────────────── */
function buildNav() {
  const nav = document.getElementById('navList');
  nav.innerHTML = NAV.map(n => `
    <div class="nav-item" data-page="${n.id}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n.icon]}</svg>
      <span>${n.label}</span>
    </div>`).join('');
  nav.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.page));
  });
}

document.getElementById('collapseBtn').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('collapsed');
});

const renderers = {}; // page id -> async function() rendering into its container

function navigate(pageId) {
  state.currentPage = pageId;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === pageId));
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  const container = document.getElementById('page' + pageId.charAt(0).toUpperCase() + pageId.slice(1));
  container.classList.add('active');
  if (renderers[pageId]) renderers[pageId](container);
}

/* ═══════════════════════════════════════════════════════════════
   OVERVIEW
   ═══════════════════════════════════════════════════════════════ */
renderers.overview = async (el) => {
  el.innerHTML = `<div class="page-header"><div><h2>Dashboard</h2><p>Twin Hearts operations at a glance</p></div></div>
    <div class="kpi-grid" id="ovKpis"><div class="loading-state">Loading…</div></div>
    <div class="card"><h3>Recent admin activity</h3><div id="ovActivity"><div class="loading-state">Loading…</div></div></div>`;
  try {
    const data = await api('/overview');
    const k = data.kpis;
    const cards = [
      ['Total users', k.totalUsers],
      ['New today', k.newUsersToday],
      ['New this week', k.newUsersThisWeek],
      ['New this month', k.newUsersThisMonth],
      ['Suspended accounts', k.suspendedAccounts],
      ['Total couples', k.totalCouples],
      ['Paired couples', k.pairedCouples],
      ['Unpaired couples', k.unpairedCouples],
      ['Production version', k.currentReleaseVersion || 'None published']
    ];
    document.getElementById('ovKpis').innerHTML = cards.map(([label, value]) => `
      <div class="kpi-card"><div class="label">${esc(label)}</div><div class="value${typeof value === 'string' && isNaN(value) ? ' muted' : ''}">${esc(value)}</div></div>`).join('')
      + `<div class="kpi-card"><div class="label">Not yet tracked</div><div class="value muted">DAU · AI usage · Storage</div></div>`;

    const act = data.recentActivity || [];
    document.getElementById('ovActivity').innerHTML = act.length ? `
      <div class="table-wrap"><table><thead><tr><th>Action</th><th>Target</th><th>Admin</th><th>When</th></tr></thead><tbody>
        ${act.map(a => `<tr><td>${esc(a.action)}</td><td>${esc(a.target_type || '—')}${a.target_id ? ' · ' + esc(String(a.target_id).slice(0, 8)) : ''}</td><td>${esc(a.admin_email)}</td><td>${fmtDate(a.created_at)}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty-state">No admin activity yet.</div>`;
  } catch (e) {
    document.getElementById('ovKpis').innerHTML = `<div class="error-state">${esc(e.message)}</div>`;
  }
};

/* ═══════════════════════════════════════════════════════════════
   USERS
   ═══════════════════════════════════════════════════════════════ */
let usersState = { page: 1, search: '', status: '' };

renderers.users = async (el) => {
  el.innerHTML = `
    <div class="page-header"><div><h2>Users</h2><p>Account administration</p></div></div>
    <div class="toolbar">
      <input type="search" id="usersSearch" placeholder="Search name, email, phone…" value="${esc(usersState.search)}">
      <select id="usersStatus">
        <option value="">All statuses</option>
        <option value="active">Active</option>
        <option value="suspended">Suspended</option>
        <option value="disabled">Disabled</option>
      </select>
      <div class="spacer"></div>
    </div>
    <div class="card"><div class="table-wrap" id="usersTable"><div class="loading-state">Loading…</div></div>
      <div class="pagination" id="usersPagination"></div></div>`;

  document.getElementById('usersStatus').value = usersState.status;
  document.getElementById('usersSearch').addEventListener('input', debounce(() => {
    usersState.search = document.getElementById('usersSearch').value;
    usersState.page = 1;
    loadUsers();
  }, 350));
  document.getElementById('usersStatus').addEventListener('change', () => {
    usersState.status = document.getElementById('usersStatus').value;
    usersState.page = 1;
    loadUsers();
  });
  loadUsers();
};

async function loadUsers() {
  const tableEl = document.getElementById('usersTable');
  tableEl.innerHTML = skeletonRows(5, 5);
  try {
    const q = new URLSearchParams({ page: usersState.page, search: usersState.search, status: usersState.status });
    const data = await api('/users?' + q.toString());
    if (!data.users.length) {
      tableEl.innerHTML = `<div class="empty-state">No users match this filter.</div>`;
      document.getElementById('usersPagination').innerHTML = '';
      return;
    }
    tableEl.innerHTML = `<table><thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Paired</th><th>Joined</th><th></th></tr></thead><tbody>
      ${data.users.map(u => `<tr>
        <td>${esc(u.name)}</td>
        <td>${esc(u.email)}</td>
        <td><span class="badge ${u.account_status}">${esc(u.account_status)}</span></td>
        <td>${u.paired ? 'Yes' : 'No'}</td>
        <td>${fmtDate(u.created_at)}</td>
        <td><button class="btn secondary small" data-user="${u.id}">View</button></td>
      </tr>`).join('')}
    </tbody></table>`;
    tableEl.querySelectorAll('[data-user]').forEach(btn => btn.addEventListener('click', () => openUserDetail(btn.dataset.user)));

    document.getElementById('usersPagination').innerHTML = `
      <button class="btn secondary small" id="usersPrev" ${data.page <= 1 ? 'disabled' : ''}>Prev</button>
      <span>Page ${data.page} of ${data.totalPages} · ${data.total} users</span>
      <button class="btn secondary small" id="usersNext" ${data.page >= data.totalPages ? 'disabled' : ''}>Next</button>`;
    const prevBtn = document.getElementById('usersPrev'), nextBtn = document.getElementById('usersNext');
    if (prevBtn) prevBtn.addEventListener('click', () => { usersState.page--; loadUsers(); });
    if (nextBtn) nextBtn.addEventListener('click', () => { usersState.page++; loadUsers(); });
  } catch (e) {
    tableEl.innerHTML = `<div class="error-state">${esc(e.message)}</div>`;
  }
}

async function openUserDetail(id) {
  openDrawer(`<div class="loading-state">Loading…</div>`);
  try {
    const { user, couple, partner } = await api('/users/' + id);
    const html = `
      <h3>${esc(user.name)}</h3>
      <div class="kv"><span class="k">Email</span><span>${esc(user.email)}</span></div>
      <div class="kv"><span class="k">Phone</span><span>${esc(user.phone_number || '—')}</span></div>
      <div class="kv"><span class="k">Status</span><span class="badge ${user.account_status}">${esc(user.account_status)}</span></div>
      <div class="kv"><span class="k">Role</span><span>${esc(user.role || '—')}</span></div>
      <div class="kv"><span class="k">Joined</span><span>${fmtDate(user.created_at)}</span></div>
      ${couple ? `<div class="kv"><span class="k">Couple paired</span><span>${couple.paired ? 'Yes' : 'No'}</span></div>` : ''}
      ${partner ? `<div class="kv"><span class="k">Partner</span><span>${esc(partner.name)} (${esc(partner.account_status)})</span></div>` : ''}
      <div class="actions">
        ${user.account_status !== 'active' ? `<button class="btn secondary small" data-act="active">Reactivate</button>` : ''}
        ${user.account_status !== 'suspended' ? `<button class="btn secondary small" data-act="suspended">Suspend</button>` : ''}
        ${user.account_status !== 'disabled' ? `<button class="btn secondary small" data-act="disabled">Disable</button>` : ''}
        <button class="btn danger small" id="deleteUserBtn">Delete account</button>
      </div>`;
    openDrawer(html);
    document.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', async () => {
      try {
        await api(`/users/${id}/status`, { method: 'POST', body: JSON.stringify({ status: btn.dataset.act }) });
        toast(`Account set to ${btn.dataset.act}`);
        closeDrawer(); loadUsers();
      } catch (e) { toast(e.message, 'error'); }
    }));
    document.getElementById('deleteUserBtn').addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Delete this account?',
        body: 'This permanently removes the account. This cannot be undone.',
        requireTypeMatch: user.email,
        confirmLabel: 'Delete account'
      });
      if (!ok) return;
      try {
        await api(`/users/${id}`, { method: 'DELETE', body: JSON.stringify({ confirm: true }) });
        toast('Account deleted');
        closeDrawer(); loadUsers();
      } catch (e) { toast(e.message, 'error'); }
    });
  } catch (e) {
    openDrawer(`<div class="error-state">${esc(e.message)}</div>`);
  }
}

/* ═══════════════════════════════════════════════════════════════
   COUPLES
   ═══════════════════════════════════════════════════════════════ */
renderers.couples = async (el) => {
  el.innerHTML = `
    <div class="page-header"><div><h2>Couples</h2><p>Pairing status and health</p></div>
      <button class="btn secondary small" id="showOrphanedBtn">Show broken pairs only</button></div>
    <div class="card"><div class="table-wrap" id="couplesTable"><div class="loading-state">Loading…</div></div></div>`;
  let orphanedOnly = false;
  document.getElementById('showOrphanedBtn').addEventListener('click', () => {
    orphanedOnly = !orphanedOnly;
    document.getElementById('showOrphanedBtn').textContent = orphanedOnly ? 'Show all couples' : 'Show broken pairs only';
    loadCouples(orphanedOnly);
  });
  loadCouples(false);
};

async function loadCouples(orphanedOnly) {
  const tableEl = document.getElementById('couplesTable');
  tableEl.innerHTML = skeletonRows(4, 5);
  try {
    if (orphanedOnly) {
      const data = await api('/couples/orphaned');
      if (!data.orphaned.length) { tableEl.innerHTML = `<div class="empty-state">No broken or orphaned pairs found. ✓</div>`; return; }
      tableEl.innerHTML = renderCouplesTable(data.orphaned, true);
    } else {
      const data = await api('/couples');
      if (!data.couples.length) { tableEl.innerHTML = `<div class="empty-state">No couples yet.</div>`; return; }
      tableEl.innerHTML = renderCouplesTable(data.couples, false);
    }
    tableEl.querySelectorAll('[data-reset]').forEach(btn => btn.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Reset pairing?', body: 'This sets the couple back to unpaired so the remaining member can re-invite a partner. No data is deleted.', confirmLabel: 'Reset pairing' });
      if (!ok) return;
      try {
        await api(`/couples/${btn.dataset.reset}/reset-pairing`, { method: 'POST' });
        toast('Pairing reset');
        loadCouples(orphanedOnly);
      } catch (e) { toast(e.message, 'error'); }
    }));
  } catch (e) {
    tableEl.innerHTML = `<div class="error-state">${esc(e.message)}</div>`;
  }
}

function renderCouplesTable(rows, isOrphanView) {
  return `<table><thead><tr><th>Couple</th><th>Paired</th><th>Members</th><th>Created</th><th></th></tr></thead><tbody>
    ${rows.map(c => `<tr>
      <td>${esc(c.user1_name)} &amp; ${esc(c.user2_name)}</td>
      <td>${c.paired ? 'Yes' : 'No'} ${c.broken ? '<span class="badge suspended">broken</span>' : ''}</td>
      <td>${c.memberCount ?? '—'}</td>
      <td>${fmtDate(c.created_at)}</td>
      <td>${(isOrphanView || c.broken) ? `<button class="btn secondary small" data-reset="${c.id}">Reset pairing</button>` : ''}</td>
    </tr>`).join('')}
  </tbody></table>`;
}

/* ═══════════════════════════════════════════════════════════════
   RELEASES
   ═══════════════════════════════════════════════════════════════ */
renderers.releases = async (el) => {
  el.innerHTML = `
    <div class="page-header"><div><h2>Releases</h2><p>App version and update rollout</p></div>
      <button class="btn small" id="newReleaseBtn">+ New release</button></div>
    <div class="card" id="currentReleaseCard"><div class="loading-state">Loading…</div></div>
    <div class="card"><h3>All releases</h3><div id="releasesList"><div class="loading-state">Loading…</div></div></div>`;
  document.getElementById('newReleaseBtn').addEventListener('click', () => openReleaseForm());
  loadReleases();
};

async function loadReleases() {
  try {
    const current = await api('/releases/current');
    document.getElementById('currentReleaseCard').innerHTML = current.release ? `
      <h3>Currently active production release</h3>
      <div class="kv"><span class="k">Version</span><span>${esc(current.release.version)}</span></div>
      <div class="kv"><span class="k">Title</span><span>${esc(current.release.title)}</span></div>
      <div class="kv"><span class="k">Published</span><span>${fmtDate(current.release.published_at)}</span></div>
    ` : `<div class="empty-state">No release has been published yet.</div>`;
  } catch (e) { document.getElementById('currentReleaseCard').innerHTML = `<div class="error-state">${esc(e.message)}</div>`; }

  const listEl = document.getElementById('releasesList');
  listEl.innerHTML = skeletonRows(3, 5);
  try {
    const data = await api('/releases');
    if (!data.releases.length) { listEl.innerHTML = `<div class="empty-state">No releases yet — create your first one.</div>`; return; }
    listEl.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Version</th><th>Title</th><th>Type</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>
      ${data.releases.map(r => `<tr>
        <td>${esc(r.version)}${r.build ? ' (' + r.build + ')' : ''}</td>
        <td>${esc(r.title)}</td>
        <td><span class="badge ${r.update_type}">${esc(r.update_type)}</span></td>
        <td><span class="badge ${r.status}">${esc(r.status)}</span></td>
        <td>${fmtDate(r.created_at)}</td>
        <td>
          ${r.status === 'draft' ? `<button class="btn secondary small" data-edit="${r.id}">Edit</button> <button class="btn small" data-publish="${r.id}">Publish</button> <button class="btn danger small" data-delrel="${r.id}">Delete</button>` : ''}
          ${r.status === 'published' ? `<button class="btn secondary small" data-unpublish="${r.id}">Unpublish</button> <button class="btn secondary small" data-archive="${r.id}">Archive</button>` : ''}
        </td>
      </tr>`).join('')}
    </tbody></table></div>`;

    listEl.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openReleaseForm(data.releases.find(r => r.id === b.dataset.edit))));
    listEl.querySelectorAll('[data-publish]').forEach(b => b.addEventListener('click', async () => {
      try { await api(`/releases/${b.dataset.publish}/publish`, { method: 'POST' }); toast('Release published'); loadReleases(); }
      catch (e) { toast(e.message, 'error'); }
    }));
    listEl.querySelectorAll('[data-unpublish]').forEach(b => b.addEventListener('click', async () => {
      try { await api(`/releases/${b.dataset.unpublish}/unpublish`, { method: 'POST' }); toast('Release unpublished'); loadReleases(); }
      catch (e) { toast(e.message, 'error'); }
    }));
    listEl.querySelectorAll('[data-archive]').forEach(b => b.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Archive this release?', body: 'Archived releases become read-only history.', confirmLabel: 'Archive' });
      if (!ok) return;
      try { await api(`/releases/${b.dataset.archive}/archive`, { method: 'POST' }); toast('Release archived'); loadReleases(); }
      catch (e) { toast(e.message, 'error'); }
    }));
    listEl.querySelectorAll('[data-delrel]').forEach(b => b.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Delete this draft?', body: 'This permanently deletes the draft release.', confirmLabel: 'Delete' });
      if (!ok) return;
      try { await api(`/releases/${b.dataset.delrel}`, { method: 'DELETE' }); toast('Draft deleted'); loadReleases(); }
      catch (e) { toast(e.message, 'error'); }
    }));
  } catch (e) {
    listEl.innerHTML = `<div class="error-state">${esc(e.message)}</div>`;
  }
}

function openReleaseForm(existing) {
  const isEdit = !!existing;
  const html = `
    <h3>${isEdit ? 'Edit release' : 'New release'}</h3>
    <div class="field"><label>Version</label><input id="relVersion" value="${esc(existing?.version || '')}" placeholder="1.23"></div>
    <div class="field"><label>Build (optional)</label><input id="relBuild" value="${esc(existing?.build ?? '')}" placeholder="23"></div>
    <div class="field"><label>Title</label><input id="relTitle" value="${esc(existing?.title || '')}" placeholder="Twin AI companion"></div>
    <div class="field"><label>Update message</label><input id="relMessage" value="${esc(existing?.message || '')}" placeholder="Short one-liner shown in the prompt"></div>
    <div class="field"><label>Release notes</label><textarea id="relNotes" rows="4" placeholder="What's new…">${esc(existing?.notes || '')}</textarea></div>
    <div class="field"><label>Update type</label>
      <select id="relType">
        <option value="optional" ${existing?.update_type === 'optional' ? 'selected' : ''}>Optional</option>
        <option value="recommended" ${existing?.update_type === 'recommended' ? 'selected' : ''}>Recommended</option>
        <option value="required" ${existing?.update_type === 'required' ? 'selected' : ''}>Required</option>
      </select>
    </div>
    <div class="field"><label>Download / update URL</label><input id="relUrl" value="${esc(existing?.update_url || '')}" placeholder="https://…/twin-hearts.apk"></div>
    <div class="field"><label>Minimum supported version (optional)</label><input id="relMin" value="${esc(existing?.min_supported_version || '')}" placeholder="1.5"></div>
    <div class="hint">Recommended/Required updates cannot be published without a download URL.</div>
    <div class="modal-actions"><button class="btn secondary" id="relCancel">Cancel</button><button class="btn" id="relSave">${isEdit ? 'Save changes' : 'Create draft'}</button></div>`;
  openDrawer(html);
  document.getElementById('relCancel').addEventListener('click', closeDrawer);
  document.getElementById('relSave').addEventListener('click', async () => {
    const payload = {
      version: document.getElementById('relVersion').value.trim(),
      build: document.getElementById('relBuild').value.trim() ? parseInt(document.getElementById('relBuild').value, 10) : null,
      title: document.getElementById('relTitle').value.trim(),
      message: document.getElementById('relMessage').value.trim(),
      notes: document.getElementById('relNotes').value.trim(),
      update_type: document.getElementById('relType').value,
      update_url: document.getElementById('relUrl').value.trim(),
      min_supported_version: document.getElementById('relMin').value.trim()
    };
    try {
      if (isEdit) await api(`/releases/${existing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await api('/releases', { method: 'POST', body: JSON.stringify(payload) });
      toast(isEdit ? 'Release updated' : 'Draft created');
      closeDrawer(); loadReleases();
    } catch (e) { toast(e.message, 'error'); }
  });
}

/* ═══════════════════════════════════════════════════════════════
   NOTIFICATIONS
   ═══════════════════════════════════════════════════════════════ */
renderers.notifications = async (el) => {
  el.innerHTML = `
    <div class="page-header"><div><h2>Notifications</h2><p>Announcements and release pushes</p></div>
      <button class="btn small" id="newNotifBtn">+ Compose</button></div>
    <div class="card"><h3>History</h3><div id="notifList"><div class="loading-state">Loading…</div></div></div>`;
  document.getElementById('newNotifBtn').addEventListener('click', openNotifComposer);
  loadNotifs();
};

async function loadNotifs() {
  const el = document.getElementById('notifList');
  el.innerHTML = skeletonRows(3, 5);
  try {
    const data = await api('/notifications');
    if (!data.notifications.length) { el.innerHTML = `<div class="empty-state">No notifications sent yet.</div>`; return; }
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Title</th><th>Audience</th><th>Status</th><th>Created</th><th>Sent</th><th></th></tr></thead><tbody>
      ${data.notifications.map(n => `<tr>
        <td>${esc(n.title)}</td><td>${esc(n.audience)}</td>
        <td><span class="badge ${n.status}">${esc(n.status)}</span></td>
        <td>${fmtDate(n.created_at)}</td><td>${fmtDate(n.sent_at)}</td>
        <td>${n.status === 'draft' ? `<button class="btn small" data-send="${n.id}">Send</button> <button class="btn danger small" data-delnotif="${n.id}">Delete</button>` : (n.result?.recipientCount !== undefined ? `${n.result.recipientCount} recipients` : '')}</td>
      </tr>`).join('')}
    </tbody></table></div>`;
    el.querySelectorAll('[data-send]').forEach(b => b.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Send this notification now?', body: 'This pushes to every matching recipient immediately and cannot be undone.', confirmLabel: 'Send now' });
      if (!ok) return;
      try { await api(`/notifications/${b.dataset.send}/send`, { method: 'POST' }); toast('Notification sent'); loadNotifs(); }
      catch (e) { toast(e.message, 'error'); }
    }));
    el.querySelectorAll('[data-delnotif]').forEach(b => b.addEventListener('click', async () => {
      try { await api(`/notifications/${b.dataset.delnotif}`, { method: 'DELETE' }); toast('Draft deleted'); loadNotifs(); }
      catch (e) { toast(e.message, 'error'); }
    }));
  } catch (e) { el.innerHTML = `<div class="error-state">${esc(e.message)}</div>`; }
}

function openNotifComposer() {
  const html = `
    <h3>Compose notification</h3>
    <div class="field"><label>Title</label><input id="notifTitle" placeholder="Twinhearts 1.5 is available"></div>
    <div class="field"><label>Message</label><textarea id="notifMessage" rows="3" placeholder="A new version with improvements and fixes is ready."></textarea></div>
    <div class="field"><label>Type</label>
      <select id="notifType">
        <option value="announcement">Announcement</option>
        <option value="new_release">New release</option>
        <option value="maintenance">Maintenance</option>
        <option value="info">Info</option>
      </select>
    </div>
    <div class="field"><label>Audience</label>
      <select id="notifAudience"><option value="all">Everyone</option><option value="user1">User 1 role</option><option value="user2">User 2 role</option></select>
    </div>
    <div id="notifPreview" class="hint"></div>
    <div class="modal-actions">
      <button class="btn secondary" id="notifCancel">Cancel</button>
      <button class="btn secondary" id="notifSaveDraft">Save draft</button>
      <button class="btn" id="notifSendNow">Send now</button>
    </div>`;
  openDrawer(html);
  document.getElementById('notifCancel').addEventListener('click', closeDrawer);

  async function updatePreview() {
    const title = document.getElementById('notifTitle').value.trim();
    const message = document.getElementById('notifMessage').value.trim();
    const audience = document.getElementById('notifAudience').value;
    if (!title || !message) { document.getElementById('notifPreview').textContent = ''; return; }
    try {
      const data = await api('/notifications/preview', { method: 'POST', body: JSON.stringify({ title, message, audience }) });
      document.getElementById('notifPreview').textContent = `Will reach ${data.preview.recipientCount} recipient(s).`;
    } catch (e) { /* silent — preview is best-effort */ }
  }
  ['notifTitle', 'notifMessage', 'notifAudience'].forEach(id => document.getElementById(id).addEventListener('input', debounce(updatePreview, 300)));

  function collect() {
    return {
      title: document.getElementById('notifTitle').value.trim(),
      message: document.getElementById('notifMessage').value.trim(),
      type: document.getElementById('notifType').value,
      audience: document.getElementById('notifAudience').value
    };
  }
  document.getElementById('notifSaveDraft').addEventListener('click', async () => {
    try { await api('/notifications', { method: 'POST', body: JSON.stringify(collect()) }); toast('Draft saved'); closeDrawer(); loadNotifs(); }
    catch (e) { toast(e.message, 'error'); }
  });
  document.getElementById('notifSendNow').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Send immediately?', body: 'This pushes to matching recipients right now.', confirmLabel: 'Send now' });
    if (!ok) return;
    try { await api('/notifications', { method: 'POST', body: JSON.stringify({ ...collect(), sendNow: true }) }); toast('Notification sent'); closeDrawer(); loadNotifs(); }
    catch (e) { toast(e.message, 'error'); }
  });
}

/* ═══════════════════════════════════════════════════════════════
   FEATURE FLAGS
   ═══════════════════════════════════════════════════════════════ */
renderers.flags = async (el) => {
  el.innerHTML = `
    <div class="page-header"><div><h2>Feature Flags</h2><p>Remote config — controls functionality, not authorization</p></div>
      <button class="btn small" id="newFlagBtn">+ New flag</button></div>
    <div class="card"><div id="flagsList"><div class="loading-state">Loading…</div></div></div>`;
  document.getElementById('newFlagBtn').addEventListener('click', () => openFlagForm());
  loadFlags();
};

async function loadFlags() {
  const el = document.getElementById('flagsList');
  el.innerHTML = skeletonRows(3, 4);
  try {
    const data = await api('/flags');
    if (!data.flags.length) { el.innerHTML = `<div class="empty-state">No feature flags yet.</div>`; return; }
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Flag</th><th>Rollout</th><th>Enabled</th><th></th></tr></thead><tbody>
      ${data.flags.map(f => `<tr>
        <td><strong>${esc(f.name)}</strong><br><span class="mono text-muted">${esc(f.key)}</span></td>
        <td>${esc(f.rollout_type)}${f.rollout_type === 'percentage' ? ' (' + (f.rollout_value?.percentage ?? 0) + '%)' : ''}</td>
        <td><label class="switch"><input type="checkbox" data-toggle="${f.id}" ${f.enabled ? 'checked' : ''}><span class="slider"></span></label></td>
        <td><button class="btn secondary small" data-editflag="${f.id}">Edit</button> <button class="btn danger small" data-delflag="${f.id}">Delete</button></td>
      </tr>`).join('')}
    </tbody></table></div>`;

    el.querySelectorAll('[data-toggle]').forEach(cb => cb.addEventListener('change', async () => {
      try { await api(`/flags/${cb.dataset.toggle}/toggle`, { method: 'POST' }); toast('Flag updated'); }
      catch (e) { toast(e.message, 'error'); cb.checked = !cb.checked; }
    }));
    el.querySelectorAll('[data-editflag]').forEach(b => b.addEventListener('click', () => openFlagForm(data.flags.find(f => f.id === b.dataset.editflag))));
    el.querySelectorAll('[data-delflag]').forEach(b => b.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Delete this flag?', body: 'The app will stop receiving this flag entirely.', confirmLabel: 'Delete' });
      if (!ok) return;
      try { await api(`/flags/${b.dataset.delflag}`, { method: 'DELETE' }); toast('Flag deleted'); loadFlags(); }
      catch (e) { toast(e.message, 'error'); }
    }));
  } catch (e) { el.innerHTML = `<div class="error-state">${esc(e.message)}</div>`; }
}

function openFlagForm(existing) {
  const isEdit = !!existing;
  const rv = existing?.rollout_value || {};
  const html = `
    <h3>${isEdit ? 'Edit flag' : 'New feature flag'}</h3>
    <div class="field"><label>Key ${isEdit ? '(read-only)' : '(lowercase_snake_case)'}</label><input id="flagKey" value="${esc(existing?.key || '')}" placeholder="ai_both_mode" ${isEdit ? 'disabled' : ''}></div>
    <div class="field"><label>Display name</label><input id="flagName" value="${esc(existing?.name || '')}" placeholder="AI Both Mode"></div>
    <div class="field"><label>Description</label><textarea id="flagDesc" rows="2">${esc(existing?.description || '')}</textarea></div>
    <div class="field"><label>Rollout type</label>
      <select id="flagRolloutType">
        <option value="everyone" ${existing?.rollout_type === 'everyone' ? 'selected' : ''}>Everyone</option>
        <option value="test_users" ${existing?.rollout_type === 'test_users' ? 'selected' : ''}>Test users</option>
        <option value="percentage" ${existing?.rollout_type === 'percentage' ? 'selected' : ''}>Percentage</option>
      </select>
    </div>
    <div class="field" id="flagRolloutValueWrap">
      <label id="flagRolloutValueLabel">Rollout value</label>
      <input id="flagRolloutValue" value="${esc(rv.percentage ?? (rv.userIds ? rv.userIds.join(',') : ''))}" placeholder="e.g. 25 or user-id-1,user-id-2">
      <div class="hint">Percentage: a number 0–100. Test users: comma-separated user IDs.</div>
    </div>
    <div class="field"><label><input type="checkbox" id="flagEnabled" ${existing?.enabled ? 'checked' : ''}> Enabled</label></div>
    <div class="modal-actions"><button class="btn secondary" id="flagCancel">Cancel</button><button class="btn" id="flagSave">${isEdit ? 'Save' : 'Create'}</button></div>`;
  openDrawer(html);
  document.getElementById('flagCancel').addEventListener('click', closeDrawer);
  document.getElementById('flagSave').addEventListener('click', async () => {
    const rolloutType = document.getElementById('flagRolloutType').value;
    const rawVal = document.getElementById('flagRolloutValue').value.trim();
    let rollout_value = {};
    if (rolloutType === 'percentage') rollout_value = { percentage: Math.max(0, Math.min(100, parseInt(rawVal, 10) || 0)) };
    if (rolloutType === 'test_users') rollout_value = { userIds: rawVal ? rawVal.split(',').map(s => s.trim()).filter(Boolean) : [] };

    const payload = {
      name: document.getElementById('flagName').value.trim(),
      description: document.getElementById('flagDesc').value.trim(),
      rollout_type: rolloutType,
      rollout_value,
      enabled: document.getElementById('flagEnabled').checked
    };
    if (!isEdit) payload.key = document.getElementById('flagKey').value.trim();

    try {
      if (isEdit) await api(`/flags/${existing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await api('/flags', { method: 'POST', body: JSON.stringify(payload) });
      toast(isEdit ? 'Flag updated' : 'Flag created');
      closeDrawer(); loadFlags();
    } catch (e) { toast(e.message, 'error'); }
  });
}

/* ═══════════════════════════════════════════════════════════════
   APP HEALTH
   ═══════════════════════════════════════════════════════════════ */
renderers.health = async (el) => {
  el.innerHTML = `
    <div class="page-header"><div><h2>App Health</h2><p>Operational error log — no message content is ever logged here</p></div></div>
    <div class="kpi-grid" id="healthCounts"></div>
    <div class="card"><div class="toolbar">
        <select id="healthSeverity"><option value="">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="info">Info</option></select>
      </div><div id="healthList"><div class="loading-state">Loading…</div></div></div>`;
  document.getElementById('healthSeverity').addEventListener('change', loadHealth);
  loadHealth();
};

async function loadHealth() {
  const el = document.getElementById('healthList');
  el.innerHTML = skeletonRows(4, 4);
  try {
    const sev = document.getElementById('healthSeverity').value;
    const data = await api('/health/errors?' + new URLSearchParams({ severity: sev }).toString());
    document.getElementById('healthCounts').innerHTML = `
      <div class="kpi-card"><div class="label">Critical</div><div class="value">${data.counts.critical}</div></div>
      <div class="kpi-card"><div class="label">Warning</div><div class="value">${data.counts.warning}</div></div>
      <div class="kpi-card"><div class="label">Info</div><div class="value">${data.counts.info}</div></div>`;
    if (!data.errors.length) { el.innerHTML = `<div class="empty-state">No errors logged. ✓</div>`; return; }
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Severity</th><th>Source</th><th>Message</th><th>When</th></tr></thead><tbody>
      ${data.errors.map(e => `<tr><td><span class="badge ${e.severity}">${esc(e.severity)}</span></td><td class="mono">${esc(e.source)}</td><td>${esc(e.message)}</td><td>${fmtDate(e.created_at)}</td></tr>`).join('')}
    </tbody></table></div>`;
  } catch (e) { el.innerHTML = `<div class="error-state">${esc(e.message)}</div>`; }
}

/* ═══════════════════════════════════════════════════════════════
   AUDIT LOG
   ═══════════════════════════════════════════════════════════════ */
let auditPage = 1;
renderers.audit = async (el) => {
  el.innerHTML = `<div class="page-header"><div><h2>Audit Logs</h2><p>Every admin action, permanently recorded</p></div></div>
    <div class="card"><div id="auditList"><div class="loading-state">Loading…</div></div>
      <div class="pagination" id="auditPagination"></div></div>`;
  auditPage = 1;
  loadAudit();
};

async function loadAudit() {
  const el = document.getElementById('auditList');
  el.innerHTML = skeletonRows(5, 4);
  try {
    const data = await api('/health/audit?page=' + auditPage);
    if (!data.entries.length) { el.innerHTML = `<div class="empty-state">No audit entries yet.</div>`; document.getElementById('auditPagination').innerHTML = ''; return; }
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Action</th><th>Target</th><th>Admin</th><th>When</th></tr></thead><tbody>
      ${data.entries.map(a => `<tr><td>${esc(a.action)}</td><td>${esc(a.target_type || '—')}${a.target_id ? ' · ' + esc(String(a.target_id).slice(0, 8)) : ''}</td><td>${esc(a.admin_email)}</td><td>${fmtDate(a.created_at)}</td></tr>`).join('')}
    </tbody></table></div>`;
    document.getElementById('auditPagination').innerHTML = `
      <button class="btn secondary small" id="auditPrev" ${data.page <= 1 ? 'disabled' : ''}>Prev</button>
      <span>Page ${data.page} of ${data.totalPages}</span>
      <button class="btn secondary small" id="auditNext" ${data.page >= data.totalPages ? 'disabled' : ''}>Next</button>`;
    const p = document.getElementById('auditPrev'), n = document.getElementById('auditNext');
    if (p) p.addEventListener('click', () => { auditPage--; loadAudit(); });
    if (n) n.addEventListener('click', () => { auditPage++; loadAudit(); });
  } catch (e) { el.innerHTML = `<div class="error-state">${esc(e.message)}</div>`; }
}

/* ═══════════════════════════════════════════════════════════════
   SUPPORT & CUSTOMER CARE
   ═══════════════════════════════════════════════════════════════ */
let supportActiveTicketId = null;
let supportPollTimer = null;
let supportFilterStatus = 'all';
let supportSearchQuery = '';

const CANNED_REPLIES = [
  'Select a quick response…',
  'Hello! Welcome to Twin Hearts support. How can I help you today?',
  'Thank you for reporting this. We have resolved the issue on your account. Please reload the app!',
  'Could you please share your partner\'s registered phone number so we can check your connection?',
  'Please check that push notifications are enabled in both Twin Hearts Settings and your phone system settings.',
  'Your data and photos are safely backed up in the cloud. Let us know if you need help syncing.',
  'We have noted your feedback and will include this in our upcoming app release. Thank you for using Twin Hearts! 💕'
];

renderers.support = async (el) => {
  if (supportPollTimer) clearInterval(supportPollTimer);

  el.innerHTML = `
    <div class="page-header">
      <div>
        <h2>Customer Care &amp; Support</h2>
        <p>Live user chats, Twin Care AI conversations, and manual care management</p>
      </div>
      <div>
        <button class="btn secondary small" id="supportRefreshBtn">↻ Refresh</button>
      </div>
    </div>

    <!-- KPI Summary -->
    <div class="grid grid-4" id="supportKpis" style="margin-bottom:16px">
      <div class="card kpi"><div class="label">Total Inquiries</div><div class="val" id="kpiSupTotal">—</div></div>
      <div class="card kpi"><div class="label">Waiting Admin Reply</div><div class="val" id="kpiSupWaiting" style="color:var(--amber)">—</div></div>
      <div class="card kpi"><div class="label">Active / AI Mode</div><div class="val" id="kpiSupOpen" style="color:var(--green)">—</div></div>
      <div class="card kpi"><div class="label">Resolved</div><div class="val" id="kpiSupResolved" style="color:var(--text3)">—</div></div>
    </div>

    <!-- Split layout: tickets list + chat thread -->
    <div class="support-layout">
      <!-- Left sidebar -->
      <div class="support-sidebar">
        <div class="support-sidebar-header">
          <input type="search" id="supportSearchInput" placeholder="Search user, email or message…" autocomplete="off" value="${esc(supportSearchQuery)}">
          <div style="display:flex;gap:6px">
            <select id="supportStatusFilter" style="flex:1">
              <option value="all" ${supportFilterStatus === 'all' ? 'selected' : ''}>All Conversations</option>
              <option value="waiting" ${supportFilterStatus === 'waiting' ? 'selected' : ''}>⚠️ Needs Reply</option>
              <option value="open" ${supportFilterStatus === 'open' ? 'selected' : ''}>Active / Open</option>
              <option value="resolved" ${supportFilterStatus === 'resolved' ? 'selected' : ''}>Resolved</option>
            </select>
          </div>
        </div>
        <div class="support-ticket-list" id="supportTicketList">
          <div class="loading-state">Loading conversations…</div>
        </div>
      </div>

      <!-- Right chat thread -->
      <div class="support-main" id="supportMainPane">
        <div class="support-main-empty">
          <div style="font-size:36px">💬</div>
          <h3>Select a Conversation</h3>
          <p>Choose any inquiry from the left to view message history, AI answers, or reply live.</p>
        </div>
      </div>
    </div>
  `;

  document.getElementById('supportRefreshBtn').addEventListener('click', () => {
    loadSupportOverview();
    loadSupportTickets();
    if (supportActiveTicketId) loadActiveTicket(supportActiveTicketId);
  });

  document.getElementById('supportStatusFilter').addEventListener('change', (e) => {
    supportFilterStatus = e.target.value;
    loadSupportTickets();
  });

  document.getElementById('supportSearchInput').addEventListener('input', debounce((e) => {
    supportSearchQuery = e.target.value;
    loadSupportTickets();
  }, 300));

  await loadSupportOverview();
  await loadSupportTickets();

  // Polling every 5s while on the support page
  supportPollTimer = setInterval(() => {
    if (state.currentPage === 'support') {
      loadSupportOverview(true);
      loadSupportTickets(true);
      if (supportActiveTicketId) loadActiveTicket(supportActiveTicketId, true);
    } else {
      clearInterval(supportPollTimer);
    }
  }, 5000);
};

async function loadSupportOverview(silent = false) {
  try {
    const data = await api('/support/overview');
    if (data.stats) {
      document.getElementById('kpiSupTotal').textContent = data.stats.total;
      document.getElementById('kpiSupWaiting').textContent = data.stats.waiting_admin;
      document.getElementById('kpiSupOpen').textContent = data.stats.open;
      document.getElementById('kpiSupResolved').textContent = data.stats.resolved;
    }
  } catch (e) {
    if (!silent) console.error('support overview error:', e);
  }
}

async function loadSupportTickets(silent = false) {
  const container = document.getElementById('supportTicketList');
  if (!container) return;

  try {
    let url = `/support/tickets?status=${encodeURIComponent(supportFilterStatus)}`;
    if (supportSearchQuery) url += `&search=${encodeURIComponent(supportSearchQuery)}`;
    const data = await api(url);
    const tickets = data.tickets || [];

    if (!tickets.length) {
      container.innerHTML = `<div class="empty-state">No conversations found.</div>`;
      return;
    }

    container.innerHTML = tickets.map(t => {
      const isSelected = t.id === supportActiveTicketId;
      const statusBadge = t.status === 'waiting_admin' 
        ? `<span class="badge" style="background:#5c1d0c;color:#fb923c">⚠️ Waiting</span>`
        : t.status === 'resolved'
        ? `<span class="badge" style="background:#1e293b;color:#94a3b8">Resolved</span>`
        : `<span class="badge" style="background:#134e4a;color:#2dd4bf">Open</span>`;

      const modeBadge = t.mode === 'human'
        ? `<span class="badge" style="background:#701a75;color:#f472b6">👤 Human</span>`
        : `<span class="badge" style="background:#1e3a8a;color:#60a5fa">🤖 AI</span>`;

      const unreadHtml = t.unread_admin > 0
        ? `<span style="background:var(--accent);color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:10px">${t.unread_admin} new</span>`
        : '';

      const timeStr = t.updated_at ? fmtDate(t.updated_at) : '';

      return `
        <div class="ticket-row ${isSelected ? 'active' : ''}" data-ticket-id="${t.id}" onclick="selectSupportTicket('${t.id}')">
          <div class="ticket-row-top">
            <span class="ticket-user-name">${esc(t.user_name || 'User')} ${unreadHtml}</span>
            <span class="ticket-time">${timeStr}</span>
          </div>
          <div class="ticket-snippet">${esc(t.last_message || 'No messages yet')}</div>
          <div class="ticket-meta">
            ${statusBadge}
            ${modeBadge}
            ${t.user_phone ? `<span style="font-size:11px;color:var(--text3)">📞 ${esc(t.user_phone)}</span>` : ''}
          </div>
        </div>
      `;
    }).join('');

    // If an active ticket is set, keep it highlighted
    if (supportActiveTicketId) {
      const activeEl = container.querySelector(`[data-ticket-id="${supportActiveTicketId}"]`);
      if (activeEl) activeEl.classList.add('active');
    }
  } catch (e) {
    if (!silent) container.innerHTML = `<div class="error-state">${esc(e.message)}</div>`;
  }
}

async function selectSupportTicket(ticketId) {
  supportActiveTicketId = ticketId;
  document.querySelectorAll('.ticket-row').forEach(r => {
    r.classList.toggle('active', r.dataset.ticketId === ticketId);
  });
  await loadActiveTicket(ticketId);
}

async function loadActiveTicket(ticketId, isPoll = false) {
  const mainPane = document.getElementById('supportMainPane');
  if (!mainPane) return;

  try {
    const data = await api(`/support/ticket/${ticketId}`);
    const t = data.ticket;
    if (!t) return;

    // Check if user is typing or if message list needs update
    const messages = t.messages || [];

    if (!isPoll || !document.getElementById('supportMessagesScroll')) {
      mainPane.innerHTML = `
        <div class="support-thread-header">
          <div class="support-thread-user">
            <h3>${esc(t.user_name || 'Valued User')} ${t.mode === 'human' ? '👤 Live Chat' : '🤖 AI Assisted'}</h3>
            <p>
              ${t.user_phone ? `Phone: ${esc(t.user_phone)} · ` : ''}
              ${t.user_email ? `Email: ${esc(t.user_email)} · ` : ''}
              ${t.couple_id ? `Couple: ${esc(String(t.couple_id).slice(0, 8))}… · ` : ''}
              Started: ${fmtDate(t.created_at)}
            </p>
          </div>
          <div class="support-thread-actions">
            <select id="ticketStatusSelect" onchange="changeTicketStatus('${t.id}', this.value)" style="background:var(--panel);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:6px 9px;font-size:12px">
              <option value="open" ${t.status === 'open' ? 'selected' : ''}>Status: Open</option>
              <option value="waiting_admin" ${t.status === 'waiting_admin' ? 'selected' : ''}>Status: Waiting Admin</option>
              <option value="waiting_user" ${t.status === 'waiting_user' ? 'selected' : ''}>Status: Waiting User</option>
              <option value="resolved" ${t.status === 'resolved' ? 'selected' : ''}>Status: Resolved</option>
            </select>
            <button class="btn danger small" onclick="deleteSupportTicket('${t.id}')">Delete</button>
          </div>
        </div>

        <div class="support-messages-scroll" id="supportMessagesScroll">
          <!-- Messages -->
        </div>

        <div class="support-composer">
          <div class="support-composer-tools">
            <select id="cannedRepliesSelect" onchange="applyCannedReply(this.value)" style="background:var(--panel);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;font-size:12px">
              ${CANNED_REPLIES.map((r, i) => `<option value="${i === 0 ? '' : esc(r)}">${esc(r)}</option>`).join('')}
            </select>
          </div>
          <textarea id="adminReplyText" placeholder="Type a direct reply to the user (sent directly to user's chat bar)..." rows="3"></textarea>
          <div class="support-composer-actions">
            <span style="font-size:12px;color:var(--text3)">Replying as Twin Hearts Support</span>
            <div style="display:flex;gap:8px">
              <button class="btn secondary small" onclick="resolveAndReply('${t.id}')">Send &amp; Resolve</button>
              <button class="btn small" id="adminSendReplyBtn" onclick="sendAdminReply('${t.id}')">Send Reply</button>
            </div>
          </div>
        </div>
      `;

      // Enter key to send (Ctrl+Enter or Cmd+Enter)
      const ta = document.getElementById('adminReplyText');
      if (ta) {
        ta.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            sendAdminReply(t.id);
          }
        });
      }
    }

    renderSupportMessages(messages);
  } catch (e) {
    if (!isPoll) mainPane.innerHTML = `<div class="error-state">${esc(e.message)}</div>`;
  }
}

function renderSupportMessages(messages) {
  const scrollEl = document.getElementById('supportMessagesScroll');
  if (!scrollEl) return;

  const atBottom = scrollEl.scrollHeight - scrollEl.scrollTop <= scrollEl.clientHeight + 50;

  scrollEl.innerHTML = (messages || []).map(m => {
    const isUser = m.sender === 'user';
    const isAdmin = m.sender === 'admin';
    const isAi = m.sender === 'ai';

    const avatarChar = isUser ? '👤' : isAdmin ? '🛡️' : '🤖';
    const tagHtml = isAi ? '<span class="badge info" style="font-size:9px;padding:1px 5px">AI Generated</span>'
      : isAdmin ? '<span class="badge" style="font-size:9px;padding:1px 5px;background:var(--accent);color:#fff">Admin</span>'
      : '<span class="badge" style="font-size:9px;padding:1px 5px;background:#380725;color:#f5c8e2">Customer</span>';

    return `
      <div class="adm-msg-row ${m.sender}">
        <div class="adm-avatar ${m.sender}">${avatarChar}</div>
        <div class="adm-msg-body">
          <div class="adm-msg-header">
            <span>${esc(m.sender_name || (isUser ? 'Customer' : isAdmin ? 'Support Team' : 'Twin Care AI'))}</span>
            ${tagHtml}
            <span style="opacity:0.7">${fmtDate(m.created_at)}</span>
          </div>
          <div class="adm-msg-bubble">${esc(m.text)}</div>
        </div>
      </div>
    `;
  }).join('');

  if (atBottom) {
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }
}

function applyCannedReply(text) {
  if (!text) return;
  const ta = document.getElementById('adminReplyText');
  if (ta) {
    ta.value = text;
    ta.focus();
  }
  document.getElementById('cannedRepliesSelect').selectedIndex = 0;
}

async function sendAdminReply(ticketId) {
  const ta = document.getElementById('adminReplyText');
  const text = (ta?.value || '').trim();
  if (!text) return;

  const btn = document.getElementById('adminSendReplyBtn');
  btn.disabled = true;

  try {
    const res = await api(`/support/ticket/${ticketId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ text })
    });
    ta.value = '';
    toast('Reply sent to customer!');
    await loadActiveTicket(ticketId);
    await loadSupportOverview(true);
    await loadSupportTickets(true);
  } catch (e) {
    toast('Failed to send reply: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function resolveAndReply(ticketId) {
  const ta = document.getElementById('adminReplyText');
  const text = (ta?.value || '').trim();
  if (text) {
    await sendAdminReply(ticketId);
  }
  await changeTicketStatus(ticketId, 'resolved');
}

async function changeTicketStatus(ticketId, status) {
  try {
    await api(`/support/ticket/${ticketId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    toast(`Ticket marked as ${status}`);
    await loadActiveTicket(ticketId, true);
    await loadSupportOverview(true);
    await loadSupportTickets(true);
  } catch (e) {
    toast('Status update failed: ' + e.message, 'error');
  }
}

async function deleteSupportTicket(ticketId) {
  const ok = await confirmDialog({
    title: 'Delete Support Conversation?',
    body: 'This will permanently remove this customer inquiry and all message logs.',
    confirmLabel: 'Delete Ticket'
  });
  if (!ok) return;

  try {
    await api(`/support/ticket/${ticketId}`, { method: 'DELETE' });
    toast('Ticket deleted');
    supportActiveTicketId = null;
    document.getElementById('supportMainPane').innerHTML = `
      <div class="support-main-empty">
        <div style="font-size:36px">💬</div>
        <h3>Select a Conversation</h3>
        <p>Choose any inquiry from the left to view message history, AI answers, or reply live.</p>
      </div>
    `;
    await loadSupportOverview();
    await loadSupportTickets();
  } catch (e) {
    toast('Failed to delete ticket: ' + e.message, 'error');
  }
}

/* ── Utilities ─────────────────────────────────────────────────── */
function skeletonRows(rows, cols) {
  return `<table><tbody>${Array.from({ length: rows }).map(() => `<tr class="skeleton-row">${Array.from({ length: cols }).map(() => `<td></td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* ── Boot ─────────────────────────────────────────────────────── */
checkAuth();

