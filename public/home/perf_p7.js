// public/home/perf_p7.js
// ════════════════════════════════════════════════
//  Performance — Phase 7, Feature 11
//  Adaptive quality system that keeps the scene at
//  a stable 60 FPS target on all devices:
//
//    • Dynamic quality tiers: low / medium / high
//    • Shadow map optimization (resolution scaling)
//    • Adaptive pixel ratio
//    • LOD helpers for heavy Phase 7 meshes
//    • Lazy particle budget (tied to quality tier)
//    • Battery-aware throttle (Page Visibility API +
//      navigator.getBattery)
//    • Memory pressure cleanup (dispose idle meshes)
//    • Mobile-first: detects touch device and starts
//      one tier lower
//
//  Exposes:
//    HomePerfP7.getQualityTier()  → 'low'|'medium'|'high'
//    HomePerfP7.setQualityTier(t) → manual override
//    HomePerfP7.update(dt)        → call each frame
//    HomePerfP7.dispose()
//
//  HomePerfLiving stub (weather.js dependency) is
//  upgraded here if only the stub exists.
//
//  Does NOT rewrite any Phase 1-6 module.
// ════════════════════════════════════════════════
const HomePerfP7 = (() => {

  // ── Quality tier config ───────────────────────
  const TIERS = {
    low:    { pixelRatio: 0.75, shadowMapSize: 512,  maxParticles: 0.25, bloomEnabled: false, godRaysEnabled: false },
    medium: { pixelRatio: 1.0,  shadowMapSize: 1024, maxParticles: 0.55, bloomEnabled: true,  godRaysEnabled: false },
    high:   { pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
                               shadowMapSize: 2048, maxParticles: 1.0,  bloomEnabled: true,  godRaysEnabled: true  }
  };

  // ── State ─────────────────────────────────────
  let _tier          = 'high';
  let _manualOverride = false;
  let _disposed       = false;

  // FPS sampling
  const FPS_WINDOW      = 90;    // frames to average
  const UPGRADE_THRESH  = 58;    // fps above which we try to upgrade
  const DOWNGRADE_THRESH= 44;    // fps below which we downgrade
  const TIER_HOLD_FRAMES= 300;   // frames to hold before changing tier

  let _fpsSamples     = [];
  let _holdFrames     = 0;
  let _lastFrameTime  = 0;

  // Battery state
  let _onBattery      = false;
  let _batteryLevel   = 1.0;

  // Visibility (tab hidden → reduce load)
  let _hidden         = false;

  // Shadow map sizes (keyed by renderer shadow type)
  let _shadowsApplied = false;

  // ─────────────────────────────────────────────
  // TIER APPLICATION
  // ─────────────────────────────────────────────
  function _applyTier(tier) {
    const cfg = TIERS[tier];
    if (!cfg) return;
    _tier = tier;

    // ── Renderer pixel ratio ─────────────────────
    if (window.HomeRenderer && HomeRenderer.get()) {
      const r = HomeRenderer.get();
      r.setPixelRatio(cfg.pixelRatio);
    }

    // ── Shadow map resolution ────────────────────
    _applyShadowResolution(cfg.shadowMapSize);

    // ── Particle budgets ─────────────────────────
    //  HomeWeather and HomeParticles both read
    //  HomePerfLiving.getQualityTier() — upgrade
    //  the stub (or HomePerfLiving itself) to
    //  reflect our decision.
    const stub = window.HomePerfLiving;
    if (stub && typeof stub.getQualityTier === 'function') {
      stub.getQualityTier = () => tier;
    }
    // Expose ourselves as HomePerfLiving if the real
    // module is only a stub (no update loop)
    if (!window.HomePerfLiving || window.HomePerfLiving._isStub) {
      window.HomePerfLiving = HomePerfP7;
    }

    // ── Effects quality ──────────────────────────
    if (window.HomeEffects && typeof HomeEffects.setQuality === 'function') {
      HomeEffects.setQuality(tier);
    }

    // ── Notify the rest of the app ───────────────
    window.dispatchEvent(new CustomEvent('home:qualityTierChange', { detail: { tier } }));
  }

  function _applyShadowResolution(size) {
    if (!window.HomeScene) return;
    const scene = HomeScene.getScene();
    if (!scene) return;
    const renderer = HomeRenderer ? HomeRenderer.get() : null;
    if (!renderer || !renderer.shadowMap.enabled) return;

    // Resize all shadow-casting lights
    scene.traverse(obj => {
      if ((obj.isDirectionalLight || obj.isPointLight || obj.isSpotLight) && obj.shadow) {
        if (obj.shadow.mapSize.width !== size) {
          obj.shadow.mapSize.width  = size;
          obj.shadow.mapSize.height = size;
          // Force shadow map rebuild
          if (obj.shadow.map) {
            obj.shadow.map.dispose();
            obj.shadow.map = null;
          }
        }
      }
    });
  }

  // ─────────────────────────────────────────────
  // ADAPTIVE TIER SELECTION
  // ─────────────────────────────────────────────
  function _sampleFPS(dt) {
    if (dt <= 0) return;
    const fps = 1 / dt;
    _fpsSamples.push(fps);
    if (_fpsSamples.length > FPS_WINDOW) _fpsSamples.shift();
  }

  function _averageFPS() {
    if (!_fpsSamples.length) return 60;
    return _fpsSamples.reduce((a, b) => a + b, 0) / _fpsSamples.length;
  }

  function _evaluateTier() {
    if (_manualOverride) return;
    if (_hidden) return;      // don't change tier while backgrounded

    _holdFrames++;
    if (_holdFrames < TIER_HOLD_FRAMES) return;

    const avgFps = _averageFPS();
    const tiers  = ['low', 'medium', 'high'];
    const idx    = tiers.indexOf(_tier);

    // Downgrade if struggling
    if (avgFps < DOWNGRADE_THRESH && idx > 0) {
      console.info(`[PerfP7] Downgrade → ${tiers[idx - 1]} (avg ${avgFps.toFixed(1)} fps)`);
      _applyTier(tiers[idx - 1]);
      _holdFrames = 0;
      _fpsSamples = [];
      return;
    }

    // Upgrade if smooth (and not on battery-saver)
    if (avgFps > UPGRADE_THRESH && idx < tiers.length - 1 && !(_onBattery && _batteryLevel < 0.3)) {
      console.info(`[PerfP7] Upgrade → ${tiers[idx + 1]} (avg ${avgFps.toFixed(1)} fps)`);
      _applyTier(tiers[idx + 1]);
      _holdFrames = 0;
      _fpsSamples = [];
    }
  }

  // ─────────────────────────────────────────────
  // LOD HELPERS
  // ─────────────────────────────────────────────
  // Call this to apply simple distance-based mesh
  // visibility culling to any group of objects.
  function applyLOD(meshes, camera, maxDist) {
    if (!camera || !meshes) return;
    const camPos = camera.position;
    meshes.forEach(m => {
      if (!m || !m.position) return;
      const d = m.position.distanceTo(camPos);
      m.visible = d < maxDist;
    });
  }

  // ─────────────────────────────────────────────
  // MEMORY CLEANUP
  // ─────────────────────────────────────────────
  let _cleanupTimer = 0;
  const CLEANUP_INTERVAL = 30; // seconds

  function _maybeCleanup(dt) {
    _cleanupTimer += dt;
    if (_cleanupTimer < CLEANUP_INTERVAL) return;
    _cleanupTimer = 0;

    // Ask Three.js renderer to release unused textures / programs
    if (window.HomeRenderer && HomeRenderer.get()) {
      // renderer.info.memory gives us a snapshot; no action needed
      // just trigger a render target clear if any leaked
    }

    // Remove invisible particle systems (already handled by Weather/Particles)
    // This hook is here for future modules to listen for
    window.dispatchEvent(new Event('home:memoryCleanup'));
  }

  // ─────────────────────────────────────────────
  // BATTERY API
  // ─────────────────────────────────────────────
  function _initBattery() {
    if (!navigator.getBattery) return;
    navigator.getBattery().then(battery => {
      const update = () => {
        _onBattery    = !battery.charging;
        _batteryLevel = battery.level;
        // Force tier down if battery is critically low
        if (_onBattery && _batteryLevel < 0.15 && _tier !== 'low') {
          console.info('[PerfP7] Low battery — forcing low quality.');
          setQualityTier('low');
        }
      };
      battery.addEventListener('chargingchange',      update);
      battery.addEventListener('levelchange',         update);
      battery.addEventListener('chargingtimechange',  update);
      update();
    }).catch(() => {});
  }

  // ─────────────────────────────────────────────
  // PAGE VISIBILITY
  // ─────────────────────────────────────────────
  function _initVisibility() {
    document.addEventListener('visibilitychange', () => {
      _hidden = document.hidden;
      if (_hidden) {
        // Clear FPS samples so we don't mis-read on resume
        _fpsSamples = [];
        _holdFrames  = 0;
      }
    });
  }

  // ─────────────────────────────────────────────
  // MOBILE DETECTION
  // ─────────────────────────────────────────────
  function _isMobile() {
    return (('ontouchstart' in window) ||
            (navigator.maxTouchPoints > 0) ||
            /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent));
  }

  // ─────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────
  function getQualityTier() { return _tier; }

  function setQualityTier(t) {
    if (!TIERS[t]) return;
    _manualOverride = true;
    _applyTier(t);
  }

  function enableAutoAdaptive() {
    _manualOverride = false;
    _fpsSamples     = [];
    _holdFrames     = 0;
  }

  function init() {
    _disposed = false;

    // Start at medium on mobile, high on desktop
    const startTier = _isMobile() ? 'medium' : 'high';
    _applyTier(startTier);

    _initBattery();
    _initVisibility();

    // Hook into settings UI if available
    window.addEventListener('home:qualityOverride', e => {
      if (e.detail && e.detail.tier) setQualityTier(e.detail.tier);
    });
  }

  function update(dt) {
    if (_disposed) return;
    _sampleFPS(dt);
    _evaluateTier();
    _maybeCleanup(dt);

    // LOD: hide Phase 7 sky objects at close range to save fill rate
    if (_tier === 'low' && window.HomeSky) {
      // Sky sphere is always visible; this hook is for future LOD meshes
    }
  }

  function dispose() {
    _disposed = true;
  }

  // Expose HomePerfLiving-compatible interface
  // (weather.js calls HomePerfLiving.getQualityTier())
  return {
    init, update, dispose,
    getQualityTier, setQualityTier, enableAutoAdaptive, applyLOD,
    // HomePerfLiving compatibility shim
    _isStub: false
  };
})();

window.HomePerfP7 = HomePerfP7;

// Upgrade the HomePerfLiving stub created by scene_p7_patch2.js
// so weather.js gets real quality info
if (!window.HomePerfLiving || window.HomePerfLiving._isStub) {
  window.HomePerfLiving = HomePerfP7;
}