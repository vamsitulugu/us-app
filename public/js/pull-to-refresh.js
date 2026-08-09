/*
 * pull-to-refresh.js
 * ─────────────────────────────────────────────────────────────
 * A dependency-free, Instagram-style pull-to-refresh controller.
 * Works both in the top-level SPA shell (attached to `.content`)
 * and inside individual same-origin iframe pages (attached to
 * whatever that page's own scroll container is) — same pattern
 * as scroll-reset.js, which this file is designed to sit next to.
 *
 * Usage:
 *   const handle = PullToRefresh.attach(containerEl, onRefresh, {
 *     canActivate: () => true,   // optional runtime gate, checked on every gesture start
 *     threshold: 70,             // px of pull required to trigger on release
 *     maxPull: 120               // px of visual travel at full rubber-band resistance
 *   });
 *   handle.destroy();            // removes all listeners + the indicator DOM
 *
 * onRefresh may return a Promise; the indicator stays in its
 * loading state until it resolves/rejects, and a new gesture is
 * ignored while one is in flight (per-instance, so multiple
 * containers on the same page — e.g. the shell + chat — don't
 * block each other).
 *
 * Design notes:
 *   - Only touch/pen pointer input is handled; mouse-driven pulls
 *     are ignored entirely so desktop pointer/drag/click behavior
 *     is completely unaffected.
 *   - The gesture only arms when the container's scrollTop is
 *     already 0 at touchstart, and only commits to "pulling" once
 *     the drag is confirmed vertical-downward past a small
 *     deadzone — until that point touchmove is never
 *     preventDefault()'d, so normal scrolling, horizontal swipes,
 *     and any other gesture handling on the page is untouched.
 *   - Uses CSS transforms + a WAAPI-free class-based fade, so it
 *     has no external CSS dependency and can't fight the host
 *     page's stylesheet cascade — all indicator styling is inline.
 */
(function (global) {
  'use strict';

  var DEADZONE = 8;         // px of vertical travel before we decide this is a pull, not a tap/scroll
  var HORIZONTAL_GUARD = 1.2; // if |dx| > |dy| * this, treat as a horizontal swipe and back off

  function makeIndicator() {
    var wrap = document.createElement('div');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.style.cssText = [
      'position:absolute', 'left:0', 'right:0', 'top:0',
      'display:flex', 'align-items:center', 'justify-content:center',
      'height:0', 'overflow:visible', 'pointer-events:none',
      'z-index:60', 'transition:none'
    ].join(';');

    var puck = document.createElement('div');
    puck.style.cssText = [
      'width:34px', 'height:34px', 'border-radius:50%',
      'background:var(--card,#fff)', 'box-shadow:0 2px 10px rgba(0,0,0,.18)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'transform:translateY(-40px) scale(.7)', 'opacity:0',
      'transition:opacity .18s ease'
    ].join(';');

    puck.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" ' +
      'style="transform:rotate(0deg)">' +
      '<circle cx="12" cy="12" r="9" stroke="var(--border,#e2e2e6)" stroke-width="2.5"/>' +
      '<path d="M12 3a9 9 0 0 1 9 9" stroke="var(--brand,#ED2A3A)" stroke-width="2.5" stroke-linecap="round"/>' +
      '</svg>';

    wrap.appendChild(puck);
    return { wrap: wrap, puck: puck, arc: puck.querySelector('svg') };
  }

  function PullToRefresh(container, onRefresh, opts) {
    opts = opts || {};
    this.container = container;
    this.onRefresh = onRefresh;
    this.canActivate = typeof opts.canActivate === 'function' ? opts.canActivate : function () { return true; };
    this.threshold = opts.threshold || 70;
    this.maxPull = opts.maxPull || 120;

    this._active = false;      // a touch is down and we've committed to a pull
    this._deciding = false;    // a touch is down, still inside the deadzone
    this._refreshing = false;  // an onRefresh() call is in flight
    this._startY = 0;
    this._startX = 0;
    this._dist = 0;
    this._touchId = null;

    var pos = getComputedStyle(container).position;
    if (pos === 'static') container.style.position = 'relative';

    var ind = makeIndicator();
    this._indWrap = ind.wrap;
    this._indPuck = ind.puck;
    this._indArc = ind.arc;
    container.insertBefore(this._indWrap, container.firstChild);

    this._onStart = this._onStart.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onEnd = this._onEnd.bind(this);

    container.addEventListener('touchstart', this._onStart, { passive: true });
    container.addEventListener('touchmove', this._onMove, { passive: false });
    container.addEventListener('touchend', this._onEnd, { passive: true });
    container.addEventListener('touchcancel', this._onEnd, { passive: true });
  }

  PullToRefresh.prototype._onStart = function (e) {
    if (this._refreshing) return;
    if (!this.canActivate()) return;
    if (this.container.scrollTop > 0) return;
    var t = e.touches[0];
    this._touchId = t.identifier;
    this._startY = t.clientY;
    this._startX = t.clientX;
    this._dist = 0;
    this._deciding = true;
    this._active = false;
  };

  PullToRefresh.prototype._onMove = function (e) {
    if (!this._deciding && !this._active) return;
    var t = null;
    for (var i = 0; i < e.touches.length; i++) {
      if (e.touches[i].identifier === this._touchId) { t = e.touches[i]; break; }
    }
    if (!t) return;

    var dy = t.clientY - this._startY;
    var dx = t.clientX - this._startX;

    if (this._deciding) {
      if (Math.abs(dy) < DEADZONE && Math.abs(dx) < DEADZONE) return;
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy) * HORIZONTAL_GUARD || this.container.scrollTop > 0) {
        // Not a downward pull-at-top gesture (upward scroll, horizontal
        // swipe, or the container already scrolled during the deadzone)
        // — release control back to normal scrolling entirely.
        this._deciding = false;
        return;
      }
      this._deciding = false;
      this._active = true;
    }

    if (!this._active) return;

    // Rubber-band resistance past the container's scrollTop staying 0.
    if (this.container.scrollTop > 0) { this._cancel(); return; }

    var raw = Math.max(0, dy);
    var resisted = raw < this.maxPull ? raw * 0.55 : this.maxPull * 0.55 + (raw - this.maxPull) * 0.08;
    this._dist = Math.min(resisted, this.maxPull);

    e.preventDefault(); // now safe: we've confirmed this is our gesture, not a scroll/swipe

    var progress = Math.min(1, this._dist / this.threshold);
    this._indWrap.style.height = '0px';
    this._indPuck.style.transform = 'translateY(' + (this._dist - 6) + 'px) scale(' + (0.7 + 0.3 * progress) + ')';
    this._indPuck.style.opacity = String(Math.min(1, progress * 1.2));
    this._indArc.style.transform = 'rotate(' + (progress * 300) + 'deg)';
  };

  PullToRefresh.prototype._onEnd = function () {
    if (!this._active) { this._deciding = false; this._active = false; return; }
    this._active = false;
    var triggered = this._dist >= this.threshold;
    if (triggered) {
      this._runRefresh();
    } else {
      this._settle(0, true);
    }
  };

  PullToRefresh.prototype._cancel = function () {
    this._deciding = false;
    if (this._active) { this._active = false; this._settle(0, true); }
  };

  PullToRefresh.prototype._settle = function (toY, fade) {
    var self = this;
    this._indPuck.style.transition = 'transform .25s cubic-bezier(.22,1,.36,1), opacity .25s ease';
    this._indPuck.style.transform = 'translateY(' + (toY - 40) + 'px) scale(.7)';
    if (fade) this._indPuck.style.opacity = '0';
    setTimeout(function () { self._indPuck.style.transition = ''; }, 260);
  };

  PullToRefresh.prototype._runRefresh = function () {
    var self = this;
    this._refreshing = true;

    // Lock the indicator into a centered spinning "loading" state.
    this._indPuck.style.transition = 'transform .18s ease';
    this._indPuck.style.transform = 'translateY(' + (this.threshold - 6) + 'px) scale(1)';
    this._indPuck.style.opacity = '1';
    this._indArc.style.animation = 'ptr-spin .8s linear infinite';
    ensureSpinKeyframes();

    var result;
    try {
      result = this.onRefresh ? this.onRefresh() : null;
    } catch (err) {
      result = Promise.reject(err);
    }
    Promise.resolve(result).then(
      function () { self._finishRefresh(true); },
      function (err) { console.warn('[pull-to-refresh] refresh failed', err); self._finishRefresh(false); }
    );
  };

  PullToRefresh.prototype._finishRefresh = function (ok) {
    var self = this;
    this._indArc.style.animation = '';
    // Brief success/settle beat so the release doesn't feel abrupt,
    // then collapse the indicator back off-screen.
    this._indArc.style.transform = 'rotate(360deg)';
    setTimeout(function () {
      self._refreshing = false;
      self._settle(0, true);
    }, ok ? 150 : 250);
  };

  PullToRefresh.prototype.destroy = function () {
    this.container.removeEventListener('touchstart', this._onStart);
    this.container.removeEventListener('touchmove', this._onMove);
    this.container.removeEventListener('touchend', this._onEnd);
    this.container.removeEventListener('touchcancel', this._onEnd);
    if (this._indWrap && this._indWrap.parentNode) this._indWrap.parentNode.removeChild(this._indWrap);
  };

  var _kfInjected = false;
  function ensureSpinKeyframes() {
    if (_kfInjected) return;
    _kfInjected = true;
    var style = document.createElement('style');
    style.textContent = '@keyframes ptr-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';
    document.head.appendChild(style);
  }

  global.PullToRefresh = {
    attach: function (container, onRefresh, opts) {
      if (!container) return { destroy: function () {} };
      return new PullToRefresh(container, onRefresh, opts);
    }
  };
})(window);
