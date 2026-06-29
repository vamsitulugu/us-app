// public/home/effects.js
// ════════════════════════════════════════════════
//  Effects — Phase 7, Feature 9
//  Post-processing & visual effects:
//    • Bloom / glow (CSS canvas filter — no EffectComposer dep)
//    • Volumetric light shafts (geometry-based god rays)
//    • Lens flare (sprite-based)
//    • Screen rain (canvas 2D overlay)
//    • Fog transitions (scene.fog lerp)
//    • Adaptive post-processing (quality tiers)
//    • Sun corona glow
//    • Night vignette
//
//  Architecture:
//    - No external postprocessing library required.
//    - Uses a 2D <canvas> overlay for screen-space rain
//      and CSS filter on the WebGL canvas for bloom.
//    - Geometry-based effects go directly in the THREE scene.
//    - Hooks into scene_p7_patch.js update loop.
//    - Does NOT rewrite any Phase 1–6 module.
// ════════════════════════════════════════════════
const HomeEffects = (() => {

  let _scene    = null;
  let _renderer = null;
  let _camera   = null;

  // ── Quality tier ──────────────────────────────
  // 'low' | 'medium' | 'high'
  let _quality  = 'high';

  // ── CSS bloom state ───────────────────────────
  let _bloomTarget   = 0;
  let _bloomCurrent  = 0;
  let _canvasEl      = null;

  // ── Screen rain overlay ───────────────────────
  let _rainCanvas  = null;
  let _rainCtx     = null;
  let _rainDrops   = [];
  let _rainTarget  = 0;  // 0–1 opacity target
  let _rainOpacity = 0;
  const SCREEN_RAIN_COUNT = 120;

  // ── Lens flare ────────────────────────────────
  let _flareMesh    = null;
  let _flareSprites = [];
  let _flarePhase   = 0;

  // ── God ray geometry (volumetric shafts) ─────
  let _godRayGroup  = null;
  let _godRayTime   = 0;

  // ── Vignette overlay (DOM div) ───────────────
  let _vignetteDom  = null;
  let _vigTarget    = 0;
  let _vigCurrent   = 0;

  // ── Sun corona ────────────────────────────────
  let _coronaMesh   = null;
  let _coronaPhase  = 0;

  // ── Fog lerp state ───────────────────────────
  // Handled by HomeWeather already; we add a
  // secondary "interior warm fog" effect.
  let _interiorFogTarget  = 0;
  let _interiorFogCurrent = 0;

  // ─────────────────────────────────────────────
  // QUALITY DETECTION
  // ─────────────────────────────────────────────
  function _detectQuality() {
    if (window.HomePerfLiving && HomePerfLiving.getQualityTier) {
      _quality = HomePerfLiving.getQualityTier();
    } else {
      // Fallback: probe GPU via canvas
      try {
        const gl = document.createElement('canvas').getContext('webgl');
        const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
        const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
        _quality = /Mali-4|Adreno 3|PowerVR|Intel HD 3/.test(renderer) ? 'low' : 'high';
      } catch (_) { _quality = 'medium'; }
    }
  }

  // ─────────────────────────────────────────────
  // BLOOM (CSS filter on WebGL canvas)
  // ─────────────────────────────────────────────
  function _initBloom() {
    _canvasEl = document.getElementById('homeCanvas');
    if (!_canvasEl) {
      // Find any canvas
      _canvasEl = document.querySelector('canvas');
    }
    if (!_canvasEl) return;
    // Store original filter so we can restore
    _canvasEl._origFilter = _canvasEl.style.filter || '';
  }

  function _updateBloom(dt) {
    if (!_canvasEl || _quality === 'low') return;

    // Bloom sources: fireplace, candles, sun (morning/golden), lightning
    const skyTime    = window.HomeSky     ? HomeSky.getTime()     : 0.5;
    const weather    = window.HomeWeather ? HomeWeather.getCurrent() : 'clear';
    const fireplaceOn = window.HomeEnvironment ? HomeEnvironment.getState().fireplace : false;

    // Sun bloom peaks at golden hour and noon
    const isSunny = ['clear', 'cloudy'].includes(weather);
    const sunBloom = isSunny ? Math.max(0, Math.sin(skyTime * Math.PI)) * 0.55 : 0;

    // Fireplace bloom
    const fireBloom = fireplaceOn ? 0.4 : 0;

    // Lightning flash bloom
    const ltBloom = _lightningFlash > 0 ? _lightningFlash * 1.8 : 0;

    _bloomTarget = Math.min(1.2, sunBloom + fireBloom + ltBloom);
    _bloomCurrent = HomeUtils.lerp(_bloomCurrent, _bloomTarget, dt * 3);

    if (_bloomCurrent < 0.01) {
      _canvasEl.style.filter = _canvasEl._origFilter;
      return;
    }

    const blur    = (_bloomCurrent * 2.5).toFixed(2);
    const bright  = (1 + _bloomCurrent * 0.18).toFixed(3);
    const saturate = (1 + _bloomCurrent * 0.22).toFixed(3);
    _canvasEl.style.filter =
      `brightness(${bright}) saturate(${saturate}) drop-shadow(0 0 ${blur}px rgba(255,220,120,${(_bloomCurrent * 0.45).toFixed(2)}))`;
  }

  // Lightning flash passthrough from HomeWeather
  let _lightningFlash = 0;

  // ─────────────────────────────────────────────
  // SCREEN RAIN OVERLAY
  // ─────────────────────────────────────────────
  function _initScreenRain() {
    _rainCanvas = document.createElement('canvas');
    _rainCanvas.style.cssText = `
      position:fixed;inset:0;width:100%;height:100%;
      pointer-events:none;z-index:5;opacity:0;
      transition:opacity 1.2s ease;
    `;
    _rainCanvas.id = 'homeScreenRain';
    document.body.appendChild(_rainCanvas);
    _rainCtx = _rainCanvas.getContext('2d');
    _resizeRainCanvas();
    window.addEventListener('resize', _resizeRainCanvas);

    // Init drops
    for (let i = 0; i < SCREEN_RAIN_COUNT; i++) {
      _rainDrops.push(_newDrop(true));
    }
  }

  function _resizeRainCanvas() {
    if (!_rainCanvas) return;
    _rainCanvas.width  = window.innerWidth;
    _rainCanvas.height = window.innerHeight;
  }

  function _newDrop(rand = false) {
    return {
      x:     Math.random() * window.innerWidth,
      y:     rand ? Math.random() * window.innerHeight : -20,
      len:   Math.random() * 18 + 10,
      speed: Math.random() * 8 + 6,
      width: Math.random() * 1.2 + 0.3,
      alpha: Math.random() * 0.35 + 0.08
    };
  }

  function _updateScreenRain(dt) {
    if (!_rainCtx) return;

    const weather = window.HomeWeather ? HomeWeather.getCurrent() : 'clear';
    const wetness = window.HomeWeather ? HomeWeather.getWetness() : 0;
    const isRaining = ['rain', 'heavyrain', 'drizzle', 'thunderstorm'].includes(weather);

    // Only show screen rain for heavy conditions
    const heavyRain = ['heavyrain', 'thunderstorm'].includes(weather);
    _rainTarget  = heavyRain ? Math.min(0.55, wetness * 0.6) : 0;
    _rainOpacity = HomeUtils.lerp(_rainOpacity, _rainTarget, dt * 1.2);

    if (_rainCanvas) _rainCanvas.style.opacity = _rainOpacity.toFixed(3);
    if (_rainOpacity < 0.01) return;

    const ctx = _rainCtx;
    ctx.clearRect(0, 0, _rainCanvas.width, _rainCanvas.height);

    // Wind tilt
    const wind = window.HomeWeather ? (HomeWeather.getDefinition(weather)?.wind || 0) : 0;
    const tiltX = wind * 3.5 * dt;

    _rainDrops.forEach(d => {
      d.y += d.speed * (1 + wind * 0.5);
      d.x += tiltX * d.speed * 0.8;

      if (d.y > _rainCanvas.height + 30 || d.x > _rainCanvas.width + 30) {
        Object.assign(d, _newDrop());
      }

      ctx.strokeStyle = `rgba(180,210,240,${d.alpha})`;
      ctx.lineWidth   = d.width;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x + tiltX * d.len * 0.6, d.y + d.len);
      ctx.stroke();
    });
  }

  // ─────────────────────────────────────────────
  // LENS FLARE
  // ─────────────────────────────────────────────
  function _initLensFlare() {
    if (_quality === 'low') return;

    _godRayGroup = new THREE.Group();
    _godRayGroup.name = 'lensFlares';
    _scene.add(_godRayGroup);

    // Flare sprites: centre disc + halos at varying distances along view axis
    const flareConfigs = [
      { scale: 2.2, color: 0xfff8e0, opacity: 0.55 },  // main disc
      { scale: 0.6, color: 0xffd090, opacity: 0.30 },   // inner ring
      { scale: 1.1, color: 0xffffff, opacity: 0.18 },   // mid ring
      { scale: 0.4, color: 0x80c0ff, opacity: 0.22 },   // chromatic fringe
      { scale: 0.9, color: 0xff8040, opacity: 0.14 }    // warm streak
    ];

    flareConfigs.forEach(cfg => {
      const geo = new THREE.PlaneGeometry(1, 1);
      const mat = new THREE.MeshBasicMaterial({
        color: cfg.color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 999;
      mesh.frustumCulled = false;
      _godRayGroup.add(mesh);
      _flareSprites.push({ mesh, cfg, pos: new THREE.Vector3() });
    });
  }

  function _updateLensFlare(dt) {
    if (!_godRayGroup || !_camera || _quality === 'low') return;

    const weather = window.HomeWeather ? HomeWeather.getCurrent() : 'clear';
    const skyTime = window.HomeSky ? HomeSky.getTime() : 0.5;

    // Flare only when sun is visible & sky clear
    const isSunVisible = skyTime > 0.22 && skyTime < 0.82 && ['clear', 'cloudy'].includes(weather);
    const sunIntensity = isSunVisible ? Math.sin((skyTime - 0.22) / 0.60 * Math.PI) : 0;

    _flarePhase += dt * 2.1;

    if (!isSunVisible || sunIntensity < 0.05) {
      _flareSprites.forEach(f => {
        f.mesh.material.opacity = HomeUtils.lerp(f.mesh.material.opacity, 0, dt * 3);
      });
      return;
    }

    // Sun world position (mirrors sky.js sun arc)
    const sunAngle = (skyTime - 0.25) * Math.PI * 2;
    const sunPos = new THREE.Vector3(
      Math.cos(sunAngle) * 55,
      Math.sin(sunAngle) * 55,
      -20
    );

    // Project sun to NDC
    const sunNDC = sunPos.clone().project(_camera);
    if (sunNDC.z > 1) {
      // Behind camera — hide
      _flareSprites.forEach(f => {
        f.mesh.material.opacity = HomeUtils.lerp(f.mesh.material.opacity, 0, dt * 4);
      });
      return;
    }

    // Screen-space position of sun
    const hw = window.innerWidth  * 0.5;
    const hh = window.innerHeight * 0.5;
    const sunScreen = new THREE.Vector2(sunNDC.x * hw + hw, -sunNDC.y * hh + hh);

    // Flares spread along the line from sun to screen centre
    const centre = new THREE.Vector2(hw, hh);
    const dir    = centre.clone().sub(sunScreen);

    // Spawn flares at different distances along dir
    const offsets = [0, 0.2, 0.45, 0.7, 1.1];
    _flareSprites.forEach((f, idx) => {
      const t    = offsets[idx] || 0;
      const sp   = sunScreen.clone().add(dir.clone().multiplyScalar(t));

      // Convert back to world-space billboard position in front of camera
      const ndcX = (sp.x / window.innerWidth)  * 2 - 1;
      const ndcY = -(sp.y / window.innerHeight) * 2 + 1;
      const worldPos = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(_camera);

      f.mesh.position.copy(worldPos);
      f.mesh.lookAt(_camera.position);
      const s = f.cfg.scale * (0.9 + 0.1 * Math.sin(_flarePhase + idx));
      f.mesh.scale.setScalar(s);

      const targetOp = f.cfg.opacity * sunIntensity * (0.8 + 0.2 * Math.random());
      f.mesh.material.opacity = HomeUtils.lerp(f.mesh.material.opacity, targetOp, dt * 3);
    });
  }

  // ─────────────────────────────────────────────
  // GOD RAYS (Volumetric light shafts through windows)
  // ─────────────────────────────────────────────
  let _godRays = [];
  const GOD_RAY_DEFS = [
    { pos: new THREE.Vector3(-3.0, 2.2, -4.8), dir: new THREE.Vector3( 0.2, -1, 0.4) },
    { pos: new THREE.Vector3( 3.0, 2.2, -4.8), dir: new THREE.Vector3(-0.2, -1, 0.4) },
    { pos: new THREE.Vector3(-4.8, 2.2,  0.0), dir: new THREE.Vector3( 0.5, -1, 0.2) }
  ];

  function _initGodRays() {
    if (_quality === 'low') return;

    GOD_RAY_DEFS.forEach(def => {
      // Tapered cone pointing inward
      const geo = new THREE.CylinderGeometry(0.04, 1.6, 5.5, 6, 1, true);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xfff8e0,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false
      });
      const mesh = new THREE.Mesh(geo, mat);

      // Orient along def.dir
      mesh.position.copy(def.pos).add(def.dir.clone().multiplyScalar(2.8));
      const up    = new THREE.Vector3(0, 1, 0);
      const quat  = new THREE.Quaternion().setFromUnitVectors(up, def.dir.clone().normalize());
      mesh.setRotationFromQuaternion(quat);
      mesh.renderOrder = 8;
      _scene.add(mesh);
      _godRays.push({ mesh, def });
    });
  }

  function _updateGodRays(dt) {
    if (_godRays.length === 0) return;

    const skyTime = window.HomeSky    ? HomeSky.getTime()       : 0.5;
    const weather = window.HomeWeather? HomeWeather.getCurrent() : 'clear';
    const curtains = window.HomeEnvironment ? HomeEnvironment.getState().curtains : 'closed';

    const isClear   = ['clear', 'cloudy'].includes(weather);
    const isOpen    = curtains !== 'closed';
    const sunHeight = Math.max(0, Math.sin((skyTime - 0.25) * Math.PI * 2));
    const baseInt   = isClear && isOpen ? sunHeight * 0.09 : 0;

    _godRayTime += dt;
    _godRays.forEach((r, i) => {
      const flicker = 1 + 0.08 * Math.sin(_godRayTime * 1.3 + i * 2.1);
      const target  = baseInt * flicker;
      r.mesh.material.opacity = HomeUtils.lerp(r.mesh.material.opacity, target, dt * 1.8);
    });
  }

  // ─────────────────────────────────────────────
  // SUN CORONA GLOW (billboard halo around sun mesh)
  // ─────────────────────────────────────────────
  function _initCorona() {
    if (_quality === 'low') return;

    const geo = new THREE.PlaneGeometry(12, 12);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xfff4a0,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide
    });
    _coronaMesh = new THREE.Mesh(geo, mat);
    _coronaMesh.renderOrder = -52;
    _scene.add(_coronaMesh);
  }

  function _updateCorona(dt) {
    if (!_coronaMesh) return;

    const skyTime = window.HomeSky ? HomeSky.getTime() : 0.5;
    const weather = window.HomeWeather ? HomeWeather.getCurrent() : 'clear';

    const sunAngle = (skyTime - 0.25) * Math.PI * 2;
    const sx = Math.cos(sunAngle) * 55;
    const sy = Math.sin(sunAngle) * 55;

    _coronaMesh.position.set(sx, sy, -20);
    if (_camera) _coronaMesh.lookAt(_camera.position);

    _coronaPhase += dt * 0.9;
    const pulse    = 1 + 0.06 * Math.sin(_coronaPhase);
    const isSun    = sy > -3 && ['clear', 'cloudy'].includes(weather);
    const sunI     = isSun ? Math.max(0, Math.sin((skyTime - 0.22) / 0.60 * Math.PI)) : 0;
    const target   = sunI * 0.22 * pulse;

    _coronaMesh.material.opacity = HomeUtils.lerp(_coronaMesh.material.opacity, target, dt * 2.5);
    _coronaMesh.scale.setScalar(pulse);
  }

  // ─────────────────────────────────────────────
  // VIGNETTE
  // ─────────────────────────────────────────────
  function _initVignette() {
    _vignetteDom = document.createElement('div');
    _vignetteDom.id = 'homeVignette';
    _vignetteDom.style.cssText = `
      position:fixed;inset:0;pointer-events:none;z-index:4;
      background: radial-gradient(ellipse at center,
        transparent 40%,
        rgba(0,0,8,0) 55%,
        rgba(0,0,8,0.55) 100%);
      opacity:0;transition:opacity 0.8s ease;
    `;
    document.body.appendChild(_vignetteDom);
  }

  function _updateVignette(dt) {
    if (!_vignetteDom) return;

    const skyTime = window.HomeSky ? HomeSky.getTime() : 0.5;
    const isNight = skyTime < 0.27 || skyTime > 0.85;
    const weather = window.HomeWeather ? HomeWeather.getCurrent() : 'clear';
    const isStorm = weather === 'thunderstorm' || weather === 'heavyrain';

    _vigTarget  = isNight ? 0.72 : isStorm ? 0.50 : 0.20;
    _vigCurrent = HomeUtils.lerp(_vigCurrent, _vigTarget, dt * 1.4);
    _vignetteDom.style.opacity = _vigCurrent.toFixed(3);
  }

  // ─────────────────────────────────────────────
  // FOG TRANSITION (interior warm fog at night)
  // ─────────────────────────────────────────────
  function _updateInteriorFog(dt) {
    if (!_scene || !_scene.fog) return;
    const fireplaceOn = window.HomeEnvironment ? HomeEnvironment.getState().fireplace : false;
    const candlesOn   = window.HomeEnvironment ? HomeEnvironment.getState().candles : true;

    // Warm the fog colour slightly when fireplace is on
    if (fireplaceOn) {
      _scene.fog.color.lerp(new THREE.Color(0x3a1a08), dt * 0.4);
    } else if (candlesOn) {
      _scene.fog.color.lerp(new THREE.Color(0x100808), dt * 0.2);
    }
  }

  // ─────────────────────────────────────────────
  // ADAPTIVE QUALITY
  // ─────────────────────────────────────────────
  let _fpsHistory   = [];
  let _fpsCheckTime = 0;

  function _adaptQuality(dt) {
    _fpsCheckTime += dt;
    if (_fpsCheckTime < 5) return; // check every 5 s
    _fpsCheckTime = 0;

    const fps = window.HomeScene ? HomeScene.getPerf().fps : 60;
    _fpsHistory.push(fps);
    if (_fpsHistory.length > 6) _fpsHistory.shift();

    const avg = _fpsHistory.reduce((s, v) => s + v, 0) / _fpsHistory.length;
    if (avg < 28 && _quality !== 'low') {
      _quality = avg < 18 ? 'low' : 'medium';
      _applyQuality();
    } else if (avg > 55 && _quality === 'medium') {
      _quality = 'high';
      _applyQuality();
    }
  }

  function _applyQuality() {
    // Screen rain particle count
    if (_rainDrops.length > 0) {
      const target = _quality === 'low' ? 40 : _quality === 'medium' ? 80 : SCREEN_RAIN_COUNT;
      while (_rainDrops.length > target) _rainDrops.pop();
      while (_rainDrops.length < target) _rainDrops.push(_newDrop(true));
    }

    // God rays visibility
    _godRays.forEach(r => {
      r.mesh.visible = _quality !== 'low';
    });

    // Flares visibility
    _flareSprites.forEach(f => {
      f.mesh.visible = _quality !== 'low';
    });

    // Corona visibility
    if (_coronaMesh) _coronaMesh.visible = _quality !== 'low';
  }

  // ─────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────
  function init(threeScene, webglRenderer, threeCamera) {
    _scene    = threeScene;
    _renderer = webglRenderer;
    _camera   = threeCamera;

    _detectQuality();
    _initBloom();
    _initScreenRain();
    _initLensFlare();
    _initGodRays();
    _initCorona();
    _initVignette();

    // Lightning → bloom spike
    window.addEventListener('home:lightning', e => {
      _lightningFlash = (e.detail ? e.detail.intensity : 1.0) * 0.9;
    });

    // Weather change → reset rain overlay
    window.addEventListener('home:weatherChange', () => {
      _rainTarget = 0;
    });
  }

  function update(dt) {
    if (!_scene) return;

    // Decay lightning flash
    if (_lightningFlash > 0) _lightningFlash = Math.max(0, _lightningFlash - dt * 4);

    _updateBloom(dt);
    _updateScreenRain(dt);
    _updateLensFlare(dt);
    _updateGodRays(dt);
    _updateCorona(dt);
    _updateVignette(dt);
    _updateInteriorFog(dt);
    _adaptQuality(dt);
  }

  function dispose() {
    // Remove DOM elements
    if (_rainCanvas)  { _rainCanvas.remove();  _rainCanvas = null;  }
    if (_vignetteDom) { _vignetteDom.remove();  _vignetteDom = null; }

    // Restore canvas filter
    if (_canvasEl) { _canvasEl.style.filter = _canvasEl._origFilter || ''; _canvasEl = null; }

    // Remove Three.js objects
    _flareSprites.forEach(f => {
      _scene && _scene.remove(f.mesh);
      f.mesh.geometry.dispose();
      f.mesh.material.dispose();
    });
    _flareSprites = [];

    _godRays.forEach(r => {
      _scene && _scene.remove(r.mesh);
      r.mesh.geometry.dispose();
      r.mesh.material.dispose();
    });
    _godRays = [];

    if (_godRayGroup) { _scene && _scene.remove(_godRayGroup); _godRayGroup = null; }
    if (_coronaMesh)  { _scene && _scene.remove(_coronaMesh);
      _coronaMesh.geometry.dispose(); _coronaMesh.material.dispose(); _coronaMesh = null;
    }

    window.removeEventListener('resize', _resizeRainCanvas);
    _scene = _renderer = _camera = null;
  }

  function setQuality(tier) {
    _quality = tier;
    _applyQuality();
  }

  return { init, update, dispose, setQuality };
})();

window.HomeEffects = HomeEffects;