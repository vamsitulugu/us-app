/*public/chat/call.js*/

const Call = (function () {
  let pc, localStream, remoteStream, callType, isCaller = false;
  let timerInt, seconds = 0;
  let pollInterval;
  let isMuted = false, isCamOff = false, isSpeakerOn = true;

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

  function renderRinging(type, incoming) {
    const el = ensureOverlay();
    el.classList.remove('call-active-video');
    const name = window.S.partnerName || 'Partner';
    const av = window.S.partnerAvatar;

    el.innerHTML = `
      <div class="call-bg-blur"></div>
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
        <div class="call-topbar"><span class="call-name-pill">${esc(name)} · <span id="callTimer">00:00</span></span></div>
        <video id="callRemoteVideo" class="call-remote-video" autoplay playsinline></video>
        <video id="callLocalVideo" class="call-local-video" autoplay playsinline muted></video>
        ${controlsHtml(true)}`;
      document.getElementById('callRemoteVideo').srcObject = remoteStream;
      document.getElementById('callLocalVideo').srcObject = localStream;
    } else {
      el.classList.remove('call-active-video');
      const av = window.S.partnerAvatar;
      el.innerHTML = `
        <div class="call-bg-blur"></div>
        <div class="call-content">
          <div class="call-status-label">Connected</div>
          <div class="call-avatar-ring connected"><div class="call-avatar">${avatarHtml(name, av)}</div></div>
          <div class="call-partner-name">${esc(name)}</div>
          <div class="call-sub" id="callTimer">00:00</div>
        </div>
        ${controlsHtml(false)}`;
      const remoteAudio = document.createElement('audio');
      remoteAudio.id = 'callRemoteAudio'; remoteAudio.autoplay = true; remoteAudio.srcObject = remoteStream;
      el.appendChild(remoteAudio);
    }
    startTimer();
  }

  function controlsHtml(video) {
    return `<div class="call-controls call-controls-active">
      <button type="button" class="call-btn call-btn-sm" id="muteBtn" onclick="Call.toggleMute()" title="Mute">
        <span id="muteIcon">🎙️</span>
      </button>
      ${video
        ? `<button type="button" class="call-btn call-btn-sm" id="camBtn" onclick="Call.toggleCam()" title="Camera">
             <span id="camIcon">📹</span>
           </button>
           <button type="button" class="call-btn call-btn-sm" id="flipBtn" onclick="Call.flipCamera()" title="Flip camera">🔄</button>`
        : `<button type="button" class="call-btn call-btn-sm" id="speakerBtn" onclick="Call.toggleSpeaker()" title="Speaker">
             <span id="speakerIcon">🔊</span>
           </button>`}
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
  }

  function toggleCam() {
    if (!localStream) return;
    const track = localStream.getVideoTracks()[0];
    if (!track) return;
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

  function startTimer() {
    seconds = 0;
    if (timerInt) clearInterval(timerInt);
    timerInt = setInterval(() => {
      seconds++;
      const t = document.getElementById('callTimer');
      if (t) t.textContent = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
    }, 1000);
  }

  // ─── CALL FLOW ───────────────────────────────────────
  async function startCall(type) {
    if (!coupleId()) { toast('Not connected to a partner yet'); return; }
    if (!S.paired) { toast('⚠️ Your partner hasn\'t joined yet — pair first'); return; }
    callType = type; isCaller = true;
    isMuted = false; isCamOff = false; isSpeakerOn = true;
    renderRinging(type, false);
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' });
    } catch (e) { toast('Camera/mic permission denied'); cleanup(); return; }
    await setupPeer();
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await pushSignal({ type: 'offer', sdp: offer, callType: type, ts: Date.now() });
    try { await api('POST', '/api/call/notify', { coupleId: coupleId(), callerRole: myRole(), type }); } catch (e) {}
    startPolling();
  }

  let pendingOffer = null;
  function showIncoming(m) {
    pendingOffer = m;
    callType = m.callType || 'voice';
    isCaller = false;
    renderRinging(callType, true);
    startPolling();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
  }

  async function acceptCall() {
    if (!pendingOffer) return;
    isMuted = false; isCamOff = false; isSpeakerOn = true;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: callType === 'video' });
    } catch (e) { toast('Permission denied'); declineCall(); return; }
    await setupPeer();
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    await pc.setRemoteDescription(new RTCSessionDescription(pendingOffer.sdp));
    for (const cand of iceQueue) { try { await pc.addIceCandidate(cand); } catch (e) {} }
    iceQueue = [];
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
    pc.ontrack = e => {
      e.streams[0].getTracks().forEach(t => remoteStream.addTrack(t));
      if (document.getElementById('callRemoteVideo')) document.getElementById('callRemoteVideo').srcObject = remoteStream;
      if (document.getElementById('callRemoteAudio')) document.getElementById('callRemoteAudio').srcObject = remoteStream;
    };
    pc.onicecandidate = e => { if (e.candidate) pushSignal({ type: 'ice', candidate: e.candidate }); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') renderActive();
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
    if (pc) { pc.close(); pc = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    remoteStream = null;
    iceQueue = [];
    if (timerInt) clearInterval(timerInt);
    if (pollInterval) clearInterval(pollInterval);
    closeOverlay();
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
  return { startCall, acceptCall, declineCall, endCall, toggleMute, toggleCam, toggleSpeaker, flipCamera };
})();
window.Call = Call;