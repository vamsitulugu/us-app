/* ============================================================
   GalleryEngine — one shared engine for every "swipe through
   related photos" surface in the app (chat media, Memories,
   albums, etc).

   Responsibilities (per the app's gallery spec):
     open(collection, index) / previous() / next() / swipe /
     zoom / pan / reset / close

   Design notes:
   - Renders exactly 3 layers at a time: prev / current / next.
     Only current + the two touching neighbors are ever loaded
     (see preload()), never the whole collection.
   - Navigation is a translateX() on a GPU-accelerated track that
     either follows the finger 1:1 while dragging, or animates
     with a 180-280ms transition on release. There is no
     "swap src instantly" step anywhere in this file — this is
     what removes the flash/white-frame/layout-jump the app
     currently gets from index.html's memViewerRender().
   - Zoom/pan lives on a *separate* inner transform (the "stage
     content" div) that is layered per-slide, not on the track
     and not on any ancestor of the close button. Callers that
     render their own close button (Memories keeps its own top
     bar) are safe by construction: the engine never touches
     anything above the stage element it's given.
   - When zoom > 1 for the active slide, horizontal drags pan
     that slide instead of changing the transform of the track,
     so panning can never accidentally flip to the next photo.
   ============================================================ */
(function (global) {
  'use strict';

  const SWIPE_MS = 220;              // within the requested 180-280ms window
  const SWIPE_COMPLETE_DIST = 0.28;  // fraction of stage width
  const SWIPE_COMPLETE_VELOCITY = 0.55; // px/ms
  const MAX_ZOOM = 4;
  const MIN_ZOOM = 1;
  const DOUBLE_TAP_MS = 280;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  class GalleryEngine {
    /**
     * @param {HTMLElement} stageEl - container the engine renders into.
     *   Must be position:relative/fixed with overflow:hidden. The engine
     *   only ever writes inside this element — it never reaches outside
     *   it, so a caller's own fixed UI (close button, counter, action
     *   bar) placed as a *sibling* of stageEl is guaranteed unaffected
     *   by any zoom/pan/swipe transform this engine applies.
     * @param {Object} opts
     *   onIndexChange(index, item)
     *   onZoomChange(zoomed:boolean)
     *   renderItem(item) -> HTMLElement (img/video), engine sizes it
     */
    constructor(stageEl, opts) {
      this.stage = stageEl;
      this.opts = opts || {};
      this.items = [];
      this.index = -1;
      this.slides = new Map(); // index -> slide record
      this.track = document.createElement('div');
      this.track.className = 'gve-track';
      this.stage.appendChild(this.track);
      this._bind();
    }

    open(items, index) {
      this.items = items || [];
      this.index = clamp(index || 0, 0, Math.max(0, this.items.length - 1));
      this._rebuild();
    }

    close() {
      this.track.innerHTML = '';
      this.slides.clear();
      this.items = [];
      this.index = -1;
    }

    current() { return this.items[this.index] || null; }

    previous() { this._goTo(this.index - 1); }
    next() { this._goTo(this.index + 1); }

    reset() {
      // Reset zoom/pan of the *current* slide only.
      const s = this.slides.get(this.index);
      if (s) this._setZoom(s, 1, 0, 0, false);
    }

    _goTo(newIndex, animateMs) {
      if (newIndex < 0 || newIndex >= this.items.length) { this._snapBack(); return; }
      const prevIndex = this.index;
      this.index = newIndex;
      this._render();
      this._animateTrackTo(0, animateMs != null ? animateMs : SWIPE_MS);
      if (prevIndex !== newIndex) {
        const prevSlide = this.slides.get(prevIndex);
        if (prevSlide) this._setZoom(prevSlide, 1, 0, 0, false); // reset zoom on the photo we left
        if (this.opts.onIndexChange) this.opts.onIndexChange(this.index, this.current());
      }
    }

    // ---- rendering ----
    _rebuild() {
      this.track.innerHTML = '';
      this.slides.clear();
      this._render();
      this._setTrackX(0, false);
      if (this.opts.onIndexChange) this.opts.onIndexChange(this.index, this.current());
    }

    _makeSlide(i) {
      if (i < 0 || i >= this.items.length) return null;
      if (this.slides.has(i)) return this.slides.get(i);
      const item = this.items[i];
      const wrap = document.createElement('div');
      wrap.className = 'gve-slide';
      const content = document.createElement('div');
      content.className = 'gve-content';
      wrap.appendChild(content);
      const el = this.opts.renderItem(item);
      content.appendChild(el);
      const rec = { i, wrap, content, el, zoom: 1, panX: 0, panY: 0 };
      this._bindZoomPan(rec);
      this.slides.set(i, rec);
      return rec;
    }

    // Only current + immediate neighbors ever exist in the DOM /
    // get their media requested — this is the preload contract.
    _render() {
      const keep = new Set([this.index - 1, this.index, this.index + 1]);
      for (const [i, rec] of Array.from(this.slides.entries())) {
        if (!keep.has(i)) { rec.wrap.remove(); this.slides.delete(i); }
      }
      this.track.innerHTML = '';
      [this.index - 1, this.index, this.index + 1].forEach((i) => {
        const rec = this._makeSlide(i);
        if (!rec) return;
        rec.wrap.style.transform = `translate3d(${(i - this.index) * 100}%,0,0)`;
        this.track.appendChild(rec.wrap);
      });
    }

    // ---- track drag (swipe between photos) ----
    _bind() {
      let dragging = false, startX = 0, startY = 0, lastX = 0, lastT = 0, velocity = 0, axisLocked = null;

      const isZoomed = () => {
        const s = this.slides.get(this.index);
        return s && s.zoom > 1.01;
      };

      const onDown = (x, y) => {
        if (isZoomed()) return; // let _bindZoomPan handle panning instead
        dragging = true; axisLocked = null;
        startX = lastX = x; startY = y; lastT = performance.now(); velocity = 0;
        this.track.style.transition = 'none';
      };
      const onMove = (x, y) => {
        if (!dragging) return;
        const dx = x - startX, dy = y - startY;
        if (axisLocked === null && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
          axisLocked = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
        }
        if (axisLocked !== 'x') return; // vertical drag: ignore, let it fall through (e.g. tap-to-toggle chrome)
        const now = performance.now();
        const dt = Math.max(1, now - lastT);
        velocity = (x - lastX) / dt;
        lastX = x; lastT = now;
        const pct = (dx / this.stage.clientWidth) * 100;
        this._setTrackX(pct, false);
      };
      const onUp = () => {
        if (!dragging) return;
        dragging = false;
        if (axisLocked !== 'x') { this._snapBack(); return; }
        const dx = lastX - startX;
        const frac = Math.abs(dx) / this.stage.clientWidth;
        const goingNext = dx < 0;
        if (frac > SWIPE_COMPLETE_DIST || Math.abs(velocity) > SWIPE_COMPLETE_VELOCITY) {
          goingNext ? this.next() : this.previous();
        } else {
          this._snapBack();
        }
      };

      this.stage.addEventListener('pointerdown', (e) => { if (e.target.closest('.gve-no-drag')) return; onDown(e.clientX, e.clientY); this.stage.setPointerCapture?.(e.pointerId); });
      this.stage.addEventListener('pointermove', (e) => onMove(e.clientX, e.clientY));
      this.stage.addEventListener('pointerup', onUp);
      this.stage.addEventListener('pointercancel', onUp);

      // Keyboard (desktop) — only the visible/open viewer instance
      // should react, since a page can have more than one GalleryEngine
      // (e.g. chat media viewer + Memories viewer) mounted at once.
      this._keyHandler = (e) => {
        if (!this.stage.offsetParent) return; // stage (or an ancestor) is display:none -> not the active viewer
        if (e.key === 'ArrowLeft') this.previous();
        else if (e.key === 'ArrowRight') this.next();
        else if (e.key === 'Escape' && this.opts.onEscape) this.opts.onEscape();
      };
      document.addEventListener('keydown', this._keyHandler);
    }

    _setTrackX(pct, animate) {
      this.track.style.transition = animate ? `transform ${SWIPE_MS}ms cubic-bezier(.22,.61,.36,1)` : 'none';
      this.track.style.transform = `translate3d(${pct}%,0,0)`;
    }
    _animateTrackTo(pct, ms) {
      this.track.style.transition = `transform ${ms}ms cubic-bezier(.22,.61,.36,1)`;
      this.track.style.transform = `translate3d(${pct}%,0,0)`;
    }
    _snapBack() { this._animateTrackTo(0, SWIPE_MS); }

    // ---- per-slide pinch/double-tap zoom + pan ----
    _bindZoomPan(rec) {
      const content = rec.content;
      let panning = false, sx = 0, sy = 0, startPanX = 0, startPanY = 0;
      let pinchStartDist = 0, pinchStartZoom = 1;
      let lastTapT = 0;

      const apply = () => {
        content.style.transform = `translate3d(${rec.panX}px,${rec.panY}px,0) scale(${rec.zoom})`;
      };

      content.addEventListener('pointerdown', (e) => {
        if (rec.zoom <= 1.01) return; // not zoomed: let the track handle swipe
        panning = true; sx = e.clientX; sy = e.clientY;
        startPanX = rec.panX; startPanY = rec.panY;
        e.stopPropagation();
      });
      content.addEventListener('pointermove', (e) => {
        if (!panning) return;
        rec.panX = startPanX + (e.clientX - sx);
        rec.panY = startPanY + (e.clientY - sy);
        apply();
        e.stopPropagation();
      });
      const endPan = (e) => { if (panning) { panning = false; e && e.stopPropagation(); } };
      content.addEventListener('pointerup', endPan);
      content.addEventListener('pointercancel', endPan);

      // Double-tap to toggle zoom
      content.addEventListener('pointerup', (e) => {
        const now = performance.now();
        if (now - lastTapT < DOUBLE_TAP_MS) {
          if (rec.zoom > 1.01) this._setZoom(rec, 1, 0, 0, true);
          else this._setZoom(rec, 2.5, 0, 0, true);
        }
        lastTapT = now;
      });

      // Pinch (two-finger) zoom via touch events — pointer events don't
      // give us multi-touch deltas directly.
      content.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
          pinchStartDist = dist(e.touches[0], e.touches[1]);
          pinchStartZoom = rec.zoom;
        }
      }, { passive: true });
      content.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2) {
          const d = dist(e.touches[0], e.touches[1]);
          const z = clamp(pinchStartZoom * (d / pinchStartDist), MIN_ZOOM, MAX_ZOOM);
          this._setZoom(rec, z, rec.panX, rec.panY, false);
          e.preventDefault();
        }
      }, { passive: false });

      function dist(a, b) { return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }

      rec._applyZoom = apply;
    }

    _setZoom(rec, zoom, panX, panY, animate) {
      rec.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
      rec.panX = rec.zoom <= 1.01 ? 0 : panX;
      rec.panY = rec.zoom <= 1.01 ? 0 : panY;
      rec.content.style.transition = animate ? 'transform 200ms ease' : 'none';
      rec.content.style.transform = `translate3d(${rec.panX}px,${rec.panY}px,0) scale(${rec.zoom})`;
      if (this.opts.onZoomChange) this.opts.onZoomChange(rec.zoom > 1.01);
    }

    destroy() {
      document.removeEventListener('keydown', this._keyHandler);
      this.close();
    }
  }

  global.GalleryEngine = GalleryEngine;
})(window);
