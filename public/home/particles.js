// public/home/particles.js
// ════════════════════════════════════════════════
//  Particles — Phase 7, Feature 8
//  GPU-efficient particle systems:
//    • Rain splash impacts
//    • Snow ground drift
//    • Dust motes (supplement to environment.js)
//    • Fireflies (night)
//    • Butterflies (garden / morning)
//    • Falling leaves (autumn wind)
//    • Floating pollen (spring / clear)
//
//  Uses THREE.InstancedMesh for all systems.
//  Reads HomeWeather, HomeSky, HomeScene.state.
//  NEW MODULE — does NOT rewrite Phase 1–6 files.
// ════════════════════════════════════════════════
const HomeParticles = (() => {

  let scene = null;

  // ── Quality multiplier (set by HomePerfLiving) ─
  let _quality = 1.0;

  // ── Active system registry ────────────────────
  const _systems = {};

  // ── Shared dummy for instanced matrix updates ─
  const _dummy = new THREE.Object3D();

  // ─────────────────────────────────────────────
  // GENERIC PARTICLE SYSTEM FACTORY
  // ─────────────────────────────────────────────
  function _makeSystem(key, geo, mat, count) {
    if (_systems[key]) _destroySystem(key);
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow    = false;
    mesh.receiveShadow = false;
    scene.add(mesh);

    return {
      mesh,
      count,
      pos:   new Float32Array(count * 3),
      vel:   new Float32Array(count * 3),
      age:   new Float32Array(count),
      life:  new Float32Array(count),
      extra: new Float32Array(count * 4),   // spare channel (phase, size, rot, etc.)
      active: true
    };
  }

  function _destroySystem(key) {
    const s = _systems[key];
    if (!s) return;
    scene && scene.remove(s.mesh);
    s.mesh.geometry.dispose();
    s.mesh.material.dispose();
    delete _systems[key];
  }

  // ─────────────────────────────────────────────
  // RAIN SPLASH
  // ─────────────────────────────────────────────
  const SPLASH_COUNT = 80;

  function _initSplash() {
    const geo = new THREE.RingGeometry(0.0, 0.12, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xaaccee, transparent: true, opacity: 0,
      depthWrite: false, side: THREE.DoubleSide
    });
    const sys = _makeSystem('splash', geo, mat, Math.floor(SPLASH_COUNT * _quality));
    for (let i = 0; i < sys.count; i++) _respawnSplash(sys, i, true);
    _systems.splash = sys;
  }

  function _respawnSplash(sys, i, rand = false) {
    sys.pos[i*3]   = (Math.random() - 0.5) * 14;
    sys.pos[i*3+1] = 0.01;
    sys.pos[i*3+2] = (Math.random() - 0.5) * 14;
    sys.life[i]    = 0.3 + Math.random() * 0.4;
    sys.age[i]     = rand ? Math.random() * sys.life[i] : 0;
    sys.extra[i*4] = Math.random() * 0.08 + 0.04; // max ring scale
  }

  function _updateSplash(dt) {
    const sys = _systems.splash;
    if (!sys) return;
    const wetness = window.HomeWeather ? HomeWeather.getWetness() : 0;
    const targetOp = wetness * 0.7;
    sys.mesh.material.opacity = HomeUtils.lerp(sys.mesh.material.opacity, targetOp, dt * 2);

    for (let i = 0; i < sys.count; i++) {
      sys.age[i] += dt;
      if (sys.age[i] >= sys.life[i]) { _respawnSplash(sys, i); continue; }

      const prog = sys.age[i] / sys.life[i];
      const scale = sys.extra[i*4] * prog;

      _dummy.position.set(sys.pos[i*3], sys.pos[i*3+1], sys.pos[i*3+2]);
      _dummy.rotation.set(-Math.PI * 0.5, 0, 0);
      _dummy.scale.setScalar(scale);
      _dummy.updateMatrix();
      sys.mesh.setMatrixAt(i, _dummy.matrix);
    }
    sys.mesh.instanceMatrix.needsUpdate = true;
  }

  // ─────────────────────────────────────────────
  // SNOW GROUND DRIFT
  // ─────────────────────────────────────────────
  const SNOW_DRIFT_COUNT = 200;

  function _initSnowDrift() {
    const geo = new THREE.SphereGeometry(0.04, 4, 4);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, depthWrite: false
    });
    const sys = _makeSystem('snowDrift', geo, mat, Math.floor(SNOW_DRIFT_COUNT * _quality));
    for (let i = 0; i < sys.count; i++) _respawnSnowDrift(sys, i, true);
    _systems.snowDrift = sys;
  }

  function _respawnSnowDrift(sys, i, rand = false) {
    sys.pos[i*3]   = (Math.random() - 0.5) * 16;
    sys.pos[i*3+1] = 0.02 + Math.random() * 0.1;
    sys.pos[i*3+2] = (Math.random() - 0.5) * 16;
    sys.vel[i*3]   = (Math.random() - 0.5) * 0.3;
    sys.vel[i*3+2] = (Math.random() - 0.5) * 0.3;
    sys.life[i]    = 3 + Math.random() * 5;
    sys.age[i]     = rand ? Math.random() * sys.life[i] : 0;
    sys.extra[i*4] = 0.6 + Math.random() * 0.8; // scale
  }

  function _updateSnowDrift(dt) {
    const sys = _systems.snowDrift;
    if (!sys) return;
    const isSnow = window.HomeWeather && HomeWeather.getCurrent() === 'snow';
    const targetOp = isSnow ? 0.75 : 0;
    sys.mesh.material.opacity = HomeUtils.lerp(sys.mesh.material.opacity, targetOp, dt * 1.5);

    for (let i = 0; i < sys.count; i++) {
      sys.age[i] += dt;
      if (sys.age[i] >= sys.life[i]) { _respawnSnowDrift(sys, i); continue; }
      sys.pos[i*3]   += sys.vel[i*3]   * dt;
      sys.pos[i*3+2] += sys.vel[i*3+2] * dt;

      _dummy.position.set(sys.pos[i*3], sys.pos[i*3+1], sys.pos[i*3+2]);
      _dummy.scale.setScalar(sys.extra[i*4]);
      _dummy.rotation.set(0, sys.age[i], 0);
      _dummy.updateMatrix();
      sys.mesh.setMatrixAt(i, _dummy.matrix);
    }
    sys.mesh.instanceMatrix.needsUpdate = true;
  }

  // ─────────────────────────────────────────────
  // FIREFLIES
  // ─────────────────────────────────────────────
  const FIREFLY_COUNT = 35;

  function _initFireflies() {
    const geo = new THREE.SphereGeometry(0.035, 6, 6);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xccff44, transparent: true, opacity: 0,
      depthWrite: false, fog: false
    });
    const sys = _makeSystem('fireflies', geo, mat, Math.floor(FIREFLY_COUNT * _quality));
    for (let i = 0; i < sys.count; i++) _respawnFirefly(sys, i, true);
    _systems.fireflies = sys;
  }

  function _respawnFirefly(sys, i, rand = false) {
    sys.pos[i*3]   = (Math.random() - 0.5) * 10;
    sys.pos[i*3+1] = 0.4 + Math.random() * 2.2;
    sys.pos[i*3+2] = (Math.random() - 0.5) * 10;
    sys.vel[i*3]   = (Math.random() - 0.5) * 0.4;
    sys.vel[i*3+1] = (Math.random() - 0.5) * 0.15;
    sys.vel[i*3+2] = (Math.random() - 0.5) * 0.4;
    sys.life[i]    = 4 + Math.random() * 8;
    sys.age[i]     = rand ? Math.random() * sys.life[i] : 0;
    sys.extra[i*4]   = Math.random() * Math.PI * 2;  // phase
    sys.extra[i*4+1] = 0.5 + Math.random() * 1.5;   // blink speed
  }

  function _updateFireflies(dt) {
    const sys = _systems.fireflies;
    if (!sys) return;
    const skyTime = window.HomeSky ? HomeSky.getTime() : 0.5;
    const isNight = skyTime < 0.27 || skyTime > 0.85;
    const inGarden = window.HomeScene && (HomeScene.state.currentRoom === 'garden' || HomeScene.state.currentRoom === 'rooftop');
    const targetOp = isNight && inGarden ? 0.9 : isNight ? 0.55 : 0;
    sys.mesh.material.opacity = HomeUtils.lerp(sys.mesh.material.opacity, targetOp, dt * 1.2);

    for (let i = 0; i < sys.count; i++) {
      sys.age[i] += dt;
      if (sys.age[i] >= sys.life[i]) { _respawnFirefly(sys, i); continue; }

      sys.extra[i*4] += dt * sys.extra[i*4+1];
      const blink = Math.max(0, Math.sin(sys.extra[i*4]));

      // Lazy wander
      sys.pos[i*3]   += sys.vel[i*3]   * dt;
      sys.pos[i*3+1] += sys.vel[i*3+1] * dt + Math.sin(sys.extra[i*4] * 0.5) * 0.003;
      sys.pos[i*3+2] += sys.vel[i*3+2] * dt;

      // Soft boundary
      if (Math.abs(sys.pos[i*3])   > 6) sys.vel[i*3]   *= -1;
      if (sys.pos[i*3+1] < 0.2)    sys.vel[i*3+1] =  Math.abs(sys.vel[i*3+1]);
      if (sys.pos[i*3+1] > 3.0)    sys.vel[i*3+1] = -Math.abs(sys.vel[i*3+1]);
      if (Math.abs(sys.pos[i*3+2]) > 6) sys.vel[i*3+2] *= -1;

      _dummy.position.set(sys.pos[i*3], sys.pos[i*3+1], sys.pos[i*3+2]);
      const s = blink * (0.7 + Math.sin(sys.extra[i*4] * 2.1) * 0.3);
      _dummy.scale.setScalar(Math.max(0.01, s));
      _dummy.updateMatrix();
      sys.mesh.setMatrixAt(i, _dummy.matrix);
    }
    sys.mesh.instanceMatrix.needsUpdate = true;

    // Colour pulse green→yellow
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.001);
    sys.mesh.material.color.setRGB(0.7 + pulse * 0.3, 1.0, 0.1 + pulse * 0.3);
  }

  // ─────────────────────────────────────────────
  // BUTTERFLIES
  // ─────────────────────────────────────────────
  const BUTTERFLY_COUNT = 12;

  function _initButterflies() {
    // Two-wing shape: two quads side by side
    const geo = new THREE.PlaneGeometry(0.22, 0.15, 1, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffaacc, transparent: true, opacity: 0,
      depthWrite: false, side: THREE.DoubleSide
    });
    const sys = _makeSystem('butterflies', geo, mat, Math.floor(BUTTERFLY_COUNT * _quality));
    for (let i = 0; i < sys.count; i++) _respawnButterfly(sys, i, true);
    _systems.butterflies = sys;
  }

  function _respawnButterfly(sys, i, rand = false) {
    sys.pos[i*3]   = (Math.random() - 0.5) * 8;
    sys.pos[i*3+1] = 0.5 + Math.random() * 1.8;
    sys.pos[i*3+2] = (Math.random() - 0.5) * 8;
    sys.vel[i*3]   = (Math.random() - 0.5) * 0.6;
    sys.vel[i*3+2] = (Math.random() - 0.5) * 0.6;
    sys.life[i]    = 6 + Math.random() * 10;
    sys.age[i]     = rand ? Math.random() * sys.life[i] : 0;
    sys.extra[i*4]   = Math.random() * Math.PI * 2;  // wing phase
    sys.extra[i*4+1] = 4 + Math.random() * 4;        // wing flap speed
    // Random hue
    const hues = [0xffaacc, 0xaaccff, 0xffeeaa, 0xaaffcc, 0xddaaff];
    sys.extra[i*4+2] = hues[Math.floor(Math.random() * hues.length)];
  }

  function _updateButterflies(dt) {
    const sys = _systems.butterflies;
    if (!sys) return;
    const skyTime = window.HomeSky ? HomeSky.getTime() : 0.5;
    const isMorning = skyTime >= 0.27 && skyTime <= 0.55;
    const weather = window.HomeWeather ? HomeWeather.getCurrent() : 'clear';
    const isCalm = ['clear', 'cloudy', 'fog'].includes(weather);
    const targetOp = isMorning && isCalm ? 0.85 : 0;
    sys.mesh.material.opacity = HomeUtils.lerp(sys.mesh.material.opacity, targetOp, dt * 1.5);

    for (let i = 0; i < sys.count; i++) {
      sys.age[i] += dt;
      if (sys.age[i] >= sys.life[i]) { _respawnButterfly(sys, i); continue; }

      sys.extra[i*4] += dt * sys.extra[i*4+1];
      const wingAngle = Math.cos(sys.extra[i*4]) * 0.8; // -0.8 → 0.8

      // Bobbing flight
      sys.pos[i*3]   += sys.vel[i*3]   * dt;
      sys.pos[i*3+1] += Math.sin(sys.extra[i*4] * 0.3) * 0.006;
      sys.pos[i*3+2] += sys.vel[i*3+2] * dt;

      // Soft boundary
      if (Math.abs(sys.pos[i*3]) > 5)   sys.vel[i*3]   *= -0.9;
      if (sys.pos[i*3+1] < 0.3)         sys.pos[i*3+1] = 0.3;
      if (sys.pos[i*3+1] > 2.5)         sys.pos[i*3+1] = 2.5;
      if (Math.abs(sys.pos[i*3+2]) > 5) sys.vel[i*3+2] *= -0.9;

      _dummy.position.set(sys.pos[i*3], sys.pos[i*3+1], sys.pos[i*3+2]);
      _dummy.rotation.set(0, Math.atan2(sys.vel[i*3], sys.vel[i*3+2]), wingAngle);
      _dummy.scale.setScalar(1);
      _dummy.updateMatrix();
      sys.mesh.setMatrixAt(i, _dummy.matrix);
    }
    sys.mesh.instanceMatrix.needsUpdate = true;
  }

  // ─────────────────────────────────────────────
  // FALLING LEAVES
  // ─────────────────────────────────────────────
  const LEAF_COUNT = 60;

  function _initLeaves() {
    const geo = new THREE.PlaneGeometry(0.14, 0.10, 1, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xcc7722, transparent: true, opacity: 0,
      depthWrite: false, side: THREE.DoubleSide
    });
    const sys = _makeSystem('leaves', geo, mat, Math.floor(LEAF_COUNT * _quality));
    for (let i = 0; i < sys.count; i++) _respawnLeaf(sys, i, true);
    _systems.leaves = sys;
  }

  function _respawnLeaf(sys, i, rand = false) {
    sys.pos[i*3]   = (Math.random() - 0.5) * 14;
    sys.pos[i*3+1] = rand ? Math.random() * 10 : 8 + Math.random() * 4;
    sys.pos[i*3+2] = (Math.random() - 0.5) * 14;
    sys.vel[i*3]   = (Math.random() - 0.5) * 0.8;
    sys.vel[i*3+1] = -(0.6 + Math.random() * 0.8);
    sys.vel[i*3+2] = (Math.random() - 0.5) * 0.8;
    sys.extra[i*4]   = Math.random() * Math.PI * 2; // tumble phase
    sys.extra[i*4+1] = 1.5 + Math.random() * 3;    // tumble speed
    // Autumn leaf colours
    const cols = [0xcc5500, 0xdd7700, 0xee9900, 0xbb3300, 0xffbb00];
    sys.extra[i*4+2] = cols[Math.floor(Math.random() * cols.length)];
  }

  function _updateLeaves(dt) {
    const sys = _systems.leaves;
    if (!sys) return;
    const weather = window.HomeWeather ? HomeWeather.getCurrent() : 'clear';
    const windStrength = window.HomeWeather ? (HomeWeather.getDefinition(weather)?.wind || 0) : 0;
    const targetOp = windStrength > 0.3 ? Math.min(1, windStrength * 0.7) : 0;
    sys.mesh.material.opacity = HomeUtils.lerp(sys.mesh.material.opacity, targetOp, dt * 1.2);

    for (let i = 0; i < sys.count; i++) {
      sys.extra[i*4] += dt * sys.extra[i*4+1];

      sys.pos[i*3]   += sys.vel[i*3]   * dt + Math.sin(sys.extra[i*4] * 0.7) * 0.015;
      sys.pos[i*3+1] += sys.vel[i*3+1] * dt;
      sys.pos[i*3+2] += sys.vel[i*3+2] * dt + Math.cos(sys.extra[i*4] * 0.5) * 0.01;

      if (sys.pos[i*3+1] < -0.5) _respawnLeaf(sys, i);

      _dummy.position.set(sys.pos[i*3], sys.pos[i*3+1], sys.pos[i*3+2]);
      _dummy.rotation.set(
        sys.extra[i*4],
        sys.extra[i*4] * 0.7,
        sys.extra[i*4] * 0.5
      );
      _dummy.scale.setScalar(1);
      _dummy.updateMatrix();
      sys.mesh.setMatrixAt(i, _dummy.matrix);
    }
    sys.mesh.instanceMatrix.needsUpdate = true;

    // Vary leaf colour gently
    const hue = 0.07 + 0.04 * Math.sin(performance.now() * 0.0003);
    sys.mesh.material.color.setHSL(hue, 0.9, 0.45);
  }

  // ─────────────────────────────────────────────
  // FLOATING POLLEN
  // ─────────────────────────────────────────────
  const POLLEN_COUNT = 100;

  function _initPollen() {
    const geo = new THREE.SphereGeometry(0.018, 4, 4);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffaa, transparent: true, opacity: 0,
      depthWrite: false, fog: false
    });
    const sys = _makeSystem('pollen', geo, mat, Math.floor(POLLEN_COUNT * _quality));
    for (let i = 0; i < sys.count; i++) _respawnPollen(sys, i, true);
    _systems.pollen = sys;
  }

  function _respawnPollen(sys, i, rand = false) {
    sys.pos[i*3]   = (Math.random() - 0.5) * 12;
    sys.pos[i*3+1] = rand ? 0.2 + Math.random() * 4 : 0.2;
    sys.pos[i*3+2] = (Math.random() - 0.5) * 12;
    sys.vel[i*3]   = (Math.random() - 0.5) * 0.15;
    sys.vel[i*3+1] = 0.04 + Math.random() * 0.08;
    sys.vel[i*3+2] = (Math.random() - 0.5) * 0.15;
    sys.life[i]    = 8 + Math.random() * 10;
    sys.age[i]     = rand ? Math.random() * sys.life[i] : 0;
    sys.extra[i*4] = Math.random() * Math.PI * 2;
  }

  function _updatePollen(dt) {
    const sys = _systems.pollen;
    if (!sys) return;
    const skyTime = window.HomeSky ? HomeSky.getTime() : 0.5;
    const weather = window.HomeWeather ? HomeWeather.getCurrent() : 'clear';
    const isSpring = skyTime > 0.27 && skyTime < 0.70 && weather === 'clear';
    const targetOp = isSpring ? 0.5 : 0;
    sys.mesh.material.opacity = HomeUtils.lerp(sys.mesh.material.opacity, targetOp, dt * 0.8);

    for (let i = 0; i < sys.count; i++) {
      sys.age[i]     += dt;
      sys.extra[i*4] += dt * 0.8;
      if (sys.age[i] >= sys.life[i]) { _respawnPollen(sys, i); continue; }

      sys.pos[i*3]   += sys.vel[i*3]   * dt + Math.sin(sys.extra[i*4]) * 0.004;
      sys.pos[i*3+1] += sys.vel[i*3+1] * dt;
      sys.pos[i*3+2] += sys.vel[i*3+2] * dt + Math.cos(sys.extra[i*4] * 0.7) * 0.003;

      if (sys.pos[i*3+1] > 5.5) { sys.pos[i*3+1] = 0.2; }

      _dummy.position.set(sys.pos[i*3], sys.pos[i*3+1], sys.pos[i*3+2]);
      _dummy.scale.setScalar(1);
      _dummy.updateMatrix();
      sys.mesh.setMatrixAt(i, _dummy.matrix);
    }
    sys.mesh.instanceMatrix.needsUpdate = true;
  }

  // ─────────────────────────────────────────────
  // SETWEATHER compatibility shim
  // (scene.js calls HomeParticles.setWeather(w))
  // ─────────────────────────────────────────────
  function setWeather(w) {
    // Visibility handled in update() per-system — nothing extra needed
  }

  // ─────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────
  function init(threeScene) {
    scene = threeScene;

    // Quality from HomePerfLiving if available
    if (window.HomePerfLiving) {
      const tier = HomePerfLiving.getQualityTier ? HomePerfLiving.getQualityTier() : 'high';
      _quality = tier === 'low' ? 0.25 : tier === 'medium' ? 0.55 : 1.0;
    }

    _initSplash();
    _initSnowDrift();
    _initFireflies();
    _initButterflies();
    _initLeaves();
    _initPollen();
  }

  function update(dt) {
    if (!scene) return;
    _updateSplash(dt);
    _updateSnowDrift(dt);
    _updateFireflies(dt);
    _updateButterflies(dt);
    _updateLeaves(dt);
    _updatePollen(dt);
  }

  function dispose() {
    Object.keys(_systems).forEach(_destroySystem);
    scene = null;
  }

  return { init, update, dispose, setWeather };
})();

window.HomeParticles = HomeParticles;