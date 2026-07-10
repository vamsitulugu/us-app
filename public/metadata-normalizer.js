/* ═══════════════════════════════════════════════════════════════
   METADATA NORMALIZER — Smart Metadata Normalization Engine

   Pure local text-cleaning. Never calls an API. Never mutates the
   original file or the raw values passed in — always returns a NEW
   object with clean* fields alongside whatever raw* fields you gave it.

   Load order (new file, added after metadata-service.js):
     <script src="/metadata-service.js"></script>
     <script src="/metadata-normalizer.js"></script>
     <script src="/lyrics-search.js"></script>
     <script src="/lyrics-import-service.js"></script>
     <script src="/artwork-service.js"></script>
     <script src="/cache-service.js"></script>
     <script src="/import-service.js"></script>
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // Known download-site brandings that get glued onto ripped MP3 tags.
  // Matched case-insensitively, with or without surrounding punctuation.
  const SITE_NAMES = [
    'SenSongsMp3\\.Com', 'SenSongsMp3', 'NaaSongs', 'MassTamilan', 'Isaimini',
    'Starmusiq', 'PagalWorld', 'MrJatt', 'DjPunjab', 'TamilWire', 'TamilRockers',
    'KuttyWeb', 'Moviesda', '123Musiq', 'SongsPk', 'WapKing', 'DjOfficial',
    'MP3Skull', 'Downloadming', 'RaagTunes', 'A2zwap',
  ];
  const SITE_RE = new RegExp('(' + SITE_NAMES.join('|') + ')', 'gi');

  // Junk quality/format tags that ride along with the title on ripped files.
  const QUALITY_TAGS_RE = /\b(128\s*kbps|192\s*kbps|256\s*kbps|320\s*kbps|hq|hd|official\s*audio|official\s*video|audio\s*song|full\s*song|lyric(al)?\s*video|mp3|m4a|flac)\b/gi;

  // Separator characters/sequences commonly used to glue branding onto titles
  const SEPARATOR_RE = /(::|--|\|\||\||~|»|>>|_{2,})/g;

  function stripSites(s) { return s.replace(SITE_RE, ' '); }
  function stripQualityTags(s) { return s.replace(QUALITY_TAGS_RE, ' '); }
  function stripSeparatorArtifacts(s) { return s.replace(SEPARATOR_RE, ' '); }

  // Removes empty/leftover bracket pairs like "()" "[]" "( )" left behind
  // after site names are stripped out of them, WITHOUT touching bracketed
  // content that's actually meaningful (e.g. "(2025)", "(Remix)").
  function stripEmptyBrackets(s) {
    return s
      .replace(/\(\s*\)/g, ' ')
      .replace(/\[\s*\]/g, ' ')
      .replace(/\{\s*\}/g, ' ');
  }

  function collapseWhitespace(s) {
    return s.replace(/\s{2,}/g, ' ').trim();
  }

  // Trims leftover leading/trailing punctuation the above steps expose,
  // e.g. "Fire Storm -" -> "Fire Storm", "- Fire Storm" -> "Fire Storm"
  function trimStrayPunctuation(s) {
    return s.replace(/^[\s\-–—:|,._]+/, '').replace(/[\s\-–—:|,._]+$/, '');
  }

  /**
   * Extracts a plain string from a value that might be:
   *  - a normal string
   *  - a jsmediatags "frame" object like { id, data: "..." } or { id, data: { text: "..." } }
   *  - an array of strings/frames
   *  - null/undefined
   * Fixes the "[object Object]" display bug (Step: OBJECT FIX).
   */
  function coerceToString(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value.trim() || null;
    if (typeof value === 'number') return String(value);
    if (Array.isArray(value)) {
      const parts = value.map(coerceToString).filter(Boolean);
      return parts.length ? parts.join(', ') : null;
    }
    if (typeof value === 'object') {
      // common jsmediatags/ID3 shapes
      if (typeof value.text === 'string') return value.text.trim() || null;
      if (typeof value.data === 'string') return value.data.trim() || null;
      if (value.data && typeof value.data.text === 'string') return value.data.text.trim() || null;
      if (Array.isArray(value.data)) return coerceToString(value.data);
      // last resort: never let a raw object reach the UI
      return null;
    }
    return null;
  }

  function cleanTitle(raw) {
    const str = coerceToString(raw);
    if (!str) return null;
    let s = str;
    s = stripSites(s);
    s = stripQualityTags(s);
    s = stripSeparatorArtifacts(s);
    s = stripEmptyBrackets(s);
    s = collapseWhitespace(s);
    s = trimStrayPunctuation(s);
    s = collapseWhitespace(s);
    return s || null;
  }

  function cleanArtist(raw) {
    const str = coerceToString(raw);
    if (!str) return null;
    let s = str;
    s = stripSites(s);
    s = stripSeparatorArtifacts(s);
    // normalize comma-separated artist lists: "Simbu,, SS Thaman ,Deepak Blue"
    // -> "Simbu, SS Thaman, Deepak Blue" — real names are preserved as-is,
    // only spacing/duplicate commas around them are fixed.
    s = s.split(',').map(part => collapseWhitespace(trimStrayPunctuation(part))).filter(Boolean).join(', ');
    s = collapseWhitespace(s);
    return s || null;
  }

  function cleanAlbum(raw) {
    const str = coerceToString(raw);
    if (!str) return null;
    let s = str;
    s = stripSites(s);
    s = stripSeparatorArtifacts(s);
    s = stripEmptyBrackets(s); // only removes brackets left EMPTY by site-stripping — "(2025)" survives untouched
    s = collapseWhitespace(s);
    s = trimStrayPunctuation(s);
    return s || null;
  }

  function cleanAlbumArtist(raw) { return cleanArtist(raw); }
  function cleanComposer(raw) { return cleanArtist(raw); }
  function cleanGenre(raw) {
    const str = coerceToString(raw);
    if (!str) return null;
    return collapseWhitespace(stripSites(str)) || null;
  }

  /**
   * Takes the raw metadata object from MetadataService.extract() and
   * returns a NEW object with clean* fields added, while preserving
   * every raw* field untouched (Step 2: "Preserve the original metadata").
   */
  function normalize(meta) {
    if (!meta) return meta;
    return {
      ...meta,
      rawTitle: coerceToString(meta.title),
      rawArtist: coerceToString(meta.artist),
      rawAlbum: coerceToString(meta.album),
      rawAlbumArtist: coerceToString(meta.albumArtist),
      rawComposer: coerceToString(meta.composer),
      rawGenre: coerceToString(meta.genre),
      rawYear: meta.year || null,

      cleanTitle: cleanTitle(meta.title),
      cleanArtist: cleanArtist(meta.artist),
      cleanAlbum: cleanAlbum(meta.album),
      cleanAlbumArtist: cleanAlbumArtist(meta.albumArtist),
      cleanComposer: cleanComposer(meta.composer),
      cleanGenre: cleanGenre(meta.genre),
    };
  }

  window.MetadataNormalizer = {
    normalize,
    cleanTitle, cleanArtist, cleanAlbum, cleanAlbumArtist, cleanComposer, cleanGenre,
    coerceToString,
  };
})();
