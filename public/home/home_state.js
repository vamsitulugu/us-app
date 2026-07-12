// public/home/home_state.js
// ════════════════════════════════════════════════
//  HomeStateManager — Virtual Home shared state store
// ════════════════════════════════════════════════
//  This file was missing from the project (every Virtual Home
//  module calls `window.HomeStateManager` but nothing defined it,
//  so every session crashed with "HomeStateManager is not defined"
//  on smart furniture, daily routine, relationship stats, camera
//  mode changes, and event tracking).
//
//  This implementation restores the exact method surface every
//  dependent module calls:
//    setCameraMode, setLight, setFireplace, setTV, setSkyTime,
//    setTimeOfDay, setRoutinePeriod, get, getAll, getLastEvent,
//    setLastEvent, getRelationship, setRelationshipValue,
//    setFurnitureState, getFurnitureState, setWindow, applyToScene
//
//  Persistence strategy:
//   - Full state is cached in localStorage (uwl_home_state_v1) so
//     it survives reloads even without a dedicated backend table.
//   - The subset of fields the backend already has a home_settings
//     table for (time_of_day, weather, active_room) is additionally
//     synced there (best-effort, debounced, silently ignored on
//     failure — matches the app's existing push/notification
//     fire-and-forget pattern) so it's visible across devices.
// ════════════════════════════════════════════════
(function () {
  'use strict';

  const STORAGE_KEY = 'uwl_home_state_v1';
  const SYNC_DEBOUNCE_MS = 1500;

  function _loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }

  const _defaults = {
    weather: 'clear',
    time_of_day: 'day',
    active_room: 'living',
    routinePeriod: 'day',
    skyTime: 12,
    cameraMode: 'default',
    fireplace: false,
    tv: false,
    lights: {},     // room -> bool
    windows: {},    // windowName -> 'open' | 'closed'
    furniture: {},  // furnitureKey -> { ...patch }
    relationship: {}, // valueKey -> number
    lastEvent: {}   // eventKey -> timestamp (ms, performance.now() scale)
  };

  const saved = _loadFromStorage();
  const _state = Object.assign({}, _defaults, saved || {});
  // Deep-merge the nested objects rather than letting a partial saved
  // blob wipe out defaults for keys it didn't have yet.
  ['lights', 'windows', 'furniture', 'relationship', 'lastEvent'].forEach(k => {
    _state[k] = Object.assign({}, _defaults[k], (saved && saved[k]) || {});
  });

  let _saveTimer = null;
  function _persistLocal() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_state)); } catch (e) {}
  }

  function _getCoupleId() {
    try {
      const raw = localStorage.getItem('uwl_v5');
      if (raw) return JSON.parse(raw).coupleId || null;
    } catch (e) {}
    return null;
  }

  function _syncSettingsToBackend() {
    const coupleId = _getCoupleId();
    if (!coupleId) return;
    fetch(`https://us-app-av6d.onrender.com/api/home/settings/${coupleId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        time_of_day: _state.time_of_day,
        weather: _state.weather,
        active_room: _state.active_room
      })
    }).catch(() => {});
  }

  function _scheduleSave() {
    _persistLocal();
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(_syncSettingsToBackend, SYNC_DEBOUNCE_MS);
  }

  function _emit(key, value) {
    window.dispatchEvent(new CustomEvent('homestate:change', { detail: { key, value } }));
  }

  const HomeStateManager = {
    // ── generic get/getAll ──────────────────────────
    get(key) { return _state[key]; },
    getAll() { return JSON.parse(JSON.stringify(_state)); },

    // ── camera ───────────────────────────────────────
    setCameraMode(mode) {
      _state.cameraMode = mode;
      _scheduleSave();
      _emit('cameraMode', mode);
    },

    // ── lighting ─────────────────────────────────────
    setLight(room, on) {
      _state.lights[room] = !!on;
      _scheduleSave();
      _emit('light:' + room, !!on);
    },

    // ── fireplace / TV ───────────────────────────────
    setFireplace(on) {
      _state.fireplace = !!on;
      _scheduleSave();
      _emit('fireplace', !!on);
    },
    setTV(on) {
      _state.tv = !!on;
      _scheduleSave();
      _emit('tv', !!on);
    },

    // ── time / weather / routine ────────────────────
    setSkyTime(t) {
      _state.skyTime = t;
      _scheduleSave();
      _emit('skyTime', t);
    },
    setTimeOfDay(period) {
      _state.time_of_day = period;
      _scheduleSave();
      _emit('time_of_day', period);
    },
    setRoutinePeriod(period) {
      _state.routinePeriod = period;
      _scheduleSave();
      _emit('routinePeriod', period);
    },
    setWindow(name, state) {
      _state.windows[name] = state;
      _scheduleSave();
      _emit('window:' + name, state);
    },

    // ── furniture ────────────────────────────────────
    getFurnitureState(key) { return _state.furniture[key] || null; },
    setFurnitureState(key, patch) {
      _state.furniture[key] = Object.assign({}, _state.furniture[key], patch);
      _scheduleSave();
      _emit('furniture:' + key, _state.furniture[key]);
    },

    // ── relationship values ─────────────────────────
    getRelationship() { return Object.assign({}, _state.relationship); },
    setRelationshipValue(key, value) {
      _state.relationship[key] = value;
      _scheduleSave();
      _emit('relationship:' + key, value);
    },

    // ── one-shot event cooldown tracking ────────────
    getLastEvent(key) { return _state.lastEvent[key] || 0; },
    setLastEvent(key) {
      _state.lastEvent[key] = performance.now();
      _scheduleSave();
    },

    // ── re-apply persisted state to a freshly-built scene ──
    // Best-effort: calls into whichever scene subsystems are
    // currently loaded. Every call is individually guarded so a
    // missing subsystem never blocks the rest from applying.
    applyToScene() {
      try {
        if (window.HomeLighting) {
          Object.entries(_state.lights).forEach(([room, on]) => {
            try { HomeLighting.setLight && HomeLighting.setLight(room, on); } catch (e) {}
          });
        }
      } catch (e) {}
      try {
        if (window.HomeAmbientAudioEngine) {
          if (_state.fireplace) HomeAmbientAudioEngine.setFireplaceAudio && HomeAmbientAudioEngine.setFireplaceAudio(true);
          if (_state.tv) HomeAmbientAudioEngine.setTVAudio && HomeAmbientAudioEngine.setTVAudio(true);
        }
      } catch (e) {}
      try {
        if (window.HomeWeather && _state.weather) {
          HomeWeather.setWeather && HomeWeather.setWeather(_state.weather);
        }
      } catch (e) {}
      try {
        if (window.HomeDailyRoutine && _state.routinePeriod) {
          HomeDailyRoutine.setPeriod && HomeDailyRoutine.setPeriod(_state.routinePeriod);
        }
      } catch (e) {}
      try {
        if (window.HomeSmartFurniture && HomeSmartFurniture.restoreState) {
          HomeSmartFurniture.restoreState(_state.furniture);
        }
      } catch (e) {}
      try {
        if (window.HomeCameraDirector && _state.cameraMode) {
          HomeCameraDirector.setMode && HomeCameraDirector.setMode(_state.cameraMode, 0);
        }
      } catch (e) {}
      _emit('sceneApplied', true);
    }
  };

  window.HomeStateManager = HomeStateManager;
})();
