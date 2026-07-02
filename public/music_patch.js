/* ═══════════════════════════════════════════════════════════════
   MUSIC PATCH — Premium Music Player Upgrades
   Load AFTER music.html's main inline <script> block:
     <script src="/music_patch.js"></script>
   Adds, without removing any existing feature:
     • Media Session API (lock screen / notification controls)
     • Playback speed control
     • Sleep timer
     • Crossfade between tracks
     • Real LRC-style synced lyrics + manual scroll + fullscreen lyrics
       + proper "Lyrics unavailable" state
     • Resume from last position per track
     • "Most Played" tab
     • Song search across all playlists
     • Fullscreen Now-Playing player with visualizer
     • Best-effort ID3 tag / album-art auto-extraction on upload
   Everything here reads/patches the existing globals declared in
   music.html's inline script (musicState, audio, fxState, etc.)
   which are visible here because classic <script> tags share one
   global scope on the page.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function whenReady(fn) {
    if (typeof musicState !== 'undefined' && document.getElementById('audioPlayer')) fn();
    else setTimeout(() => whenReady(fn), 150);
  }

  whenReady(init);

  function init() {
    injectStyles();
    injectUI();
    setupSpeedControl();
    setupSleepTimer();
    setupCrossfade();
    setupResumePosition();
    setupMostPlayedTab();
    setupSongSearch();
    setupFullscreenPlayer();
    setupLyricsEngine();
    setupMediaSession();
    setupId3Extraction();
    console.log('🎵 music_patch.js loaded — premium features active');
  }

  /* ═══════════════════════════════════════
     STYLES
  ═══════════════════════════════════════ */
  function injectStyles() {
    const css = `
    .mp-btn{background:rgba(255,255,255,0.08);border:1px solid var(--border2,rgba(255,255,255,0.18));color:#fff;font-size:11px;font-weight:700;padding:6px 10px;border-radius:16px;cursor:pointer;transition:all .2s;white-space:nowrap}
    .mp-btn:hover{background:rgba(255,255,255,0.16)}
    .mp-btn.active{background:var(--accent,#5b9bff);border-color:var(--accent,#5b9bff)}
    .mp-search-wrap{padding:10px 16px 0}
    .mp-search-input{width:100%;background:var(--g1,rgba(255,255,255,.04));border:1px solid var(--border,rgba(255,255,255,.1));border-radius:12px;padding:9px 13px;color:#fff;font-family:var(--ff-sans,Inter,sans-serif);font-size:13px;outline:none}
    .mp-search-input:focus{border-color:var(--accent,#5b9bff)}
    .mp-search-results{padding:6px 16px 14px}
    .mp-sleep-modal-bg,.mp-fullscreen-bg{position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,.7);backdrop-filter:blur(10px);display:none;align-items:center;justify-content:center;padding:16px}
    .mp-sleep-modal-bg.open,.mp-fullscreen-bg.open{display:flex}
    .mp-sleep-modal{background:rgba(10,10,24,.96);border:1px solid var(--border2,rgba(255,255,255,.18));border-radius:20px;padding:20px;width:100%;max-width:340px;color:#fff}
    .mp-sleep-title{font-family:var(--ff-serif,serif);font-size:17px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center}
    .mp-sleep-opts{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:10px}
    .mp-sleep-opt{padding:10px;text-align:center;border-radius:12px;border:1px solid var(--border,rgba(255,255,255,.1));background:var(--g1,rgba(255,255,255,.04));cursor:pointer;font-size:12px;font-weight:600;transition:all .2s}
    .mp-sleep-opt:hover{background:var(--g2,rgba(255,255,255,.08))}
    .mp-sleep-opt.active{background:var(--accent,#5b9bff);border-color:var(--accent,#5b9bff)}
    .mp-sleep-status{font-size:11px;color:rgba(255,255,255,.5);text-align:center;margin-top:6px}
    .mp-sleep-badge{position:fixed;bottom:130px;right:16px;z-index:150;background:rgba(0,0,0,.75);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.2);color:#fff;padding:6px 12px;border-radius:20px;font-size:11px;font-weight:700;display:none;align-items:center;gap:6px}
    .mp-sleep-badge.show{display:flex}

    /* Fullscreen player */
    .mp-fullscreen-wrap{width:100%;max-width:480px;height:100%;max-height:800px;display:flex;flex-direction:column;background:radial-gradient(ellipse at 50% 0%,rgba(91,0,160,.28),rgba(2,2,10,.98) 70%);border-radius:24px;overflow:hidden;position:relative}
    .mp-fs-top{display:flex;justify-content:space-between;align-items:center;padding:16px}
    .mp-fs-iconbtn{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);color:#fff;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;cursor:pointer}
    .mp-fs-art-wrap{display:flex;justify-content:center;padding:10px 0}
    .mp-fs-art{width:190px;height:190px;border-radius:22px;background:linear-gradient(135deg,var(--accent,#5b9bff),var(--accent2,#e455e0));display:flex;align-items:center;justify-content:center;font-size:56px;box-shadow:0 20px 60px rgba(0,0,0,.5);overflow:hidden}
    .mp-fs-art img{width:100%;height:100%;object-fit:cover}
    .mp-fs-info{text-align:center;padding:10px 24px 0}
    .mp-fs-title{font-family:var(--ff-serif,serif);font-size:21px;color:#fff}
    .mp-fs-artist{font-size:12px;color:rgba(255,255,255,.5);margin-top:3px}
    .mp-fs-canvas{width:100%;height:44px;display:block;margin-top:6px}
    .mp-fs-lyrics-wrap{flex:1;overflow-y:auto;padding:14px 26px;mask-image:linear-gradient(to bottom,transparent,#000 10%,#000 90%,transparent)}
    .mp-fs-lyrics-wrap::-webkit-scrollbar{width:0}
    .mp-fs-lyrics{display:flex;flex-direction:column;gap:14px;text-align:center;padding:24vh 0}
    .mp-lyric-line{font-size:15px;color:rgba(255,255,255,.4);transition:all .25s;cursor:pointer}
    .mp-lyric-line.mp-current{color:#fff;font-size:19px;font-weight:700;text-shadow:0 0 16px var(--accent-glow,rgba(91,155,255,.5))}
    .mp-lyric-unavailable{text-align:center;color:rgba(255,255,255,.4);font-size:13px;padding:40px 20px;line-height:1.8}
    .mp-fs-progress{padding:6px 24px}
    .mp-fs-bar{height:4px;border-radius:3px;background:rgba(255,255,255,.12);cursor:pointer;position:relative}
    .mp-fs-bar-fill{height:100%;border-radius:3px;background:linear-gradient(90deg,var(--accent,#5b9bff),var(--accent2,#e455e0));width:0%}
    .mp-fs-times{display:flex;justify-content:space-between;font-size:10px;color:rgba(255,255,255,.4);margin-top:4px}
    .mp-fs-controls{display:flex;align-items:center;justify-content:center;gap:22px;padding:14px 20px 22px}
    .mp-fs-ctrl{width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);color:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center}
    .mp-fs-ctrl.play{width:60px;height:60px;font-size:22px;background:linear-gradient(135deg,var(--accent,#5b9bff),var(--accent-d,#2f6feb));box-shadow:0 8px 24px var(--accent-glow,rgba(91,155,255,.4));border:none}
    .mp-fs-tabbar{display:flex;gap:6px;justify-content:center;padding:0 20px 14px}
    .mp-fs-tab{padding:5px 14px;border-radius:16px;font-size:11px;font-weight:700;cursor:pointer;background:rgba(255,255,255,.06);color:rgba(255,255,255,.5)}
    .mp-fs-tab.active{background:#fff;color:#111}

    /* Resume/played badges */
    .mp-resume-badge{font-size:9px;color:var(--accent,#5b9bff);font-weight:700}
    `;
    const style = document.createElement('style');
    style.id = 'mp-patch-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ═══════════════════════════════════════
     UI INJECTION — now-playing bar buttons
  ═══════════════════════════════════════ */
  function injectUI() {
    const controls = document.querySelector('.np-controls');
    if (controls) {
      const speedBtn = document.createElement('button');
      speedBtn.className = 'nc-btn mp-btn';
      speedBtn.id = 'mpSpeedBtn';
      speedBtn.title = 'Playback speed';
      speedBtn.textContent = '1x';
      speedBtn.onclick = () => window.MusicPatch.cycleSpeed();
      controls.appendChild(speedBtn);

      const sleepBtn = document.createElement('button');
      sleepBtn.className = 'nc-btn';
      sleepBtn.id = 'mpSleepBtn';
      sleepBtn.title = 'Sleep timer';
      sleepBtn.textContent = '🌙';
      sleepBtn.onclick = () => window.MusicPatch.openSleepModal();
      controls.appendChild(sleepBtn);

      const fsBtn = document.createElement('button');
      fsBtn.className = 'nc-btn';
      fsBtn.title = 'Fullscreen player';
      fsBtn.textContent = '⤢';
      fsBtn.onclick = () => window.MusicPatch.openFullscreen();
      controls.appendChild(fsBtn);
    }

    // Make the now-playing art clickable to open fullscreen too
    const npArt = document.getElementById('npArt');
    if (npArt) { npArt.style.cursor = 'pointer'; npArt.onclick = () => window.MusicPatch.openFullscreen(); }

    // Sleep timer modal
    const sleepModal = document.createElement('div');
    sleepModal.className = 'mp-sleep-modal-bg';
    sleepModal.id = 'mpSleepModalBg';
    sleepModal.innerHTML = `
      <div class="mp-sleep-modal">
        <div class="mp-sleep-title">🌙 Sleep Timer <button class="mp-fs-iconbtn" style="width:28px;height:28px;font-size:13px" onclick="MusicPatch.closeSleepModal()">✕</button></div>
        <div class="mp-sleep-opts">
          <div class="mp-sleep-opt" data-m="15" onclick="MusicPatch.setSleepTimer(15)">15 min</div>
          <div class="mp-sleep-opt" data-m="30" onclick="MusicPatch.setSleepTimer(30)">30 min</div>
          <div class="mp-sleep-opt" data-m="45" onclick="MusicPatch.setSleepTimer(45)">45 min</div>
          <div class="mp-sleep-opt" data-m="60" onclick="MusicPatch.setSleepTimer(60)">60 min</div>
          <div class="mp-sleep-opt" data-m="track" onclick="MusicPatch.setSleepTimer('track')" style="grid-column:1/-1">End of current track</div>
        </div>
        <div class="mp-sleep-status" id="mpSleepStatus">No sleep timer set</div>
        <button class="mp-btn" style="width:100%;margin-top:10px" onclick="MusicPatch.clearSleepTimer()">Cancel Timer</button>
      </div>`;
    document.body.appendChild(sleepModal);
    sleepModal.addEventListener('click', e => { if (e.target === sleepModal) window.MusicPatch.closeSleepModal(); });

    const sleepBadge = document.createElement('div');
    sleepBadge.className = 'mp-sleep-badge';
    sleepBadge.id = 'mpSleepBadge';
    sleepBadge.innerHTML = `🌙 <span id="mpSleepCountdown">--:--</span>`;
    document.body.appendChild(sleepBadge);

    // Fullscreen player overlay
    const fsBg = document.createElement('div');
    fsBg.className = 'mp-fullscreen-bg';
    fsBg.id = 'mpFullscreenBg';
    fsBg.innerHTML = `
      <div class="mp-fullscreen-wrap">
        <div class="mp-fs-top">
          <button class="mp-fs-iconbtn" onclick="MusicPatch.closeFullscreen()">⌄</button>
          <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,.6);letter-spacing:.5px;text-transform:uppercase">Now Playing</div>
          <button class="mp-fs-iconbtn" onclick="MusicPatch.cycleSpeed()" id="mpFsSpeedBtn">1x</button>
        </div>
        <div class="mp-fs-tabbar">
          <div class="mp-fs-tab active" data-t="player" onclick="MusicPatch.fsTab('player',this)">Player</div>
          <div class="mp-fs-tab" data-t="lyrics" onclick="MusicPatch.fsTab('lyrics',this)">Lyrics</div>
        </div>
        <div id="mpFsPlayerView">
          <div class="mp-fs-art-wrap"><div class="mp-fs-art" id="mpFsArt"><span>🎵</span></div></div>
          <div class="mp-fs-info">
            <div class="mp-fs-title" id="mpFsTitle">No song playing</div>
            <div class="mp-fs-artist" id="mpFsArtist">—</div>
          </div>
          <canvas class="mp-fs-canvas" id="mpFsCanvas"></canvas>
        </div>
        <div id="mpFsLyricsView" style="display:none;flex:1;overflow:hidden">
          <div class="mp-fs-lyrics-wrap" id="mpFsLyricsWrap"><div class="mp-fs-lyrics" id="mpFsLyrics"></div></div>
        </div>
        <div class="mp-fs-progress">
          <div class="mp-fs-bar" id="mpFsBar" onclick="MusicPatch.fsSeek(event)"><div class="mp-fs-bar-fill" id="mpFsBarFill"></div></div>
          <div class="mp-fs-times"><span id="mpFsCur">0:00</span><span id="mpFsDur">0:00</span></div>
        </div>
        <div class="mp-fs-controls">
          <button class="mp-fs-ctrl" onclick="prevSong()">⏮</button>
          <button class="mp-fs-ctrl play" id="mpFsPlayBtn" onclick="togglePlay()">▶</button>
          <button class="mp-fs-ctrl" onclick="nextSong()">⏭</button>
        </div>
      </div>`;
    document.body.appendChild(fsBg);
    fsBg.addEventListener('click', e => { if (e.target === fsBg) window.MusicPatch.closeFullscreen(); });
  }

  /* ═══════════════════════════════════════
     PLAYBACK SPEED
  ═══════════════════════════════════════ */
  const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
  let speedIdx = 1;

  function setupSpeedControl() {
    // Enforce our combined rate continuously so it survives other code
    // (e.g. karaoke pitch shifting) touching audio.playbackRate.
    setInterval(() => {
      const audioEl = document.getElementById('audioPlayer');
      if (!audioEl) return;
      const pitchFactor = (typeof fxState !== 'undefined' && fxState.pitch) ? Math.pow(2, fxState.pitchAmt / 12) : 1;
      const desired = SPEEDS[speedIdx] * pitchFactor;
      if (Math.abs(audioEl.playbackRate - desired) > 0.01) audioEl.playbackRate = desired;
    }, 400);
  }

  function cycleSpeed() {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    const label = SPEEDS[speedIdx] + 'x';
    const b1 = document.getElementById('mpSpeedBtn'); if (b1) { b1.textContent = label; b1.classList.toggle('active', SPEEDS[speedIdx] !== 1); }
    const b2 = document.getElementById('mpFsSpeedBtn'); if (b2) b2.textContent = label;
    if (typeof showMMToast === 'function') showMMToast('Speed: ' + label);
  }

  /* ═══════════════════════════════════════
     SLEEP TIMER
  ═══════════════════════════════════════ */
  let sleepTimeoutId = null, sleepIntervalId = null, sleepEndsAt = null, sleepAtTrackEnd = false;

  function setupSleepTimer() {}

  function openSleepModal() { document.getElementById('mpSleepModalBg').classList.add('open'); }
  function closeSleepModal() { document.getElementById('mpSleepModalBg').classList.remove('open'); }

  function setSleepTimer(mins) {
    clearSleepTimerInternal();
    document.querySelectorAll('.mp-sleep-opt').forEach(o => o.classList.toggle('active', String(o.dataset.m) === String(mins)));
    if (mins === 'track') {
      sleepAtTrackEnd = true;
      document.getElementById('mpSleepStatus').textContent = 'Will pause at the end of this track';
      showSleepBadge('End of track');
    } else {
      sleepEndsAt = Date.now() + mins * 60000;
      sleepTimeoutId = setTimeout(doSleepFade, mins * 60000);
      sleepIntervalId = setInterval(updateSleepCountdown, 1000);
      updateSleepCountdown();
    }
    if (typeof showMMToast === 'function') showMMToast('🌙 Sleep timer set');
    closeSleepModal();
  }

  function updateSleepCountdown() {
    if (!sleepEndsAt) return;
    const remain = Math.max(0, sleepEndsAt - Date.now());
    const m = Math.floor(remain / 60000), s = Math.floor((remain % 60000) / 1000);
    const label = m + ':' + String(s).padStart(2, '0');
    const st = document.getElementById('mpSleepStatus'); if (st) st.textContent = 'Playback pauses in ' + label;
    showSleepBadge(label);
    if (remain <= 0) clearInterval(sleepIntervalId);
  }

  function showSleepBadge(label) {
    const b = document.getElementById('mpSleepBadge');
    if (!b) return;
    b.classList.add('show');
    document.getElementById('mpSleepCountdown').textContent = label;
  }
  function hideSleepBadge() { document.getElementById('mpSleepBadge')?.classList.remove('show'); }

  function doSleepFade() {
    const audioEl = document.getElementById('audioPlayer');
    if (!audioEl) return;
    const startVol = audioEl.volume;
    let v = startVol;
    const fade = setInterval(() => {
      v -= 0.05;
      if (v <= 0) { clearInterval(fade); audioEl.pause(); audioEl.volume = startVol; hideSleepBadge(); if (typeof showMMToast === 'function') showMMToast('🌙 Sleep timer ended playback'); }
      else audioEl.volume = v;
    }, 200);
    clearSleepTimerInternal(true);
  }

  function clearSleepTimerInternal(skipHide) {
    clearTimeout(sleepTimeoutId); clearInterval(sleepIntervalId);
    sleepTimeoutId = null; sleepIntervalId = null; sleepEndsAt = null; sleepAtTrackEnd = false;
    if (!skipHide) hideSleepBadge();
    document.querySelectorAll('.mp-sleep-opt').forEach(o => o.classList.remove('active'));
  }
  function clearSleepTimer() {
    clearSleepTimerInternal();
    document.getElementById('mpSleepStatus').textContent = 'No sleep timer set';
    if (typeof showMMToast === 'function') showMMToast('Sleep timer cancelled');
  }

  // Hook: pause at end of current track if sleepAtTrackEnd requested
  document.addEventListener('DOMContentLoaded', () => {
    const audioEl = document.getElementById('audioPlayer');
    if (audioEl) audioEl.addEventListener('ended', () => {
      if (sleepAtTrackEnd) { sleepAtTrackEnd = false; hideSleepBadge(); setTimeout(() => audioEl.pause(), 50); }
    });
  });

  /* ═══════════════════════════════════════
     CROSSFADE
  ═══════════════════════════════════════ */
  const CROSSFADE_SEC = 3;
  let crossfading = false;

  function setupCrossfade() {
    setInterval(() => {
      const audioEl = document.getElementById('audioPlayer');
      if (!audioEl || typeof musicState === 'undefined') return;
      if (!musicState.playing || musicState.repeat || crossfading) return;
      if (!audioEl.duration || isNaN(audioEl.duration)) return;
      const remaining = audioEl.duration - audioEl.currentTime;
      if (remaining > 0 && remaining <= CROSSFADE_SEC) {
        crossfading = true;
        fadeOutThenNext(audioEl);
      }
    }, 400);
  }

  function fadeOutThenNext(audioEl) {
    const startVol = audioEl.volume;
    const steps = 15;
    let i = 0;
    const iv = setInterval(() => {
      i++;
      audioEl.volume = Math.max(0, startVol * (1 - i / steps));
      if (i >= steps) {
        clearInterval(iv);
        if (typeof nextSong === 'function') nextSong();
        // fade back in on the new track
        let j = 0;
        audioEl.volume = 0;
        const iv2 = setInterval(() => {
          j++;
          audioEl.volume = Math.min(startVol, startVol * (j / steps));
          if (j >= steps) { clearInterval(iv2); audioEl.volume = startVol; crossfading = false; }
        }, 60);
      }
    }, 60);
  }

  /* ═══════════════════════════════════════
     RESUME FROM LAST POSITION
  ═══════════════════════════════════════ */
  function setupResumePosition() {
    const audioEl = document.getElementById('audioPlayer');
    if (!audioEl) return;
    let lastSaveTs = 0;
    audioEl.addEventListener('timeupdate', () => {
      const now = Date.now();
      if (now - lastSaveTs < 4000) return;
      lastSaveTs = now;
      const t = currentTrackObj();
      if (!t || !audioEl.duration) return;
      if (audioEl.duration - audioEl.currentTime < 5) return; // don't save near-end positions
      try {
        const map = JSON.parse(localStorage.getItem('us_music_positions') || '{}');
        map[t.id] = audioEl.currentTime;
        localStorage.setItem('us_music_positions', JSON.stringify(map));
      } catch (e) {}
    });
    audioEl.addEventListener('ended', () => {
      const t = currentTrackObj();
      if (!t) return;
      try {
        const map = JSON.parse(localStorage.getItem('us_music_positions') || '{}');
        delete map[t.id];
        localStorage.setItem('us_music_positions', JSON.stringify(map));
      } catch (e) {}
    });

    // Patch playTrack to resume once metadata is loaded
    const _origPlayTrack = window.playTrack;
    if (typeof _origPlayTrack === 'function') {
      window.playTrack = function (pl, idx) {
        _origPlayTrack(pl, idx);
        const t = musicState[pl] && musicState[pl][idx];
        if (!t) return;
        try {
          const map = JSON.parse(localStorage.getItem('us_music_positions') || '{}');
          const pos = map[t.id];
          if (pos && pos > 3) {
            const onLoaded = () => { audioEl.currentTime = pos; audioEl.removeEventListener('loadedmetadata', onLoaded); };
            audioEl.addEventListener('loadedmetadata', onLoaded);
          }
        } catch (e) {}
      };
    }
  }

  function currentTrackObj() {
    if (typeof musicState === 'undefined') return null;
    const pl = musicState.currentPlaylist, idx = musicState.currentIdx;
    return (pl != null && musicState[pl] && musicState[pl][idx]) || null;
  }

  /* ═══════════════════════════════════════
     MOST PLAYED TAB
  ═══════════════════════════════════════ */
  function setupMostPlayedTab() {
    const tabsRow = document.querySelector('.pl-tabs');
    if (!tabsRow) return;
    const tab = document.createElement('div');
    tab.className = 'pl-tab';
    tab.textContent = '🏆 Most Played';
    tab.onclick = () => switchPlTabPatched('mostplayed', tab);
    tabsRow.appendChild(tab);

    const section = document.createElement('div');
    section.id = 'pl-mostplayed';
    section.style.display = 'none';
    section.innerHTML = `
      <div class="sec-header"><div><div class="sec-title">🏆 Most Played</div><div class="sec-sub" id="mostPlayedStats">0 songs</div></div></div>
      <div class="track-list" id="mostPlayedList"></div>`;
    document.getElementById('pl-my')?.parentElement?.appendChild(section);
  }

  function switchPlTabPatched(tab, el) {
    // Reuse the app's own tab switching for the built-in tabs, then show ours
    document.querySelectorAll('.pl-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    ['my', 'partner', 'karaoke', 'videos', 'favorites', 'recent', 'mostplayed'].forEach(id => {
      const sec = document.getElementById('pl-' + id);
      if (sec) sec.style.display = (tab === id) ? 'block' : 'none';
    });
    if (tab === 'mostplayed') renderMostPlayed();
  }

  function renderMostPlayed() {
    if (typeof getAllTracks !== 'function') return;
    const all = getAllTracks().filter(x => (x.t.playCount || 0) > 0)
      .sort((a, b) => (b.t.playCount || 0) - (a.t.playCount || 0)).slice(0, 50);
    const statsEl = document.getElementById('mostPlayedStats');
    if (statsEl) statsEl.textContent = all.length + ' song' + (all.length !== 1 ? 's' : '');
    const el = document.getElementById('mostPlayedList');
    if (!el) return;
    if (!all.length) {
      el.innerHTML = `<div class="empty-pl"><div class="empty-pl-ico">🏆</div><div class="empty-pl-text">Play some songs to see your most played tracks here</div></div>`;
      return;
    }
    el.innerHTML = all.map((x, i) => `
      <div class="track-item${musicState.currentPlaylist===x.pl&&musicState.currentIdx===x.i?' active':''}" onclick="playTrack('${x.pl}',${x.i})">
        <div class="track-num">${i + 1}</div>
        <div class="track-playing-anim"><div class="bar-anim"></div><div class="bar-anim"></div><div class="bar-anim"></div></div>
        <div class="track-art">${x.t.artData ? `<img src="${x.t.artData}" alt="">` : `<span>${x.t.emoji || '🎵'}</span>`}</div>
        <div class="track-info">
          <div class="track-title">${escH(x.t.title)}</div>
          <div class="track-artist">${escH(x.t.artist || 'Unknown Artist')} · ▶ ${x.t.playCount || 0} plays</div>
        </div>
        <div class="track-dur">${x.t.durationFmt || ''}</div>
      </div>`).join('');
  }

  /* ═══════════════════════════════════════
     SONG SEARCH (across playlists)
  ═══════════════════════════════════════ */
  function setupSongSearch() {
    const musicSection = document.getElementById('section-music');
    if (!musicSection) return;
    const wrap = document.createElement('div');
    wrap.className = 'mp-search-wrap';
    wrap.innerHTML = `<input type="text" class="mp-search-input" id="mpSongSearch" placeholder="🔎 Search all songs by title or artist...">`;
    musicSection.insertBefore(wrap, musicSection.firstChild.nextSibling);

    const results = document.createElement('div');
    results.className = 'mp-search-results';
    results.id = 'mpSearchResults';
    results.style.display = 'none';
    wrap.after(results);

    document.getElementById('mpSongSearch').addEventListener('input', function () {
      const q = this.value.trim().toLowerCase();
      if (!q) { results.style.display = 'none'; return; }
      results.style.display = 'block';
      const all = getAllTracks().filter(x => (x.t.title || '').toLowerCase().includes(q) || (x.t.artist || '').toLowerCase().includes(q));
      results.innerHTML = all.length ? `<div class="track-list" style="padding:0">${all.map((x, i) => `
        <div class="track-item" onclick="playTrack('${x.pl}',${x.i})">
          <div class="track-art">${x.t.artData ? `<img src="${x.t.artData}" alt="">` : `<span>${x.t.emoji || '🎵'}</span>`}</div>
          <div class="track-info"><div class="track-title">${escH(x.t.title)}</div><div class="track-artist">${escH(x.t.artist || 'Unknown Artist')} · ${x.pl === 'my' ? 'My Playlist' : "Partner's"}</div></div>
          <div class="track-dur">${x.t.durationFmt || ''}</div>
        </div>`).join('')}</div>` : `<div class="empty-pl" style="padding:20px"><div class="empty-pl-ico">🔎</div><div class="empty-pl-text">No songs found</div></div>`;
    });
  }

  /* ═══════════════════════════════════════
     LYRICS ENGINE — LRC-style timed sync,
     manual scroll fallback, "unavailable" state
  ═══════════════════════════════════════ */
  function parseLyricsTimed(raw) {
    if (!raw || !raw.trim()) return { timed: false, lines: [] };
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length);
    const lrcRe = /^\[(\d{1,2}):(\d{2})(?:\.(\d{1,2}))?\]\s*(.*)$/;
    const parsed = [];
    let anyTimed = false;
    lines.forEach(l => {
      const m = l.match(lrcRe);
      if (m) {
        anyTimed = true;
        const t = parseInt(m[1]) * 60 + parseInt(m[2]) + (m[3] ? parseFloat('0.' + m[3]) : 0);
        parsed.push({ time: t, text: m[4] });
      } else {
        parsed.push({ time: null, text: l });
      }
    });
    return { timed: anyTimed, lines: parsed };
  }

  function setupLyricsEngine() {
    // Nothing to bind at load; functions exposed via MusicPatch and used
    // by the fullscreen player + (optionally) the existing karaoke mode.
    const audioEl = document.getElementById('audioPlayer');
    if (!audioEl) return;
    audioEl.addEventListener('timeupdate', updateFsLyricsHighlight);
  }

  let fsLyricsState = { timed: false, lines: [] };

  function loadLyricsForCurrentTrack() {
    const t = currentTrackObj();
    const wrap = document.getElementById('mpFsLyrics');
    if (!wrap) return;
    if (!t || !t.lyrics || !t.lyrics.trim()) {
      fsLyricsState = { timed: false, lines: [] };
      wrap.innerHTML = `<div class="mp-lyric-unavailable">📜 Lyrics unavailable<br><span style="font-size:11px">Add lyrics for this song via ⋯ → Lyrics in the playlist</span></div>`;
      return;
    }
    const parsed = parseLyricsTimed(t.lyrics);
    fsLyricsState = parsed;
    wrap.innerHTML = parsed.lines.map((l, i) => `<div class="mp-lyric-line" data-i="${i}" onclick="MusicPatch.jumpToLyric(${i})">${escH(l.text || '\u266A')}</div>`).join('');
  }

  function updateFsLyricsHighlight() {
    const audioEl = document.getElementById('audioPlayer');
    if (!audioEl || !fsLyricsState.lines.length) return;
    let idx = -1;
    if (fsLyricsState.timed) {
      for (let i = 0; i < fsLyricsState.lines.length; i++) {
        if (fsLyricsState.lines[i].time !== null && fsLyricsState.lines[i].time <= audioEl.currentTime) idx = i;
      }
    } else if (audioEl.duration) {
      idx = Math.min(fsLyricsState.lines.length - 1, Math.floor((audioEl.currentTime / audioEl.duration) * fsLyricsState.lines.length));
    }
    document.querySelectorAll('.mp-lyric-line').forEach(el => el.classList.remove('mp-current'));
    if (idx >= 0) {
      const cur = document.querySelector(`.mp-lyric-line[data-i="${idx}"]`);
      if (cur) { cur.classList.add('mp-current'); cur.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }
  }

  function jumpToLyric(i) {
    const audioEl = document.getElementById('audioPlayer');
    const line = fsLyricsState.lines[i];
    if (!audioEl) return;
    if (fsLyricsState.timed && line && line.time !== null) audioEl.currentTime = line.time;
    else if (audioEl.duration) audioEl.currentTime = (i / fsLyricsState.lines.length) * audioEl.duration;
  }

  /* ═══════════════════════════════════════
     FULLSCREEN NOW-PLAYING PLAYER
  ═══════════════════════════════════════ */
  let fsRafId = null;

  function openFullscreen() {
    document.getElementById('mpFullscreenBg').classList.add('open');
    refreshFullscreenInfo();
    loadLyricsForCurrentTrack();
    ensureVisualizerGraph();
    if (!fsRafId) drawFsVisualizer();
  }
  function closeFullscreen() {
    document.getElementById('mpFullscreenBg').classList.remove('open');
    if (fsRafId) { cancelAnimationFrame(fsRafId); fsRafId = null; }
  }
  function fsTab(tab, el) {
    document.querySelectorAll('.mp-fs-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('mpFsPlayerView').style.display = tab === 'player' ? 'block' : 'none';
    document.getElementById('mpFsLyricsView').style.display = tab === 'lyrics' ? 'flex' : 'none';
    if (tab === 'lyrics') loadLyricsForCurrentTrack();
  }
  function fsSeek(e) {
    const audioEl = document.getElementById('audioPlayer');
    if (!audioEl || !audioEl.duration) return;
    const bar = document.getElementById('mpFsBar');
    const rect = bar.getBoundingClientRect();
    audioEl.currentTime = ((e.clientX - rect.left) / rect.width) * audioEl.duration;
  }

  function refreshFullscreenInfo() {
    const t = currentTrackObj();
    const artEl = document.getElementById('mpFsArt');
    if (t) {
      document.getElementById('mpFsTitle').textContent = t.title;
      document.getElementById('mpFsArtist').textContent = t.artist || 'Unknown Artist';
      artEl.innerHTML = t.artData ? `<img src="${t.artData}" alt="">` : `<span>${t.emoji || '🎵'}</span>`;
    } else {
      document.getElementById('mpFsTitle').textContent = 'No song playing';
      document.getElementById('mpFsArtist').textContent = '—';
      artEl.innerHTML = `<span>🎵</span>`;
    }
  }

  function tickFsProgress() {
    const audioEl = document.getElementById('audioPlayer');
    if (!audioEl || !document.getElementById('mpFullscreenBg').classList.contains('open')) return;
    if (audioEl.duration) {
      document.getElementById('mpFsBarFill').style.width = (audioEl.currentTime / audioEl.duration * 100) + '%';
      document.getElementById('mpFsCur').textContent = fmtTime(audioEl.currentTime);
      document.getElementById('mpFsDur').textContent = fmtTime(audioEl.duration);
    }
    document.getElementById('mpFsPlayBtn').textContent = musicState.playing ? '⏸' : '▶';
  }
  setInterval(tickFsProgress, 500);

  function ensureVisualizerGraph() {
    if (typeof ensureKaraokeAudioGraph === 'function') ensureKaraokeAudioGraph();
  }

  function drawFsVisualizer() {
    const canvas = document.getElementById('mpFsCanvas');
    const open = document.getElementById('mpFullscreenBg').classList.contains('open');
    if (!open) { fsRafId = null; return; }
    if (canvas) {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = 44 * dpr;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const analyser = typeof karaokeAnalyser !== 'undefined' ? karaokeAnalyser : null;
      if (analyser) {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const barCount = 48, step = Math.max(1, Math.floor(data.length / barCount)), bw = canvas.width / barCount;
        for (let i = 0; i < barCount; i++) {
          const v = (data[i * step] || 0) / 255;
          const h = Math.max(3 * dpr, v * canvas.height);
          ctx.fillStyle = 'rgba(255,255,255,0.7)';
          ctx.fillRect(i * bw + bw * 0.2, (canvas.height - h) / 2, bw * 0.6, h);
        }
      }
    }
    fsRafId = requestAnimationFrame(drawFsVisualizer);
  }

  /* ═══════════════════════════════════════
     MEDIA SESSION API (lock screen / notification controls,
     background playback metadata)
  ═══════════════════════════════════════ */
  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('play', () => { if (typeof togglePlay === 'function') { const audioEl = document.getElementById('audioPlayer'); if (!musicState.playing) togglePlay(); } });
    navigator.mediaSession.setActionHandler('pause', () => { if (musicState.playing && typeof togglePlay === 'function') togglePlay(); });
    navigator.mediaSession.setActionHandler('previoustrack', () => { if (typeof prevSong === 'function') prevSong(); });
    navigator.mediaSession.setActionHandler('nexttrack', () => { if (typeof nextSong === 'function') nextSong(); });
    try {
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        const audioEl = document.getElementById('audioPlayer');
        if (audioEl && details.seekTime != null) audioEl.currentTime = details.seekTime;
      });
      navigator.mediaSession.setActionHandler('seekbackward', () => {
        const audioEl = document.getElementById('audioPlayer');
        if (audioEl) audioEl.currentTime = Math.max(0, audioEl.currentTime - 10);
      });
      navigator.mediaSession.setActionHandler('seekforward', () => {
        const audioEl = document.getElementById('audioPlayer');
        if (audioEl) audioEl.currentTime = Math.min(audioEl.duration || 0, audioEl.currentTime + 10);
      });
    } catch (e) { /* some browsers don't support all handlers */ }

    // Patch playTrack + updateNowPlaying to push metadata
    const _origUpdateNowPlaying = window.updateNowPlaying;
    if (typeof _origUpdateNowPlaying === 'function') {
      window.updateNowPlaying = function (t) {
        _origUpdateNowPlaying(t);
        pushMediaSessionMetadata(t);
        refreshFullscreenInfo();
        loadLyricsForCurrentTrack();
      };
    }
    const audioEl = document.getElementById('audioPlayer');
    if (audioEl) {
      audioEl.addEventListener('play', () => { try { navigator.mediaSession.playbackState = 'playing'; } catch (e) {} });
      audioEl.addEventListener('pause', () => { try { navigator.mediaSession.playbackState = 'paused'; } catch (e) {} });
      audioEl.addEventListener('timeupdate', () => {
        try {
          if (audioEl.duration) {
            navigator.mediaSession.setPositionState({
              duration: audioEl.duration,
              playbackRate: audioEl.playbackRate || 1,
              position: Math.min(audioEl.currentTime, audioEl.duration),
            });
          }
        } catch (e) {}
      });
    }
  }

  function pushMediaSessionMetadata(t) {
    if (!('mediaSession' in navigator) || !t) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title || 'Untitled',
        artist: t.artist || 'Unknown Artist',
        album: 'Us With Love 💕',
        artwork: t.artData ? [
          { src: t.artData, sizes: '256x256', type: 'image/png' },
          { src: t.artData, sizes: '512x512', type: 'image/png' },
        ] : [],
      });
    } catch (e) {}
  }

  /* ═══════════════════════════════════════
     BEST-EFFORT ID3 / ALBUM ART EXTRACTION
     Uses jsmediatags from CDN if available; fails gracefully.
  ═══════════════════════════════════════ */
  let jsmediatagsLoaded = false, jsmediatagsLoading = false;
  function loadJsMediaTags(cb) {
    if (jsmediatagsLoaded) return cb();
    if (jsmediatagsLoading) { setTimeout(() => loadJsMediaTags(cb), 300); return; }
    jsmediatagsLoading = true;
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jsmediatags/3.9.7/jsmediatags.min.js';
    s.onload = () => { jsmediatagsLoaded = true; jsmediatagsLoading = false; cb(); };
    s.onerror = () => { jsmediatagsLoading = false; cb(new Error('jsmediatags failed to load')); };
    document.head.appendChild(s);
  }

  function setupId3Extraction() {
    // Wrap the file input change handlers so we can pre-fill metadata
    // before the existing "song modal" prefill logic runs. We do this by
    // intercepting the pending song data right after processNextUpload()
    // opens the modal, using a short delay + jsmediatags read on the raw file.
    const inputs = document.querySelectorAll('input[type=file][accept="audio/*"]');
    inputs.forEach(inp => {
      inp.addEventListener('change', function () {
        const file = this.files && this.files[0];
        if (!file) return;
        loadJsMediaTags(function (err) {
          if (err || !window.jsmediatags) return;
          try {
            window.jsmediatags.read(file, {
              onSuccess: function (tag) {
                const tags = tag.tags || {};
                setTimeout(() => {
                  const titleEl = document.getElementById('smTitle');
                  const artistEl = document.getElementById('smArtist');
                  if (titleEl && tags.title && (!titleEl.value || titleEl.value === file.name.replace(/\.[^/.]+$/, ''))) titleEl.value = tags.title;
                  if (artistEl && tags.artist) artistEl.value = tags.artist;
                  if (tags.picture) {
                    const { data, format } = tags.picture;
                    let base64 = '';
                    for (let i = 0; i < data.length; i++) base64 += String.fromCharCode(data[i]);
                    const artData = 'data:' + format + ';base64,' + window.btoa(base64);
                    window.pendingSongArt = artData;
                    const prev = document.getElementById('smArtPreview');
                    if (prev) { prev.src = artData; prev.style.display = 'block'; }
                  }
                }, 400); // wait for the modal's own prefill to run first
              },
              onError: function () { /* no ID3 tags — leave filename-based guess */ }
            });
          } catch (e) {}
        });
      });
    });
  }

  /* ═══════════════════════════════════════
     PUBLIC API
  ═══════════════════════════════════════ */
  window.MusicPatch = {
    cycleSpeed,
    openSleepModal, closeSleepModal, setSleepTimer, clearSleepTimer,
    openFullscreen, closeFullscreen, fsTab, fsSeek,
    jumpToLyric,
  };
})();