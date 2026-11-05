/* topbar-actions.js — one top bar for every page (matches the Android app):
   [← back] [page name] ........ [🔍 page search] [⋮ page menu]
   • The 🔍 and ⋮ live IN the top bar. Each page's own search / ⋮ / duplicate title row is hidden.
   • A page that already has a search box (Music, Places, Settings, Globe) is driven from the top bar.
   • A page with no search box gets a filter: type in the top bar and that page's cards are filtered.
   • Pages that are full-screen apps with their own header (Home, Chat, Twin, Live Map) are left alone.
   Undo: remove the <script src="/topbar-actions.js"> line in index.html. */
(function () {
  'use strict';
  if (window.__tbActions) return; window.__tbActions = true;

  var FRAME = { music:'musicFrame', movie:'movieFrame', games:'gamesFrame', places:'placesFrame', globe:'globeFrame',
    collection:'collectionFrame', lovecounter:'lovecounterFrame', dreamgoals:'dreamgoalsFrame',
    meetplanner:'meetplannerFrame', dailyroutine:'dailyroutineFrame', pro:'proFrame' };

  /* Pages that keep their own full header — the top-bar slot is hidden there. */
  var NO_SLOT = { dashboard:1, chat:1, ai:1, map:1 };

  /* Per-page wiring. search: {click} presses the page's own search button, {input} drives the page's own box.
     menu: extra ⋮ items (each {label, click}); hide: CSS inside the page that removes its own title/search/⋮ row. */
  var REG = {
    music:  { search:{ click:'[data-act="open-search"]' }, menu:[{ label:'Music settings', click:'[data-act="open-settings"]' }], hide:'#home > .hdr' },
    movie:  { menu:[{ label:'Watch history', click:'#wtHistoryBtn' }], hide:'#wtHeader' },
    places: { search:{ input:'#pmSearch' }, hide:'#pmSearch' },
    globe:  { search:{ click:'#searchToggleBtn' }, hide:'.top-bar',
              menu:[{ label:'Live location', click:'#liveToggleBtn' }, { label:'Statistics', click:'[title="Statistics"]' },
                    { label:'Filter', click:'[title="Filter"]' }, { label:'Reset view', click:'[title="Reset view"]' }] },
    pro:    { hide:'.hero h1' },
    settings: { search:{ input:'#setSearch' } }
  };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var cur = '', started = false;

  /* ── DOM ───────────────────────────────────────────────── */
  var ICON_S = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';
  var ICON_M = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
  var ICON_X = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';

  function build() {
    var row = $('.topbar .tb-row'); if (!row || $('#tbSlot')) return !!$('#tbSlot');
    var slot = document.createElement('div'); slot.className = 'tb-slot'; slot.id = 'tbSlot';
    slot.innerHTML = '<button type="button" class="tb-ib" id="tbSearch" aria-label="Search">' + ICON_S + '</button>' +
                     '<button type="button" class="tb-ib" id="tbMore" aria-label="More options">' + ICON_M + '</button>';
    row.appendChild(slot);

    var bar = document.createElement('div'); bar.className = 'tb-searchbar'; bar.id = 'tbSearchBar'; bar.hidden = true;
    bar.innerHTML = '<button type="button" class="tb-ib" id="tbSearchClose" aria-label="Close search">' +
                    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>' +
                    '<input type="search" id="tbSearchInput" autocomplete="off" enterkeyhint="search" aria-label="Search this page">' +
                    '<button type="button" class="tb-ib" id="tbSearchClear" aria-label="Clear" hidden>' + ICON_X + '</button>';
    $('.topbar').appendChild(bar);

    var menu = document.createElement('div'); menu.className = 'tb-menu'; menu.id = 'tbMenu'; menu.hidden = true;
    document.body.appendChild(menu);

    $('#tbSearch').addEventListener('click', openSearchUI);
    $('#tbMore').addEventListener('click', function (e) { e.stopPropagation(); toggleMenu(); });
    $('#tbSearchClose').addEventListener('click', closeSearchUI);
    $('#tbSearchClear').addEventListener('click', function () { setQuery(''); $('#tbSearchInput').focus(); });
    $('#tbSearchInput').addEventListener('input', function () { setQuery(this.value); });
    $('#tbSearchInput').addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSearchUI(); });
    document.addEventListener('click', function (e) { if (!e.target.closest('#tbMenu')) closeMenu(); });
    return true;
  }

  /* ── page helpers ──────────────────────────────────────── */
  function pageEl() { return document.getElementById('page-' + cur); }
  function frameDoc() {
    var id = FRAME[cur], f = id && document.getElementById(id);
    try { return f && f.contentDocument && f.contentDocument.body ? f.contentDocument : null; } catch (e) { return null; }
  }
  function root() { var d = frameDoc(); return d ? d.body : pageEl(); }
  function q(sel) { var p = frameDoc() || pageEl(); return p ? p.querySelector(sel) : null; }

  /* ── search ────────────────────────────────────────────── */
  function openSearchUI() {
    var r = REG[cur] || {}, s = r.search;
    if (s && s.click) { var b = q(s.click); if (b) { b.click(); return; } }
    var bar = $('#tbSearchBar'); bar.hidden = false; document.body.classList.add('tb-searching');
    var inp = $('#tbSearchInput'); inp.value = ''; inp.placeholder = 'Search ' + (($('#topTitle') || {}).textContent || 'this page').trim();
    setTimeout(function () { inp.focus(); }, 30);
  }
  function closeSearchUI() {
    setQuery(''); var bar = $('#tbSearchBar'); if (bar) bar.hidden = true; document.body.classList.remove('tb-searching');
  }
  function setQuery(v) {
    var inp = $('#tbSearchInput'); if (inp.value !== v) inp.value = v;
    $('#tbSearchClear').hidden = !v;
    var s = (REG[cur] || {}).search;
    if (s && s.input) {                       // drive the page's own search box
      var box = q(s.input);
      if (box) { box.value = v; box.dispatchEvent(new Event('input', { bubbles: true })); return; }
    }
    filterPage(v);
  }

  /* Generic filter: finds repeated "card" siblings on the page and hides the ones that don't match. */
  var SKIP = /(^|[\s_-])(tab|tabs|stab|chip|chips|nav|btn|toggle|filter|pill|seg|hdr|header)([\s_-]|$)/i;
  function filterPage(v) {
    var rt = root(); if (!rt) return;
    rt.querySelectorAll('[data-tbf]').forEach(function (el) { el.style.display = el.getAttribute('data-tbf'); el.removeAttribute('data-tbf'); });
    var text = v.trim().toLowerCase(); if (!text) return;
    var seen = new Set(), items = [];
    rt.querySelectorAll('*').forEach(function (p) {
      if (p.closest('#tbSlot,[data-tbf-skip]') || p.offsetParent === null) return;
      var groups = {};
      for (var i = 0; i < p.children.length; i++) {
        var c = p.children[i]; if (/^(SCRIPT|STYLE|SVG|BR|INPUT|OPTION)$/i.test(c.tagName)) continue;
        var key = c.tagName + '.' + c.className; if (SKIP.test(c.className)) continue;
        (groups[key] = groups[key] || []).push(c);
      }
      Object.keys(groups).forEach(function (k) {
        var g = groups[k]; if (g.length < 3) return;
        var inside = false; g.forEach(function (el) { if (seen.has(el.parentNode)) inside = true; });
        if (inside) return;
        var texty = g.filter(function (el) { return (el.textContent || '').trim().length > 2; }).length;
        if (texty < 3) return;
        g.forEach(function (el) { seen.add(el); items.push(el); });
      });
    });
    if (!items.length) {                       // nothing to filter → use the app-wide search
      closeSearchUI(); if (typeof window.openSearch === 'function') { window.openSearch(); var si = $('#searchInput'); if (si) { si.value = v; if (typeof window.doSearch === 'function') window.doSearch(v); } }
      return;
    }
    items.forEach(function (el) {
      if ((el.textContent || '').toLowerCase().indexOf(text) === -1) {
        el.setAttribute('data-tbf', el.style.display || ''); el.style.display = 'none';
      }
    });
  }

  /* ── ⋮ menu ────────────────────────────────────────────── */
  function menuItems() {
    var items = [], r = REG[cur] || {};
    (r.menu || []).forEach(function (m) { if (q(m.click)) items.push({ label: m.label, run: function () { q(m.click).click(); } }); });
    items.push({ label: 'Refresh page', run: refreshPage });
    if (cur !== 'settings') items.push({ label: 'Settings', run: function () { if (window.goto) window.goto('settings'); } });
    items.push({ label: 'Help', run: function () { window.open('/help.html', '_blank'); } });
    return items;
  }
  function refreshPage() {
    var id = FRAME[cur], f = id && document.getElementById(id);
    if (f) { try { f.contentWindow.location.reload(); } catch (e) { f.src = f.src; } }
    else { var cb = pageEl(); if (cb) { cb.style.opacity = '.4'; setTimeout(function () { location.reload(); }, 120); } }
  }
  function toggleMenu() {
    var m = $('#tbMenu'); if (!m.hidden) { closeMenu(); return; }
    m.innerHTML = '';
    menuItems().forEach(function (it) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = it.label;
      b.addEventListener('click', function (e) { e.stopPropagation(); closeMenu(); it.run(); });
      m.appendChild(b);
    });
    var r = $('#tbMore').getBoundingClientRect();
    m.style.top = (r.bottom + 6) + 'px'; m.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
    m.hidden = false;
  }
  function closeMenu() { var m = $('#tbMenu'); if (m) m.hidden = true; }

  /* ── hide each page's own duplicate title / search / ⋮ row ─ */
  function injectFrameCss(page) {
    var id = FRAME[page], f = id && document.getElementById(id), r = REG[page]; if (!f || !r || !r.hide) return;
    try {
      var d = f.contentDocument; if (!d || !d.head || d.getElementById('tb-hide-css')) return;
      var st = d.createElement('style'); st.id = 'tb-hide-css'; st.textContent = r.hide + '{display:none!important}';
      d.head.appendChild(st);
    } catch (e) {}
  }
  function wireFrames() {
    Object.keys(FRAME).forEach(function (p) {
      var f = document.getElementById(FRAME[p]); if (!f || f.__tbw) return; f.__tbw = true;
      f.addEventListener('load', function () { injectFrameCss(p); });
      injectFrameCss(p);
    });
  }

  /* Pages whose card title is plain text next to buttons: wrap the text so CSS can hide just the name. */
  function dedupeTitles() {
    ['#page-bucket .card-title'].forEach(function (sel) {
      var el = $(sel), n = el && el.firstChild;
      if (n && n.nodeType === 3 && n.textContent.trim()) {
        var sp = document.createElement('span'); sp.className = 'tb-dup'; sp.textContent = n.textContent; el.replaceChild(sp, n);
      }
    });
  }

  /* ── follow the page the app is showing ────────────────── */
  function onPage() {
    var p = document.body.getAttribute('data-page') || 'dashboard'; if (started && p === cur) return; started = true;
    cur = p; closeSearchUI(); closeMenu(); wireFrames(); injectFrameCss(p);
    document.body.classList.toggle('tb-noslot', !!NO_SLOT[p]);
    var sb = $('#tbSearch'); if (sb) sb.title = 'Search ' + p;
  }

  function init() {
    if (!build()) return setTimeout(init, 300);
    new MutationObserver(onPage).observe(document.body, { attributes: true, attributeFilter: ['data-page'] });
    dedupeTitles(); onPage(); wireFrames();
    setTimeout(wireFrames, 1500); setTimeout(wireFrames, 5000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
