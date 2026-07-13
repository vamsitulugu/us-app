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

  /* ── 2. Status bar icon style only — MainActivity.java (native) already
     makes both the status bar and navigation bar transparent and sets
     light/white icons for edge-to-edge. Setting a background color from
     here would fight that and reintroduce a solid bar. */
  function wireStatusBar() {
    if (!StatusBar) return;
    StatusBar.setStyle({ style: 'DARK' }).catch(() => {});
  }

  /* ── 3. Hardware back button + Predictive Back (Android 13+, enabled via
     android:enableOnBackInvokedCallback in AndroidManifest.xml).
     Priority, matching what a physical back press already does elsewhere
     in the app:
       1) close any open overlay/modal/sheet directly (they toggle a plain
          .open class via direct DOM calls — index.html/call.js — not via
          history, so we close them the same way instead of touching history)
       2) otherwise step back through the app's own page history (goto()/
          popstate are already wired for this — see index.html's goto()
          comment: "including via the Android hardware Back button")
       3) otherwise, there's nowhere left to go — exit the app. */
  function wireBackButton() {
    if (!App) return;
    App.addListener('backButton', ({ canGoBack }) => {
      const openOverlay = document.querySelector(
        '#callOverlay.open, .modal-bg.open, #imgViewer.open, #searchOverlay.open'
      );
      if (openOverlay) {
        openOverlay.classList.remove('open');
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