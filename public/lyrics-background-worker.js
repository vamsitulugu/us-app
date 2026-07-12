/* ═══════════════════════════════════════════════════════════════
   LYRICS BACKGROUND WORKER — Step 8

   Runs a lyric search for a song AFTER it has already been saved,
   completely decoupled from the import UI. The user never waits on
   this. If found, the result lands in cached_lyrics + the song row
   automatically (server-side, in the same auto-fetch call) — no
   refresh needed, and playback will pick it up via lyrics-manager.js
   the next time the song is opened (or immediately, if it's open now,
   via the 'lyricsResolved' event this file emits).

   Queue-based, sequential (one search in flight at a time) to avoid
   hammering providers when several songs are imported back to back.
   Dedupes — a song already queued or already resolved this session is
   never enqueued twice.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function whenReady(fn, attempt) {
    attempt = attempt || 0;
    if (window.LyricsSearch && window.MetadataNormalizer) fn();
    else if (attempt >= 100) console.warn('[LyricsBackgroundWorker] dependencies never became available — giving up.');
    else setTimeout(() => whenReady(fn, attempt + 1), 150);
  }

  const queue = [];
  const enqueued = new Set(); // songId -> prevents double-enqueue
  const listeners = [];
  let processing = false;

  function on(fn) { listeners.push(fn); }
  function emit(songId, result) { listeners.forEach(fn => { try { fn(songId, result); } catch (e) {} }); }

  /**
   * @param {object} song  a saved song row: { id, title, artist, album,
   *        duration_sec, clean_title, clean_artist, clean_album,
   *        couple_id (or pass coupleId separately) }
   * @param {string} [coupleId]
   */
  function enqueue(song, coupleId) {
    if (!song || !song.id) return;
    if (enqueued.has(song.id)) return; // already queued or already resolved this session
    enqueued.add(song.id);
    queue.push({ song, coupleId: coupleId || song.couple_id });
    if (!processing) processNext();
  }

  async function processNext() {
    if (!queue.length) { processing = false; return; }
    processing = true;
    const { song, coupleId } = queue.shift();

    try {
      // Song may already have lyrics (e.g. fast-path resolved before save
      // in import-service.js) — nothing to do, just confirm and skip.
      if (song.lyrics_cached || (song.lyrics && song.lyrics.trim())) {
        emit(song.id, { found: true, provider: song.lyrics_source || 'cache', skipped: true });
        processNext();
        return;
      }

      const clean = {
        cleanTitle: song.clean_title || song.title,
        cleanArtist: song.clean_artist || song.artist,
        cleanAlbum: song.clean_album || song.album,
      };
      const result = await window.LyricsSearch.search(clean, song.duration_sec, { songId: song.id, coupleId });
      emit(song.id, result);
    } catch (e) {
      emit(song.id, { found: false, error: e.message });
    }
    processNext();
  }

  function isQueued(songId) { return enqueued.has(songId); }

  window.LyricsBackgroundWorker = { enqueue, on, isQueued };
  window.dispatchEvent(new Event('lyrics-background-worker-ready'));
})();