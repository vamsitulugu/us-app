/* ═══════════════════════════════════════════════════════════════
   PREMIUM MOTION — JS trigger library
   Include AFTER premium-motion.css and AFTER your main app script.
   Exposes window.PM.* — call these instead of spawnPetals()/emoji fx.
═══════════════════════════════════════════════════════════════ */
(function () {
  const PM = {};

  // ── Utility: fire a bloom centered on an element (or click point) ──
  function bloomOn(el, evt) {
    if (!el) return;
    el.classList.add('pm-glass-surface');
    let bloom = el.querySelector(':scope > .pm-bloom');
    if (!bloom) {
      bloom = document.createElement('div');
      bloom.className = 'pm-bloom';
      el.appendChild(bloom);
    }
    const rect = el.getBoundingClientRect();
    let x = 50, y = 50;
    if (evt && evt.clientX != null) {
      x = ((evt.clientX - rect.left) / rect.width) * 100;
      y = ((evt.clientY - rect.top) / rect.height) * 100;
    }
    bloom.style.setProperty('--pm-bx', x + '%');
    bloom.style.setProperty('--pm-by', y + '%');
    bloom.classList.remove('pm-play'); void bloom.offsetWidth;
    bloom.classList.add('pm-play');
  }

  // ── Utility: sweep a light reflection across an element ──
  function sweepOn(el) {
    if (!el) return;
    el.classList.add('pm-glass-surface');
    el.classList.remove('pm-sweep'); void el.offsetWidth;
    el.classList.add('pm-sweep');
    setTimeout(() => el.classList.remove('pm-sweep'), 700);
  }

  // ── Utility: ripple ring at a point (page coords) ──
  function rippleAt(x, y, container = document.body) {
    const ring = document.createElement('div');
    ring.className = 'pm-ripple-ring pm-play';
    ring.style.left = x + 'px';
    ring.style.top = y + 'px';
    ring.style.width = '10px';
    ring.style.height = '10px';
    container.appendChild(ring);
    setTimeout(() => ring.remove(), 420);
  }

  // ═══ 1. PARTNER JOINED ═══
  PM.partnerJoined = function () {
    let el = document.getElementById('pmPartnerJoined');
    if (!el) {
      el = document.createElement('div');
      el.id = 'pmPartnerJoined';
      el.className = 'pm-partner-joined';
      el.innerHTML = '<div class="pm-pj-orb pm-pj-left"></div><div class="pm-pj-orb pm-pj-right"></div>';
      document.body.appendChild(el);
    }
    el.classList.remove('pm-active'); void el.offsetWidth;
    el.classList.add('pm-active');
    setTimeout(() => rippleAt(window.innerWidth / 2, window.innerHeight / 2), 950);
    setTimeout(() => el.classList.remove('pm-active'), 1900);
  };

  // ═══ 2. HUG ═══
  PM.hug = function (buttonEl) {
    if (buttonEl) { sweepOn(buttonEl); bloomOn(buttonEl); }
  };

  // ═══ 3. TOUCH ═══
  PM.touch = function (buttonEl, evt) {
    if (!buttonEl) return;
    const rect = buttonEl.getBoundingClientRect();
    rippleAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
    bloomOn(buttonEl, evt);
  };

  // ═══ 4. MESSAGE SENT ═══
  PM.messageSent = function (bubbleEl) {
    if (!bubbleEl) return;
    bubbleEl.style.willChange = 'transform, opacity';
    bubbleEl.animate(
      [
        { transform: 'translateY(6px)', opacity: 0, filter: 'blur(2px)' },
        { transform: 'translateY(0)', opacity: 1, filter: 'blur(0)' }
      ],
      { duration: 260, easing: 'cubic-bezier(.22,.61,.36,1)' }
    );
    sweepOn(bubbleEl);
  };

  // ═══ 5. MEMORY ADDED ═══
  PM.memoryAdded = function (cardEl) {
    if (!cardEl) return;
    cardEl.classList.add('pm-card-added');
    sweepOn(cardEl);
    setTimeout(() => cardEl.classList.remove('pm-card-added'), 500);
  };

  // ═══ 6. EVENT ADDED ═══
  PM.eventAdded = function (cardEl) {
    if (!cardEl) return;
    cardEl.animate(
      [
        { transform: 'translateY(14px)', opacity: 0 },
        { transform: 'translateY(0)', opacity: 1 }
      ],
      { duration: 320, easing: 'cubic-bezier(.22,.61,.36,1)' }
    );
    bloomOn(cardEl);
  };

  // ═══ 7. GIFT OPENED ═══
  PM.giftOpened = function (boxEl) {
    if (!boxEl) return;
    boxEl.classList.add('pm-gift-box');
    let glow = boxEl.querySelector(':scope > .pm-gift-glow');
    if (!glow) {
      glow = document.createElement('div');
      glow.className = 'pm-gift-glow';
      boxEl.style.position = boxEl.style.position || 'relative';
      boxEl.appendChild(glow);
    }
    boxEl.classList.remove('pm-open'); void boxEl.offsetWidth;
    boxEl.classList.add('pm-open');
    sweepOn(boxEl);
    setTimeout(() => boxEl.classList.remove('pm-open'), 650);
  };

  // ═══ 8. CALL CONNECTED / ENDED ═══
  PM.callConnected = function () {
    let line = document.getElementById('pmCallLine');
    if (line) { line.classList.remove('pm-ending'); line.classList.add('pm-active'); }
  };
  PM.callEnded = function () {
    let line = document.getElementById('pmCallLine');
    if (line) {
      line.classList.remove('pm-active');
      line.classList.add('pm-ending');
      setTimeout(() => line.classList.remove('pm-ending'), 1100);
    }
  };

  // ═══ 9. RELATIONSHIP CONNECTED ═══
  PM.relationshipConnected = function (containerEl) {
    const target = containerEl || document.body;
    const el = document.createElement('div');
    el.className = 'pm-rings';
    el.style.cssText = 'position:relative;height:60px;';
    el.innerHTML = '<div class="pm-ring pm-ring-a"></div><div class="pm-ring pm-ring-b"></div>';
    target.appendChild(el);
    setTimeout(() => {
      const rect = el.getBoundingClientRect();
      rippleAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }, 850);
    setTimeout(() => el.remove(), 1600);
  };

  // ═══ 10. ACHIEVEMENT ═══
  PM.achievement = function () {
    let ring = document.getElementById('pmAchieveRing');
    if (!ring) {
      ring = document.createElement('div');
      ring.id = 'pmAchieveRing';
      ring.className = 'pm-achieve-ring';
      document.body.appendChild(ring);
    }
    ring.classList.remove('pm-play'); void ring.offsetWidth;
    ring.classList.add('pm-play');
  };

  // ═══ 11. SYNC COMPLETE ═══
  PM.syncComplete = function (anchorEl) {
    let ring = document.getElementById('pmSyncRing');
    if (!ring) {
      ring = document.createElement('span');
      ring.id = 'pmSyncRing';
      ring.className = 'pm-sync-ring';
      (anchorEl || document.body).appendChild(ring);
    }
    ring.classList.remove('pm-play'); void ring.offsetWidth;
    ring.classList.add('pm-play');
  };

  // ═══ 12. CARD OPEN (generic) ═══
  PM.cardOpen = function (cardEl) {
    if (!cardEl) return;
    bloomOn(cardEl);
    sweepOn(cardEl);
  };

  // ═══ 13. BUTTON PRESS (generic — attach on click) ═══
  PM.buttonPress = function (btnEl, evt) {
    if (!btnEl) return;
    bloomOn(btnEl, evt);
  };

  window.PM = PM;

  // ─────────────────────────────────────────────────────────
  // AUTO-WIRE: replace the emoji-particle celebration globally.
  // Your app calls spawnPetals(n) in ~15 places. We override it
  // here so every existing call site gets the new light language
  // for free — no need to touch each call site individually.
  // ─────────────────────────────────────────────────────────
  window.spawnPetals = function (n) {
    // Fire a soft achievement ring instead of flying emoji.
    PM.achievement();
  };

  // Wire the touch ripple element that already exists in your DOM
  // (#touchRipple with an emoji span) to the new bloom/ripple system.
  document.addEventListener('DOMContentLoaded', function () {
    const oldRipple = document.getElementById('touchRipple');
    if (oldRipple) oldRipple.style.display = 'none'; // retire emoji ripple

    // Give every button-like element a bloom-on-press for free — native
    // <button> elements (the vast majority of tap targets across every
    // page in this app) plus the known div-based tap targets (tabs,
    // chips, pills) that don't use a real <button> tag.
    document.body.addEventListener('pointerdown', function (e) {
      const target = e.target.closest(
        'button, .btn, .ic-btn, .connect-action-btn, .cc-btn, ' +
        '[class*="-tab"]:not([class*="-tabs"]), ' +
        '[class*="-chip"]:not([class*="-chips"]), ' +
        '[class*="-pill"]:not([class*="-pills"])'
      );
      if (target) PM.buttonPress(target, e);
    }, { passive: true });

    // ── CARD LONG-PRESS ──────────────────────────────────────
    // Delegated globally so every .card / *-card element on every
    // page gets long-press feedback automatically, no per-page wiring.
    let lpTimer = null, lpEl = null;
    const LP_DELAY = 420;
    function lpStart(e) {
      const card = e.target.closest('.card, [class*="-card"]');
      if (!card) return;
      lpEl = card;
      lpTimer = setTimeout(function () { lpEl && lpEl.classList.add('pm-longpress'); }, LP_DELAY);
    }
    function lpEnd() {
      clearTimeout(lpTimer);
      if (lpEl) lpEl.classList.remove('pm-longpress');
      lpEl = null;
    }
    document.body.addEventListener('pointerdown', lpStart, { passive: true });
    document.body.addEventListener('pointerup', lpEnd, { passive: true });
    document.body.addEventListener('pointercancel', lpEnd, { passive: true });
    document.body.addEventListener('pointermove', function (e) {
      // Cancel if the finger drifts (scrolling), so long-press doesn't
      // fire mid-scroll.
      if (lpEl) {
        const r = lpEl.getBoundingClientRect();
        if (e.clientX < r.left - 10 || e.clientX > r.right + 10 ||
            e.clientY < r.top - 10 || e.clientY > r.bottom + 10) lpEnd();
      }
    }, { passive: true });
  });
})();