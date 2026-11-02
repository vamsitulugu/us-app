/* ══════════════════════════════════════════════════════════════
   TWIN REWARDS — Steps 1–3 (web)  ·  wallet, daily check-in, streaks,
   Gift Shop API, Spin & Win wheel, and Lucky Scratch card.
   Home strip (#rwStrip, inserted above "Stay Connected") and the
   Rewards page (#page-rewards → #rewardsPageContent).

   All numbers come from the server (/api/rewards/*). This file only
   DISPLAYS them and animates to server results. It never sends an amount.
   Needs globals from the main app: S, API, goto(), toast().
   ══════════════════════════════════════════════════════════════ */
'use strict';

const Rewards = (() => {
  const COIN = '<svg class="rw-coin" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#F5B83D"/><circle cx="12" cy="12" r="7.2" fill="none" stroke="#B87A0A" stroke-width="1.4"/><path d="M12 7.6v8.8M9.6 10c.5-.9 1.4-1.3 2.4-1.3 1.3 0 2.4.6 2.4 1.7 0 2.3-4.8 1.2-4.8 3.6 0 1.1 1.1 1.8 2.4 1.8 1 0 1.9-.4 2.4-1.2" fill="none" stroke="#B87A0A" stroke-width="1.3" stroke-linecap="round"/></svg>';
  const FLAME = '<svg class="rw-flame" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2c.6 3.2-1.2 4.6-2.6 6.3C8 10 7 11.6 7 14a5 5 0 0 0 10 0c0-1.6-.7-2.9-1.5-4 0 1.3-.7 2.2-1.6 2.2-1.3 0-1.7-1.3-1.2-3C13.4 7.2 13 4.6 12 2z"/></svg>';
  const WHEEL_ICO = '<svg class="rw-wheel-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M4.93 19.07l14.14-14.14"/></svg>';
  const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const KIND = { checkin: 'Daily check-in', gift: 'Gift sent', gift_refund: 'Gift refunded', spin: 'Spin & Win', scratch: 'Lucky Scratch' };

  let sum = null, hist = null, loading = false, busy = false, failed = false;
  let wheelAngle = 0, isSpinning = false, scratchResult = null, isScratching = false;

  const $ = id => document.getElementById(id);
  const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ids = () => (window.S && S.userId && S.coupleId) ? { userId: S.userId, coupleId: S.coupleId } : null;
  const base = () => (typeof API !== 'undefined' ? API : '');
  const genClientId = () => 'cl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);

  async function call(method, path, body) {
    const id = ids(); if (!id) throw new Error('not-ready');
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const qs = method === 'GET' ? (path.includes('?') ? '&' : '?') + 'coupleId=' + encodeURIComponent(id.coupleId) + '&userId=' + encodeURIComponent(id.userId) : '';
      const r = await fetch(base() + path + qs, {
        method, signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', 'x-user-id': id.userId },
        body: method === 'GET' ? undefined : JSON.stringify({ ...body, coupleId: id.coupleId, userId: id.userId }),
      });
      let data = {}; try { data = await r.json(); } catch (_) {}
      if (!r.ok) { const er = new Error(data.error || 'Something went wrong'); er.status = r.status; er.data = data; throw er; }
      return data;
    } finally { clearTimeout(t); }
  }

  /* ── data ── */
  async function load(withHistory) {
    if (loading || !ids()) return;
    loading = true;
    try {
      sum = await call('GET', '/api/rewards/summary'); failed = false;
      if (withHistory) hist = (await call('GET', '/api/rewards/history?limit=20')).items;
    } catch (e) { if (e.message !== 'not-ready') failed = true; }
    loading = false; render();
  }

  async function claim() {
    if (busy || !sum || sum.checkedInToday) return;
    busy = true; render();
    try {
      const before = sum.balance;
      sum = await call('POST', '/api/rewards/checkin', {});
      busy = false; failed = false; hist = null;
      render(); countUp(before, sum.balance);
      if (sum.claimed && typeof toast === 'function') toast('+' + sum.earned + ' Gold Coins 🪙  ·  ' + sum.streak + '-day streak 🔥');
      if (isPageOpen()) load(true);
    } catch (e) {
      busy = false; render();
      if (typeof toast === 'function') toast(e.message === 'not-ready' ? 'Still signing in…' : e.message);
    }
  }

  /* ── Step 2: Gift Shop ── */
  async function loadGifts() {
    const g = await call('GET', '/api/rewards/gifts');
    if (sum) { sum.balance = g.balance; renderStrip(); }
    return g;
  }
  async function sendGift(giftId, clientId) {
    const r = await call('POST', '/api/rewards/gift', { giftId, clientId });
    if (sum) sum.balance = r.balance;
    hist = null; render();
    if (isPageOpen()) load(true);
    return r;
  }

  /* ── Step 3: Spin & Win ── */
  async function spin() {
    if (isSpinning || !sum || sum.spunToday) return;
    isSpinning = true;
    const btn = $('rwSpinBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Spinning…'; }

    try {
      const res = await call('POST', '/api/rewards/spin', { clientId: 'spin_' + genClientId() });
      const targetIndex = res.sliceIndex != null ? res.sliceIndex : 0;
      const coinsWon = res.coins || 0;
      const newBal = res.balance;

      // Animate wheel to the target slice
      animateWheel(targetIndex, () => {
        isSpinning = false;
        if (sum) {
          sum.balance = newBal;
          sum.spunToday = true;
          sum.spinsAvailable = 0;
        }
        hist = null;
        render();
        countUp(newBal - coinsWon, newBal);
        if (typeof toast === 'function') toast('🎉 You won ' + coinsWon + ' Gold Coins from Spin & Win!');
        if (window.playAppSound) try { window.playAppSound('chat.sticker.sent'); } catch (_) {}
      });
    } catch (e) {
      isSpinning = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Spin Wheel 🎡'; }
      if (typeof toast === 'function') toast(e.message || 'Spin failed. Please try again.');
    }
  }

  function animateWheel(targetIndex, onDone) {
    const canvas = $('rwWheelCanvas');
    if (!canvas || !sum || !sum.wheelSlices) { if (onDone) onDone(); return; }
    const slices = sum.wheelSlices;
    const num = slices.length || 8;
    const sliceRad = (2 * Math.PI) / num;

    // Pointer is at top (-PI/2). To put targetIndex under pointer:
    // angle + (targetIndex + 0.5) * sliceRad = -PI/2  (mod 2PI)
    const targetSliceCenter = (targetIndex + 0.5) * sliceRad;
    let finalAngle = -Math.PI / 2 - targetSliceCenter;
    while (finalAngle < wheelAngle) finalAngle += 2 * Math.PI;
    // Add 5 full rotations for drama
    finalAngle += 5 * 2 * Math.PI;

    if (reduce()) {
      wheelAngle = finalAngle;
      drawWheel(canvas, slices, wheelAngle);
      if (onDone) onDone();
      return;
    }

    const startAngle = wheelAngle;
    const totalDelta = finalAngle - startAngle;
    const startTime = performance.now();
    const duration = 3600;

    function frame(now) {
      const elapsed = now - startTime;
      const p = Math.min(1, elapsed / duration);
      // Ease out cubic
      const ease = 1 - Math.pow(1 - p, 3);
      wheelAngle = startAngle + totalDelta * ease;
      drawWheel(canvas, slices, wheelAngle);

      if (p < 1) {
        requestAnimationFrame(frame);
      } else {
        wheelAngle = finalAngle % (2 * Math.PI);
        drawWheel(canvas, slices, wheelAngle);
        if (onDone) onDone();
      }
    }
    requestAnimationFrame(frame);
  }

  function drawWheel(canvas, slices, angle) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const center = size / 2;
    const radius = center - 10;
    const num = slices.length || 8;
    const sliceRad = (2 * Math.PI) / num;

    ctx.clearRect(0, 0, size, size);

    // Outer ring shadow and border
    ctx.save();
    ctx.beginPath();
    ctx.arc(center, center, radius + 5, 0, 2 * Math.PI);
    ctx.fillStyle = '#D9941A';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(center, center, radius, 0, 2 * Math.PI);
    ctx.fillStyle = '#1A1423';
    ctx.fill();

    // Draw Slices
    for (let i = 0; i < num; i++) {
      const s = slices[i];
      const startAngle = angle + i * sliceRad;
      const endAngle = startAngle + sliceRad;

      ctx.beginPath();
      ctx.moveTo(center, center);
      ctx.arc(center, center, radius - 2, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = s.color || (i % 2 === 0 ? '#F59E0B' : '#EC4899');
      ctx.fill();

      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.stroke();

      // Label & Icon
      ctx.save();
      ctx.translate(center, center);
      ctx.rotate(startAngle + sliceRad / 2);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 12px sans-serif';
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 4;
      ctx.fillText((s.emoji || '🪙') + ' ' + (s.coins || ''), radius - 22, 4);
      ctx.restore();
    }

    // Outer dots decoration
    const dotCount = 16;
    for (let d = 0; d < dotCount; d++) {
      const dotAngle = d * (2 * Math.PI / dotCount);
      const dotX = center + (radius + 2.5) * Math.cos(dotAngle);
      const dotY = center + (radius + 2.5) * Math.sin(dotAngle);
      ctx.beginPath();
      ctx.arc(dotX, dotY, 2, 0, 2 * Math.PI);
      ctx.fillStyle = '#FFF8E7';
      ctx.fill();
    }

    // Center Hub
    ctx.beginPath();
    ctx.arc(center, center, 24, 0, 2 * Math.PI);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#F5B83D';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(center, center, 18, 0, 2 * Math.PI);
    ctx.fillStyle = '#3A2400';
    ctx.fill();

    ctx.fillStyle = '#F5B83D';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💖', center, center);

    ctx.restore();
  }

  /* ── Step 3: Scratch Card ── */
  async function scratch() {
    if (isScratching || !sum || sum.scratchedToday || scratchResult) return;
    isScratching = true;
    try {
      const res = await call('POST', '/api/rewards/scratch', { clientId: 'scratch_' + genClientId() });
      scratchResult = res;
      isScratching = false;

      // Update card content behind canvas
      const prizeEl = $('rwScratchPrize');
      if (prizeEl) {
        prizeEl.innerHTML = '<div class="rw-sc-emoji">' + esc(res.emoji || '💖') + '</div>' +
          '<div class="rw-sc-title">' + esc(res.title) + '</div>' +
          '<div class="rw-sc-coins">+' + res.coins + ' Gold Coins 🪙</div>' +
          '<div class="rw-sc-msg">“' + esc(res.message) + '”</div>';
      }

      if (sum) {
        sum.balance = res.balance;
        sum.scratchedToday = true;
        sum.scratchesAvailable = 0;
      }
      hist = null;
      renderStrip();
    } catch (e) {
      isScratching = false;
      if (typeof toast === 'function') toast(e.message || 'Could not claim scratch card.');
    }
  }

  function initScratchCanvas(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;

    // Fill with metallic gold/silver gradient
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#D9941A');
    g.addColorStop(0.3, '#F5B83D');
    g.addColorStop(0.7, '#FCD34D');
    g.addColorStop(1, '#B87A0A');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Decorative pattern
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    for (let x = 10; x < w; x += 24) {
      for (let y = 10; y < h; y += 24) {
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, 2 * Math.PI);
        ctx.fill();
      }
    }

    // Text prompt
    ctx.fillStyle = '#3A2400';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🎫 Scratch to Reveal Prize ✨', w / 2, h / 2 - 4);
    ctx.font = '12px sans-serif';
    ctx.fillText('Drag your finger or tap Reveal All', w / 2, h / 2 + 18);

    let drawing = false;
    let scratchedPixels = 0;
    const totalPixels = w * h;

    function eraseAt(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const x = (clientX - rect.left) * (canvas.width / rect.width);
      const y = (clientY - rect.top) * (canvas.height / rect.height);

      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(x, y, 22, 0, 2 * Math.PI);
      ctx.fill();

      // First scratch stroke triggers the server claim if not done yet
      if (!scratchResult && !sum?.scratchedToday && !isScratching) {
        scratch();
      }

      scratchedPixels += 1;
      if (scratchedPixels > 24) {
        revealScratch(canvas);
      }
    }

    canvas.onmousedown = e => { drawing = true; eraseAt(e.clientX, e.clientY); };
    window.addEventListener('mouseup', () => { drawing = false; });
    canvas.onmousemove = e => { if (drawing) eraseAt(e.clientX, e.clientY); };

    canvas.ontouchstart = e => {
      drawing = true;
      if (e.touches && e.touches[0]) eraseAt(e.touches[0].clientX, e.touches[0].clientY);
    };
    canvas.ontouchend = () => { drawing = false; };
    canvas.ontouchmove = e => {
      if (drawing && e.touches && e.touches[0]) {
        e.preventDefault();
        eraseAt(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
  }

  function revealScratch(canvas) {
    if (!canvas) canvas = $('rwScratchCanvas');
    if (!scratchResult && !sum?.scratchedToday && !isScratching) {
      scratch();
    }
    if (canvas) {
      canvas.style.transition = 'opacity 0.5s ease-out';
      canvas.style.opacity = '0';
      setTimeout(() => {
        canvas.style.display = 'none';
        const btn = $('rwScratchRevealBtn');
        if (btn) btn.style.display = 'none';
        if (scratchResult && typeof toast === 'function') {
          toast('💖 ' + scratchResult.title + ' · +' + scratchResult.coins + ' Gold Coins 🪙');
          countUp(sum.balance - scratchResult.coins, sum.balance);
        }
      }, 500);
    }
  }

  function countUp(from, to) {
    const els = document.querySelectorAll('[data-rw-bal]');
    els.forEach(el => el.classList.add('rw-pop'));
    if (reduce() || from === to) return;
    const t0 = performance.now(), dur = 700;
    (function tick(now) {
      const p = Math.min(1, (now - t0) / dur), v = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      document.querySelectorAll('[data-rw-bal]').forEach(el => { el.textContent = v; });
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  }

  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isPageOpen = () => { const p = $('page-rewards'); return !!(p && p.classList.contains('active')); };

  /* ── Home strip ── */
  function ensureStrip() {
    let el = $('rwStrip');
    if (el) return el;
    const anchor = document.querySelector('#page-dashboard .dh-sheet-title');
    if (!anchor) return null;
    el = document.createElement('div'); el.id = 'rwStrip'; el.className = 'rw';
    anchor.parentNode.insertBefore(el, anchor);
    el.addEventListener('click', e => {
      if (e.target.closest('[data-rw-claim]')) { e.stopPropagation(); claim(); return; }
      if (typeof goto === 'function') goto('rewards');
    });
    return el;
  }

  function renderStrip() {
    const el = ensureStrip(); if (!el) return;
    if (!sum) {
      el.innerHTML = '<div class="rw-card rw-strip is-loading">' + '<div class="rw-strip-stat">' + COIN + '<div><b>—</b><span>Gold Coins</span></div></div></div>';
      return;
    }
    const btn = sum.checkedInToday
      ? '<button class="rw-btn is-done" type="button" disabled>✓ Claimed</button>'
      : '<button class="rw-btn is-pulse" type="button" data-rw-claim ' + (busy ? 'disabled' : '') + '>' + (busy ? '…' : 'Claim +' + sum.todayCoins) + '</button>';

    const spinText = sum.spinsAvailable > 0 ? '1 Spin' : 'Spun';
    el.innerHTML = '<div class="rw-card rw-strip" role="button" tabindex="0" aria-label="Open Rewards">' +
      '<div class="rw-strip-stat">' + COIN + '<div><b data-rw-bal>' + sum.balance + '</b><span>Gold Coins</span></div></div>' +
      '<div class="rw-strip-sep"></div>' +
      '<div class="rw-strip-stat">' + FLAME + '<div><b>' + sum.streak + '</b><span>Day streak</span></div></div>' +
      '<div class="rw-strip-sep"></div>' +
      '<div class="rw-strip-stat rw-strip-spin">' + WHEEL_ICO + '<div><b>' + (sum.spinsAvailable > 0 ? '1' : '0') + '</b><span>' + spinText + '</span></div></div>' +
      btn + '</div>';
  }

  /* ── Rewards page ── */
  function renderPage() {
    const host = $('rewardsPageContent'); if (!host) return;
    if (!sum) {
      host.innerHTML = failed
        ? '<div class="rw rw-card rw-err">Could not load your rewards.<br><button class="rw-btn" type="button" data-rw-retry>Try again</button></div>'
        : '<div class="rw rw-page"><div class="rw-skel"></div><div class="rw-skel"></div></div>';
      return;
    }
    const days = sum.cycle.map(d => '<div class="rw-day' + (d.done ? ' is-done' : '') + (d.today ? ' is-today' : '') + (d.day === 7 ? ' is-big' : '') + '">Day ' + d.day +
      (d.done ? CHECK : COIN.replace('rw-coin', '')) + '<b>+' + d.coins + '</b></div>').join('');
    const note = sum.checkedInToday
      ? 'Come back tomorrow to keep your ' + sum.streak + '-day streak going.'
      : (sum.streak > 0 ? 'Claim today to make it ' + (sum.streak + 1) + ' days in a row.' : 'Claim today to start your streak.');
    const claimBtn = sum.checkedInToday
      ? '<button class="rw-btn is-done" type="button" disabled>✓ Claimed today</button>'
      : '<button class="rw-btn is-pulse" type="button" data-rw-claim ' + (busy ? 'disabled' : '') + '>' + (busy ? 'Claiming…' : 'Claim +' + sum.todayCoins + ' coins') + '</button>';
    const partner = (window.S && S.partnerName) ? S.partnerName : 'Partner';
    const coupleMsg = sum.coupleDoneToday ? 'You both checked in today 💞'
      : (sum.checkedInToday ? 'Waiting for ' + partner + ' to check in today'
        : (sum.partnerCheckedInToday ? partner + ' already checked in — your turn 💌' : 'Check in — and ask ' + partner + ' to do the same'));

    // Step 3: Spin & Scratch states
    const spinBtnLabel = sum.spunToday ? 'Spun Today ✓' : 'Spin Wheel 🎡';
    const spinDisabled = sum.spunToday || isSpinning ? 'disabled' : '';

    const scratchCoverStyle = sum.scratchedToday ? 'display:none;' : '';
    const scratchRevealBtn = sum.scratchedToday ? '' : '<button type="button" class="rw-btn rw-sc-btn" id="rwScratchRevealBtn" onclick="Rewards.revealScratch()">Reveal Prize ✨</button>';

    let history;
    if (hist == null) history = '<div class="rw-empty">Loading…</div>';
    else if (!hist.length) history = '<div class="rw-empty">No coins yet. Claim your first daily reward above.</div>';
    else history = '<ul class="rw-hist">' + hist.map(h => {
      const d = new Date(h.created_at), pos = h.amount >= 0;
      return '<li><div>' + esc(h.kind === 'gift' && h.meta && h.meta.name ? 'Gift: ' + h.meta.name : (KIND[h.kind] || 'Reward')) + '<small>' + d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + '</small></div><em class="' + (pos ? 'pos' : 'neg') + '">' + (pos ? '+' : '') + h.amount + '</em></li>';
    }).join('') + '</ul>';

    host.innerHTML = '<div class="rw rw-page">' +
      '<div class="rw-head"><div><h2>Twin Rewards</h2><p>Play together. Earn together. Celebrate together.</p></div></div>' +
      '<div class="rw-card rw-hero">' + COIN + '<div><div class="rw-bal" data-rw-bal>' + sum.balance + '</div><div class="rw-bal-l">Gold Coins</div></div>' +
        '<div class="rw-hero-right"><b>' + sum.lifetimeEarned + '</b>earned in total</div></div>' +

      // 1. Daily Check-in
      '<div class="rw-card"><h3>Daily check-in <small>Day ' + sum.cyclePosition + ' of 7</small></h3><div class="rw-days">' + days + '</div>' +
        '<div class="rw-claim-row">' + claimBtn + '<div class="rw-note">' + note + '</div></div></div>' +

      // 2. Spin & Win Wheel
      '<div class="rw-card rw-interactive-card"><h3>🎡 Spin & Win <small>' + (sum.spunToday ? 'Free spin used' : '1 Free spin available') + '</small></h3>' +
        '<div class="rw-wheel-box">' +
          '<div class="rw-wheel-pointer">▼</div>' +
          '<canvas id="rwWheelCanvas" width="280" height="280" class="rw-wheel-canvas"></canvas>' +
        '</div>' +
        '<div class="rw-spin-actions">' +
          '<button type="button" class="rw-btn ' + (sum.spunToday ? 'is-done' : 'is-pulse') + '" id="rwSpinBtn" ' + spinDisabled + ' onclick="Rewards.spin()">' + spinBtnLabel + '</button>' +
          '<div class="rw-note">' + (sum.spunToday ? 'Come back tomorrow for your next free spin.' : 'Spin the wheel to win up to 100 Gold Coins!') + '</div>' +
        '</div>' +
      '</div>' +

      // 3. Lucky Scratch Card
      '<div class="rw-card rw-interactive-card"><h3>🎫 Lucky Couple Scratch <small>' + (sum.scratchedToday ? 'Scratched today' : '1 Card ready') + '</small></h3>' +
        '<div class="rw-scratch-box">' +
          '<div class="rw-scratch-under" id="rwScratchPrize">' +
            '<div class="rw-sc-emoji">💖</div>' +
            '<div class="rw-sc-title">' + (sum.scratchedToday ? 'Daily Fortune Claimed' : 'Romantic Surprise') + '</div>' +
            '<div class="rw-sc-coins">+' + (scratchResult?.coins || '15–100') + ' Gold Coins 🪙</div>' +
            '<div class="rw-sc-msg">' + (scratchResult?.message || 'Scratch the card to reveal your lucky prize!') + '</div>' +
          '</div>' +
          '<canvas id="rwScratchCanvas" width="280" height="150" class="rw-scratch-canvas" style="' + scratchCoverStyle + '"></canvas>' +
        '</div>' +
        '<div class="rw-scratch-actions">' +
          scratchRevealBtn +
          '<div class="rw-note">' + (sum.scratchedToday ? 'You claimed your daily card. Next card tomorrow!' : 'Scratch the gold card above or tap Reveal Prize.') + '</div>' +
        '</div>' +
      '</div>' +

      // 4. Couple Streak
      '<div class="rw-card"><h3>Couple streak</h3><div class="rw-couple">' + FLAME +
        '<div><div class="rw-couple-n">' + sum.coupleStreak + '</div><div class="rw-couple-l">days you both checked in</div></div>' +
        '<div class="rw-pills"><span class="rw-pill' + (sum.checkedInToday ? ' is-on' : '') + '">You ' + (sum.checkedInToday ? '✓' : '·') + '</span>' +
        '<span class="rw-pill' + (sum.partnerCheckedInToday ? ' is-on' : '') + '">' + partner + ' ' + (sum.partnerCheckedInToday ? '✓' : '·') + '</span></div></div>' +
        '<div class="rw-note" style="margin-top:10px">' + coupleMsg + '</div></div>' +

      // 5. Coin History
      '<div class="rw-card"><h3>Coin history</h3>' + history + '</div></div>';

    // Initialize the canvas elements after DOM render
    requestAnimationFrame(() => {
      const wCanvas = $('rwWheelCanvas');
      if (wCanvas && sum?.wheelSlices) drawWheel(wCanvas, sum.wheelSlices, wheelAngle);

      const sCanvas = $('rwScratchCanvas');
      if (sCanvas && !sum?.scratchedToday) initScratchCanvas(sCanvas);
    });
  }

  function render() { renderStrip(); renderPage(); }

  /* ── wiring ── */
  function wire() {
    document.addEventListener('click', e => {
      if (e.target.closest('#rewardsPageContent [data-rw-claim]')) claim();
      else if (e.target.closest('#rewardsPageContent [data-rw-retry]')) { failed = false; renderPage(); load(true); }
    });
    // After the app's goto(): refresh when Home or Rewards opens.
    const orig = window.goto;
    if (typeof orig === 'function' && !orig.__rw) {
      const wrapped = function (page) {
        const r = orig.apply(this, arguments);
        if (page === 'rewards') { renderPage(); load(true); }
        else if (page === 'dashboard') { ensureStrip(); load(false); }
        return r;
      };
      wrapped.__rw = true; window.goto = wrapped;
    }
    // Coming back to the tab: refresh once (no timers, no polling).
    document.addEventListener('visibilitychange', () => { if (!document.hidden && ids()) load(isPageOpen()); });
  }

  function start() {
    wire(); renderStrip();
    let tries = 0;
    const wait = setInterval(() => {
      if (ids()) { clearInterval(wait); load(false); } else if (++tries > 40) clearInterval(wait);
    }, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  return { load, claim, render, loadGifts, sendGift, spin, scratch, revealScratch };
})();
window.Rewards = Rewards;
