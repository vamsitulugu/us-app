/* frame-preloader.js
 * Loads the iframe-based pages (Movie, Music, Daily Routine, Meet Planner,
 * Love Counter, Dream Goals, Globe, Places, Collection, Games) so they open
 * instantly instead of showing a blank page.
 *
 * index.html declares these iframes with `data-src` (no `src`). This script:
 *   1. Loads a frame immediately when its page becomes the active page.
 *   2. Warms up every other frame in the background, one at a time, once the
 *      dashboard has finished loading, so later taps are instant.
 */
(function () {
  'use strict';

  // Warm-up order: lightweight pages first, heavy (WebGL/media) pages last.
  var ORDER = [
    'dailyroutineFrame', 'lovecounterFrame', 'meetplannerFrame',
    'dreamgoalsFrame', 'placesFrame', 'collectionFrame',
    'musicFrame', 'movieFrame', 'gamesFrame', 'globeFrame'
  ];

  function loadFrame(frame) {
    if (!frame) return;
    var url = frame.getAttribute('data-src');
    if (!url) return;                       // already loaded or nothing to load
    frame.setAttribute('src', url);
    frame.removeAttribute('data-src');
  }

  function loadById(id) { loadFrame(document.getElementById(id)); }

  function loadActivePageFrame() {
    var active = document.querySelector('.page.active');
    if (!active) return;
    var frames = active.querySelectorAll('iframe[data-src]');
    for (var i = 0; i < frames.length; i++) loadFrame(frames[i]);
  }

  function idle(fn, timeout) {
    if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: timeout || 2000 });
    else setTimeout(fn, 300);
  }

  function warmUpNext(i) {
    if (i >= ORDER.length) return;
    idle(function () {
      loadById(ORDER[i]);
      setTimeout(function () { warmUpNext(i + 1); }, 400);
    });
  }

  function start() {
    // 1) Open-on-demand: whenever a .page becomes active, load its frame NOW.
    var pages = document.querySelectorAll('.page');
    var obs = new MutationObserver(loadActivePageFrame);
    for (var i = 0; i < pages.length; i++) {
      obs.observe(pages[i], { attributes: true, attributeFilter: ['class'] });
    }
    loadActivePageFrame();

    // 2) Background warm-up after the main app has finished loading.
    function begin() { setTimeout(function () { warmUpNext(0); }, 800); }
    if (document.readyState === 'complete') begin();
    else window.addEventListener('load', begin, { once: true });
  }

  // Safety net for any code that navigates before the observer fires.
  window.USFramePreloader = { load: loadById, loadActive: loadActivePageFrame };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
