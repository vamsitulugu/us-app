/* ═══════════════════════════════════════════════════════════════
   LYRICS MANAGER — Step 9 (player flow), the single source of truth
   playback code should ask for lyrics.

   Flow, exactly per spec:
     Open Song → Memory Cache? → yes → show
                                → no → Supabase (status)? → yes → show
                                                            → no → show
     "Searching lyrics..." + fire the background worker (non-blocking —
     playback itself never awaits this) → update automatically if found.

   This file NEVER calls a provider-hitting endpoint itself. The only
   network call it makes is the cache-only GET /api/lyrics/status/:songId
   via lyrics-cache.js. Enqueuing the background worker is fire-and-
   forget — the manager returns its 'searching' result to the caller
   immediately either way.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function whenReady(fn) {
    if (window.LyricsCache && window.LyricsBackgroundWorker) fn();
    else setTimeout(() => whenReady(fn), 100);
  }



  /**
   * @param {object} song  { id, title, artist, lyrics, lyrics_cached, ... }
   * @param {string} coupleId  needed only if we end up enqueuing a
   *        background search for a never-seen-before song
   * @returns {Promise<object>} { state: 'found'|'searching'|'unavailable',
   *          lrc?, syncType?, provider? }
   */
  async function getLyrics(song, coupleId) {
    if (!song) return { state: 'unavailable' };

    // Step 3 — memory cache
    const mem = window.LyricsCache.getMemory(song.id);
    if (mem) return memToResult(mem, song);

    // Already-loaded Supabase row data counts as the Supabase cache hit —
    // no network call needed at all in the common case.
    if (song.lyrics && song.lyrics.trim()) {
      const entry = { state: 'cached', lrc: song.lyrics, lrcLatin: song.lyrics_latin || null, provider: song.lyrics_source || 'cache', syncType: 'synced' };
      window.LyricsCache.setMemory(song.id, entry);
      return { state: 'found', lrc: entry.lrc, lrcLatin: entry.lrcLatin, provider: entry.provider, syncType: entry.syncType };
    }

    // Step 4 — Supabase cache (pure read, no provider call)
    const status = await window.LyricsCache.checkSupabase(song.id);
    if (status.state === 'cached') {
      return { state: 'found', lrc: status.lrc, lrcLatin: status.lrcLatin, provider: status.provider, syncType: status.syncType };
    }
    if (status.state === 'missing') {
      return { state: 'unavailable' };
    }

    // status.state === 'unknown' — genuinely never searched. Fire the
    // background worker (does NOT block playback) and return 'searching'
    // so the UI can show that state and update itself when resolved.
    if (!window.LyricsBackgroundWorker.isQueued(song.id)) {
      window.LyricsBackgroundWorker.enqueue(song, coupleId);
    }
    return { state: 'searching' };
  }

  function memToResult(mem, song) {
    if (mem.state === 'cached') return { state: 'found', lrc: mem.lrc, lrcLatin: mem.lrcLatin, provider: mem.provider, syncType: mem.syncType };
    if (mem.state === 'missing') return { state: 'unavailable' };
    return { state: 'searching' };
  }

  /**
   * Subscribe to a song's background search finishing. Fires at most
   * once per call. Safe to call even if the search already finished by
   * the time you subscribe — resolves on next tick either way.
   */
  function subscribe(songId, cb) {
    if (!window.LyricsBackgroundWorker) { cb({ found: false }); return; }
    window.LyricsBackgroundWorker.on((resolvedSongId, result) => {
      if (resolvedSongId === songId) cb(result);
    });
  }

  window.LyricsManager = { getLyrics, subscribe };
})();