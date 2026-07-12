/*!
 * Premium Sound Library
 * -----------------------------------------------------------------------
 * Declarative catalogue of every sound event in the app, grouped by
 * category. Each entry maps to a tiny synthesis "recipe" consumed by
 * SoundEngine. Recipes are built from a handful of reusable voice
 * "families" (tap, pop, chime, whoosh, glide, noise-swell...) so the
 * whole app shares one coherent sonic language, while every individual
 * event still gets a distinct, purposeful sound.
 * -----------------------------------------------------------------------
 */
(function () {
  'use strict';
  const E = window.SoundEngine;
  if (!E) return;

  // ---- Reusable voice-family helpers --------------------------------
  const tap = (freq, gain = 0.35, dur = 0.05) => ({
    duration: dur,
    layers: [{ type: 'sine', freqStart: freq, gain, attack: 0.002, decay: dur * 0.6, sustain: 0, release: dur * 0.3 }]
  });

  const pop = (freqStart, freqEnd, gain = 0.4, dur = 0.09) => ({
    duration: dur,
    layers: [{ type: 'triangle', freqStart, freqEnd, gain, attack: 0.003, decay: dur * 0.5, sustain: 0, release: dur * 0.4 }]
  });

  const chime = (freqs, gain = 0.3, dur = 0.5, spread = 0.03) => ({
    duration: dur,
    layers: freqs.map((f, i) => ({
      type: 'sine', freqStart: f, gain: gain / Math.sqrt(freqs.length),
      attack: 0.008, decay: dur * 0.4, sustain: 0.15, release: dur * 0.5,
      delay: i * spread
    }))
  });

  const whoosh = (freqStart, freqEnd, gain = 0.25, dur = 0.18) => ({
    duration: dur,
    layers: [
      { type: 'noise', noiseColor: 'pink', gain: gain * 0.5, attack: dur * 0.3, decay: dur * 0.3, sustain: 0.1, release: dur * 0.4 },
      { type: 'sine', freqStart, freqEnd, glideExp: true, gain: gain * 0.6, attack: dur * 0.2, decay: dur * 0.3, sustain: 0.1, release: dur * 0.4 }
    ]
  });

  const click = (freq = 900, gain = 0.25) => ({
    duration: 0.035,
    layers: [{ type: 'square', freqStart: freq, gain, attack: 0.001, decay: 0.02, sustain: 0, release: 0.014 }]
  });

  const swell = (freqStart, freqEnd, gain = 0.3, dur = 0.6) => ({
    duration: dur,
    layers: [{ type: 'sine', freqStart, freqEnd, glideExp: true, gain, attack: dur * 0.3, decay: dur * 0.2, sustain: 0.4, release: dur * 0.4 }]
  });

  const success = (base = 523.25, gain = 0.32) => chime([base, base * 1.25, base * 1.5], gain, 0.4, 0.04);
  const errorTone = (base = 220, gain = 0.3) => ({
    duration: 0.22,
    layers: [
      { type: 'triangle', freqStart: base, gain, attack: 0.004, decay: 0.08, sustain: 0.1, release: 0.1 },
      { type: 'triangle', freqStart: base * 0.94, gain: gain * 0.8, attack: 0.004, decay: 0.08, sustain: 0.1, release: 0.1, delay: 0.06 }
    ]
  });
  const ding = (freq = 1046.5, gain = 0.3) => chime([freq], gain, 0.3);
  const softNoiseTick = (gain = 0.15) => ({
    duration: 0.03,
    layers: [{ type: 'noise', noiseColor: 'white', gain, attack: 0.001, decay: 0.015, sustain: 0, release: 0.01 }]
  });

  // A small pentatonic palette keeps every chime harmonically related.
  const PENT = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0];

  function def(name, category, recipe) { E.define(name, category, () => recipe); }
  function defs(category, map, factory) {
    Object.keys(map).forEach((name) => def(name, category, factory(map[name], name)));
  }

  // ==================================================================
  // MICRO INTERACTIONS (ui)
  // ==================================================================
  const uiMap = {
    'ui.button.tap': () => tap(720, 0.22, 0.045),
    'ui.card.select': () => pop(500, 640, 0.25, 0.07),
    'ui.toggle.on': () => pop(500, 900, 0.28, 0.08),
    'ui.toggle.off': () => pop(700, 420, 0.22, 0.08),
    'ui.checkbox.check': () => pop(600, 1000, 0.26, 0.06),
    'ui.checkbox.uncheck': () => tap(500, 0.18, 0.04),
    'ui.radio.select': () => tap(760, 0.22, 0.045),
    'ui.tab.switch': () => whoosh(500, 900, 0.18, 0.12),
    'ui.nav.bottom': () => tap(680, 0.2, 0.05),
    'ui.sidebar.open': () => whoosh(300, 700, 0.22, 0.16),
    'ui.sidebar.close': () => whoosh(700, 300, 0.2, 0.14),
    'ui.search.open': () => whoosh(400, 800, 0.2, 0.14),
    'ui.search.close': () => whoosh(800, 400, 0.18, 0.12),
    'ui.dialog.open': () => swell(400, 700, 0.22, 0.22),
    'ui.dialog.close': () => swell(700, 350, 0.18, 0.18),
    'ui.popup.open': () => pop(600, 900, 0.22, 0.09),
    'ui.popup.close': () => pop(900, 550, 0.18, 0.08),
    'ui.page.transition': () => whoosh(350, 650, 0.2, 0.2),
    'ui.nav.back': () => whoosh(650, 350, 0.18, 0.14),
  };
  Object.keys(uiMap).forEach((name) => def(name, 'ui', uiMap[name]()));

  // ==================================================================
  // CHAT
  // ==================================================================
  const chatMap = {
    'chat.message.sent': () => pop(560, 780, 0.28, 0.08),
    'chat.message.delivered': () => tap(880, 0.16, 0.03),
    'chat.message.read': () => chime([740, 988], 0.2, 0.25, 0.03),
    'chat.typing.start': () => softNoiseTick(0.1),
    'chat.voice.record.start': () => pop(500, 750, 0.25, 0.09),
    'chat.voice.record.stop': () => pop(750, 480, 0.22, 0.09),
    'chat.voice.sent': () => whoosh(500, 900, 0.24, 0.16),
    'chat.gif.sent': () => pop(620, 860, 0.24, 0.08),
    'chat.image.sent': () => pop(600, 840, 0.24, 0.08),
    'chat.file.sent': () => pop(560, 800, 0.24, 0.09),
    'chat.sticker.sent': () => chime([660, 880], 0.24, 0.2, 0.02),
    'chat.reaction.emoji': () => ding(1318.5, 0.2),
    'chat.message.pinned': () => chime([700, 933], 0.22, 0.22, 0.03),
    'chat.message.deleted': () => errorTone(300, 0.18),
    'chat.message.edited': () => tap(600, 0.16, 0.04),
  };
  Object.keys(chatMap).forEach((name) => def(name, 'chat', chatMap[name]()));

  // ==================================================================
  // CALLS
  // ==================================================================
  def('call.outgoing', 'call', { duration: 1.2, layers: [
    { type: 'sine', freqStart: 480, gain: 0.25, attack: 0.02, decay: 0.3, sustain: 0.5, release: 0.3 },
    { type: 'sine', freqStart: 480, gain: 0.25, attack: 0.02, decay: 0.3, sustain: 0.5, release: 0.3, delay: 0.6 }
  ]});
  def('call.incoming.ringtone', 'call', { duration: 1.6, layers: [
    { type: 'sine', freqStart: 587.33, gain: 0.3, attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.3 },
    { type: 'sine', freqStart: 739.99, gain: 0.3, attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.3, delay: 0.25 },
    { type: 'sine', freqStart: 587.33, gain: 0.3, attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.3, delay: 0.8 },
    { type: 'sine', freqStart: 739.99, gain: 0.3, attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.3, delay: 1.05 }
  ]});
  def('call.connecting', 'call', pop(400, 600, 0.2, 0.1));
  def('call.connected', 'call', success(587.33, 0.3));
  def('call.ended', 'call', pop(600, 300, 0.24, 0.14));
  def('call.failed', 'call', errorTone(196, 0.3));
  def('call.muted', 'call', tap(400, 0.22, 0.05));
  def('call.unmuted', 'call', tap(600, 0.22, 0.05));
  def('call.speaker.on', 'call', pop(500, 700, 0.22, 0.08));
  def('call.speaker.off', 'call', pop(700, 500, 0.2, 0.08));
  def('call.camera.on', 'call', pop(550, 780, 0.22, 0.08));
  def('call.camera.off', 'call', pop(780, 550, 0.2, 0.08));
  def('call.video.connected', 'call', success(659.25, 0.3));
  def('call.network.reconnect', 'call', whoosh(300, 700, 0.2, 0.18));
  def('call.waiting', 'call', tap(700, 0.2, 0.06));

  // ==================================================================
  // AI PAGE
  // ==================================================================
  def('ai.prompt.submitted', 'ai', pop(500, 850, 0.26, 0.1));
  def('ai.thinking.begin', 'ai', { duration: 0.5, layers: [
    { type: 'sine', freqStart: 300, freqEnd: 500, glideExp: true, gain: 0.15, attack: 0.1, decay: 0.2, sustain: 0.2, release: 0.2 }
  ]});
  def('ai.streaming.tick', 'ai', softNoiseTick(0.06));
  def('ai.response.completed', 'ai', success(659.25, 0.28));
  def('ai.response.copied', 'ai', tap(900, 0.2, 0.04));
  def('ai.response.regenerated', 'ai', whoosh(400, 750, 0.2, 0.15));
  def('ai.voice.mode', 'ai', chime([523.25, 659.25, 783.99], 0.24, 0.3, 0.03));
  def('ai.tool.execution', 'ai', pop(450, 700, 0.22, 0.1));

  // ==================================================================
  // ACHIEVEMENTS
  // ==================================================================
  def('achievement.xp.gained', 'achievements', ding(1174.66, 0.26));
  def('achievement.level.up', 'achievements', chime([523.25, 659.25, 783.99, 1046.5], 0.34, 0.6, 0.05));
  def('achievement.unlocked', 'achievements', chime([587.33, 739.99, 880], 0.3, 0.5, 0.04));
  def('achievement.badge.unlocked', 'achievements', chime([659.25, 830.61, 987.77], 0.3, 0.5, 0.04));
  def('achievement.milestone.reached', 'achievements', chime([523.25, 698.46, 880], 0.3, 0.55, 0.05));
  def('achievement.goal.completed', 'achievements', success(783.99, 0.3));
  def('achievement.challenge.completed', 'achievements', success(880, 0.3));
  def('achievement.reward.claimed', 'achievements', chime([600, 800, 1000], 0.3, 0.4, 0.03));
  def('achievement.streak.increased', 'achievements', chime([700, 933, 1244], 0.28, 0.4, 0.03));
  def('achievement.daily.reward', 'achievements', chime([659.25, 880, 1108.73], 0.3, 0.45, 0.04));
  def('achievement.relationship.levelup', 'achievements', chime([554.37, 698.46, 880, 1108.73], 0.32, 0.65, 0.05));

  // ==================================================================
  // LOVE FEATURES
  // ==================================================================
  def('love.memory.opened', 'love', swell(400, 700, 0.24, 0.4));
  def('love.capsule.opened', 'love', chime([523.25, 659.25, 830.61], 0.3, 0.55, 0.05));
  def('love.gift.received', 'love', chime([600, 800, 1000, 1200], 0.32, 0.5, 0.04));
  def('love.hug', 'love', swell(300, 550, 0.26, 0.5));
  def('love.kiss', 'love', pop(700, 1000, 0.28, 0.12));
  def('love.surprise.unlocked', 'love', chime([587.33, 739.99, 932.33], 0.3, 0.5, 0.04));
  def('love.countdown.completed', 'love', success(880, 0.32));
  def('love.anniversary', 'love', chime([523.25, 659.25, 783.99, 1046.5, 1318.5], 0.34, 0.7, 0.05));
  def('love.birthday', 'love', chime([523.25, 659.25, 783.99, 1046.5, 1318.5], 0.34, 0.7, 0.05));
  def('love.dream.completed', 'love', success(698.46, 0.3));
  def('love.mood.updated', 'love', tap(660, 0.2, 0.05));
  def('love.relationship.milestone', 'love', chime([554.37, 698.46, 880], 0.3, 0.55, 0.04));

  // ==================================================================
  // MONEY
  // ==================================================================
  def('money.expense.added', 'money', tap(500, 0.2, 0.05));
  def('money.income.added', 'money', pop(600, 850, 0.24, 0.09));
  def('money.budget.completed', 'money', success(659.25, 0.28));
  def('money.savings.milestone', 'money', chime([600, 800, 1000], 0.28, 0.4, 0.03));
  def('money.goal.completed', 'money', success(783.99, 0.3));

  // ==================================================================
  // STUDY
  // ==================================================================
  def('study.started', 'study', pop(450, 650, 0.2, 0.09));
  def('study.focus.started', 'study', swell(350, 550, 0.2, 0.3));
  def('study.focus.completed', 'study', success(659.25, 0.28));
  def('study.pomodoro.completed', 'study', chime([587.33, 783.99], 0.26, 0.3, 0.03));
  def('study.streak', 'study', chime([700, 933, 1244], 0.26, 0.4, 0.03));

  // ==================================================================
  // GAMES
  // ==================================================================
  def('game.start', 'games', pop(400, 750, 0.28, 0.12));
  def('game.answer.correct', 'games', success(880, 0.3));
  def('game.answer.wrong', 'games', errorTone(220, 0.28));
  def('game.victory', 'games', chime([523.25, 659.25, 783.99, 1046.5, 1318.5], 0.34, 0.8, 0.05));
  def('game.defeat', 'games', { duration: 0.5, layers: [
    { type: 'triangle', freqStart: 440, freqEnd: 220, gain: 0.28, attack: 0.01, decay: 0.3, sustain: 0.1, release: 0.2 }
  ]});
  def('game.reward', 'games', chime([600, 800, 1000], 0.3, 0.4, 0.03));
  def('game.highscore', 'games', chime([659.25, 880, 1108.73, 1318.5], 0.32, 0.6, 0.04));
  def('game.countdown.tick', 'games', click(1000, 0.2));
  def('game.completion', 'games', success(783.99, 0.3));

  // ==================================================================
  // VIRTUAL HOME (subtle interaction stingers; true ambience loops are
  // handled by AmbienceController below rather than one-shot samples)
  // ==================================================================
  def('home.door.open', 'home', whoosh(200, 400, 0.2, 0.2));
  def('home.door.close', 'home', whoosh(400, 180, 0.2, 0.18));
  def('home.window.open', 'home', whoosh(300, 500, 0.16, 0.18));
  def('home.window.close', 'home', whoosh(500, 280, 0.16, 0.16));
  def('home.chair.move', 'home', { duration: 0.15, layers: [{ type: 'noise', noiseColor: 'pink', gain: 0.12, attack: 0.02, decay: 0.08, sustain: 0.05, release: 0.06 }] });
  def('home.sofa.sit', 'home', { duration: 0.2, layers: [{ type: 'noise', noiseColor: 'pink', gain: 0.14, attack: 0.02, decay: 0.1, sustain: 0.05, release: 0.08 }] });
  def('home.bed.sit', 'home', { duration: 0.2, layers: [{ type: 'noise', noiseColor: 'pink', gain: 0.12, attack: 0.02, decay: 0.1, sustain: 0.05, release: 0.08 }] });
  def('home.light.switch', 'home', click(1200, 0.18));
  def('home.computer.on', 'home', pop(400, 700, 0.18, 0.1));

  // ==================================================================
  // NOTIFICATIONS (by domain)
  // ==================================================================
  def('notification.reminder', 'notification', ding(880, 0.28));
  def('notification.message', 'notification', ding(988, 0.28));
  def('notification.call', 'notification', chime([659.25, 830.61], 0.3, 0.3, 0.03));
  def('notification.ai', 'notification', ding(1046.5, 0.26));
  def('notification.goal', 'notification', ding(783.99, 0.28));
  def('notification.study', 'notification', ding(698.46, 0.26));
  def('notification.money', 'notification', ding(659.25, 0.26));
  def('notification.relationship', 'notification', chime([587.33, 880], 0.28, 0.35, 0.03));
  def('notification.emergency', 'notification', { duration: 0.6, layers: [
    { type: 'square', freqStart: 880, gain: 0.3, attack: 0.005, decay: 0.1, sustain: 0.2, release: 0.1 },
    { type: 'square', freqStart: 880, gain: 0.3, attack: 0.005, decay: 0.1, sustain: 0.2, release: 0.1, delay: 0.3 }
  ]});

  // ==================================================================
  // LOADING / SYSTEM STATES
  // ==================================================================
  def('loading.success', 'loading', ding(1046.5, 0.22));
  def('loading.failure', 'loading', errorTone(220, 0.22));
  def('loading.warning', 'loading', tap(500, 0.2, 0.06));
  def('loading.completed', 'loading', success(659.25, 0.22));
  def('loading.retry', 'loading', whoosh(400, 600, 0.16, 0.1));

  // Warm the most common ones lazily on first idle frame (non-blocking).
  const warmList = ['ui.button.tap', 'ui.dialog.open', 'chat.message.sent', 'notification.message'];
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => E.preload(warmList));
  } else {
    setTimeout(() => E.preload(warmList), 1200);
  }
})();
