/* Twin Hearts — "Android look" switch.
   The classic web UI is the default and is never edited. When this is ON the page gets
   <html data-ui="android"> and /android-ui.css is added; every rule in that file is scoped
   to data-ui="android", so turning it OFF returns the exact old UI.
   Turn on:  Settings → Appearance → Interface, or open any page with ?ui=android
   Turn off: Settings → Appearance → Interface → Classic, or ?ui=classic
   Same-origin iframes load this file too and follow through the 'storage' event. */
(function () {
  'use strict';
  var KEY = 'th_ui', LINK_ID = 'th-android-ui-css';
  function fromUrl() {
    try { var m = /[?&]ui=(android|classic)\b/.exec(location.search); return m ? m[1] : null; } catch (e) { return null; }
  }
  function pref() {
    var u = fromUrl();
    try {
      if (u) localStorage.setItem(KEY, u);
      return localStorage.getItem(KEY) === 'android' ? 'android' : 'classic';
    } catch (e) { return u || 'classic'; }
  }
  function apply() {
    var on = pref() === 'android', de = document.documentElement;
    if (on) de.setAttribute('data-ui', 'android'); else de.removeAttribute('data-ui');
    var link = document.getElementById(LINK_ID);
    if (on && !link) {
      link = document.createElement('link');
      link.id = LINK_ID; link.rel = 'stylesheet'; link.href = '/android-ui.css?v=2';
      (document.head || de).appendChild(link);
    } else if (!on && link) link.remove();
    try { window.dispatchEvent(new CustomEvent('uichange', { detail: { ui: on ? 'android' : 'classic' } })); } catch (e) {}
  }
  window.AndroidUI = {
    get: pref,
    set: function (v) { try { localStorage.setItem(KEY, v === 'android' ? 'android' : 'classic'); } catch (e) {} apply(); }
  };
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(); });
  apply();
})();
