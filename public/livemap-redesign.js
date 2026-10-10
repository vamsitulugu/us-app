/* public/livemap-redesign.js
   ────────────────────────────────────────────────────────────────
   Live Map — video-call split view only. Loaded AFTER livemap.js and
   chat/call.js. (The page layout itself lives in livemap-screens.js /
   livemap-screens.css; the old restructure / nearby-search code that
   used to live here has been removed.)
   While a call is active on the map page this docks the call UI
   beside the map as a resizable split-screen panel.
   ──────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

    /* ════════════════════════════════════════════════════════════════
     VIDEO CALL SPLIT VIEW — while a call is active on the Live Map
        page, dock the call alongside the map (instead of the normal
        fullscreen call UI) so the map stays fully usable:
          • mobile / narrow:  map on top,  call on bottom
          • desktop / wide:   map on left, call on right
        A draggable divider resizes both panes. Ending the call tears
        the dock down and returns to the normal Live Map layout with
        no reload. This ONLY happens while #page-map is the active
        page — the normal chat page's call UI is completely untouched
        (it never gets docked, since onMapPage() is false there).
     ════════════════════════════════════════════════════════════════ */
  function onMapPage() { return $('page-map')?.classList.contains('active'); }

  let dockEl = null, mapWrapSlot = null, mapWrapEl = null, dockedOverlay = null;
  let dockMQ = window.matchMedia('(min-width:701px)');

  function invalidateMap() {
    const st = window.LiveMap?._debug;
    if (st?.map?.invalidateSize) requestAnimationFrame(() => st.map.invalidateSize());
  }

  function updateDockOrientation() {
    if (!dockEl) return;
    dockEl.classList.toggle('lm2-dock-row', dockMQ.matches);
    invalidateMap();
  }

  function buildDock() {
    const page = $('page-map');
    mapWrapEl = page?.querySelector('.lm2-map-wrap');
    if (!page || !mapWrapEl) return null;

    // Leave a placeholder in the map wrap's original spot so we can
    // put it back exactly where it was once the call ends.
    mapWrapSlot = document.createComment('lm2-map-wrap-slot');
    mapWrapEl.parentNode.insertBefore(mapWrapSlot, mapWrapEl);

    const dock = document.createElement('div');
    dock.className = 'lm2-call-dock';
    dock.id = 'lm2CallDock';
    dock.innerHTML = `
      <div class="lm2-dock-pane lm2-dock-map" id="lm2DockMap"></div>
      <div class="lm2-dock-resizer" id="lm2DockResizer"></div>
      <div class="lm2-dock-pane lm2-dock-call" id="lm2DockCall"></div>`;
    mapWrapSlot.parentNode.insertBefore(dock, mapWrapSlot);
    dock.querySelector('#lm2DockMap').appendChild(mapWrapEl);

    wireResizer(dock, dock.querySelector('#lm2DockResizer'));
    dockMQ.addEventListener ? dockMQ.addEventListener('change', updateDockOrientation) : dockMQ.addListener(updateDockOrientation);
    updateDockOrientation();
    return dock;
  }

  function wireResizer(dock, handle) {
    let dragging = false;
    const setRatio = (clientX, clientY) => {
      const rect = dock.getBoundingClientRect();
      const row = dockMQ.matches;
      const raw = row ? (clientX - rect.left) / rect.width : (clientY - rect.top) / rect.height;
      // Issue 2 fix: in column layout (mobile) the call pane sits below
      // the map and holds the mute/speaker/end-call bar. Cap how far the
      // map side can be dragged so the call pane never shrinks under the
      // ~150px floor its controls need (matches .lm2-dock-call min-height).
      const maxRatio = row ? 0.82 : Math.min(0.82, 1 - (150 / rect.height));
      const ratio = Math.min(maxRatio, Math.max(0.18, raw));
      dock.style.setProperty('--lm2-split-ratio', ratio.toFixed(4));
      invalidateMap();
    };
    handle.addEventListener('pointerdown', e => { dragging = true; handle.setPointerCapture(e.pointerId); e.preventDefault(); });
    handle.addEventListener('pointermove', e => { if (dragging) setRatio(e.clientX, e.clientY); });
    handle.addEventListener('pointerup', () => { dragging = false; });
    handle.addEventListener('pointercancel', () => { dragging = false; });
  }

  function dockCall(overlay) {
    if (!overlay || dockedOverlay === overlay) return;
    if (!dockEl) dockEl = buildDock();
    if (!dockEl) return;
    const callPane = $('lm2DockCall');
    callPane.appendChild(overlay);
    overlay.classList.add('lm2-docked', 'open');
    dockedOverlay = overlay;
    invalidateMap();
  }

  function teardownDock() {
    if (mapWrapEl && mapWrapSlot && mapWrapSlot.parentNode) {
      mapWrapSlot.parentNode.insertBefore(mapWrapEl, mapWrapSlot);
      mapWrapSlot.remove();
    }
    if (dockEl) dockEl.remove();
    dockMQ.removeEventListener ? dockMQ.removeEventListener('change', updateDockOrientation) : dockMQ.removeListener(updateDockOrientation);
    dockEl = null; mapWrapSlot = null; mapWrapEl = null; dockedOverlay = null;
    invalidateMap();
  }

  const callObserver = new MutationObserver(() => {
    const overlay = $('callOverlay');
    if (overlay && overlay.classList.contains('open')) {
      if (onMapPage()) dockCall(overlay);
      else if (dockedOverlay) teardownDock(); // navigated away from map mid-call: let the normal fullscreen call UI take over
    } else if (!overlay && dockedOverlay) {
      teardownDock(); // call ended — back to the normal Live Map page, no reload
    }
  });
  callObserver.observe(document.body, { childList: true, subtree: true });
})();
