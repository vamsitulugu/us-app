// public/home/controls.js
// ════════════════════════════════════════════════
//  Controls — Orbit (look around) + Furniture drag
// ════════════════════════════════════════════════
const HomeControls = (() => {

  let camera   = null;
  let canvas   = null;
  let scene    = null;
  let enabled  = true;

  // ── Orbit state ──────────────────────────────
  const orbit = {
    theta:      0,        // horizontal angle
    phi:        0.45,     // vertical angle (radians from top)
    radius:     9,        // distance from target
    target:     new THREE.Vector3(0, 1.2, 0),
    minPhi:     0.15,
    maxPhi:     1.35,
    minRadius:  3,
    maxRadius:  16,
    damping:    0.10,     // lerp factor per frame
    // Smooth targets
    _theta:     0,
    _phi:       0.45,
    _radius:    9,
    _target:    new THREE.Vector3(0, 1.2, 0)
  };

  // ── Pointer state ────────────────────────────
  let isPointerDown  = false;
  let lastX = 0, lastY = 0;
  let pointers       = {};    // touch tracking
  let lastPinchDist  = 0;

  // ── Drag (furniture placement) ───────────────
  let dragMode       = false; // set true by furniture module
  let dragObject     = null;
  let dragPlane      = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let dragIntersect  = new THREE.Vector3();
  let dragOffset     = new THREE.Vector3();
  const raycaster    = new THREE.Raycaster();
  const mouse        = new THREE.Vector2();

  // ── Init ─────────────────────────────────────
  function init(cam, canvasEl, threeScene) {
    camera = cam;
    canvas = canvasEl;
    scene  = threeScene;

    // Mouse
    canvas.addEventListener('mousedown',  onMouseDown,   { passive: false });
    canvas.addEventListener('mousemove',  onMouseMove,   { passive: true  });
    canvas.addEventListener('mouseup',    onMouseUp,     { passive: true  });
    canvas.addEventListener('wheel',      onWheel,       { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    // Touch
    canvas.addEventListener('touchstart', onTouchStart,  { passive: false });
    canvas.addEventListener('touchmove',  onTouchMove,   { passive: false });
    canvas.addEventListener('touchend',   onTouchEnd,    { passive: true  });

    return orbit;
  }

  // ── Mouse handlers ───────────────────────────
  function onMouseDown(e) {
    if (!enabled) return;
    if (e.button !== 0) return;   // left only
    isPointerDown = true;
    lastX = e.clientX;
    lastY = e.clientY;

    if (dragMode && dragObject) {
      // handled in move
    }
  }

  function onMouseMove(e) {
    if (!enabled || !isPointerDown) return;

    if (dragMode && dragObject) {
      moveDragObject(e.clientX, e.clientY);
      return;
    }

    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    orbit._theta -= dx * 0.006;
    orbit._phi    = HomeUtils.clamp(orbit._phi + dy * 0.005, orbit.minPhi, orbit.maxPhi);
  }

  function onMouseUp() {
    isPointerDown = false;
    if (dragMode && dragObject) commitDrag();
  }

  function onWheel(e) {
    if (!enabled) return;
    e.preventDefault();
    orbit._radius = HomeUtils.clamp(orbit._radius + e.deltaY * 0.01, orbit.minRadius, orbit.maxRadius);
  }

  // ── Touch handlers ───────────────────────────
  function onTouchStart(e) {
    if (!enabled) return;
    e.preventDefault();
    for (const t of e.changedTouches) pointers[t.identifier] = { x: t.clientX, y: t.clientY };
    const ids = Object.keys(pointers);
    if (ids.length === 1) {
      isPointerDown = true;
      lastX = pointers[ids[0]].x;
      lastY = pointers[ids[0]].y;
    } else if (ids.length === 2) {
      lastPinchDist = getPinchDist();
    }
  }

  function onTouchMove(e) {
    if (!enabled) return;
    e.preventDefault();
    for (const t of e.changedTouches) pointers[t.identifier] = { x: t.clientX, y: t.clientY };
    const ids = Object.keys(pointers);

    if (ids.length === 2) {
      // Pinch zoom
      const dist = getPinchDist();
      const delta = lastPinchDist - dist;
      orbit._radius = HomeUtils.clamp(orbit._radius + delta * 0.015, orbit.minRadius, orbit.maxRadius);
      lastPinchDist = dist;
      return;
    }

    if (!isPointerDown || ids.length !== 1) return;
    const p = pointers[ids[0]];

    if (dragMode && dragObject) {
      moveDragObject(p.x, p.y);
      return;
    }

    const dx = p.x - lastX;
    const dy = p.y - lastY;
    lastX = p.x;
    lastY = p.y;

    orbit._theta -= dx * 0.006;
    orbit._phi    = HomeUtils.clamp(orbit._phi + dy * 0.005, orbit.minPhi, orbit.maxPhi);
  }

  function onTouchEnd(e) {
    for (const t of e.changedTouches) delete pointers[t.identifier];
    if (Object.keys(pointers).length === 0) {
      isPointerDown = false;
      if (dragMode && dragObject) commitDrag();
    }
  }

  function getPinchDist() {
    const ids  = Object.keys(pointers);
    const a    = pointers[ids[0]];
    const b    = pointers[ids[1]];
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  // ── Drag helpers ─────────────────────────────
  function setDragMode(obj) {
    dragMode   = !!obj;
    dragObject = obj || null;
    canvas.style.cursor = obj ? 'grabbing' : 'grab';
  }

  function moveDragObject(cx, cy) {
    if (!dragObject) return;
    _toNDC(cx, cy);
    raycaster.setFromCamera(mouse, camera);
    if (raycaster.ray.intersectPlane(dragPlane, dragIntersect)) {
      dragObject.position.x = Math.round((dragIntersect.x - dragOffset.x) * 4) / 4;
      dragObject.position.z = Math.round((dragIntersect.z - dragOffset.z) * 4) / 4;
    }
  }

  function commitDrag() {
    if (!dragObject) return;
    window.dispatchEvent(new CustomEvent('home:furnitureMoved', { detail: dragObject }));
    dragObject = null;
    dragMode   = false;
    canvas.style.cursor = 'grab';
  }

  function startDrag(obj, cx, cy) {
    dragObject = obj;
    dragMode   = true;
    _toNDC(cx, cy);
    raycaster.setFromCamera(mouse, camera);
    if (raycaster.ray.intersectPlane(dragPlane, dragIntersect)) {
      dragOffset.set(dragIntersect.x - obj.position.x, 0, dragIntersect.z - obj.position.z);
    }
    canvas.style.cursor = 'grabbing';
  }

  function _toNDC(cx, cy) {
    const rect = canvas.getBoundingClientRect();
    mouse.x =  ((cx - rect.left)  / rect.width)  * 2 - 1;
    mouse.y = -((cy - rect.top)   / rect.height)  * 2 + 1;
  }

  // ── Raycasting (for click detection) ─────────
  function getRaycaster(cx, cy) {
    _toNDC(cx, cy);
    raycaster.setFromCamera(mouse, camera);
    return raycaster;
  }

  // ── Per-frame update (called by scene loop) ──
  function update(dt) {
    if (!camera) return;

    // Smooth orbit angles
    const a = 1 - Math.pow(orbit.damping, dt * 60);
    orbit.theta  = HomeUtils.lerp(orbit.theta,  orbit._theta,  a);
    orbit.phi    = HomeUtils.lerp(orbit.phi,    orbit._phi,    a);
    orbit.radius = HomeUtils.lerp(orbit.radius, orbit._radius, a);
    orbit.target.lerp(orbit._target, a * 0.5);

    // Spherical to Cartesian
    const x = orbit.radius * Math.sin(orbit.phi) * Math.sin(orbit.theta);
    const y = orbit.radius * Math.cos(orbit.phi);
    const z = orbit.radius * Math.sin(orbit.phi) * Math.cos(orbit.theta);

    camera.position.set(
      orbit.target.x + x,
      orbit.target.y + y,
      orbit.target.z + z
    );
    camera.lookAt(orbit.target);
  }

  // ── Snap to room preset ──────────────────────
  function snapToRoom(roomName) {
    const presets = {
      living:   { theta: 0,    phi: 0.45, radius: 9,  tx: 0, ty: 1.2, tz: 0  },
      bedroom:  { theta: 0,    phi: 0.45, radius: 8,  tx: 0, ty: 1.2, tz: 0  },
      kitchen:  { theta: 0.3,  phi: 0.42, radius: 8,  tx: 0, ty: 1.2, tz: 0  },
      garden:   { theta: 0,    phi: 0.38, radius: 11, tx: 0, ty: 0.5, tz: 0  },
      gameroom: { theta: 0,    phi: 0.45, radius: 8,  tx: 0, ty: 1.2, tz: 0  },
      music:    { theta: -0.2, phi: 0.45, radius: 8,  tx: 0, ty: 1.2, tz: 0  },
      library:  { theta: 0.2,  phi: 0.42, radius: 8,  tx: 0, ty: 1.2, tz: 0  },
      petroom:  { theta: 0,    phi: 0.45, radius: 8,  tx: 0, ty: 1.2, tz: 0  },
      rooftop:  { theta: 0,    phi: 0.35, radius: 12, tx: 0, ty: 1.0, tz: 0  }
    };
    const p = presets[roomName] || presets.living;
    orbit._theta  = p.theta;
    orbit._phi    = p.phi;
    orbit._radius = p.radius;
    orbit._target.set(p.tx, p.ty, p.tz);
  }

  function setEnabled(v) { enabled = v; }

  function dispose() {
    canvas.removeEventListener('mousedown',  onMouseDown);
    canvas.removeEventListener('mousemove',  onMouseMove);
    canvas.removeEventListener('mouseup',    onMouseUp);
    canvas.removeEventListener('wheel',      onWheel);
    canvas.removeEventListener('touchstart', onTouchStart);
    canvas.removeEventListener('touchmove',  onTouchMove);
    canvas.removeEventListener('touchend',   onTouchEnd);
    camera = null; canvas = null; scene = null;
  }

  return { init, update, snapToRoom, setDragMode, startDrag, getRaycaster, setEnabled, dispose };
})();

window.HomeControls = HomeControls;
