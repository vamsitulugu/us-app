/* ═══════════════════════════════════════════════════════════════
   KARAOKE FIX + LYRICS WORKFLOW PATCH
   Load AFTER music-player.js:
     <script src="/music-player.js"></script>
     <script src="/music-player-karaoke-patch.js"></script>

   Fixes:
   - Play/Pause/Resume/Seek in Karaoke (old code called togglePlay(),
     prevSong(), nextSong(), playAll(), toggleShuffle(), toggleRepeat(),
     seekSong() — none of which exist after the AudioService rewrite,
     so every click silently threw and did nothing).
   - Implements the "Lyrics not found" popup workflow: check for saved
     lyrics -> open Karaoke immediately if found, otherwise show
     Open Lyrics Website / Paste Lyrics / Upload LRC File / Cancel.
   - Validates LRC format before saving; saved lyrics persist to the
     song permanently (via the existing PATCH /api/music/:id route)
     and Karaoke auto-opens right after a successful save.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function whenReady(fn) {
    if (window.AudioService && window.Store && window.MusicPlayer && typeof karaokeState !== 'undefined') fn();
    else setTimeout(() => whenReady(fn), 150);
  }

  function escH(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  /* ── LRC validation (mirrors the parser already used for playback) ── */
  const LRC_LINE_RE = /^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/m;
  function validateLRC(text) {
    if (!text || !text.trim()) return { ok: false, reason: 'Please paste or upload some lyrics first.' };
    if (!LRC_LINE_RE.test(text)) {
      return { ok: false, reason: 'This doesn\'t look like synced LRC lyrics. Each line should look like: [00:12.34] Some lyric text' };
    }
    return { ok: true };
  }

  /* ── inject styles ── */
  function injectStyles() {
    const css = `
    .lyr-nf-overlay,.lyr-paste-overlay{position:fixed;inset:0;z-index:1100;background:rgba(0,0,0,.65);backdrop-filter:blur(8px);display:none;align-items:center;justify-content:center;padding:20px}
    .lyr-nf-overlay.open,.lyr-paste-overlay.open{display:flex}
    .lyr-nf-card{width:100%;max-width:380px;background:rgba(10,10,24,.97);backdrop-filter:blur(30px) saturate(200%);border:1px solid rgba(255,255,255,.15);border-radius:22px;padding:26px 22px;text-align:center;animation:lyrNfIn .3s cubic-bezier(.34,1.56,.64,1);box-shadow:0 24px 70px rgba(0,0,0,.5)}
    @keyframes lyrNfIn{from{opacity:0;transform:scale(.9) translateY(14px)}to{opacity:1;transform:scale(1) translateY(0)}}
    .lyr-nf-ico{font-size:38px;margin-bottom:8px}
    .lyr-nf-title{font-family:var(--ff-serif,serif);font-size:19px;color:#fff;margin-bottom:16px}
    .lyr-nf-label{font-size:9px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:rgba(255,255,255,.4);margin-top:8px}
    .lyr-nf-song{font-size:15px;font-weight:700;color:#fff}
    .lyr-nf-artist{font-size:12px;color:rgba(255,255,255,.55);margin-bottom:18px}
    .lyr-nf-btn{width:100%;padding:12px;margin-bottom:9px;border-radius:14px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#fff;font-size:13px;font-weight:600;cursor:pointer;transition:.2s;display:flex;align-items:center;justify-content:center;gap:8px}
    .lyr-nf-btn:hover{background:rgba(255,255,255,.13);transform:translateY(-1px)}
    .lyr-nf-btn.primary{background:linear-gradient(135deg,var(--accent,#5b9bff),var(--accent-d,#2f6feb));border:none;box-shadow:0 6px 20px rgba(91,155,255,.4)}
    .lyr-nf-btn.cancel{background:transparent;border:none;color:rgba(255,255,255,.45);margin-top:4px;box-shadow:none}
    .lyr-paste-card{width:100%;max-width:460px;background:rgba(10,10,24,.97);backdrop-filter:blur(30px) saturate(200%);border:1px solid rgba(255,255,255,.15);border-radius:22px;padding:22px;box-shadow:0 24px 70px rgba(0,0,0,.5)}
    .lyr-paste-title{font-family:var(--ff-serif,serif);font-size:17px;color:#fff;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center}
    .lyr-paste-title button{background:none;border:none;color:rgba(255,255,255,.5);font-size:18px;cursor:pointer}
    .lyr-paste-ta{width:100%;min-height:180px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.15);border-radius:12px;padding:12px;color:#fff;font-family:'SFMono-Regular',Consolas,monospace;font-size:12px;line-height:1.6;resize:vertical;outline:none}
    .lyr-paste-ta:focus{border-color:var(--accent,#5b9bff)}
    .lyr-paste-hint{font-size:11px;color:rgba(255,255,255,.4);margin:8px 0 4px;line-height:1.5}
    .lyr-paste-err{font-size:12px;color:#f87171;margin:6px 0 4px;display:none}
    .lyr-paste-actions{display:flex;gap:8px;margin-top:14px}
    .lyr-paste-actions button{flex:1;padding:11px;border-radius:12px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#fff;font-weight:600;font-size:13px;cursor:pointer;transition:.2s}
    .lyr-paste-actions button:hover{background:rgba(255,255,255,.12)}
    .lyr-paste-actions button.primary{background:linear-gradient(135deg,var(--accent,#5b9bff),var(--accent-d,#2f6feb));border:none}
    .lyr-file-label{display:inline-flex;gap:6px;align-items:center;padding:9px 14px;border-radius:10px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);color:#fff;font-size:12px;cursor:pointer;margin-bottom:12px;position:relative}
    .lyr-file-label input{position:absolute;inset:0;opacity:0;cursor:pointer}
    `;
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
  }

  /* ── DOM: lyrics-not-found popup ── */
  function injectNotFoundPopup() {
    if (document.getElementById('lyrNfOverlay')) return;
    const el = document.createElement('div');
    el.id = 'lyrNfOverlay'; el.className = 'lyr-nf-overlay';
    el.innerHTML = `
      <div class="lyr-nf-card">
        <div class="lyr-nf-ico">🎤</div>
        <div class="lyr-nf-title">Lyrics not found</div>
        <div class="lyr-nf-label">Song</div>
        <div class="lyr-nf-song" id="lyrNfSong">—</div>
        <div class="lyr-nf-label">Artist</div>
        <div class="lyr-nf-artist" id="lyrNfArtist">—</div>
        <button class="lyr-nf-btn primary" id="lyrNfOpenSite">🌐 Open Lyrics Website</button>
        <button class="lyr-nf-btn" id="lyrNfPaste">📋 Paste Lyrics</button>
        <button class="lyr-nf-btn" id="lyrNfUploadTrigger">📂 Upload LRC File
          <input type="file" id="lyrNfUploadInput" accept=".lrc,text/plain" style="display:none">
        </button>
        <button class="lyr-nf-btn cancel" id="lyrNfCancel">❌ Cancel</button>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', e => { if (e.target === el) closeNotFoundPopup(); });
    document.getElementById('lyrNfCancel').onclick = closeNotFoundPopup;
    document.getElementById('lyrNfOpenSite').onclick = () => {
      const s = window._lyrNfSong;
      if (!s) return;
      const q = encodeURIComponent(`${s.title} ${s.artist || ''}`.trim());
      window.open(`https://www.lyricsify.com/search?q=${q}`, '_blank', 'noopener');
    };
    document.getElementById('lyrNfPaste').onclick = () => { closeNotFoundPopup(); openPasteModal('paste'); };
    document.getElementById('lyrNfUploadTrigger').onclick = (e) => {
      if (e.target.id === 'lyrNfUploadInput') return;
      document.getElementById('lyrNfUploadInput').click();
    };
    document.getElementById('lyrNfUploadInput').addEventListener('change', (e) => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { closeNotFoundPopup(); openPasteModal('upload', reader.result); };
      reader.readAsText(file);
      e.target.value = '';
    });
  }
  function openNotFoundPopup(song) {
    window._lyrNfSong = song;
    document.getElementById('lyrNfSong').textContent = song.title || 'Untitled';
    document.getElementById('lyrNfArtist').textContent = song.artist || 'Unknown Artist';
    document.getElementById('lyrNfOverlay').classList.add('open');
  }
  function closeNotFoundPopup() { document.getElementById('lyrNfOverlay').classList.remove('open'); }

  /* ── DOM: paste / upload-review modal ── */
  function injectPasteModal() {
    if (document.getElementById('lyrPasteOverlay')) return;
    const el = document.createElement('div');
    el.id = 'lyrPasteOverlay'; el.className = 'lyr-paste-overlay';
    el.innerHTML = `
      <div class="lyr-paste-card">
        <div class="lyr-paste-title"><span>📋 Paste Synced Lyrics</span><button id="lyrPasteClose">✕</button></div>
        <div class="lyr-paste-hint">Paste LRC-format lyrics copied from Lyricsify, e.g.<br><code>[00:12.34] First line of the song</code></div>
        <textarea class="lyr-paste-ta" id="lyrPasteTa" placeholder="[00:12.34] First line...
[00:16.02] Second line..."></textarea>
        <div class="lyr-paste-err" id="lyrPasteErr"></div>
        <div class="lyr-paste-actions">
          <button id="lyrPasteCancel">Cancel</button>
          <button class="primary" id="lyrPasteSave">✅ Save & Open Karaoke</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', e => { if (e.target === el) closePasteModal(); });
    document.getElementById('lyrPasteClose').onclick = closePasteModal;
    document.getElementById('lyrPasteCancel').onclick = closePasteModal;
    document.getElementById('lyrPasteSave').onclick = confirmPasteSave;
  }
  function openPasteModal(mode, prefill) {
    document.getElementById('lyrPasteErr').style.display = 'none';
    document.getElementById('lyrPasteTa').value = prefill || '';
    document.getElementById('lyrPasteOverlay').classList.add('open');
    document.getElementById('lyrPasteTa').focus();
  }
  function closePasteModal() { document.getElementById('lyrPasteOverlay').classList.remove('open'); }

  async function confirmPasteSave() {
    const song = window._lyrNfSong; if (!song) { closePasteModal(); return; }
    const text = document.getElementById('lyrPasteTa').value;
    const check = validateLRC(text);
    const errEl = document.getElementById('lyrPasteErr');
    if (!check.ok) { errEl.textContent = check.reason; errEl.style.display = 'block'; return; }
    const btn = document.getElementById('lyrPasteSave');
    const orig = btn.textContent; btn.textContent = 'Saving…'; btn.disabled = true;
    try {
      const ctx = window.MusicPlayer.getCoupleCtx();
      if (!ctx) throw new Error('Not connected');
      await window.MusicPlayer.api('PATCH', '/api/music/' + song.id, { coupleId: ctx.coupleId, lyrics: text });
      song.lyrics = text; // permanently linked to this song in Store
      window.MusicPlayer.toast('Lyrics saved 📜 — never asked again for this song');
      closePasteModal();
      openKaraokeForSong(song.id);
    } catch (e) {
      errEl.textContent = 'Could not save lyrics: ' + e.message; errEl.style.display = 'block';
    } finally {
      btn.textContent = orig; btn.disabled = false;
    }
  }

  /* ── entry point used by the ⋯ action sheet "Sing With Lyrics" ── */
  function openKaraokeForSong(songId) {
    const s = window.Store.songs.find(x => x.id === songId);
    if (!s || typeof openKaraokeMode !== 'function') return;
    const mine = (function () {
      try { const ctx = window.MusicPlayer.getCoupleCtx(); return s.uploaded_by === (ctx ? ctx.role : 'user1'); } catch (e) { return true; }
    })();
    const list = mine ? window.Store.songs.filter(x => x.uploaded_by === s.uploaded_by) : window.Store.songs.filter(x => x.uploaded_by !== (window.MusicPlayer.getCoupleCtx() || {}).role);
    const pl = mine ? 'my' : 'partner';
    const idx = list.findIndex(x => x.id === s.id);
    openKaraokeMode(pl, Math.max(0, idx));
  }

  window.karaokeOpenById = function (songId) {
    const s = window.Store.songs.find(x => x.id === songId); if (!s) return;
    if (s.lyrics && s.lyrics.trim()) {
      // Lyrics already exist -> open Karaoke immediately, never ask again
      openKaraokeForSong(songId);
    } else {
      openNotFoundPopup(s);
    }
  };

  /* ── FIX: playback control shims that the old code still calls ── */
  function installControlShims() {
    window.togglePlay = function () { window.AudioService.togglePlay(); };
    window.prevSong = function () { window.AudioService.prev(); };
    window.nextSong = function () { window.AudioService.next(true); };
    window.playAll = function (pl) { window.playAllList(pl === 'partner' ? 'partner' : 'my'); };
    window.toggleShuffle = function () {
      window.AudioService.setShuffle(!window.AudioService.shuffle);
      document.querySelectorAll('#shuffleBtn,#myShufflePill').forEach(b => b.classList.toggle('active', window.AudioService.shuffle));
    };
    window.toggleRepeat = function () {
      window.AudioService.cycleRepeat();
      document.querySelectorAll('#repeatBtn,#myRepeatPill').forEach(b => b.classList.toggle('active', window.AudioService.repeatMode !== 'off'));
    };
    window.seekSong = function (e) {
      const bar = document.getElementById('npProgressArea'); if (!bar) return;
      const r = bar.getBoundingClientRect();
      window.AudioService.seekPct((e.clientX - r.left) / r.width);
    };

    // Karaoke transport: single audio instance, driven by AudioService,
    // lyrics already resync off native `timeupdate` in the existing code.
    window.karaokeTogglePlay = function () {
      if (typeof karaokeAudioCtx !== 'undefined' && karaokeAudioCtx && karaokeAudioCtx.state === 'suspended') {
        karaokeAudioCtx.resume().catch(() => {});
      }
      window.AudioService.togglePlay();
    };
    window.karaokeRestart = function () { window.AudioService.seek(0); window.AudioService.audio.play().catch(() => {}); };
    window.karaokeSeek = function (e) {
      const bar = document.getElementById('karaokeProgressArea'); if (!bar) return;
      const r = bar.getBoundingClientRect();
      window.AudioService.seekPct((e.clientX - r.left) / r.width);
    };
  }

  whenReady(function () {
    injectStyles();
    injectNotFoundPopup();
    injectPasteModal();
    installControlShims();
  });
})();