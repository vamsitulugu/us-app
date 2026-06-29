// public/home/movement.js
// ════════════════════════════════════════════════
//  Movement — Phase 6, Feature 2
//  Walking, running, idle, click-to-move, pathfinding,
//  keyboard movement, mobile joystick, collision.
//  NEW MODULE — does not modify rooms/furniture/memories.
// ════════════════════════════════════════════════
const HomeMovement = (() => {

  let camera   = null;
  let canvas   = null;
  let scene    = null;
  let enabled  = true;

  const WALK_SPEED = 1.6;   // units/sec
  const RUN_SPEED  = 3.4;
  const TURN_RATE  = 8.0;   // rad/sec max turn speed
  const ARRIVE_EPS = 0.06;

  // Per-avatar nav state, keyed by role
  const nav = {
    user1: _freshNav(),
    user2: _freshNav()
  };

  function _freshNav() {
    return {
      path:        [],      // array of THREE.Vector3 waypoints
      pathIndex:   0,
      target:      null,    // final destination (Vector3) or null
      running:     false,
      moving:      false
    };
  }

  // ── Collision: simple AABB obstacle list ─────────
  // Populated optionally via registerObstacle(). rooms.js/furniture.js
  // are NOT modified — this is opt-in for future wiring.
  let obstacles = []; // { minX, maxX, minZ, maxZ }

  function registerObstacle(box3OrMesh) {
    let box;
    if (box3OrMesh.isBox3) box = box3OrMesh;
    else if (box3OrMesh.isObject3D) box = new THREE.Box3().setFromObject(box3OrMesh);
    else return;
    obstacles.push({
      minX: box.min.x, maxX: box.max.x,
      minZ: box.min.z, maxZ: box.max.z
    });
  }

  function clearObstacles() { obstacles = []; }

  function _collidesAt(x, z, radius = 0.28) {
    for (const o of obstacles) {
      if (x + radius > o.minX && x - radius < o.maxX &&
          z + radius > o.minZ && z - radius < o.maxZ) return true;
    }
    return false;
  }

  // ── Simple straight-line pathfinder with obstacle nudge ──
  // Full navmesh pathfinding is overkill for a single-room-at-a-time
  // house; this performs direct-line movement and, if the straight
  // line collides, tries a small set of waypoint detours around the
  // obstacle's bounding box. Good enough for room-scale furniture.
  function computePath(from, to) {
    if (!_segmentBlocked(from, to)) return [to.clone()];

    const blocker = _firstBlockingObstacle(from, to);
    if (!blocker) return [to.clone()];

    const pad = 0.45;
    const corners = [
      new THREE.Vector3(blocker.minX - pad, 0, blocker.minZ - pad),
      new THREE.Vector3(blocker.maxX + pad, 0, blocker.minZ - pad),
      new THREE.Vector3(blocker.minX - pad, 0, blocker.maxZ + pad),
      new THREE.Vector3(blocker.maxX + pad, 0, blocker.maxZ + pad)
    ];
    let best = null, bestDist = Infinity;
    for (const c of corners) {
      if (_segmentBlocked(from, c) || _segmentBlocked(c, to)) continue;
      const d = from.distanceTo(c) + c.distanceTo(to);
      if (d < bestDist) { bestDist = d; best = c; }
    }
    if (best) return [best, to.clone()];
    return [to.clone()];
  }

  function _segmentBlocked(a, b, steps = 10) {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = HomeUtils.lerp(a.x, b.x, t);
      const z = HomeUtils.lerp(a.z, b.z, t);
      if (_collidesAt(x, z)) return true;
    }
    return false;
  }

  function _firstBlockingObstacle(a, b, steps = 10) {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = HomeUtils.lerp(a.x, b.x, t);
      const z = HomeUtils.lerp(a.z, b.z, t);
      for (const o of obstacles) {
        if (x > o.minX - 0.28 && x < o.maxX + 0.28 &&
            z > o.minZ - 0.28 && z < o.maxZ + 0.28) return o;
      }
    }
    return null;
  }

  // ── Public movement commands ──────────────────────
  function moveTo(role, x, z, run = false) {
    const avatar = HomeAvatars.get(role);
    if (!avatar) return;
    const from = avatar.state.position;
    const to   = new THREE.Vector3(x, 0, z);
    const n    = nav[role];
    n.path      = computePath(from, to);
    n.pathIndex = 0;
    n.target    = to;
    n.running   = run;
    n.moving    = true;
  }

  function stop(role) {
    const n = nav[role];
    n.path = []; n.pathIndex = 0; n.target = null; n.moving = false;
    const avatar = HomeAvatars.get(role);
    if (avatar) avatar.play(avatar.state.sitting ? 'sit' : (avatar.state.sleeping ? 'sleep' : 'idle'));
  }

  function gesture(role, animKey) {
    const avatar = HomeAvatars.get(role);
    if (!avatar) return;
    stop(role);
    avatar.playOnce(animKey);
  }

  function sit(role, atPosition) {
    const avatar = HomeAvatars.get(role);
    if (!avatar) return;
    stop(role);
    if (atPosition) avatar.setPosition(atPosition.x, 0, atPosition.z);
    avatar.state.sitting = true;
    avatar.state.sleeping = false;
    avatar.play('sit');
  }

  function standUp(role) {
    const avatar = HomeAvatars.get(role);
    if (!avatar) return;
    avatar.state.sitting = false;
    avatar.state.sleeping = false;
    avatar.play('standUp', 0.25, false);
    setTimeout(() => avatar.play('idle'), 500);
  }

  function sleep(role, atPosition) {
    const avatar = HomeAvatars.get(role);
    if (!avatar) return;
    stop(role);
    if (atPosition) avatar.setPosition(atPosition.x, 0, atPosition.z);
    avatar.state.sleeping = true;
    avatar.state.sitting = false;
    avatar.play('sleep');
  }

  // ── Per-frame update — advances along path ────────
  function _updateRole(role, dt) {
    const avatar = HomeAvatars.get(role);
    const n = nav[role];
    if (!avatar || !n.moving || !n.path.length) return;

    const speed = n.running ? RUN_SPEED : WALK_SPEED;
    const pos   = avatar.state.position;
    const wp    = n.path[n.pathIndex];
    if (!wp) { n.moving = false; return; }

    const dx = wp.x - pos.x, dz = wp.z - pos.z;
    const dist = Math.hypot(dx, dz);

    if (dist < ARRIVE_EPS) {
      n.pathIndex++;
      if (n.pathIndex >= n.path.length) {
        n.moving = false;
        avatar.play('idle', 0.3);
        return;
      }
      return;
    }

    const targetYaw = Math.atan2(dx, dz);
    let curYaw = avatar.state.rotationY;
    let diff = targetYaw - curYaw;
    while (diff >  Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxTurn = TURN_RATE * dt;
    const newYaw = curYaw + HomeUtils.clamp(diff, -maxTurn, maxTurn);
    avatar.setRotationY(newYaw);

    const step = Math.min(speed * dt, dist);
    const moveX = pos.x + Math.sin(newYaw) * step;
    const moveZ = pos.z + Math.cos(newYaw) * step;

    if (!_collidesAt(moveX, moveZ)) {
      avatar.setPosition(moveX, 0, moveZ);
    } else {
      n.moving = false;
      avatar.play('idle', 0.3);
      return;
    }

    avatar.play(n.running ? 'run' : 'walk', 0.2);

    if (window.HomeAudioLiving && HomeAudioLiving.onFootstep) {
      HomeAudioLiving.onFootstep(role, n.running, dt);
    }
  }

  // ── Click-to-move (desktop) ───────────────────────
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const _intersect  = new THREE.Vector3();

  function _onCanvasClick(e) {
    if (!enabled) return;
    const myRole = HomeUtils.getMyRole();
    const raycaster = HomeControls.getRaycaster(e.clientX, e.clientY);
    if (raycaster.ray.intersectPlane(groundPlane, _intersect)) {
      const run = e.shiftKey === true;
      moveTo(myRole, _intersect.x, _intersect.z, run);
      if (window.HomeRealtimeLiving && HomeRealtimeLiving.broadcastMove) {
        HomeRealtimeLiving.broadcastMove(myRole, _intersect.x, _intersect.z, run);
      }
    }
  }

  // ── Keyboard movement (desktop) ───────────────────
  const keys = { w: false, a: false, s: false, d: false, shift: false };

  function _onKeyDown(e) {
    if (!enabled) return;
    const k = e.key.toLowerCase();
    if (k === 'w' || k === 'arrowup')    keys.w = true;
    if (k === 'a' || k === 'arrowleft')  keys.a = true;
    if (k === 's' || k === 'arrowdown')  keys.s = true;
    if (k === 'd' || k === 'arrowright') keys.d = true;
    if (k === 'shift') keys.shift = true;
  }
  function _onKeyUp(e) {
    const k = e.key.toLowerCase();
    if (k === 'w' || k === 'arrowup')    keys.w = false;
    if (k === 'a' || k === 'arrowleft')  keys.a = false;
    if (k === 's' || k === 'arrowdown')  keys.s = false;
    if (k === 'd' || k === 'arrowright') keys.d = false;
    if (k === 'shift') keys.shift = false;
  }

  function _keyboardTick(dt) {
    const anyKey = keys.w || keys.a || keys.s || keys.d;
    if (!anyKey) return;
    const myRole = HomeUtils.getMyRole();
    const avatar = HomeAvatars.get(myRole);
    if (!avatar) return;

    const n = nav[myRole];
    n.moving = false; n.path = [];

    let mx = 0, mz = 0;
    if (keys.w) mz += 1;
    if (keys.s) mz -= 1;
    if (keys.a) mx -= 1;
    if (keys.d) mx += 1;
    if (mx === 0 && mz === 0) return;

    const len = Math.hypot(mx, mz);
    mx /= len; mz /= len;

    const speed = keys.shift ? RUN_SPEED : WALK_SPEED;
    const yaw = Math.atan2(mx, mz);
    avatar.setRotationY(HomeUtils.lerp(avatar.state.rotationY, yaw, 0.25));

    const pos = avatar.state.position;
    const newX = pos.x + mx * speed * dt;
    const newZ = pos.z + mz * speed * dt;
    if (!_collidesAt(newX, newZ)) avatar.setPosition(newX, 0, newZ);
    avatar.play(keys.shift ? 'run' : 'walk', 0.15);

    if (window.HomeAudioLiving && HomeAudioLiving.onFootstep) {
      HomeAudioLiving.onFootstep(myRole, keys.shift, dt);
    }
    if (window.HomeRealtimeLiving && HomeRealtimeLiving.broadcastPosition) {
      HomeRealtimeLiving.broadcastPosition(myRole, newX, newZ, avatar.state.rotationY, keys.shift ? 'run' : 'walk');
    }
  }

  // ── Mobile joystick ────────────────────────────────
  let joystickEl = null, joystickKnob = null;
  let joyActive = false, joyVec = { x: 0, y: 0 };

  function initJoystick(containerEl) {
    if (!containerEl) return;
    joystickEl = containerEl;
    joystickEl.innerHTML = `
      <div class="home-joy-base" style="position:relative;width:96px;height:96px;border-radius:50%;
        background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);
        backdrop-filter:blur(8px);touch-action:none">
        <div class="home-joy-knob" style="position:absolute;width:44px;height:44px;border-radius:50%;
          background:rgba(255,255,255,0.35);border:1px solid rgba(255,255,255,0.5);
          left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none"></div>
      </div>`;
    joystickKnob = joystickEl.querySelector('.home-joy-knob');
    const base = joystickEl.querySelector('.home-joy-base');

    const radius = 36;
    function setKnob(dx, dy) {
      const len = Math.hypot(dx, dy);
      const clampedLen = Math.min(len, radius);
      const ang = Math.atan2(dy, dx);
      const kx = Math.cos(ang) * clampedLen;
      const ky = Math.sin(ang) * clampedLen;
      joystickKnob.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
      joyVec.x = kx / radius;
      joyVec.y = ky / radius;
    }
    function reset() {
      joyActive = false; joyVec.x = 0; joyVec.y = 0;
      joystickKnob.style.transform = 'translate(-50%,-50%)';
    }

    let originX = 0, originY = 0;
    base.addEventListener('touchstart', e => {
      e.preventDefault();
      const t = e.touches[0];
      const rect = base.getBoundingClientRect();
      originX = rect.left + rect.width / 2;
      originY = rect.top + rect.height / 2;
      joyActive = true;
      setKnob(t.clientX - originX, t.clientY - originY);
    }, { passive: false });
    base.addEventListener('touchmove', e => {
      if (!joyActive) return;
      e.preventDefault();
      const t = e.touches[0];
      setKnob(t.clientX - originX, t.clientY - originY);
    }, { passive: false });
    base.addEventListener('touchend', reset, { passive: true });
    base.addEventListener('touchcancel', reset, { passive: true });

    base.addEventListener('mousedown', e => {
      const rect = base.getBoundingClientRect();
      originX = rect.left + rect.width / 2;
      originY = rect.top + rect.height / 2;
      joyActive = true;
      setKnob(e.clientX - originX, e.clientY - originY);
      const mm = (ev) => setKnob(ev.clientX - originX, ev.clientY - originY);
      const mu = () => { reset(); window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
      window.addEventListener('mousemove', mm);
      window.addEventListener('mouseup', mu);
    });
  }

  function _joystickTick(dt) {
    if (!joyActive || (Math.abs(joyVec.x) < 0.08 && Math.abs(joyVec.y) < 0.08)) return;
    const myRole = HomeUtils.getMyRole();
    const avatar = HomeAvatars.get(myRole);
    if (!avatar) return;

    const n = nav[myRole];
    n.moving = false; n.path = [];

    const mx = joyVec.x;
    const mz = -joyVec.y;
    const mag = Math.min(1, Math.hypot(mx, mz));
    if (mag < 0.08) return;

    const running = mag > 0.75;
    const speed = running ? RUN_SPEED : WALK_SPEED;
    const yaw = Math.atan2(mx, mz);
    avatar.setRotationY(HomeUtils.lerp(avatar.state.rotationY, yaw, 0.2));

    const pos = avatar.state.position;
    const newX = pos.x + Math.sin(yaw) * speed * mag * dt;
    const newZ = pos.z + Math.cos(yaw) * speed * mag * dt;
    if (!_collidesAt(newX, newZ)) avatar.setPosition(newX, 0, newZ);
    avatar.play(running ? 'run' : 'walk', 0.15);

    if (window.HomeAudioLiving && HomeAudioLiving.onFootstep) {
      HomeAudioLiving.onFootstep(myRole, running, dt);
    }
    if (window.HomeRealtimeLiving && HomeRealtimeLiving.broadcastPosition) {
      HomeRealtimeLiving.broadcastPosition(myRole, newX, newZ, avatar.state.rotationY, running ? 'run' : 'walk');
    }
  }

  // ── Init / dispose ─────────────────────────────────
  function init(cam, canvasEl, threeScene) {
    camera = cam; canvas = canvasEl; scene = threeScene;
    canvas.addEventListener('click', _onCanvasClick);
    window.addEventListener('keydown', _onKeyDown);
    window.addEventListener('keyup', _onKeyUp);
  }

  function update(dt) {
    if (!enabled) return;
    _keyboardTick(dt);
    _joystickTick(dt);
    _updateRole('user1', dt);
    _updateRole('user2', dt);
  }

  function setEnabled(v) { enabled = v; }

  function dispose() {
    if (canvas) canvas.removeEventListener('click', _onCanvasClick);
    window.removeEventListener('keydown', _onKeyDown);
    window.removeEventListener('keyup', _onKeyUp);
  }

  return {
    init, update, dispose, setEnabled,
    moveTo, stop, gesture, sit, standUp, sleep,
    registerObstacle, clearObstacles,
    initJoystick,
    nav
  };
})();

window.HomeMovement = HomeMovement;