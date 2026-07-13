/* public/capacitor-bridge.js
   ─────────────────────────────────────────────────────────────
   Native-Android bridge for the Capacitor build. ADDITIVE ONLY:
   - Every existing web/PWA code path (navigator.vibrate, navigator.share,
     <input type="file">, the service worker, push notifications) is left
     completely untouched and keeps working exactly as before.
   - This file only *adds* native behavior on top when running inside the
     Capacitor Android shell. On a normal browser/PWA, window.Capacitor is
     undefined, every guard below short-circuits, and this file does nothing.
   ───────────────────────────────────────────────────────────── */
(function () {
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (!isNative) return; // running as plain web/PWA — do nothing, ever.

  const Plugins = window.Capacitor.Plugins || {};
  const { SplashScreen, StatusBar, Keyboard, App, Haptics, Share, Network } = Plugins;

  /* ── 1. Hide the native splash screen the instant the app's OWN
     loading skeleton (#appLoader) finishes and fades out. This means
     the native splash → the app's existing skeleton → the real UI,
     with no white flash and no gap, and requires zero edits to the
     skeleton loader's own code. ─────────────────────────────────── */
  function wireSplashHide() {
    if (!SplashScreen) return;
    const overlay = document.getElementById('appLoader');
    if (!overlay) { SplashScreen.hide().catch(() => {}); return; }
    if (overlay.classList.contains('al-hide')) { SplashScreen.hide().catch(() => {}); return; }
    const mo = new MutationObserver(() => {
      if (overlay.classList.contains('al-hide')) {
        SplashScreen.hide().catch(() => {});
        mo.disconnect();
      }
    });
    mo.observe(overlay, { attributes: true, attributeFilter: ['class'] });
    // Safety net: never leave the user stuck on the splash forever if the
    // app's own loader logic changes in the future.
    setTimeout(() => { SplashScreen.hide().catch(() => {}); mo.disconnect(); }, 8000);
  }

  /* ── 2. Status bar to match the app's existing dark/red theme
     (same colors already declared in manifest.json / capacitor.config). */
  function wireStatusBar() {
    if (!StatusBar) return;
    StatusBar.setBackgroundColor({ color: '#1a0010' }).catch(() => {});
    StatusBar.setStyle({ style: 'DARK' }).catch(() => {});
  }

  /* ── 3. Hardware back button: mirror the browser back button behavior
     the app already relies on (closing overlays/panels via history),
     and only exit the app when there's truly nowhere left to go back to —
     this is the one piece of behavior a WebView doesn't get for free. */
  function wireBackButton() {
    if (!App) return;
    App.addListener('backButton', ({ canGoBack }) => {
      // Let any open modal/overlay/panel close first — the existing app
      // already listens for popstate/back to close its own UI (chat
      // panels, overlays, sheets), so just replay that same signal.
      const hasOpenOverlay = document.querySelector(
        '.call-overlay, .chat-sheet.open, .modal.open, #callOverlay'
      );
      if (hasOpenOverlay) {
        window.dispatchEvent(new PopStateEvent('popstate'));
        return;
      }
      if (canGoBack) window.history.back();
      else App.exitApp();
    });
  }

  /* ── 4. Reconnect detection — the app already polls/reconnects its own
     way; this just gives it a faster, event-driven signal instead of
     waiting on the next poll tick, and only fires the same 'online'/
     'offline' events the web app already listens for. */
  function wireNetwork() {
    if (!Network) return;
    Network.addListener('networkStatusChange', (status) => {
      window.dispatchEvent(new Event(status.connected ? 'online' : 'offline'));
    });
  }

  /* ── 5. Expose a tiny optional helper other scripts can use, without
     requiring them to — every existing navigator.vibrate()/navigator.share()
     call keeps working unmodified. This purely gives future code an
     opt-in nicer native haptic/share if it wants one. */
  window.NativeBridge = {
    haptic(style) {
      if (Haptics) Haptics.impact({ style: style || 'MEDIUM' }).catch(() => {});
      else if (navigator.vibrate) navigator.vibrate(20); // web fallback, unchanged
    },
    share(opts) {
      if (Share) return Share.share(opts).catch(() => {});
      if (navigator.share) return navigator.share(opts).catch(() => {});
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    wireSplashHide();
    wireStatusBar();
    wireBackButton();
    wireNetwork();
  });
  if (document.readyState !== 'loading') {
    wireSplashHide();
    wireStatusBar();
    wireBackButton();
    wireNetwork();
  }
})();
