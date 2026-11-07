/* ═══════════════════════════════════════════════════════════════
   TWIN CINEMA — movie-night invite (Twin Hearts side)
   • "Twin Cinema" row (Together page) → host sheet → opens the cinema lobby
   • Partner side: polls /api/cinema/pending and shows an invite card
     (Accept → opens the cinema with their own avatar; Not now → host is told)
   • Push taps arrive as /?cinema=<id>; the same check shows the card straight away.
   Purely additive: nothing else in the app calls into this file.
   Backend: routes/cinema.js · Theatre: the separate twin-cinemas deploy.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.TwinCinema) return;

  var POLL_MS = 6000;
  var shown = null, dismissed = {}, timer = null, busy = false;

  function st() { return window.S || {}; }
  function api() { return window.API || 'https://us-app-av6d.onrender.com'; }
  function ready() { var s = st(); return !!(s.coupleId && s.role && String(s.coupleId).indexOf('solo_') !== 0 && s.paired !== false); }
  function say(t) { try { if (typeof window.toast === 'function') return window.toast(t); } catch (_) {} try { alert(t); } catch (_) {} }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  // Which cinema avatar am I? girl = 1, boy = 2. Unknown → user1 = 1, user2 = 2. (The guest always gets the other one.)
  function mySlot() {
    var s = st(), rk = s.role === 'user1' ? 'u1' : 'u2', g = s.profile && s.profile[rk] && s.profile[rk].gender;
    if (g === 'male') return 2;
    if (g === 'female') return 1;
    return s.role === 'user1' ? 1 : 2;
  }

  function call(method, path, body) {
    var opt = { method: method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
    if (body) opt.body = JSON.stringify(body);
    return fetch(api() + '/api/cinema' + path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; throw e; } return j; });
    });
  }

  // The cinema gets a "back" link so Leave / ← Twin Hearts returns here.
  function go(url) {
    var sep = url.indexOf('#') >= 0 ? '&' : '#';
    window.location.href = url + sep + 'b=' + encodeURIComponent(location.origin + '/');
  }

  /* ── styles (injected once) ── */
  function css() {
    if (document.getElementById('tcn-css')) return;
    var s = document.createElement('style'); s.id = 'tcn-css';
    s.textContent =
      '.tcn-back{position:fixed;inset:0;z-index:99990;background:rgba(10,4,20,.6);display:flex;align-items:flex-end;justify-content:center;animation:tcnF .18s ease}' +
      '.tcn-card{width:min(440px,100%);background:linear-gradient(160deg,#2a0f3d,#4a1457);color:#fff;border-radius:22px 22px 0 0;padding:22px 20px calc(22px + env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(0,0,0,.45);animation:tcnU .22s ease}' +
      '.tcn-top{display:flex;align-items:center;gap:12px;margin-bottom:6px}.tcn-ico{font-size:34px}.tcn-av{width:46px;height:46px;border-radius:50%;object-fit:cover;border:2px solid #ff4fa0}' +
      '.tcn-card h3{margin:0;font-size:19px}.tcn-card p{margin:4px 0 14px;color:#e4c9f2;font-size:14px;line-height:1.4}' +
      '.tcn-card input{width:100%;box-sizing:border-box;padding:12px 14px;border-radius:12px;border:1px solid #7b3d99;background:rgba(255,255,255,.08);color:#fff;font:inherit;margin-bottom:14px}' +
      '.tcn-row{display:flex;gap:10px}.tcn-row button{flex:1;padding:13px;border-radius:14px;border:1px solid #7b3d99;background:rgba(255,255,255,.1);color:#fff;font:inherit;font-weight:600;cursor:pointer}' +
      '.tcn-row button.go{background:linear-gradient(135deg,#d6338a,#8e3fd4);border-color:transparent}.tcn-row button:disabled{opacity:.6}' +
      '@keyframes tcnF{from{opacity:0}to{opacity:1}}@keyframes tcnU{from{transform:translateY(40px)}to{transform:none}}';
    document.head.appendChild(s);
  }
  function close() { var e = document.getElementById('tcn-ov'); if (e) e.remove(); shown = null; }
  function sheet(html) {
    css(); close();
    var d = document.createElement('div'); d.className = 'tcn-back'; d.id = 'tcn-ov';
    d.innerHTML = '<div class="tcn-card">' + html + '</div>';
    d.addEventListener('click', function (e) { if (e.target === d && d.dataset.lock !== '1') close(); });
    document.body.appendChild(d); return d;
  }

  /* ── host: Together → Twin Cinema ── */
  function open() {
    if (!ready()) return say('Connect with your partner first to plan a movie night 🎬');
    var s = st(), pn = esc(s.partnerName || 'your partner');
    var d = sheet(
      '<div class="tcn-top"><span class="tcn-ico">🍿</span><div><h3>Movie night</h3></div></div>' +
      '<p>You will enter the cinema lobby first. Invite ' + pn + ' from there, and when they accept you both go in together.</p>' +
      '<input id="tcn-movie" maxlength="60" placeholder="What are you watching? (optional)">' +
      '<div class="tcn-row"><button id="tcn-no">Cancel</button><button id="tcn-go" class="go">Open cinema lobby</button></div>');
    d.querySelector('#tcn-no').onclick = close;
    d.querySelector('#tcn-go').onclick = function () {
      var b = this; b.disabled = true; b.textContent = 'Opening…';
      call('POST', '/create', { coupleId: s.coupleId, role: s.role, slot: mySlot(), movie: d.querySelector('#tcn-movie').value.trim() })
        .then(function (r) { go(r.url); })
        .catch(function (e) { b.disabled = false; b.textContent = 'Open cinema lobby'; say('Could not open the cinema: ' + e.message); });
    };
  }

  /* ── partner: invite card ── */
  function showInvite(inv) {
    if (window.TwinCinema && window.TwinCinema.hold) return;      // movie page is auto-joining this one
    if (shown === inv.id || dismissed[inv.id]) return;
    shown = inv.id;
    var s = st(), name = esc(inv.hostName || s.partnerName || 'Your partner');
    var av = inv.hostAvatar && /^(https?:|data:image\/|\/)/.test(inv.hostAvatar) ? '<img class="tcn-av" src="' + esc(inv.hostAvatar) + '" alt="">' : '<span class="tcn-ico">🎬</span>';
    var d = sheet(
      '<div class="tcn-top">' + av + '<div><h3>' + name + ' invited you</h3></div></div>' +
      '<p>🍿 Movie night in Twin Cinema' + (inv.movie ? ' · <b>' + esc(inv.movie) + '</b>' : '') + '. They are already waiting in the lobby.</p>' +
      '<div class="tcn-row"><button id="tcn-dec">Not now</button><button id="tcn-acc" class="go">Accept ♥</button></div>');
    d.dataset.lock = '1';
    d.querySelector('#tcn-dec').onclick = function () {
      dismissed[inv.id] = 1; close();
      call('POST', '/' + inv.id + '/decline', { coupleId: s.coupleId, role: s.role }).catch(function () {});
    };
    d.querySelector('#tcn-acc').onclick = function () {
      var b = this; b.disabled = true; b.textContent = 'Joining…';
      call('POST', '/' + inv.id + '/accept', { coupleId: s.coupleId, role: s.role })
        .then(function (r) { dismissed[inv.id] = 1; go(r.url); })
        .catch(function (e) { close(); dismissed[inv.id] = 1; say(e.status === 410 || e.status === 409 ? 'That invite is no longer open — ask for a new one 🎬' : 'Could not join: ' + e.message); });
    };
  }

  function check() {
    if (busy || document.hidden || !ready()) return;
    var s = st(); busy = true;
    call('GET', '/pending/' + encodeURIComponent(s.coupleId) + '?role=' + encodeURIComponent(s.role))
      .then(function (r) {
        if (r.invite) showInvite(r.invite);
        else if (shown) close();                      // host cancelled / invite expired while the card was open
      })
      .catch(function () {})
      .then(function () { busy = false; });
  }

  function start() {
    if (timer) return;
    check();
    timer = setInterval(check, POLL_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
  }

  /* ── 3D movie from the Watch Together ready lobby (movie.html) ──
     start3D: host side — open a session, invite the partner, enter the cinema lobby.
     pending/joinNow: guest side — the partner is already on the same ready screen, so follow without a card. */
  function banner(html) {
    css(); close();
    var d = document.createElement('div'); d.className = 'tcn-back'; d.id = 'tcn-ov'; d.dataset.lock = '1'; d.style.alignItems = 'center';
    d.innerHTML = '<div class="tcn-card" style="border-radius:22px;margin:0 16px;text-align:center"><div class="tcn-ico" style="font-size:44px">🍿</div>' + html + '</div>';
    document.body.appendChild(d); return d;
  }
  function start3D(o) {
    if (!ready()) { say('Connect with your partner first 🎬'); return Promise.resolve(); }
    var s = st();
    banner('<h3>Opening the 3D theatre…</h3><p>Your partner will follow you in.</p>');
    return call('POST', '/create', { coupleId: s.coupleId, role: s.role, slot: mySlot(), movie: (o && o.movie) || '' })
      .then(function (r) {
        return call('POST', '/' + r.session.id + '/invite', { coupleId: s.coupleId, role: s.role })
          .then(function () { go(r.url + '&i=1'); });          // i=1: the cinema lobby opens with the invite already sent
      })
      .catch(function (e) { close(); say('Could not open the 3D theatre: ' + e.message); });
  }
  function pending() {
    if (!ready()) return Promise.resolve(null);
    var s = st();
    return call('GET', '/pending/' + encodeURIComponent(s.coupleId) + '?role=' + encodeURIComponent(s.role)).then(function (r) { return r.invite || null; });
  }
  function joinNow(inv) {
    var s = st(), name = esc(inv.hostName || s.partnerName || 'Your partner');
    banner('<h3>' + name + ' chose 3D movie</h3><p>Taking you to the cinema lobby…</p>');
    setTimeout(function () {
      call('POST', '/' + inv.id + '/accept', { coupleId: s.coupleId, role: s.role })
        .then(function (r) { dismissed[inv.id] = 1; go(r.url); })
        .catch(function (e) { close(); dismissed[inv.id] = 1; say(e.status === 410 || e.status === 409 ? 'That 3D invite is no longer open — ask for a new one 🎬' : 'Could not join: ' + e.message); });
    }, 1800);
  }

  /* ── Together page entry (added without touching index.html's markup beyond one row) ── */
  window.TwinCinema = { open: open, check: check, start3D: start3D, pending: pending, joinNow: joinNow, hold: false };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 2500); });
  else setTimeout(start, 2500);
})();
