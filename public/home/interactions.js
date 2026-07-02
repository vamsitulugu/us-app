// public/home/interactions.js
// ════════════════════════════════════════════════
//  Interactions — Phase 6, Feature 3
//  Couple interactions: hold hands, hug, kiss, high five,
//  dance together, sit together, sleep together, selfie,
//  watch TV together, listen music together, cook together,
//  play games together, garden together, read together.
//  NEW MODULE — does not modify rooms/furniture/memories.
// ════════════════════════════════════════════════
const HomeInteractions = (() => {

  let scene = null;
  let active = null; // current interaction descriptor, or null

  const PROXIMITY_RADIUS = 1.4; // units — how close avatars must be for "close" interactions

  // Interaction registry: each entry describes animation keys,
  // minimum/maximum duration, whether it needs proximity, and
  // any room requirement (for context interactions like watchTV).
  const INTERACTIONS = {
    holdHands: {
      label: 'Hold Hands', icon: '🤝', requiresProximity: true,
      anim: 'idle', duration: null, // persists until cancelled
      apply(u1, u2) { _faceEachOther(u1, u2); _snapTogether(u1, u2, 0.55); }
    },
    hug: {
      label: 'Hug', icon: '🤗', requiresProximity: true,
      anim: 'hug', duration: 3200,
      apply(u1, u2) {
        _faceEachOther(u1, u2);
        _snapTogether(u1, u2, 0.32);
        u1.play('hug', 0.2, false);
        u2.play('hug', 0.2, false);
      }
    },
    kiss: {
      label: 'Kiss', icon: '💋', requiresProximity: true,
      anim: 'kiss', duration: 2200,
      apply(u1, u2) {
        _faceEachOther(u1, u2);
        _snapTogether(u1, u2, 0.28);
        u1.play('kiss', 0.2, false);
        u2.play('kiss', 0.2, false);
      }
    },
    highFive: {
      label: 'High Five', icon: '🙌', requiresProximity: true,
      anim: 'highFive', duration: 1400,
      apply(u1, u2) {
        _faceEachOther(u1, u2);
        _snapTogether(u1, u2, 0.5);
        u1.play('highFive', 0.15, false);
        u2.play('highFive', 0.15, false);
      }
    },
    danceTogether: {
      label: 'Dance Together', icon: '💃', requiresProximity: true,
      anim: 'dance', duration: null,
      apply(u1, u2) {
        _faceEachOther(u1, u2);
        _snapTogether(u1, u2, 0.5);
        u1.play('dance', 0.3);
        u2.play('dance', 0.3);
      }
    },
    sitTogether: {
      label: 'Sit Together', icon: '🛋️', requiresProximity: false,
      anim: 'sit', duration: null,
      apply(u1, u2) {
        // Expect caller to pass a target sofa position via interaction options;
        // fallback: sit side-by-side wherever u1 currently stands.
        const base = u1.state.position.clone();
        HomeMovement.sit('user1', base);
        HomeMovement.sit('user2', new THREE.Vector3(base.x + 0.5, 0, base.z));
        _faceSameDirection(u1, u2, 0);
      }
    },
    sleepTogether: {
      label: 'Sleep Together', icon: '😴', requiresProximity: false,
      anim: 'sleep', duration: null,
      apply(u1, u2) {
        const base = u1.state.position.clone();
        HomeMovement.sleep('user1', base);
        HomeMovement.sleep('user2', new THREE.Vector3(base.x + 0.45, 0, base.z));
      }
    },
    selfie: {
      label: 'Take Selfie', icon: '🤳', requiresProximity: true,
      anim: 'idle', duration: 1800,
      apply(u1, u2) {
        _faceCamera(u1, u2);
        _snapTogether(u1, u2, 0.4);
        u1.playOnce('wave');
        if (window.HomeMemories && HomeMemories.captureSelfieMoment) {
          HomeMemories.captureSelfieMoment(); // optional hook into Phase 5 memories, only called if it exists
        }
      }
    },
    watchTV: {
      label: 'Watch TV Together', icon: '📺', requiresProximity: false, room: 'living',
      anim: 'sit', duration: null,
      apply(u1, u2) {
        // Living room TV sofa is presumed near origin facing -Z; reuse sit logic.
        const sofa = new THREE.Vector3(0, 0, 1.8);
        HomeMovement.sit('user1', sofa);
        HomeMovement.sit('user2', new THREE.Vector3(sofa.x + 0.55, 0, sofa.z));
        if (window.HomeScene) { HomeScene.state.tvOn = true; }
      }
    },
    listenMusic: {
      label: 'Listen Music Together', icon: '🎧', requiresProximity: true, room: 'music',
      anim: 'idle', duration: null,
      apply(u1, u2) { _faceEachOther(u1, u2); _snapTogether(u1, u2, 0.6); }
    },
    cookTogether: {
      label: 'Cook Together', icon: '🍳', requiresProximity: true, room: 'kitchen',
      anim: 'idle', duration: null,
      apply(u1, u2) { _sideBySideFacingSame(u1, u2, Math.PI); }
    },
    playGames: {
      label: 'Play Games Together', icon: '🎮', requiresProximity: true, room: 'gameroom',
      anim: 'sit', duration: null,
      apply(u1, u2) {
        const base = u1.state.position.clone();
        HomeMovement.sit('user1', base);
        HomeMovement.sit('user2', new THREE.Vector3(base.x + 0.6, 0, base.z));
      }
    },
    gardenTogether: {
      label: 'Garden Together', icon: '🌱', requiresProximity: true, room: 'garden',
      anim: 'idle', duration: null,
      apply(u1, u2) { _sideBySideFacingSame(u1, u2, 0); }
    },
    readTogether: {
      label: 'Read Together', icon: '📖', requiresProximity: true, room: 'library',
      anim: 'sit', duration: null,
      apply(u1, u2) {
        const base = u1.state.position.clone();
        HomeMovement.sit('user1', base);
        HomeMovement.sit('user2', new THREE.Vector3(base.x + 0.45, 0, base.z));
      }
    }
  };

  // ── Geometry helpers ───────────────────────────────
  function _faceEachOther(u1, u2) {
    const p1 = u1.state.position, p2 = u2.state.position;
    const yaw1 = Math.atan2(p2.x - p1.x, p2.z - p1.z);
    const yaw2 = Math.atan2(p1.x - p2.x, p1.z - p2.z);
    u1.setRotationY(yaw1);
    u2.setRotationY(yaw2);
  }

  function _faceCamera(u1, u2) {
    if (!window.HomeCamera) return _faceEachOther(u1, u2);
    const cam = HomeCamera.get();
    if (!cam) return _faceEachOther(u1, u2);
    [u1, u2].forEach(av => {
      const dir = new THREE.Vector3().subVectors(cam.position, av.state.position);
      av.setRotationY(Math.atan2(dir.x, dir.z));
    });
  }

  function _faceSameDirection(u1, u2, yaw) {
    u1.setRotationY(yaw);
    u2.setRotationY(yaw);
  }

  function _sideBySideFacingSame(u1, u2, yaw) {
    const mid = u1.state.position.clone().lerp(u2.state.position, 0.5);
    u1.setPosition(mid.x - 0.3, 0, mid.z);
    u2.setPosition(mid.x + 0.3, 0, mid.z);
    _faceSameDirection(u1, u2, yaw);
  }

  // Pull avatars to standing positions ~`gap` units apart, centered
  // on their current midpoint, then face each other.
  function _snapTogether(u1, u2, gap) {
    const mid = u1.state.position.clone().lerp(u2.state.position, 0.5);
    const dir = new THREE.Vector3().subVectors(u2.state.position, u1.state.position);
    if (dir.lengthSq() < 0.0001) dir.set(1, 0, 0);
    dir.normalize();
    u1.setPosition(mid.x - dir.x * gap / 2, 0, mid.z - dir.z * gap / 2);
    u2.setPosition(mid.x + dir.x * gap / 2, 0, mid.z + dir.z * gap / 2);
  }

  function _proximityOK() {
    const u1 = HomeAvatars.get('user1'), u2 = HomeAvatars.get('user2');
    if (!u1 || !u2) return false;
    return u1.state.position.distanceTo(u2.state.position) <= PROXIMITY_RADIUS;
  }

  // ── Public API ─────────────────────────────────────
  function listAvailable() {
    return Object.entries(INTERACTIONS).map(([key, def]) => ({
      key, label: def.label, icon: def.icon, requiresProximity: def.requiresProximity, room: def.room || null
    }));
  }

  function canTrigger(key) {
    const def = INTERACTIONS[key];
    if (!def) return { ok: false, reason: 'unknown' };
    if (def.room && window.HomeScene && HomeScene.getState().currentRoom !== def.room) {
      return { ok: false, reason: 'wrong_room' };
    }
    if (def.requiresProximity && !_proximityOK()) {
      return { ok: false, reason: 'too_far' };
    }
    return { ok: true };
  }

  function trigger(key, opts) {
    const def = INTERACTIONS[key];
    if (!def) { console.warn('[HomeInteractions] Unknown interaction:', key); return false; }

    const check = canTrigger(key);
    if (!check.ok) {
      if (check.reason === 'too_far') HomeUtils.toast('Move closer together first 💕', 'info');
      else if (check.reason === 'wrong_room') HomeUtils.toast('Head to the ' + (def.room || 'right room') + ' for this', 'info');
      return false;
    }

    const u1 = HomeAvatars.get('user1'), u2 = HomeAvatars.get('user2');
    if (!u1 || !u2) return false;

    // Cancel a previous open-ended interaction (e.g. switching from
    // holdHands to dance) before applying the new one.
    if (active && active.key !== key) _endActive(false);

    def.apply(u1, u2, opts || {});
    active = { key, startedAt: Date.now(), def };

    // Broadcast to partner (Feature 6 hook — no-op if realtime module absent)
    if (window.HomeRealtimeLiving && HomeRealtimeLiving.broadcastInteraction) {
      HomeRealtimeLiving.broadcastInteraction(key, opts || {});
    }

    HomeUtils.toast(def.icon + ' ' + def.label, 'success');

    // Award relationship XP if the app shell exposes addXP (defined in
    // index.html's global scope, outside the home iframe in this project's
    // architecture — guarded so it's a no-op inside the iframe context)
    if (window.parent && typeof window.parent.addXP === 'function') {
      try { window.parent.addXP(4); } catch (_) {}
    }

    if (def.duration) {
      clearTimeout(_activeTimer);
      _activeTimer = setTimeout(() => _endActive(true), def.duration);
    }
    return true;
  }

  let _activeTimer = null;

  function _endActive(returnToIdle) {
    if (!active) return;
    if (returnToIdle) {
      const u1 = HomeAvatars.get('user1'), u2 = HomeAvatars.get('user2');
      if (u1) u1.play('idle', 0.3);
      if (u2) u2.play('idle', 0.3);
    }
    active = null;
    clearTimeout(_activeTimer);
  }

  function cancel() { _endActive(true); }

  function getActive() { return active ? { key: active.key, startedAt: active.startedAt } : null; }

  function init(threeScene) {
    scene = threeScene;
  }

  function dispose() {
    clearTimeout(_activeTimer);
    active = null;
  }

  return {
    init, dispose,
    listAvailable, canTrigger, trigger, cancel, getActive,
    PROXIMITY_RADIUS
  };
})();

window.HomeInteractions = HomeInteractions;