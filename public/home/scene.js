// public/home/scene.js
// ════════════════════════════════════════════════
//  Scene — Three.js scene + master render loop
//  Orchestrates: renderer, camera, lighting, controls
// ════════════════════════════════════════════════
const HomeScene = (() => {

  let scene     = null;
  let renderer  = null;
  let camera    = null;
  let clock     = null;
  let animFrame = null;
  let paused    = false;

  // Performance tracking
  const perf = { fps: 60, frames: 0, last: 0 };

  // State shared across modules
  const state = {
    currentRoom:  'living',
    timeOfDay:    'day',
    weather:      'clear',
    fireplace:    false,
    tvOn:         false,
    editMode:     false,      // furniture drag mode
    coupleId:     null,
    myRole:       'user1'
  };

  // ── Init ─────────────────────────────────────
  function init(canvasEl) {
    // Three.js Scene
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0a1a, 0.012);

    // Clock
    clock = new THREE.Clock();

    // Renderer
    renderer = HomeRenderer.init(canvasEl);

    // Camera
    camera = HomeCamera.init();

    // Lighting
    HomeLighting.init(scene);

    // Controls
    HomeControls.init(camera, canvasEl, scene);

    // Couple context
    state.coupleId = HomeUtils.getCoupleId();
    state.myRole   = HomeUtils.getMyRole();

    // Kick off render loop
    loop();

    // Listen for furniture drag commit
    window.addEventListener('home:furnitureMoved', onFurnitureMoved);

    return { scene, renderer, camera };
  }

  // ── Render loop ──────────────────────────────
  function loop() {
    animFrame = requestAnimationFrame(loop);
    if (paused) return;

    const dt  = Math.min(clock.getDelta(), 0.05);   // cap at 50 ms
    const now = performance.now();

    // FPS counter
    perf.frames++;
    if (now - perf.last >= 1000) {
      perf.fps   = perf.frames;
      perf.frames = 0;
      perf.last  = now;
      const el = document.getElementById('fpsCounter');
      if (el) el.textContent = perf.fps + ' fps';
    }

    // Update subsystems
    HomeControls.update(dt);
    HomeLighting.update(dt);
    HomeLighting.updateFireplace(state.fireplace, dt);
    HomeLighting.updateTVGlow(state.tvOn, dt);

    // Update rooms module if loaded
    if (window.HomeRooms && HomeRooms.update) HomeRooms.update(dt);

    // Update furniture module if loaded
    if (window.HomeFurniture && HomeFurniture.update) HomeFurniture.update(dt);

    // Update pets module if loaded
    if (window.HomePets && HomePets.update) HomePets.update(dt);

    // Update particles if loaded
    if (window.HomeParticles && HomeParticles.update) HomeParticles.update(dt);

    // Update effects if loaded
    if (window.HomeEffects && HomeEffects.update) HomeEffects.update(dt);


     if (window.HomeAvatars && HomeAvatars.update) HomeAvatars.update(dt);
    if (window.HomeMovement && HomeMovement.update) HomeMovement.update(dt);
    if (window.HomeAIBehavior && HomeAIBehavior.update) HomeAIBehavior.update(dt);
    if (window.HomePerfLiving && HomePerfLiving.update) HomePerfLiving.update(dt);

    renderer.render(scene, camera);
  }

  // ── Room switch ──────────────────────────────
  function goToRoom(roomName, immediate = false) {
    if (!Object.keys(ROOMS).includes(roomName)) return;
    state.currentRoom = roomName;

    HomeControls.snapToRoom(roomName);
    HomeLighting.configureForRoom(roomName);

    if (window.HomeRooms) HomeRooms.showRoom(roomName);
    if (window.HomeUI)    HomeUI.onRoomChange(roomName);

    // Persist setting
    if (state.coupleId) {
      HomeAPI.settings.save(state.coupleId, { active_room: roomName }).catch(() => {});
    }

    window.dispatchEvent(new CustomEvent('home:roomChange', { detail: { room: roomName } }));
  }

  // ── Time of day ──────────────────────────────
  function setTimeOfDay(tod) {
    state.timeOfDay = tod;
    HomeLighting.setTimeOfDay(tod);

    // Update sky background
    const skies = {
      day:    0x87ceeb,
      sunset: 0xff7043,
      night:  0x0d0d2b
    };
    scene.background = new THREE.Color(skies[tod] || skies.day);
    scene.fog.color.set(tod === 'night' ? 0x0a0a1a : tod === 'sunset' ? 0x3d1c02 : 0xd0e8f0);

    if (state.coupleId) {
      HomeAPI.settings.save(state.coupleId, { time_of_day: tod }).catch(() => {});
    }
  }

  // ── Weather ──────────────────────────────────
  function setWeather(w) {
    state.weather = w;
    if (window.HomeParticles) HomeParticles.setWeather(w);
    if (state.coupleId) {
      HomeAPI.settings.save(state.coupleId, { weather: w }).catch(() => {});
    }
  }

  // ── Furniture moved callback ──────────────────
  async function onFurnitureMoved(e) {
    const obj = e.detail;
    if (!obj || !obj.userData || !obj.userData.dbId) return;
    try {
      await HomeAPI.furniture.update(obj.userData.dbId, {
        pos_x: obj.position.x,
        pos_y: obj.position.y,
        pos_z: obj.position.z,
        rot_y: obj.rotation.y
      });
      HomeUtils.toast('Furniture saved ✓', 'success');
    } catch (err) {
      HomeUtils.toast('Save failed: ' + err.message, 'error');
    }
  }

  // ── Pause / resume (when iframe hidden) ──────
  function pause()  { paused = true;  clock.stop();  }
  function resume() { paused = false; clock.start(); }

  // ── Add arbitrary object to scene ────────────
  function add(obj)    { scene.add(obj); }
  function remove(obj) { scene.remove(obj); }

  function getScene()    { return scene;    }
  function getCamera()   { return camera;   }
  function getRenderer() { return renderer; }
  function getState()    { return state;    }
  function getPerf()     { return perf;     }

  function dispose() {
    cancelAnimationFrame(animFrame);
    window.removeEventListener('home:furnitureMoved', onFurnitureMoved);
    HomeRenderer.dispose();
    HomeControls.dispose();
    HomeLighting.dispose();
    scene.clear();
    scene = null; renderer = null; camera = null;
  }

  return {
    init, loop,
    goToRoom, setTimeOfDay, setWeather,
    add, remove,
    getScene, getCamera, getRenderer, getState, getPerf,
    pause, resume, dispose,
    state
  };
})();

// Room list (used for nav validation)
const ROOMS = {
  living:   { label: 'Living Room',  icon: '🛋️' },
  bedroom:  { label: 'Bedroom',      icon: '🛏️' },
  kitchen:  { label: 'Kitchen',      icon: '🍳' },
  garden:   { label: 'Garden',       icon: '🌿' },
  gameroom: { label: 'Game Room',    icon: '🎮' },
  music:    { label: 'Music Room',   icon: '🎵' },
  library:  { label: 'Library',      icon: '📚' },
  petroom:  { label: 'Pet Room',     icon: '🐾' },
  rooftop:  { label: 'Rooftop',      icon: '🌙' }
};

window.HomeScene = HomeScene;
window.ROOMS     = ROOMS;
