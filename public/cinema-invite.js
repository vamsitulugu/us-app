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

  /* ── The theatre runs in a full-screen frame INSIDE this page (not a page change), so that
        • the movie file you already picked on Watch Together is handed straight to the theatre (a File can only travel
          between pages by postMessage, never through a URL) — no second "choose movie" in the lobby;
        • on a phone the theatre is always landscape: fullscreen + orientation lock where the browser allows it,
          otherwise the frame is turned 90° (see CSS) and a hint asks the user to turn the phone sideways. ── */
  var stage = null;
  function watchFile() {            // the file picked on the Watch Together page (movie.js exposes it)
    try { var f = document.getElementById('movieFrame'), w = f && f.contentWindow; return (w && w.TwinWatchFile && w.TwinWatchFile()) || null; } catch (_) { return null; }
  }
  function landscape(el) {          // best effort; only works inside a tap (the follower's phone has none → the CSS turn covers it)
    try {
      if (!window.matchMedia || !matchMedia('(pointer:coarse)').matches) return;
      var lock = function () { try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {}); } catch (_) {} };
      var rf = el.requestFullscreen || el.webkitRequestFullscreen;
      if (rf) { var p = rf.call(el, { navigationUI: 'hide' }); if (p && p.then) p.then(lock, function () {}); else lock(); } else lock();
    } catch (_) {}
  }
  function openStage(text, file) {
    if (stage) return stage;
    css(); close();
    var wrap = document.createElement('div'); wrap.id = 'tcn-stage';
    wrap.innerHTML = '<div class="tcn-load"><div class="tcn-ico">🍿</div><div class="tcn-lt"></div></div><div class="tcn-hint">↺ Turn your phone sideways for the 3D theatre</div>';
    wrap.querySelector('.tcn-lt').textContent = text || 'Opening the 3D theatre…';
    document.body.appendChild(wrap);
    stage = { wrap: wrap, frame: null, origin: '*', file: file || watchFile(), onMsg: null };
    landscape(wrap);
    return stage;
  }
  function closeStage() {
    var s = stage; if (!s) return; stage = null;
    try { window.removeEventListener('message', s.onMsg); } catch (_) {}
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (_) {}
    try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (_) {}
    s.wrap.remove();
  }
  function stageMsg(e) {            // the theatre → this page: "ready" (send me the file) / "leave"
    var s = stage; if (!s || !s.frame || e.source !== s.frame.contentWindow) return;
    if (s.origin !== '*' && e.origin !== s.origin) return;
    var d = e.data; if (!d || d.src !== 'twin-cinema') return;
    if (d.type === 'ready') {
      try { e.source.postMessage(s.file ? { src: 'twin-hearts', type: 'file', file: s.file } : { src: 'twin-hearts', type: 'nofile' }, s.origin); } catch (_) {}
    } else if (d.type === 'leave') closeStage();
  }
  function enter(url, s) {          // s = a stage opened earlier inside the tap; otherwise open one now
    if (window.TwinCinema && window.TwinCinema.embed === false) { closeStage(); return go(url); }
    s = s || openStage();
    var sep = url.indexOf('#') >= 0 ? '&' : '#';
    try { s.origin = new URL(url).origin; } catch (_) { s.origin = '*'; }
    var f = document.createElement('iframe');
    f.setAttribute('allow', 'autoplay; fullscreen; screen-wake-lock'); f.setAttribute('title', 'Twin Cinema');
    f.style.visibility = 'hidden'; f.onload = function () { f.style.visibility = 'visible'; };
    f.src = url + sep + 'b=' + encodeURIComponent(location.origin + '/') + '&e=1';
    s.frame = f; s.onMsg = stageMsg; window.addEventListener('message', stageMsg);
    s.wrap.appendChild(f);
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
      '@keyframes tcnF{from{opacity:0}to{opacity:1}}@keyframes tcnU{from{transform:translateY(40px)}to{transform:none}}' +
      /* 3D theatre stage: full-screen frame; on a phone held upright the frame is turned 90° so the theatre is landscape */
      '#tcn-stage{position:fixed;inset:0;z-index:99999;background:#05010a;overflow:hidden}' +
      '#tcn-stage iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#000}' +
      '#tcn-stage .tcn-load{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#fff;font-weight:600;text-align:center;padding:20px}' +
      '#tcn-stage .tcn-hint{display:none}' +
      '@keyframes tcnH{0%,80%{opacity:1}100%{opacity:0;visibility:hidden}}' +
      '@media (orientation:portrait) and (pointer:coarse){' +
        '#tcn-stage iframe{inset:auto;top:0;left:0;width:100vh;width:100dvh;height:100vw;height:100dvw;transform-origin:0 0;transform:translateX(100vw) rotate(90deg);transform:translateX(100dvw) rotate(90deg)}' +
        '#tcn-stage .tcn-hint{display:block;position:absolute;left:50%;bottom:calc(28px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:2;background:rgba(0,0,0,.72);color:#fff;padding:10px 16px;border-radius:999px;font-size:14px;white-space:nowrap;animation:tcnH 6s forwards;pointer-events:none}}';
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
      var movie = d.querySelector('#tcn-movie').value.trim(), stg = openStage('Opening the cinema lobby…');       // inside the tap, so fullscreen + landscape are allowed
      call('POST', '/create', { coupleId: s.coupleId, role: s.role, slot: mySlot(), movie: movie })
        .then(function (r) { enter(r.url, stg); })
        .catch(function (e) { closeStage(); say('Could not open the cinema: ' + e.message); });
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
      var stg = openStage('Joining the cinema lobby…');                                                         // closes the card, inside the tap
      call('POST', '/' + inv.id + '/accept', { coupleId: s.coupleId, role: s.role })
        .then(function (r) { dismissed[inv.id] = 1; enter(r.url, stg); })
        .catch(function (e) { closeStage(); dismissed[inv.id] = 1; say(e.status === 410 || e.status === 409 ? 'That invite is no longer open — ask for a new one 🎬' : 'Could not join: ' + e.message); });
    };
  }

  function check() {
    if (busy || document.hidden || !ready() || stage) return;
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
    var s = st(), stg = openStage('Opening the 3D theatre… your partner will follow you in.', o && o.file);
    return call('POST', '/create', { coupleId: s.coupleId, role: s.role, slot: mySlot(), movie: (o && o.movie) || '' })
      .then(function (r) {
        return call('POST', '/' + r.session.id + '/invite', { coupleId: s.coupleId, role: s.role })
          .then(function () { enter(r.url + '&i=1', stg); });          // i=1: the cinema lobby opens with the invite already sent
      })
      .catch(function (e) { closeStage(); say('Could not open the 3D theatre: ' + e.message); });
  }
  function pending() {
    if (!ready()) return Promise.resolve(null);
    var s = st();
    return call('GET', '/pending/' + encodeURIComponent(s.coupleId) + '?role=' + encodeURIComponent(s.role)).then(function (r) { return r.invite || null; });
  }
  function joinNow(inv, o) {
    var s = st(), name = esc(inv.hostName || s.partnerName || 'Your partner');
    var stg = openStage((inv.hostName || s.partnerName || 'Your partner') + ' chose 3D movie — taking you to the cinema lobby…', o && o.file);
    setTimeout(function () {
      call('POST', '/' + inv.id + '/accept', { coupleId: s.coupleId, role: s.role })
        .then(function (r) { dismissed[inv.id] = 1; enter(r.url, stg); })
        .catch(function (e) { closeStage(); dismissed[inv.id] = 1; say(e.status === 410 || e.status === 409 ? 'That 3D invite is no longer open — ask for a new one 🎬' : 'Could not join: ' + e.message); });
    }, 1800);
  }

  /* ── Together page entry (added without touching index.html's markup beyond one row) ── */
  window.TwinCinema = { open: open, check: check, start3D: start3D, pending: pending, joinNow: joinNow, hold: false, embed: true };   // embed:false = old behaviour (open the theatre as a separate page)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 2500); });
  else setTimeout(start, 2500);
})();
