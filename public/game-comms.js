/* ═══════════════════════════════════════════════════════════════
   GAME COMMS — voice call + chat (text & voice messages)
   Works inside EVERY game, because it hooks into the shared game
   overlay (#goverlay) rather than into any single game.

   1) GameVoice — audio-only call between the two partners.
      • Header 📞 button turns it on / off.
      • While on, a tiny floating pill shows ONLY: mute · speaker · end.
      • Reuses /api/call/turn-creds and /api/call/signal (same as the
        face-to-face video), tagged gameCtx:'v:<game>' so it never
        collides with chat calls or the video call.

   2) GameChat — 💬 button opens a bottom sheet with:
      • normal text messages
      • ONE 🎙️ button to record + send voice messages
      Messages sync through the existing games state API using two
      per-player keys (gm_gchat_u1 / gm_gchat_u2). Voice clips go to
      the existing /api/media/upload-voice endpoint. No backend change.

   Hooks (in games.html): Hub.openGame → GameComms.onOpen(gid)
                          Hub.exitGame → GameComms.onExit()
═══════════════════════════════════════════════════════════════ */
(function () {
'use strict';
if (window.GameComms) return;

const $ = (id) => document.getElementById(id);
const partner = () => (window.ID && ID.partnerName) || 'Partner';
const isSolo = () => String(ID.coupleId).indexOf('solo_') === 0;
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const svg = (inner) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
const ICON = {
  mic: svg('<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'),
  micOff: svg('<line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'),
  vol2: svg('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>'),
  vol1: svg('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>'),
  endCall: svg('<path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/><line x1="23" y1="1" x2="1" y2="23"/>'),
  play: svg('<polygon points="6 3 20 12 6 21 6 3" fill="currentColor"/>'),
  pause: svg('<rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/>'),
  send: svg('<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2" fill="currentColor"/>'),
  trash: svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'),
  close: svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>')
};

/* ───────────────────────── CSS ───────────────────────── */
const css = `
/* header buttons */
#goVoiceBtn,#goChatBtn{position:relative}
#goChatBtn{border-color:rgba(255,120,190,.45);background:rgba(255,120,190,.15);color:#ffb3da}
#goVoiceBtn.on{background:linear-gradient(135deg,#10b981,#047857);color:#fff;border-color:transparent;box-shadow:0 0 0 3px rgba(16,185,129,.3)}
#goChatBtn.on{background:linear-gradient(135deg,#d11a95,#7a0b45);color:#fff;border-color:transparent;box-shadow:0 0 0 3px rgba(209,26,149,.3)}
#goVoiceBtn.gc-ring{animation:gcRing .9s ease-in-out infinite}
.gc-badge{position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;padding:0 4px;border-radius:9px;background:#ef4444;color:#fff;font-size:10px;font-weight:800;display:none;align-items:center;justify-content:center;line-height:1;border:1.5px solid #14090f}
.gc-badge.show{display:flex}
.gohead{gap:6px}
@media(max-width:430px){#goXpChip{display:none}}
@keyframes gcRing{0%,100%{transform:scale(1)}50%{transform:scale(1.18)}}

/* voice pill: mute · speaker · end — nothing else */
.gcv-pill{position:fixed;z-index:3500;top:calc(env(safe-area-inset-top,0px) + 108px);right:10px;display:flex;gap:8px;padding:7px;border-radius:32px;background:rgba(24,10,18,.9);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.2);box-shadow:0 10px 30px rgba(0,0,0,.5);touch-action:none;cursor:grab;user-select:none}
.gcv-pill.connecting{animation:gcvPulse 1.3s ease-in-out infinite}
.gcv-pill.active{border-color:rgba(52,211,153,.7);box-shadow:0 0 0 3px rgba(52,211,153,.18),0 10px 30px rgba(0,0,0,.5)}
@keyframes gcvPulse{0%,100%{border-color:rgba(251,191,36,.9)}50%{border-color:rgba(251,191,36,.2)}}
.gcv-btn{width:40px;height:40px;border-radius:50%;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.12);color:#fff;display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer}
.gcv-btn svg{width:20px;height:20px}
.gcv-btn.muted{background:#f87171;border-color:transparent}
.gcv-btn.spk-on{background:rgba(52,211,153,.28);border-color:rgba(52,211,153,.65)}
.gcv-btn.end{background:#ef4444;border-color:transparent}

/* chat sheet */
#gcSheet{position:fixed;left:0;right:0;bottom:0;z-index:3600;display:none;flex-direction:column;height:min(52vh,440px);height:min(52dvh,440px);max-width:560px;margin:0 auto;background:linear-gradient(180deg,rgba(34,12,26,.97),rgba(18,8,14,.985));border:1px solid rgba(255,255,255,.16);border-bottom:none;border-radius:22px 22px 0 0;box-shadow:0 -14px 40px rgba(0,0,0,.55);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);color:#fff;font-family:var(--ff-sans,system-ui,sans-serif);padding-bottom:env(safe-area-inset-bottom,0px)}
#gcSheet.open{display:flex;animation:gcUp .26s cubic-bezier(.2,.9,.3,1)}
@keyframes gcUp{from{transform:translateY(40px);opacity:0}to{transform:none;opacity:1}}
#gcSheet .gc-head{display:flex;align-items:center;gap:8px;padding:12px 14px 8px;flex-shrink:0}
#gcSheet .gc-title{flex:1;font-weight:800;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#gcSheet .gc-x{width:30px;height:30px;border-radius:50%;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.1);color:#fff;display:flex;align-items:center;justify-content:center;padding:0}
#gcSheet .gc-x svg{width:15px;height:15px}
#gcSheet .gc-list{flex:1;overflow-y:auto;padding:6px 12px 10px;display:flex;flex-direction:column;gap:7px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
#gcSheet .gc-empty{margin:auto;text-align:center;font-size:14px;opacity:.8;line-height:1.7}
#gcSheet .gc-empty span{font-size:11.5px;opacity:.7}
#gcSheet .gc-row{display:flex;flex-direction:column;max-width:84%}
#gcSheet .gc-row.me{align-self:flex-end;align-items:flex-end}
#gcSheet .gc-row.them{align-self:flex-start;align-items:flex-start}
#gcSheet .gc-bub{padding:8px 12px;border-radius:17px;font-size:14px;line-height:1.4;word-break:break-word;white-space:pre-wrap;user-select:text;-webkit-user-select:text}
#gcSheet .me .gc-bub{background:linear-gradient(135deg,#d11a95,#7a0b45);border-bottom-right-radius:5px}
#gcSheet .them .gc-bub{background:rgba(255,255,255,.13);border-bottom-left-radius:5px}
#gcSheet .gc-voice{display:flex;align-items:center;gap:9px;min-width:176px;padding:7px 12px 7px 8px;white-space:normal}
#gcSheet .gc-play{width:32px;height:32px;border-radius:50%;border:none;background:rgba(255,255,255,.24);color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0}
#gcSheet .gc-play svg{width:13px;height:13px}
#gcSheet .gc-wave{flex:1;height:5px;border-radius:5px;background:rgba(255,255,255,.24);overflow:hidden}
#gcSheet .gc-wave i{display:block;height:100%;width:0;background:#fff;border-radius:5px;transition:width .25s linear}
#gcSheet .gc-dur{font-size:11px;opacity:.9;font-variant-numeric:tabular-nums}
#gcSheet .gc-meta{font-size:10px;opacity:.55;margin-top:2px;padding:0 4px;display:flex;gap:6px;align-items:center}
#gcSheet .gc-retry{border:none;background:none;color:#fca5a5;font-size:10.5px;font-weight:700;padding:0}
#gcSheet .gc-composer{display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid rgba(255,255,255,.1);flex-shrink:0}
#gcSheet .gc-input{flex:1;min-width:0;height:42px;border-radius:21px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#fff;padding:0 16px;font-size:16px;outline:none;font-family:inherit}
#gcSheet .gc-input::placeholder{color:rgba(255,255,255,.45)}
#gcSheet .gc-input:focus{border-color:rgba(255,120,190,.7)}
#gcSheet .gc-ibtn{width:42px;height:42px;border-radius:50%;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.12);color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0}
#gcSheet .gc-ibtn svg{width:19px;height:19px}
#gcSheet .gc-ibtn.send{background:linear-gradient(135deg,#d11a95,#7a0b45);border-color:transparent}
#gcSheet .gc-recbar{display:none;align-items:center;gap:12px;padding:10px 12px;border-top:1px solid rgba(255,255,255,.1);flex-shrink:0}
#gcSheet.rec .gc-composer{display:none}
#gcSheet.rec .gc-recbar{display:flex}
#gcSheet .gc-recdot{width:11px;height:11px;border-radius:50%;background:#ef4444;animation:gcBlink 1s ease-in-out infinite}
@keyframes gcBlink{0%,100%{opacity:1}50%{opacity:.25}}
#gcSheet .gc-rectime{font-weight:800;font-size:15px;font-variant-numeric:tabular-nums}
#gcSheet .gc-rechint{flex:1;font-size:11.5px;opacity:.6}
#gcSheet .gc-ibtn.cancel{color:#fca5a5;border-color:rgba(248,113,113,.5);background:rgba(248,113,113,.14)}
`;
const st = document.createElement('style');
st.id = 'gameCommsCss';
st.textContent = css;
document.head.appendChild(st);

/* ═══════════════════════ 1) VOICE CALL ═══════════════════════ */
const GameVoice = {
  gid: null, state: 'idle',            // idle | ringing | connecting | active
  callId: null, isCaller: false,
  pc: null, stream: null, audioEl: null,
  muted: false, speakerOn: true,
  cursor: 0, pollTimer: null, polling: false, ready: false,
  iceBuf: {}, offerMsg: null, ringTimer: null, dropTimer: null,
  _q: Promise.resolve(), _pos: null,

  get active() { return this.state === 'connecting' || this.state === 'active'; },

  _ctx() { return 'v:' + this.gid; },
  _url(after) { return API + '/api/call/signal/' + encodeURIComponent(ID.coupleId) + '?role=' + otherRole + '&after=' + after; },
  _ck() { return 'gcv_cur_' + ID.coupleId + '_' + ID.role; },

  /* signals are posted through one queue so the offer always lands before its ICE candidates */
  _send(msg, callId) {
    const body = JSON.stringify({
      coupleId: ID.coupleId, role: ID.role,
      payload: Object.assign({}, msg, { gameCtx: this._ctx(), callId: callId || this.callId, ts: Date.now() })
    });
    this._q = this._q.then(() =>
      fetch(API + '/api/call/signal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(() => {})
    );
    return this._q;
  },

  /* ── lifecycle (called by Hub.openGame / Hub.exitGame) ── */
  async onOpen(gid) {
    if (this.gid === gid && this.pollTimer) return;
    this.gid = gid; this.ready = false;
    await this._initCursor();
    if (this.gid !== gid) return;
    this.ready = true;
    this._startPoll();
    this._ui();
  },
  onExit() {
    this.stop();
    this._unring();
    clearInterval(this.pollTimer); this.pollTimer = null;
    this.gid = null; this.ready = false;
  },

  /* start from "now": only signals sent after the game opened are considered */
  async _initCursor() {
    let after = parseInt(sessionStorage.getItem(this._ck()) || '0', 10) || 0, max = after;
    try {
      for (let i = 0; i < 40; i++) {
        const r = await fetch(this._url(after), { cache: 'no-store' });
        if (!r.ok) break;
        const rows = await r.json();
        if (!Array.isArray(rows) || !rows.length) break;
        max = Math.max.apply(null, [max].concat(rows.map((x) => x.id)));
        after = max;
        if (rows.length < 50) break;
      }
    } catch (e) {}
    this.cursor = max;
    try { sessionStorage.setItem(this._ck(), String(max)); } catch (e) {}
  },

  _startPoll() {
    clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this._poll(), 1000);
  },
  async _poll() {
    if (this.polling || !this.ready || !this.gid) return;
    this.polling = true;
    try {
      const r = await fetch(this._url(this.cursor), { cache: 'no-store' });
      if (!r.ok) return;
      const rows = await r.json();
      for (const row of rows) {
        this.cursor = Math.max(this.cursor, row.id);
        const m = row.payload;
        if (!m || m.gameCtx !== this._ctx()) continue;
        await this._handle(m);
      }
      try { sessionStorage.setItem(this._ck(), String(this.cursor)); } catch (e) {}
    } catch (e) {} finally { this.polling = false; }
  },

  async _handle(m) {
    switch (m.type) {
      case 'offer':
        if (this.state === 'idle') {
          if (window.GameVideo && GameVideo.active) { this._send({ type: 'decline' }, m.callId); return; }
          this._ring(m);
        } else if (this.state === 'ringing') {
          if (this.offerMsg && this.offerMsg.callId !== m.callId) this.offerMsg = m;   // partner re-called
        } else if (this.state === 'connecting' && this.isCaller && this.pc && this.pc.signalingState === 'have-local-offer') {
          // both of us tapped call at the same moment — user2 yields to user1's offer
          if (ID.role === 'user2') await this._takeOver(m);
        }
        break;
      case 'ice':
        if (!m.callId || !m.candidate) break;
        if (m.callId === this.callId && this.pc && this.pc.remoteDescription) {
          try { await this.pc.addIceCandidate(m.candidate); } catch (e) {}
        } else {
          const b = this.iceBuf[m.callId] || (this.iceBuf[m.callId] = []);
          if (b.length < 80) b.push(m.candidate);
        }
        break;
      case 'answer':
        if (m.callId === this.callId && this.isCaller && this.pc && this.pc.signalingState === 'have-local-offer') {
          try { await this.pc.setRemoteDescription(m.sdp); await this._flushIce(m.callId); } catch (e) {}
        }
        break;
      case 'end':
        if (this.state === 'ringing' && this.offerMsg && m.callId === this.offerMsg.callId) this._unring();
        else if (this.active && m.callId === this.callId) { toast(partner() + ' ended the voice call'); this._reset(); }
        break;
      case 'decline':
        if (this.isCaller && this.active && m.callId === this.callId) { toast(partner() + ' declined the voice call'); this._reset(); }
        break;
    }
  },

  async _flushIce(cid) {
    const list = this.iceBuf[cid] || []; delete this.iceBuf[cid];
    for (const c of list) { try { await this.pc.addIceCandidate(c); } catch (e) {} }
  },

  async _iceServers() {
    try {
      const r = await fetch(API + '/api/call/turn-creds');
      const d = await r.json();
      return (d.iceServers && d.iceServers.length) ? d.iceServers : [{ urls: 'stun:stun.l.google.com:19302' }];
    } catch (e) { return [{ urls: 'stun:stun.l.google.com:19302' }]; }
  },

  async _setupPeer() {
    const iceServers = await this._iceServers();
    const pc = new RTCPeerConnection({ iceServers });
    this.pc = pc;
    this.stream.getTracks().forEach((t) => pc.addTrack(t, this.stream));
    pc.ontrack = (e) => this._attachAudio(e.streams[0] || new MediaStream([e.track]));
    pc.onicecandidate = (e) => { if (e.candidate && this.pc === pc) this._send({ type: 'ice', candidate: e.candidate }); };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      const s = pc.connectionState;
      if (s === 'connected') {
        clearTimeout(this.dropTimer);
        if (this.state !== 'active') {
          this.state = 'active'; clearTimeout(this.ringTimer);
          this._ui(); toast('🎧 Voice connected');
        }
      } else if (s === 'disconnected') {
        clearTimeout(this.dropTimer);
        this.dropTimer = setTimeout(() => {
          if (this.pc === pc && pc.connectionState !== 'connected') { toast('Voice connection lost'); this.stop(); }
        }, 10000);
      } else if (s === 'failed') { toast('Voice connection failed'); this.stop(); }
    };
  },

  _attachAudio(stream) {
    if (!this.audioEl) {
      const a = document.createElement('audio');
      a.id = 'gcvAudio'; a.autoplay = true; a.setAttribute('playsinline', ''); a.style.display = 'none';
      document.body.appendChild(a); this.audioEl = a;
    }
    this.audioEl.srcObject = stream;
    this._applySpeaker();
    const p = this.audioEl.play();
    if (p && p.catch) p.catch(() => {
      toast('Tap anywhere to hear ' + partner());
      document.addEventListener('pointerdown', () => { if (this.audioEl) this.audioEl.play().catch(() => {}); }, { once: true });
    });
  },

  /* Speaker ON = full volume. OFF = quiet "earpiece-style" volume. (Browsers cannot truly switch the phone's
     earpiece/loudspeaker; setSinkId is tried where a browser supports it. The Android app can do real routing.) */
  _applySpeaker() {
    const a = this.audioEl; if (!a) return;
    a.volume = this.speakerOn ? 1 : 0.35;
    if (a.setSinkId) { a.setSinkId(this.speakerOn ? 'default' : 'communications').catch(() => {}); }
  },

  /* ── user actions ── */
  async toggle() {
    if (this.state === 'ringing') return;          // answer / decline on the card
    if (this.state !== 'idle') { this.stop(); return; }
    await this.start();
  },

  async start() {
    const gid = window.Hub && Hub.activeGameId;
    if (!gid || this.state !== 'idle') return;
    if (isSolo()) { toast('Connect with your partner to use voice 💗'); return; }
    if (window.GameVideo && GameVideo.active) { toast('📹 The video call already has voice'); return; }
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) || !window.RTCPeerConnection) { toast('Voice calls are not supported here'); return; }
    this.gid = gid;
    const cid = uid();
    this.callId = cid; this.isCaller = true; this.state = 'connecting'; this._ui();
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (this.callId !== cid) { s.getTracks().forEach((t) => t.stop()); return; }
      this.stream = s;
    } catch (e) {
      if (this.callId === cid) { toast('⚠️ Microphone permission needed for voice'); this._reset(); }
      return;
    }
    try {
      await this._setupPeer();
      if (this.callId !== cid) return;
      const offer = await this.pc.createOffer();
      this._send({ type: 'offer', sdp: offer });          // queued BEFORE ICE candidates start
      await this.pc.setLocalDescription(offer);
      toast('📞 Calling ' + partner() + '…');
      this._armConnectTimeout(cid, partner() + ' did not answer');
    } catch (e) { if (this.callId === cid) { toast('Could not start the voice call'); this.stop(); } }
  },

  _armConnectTimeout(cid, msg) {
    clearTimeout(this.ringTimer);
    this.ringTimer = setTimeout(() => {
      if (this.callId === cid && this.state === 'connecting') { toast(msg); this.stop(); }
    }, 40000);
  },

  _ring(m) {
    this.offerMsg = m; this.state = 'ringing';
    this._showCard();
    clearTimeout(this.ringTimer);
    this.ringTimer = setTimeout(() => { if (this.state === 'ringing') this._unring(); }, 45000);
    if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
    try { Snd.tap(); } catch (e) {}
    this._ui();
  },
  _unring() {
    clearTimeout(this.ringTimer);
    const el = $('gcvIncoming'); if (el) el.remove();
    this.offerMsg = null;
    if (this.state === 'ringing') this.state = 'idle';
    this._ui();
  },
  _showCard() {
    if ($('gcvIncoming')) return;
    const el = document.createElement('div');
    el.id = 'gcvIncoming'; el.className = 'gv-incoming-overlay';
    el.innerHTML = '<div class="gv-incoming-card"><div class="gv-incoming-ico">📞</div>' +
      '<div class="gv-incoming-text"><strong>' + esc(partner()) + '</strong> is calling — talk while you play 💗</div>' +
      '<div class="gv-incoming-actions"><button class="gv-decline-btn" id="gcvDecline">Decline</button>' +
      '<button class="gv-accept-btn" id="gcvAccept">Accept 📞</button></div></div>';
    document.body.appendChild(el);
    $('gcvDecline').onclick = () => this.decline();
    $('gcvAccept').onclick = () => this.accept();
  },

  decline() {
    const m = this.offerMsg;
    this._unring();
    if (m) this._send({ type: 'decline' }, m.callId);
  },

  async accept() {
    const m = this.offerMsg; if (!m) return;
    const el = $('gcvIncoming'); if (el) el.remove();
    clearTimeout(this.ringTimer);
    this.offerMsg = null;
    this.callId = m.callId; this.isCaller = false; this.state = 'connecting'; this._ui();
    const cid = m.callId;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      toast('⚠️ Microphone permission needed for voice');
      this._send({ type: 'decline' }, cid); this._reset(); return;
    }
    try {
      await this._setupPeer();
      await this._answer(m);
      this._armConnectTimeout(cid, 'Could not connect the voice call');
    } catch (e) { toast('Could not connect the voice call'); this.stop(); }
  },

  async _answer(m) {
    await this.pc.setRemoteDescription(m.sdp);
    await this._flushIce(m.callId);
    const ans = await this.pc.createAnswer();
    this._send({ type: 'answer', sdp: ans });
    await this.pc.setLocalDescription(ans);
  },
  async _takeOver(m) {
    clearTimeout(this.ringTimer);
    this.callId = m.callId; this.isCaller = false;
    try { await this.pc.setLocalDescription({ type: 'rollback' }); await this._answer(m); this._armConnectTimeout(m.callId, 'Could not connect the voice call'); }
    catch (e) { toast('Could not connect the voice call'); this.stop(); }
  },

  toggleMute() {
    if (!this.stream) return;
    this.muted = !this.muted;
    this.stream.getAudioTracks().forEach((t) => { t.enabled = !this.muted; });
    this._ui();
  },
  toggleSpeaker() { this.speakerOn = !this.speakerOn; this._applySpeaker(); this._ui(); },

  /* end the call for both people */
  stop(silent) {
    const cid = this.callId, was = this.active;
    if (was && !silent && cid) this._send({ type: 'end' }, cid);
    this._reset();
  },
  _reset() {
    clearTimeout(this.ringTimer); clearTimeout(this.dropTimer);
    if (this.pc) {
      this.pc.onconnectionstatechange = null; this.pc.onicecandidate = null; this.pc.ontrack = null;
      try { this.pc.close(); } catch (e) {}
    }
    this.pc = null;
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    if (this.audioEl) { try { this.audioEl.srcObject = null; } catch (e) {} this.audioEl.remove(); this.audioEl = null; }
    if (this.state !== 'ringing') this.state = 'idle';
    this.callId = null; this.isCaller = false; this.iceBuf = {};
    this.muted = false; this.speakerOn = true;
    this._ui();
  },

  /* ── UI ── */
  _ui() {
    const btn = $('goVoiceBtn');
    if (btn) {
      btn.classList.toggle('on', this.active);
      btn.classList.toggle('gc-ring', this.state === 'ringing');
      btn.title = this.active ? 'End voice call' : 'Voice call';
    }
    if (this.active) this._pill(); else { const p = $('gcvPill'); if (p) p.remove(); }
  },
  _pill() {
    let p = $('gcvPill');
    if (!p) {
      p = document.createElement('div');
      p.id = 'gcvPill'; p.className = 'gcv-pill';
      p.innerHTML = '<button class="gcv-btn" id="gcvMute" title="Mute"></button>' +
        '<button class="gcv-btn" id="gcvSpk" title="Speaker"></button>' +
        '<button class="gcv-btn end" id="gcvEnd" title="End call">' + ICON.endCall + '</button>';
      document.body.appendChild(p);
      $('gcvMute').onclick = () => this.toggleMute();
      $('gcvSpk').onclick = () => this.toggleSpeaker();
      $('gcvEnd').onclick = () => this.stop();
      this._drag(p);
      if (this._pos) { p.style.left = this._pos.x + 'px'; p.style.top = this._pos.y + 'px'; p.style.right = 'auto'; }
    }
    p.classList.toggle('connecting', this.state === 'connecting');
    p.classList.toggle('active', this.state === 'active');
    const mu = $('gcvMute'); mu.innerHTML = this.muted ? ICON.micOff : ICON.mic; mu.classList.toggle('muted', this.muted);
    const sp = $('gcvSpk'); sp.innerHTML = this.speakerOn ? ICON.vol2 : ICON.vol1; sp.classList.toggle('spk-on', this.speakerOn);
  },
  /* the pill can be dragged out of the way of the game board */
  _drag(p) {
    let down = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
    p.addEventListener('pointerdown', (e) => { down = true; moved = false; sx = e.clientX; sy = e.clientY; const r = p.getBoundingClientRect(); ox = r.left; oy = r.top; });
    p.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 8) return;
      if (!moved) { moved = true; try { p.setPointerCapture(e.pointerId); } catch (x) {} }
      const x = Math.min(window.innerWidth - p.offsetWidth - 4, Math.max(4, ox + dx));
      const y = Math.min(window.innerHeight - p.offsetHeight - 4, Math.max(4, oy + dy));
      p.style.left = x + 'px'; p.style.top = y + 'px'; p.style.right = 'auto';
      GameVoice._pos = { x, y };
    });
    const up = () => { down = false; if (moved) { p._dragged = true; setTimeout(() => { p._dragged = false; }, 0); } };
    p.addEventListener('pointerup', up); p.addEventListener('pointercancel', up);
    p.addEventListener('click', (e) => { if (p._dragged) { e.stopPropagation(); e.preventDefault(); } }, true);
  }
};

/* ═══════════════════════ 2) CHAT (text + voice messages) ═══════════════════════ */
const GameChat = {
  gid: null, isOpen: false,
  mine: [], theirs: [], baseline: false, unread: 0,
  pollT: null, _q: Promise.resolve(), _sig: '',
  rec: null, recTimer: null, playing: null,

  _kMe() { return 'gm_gchat_' + myKey; },
  _kPt() { return 'gm_gchat_' + ptKey; },

  /* ── lifecycle ── */
  onOpen(gid) {
    this.onExit();
    this.gid = gid; this.mine = []; this.theirs = []; this.baseline = false; this.unread = 0; this._sig = '';
    this._badge();
    this._pull().then(() => this._loop());
  },
  onExit() {
    this.hide(true);
    clearTimeout(this.pollT); this.pollT = null;
    this._stopPlay();
    this.gid = null; this.mine = []; this.theirs = []; this.baseline = false; this.unread = 0;
    this._badge();
  },

  _loop() {
    clearTimeout(this.pollT);
    if (!this.gid) return;
    const gap = this.isOpen ? 1500 : (document.hidden ? 8000 : 3500);
    this.pollT = setTimeout(async () => { await this._pull(); this._loop(); }, gap);
  },

  async _pull() {
    const kMe = this._kMe(), kPt = this._kPt();
    let r;
    try { r = await GamesStore.read(this.baseline ? [kPt] : [kMe, kPt]); } catch (e) { return; }
    if (!this.gid) return;
    if (!this.baseline) {
      const mine = r[kMe];
      if (mine && Array.isArray(mine.m)) {
        const have = new Set(this.mine.map((x) => x.id));
        mine.m.forEach((x) => { if (x && x.id && !have.has(x.id)) this.mine.push(Object.assign({ st: 'sent' }, x)); });
        this.mine.sort((a, b) => a.ts - b.ts);
      }
    }
    const pt = r[kPt];
    const list = (pt && Array.isArray(pt.m)) ? pt.m.filter((x) => x && x.id && (x.t === 'text' || x.t === 'voice')) : [];
    if (!this.baseline) { this.theirs = list; this.baseline = true; this._render(); return; }
    const known = new Set(this.theirs.map((x) => x.id));
    const fresh = list.filter((x) => !known.has(x.id));
    this.theirs = list;
    if (fresh.length) this._incoming(fresh);
  },

  _incoming(fresh) {
    if (this.isOpen) { this._render(true); try { Snd.tap(); } catch (e) {} return; }
    this.unread += fresh.length; this._badge();
    const m = fresh[fresh.length - 1];
    toast(m.t === 'voice' ? '🎙️ ' + partner() + ' sent a voice message' : '💬 ' + partner() + ': ' + String(m.x || '').slice(0, 60));
    try { Snd.tap(); } catch (e) {}
    if (navigator.vibrate) navigator.vibrate(60);
  },

  _badge() {
    const b = $('goChatBadge'); if (!b) return;
    b.textContent = this.unread > 9 ? '9+' : String(this.unread);
    b.classList.toggle('show', this.unread > 0);
  },

  /* ── sheet ── */
  toggle() { if (this.isOpen) this.hide(); else this.show(); },

  _ensureSheet() {
    if ($('gcSheet')) return;
    const s = document.createElement('div');
    s.id = 'gcSheet';
    s.innerHTML =
      '<div class="gc-head"><div class="gc-title" id="gcTitle">💬 Chat</div><button class="gc-x" id="gcClose" title="Close">' + ICON.close + '</button></div>' +
      '<div class="gc-list" id="gcList"></div>' +
      '<div class="gc-composer" id="gcComposer">' +
        '<input class="gc-input" id="gcInput" type="text" maxlength="500" autocomplete="off" placeholder="Type a message…">' +
        '<button class="gc-ibtn" id="gcMic" title="Record a voice message">' + ICON.mic + '</button>' +
        '<button class="gc-ibtn send" id="gcSend" title="Send">' + ICON.send + '</button>' +
      '</div>' +
      '<div class="gc-recbar" id="gcRec">' +
        '<button class="gc-ibtn cancel" id="gcRecCancel" title="Cancel">' + ICON.trash + '</button>' +
        '<span class="gc-recdot"></span><span class="gc-rectime" id="gcRecTime">0:00</span>' +
        '<span class="gc-rechint">Recording…</span>' +
        '<button class="gc-ibtn send" id="gcRecSend" title="Send voice message">' + ICON.send + '</button>' +
      '</div>';
    document.body.appendChild(s);
    $('gcClose').onclick = () => this.hide();
    $('gcSend').onclick = () => this.sendText();
    $('gcMic').onclick = () => this.startRec();
    $('gcRecCancel').onclick = () => this.stopRec(false);
    $('gcRecSend').onclick = () => this.stopRec(true);
    $('gcInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendText(); } });
    $('gcList').addEventListener('click', (e) => {
      const p = e.target.closest('[data-play]'); if (p) { this._play(p.dataset.play); return; }
      const r = e.target.closest('[data-retry]'); if (r) this._retry(r.dataset.retry);
    });
    const vv = window.visualViewport;   // keep the sheet above the on-screen keyboard
    if (vv) {
      const fit = () => {
        if (!this.isOpen) return;
        s.style.bottom = Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + 'px';
        s.style.maxHeight = Math.max(240, vv.height * 0.85) + 'px';
      };
      vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit);
    }
  },

  show() {
    if (!this.gid) return;
    if (isSolo()) { toast('Connect with your partner to chat 💗'); return; }
    this._ensureSheet();
    $('gcTitle').textContent = '💬 ' + partner();
    $('gcSheet').classList.add('open');
    this.isOpen = true; this.unread = 0; this._badge();
    const b = $('goChatBtn'); if (b) b.classList.add('on');
    this._sig = ''; this._render(true);
    this._loop();
    if (!('ontouchstart' in window)) { const i = $('gcInput'); if (i) i.focus(); }
  },
  hide(silent) {
    if (this.rec) this.stopRec(false);
    const s = $('gcSheet');
    if (s) { s.classList.remove('open'); s.style.bottom = ''; s.style.maxHeight = ''; }
    this.isOpen = false;
    const b = $('goChatBtn'); if (b) b.classList.remove('on');
    if (!silent) this._loop();
  },

  /* ── sending ── */
  sendText() {
    const inp = $('gcInput'); if (!inp) return;
    const x = inp.value.trim(); if (!x) return;
    inp.value = '';
    this._push({ id: uid(), t: 'text', x: x.slice(0, 500), ts: Date.now() });
  },
  _push(m) {
    m.st = 'sending';
    this.mine.push(m);
    if (this.mine.length > 40) this.mine = this.mine.slice(-40);
    this._render(true);
    this._save();
  },
  /* My key only ever holds MY last 20 messages, so the two phones never overwrite each other */
  _save() {
    this._q = this._q.then(async () => {
      const batch = this.mine.filter((m) => m.t === 'text' || m.u).slice(-20);
      const ids = new Set(batch.map((m) => m.id));
      const payload = { m: batch.map((m) => ({ id: m.id, t: m.t, x: m.x, u: m.u, d: m.d, ts: m.ts })), ts: Date.now() };
      try {
        await GamesStore.write({ [this._kMe()]: payload });
        this.mine.forEach((m) => { if (ids.has(m.id) && (m.st === 'sending' || m.st === 'fail')) m.st = 'sent'; });
      } catch (e) {
        this.mine.forEach((m) => { if (ids.has(m.id) && m.st === 'sending') m.st = 'fail'; });
      }
      this._render();
    });
    return this._q;
  },
  _retry(id) {
    const m = this.mine.find((x) => x.id === id); if (!m) return;
    if (m.t === 'voice' && !m.u && m._blob) { this._upload(m); return; }
    m.st = 'sending'; this._render(); this._save();
  },

  /* ── voice messages ── */
  async startRec() {
    if (this.rec) return;
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) || !window.MediaRecorder) { toast('Voice messages are not supported on this browser'); return; }
    let stream;
    try {
      // if a voice call is running the mic is already open — record from a clone of it
      const callTrack = GameVoice.stream && GameVoice.stream.getAudioTracks()[0];
      if (callTrack && callTrack.readyState === 'live') {
        const c = callTrack.clone(); c.enabled = true;
        stream = new MediaStream([c]);
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      }
    } catch (e) { toast('⚠️ Microphone permission needed'); return; }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => { try { return MediaRecorder.isTypeSupported(t); } catch (e) { return false; } }) || '';
    let mr;
    try { mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); }
    catch (e) { stream.getTracks().forEach((t) => t.stop()); toast('Could not start recording'); return; }
    const r = { mr, stream, chunks: [], start: Date.now(), discard: false, mime: mr.mimeType || mime || 'audio/webm' };
    mr.ondataavailable = (e) => { if (e.data && e.data.size) r.chunks.push(e.data); };
    mr.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (r.discard) return;
      const dur = (Date.now() - r.start) / 1000;
      const blob = new Blob(r.chunks, { type: r.mime });
      if (dur < 0.7 || blob.size < 500) { toast('Too short — hold on a little longer 🎙️'); return; }
      this._sendVoiceBlob(blob, dur, r.mime);
    };
    this.rec = r;
    mr.start(250);
    $('gcSheet').classList.add('rec');
    $('gcRecTime').textContent = '0:00';
    this.recTimer = setInterval(() => {
      const s = Math.floor((Date.now() - r.start) / 1000);
      $('gcRecTime').textContent = fmt(s);
      if (s >= 120) this.stopRec(true);
    }, 250);
  },
  stopRec(send) {
    const r = this.rec; if (!r) return;
    this.rec = null; clearInterval(this.recTimer);
    r.discard = !send;
    const s = $('gcSheet'); if (s) s.classList.remove('rec');
    try { if (r.mr.state !== 'inactive') r.mr.stop(); else r.stream.getTracks().forEach((t) => t.stop()); }
    catch (e) { r.stream.getTracks().forEach((t) => t.stop()); }
  },
  async _sendVoiceBlob(blob, dur, mime) {
    const m = { id: uid(), t: 'voice', u: '', d: Math.round(dur), ts: Date.now(), st: 'sending', _blob: blob, _mime: mime, _local: URL.createObjectURL(blob) };
    this.mine.push(m);
    if (this.mine.length > 40) this.mine = this.mine.slice(-40);
    this._render(true);
    await this._upload(m);
  },
  async _upload(m) {
    m.st = 'sending'; this._render();
    try {
      const base = String(m._mime || '').split(';')[0].trim().toLowerCase();
      const ext = ({ 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3' })[base] || 'webm';
      const fd = new FormData();
      fd.append('file', m._blob, 'voice.' + ext);
      fd.append('coupleId', ID.coupleId);
      fd.append('senderRole', ID.role);
      const r = await fetch(API + '/api/media/upload-voice', { method: 'POST', body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) throw new Error(d.error || 'Upload failed');
      m.u = d.url;
      await this._save();
    } catch (e) {
      m.st = 'fail'; this._render();
      toast('⚠️ Voice message not sent — tap retry');
    }
  },

  /* ── playback ── */
  _find(id) { return this.mine.find((x) => x.id === id) || this.theirs.find((x) => x.id === id); },
  _play(id) {
    const m = this._find(id); if (!m) return;
    const url = m._local || m.u;
    if (!/^(https?:|blob:)/.test(url || '')) return;
    if (this.playing && this.playing.id === id) { this._stopPlay(); return; }
    this._stopPlay();
    const a = new Audio(); a.preload = 'auto'; a.src = url;
    this.playing = { id, a, d: Number(m.d) || 0 };
    a.ontimeupdate = () => this._playUI();
    a.onended = () => this._stopPlay();
    a.onerror = () => { toast('Could not play this voice message'); this._stopPlay(); };
    a.play().catch(() => { toast('Could not play this voice message'); this._stopPlay(); });
    this._playUI();
  },
  _stopPlay() {
    if (this.playing) { try { this.playing.a.pause(); this.playing.a.src = ''; } catch (e) {} this.playing = null; }
    this._playUI();
  },
  _playUI() {
    document.querySelectorAll('#gcList .gc-play').forEach((b) => {
      const on = !!(this.playing && b.dataset.play === this.playing.id);
      b.innerHTML = on ? ICON.pause : ICON.play;
      const bar = b.parentNode.querySelector('.gc-wave i');
      if (!bar) return;
      let pct = 0;
      if (on) {
        const a = this.playing.a;
        const d = (isFinite(a.duration) && a.duration > 0) ? a.duration : this.playing.d;
        pct = d ? Math.min(100, (a.currentTime / d) * 100) : 0;
      }
      bar.style.width = pct + '%';
    });
  },

  /* ── rendering ── */
  _bubble(o) {
    const m = o.m;
    const time = new Date(m.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    let body;
    if (m.t === 'voice') {
      body = '<div class="gc-bub gc-voice"><button class="gc-play" data-play="' + esc(m.id) + '">' + ICON.play + '</button>' +
             '<div class="gc-wave"><i></i></div><span class="gc-dur">' + fmt(Math.max(1, Number(m.d) || 0)) + '</span></div>';
    } else {
      body = '<div class="gc-bub">' + esc(m.x || '') + '</div>';
    }
    let status = '';
    if (o.me) {
      status = m.st === 'sending' ? '<span>sending…</span>'
        : m.st === 'fail' ? '<button class="gc-retry" data-retry="' + esc(m.id) + '">⚠️ Not sent · retry</button>'
        : '<span>✓</span>';
    }
    return '<div class="gc-row ' + (o.me ? 'me' : 'them') + '">' + body + '<div class="gc-meta">' + time + ' ' + status + '</div></div>';
  },
  _render(scroll) {
    const list = $('gcList'); if (!list) return;
    const cutoff = Date.now() - 3 * 3600 * 1000;     // show the last 3 hours
    const all = this.mine.map((m) => ({ m, me: true })).concat(this.theirs.map((m) => ({ m, me: false })))
      .filter((o) => o.m.ts > cutoff).sort((a, b) => a.m.ts - b.m.ts);
    const sig = all.map((o) => o.m.id + (o.m.st || '') + (o.m.u ? 'u' : '')).join('|');
    if (sig === this._sig) return;
    this._sig = sig;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    list.innerHTML = all.length
      ? all.map((o) => this._bubble(o)).join('')
      : '<div class="gc-empty">Say something sweet 💕<br><span>Send a message or a voice note while you play</span></div>';
    this._playUI();
    if (scroll || nearBottom) list.scrollTop = list.scrollHeight;
  }
};

window.GameVoice = GameVoice;
window.GameChat = GameChat;
window.GameComms = {
  onOpen(gid) { GameVoice.onOpen(gid); GameChat.onOpen(gid); },
  onExit() { GameVoice.onExit(); GameChat.onExit(); }
};

/* if a game was already open before this file loaded */
try { if (window.Hub && Hub.activeGameId) window.GameComms.onOpen(Hub.activeGameId); } catch (e) {}
})();
