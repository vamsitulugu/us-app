/* ════════════════════════════════════════════════════════════════════
   TWIN ORB — single Canvas-rendered energy sphere (Phase 3 rebuild)
   ────────────────────────────────────────────────────────────────────
   Replaces the old dual-DOM SVG orb (#twinOrb + #twinDockOrb, two
   separate elements kept in visual sync by toggling the same classes
   on both). There is now exactly ONE orb: one <canvas>, one rAF loop,
   one state machine. It lives in a fixed overlay layer and physically
   translates/scales itself on top of whichever "anchor" element is
   currently active (hero welcome / dock / voice-mode), measured with
   getBoundingClientRect(). Nothing about layout, chat, the AI backend,
   or Twin's personality is touched by this file.

   Public API (window.TwinOrb):
     TwinOrb.init()                         — call once on page load
     TwinOrb.goTo(anchorEl, {animate})       — travel to an anchor's center
     TwinOrb.setSize(px, {animate})          — resize (usually paired with goTo)
     TwinOrb.setState('idle'|'thinking'|'responding'|'error'|'offline'|'listening'|'speaking')
     TwinOrb.setMicLevel(0..1)               — real mic amplitude while listening
     TwinOrb.refresh()                       — re-measure current anchor (resize/orientation)
════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // Canvas is always drawn at this logical size; CSS transform scales
  // it down for smaller anchors (dock/nav) so there is only ever one
  // resolution to render, and shrinking via `scale()` stays crisp.
  var BASE_SIZE = 176;

  var canvas, ctx, dpr = 1;
  var mounted = false;
  var rafId = null;
  var lastFrameT = 0;
  var visible = true;   // tab-visibility (document.hidden)
  var pageVisible = false; // is the Twin page currently the active app page

  // ── current transform target ──
  var curX = 0, curY = 0, curScale = 84 / BASE_SIZE;
  var activeAnchor = null;

  // ── state machine ──
  var state = 'idle';           // idle | thinking | responding | error | offline | listening | speaking
  var micLevel = 0;             // 0..1, live mic amplitude (listening)
  var errorTimer = null;
  var respondTimer = null;
  var stateT0 = performance.now();

  // ── plasma blobs (procedural, merge into one soft field) ──
  var PLASMA = [
    { rx: 0.30, ry: 0.22, r: 0.55, fx: 0.31, fy: 0.27, ph: 0.0, tone: 0 },
    { rx: 0.62, ry: 0.60, r: 0.60, fx: 0.19, fy: 0.24, ph: 1.1, tone: 1 },
    { rx: 0.40, ry: 0.70, r: 0.48, fx: 0.26, fy: 0.18, ph: 2.4, tone: 0 },
    { rx: 0.72, ry: 0.32, r: 0.42, fx: 0.22, fy: 0.29, ph: 3.6, tone: 2 },
    { rx: 0.50, ry: 0.50, r: 0.70, fx: 0.12, fy: 0.15, ph: 4.4, tone: 1 },
    { rx: 0.25, ry: 0.55, r: 0.40, fx: 0.28, fy: 0.21, ph: 5.2, tone: 2 }
  ];

  // ── silver energy ribbons (bezier, animated control points) ──
  var RIBBONS = [
    { depth: 'back', fx1: 0.17, fy1: 0.23, fx2: 0.21, fy2: 0.19, ph: 0.4, amp: 0.16, speed: 0.35, y0: 0.30 },
    { depth: 'mid', fx1: 0.20, fy1: 0.16, fx2: 0.15, fy2: 0.24, ph: 1.6, amp: 0.20, speed: 0.42, y0: 0.48 },
    { depth: 'front', fx1: 0.24, fy1: 0.20, fx2: 0.18, fy2: 0.17, ph: 2.7, amp: 0.22, speed: 0.5, y0: 0.55 },
    { depth: 'mid', fx1: 0.14, fy1: 0.27, fx2: 0.22, fy2: 0.14, ph: 3.9, amp: 0.18, speed: 0.31, y0: 0.62 },
    { depth: 'back', fx1: 0.19, fy1: 0.18, fx2: 0.16, fy2: 0.22, ph: 5.1, amp: 0.15, speed: 0.38, y0: 0.42 }
  ];

  var PARTICLES = (function () {
    var arr = [];
    for (var i = 0; i < 16; i++) {
      arr.push({
        a: Math.random() * Math.PI * 2,
        rr: 0.25 + Math.random() * 0.55,
        speed: 0.04 + Math.random() * 0.06,
        ph: Math.random() * Math.PI * 2,
        size: 0.6 + Math.random() * 1.3
      });
    }
    return arr;
  })();

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'twinOrbCanvas';
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, {
      position: 'fixed',
      top: '0', left: '0',
      width: BASE_SIZE + 'px',
      height: BASE_SIZE + 'px',
      pointerEvents: 'none',
      zIndex: '60',
      willChange: 'transform',
      // Center-origin is what makes `translate(dx,dy) scale(s)` land the
      // canvas's *center* exactly on (dx + BASE_SIZE/2, dy + BASE_SIZE/2)
      // regardless of scale. With the old '0 0' origin, scale shrank the
      // box toward its top-left corner *before* the translate, which
      // pulled the visual center up-and-left by BASE_SIZE/2*(1-scale) —
      // ~56px at dock size. That was the whole "stops too high" bug.
      transformOrigin: '50% 50%',
      transition: 'none',
      display: 'none' // hidden until TwinOrb.show() — never visible by default
    });
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    resizeCanvasBuffer();
  }

  function resizeCanvasBuffer() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(BASE_SIZE * dpr);
    canvas.height = Math.round(BASE_SIZE * dpr);
  }

  function applyTransform(animate) {
    canvas.style.transition = animate
      ? 'transform 760ms cubic-bezier(0.22,1,0.36,1)'
      : 'none';
    var tx = curX - BASE_SIZE / 2;
    var ty = curY - BASE_SIZE / 2;
    canvas.style.transform = 'translate3d(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px,0) scale(' + curScale.toFixed(4) + ')';
    if (animate) scheduleLandingSettle(tx, ty, curScale);
  }

  var settleTimer1 = null, settleTimer2 = null;
  // Extremely small "it just landed" wobble — scale target -> ~1.02x
  // -> target, over ~300ms once the main 760ms travel finishes. Never
  // touches position, only a subtle scale overshoot, and only ever
  // runs on the one canvas that already exists.
  function scheduleLandingSettle(tx, ty, targetScale) {
    clearTimeout(settleTimer1); clearTimeout(settleTimer2);
    settleTimer1 = setTimeout(function () {
      canvas.style.transition = 'transform 140ms cubic-bezier(0.34,1.56,0.64,1)';
      canvas.style.transform = 'translate3d(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px,0) scale(' + (targetScale * 1.02).toFixed(4) + ')';
      settleTimer2 = setTimeout(function () {
        canvas.style.transition = 'transform 160ms ease-out';
        canvas.style.transform = 'translate3d(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px,0) scale(' + targetScale.toFixed(4) + ')';
      }, 140);
    }, 760);
  }

  function centerOf(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, size: r.width };
  }

  function goTo(anchorEl, opts) {
    if (!anchorEl) return;
    ensureCanvas();
    opts = opts || {};
    activeAnchor = anchorEl;
    var c = centerOf(anchorEl);
    curX = c.x; curY = c.y;
    if (c.size > 0) curScale = c.size / BASE_SIZE;
    applyTransform(opts.animate !== false);
  }

  function refresh() {
    if (!activeAnchor || !canvas) return;
    goTo(activeAnchor, { animate: false });
  }

  function setState(next) {
    if (!next) next = 'idle';
    clearTimeout(errorTimer);
    clearTimeout(respondTimer);
    state = next;
    stateT0 = performance.now();
    if (next === 'error') {
      errorTimer = setTimeout(function () { setState('idle'); }, 1400);
    }
    if (next === 'responding') {
      respondTimer = setTimeout(function () { if (state === 'responding') setState('idle'); }, 900);
    }
  }

  function setMicLevel(v) {
    micLevel = Math.max(0, Math.min(1, v || 0));
  }

  // ── drawing helpers ──
  function lerp(a, b, t) { return a + (b - a) * t; }

  function speedMul() {
    switch (state) {
      case 'thinking': return 1.9;
      case 'listening': return 1 + micLevel * 1.1;
      case 'speaking': return 1.5;
      case 'offline': return 0.15;
      default: return 1;
    }
  }
  function energyMul() {
    switch (state) {
      case 'thinking': return 1.35;
      case 'listening': return 1 + micLevel * 0.8;
      case 'speaking': return 1.25;
      case 'error': return 1.4;
      case 'offline': return 0.25;
      default: return 1;
    }
  }

  function draw(tNow) {
    var W = BASE_SIZE, H = BASE_SIZE, R = W / 2;
    var t = tNow * 0.001;
    var sMul = speedMul();
    var eMul = energyMul();
    var tt = t * sMul;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // ── outer aura (outside the sphere clip) ──
    var breathe = 1 + Math.sin(t * 1.3) * 0.05 * eMul;
    var auraR = R * (1.28 * breathe);
    var auraGrad = ctx.createRadialGradient(R, R, R * 0.7, R, R, auraR);
    var auraOp = (state === 'offline') ? 0.08 : 0.34 + 0.16 * eMul;
    auraGrad.addColorStop(0, 'rgba(200,0,0,' + (auraOp * 0.5).toFixed(3) + ')');
    auraGrad.addColorStop(0.55, 'rgba(120,0,0,' + (auraOp * 0.35).toFixed(3) + ')');
    auraGrad.addColorStop(1, 'rgba(120,0,0,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = auraGrad;
    ctx.beginPath(); ctx.arc(R, R, auraR, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // ── clip to the sphere ──
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R * 0.97, 0, Math.PI * 2);
    ctx.clip();

    // Layer 1 — deep base sphere shading (several stacked radials = depth)
    var base = ctx.createRadialGradient(R * 0.86, R * 0.72, R * 0.05, R, R, R * 1.05);
    base.addColorStop(0, '#120005');
    base.addColorStop(0.35, '#7a0010');
    base.addColorStop(0.7, '#1c0006');
    base.addColorStop(1, '#050001');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);

    var mid = ctx.createRadialGradient(R * 0.42, R * 0.5, R * 0.02, R * 0.5, R * 0.52, R * 0.95);
    mid.addColorStop(0, 'rgba(220,10,10,0.55)');
    mid.addColorStop(0.4, 'rgba(200,0,0,0.4)');
    mid.addColorStop(1, 'rgba(18,0,5,0)');
    ctx.fillStyle = mid;
    ctx.fillRect(0, 0, W, H);

    // Layer 2 — internal plasma clouds (merged soft blobs, screen blend)
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    try { ctx.filter = 'blur(' + (R * 0.10).toFixed(1) + 'px)'; } catch (e) {}
    for (var i = 0; i < PLASMA.length; i++) {
      var p = PLASMA[i];
      var px = R + Math.cos(tt * p.fx + p.ph) * R * p.rx;
      var py = R + Math.sin(tt * p.fy + p.ph * 1.3) * R * p.ry;
      var pr = R * p.r * (0.85 + 0.15 * Math.sin(tt * 0.6 + p.ph));
      var col = p.tone === 0 ? '200,20,20' : (p.tone === 1 ? '150,0,0' : '196,150,160');
      var g = ctx.createRadialGradient(px, py, 0, px, py, pr);
      var op = (0.22 * eMul).toFixed(3);
      g.addColorStop(0, 'rgba(' + col + ',' + op + ')');
      g.addColorStop(1, 'rgba(' + col + ',0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
    }
    try { ctx.filter = 'none'; } catch (e) {}
    ctx.restore();

    // Layer 3 — silver energy ribbons (smooth bezier, no dashes)
    for (var d = 0; d < 3; d++) {
      var depthName = d === 0 ? 'back' : (d === 1 ? 'mid' : 'front');
      for (var r2 = 0; r2 < RIBBONS.length; r2++) {
        var rb = RIBBONS[r2];
        if (rb.depth !== depthName) continue;
        drawRibbon(rb, tt, R, eMul);
      }
    }

    // Layer 4 — breathing core
    var coreBreath = 0.55 + 0.45 * Math.sin(t * 2.1 * sMul);
    var coreR = R * (0.42 + 0.06 * coreBreath * eMul);
    var coreG = ctx.createRadialGradient(R * 0.46, R * 0.46, 0, R * 0.5, R * 0.5, coreR);
    coreG.addColorStop(0, 'rgba(244,244,244,' + (0.30 + 0.22 * coreBreath * eMul).toFixed(3) + ')');
    coreG.addColorStop(0.4, 'rgba(211,19,50,' + (0.20 * eMul).toFixed(3) + ')');
    coreG.addColorStop(1, 'rgba(211,19,50,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = coreG;
    ctx.beginPath(); ctx.arc(R, R, coreR, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Layer 5 — tiny drifting particles
    if (state !== 'offline') {
      ctx.save();
      for (var pi = 0; pi < PARTICLES.length; pi++) {
        var par = PARTICLES[pi];
        var ang = par.a + tt * par.speed;
        var rad = R * par.rr;
        var qx = R + Math.cos(ang) * rad;
        var qy = R + Math.sin(ang * 0.8) * rad * 0.9;
        var fade = 0.25 + 0.35 * Math.sin(t * 1.4 + par.ph);
        if (fade < 0) continue;
        ctx.fillStyle = 'rgba(228,229,231,' + (fade * 0.6 * eMul).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(qx, qy, par.size, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    // ── spherical lighting on top ──
    // edge vignette
    var vig = ctx.createRadialGradient(R, R, R * 0.55, R, R, R);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);
    // upper-left soft highlight
    var hi = ctx.createRadialGradient(R * 0.36, R * 0.30, 0, R * 0.36, R * 0.30, R * 0.55);
    hi.addColorStop(0, 'rgba(255,255,255,0.22)');
    hi.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hi;
    ctx.fillRect(0, 0, W, H);
    // lower deep shadow
    var lo = ctx.createRadialGradient(R * 0.62, R * 0.82, 0, R * 0.62, R * 0.82, R * 0.7);
    lo.addColorStop(0, 'rgba(0,0,0,0.35)');
    lo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = lo;
    ctx.fillRect(0, 0, W, H);
    // rim light
    ctx.save();
    ctx.strokeStyle = 'rgba(228,229,231,0.28)';
    ctx.lineWidth = Math.max(1, R * 0.02);
    ctx.beginPath();
    ctx.arc(R, R, R * 0.94, Math.PI * 1.05, Math.PI * 1.75);
    ctx.stroke();
    ctx.restore();

    // state-specific flash (error)
    if (state === 'error') {
      var flick = Math.abs(Math.sin((tNow - stateT0) * 0.02));
      ctx.fillStyle = 'rgba(248,113,113,' + (0.18 * flick).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    ctx.restore(); // end sphere clip
  }

  function drawRibbon(rb, tt, R, eMul) {
    var W = BASE_SIZE;
    var ph = tt * rb.speed + rb.ph;
    var y0 = rb.y0 * W;
    var amp = rb.amp * W * (0.85 + 0.15 * eMul);

    var x0 = -W * 0.15, x3 = W * 1.15;
    var c1x = W * rb.fx1 * 3, c1y = y0 + Math.sin(ph) * amp;
    var c2x = W - W * rb.fx2 * 3, c2y = y0 + Math.cos(ph * 1.3 + 1) * amp;
    var midY = y0 + Math.sin(ph * 0.7 + 2) * amp * 0.6;

    var style;
    if (rb.depth === 'back') style = { w: 1.1, glow: 0.10, mid: 0.16, core: 0.20, color: '196,150,160' };
    else if (rb.depth === 'mid') style = { w: 1.6, glow: 0.16, mid: 0.30, core: 0.5, color: '191,194,199' };
    else style = { w: 2.1, glow: 0.22, mid: 0.42, core: 0.9, color: '228,229,231' };

    function path() {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, x3, midY);
    }

    ctx.save();
    ctx.setLineDash([]);
    ctx.lineCap = 'round';

    // pass 1 — wide soft glow
    ctx.globalAlpha = style.glow * eMul;
    ctx.strokeStyle = 'rgba(' + style.color + ',1)';
    ctx.lineWidth = style.w * 4.2;
    try { ctx.filter = 'blur(' + (style.w * 1.6).toFixed(1) + 'px)'; } catch (e) {}
    path(); ctx.stroke();
    try { ctx.filter = 'none'; } catch (e) {}

    // pass 2 — medium silver body
    ctx.globalAlpha = style.mid * eMul;
    ctx.lineWidth = style.w * 1.6;
    path(); ctx.stroke();

    // pass 3 — thin bright core
    ctx.globalAlpha = style.core;
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.lineWidth = Math.max(0.6, style.w * 0.55);
    path(); ctx.stroke();

    ctx.restore();
  }

  function loop(tNow) {
    if (!visible || !pageVisible) { rafId = null; return; }
    draw(tNow);
    rafId = requestAnimationFrame(loop);
  }

  function startLoop() {
    if (rafId) return;
    if (!pageVisible) return; // never render while off the Twin page
    rafId = requestAnimationFrame(loop);
  }
  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  document.addEventListener('visibilitychange', function () {
    visible = !document.hidden;
    if (visible) startLoop(); else stopLoop();
  });

  window.addEventListener('resize', function () { if (pageVisible) refresh(); });
  window.addEventListener('orientationchange', function () { setTimeout(function () { if (pageVisible) refresh(); }, 60); });

  function init() {
    if (mounted) return;
    mounted = true;
    ensureCanvas();
    // Deliberately NOT calling startLoop()/showing here — the orb stays
    // fully hidden (display:none, no rAF) until show() is called by the
    // page-navigation handler for the 'ai' page. This is what guarantees
    // it can never be seen on Dashboard/Home/any other page, including
    // on first boot if Twin isn't the initial page.
  }

  // Called every time the Twin page becomes the active page.
  function show() {
    ensureCanvas();
    pageVisible = true;
    canvas.style.display = 'block';
    startLoop();
  }

  // Called every time the Twin page is left for any other page. Fully
  // detaches the orb from view and halts its render loop — this is the
  // single choke point that fixes "orb leaks onto Dashboard".
  function hide() {
    pageVisible = false;
    stopLoop();
    if (canvas) canvas.style.display = 'none';
  }

  function isPageVisible() { return pageVisible; }

  window.TwinOrb = {
    init: init,
    show: show,
    hide: hide,
    isPageVisible: isPageVisible,
    goTo: goTo,
    refresh: refresh,
    setState: setState,
    setMicLevel: setMicLevel,
    getState: function () { return state; }
  };
})();