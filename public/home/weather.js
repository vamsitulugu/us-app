// public/home/weather.js
// ════════════════════════════════════════════════
//  Weather — Phase 7, Feature 1
//  Rain, Heavy Rain, Drizzle, Thunderstorm, Snow,
//  Fog, Wind, Sunny, Cloudy, Sunset, Night.
//  Realistic transitions, particles, puddles, wet
//  reflections. NEW MODULE — reuses HomeLighting,
//  HomeScene, HomeParticles. Does NOT modify
//  rooms/furniture/memories/any Phase 1-6 module.
// ════════════════════════════════════════════════
const HomeWeather = (() => {

  let scene        = null;
  let current      = 'clear';
  let transitioning = false;

  // ── Weather Definitions ────────────────────────
  // Each entry drives: particles, fog, lighting tint,
  // wind, wet-floor reflection intensity.
  const WEATHERS = {
    clear: {
      label: 'Sunny', icon: '☀️',
      fog: { color: 0xd0e8f0, density: 0.008 },
      lightTint: null, wetness: 0, wind: 0,
      particles: null
    },
    cloudy: {
      label: 'Cloudy', icon: '☁️',
      fog: { color: 0xb0b8c8, density: 0.012 },
      lightTint: { ambient: 0xc8d0dc, sun: 0.8 }, wetness: 0, wind: 0.2,
      particles: null
    },
    drizzle: {
      label: 'Drizzle', icon: '🌦️',
      fog: { color: 0x8090a0, density: 0.018 },
      lightTint: { ambient: 0x90a0b0, sun: 0.6 }, wetness: 0.4, wind: 0.3,
      particles: { type: 'rain', count: 600, speed: 8, opacity: 0.28, width: 0.012, length: 0.18 }
    },
    rain: {
      label: 'Rain', icon: '🌧️',
      fog: { color: 0x607080, density: 0.022 },
      lightTint: { ambient: 0x708090, sun: 0.5 }, wetness: 0.75, wind: 0.5,
      particles: { type: 'rain', count: 1800, speed: 12, opacity: 0.38, width: 0.01, length: 0.25 }
    },
    heavyrain: {
      label: 'Heavy Rain', icon: '⛈️',
      fog: { color: 0x405060, density: 0.030 },
      lightTint: { ambient: 0x506070, sun: 0.35 }, wetness: 1.0, wind: 1.0,
      particles: { type: 'rain', count: 3600, speed: 18, opacity: 0.45, width: 0.009, length: 0.35 }
    },
    thunderstorm: {
      label: 'Thunderstorm', icon: '⚡',
      fog: { color: 0x303848, density: 0.035 },
      lightTint: { ambient: 0x404858, sun: 0.25 }, wetness: 1.0, wind: 1.5,
      particles: { type: 'rain', count: 4000, speed: 22, opacity: 0.50, width: 0.009, length: 0.40 },
      thunder: true
    },
    snow: {
      label: 'Snow', icon: '❄️',
      fog: { color: 0xe0e8f4, density: 0.016 },
      lightTint: { ambient: 0xe0e8ff, sun: 0.9 }, wetness: 0, wind: 0.4,
      particles: { type: 'snow', count: 1200, speed: 1.2, opacity: 0.80, size: 0.08 }
    },
    fog: {
      label: 'Fog', icon: '🌫️',
      fog: { color: 0xc8d0d8, density: 0.060 },
      lightTint: { ambient: 0xb8c0c8, sun: 0.55 }, wetness: 0.2, wind: 0.1,
      particles: null
    },
    wind: {
      label: 'Windy', icon: '💨',
      fog: { color: 0xb8c8d8, density: 0.010 },
      lightTint: null, wetness: 0, wind: 2.0,
      particles: { type: 'wind', count: 80, speed: 6, opacity: 0.15 }
    },
    sunset: {
      label: 'Sunset', icon: '🌅',
      fog: { color: 0xff7043, density: 0.010 },
      lightTint: { ambient: 0xff8c42, sun: 0.9 }, wetness: 0, wind: 0.1,
      particles: null
    },
    night: {
      label: 'Night', icon: '🌙',
      fog: { color: 0x0a0a1a, density: 0.012 },
      lightTint: { ambient: 0x0d1b4b, sun: 0.2 }, wetness: 0, wind: 0,
      particles: null
    }
  };

  // ── State ──────────────────────────────────────
  let _wetness    = 0;          // 0-1, drives floor reflection
  let _windPhase  = 0;
  let _thunderTimer = 0;
  let _thunderActive = false;
  let _lightningFlashTimer = 0;
  let _transitionAlpha = 1;
  let _targetWetness = 0;
  let _puddleMesh = null;
  let _puddleVisible = false;

  // ── Rain/Snow Particle System ─────────────────
  // Uses THREE.InstancedMesh for GPU efficiency
  let _particleSystem = null;
  let _particleDef    = null;
  let _particlePositions = null;
  let _particleVelocities = null;
  let _instanceMatrix = null;
  const _dummy = new THREE.Object3D();

  function _buildParticles(def) {
    _destroyParticles();
    if (!def || !scene) return;
    _particleDef = def;

    const count = HomePerfLiving
      ? Math.floor(def.count * (HomePerfLiving.getQualityTier() === 'low' ? 0.25 : HomePerfLiving.getQualityTier() === 'medium' ? 0.55 : 1.0))
      : def.count;

    let geo, mat;
    if (def.type === 'rain') {
      geo = new THREE.CylinderGeometry(def.width * 0.5, def.width * 0.5, def.length, 3, 1);
      mat = new THREE.MeshBasicMaterial({ color: 0xaac8e0, transparent: true, opacity: def.opacity, depthWrite: false });
    } else if (def.type === 'snow') {
      geo = new THREE.SphereGeometry(def.size, 4, 4);
      mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: def.opacity, depthWrite: false });
    } else {
      // wind — thin elongated streaks
      geo = new THREE.CylinderGeometry(0.005, 0.005, 0.8, 3, 1);
      mat = new THREE.MeshBasicMaterial({ color: 0xc8d8e8, transparent: true, opacity: def.opacity, depthWrite: false });
    }

    _particleSystem = new THREE.InstancedMesh(geo, mat, count);
    _particleSystem.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _particleSystem.frustumCulled = false;
    _particleSystem.castShadow = false;
    _particleSystem.receiveShadow = false;

    _particlePositions  = new Float32Array(count * 3);
    _particleVelocities = new Float32Array(count * 3);

    const spread = 18;
    for (let i = 0; i < count; i++) {
      _particlePositions[i*3]   = (Math.random() - 0.5) * spread;
      _particlePositions[i*3+1] = Math.random() * 14;
      _particlePositions[i*3+2] = (Math.random() - 0.5) * spread;

      if (def.type === 'rain') {
        _particleVelocities[i*3]   = (Math.random() - 0.5) * 0.5; // wind drift X
        _particleVelocities[i*3+1] = -(def.speed * (0.85 + Math.random() * 0.3));
        _particleVelocities[i*3+2] = (Math.random() - 0.5) * 0.5;
      } else if (def.type === 'snow') {
        _particleVelocities[i*3]   = (Math.random() - 0.5) * 0.3;
        _particleVelocities[i*3+1] = -(def.speed * (0.6 + Math.random() * 0.8));
        _particleVelocities[i*3+2] = (Math.random() - 0.5) * 0.3;
      } else {
        _particleVelocities[i*3]   = def.speed * (0.7 + Math.random() * 0.6);
        _particleVelocities[i*3+1] = (Math.random() - 0.5) * 0.5;
        _particleVelocities[i*3+2] = (Math.random() - 0.5) * 0.5;
      }
    }

    scene.add(_particleSystem);
  }

  function _destroyParticles() {
    if (_particleSystem) {
      scene && scene.remove(_particleSystem);
      _particleSystem.geometry.dispose();
      _particleSystem.material.dispose();
      _particleSystem = null;
    }
    _particlePositions = null;
    _particleVelocities = null;
    _particleDef = null;
  }

  function _updateParticles(dt) {
    if (!_particleSystem || !_particlePositions) return;
    const count = _particleSystem.count;
    const def   = _particleDef;
    if (!def) return;

    // wind turbulence offset
    const windX = def.type === 'wind'
      ? Math.sin(_windPhase * 1.4) * def.speed * dt
      : (WEATHERS[current]?.wind || 0) * Math.sin(_windPhase * 0.8) * 0.8 * dt;

    for (let i = 0; i < count; i++) {
      _particlePositions[i*3]   += _particleVelocities[i*3]   * dt + windX;
      _particlePositions[i*3+1] += _particleVelocities[i*3+1] * dt;
      _particlePositions[i*3+2] += _particleVelocities[i*3+2] * dt;

      // Respawn at top when drops hit floor
      if (_particlePositions[i*3+1] < -0.5) {
        _particlePositions[i*3]   = (Math.random() - 0.5) * 18;
        _particlePositions[i*3+1] = 13 + Math.random() * 2;
        _particlePositions[i*3+2] = (Math.random() - 0.5) * 18;
      }
      // Wrap X/Z
      if (Math.abs(_particlePositions[i*3])   > 10) _particlePositions[i*3]   *= -0.9;
      if (Math.abs(_particlePositions[i*3+2]) > 10) _particlePositions[i*3+2] *= -0.9;

      _dummy.position.set(
        _particlePositions[i*3],
        _particlePositions[i*3+1],
        _particlePositions[i*3+2]
      );

      if (def.type === 'rain') {
        // Tilt rain in wind direction
        const windTilt = (WEATHERS[current]?.wind || 0) * 0.18;
        _dummy.rotation.set(windTilt, 0, 0);
      } else if (def.type === 'snow') {
        _dummy.rotation.set(
          Math.sin(_windPhase + i * 0.3) * 0.3,
          _windPhase * 0.2 + i * 0.1,
          Math.cos(_windPhase + i * 0.5) * 0.3
        );
      } else {
        _dummy.rotation.set(0, 0, Math.PI * 0.5);
      }

      _dummy.updateMatrix();
      _particleSystem.setMatrixAt(i, _dummy.matrix);
    }
    _particleSystem.instanceMatrix.needsUpdate = true;
  }

  // ── Puddle (wet floor reflection plane) ────────
  function _buildPuddle() {
    if (_puddleMesh) return;
    const geo = new THREE.PlaneGeometry(16, 16, 1, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x445566,
      metalness: 0.3,
      roughness: 0.05,
      transparent: true,
      opacity: 0,
      envMapIntensity: 1.5
    });
    _puddleMesh = new THREE.Mesh(geo, mat);
    _puddleMesh.rotation.x = -Math.PI / 2;
    _puddleMesh.position.y = 0.001; // just above floor
    _puddleMesh.receiveShadow = false;
    scene && scene.add(_puddleMesh);
  }

  function _updatePuddle(dt) {
    if (!_puddleMesh) return;
    const targetOpacity = _wetness * 0.35;
    _puddleMesh.material.opacity = HomeUtils.lerp(_puddleMesh.material.opacity, targetOpacity, 3 * dt);
    _puddleMesh.material.roughness = HomeUtils.lerp(_puddleMesh.material.roughness, 0.05 + (1 - _wetness) * 0.7, 2 * dt);
    _puddleMesh.visible = _puddleMesh.material.opacity > 0.005;
  }

  // ── Thunder & Lightning ─────────────────────────
  function _triggerLightning() {
    if (!scene) return;
    _lightningFlashTimer = 0.12; // seconds of bright flash

    // Flash the whole scene via a brief ambient spike
    if (window.HomeLighting) {
      const lights = HomeLighting.getAll();
      if (lights.ambient) {
        const orig = lights.ambient.intensity;
        lights.ambient.intensity = 8.0;
        setTimeout(() => {
          if (lights.ambient) lights.ambient.intensity = orig;
        }, 80);
        // Double flash
        setTimeout(() => {
          if (lights.ambient) {
            lights.ambient.intensity = 5.0;
            setTimeout(() => { if (lights.ambient) lights.ambient.intensity = orig; }, 60);
          }
        }, 160);
      }
    }

    // Notify window_system for window flashes
    window.dispatchEvent(new CustomEvent('home:lightning', { detail: { intensity: 1.0 } }));

    // Notify audio
    if (window.HomeAmbientAudio && HomeAmbientAudio.onThunder) {
      HomeAmbientAudio.onThunder();
    }
  }

  // ── Apply weather config to scene ──────────────
  function _applyWeatherConfig(w, immediate = false) {
    const cfg = WEATHERS[w];
    if (!cfg || !scene) return;

    // Fog
    if (scene.fog) {
      scene.fog.color.setHex(cfg.fog.color);
      if (immediate) {
        scene.fog.density = cfg.fog.density;
      } else {
        // Lerped in update()
        _fogTarget = cfg.fog.density;
      }
    }

    // Lighting tint
    if (cfg.lightTint && window.HomeLighting) {
      const lights = HomeLighting.getAll();
      if (cfg.lightTint.ambient && lights.ambient) {
        lights.ambient.color.setHex(cfg.lightTint.ambient);
      }
      if (cfg.lightTint.sun !== undefined && lights.sun) {
        lights.sun.intensity = Math.max(0.1, (lights.sun.intensity * cfg.lightTint.sun));
      }
    }

    // Target wetness
    _targetWetness = cfg.wetness;

    // Particles
    if (cfg.particles) {
      _buildParticles(cfg.particles);
    } else {
      _destroyParticles();
    }

    // Dispatch event for sky.js / window_system.js
    window.dispatchEvent(new CustomEvent('home:weatherChange', { detail: { weather: w, cfg } }));
  }

  let _fogTarget = 0.008;

  // ── Public API ─────────────────────────────────
  function setWeather(w, immediate = false) {
    if (!WEATHERS[w]) { console.warn('[HomeWeather] Unknown weather:', w); return; }
    current = w;
    transitioning = !immediate;
    _applyWeatherConfig(w, immediate);

    // Persist (reuse existing settings save)
    const cid = HomeUtils.getCoupleId();
    if (cid && window.HomeAPI) {
      HomeAPI.settings.save(cid, { weather: w }).catch(() => {});
    }

    // Broadcast to partner via realtime
    if (window.HomeRealtimeLiving && HomeRealtimeLiving.broadcastEnvChange) {
      HomeRealtimeLiving.broadcastEnvChange({ weather: w });
    }
  }

  function getCurrent()    { return current; }
  function getWetness()    { return _wetness; }
  function getDefinition(w){ return WEATHERS[w] || null; }
  function listAll()       { return Object.entries(WEATHERS).map(([key, v]) => ({ key, label: v.label, icon: v.icon })); }

  function init(threeScene) {
    scene = threeScene;
    _buildPuddle();
    _fogTarget = scene.fog ? scene.fog.density : 0.008;
  }

  function update(dt) {
    _windPhase += dt * 1.2;

    // Lerp wetness
    _wetness = HomeUtils.lerp(_wetness, _targetWetness, dt * 0.4);

    // Lerp fog density
    if (scene && scene.fog) {
      scene.fog.density = HomeUtils.lerp(scene.fog.density, _fogTarget, dt * 0.8);
    }

    // Update particles
    _updateParticles(dt);

    // Update puddle
    _updatePuddle(dt);

    // Thunder for thunderstorm
    if (current === 'thunderstorm') {
      _thunderTimer -= dt;
      if (_thunderTimer <= 0) {
        _thunderTimer = 4 + Math.random() * 12; // next thunder in 4-16s
        if (Math.random() < 0.7) _triggerLightning();
      }
    }
  }

  function dispose() {
    _destroyParticles();
    if (_puddleMesh) {
      scene && scene.remove(_puddleMesh);
      _puddleMesh.geometry.dispose();
      _puddleMesh.material.dispose();
      _puddleMesh = null;
    }
  }

  return {
    init, update, dispose,
    setWeather, getCurrent, getWetness, getDefinition, listAll,
    WEATHERS
  };
})();

window.HomeWeather = HomeWeather;