/*
 * scroll-reset.js
 * ─────────────────────────────────────────────────────────────
 * Ensures every page/section always opens scrolled to the top,
 * instead of inheriting whatever scroll position was left behind
 * by the previously viewed page (the "US" SPA reuses a single
 * scrollable #content region for every .page, and several pages
 * are separate documents loaded into persistent <iframe>s that
 * never reload, so their internal scroll position also lingers).
 *
 * This file is intentionally dependency-free and safe to include
 * on every page (top-level or iframe-embedded). It does three
 * things:
 *   1. Disables the browser's automatic scroll restoration so
 *      back/forward/bfcache navigation doesn't fight our reset.
 *   2. Resets window + known scrollable containers to the top on
 *      initial load and on 'pageshow' (covers bfcache restores).
 *   3. Listens for a postMessage from a parent frame asking this
 *      document to reset its scroll — used when the SPA shell
 *      switches an <iframe> page back into view without reloading
 *      it.
 *
 * Elements that intentionally need to keep their own scroll
 * position (e.g. an open chat thread that should stay scrolled to
 * its latest message) can opt out with data-preserve-scroll="true".
 */
(function () {
  'use strict';

  // Known scrollable regions across the app's pages. Harmless if a
  // given page doesn't contain any of these — querySelectorAll just
  // returns an empty list.
  var SCROLL_SELECTORS = [
    '.content',            // main SPA shell scroll region
    '.panel-body',         // globe.html side panels
    '.stats-content',      // globe.html stats panel
    '.gobody',             // games.html game body
    '.karaoke-lyrics-wrap',// music.html karaoke view
    '.mp-poi-list',        // meetplanner.html POI list
    '.page-content',
    '.scroll-container',
    '[data-scroll-root]'
  ].join(',');

  function resetScrollTop(root) {
    root = root || document;
    try { window.scrollTo(0, 0); } catch (e) {}
    try {
      if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    } catch (e) {}
    try {
      var nodes = root.querySelectorAll(SCROLL_SELECTORS);
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (el.getAttribute('data-preserve-scroll') === 'true') continue;
        el.scrollTop = 0;
      }
    } catch (e) {}
  }

  // Exposed so page-specific code (e.g. the SPA's goto() router) can
  // call it directly for the page it just activated, without waiting
  // on an event.
  window.__resetScrollToTop = resetScrollTop;

  if ('scrollRestoration' in history) {
    try { history.scrollRestoration = 'manual'; } catch (e) {}
  }

  // A parent frame (the SPA shell) can ask an embedded page to reset
  // its own scroll when it's switched back into view without a reload.
  window.addEventListener('message', function (evt) {
    if (evt && evt.data && evt.data.type === 'US_RESET_SCROLL') {
      resetScrollTop();
    }
  });

  // Covers normal loads, bfcache restores (back/forward), and PWA
  // resumes on Android.
  window.addEventListener('pageshow', function () { resetScrollTop(); });
  document.addEventListener('DOMContentLoaded', function () { resetScrollTop(); });
})();