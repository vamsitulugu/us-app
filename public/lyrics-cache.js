/* ═══════════════════════════════════════════════════════════════
   LYRICS CACHE — Step 3 (memory) + Step 4 (Supabase) cache layer.

   This is the ONLY file that talks to GET /api/lyrics/status/:songId,
   which is a pure cache read on the backend (no provider calls ever).
   Playback code must go through this file, never call auto-fetch.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const API = (function () {
    try { return window.parent?.API || window.API || 'https://us-app-av6d.onrender.com'; }
    catch (e) { return 'https://us-app-av6d.onrender.com'; }
  })();

  // Step 3 — in-memory cache. Cleared on page reload (by design — the
  // Supabase cache behind it is what's permanent, per spec).
  const memory = new Map(); // songId -> { state: 'cached'|'missing'|'unknown', lrc, lrcLatin, syncType, provider }

  function getMemory(songId) {
    return memory.get(songId) || null;
  }
  function setMemory(songId, entry) {
    memory.set(songId, entry);
  }
  function clearMemory(songId) {
    if (songId) memory.delete(songId); else memory.clear();
  }

  // Step 4 — Supabase cache check. Pure read, never triggers a provider
  // search. Populates memory cache on the way out so repeat calls for
  // the same song during this session never hit the network again.
  async function checkSupabase(songId) {
    if (!songId) return { state: 'unknown' };
    try {
      const r = await fetch(API + '/api/lyrics/status/' + songId);
      if (!r.ok) return { state: 'unknown' };
      const data = await r.json();
      setMemory(songId, data);
      return data;
    } catch (e) {
      return { state: 'unknown' };
    }
  }

  /**
   * The single entry point playback code should use.
   * Returns immediately from memory if we've already checked this
   * session; otherwise does ONE cache-only Supabase read.
   * Never calls a lyrics provider.
   */
  async function getStatus(songId) {
    const mem = getMemory(songId);
    if (mem) return mem;
    return checkSupabase(songId);
  }

  window.LyricsCache = { getMemory, setMemory, clearMemory, checkSupabase, getStatus };
})();