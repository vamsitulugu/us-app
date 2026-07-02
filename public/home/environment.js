// public/home/environment.js
// ════════════════════════════════════════════════
//  Environment — Phase 7, Features 5 & 7
//  Interactive toggles: curtains, windows, lights,
//  fireplace, TV. Indoor atmosphere: floor reflection,
//  candles, lamp glow, dust motes, smoke.
//  NEW MODULE — patches HomeLighting/HomeScene via
//  events only. Does NOT rewrite any Phase 1–6 file.
// ════════════════════════════════════════════════
const HomeEnvironment = (() => {

  let scene = null;

  // ── State ──────────────────────────────────────
  const state = {
    fireplace:       false,
    tv:              false,
    curtains:        'closed',   // 'open' | 'closed' | 'half'
    windows:         {},         // roomName -> bool (open)
    lights:          {},         // roomName -> bool
    candles:         true,
    lamps:           true
  };

  // ── Curtain meshes ──────────────────────────────
  // Simple plane-pairs that slide on toggle. Position
  // them in front of each window's world-space location.
  const WINDOW_POSITIONS = [
    { name: 'front_left',  pos: new THREE.Vector3(-3.0, 2.2, -4.9), room: 'living'  },
    { name: 'front_right', pos: new THREE.Vector3( 3.0, 2.2, -4.9), room: 'living'  },
    { name: 'side_left',   pos: new THREE.Vector3(-4.9, 2.2,  0.0), room: 'living'  },
    { name: 'bedroom_win', pos: new THREE.Vector3( 0.0, 2.2, -4.9), room: 'bedroom' }
  ];
  let _curtainMeshes = [];   // { left, right, openX, closedX, name }

  // ── Candle meshes + point lights ────────────────
  let _candles = [];  // { mesh, flame, light, flicker }
  const CANDLE_POSITIONS = [
    new THREE.Vector3(-1.8,  0.95,  1.5),
    new THREE.Vector3( 1.8,  0.95,  1.5),
    new THREE.Vector3( 0.0,  0.95, -1.8)
  ];

  // ── Floor reflection plane ──────────────────────
  let _reflectionPlane = null;

  // ── Dust mote particle system ───────────────────
  let _dustSystem = null;
  let _dustPositions = null;
  let _dustPhase = 0;

  // ── Smoke (fireplace) ────────────────────────────
  let _smokeSystem = null;
  let _smokePositions = null;
  let _smokePhase = 0;

  // ─────────────────────────────────────────────────
  // BUILD CURTAINS
  // ─────────────────────────────────────────────────
  function _buildCurtains() {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xf5e6d3,
      roughness: 0.9, metalness: 0,
      transparent: true, opacity: 0.88,
      side: THREE.DoubleSide
    });
    WINDOW_POSITIONS.forEach(wp => {
      // Each window: two curtain panels (left+right) on a local axis
      const panelW = 1.1, panelH = 2.8;
      const geo = new THREE.PlaneGeometry(panelW, panelH, 1, 8);

      const left  = new THREE.Mesh(geo, mat.clone());
      const right = new THREE.Mesh(geo, mat.clone());

      // Default closed — panels meet at center
      const isZ = Math.abs(wp.pos.z) > Math.abs(wp.pos.x);
      if (isZ) {
        left.position.copy(wp.pos).add(new THREE.Vector3(-panelW * 0.5, 0, 0));
        right.position.copy(wp.pos).add(new THREE.Vector3( panelW * 0.5, 0, 0));
        left.rotation.y  = 0;
        right.rotation.y = 0;
      } else {
        left.position.copy(wp.pos).add(new THREE.Vector3(0, 0, -panelW * 0.5));
        right.position.copy(wp.pos).add(new THREE.Vector3(0, 0,  panelW * 0.5));
        left.rotation.y  = Math.PI * 0.5;
        right.rotation.y = Math.PI * 0.5;
      }

      left.castShadow = false; left.receiveShadow = false;
      right.castShadow = false; right.receiveShadow = false;

      scene.add(left);
      scene.add(right);

      _curtainMeshes.push({
        left, right, wp,
        isZ,
        openOffsetX: panelW * 1.4,   // slide outward this far when open
        t: 0,   // 0 = closed, 1 = open (animated)
        target: 0
      });
    });
  }

  function _updateCurtains(dt) {
    _curtainMeshes.forEach(c => {
      c.t = HomeUtils.lerp(c.t, c.target, dt * 3.5);
      const off = c.openOffsetX * c.t;
      if (c.isZ) {
        c.left.position.x  = c.wp.pos.x - c.wp.pos.x * 0 - off - 0.55;
        c.right.position.x = c.wp.pos.x + off + 0.55;
      } else {
        c.left.position.z  = c.wp.pos.z - off - 0.55;
        c.right.position.z = c.wp.pos.z + off + 0.55;
      }
      // Squish the panels as they open (gathered look)
      const scaleX = HomeUtils.lerp(1.0, 0.35, c.t);
      c.left.scale.x  = scaleX;
      c.right.scale.x = scaleX;
    });
  }

  // ─────────────────────────────────────────────────
  // CANDLES
  // ─────────────────────────────────────────────────
  function _buildCandles() {
    CANDLE_POSITIONS.forEach((pos, i) => {
      // Wax body
      const waxGeo = new THREE.CylinderGeometry(0.06, 0.07, 0.35, 8);
      const waxMat = new THREE.MeshStandardMaterial({ color: 0xfff8e7, roughness: 0.9 });
      const wax    = new THREE.Mesh(waxGeo, waxMat);
      wax.position.copy(pos);
      wax.castShadow = true;
      scene.add(wax);

      // Flame (small billboard sphere)
      const flameGeo = new THREE.SphereGeometry(0.05, 6, 6);
      const flameMat = new THREE.MeshBasicMaterial({ color: 0xffaa22, transparent: true, opacity: 0.9 });
      const flame    = new THREE.Mesh(flameGeo, flameMat);
      flame.position.copy(pos).add(new THREE.Vector3(0, 0.22, 0));
      flame.scale.set(1, 1.6, 1);
      scene.add(flame);

      // Point light
      const light = new THREE.PointLight(0xff8822, state.candles ? 0.7 : 0, 3, 2);
      light.position.copy(pos).add(new THREE.Vector3(0, 0.3, 0));
      scene.add(light);

      _candles.push({ wax, flame, light, flicker: Math.random() * Math.PI * 2, baseIntensity: 0.7 });
    });
  }

  function _updateCandles(dt) {
    _candles.forEach(c => {
      c.flicker += dt * 6 + Math.sin(dt * 13) * 2;
      const f = 0.85 + 0.15 * Math.sin(c.flicker) + 0.07 * Math.sin(c.flicker * 2.3);
      const targetI = state.candles ? c.baseIntensity * f : 0;
      c.light.intensity  = HomeUtils.lerp(c.light.intensity, targetI, dt * 4);
      c.flame.visible    = state.candles;
      if (state.candles) {
        c.flame.scale.x = f * 0.95;
        c.flame.scale.y = 1.6 * f;
        c.flame.material.opacity = 0.7 + 0.2 * f;
      }
    });
  }

  // ─────────────────────────────────────────────────
  // FLOOR REFLECTION
  // ─────────────────────────────────────────────────
  function _buildReflectionPlane() {
    const geo = new THREE.PlaneGeometry(18, 18, 1, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e,
      metalness: 0.4,
      roughness: 0.15,
      transparent: true,
      opacity: 0.18,
      envMapIntensity: 1.2
    });
    _reflectionPlane = new THREE.Mesh(geo, mat);
    _reflectionPlane.rotation.x = -Math.PI * 0.5;
    _reflectionPlane.position.y = 0.002;
    _reflectionPlane.receiveShadow = false;
    scene.add(_reflectionPlane);
  }

  function _updateReflection(dt) {
    if (!_reflectionPlane) return;
    // Intensity driven by fireplace + candles + TV state
    const base     = 0.08;
    const fireCont = state.fireplace ? 0.12 : 0;
    const tvCont   = state.tv       ? 0.08 : 0;
    const candleCont = state.candles ? 0.04 : 0;
    // Add wetness from weather
    const wetCont  = window.HomeWeather ? HomeWeather.getWetness() * 0.15 : 0;
    const target   = base + fireCont + tvCont + candleCont + wetCont;
    _reflectionPlane.material.opacity = HomeUtils.lerp(_reflectionPlane.material.opacity, target, dt * 2);
  }

  // ─────────────────────────────────────────────────
  // DUST MOTES
  // ─────────────────────────────────────────────────
  function _buildDust() {
    const count = 120;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * 10;
      positions[i * 3 + 1] = 0.5 + Math.random() * 3.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 10;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xfff8e0, size: 0.018, sizeAttenuation: true,
      transparent: true, opacity: 0.35,
      depthWrite: false, fog: true
    });
    _dustSystem    = new THREE.Points(geo, mat);
    _dustPositions = positions;
    scene.add(_dustSystem);
  }

  function _updateDust(dt) {
    if (!_dustSystem || !_dustPositions) return;
    _dustPhase += dt * 0.3;
    const count = _dustPositions.length / 3;
    for (let i = 0; i < count; i++) {
      _dustPositions[i * 3]     += Math.sin(_dustPhase + i * 0.7) * 0.003;
      _dustPositions[i * 3 + 1] += 0.003 + Math.sin(_dustPhase * 0.5 + i) * 0.002;
      _dustPositions[i * 3 + 2] += Math.cos(_dustPhase + i * 0.5) * 0.003;
      if (_dustPositions[i * 3 + 1] > 4.2) {
        _dustPositions[i * 3 + 1] = 0.3;
        _dustPositions[i * 3]     = (Math.random() - 0.5) * 10;
        _dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 10;
      }
    }
    _dustSystem.geometry.attributes.position.needsUpdate = true;
  }

  // ─────────────────────────────────────────────────
  // FIREPLACE SMOKE
  // ─────────────────────────────────────────────────
  function _buildSmoke() {
    const count = 60;
    const pos   = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 0.5;
      pos[i * 3 + 1] = 0.8 + Math.random() * 2.0;
      pos[i * 3 + 2] = -4.5 + (Math.random() - 0.5) * 0.4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x888888, size: 0.22, sizeAttenuation: true,
      transparent: true, opacity: 0,
      depthWrite: false
    });
    _smokeSystem    = new THREE.Points(geo, mat);
    _smokePositions = pos;
    scene.add(_smokeSystem);
  }

  function _updateSmoke(dt) {
    if (!_smokeSystem || !_smokePositions) return;
    _smokePhase += dt;
    const targetOpacity = state.fireplace ? 0.18 : 0;
    _smokeSystem.material.opacity = HomeUtils.lerp(_smokeSystem.material.opacity, targetOpacity, dt * 1.5);
    if (!state.fireplace && _smokeSystem.material.opacity < 0.01) return;
    const count = _smokePositions.length / 3;
    for (let i = 0; i < count; i++) {
      _smokePositions[i * 3]     += Math.sin(_smokePhase + i * 1.1) * 0.004;
      _smokePositions[i * 3 + 1] += 0.015 + Math.random() * 0.01;
      _smokePositions[i * 3 + 2] += Math.cos(_smokePhase * 0.7 + i) * 0.003;
      if (_smokePositions[i * 3 + 1] > 4.5) {
        _smokePositions[i * 3]     = (Math.random() - 0.5) * 0.5;
        _smokePositions[i * 3 + 1] = 0.8;
        _smokePositions[i * 3 + 2] = -4.5 + (Math.random() - 0.5) * 0.4;
      }
    }
    _smokeSystem.geometry.attributes.position.needsUpdate = true;
  }

  // ─────────────────────────────────────────────────
  // INTERACTIVE TOGGLES
  // ─────────────────────────────────────────────────
  function setCurtains(mode) {
    // mode: 'open' | 'closed' | 'half'
    state.curtains = mode;
    const target = mode === 'open' ? 1 : mode === 'half' ? 0.5 : 0;
    _curtainMeshes.forEach(c => { c.target = target; });
    _broadcast({ curtains: mode });
  }

  function setWindow(roomName, open) {
    state.windows[roomName] = open;
    // Window open/close: dispatch event so HomeAmbientAudio can adjust
    window.dispatchEvent(new CustomEvent('home:windowState', { detail: { room: roomName, open } }));
    _broadcast({ windows: { ...state.windows } });
  }

  function setFireplace(on) {
    state.fireplace = on;
    // Relay to HomeScene so the existing fireplace light path is used
    if (window.HomeScene) HomeScene.state.fireplace = on;
    window.dispatchEvent(new CustomEvent('home:fireplaceState', { detail: { on } }));
    _broadcast({ fireplace: on });
  }

  function setTV(on) {
    state.tv = on;
    if (window.HomeScene) HomeScene.state.tvOn = on;
    window.dispatchEvent(new CustomEvent('home:tvState', { detail: { on } }));
    _broadcast({ tv: on });
  }

  function setRoomLight(roomName, on) {
    state.lights[roomName] = on;
    if (window.HomeLighting) HomeLighting.configureForRoom(on ? roomName : '__off');
    window.dispatchEvent(new CustomEvent('home:lightState', { detail: { room: roomName, on } }));
    _broadcast({ lights: { ...state.lights } });
  }

  function setCandles(on) {
    state.candles = on;
    _broadcast({ candles: on });
  }

  function toggleFireplace() { setFireplace(!state.fireplace); }
  function toggleTV()        { setTV(!state.tv); }
  function toggleCurtains()  { setCurtains(state.curtains === 'open' ? 'closed' : 'open'); }

  // ─────────────────────────────────────────────────
  // REALTIME BROADCAST (Feature 9)
  // ─────────────────────────────────────────────────
  function _broadcast(partial) {
    if (window.HomeRealtimeLiving && HomeRealtimeLiving.broadcastEnvChange) {
      HomeRealtimeLiving.broadcastEnvChange(partial);
    }
  }

  function applyRemoteState(data) {
    if (data.curtains  !== undefined) setCurtains(data.curtains);
    if (data.fireplace !== undefined) setFireplace(data.fireplace);
    if (data.tv        !== undefined) setTV(data.tv);
    if (data.candles   !== undefined) setCandles(data.candles);
    if (data.windows)  Object.entries(data.windows).forEach(([r, v]) => setWindow(r, v));
    if (data.lights)   Object.entries(data.lights).forEach(([r, v]) => setRoomLight(r, v));
  }

  // ─────────────────────────────────────────────────
  // INIT / UPDATE / DISPOSE
  // ─────────────────────────────────────────────────
  function init(threeScene) {
    scene = threeScene;
    _buildCurtains();
    _buildCandles();
    _buildReflectionPlane();
    _buildDust();
    _buildSmoke();

    // Listen for realtime partner env changes
    window.addEventListener('home:envSync', e => {
      if (e.detail) applyRemoteState(e.detail);
    });

    // Lightning flashes through windows
    window.addEventListener('home:lightning', () => {
      _curtainMeshes.forEach(c => {
        if (state.curtains !== 'closed') {
          // brief white tint on open curtain meshes
          c.left.material.emissive  && c.left.material.emissive.setHex(0xffffff);
          c.right.material.emissive && c.right.material.emissive.setHex(0xffffff);
          setTimeout(() => {
            c.left.material.emissive  && c.left.material.emissive.setHex(0x000000);
            c.right.material.emissive && c.right.material.emissive.setHex(0x000000);
          }, 100);
        }
      });
    });
  }

  function update(dt) {
    _updateCurtains(dt);
    _updateCandles(dt);
    _updateReflection(dt);
    _updateDust(dt);
    _updateSmoke(dt);
  }

  function getState() { return state; }

  function dispose() {
    _curtainMeshes.forEach(c => {
      scene.remove(c.left); scene.remove(c.right);
      c.left.geometry.dispose(); c.right.geometry.dispose();
    });
    _candles.forEach(c => {
      scene.remove(c.wax); scene.remove(c.flame); scene.remove(c.light);
      c.wax.geometry.dispose(); c.flame.geometry.dispose();
    });
    if (_reflectionPlane) { scene.remove(_reflectionPlane); _reflectionPlane.geometry.dispose(); }
    if (_dustSystem)  { scene.remove(_dustSystem);  _dustSystem.geometry.dispose();  }
    if (_smokeSystem) { scene.remove(_smokeSystem); _smokeSystem.geometry.dispose(); }
    _curtainMeshes = []; _candles = [];
  }

  return {
    init, update, dispose,
    setCurtains, setWindow, setFireplace, setTV, setRoomLight, setCandles,
    toggleFireplace, toggleTV, toggleCurtains,
    applyRemoteState, getState
  };
})();

window.HomeEnvironment = HomeEnvironment;