/* Twin Hearts - web ads (Google AdSense).
 *
 * Why this file exists: the ONE place that decides whether a web ad may appear, and where.
 * It stays OFF until the ad unit ids below are filled in (AdSense > Ads > By ad unit).
 *
 * Two places, same rules of kindness as the Android app:
 *  1. LANDING page (signed-out visitors): one ad above the footer, via <div data-th-ad="landing"></div>.
 *  2. The signed-in APP, for FREE couples only: a small "Advertisement" card at the bottom of calm
 *     pages (Home, Calendar, Money, Study, Bucket list, Level). NEVER on Chat, Twin AI, Live Map,
 *     Games, Music, Movies, Calls, Settings, Pro or personal pages (Vault, Period, Fights, My Space...).
 *
 * Responsive: the ad unit is a "responsive display" unit, so Google picks a size that fits the screen:
 * a slim banner on phones, a wide banner on laptops and desktops.
 *
 * Google's rules this file follows (so the AdSense account stays safe):
 *  - No pop-ups, no full-screen overlays, no ads on a timer. An ad is only requested when the person
 *    opens a page; going back to a page that already shows an ad keeps the same ad. A page that has
 *    shown its ad for 8 minutes gets a fresh ad the next time the person opens it (never while they
 *    stay on it).
 *  - Nothing is drawn until an ad has really filled (no empty boxes), and the card is clearly labelled.
 *  - Never inside the Android app / a WebView (AdMob is used there).
 *  - Pro couples never see ads. If Pro cannot be confirmed (offline, server asleep), nothing is shown.
 */
(function () {
  'use strict';

  var CFG = {
    client: 'ca-pub-8220558701111236', // AdSense > Account > Settings (same id as public/ads.txt)
    slots: {
      landing: '', // ad unit id for the landing page, e.g. '1234567890'
      app: ''      // ad unit id for the signed-in app. Create a "Display ads" unit with the Responsive type.
    },
    allowInstalledPwa: true // show ads in the installed web app too (set false to keep it browser-only)
  };

  // Calm pages only. Same idea as the Android app: never where people type, talk, play or watch.
  var CALM_PAGES = ['dashboard', 'calendar', 'money', 'study', 'bucket', 'level'];
  var REUSE_MS = 8 * 60 * 1000; // an ad on a page is kept this long before the next visit may get a fresh one

  if (!CFG.client) return;
  if (inAppWrapper()) return;

  function inAppWrapper() {
    try {
      var ua = navigator.userAgent || '';
      if (/;\s*wv\)/.test(ua) || /TwinHearts/i.test(ua)) return true;      // Android WebView
      if ((document.referrer || '').indexOf('android-app://') === 0) return true; // Trusted Web Activity
    } catch (e) { /* ignore */ }
    return false;
  }

  function isInstalledPwa() {
    try { return !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches); } catch (e) { return false; }
  }

  function loadLibrary() {
    if (document.querySelector('script[data-th-adsense]')) return;
    var sc = document.createElement('script');
    sc.async = true;
    sc.crossOrigin = 'anonymous';
    sc.setAttribute('data-th-adsense', '1');
    sc.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(CFG.client);
    document.head.appendChild(sc);
  }

  /* One ad card. It is collapsed (zero height) but NOT hidden, because Google must measure a real width
     to choose a size. It opens only when the ad reports "filled". */
  function buildUnit(slotId, withProLink) {
    var wrap = document.createElement('div');
    wrap.className = 'th-ad-card';
    wrap.setAttribute('role', 'complementary');
    wrap.setAttribute('aria-label', 'Advertisement');
    wrap.style.cssText = 'max-height:0;overflow:hidden;opacity:0;margin:0 auto;width:100%;max-width:728px;box-sizing:border-box;' +
      'transition:opacity .25s ease';

    var head = document.createElement('div');
    head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:12px;' +
      'font:11px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.08em;text-transform:uppercase;' +
      'opacity:.6;margin-bottom:6px';
    var label = document.createElement('span');
    label.textContent = 'Advertisement';
    head.appendChild(label);
    if (withProLink && typeof window.goto === 'function') {
      var pro = document.createElement('a');
      pro.href = '#pro';
      pro.textContent = 'Remove ads';
      pro.style.cssText = 'color:inherit;text-decoration:underline;cursor:pointer;letter-spacing:.04em;text-transform:none;padding:6px 0';
      pro.addEventListener('click', function (ev) { ev.preventDefault(); try { window.goto('pro'); } catch (e) { /* ignore */ } });
      head.appendChild(pro);
    }

    var ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.cssText = 'display:block;overflow:hidden;border-radius:12px';
    ins.setAttribute('data-ad-client', CFG.client);
    ins.setAttribute('data-ad-slot', slotId);
    ins.setAttribute('data-ad-format', 'auto');
    ins.setAttribute('data-full-width-responsive', 'true');

    wrap.appendChild(head);
    wrap.appendChild(ins);

    new MutationObserver(function (_, obs) {
      var st = ins.getAttribute('data-ad-status');
      if (st === 'filled') {
        wrap.style.maxHeight = 'none';
        wrap.style.overflow = 'visible';
        wrap.style.opacity = '1';
        wrap.style.margin = '20px auto';
        obs.disconnect();
      } else if (st === 'unfilled') {
        obs.disconnect(); // stays collapsed: no empty box
      }
    }).observe(ins, { attributes: true, attributeFilter: ['data-ad-status'] });

    return { wrap: wrap, ins: ins };
  }

  /* Ask Google for the ad once the card has a real width (it has none while its page is still hidden). */
  function requestAd(unit, tries, onGiveUp) {
    if (!unit.wrap.isConnected) return;
    if (unit.ins.offsetWidth > 0) {
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* blocked by an ad blocker: fine */ }
      return;
    }
    if (tries >= 8) { if (onGiveUp) onGiveUp(); return; }
    setTimeout(function () { requestAd(unit, tries + 1, onGiveUp); }, 250);
  }

  /* ───────── 1. Landing page (signed out) ───────── */
  function startLanding() {
    var holders = document.querySelectorAll('[data-th-ad]');
    if (!holders.length) return false;
    try {
      if (!CFG.allowInstalledPwa && isInstalledPwa()) return true;
      var s = JSON.parse(localStorage.getItem('uwl_v5') || '{}');
      if (s && s.setupDone && s.coupleId) return true; // signed in: never on the landing page
    } catch (e) { /* storage blocked: treat as signed out */ }

    loadLibrary(); // also needed while AdSense is reviewing the site
    for (var i = 0; i < holders.length; i++) {
      var slotId = CFG.slots[holders[i].getAttribute('data-th-ad')];
      if (!slotId) continue;
      var unit = buildUnit(slotId, false);
      holders[i].appendChild(unit.wrap);
      requestAd(unit, 0, null);
    }
    return true;
  }

  /* ───────── 2. Signed-in app (free couples) ───────── */
  function startApp() {
    if (!document.getElementById('page-dashboard')) return false;
    if (!CFG.slots.app) return true; // not configured yet: stay completely off
    if (!CFG.allowInstalledPwa && isInstalledPwa()) return true;

    var cards = {};     // page -> { wrap, at }
    var checking = null;

    function removeAll() {
      Object.keys(cards).forEach(function (p) { if (cards[p].wrap) cards[p].wrap.remove(); });
      cards = {};
    }

    /* Free + confirmed by the server. Unknown (offline, not signed in, server asleep) = no ads. */
    function isFreeCouple() {
      if (checking) return checking;
      checking = (async function () {
        try {
          if (!window.ProCard || !ProCard.session()) return false;
          var st = await ProCard.status();
          return !(st && st.isPro);
        } catch (e) { return false; }
      })();
      checking.then(function () { checking = null; }, function () { checking = null; });
      return checking;
    }

    function hostFor(page) {
      var pg = document.getElementById('page-' + page);
      if (!pg) return null;
      if (page === 'dashboard') {
        var quote = pg.querySelector('.dw-quote');
        if (quote && quote.parentNode) return { parent: quote.parentNode, before: quote };
      }
      return { parent: pg, before: null };
    }

    function currentPage() {
      var a = document.body.getAttribute('data-page');
      if (a) return a;
      var act = document.querySelector('.page.active');
      return act && act.id ? act.id.replace(/^page-/, '') : '';
    }

    function mount(page) {
      var rec = cards[page], now = Date.now();
      if (rec && rec.wrap.isConnected && now - rec.at < REUSE_MS) return; // keep the ad that is already there
      if (rec) rec.wrap.remove();
      var host = hostFor(page);
      if (!host) return;
      loadLibrary();
      var unit = buildUnit(CFG.slots.app, true);
      unit.wrap.style.gridColumn = '1 / -1'; // spans the whole row on wide dashboard layouts
      host.parent.insertBefore(unit.wrap, host.before);
      cards[page] = { wrap: unit.wrap, at: now };
      requestAd(unit, 0, function () { unit.wrap.remove(); delete cards[page]; });
    }

    async function onPage(page) {
      if (!page || CALM_PAGES.indexOf(page) < 0) return;
      if (!(await isFreeCouple())) { removeAll(); return; }
      if (currentPage() !== page) return; // the person already moved on while we checked
      mount(page);
    }

    new MutationObserver(function () { onPage(currentPage()); })
      .observe(document.body, { attributes: true, attributeFilter: ['data-page'] });

    // If Pro is bought while the app is open, the ads disappear at once.
    function watchPro(tries) {
      if (window.ProCard && ProCard.onChange) { ProCard.onChange(function (st) { if (st && st.isPro) removeAll(); }); return; }
      if (tries < 20) setTimeout(function () { watchPro(tries + 1); }, 250);
    }
    watchPro(0);

    // First page the person lands on (Home, or the page they were last on).
    setTimeout(function () { onPage(currentPage()); }, 1500);
    return true;
  }

  function start() {
    if (startLanding()) return;
    startApp();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
