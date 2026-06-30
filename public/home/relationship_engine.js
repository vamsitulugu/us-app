// public/home/relationship_engine.js
// ════════════════════════════════════════════════
//  Relationship & Emotion Engine — Phase 8
//  Tracks hidden relationship values and emotional
//  states; drives animation speed, lighting warmth,
//  music selection, idle behavior weights, pet
//  reactions. Every interaction earns/spends values.
// ════════════════════════════════════════════════
const HomeRelationshipEngine = (() => {

  // ── Value definitions ───────────────────────────
  // Each value: range 0-100, decay rate per second, effect description
  const VALUE_DEFS = {
    love:       { decay: 0.001, label: 'Love',       icon: '❤️'  },
    comfort:    { decay: 0.002, label: 'Comfort',    icon: '🤗'  },
    energy:     { decay: 0.004, label: 'Energy',     icon: '⚡'  },
    mood:       { decay: 0.003, label: 'Mood',       icon: '😊'  },
    excitement: { decay: 0.006, label: 'Excitement', icon: '✨'  },
    stress:     { decay: 0.002, label: 'Stress',     icon: '😰', inverted: true },
    trust:      { decay: 0.0005, label: 'Trust',     icon: '🤝' }
  };

  // ── Interaction XP table ────────────────────────
  const INTERACTION_XP = {
    holdHands:    { love: +4,  comfort: +3, trust: +2 },
    hug:          { love: +6,  comfort: +5, mood: +4, stress: -8 },
    kiss:         { love: +8,  excitement: +6, mood: +5, trust: +3 },
    highFive:     { mood: +5,  excitement: +4, energy: +3 },
    danceTogether:{ love: +5,  excitement: +8, mood: +6, stress: -5 },
    sitTogether:  { comfort: +4, stress: -3 },
    sleepTogether:{ comfort: +6, energy: +10, stress: -10 },
    selfie:       { love: +3,  excitement: +5, mood: +4 },
    watchTV:      { comfort: +3, stress: -4 },
    listenMusic:  { comfort: +4, mood: +5, stress: -3 },
    cookTogether: { love: +4,  trust: +3, mood: +3 },
    playGames:    { excitement: +7, mood: +5, stress: -2 },
    gardenTogether:{ comfort: +5, mood: +6, stress: -6, trust: +2 },
    readTogether: { comfort: +4, trust: +4, stress: -4 }
  };

  // Pet interaction XP
  const PET_XP = {
    feed:    { comfort: +2, mood: +2 },
    play:    { excitement: +4, mood: +3, stress: -2 },
    cuddle:  { comfort: +3, stress: -4 }
  };

  // ── Internal state ─────────────────────────────
  let _values    = {};
  let _listeners = [];   // fn(key, newVal, delta)
  let _moodLabel = 'content';

  function _loadValues() {
    const saved = HomeStateManager.getRelationship();
    _values = { ...saved };
    // Ensure all keys exist
    for (const key of Object.keys(VALUE_DEFS)) {
      if (_values[key] == null) _values[key] = 50;
    }
  }

  function _saveValues() {
    for (const [k, v] of Object.entries(_values)) {
      HomeStateManager.setRelationshipValue(k, v);
    }
  }

  // ── Core mutator ───────────────────────────────
  function adjust(key, delta) {
    if (!VALUE_DEFS[key]) return;
    const prev = _values[key];
    _values[key] = Math.max(0, Math.min(100, prev + delta));
    const actual = _values[key] - prev;
    if (Math.abs(actual) > 0.01) {
      _listeners.forEach(fn => { try { fn(key, _values[key], actual); } catch (_) {} });
      HomeStateManager.setRelationshipValue(key, _values[key]);
    }
  }

  function applyInteractionXP(interactionKey) {
    const xp = INTERACTION_XP[interactionKey];
    if (!xp) return;
    for (const [k, v] of Object.entries(xp)) adjust(k, v);
    _updateMoodLabel();
    _propagateEffects();
  }

  function applyPetXP(action) {
    const xp = PET_XP[action];
    if (!xp) return;
    for (const [k, v] of Object.entries(xp)) adjust(k, v);
  }

  // ── Mood label ──────────────────────────────────
  function _updateMoodLabel() {
    const avg = (
      _values.love * 0.25 +
      _values.mood * 0.25 +
      _values.comfort * 0.20 +
      (100 - _values.stress) * 0.15 +
      _values.energy * 0.15
    );
    if (avg >= 80)      _moodLabel = 'blissful';
    else if (avg >= 65) _moodLabel = 'happy';
    else if (avg >= 50) _moodLabel = 'content';
    else if (avg >= 35) _moodLabel = 'neutral';
    else if (avg >= 20) _moodLabel = 'tired';
    else                _moodLabel = 'sad';
  }

  // ── Propagate effects to other systems ─────────
  function _propagateEffects() {
    // Walking speed — energy drives pace
    if (window.HomeMovement && HomeMovement.setSpeedMultiplier) {
      const speedMult = 0.7 + (_values.energy / 100) * 0.6;
      HomeMovement.setSpeedMultiplier(speedMult);
    }

    // Lighting warmth — love/comfort tint the ambient
    if (window.HomeLighting) {
      const warmth = (_values.love + _values.comfort) / 200;
      const r = Math.floor(200 + warmth * 55);
      const g = Math.floor(170 + warmth * 30);
      const b = Math.floor(140 + (1 - warmth) * 80);
      try {
        const lights = HomeLighting.getAll();
        if (lights.ambient) {
          lights.ambient.color.setRGB(r / 255, g / 255, b / 255);
        }
      } catch (_) {}
    }

    // Music mood
    if (window.HomeAmbientAudioEngine) {
      try {
        const genre = _values.excitement > 60 ? 'upbeat'
                    : _values.mood > 65        ? 'romantic'
                    : _values.stress > 60      ? 'ambient'
                    : _values.comfort > 60     ? 'lofi'
                    : 'chill';
        HomeAmbientAudioEngine.setMusicGenre(genre);
      } catch (_) {}
    }

    // Pet reaction to human mood
    if (window.HomePets && HomePets.onMoodChange) {
      try { HomePets.onMoodChange(_moodLabel); } catch (_) {}
    }
  }

  // ── Periodic natural decay ─────────────────────
  function update(dt) {
    let changed = false;
    for (const [key, def] of Object.entries(VALUE_DEFS)) {
      if (def.inverted) {
        // Stress decays toward 0 naturally
        if (_values[key] > 0) {
          _values[key] = Math.max(0, _values[key] - def.decay * dt);
          changed = true;
        }
      } else {
        // Positive values drift slightly toward 50 when extreme
        const drift = (_values[key] - 50) * def.decay * dt * 0.1;
        if (Math.abs(drift) > 0.001) {
          _values[key] -= drift;
          changed = true;
        }
      }
    }
    if (changed) _saveValues();
  }

  // ── Getters ────────────────────────────────────
  function getValue(key)     { return _values[key] ?? 50; }
  function getAll()          { return { ..._values }; }
  function getMoodLabel()    { return _moodLabel; }
  function getCompositeScore() {
    return Math.round(
      _values.love * 0.3 +
      _values.trust * 0.2 +
      _values.comfort * 0.2 +
      _values.mood * 0.15 +
      (100 - _values.stress) * 0.15
    );
  }

  // Idle behavior weights — used by NPC behavior system
  function getIdleBehaviorWeights() {
    return {
      lookAtPartner:  Math.min(1, _values.love / 60),
      relaxedPose:    Math.min(1, _values.comfort / 70),
      stretchYawn:    Math.min(1, (100 - _values.energy) / 60),
      lookOutWindow:  0.15 + (_values.mood < 40 ? 0.15 : 0),
      checkPhone:     0.10 + (_values.stress / 200),
      walkRandomly:   0.10 + (_values.energy / 150),
      petAnimal:      0.12
    };
  }

  function onChange(fn) {
    _listeners.push(fn);
    return () => { _listeners = _listeners.filter(f => f !== fn); };
  }

  // ── Init ───────────────────────────────────────
  function init() {
    _loadValues();
    _updateMoodLabel();

    // Hook into interaction system
    window.addEventListener('home:interactionTriggered', e => {
      if (e.detail && e.detail.key) applyInteractionXP(e.detail.key);
    });

    // Hook into pet actions
    window.addEventListener('home:petAction', e => {
      if (e.detail && e.detail.action) applyPetXP(e.detail.action);
    });

    // Routine period affects relationship values
    window.addEventListener('home:routinePeriodChange', e => {
      const p = e.detail?.period;
      if (p === 'morning')   { adjust('energy', +8); adjust('mood', +3); }
      if (p === 'night')     { adjust('energy', -5); adjust('stress', -5); }
      if (p === 'midnight')  { adjust('energy', -12); }
    });
  }

  function dispose() {
    _listeners = [];
  }

  return {
    init, update, dispose,
    adjust, applyInteractionXP, applyPetXP,
    getValue, getAll, getMoodLabel, getCompositeScore,
    getIdleBehaviorWeights, onChange,
    VALUE_DEFS, INTERACTION_XP
  };
})();

window.HomeRelationshipEngine = HomeRelationshipEngine;
