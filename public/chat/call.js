/*public/chat/call.js*/

const Call = (function () {
  let pc, localStream, remoteStream, callType, isCaller = false;
  let timerInt, seconds = 0;
  let pollInterval;
  let isMuted = false, isCamOff = false, isSpeakerOn = true;
  let isMinimized = false, pipEl = null, pipDrag = null;
  let signalInterval = null;
  let videoUpgradePending = false;
  let ringTimeout = null;
  function clearRingTimeout() { if (ringTimeout) clearTimeout(ringTimeout); ringTimeout = null; }

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
      }
    } catch (e) { console.error('Signal push error:', e); toast('⚠️ Network error during call setup'); }
  }
async function initSignalCursor() {
    try {
      const r = await fetch(API + '/api/call/signal/' + coupleId() + '?role=' + otherRole());
      if (!r.ok) return;
      const rows = await r.json();
      if (rows.length) lastSignalId = Math.max(...rows.map(x => x.id));
    } catch (e) {}
  }
  let lastSignalId = 0;
  async function pollSignal() {
    if (!coupleId()) return;
    try {
      const r = await fetch(API + '/api/call/signal/' + coupleId() + '?role=' + otherRole() + '&after=' + lastSignalId);
      if (!r.ok) return;
      const rows = await r.json();
      if (!rows.length) return;
      lastSignalId = Math.max(...rows.map(x => x.id));
      for (const row of rows) await handleSignal(row.payload);
    } catch (e) {}
  }

let iceQueue = [];

  async function handleSignal(m) {
    if (m.type === 'offer' && !pc) {
      if (m.ts && Date.now() - m.ts > 20000) return; // ignore stale offers
      showIncoming(m);
    }
    else if (m.type === 'answer' && pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(m.sdp));
      onConnecting();
      for (const cand of iceQueue) { try { await pc.addIceCandidate(cand); } catch (e) {} }
      iceQueue = [];
    }
    else if (m.type === 'ice') {
      if (pc && pc.remoteDescription) {
        try { await pc.addIceCandidate(m.candidate); } catch (e) {}
      } else {
        iceQueue.push(m.candidate);
      }
    }
    else if (m.type === 'end') { endCall(false); }
    else if (m.type === 'decline') { toast('Call declined'); cleanup(); logCall('declined'); }
    else if (m.type === 'video-upgrade-request') { showUpgradeRequestBanner(); }
    else if (m.type === 'video-upgrade-accept') { sendUpgradeOffer(); }
    else if (m.type === 'video-upgrade-decline') { toast('Partner declined video'); videoUpgradePending = false; }
    else if (m.type === 'video-upgrade-offer') { await handleUpgradeOffer(m); }
    else if (m.type === 'video-upgrade-answer') { await handleUpgradeAnswer(m); }
  }

  function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(pollSignal, 500);
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
    return av ? `<img src="${av}" style="width:100%;height:100%;object-fit:cover">` : (name[0] || 'P');
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
        <button type="button" class="call-topbar-btn" onclick="Call.minimize()" title="Minimize">🗕</button>
        <div class="call-topbar-title">
          <div class="call-topbar-name">${esc(window.S.partnerName || 'Partner')}</div>
          <div class="call-topbar-sub">🔒 <span id="callTopSub">End-to-end encrypted</span></div>
        </div>
        <button type="button" class="call-topbar-btn" title="Signal quality">${signalBarsHtml(3)}</button>
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
    const el = ensureOverlay();
    el.classList.remove('call-active-video');
    const name = window.S.partnerName || 'Partner';
    const av = window.S.partnerAvatar;

    el.innerHTML = `
      <div class="call-bg-blur"></div>
      ${topbarHtml()}
      <div class="call-content">
        <div class="call-status-label">${incoming ? (type === 'video' ? 'Incoming video call' : 'Incoming voice call') : 'Calling...'}</div>
        <div class="call-avatar-ring pulse">
          <div class="call-avatar">${avatarHtml(name, av)}</div>
        </div>
        <div class="call-partner-name">${esc(name)}</div>
        <div class="call-sub">${type === 'video' ? '📹 Video call' : '🎙️ Voice call'}</div>
      </div>
      ${incoming ? `
        <div class="call-incoming-labels">
          <span>Decline</span><span>Accept</span>
        </div>
        <div class="call-controls call-controls-incoming" style="margin-bottom:max(40px, env(safe-area-inset-bottom))">
          <button type="button" class="call-btn call-btn-decline" onclick="Call.declineCall()">📞</button>
          <button type="button" class="call-btn call-btn-accept" onclick="Call.acceptCall()">${type === 'video' ? '📹' : '📞'}</button>
        </div>
      ` : `
        <div class="call-controls" style="margin-bottom:max(40px, env(safe-area-inset-bottom))">
          <button type="button" class="call-btn call-btn-end" onclick="Call.endCall()">📞</button>
        </div>
      `}`;
    // force layout + open on next frame so opacity transition + pointer-events actually apply
    requestAnimationFrame(() => el.classList.add('open'));
  }

  function renderActive() {
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
      document.getElementById('callRemoteVideo').srcObject = remoteStream;
      document.getElementById('callLocalVideo').srcObject = localStream;
    } else {
      el.classList.remove('call-active-video');
      const av = window.S.partnerAvatar;
      el.innerHTML = `
        <div class="call-bg-blur"></div>
        ${topbarHtml()}
        <div class="call-content">
          <div class="call-status-label">Connected</div>
          <div class="call-avatar-ring connected"><div class="call-avatar">${avatarHtml(name, av)}</div></div>
          <div class="call-partner-name">${esc(name)}</div>
          <div class="call-sub" id="callTimer">00:00</div>
        </div>
        <div id="callMoreMenuHost"></div>
        ${controlsHtml(false)}`;
      const remoteAudio = document.createElement('audio');
      remoteAudio.id = 'callRemoteAudio'; remoteAudio.autoplay = true; remoteAudio.srcObject = remoteStream;
      el.appendChild(remoteAudio);
    }
    startTimer();
    startSignalMonitor();
  }

  function controlsHtml(video) {
    return `<div class="call-controls call-controls-wa">
      <button type="button" class="call-btn call-btn-sm" onclick="Call.toggleMoreMenu()" title="More">⋯</button>
      ${video
        ? `<button type="button" class="call-btn call-btn-sm" id="flipBtn" onclick="Call.flipCamera()" title="Flip camera">🔄</button>`
        : `<button type="button" class="call-btn call-btn-sm" id="camBtn" onclick="Call.toggleCam()" title="Video">
             <span id="camIcon">📹</span>
           </button>`}
      <button type="button" class="call-btn call-btn-sm" id="speakerBtn" onclick="Call.toggleSpeaker()" title="Speaker">
        <span id="speakerIcon">🔊</span>
      </button>
      <button type="button" class="call-btn call-btn-sm" id="muteBtn" onclick="Call.toggleMute()" title="Mute">
        <span id="muteIcon">🎙️</span>
      </button>
      <button type="button" class="call-btn call-btn-end" onclick="Call.endCall()">📞</button>
    </div>`;
  }

  function toggleMute() {
    if (!localStream) return;
    const track = localStream.getAudioTracks()[0];
    if (!track) return;
    isMuted = !isMuted;
    track.enabled = !isMuted;
    document.getElementById('muteBtn')?.classList.toggle('call-btn-active', isMuted);
    const icon = document.getElementById('muteIcon');
    if (icon) icon.textContent = isMuted ? '🔇' : '🎙️';
    if (pipEl) {
      const existing = pipEl.querySelector('.call-pip-mic-off');
      if (isMuted && !existing) pipEl.insertAdjacentHTML('beforeend', `<div class="call-pip-mic-off">🔇</div>`);
      if (!isMuted && existing) existing.remove();
    }
  }

  function toggleCam() {
    if (!localStream) return;
    const track = localStream.getVideoTracks()[0];
    if (!track) { requestVideoUpgrade(); return; }
    isCamOff = !isCamOff;
    track.enabled = !isCamOff;
    document.getElementById('camBtn')?.classList.toggle('call-btn-active', isCamOff);
    const icon = document.getElementById('camIcon');
    if (icon) icon.textContent = isCamOff ? '📵' : '📹';
    const localVid = document.getElementById('callLocalVideo');
    if (localVid) localVid.style.opacity = isCamOff ? '0.25' : '1';
  }

  function toggleSpeaker() {
    isSpeakerOn = !isSpeakerOn;
    document.getElementById('speakerBtn')?.classList.toggle('call-btn-active', !isSpeakerOn);
    const icon = document.getElementById('speakerIcon');
    if (icon) icon.textContent = isSpeakerOn ? '🔊' : '🔈';
    const audioEl = document.getElementById('callRemoteAudio');
    if (audioEl && audioEl.setSinkId) {
      audioEl.setSinkId(isSpeakerOn ? 'default' : 'communications').catch(() => {});
    }
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
  function toggleMoreMenu() {
    const host = document.getElementById('callMoreMenuHost');
    if (!host) return;
    if (host.querySelector('.call-more-menu')) { host.innerHTML = ''; return; }
    host.innerHTML = `
      <div class="call-more-backdrop" onclick="Call.toggleMoreMenu()"></div>
      <div class="call-more-menu">
        <button type="button" onclick="Call.openChatDuringCall()">💬 Open chat</button>
        <button type="button" onclick="Call.toggleMoreMenu(); Call.minimize()">🗕 Minimize call</button>
      </div>`;
  }
  function openChatDuringCall() {
    toggleMoreMenu();
    minimize();
    // chat UI is already the underlying screen in this app, so nothing else to route
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
    if (isMuted) pipEl.insertAdjacentHTML('beforeend', `<div class="call-pip-mic-off">🔇</div>`);
    pipEl.insertAdjacentHTML('beforeend', `<div class="call-pip-timer" id="pipTimer">00:00</div>`);
    pipEl.onclick = (e) => { if (!pipDrag || !pipDrag.moved) restore(); };
    document.body.appendChild(pipEl);
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
      <span>📹 Your partner wants to turn on video</span>
      <div class="call-upgrade-actions">
        <button type="button" onclick="Call.declineVideoUpgrade()">Not now</button>
        <button type="button" class="accept" onclick="Call.acceptVideoUpgrade()">Turn on</button>
      </div>`;
    el.appendChild(b);
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
  async function startCall(type) {
    if (!coupleId()) { toast('Not connected to a partner yet'); return; }
    if (!S.paired) { toast('⚠️ Your partner hasn\'t joined yet — pair first'); return; }
    if (pc) { toast('A call is already in progress'); return; }
    callType = type; isCaller = true;
    isMuted = false; isCamOff = false; isSpeakerOn = true;
    renderRinging(type, false);
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' });
      await setupPeer();
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await pushSignal({ type: 'offer', sdp: offer, callType: type, ts: Date.now() });
      try { await api('POST', '/api/call/notify', { coupleId: coupleId(), callerRole: myRole(), type }); } catch (e) {}
      startPolling();
      clearRingTimeout();
      ringTimeout = setTimeout(() => {
        if (pc && pc.connectionState !== 'connected') {
          toast('No answer');
          pushSignal({ type: 'end' });
          logCall('missed', 0);
          cleanup();
        }
      }, 30000);
    } catch (e) {
      console.error('startCall failed:', e);
      toast(e && e.name === 'NotAllowedError' ? 'Camera/mic permission denied' : 'Could not start call');
      cleanup();
    }
  }

  let pendingOffer = null;
  function showIncoming(m) {
    pendingOffer = m;
    callType = m.callType || 'voice';
    isCaller = false;
    renderRinging(callType, true);
    startPolling();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
    clearRingTimeout();
    ringTimeout = setTimeout(() => {
      if (pendingOffer) {
        toast('Missed call');
        logCall('missed', 0);
        cleanup();
      }
    }, 30000);
  }

  async function acceptCall() {
    if (!pendingOffer) return;
    clearRingTimeout();
    isMuted = false; isCamOff = false; isSpeakerOn = true;
    const offer = pendingOffer;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: callType === 'video' });
      await setupPeer();
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
      await pc.setRemoteDescription(new RTCSessionDescription(offer.sdp));
      for (const cand of iceQueue) { try { await pc.addIceCandidate(cand); } catch (e) {} }
      iceQueue = [];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await pushSignal({ type: 'answer', sdp: answer });
      onConnecting();
    } catch (e) {
      console.error('acceptCall failed:', e);
      toast(e && e.name === 'NotAllowedError' ? 'Permission denied' : 'Could not answer call');
      pushSignal({ type: 'decline' });
      cleanup();
    }
  }
  function declineCall() {
    clearRingTimeout();
    pushSignal({ type: 'decline' });
    logCall('declined');
    cleanup();
  }

  async function setupPeer() {
    const iceServers = await getIceServers();
    pc = new RTCPeerConnection({ iceServers });
    remoteStream = new MediaStream();
    pc.ontrack = e => {
      e.streams[0].getTracks().forEach(t => remoteStream.addTrack(t));
      if (document.getElementById('callRemoteVideo')) document.getElementById('callRemoteVideo').srcObject = remoteStream;
      if (document.getElementById('callRemoteAudio')) document.getElementById('callRemoteAudio').srcObject = remoteStream;
    };
    pc.onicecandidate = e => { if (e.candidate) pushSignal({ type: 'ice', candidate: e.candidate }); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') { clearRingTimeout(); renderActive(); }
      if (pc.connectionState === 'failed') { toast('Call disconnected'); endCall(true); }
      else if (pc.connectionState === 'disconnected') { toast('Connection lost — reconnecting...'); }
    };
  }
  function onConnecting() { const lbl = document.querySelector('.call-status-label'); if (lbl) lbl.textContent = 'Connecting...'; }

  function endCall(notify = true) {
    if (notify) pushSignal({ type: 'end' });
    logCall('ended', seconds);
    cleanup();
  }
  function cleanup() {
    clearRingTimeout();
    if (pc) { pc.close(); pc = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    remoteStream = null;
    iceQueue = [];
    if (timerInt) clearInterval(timerInt);
    if (pollInterval) clearInterval(pollInterval);
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

  document.addEventListener('DOMContentLoaded', async () => {
    await initSignalCursor();
    setTimeout(startPolling, 1500);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pollSignal();
  });
  window.addEventListener('focus', () => pollSignal());
  window.addEventListener('pageshow', () => pollSignal());
  return { startCall, acceptCall, declineCall, endCall, toggleMute, toggleCam, toggleSpeaker, flipCamera, minimize, restore, toggleMoreMenu, openChatDuringCall, acceptVideoUpgrade, declineVideoUpgrade };
})();
window.Call = Call;