/* public/movie.js — "Watch Together"
   Loaded inside an iframe from index.html (same pattern as music.html /
   games.html). The movie file itself NEVER leaves this device — only
   tiny JSON room state goes through the API + Supabase Realtime.
*/
(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════
  // SECTION 1 — Couple/session context (same pattern as music.html)
  // ═══════════════════════════════════════════════════════
  const API = (function () {
    try { return window.parent.API || 'https://us-app-av6d.onrender.com'; }
    catch (e) { return 'https://us-app-av6d.onrender.com'; }
  })();

  function getCtx() {
    try {
      const s = window.parent.S;
      if (s && s.coupleId) {
        return { coupleId: s.coupleId, role: s.role || 'user1', myName: s.myName || 'You', partnerName: s.partnerName || 'Partner' };
      }
    } catch (e) {}
    try {
      const raw = localStorage.getItem('uwl_v5');
      if (raw) {
        const d = JSON.parse(raw);
        if (d.coupleId) return { coupleId: d.coupleId, role: d.role || 'user1', myName: d.myName || 'You', partnerName: d.partnerName || 'Partner' };
      }
    } catch (e) {}
    return null;
  }

  const ctx = getCtx();
  const ROLE = ctx ? ctx.role : 'user1';
  const OTHER_ROLE = ROLE === 'user1' ? 'user2' : 'user1';
  const COUPLE_ID = ctx ? ctx.coupleId : null;

  async function api(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(API + '/api/movie' + path, opts);
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error((data && data.error) || 'Request failed');
    return data;
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 2 — Supabase Realtime (broadcast-only channel, same anon
  // key pattern as music.html's setupMusicRealtime — small payloads go
  // straight over the wire, no need to fetch-on-ping here since the
  // events themselves already carry the state).
  // ═══════════════════════════════════════════════════════
  const WT_SUPABASE_URL = 'https://jmhsyhpmuszyphwjfcuk.supabase.co';
  const WT_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImptaHN5aHBtdXN6eXBod2pmY3VrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5NzAzODIsImV4cCI6MjA5OTU0NjM4Mn0.hXmVIoESJ5SkbhIaN-UyWLbJ4XdvZD_dd7U2WzFfvNI';
  let _sb = null, _channel = null, _presenceState = { partnerOnline: false };

  function getSb() {
    if (_sb) return _sb;
    try { _sb = window.supabase.createClient(WT_SUPABASE_URL, WT_SUPABASE_KEY); } catch (e) { _sb = null; }
    return _sb;
  }

  function setupRealtime() {
    if (_channel || !COUPLE_ID) return;
    const sb = getSb();
    if (!sb) return;
    _channel = sb.channel('watch_together:' + COUPLE_ID, {
      config: { broadcast: { self: false }, presence: { key: ROLE } }
    })
      .on('broadcast', { event: 'wt_state' }, (msg) => applyRemoteState(msg.payload))
      .on('broadcast', { event: 'wt_reaction' }, (msg) => showReaction(msg.payload.emoji, false))
      .on('presence', { event: 'sync' }, () => {
        const st = _channel.presenceState();
        _presenceState.partnerOnline = Object.keys(st).some(k => k === OTHER_ROLE);
        updatePartnerPresenceUI();
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') { try { await _channel.track({ role: ROLE, at: Date.now() }); } catch (e) {} }
      });
  }

  function broadcastState(partialPayload) {
    if (!_channel) return;
    try { _channel.send({ type: 'broadcast', event: 'wt_state', payload: partialPayload }); } catch (e) {}
  }
  function broadcastReaction(emoji) {
    if (!_channel) return;
    try { _channel.send({ type: 'broadcast', event: 'wt_reaction', payload: { emoji, from: ROLE } }); } catch (e) {}
  }

  window.addEventListener('pagehide', teardownRealtime);
  function teardownRealtime() {
    if (_channel && _sb) { try { _sb.removeChannel(_channel); } catch (e) {} _channel = null; }
    clearAllTimers();
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 3 — Local state
  // ═══════════════════════════════════════════════════════
  const state = {
    room: null,
    localFile: null,
    localObjectUrl: null,
    myDuration: null,
    myTitle: null,
    lastActionSeq: 0,
    applyingRemote: false,   // guard flag so our own listeners don't
                             // re-broadcast a change we just applied
                             // remotely (breaks feedback loops, spec §10)
    countdownTimer: null,
    driftTimer: null,
    reconnectPending: false
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    empty: $('stateEmpty'), lobby: $('stateLobby'), countdown: $('stateCountdown'), watching: $('stateWatching'),
    fileInput: $('movieFileInput'), video: $('wtVideo'),
    toast: $('wtToast'), banner: $('wtBanner'), bannerText: $('wtBannerText'), bannerActions: $('wtBannerActions')
  };

  function showState(name) {
    [els.empty, els.lobby, els.countdown, els.watching].forEach(el => { if (el) el.hidden = true; });
    ({ empty: els.empty, lobby: els.lobby, countdown: els.countdown, watching: els.watching })[name].hidden = false;
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
  }

  function toast(msg, ms) {
    els.toast.textContent = msg; els.toast.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => els.toast.hidden = true, ms || 2500);
  }

  function showBanner(text, actions) {
    els.bannerText.textContent = text;
    els.bannerActions.innerHTML = '';
    (actions || []).forEach(a => {
      const b = document.createElement('button');
      b.textContent = a.label; if (a.secondary) b.className = 'secondary';
      b.onclick = a.onClick;
      els.bannerActions.appendChild(b);
    });
    els.banner.hidden = false;
  }
  function hideBanner() { els.banner.hidden = true; }

  // ═══════════════════════════════════════════════════════
  // SECTION 4 — Local movie selection. A plain <input type=file> is
  // the safest choice here: it triggers Android's system document/file
  // picker, which is what supports Scoped Storage / SAF content URIs
  // without requesting broad storage permissions. We only ever use the
  // File object / a blob: object URL created from it — never a raw
  // filesystem path — and that URL is revoked when we're done. If the
  // app is killed and relaunched, the File reference is gone (a real
  // Android/browser limitation) — the user is asked to reselect (§33).
  // ═══════════════════════════════════════════════════════
  $('btnChooseMovie').onclick = () => els.fileInput.click();
  $('btnChangeMovie').onclick = () => els.fileInput.click();

  els.fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!/^video\//.test(file.type)) { toast("That file doesn't look like a supported video."); return; }

    if (state.localObjectUrl) URL.revokeObjectURL(state.localObjectUrl);
    state.localFile = file;
    state.localObjectUrl = URL.createObjectURL(file);

    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.src = state.localObjectUrl;
    probe.onloadedmetadata = async () => {
      state.myDuration = probe.duration;
      state.myTitle = file.name.replace(/\.[^/.]+$/, '');
      const sizeGb = (file.size / 1e9).toFixed(file.size > 1e9 ? 1 : 2);
      renderMyMovieCard(state.myTitle, state.myDuration, file.type, sizeGb);
      try {
        state.room = await api('POST', `/${COUPLE_ID}/movie`, { role: ROLE, title: state.myTitle, durationSec: state.myDuration });
        renderLobby();
      } catch (err) { toast('Could not save selection — check your connection.'); }
    };
    probe.onerror = () => toast("This video format may not be supported by your device's player.");
  });

  function renderMyMovieCard(title, duration, type, sizeGb) {
    $('myMovieCard').hidden = false;
    $('myMovieTitle').textContent = title;
    $('myMovieMeta').textContent = `${fmtTime(duration)} • ${(type.split('/')[1] || '').toUpperCase()} • ${sizeGb} GB`;
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 5 — Lobby rendering (compatibility check + ready system)
  // ═══════════════════════════════════════════════════════
  function renderLobby() {
    const r = state.room;
    if (!r) { showState('empty'); return; }
    showState('lobby');

    const mine = ROLE === 'user1' ? r.user1_duration_sec : r.user2_duration_sec;
    const theirs = ROLE === 'user1' ? r.user2_duration_sec : r.user1_duration_sec;
    const myReady = ROLE === 'user1' ? r.user1_ready : r.user2_ready;
    const theirReady = ROLE === 'user1' ? r.user2_ready : r.user1_ready;

    if (mine && theirs) {
      const banner = $('matchBanner'); banner.hidden = false;
      if (r.movies_match) {
        banner.className = 'wt-match-banner match'; banner.textContent = '✅ Movie Match';
        $('btnReady').hidden = false;
      } else {
        banner.className = 'wt-match-banner mismatch';
        banner.textContent = '⚠️ Your movie versions appear to have different durations. Please select matching versions before starting.';
        $('btnReady').hidden = true;
      }
    } else {
      $('matchBanner').hidden = true;
      $('btnReady').hidden = !mine;
    }

    $('stateMe').textContent = myReady ? '✓ Ready' : (mine ? 'Movie Selected' : 'Selecting…');
    $('chipMe').classList.toggle('is-ready', !!myReady);
    $('statePartner').textContent = theirReady ? '✓ Ready' : (theirs ? 'Movie Selected' : 'Waiting…');
    $('chipPartner').classList.toggle('is-ready', !!theirReady);
    if (ctx && ctx.partnerName) $('partnerNameLabel').textContent = ctx.partnerName;

    $('btnReady').classList.toggle('is-active', !!myReady);
    $('btnReady').textContent = myReady ? '✓ READY' : "I'M READY";

    const bothReady = r.movies_match && r.user1_ready && r.user2_ready;
    $('bothReadyBlock').hidden = !bothReady;

    if (r.status === 'countdown' && r.scheduled_start_at) runCountdown(r.scheduled_start_at);
    else if (r.status === 'watching') enterWatching(r);
  }

  $('btnReady').onclick = async () => {
    const r = state.room;
    const currentlyReady = ROLE === 'user1' ? r.user1_ready : r.user2_ready;
    try {
      state.room = await api('POST', `/${COUPLE_ID}/ready`, { role: ROLE, ready: !currentlyReady });
      renderLobby();
    } catch (e) { toast('Could not update ready state.'); }
  };

  $('btnStart').onclick = async () => {
    try {
      state.room = await api('POST', `/${COUPLE_ID}/start`, { role: ROLE, countdownMs: 3500 });
      runCountdown(state.room.scheduled_start_at);
    } catch (e) { toast('Could not start session.'); }
  };

  // ═══════════════════════════════════════════════════════
  // SECTION 6 — Countdown (shared future timestamp, not two local
  // timers, so latency can't let one device start noticeably early)
  // ═══════════════════════════════════════════════════════
  function runCountdown(startAtIso) {
    showState('countdown');
    const startAt = new Date(startAtIso).getTime();
    clearInterval(state.countdownTimer);
    state.countdownTimer = setInterval(() => {
      const secLeft = Math.ceil((startAt - Date.now()) / 1000);
      if (secLeft <= 0) {
        clearInterval(state.countdownTimer);
        $('countdownNum').textContent = '❤️';
        setTimeout(() => enterWatching(state.room), 400);
      } else {
        $('countdownNum').textContent = String(secLeft);
      }
    }, 200);
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 7 — Player + clock-based sync engine
  // ═══════════════════════════════════════════════════════
  function enterWatching(room) {
    showState('watching');
    setupRealtime();
    if (state.localObjectUrl) els.video.src = state.localObjectUrl;
    els.video.currentTime = expectedPosition(room);
    if (room.playing) els.video.play().catch(() => {});
    startDriftLoop();
    setupCallBridge();
  }

  function expectedPosition(room) {
    if (!room) return 0;
    if (!room.playing) return room.position_sec || 0;
    const elapsed = (Date.now() - new Date(room.updated_at).getTime()) / 1000;
    return (room.position_sec || 0) + Math.max(0, elapsed);
  }

  function nextSeq() { return (state.lastActionSeq = Math.max(state.lastActionSeq + 1, Date.now())); }

  async function sendAction(playing, positionSec) {
    const seq = nextSeq();
    const payload = { role: ROLE, playing, positionSec, actionSeq: seq, updated_at: new Date().toISOString(), updated_by: ROLE };
    broadcastState(payload); // instant path for a partner who's online right now
    try { state.room = await api('PATCH', `/${COUPLE_ID}/state`, { role: ROLE, playing, positionSec, actionSeq: seq }); }
    catch (e) { /* durable write failed; broadcast may still have reached partner — reconciled on next reconnect */ }
  }

  function applyRemoteState(payload) {
    if (!payload || payload.actionSeq <= state.lastActionSeq) return; // stale/out-of-order — ignore (§25)
    state.lastActionSeq = payload.actionSeq;
    state.room = { ...(state.room || {}), playing: payload.playing, position_sec: payload.positionSec, updated_at: payload.updated_at };

    state.applyingRemote = true;
    const target = expectedPosition(state.room);
    if (Math.abs(els.video.currentTime - target) > 0.5) els.video.currentTime = target;
    if (payload.playing) els.video.play().catch(() => {}); else els.video.pause();
    setTimeout(() => { state.applyingRemote = false; }, 250);

    updatePlayPauseIcon();
  }

  function updatePlayPauseIcon() { $('btnPlayPause').textContent = els.video.paused ? '▶' : '⏸'; }

  $('btnPlayPause').onclick = () => {
    if (state.applyingRemote) return;
    if (els.video.paused) { els.video.play(); sendAction(true, els.video.currentTime); }
    else { els.video.pause(); sendAction(false, els.video.currentTime); }
    updatePlayPauseIcon();
  };
  $('btnSeekBack').onclick = () => userSeek(els.video.currentTime - 10);
  $('btnSeekFwd').onclick = () => userSeek(els.video.currentTime + 10);
  $('wtTimeline').addEventListener('change', (e) => userSeek(parseFloat(e.target.value) / 100 * (els.video.duration || 0)));
  function userSeek(t) {
    if (state.applyingRemote) return;
    els.video.currentTime = Math.max(0, t);
    sendAction(!els.video.paused, els.video.currentTime);
  }

  els.video.addEventListener('timeupdate', () => {
    if (!els.video.duration) return;
    $('wtTimeline').value = (els.video.currentTime / els.video.duration) * 100;
    $('wtTimeLabel').textContent = `${fmtTime(els.video.currentTime)} / ${fmtTime(els.video.duration)}`;
  });
  els.video.addEventListener('ended', async () => {
    try {
      state.room = await api('POST', `/${COUPLE_ID}/end`, { role: ROLE, movieTitle: state.myTitle, durationSec: state.myDuration, completedPct: 100 });
    } catch (e) {}
    toast('Movie finished ❤️');
  });

  // ── Periodic drift correction (§12) — this only READS the local
  // clock-derived expected position and nudges local playback; nothing
  // is written to the server on this loop. ──
  function startDriftLoop() {
    clearInterval(state.driftTimer);
    state.driftTimer = setInterval(() => {
      if (!state.room || !state.room.playing || state.applyingRemote || document.hidden) return;
      const expected = expectedPosition(state.room);
      const diff = expected - els.video.currentTime;
      const abs = Math.abs(diff);
      if (abs < 0.5) {
        els.video.playbackRate = 1;
        $('syncStatus').textContent = '✓ In sync';
      } else if (abs < 2) {
        // Gentle correction. Flagged risk: playback-rate nudging can
        // behave inconsistently on some Android decoders — simplify to
        // hard-seek-only here if that proves true in testing.
        els.video.playbackRate = diff > 0 ? 1.03 : 0.97;
        $('syncStatus').textContent = `Sync difference: ${abs.toFixed(1)}s`;
      } else {
        els.video.playbackRate = 1;
        els.video.currentTime = expected;
        $('syncStatus').textContent = 'Resyncing…';
      }
    }, 1000);
  }

  $('btnSync').onclick = () => {
    if (!state.room) return;
    els.video.currentTime = expectedPosition(state.room);
    toast('Synced ✓');
  };

  function clearAllTimers() { clearInterval(state.countdownTimer); clearInterval(state.driftTimer); }

  // ═══════════════════════════════════════════════════════
  // SECTION 8 — Reactions (ephemeral only — never written to the DB)
  // ═══════════════════════════════════════════════════════
  document.querySelectorAll('#reactionBar button').forEach(btn => {
    btn.onclick = () => { const emoji = btn.dataset.r; showReaction(emoji, true); broadcastReaction(emoji); };
  });
  function showReaction(emoji, mine) {
    const el = document.createElement('div');
    el.className = 'wt-reaction-float';
    el.textContent = emoji;
    el.style.left = (mine ? 70 : (20 + Math.random() * 20)) + '%';
    $('reactionsLayer').appendChild(el);
    setTimeout(() => el.remove(), 2300);
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 9 — Fullscreen
  // ═══════════════════════════════════════════════════════
  $('btnFullscreen').onclick = async () => {
    const wrap = $('playerWrap');
    if (!document.fullscreenElement) {
      await wrap.requestFullscreen().catch(() => {});
      try { screen.orientation && screen.orientation.lock && await screen.orientation.lock('landscape'); } catch (e) {}
    } else {
      await document.exitFullscreen().catch(() => {});
      try { screen.orientation && screen.orientation.unlock && screen.orientation.unlock(); } catch (e) {}
    }
  };

  // ═══════════════════════════════════════════════════════
  // SECTION 10 — Partner video PiP bridge. Reuses the EXISTING call
  // system in public/chat/call.js, which lives in the PARENT window,
  // not this iframe — bridged via window.parent.Call rather than a
  // second WebRTC implementation. Requires one small additive patch to
  // call.js (getRemoteStream()/getState() + a change event) — see the
  // report. Nothing about the call's own logic is touched.
  // ═══════════════════════════════════════════════════════
  function setupCallBridge() {
    const pip = $('wtPip'), pipVideo = $('wtPipVideo'), fallback = $('wtPipAvatarFallback'), badge = $('wtPipBadge');
    let expanded = false, dragMoved = false;

    function refresh() {
      let Call = null;
      try { Call = window.parent.Call; } catch (e) {}
      if (!Call || typeof Call.getRemoteStream !== 'function') { pip.hidden = true; $('wtPipControls').hidden = true; return; }
      const stream = Call.getRemoteStream();
      const camOn = typeof Call.getRemoteCamOn === 'function' ? Call.getRemoteCamOn() : true;
      if (!stream) { pip.hidden = true; return; }
      pip.hidden = false;
      if (camOn) {
        pipVideo.srcObject = stream; pipVideo.hidden = false; fallback.hidden = true;
        badge.style.color = 'var(--green,#34d399)';
      } else {
        pipVideo.hidden = true; fallback.hidden = false;
        fallback.textContent = (ctx && ctx.partnerName ? ctx.partnerName[0] : 'P');
      }
    }
    try { window.parent.addEventListener('uwl:call-stream-changed', refresh); } catch (e) {}
    refresh();
    setInterval(refresh, 4000); // cheap fallback poll in case the event bridge isn't wired up yet

    pip.onclick = () => { if (dragMoved) { dragMoved = false; return; } expanded = !expanded; pip.classList.toggle('expanded', expanded); $('wtPipControls').hidden = !expanded; };

    // Draggable, snaps to nearest corner, stays within the visible movie area
    let sx, sy, ox, oy, dragging = false;
    pip.addEventListener('pointerdown', (e) => { dragging = true; dragMoved = false; sx = e.clientX; sy = e.clientY; const r = pip.getBoundingClientRect(); ox = r.left; oy = r.top; pip.setPointerCapture(e.pointerId); });
    pip.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragMoved = true;
      pip.style.left = Math.max(4, ox + dx) + 'px'; pip.style.top = Math.max(4, oy + dy) + 'px';
      pip.style.right = 'auto'; pip.style.bottom = 'auto';
    });
    pip.addEventListener('pointerup', () => {
      dragging = false;
      const wrap = $('playerWrap').getBoundingClientRect();
      const r = pip.getBoundingClientRect();
      const snapLeft = (r.left - wrap.left) < (wrap.width / 2);
      const snapTop = (r.top - wrap.top) < (wrap.height / 2);
      pip.style.left = pip.style.top = pip.style.right = pip.style.bottom = '';
      pip.style.left = snapLeft ? '16px' : 'auto';
      pip.style.right = snapLeft ? 'auto' : '16px';
      pip.style.top = snapTop ? '16px' : 'auto';
      pip.style.bottom = snapTop ? 'auto' : '90px'; // stay clear of the controls bar
    });

    $('pipMuteBtn').onclick = () => { try { window.parent.Call.toggleMute(); } catch (e) {} };
    $('pipCamBtn').onclick = () => { try { window.parent.Call.toggleCam(); } catch (e) {} };
    $('pipEndBtn').onclick = () => { try { window.parent.Call.endCall(); } catch (e) {} };
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 11 — Chat overlay (reuse existing chat system — ask the
  // parent window to open its existing chat drawer over this page)
  // ═══════════════════════════════════════════════════════
  $('btnChat').onclick = () => { try { window.parent.postMessage({ type: 'uwl:open-chat-overlay' }, '*'); } catch (e) {} };

  // ═══════════════════════════════════════════════════════
  // SECTION 12 — Partner presence / left-room handling
  // ═══════════════════════════════════════════════════════
  function updatePartnerPresenceUI() {
    if (!els.watching.hidden) {
      $('partnerOverlay').textContent = _presenceState.partnerOnline ? '❤️ Partner Watching' : 'Partner • Reconnecting…';
    }
    if (!_presenceState.partnerOnline && state.room && state.room.status === 'watching') {
      showBanner('Partner left the room.', [
        { label: 'Continue Alone', onClick: hideBanner },
        { label: 'Wait for Partner', secondary: true, onClick: hideBanner },
        { label: 'End Session', secondary: true, onClick: endSession }
      ]);
    } else if (_presenceState.partnerOnline) {
      hideBanner();
    }
  }
  async function endSession() {
    hideBanner();
    try { state.room = await api('POST', `/${COUPLE_ID}/end`, { role: ROLE, movieTitle: state.myTitle, durationSec: state.myDuration }); } catch (e) {}
    showState('empty');
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 13 — Reconnect handling (network + app resume). On resume:
  // fetch authoritative state, recompute expected position, reconcile —
  // never trust JS timers that may have been frozen while backgrounded.
  // ═══════════════════════════════════════════════════════
  async function reconcile() {
    if (!COUPLE_ID || state.reconnectPending) return;
    state.reconnectPending = true;
    try {
      const room = await api('GET', `/${COUPLE_ID}`);
      state.reconnectPending = false;
      if (!room) return;
      state.room = room;
      if (room.action_seq && room.action_seq > state.lastActionSeq) state.lastActionSeq = room.action_seq;
      if (!els.watching.hidden) {
        const target = expectedPosition(room);
        if (Math.abs(els.video.currentTime - target) > 1) els.video.currentTime = target;
        if (room.playing) els.video.play().catch(() => {}); else els.video.pause();
      } else {
        renderLobby();
      }
      hideBanner();
    } catch (e) {
      state.reconnectPending = false;
      if (!els.watching.hidden) showBanner('⚠️ Connection lost. Trying to reconnect…', []);
    }
  }
  window.addEventListener('online', reconcile);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reconcile(); });
  window.addEventListener('pageshow', reconcile);
  window.addEventListener('focus', reconcile);

  // ═══════════════════════════════════════════════════════
  // SECTION 14 — Boot
  // ═══════════════════════════════════════════════════════
  $('wtBack').onclick = () => { try { window.parent.postMessage({ type: 'uwl:close-watch-together' }, '*'); } catch (e) {} };

  (async function init() {
    if (!COUPLE_ID) { toast('Could not find your couple pairing.'); return; }
    setupRealtime();
    try {
      const room = await api('GET', `/${COUPLE_ID}`);
      state.room = room;
      if (!room || room.status === 'idle' || room.status === 'ended') showState('empty');
      else if (room.status === 'watching') enterWatching(room);
      else if (room.status === 'countdown' && room.scheduled_start_at) runCountdown(room.scheduled_start_at);
      else renderLobby();
    } catch (e) { showState('empty'); }
  })();

})();