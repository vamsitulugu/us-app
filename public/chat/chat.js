/*public/chat/chat.js*/
'use strict';

const Call = (() => {
  const API = (typeof window !== 'undefined' && window.API) ? window.API : 'https://us-app-api.onrender.com';

  let pc = null;                 // RTCPeerConnection
  let localStream = null;
  let remoteStream = null;
  let sbChannel = null;
  let callState = 'idle';        // idle | ringing-out | ringing-in | connected
  let callType = 'voice';        // voice | video
  let callStartTs = 0;
  let durationInterval = null;
  let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  let ringtoneAudio = null;
  let pendingCandidates = [];
  let isCaller = false;

  function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function myRole() { return window.S?.role || 'user1'; }
  function otherRole() { return myRole() === 'user1' ? 'user2' : 'user1'; }
  function coupleId() { return window.S?.coupleId; }

  /* ══════════════════════════════════════════════════════════════
     SIGNALING — Supabase Realtime Broadcast channel
  ══════════════════════════════════════════════════════════════ */
  function ensureChannel() {
    if (sbChannel || !window.supabase || !window.__SUPABASE_URL__) return sbChannel;
    const sb = window.supabase.createClient(window.__SUPABASE_URL__, window.__SUPABASE_ANON_KEY__);
    sbChannel = sb.channel('call-' + coupleId(), { config: { broadcast: { self: false } } });
    sbChannel.on('broadcast', { event: 'signal' }, ({ payload }) => handleSignal(payload));
    sbChannel.subscribe();
    return sbChannel;
  }

  function sendSignal(type, data) {
    ensureChannel();
    if (!sbChannel) return;
    sbChannel.send({ type: 'broadcast', event: 'signal', payload: { type, from: myRole(), ...data } });
  }

  async function handleSignal(msg) {
    if (!msg || msg.from === myRole()) return;
    switch (msg.type) {
      case 'call-offer':
        if (callState !== 'idle') { sendSignal('call-busy', {}); return; }
        callType = msg.callType || 'voice';
        isCaller = false;
        await showIncomingCall(msg.offer);
        break;
      case 'call-answer':
        if (pc && msg.answer) await pc.setRemoteDescription(new RTCSessionDescription(msg.answer));
        flushPendingCandidates();
        onCallConnected();
        break;
      case 'ice-candidate':
        if (pc && msg.candidate) {
          try { await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); }
          catch (e) { pendingCandidates.push(msg.candidate); }
        }
        break;
      case 'call-decline':
        toast('📵 ' + (window.S?.partnerName || 'Partner') + ' declined the call');
        logCall(callType, 'declined');
        cleanup();
        break;
      case 'call-busy':
        toast('📵 ' + (window.S?.partnerName || 'Partner') + ' is on another call');
        cleanup();
        break;
      case 'call-end':
        endCallUI('ended-remote');
        break;
      case 'call-cancel':
        hideIncomingCall();
        logCall(callType, 'missed');
        cleanup();
        break;
    }
  }

  function flushPendingCandidates() {
    pendingCandidates.forEach(c => pc?.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));
    pendingCandidates = [];
  }

  /* ══════════════════════════════════════════════════════════════
     TURN CREDS
  ══════════════════════════════════════════════════════════════ */
  async function loadTurnCreds() {
    try {
      const r = await fetch(API + '/api/call/turn-creds');
      const data = await r.json();
      iceServers = data.iceServers || iceServers;
    } catch (e) { /* fallback stun already set */ }
  }

  /* ══════════════════════════════════════════════════════════════
     STARTING A CALL (caller side)
  ══════════════════════════════════════════════════════════════ */
  async function startCall(type) {
    if (!window.S?.paired) { toast('Pair with your partner first 💕'); return; }
    if (callState !== 'idle') { toast('Already in a call'); return; }
    await loadTurnCreds();
    ensureChannel();
    callType = type; isCaller = true;
    callState = 'ringing-out';

    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true, video: type === 'video' ? { facingMode: 'user' } : false
      });
    } catch (e) {
      toast('Camera/mic permission denied'); cleanup(); return;
    }

    buildPeerConnection();
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal('call-offer', { offer, callType: type });

    showOutgoingCallUI();
    playRingtone('outgoing');

    // Auto-cancel after 35s if unanswered
    _ringTimeout = setTimeout(() => { if (callState === 'ringing-out') { sendSignal('call-cancel', {}); logCall(callType, 'missed'); cleanup(); toast('No answer'); } }, 35000);
  }
  let _ringTimeout = null;

  /* ══════════════════════════════════════════════════════════════
     RECEIVING A CALL (callee side)
  ══════════════════════════════════════════════════════════════ */
  let _incomingOffer = null;
  async function showIncomingCall(offer) {
    callState = 'ringing-in';
    _incomingOffer = offer;
    await loadTurnCreds();
    playRingtone('incoming');
    if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]);
    renderIncomingOverlay();
    if (typeof window.fireBackgroundNotification === 'function') {
      window.fireBackgroundNotification(
        (callType === 'video' ? '📹 Video' : '🎙️ Voice') + ' call from ' + (window.S?.partnerName || 'Partner'),
        'Tap to answer'
      );
    }
  }

  async function acceptCall() {
    stopRingtone();
    hideIncomingCall();
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true, video: callType === 'video' ? { facingMode: 'user' } : false
      });
    } catch (e) { toast('Camera/mic permission denied'); sendSignal('call-decline', {}); cleanup(); return; }

    buildPeerConnection();
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    await pc.setRemoteDescription(new RTCSessionDescription(_incomingOffer));
    flushPendingCandidates();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendSignal('call-answer', { answer });

    onCallConnected();
  }

  function declineCall() {
    stopRingtone();
    hideIncomingCall();
    sendSignal('call-decline', {});
    logCall(callType, 'declined');
    cleanup();
  }

  /* ══════════════════════════════════════════════════════════════
     PEER CONNECTION
  ══════════════════════════════════════════════════════════════ */
  function buildPeerConnection() {
    pc = new RTCPeerConnection({ iceServers });
    remoteStream = new MediaStream();

    pc.onicecandidate = (e) => { if (e.candidate) sendSignal('ice-candidate', { candidate: e.candidate }); };
    pc.ontrack = (e) => { e.streams[0].getTracks().forEach(t => remoteStream.addTrack(t)); attachRemoteStream(); };
    pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState) && callState === 'connected') {
        toast('Call connection lost'); endCallUI('failed');
      }
    };
  }

  function onCallConnected() {
    clearTimeout(_ringTimeout);
    stopRingtone();
    callState = 'connected';
    callStartTs = Date.now();
    renderInCallUI();
    durationInterval = setInterval(updateDurationLabel, 1000);
    if (typeof window.spawnPetals === 'function') window.spawnPetals(4);
  }

  /* ══════════════════════════════════════════════════════════════
     HANG UP
  ══════════════════════════════════════════════════════════════ */
  function hangUp() {
    const dur = callStartTs ? Math.floor((Date.now() - callStartTs) / 1000) : 0;
    sendSignal('call-end', {});
    logCall(callType, dur > 0 ? 'ended' : 'missed', dur);
    endCallUI('ended-local');
  }
  function endCallUI() {
    cleanup();
  }
  function cleanup() {
    clearTimeout(_ringTimeout);
    clearInterval(durationInterval); durationInterval = null;
    stopRingtone();
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    if (pc) { pc.close(); pc = null; }
    remoteStream = null;
    callState = 'idle'; callStartTs = 0; isCaller = false; _incomingOffer = null;
    pendingCandidates = [];
    removeAllCallUI();
  }

  async function logCall(type, status, duration) {
    if (!coupleId()) return;
    try {
      await fetch(API + '/api/call/log', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coupleId: coupleId(), callerRole: myRole(), type, status, duration })
      });
      if (typeof window.Chat?.refresh === 'function') window.Chat.refresh();
    } catch (e) {}
  }

  /* ══════════════════════════════════════════════════════════════
     RINGTONE (Web Audio, no files needed)
  ══════════════════════════════════════════════════════════════ */
  function playRingtone(kind) {
    stopRingtone();
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      ringtoneAudio = { ctx, interval: null, stopped: false };
      const pattern = kind === 'incoming' ? [0, 0.3] : [0, 1.0];
      function ring() {
        if (ringtoneAudio.stopped) return;
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.value = kind === 'incoming' ? 880 : 440;
        g.gain.setValueAtTime(0.001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.05);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + pattern[1]);
        o.start(); o.stop(ctx.currentTime + pattern[1] + 0.05);
      }
      ring();
      ringtoneAudio.interval = setInterval(ring, kind === 'incoming' ? 1500 : 2500);
    } catch (e) {}
  }
  function stopRingtone() {
    if (ringtoneAudio) { ringtoneAudio.stopped = true; clearInterval(ringtoneAudio.interval); try { ringtoneAudio.ctx.close(); } catch (e) {} ringtoneAudio = null; }
  }

  /* ══════════════════════════════════════════════════════════════
     UI — outgoing / incoming / in-call overlays
  ══════════════════════════════════════════════════════════════ */
  function removeAllCallUI() {
    document.getElementById('callOverlay')?.remove();
  }

  function partnerAvatarHtml() {
    const src = window.S?.partnerAvatar;
    const name = (window.S?.partnerName || 'P')[0];
    return src ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : name;
  }

  function showOutgoingCallUI() {
    removeAllCallUI();
    const el = document.createElement('div');
    el.id = 'callOverlay';
    el.className = 'call-overlay';
    el.innerHTML = `
      <div class="call-bg-blur"></div>
      <div class="call-content">
        <div class="call-status-label">${callType === 'video' ? '📹 Video calling…' : '🎙️ Calling…'}</div>
        <div class="call-avatar-ring"><div class="call-avatar">${partnerAvatarHtml()}</div></div>
        <div class="call-partner-name">${esc(window.S?.partnerName || 'Partner')}</div>
        <div class="call-sub">Ringing...</div>
        <div class="call-controls">
          <button class="call-btn call-btn-end" onclick="Call.hangUp()">📵</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('open'));
  }

  function renderIncomingOverlay() {
    removeAllCallUI();
    const el = document.createElement('div');
    el.id = 'callOverlay';
    el.className = 'call-overlay call-incoming';
    el.innerHTML = `
      <div class="call-bg-blur"></div>
      <div class="call-content">
        <div class="call-status-label">${callType === 'video' ? '📹 Incoming Video Call' : '🎙️ Incoming Call'}</div>
        <div class="call-avatar-ring pulse"><div class="call-avatar">${partnerAvatarHtml()}</div></div>
        <div class="call-partner-name">${esc(window.S?.partnerName || 'Partner')}</div>
        <div class="call-sub">is calling you...</div>
        <div class="call-controls call-controls-incoming">
          <button class="call-btn call-btn-decline" onclick="Call.decline()">✕</button>
          <button class="call-btn call-btn-accept" onclick="Call.accept()">📞</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('open'));
  }
  function hideIncomingCall() { removeAllCallUI(); }

  function renderInCallUI() {
    removeAllCallUI();
    const el = document.createElement('div');
    el.id = 'callOverlay';
    el.className = 'call-overlay call-active-' + callType;
    el.innerHTML = callType === 'video' ? `
      <video id="callRemoteVideo" class="call-remote-video" autoplay playsinline></video>
      <video id="callLocalVideo" class="call-local-video" autoplay playsinline muted></video>
      <div class="call-topbar">
        <div class="call-name-pill">${esc(window.S?.partnerName || 'Partner')} · <span id="callDurLabel">00:00</span></div>
      </div>
      <div class="call-controls call-controls-active">
        <button class="call-btn call-btn-sm" id="callMuteBtn" onclick="Call.toggleMute()">🎙️</button>
        <button class="call-btn call-btn-sm" id="callCamBtn" onclick="Call.toggleCamera()">📷</button>
        <button class="call-btn call-btn-sm" onclick="Call.switchCamera()">🔄</button>
        <button class="call-btn call-btn-end" onclick="Call.hangUp()">📵</button>
      </div>` : `
      <div class="call-bg-blur"></div>
      <div class="call-content">
        <div class="call-status-label">🎙️ Voice Call</div>
        <div class="call-avatar-ring connected"><div class="call-avatar">${partnerAvatarHtml()}</div></div>
        <div class="call-partner-name">${esc(window.S?.partnerName || 'Partner')}</div>
        <div class="call-sub" id="callDurLabel">00:00</div>
        <audio id="callRemoteAudio" autoplay></audio>
        <div class="call-controls call-controls-active">
          <button class="call-btn call-btn-sm" id="callMuteBtn" onclick="Call.toggleMute()">🎙️</button>
          <button class="call-btn call-btn-end" onclick="Call.hangUp()">📵</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('open'));
    attachLocalStream();
    attachRemoteStream();
  }

  function attachLocalStream() {
    if (callType !== 'video' || !localStream) return;
    const v = document.getElementById('callLocalVideo');
    if (v) v.srcObject = localStream;
  }
  function attachRemoteStream() {
    if (!remoteStream) return;
    if (callType === 'video') {
      const v = document.getElementById('callRemoteVideo');
      if (v) v.srcObject = remoteStream;
    } else {
      const a = document.getElementById('callRemoteAudio');
      if (a) a.srcObject = remoteStream;
    }
  }
  function updateDurationLabel() {
    const el = document.getElementById('callDurLabel');
    if (!el || !callStartTs) return;
    const sec = Math.floor((Date.now() - callStartTs) / 1000);
    el.textContent = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
  }

  /* ── in-call controls ── */
  let muted = false, camOff = false, facingMode = 'user';
  function toggleMute() {
    if (!localStream) return;
    muted = !muted;
    localStream.getAudioTracks().forEach(t => t.enabled = !muted);
    const btn = document.getElementById('callMuteBtn'); if (btn) btn.classList.toggle('call-btn-active', muted);
    if (btn) btn.innerHTML = muted ? '🔇' : '🎙️';
  }
  function toggleCamera() {
    if (!localStream || callType !== 'video') return;
    camOff = !camOff;
    localStream.getVideoTracks().forEach(t => t.enabled = !camOff);
    const btn = document.getElementById('callCamBtn'); if (btn) btn.classList.toggle('call-btn-active', camOff);
    if (btn) btn.innerHTML = camOff ? '🚫' : '📷';
  }
  async function switchCamera() {
    if (!localStream || callType !== 'video') return;
    facingMode = facingMode === 'user' ? 'environment' : 'user';
    const oldTrack = localStream.getVideoTracks()[0];
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode } });
      const newTrack = newStream.getVideoTracks()[0];
      const sender = pc?.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) await sender.replaceTrack(newTrack);
      localStream.removeTrack(oldTrack); oldTrack.stop();
      localStream.addTrack(newTrack);
      attachLocalStream();
    } catch (e) { toast('Could not switch camera'); }
  }

  function toast(msg, dur) { if (typeof window.toast === 'function') window.toast(msg, dur); }

  /* ══════════════════════════════════════════════════════════════
     INIT — listen for incoming calls app-wide
  ══════════════════════════════════════════════════════════════ */
  function init() {
    if (!coupleId()) { setTimeout(init, 800); return; }
    ensureChannel();
  }

  return {
    init, startCall, accept: acceptCall, decline: declineCall, hangUp,
    toggleMute, toggleCamera, switchCamera,
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  const tryInit = () => {
    if (typeof window.S === 'undefined') { setTimeout(tryInit, 500); return; }
    Call.init();
  };
  setTimeout(tryInit, 1500);
});