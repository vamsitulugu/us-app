/* ═══════════════════════════════════════════════════════════════
   MUSIC · core
   Event bus, helpers, icons, API client, settings, overlay/back stack,
   sheets & dialogs, screen navigation, the data store (songs, playlists,
   recordings) and realtime sync.

   Everything is exposed on window.MX. Compatibility globals for the
   scripts this redesign leaves in place (import-service, couple-karaoke,
   lyrics-admin-dashboard) are defined at the bottom: Store, MusicPlayer.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const MX = (window.MX = {});

  /* ── event bus ─────────────────────────────────────────── */
  const bus = {};
  MX.on = (e, fn) => { (bus[e] = bus[e] || []).push(fn); return () => MX.off(e, fn); };
  MX.off = (e, fn) => { bus[e] = (bus[e] || []).filter((f) => f !== fn); };
  MX.emit = (e, p) => (bus[e] || []).slice().forEach((fn) => { try { fn(p); } catch (err) { console.error('[music]', e, err); } });

  /* ── helpers ───────────────────────────────────────────── */
  MX.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  MX.fmt = (s) => { s = Number(s); if (!isFinite(s) || s < 0) s = 0; const m = Math.floor(s / 60), r = Math.floor(s % 60); return m + ':' + String(r).padStart(2, '0'); };
  MX.fmtLong = (sec) => {
    sec = Math.round(Number(sec) || 0); if (!sec) return '0 min';
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    return h ? `${h} hr ${m} min` : `${Math.max(1, m)} min`;
  };
  MX.fmtBytes = (b) => { b = Number(b) || 0; if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(0) + ' KB'; if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB'; return (b / 1073741824).toFixed(2) + ' GB'; };
  MX.rel = (iso) => {
    const t = typeof iso === 'number' ? iso : Date.parse(iso); if (!t) return '';
    const d = (Date.now() - t) / 1000;
    if (d < 60) return 'just now'; if (d < 3600) return Math.floor(d / 60) + ' min ago';
    if (d < 86400) return Math.floor(d / 3600) + ' hr ago'; if (d < 604800) return Math.floor(d / 86400) + ' d ago';
    return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d > 31536000 ? 'numeric' : undefined });
  };
  MX.date = (iso) => { const t = Date.parse(iso); return t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''; };
  MX.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  MX.ts = (v) => { if (!v) return 0; if (typeof v === 'number') return v; const t = Date.parse(v); return isFinite(t) ? t : 0; };
  MX.shuffleArray = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  MX.online = () => navigator.onLine !== false;
  MX.haptic = () => {
    try { const h = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics; if (h && h.impact) { h.impact({ style: 'LIGHT' }); return; } } catch (e) {}
    try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) {}
  };
  MX.share = async (text, url) => {
    try { if (navigator.share) { await navigator.share({ text, url }); return true; } } catch (e) { if (e && e.name === 'AbortError') return true; }
    try { await navigator.clipboard.writeText(url ? text + ' ' + url : text); MX.toast('Copied to clipboard'); return true; } catch (e) {}
    MX.toast("Sharing isn't available here"); return false;
  };
  MX.readFile = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsText(file); });

  /* ── icons (24×24, lucide-style strokes) ───────────────── */
  const I = {
    play: '<polygon points="6 3 20 12 6 21 6 3"/>', pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    prev: '<polygon points="19 20 9 12 19 4 19 20"/><line x1="5" x2="5" y1="19" y2="5"/>', next: '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/>',
    shuffle: '<path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    repeat1: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11 10h1v4"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>', more: '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
    left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>', down: '<path d="m6 9 6 6 6-6"/>', up: '<path d="m18 15-6-6-6 6"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
    video: '<path d="m16 13 5.2 3.1a.5.5 0 0 0 .8-.4V8.3a.5.5 0 0 0-.8-.4L16 11"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/>',
    queue: '<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>',
    lyrics: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    sort: '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    film: '<rect x="2" y="2" width="20" height="20" rx="2.18"/><path d="M7 2v20"/><path d="M17 2v20"/><path d="M2 12h20"/><path d="M2 7h5"/><path d="M2 17h5"/><path d="M17 17h5"/><path d="M17 7h5"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
    headphones: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    font: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.287 1.288L3 12l5.8 1.9a2 2 0 0 1 1.288 1.287L12 21l1.9-5.8a2 2 0 0 1 1.287-1.288L21 12l-5.8-1.9a2 2 0 0 1-1.288-1.287Z"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    disc: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2"/>',
    listPlus: '<path d="M11 12H3"/><path d="M16 6H3"/><path d="M16 18H3"/><path d="M18 9v6"/><path d="M21 12h-6"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
    sliders: '<line x1="4" x2="20" y1="7" y2="7"/><line x1="4" x2="20" y1="17" y2="17"/><circle cx="9" cy="7" r="2.5"/><circle cx="15" cy="17" r="2.5"/>',
    flip: '<path d="M3 7h13l-3-3"/><path d="M21 17H8l3 3"/>',
    wifiOff: '<path d="M12 20h.01"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M2 8.8a15 15 0 0 1 4.2-2.6"/><path d="M5 12.9a10 10 0 0 1 5.2-2.7"/><path d="M19 12.9a10 10 0 0 0-2.2-1.6"/><path d="M22 8.8a15 15 0 0 0-8.6-3.6"/><path d="m2 2 20 20"/>',
    tv: '<rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/>',
    award: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    fileText: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  };
  const FILLED = { play: 1, pause: 1, prev: 1, next: 1, stop: 0, more: 1 };
  MX.icon = (name, cls) => `<svg class="i${FILLED[name] ? ' fill' : ''}${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${I[name] || ''}</svg>`;

  /* ── context + API ─────────────────────────────────────── */
  const API = (function () {
    try { return window.parent.API || window.API || 'https://us-app-av6d.onrender.com'; } catch (e) { return window.API || 'https://us-app-av6d.onrender.com'; }
  })();
  MX.API = API;
  MX.ctx = function () {
    try {
      const p = window.parent && window.parent.S;
      if (p && p.coupleId) return { coupleId: p.coupleId, role: p.role || 'user1', myName: p.myName || 'You', partnerName: p.partnerName || 'Partner' };
    } catch (e) {}
    try {
      const raw = localStorage.getItem('uwl_v5');
      if (raw) { const d = JSON.parse(raw); if (d.coupleId) return { coupleId: d.coupleId, role: d.role || 'user1', myName: d.myName || 'You', partnerName: d.partnerName || 'Partner' }; }
    } catch (e) {}
    return null;
  };
  MX.role = () => (MX.ctx() || {}).role || 'user1';
  MX.partnerRole = () => (MX.role() === 'user1' ? 'user2' : 'user1');
  MX.names = () => { const c = MX.ctx() || {}; return { me: c.myName || 'You', partner: c.partnerName || 'Partner' }; };

  MX.api = async function (method, path, body, opts) {
    opts = opts || {};
    if (!MX.online()) { const e = new Error("You're offline"); e.offline = true; throw e; }
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), opts.timeout || (isForm ? 180000 : 25000)) : null;
    let r;
    try {
      r = await fetch(API + path, {
        method, signal: ctl ? ctl.signal : undefined,
        headers: isForm || body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : (isForm ? body : JSON.stringify(body)),
      });
    } catch (err) {
      const e = new Error(err && err.name === 'AbortError' ? 'The request timed out' : 'Network problem — check your connection');
      e.network = true; throw e;
    } finally { if (timer) clearTimeout(timer); }
    let data = null; try { data = await r.json(); } catch (e) {}
    if (!r.ok) { const e = new Error((data && data.error) || 'Request failed (' + r.status + ')'); e.status = r.status; e.code = data && data.code; throw e; }
    return data;
  };

  /* ── tiny persistent cache (per couple) ────────────────── */
  MX.cache = {
    key: (k) => 'mx_' + k + '_' + ((MX.ctx() || {}).coupleId || 'x'),
    get(k, fallback) { try { const v = localStorage.getItem(this.key(k)); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
    set(k, v) { try { localStorage.setItem(this.key(k), JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(this.key(k)); } catch (e) {} },
  };

  /* ── settings (device-level, like every music app) ─────── */
  const DEFAULTS = { crossfade: 0, autoLyrics: true, normalize: false, vocalReduce: false, lyricSize: 1, lyricBg: true, sort: 'added', fx: { preset: 'flat', reverb: 0, delay: 0, bass: 0, treble: 0 } };
  let settings = Object.assign({}, DEFAULTS, (function () { try { return JSON.parse(localStorage.getItem('mx_settings_v1')) || {}; } catch (e) { return {}; } })());
  MX.settings = {
    get: (k) => settings[k],
    all: () => settings,
    set(k, v) { settings[k] = v; try { localStorage.setItem('mx_settings_v1', JSON.stringify(settings)); } catch (e) {} MX.emit('settings', { key: k, value: v }); },
  };

  /* ── toast ─────────────────────────────────────────────── */
  let toastT;
  MX.toast = function (msg) {
    const el = document.getElementById('toast'); if (!el) return;
    el.textContent = msg; el.classList.add('show'); clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove('show'), 2800);
  };

  /* ── overlay / back-button stack ───────────────────────── */
  const layers = [];
  MX.layers = {
    push(id, close) { layers.push({ id, close }); },
    remove(id) { const i = layers.map((l) => l.id).lastIndexOf(id); if (i >= 0) layers.splice(i, 1); },
    has: (id) => layers.some((l) => l.id === id),
    closeTop() { const l = layers[layers.length - 1]; if (!l) return false; try { l.close(); } catch (e) { layers.pop(); } return true; },
  };

  /* ── sheets & dialogs ──────────────────────────────────── */
  let sheetSeq = 0;
  MX.sheet = function (html, opts) {
    opts = opts || {};
    const id = 'sheet' + (++sheetSeq);
    const ov = document.createElement('div');
    ov.className = 'ov open' + (opts.modal ? ' modal' : '');
    ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${opts.modal ? '' : '<div class="sheet-grab"></div>'}${html}</div>`;
    document.body.appendChild(ov);
    let closed = false;
    const api = {
      el: ov.firstElementChild, ov,
      close(result) {
        if (closed) return; closed = true;
        MX.layers.remove(id); ov.remove();
        if (opts.onClose) try { opts.onClose(result); } catch (e) {}
      },
      $: (s) => ov.querySelector(s),
    };
    ov.addEventListener('click', (e) => { if (e.target === ov && !opts.sticky) api.close(); });
    MX.layers.push(id, () => api.close());
    if (opts.onMount) opts.onMount(api);
    return api;
  };

  MX.confirm = function (o) {
    return new Promise((resolve) => {
      let answer = false;
      const s = MX.sheet(`<h3>${MX.esc(o.title || 'Are you sure?')}</h3>${o.message ? `<p class="msg">${MX.esc(o.message)}</p>` : ''}
        <div class="row2"><button class="btn ghost" data-k="no">${MX.esc(o.cancel || 'Cancel')}</button>
        <button class="btn ${o.danger ? 'danger' : 'primary'}" data-k="yes">${MX.esc(o.confirm || 'OK')}</button></div>`,
        { modal: true, onClose: () => resolve(answer) });
      s.el.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; answer = b.dataset.k === 'yes'; s.close(); });
    });
  };
  MX.prompt = function (o) {
    return new Promise((resolve) => {
      let value = null;
      const s = MX.sheet(`<h3>${MX.esc(o.title || '')}</h3>
        <div class="field">${o.label ? `<label>${MX.esc(o.label)}</label>` : ''}<input id="pmIn" type="text" maxlength="${o.max || 80}" placeholder="${MX.esc(o.placeholder || '')}" value="${MX.esc(o.value || '')}"></div>
        <div class="row2"><button class="btn ghost" data-k="no">Cancel</button><button class="btn primary" data-k="yes">${MX.esc(o.confirm || 'Save')}</button></div>`,
        { modal: true, onClose: () => resolve(value) });
      const input = s.$('#pmIn'); setTimeout(() => { input.focus(); input.select(); }, 60);
      const done = () => { const v = input.value.trim(); if (!v) { input.focus(); return; } value = v; s.close(); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); });
      s.el.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; if (b.dataset.k === 'yes') done(); else s.close(); });
    });
  };
  /* Action list sheet: items = [{ico,label,act,data,danger,hint,on}] */
  MX.menu = function (head, items) {
    const rows = items.filter(Boolean).map((it, i) => `<button class="sa${it.danger ? ' danger' : ''}${it.on ? ' on' : ''}" data-i="${i}">${MX.icon(it.ico)}<span>${MX.esc(it.label)}</span>${it.hint ? `<span class="hint">${MX.esc(it.hint)}</span>` : ''}</button>`).join('');
    const list = items.filter(Boolean);
    const s = MX.sheet((head || '') + rows);
    s.el.addEventListener('click', (e) => {
      const b = e.target.closest('.sa'); if (!b) return;
      const it = list[+b.dataset.i]; s.close();
      if (it && it.run) setTimeout(() => it.run(), 10);
    });
    return s;
  };

  /* ── global click delegation:  data-act="name"  ───────── */
  const actions = {};
  MX.act = (name, fn) => { actions[name] = fn; };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const fn = actions[el.dataset.act];
    if (fn) { e.preventDefault(); try { const r = fn(el.dataset, el, e); if (r && r.catch) r.catch((err) => console.error('[music]', err)); } catch (err) { console.error('[music]', err); } }
  });
  // Broken artwork falls back to the gradient + note icon behind it.
  document.addEventListener('error', (e) => { const t = e.target; if (t && t.tagName === 'IMG' && t.closest('.cover,.mix-art,.mv-poster')) t.remove(); }, true);

  /* ── covers ────────────────────────────────────────────── */
  MX.cover = (song, size) => `<div class="cover ${size || 'm'}">${MX.icon('music')}${song && song.cover_url ? `<img src="${MX.esc(song.cover_url)}" alt="" loading="lazy" decoding="async">` : ''}</div>`;

  /* ═══════════════════════════════════════════════════════
     NAVIGATION — a tiny screen stack. The Home screen is the root;
     everything else is pushed on top with a back arrow, like a native app.
  ═══════════════════════════════════════════════════════ */
  const screens = {}; const stack = [];
  const appEl = () => document.getElementById('app');
  MX.nav = {
    register(name, mount) { screens[name] = mount; },
    stack: () => stack.slice(),
    depth: () => stack.length,
    top: () => stack[stack.length - 1] || null,
    push(name, params) {
      const mount = screens[name]; if (!mount) { console.warn('unknown screen', name); return null; }
      const el = document.createElement('section');
      el.className = 'screen pushed active enter'; el.setAttribute('data-scroll-root', '');
      appEl().appendChild(el);
      const entry = { name, params: params || {}, el, ctl: null };
      stack.push(entry);
      entry.ctl = mount(el, entry.params, entry) || {};
      setTimeout(() => el.classList.remove('enter'), 340);
      MX.emit('nav', { name, depth: stack.length });
      return entry;
    },
    pop() {
      const entry = stack.pop(); if (!entry) return false;
      if (entry.ctl && entry.ctl.destroy) try { entry.ctl.destroy(); } catch (e) {}
      entry.el.classList.add('leave');
      setTimeout(() => entry.el.remove(), 230);
      MX.emit('nav', { name: (MX.nav.top() || {}).name || 'home', depth: stack.length });
      return true;
    },
    popAll() { while (stack.length) MX.nav.pop(); },
    update(evt) {
      stack.forEach((en) => { const c = en.ctl; if (c && c.update && (!c.events || c.events.includes(evt))) { try { c.update(evt); } catch (e) { console.error('[music] update', en.name, e); } } });
    },
  };
  MX.act('back', () => { if (!MX.layers.closeTop()) MX.nav.pop(); });
  MX.hdr = (title, right, sub) => `<header class="hdr sticky"><button class="icon-btn bare" data-act="back" aria-label="Back">${MX.icon('left')}</button><h1 class="ellip">${MX.esc(title)}${sub ? `<div class="hdr-sub">${MX.esc(sub)}</div>` : ''}</h1><div class="hdr-actions">${right || ''}</div></header>`;

  /* ═══════════════════════════════════════════════════════
     DATA STORE
  ═══════════════════════════════════════════════════════ */
  const S = (MX.S = { songs: [], playlists: [], playlistsAvailable: true, recordings: [], loaded: {} });
  const Lib = (MX.lib = {});
  Lib.byId = (id) => S.songs.find((s) => String(s.id) === String(id)) || null;
  Lib.isMine = (s) => s.uploaded_by === MX.role();
  /* 30-second Deezer previews added from "Search Online" live on the Featured Songs page only. */
  Lib.isPreview = (s) => /(^|\.)(dzcdn\.net|deezer\.com)(\/|$)/i.test(String(s && s.audio_url || '').replace(/^https?:\/\//i, ''));
  Lib.full = () => S.songs.filter((s) => !Lib.isPreview(s));
  Lib.featured = () => S.songs.filter(Lib.isPreview).sort((a, b) => MX.ts(b.created_at) - MX.ts(a.created_at));
  Lib.mine = () => Lib.full().filter(Lib.isMine);
  Lib.partner = () => Lib.full().filter((s) => !Lib.isMine(s));
  Lib.liked = () => Lib.full().filter((s) => s.liked);
  Lib.recent = (n) => { const l = S.songs.filter((s) => MX.ts(s.my_last_played)).sort((a, b) => MX.ts(b.my_last_played) - MX.ts(a.my_last_played)); return n ? l.slice(0, n) : l; };
  Lib.norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  Lib.search = (q) => {
    q = Lib.norm(q).trim(); if (!q) return [];
    const words = q.split(/\s+/);
    return S.songs.filter((s) => { const hay = Lib.norm([s.title, s.artist, s.album, s.genre].join(' ')); return words.every((w) => hay.includes(w)); });
  };
  Lib.sorters = {
    added: { label: 'Recently added', fn: (a, b) => MX.ts(b.created_at) - MX.ts(a.created_at) },
    title: { label: 'Title A–Z', fn: (a, b) => String(a.title).localeCompare(String(b.title), undefined, { sensitivity: 'base' }) },
    artist: { label: 'Artist A–Z', fn: (a, b) => String(a.artist).localeCompare(String(b.artist), undefined, { sensitivity: 'base' }) },
    played: { label: 'Most played', fn: (a, b) => (b.my_play_count || 0) - (a.my_play_count || 0) },
    duration: { label: 'Longest first', fn: (a, b) => (b.duration_sec || 0) - (a.duration_sec || 0) },
  };
  Lib.sort = (list, key) => list.slice().sort((Lib.sorters[key] || Lib.sorters.added).fn);
  Lib.playlistSongs = (pl) => (pl.song_ids || []).map(Lib.byId).filter(Boolean);
  Lib.totalSec = (list) => list.reduce((n, s) => n + (s.duration_sec || 0), 0);

  const D = (MX.data = {});

  function applySongs(rows) {
    const old = new Map(S.songs.map((s) => [String(s.id), s]));
    S.songs = (rows || []).map((r) => {
      const o = old.get(String(r.id));
      // The list omits the lyrics body — keep what we've already downloaded.
      if (o && o.lyrics !== undefined && r.lyrics === undefined) { r.lyrics = o.lyrics; r.lyrics_latin = o.lyrics_latin; }
      return r;
    });
    MX.emit('library');
  }
  D.loadSongs = async function (quiet) {
    const c = MX.ctx(); if (!c) return false;
    try {
      const rows = await MX.api('GET', '/api/music/' + encodeURIComponent(c.coupleId) + '?viewer=' + c.role);
      S.loaded.songs = true; applySongs(rows);
      MX.cache.set('songs', rows.map((r) => { const { lyrics, lyrics_latin, lyrics_native, ...rest } = r; return rest; }));
      return true;
    } catch (e) {
      if (!S.loaded.songs) { const cached = MX.cache.get('songs', null); if (cached) { applySongs(cached); S.loaded.songs = true; } }
      if (!quiet && !e.offline) MX.toast('Could not refresh songs — ' + e.message);
      S.loaded.songs = true; MX.emit('library');
      return false;
    }
  };
  D.loadPlaylists = async function () {
    const c = MX.ctx(); if (!c) return;
    try {
      const r = await MX.api('GET', '/api/music/' + encodeURIComponent(c.coupleId) + '/playlists');
      S.playlistsAvailable = r.available !== false; S.playlists = r.playlists || [];
      MX.cache.set('playlists', S.playlists);
    } catch (e) { if (!S.loaded.playlists) S.playlists = MX.cache.get('playlists', []); }
    S.loaded.playlists = true; MX.emit('playlists');
  };
  D.loadRecordings = async function () {
    const c = MX.ctx(); if (!c) return;
    try { S.recordings = (await MX.api('GET', '/api/recordings/' + encodeURIComponent(c.coupleId))) || []; MX.cache.set('recs', S.recordings); }
    catch (e) { if (!S.loaded.recordings) S.recordings = MX.cache.get('recs', []); }
    S.loaded.recordings = true; MX.emit('recordings');
  };
  D.loadAll = () => Promise.all([D.loadSongs(true), D.loadPlaylists(), D.loadRecordings()]);

  D.toggleLike = async function (song) {
    const c = MX.ctx(); if (!c || !song) return;
    const next = !song.liked; song.liked = next; MX.haptic(); MX.emit('library', { like: song.id });
    try { await MX.api('PUT', '/api/music/' + song.id + '/like', { coupleId: c.coupleId, viewer: c.role, liked: next }); MX.rt.ping('songs'); }
    catch (e) { song.liked = !next; MX.emit('library', { like: song.id }); MX.toast(e.offline ? 'Connect to the internet to like songs' : 'Could not update like'); }
  };
  D.deleteSong = async function (song) {
    const c = MX.ctx(); if (!c || !song) return false;
    if (!Lib.isMine(song)) { MX.toast('Only ' + MX.names().partner + ' can delete this song'); return false; }
    const ok = await MX.confirm({ title: 'Delete “' + song.title + '”?', message: 'This removes the song and its files for both of you. This can\'t be undone.', confirm: 'Delete', danger: true });
    if (!ok) return false;
    try {
      await MX.api('DELETE', '/api/music/' + song.id, { coupleId: c.coupleId, viewer: c.role });
    } catch (e) { MX.toast('Delete failed — ' + e.message); return false; }
    const cur = window.AudioService && AudioService.currentSong();
    if (cur && cur.id === song.id) AudioService.stop();
    if (window.AudioService) AudioService.removeFromQueue(song.id);
    if (MX.offline) MX.offline.remove(song);
    S.songs = S.songs.filter((s) => s.id !== song.id);
    S.playlists.forEach((p) => { p.song_ids = (p.song_ids || []).filter((id) => String(id) !== String(song.id)); });
    MX.emit('library'); MX.emit('playlists'); MX.rt.ping('songs'); MX.toast('Song deleted');
    return true;
  };
  D.updateSong = async function (song, fields) {
    const c = MX.ctx(); if (!c) return null;
    const row = await MX.api('PATCH', '/api/music/' + song.id, Object.assign({ coupleId: c.coupleId, viewer: c.role }, fields));
    Object.keys(row || {}).forEach((k) => { if (k !== 'lyrics' || fields.lyrics !== undefined) song[k] = row[k]; });
    MX.emit('library'); MX.rt.ping('songs');
    return song;
  };
  /* Make sure `song.lyrics` is loaded (the list endpoint omits it). */
  D.ensureFullSong = async function (song) {
    if (!song || song.lyrics !== undefined || song._full || song.has_lyrics === false) return song;
    const c = MX.ctx(); if (!c) return song;
    try {
      const full = await MX.api('GET', '/api/music/song/' + song.id + '?coupleId=' + encodeURIComponent(c.coupleId) + '&viewer=' + c.role);
      song.lyrics = full.lyrics || ''; song.lyrics_latin = full.lyrics_latin || null; song._full = true;
    } catch (e) { /* offline or missing — leave as is */ }
    return song;
  };

  /* playlists */
  const needPl = () => { if (!S.playlistsAvailable) { MX.toast('Playlists need a quick database update — see migrations/music_v2.sql'); return false; } return true; };
  D.createPlaylist = async function (name, songIds) {
    if (!needPl()) return null; const c = MX.ctx();
    try {
      const pl = await MX.api('POST', '/api/music/playlists', { coupleId: c.coupleId, viewer: c.role, name, songIds: songIds || [] });
      S.playlists.push(pl); MX.emit('playlists'); MX.rt.ping('songs'); return pl;
    } catch (e) { MX.toast(e.code === 'MIGRATION_REQUIRED' ? 'Playlists need a quick database update' : 'Could not create playlist — ' + e.message); return null; }
  };
  D.renamePlaylist = async function (pl, name) {
    const c = MX.ctx();
    try { await MX.api('PATCH', '/api/music/playlists/' + pl.id, { coupleId: c.coupleId, name }); pl.name = name; MX.emit('playlists'); MX.rt.ping('songs'); return true; }
    catch (e) { MX.toast('Could not rename — ' + e.message); return false; }
  };
  D.deletePlaylist = async function (pl) {
    const ok = await MX.confirm({ title: 'Delete “' + pl.name + '”?', message: 'The songs stay in your library — only the playlist is removed.', confirm: 'Delete', danger: true });
    if (!ok) return false; const c = MX.ctx();
    try { await MX.api('DELETE', '/api/music/playlists/' + pl.id, { coupleId: c.coupleId }); S.playlists = S.playlists.filter((p) => p.id !== pl.id); MX.emit('playlists'); MX.rt.ping('songs'); return true; }
    catch (e) { MX.toast('Could not delete — ' + e.message); return false; }
  };
  D.addToPlaylist = async function (pl, songIds) {
    const c = MX.ctx();
    try {
      const r = await MX.api('POST', '/api/music/playlists/' + pl.id + '/songs', { coupleId: c.coupleId, viewer: c.role, songIds });
      (songIds || []).forEach((id) => { if (!pl.song_ids.includes(String(id))) pl.song_ids.push(String(id)); });
      MX.emit('playlists'); MX.rt.ping('songs'); return r;
    } catch (e) { MX.toast('Could not add — ' + e.message); return null; }
  };
  D.removeFromPlaylist = async function (pl, songId) {
    const c = MX.ctx();
    try { await MX.api('DELETE', '/api/music/playlists/' + pl.id + '/songs/' + songId, { coupleId: c.coupleId }); pl.song_ids = pl.song_ids.filter((id) => String(id) !== String(songId)); MX.emit('playlists'); MX.rt.ping('songs'); return true; }
    catch (e) { MX.toast('Could not remove — ' + e.message); return false; }
  };
  D.reorderPlaylist = async function (pl, ids) {
    const c = MX.ctx(); const prev = pl.song_ids; pl.song_ids = ids; MX.emit('playlists');
    try { await MX.api('PUT', '/api/music/playlists/' + pl.id + '/order', { coupleId: c.coupleId, songIds: ids }); MX.rt.ping('songs'); }
    catch (e) { pl.song_ids = prev; MX.emit('playlists'); MX.toast('Could not reorder'); }
  };

  /* ═══════════════════════════════════════════════════════
     REALTIME — one broadcast channel per couple. It carries no data,
     only a "something changed, refetch" nudge; a slow poll is the safety net.
  ═══════════════════════════════════════════════════════ */
  const SB_URL = 'https://jmhsyhpmuszyphwjfcuk.supabase.co';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImptaHN5aHBtdXN6eXBod2pmY3VrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5NzAzODIsImV4cCI6MjA5OTU0NjM4Mn0.hXmVIoESJ5SkbhIaN-UyWLbJ4XdvZD_dd7U2WzFfvNI';
  let sb = null, chan = null, pollT = null;
  const refetch = {
    songs: MX.debounce(() => { D.loadSongs(true); D.loadPlaylists(); }, 500),
    recordings: MX.debounce(() => D.loadRecordings(), 500),
  };
  MX.rt = {
    start() {
      const c = MX.ctx(); if (!c || chan) return;
      try {
        if (window.supabase && window.supabase.createClient) {
          sb = window.supabase.createClient(SB_URL, SB_KEY);
          chan = sb.channel('music_sync:' + c.coupleId, { config: { broadcast: { self: false } } })
            .on('broadcast', { event: 'music_changed' }, () => refetch.songs())
            .on('broadcast', { event: 'recordings_changed' }, () => refetch.recordings())
            .subscribe();
        }
      } catch (e) { console.warn('[music] realtime unavailable', e); chan = null; }
      clearInterval(pollT);
      pollT = setInterval(() => { if (document.hidden || !MX.online()) return; D.loadSongs(true); D.loadPlaylists(); }, chan ? 90000 : 25000);
    },
    ping(kind) {
      if (!chan) return;
      const ev = kind === 'recordings' ? 'recordings_changed' : 'music_changed';
      try { chan.send({ type: 'broadcast', event: ev, payload: {} }); } catch (e) {}
    },
    stop() { try { if (sb && chan) sb.removeChannel(chan); } catch (e) {} chan = null; clearInterval(pollT); },
  };
  window.addEventListener('pagehide', () => MX.rt.stop());
  window.addEventListener('online', () => { MX.emit('connectivity', true); D.loadAll(); });
  window.addEventListener('offline', () => MX.emit('connectivity', false));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && MX.ctx() && S.loaded.songs) D.loadSongs(true); });

  /* ═══════════════════════════════════════════════════════
     Compatibility surface for scripts that stay as they are.
  ═══════════════════════════════════════════════════════ */
  Object.defineProperty(window, 'Store', { configurable: true, get: () => S }); // import-service pushes into Store.songs
  window.MusicPlayer = {
    toast: (m) => MX.toast(m), escH: MX.esc, fmtTime: MX.fmt, getCoupleCtx: MX.ctx, api: MX.api,
    get Store() { return S; }, loadSongs: () => D.loadSongs(true),
  };
  window.renderMusicTracks = () => MX.emit('library');
  // The import pipeline calls this after saving a song.
  window.checkAchievements = () => MX.emit('milestones');
})();
