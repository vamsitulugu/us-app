/* ══════════════════════════════════════════════════════════════
   UX POLISH PATCH — JS
   Follows the same non-invasive hooking pattern as index_patch.js:
   it wraps existing globals (goto, Call.*) instead of editing them,
   so nothing here duplicates or replaces existing logic.
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── 0. FOUC guard: flip visibility on as soon as the browser has
     resolved final computed styles for the theme variables. ── */
  function markThemeReady() {
    document.documentElement.classList.add('theme-ready');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', markThemeReady);
  } else {
    markThemeReady();
  }
  // Safety net in case something upstream throws before DOMContentLoaded fires
  setTimeout(markThemeReady, 1200);

  /* ── Pages that should be treated as "immersive" — bottom nav
     hides while any of these is the active page/overlay. ── */
  const IMMERSIVE_PAGES = new Set(['chat', 'camera', 'map', 'globe', 'virtualhome']);

  let immersiveOverlayCount = 0; // calls, fullscreen media, image viewer, etc.

  function updateNavVisibility() {
    const activePage = document.querySelector('.page.active');
    const pageId = activePage ? activePage.id.replace('page-', '') : null;
    const immersive = immersiveOverlayCount > 0 || IMMERSIVE_PAGES.has(pageId);
    document.body.classList.toggle('nav-hidden', immersive);
  }

  /* Call any time an overlay (call UI, fullscreen player, image
     viewer, fullscreen AI, etc.) opens or closes. */
  window.UXPolish = {
    enterImmersive() { immersiveOverlayCount++; updateNavVisibility(); },
    exitImmersive() { immersiveOverlayCount = Math.max(0, immersiveOverlayCount - 1); updateNavVisibility(); }
  };

  /* ── 2. Hook goto() so nav visibility re-evaluates on every
     page change, on top of whatever index_patch.js already hooked. ── */
  function hookGoto() {
    const _prevGoto = window.goto;
    if (typeof _prevGoto !== 'function' || _prevGoto.__uxPolishHooked) return;
    window.goto = function (page, pushHistory) {
      _prevGoto(page, pushHistory);
      updateNavVisibility();
    };
    window.goto.__uxPolishHooked = true;
  }

  /* ── 1. Android back button: don't let it kill an active call or
     exit the PWA while immersive content is open. Root cause: the
     app never pushed a history entry when opening the call overlay
     / fullscreen views, so a single hardware back-press had nothing
     to "consume" and closed the WebView outright, killing the
     WebRTC/audio session instantly. Fix: push a guard history entry
     whenever something immersive opens, and on popstate, close/
     minimize that thing instead of letting the navigation continue. ── */
  let guardDepth = 0;
  function pushBackGuard() {
    guardDepth++;
    try { history.pushState({ uxGuard: true, depth: guardDepth }, ''); } catch (_) {}
  }

  function hookCallBackButton() {
    if (!window.Call || window.Call.__uxPolishHooked) return;
    const orig = {
      startCall: window.Call.startCall,
      acceptCall: window.Call.acceptCall,
      endCall: window.Call.endCall,
      minimize: window.Call.minimize,
      restore: window.Call.restore
    };
    window.Call.startCall = function (...args) {
      pushBackGuard();
      window.UXPolish.enterImmersive();
      return orig.startCall.apply(window.Call, args);
    };
    window.Call.acceptCall = function (...args) {
      pushBackGuard();
      window.UXPolish.enterImmersive();
      return orig.acceptCall.apply(window.Call, args);
    };
    window.Call.endCall = function (...args) {
      window.UXPolish.exitImmersive();
      return orig.endCall.apply(window.Call, args);
    };
    // Minimizing a call is itself a good response to the back button,
    // so it should NOT count as leaving "immersive" — the PiP bubble
    // stays visible over normal navigation, which is the desired UX.
    window.Call.restore = function (...args) {
      pushBackGuard();
      return orig.restore.apply(window.Call, args);
    };
    window.Call.__uxPolishHooked = true;
  }

  window.addEventListener('popstate', function (e) {
    // If a call is active and not already minimized, treat back as
    // "minimize, stay connected" rather than letting default
    // navigation/exit proceed.
    const overlay = document.getElementById('callOverlay');
    const callIsOpenFullscreen = overlay && overlay.classList.contains('open');
    if (callIsOpenFullscreen && window.Call && typeof window.Call.minimize === 'function') {
      window.Call.minimize();
      pushBackGuard(); // re-arm the guard so the NEXT back press is needed to actually leave
      return;
    }
    updateNavVisibility();
  }, true);

  /* ── Init / re-init hooks once app globals exist (goto, Call are
     defined late in index.html / loaded async from chat/call.js). ── */
  function tryInit() {
    hookGoto();
    hookCallBackButton();
    updateNavVisibility();
  }
  document.addEventListener('DOMContentLoaded', tryInit);
  window.addEventListener('load', tryInit);
  // Call.js loads after the page; poll briefly until it's available.
  let tries = 0;
  const iv = setInterval(() => {
    tries++;
    hookCallBackButton();
    if ((window.Call && window.Call.__uxPolishHooked) || tries > 40) clearInterval(iv);
  }, 250);

  /* ── 7. Collapse the header logo on scroll for a tighter, more
     "app-like" feel once the user starts reading content — purely
     cosmetic, never affects layout height (avoids jumps). ── */
  document.addEventListener('DOMContentLoaded', function () {
    const contentEls = document.querySelectorAll('.content');
    const topbar = document.querySelector('.topbar');
    if (!topbar || !contentEls.length) return;
    contentEls.forEach(el => {
      el.addEventListener('scroll', () => {
        topbar.classList.toggle('tb-collapsed', el.scrollTop > 24);
      }, { passive: true });
    });
  });
})();
