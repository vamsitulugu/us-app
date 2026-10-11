/* ═══════════════════════════════════════════════════════════════════
   Movie Collection — lives on the Watch Together (movie) page.
   Moved here from the Music page. Uses the SAME localStorage key
   ('us_movies_v2') and the SAME record shape, so every movie that was
   added on the old Music > Movies tab appears here automatically.

   Record: { id, title, year, genre, rating(0-5), status
             ('watchlist'|'watching'|'watched'), review, scene,
             owner ('my'|'partner'|'both'), poster (data URL), fav }
   Pure UI/local data — no backend, no change to sync/calls/R2 code.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const KEY = 'us_movies_v2';

  const GENRES = {
    Romance:     { e: '💕', c: ['#ff6b9a', '#6e1231'] },
    Action:      { e: '💥', c: ['#ff8a3d', '#6b1d0b'] },
    Comedy:      { e: '😂', c: ['#ffd14a', '#7a4a06'] },
    Drama:       { e: '🎭', c: ['#b68bff', '#3a1b73'] },
    Thriller:    { e: '😰', c: ['#7d8aa3', '#1b2233'] },
    Horror:      { e: '👻', c: ['#9aa0a6', '#2a0a0a'] },
    'Sci-Fi':    { e: '🚀', c: ['#43b5ff', '#0a2a5c'] },
    Fantasy:     { e: '🧙', c: ['#5ee0b0', '#0e4a3a'] },
    Animation:   { e: '🎨', c: ['#ff7ad9', '#5a1a6e'] },
    Documentary: { e: '📽️', c: ['#c9b27c', '#4a3a16'] },
    Bollywood:   { e: '🎪', c: ['#ff5d73', '#7a1030'] },
    Other:       { e: '🎬', c: ['#d6102a', '#3a0510'] },
  };
  const STATUS = {
    watchlist: { label: '🌟 Watchlist', cls: 'st-watchlist' },
    watching:  { label: '🍿 Watching',  cls: 'st-watching' },
    watched:   { label: '✅ Watched',   cls: 'st-watched' },
  };

  const S = {
    movies: [], tab: 'home',
    filter: 'all', owner: 'all', genre: null, q: '',
    editId: null, detailId: null, pendingPoster: '', pendingRating: 0, deleteId: null,
  };

  function load() {
    try { const d = localStorage.getItem(KEY); S.movies = d ? (JSON.parse(d) || []) : []; } catch (e) { S.movies = []; }
    if (!Array.isArray(S.movies)) S.movies = [];
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S.movies)); return true; }
    catch (e) { toast('Storage is full — try a smaller poster'); return false; }
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const g = (name) => GENRES[name] || GENRES.Other;
  const byRecent = (a, b) => Number(b.id) - Number(a.id);
  function icons() { try { window.lucide && window.lucide.createIcons(); } catch (e) {} }
  let toastT;
  function toast(msg) {
    const t = $('mcToast'); if (!t) return;
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2400);
  }
  const find = (id) => S.movies.find((m) => String(m.id) === String(id));

  // ── poster art (image if present, else genre-tinted placeholder) ──
  function posterStyle(m) {
    if (m && m.poster) return `background-image:url('${m.poster}')`;
    const c = g(m && m.genre).c;
    return `background-image:linear-gradient(150deg,${c[0]},${c[1]})`;
  }
  const posterEmoji = (m) => (m && m.poster ? '' : `<span class="mc-ph">${g(m && m.genre).e}</span>`);

  // ═══════════ Tabs ═══════════
  function go(tab, opts) {
    S.tab = tab;
    ['home', 'library', 'genres', 'watch'].forEach((t) => {
      const el = $('tab' + t.charAt(0).toUpperCase() + t.slice(1)); if (el) el.hidden = t !== tab;
    });
    document.querySelectorAll('#wtTabs .wt-tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
    if (opts && opts.reset) { S.filter = 'all'; S.owner = 'all'; S.genre = null; S.q = ''; const si = $('mcSearch'); if (si) si.value = ''; }
    render();
    const sc = document.scrollingElement || document.documentElement; try { sc.scrollTop = 0; } catch (e) {}
  }

  function render() {
    if (S.tab === 'home') renderHome();
    else if (S.tab === 'library') renderLibrary();
    else if (S.tab === 'genres') renderGenres();
    icons();
  }

  // ═══════════ Home ═══════════
  function featured() {
    if (!S.movies.length) return null;
    const favs = S.movies.filter((m) => m.fav).sort(byRecent);
    return favs[0] || S.movies.slice().sort(byRecent)[0];
  }
  function card(m) {
    return `<button type="button" class="mc-card" data-open="${esc(m.id)}">
      <span class="mc-poster" style="${posterStyle(m)}">${posterEmoji(m)}
        <span class="mc-fav${m.fav ? ' on' : ''}" data-fav="${esc(m.id)}" role="button" aria-label="Favorite">${m.fav ? '★' : '☆'}</span>
      </span>
      <span class="mc-card-title">${esc(m.title)}</span>
      <span class="mc-card-meta">${m.year ? esc(m.year) + ' • ' : ''}${esc(m.genre || '')}</span>
    </button>`;
  }
  function row(title, list, seeAll) {
    if (!list.length) return '';
    return `<div class="mc-row-head"><h3>${esc(title)}</h3>${seeAll ? `<button type="button" class="mc-seeall" data-seeall="${esc(seeAll)}">See all <i data-lucide="chevron-right"></i></button>` : ''}</div>
      <div class="mc-hscroll">${list.slice(0, 12).map(card).join('')}</div>`;
  }
  function renderHome() {
    const f = featured();
    if (f) {
      const st = STATUS[f.status] || STATUS.watchlist;
      $('mcBanner').innerHTML = `<div class="mc-banner" style="${posterStyle(f)}">
        <div class="mc-banner-shade"></div>${posterEmoji(f) ? `<div class="mc-banner-emoji">${g(f.genre).e}</div>` : ''}
        <button type="button" class="mc-banner-more" id="mcBannerMore" aria-label="More options"><i data-lucide="more-vertical"></i></button>
        <div class="mc-banner-body">
          <div class="mc-banner-title">${esc(f.title)}</div>
          <div class="mc-chips"><span>${esc(f.genre || 'Movie')}</span>${f.year ? `<span>${esc(f.year)}</span>` : ''}<span>${st.label}</span></div>
          <div class="mc-banner-btns">
            <button type="button" class="wt-btn wt-btn-primary" id="mcBannerWatch"><i data-lucide="heart"></i><span>Watch Together</span></button>
            <button type="button" class="wt-btn wt-btn-ghost" id="mcBannerDetails"><span>View Details</span></button>
          </div></div></div>`;
    } else {
      $('mcBanner').innerHTML = `<div class="mc-banner mc-banner-empty">
        <div class="mc-banner-shade"></div><div class="mc-banner-emoji">🎬</div>
        <div class="mc-banner-body">
          <div class="mc-banner-title">Watch Together</div>
          <p class="mc-banner-sub">Different places. Same movie. Same moment. ❤️</p>
          <div class="mc-banner-btns">
            <button type="button" class="wt-btn wt-btn-primary" id="mcBannerWatch"><i data-lucide="heart"></i><span>Watch Together</span></button>
            <button type="button" class="wt-btn wt-btn-ghost" id="mcBannerAdd"><i data-lucide="plus"></i><span>Add a Movie</span></button>
          </div></div></div>`;
    }
    const all = S.movies.slice().sort(byRecent);
    const html =
      row('Currently Watching', all.filter((m) => m.status === 'watching'), 'watching') +
      row('Your Favorites', all.filter((m) => m.fav), 'fav') +
      row('Watched Together', all.filter((m) => m.owner === 'both'), 'both') +
      row('Watchlist', all.filter((m) => m.status === 'watchlist'), 'watchlist') +
      row('Recently Added', all, 'all');
    $('mcHomeRows').innerHTML = html || `<div class="mc-empty"><div>🍿</div><p>No movies in your collection yet.<br>Add favorites and ones to watch together.</p><button type="button" class="wt-btn wt-btn-primary" id="mcEmptyAdd"><i data-lucide="plus"></i><span>Add Movie</span></button></div>`;
  }

  // ═══════════ Library ═══════════
  const FILTERS = [['all', 'All'], ['recent', 'Recent'], ['fav', '⭐ Favorites'], ['watchlist', '🌟 Watchlist'], ['watching', '🍿 Watching'], ['watched', '✅ Watched']];
  const OWNERS = [['all', 'Everyone'], ['my', '❤️ Mine'], ['partner', "💜 Partner's"], ['both', '💕 Together']];
  function filtered() {
    const q = S.q.trim().toLowerCase();
    let list = S.movies.filter((m) => {
      if (S.owner !== 'all' && m.owner !== S.owner) return false;
      if (S.genre && m.genre !== S.genre) return false;
      if (S.filter === 'fav' && !m.fav) return false;
      if (['watchlist', 'watching', 'watched'].includes(S.filter) && m.status !== S.filter) return false;
      if (q && !(m.title || '').toLowerCase().includes(q) && !(m.genre || '').toLowerCase().includes(q)) return false;
      return true;
    }).sort(byRecent);
    if (S.filter === 'recent') list = list.slice(0, 12);
    return list;
  }
  function renderLibrary() {
    const mv = S.movies;
    const avg = mv.length ? (mv.reduce((s, m) => s + (m.rating || 0), 0) / mv.length).toFixed(1) : '—';
    $('mcStats').innerHTML = [
      [mv.length, 'Total'], [mv.filter((m) => m.status === 'watched').length, 'Watched'],
      [mv.filter((m) => m.status === 'watchlist').length, 'Watchlist'], [mv.filter((m) => m.fav).length, 'Favorites'], ['⭐' + avg, 'Avg']
    ].map(([n, l]) => `<div class="mc-stat"><b>${n}</b><span>${l}</span></div>`).join('');
    $('mcFilters').innerHTML = (S.genre ? `<button type="button" class="mc-chip is-active" data-genre-clear="1">${g(S.genre).e} ${esc(S.genre)} ✕</button>` : '') +
      FILTERS.map(([k, l]) => `<button type="button" class="mc-chip${S.filter === k ? ' is-active' : ''}" data-filter="${k}">${l}</button>`).join('');
    $('mcOwners').innerHTML = OWNERS.map(([k, l]) => `<button type="button" class="mc-chip mc-chip-sm${S.owner === k ? ' is-active' : ''}" data-owner="${k}">${l}</button>`).join('');
    const list = filtered();
    $('mcGrid').innerHTML = list.length ? list.map(card).join('')
      : `<div class="mc-empty" style="grid-column:1/-1"><div>🎬</div><p>${mv.length ? 'No movies match your filters.' : 'No movies yet.<br>Tap Add to start your collection.'}</p></div>`;
  }

  // ═══════════ Genres ═══════════
  function renderGenres() {
    $('mcGenres').innerHTML = Object.keys(GENRES).map((name) => {
      const list = S.movies.filter((m) => m.genre === name);
      const withPoster = list.find((m) => m.poster);
      const c = GENRES[name].c;
      const bg = withPoster ? `background-image:linear-gradient(0deg,rgba(0,0,0,.65),rgba(0,0,0,.15)),url('${withPoster.poster}')` : `background-image:linear-gradient(150deg,${c[0]},${c[1]})`;
      return `<button type="button" class="mc-genre" data-genre="${esc(name)}" style="${bg}">
        <span class="mc-genre-emoji">${GENRES[name].e}</span>
        <span class="mc-genre-name">${esc(name)}</span><span class="mc-genre-count">${list.length} ${list.length === 1 ? 'Movie' : 'Movies'}</span></button>`;
    }).join('');
  }

  // ═══════════ Details ═══════════
  function openDetail(id) {
    const m = find(id); if (!m) return;
    S.detailId = String(id);
    const st = STATUS[m.status] || STATUS.watchlist;
    const stars = m.rating ? '★'.repeat(m.rating) + '☆'.repeat(5 - m.rating) : '☆☆☆☆☆';
    $('mcDetail').innerHTML = `
      <div class="mc-detail-hero" style="${posterStyle(m)}">
        <div class="mc-banner-shade"></div>${posterEmoji(m) ? `<div class="mc-banner-emoji">${g(m.genre).e}</div>` : ''}
        <button type="button" class="wt-icon-btn mc-d-back" id="mcDBack" aria-label="Back"><i data-lucide="chevron-left"></i></button>
        <button type="button" class="wt-icon-btn mc-d-fav${m.fav ? ' on' : ''}" id="mcDFav" aria-label="Favorite"><i data-lucide="heart"></i></button>
      </div>
      <div class="mc-detail-body">
        <h1>${esc(m.title)}</h1>
        <div class="mc-detail-meta"><span class="mc-stars-show">${stars}</span>${m.rating ? `<b>${m.rating}/5</b>` : ''}${m.year ? `<span>${esc(m.year)}</span>` : ''}<span class="mc-status ${st.cls}">${st.label}</span></div>
        <div class="mc-chips"><span>${g(m.genre).e} ${esc(m.genre || 'Other')}</span><span>${m.owner === 'both' ? '💕 Together' : m.owner === 'partner' ? "💜 Partner's" : '❤️ Mine'}</span></div>
        ${m.review ? `<h4>About</h4><p class="mc-about">${esc(m.review)}</p>` : ''}
        ${m.scene ? `<h4>❤️ Favorite Scene</h4><p class="mc-scene">${esc(m.scene)}</p>` : ''}
        <button type="button" class="wt-btn wt-btn-primary wt-btn-block" id="mcDWatch"><i data-lucide="heart"></i><span>Watch Together</span></button>
        <button type="button" class="wt-btn wt-btn-ghost wt-btn-block" id="mcDList"><i data-lucide="${m.fav ? 'bookmark-check' : 'bookmark'}"></i><span>${m.fav ? 'In My Favorites' : 'Add to My Favorites'}</span></button>
        <div class="mc-detail-actions">
          <button type="button" class="wt-btn wt-btn-ghost" id="mcDEdit"><i data-lucide="pencil"></i><span>Edit</span></button>
          <button type="button" class="wt-btn wt-btn-ghost mc-danger" id="mcDDelete"><i data-lucide="trash-2"></i><span>Delete</span></button>
        </div>
      </div>`;
    $('mcDetail').hidden = false; $('mcDetail').scrollTop = 0; icons();
  }
  function closeDetail() { $('mcDetail').hidden = true; S.detailId = null; }

  // ═══════════ Add / edit ═══════════
  function buildFormStatic() {
    $('mcGenre').innerHTML = Object.keys(GENRES).map((n) => `<option value="${esc(n)}">${GENRES[n].e} ${esc(n)}</option>`).join('');
    $('mcStars').innerHTML = [1, 2, 3, 4, 5].map((v) => `<button type="button" class="mc-star" data-v="${v}">☆</button>`).join('');
  }
  function paintStars(v) { document.querySelectorAll('#mcStars .mc-star').forEach((b) => { const on = Number(b.dataset.v) <= v; b.classList.toggle('on', on); b.textContent = on ? '★' : '☆'; }); }
  function paintPoster(src) {
    $('mcPosterPreview').innerHTML = src ? `<img src="${src}" alt="">` : '<i data-lucide="image-plus"></i><em>Upload poster</em>';
    icons();
  }
  function openForm(id, defaults) {
    S.editId = id || null;
    const m = id ? find(id) : null;
    $('mcFormTitle').textContent = m ? 'Edit Movie' : 'Add Movie';
    $('mcTitle').value = m ? m.title || '' : '';
    $('mcYear').value = m ? m.year || '' : '';
    $('mcGenre').value = (m && m.genre) || (defaults && defaults.genre) || 'Romance';
    $('mcStatus').value = (m && m.status) || 'watchlist';
    $('mcReview').value = m ? m.review || '' : '';
    $('mcScene').value = m ? m.scene || '' : '';
    $('mcOwner').value = (m && m.owner) || 'my';
    S.pendingPoster = m ? m.poster || '' : '';
    S.pendingRating = m ? m.rating || 0 : 0;
    paintStars(S.pendingRating); paintPoster(S.pendingPoster);
    $('mcFormBackdrop').hidden = false;
  }
  function closeForm() { $('mcFormBackdrop').hidden = true; S.editId = null; }
  function compress(file, maxW) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = reject;
      fr.onload = () => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          const k = Math.min(1, maxW / img.width);
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.82));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  function saveForm() {
    const title = $('mcTitle').value.trim();
    if (!title) { toast('Enter a movie name ⚠️'); return; }
    const old = S.editId ? find(S.editId) : null;
    const movie = {
      id: old ? old.id : String(Date.now()),
      title, year: $('mcYear').value, genre: $('mcGenre').value, rating: S.pendingRating || 0,
      status: $('mcStatus').value, review: $('mcReview').value.trim(), scene: $('mcScene').value.trim(),
      owner: $('mcOwner').value, poster: S.pendingPoster || '', fav: old ? !!old.fav : false,
    };
    const prev = S.movies.slice();
    if (old) S.movies[S.movies.findIndex((x) => String(x.id) === String(old.id))] = movie; else S.movies.push(movie);
    if (!save()) { S.movies = prev; return; }
    const wasEdit = !!old; closeForm(); render();
    if (S.detailId && wasEdit) openDetail(S.detailId);
    toast(wasEdit ? 'Movie updated 🎬' : 'Movie added 🎬');
  }

  // ═══════════ Actions ═══════════
  function toggleFav(id) {
    const m = find(id); if (!m) return;
    m.fav = !m.fav; save(); render();
    if (S.detailId && String(S.detailId) === String(id)) openDetail(id);
  }
  function askDelete(id) { S.deleteId = String(id); $('mcConfirmBackdrop').hidden = false; }
  function doDelete() {
    const id = S.deleteId; S.deleteId = null; $('mcConfirmBackdrop').hidden = true;
    if (!id) return;
    S.movies = S.movies.filter((x) => String(x.id) !== id); save();
    closeDetail(); render(); toast('Movie deleted');
  }
  function watchWith(m) {
    closeDetail(); $('mcActionsBackdrop').hidden = true;
    go('watch');
    toast(m ? `Pick "${m.title}" from your phone or the cloud` : 'Pick a movie to watch together');
  }
  function bannerMenu() {
    const f = featured();
    const items = [];
    if (f) {
      items.push(['view', 'eye', 'View Details'], ['edit', 'pencil', 'Edit Movie'], ['fav', f.fav ? 'star-off' : 'star', f.fav ? 'Remove from Favorites' : 'Add to Favorites'], ['del', 'trash-2', 'Delete Movie', true]);
    }
    items.push(['add', 'plus', 'Add New Movie'], ['lib', 'library', 'Open Library']);
    $('mcActionsList').innerHTML = items.map(([k, ic, label, danger]) =>
      `<button type="button" class="wt-more-row${danger ? ' wt-more-danger' : ''}" data-act="${k}"><i data-lucide="${ic}"></i><span>${label}</span></button>`).join('');
    $('mcActionsBackdrop').hidden = false; icons();
    $('mcActionsList').onclick = (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      $('mcActionsBackdrop').hidden = true;
      const a = b.dataset.act;
      if (a === 'view') openDetail(f.id); else if (a === 'edit') openForm(f.id); else if (a === 'fav') toggleFav(f.id);
      else if (a === 'del') askDelete(f.id); else if (a === 'add') openForm(); else if (a === 'lib') go('library', { reset: true });
    };
  }

  // ═══════════ Wiring (event delegation — one set of listeners) ═══════════
  function wire() {
    $('wtTabs').addEventListener('click', (e) => { const b = e.target.closest('.wt-tab'); if (b) go(b.dataset.tab, { reset: b.dataset.tab === 'library' }); });
    $('mcSearch').addEventListener('input', (e) => { S.q = e.target.value; renderLibrary(); icons(); });
    $('mcAddBtn').onclick = () => openForm();

    document.addEventListener('click', (e) => {
      const t = e.target;
      const fav = t.closest('[data-fav]'); if (fav) { e.stopPropagation(); toggleFav(fav.dataset.fav); return; }
      const open = t.closest('[data-open]'); if (open) { openDetail(open.dataset.open); return; }
      const see = t.closest('[data-seeall]');
      if (see) {
        const k = see.dataset.seeall; S.filter = 'all'; S.owner = 'all'; S.genre = null; S.q = '';
        if (k === 'fav' || k === 'watchlist' || k === 'watching') S.filter = k; else if (k === 'both') S.owner = 'both';
        go('library'); return;
      }
      const flt = t.closest('[data-filter]'); if (flt) { S.filter = flt.dataset.filter; renderLibrary(); icons(); return; }
      const own = t.closest('[data-owner]'); if (own) { S.owner = own.dataset.owner; renderLibrary(); icons(); return; }
      if (t.closest('[data-genre-clear]')) { S.genre = null; renderLibrary(); icons(); return; }
      const gn = t.closest('[data-genre]'); if (gn) { S.genre = gn.dataset.genre; S.filter = 'all'; S.owner = 'all'; go('library'); return; }
      const id = t.closest('[id]') ? t.closest('[id]').id : '';
      switch (id) {
        case 'mcBannerWatch': case 'mcDWatch': watchWith(find(S.detailId) || featured()); break;
        case 'mcBannerDetails': { const f = featured(); if (f) openDetail(f.id); break; }
        case 'mcBannerAdd': case 'mcEmptyAdd': openForm(); break;
        case 'mcBannerMore': bannerMenu(); break;
        case 'mcDBack': closeDetail(); break;
        case 'mcDFav': case 'mcDList': toggleFav(S.detailId); break;
        case 'mcDEdit': { const d = S.detailId; closeDetail(); openForm(d); break; }
        case 'mcDDelete': askDelete(S.detailId); break;
        case 'mcFormClose': closeForm(); break;
        case 'mcSave': saveForm(); break;
        case 'mcConfirmNo': S.deleteId = null; $('mcConfirmBackdrop').hidden = true; break;
        case 'mcConfirmYes': doDelete(); break;
        default: break;
      }
    });
    ['mcFormBackdrop', 'mcConfirmBackdrop', 'mcActionsBackdrop'].forEach((bid) => {
      $(bid).addEventListener('click', (e) => { if (e.target === $(bid)) { $(bid).hidden = true; if (bid === 'mcConfirmBackdrop') S.deleteId = null; } });
    });
    $('mcStars').addEventListener('click', (e) => {
      const b = e.target.closest('.mc-star'); if (!b) return;
      const v = Number(b.dataset.v); S.pendingRating = S.pendingRating === v ? 0 : v; paintStars(S.pendingRating);
    });
    $('mcPosterPick').addEventListener('click', (e) => { if (e.target !== $('mcPosterInput')) { e.preventDefault(); $('mcPosterInput').click(); } });
    $('mcPosterInput').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      try { S.pendingPoster = await compress(f, 480); paintPoster(S.pendingPoster); }
      catch (err) { toast('Could not read that image'); }
      e.target.value = '';
    });
  }

  // Back button / Escape: close the top-most collection overlay first.
  function closeTop() {
    if (!$('mcConfirmBackdrop').hidden) { S.deleteId = null; $('mcConfirmBackdrop').hidden = true; return true; }
    if (!$('mcActionsBackdrop').hidden) { $('mcActionsBackdrop').hidden = true; return true; }
    if (!$('mcFormBackdrop').hidden) { closeForm(); return true; }
    if (!$('mcDetail').hidden) { closeDetail(); return true; }
    return false;
  }

  function init() {
    if (!$('wtTabs')) return;
    load(); buildFormStatic(); wire(); go('home');
    // The movie page stays mounted; another page (or the old Music tab, if any
    // stale tab is open) may change the data — refresh when we regain focus.
    window.addEventListener('focus', () => { load(); if (!document.querySelector('.wt-modal-backdrop:not([hidden]), #mcDetail:not([hidden])')) render(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { load(); render(); } });
  }
  window.MC = { go, closeTop, openDetail, openForm, reload: () => { load(); render(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
