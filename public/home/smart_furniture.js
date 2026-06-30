// public/home/smart_furniture.js
// ════════════════════════════════════════════════
//  Smart Furniture AI — Phase 8
//  Each furniture type exposes: enter(), exit(),
//  interact(), animation(), audio(), state().
//  Hooks into HomeScene objects by userData.furnitureType.
// ════════════════════════════════════════════════
const HomeSmartFurniture = (() => {

  // ── Furniture type definitions ──────────────────
  // Each type has: interactions[], states[], enterAnim, exitAnim,
  // audio triggers, and apply(mesh, interactionKey, avatars) logic.
  const FURNITURE_TYPES = {

    bed: {
      interactions: ['sleep', 'wake', 'blanketAnim'],
      defaultState: { occupied: false, blanketOn: true },
      enterAnim: 'sleep', exitAnim: 'stretch',
      audio: { enter: 'bed_creak', exit: 'bed_creak' },
      apply(mesh, key, u1, u2, state) {
        if (key === 'sleep') {
          state.occupied = true;
          if (window.HomeMovement) {
            HomeMovement.sleep('user1', mesh.position);
            if (u2) HomeMovement.sleep('user2', new THREE.Vector3(mesh.position.x + 0.45, 0, mesh.position.z));
          }
          HomeStateManager.setFurnitureState(mesh.userData.furnitureKey, { occupied: true });
          HomeStateManager.setLight('bedroom', false);
          if (window.HomeEnvironment) try { HomeEnvironment.setRoomLight('bedroom', false); } catch (_) {}
        } else if (key === 'wake') {
          state.occupied = false;
          if (u1) u1.play('stretch', 0.3, false);
          if (u2) u2.play('stretch', 0.3, false);
          HomeStateManager.setFurnitureState(mesh.userData.furnitureKey, { occupied: false });
          HomeStateManager.setLight('bedroom', true);
        } else if (key === 'blanketAnim') {
          state.blanketOn = !state.blanketOn;
          // Animate blanket mesh child if present
          const blanket = mesh.getObjectByName('blanket');
          if (blanket) blanket.visible = state.blanketOn;
        }
      }
    },

    sofa: {
      interactions: ['sit', 'cuddle', 'watchTV'],
      defaultState: { occupied: false, cuddling: false },
      enterAnim: 'sit', exitAnim: 'stand',
      audio: { enter: 'sofa_sit', exit: 'sofa_sit' },
      apply(mesh, key, u1, u2, state) {
        if (key === 'sit') {
          state.occupied = true;
          if (window.HomeMovement) {
            HomeMovement.sit('user1', mesh.position);
            if (u2) HomeMovement.sit('user2', new THREE.Vector3(mesh.position.x + 0.55, 0, mesh.position.z));
          }
        } else if (key === 'cuddle') {
          state.cuddling = true;
          if (u1 && u2) {
            const mid = new THREE.Vector3().lerpVectors(u1.state.position, u2.state.position, 0.5);
            HomeMovement.sit('user1', new THREE.Vector3(mid.x - 0.2, 0, mid.z));
            HomeMovement.sit('user2', new THREE.Vector3(mid.x + 0.2, 0, mid.z));
            u1.play('sit', 0.3); u2.play('sit', 0.3);
          }
          window.dispatchEvent(new CustomEvent('home:interactionTriggered', { detail: { key: 'holdHands' } }));
        } else if (key === 'watchTV') {
          if (window.HomeInteractions) HomeInteractions.trigger('watchTV');
        }
      }
    },

    table: {
      interactions: ['eatTogether', 'playCards', 'read'],
      defaultState: { activity: null },
      enterAnim: 'sit', exitAnim: 'stand',
      audio: { enter: 'chair_pull', exit: 'chair_pull' },
      apply(mesh, key, u1, u2, state) {
        state.activity = key;
        const tPos = mesh.position;
        if (window.HomeMovement) {
          HomeMovement.sit('user1', new THREE.Vector3(tPos.x - 0.45, 0, tPos.z));
          HomeMovement.sit('user2', new THREE.Vector3(tPos.x + 0.45, 0, tPos.z));
        }
        if (key === 'eatTogether') {
          window.dispatchEvent(new CustomEvent('home:interactionTriggered', { detail: { key: 'cookTogether' } }));
        } else if (key === 'playCards') {
          window.dispatchEvent(new CustomEvent('home:interactionTriggered', { detail: { key: 'playGames' } }));
        } else if (key === 'read') {
          window.dispatchEvent(new CustomEvent('home:interactionTriggered', { detail: { key: 'readTogether' } }));
        }
      }
    },

    bookshelf: {
      interactions: ['read', 'saveBook'],
      defaultState: { selectedBook: null },
      enterAnim: 'idle', exitAnim: 'idle',
      audio: { enter: 'book_pull', exit: null },
      apply(mesh, key, u1, u2, state) {
        if (key === 'read') {
          if (u1) {
            u1.setPosition(mesh.position.x, 0, mesh.position.z + 0.8);
            u1.play('read', 0.2);
          }
          window.dispatchEvent(new CustomEvent('home:interactionTriggered', { detail: { key: 'readTogether' } }));
        } else if (key === 'saveBook') {
          state.selectedBook = `book_${Date.now()}`;
          HomeStateManager.setFurnitureState(mesh.userData.furnitureKey, { selectedBook: state.selectedBook });
          HomeUtils.toast('📚 Favourite book saved!', 'success');
        }
      }
    },

    computer: {
      interactions: ['aiAssistant', 'calendar', 'journal'],
      defaultState: { screenOn: false, activeApp: null },
      enterAnim: 'sit', exitAnim: 'stand',
      audio: { enter: 'keyboard', exit: null },
      apply(mesh, key, u1, u2, state) {
        state.screenOn = true;
        state.activeApp = key;
        // Illuminate screen
        const screenMesh = mesh.getObjectByName('screen');
        if (screenMesh && screenMesh.material) {
          screenMesh.material.emissive = new THREE.Color(0x1a90ff);
          screenMesh.material.emissiveIntensity = key === 'journal' ? 0.5 : 0.8;
        }
        if (u1) {
          u1.setPosition(mesh.position.x, 0, mesh.position.z + 0.7);
          u1.setRotationY(Math.PI);
          u1.play('sit', 0.3);
        }
        // Emit an event the UI layer can respond to
        window.dispatchEvent(new CustomEvent('home:computerApp', { detail: { app: key } }));
      }
    },

    window: {
      interactions: ['open', 'close'],
      defaultState: { open: false },
      enterAnim: 'idle', exitAnim: 'idle',
      audio: { enter: 'window_slide', exit: 'window_slide' },
      apply(mesh, key, u1, u2, state) {
        state.open = key === 'open';
        HomeStateManager.setWindow(mesh.userData.windowName || mesh.name, state.open ? 'open' : 'closed');
        // Animate the window mesh
        if (mesh.userData.pivot) {
          mesh.userData.pivot.rotation.y = state.open ? Math.PI * 0.5 : 0;
        }
        // Adjust outdoor sound level in ambient audio
        if (window.HomeAmbientAudioEngine) {
          HomeAmbientAudioEngine.setOutdoorVolume(state.open ? 0.7 : 0.15);
        }
        window.dispatchEvent(new CustomEvent('home:windowToggle', { detail: { name: mesh.name, open: state.open } }));
      }
    },

    fireplace: {
      interactions: ['light', 'extinguish', 'adjustHeat'],
      defaultState: { lit: false, heatLevel: 0.5 },
      enterAnim: 'idle', exitAnim: 'idle',
      audio: { enter: 'fire_crackle', exit: null },
      apply(mesh, key, u1, u2, state) {
        if (key === 'light') {
          state.lit = true;
          if (window.HomeFireplace) try { HomeFireplace.enable(); } catch (_) {}
          HomeStateManager.setFireplace(true);
        } else if (key === 'extinguish') {
          state.lit = false;
          if (window.HomeFireplace) try { HomeFireplace.disable(); } catch (_) {}
          HomeStateManager.setFireplace(false);
        } else if (key === 'adjustHeat') {
          state.heatLevel = Math.min(1, state.heatLevel + 0.25);
          if (state.heatLevel > 1) state.heatLevel = 0.3;
          if (window.HomeFireplace && HomeFireplace.setIntensity) {
            HomeFireplace.setIntensity(state.heatLevel);
          }
        }
      }
    },

    kitchen: {
      interactions: ['cookTogether', 'makeCoffee', 'eat'],
      defaultState: { cooking: false, coffeeReady: false },
      enterAnim: 'idle', exitAnim: 'idle',
      audio: { enter: 'kitchen_ambience', exit: null },
      apply(mesh, key, u1, u2, state) {
        if (key === 'cookTogether') {
          state.cooking = true;
          if (window.HomeInteractions) HomeInteractions.trigger('cookTogether');
        } else if (key === 'makeCoffee') {
          state.coffeeReady = false;
          HomeUtils.toast('☕ Brewing coffee...', 'info');
          setTimeout(() => {
            state.coffeeReady = true;
            HomeUtils.toast('☕ Coffee is ready!', 'success');
          }, 4000);
        } else if (key === 'eat') {
          if (u1) u1.play('eat', 0.2, false);
          if (u2) u2.play('eat', 0.2, false);
          window.dispatchEvent(new CustomEvent('home:interactionTriggered', { detail: { key: 'cookTogether' } }));
        }
      }
    }
  };

  // ── Per-mesh state store ────────────────────────
  const _meshStates = new Map(); // mesh uuid → { type, state, def }

  // ── Register a Three.js mesh as a smart furniture piece ──
  function register(mesh, furnitureType, key) {
    if (!FURNITURE_TYPES[furnitureType]) return;
    mesh.userData.furnitureType = furnitureType;
    mesh.userData.furnitureKey  = key || (furnitureType + '_' + mesh.uuid.slice(0, 6));
    mesh.userData.smartRegistered = true;

    const saved = HomeStateManager.getFurnitureState(mesh.userData.furnitureKey);
    const def   = FURNITURE_TYPES[furnitureType];
    const state = { ...def.defaultState, ...saved };

    _meshStates.set(mesh.uuid, { type: furnitureType, state, def, mesh });
  }

  // ── Execute an interaction on a mesh ────────────
  function interact(mesh, interactionKey) {
    const entry = _meshStates.get(mesh.uuid);
    if (!entry) return false;
    const { type, state, def } = entry;
    if (!def.interactions.includes(interactionKey)) return false;

    const u1 = window.HomeAvatars ? HomeAvatars.get('user1') : null;
    const u2 = window.HomeAvatars ? HomeAvatars.get('user2') : null;

    try { def.apply(mesh, interactionKey, u1, u2, state); } catch (e) {
      console.warn('[HomeSmartFurniture] interact error:', type, interactionKey, e.message);
    }

    // Audio
    const audioKey = def.audio?.enter;
    if (audioKey && window.HomeAmbientAudioEngine) {
      try { HomeAmbientAudioEngine.playSfx(audioKey); } catch (_) {}
    }

    // Persist state
    HomeStateManager.setFurnitureState(mesh.userData.furnitureKey, state);

    return true;
  }

  function enter(mesh) { return interact(mesh, 'enter') || interact(mesh, 'sit') || interact(mesh, 'light'); }
  function exit(mesh) {
    const entry = _meshStates.get(mesh.uuid);
    if (!entry) return;
    const { def } = entry;
    const exitAnim = def.exitAnim;
    const u1 = window.HomeAvatars ? HomeAvatars.get('user1') : null;
    if (u1 && exitAnim) try { u1.play(exitAnim, 0.3); } catch (_) {}
    if (def.audio?.exit && window.HomeAmbientAudioEngine) {
      try { HomeAmbientAudioEngine.playSfx(def.audio.exit); } catch (_) {}
    }
  }

  function getState(mesh) {
    const entry = _meshStates.get(mesh.uuid);
    return entry ? { ...entry.state } : null;
  }

  function getInteractions(mesh) {
    const entry = _meshStates.get(mesh.uuid);
    return entry ? entry.def.interactions : [];
  }

  // ── Auto-register meshes in scene by userData.furnitureType ──
  function scanAndRegister(scene) {
    scene.traverse(obj => {
      if (obj.isMesh && obj.userData.furnitureType && !obj.userData.smartRegistered) {
        register(obj, obj.userData.furnitureType, obj.userData.furnitureKey || obj.name);
      }
    });
  }

  // ── Routine-driven auto-actions ────────────────
  function applyRoutineActions(period) {
    _meshStates.forEach(({ type, mesh, state, def }) => {
      if (type === 'fireplace') {
        if (period === 'evening' && !state.lit) interact(mesh, 'light');
        if (period === 'morning' && state.lit)  interact(mesh, 'extinguish');
      }
    });
  }

  function init(scene) {
    scanAndRegister(scene);
    window.addEventListener('home:routinePeriodChange', e => {
      if (e.detail) applyRoutineActions(e.detail.period);
    });
  }

  function dispose() { _meshStates.clear(); }

  return {
    init, dispose,
    register, interact, enter, exit, getState, getInteractions,
    scanAndRegister, applyRoutineActions,
    FURNITURE_TYPES
  };
})();

window.HomeSmartFurniture = HomeSmartFurniture;
