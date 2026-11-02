/* ══════════════════════════════════════════════════════════════
   TWIN REWARDS — Step 1 (web)  ·  wallet, daily check-in, streaks
   Home strip (#rwStrip, inserted above "Stay Connected") and the
   Rewards page (#page-rewards → #rewardsPageContent).

   All numbers come from the server (/api/rewards/*). This file only
   DISPLAYS them and asks the server to claim. It never sends an amount.
   Needs globals from the main app: S, API, goto(), toast().
   ══════════════════════════════════════════════════════════════ */
'use strict';

const Rewards = (() => {
  const COIN = '<svg class="rw-coin" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#F5B83D"/><circle cx="12" cy="12" r="7.2" fill="none" stroke="#B87A0A" stroke-width="1.4"/><path d="M12 7.6v8.8M9.6 10c.5-.9 1.4-1.3 2.4-1.3 1.3 0 2.4.6 2.4 1.7 0 2.3-4.8 1.2-4.8 3.6 0 1.1 1.1 1.8 2.4 1.8 1 0 1.9-.4 2.4-1.2" fill="none" stroke="#B87A0A" stroke-width="1.3" stroke-linecap="round"/></svg>';
  const FLAME = '<svg class="rw-flame" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2c.6 3.2-1.2 4.6-2.6 6.3C8 10 7 11.6 7 14a5 5 0 0 0 10 0c0-1.6-.7-2.9-1.5-4 0 1.3-.7 2.2-1.6 2.2-1.3 0-1.7-1.3-1.2-3C13.4 7.2 13 4.6 12 2z"/></svg>';
  const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const KIND = { checkin: 'Daily check-in' };

  let sum = null, hist = null, loading = false, busy = false, failed = false;
  const $ = id => document.getElementById(id);
  const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ids = () => (window.S && S.userId && S.coupleId) ? { userId: S.userId, coupleId: S.coupleId } : null;
  const base = () => (typeof API !== 'undefined' ? API : '');

  async function call(method, path, body) {
    const id = ids(); if (!id) throw new Error('not-ready');
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const qs = method === 'GET' ? (path.includes('?') ? '&' : '?') + 'coupleId=' + encodeURIComponent(id.coupleId) + '&userId=' + encodeURIComponent(id.userId) : '';
      const r = await fetch(base() + path + qs, {
        method, signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', 'x-user-id': id.userId },
        body: method === 'GET' ? undefined : JSON.stringify({ ...body, coupleId: id.coupleId, userId: id.userId }),
      });
      let data = {}; try { data = await r.json(); } catch (_) {}
      if (!r.ok) throw new Error(data.error || 'Something went wrong');
      return data;
    } finally { clearTimeout(t); }
  }

  /* ── data ── */
  async function load(withHistory) {
    if (loading || !ids()) return;
    loading = true;
    try {
      sum = await call('GET', '/api/rewards/summary'); failed = false;
      if (withHistory) hist = (await call('GET', '/api/rewards/history?limit=20')).items;
    } catch (e) { if (e.message !== 'not-ready') failed = true; }
    loading = false; render();
  }

  async function claim() {
    if (busy || !sum || sum.checkedInToday) return;
    busy = true; render();
    try {
      const before = sum.balance;
      sum = await call('POST', '/api/rewards/checkin', {});
      busy = false; failed = false; hist = null;
      render(); countUp(before, sum.balance);
      if (sum.claimed && typeof toast === 'function') toast('+' + sum.earned + ' Gold Coins 🪙  ·  ' + sum.streak + '-day streak 🔥');
      if (isPageOpen()) load(true);
    } catch (e) {
      busy = false; render();
      if (typeof toast === 'function') toast(e.message === 'not-ready' ? 'Still signing in…' : e.message);
    }
  }

  function countUp(from, to) {
    const els = document.querySelectorAll('[data-rw-bal]');
    els.forEach(el => el.classList.add('rw-pop'));
    if (reduce() || from === to) return;
    const t0 = performance.now(), dur = 700;
    (function tick(now) {
      const p = Math.min(1, (now - t0) / dur), v = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      document.querySelectorAll('[data-rw-bal]').forEach(el => { el.textContent = v; });
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  }

  const isPageOpen = () => { const p = $('page-rewards'); return !!(p && p.classList.contains('active')); };

  /* ── Home strip ── */
  function ensureStrip() {
    let el = $('rwStrip');
    if (el) return el;
    const anchor = document.querySelector('#page-dashboard .dh-sheet-title');
    if (!anchor) return null;
    el = document.createElement('div'); el.id = 'rwStrip'; el.className = 'rw';
    anchor.parentNode.insertBefore(el, anchor);
    el.addEventListener('click', e => {
      if (e.target.closest('[data-rw-claim]')) { e.stopPropagation(); claim(); return; }
      if (typeof goto === 'function') goto('rewards');
    });
    return el;
  }

  function renderStrip() {
    const el = ensureStrip(); if (!el) return;
    if (!sum) {
      el.innerHTML = '<div class="rw-card rw-strip is-loading">' + '<div class="rw-strip-stat">' + COIN + '<div><b>—</b><span>Gold Coins</span></div></div></div>';
      return;
    }
    const btn = sum.checkedInToday
      ? '<button class="rw-btn is-done" type="button" disabled>✓ Claimed</button>'
      : '<button class="rw-btn is-pulse" type="button" data-rw-claim ' + (busy ? 'disabled' : '') + '>' + (busy ? '…' : 'Claim +' + sum.todayCoins) + '</button>';
    el.innerHTML = '<div class="rw-card rw-strip" role="button" tabindex="0" aria-label="Open Rewards">' +
      '<div class="rw-strip-stat">' + COIN + '<div><b data-rw-bal>' + sum.balance + '</b><span>Gold Coins</span></div></div>' +
      '<div class="rw-strip-sep"></div>' +
      '<div class="rw-strip-stat">' + FLAME + '<div><b>' + sum.streak + '</b><span>Day streak</span></div></div>' + btn + '</div>';
  }

  /* ── Rewards page ── */
  function renderPage() {
    const host = $('rewardsPageContent'); if (!host) return;
    if (!sum) {
      host.innerHTML = failed
        ? '<div class="rw rw-card rw-err">Could not load your rewards.<br><button class="rw-btn" type="button" data-rw-retry>Try again</button></div>'
        : '<div class="rw rw-page"><div class="rw-skel"></div><div class="rw-skel"></div></div>';
      return;
    }
    const days = sum.cycle.map(d => '<div class="rw-day' + (d.done ? ' is-done' : '') + (d.today ? ' is-today' : '') + (d.day === 7 ? ' is-big' : '') + '">Day ' + d.day +
      (d.done ? CHECK : COIN.replace('rw-coin', '')) + '<b>+' + d.coins + '</b></div>').join('');
    const note = sum.checkedInToday
      ? 'Come back tomorrow to keep your ' + sum.streak + '-day streak going.'
      : (sum.streak > 0 ? 'Claim today to make it ' + (sum.streak + 1) + ' days in a row.' : 'Claim today to start your streak.');
    const claimBtn = sum.checkedInToday
      ? '<button class="rw-btn is-done" type="button" disabled>✓ Claimed today</button>'
      : '<button class="rw-btn is-pulse" type="button" data-rw-claim ' + (busy ? 'disabled' : '') + '>' + (busy ? 'Claiming…' : 'Claim +' + sum.todayCoins + ' coins') + '</button>';
    const partner = (window.S && S.partnerName) ? S.partnerName : 'Partner';
    const coupleMsg = sum.coupleDoneToday ? 'You both checked in today 💞'
      : (sum.checkedInToday ? 'Waiting for ' + partner + ' to check in today'
        : (sum.partnerCheckedInToday ? partner + ' already checked in — your turn 💌' : 'Check in — and ask ' + partner + ' to do the same'));
    let history;
    if (hist == null) history = '<div class="rw-empty">Loading…</div>';
    else if (!hist.length) history = '<div class="rw-empty">No coins yet. Claim your first daily reward above.</div>';
    else history = '<ul class="rw-hist">' + hist.map(h => {
      const d = new Date(h.created_at), pos = h.amount >= 0;
      return '<li><div>' + (KIND[h.kind] || 'Reward') + '<small>' + d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + '</small></div><em class="' + (pos ? 'pos' : 'neg') + '">' + (pos ? '+' : '') + h.amount + '</em></li>';
    }).join('') + '</ul>';

    host.innerHTML = '<div class="rw rw-page">' +
      '<div class="rw-head"><div><h2>Twin Rewards</h2><p>Play together. Earn together. Celebrate together.</p></div></div>' +
      '<div class="rw-card rw-hero">' + COIN + '<div><div class="rw-bal" data-rw-bal>' + sum.balance + '</div><div class="rw-bal-l">Gold Coins</div></div>' +
        '<div class="rw-hero-right"><b>' + sum.lifetimeEarned + '</b>earned in total</div></div>' +
      '<div class="rw-card"><h3>Daily check-in <small>Day ' + sum.cyclePosition + ' of 7</small></h3><div class="rw-days">' + days + '</div>' +
        '<div class="rw-claim-row">' + claimBtn + '<div class="rw-note">' + note + '</div></div></div>' +
      '<div class="rw-card"><h3>Couple streak</h3><div class="rw-couple">' + FLAME +
        '<div><div class="rw-couple-n">' + sum.coupleStreak + '</div><div class="rw-couple-l">days you both checked in</div></div>' +
        '<div class="rw-pills"><span class="rw-pill' + (sum.checkedInToday ? ' is-on' : '') + '">You ' + (sum.checkedInToday ? '✓' : '·') + '</span>' +
        '<span class="rw-pill' + (sum.partnerCheckedInToday ? ' is-on' : '') + '">' + partner + ' ' + (sum.partnerCheckedInToday ? '✓' : '·') + '</span></div></div>' +
        '<div class="rw-note" style="margin-top:10px">' + coupleMsg + '</div></div>' +
      '<div class="rw-card"><h3>Coin history</h3>' + history + '</div></div>';
  }

  function render() { renderStrip(); renderPage(); }

  /* ── wiring ── */
  function wire() {
    document.addEventListener('click', e => {
      if (e.target.closest('#rewardsPageContent [data-rw-claim]')) claim();
      else if (e.target.closest('#rewardsPageContent [data-rw-retry]')) { failed = false; renderPage(); load(true); }
    });
    // After the app's goto(): refresh when Home or Rewards opens.
    const orig = window.goto;
    if (typeof orig === 'function' && !orig.__rw) {
      const wrapped = function (page) {
        const r = orig.apply(this, arguments);
        if (page === 'rewards') { renderPage(); load(true); }
        else if (page === 'dashboard') { ensureStrip(); load(false); }
        return r;
      };
      wrapped.__rw = true; window.goto = wrapped;
    }
    // Coming back to the tab: refresh once (no timers, no polling).
    document.addEventListener('visibilitychange', () => { if (!document.hidden && ids()) load(isPageOpen()); });
  }

  function start() {
    wire(); renderStrip();
    let tries = 0;
    const wait = setInterval(() => { // wait (max ~20 s) until sign-in has filled S
      if (ids()) { clearInterval(wait); load(false); } else if (++tries > 40) clearInterval(wait);
    }, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  return { load, claim, render };
})();
