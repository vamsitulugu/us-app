/* ════════════════════════════════════════════════════════════════
   Twin Hearts — Movie Search & Metadata (TMDB)
   Search movies from TMDB (free API), view details, streaming providers,
   and add to your couple's watchlist / favorites.
   Include via: <script src="/js/movie-search-ui.js"></script>
 ═════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {
  const API = (function () {
    try { return window.parent?.API || window.API || 'https://us-app-av6d.onrender.com'; }
    catch (e) { return 'https://us-app-av6d.onrender.com'; }
  })();

  let modal = null;
  let currentResults = [];
  let selectedMovie = null;
  let onAddCallback = null;

  function injectStyles() {
    if (document.getElementById('th-mv-search-styles')) return;
    const s = document.createElement('style');
    s.id = 'th-mv-search-styles';
    s.textContent = `
      #th-msv-modal {
        position: fixed; inset: 0; z-index: 2147483645;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,0.75); backdrop-filter: blur(8px);
        opacity: 0; pointer-events: none; transition: opacity .25s ease;
        padding: 20px;
      }
      #th-msv-modal.open { opacity: 1; pointer-events: auto; }
      #th-msv-modal .th-msv-backdrop {
        position: absolute; inset: 0; background: rgba(0,0,0,0.6);
        backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      }
      #th-msv-modal .th-msv-shell {
        position: relative; z-index: 2;
        width: 100%; max-width: 480px; max-height: 90vh;
        display: flex; flex-direction: column;
        background: rgba(18,6,13,0.94); border: 1px solid rgba(255,255,255,0.12);
        border-radius: 20px; box-shadow: 0 24px 60px rgba(0,0,0,0.55);
        overflow: hidden;
      }
      #th-msv-modal .th-msv-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 16px 20px; background: rgba(255,255,255,0.06);
        border-bottom: 1px solid rgba(255,255,255,0.1); flex-shrink: 0;
      }
      #th-msv-modal .th-msv-title { color: #fff; font-size: 17px; font-weight: 600; margin: 0; font-family: 'Inter', system-ui, sans-serif; }
      #th-msv-modal .th-msv-close { background: none; border: none; color: rgba(255,255,255,0.7); font-size: 22px; cursor: pointer; padding: 4px 10px; border-radius: 8px; }
      #th-msv-modal .th-msv-close:hover { background: rgba(255,255,255,0.12); color: #fff; }

      #th-msv-modal .th-msv-body { flex: 1; overflow-y: auto; padding: 16px 20px 0; }
      #th-msv-modal .th-msv-searchbar {
        display: flex; gap: 10px; margin-bottom: 16px; position: sticky; top: 0; background: rgba(18,6,13,0.94); z-index: 10; padding-bottom: 12px;
      }
      #th-msv-modal .th-msv-searchbar input {
        flex: 1; border: 1px solid rgba(255,255,255,0.15); border-radius: 12px; padding: 11px 16px; background: rgba(255,255,255,0.04); color: #fff; font-size: 14px; outline: none;
      }
      #th-msv-modal .th-msv-searchbar input:focus { border-color: hsl(322,100%,62%); box-shadow: 0 0 0 3px hsla(322,100%,62%,0.2); }
      #th-msv-modal .th-msv-searchbar button { background: hsl(322,100%,62%); border: none; border-radius: 12px; width: 44px; height: 44px; color: #fff; font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; }

      #th-msv-modal .th-msv-empty, #th-msv-modal .th-msv-loading {
        text-align: center; padding: 60px 20px; color: rgba(255,255,255,0.55); font-size: 14px;
      }
      #th-msv-modal .th-msv-empty .ico, #th-msv-modal .th-msv-loading .ico { font-size: 42px; margin-bottom: 10px; opacity: 0.5; }

      #th-msv-modal .th-msv-list { display: flex; flex-direction: column; gap: 8px; }
      #th-msv-modal .th-msv-item {
        display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 14px;
        background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
        cursor: pointer; transition: all .18s; position: relative;
      }
      #th-msv-modal .th-msv-item:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.18); transform: translateY(-1px); }
      #th-msv-modal .th-msv-item.selected { background: linear-gradient(135deg, hsla(322,100%,62%,0.18), hsla(322,100%,62%,0.08)); border-color: hsl(322,100%,62%); box-shadow: 0 0 20px hsla(322,100%,62%,0.25); }
      #th-msv-modal .th-msv-item-art { width: 48px; height: 48px; border-radius: 10px; background: rgba(255,255,255,0.08); flex-shrink: 0; object-fit: cover; }
      #th-msv-modal .th-msv-item-info { flex: 1; min-width: 0; }
      #th-msv-modal .th-msv-item-title { color: #fff; font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px; }
      #th-msv-modal .th-msv-item-meta { color: rgba(255,255,255,0.55); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #th-msv-modal .th-msv-item-check { width: 22px; height: 22px; border-radius: 6px; border: 2px solid rgba(255,255,255,0.2); background: transparent; color: #fff; font-size: 13px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; opacity: 0; transition: all .18s; }
      #th-msv-modal .th-msv-item.selected .th-msv-item-check { opacity: 1; border-color: hsl(322,100%,62%); background: hsl(322,100%,62%); }

      #th-msv-modal .th-msv-details {
        padding: 16px 20px; border-top: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.04); flex-shrink: 0; max-height: 200px; overflow-y: auto;
      }
      #th-msv-modal .th-msv-details.hidden { display: none; }
      #th-msv-modal .th-msv-details-title { color: #fff; font-size: 16px; font-weight: 700; margin: 0 0 6px; }
      #th-msv-modal .th-msv-details-meta { color: rgba(255,255,255,0.6); font-size: 12px; margin-bottom: 8px; }
      #th-msv-modal .th-msv-details-overview { color: rgba(255,255,255,0.75); font-size: 13px; line-height: 1.5; margin-bottom: 10px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
      #th-msv-modal .th-msv-providers { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
      #th-msv-modal .th-msv-provider {
        display: flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 20px;
        background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
        font-size: 11px; color: #fff;
      }
      #th-msv-modal .th-msv-provider img { width: 16px; height: 16px; border-radius: 3px; }

      #th-msv-modal .th-msv-footer {
        padding: 16px 20px; border-top: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.04); flex-shrink: 0;
        display: flex; align-items: center; justify-content: space-between;
      }
      #th-msv-modal .th-msv-btn-add {
        padding: 10px 24px; border-radius: 12px; background: linear-gradient(135deg, hsl(322,100%,62%), hsl(322,95%,50%));
        color: #fff; border: none; font-size: 14px; font-weight: 700; cursor: pointer; opacity: 0.5; pointer-events: none;
        transition: all .2s; box-shadow: 0 6px 20px hsla(322,100%,62%,0.3);
      }
      #th-msv-modal .th-msv-btn-add.ready { opacity: 1; pointer-events: auto; }
      #th-msv-modal .th-msv-btn-add.ready:hover { filter: brightness(1.1); transform: translateY(-1px); }
      #th-msv-modal .th-msv-cancel { background: none; border: none; color: rgba(255,255,255,0.7); font-size: 14px; cursor: pointer; }
      #th-msv-modal .th-msv-cancel:hover { color: #fff; }

      @media (max-width: 600px) { #th-msv-modal { padding: 8px; } #th-msv-modal .th-msv-body { padding: 12px 16px 0; } #th-msv-modal .th-msv-footer { padding: 10px 16px; } }
    `;
    document.head.appendChild(s);
  }

  function buildModal() {
    if (document.getElementById('th-msv-modal')) return;
    injectStyles();

    const html = `
      <div class="th-msv-backdrop" onclick="window.MovieSearchUI.close()"></div>
      <div class="th-msv-shell" role="dialog" aria-modal="true" aria-label="Search Movies">
        <div class="th-msv-header">
          <h2 class="th-msv-title">🎬 Search Movies</h2>
          <button class="th-msv-close" onclick="window.MovieSearchUI.close()">✕</button>
        </div>
        <div class="th-msv-body">
          <div class="th-msv-searchbar">
            <input type="search" id="th-msv-q" placeholder="Search any movie…" autocomplete="off" spellcheck="false">
            <button type="button" id="th-msv-search-btn">🔍</button>
          </div>
          <div id="th-msv-empty" class="th-msv-empty" style="display:none">
            <div class="ico">🔍</div><div>Search for any movie to add to your list</div>
          </div>
          <div id="th-msv-loading" class="th-msv-loading" style="display:none">
            <div class="ico">⏳</div><div>Finding movies…</div>
          </div>
          <div class="th-msv-list" id="th-msv-list"></div>
          <div id="th-msv-details" class="th-msv-details hidden">
            <div class="th-msv-details-title" id="th-msv-details-title"></div>
            <div class="th-msv-details-meta" id="th-msv-details-meta"></div>
            <div class="th-msv-details-overview" id="th-msv-details-overview"></div>
            <div class="th-msv-providers" id="th-msv-providers"></div>
          </div>
        </div>
        <div class="th-msv-footer">
          <button class="th-msv-cancel" onclick="window.MovieSearchUI.close()">Cancel</button>
          <button class="th-msv-btn-add" id="th-msv-btn-add" onclick="window.MovieSearchUI.addSelected()">Add to My List</button>
        </div>
      </div>
    `;
    const wrapper = document.createElement('div');
    wrapper.id = 'th-msv-modal';
    wrapper.innerHTML = html;
    document.body.appendChild(wrapper);
    bindEvents();
  }

  function bindEvents() {
    const input = document.getElementById('th-msv-q');
    const btn = document.getElementById('th-msv-search-btn');
    let tmr = null;
    input.addEventListener('input', (e) => {
      clearTimeout(tmr);
      tmr = setTimeout(() => { if (e.target.value.trim().length >= 2) search(e.target.value.trim()); else showEmpty(); }, 250);
    });
    btn.addEventListener('click', () => { if (input.value.trim().length >= 2) search(input.value.trim()); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.value.trim().length >= 2) search(input.value.trim()); });
  }

  function showEmpty() {
    document.getElementById('th-msv-empty').style.display = 'block';
    document.getElementById('th-msv-list').innerHTML = '';
    document.getElementById('th-msv-loading').style.display = 'none';
    document.getElementById('th-msv-details').classList.add('hidden');
    document.getElementById('th-msv-btn-add').classList.remove('ready');
    selectedMovie = null;
  }

  async function search(query) {
    const listEl = document.getElementById('th-msv-list');
    const emptyEl = document.getElementById('th-msv-empty');
    const loadingEl = document.getElementById('th-msv-loading');
    const detailsEl = document.getElementById('th-msv-details');
    const addBtn = document.getElementById('th-msv-btn-add');
    emptyEl.style.display = 'none'; loadingEl.style.display = 'block'; listEl.innerHTML = ''; detailsEl.classList.add('hidden'); selectedMovie = null; addBtn.classList.remove('ready');
    try {
      const r = await fetch(`${API}/api/movie-search/search?q=${encodeURIComponent(query)}`);
      if (!r.ok) throw new Error('Search failed');
      const data = await r.json();
      currentResults = data.results || [];
      renderResults();
    } catch (e) {
      console.error('[movie-search-ui] search failed:', e.message);
      loadingEl.style.display = 'none';
      emptyEl.innerHTML = '<div class="ico">⚠️</div><div>Search unavailable — try again</div>';
      emptyEl.style.display = 'block';
    } finally { loadingEl.style.display = 'none'; }
  }

  function renderResults() {
    const listEl = document.getElementById('th-msv-list');
    const emptyEl = document.getElementById('th-msv-empty');
    const addBtn = document.getElementById('th-msv-btn-add');
    if (!currentResults.length) {
      emptyEl.innerHTML = '<div class="ico">😕</div><div>No movies found</div>';
      emptyEl.style.display = 'block'; listEl.innerHTML = ''; addBtn.classList.remove('ready'); return;
    }
    emptyEl.style.display = 'none';
    listEl.innerHTML = currentResults.map((m, i) => `
      <div class="th-msv-item${i === 0 ? ' selected' : ''}" data-idx="${i}" onclick="window.MovieSearchUI.select(${i})">
        ${m.poster_url ? '<img class="th-msv-item-art" src="' + esc(m.poster_url) + '" alt="">' : '<div class="th-msv-item-art">🎬</div>'}
        <div class="th-msv-item-info">
          <div class="th-msv-item-title">' + esc(m.title) + '</div>
          <div class="th-msv-item-meta">' + (m.year ? esc(m.year) + ' • ' : '') + (m.rating ? '⭐ ' + esc(m.rating) + '/10' : '') + '</div>
        </div>
        <div class="th-msv-item-check">' + (selectedMovie === m.id ? '<i>✓</i>' : '') + '</div>
      </div>
    `).join('');
    if (selectedMovie === null && currentResults.length) select(0);
  }

  async function select(idx) {
    selectedMovie = currentResults[idx];
    document.querySelectorAll('#th-msv-list .th-msv-item').forEach((el, i) => {
      el.classList.toggle('selected', i === idx);
      const c = el.querySelector('.th-msv-item-check');
      if (c) c.innerHTML = i === idx ? '<i>✓</i>' : '';
    });
    document.getElementById('th-msv-btn-add').classList.add('ready');
    await loadDetails(selectedMovie.tmdb_id);
  }

  async function loadDetails(tmdbId) {
    const detailsEl = document.getElementById('th-msv-details');
    const titleEl = document.getElementById('th-msv-details-title');
    const metaEl = document.getElementById('th-msv-details-meta');
    const overviewEl = document.getElementById('th-msv-details-overview');
    const provEl = document.getElementById('th-msv-providers');
    detailsEl.classList.add('hidden');
    titleEl.textContent = ''; metaEl.textContent = ''; overviewEl.textContent = ''; provEl.innerHTML = '';
    try {
      const [d, p] = await Promise.all([
        fetch(`${API}/api/movie-search/${tmdbId}/details`).then(r => r.ok ? r.json() : null),
        fetch(`${API}/api/movie-search/${tmdbId}/providers`).then(r => r.ok ? r.json() : null)
      ]);
      if (d) {
        titleEl.textContent = d.title;
        metaEl.textContent = (d.year ? esc(d.year) + ' • ' : '') + (d.genre ? esc(d.genre) + ' • ' : '') + (d.runtime ? esc(d.runtime) + ' min' : '') + (d.rating ? ' • ⭐ ' + esc(d.rating) + '/10' : '');
        overviewEl.textContent = d.overview || 'No overview available.';
        detailsEl.classList.remove('hidden');
      }
      if (p && p.providers && p.providers.length) {
        const free = p.providers.filter((x) => x.tier === 'free');
        const all = p.providers;
        (free.length ? free : all).slice(0, 4).forEach((x) => {
          provEl.innerHTML += '<div class="th-msv-provider">' + (x.logo_path ? '<img src="' + esc(x.logo_path) + '" alt="">' : '') + esc(x.provider_name) + '</div>';
        });
      }
    } catch (e) { /* silent */ }
  }

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  async function addSelected() {
    if (!selectedMovie) return;
    const addBtn = document.getElementById('th-msv-btn-add');
    addBtn.disabled = true; addBtn.textContent = 'Adding…';
    try {
      const c = window.MX && window.MX.ctx ? window.MX.ctx() : null;
      const coupleId = c ? c.coupleId : null;
      const r = await fetch(`${API}/api/movie-fav`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coupleId,
          tmdbId: selectedMovie.tmdb_id,
          title: selectedMovie.title,
          year: selectedMovie.year,
          genre: selectedMovie.genre,
          posterUrl: selectedMovie.poster_url,
          backdropUrl: selectedMovie.backdrop_url,
          overview: selectedMovie.overview,
          rating: selectedMovie.rating,
          status: 'watchlist',
          addedBy: c ? c.role : null
        })
      });
      if (!r.ok) throw new Error('Add failed');
      await r.json();
      if (typeof toast === 'function') toast('Added "' + esc(selectedMovie.title) + '" to your list', 'success');
      if (window.MX && window.MX.emit) window.MX.emit('library');
      close();
    } catch (e) {
      console.error('[movie-search-ui] add failed:', e);
      if (typeof toast === 'function') toast('Could not add movie — try again', 'error');
    } finally { addBtn.disabled = false; addBtn.textContent = 'Add to My List'; }
  }

  function open() {
    buildModal();
    document.getElementById('th-msv-modal').classList.add('open');
    const input = document.getElementById('th-msv-q');
    input.value = ''; input.focus(); showEmpty();
    document.getElementById('th-msv-btn-add').classList.remove('ready'); selectedMovie = null;
  }

  function close() {
    const m = document.getElementById('th-msv-modal');
    if (m) m.classList.remove('open');
  }

  global.MovieSearchUI = { open, close, select, addSelected, search };
})();
