/* ════════════════════════════════════════════════════════════════
   Twin Hearts — Lyrics Pre-Fetch (Speed Optimization)
   Pre-fetches lyrics for all songs in the library so they appear
   instantly when a song is played — no waiting on provider calls.
   Include via: <script src="/js/lyrics-prefetch.js"></script>
 ═════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {
  const API = (function () {
    try { return window.parent?.API || window.API || 'https://us-app-av6d.onrender.com'; }
    catch (e) { return 'https://us-app-av6d.onrender.com'; }
  })();

  let prefetching = false;
  let prefetched = new Set();

  async function preFetchSong(song) {
    if (!song || prefetched.has(song.id)) return;
    if (song.lyrics && song.lyrics.trim()) { prefetched.add(song.id); return; }
    if (window.LyricsCache && window.LyricsCache.getMemory(song.id)) { prefetched.add(song.id); return; }

    try {
      const r = await fetch(API + '/api/lyrics/auto-fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: song.title,
          artist: song.artist || undefined,
          album: song.album || undefined,
          durationSec: song.duration_sec || undefined,
          songId: song.id,
          coupleId: song.couple_id || undefined,
          filename: (song.title + ' - ' + (song.artist || '')).replace(/[^a-z0-9]/gi, '_') + '.mp3'
        })
      });
      if (r.ok) {
        const data = await r.json();
        if (data.found) prefetched.add(song.id);
      }
    } catch (e) { /* silent — pre-fetch is best-effort */ }
  }

  async function preFetchAll(songs) {
    if (prefetching) return;
    prefetching = true;
    const todo = songs.filter((s) => s && !prefetched.has(s.id) && !(s.lyrics && s.lyrics.trim()));
    for (let i = 0; i < todo.length; i += 3) {
      const batch = todo.slice(i, i + 3);
      await Promise.all(batch.map((s) => preFetchSong(s)));
      if (i + 3 < todo.length) await new Promise((r) => setTimeout(r, 600));
    }
    prefetching = false;
  }

  function warmUp(songs) {
    if (!window.LyricsCache) return;
    preFetchAll(songs || (window.S && window.S.songs || []));
  }

  function warmUpSong(song) {
    if (!song || !window.LyricsCache) return;
    preFetchSong(song);
  }

  global.LyricsPreFetch = { warmUp, warmUpSong, preFetchSong, preFetchAll };
})();
