// public/home/scene_p8_patch.js
// ════════════════════════════════════════════════
//  Phase 8 patch — load AFTER scene_p7_patch2.js
//  and all Phase 8 module files.
//
//  Wires 8 new modules into HomeScene lifecycle
//  without modifying any Phase 1-7 file:
//    HomeStateManager
//    HomeDailyRoutine
//    HomeRelationshipEngine
//    HomeNPCBehavior (also registered as HomeAIBehavior)
//    HomeSmartFurniture
//    HomeAmbientAudioEngine
//    HomeCameraDirector
//    HomeEventEngine
//    HomeEmotionEngine
//
//  Load order required in home.html:
//    ... (phases 1-7 scripts) ...
//    home_state.js
//    daily_routine.js
//    relationship_engine.js
//    npc_behavior.js
//    smart_furniture.js
//    ambient_audio.js
//    camera_director.js
//    event_engine.js
//    emotion_engine.js
//    scene_p8_patch.js   ← this file, last
// ════════════════════════════════════════════════
(function patchPhase8() {

  // ── Guard: only patch once ──────────────────────
  if (window.__p8Patched) return;
  window.__p8Patched = true;

  // ── Helper: safe init call ──────────────────────
  function _safeInit(mod, label, ...args) {
    if (window[mod]) {
      try { window[mod].init(...args); }
      catch (e) { console.warn(`[P8] ${label}.init:`, e); }
    }
  }

  // ── 1. Extend HomeScene.init() ──────────────────
  const _origInit = HomeScene.init.bind(HomeScene);
  HomeScene.init = function(canvasEl) {
    const result = _origInit(canvasEl);
    const scene    = HomeScene.getScene();
    const camera   = HomeScene.getCamera();
    const renderer = HomeScene.getRenderer();

    // Phase 8 init sequence
    _safeInit('HomeStateManager',        'HomeStateManager');
    _safeInit('HomeDailyRoutine',        'HomeDailyRoutine');
    _safeInit('HomeRelationshipEngine',  'HomeRelationshipEngine');
    _safeInit('HomeNPCBehavior',         'HomeNPCBehavior');
    _safeInit('HomeAmbientAudioEngine',  'HomeAmbientAudioEngine');
    _safeInit('HomeSmartFurniture',      'HomeSmartFurniture',   scene);
    _safeInit('HomeCameraDirector',      'HomeCameraDirector',   camera, scene);
    _safeInit('HomeEventEngine',         'HomeEventEngine');
    _safeInit('HomeEmotionEngine',       'HomeEmotionEngine',    scene);

    // Restore persisted state after all modules are live
    if (window.HomeStateManager) {
      setTimeout(() => {
        try { HomeStateManager.applyToScene(); } catch (e) {
          console.warn('[P8] applyToScene:', e);
        }
      }, 500);
    }

    // Broadcast Phase 8 ready
    window.dispatchEvent(new CustomEvent('home:phase8Ready'));

    return result;
  };

  // ── 2. Extend the Phase 7 rAF update loop ────────
  //  scene_p7_patch.js already runs a separate rAF loop for P7 modules.
  //  We layer our own rAF on top for P8 modules that need update(dt).
  let _p8Running  = false;
  let _p8Frame    = null;
  let _p8LastTime = 0;

  function _p8Loop(now) {
    _p8Frame = requestAnimationFrame(_p8Loop);
    if (!window.HomeScene || !HomeScene.getScene) return;

    const dt = Math.min((now - _p8LastTime) / 1000, 0.05);
    _p8LastTime = now;
    if (dt <= 0) return;

    if (window.HomeDailyRoutine)       { try { HomeDailyRoutine.update(dt);       } catch (_) {} }
    if (window.HomeRelationshipEngine) { try { HomeRelationshipEngine.update(dt); } catch (_) {} }
    if (window.HomeNPCBehavior)        { try { HomeNPCBehavior.update(dt);        } catch (_) {} }
    if (window.HomeAmbientAudioEngine) { try { HomeAmbientAudioEngine.update(dt); } catch (_) {} }
    if (window.HomeCameraDirector)     { try { HomeCameraDirector.update(dt);     } catch (_) {} }
    if (window.HomeEventEngine)        { try { HomeEventEngine.update(dt);        } catch (_) {} }
    if (window.HomeEmotionEngine)      { try { HomeEmotionEngine.update(dt);      } catch (_) {} }
  }

  // Hook loop start into init
  const _origInit2 = HomeScene.init.bind(HomeScene);
  HomeScene.init = function(canvasEl) {
    const r = _origInit2(canvasEl);
    if (!_p8Running) {
      _p8Running  = true;
      _p8LastTime = performance.now();
      _p8Frame    = requestAnimationFrame(_p8Loop);
    }
    return r;
  };

  // ── 3. Extend HomeScene.dispose() ────────────────
  const _origDispose = HomeScene.dispose.bind(HomeScene);
  HomeScene.dispose = function() {
    if (_p8Frame) { cancelAnimationFrame(_p8Frame); _p8Frame = null; }
    _p8Running = false;
    const mods = [
      'HomeEmotionEngine', 'HomeEventEngine', 'HomeCameraDirector',
      'HomeAmbientAudioEngine', 'HomeSmartFurniture', 'HomeNPCBehavior',
      'HomeRelationshipEngine', 'HomeDailyRoutine', 'HomeStateManager'
    ];
    mods.forEach(m => {
      if (window[m] && typeof window[m].dispose === 'function') {
        try { window[m].dispose(); } catch (_) {}
      }
    });
    _origDispose();
  };

  // ── 4. Bridge HomeInteractions.trigger() to emit event ──
  //  HomeInteractions.trigger() doesn't currently dispatch a DOM event.
  //  We wrap it so HomeRelationshipEngine and HomeEmotionEngine can react.
  if (window.HomeInteractions) {
    const _origTrigger = HomeInteractions.trigger.bind(HomeInteractions);
    HomeInteractions.trigger = function(key, opts) {
      const result = _origTrigger(key, opts);
      if (result) {
        window.dispatchEvent(new CustomEvent('home:interactionTriggered', { detail: { key, opts } }));
      }
      return result;
    };
  } else {
    // HomeInteractions not yet available — defer
    let _attempts = 0;
    const _timer = setInterval(() => {
      if (++_attempts > 30) { clearInterval(_timer); return; }
      if (window.HomeInteractions) {
        clearInterval(_timer);
        const _origTrigger = HomeInteractions.trigger.bind(HomeInteractions);
        HomeInteractions.trigger = function(key, opts) {
          const result = _origTrigger(key, opts);
          if (result) {
            window.dispatchEvent(new CustomEvent('home:interactionTriggered', { detail: { key, opts } }));
          }
          return result;
        };
      }
    }, 200);
  }

  // ── 5. Partner presence → toast + camera ─────────
  window.addEventListener('home:partnerOnline', () => {
    if (window.HomeCameraDirector) HomeCameraDirector.setMode('arrival', 2.5);
    HomeUtils.toast(`${HomeUtils.getPartnerName()} just arrived! 🏡`, 'success');
  });

  // ── 6. Register ambient audio with fireplace state ──
  window.addEventListener('home:phase8Ready', () => {
    // Sync fireplace audio to persisted state
    const fireplaceOn = HomeStateManager.get('fireplace');
    if (window.HomeAmbientAudioEngine && fireplaceOn) {
      HomeAmbientAudioEngine.setFireplaceAudio(true);
    }
    // Sync TV audio
    const tvOn = HomeStateManager.get('tv');
    if (window.HomeAmbientAudioEngine && tvOn) {
      HomeAmbientAudioEngine.setTVAudio(true);
    }
  });

  // ── 7. Expose Phase 8 debug helper on window ──────
  window.HomeP8 = {
    forceEvent:      (key) => window.HomeEventEngine    && HomeEventEngine.forceEvent(key),
    fastForwardTo:   (p)   => window.HomeDailyRoutine   && HomeDailyRoutine.fastForwardTo(p),
    setWeather:      (w)   => window.HomeWeather         && HomeWeather.setWeather(w),
    showEmotion:     (r,e) => window.HomeEmotionEngine   && HomeEmotionEngine.showEmotion(r, e),
    cameraMode:      (m)   => window.HomeCameraDirector  && HomeCameraDirector.setMode(m),
    getState:        ()    => window.HomeStateManager    && HomeStateManager.getAll(),
    getRelationship: ()    => window.HomeRelationshipEngine && HomeRelationshipEngine.getAll(),
    version:         8
  };

  console.info('[P8] Phase 8 — Smart Living System patched ✓');

})();
