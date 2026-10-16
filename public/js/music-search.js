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

  /* ── styles ────────────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('th-ms-styles')) return;
    const s = document.createElement('style');
    s.id = 'th-ms-styles';
    s.textContent = `
      #th-ms-modal { position: fixed; inset: 0; z-index: 2147483645; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.75); backdrop-filter: blur(8px); opacity: 0; pointer-events: none; transition: opacity .25s ease; padding: 20px; }
      #th-ms-modal.open { opacity: 1; pointer-events: auto; }
      #th-ms-modal .th-ms-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
      #th-ms-modal .th-ms-shell { position: relative; z-index: 2; width: 100%; max-width: 460px; max-height: 90vh; display: flex; flex-direction: column; background: rgba(18,6,13,0.94); border: 1px solid rgba(255,255,255,0.12); border-radius: 20px; box-shadow: 0 24px 60px rgba(0,0,0,0.55); overflow: hidden; }
      #th-ms-modal .th-ms-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; background: rgba(255,255,255,0.06); border-bottom: 1px solid rgba(255,255,255,0.1); flex-shrink: 0; }
      #th-ms-modal .th-ms-title { color: #fff; font-size: 17px; font-weight: 600; margin: 0; font-family: 'Inter', system-ui, sans-serif; }
      #th-ms-modal .th-ms-close { background: none; border: none; color: rgba(255,255,255,0.7); font-size: 22px; cursor: pointer; padding: 4px 10px; border-radius: 8px; }
      #th-ms-modal .th-ms-close:hover { background: rgba(255,255,255,0.12); color: #fff; }
      #th-ms-modal .th-ms-body { flex: 1; overflow-y: auto; padding: 16px 20px 0; }
      #th-ms-modal .th-ms-searchbar { display: flex; gap: 10px; margin-bottom: 16px; position: sticky; top: 0; background: rgba(18,6,13,0.94); z-index: 10; padding-bottom: 12px; }
      #th-ms-modal .th-ms-searchbar input { flex: 1; border: 1px solid rgba(255,255,255,0.15); border-radius: 12px; padding: 11px 16px; background: rgba(255,255,255,0.04); color: #fff; font-size: 14px; outline: none; }
      #th-ms-modal .th-ms-searchbar input:focus { border-color: hsl(322,100%,62%); box-shadow: 0 0 0 3px hsla(322,100%,62%,0.2); }
      #th-ms-modal .th-ms-searchbar button { background: hsl(322,100%,62%); border: none; border-radius: 12px; width: 44px; height: 44px; color: #fff; font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
      #th-ms-modal .th-ms-empty, #th-ms-modal .th-ms-loading { text-align: center; padding: 60px 20px; color: rgba(255,255,255,0.55); font-size: 14px; }
      #th-ms-modal .th-ms-empty .ico, #th-ms-modal .th-ms-loading .ico { font-size: 42px; margin-bottom: 10px; opacity: 0.5; }
      #th-ms-modal .th-ms-list { display: flex; flex-direction: column; gap: 8px; }
      #th-ms-modal .th-ms-item { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 14px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); cursor: pointer; transition: all .18s; position: relative; }
      #th-ms-modal .th-ms-item:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.18); transform: translateY(-1px); }
      #th-ms-modal .th-ms-item.selected { background: linear-gradient(135deg, hsla(322,100%,62%,0.18), hsla(322,100%,62%,0.08)); border-color: hsl(322,100%,62%); box-shadow: 0 0 20px hsla(322,100%,62%,0.25); }
      #th-ms-modal .th-ms-item-art { width: 48px; height: 48px; border-radius: 10px; background: rgba(255,255,255,0.08); flex-shrink: 0; object-fit: cover; }
      #th-ms-modal .th-ms-item-info { flex: 1; min-width: 0; }
      #th-ms-modal .th-ms-item-title { color: #fff; font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px; }
      #th-ms-modal .th-ms-item-artist { color: rgba(255,255,255,0.55); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #th-ms-modal .th-ms-item-duration { color: rgba(255,255,255,0.4); font-size: 11px; margin-left: auto; }
      #th-ms-modal .th-ms-item-check { width: 22px; height: 22px; border-radius: 6px; border: 2px solid rgba(255,255,255,0.2); background: transparent; color: #fff; font-size: 13px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; opacity: 0; transition: all .18s; }
      #th-ms-modal .th-ms-item.selected .th-ms-item-check { opacity: 1; border-color: hsl(322,100%,62%); background: hsl(322,100%,62%); }
      #th-ms-modal .th-ms-footer { padding: 16px 20px; border-top: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.04); flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; }
      #th-ms-modal .th-ms-btn-add { padding: 10px 24px; border-radius: 12px; background: linear-gradient(135deg, hsl(322,100%,62%), hsl(322,95%,50%)); color: #fff; border: none; font-size: 14px; font-weight: 700; cursor: pointer; opacity: 0.5; pointer-events: none; transition: all .2s; box-shadow: 0 6px 20px hsla(322,100%,62%,0.3); }
      #th-ms-modal .th-ms-btn-add.ready { opacity: 1; pointer-events: auto; }
      #th-ms-modal .th-ms-btn-add.ready:hover { filter: brightness(1.1); transform: translateY(-1px); }
      #th-ms-modal .th-ms-cancel { background: none; border: none; color: rgba(255,255,255,0.7); font-size: 14px; cursor: pointer; }
      #th-ms-modal .th-ms-cancel:hover { color: #fff; }
      #th-ms-modal .th-ms-lyrics-preview { margin-top: 14px; padding: 12px 16px; border-radius: 12px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); font-size: 12.5px; color: rgba(255,255,255,0.75); line-height: 1.6; max-height: 120px; overflow-y: auto; display: none; }
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
        <div class="th-ms-footer"><button class="th-ms-cancel" onclick="window.MusicSearch.close()">Cancel</button><button class="th-ms-btn-add" id="th-ms-btn-add" onclick="window.MusicSearch.addSelected()">Add to Library → Get Lyrics</button></div>
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
      const r = await fetch(`${DEEZER}/search?q=${encodeURIComponent(query)}&limit=${SEARCH_LIMIT}`, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error('Search failed');
      const data = await r.json();
      currentResults = (data.data || []).map(track => ({ id: 'deezer_' + track.id, title: track.title, artist: track.artist ? track.artist.name : 'Unknown Artist', album: track.album ? track.album.title : '', duration: track.duration || 0, cover: track.album ? track.album.cover_medium : '', preview: track.preview || null, deezerId: track.id, deezerLink: track.link || '', source: 'deezer' }));
      renderResults();
    } catch (e) { console.error('[music-search] Deezer search failed:', e.message); loadingEl.style.display = 'none'; emptyEl.innerHTML = '<div class="ico">⚠️</div><div>Search unavailable — try again</div>'; emptyEl.style.display = 'block'; } finally { loadingEl.style.display = 'none'; }
  }

  function renderResults() {
    const listEl = document.getElementById('th-ms-list');
    const emptyEl = document.getElementById('th-ms-empty');
    const addBtn = document.getElementById('th-ms-btn-add');
    if (!currentResults.length) { emptyEl.innerHTML = '<div class="ico">😕</div><div>No songs found</div>'; emptyEl.style.display = 'block'; listEl.innerHTML = ''; addBtn.classList.remove('ready'); return; }
    emptyEl.style.display = 'none';
    listEl.innerHTML = currentResults.map((t, i) => `<div class="th-ms-item${i === 0 ? ' selected' : ''}" data-idx="${i}" onclick="window.MusicSearch.select(${i})">${t.cover ? '<img class="th-ms-item-art" src="' + esc(t.cover) + '" alt="">' : '<div class="th-ms-item-art">🎵</div>'}<div class="th-ms-item-info"><div class="th-ms-item-title">' + esc(t.title) + '</div><div class="th-ms-item-meta">' + (t.year ? esc(t.year) + ' • ' : '') + (t.rating ? '⭐ ' + esc(t.rating) + '/10' : '') + '</div></div><div class="th-ms-item-duration">' + fmtDuration(t.duration) + '</div><div class="th-ms-item-check">' + (selectedSongId === t.id ? '<i>✓</i>' : '') + '</div></div>`).join('');
    if (selectedSongId === null && currentResults.length) select(0);
  }

  function select(idx) { selectedSongId = currentResults[idx].id; document.querySelectorAll('#th-ms-list .th-ms-item').forEach((el, i) => { el.classList.toggle('selected', i === idx); const c = el.querySelector('.th-ms-item-check'); if (c) c.innerHTML = i === idx ? '<i>✓</i>' : ''; }); document.getElementById('th-ms-btn-add').classList.add('ready'); fetchLyricsPreview(currentResults[idx]); }

  async function fetchLyricsPreview(track) {
    const lyricsPrev = document.getElementById('th-ms-lyrics-preview'); const lyricsText = document.getElementById('th-ms-lyrics-text'); lyricsPrev.style.display = 'none'; lyricsText.textContent = '';
    try { const r = await fetch(`${API_BASE}/api/lyrics/auto-fetch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: track.title, artist: track.artist, album: track.album, durationSec: track.duration, filename: track.title + '.mp3' }) }); if (r.ok) { const data = await r.json(); if (data.found && (data.lrcNative || data.lrc || data.lyricsNative || data.lyrics)) { lyricsText.textContent = (data.lrcNative || data.lrc || data.lyricsNative || data.lyrics).slice(0, 800); lyricsPrev.style.display = 'block'; } } } catch (e) { /* silent */ }
  }

  function fmtDuration(s) { if (!s) return '--:--'; const m = Math.floor(s / 60), sec = Math.floor(s % 60); return m + ':' + String(sec).padStart(2, '0'); }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  async function addSelected() {
    if (!selectedSongId) return;
    const track = currentResults.find((t) => t.id === selectedSongId); if (!track) return;
    const addBtn = document.getElementById('th-ms-btn-add'); addBtn.disabled = true; addBtn.textContent = 'Adding…';
    try {
      const c = window.MX && window.MX.ctx ? window.MX.ctx() : null;
      const coupleId = c ? c.coupleId : null;
      const r = await fetch(`${API_BASE}/api/music`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: track.title, artist: track.artist, album: track.album, audio_url: track.preview || track.deezerLink, cover_url: track.cover, duration_sec: track.duration, source: 'deezer', external_id: track.deezerId, coupleId: coupleId, visibility: 'both' }) }); if (!r.ok) throw new Error('Backend add failed'); const data = await r.json(); const songId = data.songId || data.id;
      if (window.LyricsBackgroundWorker && songId) { window.LyricsBackgroundWorker.enqueue({ id: songId, title: track.title, artist: track.artist, album: track.album, duration_sec: track.duration, couple_id: coupleId }, coupleId); }
      if (typeof toast === 'function') toast('Added "' + esc(track.title) + '" — lyrics loading…', 'success');
      if (window.MX && window.MX.emit) window.MX.emit('library');
      close();
    } catch (e) { console.error('[music-search] add failed:', e); if (typeof toast === 'function') toast('Could not add song — try again', 'error'); } finally { addBtn.disabled = false; addBtn.textContent = 'Add to Library → Get Lyrics'; }
  }

  function open() { buildModal(); document.getElementById('th-ms-modal').classList.add('open'); const input = document.getElementById('th-ms-q'); input.value = ''; input.focus(); showEmpty(); document.getElementById('th-ms-btn-add').classList.remove('ready'); selectedSongId = null; document.getElementById('th-ms-lyrics-preview').style.display = 'none'; }
  function close() { const m = document.getElementById('th-ms-modal'); if (m) m.classList.remove('open'); }

  global.MusicSearch = { open, close, select, addSelected, search };
})(window);
