/* ONE place that sets the size of the whole web app: text, cards, buttons, images, spacing.
   UI_SCALE 0.75 = 25% smaller.  0.85 = 15% smaller.  1 = original size.
   Phones/tablets: the page is laid out wider and shown at UI_SCALE (viewport scaling).
   Desktop: CSS zoom. Set DESKTOP_TOO = false to leave desktop at the original size. */
(function () {
  var UI_SCALE = 0.75;
  var DESKTOP_TOO = true;
  try {
    if (UI_SCALE >= 1) return;
    if (window.self !== window.top) return; // pages inside the app's frames are scaled by the parent page
    var touch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    var shortSide = Math.min(screen.width, screen.height);
    if (touch && shortSide <= 900) {
      var m = document.querySelector('meta[name="viewport"]');
      if (!m) { m = document.createElement('meta'); m.name = 'viewport'; document.head.appendChild(m); }
      m.setAttribute('content', 'width=' + Math.round(window.innerWidth / UI_SCALE) + ', user-scalable=no, viewport-fit=cover');
    } else if (DESKTOP_TOO) {
      document.documentElement.style.zoom = String(UI_SCALE);
    }
  } catch (e) {}
})();
