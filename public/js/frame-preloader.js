/* frame-preloader.js
 * Makes the iframe-based pages (Movie, Music, Daily Routine, Meet Planner,
 * Love Counter, Dream Goals, Globe, Places, Collection, Games) open instantly.
 *
 * index.html declares these iframes with `data-src` (no `src`). This script:
 *   1. Loads a frame immediately when its page becomes the active page.
 *   2. Warms up every other frame in the background right after the shell
 *      is ready, so they are already loaded AND laid out (see the
 *      "Instant iframe pages" CSS in index.html) by the time you tap them.
 *   3. Shows a themed cover over a frame only until its first load finishes,
 *      so a frame that is still loading never flashes blank/black.
 */
(function () {
  'use strict';

  // Warm-up order: most-used / lightweight first, heavy (WebGL) last.
  var ORDER = [
    'musicFrame', 'movieFrame', 'dailyroutineFrame', 'meetplannerFrame',
    'lovecounterFrame', 'dreamgoalsFrame', 'placesFrame', 'collectionFrame',
    'gamesFrame', 'globeFrame'
  ];

  function addCover(frame) {
    var wrap = frame.parentNode;
    if (!wrap || wrap.querySelector('.us-frame-cover')) return null;
    var cover = document.createElement('div');
    cover.className = 'us-frame-cover';
    wrap.appendChild(cover);
    return cover;
  }

  function loadFrame(frame) {
    if (!frame) return;
    var url = frame.getAttribute('data-src');
    if (!url) return;
    var cover = addCover(frame);
    if (cover) {
      frame.addEventListener('load', function () {
        // wait one frame so the child has painted before the cover fades
        requestAnimationFrame(function () {
          cover.classList.add('done');
          setTimeout(function () { if (cover.parentNode) cover.parentNode.removeChild(cover); }, 250);
        });
      }, { once: true });
    }
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

  function idle(fn) {
    if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 1500 });
    else setTimeout(fn, 200);
  }

  function warmUpNext(i) {
    if (i >= ORDER.length) return;
    idle(function () {
      loadById(ORDER[i]);
      setTimeout(function () { warmUpNext(i + 1); }, 250);
    });
  }

  function start() {
    var pages = document.querySelectorAll('.page');
    var obs = new MutationObserver(loadActivePageFrame);
    for (var i = 0; i < pages.length; i++) {
      obs.observe(pages[i], { attributes: true, attributeFilter: ['class'] });
    }
    loadActivePageFrame();
    // Start warming right after the shell is ready (not after window.load,
    // which waits for every image and made the first tap slow).
    setTimeout(function () { warmUpNext(0); }, 500);
  }

  window.USFramePreloader = { load: loadById, loadActive: loadActivePageFrame };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
