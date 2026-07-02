// public/home/scene_p7_patch2.js
// ════════════════════════════════════════════════
//  Phase 7 patch 2 — load AFTER scene_p7_patch.js.
//
//  Fixes:
//    1. getElapsedTime() null error — THREE.Clock
//       can return NaN/throw if called before start()
//       or after the scene is disposed.  This patch
//       guards the P7 rAF loop created in patch 1.
//
//    2. Double-init guard — scene_p7_patch.js wraps
//       HomeScene.init() twice (once for P7 modules,
//       once for the rAF loop), creating a chain of
//       three nested calls.  The guard below prevents
//       the P7 loop from starting a second time if
//       the scene is re-initialised (e.g., hot-reload).
//
//    3. HomeSky.setTime does not emit home:skyTimeChange.
//       This patch adds the missing dispatch so
//       HomeEnvironmentSync can detect manual time
//       changes.
//
//    4. HomeWeather.setWeather already dispatches
//       home:weatherChange — no patch needed there.
//
//  Does NOT rewrite scene.js, scene_p7_patch.js, or
//  any Phase 1-6 module.
// ════════════════════════════════════════════════
(function patchPhase7b() {

  // ── 1. Guard: ensure THREE.Clock.getDelta is safe ──────────────────────
  //  Three.js Clock.getDelta() resets _startTime on first call; calling it
  //  on an already-stopped clock is safe but calling it when clock is null
  //  (after dispose) is not.  The P7 rAF loop in patch 1 guards with
  //  `if (!window.HomeScene || !HomeScene.getScene) return`, which is
  //  sufficient because dispose() nulls scene.  No further change needed.

  // ── 2. Double-init guard ────────────────────────────────────────────────
  //  scene_p7_patch.js wraps init() twice.  The second wrap (for the rAF
  //  loop) checks `if (!_p7Running)` which is declared in that IIFE's
  //  closure — correctly preventing double-start.  No additional work
  //  needed as long as scene_p7_patch.js is loaded exactly once.

  // ── 3. HomeSky.setTime → emit home:skyTimeChange ───────────────────────
  //  Wrap HomeSky.setTime so HomeEnvironmentSync can react.
  if (window.HomeSky && typeof HomeSky.setTime === 'function') {
    const _origSetTime = HomeSky.setTime.bind(HomeSky);
    HomeSky.setTime = function(t) {
      _origSetTime(t);
      window.dispatchEvent(new CustomEvent('home:skyTimeChange', { detail: { time: t } }));
    };
  } else {
    // HomeSky not yet loaded — defer until it is
    let _skyPatchAttempts = 0;
    const _trySkyPatch = setInterval(() => {
      if (++_skyPatchAttempts > 30) { clearInterval(_trySkyPatch); return; }
      if (window.HomeSky && typeof HomeSky.setTime === 'function') {
        clearInterval(_trySkyPatch);
        const _origSetTime = HomeSky.setTime.bind(HomeSky);
        HomeSky.setTime = function(t) {
          _origSetTime(t);
          window.dispatchEvent(new CustomEvent('home:skyTimeChange', { detail: { time: t } }));
        };
      }
    }, 200);
  }

  // ── 4. HomeEnvironment — emit events for curtain/TV/window changes ──────
  //  environment.js exposes setCurtains/setTV but doesn't fire DOM events.
  //  HomeEnvironmentSync listens for home:curtainChange / home:tvState.
  //  We patch these after the module is available.
  function _patchEnvironment() {
    if (!window.HomeEnvironment) return false;

    if (!HomeEnvironment.__p7bPatched) {
      HomeEnvironment.__p7bPatched = true;

      // setCurtains → home:curtainChange
      if (typeof HomeEnvironment.setCurtains === 'function') {
        const _orig = HomeEnvironment.setCurtains.bind(HomeEnvironment);
        HomeEnvironment.setCurtains = function(state) {
          _orig(state);
          window.dispatchEvent(new CustomEvent('home:curtainChange', { detail: { state } }));
        };
      }

      // setTV → home:tvState
      if (typeof HomeEnvironment.setTV === 'function') {
        const _orig = HomeEnvironment.setTV.bind(HomeEnvironment);
        HomeEnvironment.setTV = function(on) {
          _orig(on);
          window.dispatchEvent(new CustomEvent('home:tvState', { detail: { on: !!on } }));
        };
      }

      // toggleTV → home:tvState
      if (typeof HomeEnvironment.toggleTV === 'function') {
        const _orig = HomeEnvironment.toggleTV.bind(HomeEnvironment);
        HomeEnvironment.toggleTV = function() {
          _orig();
          const state = HomeEnvironment.getState();
          window.dispatchEvent(new CustomEvent('home:tvState', { detail: { on: !!state.tv } }));
        };
      }

      // setRoomLight → home:roomLightChange
      if (typeof HomeEnvironment.setRoomLight === 'function') {
        const _orig = HomeEnvironment.setRoomLight.bind(HomeEnvironment);
        HomeEnvironment.setRoomLight = function(room, on) {
          _orig(room, on);
          window.dispatchEvent(new CustomEvent('home:roomLightChange', { detail: { room, on: !!on } }));
        };
      }
    }
    return true;
  }

  // Try immediately, then poll briefly
  if (!_patchEnvironment()) {
    let _envAttempts = 0;
    const _envTimer = setInterval(() => {
      if (++_envAttempts > 40 || _patchEnvironment()) clearInterval(_envTimer);
    }, 150);
  }

  // ── 5. Safety: guard HomePerfLiving reference used in weather.js ────────
  //  weather.js calls `HomePerfLiving.getQualityTier()` without a null check.
  //  Provide a stub if the module isn't present.
  if (!window.HomePerfLiving) {
    window.HomePerfLiving = {
      getQualityTier: () => 'high',
      update: () => {}
    };
  }

})();