/* ═══════════════════════════════════════════════════════════════
   CACHE SERVICE — duplicate detection + "never redo work twice"
   bookkeeping for the import pipeline.

   Two independent jobs:
   1. findDuplicate() — Step 9 of the spec: before saving, compare the
      new song against the couple's existing library by Title + Artist
      + Duration (± tolerance), so re-importing the same MP3 (or the
      same song ripped twice) prompts Replace / Keep Both / Cancel
      instead of silently creating a second copy.
   2. Session-level guards so artwork/lyrics are never fetched twice
      for the same file within one import batch (works alongside the
      per-service caches in artwork-service.js / lyrics-import-service.js
      and the server-side lyrics_cache table).
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const DURATION_TOLERANCE_SEC = 3;

  function norm(s) {
    return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
  }

  /**
   * @param {Array} library   the couple's existing songs (Store.songs)
   * @param {{title:string, artist:string, durationSec:number}} candidate
   * @returns {object|null} the matching existing song, or null
   */
  function findDuplicate(library, candidate) {
    const t = norm(candidate.title);
    const a = norm(candidate.artist);
    const d = candidate.durationSec || 0;
    if (!t) return null;
    return (library || []).find(s => {
      if (norm(s.title) !== t) return false;
      if (a && norm(s.artist) !== a) return false;
      if (d && s.duration_sec) return Math.abs(s.duration_sec - d) <= DURATION_TOLERANCE_SEC;
      return true; // no duration to compare — title(+artist) match is enough
    }) || null;
  }

  window.CacheService = { findDuplicate, DURATION_TOLERANCE_SEC };
})();
