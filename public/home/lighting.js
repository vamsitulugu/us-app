// public/home/lighting.js
// ════════════════════════════════════════════════
//  Lighting — Interior lights, ambient, time-of-day
// ════════════════════════════════════════════════
const HomeLighting = (() => {

  let scene     = null;
  let lights    = {};   // named refs for tweaking

  // ── Time-of-day palettes ─────────────────────
  const TOD = {
    day: {
      ambient:    { color: 0xfff4e0, intensity: 0.55 },
      sunlight:   { color: 0xfff8f0, intensity: 2.2  },
      fill:       { color: 0xd0e8ff, intensity: 0.35 },
      exposure:   1.1
    },
    sunset: {
      ambient:    { color: 0xff8c42, intensity: 0.45 },
      sunlight:   { color: 0xff6b35, intensity: 1.6  },
      fill:       { color: 0x9b5de5, intensity: 0.25 },
      exposure:   0.95
    },
    night: {
      ambient:    { color: 0x0d1b4b, intensity: 0.30 },
      sunlight:   { color: 0x3a4a8a, intensity: 0.4  },
      fill:       { color: 0x1a237e, intensity: 0.15 },
      exposure:   0.7
    }
  };

  function init(threeScene) {
    scene = threeScene;

    // ── Hemisphere ambient (sky/ground) ─────────
    lights.hemi = new THREE.HemisphereLight(0xfff4e0, 0x4a3728, 0.55);
    scene.add(lights.hemi);

    // ── Main ambient ────────────────────────────
    lights.ambient = new THREE.AmbientLight(0xfff4e0, 0.55);
    scene.add(lights.ambient);

    // ── Directional "sun" through window ────────
    lights.sun = new THREE.DirectionalLight(0xfff8f0, 2.2);
    lights.sun.position.set(8, 12, 6);
    lights.sun.castShadow = true;
    lights.sun.shadow.mapSize.width  = 2048;
    lights.sun.shadow.mapSize.height = 2048;
    lights.sun.shadow.camera.near = 0.5;
    lights.sun.shadow.camera.far  = 50;
    lights.sun.shadow.camera.left  = -12;
    lights.sun.shadow.camera.right =  12;
    lights.sun.shadow.camera.top   =  12;
    lights.sun.shadow.camera.bottom= -12;
    lights.sun.shadow.bias = -0.0003;
    scene.add(lights.sun);
    scene.add(lights.sun.target);
    lights.sun.target.position.set(0, 0, 0);

    // ── Fill light (opposite side, soft) ────────
    lights.fill = new THREE.DirectionalLight(0xd0e8ff, 0.35);
    lights.fill.position.set(-6, 8, -4);
    scene.add(lights.fill);

    // ── Warm ceiling lamp (point light) ─────────
    lights.ceiling = new THREE.PointLight(0xffe0b0, 1.2, 18, 2);
    lights.ceiling.position.set(0, 4.2, 0);
    lights.ceiling.castShadow = true;
    lights.ceiling.shadow.mapSize.width  = 512;
    lights.ceiling.shadow.mapSize.height = 512;
    lights.ceiling.shadow.bias = -0.001;
    scene.add(lights.ceiling);

    // ── Fireplace accent (will be toggled per room) ──
    lights.fireplace = new THREE.PointLight(0xff6a1a, 0, 6, 2);
    lights.fireplace.position.set(0, 0.8, -4.5);
    scene.add(lights.fireplace);

    // ── TV screen glow (living room) ─────────────
    lights.tvGlow = new THREE.PointLight(0x4488ff, 0, 5, 2);
    lights.tvGlow.position.set(0, 2, -4.6);
    scene.add(lights.tvGlow);

    // ── Garden fill ─────────────────────────────
    lights.garden = new THREE.PointLight(0x90ee90, 0, 12, 1.5);
    lights.garden.position.set(0, 1, 0);
    scene.add(lights.garden);

    return lights;
  }

  // ── Set time of day ──────────────────────────
  function setTimeOfDay(tod, immediate = false) {
    const cfg = TOD[tod] || TOD.day;

    if (immediate) {
      lights.ambient.color.setHex(cfg.ambient.color);
      lights.ambient.intensity = cfg.ambient.intensity;
      lights.sun.color.setHex(cfg.sunlight.color);
      lights.sun.intensity = cfg.sunlight.intensity;
      lights.fill.color.setHex(cfg.fill.color);
      lights.fill.intensity = cfg.fill.intensity;
    } else {
      // Fade over ~1.5 seconds (caller runs this each frame with a lerp flag)
      _todTarget = cfg;
      _todFading = true;
    }

    if (window.HomeRenderer) HomeRenderer.setExposure(cfg.exposure);
  }

  let _todTarget = null;
  let _todFading = false;

  function update(dt) {
    if (!_todFading || !_todTarget) return;
    const a = 1 - Math.pow(0.01, dt);

    // Lerp ambient
    const ac = new THREE.Color(_todTarget.ambient.color);
    lights.ambient.color.lerp(ac, a);
    lights.ambient.intensity = HomeUtils.lerp(lights.ambient.intensity, _todTarget.ambient.intensity, a);

    // Lerp sun
    const sc = new THREE.Color(_todTarget.sunlight.color);
    lights.sun.color.lerp(sc, a);
    lights.sun.intensity = HomeUtils.lerp(lights.sun.intensity, _todTarget.sunlight.intensity, a);

    // Lerp fill
    const fc = new THREE.Color(_todTarget.fill.color);
    lights.fill.color.lerp(fc, a);
    lights.fill.intensity = HomeUtils.lerp(lights.fill.intensity, _todTarget.fill.intensity, a);

    // Check close enough to stop
    if (Math.abs(lights.ambient.intensity - _todTarget.ambient.intensity) < 0.005) {
      _todFading = false;
    }
  }

  // ── Fireplace flicker (called each frame) ────
  let _firefFlicker = 0;
  function updateFireplace(enabled, dt) {
    if (!lights.fireplace) return;
    if (!enabled) {
      lights.fireplace.intensity = HomeUtils.lerp(lights.fireplace.intensity, 0, 0.1);
      return;
    }
    _firefFlicker += dt * 8;
    const flicker = 0.85 + 0.15 * Math.sin(_firefFlicker) + 0.08 * Math.sin(_firefFlicker * 2.3 + 1.2);
    lights.fireplace.intensity = 1.6 * flicker;
  }

  // ── TV glow pulse ────────────────────────────
  let _tvPhase = 0;
  function updateTVGlow(enabled, dt) {
    if (!lights.tvGlow) return;
    if (!enabled) {
      lights.tvGlow.intensity = HomeUtils.lerp(lights.tvGlow.intensity, 0, 0.08);
      return;
    }
    _tvPhase += dt * 0.4;
    lights.tvGlow.intensity = 0.5 + 0.08 * Math.sin(_tvPhase);
  }

  // ── Room-specific light configuration ────────
  function configureForRoom(roomName) {
    const roomCeiling = {
      living:   { intensity: 1.2, color: 0xffe0b0 },
      bedroom:  { intensity: 0.7, color: 0xffd4a0 },
      kitchen:  { intensity: 1.5, color: 0xfff0d0 },
      garden:   { intensity: 0.0, color: 0xffe0b0 },
      gameroom: { intensity: 1.0, color: 0xd0c0ff },
      music:    { intensity: 0.8, color: 0xffc8a0 },
      library:  { intensity: 0.9, color: 0xfff0c8 },
      petroom:  { intensity: 1.1, color: 0xffe0b0 },
      rooftop:  { intensity: 0.0, color: 0xffe0b0 }
    };
    const cfg = roomCeiling[roomName] || roomCeiling.living;
    lights.ceiling.intensity = cfg.intensity;
    lights.ceiling.color.setHex(cfg.color);
    lights.garden.intensity = roomName === 'garden' || roomName === 'rooftop' ? 0.4 : 0;
  }

  function getAll() { return lights; }

  function dispose() {
    Object.values(lights).forEach(l => { if (l && scene) scene.remove(l); });
    lights = {};
    scene = null;
  }

  return { init, setTimeOfDay, update, updateFireplace, updateTVGlow, configureForRoom, getAll, dispose };
})();

window.HomeLighting = HomeLighting;
