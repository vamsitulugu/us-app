/* ═══════════════════════════════════════════════════════════════
   PLAYER LYRICS HOOK — replaces lyrics-auto-fetch.js in music.html's
   script tags. Same rendering behavior (native/Latin toggle, uses the
   EXISTING loadLyricsFor / renderKaraokeLyrics / parseLyrics renderers
   — none of that is touched), but the data source is now LyricsManager
   (cache-first) instead of a direct call to the provider-hitting
   /api/lyrics/auto-fetch endpoint. This is the actual fix for
   "player must never depend on external APIs."

   SWAP IN music.html:
     - REMOVE: <script src="/lyrics-auto-fetch.js"></script>
     + ADD, in this order:
       <script src="/lyrics-cache.js"></script>
       <script src="/lyrics-provider.js"></script>
       <script src="/lyrics-background-worker.js"></script>
       <script src="/lyrics-manager.js"></script>
       <script src="/player-lyrics-hook.js"></script>
   (metadata-service.js, metadata-normalizer.js, lyrics-search.js,
   lyrics-import-service.js, artwork-service.js, cache-service.js,
   import-service.js stay exactly where they were.)
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function whenReady(fn) {
    if (window.AudioService && window.Store && window.MusicPlayer && window.LyricsManager && typeof parseLyrics === 'function') fn();
    else setTimeout(() => whenReady(fn), 150);
  }

  function getCoupleCtx() {
    try { return window.MusicPlayer.getCoupleCtx(); } catch (e) { return null; }
  }

  const scriptPref = new Map();
  function getPref(songId, hasLatin) { return hasLatin ? (scriptPref.get(songId) || 'native') : 'native'; }
  function setPref(songId, val) { scriptPref.set(songId, val); }

  function injectStyles() {
    if (document.getElementById('plhStyles')) return;
    const css = `
    .lyr-loading{text-align:center;color:rgba(255,255,255,.45);font-size:13px;padding:60px 24px;line-height:1.8;animation:plhPulse 1.4s ease-in-out infinite}
    @keyframes plhPulse{0%,100%{opacity:.45}50%{opacity:.85}}
    .karaoke-no-lyrics.plh-loading{animation:plhPulse 1.4s ease-in-out infinite}
    .plh-toggle-wrap{display:flex;justify-content:center;gap:6px;padding:8px 0 2px}
    .plh-toggle-pill{display:flex;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.15);border-radius:20px;padding:3px;gap:2px}
    .plh-toggle-btn{padding:5px 13px;border-radius:16px;font-size:11px;font-weight:700;color:rgba(255,255,255,.55);background:none;border:none;cursor:pointer;font-family:var(--ff-sans,sans-serif)}
    .plh-toggle-btn.active{background:linear-gradient(135deg,var(--accent,#5b9bff),var(--accent-d,#2f6feb));color:#fff}
    .plh-plain-badge{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:rgba(255,255,255,.4);text-align:center;padding-bottom:6px}
    `;
    const s = document.createElement('style'); s.id = 'plhStyles'; s.textContent = css; document.head.appendChild(s);
  }

  function toggleHtml(songId, hasLatin) {
    if (!hasLatin) return '';
    const pref = getPref(songId, hasLatin);
    return `<div class="plh-toggle-wrap"><div class="plh-toggle-pill">
      <button type="button" class="plh-toggle-btn${pref === 'native' ? ' active' : ''}" data-plh-song="${songId}" data-plh-mode="native">Native</button>
      <button type="button" class="plh-toggle-btn${pref === 'latin' ? ' active' : ''}" data-plh-song="${songId}" data-plh-mode="latin">English Letters</button>
    </div></div>`;
  }
  function wireToggleClicks(container, song) {
    if (!container) return;
    container.querySelectorAll('.plh-toggle-btn').forEach(btn => {
      btn.onclick = () => {
        setPref(btn.getAttribute('data-plh-song'), btn.getAttribute('data-plh-mode'));
        const cur = window.AudioService.currentSong();
        if (cur && cur.id === song.id) renderForSong(song, { state: 'found', lrc: song.lyrics, lrcLatin: song.lyrics_latin, syncType: 'synced' });
      };
    });
  }

  function showLoadingWherever() {
    const fpWrap = document.getElementById('fpLyricsWrap');
    if (fpWrap && document.getElementById('fpLyricsPanel')?.style.display !== 'none') {
      fpWrap.innerHTML = `<div class="lyr-loading">🎧 Searching lyrics…</div>`;
    }
    if (typeof karaokeState !== 'undefined' && karaokeState.open) {
      const el = document.getElementById('karaokeLyrics');
      if (el) el.innerHTML = `<div class="karaoke-no-lyrics plh-loading">🎧 Searching lyrics…</div>`;
    }
  }
  function showUnavailableWherever() {
    const fpWrap = document.getElementById('fpLyricsWrap');
    if (fpWrap && document.getElementById('fpLyricsPanel')?.style.display !== 'none') {
      fpWrap.innerHTML = `<div class="lyr-unavailable">Lyrics unavailable for this song.</div>`;
    }
    if (typeof karaokeState !== 'undefined' && karaokeState.open) {
      const el = document.getElementById('karaokeLyrics');
      if (el) el.innerHTML = `<div class="karaoke-no-lyrics">🎤 Lyrics unavailable for this song.</div>`;
    }
  }

  function renderForSong(song, result) {
    const cur = window.AudioService.currentSong();
    if (!cur || cur.id !== song.id) return;

    const hasLatin = !!(result.lrcLatin && result.lrcLatin.trim());
    const pref = getPref(song.id, hasLatin);
    song.lyrics = (pref === 'latin' && hasLatin) ? result.lrcLatin : result.lrc;
    song.lyrics_latin = result.lrcLatin || song.lyrics_latin || null;

    const isPlain = result.syncType === 'plain';

    const fpPanelOpen = document.getElementById('fpLyricsPanel')?.style.display !== 'none';
    if (fpPanelOpen && typeof window.MusicPlayer.loadLyricsFor === 'function') {
      window.MusicPlayer.loadLyricsFor(song);
      const wrap = document.getElementById('fpLyricsWrap');
      if (wrap) {
        let prefix = isPlain ? `<div class="plh-plain-badge">Unsynced lyrics — no timestamp highlighting available</div>` : '';
        wrap.insertAdjacentHTML('afterbegin', prefix + toggleHtml(song.id, hasLatin));
        wireToggleClicks(wrap, song);
      }
    }
    if (typeof karaokeState !== 'undefined' && karaokeState.open) {
      const titleEl = document.getElementById('karaokeSongTitle');
      if (titleEl && titleEl.textContent === song.title) {
        karaokeState.lyricsLines = parseLyrics(song.lyrics);
        renderKaraokeLyrics();
        const wrap = document.getElementById('karaokeLyricsWrap');
        if (wrap) {
          const existing = wrap.querySelector('.plh-toggle-wrap');
          if (existing) existing.remove();
          wrap.insertAdjacentHTML('afterbegin', toggleHtml(song.id, hasLatin));
          wireToggleClicks(wrap, song);
        }
      }
    }
  }

  async function ensureLyrics(song) {
    if (!song) return;
    const ctx = getCoupleCtx();
    const result = await window.LyricsManager.getLyrics(song, ctx ? ctx.coupleId : undefined);

    if (result.state === 'found') { renderForSong(song, result); return; }
    if (result.state === 'unavailable') { showUnavailableWherever(); return; }

    showLoadingWherever();
    window.LyricsManager.subscribe(song.id, (bgResult) => {
      const cur = window.AudioService.currentSong();
      if (!cur || cur.id !== song.id) return;
      if (bgResult && bgResult.found) {
        renderForSong(song, { lrc: bgResult.lyricsNative, lrcLatin: bgResult.lyricsLatin, syncType: bgResult.syncType || 'synced' });
      } else {
        showUnavailableWherever();
      }
    });
  }

  function hookAudioService() {
    window.AudioService.on('play', (song) => ensureLyrics(song));
  }
  function hookFullPlayerLyricsToggle() {
    const orig = window.toggleFpLyrics;
    if (typeof orig !== 'function') return;
    window.toggleFpLyrics = function () {
      orig();
      const panel = document.getElementById('fpLyricsPanel');
      if (panel && panel.style.display !== 'none') {
        const s = window.AudioService.currentSong();
        if (s) ensureLyrics(s);
      }
    };
  }
  function hookKaraokeOpen() {
    const orig = window.openKaraokeMode;
    if (typeof orig !== 'function') return;
    window.openKaraokeMode = function (pl, idx) {
      orig(pl, idx);
      const t = musicState[pl][idx];
      if (!t) return;
      const real = window.Store.songs.find(s => s.id === t.id);
      if (real) ensureLyrics(real);
    };
  }

  whenReady(function () {
    injectStyles();
    hookAudioService();
    hookFullPlayerLyricsToggle();
    hookKaraokeOpen();
    const cur = window.AudioService.currentSong();
    if (cur) ensureLyrics(cur);
  });

  window.PlayerLyricsHook = { ensureLyrics };
})();