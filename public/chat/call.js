/*public/chat/call.js*/

const Call = (function () {
  let pc, localStream, remoteStream, callType, isCaller = false;
  let timerInt, seconds = 0;
  let pollInterval;
  // ─── Watch Together bridge state ───
  // callContext tags whose PRESENTATION owns the current pc/localStream/
  // remoteStream: 'chat' renders the existing fullscreen ringing/incoming/
  // connected overlay + PiP exactly as before; 'watch_together' never
  // touches any of that — it connects directly and is presented entirely
  // by public/movie.js's own mini voice/video UI. Both contexts share this
  // ONE WebRTC engine (pc/localStream/remoteStream/callType) — there is no
  // second engine — mutual exclusion is enforced by the existing `if (pc)`
  // guards in startCall()/startWatchCall(), so only one call (of either
  // kind) can ever be in flight at a time.
  let callContext = 'chat';
  let watchSessionId = null;       // which movie session this device is currently inside
  let watchMediaSessionId = null;  // which specific voice/video call instance is active
  let watchMediaStartedAt = null;  // authoritative connect timestamp — the ONLY source for the WT call timer
  // Default false (earpiece) — matches how a real phone call starts.
  // setSinkId() below is kept for browsers where it works, but on Android
  // WebView it's a documented no-op for OS-level routing; the actual
  // routing there goes through the native CallAudio plugin (see
  // nativeCallAudio() below), which is the only thing that can reach
  // AudioManager.setSpeakerphoneOn().
  let isMuted = false, isCamOff = false, isSpeakerOn = false;

  // ─── Watch Together VOICE remote-audio sink ──────────────────────────
  // ROOT CAUSE of "connects but no two-way audio" for Watch Together
  // voice calls: pc.ontrack only ever bound remoteStream to
  // #callRemoteVideo / #callRemoteAudio — both of which only exist when
  // renderActive() builds the Chat page's fullscreen call overlay. For
  // callContext === 'watch_together', renderActive() is never called
  // (by design — presentation lives in movie.js's mini UI instead), so
  // for a VOICE call there was never any <audio>/<video> element at all
  // playing the partner's remote audio track back — the media was
  // negotiated and flowing over the wire, but nothing on either side was
  // ever asked to play it. (Video calls were unaffected because the
  // mini rectangle/bubble <video> elements in movie.js are never muted,
  // so they already play the remote audio track that rides alongside
  // the video track.) Fix: a small persistent, hidden, UNMUTED <audio>
  // element created once and reused for every watch voice call.
  let watchRemoteAudioEl = null;
  function ensureWatchRemoteAudio() {
    if (watchRemoteAudioEl && document.body.contains(watchRemoteAudioEl)) return watchRemoteAudioEl;
    const el = document.createElement('audio');
    el.id = 'watchCallRemoteAudio';
    el.autoplay = true;
    el.playsInline = true;
    el.muted = false; // the REMOTE side must never be muted — only local previews are
    el.style.display = 'none';
    document.body.appendChild(el);
    watchRemoteAudioEl = el;
    return el;
  }
  function detachWatchRemoteAudio() {
    if (!watchRemoteAudioEl) return;
    try { watchRemoteAudioEl.pause(); } catch (e) {}
    watchRemoteAudioEl.srcObject = null;
  }

  // ─── Native audio routing bridge (Capacitor CallAudio plugin) ───
  // No-ops harmlessly when not running inside the native app (e.g. plain
  // browser testing), since window.Capacitor won't exist there.
  function nativeCallAudio() {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CallAudio;
  }
  // ─── Native vibration bridge (Capacitor Haptics plugin) ───
  // navigator.vibrate() on the web is blocked by the browser until the
  // user has tapped the page/frame at least once — which an incoming call
  // alert, by definition, fires before any tap has happened. That's a
  // browser policy, not a bug, and it can't be "fixed" from the web API
  // side. Haptics.vibrate() is native code and isn't subject to that
  // restriction, so we use it when running inside the app and only fall
  // back to navigator.vibrate() (which may or may not be blocked) on web.
  function nativeVibrate(durationMs) {
    const h = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics;
    if (h && h.vibrate) { h.vibrate({ duration: durationMs }).catch(() => {}); return true; }
    return false;
  }
  let _ringVibrateTimeouts = [];
  function ringVibrate() {
    // Reproduces the buzz/pause/buzz/pause/buzz pattern natively when
    // possible; on native, Haptics.vibrate() takes one duration per call,
    // so the pattern is replayed as timed calls instead of a single array.
    const pattern = [300, 150, 300, 150, 500]; // vibrate, pause, vibrate, pause, vibrate
    if (nativeVibrate(pattern[0])) {
      let t = pattern[0];
      for (let i = 1; i < pattern.length; i += 2) {
        t += pattern[i];
        const dur = pattern[i + 1];
        if (dur == null) break;
        _ringVibrateTimeouts.push(setTimeout(() => nativeVibrate(dur), t));
        t += dur;
      }
    } else if (navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  }
  function stopRingVibrate() {
    _ringVibrateTimeouts.forEach(clearTimeout);
    _ringVibrateTimeouts = [];
  }
  function setRingingAudio() {
    nativeCallAudio()?.setRinging().catch(() => {});
  }
  function setConnectedAudio() {
    nativeCallAudio()?.setConnected({ speakerOn: isSpeakerOn }).catch(() => {});
  }
  function setSpeakerAudio() {
    nativeCallAudio()?.setSpeaker({ speakerOn: isSpeakerOn }).catch(() => {});
  }
  function releaseCallAudio() {
    nativeCallAudio()?.release().catch(() => {});
  }

  // ─── Centralized incoming-call notification cleanup ─────────────────
  // Single choke point for cancelling the Android "incoming-call" system
  // notification (see NotificationActionReceiver.java / TwinHeartsMessagingService
  // showIncomingCall(), tag="incoming-call"). Called from cleanup() below,
  // which already runs on every path that ends a call's "ringing/incoming"
  // state — app Answer, app Decline, notification Answer (once acceptCall()
  // completes), caller-cancel, timeout, and call end — so this one call
  // site covers the whole notification lifecycle instead of scattering
  // cancel calls across every one of those individual handlers.
  function cancelIncomingCallNotification() {
    nativeCallAudio()?.cancelIncomingCall?.().catch(() => {});
  }
  let isMinimized = false, pipEl = null, pipDrag = null;
  let signalInterval = null;
  let videoUpgradePending = false;
  let ringTimeout = null;
  function clearRingTimeout() { if (ringTimeout) clearTimeout(ringTimeout); ringTimeout = null; }

  // ─── Ringtone / ringback engine ───────────────────────────────
  // Tries a real audio file first (drop your own ringtone at these paths),
  // and falls back to a synthesized WebAudio tone if the file is missing —
  // so it always works even with no assets in the repo.
  const RINGTONE_FILE = '/sounds/ringtone.mp3';   // incoming call
  const RINGBACK_FILE = '/sounds/ringback.mp3';   // outgoing call ("Calling...")
  let ringFileEl = null, vibrateTimer = null, usingNativeRingtone = false;
  let ringAudioCtx = null, ringGain = null, ringLoopTimer = null;
  function ensureRingCtx() {
    if (!ringAudioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ringAudioCtx = new AC();
    }
    if (ringAudioCtx.state === 'suspended') ringAudioCtx.resume().catch(() => {});
    return ringAudioCtx;
  }
  function playTone(ctx, freq, start, dur, vol) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(vol, start + 0.03);
    gain.gain.setValueAtTime(vol, start + dur - 0.05);
    gain.gain.linearRampToValueAtTime(0, start + dur);
    osc.connect(gain).connect(ringGain || ctx.destination);
    osc.start(start); osc.stop(start + dur);
  }
  function startSynthTone(kind) {
    if (ringLoopTimer) return; // already running — never start a second overlapping interval
    const ctx = ensureRingCtx();
    if (!ctx) return;
    ringGain = ctx.createGain();
    ringGain.gain.value = kind === 'incoming' ? 0.16 : 0.08;
    ringGain.connect(ctx.destination);
    const cycle = () => {
      if (!ringGain) { if (ringLoopTimer) { clearInterval(ringLoopTimer); ringLoopTimer = null; } return; }
      const t = ctx.currentTime;
      if (kind === 'incoming') {
        playTone(ctx, 440, t, 0.4, ringGain.gain.value);
        playTone(ctx, 480, t, 0.4, ringGain.gain.value);
        playTone(ctx, 440, t + 0.6, 0.4, ringGain.gain.value);
        playTone(ctx, 480, t + 0.6, 0.4, ringGain.gain.value);
      } else {
        playTone(ctx, 480, t, 1.0, ringGain.gain.value);
      }
    };
    cycle();
    ringLoopTimer = setInterval(cycle, kind === 'incoming' ? 2000 : 3000);
  }
  function startRingtone(kind) {
    stopRingtone();
    // Incoming calls: prefer the native ringtone when running inside the
    // app — it plays through Android's own audio layer, outside the
    // WebView, so it isn't blocked by autoplay policy even on a cold app
    // open with zero prior taps. Falls through to the web audio path
    // below too, harmlessly, in case the native call fails for any reason.
    if (kind === 'incoming' && nativeCallAudio()?.playRingtone) {
      nativeCallAudio().playRingtone().catch(() => {});
      usingNativeRingtone = true;
    } else {
      usingNativeRingtone = false;
    }
    const file = kind === 'incoming' ? RINGTONE_FILE : RINGBACK_FILE;
    ringFileEl = new Audio(file);
    ringFileEl.loop = true;
    ringFileEl.volume = kind === 'incoming' ? 0.9 : 0.5;
    const playPromise = ringFileEl.play();
    if (playPromise && playPromise.then) {
      playPromise.then(() => {}).catch(() => {
        ringFileEl = null;
        startSynthTone(kind); // guarded by the ringLoopTimer check above — safe even if 'error' also fires
      });
    }
    // If the file 404s / errors, ditch it and use the synthesized tone instead
    ringFileEl.addEventListener('error', () => {
      if (ringFileEl) { ringFileEl = null; }
      startSynthTone(kind); // guarded internally — won't double-start if the .catch() above already did
    }, { once: true });
    if (kind === 'incoming') {
      ringVibrate();
      vibrateTimer = setInterval(ringVibrate, 2000);
    }
  }
  function stopRingtone() {
    if (usingNativeRingtone) { nativeCallAudio()?.stopRingtone().catch(() => {}); usingNativeRingtone = false; }
    if (ringFileEl) { try { ringFileEl.pause(); ringFileEl.currentTime = 0; } catch (e) {} ringFileEl = null; }
    if (ringLoopTimer) { clearInterval(ringLoopTimer); ringLoopTimer = null; }
    if (vibrateTimer) { clearInterval(vibrateTimer); vibrateTimer = null; }
    stopRingVibrate();
    if (navigator.vibrate) navigator.vibrate(0);
    if (ringGain) {
      try { ringGain.gain.linearRampToValueAtTime(0, (ringAudioCtx?.currentTime || 0) + 0.15); } catch (e) {}
      ringGain = null;
    }
  }

  function coupleId() { return window.S && window.S.coupleId; }
  function myRole() { return window.S && window.S.role; }
  function otherRole() { return myRole() === 'user1' ? 'user2' : 'user1'; }

  async function getIceServers() {
    try {
      const r = await fetch(API + '/api/call/turn-creds');
      const d = await r.json();
      return d.iceServers && d.iceServers.length ? d.iceServers : [{ urls: 'stun:stun.l.google.com:19302' }];
    } catch (e) { return [{ urls: 'stun:stun.l.google.com:19302' }]; }
  }

  async function pushSignal(msg) {
    if (!coupleId()) { toast('⚠️ Not connected to partner'); return; }
    try {
      const r = await fetch(API + '/api/call/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coupleId: coupleId(), role: myRole(), payload: msg })
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        console.error('Signal push failed:', err);
        toast('⚠️ Call signal failed: ' + (err.error || r.status));
      } else if (_callSignalChannel) {
        try { _callSignalChannel.send({ type: 'broadcast', event: 'signal_ping', payload: {} }); } catch (e) {}
      }
    } catch (e) { console.error('Signal push error:', e); toast('⚠️ Network error during call setup'); }
  }

  // ── Realtime wake-trigger for signaling ──────────────────────────────
  // Purely additive: on a broadcast ping it fires pollSignal() immediately,
  // which still goes through the existing after=lastSignalId DB cursor —
  // so delivery order/dedup is completely unchanged, it just arrives sooner
  // than the next 500ms/2s poll tick. startPolling() below is left fully
  // intact as the safety net; this channel is opened once and kept alive
  // for the same reason the idle poll loop is never killed (see cleanup()) —
  // it's what catches the *next* incoming call.
  let _callSb = null, _callSignalChannel = null;
  function _getCallSupabase() {
    if (_callSb) return _callSb;
    try {
      if (window.__SHARED_SB__) { _callSb = window.__SHARED_SB__; return _callSb; }
      if (window.supabase && window.supabase.createClient && window.__SUPABASE_URL__ && window.__SUPABASE_ANON_KEY__) {
        _callSb = window.supabase.createClient(window.__SUPABASE_URL__, window.__SUPABASE_ANON_KEY__);
      }
    } catch (e) { console.warn('Call Supabase init failed', e); }
    return _callSb;
  }
  function setupCallSignalRealtime() {
    if (_callSignalChannel || !coupleId()) return;
    const sb = _getCallSupabase();
    if (!sb) return;
    try {
      _callSignalChannel = sb.channel('call_signal:' + coupleId(), { config: { broadcast: { self: false } } })
        .on('broadcast', { event: 'signal_ping' }, () => { pollSignal(); })
        .subscribe();
    } catch (e) { console.warn('Call signal realtime channel failed', e); _callSignalChannel = null; }
  }
  window.addEventListener('pagehide', () => {
    if (_callSignalChannel && _callSb) {
      try { _callSb.removeChannel(_callSignalChannel); } catch (e) {}
    }
    _callSignalChannel = null;
  });
async function initSignalCursor() {
    // window.S.coupleId is populated asynchronously after auth completes,
    // but this used to fire straight off DOMContentLoaded — so on a fresh
    // load it ran against a null coupleId, silently 404'd, and left
    // lastSignalId stuck at 0. Every OLD signal row (offers/declines/ends
    // from long-past test calls) then got treated as "new" once polling
    // began, which is what produced a phantom instant "Call declined" on
    // the very first real call. Wait for coupleId to actually exist first.
    for (let i = 0; i < 40 && !coupleId(); i++) {
      await new Promise(res => setTimeout(res, 250));
    }
    if (!coupleId()) return; // gave up after 10s — pollSignal() will no-op until it appears
    try {
      const r = await fetch(API + '/api/call/signal/' + coupleId() + '?role=' + otherRole(), { cache: 'no-store' });
      if (!r.ok) return;
      const rows = await r.json();
      if (rows.length) lastSignalId = Math.max(...rows.map(x => x.id));
    } catch (e) {}
  }
  let lastSignalId = 0;
  async function pollSignal() {
    if (!coupleId()) return;
    try {
      const r = await fetch(API + '/api/call/signal/' + coupleId() + '?role=' + otherRole() + '&after=' + lastSignalId, { cache: 'no-store' });
      if (!r.ok) return;
      const rows = await r.json();
      if (!rows.length) return;
      lastSignalId = Math.max(...rows.map(x => x.id));
      for (const row of rows) await handleSignal(row.payload);
    } catch (e) {}
  }

  let iceQueue = [];
  // Exactly one call_log row per call attempt. Previously both sides could
  // log independently (caller's no-answer timeout + callee's own timeout +
  // the 'end' signal handler unconditionally logging 'ended' even when no
  // call had ever connected), stacking up many duplicate/incorrect entries
  // in chat for a single call attempt — especially once a shaky connection
  // caused several retries. This flag makes every logging call a no-op
  // after the first one for the current call.
  let callLogged = false;
  function logCallOnce(status, duration) {
    if (callLogged) return;
    callLogged = true;
    logCall(status, duration);
  }

  async function handleSignal(m) {
    // In-game "face to face" video (Games page) reuses this same signal
    // table but is tagged with gameCtx and has its own compact accept/
    // decline card + side-by-side UI — it must never trigger the
    // full-screen call overlay here.
    if (m && m.gameCtx) return;

    // ─── Watch Together signals: NEVER touch the Chat fullscreen UI ───
    // These are routed entirely through the watch-specific handlers,
    // which validate the sender's watchSessionId against OUR currently
    // registered session (see registerWatchSession()) before doing
    // anything — a stale or foreign-session signal is silently ignored
    // instead of ever being able to auto-open a mic/camera.
    const isWatch = m && m.context === 'watch_together';
    if (isWatch) {
      if (m.type === 'offer') { await handleWatchOffer(m); return; }
      if (m.type === 'answer' && pc && callContext === 'watch_together') {
        if (m.watchSessionId !== watchSessionId || m.mediaSessionId !== watchMediaSessionId) return;
        await pc.setRemoteDescription(new RTCSessionDescription(m.sdp));
        for (const cand of iceQueue) { try { await pc.addIceCandidate(cand); } catch (e) {} }
        iceQueue = [];
        return;
      }
      if (m.type === 'end') { if (m.watchSessionId === watchSessionId) cleanupWatchCall(); return; }
      if (m.type === 'watch-upgrade-offer') { await handleWatchUpgradeOffer(m); return; }
      if (m.type === 'watch-upgrade-answer') { await handleWatchUpgradeAnswer(m); return; }
      return; // unknown watch-tagged signal — ignore rather than guess
    }

    if (m.type === 'offer' && !pc) {
      if (m.ts && Date.now() - m.ts > 45000) return; // ignore stale offers
      showIncoming(m);
    }
    else if (m.type === 'answer' && pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(m.sdp));
      onConnecting();
      for (const cand of iceQueue) { try { await pc.addIceCandidate(cand); } catch (e) {} }
      iceQueue = [];
    }
    else if (m.type === 'ice') {
      // A ice candidate belonging to an ACTIVE WATCH call must be routed
      // to the shared pc too (both contexts share the one RTCPeerConnection),
      // regardless of which context originally created it — ICE messages
      // carry no context tag by design (spec keeps them minimal), so this
      // always just feeds whichever pc/iceQueue currently exists.
      if (pc && pc.remoteDescription) {
        try { await pc.addIceCandidate(m.candidate); } catch (e) {}
      } else {
        iceQueue.push(m.candidate);
      }
    }
    else if (m.type === 'end') {
      // Only a call that actually reached setupPeer() (pc exists) counts
      // as "ended" — if pc was never created, this device was still
      // ringing/idle and the attempt is already covered by a 'missed'
      // log from whichever side's timeout fires, via the guard above.
      if (pc) endCall(false); else cleanup();
    }
    else if (m.type === 'decline') { toast('Call declined'); cleanup(); logCallOnce('declined'); }
    else if (m.type === 'video-upgrade-request') { showUpgradeRequestBanner(); }
    else if (m.type === 'video-upgrade-accept') { sendUpgradeOffer(); }
    else if (m.type === 'video-upgrade-decline') { toast('Partner declined video'); videoUpgradePending = false; }
    else if (m.type === 'video-upgrade-offer') { await handleUpgradeOffer(m); }
    else if (m.type === 'video-upgrade-answer') { await handleUpgradeAnswer(m); }
  }

  function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    let _tick = 0;
    pollInterval = setInterval(() => {
      _tick++;
      // Full 500ms speed only while a call is actually connecting/active
      // (pc exists) — that's when ICE/signaling needs low latency.
      // Idle (no call), just check every 4th tick (~2s) to catch an
      // incoming offer quickly enough for a responsive ring, without
      // hammering the endpoint 24/7. Deliberately NOT gated on
      // document.hidden — some mobile browsers report the page as hidden
      // even while it's the actual foreground tab, which was silently
      // blocking incoming-call detection on those devices.
      if (pc || _tick % 4 === 0) pollSignal();
    }, 500);
    pollSignal(); // fire immediately, don't wait for first tick
  }

  // ─── UI overlay — always fully removed before creating new one ──────
  function ensureOverlay() {
    document.querySelectorAll('#callOverlay').forEach(el => el.remove()); // kill any stale duplicates
    const el = document.createElement('div');
    el.id = 'callOverlay';
    el.className = 'call-overlay';
    document.body.appendChild(el);
    return el;
  }
  function closeOverlay() {
    document.querySelectorAll('#callOverlay').forEach(el => { el.classList.remove('open'); el.remove(); });
  }

  function avatarHtml(name, av) {
    return av
      ? `<img src="${av}" style="width:100%;height:100%;object-fit:cover;object-position:center;border-radius:50%" onerror="this.remove()">`
      : (name[0] || 'P').toUpperCase();
  }

  // ─── Shared icon + labeled-control-button helpers ──────────────────
  // Every call screen (outgoing, incoming, connected) renders its buttons
  // through this one path, using the app's existing Lucide icon set
  // (already loaded globally — see /ui-icons.js) instead of emoji. Icons
  // are re-rendered explicitly via lucide.createIcons() right after the
  // HTML is injected, rather than relying on ui-icons.js's debounced
  // MutationObserver, so a button never flashes empty on first paint.
  function icoHTML(name) { return `<i data-lucide="${name}"></i>`; }
  function renderIcons() { window.lucide && window.lucide.createIcons(); }

  function ctrlBtn({ id, icon, label, onclick, active = false, disabled = false, variant = 'sm' }) {
    const shapeCls = variant === 'end' ? 'call-btn-end' : variant === 'decline' ? 'call-btn-decline'
      : variant === 'accept' ? 'call-btn-accept' : 'call-btn-sm';
    return `<div class="ccp-item">
      <button type="button" class="call-btn ${shapeCls}${active ? ' call-btn-active' : ''}" id="${id}Btn"
        ${disabled ? 'disabled' : ''} aria-pressed="${active}" aria-label="${label}" title="${label}"
        onclick="${onclick}">
        <span class="call-ico-wrap" id="${id}Icon">${icoHTML(icon)}</span>
      </button>
      <span class="ccp-label">${label}</span>
    </div>`;
  }

  function signalBarsHtml(level) {
    // level: 3 good, 2 weak, 1 poor
    const cls = level === 3 ? '' : level === 2 ? 'weak' : 'poor';
    let bars = '';
    for (let i = 1; i <= 4; i++) bars += `<span class="${i <= level + 1 ? 'active' : ''}"></span>`;
    return `<div class="call-signal-bars ${cls}" id="callSignalBars">${bars}</div>`;
  }

  function topbarHtml() {
    return `
      <div class="call-topbar-full">
        <button type="button" class="call-topbar-btn" onclick="Call.minimize()" title="Minimize" aria-label="Minimize call">${icoHTML('chevron-down')}</button>
        <div class="call-topbar-title">
          <div class="call-topbar-name">${esc(window.S.partnerName || 'Partner')}</div>
          <div class="call-topbar-sub">${icoHTML('lock')} <span id="callTopSub">End-to-end encrypted</span></div>
        </div>
        <div class="call-topbar-right">
          ${callType === 'video' && !document.getElementById('page-map')?.classList.contains('active')
            ? `<button type="button" class="call-topbar-btn" onclick="Call.openMap()" title="Open Live Map" aria-label="Open Live Map">${icoHTML('map')}</button>`
            : ''}
          <div class="call-topbar-btn call-topbar-signal" title="Signal quality" aria-hidden="true">${signalBarsHtml(3)}</div>
        </div>
      </div>`;
  }

  async function pollSignalQuality() {
    if (!pc) return;
    try {
      const stats = await pc.getStats();
      let rtt = null, loss = null;
      stats.forEach(r => {
        if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.currentRoundTripTime != null) {
          rtt = r.currentRoundTripTime;
        }
        if (r.type === 'inbound-rtp' && r.packetsLost != null && r.packetsReceived) {
          loss = r.packetsLost / (r.packetsLost + r.packetsReceived);
        }
      });
      let level = 3;
      if ((rtt != null && rtt > 0.35) || (loss != null && loss > 0.08)) level = 1;
      else if ((rtt != null && rtt > 0.15) || (loss != null && loss > 0.03)) level = 2;
      document.querySelectorAll('#callSignalBars, .call-pip .call-signal-bars').forEach(el => {
        el.className = 'call-signal-bars' + (level === 2 ? ' weak' : level === 1 ? ' poor' : '');
        el.innerHTML = signalBarsHtml(level).match(/<span.*?<\/span>/g)?.join('') || '';
      });
      const sub = document.getElementById('callTopSub');
      if (sub) sub.textContent = level === 1 ? 'Poor connection' : level === 2 ? 'Weak connection' : 'End-to-end encrypted';
    } catch (e) {}
  }
  function startSignalMonitor() {
    stopSignalMonitor();
    signalInterval = setInterval(pollSignalQuality, 3000);
  }
  function stopSignalMonitor() {
    if (signalInterval) clearInterval(signalInterval);
    signalInterval = null;
  }

  function renderRinging(type, incoming) {
    startRingtone(incoming ? 'incoming' : 'outgoing');
    setRingingAudio();
    const el = ensureOverlay();
    el.classList.remove('call-active-video');
    const name = window.S.partnerName || 'Partner';
    const av = window.S.partnerAvatar;

    el.innerHTML = `
      <div class="call-bg-blur"${av ? ` style="background-image:url('${av}')"` : ''}></div>
      <div class="call-bg-scrim"></div>
      ${topbarHtml()}
      <div class="call-content">
        <div class="call-status-label">${incoming ? (type === 'video' ? 'Incoming video call' : 'Incoming voice call') : 'Calling...'}</div>
        <div class="call-avatar-ring pulse">
          <div class="call-avatar">${avatarHtml(name, av)}</div>
        </div>
        <div class="call-partner-name">${esc(name)}</div>
        <div class="call-sub">${icoHTML(type === 'video' ? 'video' : 'mic')} ${type === 'video' ? 'Video call' : 'Voice call'}</div>
      </div>
      <div id="callMoreMenuHost"></div>
      ${incoming ? `
        <div class="call-controls call-controls-incoming" style="margin-bottom:max(40px, env(safe-area-inset-bottom))">
          ${ctrlBtn({ id: 'decline', icon: 'phone', label: 'Decline', onclick: 'Call.declineCall()', variant: 'decline' })}
          ${ctrlBtn({ id: 'accept', icon: type === 'video' ? 'video' : 'phone', label: 'Accept', onclick: 'Call.acceptCall()', variant: 'accept' })}
        </div>
      ` : outgoingControlsHtml()}`;
    renderIcons();
    // force layout + open on next frame so opacity transition + pointer-events actually apply
    requestAnimationFrame(() => el.classList.add('open'));
  }

  // ─── Outgoing (ringing) call controls ───────────────────────────────
  // Available immediately, before the partner answers — matching the
  // "controls already visible while ringing" requirement. Mute needs the
  // local mic stream (grabbed a beat after this renders — see startCall(),
  // which flips muteBtn back on as soon as it resolves) and Video needs an
  // active peer connection to negotiate an upgrade through (there isn't
  // one yet during ringing), so those two start disabled rather than
  // pretending to work. Speaker and More work immediately.
  function outgoingControlsHtml() {
    const items = [
      ctrlBtn({ id: 'more', icon: 'more-horizontal', label: 'More', onclick: 'Call.toggleMoreMenu()' }),
      ctrlBtn({ id: 'speaker', icon: isSpeakerOn ? 'volume-2' : 'volume-1', label: 'Speaker', onclick: 'Call.toggleSpeaker()', active: isSpeakerOn }),
      ctrlBtn({ id: 'cam', icon: 'video', label: 'Video', onclick: 'Call.toggleCam()', disabled: true }),
      ctrlBtn({ id: 'mute', icon: isMuted ? 'mic-off' : 'mic', label: 'Mute', onclick: 'Call.toggleMute()', active: isMuted, disabled: true }),
    ];
    return `<div class="call-control-panel" id="callControlsBar">
      <div class="ccp-row">${items.join('')}</div>
      <div class="ccp-item ccp-end-item">
        <button type="button" class="call-btn call-btn-end" onclick="Call.endCall()" aria-label="End call" title="End call">
          <span class="call-ico-wrap">${icoHTML('phone')}</span>
        </button>
        <span class="ccp-label">End</span>
      </div>
    </div>`;
  }

  function renderActive() {
    stopRingtone();
    const el = ensureOverlay();
    el.classList.add('open');
    const name = window.S.partnerName || 'Partner';
    if (callType === 'video') {
      el.classList.add('call-active-video');
      el.innerHTML = `
        ${topbarHtml()}
        <video id="callRemoteVideo" class="call-remote-video" autoplay playsinline></video>
        <video id="callLocalVideo" class="call-local-video" autoplay playsinline muted></video>
        <div id="callMoreMenuHost"></div>
        ${controlsHtml(true)}`;
      renderIcons();
      document.getElementById('callRemoteVideo').srcObject = remoteStream;
      document.getElementById('callLocalVideo').srcObject = localStream;
      startAutoHide(el);
    } else {
      el.classList.remove('call-active-video');
      const av = window.S.partnerAvatar;
      el.innerHTML = `
        <div class="call-bg-blur"${av ? ` style="background-image:url('${av}')"` : ''}></div>
        <div class="call-bg-scrim"></div>
        ${topbarHtml()}
        <div class="call-content">
          <div class="call-status-label">Connected</div>
          <div class="call-avatar-ring connected"><div class="call-avatar">${avatarHtml(name, av)}</div></div>
          <div class="call-partner-name">${esc(name)}</div>
          <div class="call-sub" id="callTimer">00:00</div>
        </div>
        <div id="callMoreMenuHost"></div>
        ${controlsHtml(false)}`;
      renderIcons();
      const remoteAudio = document.createElement('audio');
      remoteAudio.id = 'callRemoteAudio'; remoteAudio.autoplay = true; remoteAudio.srcObject = remoteStream;
      el.appendChild(remoteAudio);
    }
    startTimer();
    startSignalMonitor();
  }

  function controlsHtml(video) {
    // Premium control-panel card: a row of labeled toggle buttons (More,
    // then either Flip-camera-on-video or Video-upgrade-on-voice, then
    // Speaker, Mute), with the red End button standing alone underneath —
    // same structure as the outgoing-ringing panel above, so the screen
    // never jumps to an unrelated layout when the call connects.
    const items = [
      ctrlBtn({ id: 'more', icon: 'more-horizontal', label: 'More', onclick: 'Call.toggleMoreMenu()' }),
      video
        ? ctrlBtn({ id: 'flip', icon: 'refresh-ccw', label: 'Flip', onclick: 'Call.flipCamera()' })
        : ctrlBtn({ id: 'cam', icon: isCamOff ? 'video-off' : 'video', label: 'Video', onclick: 'Call.toggleCam()', active: isCamOff }),
      ctrlBtn({ id: 'speaker', icon: isSpeakerOn ? 'volume-2' : 'volume-1', label: 'Speaker', onclick: 'Call.toggleSpeaker()', active: isSpeakerOn }),
      ctrlBtn({ id: 'mute', icon: isMuted ? 'mic-off' : 'mic', label: 'Mute', onclick: 'Call.toggleMute()', active: isMuted }),
    ];
    return `<div class="call-control-panel${video ? ' ccp-video call-controls-active' : ''}" id="callControlsBar">
      <div class="ccp-row">${items.join('')}</div>
      <div class="ccp-item ccp-end-item">
        <button type="button" class="call-btn call-btn-end" onclick="Call.endCall()" aria-label="End call" title="End call">
          <span class="call-ico-wrap">${icoHTML('phone')}</span>
        </button>
        <span class="ccp-label">End</span>
      </div>
    </div>`;
  }

  // Swaps the icon inside a ctrlBtn's wrapper span and keeps its button's
  // active/pressed state in sync — the one place all toggle handlers below
  // update the DOM, so every button (ringing panel or connected panel)
  // reflects state changes identically regardless of which screen is up.
  function setBtnState(id, icon, active) {
    const wrap = document.getElementById(id + 'Icon');
    if (wrap) { wrap.innerHTML = icoHTML(icon); renderIcons(); }
    const btn = document.getElementById(id + 'Btn');
    if (btn) { btn.classList.toggle('call-btn-active', !!active); btn.setAttribute('aria-pressed', !!active); }
  }

  function toggleMute() {
    if (!localStream) return;
    const track = localStream.getAudioTracks()[0];
    if (!track) return;
    isMuted = !isMuted;
    window.playAppSound?.(isMuted ? 'call.muted' : 'call.unmuted');
    track.enabled = !isMuted;
    setBtnState('mute', isMuted ? 'mic-off' : 'mic', isMuted);
    if (pipEl) {
      const existing = pipEl.querySelector('.call-pip-mic-off');
      if (isMuted && !existing) pipEl.insertAdjacentHTML('beforeend', `<div class="call-pip-mic-off">${icoHTML('mic-off')}</div>`);
      if (!isMuted && existing) existing.remove();
      renderIcons();
    }
  }

  function toggleCam() {
    if (!localStream) return;
    const track = localStream.getVideoTracks()[0];
    if (!track) { requestVideoUpgrade(); return; }
    isCamOff = !isCamOff;
    window.playAppSound?.(isCamOff ? 'call.camera.off' : 'call.camera.on');
    track.enabled = !isCamOff;
    setBtnState('cam', isCamOff ? 'video-off' : 'video', isCamOff);
    const localVid = document.getElementById('callLocalVideo');
    if (localVid) localVid.style.opacity = isCamOff ? '0.25' : '1';
  }

  function toggleSpeaker() {
    isSpeakerOn = !isSpeakerOn;
    window.playAppSound?.(isSpeakerOn ? 'call.speaker.on' : 'call.speaker.off');
    // Highlighted when speaker is ON (matches Mute's "highlighted = active"
    // convention) — previously inverted, so Speaker looked highlighted
    // while OFF instead of ON.
    setBtnState('speaker', isSpeakerOn ? 'volume-2' : 'volume-1', isSpeakerOn);
    const audioEl = document.getElementById('callRemoteAudio') || (callContext === 'watch_together' ? watchRemoteAudioEl : null);
    if (audioEl && audioEl.setSinkId) {
      audioEl.setSinkId(isSpeakerOn ? 'default' : 'communications').catch(() => {});
    }
    setSpeakerAudio();
  }

  async function flipCamera() {
    if (!localStream) return;
    const track = localStream.getVideoTracks()[0];
    if (!track) return;
    const btn = document.getElementById('flipBtn');
    if (btn) btn.disabled = true;
    const cur = track.getSettings().facingMode;
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: cur === 'user' ? 'environment' : 'user' }, audio: false
      });
      const newTrack = newStream.getVideoTracks()[0];
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) await sender.replaceTrack(newTrack);
      track.stop();
      localStream.removeTrack(track);
      localStream.addTrack(newTrack);
      const localVid = document.getElementById('callLocalVideo');
      if (localVid) localVid.srcObject = localStream;
    } catch (e) { toast('Could not flip camera'); }
    if (btn) btn.disabled = false;
  }

  // ─── More menu ───
  // ─── Auto-hide controls (video calls): tap to show, fades after 4s ───
  let autoHideTimer = null;
  function stopAutoHide() {
    if (autoHideTimer) { clearTimeout(autoHideTimer); autoHideTimer = null; }
    const el = document.getElementById('callOverlay');
    if (el) el.removeEventListener('click', onOverlayTap);
  }
  function scheduleHide() {
    if (autoHideTimer) clearTimeout(autoHideTimer);
    autoHideTimer = setTimeout(() => {
      document.getElementById('callControlsBar')?.classList.add('controls-hidden');
      document.querySelector('.call-topbar-full')?.classList.add('controls-hidden');
    }, 4000);
  }
  function onOverlayTap(e) {
    if (e.target.closest('.call-btn, .call-more-menu, .call-upgrade-banner')) return; // don't fight real taps
    const bar = document.getElementById('callControlsBar');
    const top = document.querySelector('.call-topbar-full');
    const hidden = bar?.classList.contains('controls-hidden');
    bar?.classList.toggle('controls-hidden', !hidden ? true : false);
    if (hidden) { bar?.classList.remove('controls-hidden'); top?.classList.remove('controls-hidden'); scheduleHide(); }
    else { bar?.classList.add('controls-hidden'); top?.classList.add('controls-hidden'); }
  }
  function startAutoHide(el) {
    el.addEventListener('click', onOverlayTap);
    scheduleHide();
  }

  function toggleMoreMenu() {
    const host = document.getElementById('callMoreMenuHost');
    if (!host) return;
    if (host.querySelector('.call-more-menu')) { host.innerHTML = ''; return; }
    host.innerHTML = `
      <div class="call-more-backdrop" onclick="Call.toggleMoreMenu()"></div>
      <div class="call-more-menu">
        <button type="button" onclick="Call.openChatDuringCall()">${icoHTML('message-circle')} Open chat</button>
        <button type="button" onclick="Call.toggleMoreMenu(); Call.minimize()">${icoHTML('chevron-down')} Minimize call</button>
      </div>`;
    renderIcons();
  }
  function openChatDuringCall() {
    toggleMoreMenu();
    minimize();
    // chat UI is already the underlying screen in this app, so nothing else to route
  }

  // ─── Issue 3 fix: let either side of a video call jump to Live Map ───
  // Previously only whoever happened to already be on the map page got
  // the docked map+call split view (livemap-redesign.js docks the call
  // automatically whenever the map page is active during a call). The
  // other party had no way to get there. This just calls the app's normal
  // page navigation, which triggers that same auto-dock behavior for them
  // too, then re-renders the topbar so the button hides once it's not needed.
  function openMap() {
    if (typeof window.goto === 'function') window.goto('map');
    const topbar = document.querySelector('#callOverlay .call-topbar-full');
    if (topbar) topbar.outerHTML = topbarHtml();
  }

  // ─── Minimize to PiP bubble ───
  function minimize() {
    if (isMinimized) return;
    isMinimized = true;
    const overlay = document.getElementById('callOverlay');
    if (overlay) overlay.classList.remove('open');
    const name = window.S.partnerName || 'Partner';
    const av = window.S.partnerAvatar;
    pipEl = document.createElement('div');
    pipEl.id = 'callPip';
    pipEl.className = 'call-pip';
    pipEl.style.bottom = '110px';
    pipEl.style.right = '16px';
    pipEl.innerHTML = callType === 'video' && remoteStream
      ? `<video autoplay playsinline muted id="pipVideo"></video>`
      : (av ? `<img class="call-pip-static" src="${av}">` : `<div class="call-pip-avatar-fallback">${(name[0] || 'P')}</div>`);
    if (isMuted) pipEl.insertAdjacentHTML('beforeend', `<div class="call-pip-mic-off">${icoHTML('mic-off')}</div>`);
    pipEl.insertAdjacentHTML('beforeend', `<div class="call-pip-timer" id="pipTimer">00:00</div>`);
    pipEl.onclick = (e) => { if (!pipDrag || !pipDrag.moved) restore(); };
    document.body.appendChild(pipEl);
    renderIcons();
    if (callType === 'video' && remoteStream) {
      const v = document.getElementById('pipVideo');
      if (v) v.srcObject = remoteStream;
    }
    enablePipDrag(pipEl);
  }
  function restore() {
    if (!isMinimized) return;
    isMinimized = false;
    if (pipEl) { pipEl.remove(); pipEl = null; }
    const overlay = document.getElementById('callOverlay');
    if (overlay) overlay.classList.add('open');
    else if (pc) renderActive(); // safety net if overlay got dropped
  }
  function enablePipDrag(el) {
    let sx, sy, startBottom, startRight;
    const onDown = (e) => {
      const t = e.touches ? e.touches[0] : e;
      sx = t.clientX; sy = t.clientY;
      startBottom = parseInt(el.style.bottom) || 110;
      startRight = parseInt(el.style.right) || 16;
      pipDrag = { moved: false };
      document.addEventListener('mousemove', onMove); document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('mouseup', onUp); document.addEventListener('touchend', onUp);
    };
    const onMove = (e) => {
      const t = e.touches ? e.touches[0] : e;
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) { pipDrag.moved = true; if (e.cancelable) e.preventDefault(); }
      el.style.right = Math.max(4, startRight - dx) + 'px';
      el.style.bottom = Math.max(4, startBottom - dy) + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove); document.removeEventListener('touchmove', onMove);
      document.removeEventListener('mouseup', onUp); document.removeEventListener('touchend', onUp);
      setTimeout(() => { if (pipDrag) pipDrag.moved = false; }, 50);
    };
    el.addEventListener('mousedown', onDown);
    el.addEventListener('touchstart', onDown, { passive: true });
  }

  // ─── Mid-call video upgrade ───
  function requestVideoUpgrade() {
    if (!pc || callType === 'video' || videoUpgradePending) return;
    videoUpgradePending = true;
    pushSignal({ type: 'video-upgrade-request' });
    toast('Asking your partner to turn on video...');
    const btn = document.getElementById('camBtn');
    if (btn) btn.disabled = true;
  }

  function showUpgradeRequestBanner() {
    const el = document.getElementById('callOverlay');
    if (!el) return;
    document.getElementById('videoUpgradeBanner')?.remove();
    const b = document.createElement('div');
    b.id = 'videoUpgradeBanner';
    b.className = 'call-upgrade-banner';
    b.innerHTML = `
      <span>${icoHTML('video')} Your partner wants to turn on video</span>
      <div class="call-upgrade-actions">
        <button type="button" onclick="Call.declineVideoUpgrade()">Not now</button>
        <button type="button" class="accept" onclick="Call.acceptVideoUpgrade()">Turn on</button>
      </div>`;
    el.appendChild(b);
    renderIcons();
  }

  async function acceptVideoUpgrade() {
    document.getElementById('videoUpgradeBanner')?.remove();
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      const track = camStream.getVideoTracks()[0];
      localStream.addTrack(track);
      pc.addTrack(track, localStream);
      await pushSignal({ type: 'video-upgrade-accept' });
    } catch (e) { toast('Camera permission denied'); pushSignal({ type: 'video-upgrade-decline' }); }
  }

  function declineVideoUpgrade() {
    document.getElementById('videoUpgradeBanner')?.remove();
    pushSignal({ type: 'video-upgrade-decline' });
  }

  // Caller side: partner accepted, so grab our own camera and renegotiate
  async function sendUpgradeOffer() {
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      const track = camStream.getVideoTracks()[0];
      localStream.addTrack(track);
      pc.addTrack(track, localStream);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await pushSignal({ type: 'video-upgrade-offer', sdp: offer });
    } catch (e) {
      toast('Camera permission denied');
      pushSignal({ type: 'video-upgrade-decline' });
      videoUpgradePending = false;
    }
  }

  // Callee side: receives renegotiation offer (their video track was already added on accept)
  async function handleUpgradeOffer(m) {
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(m.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await pushSignal({ type: 'video-upgrade-answer', sdp: answer });
      switchToVideoUI();
    } catch (e) { toast('Video upgrade failed'); }
  }

  // Caller side: receives final answer, upgrade complete
  async function handleUpgradeAnswer(m) {
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(m.sdp));
      videoUpgradePending = false;
      switchToVideoUI();
    } catch (e) { toast('Video upgrade failed'); }
  }

  function switchToVideoUI() {
    callType = 'video';
    isCamOff = false;
    renderActive();
  }

  function startTimer() {
    seconds = 0;
    if (timerInt) clearInterval(timerInt);
    timerInt = setInterval(() => {
      seconds++;
      const formatted = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
      const t = document.getElementById('callTimer');
      if (t) t.textContent = formatted;
      const pt = document.getElementById('pipTimer');
      if (pt) pt.textContent = formatted;
    }, 1000);
  }

  // ─── CALL FLOW ───────────────────────────────────────
  let callStarting = false; // reentrancy lock — a double-tap used to start two overlapping
                             // setup sequences; the second one's cleanup() could null
                             // localStream while the first was still mid-setup, crashing
                             // on "Cannot read properties of null (reading 'getTracks')".
  // callToken guards against a DIFFERENT race: cleanup() is also invoked by
  // the background signal poller (handleSignal 'end'/'decline'), which runs
  // continuously from page load, independent of any call being set up. If
  // one of those signals lands while startCall()/acceptCall() is still
  // awaiting getUserMedia()/setupPeer(), cleanup() nulls out localStream
  // and closes the overlay right under the in-flight attempt — which is
  // exactly what made the FIRST call of a session silently fail to open
  // while retries worked (by then lastSignalId had moved past the signal
  // that caused it). Each attempt captures the token when it starts; if
  // cleanup() runs concurrently it bumps the token, and every await point
  // below checks its own token against the current one before proceeding.
  let callToken = 0;
  async function startCall(type) {
    if (callStarting) { toast('Already starting a call…'); return; }
    if (pc) { toast('A call is already in progress'); return; }
    callStarting = true;
    clearRingTimeout(); // kill any leftover timer from a previous attempt before it can fire mid-setup
    const myToken = ++callToken;
    try {
      if (!coupleId()) { toast('Not connected to a partner yet'); return; }
      if (!S.paired) { toast("⚠️ Your partner hasn't joined yet — pair first"); return; }
      callType = type; isCaller = true; callLogged = false;
      isMuted = false; isCamOff = false; isSpeakerOn = false;
      window.playAppSound?.('call.outgoing');
      renderRinging(type, false);
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' });
      if (myToken !== callToken) { // a concurrent cleanup() already tore this attempt down
        localStream.getTracks().forEach(t => t.stop()); localStream = null;
        return;
      }
      // Mic is live — the ringing panel's Mute button can now genuinely do
      // something, so stop disabling it. Video stays disabled until the
      // call actually connects (a voice→video upgrade needs a live peer
      // connection to negotiate through).
      const muteBtn = document.getElementById('muteBtn');
      if (muteBtn) muteBtn.disabled = false;
      await setupPeer();
      if (myToken !== callToken) {
        localStream && localStream.getTracks().forEach(t => t.stop()); localStream = null;
        if (pc) { pc.close(); pc = null; }
        return;
      }
      if (!localStream) throw new Error('Microphone/camera stream was lost during setup — please try again');
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (myToken !== callToken) return; // torn down mid-negotiation — don't push a signal for a dead attempt
      await pushSignal({ type: 'offer', sdp: offer, callType: type, ts: Date.now() });
      try { await api('POST', '/api/call/notify', { coupleId: coupleId(), callerRole: myRole(), type }); } catch (e) {}
      startPolling();
      clearRingTimeout();
      ringTimeout = setTimeout(() => {
        if (pc && pc.connectionState !== 'connected') {
          toast('No answer');
          pushSignal({ type: 'end' });
          logCallOnce('missed', 0);
          cleanup();
        }
      }, 30000);
    } catch (e) {
      console.error('startCall failed:', e);
      if (myToken === callToken) {
        toast(e && e.name === 'NotAllowedError' ? 'Camera/mic permission denied' : ('Could not start call' + (e && e.message ? ': ' + e.message : '')));
        cleanup();
      }
    } finally {
      callStarting = false;
    }
  }

  let pendingOffer = null;
  function showIncoming(m) {
    pendingOffer = m;
    callType = m.callType || 'voice'; callLogged = false;
    isCaller = false;
    renderRinging(callType, true);
    startPolling();
    clearRingTimeout();
    ringTimeout = setTimeout(() => {
      if (pendingOffer) {
        toast('Missed call');
        logCallOnce('missed', 0);
        cleanup();
      }
    }, 30000);
  }

  async function acceptCall() {
    if (!pendingOffer || callStarting) return;
    callStarting = true;
    clearRingTimeout();
    isMuted = false; isCamOff = false; isSpeakerOn = false;
    const offer = pendingOffer;
    const myToken = ++callToken;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: callType === 'video' });
      if (myToken !== callToken) {
        localStream.getTracks().forEach(t => t.stop()); localStream = null;
        return;
      }
      await setupPeer();
      if (myToken !== callToken) {
        localStream && localStream.getTracks().forEach(t => t.stop()); localStream = null;
        if (pc) { pc.close(); pc = null; }
        return;
      }
      if (!localStream) throw new Error('Microphone/camera stream was lost during setup — please try again');
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
      await pc.setRemoteDescription(new RTCSessionDescription(offer.sdp));
      for (const cand of iceQueue) { try { await pc.addIceCandidate(cand); } catch (e) {} }
      iceQueue = [];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (myToken !== callToken) return; // torn down mid-negotiation — don't answer for a dead attempt
      await pushSignal({ type: 'answer', sdp: answer });
      cancelIncomingCallNotification();
      onConnecting();
    } catch (e) {
      console.error('acceptCall failed:', e);
      if (myToken === callToken) {
        toast(e && e.name === 'NotAllowedError' ? 'Permission denied' : ('Could not answer call' + (e && e.message ? ': ' + e.message : '')));
        pushSignal({ type: 'decline' });
        cleanup();
      }
    } finally {
      callStarting = false;
    }
  }
  function declineCall() {
    clearRingTimeout();
    pushSignal({ type: 'decline' });
    logCallOnce('declined');
    cleanup();
  }

  async function setupPeer() {
    const iceServers = await getIceServers();
    pc = new RTCPeerConnection({ iceServers });
    remoteStream = new MediaStream();
    pc.ontrack = e => {
      e.streams[0].getTracks().forEach(t => {
        remoteStream.addTrack(t);
        // A video track flips native .muted true/false as frames actually
        // start/stop arriving — react to that immediately (root cause of
        // the mini video window sitting on its avatar-fallback letter for
        // up to 3s after the camera was really already live).
        t.addEventListener('unmute', () => window.dispatchEvent(new CustomEvent('uwl:call-stream-changed')));
        t.addEventListener('mute', () => window.dispatchEvent(new CustomEvent('uwl:call-stream-changed')));
      });
      if (document.getElementById('callRemoteVideo')) document.getElementById('callRemoteVideo').srcObject = remoteStream;
      if (document.getElementById('callRemoteAudio')) document.getElementById('callRemoteAudio').srcObject = remoteStream;
      if (callContext === 'watch_together') {
        console.log('[WatchVoice] remote track received:', e.track.kind, 'streams:', e.streams.length);
        if (callType === 'voice') {
          const wa = ensureWatchRemoteAudio();
          if (wa.srcObject !== remoteStream) wa.srcObject = remoteStream;
          console.log('[WatchVoice] remote audio stream tracks:', remoteStream.getAudioTracks().length);
          const p = wa.play();
          if (p && p.catch) p.catch(err => console.error('[WatchVoice] remote audio play failed:', err));
        } else {
          // Upgraded to video (or was video from the start) — the mini
          // rectangle/bubble <video> elements in movie.js now carry the
          // audio too. Detach the standalone sink so audio isn't played
          // through two elements at once.
          detachWatchRemoteAudio();
        }
      }
      window.dispatchEvent(new CustomEvent('uwl:call-stream-changed'));
    };
    pc.onicecandidate = e => { if (e.candidate) pushSignal({ type: 'ice', candidate: e.candidate }); };
    pc.oniceconnectionstatechange = () => {
      if (callContext === 'watch_together') console.log('[WatchVoice] iceConnectionState:', pc.iceConnectionState);
    };
    let disconnectGrace = null;
    pc.onconnectionstatechange = () => {
      if (callContext === 'watch_together') console.log('[WatchVoice] connectionState:', pc.connectionState);
      if (pc.connectionState === 'connected') {
        if (disconnectGrace) { clearTimeout(disconnectGrace); disconnectGrace = null; }
        clearRingTimeout();
        // setConnectedAudio() MUST run before renderActive() creates and
        // starts the <audio autoplay> element (see comment below) — and,
        // just as importantly, it must ALSO run for Watch Together. It
        // previously only ran on the `else` (chat) branch below, so a
        // Watch Together call never switched Android's AudioManager into
        // MODE_IN_COMMUNICATION at all — the OS stayed in normal media
        // mode, which is a second, independent reason two-way audio
        // never worked even once a sink existed for it.
        setConnectedAudio();
        if (callContext === 'watch_together') {
          // No fullscreen overlay, no PiP, no chat "Connected" screen —
          // just record the ONE authoritative timestamp movie.js's mini
          // UI computes its timer from (spec §25). Never overwritten by
          // a later reconnect within the same media session.
          if (!watchMediaStartedAt) watchMediaStartedAt = Date.now();
          window.dispatchEvent(new CustomEvent('uwl:call-stream-changed'));
          return;
        }
        // setConnectedAudio() MUST run before renderActive() creates and
        // starts the <audio autoplay> element, not after. Previously the
        // audio element started playing immediately under whatever mode
        // setRingingAudio() had left the OS in (MODE_NORMAL + speakerphone
        // forced on for the ringback), and only afterward did the native
        // switch to MODE_IN_COMMUNICATION + the real speaker preference
        // fire — Android doesn't always fully migrate an already-open
        // audio stream to the new route when that happens mid-stream, so
        // the call was audible on both outputs at once. Setting the route
        // first means the audio element opens directly on the correct one.
        renderActive();
        window.playAppSound?.(callType === 'video' ? 'call.video.connected' : 'call.connected');
      }
      if (pc.connectionState === 'failed') {
        if (disconnectGrace) { clearTimeout(disconnectGrace); disconnectGrace = null; }
        if (callContext === 'watch_together') { cleanupWatchCall(); return; }
        window.playAppSound?.('call.failed'); toast('Call disconnected'); endCall(true);
      }
      else if (pc.connectionState === 'disconnected') {
        if (callContext === 'watch_together') {
          if (disconnectGrace) clearTimeout(disconnectGrace);
          try { if (typeof pc.restartIce === 'function') pc.restartIce(); } catch (e) {}
          disconnectGrace = setTimeout(() => {
            disconnectGrace = null;
            if (pc && pc.connectionState !== 'connected') cleanupWatchCall();
          }, 12000);
          return;
        }
        window.playAppSound?.('call.network.reconnect');
        toast('Connection lost — reconnecting...');
        // 'disconnected' can recover on its own (brief network blip), but
        // previously nothing ever gave up on it — a call that never came
        // back just sat on "reconnecting..." indefinitely. Try one ICE
        // restart, then hang up if it hasn't recovered within 12s.
        if (disconnectGrace) clearTimeout(disconnectGrace);
        try { if (typeof pc.restartIce === 'function') pc.restartIce(); } catch (e) {}
        disconnectGrace = setTimeout(() => {
          disconnectGrace = null;
          if (pc && pc.connectionState !== 'connected') {
            window.playAppSound?.('call.failed');
            toast('Call disconnected');
            endCall(true);
          }
        }, 12000);
      }
    };
  }
  function onConnecting() { const lbl = document.querySelector('.call-status-label'); if (lbl) lbl.textContent = 'Connecting...'; }

  function endCall(notify = true) {
    window.playAppSound?.('call.ended');
    if (notify) pushSignal({ type: 'end' });
    logCallOnce('ended', seconds);
    cleanup();
  }
  function cleanup() {
    callStarting = false;
    callToken++; // invalidate any startCall()/acceptCall() still mid-setup
    clearRingTimeout();
    stopRingtone();
    releaseCallAudio();
    cancelIncomingCallNotification();
    stopAutoHide();
    if (pc) { pc.close(); pc = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    remoteStream = null;
    window.dispatchEvent(new CustomEvent('uwl:call-stream-changed'));
    iceQueue = [];
    if (timerInt) clearInterval(timerInt);
    // NOTE: the idle signal-poll loop (pollInterval) is intentionally left
    // running here. startPolling()'s own internal logic already throttles
    // it down to the idle rate (~2s) once `pc` is null — killing it
    // entirely on every call end used to mean nothing was left listening
    // for the *next* incoming offer at all, since the only thing that
    // would have restarted it was detecting a new offer via... the poll
    // loop that had just been stopped. Every call after the first one
    // silently never arrived until a full page reload.
    stopSignalMonitor();
    closeOverlay();
    if (pipEl) { pipEl.remove(); pipEl = null; }
    isMinimized = false;
    videoUpgradePending = false;
    pendingOffer = null;
  }
  async function logCall(status, duration) {
    if (!coupleId()) return;
    try { await api('POST', '/api/call/log', { coupleId: coupleId(), callerRole: isCaller ? myRole() : otherRole(), type: callType, status, duration: duration || 0 }); } catch (e) {}
  }

  // ─── Audio unlock ──────────────────────────────────────────────
  // Root cause of "ringtone only plays when the app is fully closed":
  // when closed, Firebase's system notification plays the ringtone via
  // the OS itself, bypassing the browser entirely. When the app is open,
  // the incoming call is caught by pollSignal() instead, which tries to
  // start audio (Audio.play() / AudioContext) with zero prior user
  // interaction on that page load — mobile autoplay policy silently
  // rejects that, so nothing plays even though the app "should" ring.
  // Fix: prime both audio paths on the very first tap/touch anywhere in
  // the app (an unrelated tap on the chat screen counts), so by the time
  // a real incoming call arrives later, the browser already treats audio
  // as unlocked for this page.
  let audioUnlocked = false;
  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    try {
      const ctx = ensureRingCtx();
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    } catch (e) {}
    try {
      const a = new Audio(RINGTONE_FILE);
      a.volume = 0; a.muted = true;
      const p = a.play();
      if (p && p.then) p.then(() => { a.pause(); a.currentTime = 0; }).catch(() => {});
    } catch (e) {}
  }
  document.addEventListener('touchstart', unlockAudio, { once: true, passive: true });
  document.addEventListener('click', unlockAudio, { once: true });

  // ─── Pending notification action (Answer tapped from the Android
  // incoming-call notification) ─────────────────────────────────────
  // ANSWER_CALL previously just opened the app and stopped — it never
  // ran the real accept-call logic, so the call was never actually
  // answered (see NotificationActionReceiver.java). WebRTC needs a live
  // JS runtime to negotiate media, so it can't be answered natively the
  // way Decline now is; instead, MainActivity.handleDeepLink() loads the
  // app with ?pendingAction=answer on the URL, and this consumes that
  // flag once the runtime is ready and the matching offer has arrived
  // over polling/realtime — then calls the SAME acceptCall() the in-app
  // Answer button uses. `pendingActionConsumed` guards against firing
  // twice — this now matters for TWO separate entry points (see below),
  // not just a duplicate DOMContentLoaded call.
  let pendingActionConsumed = false;

  function waitForOfferAndAccept() {
    // The offer may not have arrived yet (poll cadence / realtime not up
    // yet) — wait for it rather than assuming it's already there. Give
    // up after 25s (just under the 30s ring timeout) so a stale/expired
    // launch doesn't hang forever.
    const deadline = Date.now() + 25000;
    (function waitForOffer() {
      if (pendingOffer && !pc) { acceptCall(); return; } // race check: if pc already exists, another path (e.g. realtime) is already handling it
      if (pc) return; // already answered/answering via another path — don't double-answer
      if (Date.now() > deadline) return;
      setTimeout(waitForOffer, 300);
    })();
  }

  // Entry point 1: cold/background launch. MainActivity appends
  // ?pendingAction=answer to the URL it loads; this reads it off the URL
  // once the page has parsed.
  function consumePendingCallAction() {
    if (pendingActionConsumed) return;
    let action = null;
    try { action = new URLSearchParams(window.location.search).get('pendingAction'); } catch (e) {}
    if (action !== 'answer') return;
    pendingActionConsumed = true;
    // Strip the param so a later reload/back-nav doesn't re-trigger it.
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete('pendingAction');
      window.history.replaceState({}, '', u.toString());
    } catch (e) {}
    waitForOfferAndAccept();
  }

  // Entry point 2: app already warm (foreground or backgrounded with the
  // WebView already loaded). MainActivity now skips the URL/reload path
  // entirely in this case and calls this directly via evaluateJavascript,
  // so there's no page load and therefore no skeleton to bypass — this
  // just needs to reuse the same guarded accept flow.
  window.__uwl_consumeNativeAnswerCalled = false;
  function consumeNativeAnswer() {
    if (pendingActionConsumed) return;
    pendingActionConsumed = true;
    waitForOfferAndAccept();
  }

  // As early as possible (before the normal init chain below), detect a
  // notification-driven cold launch and skip the dashboard skeleton —
  // AppLoader.forceHide() is the existing escape hatch used for
  // network-failure retries; reusing it here means no skeleton changes
  // were needed. The ringing/"Connecting…" UI (renderRinging/onConnecting,
  // both pre-existing) becomes the visible foreground state instead.
  (function skipSkeletonIfCallEntry() {
    try {
      if (new URLSearchParams(window.location.search).get('pendingAction') === 'answer'
          && window.AppLoader && window.AppLoader.forceHide) {
        window.AppLoader.forceHide();
      }
    } catch (e) {}
  })();

  document.addEventListener('DOMContentLoaded', async () => {
    await initSignalCursor();
    setTimeout(startPolling, 1500);
    setTimeout(setupCallSignalRealtime, 1500);
    consumePendingCallAction();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pollSignal();
  });
  window.addEventListener('focus', () => pollSignal());
  window.addEventListener('pageshow', () => pollSignal());

  // ─── Watch Together bridge (read-only) ───
  // Exposes the existing remoteStream/local mute state to other
  // same-origin frames (e.g. public/movie.html's floating partner
  // video) without duplicating any WebRTC/signaling logic here.
  function getRemoteStream() { return remoteStream || null; }
  function getRemoteCamOn() {
    // A receiver's video track.enabled is always true locally — it does
    // NOT reflect the sender's own camera toggle. track.muted is set by
    // the browser when no media is actively flowing from the sender,
    // which is the closest reliable signal we have without adding a new
    // explicit "camera off" message to the signaling protocol.
    const t = remoteStream && remoteStream.getVideoTracks()[0];
    if (!t) return false;
    return t.readyState === 'live' && !t.muted;
  }
  function getState() { return { muted: isMuted, camOn: !isCamOff, callType, speakerOn: isSpeakerOn }; }

  // ══════════════════════════════════════════════════════════════════
  // WATCH TOGETHER — direct-join media session.
  //
  // Same engine (pc/localStream/remoteStream/getUserMedia/signaling) as
  // the Chat call flow above; ZERO fullscreen ringing/incoming screens,
  // ZERO PiP, ZERO chat call_log entries. Presentation lives entirely in
  // public/movie.js's own mini voice/video UI, which polls getWatchState()
  // /getRemoteStream() and listens for 'uwl:call-stream-changed'.
  // ══════════════════════════════════════════════════════════════════

  // Called by movie.js when it enters the WATCHING state, with an ID
  // that is unique per movie session (and changes on every new session,
  // e.g. the room's scheduled_start_at) — and cleared when that session
  // ends. This is the single source of truth an incoming watch-call
  // signal is validated against, so a stale/foreign-session offer can
  // never auto-open a mic/camera (spec §23–24).
  function registerWatchSession(id) { watchSessionId = id || null; }
  function clearWatchSession() {
    watchSessionId = null;
    if (callContext === 'watch_together') cleanupWatchCall();
  }

  function watchState() {
    return {
      active: callContext === 'watch_together' && (!!pc || !!localStream),
      callType, muted: isMuted, camOn: !isCamOff, speakerOn: isSpeakerOn,
      startedAt: watchMediaStartedAt
    };
  }

  // Partner A taps Voice/Video: create the offer immediately, no ringing
  // screen. If a voice call is already active and Video is tapped, this
  // upgrades the SAME session instead of starting a second one (spec §20).
  async function startWatchCall(type) {
    if (!watchSessionId) return; // never start media outside a real, current watch session
    if (callContext === 'watch_together' && pc && callType === 'voice' && type === 'video') {
      return upgradeWatchCallToVideo();
    }
    if (pc || callStarting) return; // one live call (chat OR watch) at a time — same engine
    callStarting = true;
    callContext = 'watch_together';
    callType = type; isCaller = true; callLogged = true; // suppress Chat call_log rows for watch calls
    // Watch Together default = loudspeaker (movie audio + partner audio both
    // need to be comfortably audible at once) — unlike a normal chat call,
    // which defaults to the earpiece. See setConnectedAudio()/CallAudio plugin.
    isMuted = false; isCamOff = false; isSpeakerOn = true;
    watchMediaSessionId = watchSessionId + ':' + Date.now() + ':' + Math.random().toString(36).slice(2, 7);
    watchMediaStartedAt = null;
    const myToken = ++callToken;
    try {
      if (!coupleId() || !S.paired) { cleanupWatchCall(); return; }
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' });
      if (myToken !== callToken) { localStream.getTracks().forEach(t => t.stop()); localStream = null; return; }
      await setupPeer();
      if (myToken !== callToken) {
        localStream && localStream.getTracks().forEach(t => t.stop()); localStream = null;
        if (pc) { pc.close(); pc = null; }
        return;
      }
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
      console.log('[WatchVoice] local audio tracks:', localStream.getAudioTracks().map(t => ({ enabled: t.enabled, readyState: t.readyState })));
      console.log('[WatchVoice] audio sender:', pc.getSenders().find(s => s.track && s.track.kind === 'audio') ? 'present' : 'MISSING');
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (myToken !== callToken) return;
      await pushSignal({ type: 'offer', sdp: offer, callType: type, ts: Date.now(), context: 'watch_together', watchSessionId, mediaSessionId: watchMediaSessionId });
      startPolling();
      window.dispatchEvent(new CustomEvent('uwl:call-stream-changed'));
    } catch (e) {
      console.error('startWatchCall failed:', e);
      toast(e && e.name === 'NotAllowedError' ? 'Camera/mic permission denied' : 'Could not start call');
      cleanupWatchCall();
    } finally {
      callStarting = false;
    }
  }

  // Partner B: an offer arrived tagged for OUR current watch session —
  // auto-join immediately, no incoming screen, no Accept/Decline.
  async function handleWatchOffer(m) {
    if (!watchSessionId || m.watchSessionId !== watchSessionId) return; // foreign/stale session — ignore
    if (m.ts && Date.now() - m.ts > 45000) return; // stale offer — ignore
    if (pc || callStarting) return; // already in a call
    callStarting = true;
    callContext = 'watch_together';
    callType = m.callType || 'voice'; isCaller = false; callLogged = true;
    // Same Watch Together default-to-loudspeaker rule as startWatchCall().
    isMuted = false; isCamOff = false; isSpeakerOn = true;
    watchMediaSessionId = m.mediaSessionId || null;
    watchMediaStartedAt = null;
    const myToken = ++callToken;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: callType === 'video' });
      if (myToken !== callToken) { localStream.getTracks().forEach(t => t.stop()); localStream = null; return; }
      await setupPeer();
      if (myToken !== callToken) {
        localStream && localStream.getTracks().forEach(t => t.stop()); localStream = null;
        if (pc) { pc.close(); pc = null; }
        return;
      }
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
      console.log('[WatchVoice] local audio tracks:', localStream.getAudioTracks().map(t => ({ enabled: t.enabled, readyState: t.readyState })));
      console.log('[WatchVoice] audio sender:', pc.getSenders().find(s => s.track && s.track.kind === 'audio') ? 'present' : 'MISSING');
      await pc.setRemoteDescription(new RTCSessionDescription(m.sdp));
      for (const cand of iceQueue) { try { await pc.addIceCandidate(cand); } catch (e) {} }
      iceQueue = [];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (myToken !== callToken) return;
      await pushSignal({ type: 'answer', sdp: answer, context: 'watch_together', watchSessionId, mediaSessionId: watchMediaSessionId });
      window.dispatchEvent(new CustomEvent('uwl:call-stream-changed'));
    } catch (e) {
      console.error('handleWatchOffer failed:', e);
      cleanupWatchCall();
    } finally {
      callStarting = false;
    }
  }

  // Voice → Video upgrade: adds a camera track to the SAME peer
  // connection/media session instead of starting a second call.
  async function upgradeWatchCallToVideo() {
    if (!pc || callType === 'video') return;
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      const track = camStream.getVideoTracks()[0];
      localStream.addTrack(track);
      pc.addTrack(track, localStream);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await pushSignal({ type: 'watch-upgrade-offer', sdp: offer, context: 'watch_together', watchSessionId, mediaSessionId: watchMediaSessionId });
      detachWatchRemoteAudio(); // the mini video window's <video> will carry audio from here on
    } catch (e) { toast('Camera permission denied'); }
  }
  async function handleWatchUpgradeOffer(m) {
    if (!pc || m.watchSessionId !== watchSessionId || m.mediaSessionId !== watchMediaSessionId) return;
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      const track = camStream.getVideoTracks()[0];
      localStream.addTrack(track);
      pc.addTrack(track, localStream);
      await pc.setRemoteDescription(new RTCSessionDescription(m.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      callType = 'video';
      await pushSignal({ type: 'watch-upgrade-answer', sdp: answer, context: 'watch_together', watchSessionId, mediaSessionId: watchMediaSessionId });
      detachWatchRemoteAudio();
      window.dispatchEvent(new CustomEvent('uwl:call-stream-changed'));
    } catch (e) { toast('Video upgrade failed'); }
  }
  async function handleWatchUpgradeAnswer(m) {
    if (!pc || m.watchSessionId !== watchSessionId || m.mediaSessionId !== watchMediaSessionId) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(m.sdp));
      callType = 'video';
      detachWatchRemoteAudio();
      window.dispatchEvent(new CustomEvent('uwl:call-stream-changed'));
    } catch (e) {}
  }

  // ─── Idempotent teardown — safe to call any number of times, from any
  // of: End button, partner's WATCH_MEDIA_END signal, End Movie, ICE
  // failure, or losing the watch session. Never touches #callOverlay/PiP
  // (they were never created for a watch call in the first place). ───
  function cleanupWatchCall() {
    callStarting = false;
    callToken++;
    if (pc) { try { pc.close(); } catch (e) {} pc = null; }
    if (localStream) { localStream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} }); localStream = null; }
    remoteStream = null;
    iceQueue = [];
    watchMediaSessionId = null;
    watchMediaStartedAt = null;
    callContext = 'chat';
    detachWatchRemoteAudio();
    releaseCallAudio();
    window.dispatchEvent(new CustomEvent('uwl:call-stream-changed'));
  }
  function endWatchCall() {
    if (callContext === 'watch_together' && (pc || localStream)) {
      try { pushSignal({ type: 'end', context: 'watch_together', watchSessionId, mediaSessionId: watchMediaSessionId }); } catch (e) {}
    }
    cleanupWatchCall();
  }

  return {
    startCall, acceptCall, declineCall, endCall, toggleMute, toggleCam, toggleSpeaker, flipCamera, minimize, restore, toggleMoreMenu, openChatDuringCall, acceptVideoUpgrade, declineVideoUpgrade, openMap, consumeNativeAnswer, getRemoteStream, getRemoteCamOn, getState,
    // Watch Together bridge — presentation lives in movie.js, not here
    registerWatchSession, clearWatchSession, startWatchCall, endWatchCall, getWatchState: watchState
  };
})();
window.Call = Call;