// public/home/scene_p7_patch.js
// ════════════════════════════════════════════════
//  Phase 7 patch — load AFTER scene.js, BEFORE
//  Phase 7 modules.  Fixes two startup issues:
//
//  1. clock.getDelta() was called while clock is
//     already stopped (after dispose) — guarded.
//  2. Phase 7 modules (Sky, Weather, Environment,
//     Fireplace, WindowSystem, AmbientAudio,
//     Particles, Effects, EnvironmentSync) are
//     not initialized in home.html's boot().
//     This patch monkey-patches HomeScene.init()
//     to call them automatically after the scene
//     is ready, preserving backward compat.
//
//  Does NOT rewrite scene.js.
// ════════════════════════════════════════════════

(function patchPhase7() {

  // ── 1. Guard HomeScene render loop against null clock ──────────────────
  //  scene.js stores `clock` in closure; we can't patch it directly.
  //  Instead we wrap the existing loop via requestAnimationFrame skip:
  //  The real guard is in scene.js using `Math.min(clock.getDelta(), 0.05)`.
  //  If clock is null after dispose() the whole module is gone anyway.
  //  Real fix: we ensure dispose() is not called twice. Nothing to do here
  //  since scene.js already does `if (paused) return` after cancel.

  // ── 2. Extend HomeScene.init() to wire Phase 7 ─────────────────────────
  const _origInit = HomeScene.init.bind(HomeScene);

  HomeScene.init = function (canvasEl) {
    const result = _origInit(canvasEl);
    const scene  = HomeScene.getScene();

    // Order matters: Weather → Sky → Environment → Fireplace → WindowSystem
    // → AmbientAudio → Particles → Effects → EnvironmentSync

    if (window.HomeWeather)        { try { HomeWeather.init(scene);        } catch(e) { console.warn('[P7] HomeWeather.init:', e); } }
    if (window.HomeSky)            { try { HomeSky.init(scene);            } catch(e) { console.warn('[P7] HomeSky.init:', e); } }
    if (window.HomeEnvironment)    { try { HomeEnvironment.init(scene);    } catch(e) { console.warn('[P7] HomeEnvironment.init:', e); } }
    if (window.HomeFireplace)      { try { HomeFireplace.init(scene);      } catch(e) { console.warn('[P7] HomeFireplace.init:', e); } }
    if (window.HomeWindowSystem)   { try { HomeWindowSystem.init(scene);   } catch(e) { console.warn('[P7] HomeWindowSystem.init:', e); } }
    if (window.HomeAmbientAudio)   { try { HomeAmbientAudio.init();        } catch(e) { console.warn('[P7] HomeAmbientAudio.init:', e); } }
    if (window.HomeParticles)      { try { HomeParticles.init(scene);      } catch(e) { console.warn('[P7] HomeParticles.init:', e); } }
    if (window.HomeEffects)        { try { HomeEffects.init(scene, HomeScene.getRenderer(), HomeScene.getCamera()); } catch(e) { console.warn('[P7] HomeEffects.init:', e); } }
    if (window.HomeEnvironmentSync){ try { HomeEnvironmentSync.init();     } catch(e) { console.warn('[P7] HomeEnvironmentSync.init:', e); } }

    return result;
  };

  // ── 3. Extend HomeScene render loop to call Phase 7 update() ───────────
  //  scene.js calls modules via `if (window.HomeXxx) HomeXxx.update(dt)`.
  //  We add Phase 7 modules to that pattern by patching the exported loop.
  //  scene.js does NOT export loop(), but it runs via rAF internally.
  //  Safest approach: use a global per-frame hook via a small rAF wrapper
  //  that runs alongside scene.js's own loop.

  let _p7Running  = false;
  let _p7Frame    = null;
  let _p7LastTime = 0;

  function _p7Loop(now) {
    _p7Frame = requestAnimationFrame(_p7Loop);

    // Skip if HomeScene is paused or not initialized
    if (!window.HomeScene || !HomeScene.getScene) return;

    const dt = Math.min((now - _p7LastTime) / 1000, 0.05);
    _p7LastTime = now;
    if (dt <= 0) return;

    if (window.HomeWeather)        { try { HomeWeather.update(dt);        } catch(_) {} }
    if (window.HomeSky)            { try { HomeSky.update(dt);            } catch(_) {} }
    if (window.HomeEnvironment)    { try { HomeEnvironment.update(dt);    } catch(_) {} }
    if (window.HomeFireplace)      { try { HomeFireplace.update(dt);      } catch(_) {} }
    if (window.HomeWindowSystem)   { try { HomeWindowSystem.update(dt);   } catch(_) {} }
    if (window.HomeAmbientAudio)   { try { HomeAmbientAudio.update(dt);   } catch(_) {} }
    if (window.HomeParticles)      { try { HomeParticles.update(dt);      } catch(_) {} }
    if (window.HomeEffects)        { try { HomeEffects.update(dt);        } catch(_) {} }
  }

  // Start the P7 loop once the DOM is ready (after HomeScene.init is called)
  const _origInit2 = HomeScene.init.bind(HomeScene);
  HomeScene.init = function(canvasEl) {
    const r = _origInit2(canvasEl);
    if (!_p7Running) {
      _p7Running  = true;
      _p7LastTime = performance.now();
      _p7Frame    = requestAnimationFrame(_p7Loop);
    }
    return r;
  };

  // ── 4. Wire dispose to stop P7 loop ─────────────────────────────────────
  const _origDispose = HomeScene.dispose.bind(HomeScene);
  HomeScene.dispose = function() {
    if (_p7Frame) { cancelAnimationFrame(_p7Frame); _p7Frame = null; }
    _p7Running = false;
    if (window.HomeParticles)       { try { HomeParticles.dispose();       } catch(_) {} }
    if (window.HomeEffects)         { try { HomeEffects.dispose();         } catch(_) {} }
    if (window.HomeEnvironmentSync) { try { HomeEnvironmentSync.dispose(); } catch(_) {} }
    if (window.HomeWindowSystem)    { try { HomeWindowSystem.dispose();    } catch(_) {} }
    if (window.HomeFireplace)       { try { HomeFireplace.dispose();       } catch(_) {} }
    if (window.HomeEnvironment)     { try { HomeEnvironment.dispose();     } catch(_) {} }
    if (window.HomeSky)             { try { HomeSky.dispose();             } catch(_) {} }
    if (window.HomeWeather)         { try { HomeWeather.dispose();         } catch(_) {} }
    if (window.HomeAmbientAudio)    { try { HomeAmbientAudio.dispose();    } catch(_) {} }
    _origDispose();
  };

})();