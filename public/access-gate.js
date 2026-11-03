/* ══════════════════════════════════════════════════════════════
   ACCESS GATE — free daily uses, then ONE small coin pass.
   Used by: Watch Together (movies), Sing Together (songs), Memory Globe (pins), Couple Games.

   const ok = await AccessGate.check('movie');   // 'movie' | 'songs' | 'pins' | 'games'
   if (!ok) return;                              // the person chose "Maybe later"

   How it feels (the point of the design):
     • The first few uses every day are FREE. A tiny note says how many are left. No pop-up.
     • Only when the free ones are gone, ONE clear sheet explains why and what a pass gives
       (e.g. 20 coins = unlimited movies for 12 hours, for both partners).
     • While a pass is running nobody is asked again — not for every song, pin or game.
   All prices / limits come from the server (/api/rewards/access/*). This file never sends an amount,
   and if the server cannot be reached it lets the person through (an outage must never lock the app).

   Works on the main page and inside the iframes (movie / music / globe / games).
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.AccessGate) return;

  const COPY = {
    movie: { title: 'Movie night pass',   used: function (n) { return "You've watched today's free movie."; },                   rule: 'unlimited movies' },
    songs: { title: 'Sing Together pass', used: function (n) { return "You've used today's " + n + ' free Sing Together songs.'; }, rule: 'unlimited songs' },
    pins:  { title: 'Globe pins pass',    used: function (n) { return "You've dropped today's " + n + ' free globe pins.'; },    rule: 'unlimited pins' },
    games: { title: 'Game night pass',    used: function (n) { return "You've played today's " + n + ' free games.'; },           rule: 'unlimited games' },
  };
  const FREE_NOUN = { movie: 'free movie', songs: 'free song', pins: 'free pin', games: 'free game' };

  // ── where are the sign-in details + API address? (this page, or the app page that holds this iframe)
  function root() {
    try { if (window.S && window.S.userId && window.S.coupleId) return window; } catch (e) {}
    try { if (window.parent && window.parent !== window && window.parent.S && window.parent.S.userId) return window.parent; } catch (e) {}
    return null;
  }
  function ids() { const r = root(); return r ? { userId: r.S.userId, coupleId: r.S.coupleId } : null; }
  function base() {
    const r = root();
    try { if (r && r.API) return r.API; } catch (e) {}
    try { if (typeof API !== 'undefined') return API; } catch (e) {}
    return '';
  }
  const gen = function () { return 'ag_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9); };
  const sound = function (name, a) { try { if (window.TwinSound) window.TwinSound[name](a); else if (window.parent && window.parent.TwinSound) window.parent.TwinSound[name](a); } catch (e) {} };

  async function call(method, path, body) {
    const id = ids(); if (!id) throw new Error('not-ready');
    const ctrl = new AbortController(); const t = setTimeout(function () { ctrl.abort(); }, 12000);
    try {
      const qs = method === 'GET' ? (path.indexOf('?') >= 0 ? '&' : '?') + 'coupleId=' + encodeURIComponent(id.coupleId) + '&userId=' + encodeURIComponent(id.userId) : '';
      const r = await fetch(base() + path + qs, {
        method: method, signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', 'x-user-id': id.userId },
        body: method === 'GET' ? undefined : JSON.stringify(Object.assign({}, body, { coupleId: id.coupleId, userId: id.userId })),
      });
      let data = {}; try { data = await r.json(); } catch (e) {}
      if (!r.ok) { const er = new Error(data.error || 'Something went wrong'); er.status = r.status; er.data = data; throw er; }
      return data;
    } finally { clearTimeout(t); }
  }

  // ── tiny note (not a pop-up) ──
  function note(text) {
    ensureStyles();
    let n = document.getElementById('agNote');
    if (!n) { n = document.createElement('div'); n.id = 'agNote'; n.className = 'ag-note'; n.setAttribute('role', 'status'); document.body.appendChild(n); }
    n.textContent = text; n.classList.add('show');
    clearTimeout(n._h); n._h = setTimeout(function () { n.classList.remove('show'); }, 3200);
  }

  function untilText(iso) {
    const d = new Date(iso), now = new Date();
    const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const same = d.toDateString() === now.toDateString();
    return same ? t : 'tomorrow ' + t;
  }

  function refreshWallet() {
    try { const R = (window.Rewards || (window.parent && window.parent.Rewards)); if (R && R.load) R.load(); } catch (e) {}
  }
  function openRewards() {
    try { const p = (window.parent && window.parent !== window) ? window.parent : window; if (typeof p.goto === 'function') p.goto('rewards'); } catch (e) {}
  }

  // ── the one clear sheet ──
  function askSheet(info) {
    ensureStyles();
    return new Promise(function (resolve) {
      const cp = COPY[info.feature] || { title: info.label || 'Pass', used: function () { return 'Free uses are done for today.'; }, rule: 'unlimited' };
      const need = Math.max(0, info.price - (info.balance || 0));
      const wrap = document.createElement('div');
      wrap.className = 'ag-back';
      wrap.innerHTML =
        '<div class="ag-sheet" role="dialog" aria-modal="true" aria-labelledby="agTitle">' +
          '<div class="ag-grab"></div>' +
          '<div class="ag-emoji" aria-hidden="true">' + (info.emoji || '🎟️') + '</div>' +
          '<h3 id="agTitle">' + cp.title + '</h3>' +
          '<p class="ag-why">' + cp.used(info.freeTotal) + ' <b>Free ones refill every day.</b></p>' +
          '<div class="ag-offer">' +
            '<div class="ag-price"><span class="ag-coin" aria-hidden="true">🪙</span> ' + info.price + '</div>' +
            '<div class="ag-perk"><b>' + info.perk + '</b><span>One tap now — we won\'t ask again for every ' + (FREE_NOUN[info.feature] || 'one').replace('free ', '') + ' during these ' + info.hours + ' hours.</span></div>' +
          '</div>' +
          '<div class="ag-bal">You have <b>' + (info.balance || 0) + ' 🪙</b>' + (need > 0 ? ' · need <b>' + need + ' more</b>' : '') + '</div>' +
          '<button type="button" class="ag-go" id="agGo">' + (need > 0 ? 'Get coins free' : 'Unlock for ' + info.price + ' 🪙') + '</button>' +
          '<button type="button" class="ag-later" id="agLater">Maybe later</button>' +
          '<p class="ag-foot">Why coins? They keep Twin Hearts free for everyone. You earn them daily — check-in, Spin &amp; Win, scratch cards and games.</p>' +
        '</div>';
      document.body.appendChild(wrap);
      requestAnimationFrame(function () { wrap.classList.add('open'); });
      sound('tap');

      let done = false;
      function close(val) {
        if (done) return; done = true;
        wrap.classList.remove('open');
        setTimeout(function () { wrap.remove(); }, 220);
        document.removeEventListener('keydown', onKey);
        resolve(val);
      }
      function onKey(e) { if (e.key === 'Escape') close(false); }
      document.addEventListener('keydown', onKey);
      wrap.addEventListener('click', function (e) { if (e.target === wrap) close(false); });
      wrap.querySelector('#agLater').onclick = function () { close(false); };

      const go = wrap.querySelector('#agGo');
      go.onclick = async function () {
        if (need > 0) { close(false); openRewards(); return; }   // not enough coins: take them to where coins are earned
        go.disabled = true; go.textContent = 'Unlocking…';
        try {
          const r = await call('POST', '/api/rewards/access/pass', { feature: info.feature, clientId: gen() });
          sound('unlock');
          note('🔓 Unlocked until ' + untilText(r.expiresAt) + ' — enjoy!');
          refreshWallet();
          close(true);
        } catch (e) {
          sound('error');
          go.disabled = false; go.textContent = 'Unlock for ' + info.price + ' 🪙';
          if (e.data && e.data.code === 'not_enough_coins') { close(false); openRewards(); }
          else note(e.message || 'Could not unlock. You were not charged.');
        }
      };
    });
  }

  /** Resolves true when the person may go ahead (free, pass, Pro — or they just bought a pass). */
  async function check(feature) {
    let r;
    try { r = await call('POST', '/api/rewards/access/use', { feature: feature }); }
    catch (e) { return true; } // not signed in yet / server down / older server: never lock people out
    if (r && r.allowed) {
      if (r.via === 'free') {
        const noun = FREE_NOUN[feature] || 'free use';
        note(r.freeLeft > 0
          ? '🎁 Free today · ' + r.freeLeft + ' ' + noun + (r.freeLeft === 1 ? '' : 's') + ' left'
          : '🎁 That was your last ' + noun + ' today — free again tomorrow');
      }
      return true;
    }
    if (r && r.needsCoins) return askSheet(r);
    return true;
  }

  async function status() { try { return await call('GET', '/api/rewards/access/status'); } catch (e) { return null; } }

  let styled = false;
  function ensureStyles() {
    if (styled) return; styled = true;
    const s = document.createElement('style'); s.id = 'agStyles';
    s.textContent =
      '.ag-back{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center;opacity:0;transition:opacity .2s}' +
      '.ag-back.open{opacity:1}' +
      '.ag-sheet{width:100%;max-width:440px;box-sizing:border-box;background:var(--surface,#2B061D);color:var(--text,#fff);border:1px solid var(--border2,rgba(194,26,139,.3));border-bottom:0;border-radius:22px 22px 0 0;padding:10px 20px calc(18px + env(safe-area-inset-bottom,0px));text-align:center;transform:translateY(40px);transition:transform .22s cubic-bezier(.2,.9,.3,1);font-family:inherit}' +
      '.ag-back.open .ag-sheet{transform:none}' +
      '.ag-grab{width:38px;height:4px;border-radius:4px;background:var(--border2,rgba(255,255,255,.25));margin:0 auto 10px}' +
      '.ag-emoji{font-size:38px;line-height:1}' +
      '.ag-sheet h3{margin:8px 0 4px;font-size:19px;font-weight:800}' +
      '.ag-why{margin:0 0 14px;font-size:14px;line-height:1.45;color:var(--text2,rgba(255,255,255,.75))}' +
      '.ag-why b{color:var(--text,#fff)}' +
      '.ag-offer{display:flex;align-items:center;gap:14px;text-align:left;background:var(--g2,rgba(255,255,255,.07));border:1px solid var(--border,rgba(255,255,255,.12));border-radius:16px;padding:12px 14px;margin-bottom:10px}' +
      '.ag-price{flex:none;min-width:64px;text-align:center;font-weight:900;font-size:26px;color:#F5B83D}' +
      '.ag-coin{font-size:20px}' +
      '.ag-perk{font-size:13px;line-height:1.4;color:var(--text2,rgba(255,255,255,.75))}' +
      '.ag-perk b{display:block;color:var(--text,#fff);font-size:14px;margin-bottom:2px}' +
      '.ag-perk span{display:block}' +
      '.ag-bal{font-size:13px;color:var(--text2,rgba(255,255,255,.75));margin-bottom:12px}' +
      '.ag-go{appearance:none;border:0;width:100%;min-height:48px;border-radius:14px;font:inherit;font-weight:800;font-size:15px;color:#3a2400;background:linear-gradient(180deg,#FFD66B,#F5B83D);cursor:pointer}' +
      '.ag-go:disabled{opacity:.6}' +
      '.ag-later{appearance:none;border:0;background:none;width:100%;min-height:44px;margin-top:4px;font:inherit;font-size:14px;font-weight:600;color:var(--text2,rgba(255,255,255,.75));cursor:pointer}' +
      '.ag-foot{margin:6px 0 0;font-size:11.5px;line-height:1.4;color:var(--text3,rgba(255,255,255,.5))}' +
      '.ag-note{position:fixed;left:50%;bottom:calc(86px + env(safe-area-inset-bottom,0px));transform:translate(-50%,16px);z-index:2147483001;max-width:88vw;padding:10px 16px;border-radius:999px;background:rgba(20,3,14,.92);color:#fff;font-size:13px;font-weight:600;border:1px solid rgba(245,184,61,.35);opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;text-align:center}' +
      '.ag-note.show{opacity:1;transform:translate(-50%,0)}';
    document.head.appendChild(s);
  }

  window.AccessGate = { check: check, status: status };
})();
