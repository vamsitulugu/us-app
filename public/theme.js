/* Theme controller: light / dark / system. Load in <head>, before CSS paints.
   Choice is stored in localStorage('th_theme'); same-origin iframes follow
   automatically through the 'storage' event. */
(function () {
  var KEY = 'th_theme', mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  var BAR = { dark: '#14030e', light: '#FDEBFD' };
  function pref() { try { return localStorage.getItem(KEY) || 'dark'; } catch (e) { return 'dark'; } }
  function resolve(p) { if (document.documentElement.getAttribute('data-theme-lock') === 'dark') return 'dark'; return p === 'system' ? (mq && !mq.matches ? 'light' : 'dark') : (p === 'light' ? 'light' : 'dark'); }
  // Home (dashboard) has a hero at the very top, so the browser theme-color follows it there.
  function barColor(t) {
    var d = document.getElementById('page-dashboard');
    if (d && d.classList.contains('active')) return '#6B093A';   // home hero colour, both themes
    return t === 'dark' ? BAR.dark : BAR.light;
  }
  function homeActive() { var d = document.getElementById('page-dashboard'); return !!(d && d.classList.contains('active')); }
  function markHome() { try { if (document.body) document.body.classList.toggle('on-home', homeActive()); } catch (e) {} }
  window.refreshStatusBar = function () {
    markHome();
    var m = document.getElementById('themeColorMeta') || document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', barColor(resolve(pref())));
  };
  document.addEventListener('DOMContentLoaded', function () {
    var host = document.getElementById('page-dashboard');
    if (host && window.MutationObserver) new MutationObserver(window.refreshStatusBar).observe(host, { attributes: true, attributeFilter: ['class'] });
  });
  function apply() {
    var t = resolve(pref()), de = document.documentElement;
    de.setAttribute('data-theme', t);
    var m = document.getElementById('themeColorMeta') || document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', barColor(t));
    try { window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: t, pref: pref() } })); } catch (e) {}
    markHome();
  }
  window.Theme = {
    get: pref, resolved: function () { return resolve(pref()); }, bar: function () { return barColor(resolve(pref())); },
    set: function (p) { try { localStorage.setItem(KEY, p); } catch (e) {} apply(); }
  };
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(); });
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (pref() === 'system') apply(); });
  document.documentElement.setAttribute('data-theme', resolve(pref()));
  document.addEventListener('DOMContentLoaded', apply);
  // Re-assert once the app has fully started (native layer may restyle bars during startup).
  window.addEventListener('load', function () {
    [0, 400, 1500].forEach(function (ms) { setTimeout(function () { try { window.refreshStatusBar(); } catch (e) {} }, ms); });
  });
})();
