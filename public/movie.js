/* public/movie.js — "Watch Together" V2
   Loaded inside an iframe from index.html (same pattern as music.html /
   games.html). The movie file itself NEVER leaves this device — only
   tiny JSON room state goes through the API + Supabase Realtime.

   STATE MACHINE (single source of truth — UI is a pure function of this):
   SETUP → START_REQUESTED (mine) → COUNTDOWN → WATCHING → ENDED
   The invited partner sees an INVITATION modal layered on SETUP, then
   also moves to COUNTDOWN once they accept.
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
  // Raw chat backend — reused as-is, no second messaging system created.
  async function chatApi(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(API + path, opts);
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error((data && data.error) || 'Request failed');
    return data;
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 2 — Supabase Realtime (broadcast-only channel)
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
      .on('broadcast', { event: 'wt_room' }, (msg) => applyRemoteRoom(msg.payload))
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
  // Full-room broadcasts (request-start / accept / cancel / end) so the
  // partner reacts INSTANTLY instead of waiting on a poll.
  function broadcastRoom(room) {
    if (!_channel) return;
    try { _channel.send({ type: 'broadcast', event: 'wt_room', payload: room }); } catch (e) {}
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
    applyingRemote: false,
    countdownTimer: null,
    driftTimer: null,
    hideTimer: null,
    chatPollTimer: null,
    lastChatTs: null,
    reconnectPending: false,
    scrubbing: false,
    uiState: 'boot' // setup | countdown | watching | ended
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    setup: $('stateSetup'), countdown: $('stateCountdown'), watching: $('stateWatching'),
    empty: $('wtEmptyCard'), lobby: $('wtLobby'), waiting: $('waitingBlock'),
    fileInput: $('movieFileInput'), video: $('wtVideo'), wrap: $('playerWrap'),
    toast: $('wtToast'), banner: $('wtBanner'), bannerText: $('wtBannerText'), bannerActions: $('wtBannerActions')
  };

  function showState(name) {
    state.uiState = name;
    [els.setup, els.countdown, els.watching].forEach(el => { if (el) el.hidden = true; });
    document.getElementById('wtPage').classList.toggle('is-watching', name === 'watching');
    if (name === 'setup') els.setup.hidden = false;
    else if (name === 'countdown') els.countdown.hidden = false;
    else if (name === 'watching') els.watching.hidden = false;
  }

  function showSetupSub(sub) {
    // sub: 'empty' | 'lobby' | 'waiting'
    els.empty.hidden = sub !== 'empty';
    els.lobby.hidden = sub === 'empty';
    els.waiting.hidden = sub !== 'waiting';
    $('bothReadyBlock').hidden = sub === 'waiting' || $('bothReadyBlock').hidden;
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

  function setStatusPill(text, kind) {
    const pill = $('statusPill');
    if (!text) { pill.hidden = true; return; }
    pill.hidden = false;
    pill.textContent = text;
    pill.className = 'wt-status-pill' + (kind ? ' is-' + kind : '');
    clearTimeout(setStatusPill._t);
    if (kind !== 'warn') setStatusPill._t = setTimeout(() => { pill.hidden = true; }, 2200);
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 4 — Local movie selection
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
        renderFromRoom();
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
  // SECTION 5 — Central room → UI dispatcher. This is the ONLY place
  // that decides which top-level state (+ setup sub-state) is shown, so
  // behavior stays deterministic instead of inferred from scattered
  // hidden/shown DOM flags (per spec's "no dozens of unrelated elements"
  // requirement).
  // ═══════════════════════════════════════════════════════
  function renderFromRoom() {
    const r = state.room;
    if (!r || r.status === 'idle' || r.status === 'ended') { showState('setup'); showSetupSub('empty'); hideInviteModal(); return; }

    if (r.status === 'countdown' && r.scheduled_start_at) {
      hideInviteModal();
      runCountdown(r.scheduled_start_at);
      return;
    }
    if (r.status === 'watching') { hideInviteModal(); enterWatching(r); return; }

    // Non-watching statuses render inside the SETUP state.
    showState('setup');

    if (r.status === 'start_requested') {
      if (r.start_requested_by === ROLE) {
        showSetupSub('waiting');
      } else {
        showSetupSub('lobby'); // stays on lobby underneath the modal
        showInviteModal(r);
      }
      return;
    }
    hideInviteModal();

    const mine = ROLE === 'user1' ? r.user1_duration_sec : r.user2_duration_sec;
    if (!mine) { showSetupSub('empty'); return; }
    showSetupSub('lobby');
    renderLobby(r);
  }

  function renderLobby(r) {
    const mine = ROLE === 'user1' ? r.user1_duration_sec : r.user2_duration_sec;
    const theirs = ROLE === 'user1' ? r.user2_duration_sec : r.user1_duration_sec;
    const myReady = ROLE === 'user1' ? r.user1_ready : r.user2_ready;
    const theirReady = ROLE === 'user1' ? r.user2_ready : r.user1_ready;

    if (mine) renderMyMovieCard(r[`${ROLE}_movie_title`] || state.myTitle || 'Selected movie', mine, 'video/mp4', '—');

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
  }

  $('btnReady').onclick = async () => {
    const r = state.room;
    const currentlyReady = ROLE === 'user1' ? r.user1_ready : r.user2_ready;
    try {
      state.room = await api('POST', `/${COUPLE_ID}/ready`, { role: ROLE, ready: !currentlyReady });
      renderFromRoom();
    } catch (e) { toast('Could not update ready state.'); }
  };

  // ═══════════════════════════════════════════════════════
  // SECTION 6 — Start request / accept / cancel flow. B never has to
  // manually press Start after accepting — accept-start alone schedules
  // the shared countdown for BOTH clients.
  // ═══════════════════════════════════════════════════════
  $('btnStart').onclick = async () => {
    try {
      state.room = await api('POST', `/${COUPLE_ID}/request-start`, { role: ROLE });
      broadcastRoom(state.room);
      renderFromRoom();
    } catch (e) { toast('Could not start session.'); }
  };

  $('btnCancelStart').onclick = async () => {
    try {
      state.room = await api('POST', `/${COUPLE_ID}/cancel-start`, { role: ROLE });
      broadcastRoom(state.room);
      renderFromRoom();
    } catch (e) { toast('Could not cancel.'); }
  };

  function showInviteModal(r) {
    $('inviteMovieName').textContent = r[`${OTHER_ROLE}_movie_title`] || state.myTitle || 'Selected movie';
    $('inviteModalBackdrop').hidden = false;
  }
  function hideInviteModal() { $('inviteModalBackdrop').hidden = true; }

  $('btnDeclineInvite').onclick = async () => {
    hideInviteModal();
    try {
      state.room = await api('POST', `/${COUPLE_ID}/cancel-start`, { role: ROLE });
      broadcastRoom(state.room);
    } catch (e) {}
  };
  $('btnAcceptInvite').onclick = async () => {
    hideInviteModal();
    try {
      state.room = await api('POST', `/${COUPLE_ID}/accept-start`, { role: ROLE, countdownMs: 4000 });
      broadcastRoom(state.room);
      runCountdown(state.room.scheduled_start_at);
    } catch (e) { toast('Could not accept.'); }
  };

  // Instant partner-side reaction to a room-level broadcast (request /
  // accept / cancel / end) without waiting on the next poll.
  function applyRemoteRoom(room) {
    if (!room) return;
    if (room.action_seq && state.room && room.action_seq <= (state.room.action_seq || 0)) return;
    state.room = room;
    renderFromRoom();
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 7 — Countdown (shared future timestamp)
  // ═══════════════════════════════════════════════════════
  function runCountdown(startAtIso) {
    if (state.uiState === 'countdown' && state._countdownFor === startAtIso) return; // already running this one
    state._countdownFor = startAtIso;
    showState('countdown');
    const startAt = new Date(startAtIso).getTime();
    clearInterval(state.countdownTimer);
    state.countdownTimer = setInterval(() => {
      const secLeft = Math.ceil((startAt - Date.now()) / 1000);
      if (secLeft <= 0) {
        clearInterval(state.countdownTimer);
        setTimeout(() => enterWatching(state.room), 150);
      } else {
        $('countdownNum').textContent = String(Math.min(3, secLeft));
      }
    }, 200);
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 8 — Player + clock-based sync engine
  // ═══════════════════════════════════════════════════════
  function enterWatching(room) {
    if (state.uiState === 'watching') return;
    showState('watching');
    setupRealtime();
    $('wtNowTitle').textContent = state.myTitle || room[`${ROLE}_movie_title`] || 'Movie';
    if (state.localObjectUrl) els.video.src = state.localObjectUrl;

    // Late-start correction: if this client's clock lands here later
    // than another (backgrounded tab, slow event delivery), compute how
    // far into playback we already are rather than starting from 0.
    const elapsedSinceStart = room.scheduled_start_at ? (Date.now() - new Date(room.scheduled_start_at).getTime()) / 1000 : 0;
    const target = Math.max(0, elapsedSinceStart) + expectedPosition(room);
    els.video.currentTime = target;
    els.video.play().catch(() => {});
    if (!room.playing) {
      // Countdown just finished — this is the moment playback truly begins.
      sendAction(true, target);
    }
    startDriftLoop();
    setupCallBridge();
    setupControlsAutoHide();
    startChatPolling();
    updatePlayPauseIcon();
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
    broadcastState(payload);
    try { state.room = await api('PATCH', `/${COUPLE_ID}/state`, { role: ROLE, playing, positionSec, actionSeq: seq }); }
    catch (e) { /* durable write failed; broadcast may still have reached partner — reconciled on next reconnect */ }
  }

  function applyRemoteState(payload) {
    if (!payload || payload.actionSeq <= state.lastActionSeq) return; // stale/out-of-order — ignore
    state.lastActionSeq = payload.actionSeq;
    state.room = { ...(state.room || {}), playing: payload.playing, position_sec: payload.positionSec, updated_at: payload.updated_at };

    state.applyingRemote = true;
    const target = expectedPosition(state.room);
    if (Math.abs(els.video.currentTime - target) > 0.5) els.video.currentTime = target;
    if (payload.playing) els.video.play().catch(() => {}); else els.video.pause();
    setTimeout(() => { state.applyingRemote = false; }, 250);

    updatePlayPauseIcon();
    if (!payload.playing) setStatusPill(payload.updated_by === ROLE ? 'Paused' : 'Paused by Partner', 'warn');
    else setStatusPill(null);
    wakeControls();
  }

  function updatePlayPauseIcon() { $('playIcon').textContent = els.video.paused ? '▶' : '⏸'; }

  $('btnPlayPause').onclick = () => {
    if (state.applyingRemote) return;
    if (els.video.paused) { els.video.play(); sendAction(true, els.video.currentTime); setStatusPill(null); }
    else { els.video.pause(); sendAction(false, els.video.currentTime); setStatusPill('Paused', 'warn'); }
    updatePlayPauseIcon();
    wakeControls();
  };
  $('btnSeekBack').onclick = () => { userSeek(els.video.currentTime - 10); wakeControls(); };
  $('btnSeekFwd').onclick = () => { userSeek(els.video.currentTime + 10); wakeControls(); };

  // Timeline: only sync to partner once the user finishes dragging
  // ("change"), never per-pixel on "input" — spec §Timeline.
  const timelineEl = $('wtTimeline');
  timelineEl.addEventListener('pointerdown', () => { state.scrubbing = true; wakeControls(true); });
  timelineEl.addEventListener('input', () => {
    if (!els.video.duration) return;
    const t = (parseFloat(timelineEl.value) / 1000) * els.video.duration;
    $('wtTimeCur').textContent = fmtTime(t);
  });
  timelineEl.addEventListener('change', (e) => {
    state.scrubbing = false;
    if (!els.video.duration) return;
    const t = (parseFloat(e.target.value) / 1000) * els.video.duration;
    userSeek(t);
  });
  function userSeek(t) {
    if (state.applyingRemote) return;
    els.video.currentTime = Math.max(0, t);
    sendAction(!els.video.paused, els.video.currentTime);
  }

  els.video.addEventListener('timeupdate', () => {
    if (!els.video.duration || state.scrubbing) return;
    timelineEl.value = (els.video.currentTime / els.video.duration) * 1000;
    $('wtTimeCur').textContent = fmtTime(els.video.currentTime);
    $('wtTimeTotal').textContent = fmtTime(els.video.duration);
  });
  els.video.addEventListener('ended', async () => {
    try {
      state.room = await api('POST', `/${COUPLE_ID}/end`, { role: ROLE, movieTitle: state.myTitle, durationSec: state.myDuration, completedPct: 100 });
    } catch (e) {}
    toast('Movie finished ❤️');
  });

  // ── Periodic drift correction — reads only, never writes to server ──
  function startDriftLoop() {
    clearInterval(state.driftTimer);
    state.driftTimer = setInterval(() => {
      if (!state.room || !state.room.playing || state.applyingRemote || document.hidden || state.scrubbing) return;
      const expected = expectedPosition(state.room);
      const diff = expected - els.video.currentTime;
      const abs = Math.abs(diff);
      if (abs < 0.5) {
        els.video.playbackRate = 1;
      } else if (abs < 2) {
        els.video.playbackRate = diff > 0 ? 1.03 : 0.97;
      } else {
        els.video.playbackRate = 1;
        els.video.currentTime = expected;
      }
    }, 1000);
  }

  // FIXED SYNC: compute the authoritative expected position (accounting
  // for elapsed time since the last state write) and hard-seek to it
  // WITHOUT pausing or re-broadcasting — this is what was silently
  // failing before because there was no visible confirmation and the
  // 1s drift loop and the manual sync could visually fight each other.
  $('btnSync').onclick = async () => {
    if (!state.room) return;
    try {
      // Pull the authoritative row first so Sync also fixes a stale
      // local copy, not just clock drift on an already-fresh one.
      const fresh = await api('GET', `/${COUPLE_ID}`);
      if (fresh) state.room = { ...state.room, ...fresh };
    } catch (e) { /* fall back to local state.room if offline */ }
    const wasPlaying = !els.video.paused;
    const target = expectedPosition(state.room);
    els.video.currentTime = target;
    els.video.playbackRate = 1;
    if (wasPlaying) els.video.play().catch(() => {}); // never leave it paused
    setStatusPill('✓ In Sync', 'good');
    wakeControls();
  };

  function clearAllTimers() { clearInterval(state.countdownTimer); clearInterval(state.driftTimer); clearTimeout(state.hideTimer); clearInterval(state.chatPollTimer); }

  // ═══════════════════════════════════════════════════════
  // SECTION 9 — Auto-hiding controls. Single timer, single source of
  // truth (playerWrap.controls-hidden class), no competing timers.
  // ═══════════════════════════════════════════════════════
  let controlsLocked = false; // true while paused-needs-controls, dragging, chat/call open, or a modal is up
  function setupControlsAutoHide() {
    clearTimeout(state.hideTimer);
    els.wrap.classList.remove('controls-hidden');
    $('tapCatcher').onclick = onPlayerTap;
    ['pointerdown', 'touchstart'].forEach(evt => els.wrap.addEventListener(evt, () => wakeControls()));
    armHideTimer();
  }
  function onPlayerTap() {
    if (els.wrap.classList.contains('controls-hidden')) wakeControls();
    else if (!controlsLocked) hideControlsNow();
    else wakeControls();
  }
  function wakeControls(forceLock) {
    els.wrap.classList.remove('controls-hidden');
    if (forceLock) return;
    armHideTimer();
  }
  function hideControlsNow() {
    if (controlsLocked) return;
    els.wrap.classList.add('controls-hidden');
  }
  function armHideTimer() {
    clearTimeout(state.hideTimer);
    state.hideTimer = setTimeout(() => {
      const paused = els.video.paused;
      const chatOpen = !$('chatComposer').hidden;
      const modalOpen = !$('endModalBackdrop').hidden || !$('inviteModalBackdrop').hidden;
      if (paused || chatOpen || modalOpen || controlsLocked || state.scrubbing) return;
      hideControlsNow();
    }, 3000);
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 10 — Reactions (ephemeral only — never written to the DB)
  // ═══════════════════════════════════════════════════════
  $('reactionToggle').onclick = () => {
    const bar = $('reactionBar');
    bar.hidden = !bar.hidden;
    wakeControls(!bar.hidden);
  };
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
  // SECTION 11 — Fullscreen
  // ═══════════════════════════════════════════════════════
  $('btnFullscreen').onclick = async () => {
    if (!document.fullscreenElement) {
      await els.wrap.requestFullscreen().catch(() => {});
      try { screen.orientation && screen.orientation.lock && await screen.orientation.lock('landscape'); } catch (e) {}
    } else {
      await document.exitFullscreen().catch(() => {});
      try { screen.orientation && screen.orientation.unlock && screen.orientation.unlock(); } catch (e) {}
    }
    wakeControls();
  };
  // Fullscreen/orientation changes must never duplicate listeners —
  // this handler is attached exactly once at module scope.
  document.addEventListener('fullscreenchange', () => wakeControls());

  // ═══════════════════════════════════════════════════════
  // SECTION 12 — Partner video PiP bridge (existing call system, bridged
  // via window.parent.Call — NOT a second WebRTC implementation).
  // ═══════════════════════════════════════════════════════
  let callBridgeSetup = false;
  function setupCallBridge() {
    if (callBridgeSetup) return; // guard against duplicate listeners across rerenders/fullscreen toggles
    callBridgeSetup = true;
    const pip = $('wtPip'), pipVideo = $('wtPipVideo'), fallback = $('wtPipAvatarFallback'), badge = $('wtPipBadge');
    let expanded = false, dragMoved = false;

    function refresh() {
      let Call = null;
      try { Call = window.parent.Call; } catch (e) {}
      if (!Call || typeof Call.getRemoteStream !== 'function') { pip.hidden = true; $('wtPipControls').hidden = true; return; }
      const stream = Call.getRemoteStream();
      const camOn = typeof Call.getRemoteCamOn === 'function' ? Call.getRemoteCamOn() : true;
      if (!stream) { pip.hidden = true; $('wtPipControls').hidden = true; return; }
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
    setInterval(refresh, 4000);

    pip.onclick = () => { if (dragMoved) { dragMoved = false; return; } expanded = !expanded; pip.classList.toggle('expanded', expanded); $('wtPipControls').hidden = !expanded; wakeControls(); };

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
      const wrap = els.wrap.getBoundingClientRect();
      const r = pip.getBoundingClientRect();
      const snapLeft = (r.left - wrap.left) < (wrap.width / 2);
      const snapTop = (r.top - wrap.top) < (wrap.height / 2);
      pip.style.left = pip.style.top = pip.style.right = pip.style.bottom = '';
      pip.style.left = snapLeft ? '16px' : 'auto';
      pip.style.right = snapLeft ? 'auto' : '16px';
      pip.style.top = snapTop ? '16px' : 'auto';
      pip.style.bottom = snapTop ? 'auto' : '90px';
    });

    $('pipMuteBtn').onclick = () => { try { window.parent.Call.toggleMute(); } catch (e) {} };
    $('pipCamBtn').onclick = () => { try { window.parent.Call.toggleCam(); } catch (e) {} };
    $('pipEndBtn').onclick = () => { try { window.parent.Call.endCall(); } catch (e) {} };
  }

  // Voice / Video call buttons — connect to the EXISTING call system,
  // no fake UI, no second backend.
  $('btnVoiceCall').onclick = () => {
    try {
      const Call = window.parent.Call;
      if (Call && typeof Call.startCall === 'function') Call.startCall('audio');
      else toast('Call system unavailable.');
    } catch (e) { toast('Call system unavailable.'); }
    wakeControls();
  };
  $('btnVideoCall').onclick = () => {
    try {
      const Call = window.parent.Call;
      if (Call && typeof Call.startCall === 'function') Call.startCall('video');
      else toast('Call system unavailable.');
    } catch (e) { toast('Call system unavailable.'); }
    wakeControls();
  };

  // ═══════════════════════════════════════════════════════
  // SECTION 13 — Movie-chat: a lightweight composer over the player that
  // reuses the EXISTING /api/chat backend (same table/rows real Chat
  // messages use) instead of a second messaging system.
  // ═══════════════════════════════════════════════════════
  const composer = $('chatComposer'), composerInput = $('chatComposerInput');
  $('btnChat').onclick = () => {
    composer.hidden = false;
    controlsLocked = true;
    wakeControls(true);
    setTimeout(() => composerInput.focus(), 50); // let layout settle before opening keyboard
  };
  $('chatComposerClose').onclick = closeComposer;
  function closeComposer() {
    composer.hidden = true;
    composerInput.blur();
    controlsLocked = false;
    armHideTimer();
  }
  async function sendMovieChat() {
    const text = composerInput.value.trim();
    if (!text || !COUPLE_ID) return;
    composerInput.value = '';
    showChatBubble(ctx && ctx.myName ? ctx.myName : 'You', text, true);
    try {
      await chatApi('POST', '/api/chat', {
        coupleId: COUPLE_ID, clientId: 'wt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        senderRole: ROLE, type: 'text', text
      });
    } catch (e) { toast('Message failed to send.'); }
  }
  $('chatComposerSend').onclick = sendMovieChat;
  composerInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMovieChat(); });

  function showChatBubble(name, text, mine) {
    const layer = $('chatFloatLayer');
    const b = document.createElement('div');
    b.className = 'wt-chat-bubble' + (mine ? ' mine' : '');
    const nameEl = document.createElement('b'); nameEl.textContent = mine ? 'You' : name;
    const txtEl = document.createElement('div'); txtEl.textContent = text;
    b.appendChild(nameEl); b.appendChild(txtEl);
    layer.appendChild(b);
    // Cap visible bubbles so a burst of messages never becomes an
    // unreadable stack over the movie.
    while (layer.children.length > 3) layer.removeChild(layer.firstChild);
    setTimeout(() => { b.classList.add('fading'); setTimeout(() => b.remove(), 650); }, 4200);
    if (!mine) wakeControls();
  }

  function startChatPolling() {
    clearInterval(state.chatPollTimer);
    state.lastChatTs = new Date().toISOString(); // only show messages sent after entering watch mode
    state.chatPollTimer = setInterval(async () => {
      if (document.hidden || !COUPLE_ID) return;
      try {
        const q = state.lastChatTs ? '?after=' + encodeURIComponent(state.lastChatTs) : '?limit=5';
        const rows = await chatApi('GET', '/api/chat/' + COUPLE_ID + q);
        if (rows && rows.length) {
          rows.forEach(r => {
            state.lastChatTs = r.created_at;
            if (r.sender_role !== ROLE && r.type === 'text') showChatBubble(ctx && ctx.partnerName ? ctx.partnerName : 'Partner', r.text, false);
          });
        }
      } catch (e) {}
    }, 2500);
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 14 — End movie (with confirmation)
  // ═══════════════════════════════════════════════════════
  $('btnEndMovie').onclick = () => { $('endModalBackdrop').hidden = false; wakeControls(true); };
  $('btnCancelEnd').onclick = () => { $('endModalBackdrop').hidden = true; armHideTimer(); };
  $('btnConfirmEnd').onclick = async () => { $('endModalBackdrop').hidden = true; await endSession(); };
  $('btnExitWatching').onclick = () => { $('endModalBackdrop').hidden = false; wakeControls(true); };

  async function endSession() {
    hideBanner();
    try {
      const room = await api('POST', `/${COUPLE_ID}/end`, { role: ROLE, movieTitle: state.myTitle, durationSec: state.myDuration });
      broadcastRoom(room);
      state.room = room;
    } catch (e) {}

    // Full cleanup — spec §End Movie 1–10.
    clearAllTimers();
    els.video.pause();
    els.video.removeAttribute('src'); els.video.load();
    if (state.localObjectUrl) { URL.revokeObjectURL(state.localObjectUrl); state.localObjectUrl = null; }
    composer.hidden = true; controlsLocked = false;
    if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch (e) {} }
    try { screen.orientation && screen.orientation.unlock && screen.orientation.unlock(); } catch (e) {}

    state.myTitle = null; state.myDuration = null; state.localFile = null;
    showState('setup'); showSetupSub('empty');
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 15 — Partner presence / left-room handling
  // ═══════════════════════════════════════════════════════
  function updatePartnerPresenceUI() {
    if (state.uiState === 'watching') {
      setStatusPill(_presenceState.partnerOnline ? null : 'Partner reconnecting…', _presenceState.partnerOnline ? null : 'warn');
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

  // ═══════════════════════════════════════════════════════
  // SECTION 16 — Reconnect handling (network + app resume)
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
      if (state.uiState === 'watching') {
        const target = expectedPosition(room);
        if (Math.abs(els.video.currentTime - target) > 1) els.video.currentTime = target;
        if (room.playing) els.video.play().catch(() => {}); else els.video.pause();
        updatePlayPauseIcon();
      } else {
        renderFromRoom();
      }
      hideBanner();
    } catch (e) {
      state.reconnectPending = false;
      if (state.uiState === 'watching') showBanner('⚠️ Connection lost. Trying to reconnect…', []);
    }
  }
  window.addEventListener('online', reconcile);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reconcile(); });
  window.addEventListener('pageshow', reconcile);
  window.addEventListener('focus', reconcile);

  // ═══════════════════════════════════════════════════════
  // SECTION 17 — Boot
  // ═══════════════════════════════════════════════════════
  $('wtBack').onclick = () => { try { window.parent.postMessage({ type: 'uwl:close-watch-together' }, '*'); } catch (e) {} };

  (async function init() {
    if (!COUPLE_ID) { toast('Could not find your couple pairing.'); showState('setup'); showSetupSub('empty'); return; }
    setupRealtime();
    try {
      const room = await api('GET', `/${COUPLE_ID}`);
      state.room = room;
      if (room && room.action_seq) state.lastActionSeq = room.action_seq;
      renderFromRoom();
    } catch (e) { showState('setup'); showSetupSub('empty'); }
  })();

})();