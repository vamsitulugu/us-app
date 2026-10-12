/* Theme controller: light / dark / system. Load in <head>, before CSS paints.
   Choice is stored in localStorage('th_theme'); same-origin iframes follow
   automatically through the 'storage' event. */
(function () {
  var KEY = 'th_theme', mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  var BAR = { dark: '#030816', light: '#EAF2FF' };
  function pref() { try { return localStorage.getItem(KEY) || 'dark'; } catch (e) { return 'dark'; } }
  function resolve(p) { if (document.documentElement.getAttribute('data-theme-lock') === 'dark') return 'dark'; return p === 'system' ? (mq && !mq.matches ? 'light' : 'dark') : (p === 'light' ? 'light' : 'dark'); }
  // DARK = white icons (for dark bars); LIGHT = black icons (for the pale light theme).
  // Home (dashboard) has a blue hero at the very top, so it keeps white icons.
  function statusStyle(t) {
    if (t === 'dark') return 'DARK';
    var d = document.getElementById('page-dashboard');
    return (d && d.classList.contains('active')) ? 'DARK' : 'LIGHT';
  }
  window.refreshStatusBar = function () {
    try { var s = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.StatusBar; if (s) s.setStyle({ style: statusStyle(resolve(pref())) }); } catch (e) {}
  };
  document.addEventListener('DOMContentLoaded', function () {
    var host = document.getElementById('page-dashboard');
    if (host && window.MutationObserver) new MutationObserver(window.refreshStatusBar).observe(host, { attributes: true, attributeFilter: ['class'] });
  });
  function apply() {
    var t = resolve(pref()), de = document.documentElement;
    de.setAttribute('data-theme', t);
    var m = document.getElementById('themeColorMeta') || document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', BAR[t]);
    try { window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: t, pref: pref() } })); } catch (e) {}
    try {
      var s = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.StatusBar;
      if (s) { s.setBackgroundColor({ color: BAR[t] }); s.setStyle({ style: statusStyle(t) }); }
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
