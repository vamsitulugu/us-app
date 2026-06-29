// public/home/window_system.js
// ════════════════════════════════════════════════
//  Window System — Phase 7, Feature 4
//  Each window shows: current weather, sky colour,
//  rain streaks on glass, snow accumulation,
//  condensation, sunlight / moonlight shafts,
//  lightning flashes. Integrates with HomeWeather,
//  HomeSky, HomeEnvironment.
//  NEW MODULE — does NOT rewrite any Phase 1-6 file.
// ════════════════════════════════════════════════
const HomeWindowSystem = (() => {

  let scene = null;

  // ── Window definitions — matched to environment.js ──
  const WINDOW_DEFS = [
    { name: 'front_left',  pos: new THREE.Vector3(-3.0, 2.2, -4.85), normal: new THREE.Vector3(0, 0, 1), w: 1.8, h: 2.2 },
    { name: 'front_right', pos: new THREE.Vector3( 3.0, 2.2, -4.85), normal: new THREE.Vector3(0, 0, 1), w: 1.8, h: 2.2 },
    { name: 'side_left',   pos: new THREE.Vector3(-4.85, 2.2,  0.0), normal: new THREE.Vector3(1, 0, 0), w: 1.8, h: 2.2 },
    { name: 'bedroom_win', pos: new THREE.Vector3( 0.0,  2.2, -4.85), normal: new THREE.Vector3(0, 0, 1), w: 1.4, h: 1.8 }
  ];

  // Each window object holds visual layers
  let _windows = [];

  // ── Shared materials ──────────────────────────
  let _glassMat       = null;
  let _rainDropMat    = null;
  let _snowMat        = null;
  let _skyGlowMat     = null;
  let _condenseMat    = null;

  // ── State ─────────────────────────────────────
  let _weatherKey     = 'clear';
  let _lightningTimer = 0;

  // ── Rain drop state (per window) ──────────────
  // We simulate rain streaks on the glass as Points
  const RAIN_DROPS    = 80;

  // ─────────────────────────────────────────────
  // BUILD
  // ─────────────────────────────────────────────
  function _buildWindows() {
    WINDOW_DEFS.forEach(def => {
      const win = { def, layers: {} };

      // ── Glass pane (slightly tinted) ──────────
      _glassMat = new THREE.MeshStandardMaterial({
        color: 0x88bbdd,
        transparent: true,
        opacity: 0.18,
        roughness: 0.05,
        metalness: 0.1,
        envMapIntensity: 1.4,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const glassGeo = new THREE.PlaneGeometry(def.w, def.h);
      win.layers.glass = new THREE.Mesh(glassGeo, _glassMat.clone());
      _orientWindow(win.layers.glass, def);
      scene.add(win.layers.glass);

      // ── Sky-colour tint overlay (shows exterior sky colour) ──
      const skyGeo = new THREE.PlaneGeometry(def.w, def.h);
      win.layers.sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({
        color: 0x87ceeb,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: THREE.DoubleSide
      }));
      _orientWindow(win.layers.sky, def);
      win.layers.sky.position.add(def.normal.clone().multiplyScalar(0.01));
      scene.add(win.layers.sky);

      // ── Rain streaks on glass ─────────────────
      const rainPos = new Float32Array(RAIN_DROPS * 3);
      const rainVel = new Float32Array(RAIN_DROPS * 2);  // x, y velocity
      for (let i = 0; i < RAIN_DROPS; i++) {
        rainPos[i*3]   = (Math.random() - 0.5) * def.w;
        rainPos[i*3+1] = (Math.random() - 0.5) * def.h;
        rainPos[i*3+2] = 0;
        rainVel[i*2]   = (Math.random() - 0.5) * 0.05;
        rainVel[i*2+1] = -(0.4 + Math.random() * 0.8);
      }
      const rainGeo = new THREE.BufferGeometry();
      rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
      const rainMat = new THREE.PointsMaterial({
        color: 0xaaccee,
        size: 0.04,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        sizeAttenuation: true
      });
      const rainPoints = new THREE.Points(rainGeo, rainMat);
      // Place in window local space then orient
      win.layers.rain = rainPoints;
      win.layers._rainPos = rainPos;
      win.layers._rainVel = rainVel;
      _orientWindow(rainPoints, def);
      rainPoints.position.add(def.normal.clone().multiplyScalar(0.02));
      scene.add(rainPoints);

      // ── Snow accumulation (white tint at bottom) ──
      const snowGeo = new THREE.PlaneGeometry(def.w, def.h * 0.25);
      win.layers.snow = new THREE.Mesh(snowGeo, new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide
      }));
      win.layers.snow.position.copy(def.pos).add(
        new THREE.Vector3(0, -(def.h * 0.375), 0)
      ).add(def.normal.clone().multiplyScalar(0.03));
      _setWindowRotation(win.layers.snow, def);
      scene.add(win.layers.snow);

      // ── Condensation (foggy glass overlay) ───
      const condGeo = new THREE.PlaneGeometry(def.w, def.h);
      win.layers.condensation = new THREE.Mesh(condGeo, new THREE.MeshBasicMaterial({
        color: 0xddeeff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide
      }));
      _orientWindow(win.layers.condensation, def);
      win.layers.condensation.position.add(def.normal.clone().multiplyScalar(0.04));
      scene.add(win.layers.condensation);

      // ── Light shaft (sun / moon god ray) ─────
      const shaftGeo = new THREE.CylinderGeometry(0.05, def.w * 0.4, 6, 6, 1, true);
      win.layers.shaft = new THREE.Mesh(shaftGeo, new THREE.MeshBasicMaterial({
        color: 0xfff8e0,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false
      }));
      win.layers.shaft.position.copy(def.pos).add(
        def.normal.clone().multiplyScalar(2.5).negate()
      );
      win.layers.shaft.position.y -= 0.5;
      // Tilt shaft inward
      if (Math.abs(def.normal.z) > 0.5) {
        win.layers.shaft.rotation.set(0, 0, def.normal.z > 0 ? -0.15 : 0.15);
      } else {
        win.layers.shaft.rotation.set(0, Math.PI * 0.5, def.normal.x > 0 ? -0.15 : 0.15);
      }
      scene.add(win.layers.shaft);

      // ── Lightning flash overlay ────────────────
      const flashGeo = new THREE.PlaneGeometry(def.w, def.h);
      win.layers.flash = new THREE.Mesh(flashGeo, new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide
      }));
      _orientWindow(win.layers.flash, def);
      win.layers.flash.position.add(def.normal.clone().multiplyScalar(0.05));
      scene.add(win.layers.flash);

      _windows.push(win);
    });
  }

  function _orientWindow(mesh, def) {
    mesh.position.copy(def.pos);
    _setWindowRotation(mesh, def);
  }

  function _setWindowRotation(mesh, def) {
    if (Math.abs(def.normal.z) > 0.5) {
      mesh.rotation.set(0, 0, 0);
    } else {
      mesh.rotation.set(0, Math.PI * 0.5, 0);
    }
  }

  // ─────────────────────────────────────────────
  // UPDATE
  // ─────────────────────────────────────────────
  function _updateRainDrops(win, dt) {
    const pos = win.layers._rainPos;
    const vel = win.layers._rainVel;
    const def = win.def;
    const halfW = def.w * 0.5;
    const halfH = def.h * 0.5;

    for (let i = 0; i < RAIN_DROPS; i++) {
      pos[i*3]   += vel[i*2]   * dt;
      pos[i*3+1] += vel[i*2+1] * dt;

      // Wrap around
      if (pos[i*3+1] < -halfH) {
        pos[i*3]   = (Math.random() - 0.5) * def.w;
        pos[i*3+1] = halfH;
      }
      if (Math.abs(pos[i*3]) > halfW) {
        pos[i*3] = (Math.random() - 0.5) * def.w;
      }
    }
    win.layers.rain.geometry.attributes.position.needsUpdate = true;
  }

  function update(dt) {
    _weatherKey = window.HomeWeather ? HomeWeather.getCurrent() : 'clear';
    const weather = window.HomeWeather ? HomeWeather.getDefinition(_weatherKey) : null;
    const wetness = window.HomeWeather ? HomeWeather.getWetness() : 0;
    const skyTime = window.HomeSky ? HomeSky.getTime() : 0.5;

    // Compute sky colour from time for the tint overlay
    const nightBlend = skyTime < 0.25 || skyTime > 0.85
      ? 1 - Math.min(Math.abs(skyTime - 0.0), Math.abs(skyTime - 1.0), Math.abs(skyTime - 0.5)) * 5
      : 0;
    const skyColor = new THREE.Color().setHSL(
      0.55,
      0.6 - nightBlend * 0.5,
      0.3 + (1 - nightBlend) * 0.45
    );

    // Rain target opacity
    const isRaining = ['rain', 'heavyrain', 'drizzle', 'thunderstorm'].includes(_weatherKey);
    const isSnowing = _weatherKey === 'snow';
    const isFoggy   = _weatherKey === 'fog';

    // Light shaft: visible during sunny/morning/afternoon
    const shaftIntensity = (_weatherKey === 'clear' || _weatherKey === 'cloudy')
      ? Math.max(0, Math.sin(skyTime * Math.PI)) * 0.12
      : 0;

    // Lightning flash decay
    if (_lightningTimer > 0) _lightningTimer -= dt;

    _windows.forEach(win => {
      // Sky overlay
      win.layers.sky.material.color.copy(skyColor);
      win.layers.sky.material.opacity = 0.15 + nightBlend * 0.08;

      // Rain on glass
      const rainTarget = isRaining ? (wetness * 0.75) : 0;
      win.layers.rain.material.opacity = HomeUtils.lerp(win.layers.rain.material.opacity, rainTarget, dt * 1.5);
      if (isRaining) _updateRainDrops(win, dt);

      // Snow accumulation at bottom
      win.layers.snow.material.opacity = HomeUtils.lerp(
        win.layers.snow.material.opacity, isSnowing ? 0.55 : 0, dt * 0.5
      );

      // Condensation: fog + rain + temperature diff
      const condTarget = isFoggy ? 0.28 : isRaining ? wetness * 0.18 : 0;
      win.layers.condensation.material.opacity = HomeUtils.lerp(
        win.layers.condensation.material.opacity, condTarget, dt * 0.8
      );

      // Light shaft
      win.layers.shaft.material.opacity = HomeUtils.lerp(
        win.layers.shaft.material.opacity, shaftIntensity, dt * 1.5
      );

      // Lightning flash
      const flashTarget = _lightningTimer > 0 ? Math.min(1, _lightningTimer * 8) * 0.85 : 0;
      win.layers.flash.material.opacity = HomeUtils.lerp(
        win.layers.flash.material.opacity, flashTarget, dt * 20
      );
    });
  }

  // ─────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────
  function triggerLightningFlash(intensity = 1.0) {
    _lightningTimer = 0.14 * intensity;
  }

  function init(threeScene) {
    scene = threeScene;
    _buildWindows();

    // Listen for lightning from HomeWeather
    window.addEventListener('home:lightning', e => {
      triggerLightningFlash(e.detail ? e.detail.intensity : 1.0);
    });

    // Listen for weather changes
    window.addEventListener('home:weatherChange', e => {
      _weatherKey = e.detail.weather;
    });
  }

  function dispose() {
    _windows.forEach(win => {
      Object.values(win.layers).forEach(layer => {
        if (layer && layer.isObject3D) {
          scene.remove(layer);
          layer.geometry && layer.geometry.dispose();
          layer.material && layer.material.dispose();
        }
      });
    });
    _windows = [];
  }

  return { init, update, dispose, triggerLightningFlash };
})();

window.HomeWindowSystem = HomeWindowSystem;