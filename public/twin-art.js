/* ═══════════════════════════════════════════════════════════════════
   public/twin-art.js — Twin AI page artwork + small UI helpers
   ───────────────────────────────────────────────────────────────────
   Pure presentation. Nothing here touches the AI backend, chat state,
   the orb, or Both-mode logic.

   Public API (window.TwinArt):
     robotSolo()      → <svg> of the single Twin robot holding a heart
     robotPair()      → <svg> of the two robots (boy + girl) for BOTH mode
     avatar()         → small round robot-face avatar for chat bubbles
     icon(name)       → inline stroke icon (menu, search, sync, plus, mic,
                        send, play, chevron, pencil, brain, heart, checks)
     refresh()        → updates "Hey <name>," greeting on the hero card
     toggleQuick()    → opens/closes the "+" quick-prompt sheet
     closeQuick()
   Global helper:
     twinSyncTap(btn) → runs the existing syncNow() with a spinning icon

   Want your own illustration instead of the built-in SVG robots?
   Drop PNG/WebP files in /public/images/twin/ and change robotSolo() /
   robotPair() to return '<img src="/images/twin/robot.png" alt="">'.
═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var uid = 0;

  /* ── shared gradient defs, one set per robot so ids never collide ── */
  /* Gradient stop whose colour can be re-themed from CSS (custom props set on
     #page-ai). Defaults = original dark-theme palette, so dark mode is unchanged. */
  function st(off, v, fb) {
    return '<stop offset="' + off + '" stop-color="' + fb + '" style="stop-color:var(' + v + ',' + fb + ')"/>';
  }

  function defs(p) {
    return '<defs>' +
      '<radialGradient id="' + p + 'h" cx="34%" cy="22%" r="90%">' +
        st(0, '--tw-art-h0', '#ffffff') + st('.42', '--tw-art-h1', '#f6d9de') + st(1, '--tw-art-h2', '#b4697a') + '</radialGradient>' +
      '<radialGradient id="' + p + 'b" cx="34%" cy="18%" r="95%">' +
        st(0, '--tw-art-b0', '#fff2f4') + st('.5', '--tw-art-b1', '#e0c5d5') + st(1, '--tw-art-b2', '#9b4d5e') + '</radialGradient>' +
      '<linearGradient id="' + p + 'v" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#24101b"/><stop offset="1" stop-color="#040102"/></linearGradient>' +
      '<radialGradient id="' + p + 'r" cx="35%" cy="28%" r="85%">' +
        '<stop offset="0" stop-color="#C21A8B"/><stop offset=".5" stop-color="#b0127a"/><stop offset="1" stop-color="#940857"/></radialGradient>' +
      '<linearGradient id="' + p + 'w" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="#C21A8B"/><stop offset="1" stop-color="#C21A8B"/></linearGradient>' +
      '<filter id="' + p + 'g" x="-60%" y="-60%" width="220%" height="220%">' +
        '<feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
    '</defs>';
  }

  var HEART = 'M0 24C-38 -2 -28 -34 -11 -31C-4 -30 0 -22 0 -18C0 -22 4 -30 11 -31C28 -34 38 -2 0 24Z';

  function bowShape(p) {
    return '<g transform="rotate(14 150 38)">' +
      '<path d="M150 40 L188 14 Q196 34 188 58 Z" fill="url(#' + p + 'w)"/>' +
      '<path d="M150 40 L112 14 Q104 34 112 58 Z" fill="url(#' + p + 'w)"/>' +
      '<circle cx="150" cy="40" r="10" fill="#C21A8B"/>' +
      '<circle cx="147" cy="37" r="3.5" fill="#fdd5ec" opacity=".8"/></g>';
  }

  /* one robot, drawn in a 220×250 box */
  function robotGroup(p, o) {
    var eye = o.eye;
    var eyePaths = '<path d="M78 93 Q88 76 98 93"/><path d="M122 93 Q132 76 142 93"/>';
    return '<g>' +
      '<ellipse cx="110" cy="238" rx="64" ry="9" fill="#000" opacity=".5"/>' +
      '<ellipse cx="82" cy="228" rx="21" ry="11" fill="url(#' + p + 'b)"/>' +
      '<ellipse cx="138" cy="228" rx="21" ry="11" fill="url(#' + p + 'b)"/>' +
      '<path d="M60 180C60 148 82 134 110 134C138 134 160 148 160 180C160 208 138 230 110 230C82 230 60 208 60 180Z" fill="url(#' + p + 'b)"/>' +
      '<ellipse cx="110" cy="84" rx="71" ry="60" fill="url(#' + p + 'h)"/>' +
      '<ellipse cx="38" cy="90" rx="11" ry="19" fill="url(#' + p + 'r)"/>' +
      '<ellipse cx="182" cy="90" rx="11" ry="19" fill="url(#' + p + 'r)"/>' +
      '<rect x="52" y="50" width="116" height="68" rx="32" fill="url(#' + p + 'v)"/>' +
      '<rect x="52" y="50" width="116" height="68" rx="32" fill="none" stroke="rgba(255,255,255,.14)"/>' +
      '<path d="M66 67Q86 55 112 57" stroke="rgba(255,255,255,.22)" stroke-width="3" fill="none" stroke-linecap="round"/>' +
      '<g stroke="' + eye + '" stroke-width="7" stroke-linecap="round" fill="none" opacity=".9" filter="url(#' + p + 'g)">' + eyePaths + '</g>' +
      '<g stroke="' + eye + '" stroke-width="4.5" stroke-linecap="round" fill="none">' + eyePaths + '</g>' +
      '<path d="M101 103Q110 111 119 103" stroke="' + eye + '" stroke-width="3.5" fill="none" stroke-linecap="round"/>' +
      (o.bow ? bowShape(p) : '') +
    '</g>';
  }

  function heartShape(p, x, y, s) {
    return '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')">' +
      '<path d="' + HEART + '" fill="#b0127a" opacity=".55" filter="url(#' + p + 'g)"/>' +
      '<path d="' + HEART + '" fill="url(#' + p + 'r)"/>' +
      '<path d="M-17 -18C-23 -14 -24 -6 -21 -1" stroke="rgba(255,255,255,.55)" stroke-width="3.2" fill="none" stroke-linecap="round"/>' +
    '</g>';
  }

  function arms(p, cx, cy) {
    return '<ellipse cx="' + (cx - 38) + '" cy="' + cy + '" rx="17" ry="25" transform="rotate(-20 ' + (cx - 38) + ' ' + cy + ')" fill="url(#' + p + 'b)"/>' +
           '<ellipse cx="' + (cx + 38) + '" cy="' + cy + '" rx="17" ry="25" transform="rotate(20 ' + (cx + 38) + ' ' + cy + ')" fill="url(#' + p + 'b)"/>';
  }

  function floaters(list) {
    return list.map(function (f) {
      return '<path class="tw-floaty" style="animation-delay:' + f[3] + 's" transform="translate(' + f[0] + ' ' + f[1] + ') scale(' + f[2] + ')" d="' + HEART + '" fill="#B0127A" opacity=".85"/>';
    }).join('');
  }

  function robotSolo() {
    var p = 'ts' + (++uid);
    return '<svg viewBox="0 0 220 250" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Twin AI robot holding a heart">' +
      defs(p) +
      floaters([[206, 70, .2, 0], [20, 120, .16, 1.2], [196, 168, .13, .6]]) +
      robotGroup(p, { eye: '#C21A8B' }) +
      heartShape(p, 110, 176, 1.25) +
      arms(p, 110, 176) +
    '</svg>';
  }

  function robotPair() {
    var a = 'tpa' + (++uid), b = 'tpb' + uid, h = 'tph' + uid;
    return '<svg viewBox="0 0 400 262" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Two Twin AI robots sharing a heart">' +
      defs(a) + defs(b) + defs(h) +
      floaters([[30, 60, .22, 0], [372, 150, .2, 1], [356, 40, .14, .5], [48, 170, .14, 1.6]]) +
      '<g transform="translate(6 12) scale(.93)">' + robotGroup(a, { eye: '#C21A8B' }) + '</g>' +
      '<g transform="translate(176 6) scale(.93)">' + robotGroup(b, { eye: '#C21A8B', bow: true }) + '</g>' +
      heartShape(h, 200, 198, 1.7) +
      '<ellipse cx="148" cy="204" rx="17" ry="25" transform="rotate(-24 148 204)" fill="url(#' + a + 'b)"/>' +
      '<ellipse cx="252" cy="204" rx="17" ry="25" transform="rotate(24 252 204)" fill="url(#' + b + 'b)"/>' +
    '</svg>';
  }

  /* small round avatar used next to Twin's chat bubbles */
  function avatar() {
    var p = 'tv' + (++uid);
    return '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<defs><radialGradient id="' + p + 'h" cx="34%" cy="22%" r="90%"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#f6d9de"/><stop offset="1" stop-color="#b4697a"/></radialGradient>' +
      '<radialGradient id="' + p + 'r" cx="35%" cy="28%" r="85%"><stop offset="0" stop-color="#C21A8B"/><stop offset=".6" stop-color="#b0127a"/><stop offset="1" stop-color="#940857"/></radialGradient></defs>' +
      '<circle cx="24" cy="24" r="22.5" fill="#2a0419"/>' +
      '<ellipse cx="24" cy="24.5" rx="15" ry="13" fill="url(#' + p + 'h)"/>' +
      '<ellipse cx="8.8" cy="25" rx="2.6" ry="4.4" fill="url(#' + p + 'r)"/><ellipse cx="39.2" cy="25" rx="2.6" ry="4.4" fill="url(#' + p + 'r)"/>' +
      '<rect x="12.5" y="16.5" width="23" height="15" rx="7" fill="#0b0308"/>' +
      '<g stroke="#C21A8B" stroke-width="2" stroke-linecap="round" fill="none"><path d="M17.5 25 Q20 20.5 22.5 25"/><path d="M25.5 25 Q28 20.5 30.5 25"/></g>' +
      '<path d="M21.5 28.4Q24 30.6 26.5 28.4" stroke="#C21A8B" stroke-width="1.4" fill="none" stroke-linecap="round"/>' +
    '</svg>';
  }

  /* ── icons (24×24, stroke = currentColor) ── */
  var ICONS = {
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    search: '<circle cx="11" cy="11" r="7.5"/><path d="m21 21-4.3-4.3"/>',
    sync: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    plus: '<path d="M5 12h14M12 5v14"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
    send: '<path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7Z"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
    brain: '<path d="M12 4.6C11.3 3.6 10.2 3 9 3a3.6 3.6 0 0 0-3.5 3.1A3.7 3.7 0 0 0 3 9.6c0 1 .4 1.9 1 2.5-.5.8-.7 1.7-.4 2.7A3.6 3.6 0 0 0 7 17.3 3.5 3.5 0 0 0 9.7 21c1 0 1.8-.5 2.3-1.2"/><path d="M12 4.6C12.7 3.6 13.8 3 15 3a3.6 3.6 0 0 1 3.5 3.1A3.7 3.7 0 0 1 21 9.6c0 1-.4 1.9-1 2.5.5.8.7 1.7.4 2.7a3.6 3.6 0 0 1-3.4 2.5A3.5 3.5 0 0 1 14.3 21c-1 0-1.8-.5-2.3-1.2"/><path d="M12 4.6v15.2"/><path d="M8.2 9.4c.9.1 1.8.7 2 1.7M15.8 9.4c-.9.1-1.8.7-2 1.7M8.4 14.2c.8-.1 1.7.3 2.1 1.1M15.6 14.2c-.8-.1-1.7.3-2.1 1.1"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8Z"/>'
  };

  function icon(name, size) {
    var s = size || 22;
    if (name === 'play') {
      return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.4-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z"/></svg>';
    }
    if (name === 'checks') {
      return '<svg width="' + (s * 1.5) + '" height="' + s + '" viewBox="0 0 24 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 9l4 4L14 3"/><path d="M10 11l2 2L21 3"/></svg>';
    }
    var fill = (name === 'brain' || name === 'heart') ? 'currentColor' : 'none';
    var fo = name === 'brain' ? ' fill-opacity=".18"' : '';
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="' + fill + '"' + fo + ' stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }

  /* ── quick prompts (the "+" sheet). Same prompts the welcome chips use. ── */
  var PROMPTS = [
    ['💑', 'Plan a date', 'Give us 5 creative and romantic date night ideas for tonight'],
    ['💬', 'We argued', 'We had a fight. Give us a step-by-step guide to talk it through with love'],
    ['💌', 'Write something sweet', 'Write a heartfelt, poetic love letter from me to my partner'],
    ['💭', 'Deep talk', 'Give us 5 deep conversation questions to learn more about each other'],
    ['🎁', 'Surprise idea', 'Plan a romantic surprise — give me 3 detailed and thoughtful options']
  ];

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function renderPrompts() {
    var row = document.getElementById('twinSuggRow');
    if (row && !row.children.length) {
      row.innerHTML = PROMPTS.map(function (p, i) {
        return '<button type="button" class="twin-sugg-chip" data-p="' + i + '"><span class="tw-chip-ico">' + p[0] + '</span>' + esc(p[1]) + '</button>';
      }).join('');
    }
    var sheet = document.getElementById('twQuick');
    if (sheet && !sheet.children.length) {
      sheet.innerHTML = '<div class="tw-quick-head">Quick prompts</div>' + PROMPTS.map(function (p, i) {
        return '<button type="button" class="tw-quick-item" data-p="' + i + '"><span class="tw-chip-ico">' + p[0] + '</span><span>' + esc(p[1]) + '</span></button>';
      }).join('');
    }
  }

  function onPromptClick(e) {
    var t = e.target.closest && e.target.closest('[data-p]');
    if (!t) return;
    var p = PROMPTS[+t.getAttribute('data-p')];
    if (!p) return;
    closeQuick();
    if (typeof window.askAI === 'function') window.askAI(p[2]);
  }

  function toggleQuick() {
    var sheet = document.getElementById('twQuick'), btn = document.getElementById('twPlusBtn');
    if (!sheet) return;
    var open = !sheet.classList.contains('open');
    sheet.classList.toggle('open', open);
    if (btn) { btn.classList.toggle('is-open', open); btn.setAttribute('aria-expanded', open ? 'true' : 'false'); }
  }
  function closeQuick() {
    var sheet = document.getElementById('twQuick'), btn = document.getElementById('twPlusBtn');
    if (sheet) sheet.classList.remove('open');
    if (btn) { btn.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false'); }
  }

  /* ── greeting ── */
  function refresh() {
    var nm = '';
    try { nm = (typeof S !== 'undefined' && S && S.myName) ? String(S.myName).trim().split(/\s+/)[0] : ''; } catch (e) {}
    var hi = document.getElementById('twHeroHi');
    if (hi) hi.textContent = nm ? 'Hey ' + nm + ',' : 'Hey there,';
  }

  /* ── mount ── */
  function mount() {
    var solo = document.getElementById('twHeroArt');
    if (solo && !solo.firstChild) solo.innerHTML = robotSolo();
    renderPrompts();
    refresh();
  }

  document.addEventListener('click', function (e) {
    var sheet = document.getElementById('twQuick');
    if (sheet && sheet.classList.contains('open')) {
      if (!e.target.closest('#twQuick') && !e.target.closest('#twPlusBtn')) closeQuick();
    }
    if (e.target.closest && (e.target.closest('#twinSuggRow') || e.target.closest('#twQuick'))) onPromptClick(e);
  });

  // The page markup precedes this script, so it can mount right away (no
  // waiting for DOMContentLoaded, which can be late on a slow network).
  // mount() is idempotent, so the DOMContentLoaded call is just a safety net.
  mount();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);

  window.TwinArt = {
    robotSolo: robotSolo, robotPair: robotPair, avatar: avatar, icon: icon,
    refresh: refresh, toggleQuick: toggleQuick, closeQuick: closeQuick, mount: mount
  };

  /* Sync button: reuse the app's own syncNow(), just add feedback. */
  window.twinSyncTap = async function (btn) {
    if (!btn || btn.classList.contains('is-spinning')) return;
    btn.classList.add('is-spinning');
    try { if (typeof window.syncNow === 'function') await window.syncNow(); }
    catch (e) { console.warn('[twin] sync failed:', e && e.message); }
    finally { btn.classList.remove('is-spinning'); }
  };
})();
