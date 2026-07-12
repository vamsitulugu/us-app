/* ═══════════════════════════════════════════════════════════════
   LYRICS SEARCH — thin client adapter over the Smart Search Engine.

   The full 5-attempt × multi-provider strategy (Step 5) now runs
   SERVER-SIDE in routes/lyrics.js's smartSearch(), so a single call to
   POST /api/lyrics/auto-fetch already tries every attempt against every
   provider in priority order before giving up. This file exists so
   callers (import-service.js, lyrics-background-worker.js) keep a
   stable, simple interface and don't need to know that detail changed.

   IMPORTANT: this file is for IMPORT-TIME / BACKGROUND-WORKER use only.
   Playback code must use lyrics-manager.js / lyrics-cache.js instead —
   never this file — since this ultimately calls a provider-hitting
   endpoint.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function whenReady(fn, attempt) {
    attempt = attempt || 0;
    if (window.LyricsImportService) fn();
    else if (attempt >= 100) console.warn('[LyricsSearch] LyricsImportService never became available — giving up.');
    else setTimeout(() => whenReady(fn, attempt + 1), 100);
  }

  /**
   * @param {object} clean  { cleanTitle, cleanArtist, cleanAlbum }
   * @param {number} durationSec
   * @param {object} [ids]  { songId, coupleId } — include once the song
   *        row exists so results get cached/tracked against it.
   * @returns {Promise<object>} { found, provider, lyricsNative, lyricsLatin, syncType }
   */
  async function search(clean, durationSec, ids) {
    if (!clean || !clean.cleanTitle) return { found: false };
    return window.LyricsImportService.searchBeforeImport({
      title: clean.cleanTitle,
      artist: clean.cleanArtist,
      album: clean.cleanAlbum,
      durationSec,
      songId: ids && ids.songId,
      coupleId: ids && ids.coupleId,
    });
  }

  whenReady(() => { window.LyricsSearch = { search }; });
})();