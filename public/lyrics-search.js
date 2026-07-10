/* ═══════════════════════════════════════════════════════════════
   LYRICS SEARCH — multi-attempt strategy layer

   Sits ABOVE lyrics-import-service.js (which does the actual network
   call to /api/lyrics/auto-fetch). This file NEVER calls fetch itself
   — it only decides WHAT to search for and in WHAT order, always using
   cleaned metadata (never raw, branded metadata like
   "Fire Storm :: SenSongsMp3.Com").

   Strategy (spec order):
     1. cleanTitle + cleanArtist
     2. cleanTitle alone
     3. cleanTitle + cleanAlbum
     4. cleanTitle + duration
     5. fuzzy — loosened title (strip parenthetical/bracketed suffixes
        like "(Remix)", "(From \"Movie\")") + artist

   Stops at the first attempt that returns a match. Returns the same
   shape as LyricsImportService.searchBeforeImport() plus which
   attempt succeeded, for transparency/debugging.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function whenReady(fn) {
    if (window.LyricsImportService) fn();
    else setTimeout(() => whenReady(fn), 100);
  }

  function fuzzyTitle(title) {
    if (!title) return title;
    // strip trailing parenthetical/bracketed qualifiers for a looser pass,
    // e.g. "Fire Storm (Remix)" -> "Fire Storm", "Hellallallo [From Movie]" -> "Hellallallo"
    return title.replace(/\s*[\(\[][^()\[\]]*[\)\]]\s*$/g, '').trim() || title;
  }

  /**
   * @param {object} clean  { cleanTitle, cleanArtist, cleanAlbum }
   * @param {number} durationSec
   * @returns {Promise<object>} same shape as LyricsImportService result,
   *          with an added `attempt` field ('title+artist' | 'title' |
   *          'title+album' | 'title+duration' | 'fuzzy' | null)
   */
  async function search(clean, durationSec) {
    const title = clean.cleanTitle;
    const artist = clean.cleanArtist;
    const album = clean.cleanAlbum;

    if (!title) return { found: false, attempt: null };

    const attempts = [
      { key: 'title+artist', params: { title, artist, durationSec } },
      { key: 'title', params: { title, durationSec: undefined } },
      { key: 'title+album', params: { title, album, durationSec } },
      { key: 'title+duration', params: { title, durationSec } },
      { key: 'fuzzy', params: { title: fuzzyTitle(title), artist, durationSec } },
    ];

    for (const attempt of attempts) {
      // skip attempts that don't actually add any signal beyond a prior one
      const res = await window.LyricsImportService.searchBeforeImport(attempt.params);
      if (res && res.found) return { ...res, attempt: attempt.key };
    }
    return { found: false, attempt: null };
  }

  whenReady(() => { window.LyricsSearch = { search, fuzzyTitle }; });
})();
