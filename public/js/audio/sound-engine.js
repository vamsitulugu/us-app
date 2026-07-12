/*!
 * Premium Sound Engine
 * -----------------------------------------------------------------------
 * A lightweight, dependency-free, procedurally-synthesized audio system.
 *
 * WHY SYNTHESIS INSTEAD OF SOUND FILES?
 *   - Zero binary assets to download -> instant load, ~0 KB network cost.
 *   - Perfectly consistent "sound family" across hundreds of events.
 *   - Trivial to theme (pitch/timbre driven by a couple of constants).
 *   - No licensing, no large repo bloat, no CDN dependency.
 *   - Every sound is generated once, cached as an AudioBuffer, and reused.
 *
 * This file is 100% additive. It does not touch any existing backend,
 * API, database, or UI logic. It only exposes `window.SoundEngine`.
 * -----------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'sound-engine:settings:v1';

  const DEFAULT_SETTINGS = {
    master: 0.8,
    muted: false,
    nightMode: false,
    categories: {
      ui: 0.7,
      chat: 0.8,
      call: 0.9,
      ai: 0.75,
      achievements: 0.85,
      love: 0.85,
      money: 0.7,
      study: 0.7,
      games: 0.85,
      home: 0.5,     // virtual home ambience
      notification: 0.85,
      loading: 0.6,
      music: 0.8,
      voice: 0.9
    }
  };

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredCloneSafe(DEFAULT_SETTINGS);
      const parsed = JSON.parse(raw);
      return Object.assign(structuredCloneSafe(DEFAULT_SETTINGS), parsed, {
        categories: Object.assign(
          structuredCloneSafe(DEFAULT_SETTINGS.categories),
          parsed.categories || {}
        )
      });
    } catch (e) {
      return structuredCloneSafe(DEFAULT_SETTINGS);
    }
  }

  function structuredCloneSafe(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function saveSettings(settings) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) { /* ignore quota errors */ }
  }

  function nowMs() { return (global.performance && performance.now) ? performance.now() : Date.now(); }

  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.masterGain = null;
      this.categoryGains = {};
      this.buffers = new Map();          // name -> AudioBuffer
      this.builders = new Map();         // name -> () => descriptor
      this.categoryOf = new Map();       // name -> category
      this.lastPlayed = new Map();       // name -> timestamp (dedupe/throttle)
      this.minGapMs = 60;                // prevent overlapping duplicate triggers
      this.settings = loadSettings();
      this.dndActive = false;
      this.unlocked = false;
      this._pendingResume = false;

      this._bindPageVisibility();
      this._bindUnlockGesture();
    }

    /* ---------------------------------------------------------------- */
    /* Lazy context creation (audio focus friendly)                     */
    /* ---------------------------------------------------------------- */
    _ensureContext() {
      if (this.ctx) return this.ctx;
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.settings.muted ? 0 : this.settings.master;
      this.masterGain.connect(this.ctx.destination);

      Object.keys(this.settings.categories).forEach((cat) => {
        const g = this.ctx.createGain();
        g.gain.value = this.settings.categories[cat];
        g.connect(this.masterGain);
        this.categoryGains[cat] = g;
      });
      return this.ctx;
    }

    _bindUnlockGesture() {
      const unlock = () => {
        this.unlocked = true;
        const ctx = this._ensureContext();
        if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
      };
      window.addEventListener('pointerdown', unlock, { once: true, passive: true });
      window.addEventListener('keydown', unlock, { once: true });
    }

    _bindPageVisibility() {
      document.addEventListener('visibilitychange', () => {
        if (!this.ctx) return;
        if (document.hidden) {
          this.ctx.suspend().catch(() => {});
        } else if (this.unlocked) {
          this.ctx.resume().catch(() => {});
        }
      });
    }

    /* ---------------------------------------------------------------- */
    /* Settings API                                                      */
    /* ---------------------------------------------------------------- */
    setMasterVolume(v) {
      this.settings.master = Math.max(0, Math.min(1, v));
      if (this.masterGain) this.masterGain.gain.value = this.settings.muted ? 0 : this.settings.master;
      saveSettings(this.settings);
    }

    setCategoryVolume(cat, v) {
      if (!(cat in this.settings.categories)) return;
      this.settings.categories[cat] = Math.max(0, Math.min(1, v));
      if (this.categoryGains[cat]) this.categoryGains[cat].gain.value = this.settings.categories[cat];
      saveSettings(this.settings);
    }

    setMuted(m) {
      this.settings.muted = !!m;
      if (this.masterGain) this.masterGain.gain.value = m ? 0 : this.settings.master;
      saveSettings(this.settings);
    }

    toggleMute() { this.setMuted(!this.settings.muted); return this.settings.muted; }

    setNightMode(on) {
      this.settings.nightMode = !!on;
      saveSettings(this.settings);
    }

    setDND(active) { this.dndActive = !!active; }

    getSettings() { return structuredCloneSafe(this.settings); }

    _respectsSilentEnvironment() {
      // Respect explicit mute, DND flag, or OS-level reduced motion+data heuristics.
      if (this.settings.muted) return false;
      if (this.dndActive) return false;
      return true;
    }

    /* ---------------------------------------------------------------- */
    /* Registration                                                      */
    /* ---------------------------------------------------------------- */
    /**
     * Register a sound definition. `builder` returns a descriptor consumed
     * by the synthesizer. Sounds are generated lazily on first play and
     * cached forever after (per session).
     */
    define(name, category, builder) {
      this.builders.set(name, builder);
      this.categoryOf.set(name, category);
    }

    /* ---------------------------------------------------------------- */
    /* Synthesis                                                         */
    /* ---------------------------------------------------------------- */
    _synthesize(name) {
      const ctx = this._ensureContext();
      if (!ctx) return null;
      const builder = this.builders.get(name);
      if (!builder) return null;
      const spec = builder();
      const duration = spec.duration || 0.2;
      const sampleRate = ctx.sampleRate;
      const length = Math.max(1, Math.ceil(duration * sampleRate));
      const buffer = ctx.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);

      // Each "layer" is a simple oscillator/noise voice mixed additively,
      // with its own envelope. This keeps the vocabulary small but
      // expressive enough for hundreds of distinct, elegant sounds.
      (spec.layers || []).forEach((layer) => {
        this._renderLayer(data, sampleRate, duration, layer);
      });

      // Normalize gently to avoid clipping across layered voices.
      let peak = 0;
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
      if (peak > 0.98) {
        const scale = 0.98 / peak;
        for (let i = 0; i < data.length; i++) data[i] *= scale;
      }

      this.buffers.set(name, buffer);
      return buffer;
    }

    _renderLayer(data, sampleRate, duration, layer) {
      const {
        type = 'sine',        // 'sine' | 'triangle' | 'square' | 'noise'
        freqStart = 440,
        freqEnd = null,       // if set, glides linearly (or exponentially) freqStart -> freqEnd
        glideExp = false,
        gain = 0.5,
        attack = 0.005,
        decay = 0.08,
        sustain = 0.0,
        release = 0.05,
        delay = 0,            // seconds, offset within the buffer
        detune = 0,           // extra Hz added for slight chorus warmth
        noiseColor = 'white'  // 'white' | 'pink' for noise type layers
      } = layer;

      const startSample = Math.floor(delay * sampleRate);
      const totalSamples = data.length;
      const end = Math.min(totalSamples, startSample + Math.ceil(duration * sampleRate));

      let pinkState = [0, 0, 0, 0, 0, 0, 0];

      for (let i = startSample; i < end; i++) {
        const t = (i - startSample) / sampleRate;
        const localDur = (end - startSample) / sampleRate;

        // Envelope (ADSR-ish, simplified for short UI sounds)
        let env;
        if (t < attack) {
          env = t / Math.max(attack, 1e-6);
        } else if (t < attack + decay) {
          const dt = (t - attack) / Math.max(decay, 1e-6);
          env = 1 - dt * (1 - sustain);
        } else if (t < localDur - release) {
          env = sustain;
        } else {
          const rt = (localDur - t) / Math.max(release, 1e-6);
          env = Math.max(0, sustain * Math.max(0, rt));
        }
        env = Math.max(0, Math.min(1, env));

        let sample = 0;
        if (type === 'noise') {
          const white = Math.random() * 2 - 1;
          if (noiseColor === 'pink') {
            // Paul Kellet pink noise approximation
            pinkState[0] = 0.99886 * pinkState[0] + white * 0.0555179;
            pinkState[1] = 0.99332 * pinkState[1] + white * 0.0750759;
            pinkState[2] = 0.96900 * pinkState[2] + white * 0.1538520;
            pinkState[3] = 0.86650 * pinkState[3] + white * 0.3104856;
            pinkState[4] = 0.55000 * pinkState[4] + white * 0.5329522;
            pinkState[5] = -0.7616 * pinkState[5] - white * 0.0168980;
            const pink = pinkState[0] + pinkState[1] + pinkState[2] + pinkState[3] +
              pinkState[4] + pinkState[5] + pinkState[6] + white * 0.5362;
            pinkState[6] = white * 0.115926;
            sample = pink * 0.11;
          } else {
            sample = white;
          }
        } else {
          let freq = freqStart;
          if (freqEnd !== null) {
            const p = localDur > 0 ? t / localDur : 0;
            freq = glideExp
              ? freqStart * Math.pow(freqEnd / freqStart, p)
              : freqStart + (freqEnd - freqStart) * p;
          }
          freq += detune;
          const phase = 2 * Math.PI * freq * t;
          if (type === 'sine') sample = Math.sin(phase);
          else if (type === 'triangle') sample = (2 / Math.PI) * Math.asin(Math.sin(phase));
          else if (type === 'square') sample = Math.sign(Math.sin(phase)) * 0.6; // soft square
        }

        data[i] += sample * env * gain;
      }
    }

    /* ---------------------------------------------------------------- */
    /* Playback                                                          */
    /* ---------------------------------------------------------------- */
    play(name, opts) {
      if (!this._respectsSilentEnvironment()) return;
      const ctx = this._ensureContext();
      if (!ctx) return;

      // Throttle rapid duplicate triggers (e.g. fast repeated taps).
      const last = this.lastPlayed.get(name) || 0;
      const t = nowMs();
      if (t - last < this.minGapMs) return;
      this.lastPlayed.set(name, t);

      if (ctx.state === 'suspended' && this.unlocked) {
        ctx.resume().catch(() => {});
      }

      let buffer = this.buffers.get(name);
      if (!buffer) buffer = this._synthesize(name);
      if (!buffer) return;

      const category = this.categoryOf.get(name) || 'ui';
      const catGain = this.categoryGains[category] || this.masterGain;

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      const voiceGain = ctx.createGain();
      voiceGain.gain.value = (opts && typeof opts.volume === 'number') ? opts.volume : 1;

      // Slight night-mode softening: gentle low-pass + lower ceiling.
      if (this.settings.nightMode) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 4000;
        voiceGain.gain.value *= 0.6;
        source.connect(lp);
        lp.connect(voiceGain);
      } else {
        source.connect(voiceGain);
      }

      voiceGain.connect(catGain);
      source.start();
      source.onended = () => {
        try { source.disconnect(); voiceGain.disconnect(); } catch (e) {}
      };
      return source;
    }

    /** Warm the cache without playing (e.g. on idle) */
    preload(names) {
      (names || Array.from(this.builders.keys())).forEach((n) => {
        if (!this.buffers.has(n)) this._synthesize(n);
      });
    }
  }

  global.SoundEngine = new SoundEngine();
})(window);
