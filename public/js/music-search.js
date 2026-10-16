/* ════════════════════════════════════════════════════════════════
   Twin Hearts — Music Search & Instant Lyrics
   Search songs online (Deezer API — free, no API key), download/add
   to your library, and get lyrics instantly via your existing
   backend /api/lyrics/auto-fetch endpoint.
   Include via: <script src="/js/music-search.js"></script>
 ═════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {
  // Resolve API base URL — try multiple sources for iframe compatibility
  let API_BASE = 'https://us-app-av6d.onrender.com';
  try {
    if (window.parent && window.parent.API) API_BASE = window.parent.API;
    else if (window.API) API_BASE = window.API;
  } catch (e) { /* fallback to default */ }

  const DEEZER = 'https://api.deezer.com';
  const SEARCH_LIMIT = 25;

  let currentResults = [];
  let selectedSongId = null;
  let adding = false;

  /* ── styles ────────────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('th-ms-styles')) return;
    const s = document.createElement('style');
    s.id = 'th-ms-styles';
    s.textContent = `
      #th-ms-modal { --th-clear: var(--us-nav-clear, calc(104px + env(safe-area-inset-bottom, 0px))); position: fixed; inset: 0; z-index: 2147483645; display: flex; align-items: flex-start; justify-content: center; background: rgba(0,0,0,0.75); backdrop-filter: blur(8px); opacity: 0; pointer-events: none; transition: opacity .25s ease; padding: calc(12px + env(safe-area-inset-top, 0px)) 14px var(--th-clear); box-sizing: border-box; height: var(--th-vh, 100dvh); }
      #th-ms-modal.open { opacity: 1; pointer-events: auto; }
      #th-ms-modal .th-ms-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
      #th-ms-modal .th-ms-shell { position: relative; z-index: 2; width: 100%; max-width: 460px; max-height: 100%; display: flex; flex-direction: column; background: rgba(18,6,13,0.96); border: 1px solid rgba(255,255,255,0.12); border-radius: 20px; box-shadow: 0 24px 60px rgba(0,0,0,0.55); overflow: hidden; margin-top: 4px; }
      #th-ms-modal .th-ms-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; background: rgba(255,255,255,0.06); border-bottom: 1px solid rgba(255,255,255,0.1); flex-shrink: 0; }
      #th-ms-modal .th-ms-title { color: #fff; font-size: 17px; font-weight: 600; margin: 0; font-family: 'Inter', system-ui, sans-serif; }
      #th-ms-modal .th-ms-close { background: none; border: none; color: rgba(255,255,255,0.7); font-size: 22px; cursor: pointer; padding: 4px 10px; border-radius: 8px; }
      #th-ms-modal .th-ms-close:hover { background: rgba(255,255,255,0.12); color: #fff; }
      #th-ms-modal .th-ms-body { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 14px 16px 16px; }
      #th-ms-modal .th-ms-searchbar { display: flex; align-items: center; gap: 10px; margin: 0 0 12px; position: sticky; top: -14px; padding: 14px 0 10px; background: rgba(18,6,13,0.96); z-index: 10; }
      #th-ms-modal .th-ms-searchbar input { flex: 1; min-width: 0; height: 44px; box-sizing: border-box; border: 1px solid rgba(255,255,255,0.15); border-radius: 12px; padding: 0 14px; background: rgba(255,255,255,0.05); color: #fff; font-size: 16px; outline: none; }
      #th-ms-modal .th-ms-searchbar input:focus { border-color: hsl(322,100%,62%); box-shadow: 0 0 0 3px hsla(322,100%,62%,0.2); }
      #th-ms-modal .th-ms-searchbar button { flex: 0 0 44px; background: hsl(322,100%,62%); border: none; border-radius: 12px; width: 44px; height: 44px; color: #fff; font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
      #th-ms-modal .th-ms-empty, #th-ms-modal .th-ms-loading { text-align: center; padding: 60px 20px; color: rgba(255,255,255,0.55); font-size: 14px; }
      #th-ms-modal .th-ms-empty .ico, #th-ms-modal .th-ms-loading .ico { font-size: 42px; margin-bottom: 10px; opacity: 0.5; }
      #th-ms-modal .th-ms-list { display: flex; flex-direction: column; gap: 8px; }
      #th-ms-modal .th-ms-item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 14px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); cursor: pointer; transition: background .18s, border-color .18s; position: relative; -webkit-tap-highlight-color: transparent; }
      #th-ms-modal .th-ms-item:active { background: rgba(255,255,255,0.08); }
      #th-ms-modal .th-ms-item-art-ph { display: flex; align-items: center; justify-content: center; font-size: 22px; }
      #th-ms-modal .th-ms-item.selected { background: linear-gradient(135deg, hsla(322,100%,62%,0.18), hsla(322,100%,62%,0.08)); border-color: hsl(322,100%,62%); box-shadow: 0 0 20px hsla(322,100%,62%,0.25); }
      #th-ms-modal .th-ms-item-art { width: 48px; height: 48px; border-radius: 10px; background: rgba(255,255,255,0.08); flex-shrink: 0; object-fit: cover; }
      #th-ms-modal .th-ms-item-info { flex: 1; min-width: 0; }
      #th-ms-modal .th-ms-item-title { color: #fff; font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px; }
      #th-ms-modal .th-ms-item-artist { color: rgba(255,255,255,0.55); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #th-ms-modal .th-ms-item-duration { color: rgba(255,255,255,0.45); font-size: 11px; flex-shrink: 0; font-variant-numeric: tabular-nums; }
      #th-ms-modal .th-ms-item-check { width: 22px; height: 22px; border-radius: 6px; border: 2px solid rgba(255,255,255,0.2); background: transparent; color: #fff; font-size: 13px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all .18s; }
      #th-ms-modal .th-ms-item.selected .th-ms-item-check { opacity: 1; border-color: hsl(322,100%,62%); background: hsl(322,100%,62%); }
      #th-ms-modal .th-ms-footer { padding: 12px 16px; border-top: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.04); flex-shrink: 0; display: flex; align-items: center; gap: 12px; }
      #th-ms-modal .th-ms-footer .th-ms-cancel { flex: 0 0 auto; padding: 10px 6px; }
      #th-ms-modal .th-ms-footer .th-ms-btn-add { flex: 1; }
      #th-ms-modal .th-ms-btn-add { padding: 12px 16px; border-radius: 12px; background: linear-gradient(135deg, hsl(322,100%,62%), hsl(322,95%,50%)); color: #fff; border: none; font-size: 14px; font-weight: 700; cursor: pointer; opacity: 0.45; pointer-events: none; transition: opacity .2s, filter .2s; box-shadow: 0 6px 20px hsla(322,100%,62%,0.3); white-space: nowrap; }
      #th-ms-modal .th-ms-btn-add.ready { opacity: 1; pointer-events: auto; }
      #th-ms-modal .th-ms-btn-add.ready:active { filter: brightness(1.1); }
      #th-ms-modal .th-ms-cancel { background: none; border: none; color: rgba(255,255,255,0.7); font-size: 14px; cursor: pointer; }
      #th-ms-modal .th-ms-cancel:hover { color: #fff; }
      #th-ms-modal .th-ms-lyrics-preview { margin-top: 12px; padding: 12px 16px; border-radius: 12px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); font-size: 12.5px; color: rgba(255,255,255,0.75); line-height: 1.6; max-height: 120px; overflow-y: auto; display: none; }
      #th-ms-modal .th-ms-lyrics-preview.show { display: block; }
      #th-ms-modal .th-ms-lyrics-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: hsl(322,100%,62%); margin-bottom: 6px; font-weight: 700; }
    `;
    document.head.appendChild(s);
  }

  function buildModal() {
    if (document.getElementById('th-ms-modal')) return;
    injectStyles();

    const html = `
      <div class="th-ms-backdrop" onclick="window.MusicSearch.close()"></div>
      <div class="th-ms-shell" role="dialog" aria-modal="true" aria-label="Search Songs">
        <div class="th-ms-header"><h2 class="th-ms-title">🎵 Search Songs</h2><button class="th-ms-close" onclick="window.MusicSearch.close()">✕</button></div>
        <div class="th-ms-body">
          <div class="th-ms-searchbar"><input type="search" id="th-ms-q" placeholder="Search any song…" autocomplete="off" spellcheck="false"><button type="button" id="th-ms-search-btn">🔍</button></div>
          <div id="th-ms-empty" class="th-ms-empty" style="display:none"><div class="ico">🔍</div><div>Search for any song to add to your library</div></div>
          <div id="th-ms-loading" class="th-ms-loading" style="display:none"><div class="ico">⏳</div><div>Finding songs…</div></div>
          <div class="th-ms-list" id="th-ms-list"></div>
          <div id="th-ms-lyrics-preview" class="th-ms-lyrics-preview"><div class="th-ms-lyrics-label">Lyrics Preview</div><div id="th-ms-lyrics-text"></div></div>
        </div>
        <div class="th-ms-footer"><button class="th-ms-cancel" onclick="window.MusicSearch.close()">Cancel</button><button class="th-ms-btn-add" id="th-ms-btn-add" onclick="window.MusicSearch.addSelected()">Add to Library</button></div>
      </div>
    `;
    const wrapper = document.createElement('div');
    wrapper.id = 'th-ms-modal';
    wrapper.innerHTML = html;
    document.body.appendChild(wrapper);
    bindEvents();
  }

  function bindEvents() {
    const input = document.getElementById('th-ms-q');
    const btn = document.getElementById('th-ms-search-btn');
    let tmr = null;
    input.addEventListener('input', (e) => { clearTimeout(tmr); tmr = setTimeout(() => { if (e.target.value.trim().length >= 2) search(e.target.value.trim()); else showEmpty(); }, 250); });
    btn.addEventListener('click', () => { if (input.value.trim().length >= 2) search(input.value.trim()); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.value.trim().length >= 2) search(input.value.trim()); });
  }

  function showEmpty() { document.getElementById('th-ms-empty').style.display = 'block'; document.getElementById('th-ms-list').innerHTML = ''; document.getElementById('th-ms-loading').style.display = 'none'; document.getElementById('th-ms-lyrics-preview').style.display = 'none'; document.getElementById('th-ms-btn-add').classList.remove('ready'); selectedSongId = null; }

  async function search(query) {
    const listEl = document.getElementById('th-ms-list');
    const emptyEl = document.getElementById('th-ms-empty');
    const loadingEl = document.getElementById('th-ms-loading');
    const lyricsPrev = document.getElementById('th-ms-lyrics-preview');
    const addBtn = document.getElementById('th-ms-btn-add');
    emptyEl.style.display = 'none'; loadingEl.style.display = 'block'; listEl.innerHTML = ''; lyricsPrev.style.display = 'none'; selectedSongId = null; addBtn.classList.remove('ready');
    try {
      // Resolve API base URL — try multiple sources for iframe compatibility
      let API_BASE = 'https://us-app-av6d.onrender.com';
      try {
        if (window.parent && window.parent.API) API_BASE = window.parent.API;
        else if (window.API) API_BASE = window.API;
      } catch (e) { /* fallback to default */ }

      const r = await fetch(`${API_BASE}/api/music/search?q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error('Search failed');
      const data = await r.json();
      currentResults = (data.results || []).map(track => ({ id: track.id, title: track.title, artist: track.artist, album: track.album, duration: track.duration || 0, cover: track.cover, preview: track.preview, deezerId: track.deezerId, deezerLink: track.deezerLink, source: 'deezer' }));
      renderResults();
    } catch (e) { console.error('[music-search] Deezer search failed:', e.message); loadingEl.style.display = 'none'; emptyEl.innerHTML = '<div class="ico">⚠️</div><div>Search unavailable — try again</div>'; emptyEl.style.display = 'block'; } finally { loadingEl.style.display = 'none'; }
  }

  function renderResults() {
    const listEl = document.getElementById('th-ms-list');
    const emptyEl = document.getElementById('th-ms-empty');
    const addBtn = document.getElementById('th-ms-btn-add');
    if (!currentResults.length) { emptyEl.innerHTML = '<div class="ico">😕</div><div>No songs found</div>'; emptyEl.style.display = 'block'; listEl.innerHTML = ''; addBtn.classList.remove('ready'); return; }
    emptyEl.style.display = 'none';
    listEl.innerHTML = currentResults.map((t, i) => {
      const art = t.cover
        ? `<img class="th-ms-item-art" src="${esc(t.cover)}" alt="" loading="lazy">`
        : `<div class="th-ms-item-art th-ms-item-art-ph">🎵</div>`;
      const meta = [t.artist, t.album].filter(Boolean).map(esc).join(' • ');
      return `<div class="th-ms-item${i === 0 ? ' selected' : ''}" data-idx="${i}" onclick="window.MusicSearch.select(${i})">`
        + art
        + `<div class="th-ms-item-info"><div class="th-ms-item-title">${esc(t.title)}</div><div class="th-ms-item-artist">${meta}</div></div>`
        + `<div class="th-ms-item-duration">${t.preview ? '30s preview' : fmtDuration(t.duration)}</div>`
        + `<div class="th-ms-item-check">${i === 0 ? '✓' : ''}</div>`
        + `</div>`;
    }).join('');
    if (selectedSongId === null && currentResults.length) select(0);
  }

  function select(idx) { selectedSongId = currentResults[idx].id; document.querySelectorAll('#th-ms-list .th-ms-item').forEach((el, i) => { el.classList.toggle('selected', i === idx); const c = el.querySelector('.th-ms-item-check'); if (c) c.textContent = i === idx ? '✓' : ''; }); document.getElementById('th-ms-btn-add').classList.add('ready'); fetchLyricsPreview(currentResults[idx]); }

  async function fetchLyricsPreview(track) {
    const lyricsPrev = document.getElementById('th-ms-lyrics-preview'); const lyricsText = document.getElementById('th-ms-lyrics-text'); lyricsPrev.style.display = 'none'; lyricsText.textContent = '';
    try { const r = await fetch(`${API_BASE}/api/lyrics/auto-fetch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: track.title, artist: track.artist, album: track.album, durationSec: track.duration, filename: track.title + '.mp3' }) }); if (r.ok) { const data = await r.json(); if (data.found && (data.lrcNative || data.lrc || data.lyricsNative || data.lyrics)) { lyricsText.textContent = (data.lrcNative || data.lrc || data.lyricsNative || data.lyrics).slice(0, 800); lyricsPrev.style.display = 'block'; } } } catch (e) { /* silent */ }
  }

  function fmtDuration(s) { if (!s) return '--:--'; const m = Math.floor(s / 60), sec = Math.floor(s % 60); return m + ':' + String(sec).padStart(2, '0'); }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  async function addSelected() {
    if (adding || !selectedSongId) return;
    const track = currentResults.find((t) => t.id === selectedSongId); if (!track) return;
    adding = true;
    const addBtn = document.getElementById('th-ms-btn-add'); addBtn.disabled = true; addBtn.textContent = 'Adding…';
    const say = (m) => { try { if (window.MX && window.MX.toast) window.MX.toast(m); else if (typeof toast === 'function') toast(m); } catch (_) {} };
    try {
      const c = window.MX && window.MX.ctx ? window.MX.ctx() : null;
      if (!c || !c.coupleId) throw new Error('Not signed in / not paired');
      const audio = track.preview || track.deezerLink;
      if (!audio) throw new Error('No playable audio for this song');
      const r = await fetch(`${API_BASE}/api/music`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        coupleId: c.coupleId, uploadedBy: c.role, viewer: c.role, visibility: 'both',
        title: track.title, artist: track.artist, album: track.album,
        audioUrl: audio, coverUrl: track.cover || null, durationSec: track.preview ? 30 : track.duration,
        source: 'deezer', externalId: track.deezerId
      }), signal: AbortSignal.timeout(45000) });
      if (!r.ok) { let msg = 'Backend add failed (' + r.status + ')'; try { const j = await r.json(); if (j && j.error) msg = j.error; } catch (_) {} throw new Error(msg); }
      const data = await r.json(); const songId = data.id || data.songId;
      if (window.LyricsBackgroundWorker && songId) { try { window.LyricsBackgroundWorker.enqueue({ id: songId, title: track.title, artist: track.artist, album: track.album, duration_sec: track.duration, couple_id: c.coupleId }, c.coupleId); } catch (_) {} }
      close();
      say('Added "' + track.title + '" to your library');
      try { if (window.MX && window.MX.data && window.MX.data.loadSongs) window.MX.data.loadSongs(true); else if (window.MX && window.MX.emit) window.MX.emit('library'); } catch (_) {}
      try { if (window.MX && window.MX.rt && window.MX.rt.ping) window.MX.rt.ping('songs'); } catch (_) {}
    } catch (e) { console.error('[music-search] add failed:', e); say('Could not add song — ' + (e.message || 'try again')); } finally { adding = false; addBtn.disabled = false; addBtn.textContent = 'Add to Library'; }
  }

  function syncViewport() {
    const m = document.getElementById('th-ms-modal'); if (!m) return;
    const vv = window.visualViewport;
    m.style.setProperty('--th-vh', (vv ? vv.height : window.innerHeight) + 'px');
  }
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', syncViewport); window.visualViewport.addEventListener('scroll', syncViewport); }

  function open() { buildModal(); syncViewport(); document.getElementById('th-ms-modal').classList.add('open'); const input = document.getElementById('th-ms-q'); input.value = ''; input.focus(); showEmpty(); document.getElementById('th-ms-btn-add').classList.remove('ready'); selectedSongId = null; document.getElementById('th-ms-lyrics-preview').style.display = 'none'; }
  function close() { const m = document.getElementById('th-ms-modal'); if (m) m.classList.remove('open'); }

  global.MusicSearch = { open, close, select, addSelected, search };
})(window);
