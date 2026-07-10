/* ═══════════════════════════════════════════════════════════════
   AUTOMATIC SYNCED LYRICS — LRCLIB fetch + Supabase cache
   v2: adds a Native-script / Latin-transliteration TOGGLE, backed by
   the updated /api/lyrics/auto-fetch response ({ lrcNative, lrcLatin }).

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
       POST /api/lyrics/auto-fetch. The backend now returns BOTH
       { lrcNative, lrcLatin } — native script (e.g. Telugu) and a
       Latin-letter transliteration, when available.
     - Stores song.lyrics_native and song.lyrics_latin, plus keeps
       song.lyrics = lyrics_native for backwards compatibility with
       any code that only knows about the old single-field shape.
     - Adds a small toggle pill next to the lyrics view (full player
       panel + Karaoke mode) whenever a Latin version is available, so
       you can switch between native script and English-letter lyrics
       per song. Choice persists per song within the session (resets
       on reload) — flip it once, keep singing.
     - Re-renders using the EXISTING render functions (loadLyricsFor /
       renderKaraokeLyrics) so parsing/highlighting logic is untouched.
     - In-memory session cache + request cancellation so switching
       songs quickly never shows stale or duplicate results.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function whenReady(fn) {
    if (window.AudioService && window.Store && window.MusicPlayer && typeof parseLyrics === 'function') fn();
    else setTimeout(() => whenReady(fn), 150);
  }

  // session-only cache: songId -> { native, latin } | { native:null, latin:null } (confirmed not found)
  const sessionCache = new Map();
  // per-song script preference for this session: songId -> 'native' | 'latin'
  const scriptPref = new Map();
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

    .laf-toggle-wrap{display:flex;justify-content:center;gap:6px;padding:8px 0 2px;position:relative;z-index:2}
    .laf-toggle-pill{display:flex;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.15);border-radius:20px;padding:3px;gap:2px}
    .laf-toggle-btn{padding:5px 13px;border-radius:16px;font-size:11px;font-weight:700;color:rgba(255,255,255,.55);background:none;border:none;cursor:pointer;transition:all .2s;font-family:var(--ff-sans,sans-serif)}
    .laf-toggle-btn.active{background:linear-gradient(135deg,var(--accent,#5b9bff),var(--accent-d,#2f6feb));color:#fff;box-shadow:0 2px 8px rgba(91,155,255,.4)}
    .karaoke-lyrics-wrap .laf-toggle-wrap{padding-bottom:6px}
    `;
    const s = document.createElement('style'); s.id = 'lafStyles'; s.textContent = css; document.head.appendChild(s);
  }

  function getPref(songId, hasLatin) {
    if (!hasLatin) return 'native';
    return scriptPref.get(songId) || 'native';
  }
  function setPref(songId, val) { scriptPref.set(songId, val); }

  function toggleHtml(songId, hasLatin) {
    if (!hasLatin) return '';
    const pref = getPref(songId, hasLatin);
    return `<div class="laf-toggle-wrap">
      <div class="laf-toggle-pill">
        <button type="button" class="laf-toggle-btn${pref === 'native' ? ' active' : ''}" data-laf-song="${songId}" data-laf-mode="native">Native</button>
        <button type="button" class="laf-toggle-btn${pref === 'latin' ? ' active' : ''}" data-laf-song="${songId}" data-laf-mode="latin">English Letters</button>
      </div>
    </div>`;
  }

  function wireToggleClicks(container) {
    if (!container) return;
    container.querySelectorAll('.laf-toggle-btn').forEach(btn => {
      btn.onclick = () => {
        const songId = btn.getAttribute('data-laf-song');
        const mode = btn.getAttribute('data-laf-mode');
        setPref(songId, mode);
        const cur = window.AudioService.currentSong();
        if (cur && cur.id === songId) applyPreferredLyrics(cur);
      };
    });
  }

  // Sets song.lyrics to whichever script is currently preferred, then
  // re-renders via the existing renderers — this is the only place that
  // decides native vs latin, so both viewers (full player + karaoke)
  // always agree.
  function applyPreferredLyrics(song) {
    const cached = sessionCache.get(song.id);
    const native = (cached && cached.native) || song.lyrics_native || song.lyrics || '';
    const latin  = (cached && cached.latin)  || song.lyrics_latin  || null;
    const hasLatin = !!(latin && latin.trim());
    const pref = getPref(song.id, hasLatin);
    song.lyrics = (pref === 'latin' && hasLatin) ? latin : native;
    renderWherever(song, !!song.lyrics, false, hasLatin);
  }

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
      if (res && res.found) {
        const native = res.lrcNative || res.lrc || null;
        const latin  = res.lrcLatin || null;
        sessionCache.set(song.id, { native, latin });
        song.lyrics_native = native;
        song.lyrics_latin  = latin;
        applyPreferredLyrics(song);
      } else {
        sessionCache.set(song.id, { native: null, latin: null });
        renderWherever(song, false);
      }
    } catch (e) {
      if (myToken !== abortToken) return;
      const cached = sessionCache.get(song.id);
      if (cached && cached.native) {
        song.lyrics_native = cached.native;
        song.lyrics_latin = cached.latin;
        applyPreferredLyrics(song);
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
    if ((song.lyrics_native && song.lyrics_native.trim()) || (song.lyrics && song.lyrics.trim() && !sessionCache.has(song.id))) {
      // already have real lyrics (manual paste, previously fetched, or DB-cached on the song row)
      if (!song.lyrics_native) song.lyrics_native = song.lyrics; // backfill for old rows
      applyPreferredLyrics(song);
      return;
    }
    if (sessionCache.has(song.id)) {
      const cached = sessionCache.get(song.id);
      if (cached && cached.native) {
        song.lyrics_native = cached.native;
        song.lyrics_latin = cached.latin;
        applyPreferredLyrics(song);
      } else {
        renderWherever(song, false);
      }
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

  function renderWherever(song, found, networkError, hasLatinOverride) {
    const cur = window.AudioService.currentSong();
    if (!cur || cur.id !== song.id) return; // song changed while we were fetching — ignore

    const cached = sessionCache.get(song.id);
    const hasLatin = hasLatinOverride !== undefined ? hasLatinOverride : !!((cached && cached.latin) || song.lyrics_latin);

    // Full player lyrics panel (uses the EXISTING loadLyricsFor renderer)
    const fpPanelOpen = document.getElementById('fpLyricsPanel')?.style.display !== 'none';
    if (fpPanelOpen && typeof window.MusicPlayer.loadLyricsFor === 'function') {
      if (found) {
        window.MusicPlayer.loadLyricsFor(song);
        const wrap = document.getElementById('fpLyricsWrap');
        if (wrap) {
          wrap.classList.add('lyr-fadein');
          wrap.insertAdjacentHTML('afterbegin', toggleHtml(song.id, hasLatin));
          wireToggleClicks(wrap);
        }
      } else {
        const wrap = document.getElementById('fpLyricsWrap');
        if (wrap) wrap.innerHTML = `<div class="lyr-unavailable">${networkError ? 'Unable to load lyrics.' : 'Synchronized lyrics are unavailable for this song.'}</div>`;
      }
    }

    // Karaoke lyrics view (uses the EXISTING parseLyrics + renderKaraokeLyrics)
    if (typeof karaokeState !== 'undefined' && karaokeState.open) {
      const titleEl = document.getElementById('karaokeSongTitle');
      if (titleEl && titleEl.textContent === song.title) {
        if (found) {
          karaokeState.lyricsLines = parseLyrics(song.lyrics);
          renderKaraokeLyrics();
          const wrap = document.getElementById('karaokeLyricsWrap');
          if (wrap) {
            const existing = wrap.querySelector('.laf-toggle-wrap');
            if (existing) existing.remove();
            wrap.insertAdjacentHTML('afterbegin', toggleHtml(song.id, hasLatin));
            wireToggleClicks(wrap);
          }
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

  window.LyricsAutoFetch = { ensureLyrics, sessionCache, scriptPref };
})();