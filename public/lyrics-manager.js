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

  function whenReady(fn, attempt) {
    attempt = attempt || 0;
    if (window.LyricsCache && window.LyricsBackgroundWorker) fn();
    else if (attempt >= 100) console.warn('[LyricsManager] dependencies never became available — giving up.');
    else setTimeout(() => whenReady(fn, attempt + 1), 100);
  }

  const resolvedListeners = new Map(); // songId -> [callbacks]

  function onceResolved(songId, cb) {
    const list = resolvedListeners.get(songId) || [];
    list.push(cb);
    resolvedListeners.set(songId, list);
  }
  function fireResolved(songId, result) {
    const list = resolvedListeners.get(songId);
    if (!list) return;
    resolvedListeners.delete(songId);
    list.forEach(cb => { try { cb(result); } catch (e) {} });
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

    // Step 3 — memory cache. Only trust it as a fast-path when it reflects
    // a real outcome ('cached'/'missing'). A stale 'unknown'/'searching'
    // entry (written before the background search resolved) must not
    // short-circuit past the already-loaded row data checked next —
    // that was the root cause of lyrics getting stuck on "Searching..."
    // forever on a song's 2nd play/reopen in the same session.
    const mem = window.LyricsCache.getMemory(song.id);
    if (mem && (mem.state === 'cached' || mem.state === 'missing')) return memToResult(mem, song);

    // Already-loaded Supabase row data counts as the Supabase cache hit —
    // no network call needed at all in the common case.
    if (song.lyrics && song.lyrics.trim()) {
      const entry = { state: 'cached', lrc: song.lyrics, lrcLatin: song.lyrics_latin || null, provider: song.lyrics_source || 'cache', syncType: 'synced' };
      window.LyricsCache.setMemory(song.id, entry);
      return { state: 'found', lrc: entry.lrc, lrcLatin: entry.lrcLatin, provider: entry.provider, syncType: entry.syncType };
    }

    if (mem) return memToResult(mem, song);

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

  // Keep the memory cache truthful once a background search actually
  // resolves. Without this, LyricsCache's memory entry for a song stays
  // stuck at whatever checkSupabase() last wrote (often 'unknown'),
  // so replaying/reopening that song later always short-circuits to
  // a permanent "searching" state instead of picking up the result
  // that's sitting right there. Registered once, globally, for every
  // song the background worker ever resolves — not per-song like
  // subscribe() above.
  whenReady(() => {
    window.LyricsBackgroundWorker.on((songId, result) => {
      if (result && result.skipped) return; // no lyric payload in this emit — the song.lyrics fast path already wrote correct memory
      if (result && result.found) {
        window.LyricsCache.setMemory(songId, {
          state: 'cached',
          lrc: result.lyricsNative || result.lrc,
          lrcLatin: result.lyricsLatin || result.lrcLatin || null,
          provider: result.provider,
          syncType: result.syncType
        });
      } else {
        window.LyricsCache.setMemory(songId, { state: 'missing' });
      }
    });
  });

  window.LyricsManager = { getLyrics, subscribe };
})();