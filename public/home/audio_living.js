// public/home/audio_living.js
// ════════════════════════════════════════════════
//  Audio Living — Phase 6, Feature 9
//  Footsteps, pet sounds (bark/meow/chirp), sleeping
//  sounds, interaction sounds (hug/kiss/etc).
//  Synthesized via Web Audio API — no binary asset
//  dependency, so it works immediately without files
//  to drop in. Swap in real samples later by editing
//  SAMPLE_PATHS and flipping USE_SAMPLES to true.
//  NEW MODULE — does not modify rooms/furniture/memories.
// ════════════════════════════════════════════════
const HomeAudioLiving = (() => {

  let ctx = null;
  let masterGain = null;
  let enabled = true;
  let muted = false;

  // Flip to true and fill in real file paths to use sampled audio
  // instead of synthesis once you have asset files ready.
  const USE_SAMPLES = false;
  const SAMPLE_PATHS = {
    footstep_soft: '/home/assets/audio/footstep_soft.mp3',
    footstep_run:  '/home/assets/audio/footstep_run.mp3',
    bark:          '/home/assets/audio/dog_bark.mp3',
    meow:          '/home/assets/audio/cat_meow.mp3',
    chirp:         '/home/assets/audio/bird_chirp.mp3',
    sleep:         '/home/assets/audio/sleep_snore.mp3',
    hug:           '/home/assets/audio/hug.mp3',
    kiss:          '/home/assets/audio/kiss.mp3',
    highFive:      '/home/assets/audio/high_five.mp3'
  };
  const sampleCache = {}; // name -> HTMLAudioElement (only used if USE_SAMPLES)

  function _ensureCtx() {
    if (ctx) return ctx;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.5;
      masterGain.connect(ctx.destination);
    } catch (e) {
      console.warn('[HomeAudioLiving] Web Audio unavailable:', e.message);
    }
    return ctx;
  }

  // Footstep throttling per role so we don't spam a beep every frame
  const _footstepTimers = { user1: 0, user2: 0 };
  const FOOTSTEP_INTERVAL_WALK = 0.42; // seconds between steps
  const FOOTSTEP_INTERVAL_RUN  = 0.26;

  // ── Synthesized sound primitives ───────────────────
  function _beep(freq, duration, type = 'sine', gainPeak = 0.18, attack = 0.005) {
    if (!enabled || muted) return;
    const c = _ensureCtx();
    if (!c) return;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, c.currentTime);
    gain.gain.linearRampToValueAtTime(gainPeak, c.currentTime + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start();
    osc.stop(c.currentTime + duration + 0.02);
  }

  function _noiseBurst(duration, gainPeak = 0.12, filterFreq = 800) {
    if (!enabled || muted) return;
    const c = _ensureCtx();
    if (!c) return;
    const bufferSize = Math.floor(c.sampleRate * duration);
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = c.createGain();
    gain.gain.setValueAtTime(gainPeak, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
    src.connect(filter); filter.connect(gain); gain.connect(masterGain);
    src.start();
  }

  function _playSampleOrSynth(name, synthFn) {
    if (USE_SAMPLES && SAMPLE_PATHS[name]) {
      if (!sampleCache[name]) {
        sampleCache[name] = new Audio(SAMPLE_PATHS[name]);
        sampleCache[name].volume = 0.6;
      }
      const a = sampleCache[name];
      try { a.currentTime = 0; a.play().catch(() => synthFn()); }
      catch (_) { synthFn(); }
      return;
    }
    synthFn();
  }

  // ── Footsteps (Feature 9) ──────────────────────────
  function onFootstep(role, isRunning, dt) {
    if (!enabled || muted) return;
    _footstepTimers[role] = (_footstepTimers[role] || 0) + dt;
    const interval = isRunning ? FOOTSTEP_INTERVAL_RUN : FOOTSTEP_INTERVAL_WALK;
    if (_footstepTimers[role] < interval) return;
    _footstepTimers[role] = 0;
    _playSampleOrSynth(isRunning ? 'footstep_run' : 'footstep_soft', () => {
      _noiseBurst(isRunning ? 0.08 : 0.10, isRunning ? 0.10 : 0.07, isRunning ? 500 : 350);
    });
  }

  // ── Pet sounds (Feature 9) ─────────────────────────
  function onPetSound(species) {
    if (!enabled || muted) return;
    const sounds = { dog: 'bark', cat: 'meow', bird: 'chirp' };
    const key = sounds[species];
    if (!key) return; // rabbit/fish are silent by design (matches spec — no sound listed for them)
    _playSampleOrSynth(key, () => {
      if (key === 'bark') {
        _beep(180, 0.16, 'sawtooth', 0.22, 0.01);
        setTimeout(() => _beep(150, 0.12, 'sawtooth', 0.16, 0.01), 140);
      } else if (key === 'meow') {
        _beepSlide(420, 620, 0.32, 0.16);
      } else if (key === 'chirp') {
        _beep(2200, 0.06, 'sine', 0.10, 0.002);
        setTimeout(() => _beep(2600, 0.05, 'sine', 0.08, 0.002), 70);
      }
    });
  }

  // Frequency-sliding tone (used for cat meow — rises then falls)
  function _beepSlide(fromFreq, toFreq, duration, gainPeak) {
    if (!enabled || muted) return;
    const c = _ensureCtx();
    if (!c) return;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(fromFreq, c.currentTime);
    osc.frequency.linearRampToValueAtTime(toFreq, c.currentTime + duration * 0.5);
    osc.frequency.linearRampToValueAtTime(fromFreq * 0.85, c.currentTime + duration);
    gain.gain.setValueAtTime(0, c.currentTime);
    gain.gain.linearRampToValueAtTime(gainPeak, c.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
    osc.connect(gain); gain.connect(masterGain);
    osc.start(); osc.stop(c.currentTime + duration + 0.02);
  }

  // ── Sleeping sounds (Feature 9) ────────────────────
  let _sleepLoopHandle = null;
  function startSleepingSound(who) {
    if (!enabled || muted) return;
    stopSleepingSound();
    _sleepLoopHandle = setInterval(() => {
      _playSampleOrSynth('sleep', () => {
        _beepSlide(140, 95, 0.55, 0.07);
      });
    }, 2400);
  }
  function stopSleepingSound() {
    if (_sleepLoopHandle) { clearInterval(_sleepLoopHandle); _sleepLoopHandle = null; }
  }

  // ── Interaction sounds (Feature 9) ─────────────────
  function onInteractionSound(key) {
    if (!enabled || muted) return;
    const map = {
      hug:      () => { _beep(300, 0.25, 'sine', 0.14, 0.02); _beep(380, 0.3, 'sine', 0.10, 0.05); },
      kiss:     () => { _beep(700, 0.10, 'sine', 0.12, 0.005); _noiseBurst(0.05, 0.05, 1200); },
      highFive: () => { _noiseBurst(0.06, 0.18, 2000); },
      danceTogether: () => { _beep(440, 0.12, 'triangle', 0.10); },
      selfie:   () => { _beep(1200, 0.04, 'square', 0.10, 0.001); }
    };
    if (map[key]) map[key]();
  }

  // Auto-hook into HomeInteractions so callers don't need to wire this
  // manually — checked lazily on each trigger via a thin wrapper that
  // interactions.js doesn't need to know about (kept decoupled).
  function _wrapInteractionsIfPresent() {
    if (!window.HomeInteractions || window.HomeInteractions.__audioWrapped) return;
    const originalTrigger = HomeInteractions.trigger;
    HomeInteractions.trigger = function (key, opts) {
      const result = originalTrigger.call(HomeInteractions, key, opts);
      if (result) onInteractionSound(key);
      return result;
    };
    HomeInteractions.__audioWrapped = true;
  }

  // ── Init / controls ─────────────────────────────────
  function init() {
    // Web Audio requires a user gesture to start in most browsers —
    // resume lazily on first interaction rather than failing silently.
    const resume = () => { _ensureCtx(); if (ctx && ctx.state === 'suspended') ctx.resume(); };
    window.addEventListener('pointerdown', resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });
    _wrapInteractionsIfPresent();
    // Retry wrapping shortly after, in case interactions.js loads after this file
    setTimeout(_wrapInteractionsIfPresent, 500);
  }

  function setEnabled(v) { enabled = v; }
  function setMuted(v) { muted = v; }
  function setVolume(v) { if (masterGain) masterGain.gain.value = HomeUtils.clamp(v, 0, 1); }

  function dispose() {
    stopSleepingSound();
    if (ctx) { try { ctx.close(); } catch (_) {} ctx = null; }
  }

  return {
    init, dispose, setEnabled, setMuted, setVolume,
    onFootstep, onPetSound, onInteractionSound,
    startSleepingSound, stopSleepingSound
  };
})();

window.HomeAudioLiving = HomeAudioLiving;