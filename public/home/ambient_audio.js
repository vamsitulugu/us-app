// public/home/ambient_audio.js
// ════════════════════════════════════════════════
//  Ambient Audio — Phase 7, Feature 6
//  Rain, Thunder, Wind, Fireplace crackling,
//  Birds (morning), Crickets (night), Water
//  fountain, Kitchen, TV, Morning/Night ambience.
//  Uses Web Audio API with procedural synthesis
//  (no external audio files needed).
//  NEW MODULE — does NOT rewrite any Phase 1-6 file.
// ════════════════════════════════════════════════
const HomeAmbientAudio = (() => {

  let _ctx        = null;    // AudioContext
  let _master     = null;    // GainNode (master volume)
  let _enabled    = true;
  let _volume     = 0.55;

  // ── Layer registry ────────────────────────────
  // Each layer: { node, gain, target, current }
  const _layers = {};

  // ── Procedural generators ─────────────────────
  // We synthesise every sound from noise / oscillators
  // so no file loading is required.

  // ─────────────────────────────────────────────
  // INIT
  // ─────────────────────────────────────────────
  function _ensureContext() {
    if (_ctx) return true;
    try {
      _ctx    = new (window.AudioContext || window.webkitAudioContext)();
      _master = _ctx.createGain();
      _master.gain.value = _volume;
      _master.connect(_ctx.destination);
      return true;
    } catch (e) {
      console.warn('[HomeAmbientAudio] Web Audio not available:', e);
      return false;
    }
  }

  function _resumeCtx() {
    if (_ctx && _ctx.state === 'suspended') _ctx.resume();
  }

  // ─────────────────────────────────────────────
  // NOISE BUFFER helper
  // ─────────────────────────────────────────────
  function _makeNoiseBuffer(seconds = 2) {
    const frames = Math.floor(_ctx.sampleRate * seconds);
    const buf    = _ctx.createBuffer(1, frames, _ctx.sampleRate);
    const data   = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ─────────────────────────────────────────────
  // LAYER FACTORY
  // Each layer is a looping noise → filter → gain chain
  // ─────────────────────────────────────────────
  function _createNoiseLayer(key, filterType, filterFreq, filterQ = 1) {
    if (_layers[key]) return;
    if (!_ensureContext()) return;

    const buf    = _makeNoiseBuffer(3);
    const source = _ctx.createBufferSource();
    source.buffer = buf;
    source.loop   = true;

    const filter = _ctx.createBiquadFilter();
    filter.type            = filterType;
    filter.frequency.value = filterFreq;
    filter.Q.value         = filterQ;

    const gain = _ctx.createGain();
    gain.gain.value = 0;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(_master);
    source.start();

    _layers[key] = { source, gain, filter, target: 0, current: 0 };
  }

  // Oscillator-based layer (for hum, tone, TV flicker)
  function _createOscLayer(key, type, freq, detune = 0) {
    if (_layers[key]) return;
    if (!_ensureContext()) return;

    const osc  = _ctx.createOscillator();
    osc.type   = type;
    osc.frequency.value = freq;
    osc.detune.value    = detune;

    const gain = _ctx.createGain();
    gain.gain.value = 0;

    osc.connect(gain);
    gain.connect(_master);
    osc.start();

    _layers[key] = { source: osc, gain, target: 0, current: 0 };
  }

  // ─────────────────────────────────────────────
  // SOUND DEFINITIONS
  // ─────────────────────────────────────────────
  function _buildAllLayers() {
    // ── Rain: white noise, low-pass filter ──────
    _createNoiseLayer('rain_light',  'lowpass',  900,  1.2);
    _createNoiseLayer('rain_heavy',  'lowpass',  1800, 0.9);

    // ── Wind: bandpass swept noise ───────────────
    _createNoiseLayer('wind',        'bandpass', 320,  3.0);

    // ── Thunder rumble: very low-pass noise ──────
    _createNoiseLayer('thunder_rumble', 'lowpass', 80, 2.0);

    // ── Fireplace crackle: high-passed noise ─────
    _createNoiseLayer('fireplace',   'highpass', 1200, 0.7);

    // ── Birds (morning): narrow band noise ~3kHz ─
    _createNoiseLayer('birds',       'bandpass', 3000, 6.0);

    // ── Crickets (night): narrow band ~2kHz ──────
    _createNoiseLayer('crickets',    'bandpass', 2200, 8.0);

    // ── Fountain: mid-range noise ─────────────────
    _createNoiseLayer('fountain',    'bandpass', 1400, 2.0);

    // ── Kitchen: low hum + gentle broadband ──────
    _createOscLayer('kitchen_hum',  'sine', 120);
    _createNoiseLayer('kitchen_bg',  'lowpass',  600, 1.0);

    // ── TV: slight hiss + 50/60 Hz hum ───────────
    _createOscLayer('tv_hum',       'sine', 220);
    _createNoiseLayer('tv_static',   'bandpass', 4000, 3.0);

    // ── Night ambience: deep sub hum ─────────────
    _createOscLayer('night_hum',    'sine', 55, -12);

    // ── Morning ambience: gentle breeze noise ────
    _createNoiseLayer('morning_air', 'lowpass', 500, 1.5);
  }

  // ─────────────────────────────────────────────
  // LAYER VOLUME TARGETS
  // ─────────────────────────────────────────────
  function _setTarget(key, vol) {
    if (_layers[key]) _layers[key].target = Math.max(0, vol);
  }

  // ─────────────────────────────────────────────
  // WEATHER → AUDIO MAPPING
  // ─────────────────────────────────────────────
  function _applyWeather(weatherKey, skyTime) {
    const isNight   = skyTime < 0.27 || skyTime > 0.87;
    const isMorning = skyTime >= 0.27 && skyTime <= 0.40;

    _setTarget('rain_light',  0);
    _setTarget('rain_heavy',  0);
    _setTarget('wind',        0);
    _setTarget('birds',       0);
    _setTarget('crickets',    0);
    _setTarget('morning_air', 0);
    _setTarget('night_hum',   0);

    switch (weatherKey) {
      case 'drizzle':
        _setTarget('rain_light', 0.28);
        _setTarget('wind',       0.08);
        break;
      case 'rain':
        _setTarget('rain_light', 0.45);
        _setTarget('rain_heavy', 0.25);
        _setTarget('wind',       0.12);
        break;
      case 'heavyrain':
        _setTarget('rain_light', 0.55);
        _setTarget('rain_heavy', 0.60);
        _setTarget('wind',       0.22);
        break;
      case 'thunderstorm':
        _setTarget('rain_light', 0.55);
        _setTarget('rain_heavy', 0.70);
        _setTarget('wind',       0.35);
        break;
      case 'wind':
        _setTarget('wind',       0.55);
        break;
      case 'fog':
        _setTarget('wind',       0.06);
        break;
      case 'clear':
      case 'cloudy':
        if (isMorning) {
          _setTarget('birds',       0.22);
          _setTarget('morning_air', 0.10);
        }
        if (isNight) {
          _setTarget('crickets',    0.18);
          _setTarget('night_hum',   0.08);
        }
        break;
    }
  }

  // ─────────────────────────────────────────────
  // THUNDER ONE-SHOT
  // ─────────────────────────────────────────────
  function onThunder() {
    if (!_ensureContext() || !_enabled) return;
    _resumeCtx();

    // Short burst of low rumble
    const buf    = _makeNoiseBuffer(0.8);
    const src    = _ctx.createBufferSource();
    src.buffer   = buf;

    const filt   = _ctx.createBiquadFilter();
    filt.type    = 'lowpass';
    filt.frequency.value = 120;

    const env    = _ctx.createGain();
    env.gain.setValueAtTime(0, _ctx.currentTime);
    env.gain.linearRampToValueAtTime(0.9, _ctx.currentTime + 0.05);
    env.gain.exponentialRampToValueAtTime(0.001, _ctx.currentTime + 1.8);

    src.connect(filt);
    filt.connect(env);
    env.connect(_master);
    src.start();
    src.stop(_ctx.currentTime + 2.0);
  }

  // ─────────────────────────────────────────────
  // INDOOR STATE → AUDIO MAPPING
  // ─────────────────────────────────────────────
  function _applyIndoorState(envState) {
    if (!envState) return;

    // Fireplace crackle
    _setTarget('fireplace', envState.fireplace ? 0.38 : 0);

    // TV
    _setTarget('tv_hum',    envState.tv ? 0.08 : 0);
    _setTarget('tv_static', envState.tv ? 0.06 : 0);

    // Kitchen ambience (always slight when in kitchen)
    const inKitchen = window.HomeScene && HomeScene.currentRoom === 'kitchen';
    _setTarget('kitchen_hum', inKitchen ? 0.06 : 0);
    _setTarget('kitchen_bg',  inKitchen ? 0.08 : 0);

    // Fountain (garden or rooftop)
    const inGarden  = window.HomeScene && (HomeScene.currentRoom === 'garden' || HomeScene.currentRoom === 'rooftop');
    _setTarget('fountain', inGarden ? 0.22 : 0);
  }

  // ─────────────────────────────────────────────
  // SMOOTH VOLUME UPDATE (called every frame)
  // ─────────────────────────────────────────────
  function _smoothLayers(dt) {
    const speed = 2.5 * dt;
    Object.values(_layers).forEach(layer => {
      if (!layer.gain) return;
      const diff = layer.target - layer.current;
      layer.current += diff * Math.min(1, speed * 3);
      layer.gain.gain.setTargetAtTime(
        _enabled ? layer.current : 0,
        _ctx.currentTime,
        0.12
      );
    });
  }

  // ─────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────
  function init() {
    // Defer AudioContext creation to first user interaction
    const start = () => {
      if (_ensureContext()) {
        _buildAllLayers();
        document.removeEventListener('click',     start);
        document.removeEventListener('touchstart', start);
        document.removeEventListener('keydown',    start);
      }
    };
    document.addEventListener('click',     start, { once: true });
    document.addEventListener('touchstart', start, { once: true });
    document.addEventListener('keydown',   start, { once: true });

    // Listen for fireplace / TV / window events
    window.addEventListener('home:fireplaceState', e => {
      if (_layers.fireplace) _setTarget('fireplace', e.detail.on ? 0.38 : 0);
    });
    window.addEventListener('home:tvState', e => {
      _setTarget('tv_hum',    e.detail.on ? 0.08 : 0);
      _setTarget('tv_static', e.detail.on ? 0.06 : 0);
    });
    window.addEventListener('home:weatherChange', e => {
      const skyTime = window.HomeSky ? HomeSky.getTime() : 0.5;
      _applyWeather(e.detail.weather, skyTime);
    });
  }

  function update(dt) {
    if (!_ctx || !_enabled) return;
    _resumeCtx();

    const weatherKey = window.HomeWeather ? HomeWeather.getCurrent() : 'clear';
    const skyTime    = window.HomeSky     ? HomeSky.getTime()        : 0.5;
    const envState   = window.HomeEnvironment ? HomeEnvironment.getState() : null;

    _applyWeather(weatherKey, skyTime);
    _applyIndoorState(envState);
    _smoothLayers(dt);
  }

  function setVolume(v) {
    _volume = HomeUtils.clamp(v, 0, 1);
    if (_master) _master.gain.setTargetAtTime(_volume, _ctx.currentTime, 0.05);
  }

  function setEnabled(v) {
    _enabled = !!v;
    if (_master) _master.gain.setTargetAtTime(_enabled ? _volume : 0, _ctx.currentTime, 0.1);
  }

  function getVolume()  { return _volume; }
  function isEnabled()  { return _enabled; }

  function dispose() {
    Object.values(_layers).forEach(l => {
      try { l.source && l.source.stop(); } catch (_) {}
    });
    if (_ctx) { _ctx.close(); _ctx = null; }
  }

  return { init, update, dispose, setVolume, setEnabled, getVolume, isEnabled, onThunder };
})();

window.HomeAmbientAudio = HomeAmbientAudio;