// public/home/npc_behavior.js
// ════════════════════════════════════════════════
//  NPC Behavior Engine — Phase 8
//  Drives intelligent idle behaviors for avatars.
//  No repetitive loops — weighted random scheduler
//  with cooldowns, period cues, and relationship
//  influence. Replaces the stub HomeAIBehavior
//  while keeping the same window export name for
//  backward compatibility with scene.js's update call.
// ════════════════════════════════════════════════
const HomeNPCBehavior = (() => {

  // ── Behavior definitions ────────────────────────
  // Each behavior: weight (base), cooldown (sec), duration (sec), apply(role)
  const BEHAVIORS = {
    lookAround: {
      label: 'Look around', baseWeight: 0.20, cooldown: 8, duration: 3,
      apply(role, avatar) {
        const yaw = avatar.state.position
          ? (Math.random() - 0.5) * Math.PI * 1.4
          : 0;
        avatar.setRotationY(avatar.group ? avatar.group.rotation.y + yaw : yaw);
        avatar.play('idle', 0.3);
      }
    },
    stretch: {
      label: 'Stretch', baseWeight: 0.12, cooldown: 20, duration: 2.5,
      apply(role, avatar) { avatar.play('stretch', 0.2, false); }
    },
    yawn: {
      label: 'Yawn', baseWeight: 0.08, cooldown: 30, duration: 2,
      apply(role, avatar) { avatar.play('yawn', 0.2, false); }
    },
    walkRandomly: {
      label: 'Wander', baseWeight: 0.15, cooldown: 12, duration: 5,
      apply(role, avatar) {
        if (!window.HomeMovement) return;
        const x = (Math.random() - 0.5) * 6;
        const z = (Math.random() - 0.5) * 6;
        HomeMovement.moveTo(role, x, z, false);
      }
    },
    lookAtPartner: {
      label: 'Look at partner', baseWeight: 0.18, cooldown: 10, duration: 4,
      apply(role, avatar) {
        const partnerRole = role === 'user1' ? 'user2' : 'user1';
        if (!window.HomeAvatars) return;
        const partner = HomeAvatars.get(partnerRole);
        if (!partner) return;
        const p1 = avatar.state.position, p2 = partner.state.position;
        avatar.setRotationY(Math.atan2(p2.x - p1.x, p2.z - p1.z));
        avatar.play('idle', 0.4);
      }
    },
    lookOutWindow: {
      label: 'Look outside', baseWeight: 0.12, cooldown: 25, duration: 6,
      apply(role, avatar) {
        // Turn toward the nearest front window (negative Z)
        avatar.setRotationY(0);
        if (!window.HomeMovement) return;
        const wx = (Math.random() - 0.5) * 3;
        HomeMovement.moveTo(role, wx, -3.5, false);
      }
    },
    petAnimal: {
      label: 'Pet animal', baseWeight: 0.10, cooldown: 20, duration: 4,
      apply(role, avatar) {
        if (!window.HomePets) return;
        const pets = HomePets.getAll ? HomePets.getAll() : [];
        if (!pets.length) return;
        const pet = pets[0];
        avatar.play('pet', 0.2, false);
        if (pet.play) pet.play('happy', 0.2);
        window.dispatchEvent(new CustomEvent('home:petAction', { detail: { petId: pet.id, action: 'cuddle' } }));
      }
    },
    checkPhone: {
      label: 'Check phone', baseWeight: 0.08, cooldown: 40, duration: 5,
      apply(role, avatar) { avatar.play('phone', 0.2, false); }
    },
    drinkWater: {
      label: 'Drink water', baseWeight: 0.07, cooldown: 35, duration: 3,
      apply(role, avatar) { avatar.play('drink', 0.2, false); }
    },
    sit: {
      label: 'Sit down', baseWeight: 0.14, cooldown: 15, duration: 10,
      apply(role, avatar) {
        if (!window.HomeMovement) return;
        HomeMovement.sit(role, avatar.state.position);
      }
    },
    dance: {
      label: 'Impromptu dance', baseWeight: 0.05, cooldown: 60, duration: 6,
      apply(role, avatar) { avatar.play('dance', 0.3); }
    },
    wave: {
      label: 'Wave at partner', baseWeight: 0.06, cooldown: 30, duration: 2,
      apply(role, avatar) { avatar.play('wave', 0.2, false); }
    }
  };

  // ── Period cue overrides ────────────────────────
  // Cue name → weight multiplier map
  const PERIOD_WEIGHT_OVERRIDES = {
    sleep:          { sit: 0, walkRandomly: 0, lookAtPartner: 0, lookAround: 0.1 },
    wakeUp:         { stretch: 3.0, yawn: 3.0, sit: 0.5 },
    morning_routine:{ walkRandomly: 1.8, checkPhone: 1.5, drinkWater: 2.0 },
    idle_active:    { walkRandomly: 1.5, lookOutWindow: 1.3, dance: 1.2 },
    relaxing:       { sit: 2.0, lookOutWindow: 1.5, lookAtPartner: 1.5 },
    cozy:           { sit: 2.5, lookAtPartner: 2.0, petAnimal: 1.8 },
    wind_down:      { sit: 2.5, stretch: 1.5, yawn: 2.0, walkRandomly: 0.3 }
  };

  // ── Per-role state ──────────────────────────────
  const _roleState = {
    user1: { timer: 3.0, activeBehavior: null, activeTimer: 0, lastUsed: {} },
    user2: { timer: 5.0, activeBehavior: null, activeTimer: 0, lastUsed: {} }
  };

  let _periodCue      = 'idle_active';
  let _disposed       = false;

  // ── Weight computation ─────────────────────────
  function _computeWeights(role) {
    const overrides = PERIOD_WEIGHT_OVERRIDES[_periodCue] || {};
    const relWeights = window.HomeRelationshipEngine
      ? HomeRelationshipEngine.getIdleBehaviorWeights() : {};
    const now = performance.now() / 1000;
    const state = _roleState[role];

    const weights = {};
    for (const [key, def] of Object.entries(BEHAVIORS)) {
      let w = def.baseWeight;

      // Period cue multiplier
      if (overrides[key] !== undefined) w *= overrides[key];

      // Relationship influence
      if (key === 'lookAtPartner' && relWeights.lookAtPartner) w *= (1 + relWeights.lookAtPartner);
      if (key === 'walkRandomly'  && relWeights.walkRandomly)  w *= (1 + relWeights.walkRandomly);
      if (key === 'petAnimal'     && relWeights.petAnimal)     w *= (1 + relWeights.petAnimal);
      if (key === 'stretch'       && relWeights.stretchYawn)   w *= (1 + relWeights.stretchYawn);

      // Cooldown gate
      const lastUsed = state.lastUsed[key] || 0;
      if (now - lastUsed < def.cooldown) w = 0;

      weights[key] = Math.max(0, w);
    }
    return weights;
  }

  function _pickBehavior(weights) {
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    if (total <= 0) return 'lookAround';
    let r = Math.random() * total;
    for (const [key, w] of Object.entries(weights)) {
      r -= w;
      if (r <= 0) return key;
    }
    return 'lookAround';
  }

  // ── Execute behavior for a role ─────────────────
  function _executeBehavior(role, key) {
    if (!window.HomeAvatars) return;
    const avatar = HomeAvatars.get(role);
    if (!avatar) return;

    const def   = BEHAVIORS[key];
    const state = _roleState[role];
    state.activeBehavior = key;
    state.activeTimer    = def.duration + Math.random() * 2;
    state.lastUsed[key]  = performance.now() / 1000;

    try { def.apply(role, avatar); } catch (e) {
      console.warn('[HomeNPCBehavior]', role, key, e.message);
    }
  }

  // ── Per-frame update ───────────────────────────
  function update(dt) {
    if (_disposed) return;

    for (const role of ['user1', 'user2']) {
      const state = _roleState[role];

      if (state.activeBehavior) {
        state.activeTimer -= dt;
        if (state.activeTimer <= 0) {
          state.activeBehavior = null;
          // Return to idle
          if (window.HomeAvatars) {
            const av = HomeAvatars.get(role);
            if (av) try { av.play('idle', 0.5); } catch (_) {}
          }
        }
      } else {
        state.timer -= dt;
        if (state.timer <= 0) {
          const weights = _computeWeights(role);
          const key     = _pickBehavior(weights);
          _executeBehavior(role, key);
          // Next idle interval: 6-18 sec, modified by energy
          const energy = window.HomeRelationshipEngine
            ? HomeRelationshipEngine.getValue('energy') : 60;
          state.timer = 6 + Math.random() * 12 * (energy / 100);
        }
      }
    }
  }

  // ── Public API ─────────────────────────────────
  function setPeriodCue(cue) { _periodCue = cue; }
  function getPeriodCue()    { return _periodCue; }

  function forceBehavior(role, key) {
    if (!BEHAVIORS[key]) return;
    _executeBehavior(role, key);
  }

  function init() { _disposed = false; }
  function dispose() { _disposed = true; }

  return { init, update, dispose, setPeriodCue, getPeriodCue, forceBehavior, BEHAVIORS };
})();

// Backward-compat alias — scene.js calls HomeAIBehavior.update(dt)
window.HomeNPCBehavior = HomeNPCBehavior;
// Also register as HomeAIBehavior if not already defined
if (!window.HomeAIBehavior) window.HomeAIBehavior = HomeNPCBehavior;
