/* ══════════════════════════════════════════════════════════════
   TWIN SOUNDS — small, soft sound effects for coins, scratch cards,
   Spin & Win, rewarded ads, unlocks and purchases.

   • Made live with the Web Audio API → no audio files to download, works offline.
   • One mute switch for everything:  TwinSound.setEnabled(false)  (remembered on this device).
   • Quiet by design (master volume ~0.35) and never plays while the tab is hidden.
   • Browsers only allow sound after a tap; the first tap anywhere wakes the audio up.

   API  (all safe to call any time; they silently do nothing when muted / unsupported)
     TwinSound.coin()          one coin "ting"
     TwinSound.coins(n)        a handful of coins falling (n = how many, max 10)
     TwinSound.tap()           soft UI tap
     TwinSound.spinStart()     wheel whoosh
     TwinSound.tick(speed)     one wheel-peg click (speed 0..1 = softer/slower … sharper/faster)
     TwinSound.spinEnd()       wheel settles
     TwinSound.scratch(power)  one scratch grain (call from pointermove, it throttles itself)
     TwinSound.win(big)        happy arpeggio (big = longer, for big prizes)
     TwinSound.reveal()        scratch card revealed
     TwinSound.ad()            rewarded-ad coins arrive
     TwinSound.unlock()        a pass / item unlocked
     TwinSound.purchase()      "ka-ching"
     TwinSound.error()         gentle "not now" thud

   CHAT + CALL SOUNDS (v2) — one short, soft cue per action:
     TwinSound.msgSent()       message sent            soft rising "pop"
     TwinSound.msgReceived()   message received        two-note "bloop"
     TwinSound.mediaSent()     photo / video / file    "swish" + pop
     TwinSound.funSent()       sticker / GIF           playful two-note "boing"
     TwinSound.voiceStart()    recording starts        rising blip
     TwinSound.voiceStop()     recording stops/sent    falling blip
     TwinSound.voiceCancel()   recording discarded     falling "bloop"
     TwinSound.react()         reaction added          bright sparkle
     TwinSound.heart()         gift / hug / kiss       warm heart chime
     TwinSound.star()          message starred         two-note ding
     TwinSound.pin()           message pinned          soft "tock"
     TwinSound.deleted()       message deleted         downward whoosh
     TwinSound.callConnected() call connected          3 rising notes
     TwinSound.callEnded()     call ended              3 falling notes
     TwinSound.switchOn() / switchOff()  mute, camera, speaker toggles
     TwinSound.blip()          network reconnecting    tiny double blip

   GAME SOUNDS (v3) — five new cues, used by games.html (the bomb countdown reuses tick):
     TwinSound.flip()          memory card turned      tiny rising "tick"
     TwinSound.match()         pair found / mind match two-note chime
     TwinSound.snap()          puzzle piece locks in   short "tock" + click
     TwinSound.boom()          bomb goes off           low thump + rumble
     TwinSound.dice()          dice roll               quick rattle + soft thud

   TwinSound.play('chat.message.sent')  → same thing by name, used by chat.js and call.js
   (also available as window.playAppSound). Unknown names are ignored.
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.TwinSound) return;

  const KEY = 'tw_sound';
  let ctx = null, master = null, noiseBuf = null, lastScratch = 0, lastTick = 0;

  function enabled() { try { return localStorage.getItem(KEY) !== 'off'; } catch (e) { return true; } }
  function setEnabled(on) {
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('twinsound:change', { detail: { enabled: !!on } })); } catch (e) {}
    if (on) { tap(); }
  }
  function toggle() { setEnabled(!enabled()); return enabled(); }

  function ensure() {
    if (!enabled() || document.hidden) return null;
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain(); master.gain.value = 0.35;
        const comp = ctx.createDynamicsCompressor(); // keeps stacked coins from clipping
        master.connect(comp); comp.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume().catch(function () {});
      return ctx;
    } catch (e) { return null; }
  }

  // wake the audio engine on the first real tap (browser rule), then stop listening
  function arm() {
    const wake = function () {
      ensure();
      ['pointerdown', 'touchend', 'keydown'].forEach(function (ev) { window.removeEventListener(ev, wake, true); });
    };
    ['pointerdown', 'touchend', 'keydown'].forEach(function (ev) { window.addEventListener(ev, wake, true); });
  }
  arm();

  function noise() {
    if (noiseBuf) return noiseBuf;
    const len = ctx.sampleRate; noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  // one shaped tone: type, start/end frequency, attack, total length, peak volume, start delay
  function tone(type, f0, f1, len, vol, delay, attack) {
    const c = ensure(); if (!c) return;
    const t = c.currentTime + (delay || 0), a = attack || 0.008;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + len);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + len + 0.03);
  }

  // a burst of filtered noise (clicks, whooshes, scratches)
  function burst(len, vol, filterType, f0, f1, q, delay) {
    const c = ensure(); if (!c) return;
    const t = c.currentTime + (delay || 0);
    const s = c.createBufferSource(); s.buffer = noise();
    s.loop = true;
    const f = c.createBiquadFilter(); f.type = filterType; f.Q.value = q || 1;
    f.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + len);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.012, len / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t, Math.random() * 0.5); s.stop(t + len + 0.03);
  }

  /* ── coins ── */
  function coin(pitch, delay) {
    const k = pitch || 1, d = delay || 0;
    tone('triangle', 1318 * k, 1318 * k, 0.16, 0.34, d, 0.004);       // E6 "ting"
    tone('triangle', 1976 * k, 1976 * k, 0.34, 0.30, d + 0.075, 0.004); // B6 ring
    tone('sine', 3951 * k, 3951 * k, 0.22, 0.07, d + 0.075, 0.004);     // sparkle on top
  }
  function coins(n) {
    const count = Math.max(1, Math.min(10, n | 0 || 4));
    for (let i = 0; i < count; i++) coin(0.9 + Math.random() * 0.35, i * 0.065 + Math.random() * 0.02);
  }

  /* ── ui ── */
  function tap() { tone('sine', 520, 380, 0.07, 0.18, 0, 0.003); }
  function error() { tone('sine', 220, 150, 0.18, 0.26, 0, 0.005); tone('sine', 196, 130, 0.22, 0.2, 0.09, 0.005); }

  /* ── spin wheel ── */
  function spinStart() { burst(0.55, 0.32, 'bandpass', 400, 2600, 0.9); tone('sine', 180, 420, 0.3, 0.12, 0, 0.02); }
  function tick(speed) {
    const now = performance.now(); if (now - lastTick < 28) return; lastTick = now; // never a machine-gun
    const s = Math.max(0, Math.min(1, speed == null ? 0.5 : speed));
    tone('square', 1500 + s * 700, 900 + s * 300, 0.032, 0.09 + s * 0.05, 0, 0.001);
    burst(0.02, 0.1, 'highpass', 3000, 3000, 0.7);
  }
  function spinEnd() { tone('sine', 330, 330, 0.25, 0.16, 0, 0.01); tone('sine', 247, 247, 0.4, 0.14, 0.04, 0.01); }

  /* ── scratch card ── */
  function scratch(power) {
    const now = performance.now(); if (now - lastScratch < 55) return; lastScratch = now;
    const p = Math.max(0.2, Math.min(1, power == null ? 0.6 : power));
    burst(0.07 + p * 0.04, 0.16 + p * 0.16, 'bandpass', 2200 + Math.random() * 1800, 1500 + Math.random() * 900, 1.6);
  }
  function reveal() {
    burst(0.28, 0.2, 'bandpass', 1500, 6000, 1.2);
    [784, 988, 1175, 1568].forEach(function (f, i) { tone('triangle', f, f, 0.5, 0.2, 0.05 + i * 0.07, 0.006); });
    coins(5);
  }

  /* ── celebrate ── */
  function win(big) {
    const notes = big ? [523, 659, 784, 1047, 1319, 1568] : [523, 659, 784, 1047];
    notes.forEach(function (f, i) {
      tone('triangle', f, f, 0.45, 0.24, i * 0.085, 0.006);
      tone('sine', f * 2, f * 2, 0.35, 0.06, i * 0.085, 0.006);
    });
    coins(big ? 8 : 5);
  }
  function ad() { // rewarded-ad payout: rising chime, then coins
    [659, 880, 1109].forEach(function (f, i) { tone('triangle', f, f, 0.32, 0.22, i * 0.1, 0.006); });
    coins(6);
  }
  function unlock() { // pass unlocked: soft "click", then a bright major chord
    burst(0.05, 0.22, 'bandpass', 1800, 900, 2);
    [523, 659, 784].forEach(function (f) { tone('triangle', f, f, 0.7, 0.2, 0.08, 0.01); });
    tone('sine', 1568, 1568, 0.6, 0.08, 0.16, 0.01);
  }
  function purchase() { // ka-ching
    burst(0.06, 0.25, 'highpass', 2500, 2500, 0.8);
    tone('triangle', 1568, 1568, 0.45, 0.28, 0.06, 0.003);
    tone('triangle', 2093, 2093, 0.6, 0.26, 0.15, 0.003);
    tone('sine', 4186, 4186, 0.4, 0.06, 0.15, 0.003);
  }

  /* ── games (v3): five tiny cues, same soft style. Bomb countdown reuses tick(). ── */
  function flip() { tone('triangle', 620, 900, 0.05, 0.15, 0, 0.003); } // memory card turned over
  function match() { tone('triangle', 988, 988, 0.12, 0.18, 0, 0.004); tone('triangle', 1319, 1319, 0.2, 0.18, 0.09, 0.004); } // pair found / mind match
  function snap() { tone('sine', 880, 560, 0.05, 0.2, 0, 0.002); burst(0.03, 0.08, 'highpass', 3000, 3000, 0.7); } // puzzle piece locks in
  function boom() { tone('sine', 150, 45, 0.45, 0.3, 0, 0.004); burst(0.3, 0.2, 'bandpass', 900, 150, 0.8); } // bomb goes off
  function dice() { // quick rattle, then a soft thud
    [0, 0.06, 0.12, 0.19].forEach(function (d, i) { tone('square', 1400 + i * 160, 1400 + i * 160, 0.03, 0.07, d, 0.001); });
    tone('sine', 220, 150, 0.09, 0.18, 0.26, 0.004);
  }

  /* ── chat ── */
  function msgSent() { tone('sine', 520, 760, 0.09, 0.2, 0, 0.004); }
  function msgReceived() { tone('sine', 880, 880, 0.12, 0.18, 0, 0.004); tone('sine', 1175, 1175, 0.2, 0.16, 0.09, 0.004); }
  function mediaSent() { burst(0.12, 0.13, 'bandpass', 900, 3200, 0.9); tone('sine', 520, 760, 0.09, 0.18, 0.07, 0.004); }
  function funSent() { tone('sine', 600, 900, 0.09, 0.2, 0, 0.004); tone('sine', 900, 1300, 0.11, 0.18, 0.08, 0.004); }
  function voiceStart() { tone('sine', 440, 660, 0.1, 0.2, 0, 0.004); }
  function voiceStop() { tone('sine', 660, 440, 0.1, 0.2, 0, 0.004); }
  function voiceCancel() { tone('sine', 400, 180, 0.16, 0.2, 0, 0.004); }
  function react() { tone('triangle', 1568, 2093, 0.12, 0.18, 0, 0.004); tone('sine', 3136, 3136, 0.12, 0.05, 0.03, 0.004); }
  function heart() { // gifts, hugs, kisses: warm, rounded, a little "lub-dub"
    [523, 659, 784].forEach(function (f, i) { tone('sine', f, f, 0.5, 0.2, i * 0.11, 0.01); });
    tone('sine', 1047, 1047, 0.55, 0.07, 0.24, 0.01);
  }
  function star() { tone('triangle', 1175, 1175, 0.14, 0.2, 0, 0.004); tone('triangle', 1568, 1568, 0.24, 0.2, 0.07, 0.004); }
  function pin() { tone('sine', 700, 500, 0.06, 0.22, 0, 0.002); tone('sine', 500, 350, 0.09, 0.18, 0.05, 0.002); }
  function deleted() { burst(0.14, 0.14, 'bandpass', 2400, 500, 0.9); }

  /* ── calls ── */
  function callConnected() { [659, 880, 1109].forEach(function (f, i) { tone('sine', f, f, 0.16, 0.18, i * 0.09, 0.006); }); }
  function callEnded() { [880, 659, 440].forEach(function (f, i) { tone('sine', f, f, 0.18, 0.18, i * 0.1, 0.006); }); }
  function switchOn() { tone('sine', 600, 850, 0.07, 0.18, 0, 0.004); }
  function switchOff() { tone('sine', 850, 600, 0.07, 0.18, 0, 0.004); }
  function blip() { tone('sine', 700, 700, 0.06, 0.14, 0, 0.004); tone('sine', 700, 700, 0.06, 0.14, 0.12, 0.004); }

  // one name → one sound. chat.js / call.js call this by name; unknown names do nothing.
  const SOUNDS = {
    'chat.message.sent': msgSent, 'chat.message.received': msgReceived,
    'chat.image.sent': mediaSent, 'chat.file.sent': mediaSent,
    'chat.gif.sent': funSent, 'chat.sticker.sent': funSent,
    'chat.voice.sent': msgSent, 'chat.voice.start': voiceStart, 'chat.voice.stop': voiceStop, 'chat.voice.cancel': voiceCancel,
    'chat.reaction': react, 'chat.heart': heart, 'chat.gift.sent': heart, 'chat.gift.received': heart,
    'chat.star': star, 'chat.pin': pin, 'chat.delete': deleted, 'chat.failed': error,
    'call.outgoing': tap, 'call.connected': callConnected, 'call.video.connected': callConnected,
    'call.ended': callEnded, 'call.failed': error, 'call.network.reconnect': blip,
    'call.muted': switchOff, 'call.unmuted': switchOn, 'call.camera.off': switchOff, 'call.camera.on': switchOn,
    'call.speaker.off': switchOff, 'call.speaker.on': switchOn,
    'game.flip': flip, 'game.match': match, 'game.snap': snap, 'game.boom': boom, 'game.dice': dice, 'game.tick': tick
  };
  const lastPlayed = {};
  function play(name) { // the same cue never fires twice within 120ms (bulk delete, double events)
    const f = SOUNDS[name]; if (!f) return;
    const now = performance.now(); if (lastPlayed[name] && now - lastPlayed[name] < 120) return; lastPlayed[name] = now;
    try { f(); } catch (e) {}
  }
  // call.js / chat.js already use window.playAppSound — until now nothing defined it, so they were silent
  if (!window.playAppSound) window.playAppSound = play;

  window.TwinSound = { enabled: enabled, setEnabled: setEnabled, toggle: toggle,
    coin: coin, coins: coins, tap: tap, error: error, spinStart: spinStart, tick: tick, spinEnd: spinEnd,
    scratch: scratch, reveal: reveal, win: win, ad: ad, unlock: unlock, purchase: purchase,
    msgSent: msgSent, msgReceived: msgReceived, mediaSent: mediaSent, funSent: funSent,
    voiceStart: voiceStart, voiceStop: voiceStop, voiceCancel: voiceCancel, react: react, heart: heart,
    star: star, pin: pin, deleted: deleted, callConnected: callConnected, callEnded: callEnded,
    switchOn: switchOn, switchOff: switchOff, blip: blip,
    flip: flip, match: match, snap: snap, boom: boom, dice: dice, play: play };
})();
