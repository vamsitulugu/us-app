// public/home/sky.js
// ════════════════════════════════════════════════
//  Sky — Phase 7, Features 2 & 3
//  Day/Night cycle with moving sun & moon,
//  dynamic skybox gradient, moving clouds,
//  stars, moon phases, shooting stars, aurora,
//  rainbow after rain. Automatic lighting changes
//  via HomeLighting. NEW MODULE — reuses HomeLighting,
//  HomeScene, HomeWeather. Does NOT modify any
//  Phase 1–6 module.
// ════════════════════════════════════════════════
const HomeSky = (() => {

  let scene = null;

  // ── Time of Day phases ─────────────────────────
  // Each phase: sky gradient top/bottom, sun/moon
  // positions, fog colour, lighting config key.
  const TOD_PHASES = {
    midnight:  { t: 0.00, skyTop: 0x010108, skyBot: 0x020212, fogColor: 0x010108, sunIntensity: 0,    moonIntensity: 0.6,  starAlpha: 1.0, label: 'Midnight' },
    predawn:   { t: 0.17, skyTop: 0x03050f, skyBot: 0x0d1a35, fogColor: 0x03050f, sunIntensity: 0,    moonIntensity: 0.3,  starAlpha: 0.7, label: 'Pre-Dawn' },
    sunrise:   { t: 0.25, skyTop: 0x1a1060, skyBot: 0xff6b35, fogColor: 0x7a3520, sunIntensity: 0.6,  moonIntensity: 0,    starAlpha: 0.0, label: 'Sunrise'  },
    morning:   { t: 0.33, skyTop: 0x4a90d9, skyBot: 0xffd4a0, fogColor: 0xc0d8f0, sunIntensity: 1.5,  moonIntensity: 0,    starAlpha: 0.0, label: 'Morning'  },
    noon:      { t: 0.50, skyTop: 0x1e90ff, skyBot: 0x87ceeb, fogColor: 0xd0e8f0, sunIntensity: 2.2,  moonIntensity: 0,    starAlpha: 0.0, label: 'Noon'     },
    afternoon: { t: 0.62, skyTop: 0x1c7ed6, skyBot: 0xaed6f1, fogColor: 0xc8e0f0, sunIntensity: 1.8,  moonIntensity: 0,    starAlpha: 0.0, label: 'Afternoon'},
    golden:    { t: 0.72, skyTop: 0x7b3f00, skyBot: 0xffaa44, fogColor: 0x5a2800, sunIntensity: 1.2,  moonIntensity: 0,    starAlpha: 0.0, label: 'Golden Hr'},
    sunset:    { t: 0.79, skyTop: 0x3d1c02, skyBot: 0xff5500, fogColor: 0x3d1c02, sunIntensity: 0.7,  moonIntensity: 0,    starAlpha: 0.0, label: 'Sunset'   },
    evening:   { t: 0.85, skyTop: 0x0d0a30, skyBot: 0x7b3f6e, fogColor: 0x0d0a20, sunIntensity: 0,    moonIntensity: 0.4,  starAlpha: 0.3, label: 'Evening'  },
    night:     { t: 0.92, skyTop: 0x040415, skyBot: 0x080830, fogColor: 0x040415, sunIntensity: 0,    moonIntensity: 0.8,  starAlpha: 1.0, label: 'Night'    }
  };

  // Current normalized time 0–1 (0 = midnight, 0.5 = noon)
  let _time       = 0.50;   // start at noon
  let _autoAdvance = false; // set true for real-time auto cycle
  let _dayDuration = 600;   // seconds for a full day cycle (auto mode)
  let _elapsed    = 0;

  // ── Sky mesh (large sphere, back-face culled inward) ──
  let _skyMesh    = null;
  let _skyMat     = null;

  // ── Sun & Moon ────────────────────────────────
  let _sunMesh    = null;
  let _moonMesh   = null;
  let _sunLight   = null;   // DirectionalLight for sky-driven sun
  let _moonLight  = null;

  // ── Stars ─────────────────────────────────────
  let _starsMesh  = null;
  let _starCount  = 2000;

  // ── Clouds ────────────────────────────────────
  let _clouds     = [];
  const CLOUD_COUNT = 12;

  // ── Shooting stars ────────────────────────────
  let _shootingStars = [];
  let _shootTimer    = 8;

  // ── Aurora ────────────────────────────────────
  let _auroraMesh    = null;
  let _auroraActive  = false;
  let _auroraTimer   = 0;

  // ── Rainbow ───────────────────────────────────
  let _rainbowMesh   = null;
  let _rainbowAlpha  = 0;
  let _rainbowTarget = 0;

  // ── Moon phase (0=new, 0.5=full, 1=new again) ─
  let _moonPhase = 0.5; // full by default, updates daily

  // ─────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────
  function _lerpColor(c1, c2, t) {
    const r1 = (c1 >> 16) & 0xff, g1 = (c1 >> 8) & 0xff, b1 = c1 & 0xff;
    const r2 = (c2 >> 16) & 0xff, g2 = (c2 >> 8) & 0xff, b2 = c2 & 0xff;
    return (
      (Math.round(r1 + (r2 - r1) * t) << 16) |
      (Math.round(g1 + (g2 - g1) * t) << 8)  |
       Math.round(b1 + (b2 - b1) * t)
    );
  }

  function _getPhasesAtTime(t) {
    const phases = Object.values(TOD_PHASES).sort((a, b) => a.t - b.t);
    let prev = phases[phases.length - 1];
    let next = phases[0];
    for (let i = 0; i < phases.length; i++) {
      if (phases[i].t <= t) prev = phases[i];
      if (phases[i].t > t)  { next = phases[i]; break; }
    }
    const span = next.t > prev.t ? next.t - prev.t : (1.0 - prev.t) + next.t;
    const local = next.t > prev.t ? t - prev.t : (t >= prev.t ? t - prev.t : 1.0 - prev.t + t);
    const alpha = span > 0 ? local / span : 0;
    return { prev, next, alpha };
  }

  // ─────────────────────────────────────────────
  // SKY MESH — large inverted sphere with vertex shader gradient
  // We fake the gradient by using a custom ShaderMaterial that
  // blends two colours based on uv.y.
  // ─────────────────────────────────────────────
  function _buildSky() {
    const geo = new THREE.SphereGeometry(80, 32, 16);
    _skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uTopColor: { value: new THREE.Color(0x1e90ff) },
        uBotColor: { value: new THREE.Color(0x87ceeb) },
        uSunColor: { value: new THREE.Color(0xfff4c0) },
        uSunDir:   { value: new THREE.Vector3(0, 1, 0) },
        uSunSize:  { value: 0.995 }
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3  uTopColor;
        uniform vec3  uBotColor;
        uniform vec3  uSunColor;
        uniform vec3  uSunDir;
        uniform float uSunSize;
        varying vec3  vWorldPos;
        void main() {
          vec3 dir = normalize(vWorldPos);
          float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 sky = mix(uBotColor, uTopColor, pow(h, 0.7));
          // Sun disc
          float sun = smoothstep(uSunSize, uSunSize + 0.002, dot(dir, normalize(uSunDir)));
          sky = mix(sky, uSunColor, sun * 0.95);
          gl_FragColor = vec4(sky, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false
    });
    _skyMesh = new THREE.Mesh(geo, _skyMat);
    _skyMesh.renderOrder = -100;
    scene.add(_skyMesh);
  }

  // ─────────────────────────────────────────────
  // SUN
  // ─────────────────────────────────────────────
  function _buildSun() {
    const geo = new THREE.SphereGeometry(1.8, 16, 16);
    const mat = new THREE.MeshBasicMaterial({ color: 0xfff4c0, fog: false });
    _sunMesh = new THREE.Mesh(geo, mat);
    _sunMesh.renderOrder = -50;
    scene.add(_sunMesh);

    _sunLight = new THREE.DirectionalLight(0xfff8f0, 0);
    _sunLight.castShadow = false; // HomeLighting already owns the shadow light
    scene.add(_sunLight);
  }

  // ─────────────────────────────────────────────
  // MOON
  // ─────────────────────────────────────────────
  function _buildMoon() {
    const geo = new THREE.SphereGeometry(1.2, 16, 16);
    const mat = new THREE.MeshBasicMaterial({ color: 0xe8f0ff, fog: false });
    _moonMesh = new THREE.Mesh(geo, mat);
    _moonMesh.renderOrder = -49;
    scene.add(_moonMesh);

    _moonLight = new THREE.DirectionalLight(0x3a4a8a, 0);
    _moonLight.castShadow = false;
    scene.add(_moonLight);
  }

  // ─────────────────────────────────────────────
  // STARS
  // ─────────────────────────────────────────────
  function _buildStars() {
    const positions = new Float32Array(_starCount * 3);
    const sizes     = new Float32Array(_starCount);
    for (let i = 0; i < _starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      const r     = 75;
      positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = Math.abs(r * Math.cos(phi)) + 10; // upper hemisphere
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      sizes[i] = 0.5 + Math.random() * 1.5;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('size',     new THREE.BufferAttribute(sizes, 1));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      sizeAttenuation: false,
      size: 1.2,
      transparent: true,
      opacity: 0,
      fog: false,
      depthWrite: false
    });
    _starsMesh = new THREE.Points(geo, mat);
    _starsMesh.renderOrder = -90;
    scene.add(_starsMesh);
  }

  // ─────────────────────────────────────────────
  // CLOUDS
  // ─────────────────────────────────────────────
  function _buildClouds() {
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const cloud = _makeCloud();
      _clouds.push(cloud);
      scene.add(cloud.group);
    }
  }

  function _makeCloud() {
    const group = new THREE.Group();
    const puffs = 3 + Math.floor(Math.random() * 4);
    const mat   = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55 + Math.random() * 0.25,
      depthWrite: false,
      fog: false
    });
    for (let p = 0; p < puffs; p++) {
      const r   = 1.8 + Math.random() * 2.5;
      const geo = new THREE.SphereGeometry(r, 7, 5);
      const mesh = new THREE.Mesh(geo, mat.clone());
      mesh.position.set(p * 2.5 - puffs * 1.2, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 2);
      mesh.scale.set(1, 0.5 + Math.random() * 0.3, 0.7);
      group.add(mesh);
    }
    const angle = Math.random() * Math.PI * 2;
    const dist  = 30 + Math.random() * 35;
    group.position.set(Math.cos(angle) * dist, 18 + Math.random() * 10, Math.sin(angle) * dist);
    group.userData.speed  = (0.4 + Math.random() * 0.8) * (Math.random() < 0.5 ? 1 : -1);
    group.userData.angle  = angle;
    group.userData.dist   = dist;
    group.userData.orbitY = group.position.y;
    group.userData.opacity = mat.opacity;
    group.userData.visible = true;
    return { group, angle, speed: group.userData.speed, dist, orbitY: group.userData.orbitY };
  }

  function _updateClouds(dt, weatherKey) {
    const cloudOpacity = _getCloudinessForWeather(weatherKey);
    _clouds.forEach(c => {
      c.angle += c.speed * dt * 0.008;
      c.group.position.x = Math.cos(c.angle) * c.dist;
      c.group.position.z = Math.sin(c.angle) * c.dist;
      c.group.children.forEach(m => {
        m.material.opacity = HomeUtils.lerp(m.material.opacity, cloudOpacity * c.group.userData.opacity, dt * 0.5);
        m.material.visible = m.material.opacity > 0.02;
      });
    });
  }

  function _getCloudinessForWeather(w) {
    const map = { clear: 0.05, cloudy: 0.9, drizzle: 0.75, rain: 0.85,
                  heavyrain: 0.95, thunderstorm: 1.0, snow: 0.8,
                  fog: 0.5, wind: 0.4, sunset: 0.3, night: 0.1 };
    return map[w] !== undefined ? map[w] : 0.3;
  }

  // ─────────────────────────────────────────────
  // SHOOTING STARS
  // ─────────────────────────────────────────────
  function _spawnShootingStar() {
    const startTheta = Math.random() * Math.PI * 2;
    const start = new THREE.Vector3(
      Math.cos(startTheta) * 60,
      35 + Math.random() * 20,
      Math.sin(startTheta) * 60
    );
    const end = start.clone().add(new THREE.Vector3(
      (Math.random() - 0.5) * 30,
      -(15 + Math.random() * 15),
      (Math.random() - 0.5) * 30
    ));
    const points = [start, end];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.9,
      linewidth: 1, fog: false, depthWrite: false
    });
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    _shootingStars.push({ line, start: start.clone(), end: end.clone(), t: 0, speed: 1.5 + Math.random() });
  }

  function _updateShootingStars(dt, starAlpha) {
    _shootTimer -= dt;
    if (_shootTimer <= 0 && starAlpha > 0.5) {
      _shootTimer = 6 + Math.random() * 18;
      _spawnShootingStar();
    }
    for (let i = _shootingStars.length - 1; i >= 0; i--) {
      const s = _shootingStars[i];
      s.t += dt * s.speed;
      s.line.material.opacity = Math.max(0, 0.9 - s.t * 0.9);
      if (s.t >= 1 || s.line.material.opacity <= 0.01) {
        scene.remove(s.line);
        s.line.geometry.dispose();
        s.line.material.dispose();
        _shootingStars.splice(i, 1);
      }
    }
  }

  // ─────────────────────────────────────────────
  // AURORA
  // ─────────────────────────────────────────────
  function _buildAurora() {
    const geo = new THREE.PlaneGeometry(120, 20, 20, 10);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:    { value: 0 },
        uAlpha:   { value: 0 },
        uColor1:  { value: new THREE.Color(0x00ff88) },
        uColor2:  { value: new THREE.Color(0x8800ff) }
      },
      vertexShader: `
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 p = position;
          p.y += sin(p.x * 0.08 + uTime * 0.6) * 3.0
               + sin(p.x * 0.15 + uTime * 1.1) * 1.5;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uAlpha;
        uniform vec3  uColor1;
        uniform vec3  uColor2;
        varying vec2  vUv;
        void main() {
          float stripe = sin(vUv.x * 8.0) * 0.5 + 0.5;
          vec3 col = mix(uColor1, uColor2, stripe);
          float edge = sin(vUv.y * 3.14159);
          gl_FragColor = vec4(col, uAlpha * edge * 0.55);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false
    });
    _auroraMesh = new THREE.Mesh(geo, mat);
    _auroraMesh.position.set(0, 45, -70);
    _auroraMesh.rotation.x = -0.15;
    _auroraMesh.renderOrder = -80;
    scene.add(_auroraMesh);
  }

  function triggerAurora(duration = 30) {
    _auroraActive = true;
    _auroraTimer  = duration;
  }

  function _updateAurora(dt, starAlpha) {
    if (!_auroraMesh) return;
    _auroraMesh.material.uniforms.uTime.value += dt;
    if (_auroraActive) {
      _auroraTimer -= dt;
      if (_auroraTimer <= 0) _auroraActive = false;
    }
    const targetAlpha = _auroraActive && starAlpha > 0.4 ? 1.0 : 0.0;
    const cur = _auroraMesh.material.uniforms.uAlpha.value;
    _auroraMesh.material.uniforms.uAlpha.value = HomeUtils.lerp(cur, targetAlpha, dt * 0.4);
  }

  // ─────────────────────────────────────────────
  // RAINBOW
  // ─────────────────────────────────────────────
  function _buildRainbow() {
    const geo = new THREE.TorusGeometry(28, 0.6, 8, 60, Math.PI);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uAlpha: { value: 0 } },
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: `
        uniform float uAlpha;
        varying vec2 vUv;
        void main() {
          vec3 colors[7];
          colors[0] = vec3(1.0, 0.0, 0.0);
          colors[1] = vec3(1.0, 0.5, 0.0);
          colors[2] = vec3(1.0, 1.0, 0.0);
          colors[3] = vec3(0.0, 1.0, 0.0);
          colors[4] = vec3(0.0, 0.5, 1.0);
          colors[5] = vec3(0.0, 0.0, 1.0);
          colors[6] = vec3(0.6, 0.0, 1.0);
          float band = vUv.x * 6.99;
          int idx = int(band);
          float frac = fract(band);
          vec3 col = mix(colors[idx], colors[min(idx+1, 6)], frac);
          gl_FragColor = vec4(col, uAlpha * 0.5);
        }
      `,
      transparent: true, depthWrite: false,
      side: THREE.DoubleSide, fog: false
    });
    _rainbowMesh = new THREE.Mesh(geo, mat);
    _rainbowMesh.position.set(0, 8, -50);
    _rainbowMesh.rotation.z = Math.PI;
    _rainbowMesh.renderOrder = -70;
    scene.add(_rainbowMesh);
  }

  function _updateRainbow(dt, weatherKey) {
    if (!_rainbowMesh) return;
    // Show rainbow shortly after rain clears
    _rainbowTarget = (weatherKey === 'clear' || weatherKey === 'cloudy') &&
                     _lastWeather && ['rain', 'drizzle', 'heavyrain'].includes(_lastWeather) ? 1 : 0;
    _rainbowAlpha = HomeUtils.lerp(_rainbowAlpha, _rainbowTarget, dt * 0.3);
    _rainbowMesh.material.uniforms.uAlpha.value = _rainbowAlpha;
  }

  let _lastWeather = 'clear';

  // ─────────────────────────────────────────────
  // MOON PHASE
  // ─────────────────────────────────────────────
  function _updateMoonPhase() {
    // Simple 29.5-day cycle mapped to a "day" counter
    const dayNum = Math.floor(Date.now() / 86400000) % 30;
    _moonPhase = dayNum / 29.5; // 0 = new, 0.5 = full
    if (_moonMesh) {
      const brightness = 0.3 + 0.7 * Math.abs(Math.sin(_moonPhase * Math.PI));
      _moonMesh.material.color.setHex(Math.floor(brightness * 0xe8) << 16 | Math.floor(brightness * 0xf0) << 8 | 0xff);
    }
  }

  // ─────────────────────────────────────────────
  // MAIN UPDATE
  // ─────────────────────────────────────────────
  function _applySkyAtTime(t, weatherKey) {
    const { prev, next, alpha } = _getPhasesAtTime(t);

    const skyTop   = _lerpColor(prev.skyTop,  next.skyTop,  alpha);
    const skyBot   = _lerpColor(prev.skyBot,  next.skyBot,  alpha);
    const fogColor = _lerpColor(prev.fogColor, next.fogColor, alpha);
    const sunI     = HomeUtils.lerp(prev.sunIntensity,  next.sunIntensity,  alpha);
    const moonI    = HomeUtils.lerp(prev.moonIntensity, next.moonIntensity, alpha);
    const starA    = HomeUtils.lerp(prev.starAlpha,     next.starAlpha,     alpha);

    // Update sky shader
    if (_skyMat) {
      _skyMat.uniforms.uTopColor.value.setHex(skyTop);
      _skyMat.uniforms.uBotColor.value.setHex(skyBot);
    }

    // Update fog
    if (scene.fog && weatherKey === 'clear') {
      scene.fog.color.setHex(fogColor);
    }

    // Update stars
    if (_starsMesh) _starsMesh.material.opacity = starA;

    // Sun position — arc from east to west over the sky sphere
    const sunAngle = (t - 0.25) * Math.PI * 2; // noon = top
    const sunDist  = 55;
    const sx = Math.cos(sunAngle) * sunDist;
    const sy = Math.sin(sunAngle) * sunDist;
    const sz = -20;
    if (_sunMesh)  {
      _sunMesh.position.set(sx, sy, sz);
      _sunMesh.visible = sy > -5;
      _sunMesh.material.color.setHex(
        t > 0.7 || t < 0.3 ? 0xff6b35 : 0xfff4c0
      );
    }
    if (_skyMat) _skyMat.uniforms.uSunDir.value.set(sx, sy, sz).normalize();

    // Sun auxiliary light (supplements HomeLighting directional which owns shadows)
    if (_sunLight) {
      _sunLight.intensity = sunI * 0.5;
      _sunLight.position.set(sx, sy, sz);
    }

    // Moon position — opposite side from sun
    const moonAngle = sunAngle + Math.PI;
    const mx = Math.cos(moonAngle) * sunDist;
    const my = Math.sin(moonAngle) * sunDist;
    if (_moonMesh) {
      _moonMesh.position.set(mx, my, sz);
      _moonMesh.visible = my > -5;
    }
    if (_moonLight) {
      _moonLight.intensity = moonI * 0.5;
      _moonLight.position.set(mx, my, sz);
    }

    // Notify HomeLighting for interior colour lerp
    if (window.HomeLighting) {
      // Map our continuous time to HomeLighting TOD keys
      const todKey = t < 0.22 ? 'night' : t < 0.30 ? 'night' : t < 0.75 ? 'day' : t < 0.87 ? 'sunset' : 'night';
      HomeLighting.setTimeOfDay(todKey);
    }

    return starA;
  }

  // ─────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────
  function init(threeScene) {
    scene = threeScene;
    _buildSky();
    _buildSun();
    _buildMoon();
    _buildStars();
    _buildClouds();
    _buildAurora();
    _buildRainbow();
    _updateMoonPhase();

    // Listen for weather changes from HomeWeather
    window.addEventListener('home:weatherChange', e => {
      _lastWeather = e.detail.weather;
    });

    // Listen for realtime env changes
    window.addEventListener('home:envSync', e => {
      if (e.detail.time !== undefined) setTime(e.detail.time);
    });
  }

  function setTime(normalizedTime) {
    _time = ((normalizedTime % 1) + 1) % 1;
  }

  function setTimeOfDay(todKey) {
    const map = { midnight: 0.0, predawn: 0.17, sunrise: 0.25, morning: 0.33,
                  noon: 0.50, afternoon: 0.62, golden: 0.72, sunset: 0.79,
                  evening: 0.85, night: 0.92 };
    if (map[todKey] !== undefined) _time = map[todKey];
  }

  function setAutoAdvance(enabled, dayDurationSeconds = 600) {
    _autoAdvance    = enabled;
    _dayDuration    = dayDurationSeconds;
  }

  function getTime()      { return _time; }
  function getMoonPhase() { return _moonPhase; }

  function getTODLabel() {
    const phases = Object.values(TOD_PHASES).sort((a, b) => a.t - b.t);
    let best = phases[0];
    for (const p of phases) { if (p.t <= _time) best = p; }
    return best.label;
  }

  function update(dt) {
    if (_autoAdvance) {
      _elapsed += dt;
      _time = (_elapsed / _dayDuration) % 1;
    }

    const weatherKey = window.HomeWeather ? HomeWeather.getCurrent() : 'clear';
    const starAlpha  = _applySkyAtTime(_time, weatherKey);

    _updateClouds(dt, weatherKey);
    _updateShootingStars(dt, starAlpha);
    _updateAurora(dt, starAlpha);
    _updateRainbow(dt, weatherKey);
  }

  function dispose() {
    const objs = [_skyMesh, _sunMesh, _moonMesh, _starsMesh, _auroraMesh, _rainbowMesh];
    objs.forEach(o => {
      if (o) { scene.remove(o); o.geometry && o.geometry.dispose(); o.material && o.material.dispose(); }
    });
    _clouds.forEach(c => {
      scene.remove(c.group);
      c.group.children.forEach(m => { m.geometry.dispose(); m.material.dispose(); });
    });
    _clouds = [];
    _shootingStars.forEach(s => { scene.remove(s.line); s.line.geometry.dispose(); s.line.material.dispose(); });
    _shootingStars = [];
    if (_sunLight)  scene.remove(_sunLight);
    if (_moonLight) scene.remove(_moonLight);
  }

  return {
    init, update, dispose,
    setTime, setTimeOfDay, setAutoAdvance,
    triggerAurora,
    getTime, getMoonPhase, getTODLabel,
    TOD_PHASES
  };
})();

window.HomeSky = HomeSky;