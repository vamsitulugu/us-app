// public/home/camera.js
// ════════════════════════════════════════════════
//  Camera — Perspective camera + smooth interpolation
// ════════════════════════════════════════════════
const HomeCamera = (() => {

  let camera   = null;
  let target   = new THREE.Vector3(0, 1, 0);   // look-at
  let _target  = new THREE.Vector3(0, 1, 0);   // smoothed

  // Default per-room presets (set by controls module)
  const PRESETS = {
    living:  { pos: new THREE.Vector3( 0,   4.5, 9),   look: new THREE.Vector3(0, 1,  0)   },
    bedroom: { pos: new THREE.Vector3( 0,   4,   8),   look: new THREE.Vector3(0, 1,  0)   },
    kitchen: { pos: new THREE.Vector3(-1,   4,   8),   look: new THREE.Vector3(0, 1, -1)   },
    garden:  { pos: new THREE.Vector3( 0,   5,  10),   look: new THREE.Vector3(0, 0,  0)   },
    gameroom:{ pos: new THREE.Vector3( 0,   4,   8),   look: new THREE.Vector3(0, 1,  0)   },
    music:   { pos: new THREE.Vector3( 0,   4,   8),   look: new THREE.Vector3(0, 1,  0)   },
    library: { pos: new THREE.Vector3( 0,   4,   8),   look: new THREE.Vector3(0, 1,  0)   },
    petroom: { pos: new THREE.Vector3( 0,   4,   8),   look: new THREE.Vector3(0, 1,  0)   },
    rooftop: { pos: new THREE.Vector3( 0,   5,  10),   look: new THREE.Vector3(0, 1,  0)   }
  };

  function init() {
    camera = new THREE.PerspectiveCamera(
      55,                                          // FOV
      window.innerWidth / window.innerHeight,      // aspect
      0.1,                                         // near
      200                                          // far
    );

    // Start at living room preset
    const p = PRESETS.living;
    camera.position.copy(p.pos);
    target.copy(p.look);
    _target.copy(p.look);
    camera.lookAt(_target);

    window.addEventListener('home:resize', onResize);
    return camera;
  }

  function onResize() {
    if (!camera) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }

  // Smoothly transition camera to a room preset
  function goToRoom(roomName, immediate = false) {
    const p = PRESETS[roomName] || PRESETS.living;
    if (immediate) {
      camera.position.copy(p.pos);
      target.copy(p.look);
      _target.copy(p.look);
      camera.lookAt(_target);
    } else {
      // Animate — controls module calls update() each frame
      _camTarget.copy(p.pos);
      _lookTarget.copy(p.look);
    }
  }

  // Smooth camera destinations (lerped in update)
  let _camTarget  = new THREE.Vector3(0, 4.5, 9);
  let _lookTarget = new THREE.Vector3(0, 1, 0);

  // Called every frame by scene render loop
  function update(dt) {
    if (!camera) return;
    const alpha = 1 - Math.pow(0.05, dt);            // frame-rate independent damping
    camera.position.lerp(_camTarget, alpha);
    target.lerp(_lookTarget, alpha);
    camera.lookAt(target);
  }

  function get()   { return camera; }

  // Override camera look-at target externally (for orbit controls)
  function setLookTarget(v3) { _lookTarget.copy(v3); }
  function setCamTarget(v3)  { _camTarget.copy(v3);  }

  function dispose() {
    window.removeEventListener('home:resize', onResize);
    camera = null;
  }

  return { init, get, goToRoom, update, setLookTarget, setCamTarget, PRESETS, dispose };
})();

window.HomeCamera = HomeCamera;
