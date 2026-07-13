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
  const { SplashScreen, StatusBar, Keyboard, App, Haptics, Share, Network, Camera } = Plugins;

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

  /* ── 5. App lifecycle (background / resume / kill-restore). The app
     already re-syncs its own state via polling (see PageManager); this
     just gives it an immediate, event-driven nudge the instant Android
     brings the app back to the foreground, instead of waiting up to one
     full poll interval. It fires the SAME 'online' event wireNetwork()
     already uses, so no other file needs to know this exists. It also
     persists nothing and touches no other state — a resume is just a
     hint to refresh sooner. */
  function wireLifecycle() {
    if (!App) return;
    App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) window.dispatchEvent(new Event('online'));
    });
    // Android can kill a backgrounded app process at any time under
    // memory pressure; when Capacitor restarts it, this is the one
    // reliable signal to re-run the same "just resumed" refresh above,
    // since a cold BridgeActivity re-create looks identical to a resume
    // from JS's point of view.
    App.addListener('resume', () => window.dispatchEvent(new Event('online')));
  }

  /* ── 6. Deep links (custom scheme + intent-filter added in
     AndroidManifest.xml). Routes usapp://open/<page> and
     https://.../open/<page> into the app's own existing goto(page)
     router — no new routing system, just feeding its existing one. If
     goto() or the page doesn't exist, this silently does nothing. */
  function wireDeepLinks() {
    if (!App) return;
    App.addListener('appUrlOpen', (data) => {
      try {
        const url = new URL(data.url);
        const parts = url.pathname.split('/').filter(Boolean);
        const page = parts[parts.length - 1] || url.hostname;
        if (page && typeof window.goto === 'function') window.goto(page);
      } catch (e) { /* malformed or unrecognized link — ignore, no crash */ }
    });
  }

  /* ── 7. Native share sheet. navigator.share() does not exist in
     Android's Capacitor WebView (unlike Chrome for Android), so
     shareCode() at index.html:7113 was silently falling through to its
     own copyCode() fallback. Defining navigator.share here makes that
     SAME existing call site (and any other navigator.share() call
     anywhere else in the app, present or future) open the real native
     share sheet automatically — zero edits to index.html needed. */
  function wireShare() {
    if (!Share || navigator.share) return; // don't shadow a real browser API if one exists
    navigator.share = function (data) {
      return Share.share({
        title: data && data.title,
        text: data && data.text,
        url: data && data.url
      }).then(() => {}).catch((e) => {
        // User-cancelled share sheets reject too — mirror the spec's
        // AbortError behavior so existing .catch(()=>{}) call sites
        // (which already swallow rejections) keep behaving identically.
        return Promise.reject(e);
      });
    };
  }

  /* ── 8. Haptics upgrade. navigator.vibrate([...]) already works as-is
     inside the WebView (VIBRATE permission is granted), so it's left
     completely alone. This just ALSO fires a real native haptic impact
     alongside it for a nicer, more "native" feel on the same 5 existing
     call sites — additive, and a no-op if Haptics isn't available. */
  function wireHaptics() {
    if (!Haptics) return;
    const originalVibrate = navigator.vibrate ? navigator.vibrate.bind(navigator) : null;
    navigator.vibrate = function (pattern) {
      Haptics.impact({ style: 'MEDIUM' }).catch(() => {});
      return originalVibrate ? originalVibrate(pattern) : true;
    };
  }

  /* ── 9. Native image picker for the two single-image avatar inputs
     (myAvatarInput / ptAvatarInput). These are the only file inputs
     that are unambiguously "pick exactly one photo" — every other
     upload in the app accepts multiple files, video, or audio, which
     the Camera plugin can't represent, so those are correctly left to
     the existing (already-functional) system file chooser. Intercepted
     in the capture phase so the existing onchange handlers on these
     inputs are still the ones that run — we just swap in the native
     Camera/Gallery choice and manually populate this same <input>'s
     files, then dispatch its normal 'change' event unmodified. */
  function wireImagePicker() {
    if (!Camera) return;
    ['myAvatarInput', 'ptAvatarInput'].forEach((id) => {
      const input = document.getElementById(id);
      if (!input) return;
      input.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        Camera.getPhoto({
          quality: 85,
          allowEditing: false,
          resultType: 'uri',
          source: 'PROMPT', // native "Camera / Photos" chooser
          promptLabelHeader: 'Choose Photo',
          promptLabelPhoto: 'From Gallery',
          promptLabelPicture: 'Take Photo'
        }).then(async (photo) => {
          const resp = await fetch(photo.webPath);
          const blob = await resp.blob();
          const file = new File([blob], 'avatar.jpg', { type: blob.type || 'image/jpeg' });
          const dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }).catch(() => {}); // user cancelled — do nothing, same as cancelling the web picker
      }, true);
    });
  }

  /* ── 10. Expose a tiny optional helper other scripts can use, without
     requiring them to — every existing call site above keeps working
     unmodified; this just gives future code an opt-in native haptic/
     share/permission call if it wants one directly. */
  window.NativeBridge = {
    haptic(style) {
      if (Haptics) Haptics.impact({ style: style || 'MEDIUM' }).catch(() => {});
      else if (navigator.vibrate) navigator.vibrate(20); // web fallback, unchanged
    },
    share(opts) {
      if (Share) return Share.share(opts).catch(() => {});
      if (navigator.share) return navigator.share(opts).catch(() => {});
    },
    requestCameraPermission() {
      if (Camera && Camera.requestPermissions) return Camera.requestPermissions();
      return Promise.resolve();
    }
  };

  function wireAll() {
    wireSplashHide();
    wireStatusBar();
    wireBackButton();
    wireNetwork();
    wireLifecycle();
    wireDeepLinks();
    wireShare();
    wireHaptics();
    wireImagePicker();
  }

  document.addEventListener('DOMContentLoaded', wireAll);
  if (document.readyState !== 'loading') wireAll();
})();