/* ═══════════════════════════════════════════════════════════════
   IMPORT SERVICE — Premium Smart Music Import System (orchestrator)

   The Music page hands picked files to ImportService.enqueueFiles()
   (see public/music/library.js → "add-songs"). This replaces the old
   "type everything by hand" flow with:

     select file(s)
       → read metadata (metadata-service.js)
       → extract embedded artwork (metadata-service.js)
       → search LRCLIB in the background (lyrics-import-service.js)
       → show a premium animated progress + auto-filled verify form
       → duplicate check (cache-service.js)
       → user taps Save
       → upload audio + artwork (artwork-service.js + /api/media)
       → create song row with full metadata (POST /api/music)
       → next file in queue

   Playback, sync, shared listening, queue, and the UI theme are never
   touched — this only replaces what happens between "pick a file" and
   "song appears in the list".
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function whenReady(fn) {
    if (window.Store && window.AudioService && window.MusicPlayer &&
        window.MetadataService && window.MetadataNormalizer && window.LyricsSearch &&
        window.LyricsBackgroundWorker &&
        window.ArtworkService && window.LyricsImportService && window.CacheService) fn();
    else setTimeout(() => whenReady(fn), 150);
  }

  const API = (function () {
    try { return window.parent?.API || window.API || 'https://us-app-av6d.onrender.com'; }
    catch (e) { return 'https://us-app-av6d.onrender.com'; }
  })();

  function getCoupleCtx() {
    try {
      const p = window.parent?.S;
      if (p && p.coupleId) return { coupleId: p.coupleId, role: p.role || 'user1' };
    } catch (e) {}
    try {
      const raw = localStorage.getItem('uwl_v5');
      if (raw) { const d = JSON.parse(raw); if (d.coupleId) return { coupleId: d.coupleId, role: d.role || 'user1' }; }
    } catch (e) {}
    return null;
  }

  async function api(method, path, body, isForm) {
    const opts = { method, headers: isForm ? {} : { 'Content-Type': 'application/json' } };
    if (body) opts.body = isForm ? body : JSON.stringify(body);
    const r = await fetch(API + path, opts);
    let data = null; try { data = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error((data && data.error) || ('Request failed: ' + r.status));
    return data;
  }

  // FAST upload: browser → Supabase Storage directly via a signed URL.
  // Falls back to the old /api/media/upload-audio route if that fails.
  async function uploadAudio(file, ctx) {
    try {
      const s = await api('POST', '/api/media/audio-upload-url', { coupleId: ctx.coupleId, filename: file.name, size: file.size });
      const form = new FormData();
      form.append('cacheControl', '3600');
      form.append('', file);
      const r = await fetch(s.signedUrl, { method: 'PUT', body: form });
      if (!r.ok) throw new Error('direct upload ' + r.status);
      return { url: s.url, path: s.path };
    } catch (e) {
      const f = new FormData(); f.append('file', file); f.append('coupleId', ctx.coupleId);
      return api('POST', '/api/media/upload-audio', f, true);
    }
  }
  function withTimeout(p, ms, fallback) {
    return Promise.race([p, new Promise(r => setTimeout(() => r(fallback), ms))]);
  }

  function escH(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function fmtDur(sec) { if (!sec) return '0:00'; const m = Math.floor(sec / 60), s = Math.floor(sec % 60); return m + ':' + (s + '').padStart(2, '0'); }
  function toast(msg) { if (window.MusicPlayer && window.MusicPlayer.toast) window.MusicPlayer.toast(msg); }

  /* ═══════════════════════════════════════
     STYLES — progress overlay + verify form + duplicate dialog
     (all scoped under mis- prefixes, reusing the app's existing
     CSS variables so it matches the current theme automatically)
  ═══════════════════════════════════════ */
  function injectStyles() {
    if (document.getElementById('misStyles')) return;
    const css = `
    .mis-overlay{position:fixed;inset:0;z-index:1400;background:rgba(0,0,0,.68);backdrop-filter:blur(10px);display:none;align-items:center;justify-content:center;padding:20px}
    .mis-overlay.open{display:flex}
    .mis-card{width:100%;max-width:420px;background:rgba(24,10,18,.97);backdrop-filter:blur(30px) saturate(200%);border:1px solid rgba(255,255,255,.15);border-radius:24px;padding:30px 26px;text-align:center;box-shadow:0 30px 90px rgba(0,0,0,.55);animation:misPop .35s cubic-bezier(.34,1.56,.64,1)}
    @keyframes misPop{from{opacity:0;transform:scale(.9) translateY(16px)}to{opacity:1;transform:scale(1) translateY(0)}}
    .mis-spin{width:52px;height:52px;margin:0 auto 18px;border-radius:50%;border:3px solid rgba(255,255,255,.12);border-top-color:var(--accent,#C21A8B);animation:misSpin 0.9s linear infinite}
    @keyframes misSpin{to{transform:rotate(360deg)}}
    .mis-step-label{font-family:var(--ff-serif,serif);font-size:17px;color:#fff;margin-bottom:6px}
    .mis-step-sub{font-size:12px;color:rgba(255,255,255,.45);margin-bottom:18px}
    .mis-steps{display:flex;justify-content:center;gap:8px;margin-top:4px}
    .mis-dot{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.18);transition:all .3s}
    .mis-dot.active{background:var(--accent,#C21A8B);box-shadow:0 0 8px var(--accent,#C21A8B);transform:scale(1.3)}
    .mis-dot.done{background:var(--green,#34d399)}

    .mis-verify-card{width:100%;max-width:420px;background:rgba(24,10,18,.97);backdrop-filter:blur(30px) saturate(200%);border:1px solid rgba(255,255,255,.15);border-radius:22px;padding:22px;max-height:88vh;overflow-y:auto;box-shadow:0 30px 90px rgba(0,0,0,.55)}
    .mis-verify-title{font-family:var(--ff-serif,serif);font-size:18px;color:#fff;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center}
    .mis-verify-title button{background:none;border:none;color:rgba(255,255,255,.5);font-size:18px;cursor:pointer}
    .mis-art-row{display:flex;gap:14px;align-items:center;margin-bottom:16px}
    .mis-art-preview{width:72px;height:72px;border-radius:14px;object-fit:cover;border:1px solid rgba(255,255,255,.15);flex-shrink:0;background:linear-gradient(135deg,var(--accent,#C21A8B),var(--accent2,#B0127A));display:flex;align-items:center;justify-content:center;font-size:26px}
    .mis-art-preview img{width:100%;height:100%;object-fit:cover;border-radius:14px}
    .mis-art-replace{font-size:11px;color:rgba(255,255,255,.55);cursor:pointer;position:relative;display:inline-block;padding:6px 12px;border-radius:8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15)}
    .mis-art-replace input{position:absolute;inset:0;opacity:0;cursor:pointer}
    .mis-field-row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .mis-meta-chip-row{display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 14px}
    .mis-meta-chip{font-size:10px;font-weight:700;color:rgba(255,255,255,.5);background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);padding:3px 8px;border-radius:8px}
    .mis-lyrics-chip{font-size:10px;font-weight:700;padding:4px 10px;border-radius:10px;margin-bottom:14px;display:inline-flex;align-items:center;gap:5px}
    .mis-lyrics-chip.found{background:rgba(52,211,153,.15);color:#34d399;border:1px solid rgba(52,211,153,.3)}
    .mis-lyrics-chip.miss{background:rgba(255,255,255,.05);color:rgba(255,255,255,.4);border:1px solid rgba(255,255,255,.1)}
    .mis-lyrics-chip.loading{background:rgba(194,26,139,.12);color:#C21A8B;border:1px solid rgba(194,26,139,.3)}
    .mis-warn{font-size:11px;color:#fbbf24;margin-bottom:10px}

    .mis-dup-actions{display:flex;flex-direction:column;gap:8px;margin-top:16px}
    .mis-dup-btn{padding:12px;border-radius:14px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#fff;font-weight:600;font-size:13px;cursor:pointer}
    .mis-dup-btn:hover{background:rgba(255,255,255,.13)}
    .mis-dup-btn.primary{background:linear-gradient(135deg,var(--accent,#C21A8B),var(--accent-d,#B0127A));border:none}
    .mis-dup-btn.danger{background:rgba(248,113,113,.15);border-color:rgba(248,113,113,.35);color:#f87171}
    `;
    const s = document.createElement('style'); s.id = 'misStyles'; s.textContent = css; document.head.appendChild(s);
  }

  /* ═══════════════════════════════════════
     PROGRESS OVERLAY (Step 10 + 11 — premium, async, non-blocking)
  ═══════════════════════════════════════ */
  const STEP_LABELS = [
    { key: 'meta', label: 'Reading Metadata…' },
    { key: 'art', label: 'Extracting Artwork…' },
    { key: 'lyrics', label: 'Searching Lyrics…' },
    { key: 'save', label: 'Saving Song…' },
    { key: 'done', label: 'Complete ✓' },
  ];

  function injectProgressOverlay() {
    if (document.getElementById('misProgressOverlay')) return;
    const el = document.createElement('div');
    el.id = 'misProgressOverlay'; el.className = 'mis-overlay';
    el.innerHTML = `
      <div class="mis-card">
        <div class="mis-spin" id="misSpin"></div>
        <div class="mis-step-label" id="misStepLabel">Reading Metadata…</div>
        <div class="mis-step-sub" id="misStepSub"></div>
        <div class="mis-steps" id="misSteps">
          ${STEP_LABELS.map(s => `<div class="mis-dot" data-step="${s.key}"></div>`).join('')}
        </div>
      </div>`;
    document.body.appendChild(el);
  }
  function showProgress(fileLabel) {
    document.getElementById('misStepSub').textContent = fileLabel || '';
    document.getElementById('misProgressOverlay').classList.add('open');
    setProgressStep('meta');
  }
  function hideProgress() { document.getElementById('misProgressOverlay').classList.remove('open'); }
  function setProgressStep(key) {
    const idx = STEP_LABELS.findIndex(s => s.key === key);
    document.getElementById('misStepLabel').textContent = (STEP_LABELS[idx] || {}).label || '';
    document.querySelectorAll('#misSteps .mis-dot').forEach((dot, i) => {
      dot.classList.toggle('active', i === idx);
      dot.classList.toggle('done', i < idx || key === 'done');
    });
    if (key === 'done') document.getElementById('misSpin').style.display = 'none';
    else document.getElementById('misSpin').style.display = 'block';
  }

  /* ═══════════════════════════════════════
     VERIFY FORM (Step 2/3/4 — auto-filled, user edits, Save)
  ═══════════════════════════════════════ */
  function injectVerifyModal() {
    if (document.getElementById('misVerifyOverlay')) return;
    const el = document.createElement('div');
    el.id = 'misVerifyOverlay'; el.className = 'mis-overlay';
    el.innerHTML = `
      <div class="mis-verify-card">
        <div class="mis-verify-title"><span>🎵 Verify Song Details</span><button id="misVerifyClose">✕</button></div>

        <div class="mis-art-row">
          <div class="mis-art-preview" id="misArtPreview"><span>🎵</span></div>
          <label class="mis-art-replace">📷 Replace Artwork
            <input type="file" accept="image/*" id="misArtReplaceInput">
          </label>
        </div>

        <div id="misLyricsChip"></div>

        <div class="sm-field"><label>Title</label><input type="text" id="misTitle"></div>
        <div class="mis-field-row2">
          <div class="sm-field"><label>Artist</label><input type="text" id="misArtist"></div>
          <div class="sm-field"><label>Album</label><input type="text" id="misAlbum"></div>
        </div>
        <div class="mis-field-row2">
          <div class="sm-field"><label>Genre</label><input type="text" id="misGenre"></div>
          <div class="sm-field"><label>Year</label><input type="number" id="misYear" min="1900" max="2100"></div>
        </div>
        <div class="mis-field-row2">
          <div class="sm-field"><label>Album Artist</label><input type="text" id="misAlbumArtist"></div>
          <div class="sm-field"><label>Composer</label><input type="text" id="misComposer"></div>
        </div>
        <div class="mis-field-row2">
          <div class="sm-field"><label>Track #</label><input type="number" id="misTrack" min="0"></div>
          <div class="sm-field"><label>Disc #</label><input type="number" id="misDisc" min="0"></div>
        </div>

        <div class="mis-meta-chip-row" id="misMetaChips"></div>

        <div class="sm-field">
          <label>Visibility</label>
          <select id="misVis">
            <option value="both">👥 Both can hear</option>
            <option value="my">❤️ Only Me</option>
            <option value="partner">💜 Partner Only</option>
          </select>
        </div>

        <div class="mis-warn" id="misWarn" style="display:none"></div>

        <button class="sm-save-btn" id="misSaveBtn">✅ Save Song</button>
      </div>`;
    document.body.appendChild(el);
    document.getElementById('misVerifyClose').onclick = () => cancelCurrent();
    el.addEventListener('click', e => { if (e.target === el) cancelCurrent(); });
  }

  function injectDupModal() {
    if (document.getElementById('misDupOverlay')) return;
    const el = document.createElement('div');
    el.id = 'misDupOverlay'; el.className = 'mis-overlay';
    el.innerHTML = `
      <div class="mis-card" style="text-align:left">
        <div style="text-align:center;font-size:34px;margin-bottom:6px">🎵</div>
        <div class="mis-step-label" style="text-align:center">This song already exists.</div>
        <div class="mis-step-sub" style="text-align:center" id="misDupSub"></div>
        <div class="mis-dup-actions">
          <button class="mis-dup-btn primary" id="misDupReplace">🔁 Replace</button>
          <button class="mis-dup-btn" id="misDupKeepBoth">➕ Keep Both</button>
          <button class="mis-dup-btn danger" id="misDupCancel">✕ Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(el);
  }

  /* ═══════════════════════════════════════
     IMPORT QUEUE / PIPELINE
  ═══════════════════════════════════════ */
  let queue = [];
  let current = null; // { file, meta, lyricsPromise, pictureDataUrl }
  let resolveVerify = null;

  function enqueueFiles(fileList, inputEl) {
    const files = Array.from(fileList).filter(f => window.MetadataService.isSupported(f));
    if (inputEl) inputEl.value = ''; // allow re-selecting the same file later
    if (!files.length) { toast('No valid audio files selected'); return; }
    if (files.length > 1) { runBatch(files); return; }  // multi-select => automatic quick import
    queue.push(...files);
    if (!current) processNext();
  }

  async function processNext() {
    if (!queue.length) { current = null; return; }
    const file = queue.shift();
    current = { file };
    const ctx = getCoupleCtx();
    // Start uploading the audio the moment the file is picked — it runs
    // while the user reviews the form, so Save is near-instant.
    const uploadPromise = ctx ? uploadAudio(file, ctx) : null;
    if (uploadPromise) uploadPromise.catch(() => {});
    showProgress(file.name);

    try {
      setProgressStep('meta');
      const rawMeta = await window.MetadataService.extract(file);
      const meta = window.MetadataNormalizer.normalize(rawMeta);
      current.meta = meta;
      current.pictureDataUrl = meta.pictureDataUrl;

      const lyricsPromise = window.LyricsSearch.search(
        { cleanTitle: meta.cleanTitle, cleanArtist: meta.cleanArtist, cleanAlbum: meta.cleanAlbum, filename: file.name },
        meta.durationSec
      );

      hideProgress();
      const verified = await openVerifyForm(file, meta, lyricsPromise);
      if (verified === null) { processNext(); return; } // cancelled

      showProgress(file.name);
      setProgressStep('save');
      await saveSong(file, verified, uploadPromise);
      setProgressStep('done');
      await tinyDelay(250);
      hideProgress();
    } catch (e) {
      hideProgress();
      toast('Import failed: ' + e.message + ' — try again or edit manually');
    }
    processNext();
  }

  /* ═══════════════════════════════════════
     BATCH (multi-select): fully automatic, 3 songs at a time.
     Metadata → duplicate check → [upload ‖ lyrics ‖ artwork] → save.
     Duplicates are skipped; lyrics missed here are retried by the
     background worker. Edit any song afterwards from the song menu.
  ═══════════════════════════════════════ */
  async function runBatch(files) {
    const ctx = getCoupleCtx();
    if (!ctx) { toast('Not connected yet'); return; }
    let idx = 0, done = 0, ok = 0, skipped = 0, failed = 0;
    const total = files.length;
    showProgress(`0 / ${total} songs`);
    document.getElementById('misStepLabel').textContent = 'Importing songs…';
    const tick = () => { document.getElementById('misStepSub').textContent = `${done} / ${total} songs`; };

    const worker = async () => {
      while (idx < files.length) {
        const file = files[idx++];
        try { (await importOneAuto(file, ctx)) === 'dup' ? skipped++ : ok++; }
        catch (e) { failed++; console.warn('[import]', file.name, e.message); }
        done++; tick();
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, total) }, worker));
    hideProgress();
    toast(`✅ ${ok} imported` + (skipped ? ` · ${skipped} already existed` : '') + (failed ? ` · ${failed} failed` : ''));
  }

  async function importOneAuto(file, ctx) {
    const meta = window.MetadataNormalizer.normalize(await window.MetadataService.extract(file));
    const title = meta.cleanTitle || (file.name || 'Untitled').replace(/\.[^.]+$/, '');
    const artist = meta.cleanArtist || 'Unknown Artist';
    if (window.CacheService.findDuplicate(window.Store.songs, { title, artist, durationSec: meta.durationSec })) return 'dup';

    const [audioRes, lyricsRes, coverUrl] = await Promise.all([
      uploadAudio(file, ctx),
      withTimeout(window.LyricsSearch.search({ cleanTitle: title, cleanArtist: meta.cleanArtist, cleanAlbum: meta.cleanAlbum, filename: file.name }, meta.durationSec), 9000, { found: false }),
      meta.pictureDataUrl ? window.ArtworkService.uploadArtwork(ctx.coupleId, meta.pictureDataUrl, file) : Promise.resolve(null),
    ]);
    await createSongRow(ctx, {
      meta, audioRes, coverUrl, lyricsRes,
      verified: {
        title, artist, album: meta.cleanAlbum || null, genre: meta.cleanGenre || null, year: meta.year || null,
        albumArtist: meta.cleanAlbumArtist || null, composer: meta.cleanComposer || null,
        track: meta.track || null, disc: meta.disc || null, visibility: 'both',
      },
      quiet: true,
    });
    return 'ok';
  }

  function tinyDelay(ms) { return new Promise(r => setTimeout(r, ms)); }

  function renderMetaChips(meta) {
    const chips = [];
    if (meta.durationSec) chips.push(`⏱ ${fmtDur(meta.durationSec)}`);
    if (meta.bitrateKbps) chips.push(`🎚 ${meta.bitrateKbps} kbps`);
    if (meta.fileSize) chips.push(`💾 ${(meta.fileSize / (1024 * 1024)).toFixed(1)} MB`);
    if (meta.format) chips.push(`📄 ${meta.format.toUpperCase()}`);
    return chips.map(c => `<span class="mis-meta-chip">${escH(c)}</span>`).join('');
  }

  function openVerifyForm(file, meta, lyricsPromise) {
    injectVerifyModal();
    return new Promise((resolve) => {
      resolveVerify = resolve;
      const $ = (id) => document.getElementById(id);

      // Display CLEANED values everywhere (Step: DISPLAY) — never the
      // raw, site-branded tags. Raw values still travel with `meta` and
      // are sent to the backend unchanged for storage (Step: DATABASE).
      $('misTitle').value = meta.cleanTitle || meta.title || '';
      $('misArtist').value = meta.cleanArtist || meta.artist || '';
      $('misAlbum').value = meta.cleanAlbum || meta.album || '';
      $('misGenre').value = meta.cleanGenre || meta.genre || '';
      $('misYear').value = meta.year || '';
      $('misAlbumArtist').value = meta.cleanAlbumArtist || '';
      $('misComposer').value = meta.cleanComposer || '';
      $('misTrack').value = meta.track || '';
      $('misDisc').value = meta.disc || '';
      $('misVis').value = 'both';
      $('misMetaChips').innerHTML = renderMetaChips(meta);

      const artPrev = $('misArtPreview');
      artPrev.innerHTML = meta.pictureDataUrl ? `<img src="${meta.pictureDataUrl}" alt="">` : '<span>🎵</span>';
      current.pictureDataUrl = meta.pictureDataUrl || null;

      const warn = $('misWarn');
      if (!meta.tagReadOk) {
        warn.style.display = 'block';
        warn.textContent = '⚠️ Could not read embedded tags automatically — please fill in details manually.';
      } else warn.style.display = 'none';

      // Lyrics chip: loading -> found/miss, never blocks the form
      const chipEl = $('misLyricsChip');
      chipEl.innerHTML = `<span class="mis-lyrics-chip loading">🔎 Searching lyrics…</span>`;
      current.lyricsResult = null;
      lyricsPromise.then(res => {
        current.lyricsResult = res;
        chipEl.innerHTML = res.found
          ? `<span class="mis-lyrics-chip found">📜 Synced lyrics found</span>`
          : `<span class="mis-lyrics-chip miss">📭 No lyrics found — song will still save</span>`;
      });

      $('misArtReplaceInput').onchange = (e) => {
        const f = e.target.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = (ev) => {
          current.pictureDataUrl = ev.target.result;
          current.replacedArtFile = f;
          artPrev.innerHTML = `<img src="${ev.target.result}" alt="">`;
        };
        r.readAsDataURL(f);
      };

      $('misSaveBtn').onclick = async () => {
        const payload = {
          title: $('misTitle').value.trim() || 'Untitled',
          artist: $('misArtist').value.trim() || 'Unknown Artist',
          album: $('misAlbum').value.trim() || null,
          genre: $('misGenre').value.trim() || null,
          year: $('misYear').value ? parseInt($('misYear').value, 10) : null,
          albumArtist: $('misAlbumArtist').value.trim() || null,
          composer: $('misComposer').value.trim() || null,
          track: $('misTrack').value ? parseInt($('misTrack').value, 10) : null,
          disc: $('misDisc').value ? parseInt($('misDisc').value, 10) : null,
          visibility: $('misVis').value,
        };

        // STEP 9 — duplicate detection before save
        const dup = window.CacheService.findDuplicate(window.Store.songs, {
          title: payload.title, artist: payload.artist, durationSec: meta.durationSec,
        });
        document.getElementById('misVerifyOverlay').classList.remove('open');
        if (dup) {
          const action = await promptDuplicate(dup);
          if (action === 'cancel') { resolveVerify(null); return; }
          if (action === 'replace') payload._replaceId = dup.id;
        }
        // Step 8 — do NOT block Save on the lyrics search. Use whatever
        // has already resolved (fast path — often ready by now since it
        // started the moment metadata was read), otherwise save with no
        // lyrics and let the background worker pick it up right after.
        const lyricsRes = current.lyricsResult || { found: false, _pending: true };
        resolveVerify({ ...payload, meta, lyricsRes });
      };

      document.getElementById('misVerifyOverlay').classList.add('open');
    });
  }

  function cancelCurrent() {
    document.getElementById('misVerifyOverlay').classList.remove('open');
    if (resolveVerify) { resolveVerify(null); resolveVerify = null; }
  }

  function promptDuplicate(existing) {
    injectDupModal();
    return new Promise((resolve) => {
      document.getElementById('misDupSub').textContent = `"${existing.title}" by ${existing.artist || 'Unknown Artist'} is already in the library.`;
      const overlay = document.getElementById('misDupOverlay');
      overlay.classList.add('open');
      const finish = (val) => { overlay.classList.remove('open'); resolve(val); };
      document.getElementById('misDupReplace').onclick = () => finish('replace');
      document.getElementById('misDupKeepBoth').onclick = () => finish('keep_both');
      document.getElementById('misDupCancel').onclick = () => finish('cancel');
    });
  }

  /* ═══════════════════════════════════════
     SAVE (Steps 6/7/8 — upload, cache lyrics + art, expanded DB row)
  ═══════════════════════════════════════ */
  async function saveSong(file, verified, uploadPromise) {
    const ctx = getCoupleCtx();
    if (!ctx) { toast('Not connected yet'); return; }

    // Replace = delete the old row first (Step 9)
    if (verified._replaceId) {
      let removed = false;
      try { await api('DELETE', '/api/music/' + verified._replaceId, { coupleId: ctx.coupleId, viewer: ctx.role }); removed = true; }
      catch (e) { toast('Could not replace that song — ' + e.message + '. Keeping both.'); }
      if (removed) window.Store.songs = window.Store.songs.filter(s => s.id !== verified._replaceId);
    }

    // Audio is usually already uploaded (started when the file was picked);
    // artwork uploads in parallel with whatever is left of it.
    const coverP = current.pictureDataUrl
      ? window.ArtworkService.uploadArtwork(ctx.coupleId, current.replacedArtFile || current.pictureDataUrl, current.replacedArtFile ? null : file)
      : Promise.resolve(null);
    const [audioRes, coverUrl] = await Promise.all([uploadPromise || uploadAudio(file, ctx), coverP]);

    await createSongRow(ctx, { meta: verified.meta, audioRes, coverUrl, lyricsRes: verified.lyricsRes || { found: false }, verified });
  }

  async function createSongRow(ctx, { meta, audioRes, coverUrl, lyricsRes, verified, quiet }) {
    const song = await api('POST', '/api/music', {
      coupleId: ctx.coupleId,
      title: verified.title,
      artist: verified.artist,
      album: verified.album,
      albumArtist: verified.albumArtist,
      composer: verified.composer,
      genre: verified.genre,
      year: verified.year,
      track: verified.track,
      disc: verified.disc,
      audioUrl: audioRes.url,
      coverUrl,
      durationSec: meta.durationSec,
      durationMs: meta.durationMs,
      bitrate: meta.bitrateKbps,
      fileSize: meta.fileSize,
      visibility: verified.visibility,
      uploadedBy: ctx.role,
      lyrics: lyricsRes.found ? lyricsRes.lyricsNative : '',
      lyricsCached: !!lyricsRes.found,
      lyricsSource: lyricsRes.found ? lyricsRes.source : null,
      lyricsUpdatedAt: lyricsRes.found ? new Date().toISOString() : null,
      rawTitle: meta.rawTitle, cleanTitle: meta.cleanTitle,
      rawArtist: meta.rawArtist, cleanArtist: meta.cleanArtist,
      rawAlbum: meta.rawAlbum, cleanAlbum: meta.cleanAlbum,
      rawAlbumArtist: meta.rawAlbumArtist, cleanAlbumArtist: meta.cleanAlbumArtist,
    });

    window.Store.songs.unshift(song);
    window.AudioService.setLibrary(window.Store.songs);
    if (typeof window.renderMusicTracks === 'function') window.renderMusicTracks();
    if (typeof window.checkAchievements === 'function') window.checkAchievements();

    // No lyrics yet? the background worker keeps trying after save (never blocks).
    window.LyricsBackgroundWorker.enqueue(song, ctx.coupleId);
    if (!quiet) toast('✅ ' + verified.title + ' imported!');
    return song;
  }

  /* ═══════════════════════════════════════
     INIT
  ═══════════════════════════════════════ */
  whenReady(function () {
    injectStyles();
    injectProgressOverlay();
    injectVerifyModal();
    injectDupModal();
  });

  window.ImportService = { enqueueFiles };
})();