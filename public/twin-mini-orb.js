/* ════════════════════════════════════════════════════════════════════
   TWIN MINI ORB — navbar-only canvas, same visual DNA as twin-orb.js
   ────────────────────────────────────────────────────────────────────
   This is NOT a redraw-from-memory approximation. The base-sphere
   gradient stops, the PLASMA blob field, and the RIBBONS bezier math
   below are copied verbatim from the production orb in
   public/twin-orb.js (the orb actually rendered on the Twin AI page),
   just driven at a smaller size with a lighter particle count for
   performance. It is a SEPARATE canvas instance with its own tiny
   rAF loop — it does not share DOM position, state, or lifecycle with
   window.TwinOrb, and this file never touches twin-orb.js.

   Used only for the two places Twin's nav icon currently exists:
   <canvas class="twin-nav-orb"> inside .nav-twin-ico (sidebar) and
   .nav-twin-ico--mini (bottom nav). Everything else — chat avatars,
   the main orb, hero/dock/voice — is untouched.
════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // Same gradient recipe as twin-orb.js, fewer blobs/particles — this
  // renders at 16-22px on screen, so the extra detail the full-size
  // orb carries would be invisible and just costs CPU across however
  // many nav orbs are on screen at once.
  var PLASMA = [
    { rx: 0.30, ry: 0.22, r: 0.55, fx: 0.31, fy: 0.27, ph: 0.0, tone: 0 },
    { rx: 0.62, ry: 0.60, r: 0.60, fx: 0.19, fy: 0.24, ph: 1.1, tone: 1 },
    { rx: 0.50, ry: 0.50, r: 0.70, fx: 0.12, fy: 0.15, ph: 4.4, tone: 1 },
    { rx: 0.25, ry: 0.55, r: 0.40, fx: 0.28, fy: 0.21, ph: 5.2, tone: 2 }
  ];

  // Identical ribbon set to twin-orb.js — this is the part that
  // matters most: continuous bezier curves, never dashed/broken.
  var RIBBONS = [
    { depth: 'back', fx1: 0.17, fy1: 0.23, fx2: 0.21, fy2: 0.19, ph: 0.4, amp: 0.16, speed: 0.35, y0: 0.30 },
    { depth: 'mid',  fx1: 0.20, fy1: 0.16, fx2: 0.15, fy2: 0.24, ph: 1.6, amp: 0.20, speed: 0.42, y0: 0.48 },
    { depth: 'front',fx1: 0.24, fy1: 0.20, fx2: 0.18, fy2: 0.17, ph: 2.7, amp: 0.22, speed: 0.5,  y0: 0.55 },
    { depth: 'mid',  fx1: 0.14, fy1: 0.27, fx2: 0.22, fy2: 0.14, ph: 3.9, amp: 0.18, speed: 0.31, y0: 0.62 }
  ];

  var PARTICLES = (function () {
    var arr = [];
    for (var i = 0; i < 6; i++) {
      arr.push({
        a: Math.random() * Math.PI * 2,
        rr: 0.25 + Math.random() * 0.55,
        speed: 0.04 + Math.random() * 0.06,
        ph: Math.random() * Math.PI * 2,
        size: 0.5 + Math.random() * 0.9
      });
    }
    return arr;
  })();

  function drawRibbon(ctx, rb, tt, R, W, eMul) {
    var ph = tt * rb.speed + rb.ph;
    var y0 = rb.y0 * W;
    var amp = rb.amp * W * (0.85 + 0.15 * eMul);
    var x0 = -W * 0.15, x3 = W * 1.15;
    var c1x = W * rb.fx1 * 3, c1y = y0 + Math.sin(ph) * amp;
    var c2x = W - W * rb.fx2 * 3, c2y = y0 + Math.cos(ph * 1.3 + 1) * amp;
    var midY = y0 + Math.sin(ph * 0.7 + 2) * amp * 0.6;

    var style;
    if (rb.depth === 'back') style = { w: 1.0, glow: 0.10, mid: 0.16, core: 0.20, color: '196,150,160' };
    else if (rb.depth === 'mid') style = { w: 1.3, glow: 0.16, mid: 0.30, core: 0.5, color: '191,194,199' };
    else style = { w: 1.6, glow: 0.22, mid: 0.42, core: 0.9, color: '228,229,231' };

    function path() {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, x3, midY);
    }

    ctx.save();
    ctx.lineCap = 'round';

    ctx.globalAlpha = style.mid * eMul;
    ctx.strokeStyle = 'rgba(' + style.color + ',1)';
    ctx.lineWidth = style.w * 1.5;
    path(); ctx.stroke();

    ctx.globalAlpha = style.core;
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.lineWidth = Math.max(0.55, style.w * 0.5);
    path(); ctx.stroke();

    ctx.restore();
  }

  function draw(ctx, W, dpr, tNow, active) {
    var R = W / 2;
    var t = tNow * 0.001;
    var eMul = active ? 1.28 : 1;
    var tt = t;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, W);

    // outer aura
    var breathe = 1 + Math.sin(t * 1.3) * 0.05 * eMul;
    var auraR = R * (1.22 * breathe) * (active ? 1.1 : 1);
    var auraGrad = ctx.createRadialGradient(R, R, R * 0.7, R, R, auraR);
    var auraOp = 0.30 + 0.16 * eMul;
    auraGrad.addColorStop(0, 'rgba(200,0,0,' + (auraOp * 0.5).toFixed(3) + ')');
    auraGrad.addColorStop(0.55, 'rgba(120,0,0,' + (auraOp * 0.35).toFixed(3) + ')');
    auraGrad.addColorStop(1, 'rgba(120,0,0,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = auraGrad;
    ctx.beginPath(); ctx.arc(R, R, auraR, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // clip to sphere
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R * 0.97, 0, Math.PI * 2);
    ctx.clip();

    // base sphere shading — same stops as twin-orb.js
    var base = ctx.createRadialGradient(R * 0.86, R * 0.72, R * 0.05, R, R, R * 1.05);
    base.addColorStop(0, '#120005');
    base.addColorStop(0.35, '#7a0010');
    base.addColorStop(0.7, '#1c0006');
    base.addColorStop(1, '#050001');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, W);

    var mid = ctx.createRadialGradient(R * 0.42, R * 0.5, R * 0.02, R * 0.5, R * 0.52, R * 0.95);
    mid.addColorStop(0, 'rgba(220,10,10,0.55)');
    mid.addColorStop(0.4, 'rgba(200,0,0,0.4)');
    mid.addColorStop(1, 'rgba(18,0,5,0)');
    ctx.fillStyle = mid;
    ctx.fillRect(0, 0, W, W);

    // plasma clouds (no blur filter at this size — not worth the cost)
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (var i = 0; i < PLASMA.length; i++) {
      var p = PLASMA[i];
      var px = R + Math.cos(tt * p.fx + p.ph) * R * p.rx;
      var py = R + Math.sin(tt * p.fy + p.ph * 1.3) * R * p.ry;
      var pr = R * p.r * (0.85 + 0.15 * Math.sin(tt * 0.6 + p.ph));
      var col = p.tone === 0 ? '200,20,20' : (p.tone === 1 ? '150,0,0' : '196,150,160');
      var g = ctx.createRadialGradient(px, py, 0, px, py, pr);
      var op = (0.20 * eMul).toFixed(3);
      g.addColorStop(0, 'rgba(' + col + ',' + op + ')');
      g.addColorStop(1, 'rgba(' + col + ',0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // silver energy ribbons — continuous curves, no dashes
    for (var d = 0; d < 3; d++) {
      var depthName = d === 0 ? 'back' : (d === 1 ? 'mid' : 'front');
      for (var r2 = 0; r2 < RIBBONS.length; r2++) {
        if (RIBBONS[r2].depth !== depthName) continue;
        drawRibbon(ctx, RIBBONS[r2], tt, R, W, eMul);
      }
    }

    // breathing core
    var coreBreath = 0.55 + 0.45 * Math.sin(t * 2.1);
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

    // tiny drifting particles
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

    // spherical lighting
    var vig = ctx.createRadialGradient(R, R, R * 0.55, R, R, R);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, W);

    var hi = ctx.createRadialGradient(R * 0.36, R * 0.30, 0, R * 0.36, R * 0.30, R * 0.55);
    hi.addColorStop(0, 'rgba(255,255,255,0.22)');
    hi.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hi;
    ctx.fillRect(0, 0, W, W);

    var lo = ctx.createRadialGradient(R * 0.62, R * 0.82, 0, R * 0.62, R * 0.82, R * 0.7);
    lo.addColorStop(0, 'rgba(0,0,0,0.35)');
    lo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = lo;
    ctx.fillRect(0, 0, W, W);

    ctx.restore(); // end sphere clip
  }

  // ── One shared rAF loop drives every .twin-nav-orb canvas on the
  // page (there are at most 2-3 at once: sidebar + bottom nav) —
  // never one loop per element. ──
  var canvases = [];
  var rafId = null;
  var running = false;

  function setupCanvas(el) {
    var rect = el.getBoundingClientRect();
    var size = Math.round(rect.width || parseFloat(getComputedStyle(el).width) || 22);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = Math.round(size * dpr);
    el.height = Math.round(size * dpr);
    return { el: el, ctx: el.getContext('2d'), size: size, dpr: dpr };
  }

  function collect() {
    canvases = Array.prototype.map.call(
      document.querySelectorAll('canvas.twin-nav-orb'),
      setupCanvas
    );
  }

  function isActive(el) {
    var host = el.closest('.bot-ni, .ni');
    return !!(host && host.classList.contains('active'));
  }

  function loop(tNow) {
    if (!running) { rafId = null; return; }
    for (var i = 0; i < canvases.length; i++) {
      var c = canvases[i];
      if (!c.el.isConnected) continue;
      draw(c.ctx, c.size, c.dpr, tNow, isActive(c.el));
    }
    rafId = requestAnimationFrame(loop);
  }

  function start() {
    if (running) return;
    collect();
    if (!canvases.length) return;
    running = true;
    rafId = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop(); else start();
  });
  window.addEventListener('resize', function () { if (running) collect(); });

  function init() {
    if (!document.querySelector('canvas.twin-nav-orb')) return;
    if (!document.hidden) start();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // In case Twin's nav markup is (re)inserted after initial load.
  window.TwinMiniOrb = { refresh: function () { if (!running) start(); else collect(); } };
})();