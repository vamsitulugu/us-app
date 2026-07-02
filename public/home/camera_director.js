// public/home/camera_director.js
// ════════════════════════════════════════════════
//  Camera Director — Phase 8
//  Cinematic camera system: idle orbit, conversation
//  focus, interaction zoom, pet follow, furniture
//  focus, smooth interpolated transitions.
//  Works alongside HomeControls — overrides target
//  position/lookAt during automated shots, then
//  hands back to user orbit when idle.
// ════════════════════════════════════════════════
const HomeCameraDirector = (() => {

  // ── Camera modes ────────────────────────────────
  const MODES = {
    orbit:        'orbit',        // default orbit (user-controlled)
    conversation: 'conversation', // focus on both avatars talking
    interaction:  'interaction',  // zoom into active interaction
    petFollow:    'petFollow',    // soft-follow an active pet
    furnitureFocus:'furnitureFocus', // establish shot at a furniture piece
    cinematicIdle:'cinematicIdle',  // slow drift, dramatic framing
    sunrise:      'sunrise',       // pan across windows at dawn
    arrival:      'arrival'        // partner enters — establish their avatar
  };

  let _camera       = null;
  let _scene        = null;
  let _mode         = MODES.orbit;
  let _prevMode     = MODES.orbit;
  let _transitioning = false;
  let _transitionT   = 0;
  let _transitionDur = 1.8; // seconds

  // Target / current camera transform (lerped)
  const _cur = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const _tgt = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const _pre = { pos: new THREE.Vector3(), look: new THREE.Vector3() }; // pre-transition start

  let _orbitControlsEnabled = true;
  let _autoReturnTimer = 0;  // seconds before returning to orbit after override
  let _idleDrift = 0;        // phase for cinematic idle slow drift
  let _petTarget  = null;    // Three.js Object3D to follow

  // ── Orbital idle keyframes ────────────────────
  // Slow cinematic points that cycle during long idle
  const ORBIT_KEYFRAMES = [
    { pos: new THREE.Vector3( 4,  3.5,  6), look: new THREE.Vector3(0, 1, 0) },
    { pos: new THREE.Vector3(-5,  2.8,  4), look: new THREE.Vector3(0, 1, 0) },
    { pos: new THREE.Vector3( 2,  4.5, -3), look: new THREE.Vector3(0, 1, 0) },
    { pos: new THREE.Vector3(-3,  2.5, -5), look: new THREE.Vector3(0, 1, 0) },
    { pos: new THREE.Vector3( 0,  5.0,  5), look: new THREE.Vector3(0, 1, 0) }
  ];
  let _orbitKeyIdx = 0;
  let _orbitKeyTimer = 0;
  const ORBIT_KEY_DURATION = 12; // seconds per keyframe

  // ── Smooth easing ─────────────────────────────
  function _easeInOut(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  function _lerp3(out, a, b, t) {
    out.x = a.x + (b.x - a.x) * t;
    out.y = a.y + (b.y - a.y) * t;
    out.z = a.z + (b.z - a.z) * t;
  }

  // ── Start a transition to a new mode ──────────
  function _startTransition(newMode, duration = 1.8) {
    if (_mode === newMode && !_transitioning) return;
    _prevMode        = _mode;
    _mode            = newMode;
    _transitioning   = true;
    _transitionT     = 0;
    _transitionDur   = duration;
    _pre.pos.copy(_camera.position);
    const lookAt = new THREE.Vector3();
    // Approximate current lookAt from camera direction
    _camera.getWorldDirection(lookAt);
    _pre.look.copy(_camera.position).add(lookAt.multiplyScalar(4));
    _computeTarget(newMode);
    HomeStateManager.setCameraMode(newMode);
  }

  // ── Compute target pos/look for a mode ─────────
  function _computeTarget(mode) {
    const u1 = window.HomeAvatars ? HomeAvatars.get('user1') : null;
    const u2 = window.HomeAvatars ? HomeAvatars.get('user2') : null;
    const p1 = u1 ? u1.state.position : new THREE.Vector3(0, 0, 0);
    const p2 = u2 ? u2.state.position : new THREE.Vector3(1, 0, 0);
    const mid = new THREE.Vector3().lerpVectors(p1, p2, 0.5);

    switch (mode) {
      case MODES.conversation: {
        const dist = p1.distanceTo(p2);
        _tgt.pos.set(mid.x, mid.y + 2.0 + dist * 0.3, mid.z + 2.5 + dist * 0.5);
        _tgt.look.copy(mid).add(new THREE.Vector3(0, 1.2, 0));
        break;
      }
      case MODES.interaction: {
        _tgt.pos.set(mid.x + 0.5, mid.y + 1.6, mid.z + 1.8);
        _tgt.look.copy(mid).add(new THREE.Vector3(0, 1.0, 0));
        break;
      }
      case MODES.petFollow: {
        const pet = _petTarget || (window.HomePets && HomePets.getAll ? HomePets.getAll()[0] : null);
        if (pet) {
          const pp = pet.state ? pet.state.position : pet.position;
          _tgt.pos.set(pp.x + 1.5, pp.y + 1.8, pp.z + 2.0);
          _tgt.look.copy(pp).add(new THREE.Vector3(0, 0.5, 0));
        }
        break;
      }
      case MODES.furnitureFocus: {
        _tgt.pos.set(mid.x + 2.5, mid.y + 2.0, mid.z + 3.0);
        _tgt.look.copy(mid).add(new THREE.Vector3(0, 0.8, 0));
        break;
      }
      case MODES.sunrise: {
        _tgt.pos.set(-3.5, 2.5, -2.0);
        _tgt.look.set(-3.0, 2.2, -5.0); // looking toward front window
        break;
      }
      case MODES.arrival: {
        // Show the partner arriving
        _tgt.pos.set(p2.x + 2.0, p2.y + 2.5, p2.z + 3.0);
        _tgt.look.copy(p2).add(new THREE.Vector3(0, 1.5, 0));
        break;
      }
      case MODES.cinematicIdle: {
        const kf = ORBIT_KEYFRAMES[_orbitKeyIdx % ORBIT_KEYFRAMES.length];
        _tgt.pos.copy(kf.pos);
        _tgt.look.copy(mid).add(new THREE.Vector3(0, 1.0, 0));
        break;
      }
      default: // orbit — hand back to HomeControls
        break;
    }
  }

  // ── Disable/enable user orbit controls ─────────
  function _setOrbitControls(enabled) {
    if (_orbitControlsEnabled === enabled) return;
    _orbitControlsEnabled = enabled;
    if (window.HomeControls && HomeControls.setEnabled) {
      HomeControls.setEnabled(enabled);
    }
  }

  // ── Per-frame update ───────────────────────────
  function update(dt) {
    if (!_camera) return;

    const isAutoMode = _mode !== MODES.orbit;

    // Auto-return to orbit after 12 sec of no interaction
    if (isAutoMode) {
      _autoReturnTimer += dt;
      if (_autoReturnTimer > 12 && _mode !== MODES.cinematicIdle) {
        setMode(MODES.orbit);
        return;
      }
    } else {
      _autoReturnTimer = 0;
    }

    // Cinematic idle keyframe progression
    if (_mode === MODES.cinematicIdle) {
      _orbitKeyTimer += dt;
      _idleDrift += dt * 0.15;
      if (_orbitKeyTimer > ORBIT_KEY_DURATION) {
        _orbitKeyTimer = 0;
        _orbitKeyIdx   = (_orbitKeyIdx + 1) % ORBIT_KEYFRAMES.length;
        _computeTarget(MODES.cinematicIdle);
        _startTransition(MODES.cinematicIdle, 4.0);
      }
    }

    // Pet follow: re-compute target each frame
    if (_mode === MODES.petFollow) {
      _computeTarget(MODES.petFollow);
      if (!_transitioning) {
        // Smooth continuous follow
        _camera.position.lerp(_tgt.pos, dt * 1.5);
        _cur.look.lerp(_tgt.look, dt * 1.8);
        _camera.lookAt(_cur.look);
        return;
      }
    }

    // Transition interpolation
    if (_transitioning) {
      _transitionT += dt / _transitionDur;
      const t = _easeInOut(Math.min(_transitionT, 1));
      _lerp3(_cur.pos,  _pre.pos,  _tgt.pos,  t);
      _lerp3(_cur.look, _pre.look, _tgt.look, t);
      _camera.position.copy(_cur.pos);
      _camera.lookAt(_cur.look);
      _setOrbitControls(false);
      if (_transitionT >= 1) {
        _transitioning = false;
        if (_mode === MODES.orbit) _setOrbitControls(true);
      }
    } else if (isAutoMode && _mode !== MODES.petFollow) {
      // Gentle drift — soft re-compute so subjects don't go stale
      _computeTarget(_mode);
      _camera.position.lerp(_tgt.pos, dt * 0.5);
      _cur.look.lerp(_tgt.look, dt * 0.8);
      _camera.lookAt(_cur.look);
      _setOrbitControls(false);
    }
  }

  // ── Public API ─────────────────────────────────
  function setMode(mode, duration) {
    if (!MODES[mode] && mode !== 'orbit') return;
    _autoReturnTimer = 0;
    if (mode === MODES.orbit) {
      if (_mode === MODES.orbit) return;
      _transitioning = false;
      _mode = MODES.orbit;
      _setOrbitControls(true);
      HomeStateManager.setCameraMode('orbit');
      return;
    }
    _startTransition(mode, duration);
  }

  function focusOnFurniture(mesh, duration = 2.0) {
    if (!mesh) return;
    const p = mesh.position;
    _tgt.pos.set(p.x + 2.5, p.y + 2.0, p.z + 3.0);
    _tgt.look.copy(p).add(new THREE.Vector3(0, 0.8, 0));
    _startTransition(MODES.furnitureFocus, duration);
  }

  function followPet(petObj) {
    _petTarget = petObj;
    setMode(MODES.petFollow, 2.0);
  }

  function getMode() { return _mode; }

  function init(camera, scene) {
    _camera = camera;
    _scene  = scene;
    _cur.pos.copy(camera.position);
    _tgt.pos.copy(camera.position);
    _pre.pos.copy(camera.position);

    // Listen for interactions — zoom in
    window.addEventListener('home:interactionTriggered', e => {
      if (e.detail) setMode(MODES.interaction, 1.5);
    });

    // Partner arrives
    window.addEventListener('home:partnerOnline', () => setMode(MODES.arrival, 2.0));

    // Sunrise
    window.addEventListener('home:routinePeriodChange', e => {
      if (e.detail?.period === 'dawn') setMode(MODES.sunrise, 3.0);
    });

    // Idle after 30s of no user input → cinematic
    let _idleTimer = 0;
    const _resetIdle = () => { _idleTimer = 0; if (_mode === MODES.cinematicIdle) setMode(MODES.orbit); };
    window.addEventListener('mousemove',  _resetIdle);
    window.addEventListener('touchstart', _resetIdle);
    window.addEventListener('keydown',    _resetIdle);
    HomeDailyRoutine.onTick(() => {
      _idleTimer += 1 / 60;
      if (_idleTimer > 30 && _mode === MODES.orbit) setMode(MODES.cinematicIdle, 4.0);
    });
  }

  function dispose() {
    _camera = null;
    _scene  = null;
  }

  return { init, update, dispose, setMode, focusOnFurniture, followPet, getMode, MODES };
})();

window.HomeCameraDirector = HomeCameraDirector;
