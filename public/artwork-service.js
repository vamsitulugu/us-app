/* ═══════════════════════════════════════════════════════════════
   ARTWORK SERVICE — embedded album art extraction + upload + cache
   Part of the Premium Smart Music Import System (import pipeline only).
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const API = (function () {
    try { return window.parent?.API || window.API || 'https://us-app-av6d.onrender.com'; }
    catch (e) { return 'https://us-app-av6d.onrender.com'; }
  })();

  function dataUrlToBlob(dataUrl) {
    const [head, b64] = dataUrl.split(',');
    const mime = (head.match(/data:(.*?);base64/) || [, 'image/jpeg'])[1];
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  // in-memory session cache: fileFingerprint -> uploaded cover URL
  // (never re-extracts/re-uploads the same file twice in one session,
  // per spec step 7 "Never extract twice")
  const uploadedCache = new Map();

  function fingerprint(file) {
    return `${file.name}:${file.size}:${file.lastModified || 0}`;
  }

  /**
   * Upload extracted (or user-replaced) artwork to Supabase Storage via
   * the existing /api/media/upload-cover endpoint.
   * @param {string} coupleId
   * @param {string|Blob} artwork  data URL or Blob
   * @param {File} [sourceFile]    original audio file, used for cache key
   * @returns {Promise<string|null>} the cover URL, or null on failure
   */
  async function uploadArtwork(coupleId, artwork, sourceFile) {
    if (!artwork) return null;
    const key = sourceFile ? fingerprint(sourceFile) : null;
    if (key && uploadedCache.has(key)) return uploadedCache.get(key);

    try {
      const blob = typeof artwork === 'string' ? dataUrlToBlob(artwork) : artwork;
      const form = new FormData();
      form.append('file', blob, 'cover.jpg');
      form.append('coupleId', coupleId);
      const r = await fetch(API + '/api/media/upload-cover', { method: 'POST', body: form });
      if (!r.ok) return null;
      const data = await r.json();
      const url = data.url || null;
      if (key && url) uploadedCache.set(key, url);
      return url;
    } catch (e) {
      console.warn('[ArtworkService] upload failed:', e.message);
      return null;
    }
  }

  window.ArtworkService = { uploadArtwork, dataUrlToBlob, fingerprint };
})();
