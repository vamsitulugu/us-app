/* Theme controller: light / dark / system. Load in <head>, before CSS paints.
   Choice is stored in localStorage('th_theme'); same-origin iframes follow
   automatically through the 'storage' event. */
(function () {
  var KEY = 'th_theme', mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  var BAR = { dark: '#030816', light: '#0A4BCF' };
  function pref() { try { return localStorage.getItem(KEY) || 'dark'; } catch (e) { return 'dark'; } }
  function resolve(p) { if (document.documentElement.getAttribute('data-theme-lock') === 'dark') return 'dark'; return p === 'system' ? (mq && !mq.matches ? 'light' : 'dark') : (p === 'light' ? 'light' : 'dark'); }
  function apply() {
    var t = resolve(pref()), de = document.documentElement;
    de.setAttribute('data-theme', t);
    var m = document.getElementById('themeColorMeta') || document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', BAR[t]);
    try { window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: t, pref: pref() } })); } catch (e) {}
    try {
      var s = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.StatusBar;
      if (s) { s.setBackgroundColor({ color: BAR[t] }); s.setStyle({ style: 'DARK' }); }
    } catch (e) {}
  }
  window.Theme = {
    get: pref, resolved: function () { return resolve(pref()); },
    set: function (p) { try { localStorage.setItem(KEY, p); } catch (e) {} apply(); }
  };
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(); });
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (pref() === 'system') apply(); });
  document.documentElement.setAttribute('data-theme', resolve(pref()));
  document.addEventListener('DOMContentLoaded', apply);
})();
