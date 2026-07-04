/* ═══════════════════════════════════════════════════════════════
   MUSIC PLAYER — PRODUCTION REBUILD (single file)
   Load in music.html ONLY. Remove music_patch.js and
   music-player-core.js <script> tags — this file replaces both.

   ALSO REMOVE from music.html's inline <script> (keep the rest —
   karaoke, FX rack, achievements, movies — all untouched, they run
   AFTER this file and use the compatibility shims at the bottom):
     musicState.my/.partner + saveMusicLocal/loadMusicLocal
     handleFileUpload, processNextUpload, confirmSongSave, closeSongModal
     playTrack, togglePlay, prevSong, nextSong, playAll,
     toggleShuffle, toggleRepeat, seekSong, deleteTrack,
     updateNowPlaying, updatePlayBtn, updateNPArt
     renderMusicTracks/renderPlaylist/renderFavorites/renderRecent/renderKaraokeList
     the old audio 'timeupdate'/'ended'/'play'/'pause' listeners
     openLyricsModal/closeLyricsModal/saveLyrics (old plain-text version)

   Load order in music.html:
     <audio id="audioPlayer" preload="auto"></audio>
     ... rest of markup ...
     <script src="/music-player.js"></script>
     <script> /* trimmed inline script: karaoke, fx rack, achievements,
                  movies, action sheet wiring 
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const API = (function () {
    try { return window.parent?.API || window.API || 'https://us-app-api.onrender.com'; }
    catch (e) { return 'https://us-app-api.onrender.com'; }
  })();

  function getCoupleCtx() {
    try {
      const p = window.parent?.S;
      if (p && p.coupleId) return { coupleId: p.coupleId, role: p.role || 'user1', myName: p.myName || 'You', partnerName: p.partnerName || 'Partner' };
    } catch (e) {}
    try {
      const raw = localStorage.getItem('uwl_v5');
      if (raw) { const d = JSON.parse(raw); if (d.coupleId) return { coupleId: d.coupleId, role: d.role || 'user1', myName: d.myName || 'You', partnerName: d.partnerName || 'Partner' }; }
    } catch (e) {}
    return null;
  }

  async function api(method, path, body, isForm) {
    const opts = { method, headers: isForm ? {} : { 'Content-Type': 'application/json' } };
    if (body) opts.body = isForm ? body : JSON.stringify(body);
    const r = await fetch(API + path, opts);
    let data = null; try { data = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error(data?.error || ('Request failed: ' + r.status));
    return data;
  }

  function escH(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function fmtTime(s) { if (!s || isNaN(s)) return '0:00'; const m = Math.floor(s / 60), sec = Math.floor(s % 60); return m + ':' + (sec + '').padStart(2, '0'); }
  function fmtDurLong(sec) { if (!sec) return ''; const m = Math.floor(sec / 60); return m > 0 ? m + 'm ' + (sec % 60) + 's' : sec + 's'; }
  let _toastT;
  function toast(msg) {
    const t = document.getElementById('mmToast'); if (!t) { console.log(msg); return; }
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(_toastT); _toastT = setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(-50%) translateY(12px)'; }, 2800);
  }

  /* ═══════════════════════════════════════
     AUDIO SERVICE — single instance, single source of truth
  ═══════════════════════════════════════ */
  const AudioService = (function () {
    const audio = document.getElementById('audioPlayer');
    audio.preload = 'auto';

    let songs = [], queue = [], queueIdx = -1;
    let shuffle = false, repeatMode = 'off'; // off | one | all
    const listeners = {};
    const on = (e, fn) => (listeners[e] = listeners[e] || []).push(fn);
    const emit = (e, p) => (listeners[e] || []).forEach(fn => { try { fn(p); } catch (err) {} });

    const currentSong = () => (queueIdx >= 0 ? songs.find(s => s.id === queue[queueIdx]) : null);
    const setLibrary = (list) => { songs = list; emit('library', songs); };

    function buildQueue(list, startId) {
      queue = list.map(s => s.id);
      queueIdx = queue.indexOf(startId);
      if (shuffle) shuffleKeepCurrent();
    }
    function shuffleKeepCurrent() {
      const curId = queue[queueIdx];
      const rest = queue.filter(id => id !== curId);
      for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
      queue = curId != null ? [curId, ...rest] : rest;
      queueIdx = 0;
    }

    let lastCountedId = null;
    function registerPlayCount(s) {
      if (lastCountedId === s.id) return;
      lastCountedId = s.id;
      const ctx = getCoupleCtx(); if (!ctx) return;
      api('PATCH', '/api/music/' + s.id, { coupleId: ctx.coupleId, incrementPlay: true }).catch(() => {});
      s.play_count = (s.play_count || 0) + 1; s.last_played = Date.now();
    }

    function playCurrent() {
      const s = currentSong(); if (!s) return;
      if (!s.audio_url) { emit('error', 'This song has no audio file — try re-uploading it.'); return; }
      if (audio.src !== s.audio_url) audio.src = s.audio_url;
      audio.playbackRate = playbackRate;
      audio.play().then(() => { emit('play', s); registerPlayCount(s); }).catch(err => emit('error', 'Playback failed: ' + err.message));
    }

    function play(list, songId) { buildQueue(list, songId); playCurrent(); }
    function togglePlay() { if (!audio.src) { emit('error', 'Select a song first'); return; } if (audio.paused) audio.play().catch(() => {}); else audio.pause(); }
    function pause() { audio.pause(); }
    function stop() { audio.pause(); audio.currentTime = 0; }
    function next(manual) {
      if (!queue.length) return;
      if (repeatMode === 'one' && !manual) { audio.currentTime = 0; audio.play().catch(() => {}); return; }
      let idx = queueIdx + 1;
      if (idx >= queue.length) { if (repeatMode === 'all') idx = 0; else { emit('queueEnd'); return; } }
      queueIdx = idx; playCurrent();
    }
    function prev() {
      if (!queue.length) return;
      if (audio.currentTime > 3) { audio.currentTime = 0; return; }
      let idx = queueIdx - 1; if (idx < 0) idx = repeatMode === 'all' ? queue.length - 1 : 0;
      queueIdx = idx; playCurrent();
    }
    function setShuffle(v) { shuffle = v; if (shuffle && queue.length) shuffleKeepCurrent(); emit('shuffle', shuffle); }
    function cycleRepeat() { repeatMode = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off'; emit('repeat', repeatMode); }
    function seek(t) { if (audio.duration) audio.currentTime = Math.max(0, Math.min(audio.duration, t)); }
    function seekPct(p) { if (audio.duration) audio.currentTime = p * audio.duration; }
    let playbackRate = 1;
    function setPlaybackRate(r) { playbackRate = r; audio.playbackRate = r; emit('rate', r); }
    function setVolume(v) { audio.volume = Math.max(0, Math.min(1, v)); emit('volume', audio.volume); }
    function getQueueSongs() { return queue.map(id => songs.find(s => s.id === id)).filter(Boolean); }
    function playById(id) { const s = songs.find(x => x.id === id); if (s) play(songs, id); }

    audio.addEventListener('ended', () => next(false));
    audio.addEventListener('play', () => emit('state', true));
    audio.addEventListener('pause', () => emit('state', false));
    audio.addEventListener('timeupdate', () => emit('time', { cur: audio.currentTime, dur: audio.duration || 0 }));
    audio.addEventListener('error', () => emit('error', 'This song could not be loaded — try re-uploading it.'));

    return {
      on, audio, setLibrary, play, playById, togglePlay, pause, stop, next, prev,
      setShuffle, cycleRepeat, seek, seekPct, setPlaybackRate, setVolume,
      currentSong, getQueueSongs,
      get shuffle() { return shuffle; }, get repeatMode() { return repeatMode; }, get playbackRate() { return playbackRate; },
    };
  })();
  window.AudioService = AudioService;

  /* ═══════════════════════════════════════
     DATA LAYER
  ═══════════════════════════════════════ */
  const Store = { songs: [] };
  function myRole() { return (getCoupleCtx() || {}).role || 'user1'; }
  function isMine(s) { return s.uploaded_by === myRole(); }
  function myList() { return Store.songs.filter(isMine); }
  function partnerList() { return Store.songs.filter(s => !isMine(s)); }

  async function loadSongs() {
    const ctx = getCoupleCtx(); if (!ctx) return;
    try {
      const rows = await api('GET', '/api/music/' + ctx.coupleId);
      Store.songs = rows || [];
      AudioService.setLibrary(Store.songs);
      renderAllLists();
    } catch (e) { toast('Could not load songs: ' + e.message); }
  }

  /* ═══════════════════════════════════════
     UPLOAD FLOW
  ═══════════════════════════════════════ */
  let pendingUpload = null, _uploadQueue = [];

  function initUploadZones() {
    document.querySelectorAll('.upload-zone input[type=file]').forEach(input => {
      input.addEventListener('change', (e) => handleFilesPicked(e.target.files));
    });
  }
  function handleFilesPicked(fileList) {
    const files = Array.from(fileList).filter(f => f.type.startsWith('audio/') || /\.(mp3|m4a|wav|ogg|flac|aac|opus)$/i.test(f.name));
    if (!files.length) { toast('No valid audio files selected'); return; }
    _uploadQueue = files; processNextUpload();
  }
  function processNextUpload() {
    if (!_uploadQueue.length) return;
    const file = _uploadQueue.shift();
    const tmp = new Audio(URL.createObjectURL(file));
    tmp.onloadedmetadata = () => {
      const dur = Math.floor(tmp.duration || 0);
      let name = file.name.replace(/\.[^/.]+$/, '');
      let title = name, artist = 'Unknown Artist';
      const di = name.indexOf(' - ');
      if (di > -1) { artist = name.slice(0, di).trim(); title = name.slice(di + 3).trim(); }
      pendingUpload = { file, coverFile: null, durationSec: dur };
      openSongModal(title, artist);
    };
    tmp.onerror = () => { pendingUpload = { file, coverFile: null, durationSec: 0 }; openSongModal(file.name.replace(/\.[^/.]+$/, ''), ''); };
  }
  function openSongModal(title, artist) {
    const t = document.getElementById('smTitle'), a = document.getElementById('smArtist'), v = document.getElementById('smVis'), p = document.getElementById('smArtPreview');
    if (t) t.value = title || ''; if (a) a.value = artist || ''; if (v) v.value = 'both'; if (p) p.style.display = 'none';
    document.getElementById('songModal').classList.add('open');
  }
  window.closeSongModal = function () {
    document.getElementById('songModal').classList.remove('open');
    pendingUpload = null;
    if (_uploadQueue.length) setTimeout(processNextUpload, 250);
  };
  window.loadSongArt = function (input) {
    if (!input.files[0] || !pendingUpload) return;
    pendingUpload.coverFile = input.files[0];
    const r = new FileReader();
    r.onload = e => { const img = document.getElementById('smArtPreview'); img.src = e.target.result; img.style.display = 'block'; };
    r.readAsDataURL(input.files[0]);
  };
  window.confirmSongSave = async function () {
    if (!pendingUpload) { window.closeSongModal(); return; }
    const ctx = getCoupleCtx(); if (!ctx) { toast('Not connected yet'); return; }
    const btn = document.querySelector('.sm-save-btn'); const orig = btn ? btn.textContent : '';
    if (btn) { btn.textContent = 'Uploading…'; btn.disabled = true; }
    setUploadProgress(10);
    try {
      const audioForm = new FormData();
      audioForm.append('file', pendingUpload.file);
      audioForm.append('coupleId', ctx.coupleId);
      const audioRes = await api('POST', '/api/media/upload-audio', audioForm, true);
      setUploadProgress(60);
      let coverUrl = null;
      if (pendingUpload.coverFile) {
        const coverForm = new FormData();
        coverForm.append('file', pendingUpload.coverFile);
        coverForm.append('coupleId', ctx.coupleId);
        const coverRes = await api('POST', '/api/media/upload-cover', coverForm, true);
        coverUrl = coverRes.url;
      }
      setUploadProgress(85);
      const song = await api('POST', '/api/music', {
        coupleId: ctx.coupleId,
        title: (document.getElementById('smTitle').value || '').trim() || 'Untitled',
        artist: (document.getElementById('smArtist').value || '').trim() || 'Unknown Artist',
        audioUrl: audioRes.url, coverUrl,
        durationSec: pendingUpload.durationSec,
        visibility: document.getElementById('smVis').value,
        uploadedBy: ctx.role,
      });
      setUploadProgress(100);
      Store.songs.unshift(song);
      AudioService.setLibrary(Store.songs);
      renderAllLists();
      toast('✅ Song added!');
      const zone = document.getElementById('myUploadZone');
      if (zone) { zone.style.transition = 'box-shadow .3s'; zone.style.boxShadow = '0 0 0 3px rgba(52,211,153,.5)'; setTimeout(() => zone.style.boxShadow = '', 700); }
      if (btn) { btn.textContent = orig; btn.disabled = false; }
      window.closeSongModal();
      if (typeof checkAchievements === 'function') checkAchievements();
    } catch (e) {
      if (btn) { btn.textContent = orig; btn.disabled = false; }
      setUploadProgress(0);
      toast('Upload failed: ' + e.message);
    }
  };
  function setUploadProgress(pct) {
    const bar = document.getElementById('uploadProgressBar'), fill = document.getElementById('uploadProgressFill');
    if (!bar || !fill) return;
    bar.style.display = pct > 0 && pct < 100 ? 'block' : 'none';
    fill.style.width = pct + '%';
  }

  /* ═══════════════════════════════════════
     DELETE / FAVORITE / MOVE
  ═══════════════════════════════════════ */
  window.deleteSong = async function (id) {
    if (!confirm('Delete this song?')) return;
    const ctx = getCoupleCtx(); if (!ctx) return;
    try {
      await api('DELETE', '/api/music/' + id, { coupleId: ctx.coupleId });
      Store.songs = Store.songs.filter(s => s.id !== id);
      AudioService.setLibrary(Store.songs);
      renderAllLists();
      toast('Song deleted');
    } catch (e) { toast('Delete failed: ' + e.message); }
  };
  window.toggleFavoriteSong = async function (id) {
    const ctx = getCoupleCtx(); if (!ctx) return;
    const s = Store.songs.find(x => x.id === id); if (!s) return;
    s.favorite = !s.favorite; renderAllLists();
    try { await api('PATCH', '/api/music/' + id, { coupleId: ctx.coupleId, favorite: s.favorite }); }
    catch (e) { s.favorite = !s.favorite; renderAllLists(); toast('Could not update favorite'); }
  };

  /* ═══════════════════════════════════════
     RENDER PLAYLISTS
  ═══════════════════════════════════════ */
  function trackRow(s, listKey) {
    const cur = AudioService.currentSong();
    const isActive = cur && cur.id === s.id;
    return `<div class="track-item${isActive ? ' active' : ''}" onclick="playFromList('${listKey}','${s.id}')">
      <div class="track-num"></div>
      <div class="track-playing-anim"><div class="bar-anim"></div><div class="bar-anim"></div><div class="bar-anim"></div></div>
      <div class="track-art">${s.cover_url ? `<img src="${s.cover_url}" alt="">` : `<span>🎵</span>`}</div>
      <div class="track-info">
        <div class="track-title">${escH(s.title)}${s.favorite ? ' <span class="track-fav-badge">❤️</span>' : ''}</div>
        <div class="track-artist">${escH(s.artist || 'Unknown Artist')}</div>
      </div>
      <div class="track-dur">${fmtTime(s.duration_sec || 0)}</div>
      <button class="track-more" onclick="event.stopPropagation();openActionSheet('${listKey}','${s.id}')" title="More">⋯</button>
      <button class="track-del" onclick="event.stopPropagation();deleteSong('${s.id}')" title="Delete">🗑️</button>
    </div>`;
  }
  function renderAllLists() {
    renderList(myList(), 'myTrackList', 'myMusicStats', 'my');
    renderList(partnerList(), 'ptTrackList', 'ptMusicStats', 'partner');
    renderList(Store.songs.filter(s => s.favorite), 'favTrackList', 'favMusicStats', 'fav');
    renderList(Store.songs.filter(s => s.last_played).sort((a, b) => (b.last_played || 0) - (a.last_played || 0)).slice(0, 30), 'recentTrackList', 'recentMusicStats', 'recent');
    renderList(Store.songs, 'karaokeTrackList', null, 'all');
  }
  function renderList(list, elId, statsId, key) {
    const el = document.getElementById(elId); if (!el) return;
    if (statsId) {
      const totalDur = list.reduce((s, t) => s + (t.duration_sec || 0), 0);
      const st = document.getElementById(statsId);
      if (st) st.textContent = `${list.length} song${list.length !== 1 ? 's' : ''}${totalDur ? ' · ' + fmtDurLong(totalDur) : ''}`;
    }
    if (!list.length) {
      el.innerHTML = `<div class="empty-pl"><div class="empty-pl-ico">${key === 'my' ? '🎵' : key === 'partner' ? '💜' : '🎶'}</div><div class="empty-pl-text">${key === 'my' ? 'Your playlist is empty<br>Upload songs from your phone!' : 'Nothing here yet'}</div></div>`;
      return;
    }
    el.innerHTML = list.map(s => trackRow(s, key)).join('');
  }
  window.playFromList = function (listKey, songId) {
    const list = listKey === 'my' ? myList() : listKey === 'partner' ? partnerList()
      : listKey === 'fav' ? Store.songs.filter(s => s.favorite)
      : listKey === 'recent' ? Store.songs.filter(s => s.last_played) : Store.songs;
    AudioService.play(list, songId);
  };
  window.playAllList = function (listKey) {
    const list = listKey === 'my' ? myList() : partnerList();
    if (!list.length) { toast('No songs to play'); return; }
    const start = AudioService.shuffle ? list[Math.floor(Math.random() * list.length)] : list[0];
    AudioService.play(list, start.id);
  };
  // Rewire existing "Play All" buttons (blue section) to real logic + fix alignment via class toggle
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.mode-pill.play-all').forEach(btn => btn.onclick = () => window.playAllList('my'));
    document.querySelectorAll('.mode-pill.play-all-pt').forEach(btn => btn.onclick = () => window.playAllList('partner'));
  });

  /* ═══════════════════════════════════════
     LRC-SYNCED LYRICS ENGINE
  ═══════════════════════════════════════ */
  const LRC_RE = /^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/;
  function parseLRC(raw) {
    if (!raw || !raw.trim()) return { timed: false, lines: [] };
    const rawLines = raw.split('\n').map(l => l.trim()).filter(l => l.length);
    const lines = []; let anyTimed = false;
    rawLines.forEach(l => {
      const m = l.match(LRC_RE);
      if (m) {
        anyTimed = true;
        const frac = m[3] ? (m[3].length === 2 ? parseInt(m[3]) / 100 : parseInt(m[3]) / 1000) : 0;
        lines.push({ time: parseInt(m[1]) * 60 + parseInt(m[2]) + frac, text: m[4] });
      } else lines.push({ time: null, text: l });
    });
    if (anyTimed) lines.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
    return { timed: anyTimed, lines };
  }

  let lyricsState = { timed: false, lines: [], idx: -1 };
  let lyricsRafId = null;

  function loadLyricsFor(song) {
    const wrap = document.getElementById('fpLyricsWrap');
    if (!wrap) return;
    if (!song || !song.lyrics || !song.lyrics.trim()) {
      lyricsState = { timed: false, lines: [], idx: -1 };
      wrap.innerHTML = `<div class="lyr-unavailable">📜 No Lyrics Available</div>`;
      return;
    }
    const parsed = parseLRC(song.lyrics);
    lyricsState = { ...parsed, idx: -1 };
    wrap.innerHTML = `<div class="lyr-list" id="lyrList">` +
      parsed.lines.map((l, i) => `<div class="lyr-line" data-i="${i}" onclick="MusicPlayer.jumpToLyric(${i})">${escH(l.text || '♪')}</div>`).join('') +
      `</div>`;
  }
  function tickLyrics() {
    lyricsRafId = requestAnimationFrame(tickLyrics);
    const wrap = document.getElementById('fpLyricsWrap');
    if (!wrap || wrap.style.display === 'none' || !lyricsState.lines.length) return;
    const audio = AudioService.audio;
    let idx = -1;
    if (lyricsState.timed) {
      for (let i = 0; i < lyricsState.lines.length; i++) if (lyricsState.lines[i].time !== null && lyricsState.lines[i].time <= audio.currentTime) idx = i;
    } else if (audio.duration) {
      idx = Math.min(lyricsState.lines.length - 1, Math.floor((audio.currentTime / audio.duration) * lyricsState.lines.length));
    }
    if (idx === lyricsState.idx) return;
    lyricsState.idx = idx;
    document.querySelectorAll('.lyr-line').forEach(el => el.classList.remove('current', 'prev', 'next'));
    const cur = document.querySelector(`.lyr-line[data-i="${idx}"]`);
    const nxt = document.querySelector(`.lyr-line[data-i="${idx + 1}"]`);
    const prv = document.querySelector(`.lyr-line[data-i="${idx - 1}"]`);
    if (cur) { cur.classList.add('current'); cur.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    if (nxt) nxt.classList.add('next');
    if (prv) prv.classList.add('prev');
  }
  function jumpToLyric(i) {
    const audio = AudioService.audio, line = lyricsState.lines[i]; if (!line) return;
    if (lyricsState.timed && line.time !== null) audio.currentTime = line.time;
    else if (audio.duration) audio.currentTime = (i / lyricsState.lines.length) * audio.duration;
  }
  window.saveLyrics = async function () {
    const ctx = getCoupleCtx(); const song = AudioService.currentSong();
    const text = document.getElementById('lyricsText').value;
    const target = song || (window.sheetCtxSong);
    if (!ctx || !target) { document.getElementById('lyricsModal')?.classList.remove('open'); return; }
    target.lyrics = text;
    try { await api('PATCH', '/api/music/' + target.id, { coupleId: ctx.coupleId, lyrics: text }); toast('Lyrics saved 📜'); }
    catch (e) { toast('Could not save lyrics'); }
    if (AudioService.currentSong() && AudioService.currentSong().id === target.id) loadLyricsFor(target);
    document.getElementById('lyricsModal')?.classList.remove('open');
  };
  window.openLyricsModal = function (songId) {
    const s = Store.songs.find(x => x.id === songId) || AudioService.currentSong();
    window.sheetCtxSong = s;
    const ta = document.getElementById('lyricsText'); if (ta) ta.value = (s && s.lyrics) || '';
    document.getElementById('lyricsModal')?.classList.add('open');
  };
  window.closeLyricsModal = function () { document.getElementById('lyricsModal')?.classList.remove('open'); };

  function injectLyricsStyles() {
    const css = `
    .lyr-panel{position:absolute;inset:0;background:rgba(4,4,12,.72);backdrop-filter:blur(20px);z-index:5;display:flex;flex-direction:column}
    .lyr-close{align-self:flex-end;margin:10px 14px}
    #fpLyricsWrap{flex:1;overflow-y:auto;padding:20vh 26px;mask-image:linear-gradient(to bottom,transparent,#000 12%,#000 88%,transparent)}
    #fpLyricsWrap::-webkit-scrollbar{width:0}
    .lyr-list{display:flex;flex-direction:column;gap:18px;text-align:center}
    .lyr-line{font-size:16px;color:rgba(255,255,255,.35);transition:all .35s cubic-bezier(.4,0,.2,1);cursor:pointer;line-height:1.5}
    .lyr-line.prev{color:rgba(255,255,255,.22)}
    .lyr-line.next{color:rgba(255,255,255,.55);font-size:17px}
    .lyr-line.current{color:#fff;font-size:22px;font-weight:700;text-shadow:0 0 20px var(--accent-glow,rgba(91,155,255,.6)),0 0 40px var(--accent-glow,rgba(91,155,255,.3));transform:scale(1.03)}
    .lyr-unavailable{text-align:center;color:rgba(255,255,255,.4);font-size:14px;padding:60px 24px;line-height:1.8}
    `;
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  }

  /* ═══════════════════════════════════════
     MINI PLAYER + FULL PLAYER
  ═══════════════════════════════════════ */
  function injectMiniPlayer() {
    if (document.getElementById('miniPlayerBar')) return;
    const bar = document.createElement('div'); bar.id = 'miniPlayerBar';
    bar.innerHTML = `
      <div class="mini-progress"><div class="mini-progress-fill" id="miniProgressFill"></div></div>
      <div class="mini-inner">
        <div class="mini-art" id="miniArt" onclick="openFullPlayer()"><span>🎵</span></div>
        <div class="mini-info" onclick="openFullPlayer()">
          <div class="mini-title" id="miniTitle">Not playing</div>
          <div class="mini-artist" id="miniArtist">Pick a song to start</div>
        </div>
        <div class="mini-controls">
          <button class="mini-btn" onclick="event.stopPropagation();AudioService.prev()" title="Previous">⏮</button>
          <button class="mini-btn play" id="miniPlayBtn" onclick="event.stopPropagation();AudioService.togglePlay()">▶</button>
          <button class="mini-btn" onclick="event.stopPropagation();AudioService.next(true)" title="Next">⏭</button>
        </div>
      </div>`;
    document.body.appendChild(bar);
  }
  function injectFullPlayer() {
    if (document.getElementById('fullPlayerBg')) return;
    const bg = document.createElement('div'); bg.id = 'fullPlayerBg'; bg.className = 'fp-bg';
    bg.innerHTML = `
      <div class="fp-anim-bg" id="fpAnimBg"></div>
      <div class="fp-wrap">
        <div class="fp-top">
          <button class="fp-iconbtn" onclick="closeFullPlayer()">⌄</button>
          <div class="fp-toplabel">Now Playing</div>
          <button class="fp-iconbtn" onclick="toggleFpQueue()">☰</button>
        </div>
        <div class="fp-body" id="fpBody">
          <div class="fp-art-wrap"><div class="fp-art" id="fpArt"><span>🎵</span></div></div>
          <div class="fp-info"><div class="fp-title" id="fpTitle">—</div><div class="fp-artist" id="fpArtist">—</div></div>
          <div class="fp-progress">
            <div class="fp-bar" id="fpBar" onclick="fpSeek(event)"><div class="fp-bar-fill" id="fpBarFill"></div></div>
            <div class="fp-times"><span id="fpCur">0:00</span><span id="fpDur">0:00</span></div>
          </div>
          <div class="fp-controls">
            <button class="fp-ctrl" id="fpShuffleBtn" onclick="AudioService.setShuffle(!AudioService.shuffle);syncFpUI()" title="Shuffle">⇄</button>
            <button class="fp-ctrl" onclick="AudioService.prev()">⏮</button>
            <button class="fp-ctrl play" id="fpPlayBtn" onclick="AudioService.togglePlay()">▶</button>
            <button class="fp-ctrl" onclick="AudioService.next(true)">⏭</button>
            <button class="fp-ctrl" id="fpRepeatBtn" onclick="AudioService.cycleRepeat();syncFpUI()" title="Repeat">↩</button>
          </div>
          <div class="fp-row2">
            <div class="fp-vol"><span>🔉</span><input type="range" id="fpVolume" min="0" max="1" step="0.01" value="1" oninput="AudioService.setVolume(this.value)"></div>
            <button class="fp-speed-btn" id="fpSpeedBtn" onclick="cycleFpSpeed()">1x</button>
            <button class="fp-ctrl sm" onclick="toggleFpLyrics()" title="Lyrics">📜</button>
            <button class="fp-ctrl sm" onclick="shareCurrentSong()" title="Share">📤</button>
          </div>
        </div>
        <div class="lyr-panel" id="fpLyricsPanel" style="display:none">
          <button class="fp-iconbtn lyr-close" onclick="toggleFpLyrics()">✕</button>
          <div id="fpLyricsWrap"></div>
        </div>
        <div class="fp-queue" id="fpQueuePanel" style="display:none"></div>
      </div>`;
    document.body.appendChild(bg);
    bg.addEventListener('click', e => { if (e.target === bg) window.closeFullPlayer(); });
  }
  window.openFullPlayer = function () {
  if (typeof closeKaraokeMode === 'function' && karaokeState && karaokeState.open) closeKaraokeMode();
  document.getElementById('fullPlayerBg').classList.add('open');
  syncFpUI();
};
  window.closeFullPlayer = function () { document.getElementById('fullPlayerBg').classList.remove('open'); };
  window.toggleFpQueue = function () {
    const p = document.getElementById('fpQueuePanel'); const showing = p.style.display !== 'none';
    p.style.display = showing ? 'none' : 'block'; if (!showing) renderFpQueue();
  };
  function renderFpQueue() {
    const p = document.getElementById('fpQueuePanel'); const list = AudioService.getQueueSongs(); const cur = AudioService.currentSong();
    p.innerHTML = `<div class="fp-queue-title">Queue — ${list.length} songs</div>` + (list.length ? list.map(s => `
      <div class="fp-queue-row${cur && cur.id === s.id ? ' active' : ''}" onclick="playFromList('all','${s.id}')">
        <div class="track-art" style="width:34px;height:34px">${s.cover_url ? `<img src="${s.cover_url}">` : '🎵'}</div>
        <div style="flex:1;min-width:0"><div class="fp-queue-t">${escH(s.title)}</div><div class="fp-queue-a">${escH(s.artist || '')}</div></div>
      </div>`).join('') : `<div class="empty-pl"><div class="empty-pl-text">Queue is empty</div></div>`);
  }
  window.fpSeek = function (e) { const bar = document.getElementById('fpBar'); const r = bar.getBoundingClientRect(); AudioService.seekPct((e.clientX - r.left) / r.width); };
  const SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.75]; let speedIdx = 0;
  window.cycleFpSpeed = function () { speedIdx = (speedIdx + 1) % SPEEDS.length; AudioService.setPlaybackRate(SPEEDS[speedIdx]); document.getElementById('fpSpeedBtn').textContent = SPEEDS[speedIdx] + 'x'; };
  window.toggleFpLyrics = function () {
    const panel = document.getElementById('fpLyricsPanel'); const showing = panel.style.display !== 'none';
    panel.style.display = showing ? 'none' : 'block';
    if (!showing) loadLyricsFor(AudioService.currentSong());
  };
  window.shareCurrentSong = function () {
    const s = AudioService.currentSong(); if (!s) return;
    if (navigator.share) navigator.share({ title: s.title, text: `🎵 ${s.title} — ${s.artist || ''}` }).catch(() => {});
    else toast("Sharing isn't supported on this browser");
  };
  function syncFpUI() {
    const s = AudioService.currentSong();
    document.getElementById('fpTitle').textContent = s ? s.title : '—';
    document.getElementById('fpArtist').textContent = s ? (s.artist || 'Unknown Artist') : '—';
    document.getElementById('fpArt').innerHTML = s && s.cover_url ? `<img src="${s.cover_url}" alt="">` : '<span>🎵</span>';
    document.getElementById('fpShuffleBtn').classList.toggle('active', AudioService.shuffle);
    const rb = document.getElementById('fpRepeatBtn');
    rb.classList.toggle('active', AudioService.repeatMode !== 'off');
    rb.textContent = AudioService.repeatMode === 'one' ? '🔂' : '↩';
    const animBg = document.getElementById('fpAnimBg');
    if (animBg) animBg.style.backgroundImage = s && s.cover_url ? `url(${s.cover_url})` : 'none';
    loadLyricsFor(s);
  }

  AudioService.on('play', (s) => {
    document.getElementById('miniTitle').textContent = s.title;
    document.getElementById('miniArtist').textContent = s.artist || 'Unknown Artist';
    document.getElementById('miniArt').innerHTML = s.cover_url ? `<img src="${s.cover_url}" alt="">` : '<span>🎵</span>';
    document.getElementById('miniPlayerBar').classList.add('show');
    renderAllLists(); syncFpUI(); pushMediaSession(s);
  });
  AudioService.on('state', (playing) => {
    const icon = playing ? '⏸' : '▶';
    const mb = document.getElementById('miniPlayBtn'); if (mb) mb.textContent = icon;
    const fb = document.getElementById('fpPlayBtn'); if (fb) fb.textContent = icon;
    document.getElementById('miniArt')?.classList.toggle('spinning', playing);
    try { navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'; } catch (e) {}
  });
  AudioService.on('time', ({ cur, dur }) => {
    if (!dur) return;
    const pct = (cur / dur) * 100;
    const mf = document.getElementById('miniProgressFill'); if (mf) mf.style.width = pct + '%';
    const fbf = document.getElementById('fpBarFill'); if (fbf) fbf.style.width = pct + '%';
    const fc = document.getElementById('fpCur'); if (fc) fc.textContent = fmtTime(cur);
    const fd = document.getElementById('fpDur'); if (fd) fd.textContent = fmtTime(dur);
    try { navigator.mediaSession.setPositionState({ duration: dur, playbackRate: AudioService.playbackRate, position: Math.min(cur, dur) }); } catch (e) {}
  });
  AudioService.on('error', (msg) => toast(msg));

  function pushMediaSession(s) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: s.title, artist: s.artist || 'Unknown Artist', album: 'Us With Love 💕', artwork: s.cover_url ? [{ src: s.cover_url, sizes: '512x512', type: 'image/png' }] : [] });
      navigator.mediaSession.setActionHandler('play', () => AudioService.togglePlay());
      navigator.mediaSession.setActionHandler('pause', () => AudioService.togglePlay());
      navigator.mediaSession.setActionHandler('previoustrack', () => AudioService.prev());
      navigator.mediaSession.setActionHandler('nexttrack', () => AudioService.next(true));
    } catch (e) {}
  }

  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); AudioService.togglePlay(); }
    if (e.code === 'ArrowRight') AudioService.seek(AudioService.audio.currentTime + 5);
    if (e.code === 'ArrowLeft') AudioService.seek(AudioService.audio.currentTime - 5);
  });

  /* ═══════════════════════════════════════
     COMPATIBILITY SHIMS for existing karaoke /
     FX rack / achievements / action-sheet code,
     which reference musicState[pl][idx], playTrack(),
     getAllTracks(), etc. These proxy straight into Store.
  ═══════════════════════════════════════ */
  window.musicState = new Proxy({ shuffle: false, repeat: false, recordings: [], _achievements: [], _achFlags: {} }, {
    get(target, prop) {
      if (prop === 'my') return myList();
      if (prop === 'partner') return partnerList();
      if (prop === 'currentPlaylist') return 'all';
      if (prop === 'currentIdx') { const s = AudioService.currentSong(); return s ? Store.songs.findIndex(x => x.id === s.id) : -1; }
      if (prop === 'playing') return !AudioService.audio.paused;
      return target[prop];
    },
    set(target, prop, val) { target[prop] = val; return true; }
  });
  window.getAllTracks = function () { return Store.songs.map((t, i) => ({ t: mapToLegacy(t), pl: 'all', i })); };
  function mapToLegacy(s) { return { id: s.id, title: s.title, artist: s.artist, artData: s.cover_url, audioData: s.audio_url, durationSec: s.duration_sec, durationFmt: fmtTime(s.duration_sec), favorite: s.favorite, playCount: s.play_count, lyrics: s.lyrics, emoji: '🎵' }; }
  window.playTrack = function (pl, idx) {
    const list = pl === 'my' ? myList() : pl === 'partner' ? partnerList() : Store.songs;
    const s = list[idx]; if (s) AudioService.play(list, s.id);
  };
  window.saveMusicLocal = function () {};
  window.loadMusicLocal = function () {};
  window.renderMusicTracks = renderAllLists;

  /* ═══════════════════════════════════════
     ACTION SHEET (repointed to real song ids)
  ═══════════════════════════════════════ */
  let sheetCtx = null;
  window.openActionSheet = function (listKey, songId) {
    const s = Store.songs.find(x => x.id === songId); if (!s) return;
    sheetCtx = { listKey, songId };
    const sheet = document.getElementById('actionSheet');
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <div class="sheet-track-head">
        <div class="sheet-track-art">${s.cover_url ? `<img src="${s.cover_url}" alt="">` : `<span>🎵</span>`}</div>
        <div style="min-width:0"><div class="sheet-title">${escH(s.title)}</div><div class="sheet-artist">${escH(s.artist || 'Unknown Artist')}</div></div>
      </div>
      <div class="sheet-actions">
        ${saAction('▶', 'Play', `playFromList('${listKey}','${s.id}');closeActionSheet()`)}
        ${saAction('🎤', 'Sing With Lyrics', `closeActionSheet();window.karaokeOpenById && karaokeOpenById('${s.id}')`)}
        ${saAction('💞', 'Sing Together', `closeActionSheet();CoupleKaraoke.sendInviteById('${s.id}')`)}
        ${saAction(s.favorite ? '💔' : '❤️', s.favorite ? 'Unfavorite' : 'Favorite', `toggleFavoriteSong('${s.id}');closeActionSheet()`)}
        ${saAction('📜', 'Lyrics', `closeActionSheet();openLyricsModal('${s.id}')`)}
        ${saAction('📤', 'Share', `shareTrack('${s.id}');closeActionSheet()`)}
        ${saAction('🗑', 'Delete', `closeActionSheet();deleteSong('${s.id}')`, true)}
      </div>`;
    document.getElementById('actionSheetOverlay').classList.add('open');
  };
  function saAction(ico, label, fn, danger) { return `<button class="sheet-action${danger ? ' danger' : ''}" onclick="${fn}"><span class="sa-ico">${ico}</span><span class="sa-label">${label}</span></button>`; }
  window.closeActionSheet = function () { document.getElementById('actionSheetOverlay').classList.remove('open'); sheetCtx = null; };
  window.shareTrack = function (id) {
    const s = Store.songs.find(x => x.id === id); if (!s) return;
    if (navigator.share) navigator.share({ title: s.title, text: `🎵 ${s.title} — ${s.artist || ''}` }).catch(() => {});
    else toast("Sharing isn't supported on this browser");
  };
  Store.songs = Store.songs; // keep global ref shim
  window.Store = Store;

  /* ═══════════════════════════════════════
     INIT
  ═══════════════════════════════════════ */
  function injectCoreStyles() {
    const css = `
    #miniPlayerBar{position:fixed;left:0;right:0;bottom:0;z-index:500;background:rgba(6,6,16,0.96);backdrop-filter:blur(24px) saturate(180%);border-top:1px solid rgba(255,255,255,0.1);transform:translateY(100%);transition:transform .3s cubic-bezier(.4,0,.2,1);padding-bottom:env(safe-area-inset-bottom)}
    #miniPlayerBar.show{transform:translateY(0)}
    .mini-progress{height:2px;background:rgba(255,255,255,.08)}
    .mini-progress-fill{height:100%;width:0%;background:linear-gradient(90deg,var(--accent,#5b9bff),var(--accent2,#e455e0));transition:width .1s linear}
    .mini-inner{display:flex;align-items:center;gap:11px;padding:9px 14px;cursor:pointer}
    .mini-art{width:44px;height:44px;border-radius:9px;flex-shrink:0;background:linear-gradient(135deg,var(--accent,#5b9bff),var(--accent2,#e455e0));display:flex;align-items:center;justify-content:center;font-size:18px;overflow:hidden;position:relative}
    .mini-art img{width:100%;height:100%;object-fit:cover}
    .mini-art.spinning{animation:miniSpin 8s linear infinite}
    @keyframes miniSpin{from{filter:hue-rotate(0)}to{filter:hue-rotate(360deg)}}
    .mini-info{flex:1;min-width:0}
    .mini-title{font-size:13px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .mini-artist{font-size:11px;color:rgba(255,255,255,.5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .mini-controls{display:flex;align-items:center;gap:4px;flex-shrink:0}
    .mini-btn{background:none;border:none;color:rgba(255,255,255,.7);font-size:16px;padding:6px;border-radius:8px;cursor:pointer}
    .mini-btn:hover{color:#fff;background:rgba(255,255,255,.08)}
    .mini-btn.play{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--accent,#5b9bff),var(--accent-d,#2f6feb));color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px}
    .fp-bg{position:fixed;inset:0;z-index:1000;background:rgba(2,2,8,0.97);display:none;overflow:hidden}
    .fp-bg.open{display:block}
    .fp-anim-bg{position:absolute;inset:-10%;background-size:cover;background-position:center;filter:blur(60px) saturate(160%) brightness(.6);opacity:.55;transform:scale(1.15);transition:background-image .4s}
    .fp-wrap{position:relative;height:100%;display:flex;flex-direction:column;max-width:480px;margin:0 auto;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)}
    .fp-top{display:flex;justify-content:space-between;align-items:center;padding:14px 16px}
    .fp-iconbtn{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);color:#fff;width:36px;height:36px;border-radius:50%;font-size:15px;cursor:pointer}
    .fp-toplabel{font-size:11px;font-weight:700;color:rgba(255,255,255,.6);letter-spacing:.5px;text-transform:uppercase}
    .fp-body{flex:1;overflow-y:auto;padding:0 24px 20px;display:flex;flex-direction:column}
    .fp-art-wrap{display:flex;justify-content:center;padding:10px 0}
    .fp-art{width:min(70vw,240px);height:min(70vw,240px);border-radius:24px;background:linear-gradient(135deg,var(--accent,#5b9bff),var(--accent2,#e455e0));display:flex;align-items:center;justify-content:center;font-size:60px;box-shadow:0 24px 70px rgba(0,0,0,.5);overflow:hidden}
    .fp-art img{width:100%;height:100%;object-fit:cover}
    .fp-info{text-align:center;padding:16px 0 0}
    .fp-title{font-family:var(--ff-serif,serif);font-size:23px;color:#fff}
    .fp-artist{font-size:13px;color:rgba(255,255,255,.55);margin-top:4px}
    .fp-progress{padding:20px 0 0}
    .fp-bar{height:4px;border-radius:3px;background:rgba(255,255,255,.15);cursor:pointer;position:relative}
    .fp-bar-fill{height:100%;border-radius:3px;background:linear-gradient(90deg,var(--accent,#5b9bff),var(--accent2,#e455e0));width:0%}
    .fp-times{display:flex;justify-content:space-between;font-size:10px;color:rgba(255,255,255,.45);margin-top:5px}
    .fp-controls{display:flex;align-items:center;justify-content:center;gap:18px;padding:18px 0}
    .fp-ctrl{width:46px;height:46px;border-radius:50%;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);color:#fff;font-size:17px;cursor:pointer}
    .fp-ctrl.play{width:64px;height:64px;font-size:24px;background:linear-gradient(135deg,var(--accent,#5b9bff),var(--accent-d,#2f6feb));border:none;box-shadow:0 10px 30px rgba(91,155,255,.4)}
    .fp-ctrl.active{color:var(--accent,#5b9bff);border-color:var(--accent,#5b9bff)}
    .fp-ctrl.sm{width:38px;height:38px;font-size:14px}
    .fp-row2{display:flex;align-items:center;gap:10px;justify-content:center;padding:0 0 8px}
    .fp-vol{display:flex;align-items:center;gap:6px;flex:1;max-width:120px}
    .fp-vol input{flex:1;accent-color:var(--accent,#5b9bff)}
    .fp-speed-btn{padding:6px 12px;border-radius:16px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);color:#fff;font-size:11px;font-weight:700;cursor:pointer}
    .fp-queue{position:absolute;inset:0;background:rgba(6,6,16,.97);backdrop-filter:blur(20px);padding:60px 18px 20px;overflow-y:auto}
    .fp-queue-title{font-size:12px;font-weight:700;color:rgba(255,255,255,.6);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px}
    .fp-queue-row{display:flex;align-items:center;gap:10px;padding:8px;border-radius:10px;cursor:pointer}
    .fp-queue-row:hover,.fp-queue-row.active{background:rgba(255,255,255,.06)}
    .fp-queue-t{font-size:12px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .fp-queue-a{font-size:10px;color:rgba(255,255,255,.45)}
    .mode-pill.play-all,.mode-pill.play-all-pt{display:inline-flex;align-items:center;justify-content:center;white-space:nowrap}
    @media(min-width:700px){#miniPlayerBar{left:16px;right:16px;bottom:12px;border-radius:16px;border:1px solid rgba(255,255,255,.12)}}
    `;
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  }

  function init() {
    injectCoreStyles();
    injectLyricsStyles();
    injectMiniPlayer();
    injectFullPlayer();
    initUploadZones();
    const oldBar = document.getElementById('nowPlayingBar'); if (oldBar) oldBar.style.display = 'none';
    loadSongs();
    tickLyrics();
  }
  function whenReady(fn) { if (document.getElementById('audioPlayer')) fn(); else setTimeout(() => whenReady(fn), 150); }
  whenReady(init);
window.karaokeOpenById = function (songId) {
  const s = Store.songs.find(x => x.id === songId); if (!s) return;
  const pl = isMine(s) ? 'my' : 'partner';
  const list = pl === 'my' ? myList() : partnerList();
  const idx = list.findIndex(x => x.id === songId);
  if (idx > -1 && typeof openKaraokeMode === 'function') openKaraokeMode(pl, idx);
};
  window.MusicPlayer = { loadSongs, toast, escH, fmtTime, getCoupleCtx, api, jumpToLyric, Store };
})();