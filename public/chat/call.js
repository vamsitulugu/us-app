const Call = (function () {
  let pc, localStream, remoteStream, callType, role, callId, isCaller = false;
  let timerInt, seconds = 0;
  let pollInterval;

  function coupleId() { return window.S && window.S.coupleId; }
  function myRole() { return window.S && window.S.role; }
  function otherRole() { return myRole() === 'user1' ? 'user2' : 'user1'; }

  async function getIceServers() {
    try {
      const r = await fetch(API + '/api/call/turn-creds');
      const d = await r.json();
      return d.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }];
    } catch (e) { return [{ urls: 'stun:stun.l.google.com:19302' }]; }
  }

  function sigKeyMine() { return 'callsig_' + myRole(); }
  function sigKeyTheirs() { return 'callsig_' + otherRole(); }

  async function pushSignal(msg) {
    if (!coupleId()) return;
    try {
      const state = await api('GET', '/api/data/state/' + coupleId());
      const existing = Array.isArray((state || {})[sigKeyMine()]) ? state[sigKeyMine()] : [];
      const updated = [...existing, { ...msg, ts: Date.now(), seq: Date.now() }].slice(-30);
      await api('POST', '/api/data/state', { coupleId: coupleId(), state: { [sigKeyMine()]: updated } });
    } catch (e) {}
  }

  let lastSeenSeq = 0;
  async function pollSignal() {
    if (!coupleId()) return;
    try {
      const state = await api('GET', '/api/data/state/' + coupleId());
      const msgs = Array.isArray((state || {})[sigKeyTheirs()]) ? state[sigKeyTheirs()] : [];
      const fresh = msgs.filter(m => m.seq > lastSeenSeq).sort((a,b)=>a.seq-b.seq);
      if (!fresh.length) return;
      lastSeenSeq = fresh[fresh.length-1].seq;
      for (const m of fresh) await handleSignal(m);
    } catch (e) {}
  }

  async function handleSignal(m) {
    if (m.type === 'offer' && !pc) { showIncoming(m); }
    else if (m.type === 'answer' && pc) { await pc.setRemoteDescription(new RTCSessionDescription(m.sdp)); onConnecting(); }
    else if (m.type === 'ice' && pc) { try { await pc.addIceCandidate(m.candidate); } catch (e) {} }
    else if (m.type === 'end') { endCall(false); }
    else if (m.type === 'decline') { toast('Call declined'); cleanup(); logCall('declined'); }
  }

  function startPolling() { if (pollInterval) clearInterval(pollInterval); pollInterval = setInterval(pollSignal, 1200); }

  // ─── UI overlay ──────────────────────────────────────
  function ensureOverlay() {
    let el = document.getElementById('callOverlay');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'callOverlay';
    el.className = 'call-overlay';
    document.body.appendChild(el);
    return el;
  }
  function closeOverlay() { document.getElementById('callOverlay')?.classList.remove('open'); }

  function renderRinging(type, incoming) {
    const el = ensureOverlay();
    el.classList.add('open');
    const name = window.S.partnerName || 'Partner';
    const av = window.S.partnerAvatar;
    el.innerHTML = `<div class="call-bg-blur"></div>
      <div class="call-content">
        <div class="call-status-label">${incoming ? (type==='video'?'Incoming video call':'Incoming voice call') : (type==='video'?'Calling...':'Calling...')}</div>
        <div class="call-avatar-ring pulse">
          <div class="call-avatar">${av ? `<img src="${av}" style="width:100%;height:100%;object-fit:cover">` : name[0]}</div>
        </div>
        <div class="call-partner-name">${esc(name)}</div>
        <div class="call-sub">${type==='video'?'📹 Video call':'🎙️ Voice call'}</div>
        <div class="call-controls ${incoming?'call-controls-incoming':''}">
          ${incoming ? `
            <button class="call-btn call-btn-decline" onclick="Call.declineCall()">📵</button>
            <button class="call-btn call-btn-accept" onclick="Call.acceptCall()">${type==='video'?'📹':'📞'}</button>
          ` : `<button class="call-btn call-btn-end" onclick="Call.endCall()">📵</button>`}
        </div>
      </div>`;
  }

  function renderActive() {
    const el = ensureOverlay();
    const name = window.S.partnerName || 'Partner';
    if (callType === 'video') {
      el.classList.add('call-active-video');
      el.innerHTML = `<div class="call-topbar"><span class="call-name-pill">${esc(name)} · <span id="callTimer">00:00</span></span></div>
        <video id="callRemoteVideo" class="call-remote-video" autoplay playsinline></video>
        <video id="callLocalVideo" class="call-local-video" autoplay playsinline muted></video>
        ${controlsHtml(true)}`;
      document.getElementById('callRemoteVideo').srcObject = remoteStream;
      document.getElementById('callLocalVideo').srcObject = localStream;
    } else {
      el.classList.remove('call-active-video');
      const av = window.S.partnerAvatar;
      el.innerHTML = `<div class="call-bg-blur"></div>
        <div class="call-content">
          <div class="call-status-label">Connected</div>
          <div class="call-avatar-ring connected"><div class="call-avatar">${av?`<img src="${av}" style="width:100%;height:100%;object-fit:cover">`:name[0]}</div></div>
          <div class="call-partner-name">${esc(name)}</div>
          <div class="call-sub" id="callTimer">00:00</div>
          ${controlsHtml(false)}
        </div>`;
      const remoteAudio = document.createElement('audio');
      remoteAudio.id = 'callRemoteAudio'; remoteAudio.autoplay = true; remoteAudio.srcObject = remoteStream;
      el.appendChild(remoteAudio);
    }
    startTimer();
  }

  function controlsHtml(video) {
    return `<div class="call-controls call-controls-active">
      <button class="call-btn call-btn-sm" id="muteBtn" onclick="Call.toggleMute()">🎙️</button>
      ${video ? `<button class="call-btn call-btn-sm" id="camBtn" onclick="Call.toggleCam()">📹</button>
      <button class="call-btn call-btn-sm" onclick="Call.flipCamera()">🔄</button>` : `<button class="call-btn call-btn-sm" id="speakerBtn" onclick="Call.toggleSpeaker()">🔊</button>`}
      <button class="call-btn call-btn-end" onclick="Call.endCall()">📵</button>
    </div>`;
  }

  function startTimer() {
    seconds = 0;
    if (timerInt) clearInterval(timerInt);
    timerInt = setInterval(() => {
      seconds++;
      const t = document.getElementById('callTimer');
      if (t) t.textContent = String(Math.floor(seconds/60)).padStart(2,'0') + ':' + String(seconds%60).padStart(2,'0');
    }, 1000);
  }

  // ─── CALL FLOW ───────────────────────────────────────
  async function startCall(type) {
    if (!coupleId()) { toast('Not connected'); return; }
    callType = type; isCaller = true;
    renderRinging(type, false);
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' });
    } catch (e) { toast('Camera/mic permission denied'); cleanup(); return; }
    await setupPeer();
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await pushSignal({ type: 'offer', sdp: offer, callType: type });
    startPolling();
  }

  let pendingOffer = null;
  function showIncoming(m) {
    pendingOffer = m;
    callType = m.callType || 'voice';
    isCaller = false;
    renderRinging(callType, true);
    startPolling();
    if (navigator.vibrate) navigator.vibrate([200,100,200,100,400]);
  }

  async function acceptCall() {
    if (!pendingOffer) return;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: callType === 'video' });
    } catch (e) { toast('Permission denied'); declineCall(); return; }
    await setupPeer();
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    await pc.setRemoteDescription(new RTCSessionDescription(pendingOffer.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await pushSignal({ type: 'answer', sdp: answer });
    onConnecting();
  }
  function declineCall() {
    pushSignal({ type: 'decline' });
    logCall('declined');
    cleanup();
  }

  async function setupPeer() {
    const iceServers = await getIceServers();
    pc = new RTCPeerConnection({ iceServers });
    remoteStream = new MediaStream();
    pc.ontrack = e => { e.streams[0].getTracks().forEach(t => remoteStream.addTrack(t)); if (document.getElementById('callRemoteVideo')) document.getElementById('callRemoteVideo').srcObject = remoteStream; if (document.getElementById('callRemoteAudio')) document.getElementById('callRemoteAudio').srcObject = remoteStream; };
    pc.onicecandidate = e => { if (e.candidate) pushSignal({ type: 'ice', candidate: e.candidate }); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') renderActive();
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        toast('Connection lost — reconnecting...');
      }
    };
  }
  function onConnecting() { const lbl = document.querySelector('.call-status-label'); if (lbl) lbl.textContent = 'Connecting...'; }

  function toggleMute() {
    if (!localStream) return;
    const track = localStream.getAudioTracks()[0];
    track.enabled = !track.enabled;
    document.getElementById('muteBtn')?.classList.toggle('call-btn-active', !track.enabled);
  }
  function toggleCam() {
    if (!localStream) return;
    const track = localStream.getVideoTracks()[0]; if (!track) return;
    track.enabled = !track.enabled;
    document.getElementById('camBtn')?.classList.toggle('call-btn-active', !track.enabled);
  }
  function toggleSpeaker() { document.getElementById('speakerBtn')?.classList.toggle('call-btn-active'); }
  async function flipCamera() {
    if (!localStream) return;
    const track = localStream.getVideoTracks()[0]; if (!track) return;
    const cur = track.getSettings().facingMode;
    track.stop();
    const newStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: cur === 'user' ? 'environment' : 'user' }, audio: false });
    const newTrack = newStream.getVideoTracks()[0];
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) sender.replaceTrack(newTrack);
    localStream.removeTrack(track); localStream.addTrack(newTrack);
    document.getElementById('callLocalVideo').srcObject = localStream;
  }

  function endCall(notify = true) {
    if (notify) pushSignal({ type: 'end' });
    logCall('ended', seconds);
    cleanup();
  }
  function cleanup() {
    if (pc) { pc.close(); pc = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    remoteStream = null;
    if (timerInt) clearInterval(timerInt);
    if (pollInterval) clearInterval(pollInterval);
    closeOverlay();
    pendingOffer = null;
  }
  async function logCall(status, duration) {
    if (!coupleId()) return;
    try { await api('POST', '/api/call/log', { coupleId: coupleId(), callerRole: isCaller ? myRole() : otherRole(), type: callType, status, duration: duration || 0 }); } catch (e) {}
  }

  // background listener for incoming calls even outside chat page
  function initGlobalListener() { startPolling(); }
  document.addEventListener('DOMContentLoaded', () => setTimeout(initGlobalListener, 1500));

  return { startCall, acceptCall, declineCall, endCall, toggleMute, toggleCam, toggleSpeaker, flipCamera };
})();
window.Call = Call;