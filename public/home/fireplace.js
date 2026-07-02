// public/home/fireplace.js
// ════════════════════════════════════════════════
//  Fireplace — Phase 7, Feature 5
//  Fire particles, flame mesh layers, embers,
//  fire light flicker. Integrates with HomeLighting
//  and HomeEnvironment via events.
//  NEW MODULE — does NOT rewrite any Phase 1-6 file.
// ════════════════════════════════════════════════
const HomeFireplace = (() => {

  let scene  = null;
  let active = false;

  // ── Fire position (living room fireplace) ─────
  const FIRE_POS = new THREE.Vector3(0, 0.55, -4.5);

  // ── Flame layers (instanced billboards) ───────
  let _flameMesh     = null;
  let _flameCount    = 48;
  let _flamePos      = null;   // Float32Array
  let _flameVel      = null;
  let _flameAge      = null;
  let _flameLife     = null;
  let _flamePhase    = 0;

  // ── Ember particles (small glowing dots) ──────
  let _emberMesh     = null;
  let _emberCount    = 30;
  let _emberPos      = null;
  let _emberVel      = null;
  let _emberAge      = null;
  let _emberLife     = null;

  // ── Inner glow mesh (static orange orb) ───────
  let _glowMesh      = null;

  // ── Fire light (owned here, supplements HomeLighting) ─
  let _fireLight     = null;
  let _flickerPhase  = 0;

  // ── Log meshes ────────────────────────────────
  let _logs          = [];

  // ─────────────────────────────────────────────
  // BUILD
  // ─────────────────────────────────────────────
  function _buildLogs() {
    const logMat = new THREE.MeshStandardMaterial({ color: 0x3a2010, roughness: 0.95, metalness: 0 });
    const logGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.7, 7);
    const offsets = [
      { x: -0.12, z: 0, ry: 0.3  },
      { x:  0.12, z: 0, ry: -0.3 },
      { x:  0,    z: 0.1, ry: Math.PI * 0.5 }
    ];
    offsets.forEach(o => {
      const m = new THREE.Mesh(logGeo, logMat);
      m.position.set(FIRE_POS.x + o.x, FIRE_POS.y - 0.22, FIRE_POS.z);
      m.rotation.set(Math.PI * 0.5, 0, o.ry);
      m.castShadow = true;
      scene.add(m);
      _logs.push(m);
    });
  }

  function _buildGlow() {
    const geo = new THREE.SphereGeometry(0.28, 10, 10);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false
    });
    _glowMesh = new THREE.Mesh(geo, mat);
    _glowMesh.position.copy(FIRE_POS).add(new THREE.Vector3(0, 0.1, 0));
    scene.add(_glowMesh);
  }

  function _buildFlames() {
    // Each flame particle: a small quad (PlaneGeometry) oriented upward
    const geo = new THREE.PlaneGeometry(0.18, 0.32, 1, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false
    });

    _flameMesh = new THREE.InstancedMesh(geo, mat, _flameCount);
    _flameMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _flameMesh.frustumCulled = false;
    _flameMesh.renderOrder   = 10;
    scene.add(_flameMesh);

    _flamePos  = new Float32Array(_flameCount * 3);
    _flameVel  = new Float32Array(_flameCount * 3);
    _flameAge  = new Float32Array(_flameCount);
    _flameLife = new Float32Array(_flameCount);

    for (let i = 0; i < _flameCount; i++) {
      _respawnFlame(i, true);
    }
  }

  function _respawnFlame(i, randomAge = false) {
    _flamePos[i*3]   = FIRE_POS.x + (Math.random() - 0.5) * 0.35;
    _flamePos[i*3+1] = FIRE_POS.y;
    _flamePos[i*3+2] = FIRE_POS.z + (Math.random() - 0.5) * 0.25;

    _flameVel[i*3]   = (Math.random() - 0.5) * 0.3;
    _flameVel[i*3+1] = 0.8 + Math.random() * 1.2;
    _flameVel[i*3+2] = (Math.random() - 0.5) * 0.3;

    _flameLife[i] = 0.5 + Math.random() * 0.8;
    _flameAge[i]  = randomAge ? Math.random() * _flameLife[i] : 0;
  }

  function _buildEmbers() {
    const geo = new THREE.SphereGeometry(0.028, 4, 4);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff8800,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false
    });

    _emberMesh = new THREE.InstancedMesh(geo, mat, _emberCount);
    _emberMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _emberMesh.frustumCulled = false;
    scene.add(_emberMesh);

    _emberPos  = new Float32Array(_emberCount * 3);
    _emberVel  = new Float32Array(_emberCount * 3);
    _emberAge  = new Float32Array(_emberCount);
    _emberLife = new Float32Array(_emberCount);

    for (let i = 0; i < _emberCount; i++) {
      _respawnEmber(i, true);
    }
  }

  function _respawnEmber(i, randomAge = false) {
    _emberPos[i*3]   = FIRE_POS.x + (Math.random() - 0.5) * 0.3;
    _emberPos[i*3+1] = FIRE_POS.y + 0.2;
    _emberPos[i*3+2] = FIRE_POS.z + (Math.random() - 0.5) * 0.2;

    const angle = Math.random() * Math.PI * 2;
    const speed = 0.4 + Math.random() * 1.0;
    _emberVel[i*3]   = Math.cos(angle) * speed * 0.4;
    _emberVel[i*3+1] = 1.2 + Math.random() * 1.5;
    _emberVel[i*3+2] = Math.sin(angle) * speed * 0.4;

    _emberLife[i] = 1.0 + Math.random() * 2.0;
    _emberAge[i]  = randomAge ? Math.random() * _emberLife[i] : 0;
  }

  function _buildLight() {
    _fireLight = new THREE.PointLight(0xff5500, 0, 8, 2);
    _fireLight.position.copy(FIRE_POS).add(new THREE.Vector3(0, 0.5, 0));
    scene.add(_fireLight);
  }

  // ─────────────────────────────────────────────
  // UPDATE
  // ─────────────────────────────────────────────
  const _dummy = new THREE.Object3D();

  function _updateFlames(dt) {
    if (!_flameMesh) return;

    _flamePhase += dt * 3.5;
    const targetOpacity = active ? 0.72 : 0;
    _flameMesh.material.opacity = HomeUtils.lerp(_flameMesh.material.opacity, targetOpacity, dt * 4);

    for (let i = 0; i < _flameCount; i++) {
      _flameAge[i] += dt;
      if (_flameAge[i] >= _flameLife[i]) {
        _respawnFlame(i);
      }

      const progress = _flameAge[i] / _flameLife[i]; // 0→1
      const sway = Math.sin(_flamePhase + i * 0.7) * 0.04;

      _flamePos[i*3]   += (_flameVel[i*3]   + sway) * dt;
      _flamePos[i*3+1] += _flameVel[i*3+1] * dt;
      _flamePos[i*3+2] += _flameVel[i*3+2] * dt;

      // Scale: grows then shrinks; tapers to a point at top
      const scaleX = (1 - progress) * (0.6 + Math.sin(_flamePhase * 2 + i) * 0.15);
      const scaleY = (0.4 + progress * 0.6) * (1.2 - progress * 0.5);

      _dummy.position.set(_flamePos[i*3], _flamePos[i*3+1], _flamePos[i*3+2]);
      _dummy.scale.set(scaleX, scaleY, scaleX);
      // Billboard toward camera handled by renderOrder + DoubleSide;
      // a simple Y-only rotation approximates it
      _dummy.rotation.set(0, _flamePhase * 0.2 + i, 0);
      _dummy.updateMatrix();
      _flameMesh.setMatrixAt(i, _dummy.matrix);
    }
    _flameMesh.instanceMatrix.needsUpdate = true;

    // Colour cycles orange → yellow at peak
    const heat = 0.5 + 0.5 * Math.sin(_flamePhase * 1.1);
    const r = 255;
    const g = Math.floor(60 + heat * 130);
    _flameMesh.material.color.setRGB(r / 255, g / 255, 0);
  }

  function _updateEmbers(dt) {
    if (!_emberMesh) return;
    const targetOpacity = active ? 0.9 : 0;
    _emberMesh.material.opacity = HomeUtils.lerp(_emberMesh.material.opacity, targetOpacity, dt * 3);

    for (let i = 0; i < _emberCount; i++) {
      _emberAge[i] += dt;
      if (_emberAge[i] >= _emberLife[i]) {
        _respawnEmber(i);
      }

      // Gravity
      _emberVel[i*3+1] -= 0.4 * dt;

      _emberPos[i*3]   += _emberVel[i*3]   * dt;
      _emberPos[i*3+1] += _emberVel[i*3+1] * dt;
      _emberPos[i*3+2] += _emberVel[i*3+2] * dt;

      _dummy.position.set(_emberPos[i*3], _emberPos[i*3+1], _emberPos[i*3+2]);
      _dummy.scale.setScalar(1);
      _dummy.rotation.set(0, 0, 0);
      _dummy.updateMatrix();
      _emberMesh.setMatrixAt(i, _dummy.matrix);
    }
    _emberMesh.instanceMatrix.needsUpdate = true;
  }

  function _updateGlow(dt) {
    if (!_glowMesh) return;
    const target = active ? 0.45 + 0.1 * Math.sin(_flickerPhase * 3.7) : 0;
    _glowMesh.material.opacity = HomeUtils.lerp(_glowMesh.material.opacity, target, dt * 5);
  }

  function _updateLight(dt) {
    if (!_fireLight) return;
    _flickerPhase += dt * 7.5;
    if (!active) {
      _fireLight.intensity = HomeUtils.lerp(_fireLight.intensity, 0, dt * 4);
      return;
    }
    const f = 0.82 + 0.18 * Math.sin(_flickerPhase)
                   + 0.09 * Math.sin(_flickerPhase * 2.3 + 1.1)
                   + 0.05 * Math.sin(_flickerPhase * 5.1 + 0.4);
    _fireLight.intensity = 2.2 * f;
    _fireLight.color.setHex(
      Math.random() > 0.97 ? 0xffcc44 : 0xff5500 // occasional yellow pop
    );

    // Also drive HomeLighting's fireplace light
    if (window.HomeLighting) HomeLighting.updateFireplace(active, dt);
  }

  // ─────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────
  function setActive(on) {
    active = on;
    window.dispatchEvent(new CustomEvent('home:fireplaceState', { detail: { on } }));
  }

  function toggle() { setActive(!active); }
  function isActive() { return active; }

  function init(threeScene) {
    scene = threeScene;
    _buildLogs();
    _buildGlow();
    _buildFlames();
    _buildEmbers();
    _buildLight();

    // Listen for environment module toggle
    window.addEventListener('home:fireplaceState', e => {
      if (e.detail && typeof e.detail.on === 'boolean') {
        active = e.detail.on;
      }
    });
  }

  function update(dt) {
    _updateFlames(dt);
    _updateEmbers(dt);
    _updateGlow(dt);
    _updateLight(dt);
  }

  function dispose() {
    const objs = [_flameMesh, _emberMesh, _glowMesh, _fireLight];
    objs.forEach(o => {
      if (!o) return;
      scene.remove(o);
      o.geometry && o.geometry.dispose();
      o.material && o.material.dispose();
    });
    _logs.forEach(l => {
      scene.remove(l);
      l.geometry.dispose();
      l.material.dispose();
    });
    _logs = [];
    _flameMesh = _emberMesh = _glowMesh = _fireLight = null;
  }

  return { init, update, dispose, setActive, toggle, isActive };
})();

window.HomeFireplace = HomeFireplace;