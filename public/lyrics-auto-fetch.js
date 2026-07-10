/* ═══════════════════════════════════════════════════════════════
   AUTOMATIC SYNCED LYRICS — LRCLIB fetch + Supabase cache
   Load LAST, after everything else:
     <script src="/music-player.js"></script>
     <script src="/music-player-karaoke-patch.js"></script>
     <script src="/couple-karaoke.js"></script>
     <script src="/lyrics-auto-fetch.js"></script>

   Does NOT touch:
     - the LRC parser (parseLyrics / parseLRC)
     - the highlighting/auto-scroll engines (updateKaraokeUI, tickLyrics)
     - playback sync, queue, progress bar, album art, buttons
     - the manual "Paste Lyrics / Upload LRC" flow (still works as a
       fallback if auto-fetch finds nothing)

   What it does:
     - On song start, if the song has no lyrics yet, calls
       POST /api/lyrics/auto-fetch (server checks Supabase cache,
       then LRCLIB, then caches the result) and drops the returned
       LRC text into song.lyrics — exactly like a manual paste would.
     - Re-renders whatever lyrics view is currently open using the
       EXISTING render functions (loadLyricsFor for the full player,
       renderKaraokeLyrics for Karaoke) so nothing about how lines
       are parsed or highlighted changes.
     - In-memory session cache + request cancellation so switching
       songs quickly never shows stale or duplicate results.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function whenReady(fn) {
    if (window.AudioService && window.Store && window.MusicPlayer && typeof parseLyrics === 'function') fn();
    else setTimeout(() => whenReady(fn), 150);
  }

  // session-only cache: songId -> lrc text (or null = confirmed not found)
  const sessionCache = new Map();
  let inFlightSongId = null;
  let abortToken = 0;

  function injectStyles() {
    if (document.getElementById('lafStyles')) return;
    const css = `
    .lyr-loading{text-align:center;color:rgba(255,255,255,.45);font-size:13px;padding:60px 24px;line-height:1.8;animation:lafPulse 1.4s ease-in-out infinite}
    @keyframes lafPulse{0%,100%{opacity:.45}50%{opacity:.85}}
    .lyr-fadein{animation:lafFadeIn .4s ease both}
    @keyframes lafFadeIn{from{opacity:0}to{opacity:1}}
    .karaoke-no-lyrics.laf-loading{animation:lafPulse 1.4s ease-in-out infinite}
    `;
    const s = document.createElement('style'); s.id = 'lafStyles'; s.textContent = css; document.head.appendChild(s);
  }

  function songKey(s) { return s.id; }

  async function requestLyrics(song) {
    const ctx = window.MusicPlayer.getCoupleCtx();
    const myToken = ++abortToken;
    inFlightSongId = song.id;
    try {
      const res = await window.MusicPlayer.api('POST', '/api/lyrics/auto-fetch', {
        songId: song.id,
        coupleId: ctx ? ctx.coupleId : undefined,
        title: song.title,
        artist: song.artist,
        album: song.album || undefined,
        durationSec: song.duration_sec || undefined,
      });
      if (myToken !== abortToken) return; // a newer song started, discard this result
      if (res && res.found && res.lrc) {
        sessionCache.set(song.id, res.lrc);
        song.lyrics = res.lrc; // exact same field the manual-paste flow writes to
        renderWherever(song, true);
      } else {
        sessionCache.set(song.id, null);
        renderWherever(song, false);
      }
    } catch (e) {
      if (myToken !== abortToken) return;
      // network failure — fall back to whatever's cached in-session, else show error
      if (sessionCache.has(song.id) && sessionCache.get(song.id)) {
        song.lyrics = sessionCache.get(song.id);
        renderWherever(song, true);
      } else {
        renderWherever(song, false, true);
      }
    } finally {
      if (inFlightSongId === song.id) inFlightSongId = null;
    }
  }

  // Kick off (or reuse) a fetch for this song. Safe to call repeatedly —
  // dedupes via sessionCache and the in-flight check.
  function ensureLyrics(song) {
    if (!song) return;
    if (song.lyrics && song.lyrics.trim()) return; // already have real lyrics (manual or previously fetched)
    if (sessionCache.has(song.id)) {
      const cached = sessionCache.get(song.id);
      if (cached) { song.lyrics = cached; renderWherever(song, true); }
      else renderWherever(song, false);
      return;
    }
    showLoadingWherever();
    requestLyrics(song);
  }

  function showLoadingWherever() {
    const fpWrap = document.getElementById('fpLyricsWrap');
    if (fpWrap && document.getElementById('fpLyricsPanel')?.style.display !== 'none') {
      fpWrap.innerHTML = `<div class="lyr-loading">🎧 Loading synchronized lyrics…</div>`;
    }
    if (typeof karaokeState !== 'undefined' && karaokeState.open) {
      const el = document.getElementById('karaokeLyrics');
      if (el) el.innerHTML = `<div class="karaoke-no-lyrics laf-loading">🎧 Loading synchronized lyrics…</div>`;
    }
  }

  function renderWherever(song, found, networkError) {
    const cur = window.AudioService.currentSong();
    if (!cur || cur.id !== song.id) return; // song changed while we were fetching — ignore

    // Full player lyrics panel (uses the EXISTING loadLyricsFor renderer)
    const fpPanelOpen = document.getElementById('fpLyricsPanel')?.style.display !== 'none';
    if (fpPanelOpen && typeof window.MusicPlayer.loadLyricsFor === 'function') {
      if (found) {
        window.MusicPlayer.loadLyricsFor(song);
        const wrap = document.getElementById('fpLyricsWrap');
        if (wrap) wrap.classList.add('lyr-fadein');
      } else {
        const wrap = document.getElementById('fpLyricsWrap');
        if (wrap) wrap.innerHTML = `<div class="lyr-unavailable">${networkError ? 'Unable to load lyrics.' : 'Synchronized lyrics are unavailable for this song.'}</div>`;
      }
    }

    // Karaoke lyrics view (uses the EXISTING parseLyrics + renderKaraokeLyrics)
    if (typeof karaokeState !== 'undefined' && karaokeState.open) {
      const activeSong = window.Store.songs[karaokeState.pl ? undefined : undefined]; // no-op guard
      // karaokeState tracks pl/idx into legacy lists; simplest correct check is by title/artist match
      // against whichever song is currently loaded in the karaoke header.
      const titleEl = document.getElementById('karaokeSongTitle');
      if (titleEl && titleEl.textContent === song.title) {
        if (found) {
          karaokeState.lyricsLines = parseLyrics(song.lyrics);
          renderKaraokeLyrics();
        } else if (typeof renderKaraokeLyrics === 'function') {
          const el = document.getElementById('karaokeLyrics');
          if (el) el.innerHTML = `<div class="karaoke-no-lyrics">${networkError ? '📡 Unable to load lyrics.' : '🎤 Synchronized lyrics are unavailable for this song.'}</div>`;
        }
      }
    }
  }

  /* ── Hook 1: every time a song starts playing, ensure lyrics ── */
  function hookAudioService() {
    window.AudioService.on('play', (song) => ensureLyrics(song));
  }

  /* ── Hook 2: opening the full-player lyrics panel should also
     trigger/refresh, in case 'play' fired before this file loaded
     or the fetch hadn't started yet ── */
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

  /* ── Hook 3: opening Karaoke should also trigger/refresh ── */
  function hookKaraokeOpen() {
    const orig = window.openKaraokeMode;
    if (typeof orig !== 'function') return;
    window.openKaraokeMode = function (pl, idx) {
      orig(pl, idx);
      const t = musicState[pl][idx];
      if (!t) return;
      // musicState proxy maps legacy shape -> real Store song; find the real song by id
      const real = window.Store.songs.find(s => s.id === t.id);
      if (real) ensureLyrics(real);
    };
  }

  whenReady(function () {
    injectStyles();
    hookAudioService();
    hookFullPlayerLyricsToggle();
    hookKaraokeOpen();

    // If a song is already playing when this file loads (e.g. hot reload), fetch immediately.
    const cur = window.AudioService.currentSong();
    if (cur) ensureLyrics(cur);
  });

  window.LyricsAutoFetch = { ensureLyrics, sessionCache };
})();