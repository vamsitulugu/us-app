/* ═══════════════════════════════════════════════════════════════
   LYRICS IMPORT SERVICE — search LRCLIB automatically the moment a
   song's metadata is read, BEFORE the user even presses Save.

   Reuses your existing backend endpoint (POST /api/lyrics/auto-fetch,
   routes/lyrics.js) — no backend contract changes needed. That
   endpoint already caches into `lyrics_cache` by normalized
   title/artist, so calling it here means playback-time lookups
   (lyrics-auto-fetch.js) hit the cache and never re-download.

   This file ONLY concerns import-time pre-fetching. The existing
   lyrics-auto-fetch.js (playback-time fetch-on-play) is untouched.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const API = (function () {
    try { return window.parent?.API || window.API || 'https://us-app-av6d.onrender.com'; }
    catch (e) { return 'https://us-app-av6d.onrender.com'; }
  })();

  /**
   * Search LRCLIB (via the cached backend endpoint) using title, artist,
   * album, and duration — same signature the spec calls for in Step 5.
   * Never throws: resolves { found:false } on any failure so import
   * always continues (Step 12 — "lyrics unavailable: save song anyway").
   *
   * NOTE: songId/coupleId are intentionally omitted here — the song row
   * doesn't exist yet at this point in the flow. The import-service
   * attaches whatever lyrics come back directly onto the POST /api/music
   * payload once the song is created, so nothing is fetched twice.
   */
  async function searchBeforeImport({ title, artist, album, durationSec, songId, coupleId }) {
    if (!title) return { found: false };
    try {
      const r = await fetch(API + '/api/lyrics/auto-fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title, artist: artist || undefined, album: album || undefined, durationSec: durationSec || undefined,
          songId: songId || undefined, coupleId: coupleId || undefined,
        }),
      });
      if (!r.ok) return { found: false };
      const data = await r.json();
      if (!data || !data.found) return { found: false, cooldown: !!(data && data.cooldown) };
      return {
        found: true,
        source: data.source || 'lrclib',
        provider: data.provider || 'lrclib',
        syncType: data.syncType || 'synced',
        lyricsNative: data.lrcNative || data.lrc || null,
        lyricsLatin: data.lrcLatin || null,
      };
    } catch (e) {
      return { found: false };
    }
  }

  window.LyricsImportService = { searchBeforeImport };
})();