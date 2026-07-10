/* ═══════════════════════════════════════════════════════════════
   METADATA SERVICE — automatic ID3 / tag extraction for the
   Premium Smart Music Import System.

   Load order (all NEW files, added to music.html AFTER the existing
   player scripts — none of them are touched):
     <script src="/music-player.js"></script>
     <script src="/music-player-karaoke-patch.js"></script>
     <script src="/couple-karaoke.js"></script>
     <script src="/lyrics-auto-fetch.js"></script>
     <script src="https://cdnjs.cloudflare.com/ajax/libs/jsmediatags/3.9.5/jsmediatags.min.js"></script>
     <script src="/metadata-service.js"></script>
     <script src="/artwork-service.js"></script>
     <script src="/lyrics-import-service.js"></script>
     <script src="/cache-service.js"></script>
     <script src="/import-service.js"></script>

   Responsibility: given a File (mp3/m4a/aac/flac/ogg/wav), extract
   every available ID3/tag field WITHOUT crashing on missing data.
   Never throws — always resolves with whatever it could find, with
   missing fields left as null so the UI can leave them blank.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const SUPPORTED_EXT = /\.(mp3|m4a|aac|flac|ogg|oga|wav|opus)$/i;

  function extOf(filename) {
    const m = String(filename || '').match(/\.([a-z0-9]+)$/i);
    return m ? m[1].toLowerCase() : '';
  }

  function isSupported(file) {
    return (file.type && file.type.startsWith('audio/')) || SUPPORTED_EXT.test(file.name || '');
  }

  // jsmediatags reads ID3v1/v2 (mp3), MP4 atoms (m4a/aac). FLAC/OGG/WAV
  // tag support varies by file — if it fails we just resolve empty
  // instead of rejecting, per spec: "leave blank instead of crashing".
  function readTags(file) {
    return new Promise((resolve) => {
      if (!window.jsmediatags) { resolve(null); return; }
      try {
        window.jsmediatags.read(file, {
          onSuccess: (tag) => resolve(tag),
          onError: () => resolve(null),
        });
      } catch (e) { resolve(null); }
    });
  }

  // Reads real playback duration via a throwaway <audio> element —
  // works for every supported format, independent of tag support.
  function readDuration(file) {
    return new Promise((resolve) => {
      try {
        const url = URL.createObjectURL(file);
        const a = new Audio();
        let settled = false;
        const finish = (sec) => {
          if (settled) return;
          settled = true;
          URL.revokeObjectURL(url);
          resolve(sec || 0);
        };
        a.preload = 'metadata';
        a.onloadedmetadata = () => finish(isFinite(a.duration) ? a.duration : 0);
        a.onerror = () => finish(0);
        setTimeout(() => finish(0), 8000); // safety timeout — never hang the import
        a.src = url;
      } catch (e) { resolve(0); }
    });
  }

  function pictureFromTags(tag) {
    try {
      const pic = tag && tag.tags && tag.tags.picture;
      if (!pic || !pic.data || !pic.data.length) return null;
      const bytes = new Uint8Array(pic.data);
      let binary = '';
      // chunked to avoid call-stack blowups on large embedded art
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      const base64 = btoa(binary);
      const format = pic.format || 'image/jpeg';
      return `data:${format};base64,${base64}`;
    } catch (e) { return null; }
  }

  function parseTrackOrDisc(raw) {
    // ID3 often encodes "3/12" for track 3 of 12
    if (raw === undefined || raw === null) return { num: null, total: null };
    const s = String(raw).trim();
    if (!s) return { num: null, total: null };
    const parts = s.split('/');
    const num = parseInt(parts[0], 10);
    const total = parts[1] ? parseInt(parts[1], 10) : null;
    return { num: isNaN(num) ? null : num, total: isNaN(total) ? null : total };
  }

  function parseYear(raw) {
    if (!raw) return null;
    const m = String(raw).match(/(\d{4})/);
    return m ? parseInt(m[1], 10) : null;
  }

  function guessFromFilename(name) {
    const base = String(name || '').replace(/\.[^/.]+$/, '');
    let title = base, artist = null;
    const di = base.indexOf(' - ');
    if (di > -1) { artist = base.slice(0, di).trim(); title = base.slice(di + 3).trim(); }
    return { title: title || null, artist };
  }

  /**
   * Extract all available metadata from an audio File.
   * Never rejects. Missing fields resolve as null.
   * @param {File} file
   * @returns {Promise<object>}
   */
  async function extract(file) {
    const fallback = guessFromFilename(file.name);
    const format = extOf(file.name) || (file.type ? file.type.split('/')[1] : '');
    const fileSize = file.size || 0;

    const [tag, durationSec] = await Promise.all([readTags(file), readDuration(file)]);

    const t = (tag && tag.tags) || {};
    const track = parseTrackOrDisc(t.track);
    const disc = parseTrackOrDisc(t.disc || t.partOfSet);
    const picture = pictureFromTags(tag);

    const bitrateKbps = (durationSec && fileSize)
      ? Math.round((fileSize * 8) / durationSec / 1000)
      : null;

    // NOTE: ID3/MP4 frames from jsmediatags are sometimes objects like
    // { id, data: "..." } or { data: { text: "..." } } rather than plain
    // strings — casting those with String() produces the literal text
    // "[object Object]". safeStr() unwraps the real value instead, or
    // returns null if there's genuinely nothing usable (this is the fix
    // for the "[object Object]" Album Artist bug).
    function safeStr(value) {
      if (value === null || value === undefined) return null;
      if (typeof value === 'string') return value.trim() || null;
      if (typeof value === 'number') return String(value);
      if (typeof value === 'object') {
        if (typeof value.text === 'string') return value.text.trim() || null;
        if (typeof value.data === 'string') return value.data.trim() || null;
        if (value.data && typeof value.data.text === 'string') return value.data.text.trim() || null;
        return null;
      }
      return null;
    }

    return {
      title: safeStr(t.title) || fallback.title,
      artist: safeStr(t.artist) || fallback.artist,
      album: safeStr(t.album),
      albumArtist: safeStr(t.albumArtist) || safeStr(t.band) || safeStr(t['TPE2']),
      composer: safeStr(t.composer),
      genre: safeStr(t.genre),
      year: parseYear(t.year),
      track: track.num,
      trackTotal: track.total,
      disc: disc.num,
      discTotal: disc.total,
      durationSec: Math.round(durationSec || 0),
      durationMs: Math.round((durationSec || 0) * 1000),
      bitrateKbps: bitrateKbps,
      fileSize: fileSize,
      format: format,
      pictureDataUrl: picture,     // null if no embedded art
      tagReadOk: !!tag,            // false => metadata failed, allow manual edit
    };
  }

  window.MetadataService = { extract, isSupported, guessFromFilename };
})();