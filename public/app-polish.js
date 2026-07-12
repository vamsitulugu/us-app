/* ============================================================
   app-polish.js — global mobile/PWA polish layer
   Loaded AFTER index.html's inline app script, so it can safely
   wrap/override goto(), toast(), and the popstate handler that
   already exist on window without touching their source.
   ============================================================ */
(function () {
  'use strict';

  /* ---- 1. Status bar color — keep native chrome black, in sync
     with the app's dark theme (was hardcoded to a blue #2f6feb). */
  function syncStatusBar() {
    var meta = document.getElementById('themeColorMeta');
    if (meta) meta.setAttribute('content', '#0B0B0B');
  }
  syncStatusBar();
  // Some pages/modals temporarily swap the theme-color meta for
  // contrast (camera, video call). Re-assert ours once those close.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) syncStatusBar();
  });

  function initImmersive() {
    watchImmersiveOverlays();
    updateImmersiveState();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initImmersive);
  } else {
    initImmersive();
  }
  // Overlays referenced above may render slightly after DOMContentLoaded
  // (some are injected by chat.js/call.js). Re-attach observers a few
  // times early on to catch late-mounted elements, cheaply.
  var overlayAttachTries = 0;
  var overlayAttachTimer = setInterval(function () {
    watchImmersiveOverlays();
    if (++overlayAttachTries >= 10) clearInterval(overlayAttachTimer);
  }, 500);

  /* ---- 2. Immersive detection, covering every screen in the app --
     Two independent sources feed one combined state:

     (a) PAGES — full-bleed destinations reached via goto(page).
         Enumerated from every #page-* in index.html (27 total) and
         classified below. Anything not listed here is a normal
         list/card page and keeps the bottom nav.
     (b) OVERLAYS — elements that can appear on TOP of any page
         (call, camera capture controls, image viewer, universal
         search) regardless of which page is behind them. These are
         watched live via MutationObserver so no future overlay
         needs a manual wire-up as long as it follows the app's
         existing open/active class convention. */

  var IMMERSIVE_PAGES = [
    'chat',        // messaging + in-thread call controls
    'map',         // live map, edge-to-edge
    'camera',      // camera capture / video preview
    'globe',       // memory globe — embedded 3D iframe experience
    'virtualhome', // virtual home — embedded 3D iframe experience
    'ai',          // AI love guide — fullscreen conversation
    'profile'      // profile editing
  ];

  // Overlay elements that mean "fullscreen thing is open" whenever
  // they carry an "open" or "active" class, keyed by the class the
  // app already uses to show/hide them (matches existing code, no
  // new conventions introduced).
  var IMMERSIVE_OVERLAY_SELECTORS = [
    { id: 'imgViewer',     activeClass: 'open' },   // image viewer
    { id: 'searchOverlay', activeClass: 'open' },   // universal search
    { id: 'camOverlay',    activeClass: null,       // camera controls: shown via inline style, not a class
      isActive: function (el) { return el && el.style.display !== 'none' && el.offsetParent !== null; } }
  ];

  function isCallActive() {
    // callOverlay is created/removed by Call.js only while a call
    // exists (see call.js: document.getElementById('callOverlay')).
    return !!document.getElementById('callOverlay');
  }

  function isAnyImmersiveOverlayOpen() {
    return IMMERSIVE_OVERLAY_SELECTORS.some(function (cfg) {
      var el = document.getElementById(cfg.id);
      if (!el) return false;
      if (cfg.isActive) return cfg.isActive(el);
      return cfg.activeClass && el.classList.contains(cfg.activeClass);
    });
  }

  function currentPage() {
    var active = document.querySelector('.page.active');
    return active ? active.id.replace(/^page-/, '') : null;
  }

  function updateImmersiveState(page) {
    page = page || currentPage();
    var immersive = IMMERSIVE_PAGES.indexOf(page) !== -1
      || isCallActive()
      || isAnyImmersiveOverlayOpen();
    document.body.setAttribute('data-immersive', immersive ? '1' : '0');
  }

  // Live-watch every immersive overlay for class/style changes, so
  // opening one from ANY page (not just via goto()) still hides the
  // nav, and closing it restores the nav without a page navigation
  // having to happen.
  function watchImmersiveOverlays() {
    IMMERSIVE_OVERLAY_SELECTORS.forEach(function (cfg) {
      var el = document.getElementById(cfg.id);
      if (!el || el.__polishObserved) return;
      el.__polishObserved = true;
      new MutationObserver(function () { updateImmersiveState(); })
        .observe(el, { attributes: true, attributeFilter: ['class', 'style'] });
    });
    // callOverlay is added/removed from the DOM entirely (not just
    // class-toggled), so watch its parent for childList changes.
    if (!document.body.__polishCallObserved) {
      document.body.__polishCallObserved = true;
      new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          if (mutations[i].addedNodes.length || mutations[i].removedNodes.length) {
            updateImmersiveState();
            break;
          }
        }
      }).observe(document.body, { childList: true });
    }
  }

  /* ---- 3. Wrap goto() (defined inline in index.html) so every
     navigation also updates the immersive/nav-hide state, without
     editing the large inline script itself. */
  function installGotoWrapper() {
    if (typeof window.goto !== 'function' || window.goto.__polished) {
      return false;
    }
    var originalGoto = window.goto;
    var wrapped = function (page, pushHistory) {
      var result = originalGoto(page, pushHistory);
      updateImmersiveState(page);
      return result;
    };
    wrapped.__polished = true;
    window.goto = wrapped;
    return true;
  }
  // The inline script may define goto() after this file runs, so
  // poll briefly until it exists, then patch it once.
  var gotoPoll = setInterval(function () {
    if (installGotoWrapper()) clearInterval(gotoPoll);
  }, 50);
  setTimeout(function () { clearInterval(gotoPoll); }, 10000);

  /* ---- 4. Back-button guard for active calls -------------------
     The existing popstate handler in index.html always calls
     goto(page, false) — including while a call is live, which tears
     the call UI down mid-conversation. We intercept at the capture
     phase (registered before the app's own listener, since this
     script loads after it, so add ours with capture:true which
     always fires first regardless of registration order) and, if a
     call is active, minimize it (keep it connected, pop back to a
     small PiP) instead of letting navigation destroy it. */
  window.addEventListener('popstate', function (e) {
    if (isCallActive() && window.Call && typeof window.Call.minimize === 'function') {
      // Keep the user's place: re-push the state we were about to
      // leave so the underlying app handler (if any) has a
      // consistent page to land on, then just minimize the call.
      window.Call.minimize();
      updateImmersiveState();
      return;
    }
  }, true);

  /* ---- 5. Suppress developer/debug toasts from end users -------
     Wrap toast() once it exists so internal/dev-only messages never
     reach a real user, while genuine feedback (sync, pairing,
     errors relevant to the user) still shows normally. */
  var DEBUG_TOAST_PATTERNS = [
    /push subscri/i,
    /^debug[:\s]/i,
    /service ?worker registered/i,
    /\{"ok"\s*:\s*true\}/i   // raw JSON.stringify() echoed into a toast
  ];
  function installToastFilter() {
    if (typeof window.toast !== 'function' || window.toast.__polished) return false;
    var originalToast = window.toast;
    var wrapped = function (msg, dur) {
      if (typeof msg === 'string' && DEBUG_TOAST_PATTERNS.some(function (re) { return re.test(msg); })) {
        console.log('[debug toast suppressed]', msg);
        return;
      }
      return originalToast(msg, dur);
    };
    wrapped.__polished = true;
    window.toast = wrapped;
    return true;
  }
  var toastPoll = setInterval(function () {
    if (installToastFilter()) clearInterval(toastPoll);
  }, 50);
  setTimeout(function () { clearInterval(toastPoll); }, 10000);

  /* ---- 6. Note: the mobile header logo and the search/sync
     right-alignment (formerly patched here at runtime via DOM
     surgery) are now fixed permanently in index.html's markup
     (.tb-row / .tb-left / .tb-actions / .tb-logo-mobile) and
     app-polish.css. No JS is needed for either anymore — removing
     the old runtime patch also removes the risk of it racing with
     or double-wrapping the now-correct static markup. */

  /* ---- 7. Passive scroll/touch listeners for smoother scrolling. */
  ['touchstart', 'touchmove', 'wheel'].forEach(function (evt) {
    window.addEventListener(evt, function () {}, { passive: true });
  });

  /* ---- 8. Keep the DOM ready-checks resilient if this file loads
     before the inline app script finishes defining everything. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      installGotoWrapper();
      installToastFilter();
    });
  }
})();