/* ═══════════════════════════════════════════════════════════════
   LYRICS PROVIDER — registry/labels for the free lyric sources.

   The actual HTTP calls to these providers happen server-side
   (routes/lyrics.js) — CORS and API-key-free public endpoints are
   easiest to call from the backend, and it keeps ALL network egress
   for lyrics in one auditable place. This file exists so the client
   (admin dashboard, search-attempt UI) can show human-readable labels
   without hardcoding provider ids in multiple places.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // Priority order matches routes/lyrics.js's PROVIDERS array exactly.
  const PROVIDERS = [
    { id: 'lrclib', label: 'LRCLIB', priority: 1, syncType: 'synced', description: 'Free, community-run synced lyrics database.' },
    { id: 'lrcmux', label: 'LRCMUX', priority: 2, syncType: 'synced', description: 'Community synced-lyrics mirror (fallback).' },
    { id: 'lyricsovh', label: 'Lyrics.ovh', priority: 3, syncType: 'plain', description: 'Free plain-text lyrics — last resort, not time-synced.' },
    { id: 'cache', label: 'Cache', priority: 0, syncType: 'synced', description: 'Already downloaded — served instantly, no network call.' },
    { id: 'manual', label: 'Manual Paste', priority: 0, syncType: 'synced', description: 'Pasted or uploaded by a user.' },
  ];

  function labelFor(providerId) {
    const p = PROVIDERS.find(x => x.id === providerId);
    return p ? p.label : (providerId || 'Unknown');
  }
  function syncTypeFor(providerId) {
    const p = PROVIDERS.find(x => x.id === providerId);
    return p ? p.syncType : 'synced';
  }

  window.LyricsProvider = { PROVIDERS, labelFor, syncTypeFor };
})();