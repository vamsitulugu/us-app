// public/home/ai_behavior.js
// ════════════════════════════════════════════════
//  AI Behaviour — Phase 6, Feature 5
//  Pets choose activities automatically. Avatars
//  automatically sit/watch TV/sleep/read/relax/walk/
//  visit rooms/react to partner/react to pets.
//  NEW MODULE — does not modify rooms/furniture/memories.
// ════════════════════════════════════════════════
const HomeAIBehavior = (() => {

  let scene   = null;
  let enabled = true;      // master toggle (idle-only avatars get AI; manual control overrides)
  let avatarAITimer = { user1: 0, user2: 0 };
  const AVATAR_DECISION_INTERVAL = [18, 40]; // seconds, randomized range between autonomous decisions

  // Only the avatar NOT controlled by the local person gets full
  // autonomous AI by default (so you don't fight your own input).
  // Both avatars get reactive behaviors (react to partner/pets).
  function _isLocallyControlled(role) {
    return role === HomeUtils.getMyRole();
  }

  // ── Avatar autonomous activities ───────────────────
  const AVATAR_ACTIVITIES = ['sit', 'watchTV', 'sleep', 'read', 'relax', 'walk', 'visitRoom'];

  function _pickAvatarActivity(role) {
    const avatar = HomeAvatars.get(role);
    if (!avatar || avatar.state.sitting || avatar.state.sleeping) return;
    // Don't override active manual movement
    if (HomeMovement.nav[role] && HomeMovement.nav[role].moving) return;

    const activity = AVATAR_ACTIVITIES[Math.floor(Math.random() * AVATAR_ACTIVITIES.length)];
    switch (activity) {
      case 'sit':
        HomeMovement.sit(role, avatar.state.position.clone());
        break;
      case 'watchTV':
        if (window.HomeScene && HomeScene.getState().currentRoom === 'living') {
          HomeInteractions.trigger('watchTV');
        } else {
          _wanderWithin(role);
        }
        break;
      case 'sleep':
        HomeMovement.sleep(role, avatar.state.position.clone());
        break;
      case 'read':
        if (window.HomeScene && HomeScene.getState().currentRoom === 'library') {
          HomeMovement.sit(role, avatar.state.position.clone());
        } else {
          _wanderWithin(role);
        }
        break;
      case 'relax':
        avatar.playOnce('lookAround');
        break;
      case 'walk':
        _wanderWithin(role);
        break;
      case 'visitRoom':
        _visitRandomRoom(role);
        break;
    }
  }

  function _wanderWithin(role) {
    const avatar = HomeAvatars.get(role);
    if (!avatar) return;
    const cx = avatar.state.position.x, cz = avatar.state.position.z;
    const angle = Math.random() * Math.PI * 2;
    const dist  = 0.8 + Math.random() * 1.6;
    const x = HomeUtils.clamp(cx + Math.cos(angle) * dist, -4.5, 4.5);
    const z = HomeUtils.clamp(cz + Math.sin(angle) * dist, -4.5, 4.5);
    HomeMovement.moveTo(role, x, z, false);
  }

  function _visitRandomRoom(role) {
    if (!window.ROOMS || !window.HomeScene) return;
    const roomNames = Object.keys(window.ROOMS);
    const target = roomNames[Math.floor(Math.random() * roomNames.length)];
    // Only the currently-displayed room actually has a visible scene in
    // this single-canvas architecture, so "visiting" a different room
    // for the NON-locally-controlled avatar just queues a soft camera-free
    // room intent; we avoid forcing the camera to switch out from under
    // the local person. If it's the same room already, just wander.
    if (window.HomeScene.getState().currentRoom === target) {
      _wanderWithin(role);
    } else {
      // Lightweight ambient cue rather than a full room switch, since
      // forcing the camera away would disrupt the local person's view.
      const avatar = HomeAvatars.get(role);
      if (avatar) avatar.playOnce('wave');
    }
  }

  // ── Reactive behaviors (both avatars, always on) ──
  function _reactToPartner(dt) {
    const u1 = HomeAvatars.get('user1'), u2 = HomeAvatars.get('user2');
    if (!u1 || !u2) return;
    const dist = u1.state.position.distanceTo(u2.state.position);
    // When close and both idle, look at each other (head tracking via avatars.js)
    if (dist < HomeInteractions.PROXIMITY_RADIUS) {
      if (u1.state.anim === 'idle') u1.setLookTarget(u2.state.position.clone().setY(1.5));
      if (u2.state.anim === 'idle') u2.setLookTarget(u1.state.position.clone().setY(1.5));
    } else {
      // Default look targets back to camera area
      if (window.HomeCamera) {
        const camPos = HomeCamera.get() ? HomeCamera.get().position : null;
        if (camPos) { u1.setLookTarget(camPos); u2.setLookTarget(camPos); }
      }
    }
  }

  function _reactToPets(dt) {
    if (!window.HomePets) return;
    const pets = HomePets.getAll();
    if (!pets.length) return;
    ['user1', 'user2'].forEach(role => {
      const avatar = HomeAvatars.get(role);
      if (!avatar) return;
      const nearest = pets.reduce((closest, p) => {
        const d = avatar.state.position.distanceTo(p.state.position);
        return (!closest || d < closest.d) ? { pet: p, d } : closest;
      }, null);
      if (nearest && nearest.d < 0.9 && avatar.state.anim === 'idle') {
        avatar.setLookTarget(nearest.pet.state.position.clone().setY(0.6));
      }
    });
  }

  // ── Pet AI (random movement, follow owner, bed, drink, play) ──
  const PET_MODE_WEIGHTS = { wander: 0.45, follow: 0.25, toBed: 0.10, drink: 0.10, play: 0.10 };
  let petDecisionTimer = {};

  function _pickPetMode(pet) {
    // Low energy strongly biases toward bed; low happiness biases toward play
    if (pet.stats.energy < 20) return 'toBed';
    if (pet.stats.happiness < 25 && Math.random() < 0.6) return 'play';

    const r = Math.random();
    let acc = 0;
    for (const [mode, w] of Object.entries(PET_MODE_WEIGHTS)) {
      acc += w;
      if (r <= acc) return mode;
    }
    return 'wander';
  }

  function _petWaterBowlPosition() {
    // Placeholder fixed bowl location (pet room area); real implementation
    // could query furniture.js for a registered "water_bowl" item, but
    // furniture.js is not modified in this phase per instructions.
    return new THREE.Vector3(-1.6, 0, -1.6);
  }

  function _petBedPosition(pet) {
    return new THREE.Vector3(1.8, pet.species === 'bird' ? 1.2 : 0, -1.8);
  }

  function _petAITick(pet, dt) {
    if (!enabled) return;
    const id = pet.id;
    petDecisionTimer[id] = (petDecisionTimer[id] || 0) + dt;

    const decisionInterval = 6 + Math.random() * 6;
    if (petDecisionTimer[id] >= decisionInterval && pet.state.mode !== 'play') {
      petDecisionTimer[id] = 0;
      pet.state.mode = _pickPetMode(pet);
    }

    const speed = (HomePets.SPECIES_DEFAULTS[pet.species] || {}).speed || 1.5;

    switch (pet.state.mode) {
      case 'wander': {
        if (!pet._wanderTarget || pet.state.position.distanceTo(pet._wanderTarget) < 0.1) {
          const angle = Math.random() * Math.PI * 2;
          const dist = 0.6 + Math.random() * 1.4;
          pet._wanderTarget = new THREE.Vector3(
            HomeUtils.clamp(pet.state.position.x + Math.cos(angle) * dist, -4.5, 4.5),
            pet.state.position.y,
            HomeUtils.clamp(pet.state.position.z + Math.sin(angle) * dist, -4.5, 4.5)
          );
        }
        _movePetToward(pet, pet._wanderTarget, speed * 0.5, dt);
        pet.play('walk');
        break;
      }
      case 'follow': {
        const owner = HomeAvatars.get(pet.ownerRole);
        if (owner) {
          const dist = pet.state.position.distanceTo(owner.state.position);
          if (dist > 0.6) {
            _movePetToward(pet, owner.state.position, speed, dt);
            pet.play('walk');
          } else {
            pet.play('idle');
          }
        }
        break;
      }
      case 'toBed': {
        const bed = _petBedPosition(pet);
        if (pet.state.position.distanceTo(bed) > 0.15) {
          _movePetToward(pet, bed, speed * 0.7, dt);
          pet.play('walk');
        } else {
          pet.play('sleep');
          pet.stats.energy = Math.min(100, pet.stats.energy + dt * 1.2);
          if (pet.stats.energy > 95) pet.state.mode = 'wander';
        }
        break;
      }
      case 'drink': {
        const bowl = _petWaterBowlPosition();
        if (pet.state.position.distanceTo(bowl) > 0.2) {
          _movePetToward(pet, bowl, speed * 0.6, dt);
          pet.play('walk');
        } else {
          pet.play('eat'); // reuse eat clip for drinking placeholder
          pet.stats.health = Math.min(100, pet.stats.health + dt * 2);
          if (Math.random() < 0.01) pet.state.mode = 'wander';
        }
        break;
      }
      case 'play': {
        pet.play('play', 0.2, false);
        break; // playWith()/timeout handles exit back to idle
      }
      default:
        pet.play('idle');
    }
  }

  function _movePetToward(pet, target, speed, dt) {
    const dx = target.x - pet.state.position.x;
    const dz = target.z - pet.state.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.02) return;
    const step = Math.min(speed * dt, dist);
    const yaw = Math.atan2(dx, dz);
    pet.setRotationY(HomeUtils.lerp(pet.state.rotationY, yaw, 0.2));
    pet.setPosition(
      pet.state.position.x + Math.sin(yaw) * step,
      pet.state.position.y,
      pet.state.position.z + Math.cos(yaw) * step
    );
    if (window.HomeAudioLiving && HomeAudioLiving.onPetSound && Math.random() < 0.002) {
      HomeAudioLiving.onPetSound(pet.species);
    }
  }

  // ── Avatar decision loop (called per-frame, throttled internally) ──
  function _avatarAITick(role, dt) {
    if (!enabled) return;
    if (_isLocallyControlled(role)) return; // never puppet the local person's own avatar
    avatarAITimer[role] += dt;
    const threshold = AVATAR_DECISION_INTERVAL[0] + Math.random() * (AVATAR_DECISION_INTERVAL[1] - AVATAR_DECISION_INTERVAL[0]);
    if (avatarAITimer[role] >= threshold) {
      avatarAITimer[role] = 0;
      _pickAvatarActivity(role);
    }
  }

  // ── Init / update / dispose ─────────────────────────
  function init(threeScene) {
    scene = threeScene;
    // Plug pet AI into pets.js without pets.js needing to import this file
    if (window.HomePets && HomePets._registerAIHook) {
      HomePets._registerAIHook(_petAITick);
    }
  }

  function update(dt) {
    if (!enabled) return;
    _avatarAITick('user1', dt);
    _avatarAITick('user2', dt);
    _reactToPartner(dt);
    _reactToPets(dt);
    // Pet AI itself runs inside Pet.update() via the registered hook,
    // which is invoked from HomePets.update() in the main render loop.
  }

  function setEnabled(v) { enabled = v; }
  function dispose() { avatarAITimer = { user1: 0, user2: 0 }; petDecisionTimer = {}; }

  return { init, update, dispose, setEnabled };
})();

window.HomeAIBehavior = HomeAIBehavior;