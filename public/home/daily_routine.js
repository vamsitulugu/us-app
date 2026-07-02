// public/home/daily_routine.js
// ════════════════════════════════════════════════
//  Daily Routine Engine — Phase 8
//  Drives all time-based automatic changes:
//  lighting, sky, weather intensity, avatar AI
//  cues, ambient audio layers, fireplace, pet
//  activity patterns. Uses real wall-clock time
//  by default; can be overridden for fast-forward.
// ════════════════════════════════════════════════
const HomeDailyRoutine = (() => {

  // ── Period definitions ──────────────────────────
  // wallStart/wallEnd = real hours (24h); skyTime = normalised sky position
  const PERIODS = {
    midnight:  { label: 'Midnight',   wallStart: 0,  wallEnd: 5,  skyTime: 0.02, icon: '🌑' },
    dawn:      { label: 'Dawn',       wallStart: 5,  wallEnd: 7,  skyTime: 0.15, icon: '🌅' },
    morning:   { label: 'Morning',    wallStart: 7,  wallEnd: 12, skyTime: 0.35, icon: '☀️' },
    afternoon: { label: 'Afternoon',  wallStart: 12, wallEnd: 17, skyTime: 0.55, icon: '🌤️' },
    sunset:    { label: 'Sunset',     wallStart: 17, wallEnd: 20, skyTime: 0.72, icon: '🌇' },
    evening:   { label: 'Evening',    wallStart: 20, wallEnd: 22, skyTime: 0.85, icon: '🌆' },
    night:     { label: 'Night',      wallStart: 22, wallEnd: 24, skyTime: 0.95, icon: '🌙' }
  };

  // What each period applies automatically
  const PERIOD_CONFIG = {
    midnight: {
      lights:      { living: false, kitchen: false, bedroom: false },
      fireplace:   false,
      tvOff:       true,
      avatarCue:   'sleep',
      petCue:      'sleep',
      fogDensity:  0.014,
      lightPreset: 'night',
      musicGenre:  'ambient',
      outdoorAmbience: 'night',
      windowBrightness: 0.0
    },
    dawn: {
      lights:      { bedroom: false },
      fireplace:   false,
      avatarCue:   'wakeUp',
      petCue:      'wake',
      fogDensity:  0.010,
      lightPreset: 'dawn',
      musicGenre:  'gentle',
      outdoorAmbience: 'birds_morning',
      windowBrightness: 0.2
    },
    morning: {
      lights:      { living: true, kitchen: true },
      fireplace:   false,
      avatarCue:   'morning_routine',
      petCue:      'active',
      fogDensity:  0.008,
      lightPreset: 'day',
      musicGenre:  'upbeat',
      outdoorAmbience: 'birds',
      windowBrightness: 0.8
    },
    afternoon: {
      lights:      { living: true },
      fireplace:   false,
      avatarCue:   'idle_active',
      petCue:      'active',
      fogDensity:  0.008,
      lightPreset: 'day',
      musicGenre:  'chill',
      outdoorAmbience: 'nature',
      windowBrightness: 1.0
    },
    sunset: {
      lights:      { living: true, kitchen: true },
      fireplace:   false,
      avatarCue:   'relaxing',
      petCue:      'calm',
      fogDensity:  0.010,
      lightPreset: 'sunset',
      musicGenre:  'romantic',
      outdoorAmbience: 'birds_evening',
      windowBrightness: 0.6
    },
    evening: {
      lights:      { living: true, bedroom: true },
      fireplace:   true,
      avatarCue:   'cozy',
      petCue:      'calm',
      fogDensity:  0.012,
      lightPreset: 'evening',
      musicGenre:  'lofi',
      outdoorAmbience: 'crickets',
      windowBrightness: 0.1
    },
    night: {
      lights:      { living: false, bedroom: true },
      fireplace:   false,
      avatarCue:   'wind_down',
      petCue:      'sleep',
      fogDensity:  0.013,
      lightPreset: 'night',
      musicGenre:  'ambient',
      outdoorAmbience: 'night',
      windowBrightness: 0.0
    }
  };

  // ── State ───────────────────────────────────────
  let _currentPeriod = 'morning';
  let _timeScale     = 1.0;     // 1 = real time; >1 = fast-forward
  let _overrideTime  = null;    // decimal hours 0-24, or null for real clock
  let _accumulator   = 0;       // seconds within current simulation minute
  let _lastWall      = -1;
  let _listeners     = [];      // fn(period, config)
  let _tickListeners = [];      // fn(skyTime) — called every frame

  // ── Clock ───────────────────────────────────────
  function _getDecimalHour() {
    if (_overrideTime !== null) return _overrideTime % 24;
    const now = new Date();
    return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  }

  function _hourToPeriod(h) {
    for (const [key, def] of Object.entries(PERIODS)) {
      if (h >= def.wallStart && h < def.wallEnd) return key;
    }
    return 'midnight'; // 0-5 fallback
  }

  function _hourToSkyTime(h) {
    // Smooth mapping: 0h=0.0, 6h=0.12, 12h=0.50, 18h=0.75, 24h=1.0
    return h / 24;
  }

  // ── Apply period to all systems ─────────────────
  function _applyPeriod(period, force = false) {
    if (period === _currentPeriod && !force) return;
    const prev = _currentPeriod;
    _currentPeriod = period;
    const cfg = PERIOD_CONFIG[period];
    if (!cfg) return;

    // Room lights
    if (window.HomeEnvironment) {
      Object.entries(cfg.lights || {}).forEach(([room, on]) => {
        try { HomeEnvironment.setRoomLight(room, on); } catch (_) {}
        HomeStateManager.setLight(room, on);
      });
    }

    // Fireplace
    if (cfg.fireplace !== undefined) {
      HomeStateManager.setFireplace(cfg.fireplace);
      if (window.HomeScene) HomeScene.state.fireplace = cfg.fireplace;
      if (window.HomeFireplace) {
        try { cfg.fireplace ? HomeFireplace.enable() : HomeFireplace.disable(); } catch (_) {}
      }
    }

    // TV off at midnight/dawn
    if (cfg.tvOff && window.HomeEnvironment) {
      try { HomeEnvironment.setTV(false); } catch (_) {}
      HomeStateManager.setTV(false);
    }

    // Sky time preset
    const skyTime = PERIODS[period].skyTime;
    if (window.HomeSky) {
      try { HomeSky.setTime(skyTime); } catch (_) {}
    }
    HomeStateManager.setSkyTime(skyTime);
    HomeStateManager.setTimeOfDay(period);
    HomeStateManager.setRoutinePeriod(period);

    // Ambient audio
    if (window.HomeAmbientAudioEngine) {
      try {
        HomeAmbientAudioEngine.setOutdoorAmbience(cfg.outdoorAmbience);
        HomeAmbientAudioEngine.setMusicGenre(cfg.musicGenre);
      } catch (_) {}
    }

    // AI behavior cue
    if (window.HomeNPCBehavior) {
      try { HomeNPCBehavior.setPeriodCue(cfg.avatarCue); } catch (_) {}
    }

    // Pet behavior cue
    if (window.HomePets) {
      try { HomePets.setPeriodCue && HomePets.setPeriodCue(cfg.petCue); } catch (_) {}
    }

    // Fog
    if (window.HomeWeather) {
      // Only nudge fog if weather is clear/cloudy (don't override storm fog)
      const w = HomeStateManager.get('weather');
      if (['clear','cloudy'].includes(w) && window.HomeScene && HomeScene.getScene()) {
        const s = HomeScene.getScene();
        if (s.fog) s.fog.density = cfg.fogDensity;
      }
    }

    // Notify listeners
    _listeners.forEach(fn => { try { fn(period, cfg, prev); } catch (_) {} });

    // Dispatch DOM event for any legacy listener
    window.dispatchEvent(new CustomEvent('home:routinePeriodChange', {
      detail: { period, config: cfg, prev }
    }));
  }

  // ── Per-frame tick ─────────────────────────────
  function update(dt) {
    if (_overrideTime !== null) {
      _overrideTime = (_overrideTime + dt * _timeScale * (24 / 86400)) % 24;
    }

    const hour     = _getDecimalHour();
    const skyTime  = _hourToSkyTime(hour);
    const period   = _hourToPeriod(hour);

    // Continuous sky time update (smooth)
    if (window.HomeSky) {
      try { HomeSky.setTime(skyTime); } catch (_) {}
    }
    HomeStateManager.setSkyTime(skyTime);

    // Tick listeners (camera director etc)
    _tickListeners.forEach(fn => { try { fn(skyTime, hour, period); } catch (_) {} });

    // Period change detection
    if (period !== _currentPeriod) {
      _applyPeriod(period);
    }

    // Gentle fog lerp toward period target
    const targetFog = PERIOD_CONFIG[period]?.fogDensity ?? 0.012;
    const w = HomeStateManager.get('weather');
    if (['clear','cloudy'].includes(w) && window.HomeScene) {
      const s = HomeScene.getScene();
      if (s && s.fog) {
        s.fog.density += (targetFog - s.fog.density) * dt * 0.3;
      }
    }
  }

  // ── Public API ─────────────────────────────────
  function getPeriod()        { return _currentPeriod; }
  function getPeriodConfig()  { return PERIOD_CONFIG[_currentPeriod]; }
  function getPeriods()       { return PERIODS; }
  function getSkyTime()       { return _hourToSkyTime(_getDecimalHour()); }
  function getDecimalHour()   { return _getDecimalHour(); }

  function setTimeOverride(h) {
    _overrideTime = h == null ? null : parseFloat(h) % 24;
    if (_overrideTime !== null) update(0);
  }

  function setTimeScale(s) { _timeScale = Math.max(0.1, s); }

  function onPeriodChange(fn) {
    _listeners.push(fn);
    return () => { _listeners = _listeners.filter(f => f !== fn); };
  }

  function onTick(fn) {
    _tickListeners.push(fn);
    return () => { _tickListeners = _tickListeners.filter(f => f !== fn); };
  }

  function fastForwardTo(period) {
    const def = PERIODS[period];
    if (!def) return;
    const midHour = (def.wallStart + def.wallEnd) / 2;
    setTimeOverride(midHour);
    _applyPeriod(period, true);
  }

  function init() {
    const hour   = _getDecimalHour();
    const period = _hourToPeriod(hour);
    _applyPeriod(period, true);
  }

  function dispose() {
    _listeners = [];
    _tickListeners = [];
    _overrideTime = null;
  }

  return {
    init, update, dispose,
    getPeriod, getPeriodConfig, getPeriods,
    getSkyTime, getDecimalHour,
    setTimeOverride, setTimeScale,
    onPeriodChange, onTick,
    fastForwardTo,
    PERIODS, PERIOD_CONFIG
  };
})();

window.HomeDailyRoutine = HomeDailyRoutine;
