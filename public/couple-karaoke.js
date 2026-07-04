/* ═══════════════════════════════════════════════════════════════
   COUPLE KARAOKE — synchronized dual-camera singing room
   Load AFTER music-player.js and music-player-karaoke-patch.js:
     <script src="/music-player.js"></script>
     <script src="/music-player-karaoke-patch.js"></script>
     <script src="/couple-karaoke.js"></script>

   Does NOT touch the existing music player / solo Karaoke feature.
   Adds one new "💞 Sing Together" entry point.

   ARCHITECTURE NOTES (read before wiring a backend):
   - Video/audio between partners is peer-to-peer via WebRTC.
   - Signaling (SDP offers/answers/ICE candidates) and the sync/
     control/reaction messages all ride over the SAME generic
     key-value channel the app already uses for partner-music sync:
        POST /api/data/state   { coupleId, state: { key: value } }
        GET  /api/data/state/:coupleId
     This avoids requiring a new WebSocket server. It's polled every
     ~0.7-1.2s, which is fine for invites/controls but is a latency
     ceiling for perfectly frame-accurate sync — hence the client-side
     drift-correction loop described below. If a WebSocket/Firebase
     channel becomes available later, swap `Channel.send`/`pollOnce`
     for a push-based transport and everything else keeps working.
   - Playback sync model: the inviter is the HOST. The host's
     AudioService is the source of truth. Every 2.5s (and on every
     play/pause/seek/track-change) the host broadcasts
     { type:'sync', songId, currentTime, playing, ts }.
     The guest keeps its own local audio element in lockstep: hard
     play()/pause() on state-change, and re-seeks whenever local
     drift exceeds 400ms (accounting for message travel time via ts).
   - Both partners hear the SAME song because the guest loads the
     exact same track (by songId) from the shared music library that
     already exists in Store — no separate audio pipe needed.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
  const DRIFT_THRESHOLD = 0.4; // seconds
  const SYNC_BROADCAST_MS = 2500;
  const SIGNAL_POLL_MS = 1200;
  const FAST_POLL_MS = 700;

  function whenReady(fn) {
    if (window.AudioService && window.Store && window.MusicPlayer) fn();
    else setTimeout(() => whenReady(fn), 150);
  }

  function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function fmtTime(s) { if (!s || isNaN(s)) return '0:00'; const m = Math.floor(s / 60), sec = Math.floor(s % 60); return m + ':' + (sec + '').padStart(2, '0'); }

  /* ═══════════════════════════════════════
     SIGNALING CHANNEL (shared key/value store)
  ═══════════════════════════════════════ */
  const Channel = (function () {
    let ctx = null, myKey = null, peerKey = null, lastPeerSeq = 0, pollTimer = null, fastTimer = null;
    let outbox = [], _seq = 0;
    const handlers = [];

    function init() {
      ctx = window.MusicPlayer.getCoupleCtx();
      if (!ctx) return false;
      myKey = 'ck_' + ctx.role;
      peerKey = 'ck_' + (ctx.role === 'user1' ? 'user2' : 'user1');
      return true;
    }
    async function send(msg) {
      if (!ctx && !init()) return;
      const payload = { ...msg, from: ctx.role, ts: Date.now(), seq: ++_seq };
      outbox.push(payload);
      if (outbox.length > 20) outbox = outbox.slice(-20);
      try {
        await window.MusicPlayer.api('POST', '/api/data/state', { coupleId: ctx.coupleId, state: { [myKey]: outbox } });
      } catch (e) {}
    }
    async function pollOnce() {
      if (!ctx && !init()) return;
      try {
        const state = await window.MusicPlayer.api('GET', '/api/data/state/' + ctx.coupleId);
        const msgs = state && state[peerKey];
        if (!Array.isArray(msgs)) return;
        const fresh = msgs.filter(m => m.seq > lastPeerSeq).sort((a, b) => a.seq - b.seq);
        if (!fresh.length) return;
        lastPeerSeq = fresh[fresh.length - 1].seq;
        fresh.forEach(msg => handlers.forEach(h => { try { h(msg); } catch (e) {} }));
      } catch (e) {}
    }
    function startPolling(fast) {
      stopPolling();
      pollTimer = setInterval(pollOnce, SIGNAL_POLL_MS);
      if (fast) fastTimer = setInterval(pollOnce, FAST_POLL_MS);
      pollOnce();
    }
    function stopPolling() {
      if (pollTimer) clearInterval(pollTimer); pollTimer = null;
      if (fastTimer) clearInterval(fastTimer); fastTimer = null;
    }
    function on(fn) { handlers.push(fn); }
    function off(fn) { const i = handlers.indexOf(fn); if (i > -1) handlers.splice(i, 1); }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') pollOnce();
    });
    return { init, send, startPolling, stopPolling, on, off, get ctx() { return ctx; } };
  })();

  /* ═══════════════════════════════════════
     DUET LYRICS PARSER
     Supports lines like:
       [00:12.34][Vamsi] I'll always love you
       [00:15.10][Likitha] I'll always miss you
       [00:18.00][Both] Forever together
     Falls back to plain LRC (no speaker tag) rendered as "Both".
  ═══════════════════════════════════════ */
  const TIME_TAG = /^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/;
  const SPEAKER_TAG = /^\[(vamsi|partner ?a|host|likitha|partner ?b|guest|both)\]/i;
  function parseDuetLRC(raw) {
    if (!raw || !raw.trim()) return [];
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    const out = [];
    lines.forEach(l => {
      const tm = l.match(TIME_TAG);
      if (!tm) return;
      let rest = l.slice(tm[0].length).trim();
      let speaker = 'both';
      const sm = rest.match(SPEAKER_TAG);
      if (sm) {
        const s = sm[1].toLowerCase();
        speaker = /vamsi|partner ?a|host/.test(s) ? 'a' : /likitha|partner ?b|guest/.test(s) ? 'b' : 'both';
        rest = rest.slice(sm[0].length).trim();
      }
      const frac = tm[3] ? (tm[3].length === 2 ? parseInt(tm[3]) / 100 : parseInt(tm[3]) / 1000) : 0;
      out.push({ time: parseInt(tm[1]) * 60 + parseInt(tm[2]) + frac, text: rest, speaker });
    });
    out.sort((a, b) => a.time - b.time);
    return out;
  }

  /* ═══════════════════════════════════════
     ROOM STATE
  ═══════════════════════════════════════ */
  const Room = {
    open: false, isHost: false, songId: null, songList: [],
    pc: null, localStream: null, remoteStream: null,
    cameraFacing: 'user', muted: false, cameraOff: false, speakerMuted: false,
    lastHostSync: null, syncBroadcastTimer: null,
    recording: false, recorder: null, recChunks: [], recCanvasStream: null, recRafId: null,
  };

  /* ═══════════════════════════════════════
     UI: injected styles
  ═══════════════════════════════════════ */
  function injectStyles() {
    if (document.getElementById('ckStyles')) return;
    const css = `
    .ck-fab{position:fixed;right:16px;bottom:calc(84px + env(safe-area-inset-bottom));z-index:490;padding:12px 18px;border-radius:30px;border:none;cursor:pointer;font-family:var(--ff-sans,sans-serif);font-size:13px;font-weight:700;color:#fff;background:linear-gradient(135deg,#ff6fb5,#7c5cff);box-shadow:0 10px 28px rgba(124,92,255,.45);display:flex;align-items:center;gap:7px;transition:transform .25s cubic-bezier(.34,1.56,.64,1)}
    .ck-fab:hover{transform:translateY(-2px) scale(1.03)}
    .ck-fab .ck-fab-ico{font-size:16px}
    @media(min-width:700px){.ck-fab{right:24px;bottom:24px}}

    .ck-invite-overlay{position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,.7);backdrop-filter:blur(10px);display:none;align-items:center;justify-content:center;padding:20px}
    .ck-invite-overlay.open{display:flex}
    .ck-invite-card{width:100%;max-width:360px;background:linear-gradient(160deg,rgba(30,10,40,.97),rgba(10,10,24,.97));border:1px solid rgba(255,255,255,.15);border-radius:26px;padding:30px 24px;text-align:center;animation:ckPop .35s cubic-bezier(.34,1.56,.64,1);box-shadow:0 30px 80px rgba(0,0,0,.6)}
    @keyframes ckPop{from{opacity:0;transform:scale(.85) translateY(20px)}to{opacity:1;transform:scale(1) translateY(0)}}
    .ck-invite-heart{font-size:44px;animation:ckHeartBeat 1.1s ease-in-out infinite}
    @keyframes ckHeartBeat{0%,100%{transform:scale(1)}50%{transform:scale(1.18)}}
    .ck-invite-text{font-family:var(--ff-serif,serif);font-size:18px;color:#fff;margin:14px 0 22px;line-height:1.5}
    .ck-invite-actions{display:flex;gap:10px}
    .ck-invite-btn{flex:1;padding:13px;border-radius:16px;border:none;cursor:pointer;font-weight:700;font-size:14px;font-family:var(--ff-sans,sans-serif);transition:.2s}
    .ck-invite-btn.accept{background:linear-gradient(135deg,#34d399,#10b981);color:#04160f;box-shadow:0 8px 22px rgba(52,211,153,.4)}
    .ck-invite-btn.decline{background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.15)}
    .ck-invite-btn:hover{transform:translateY(-1px)}
    .ck-waiting-note{font-size:11px;color:rgba(255,255,255,.4);margin-top:14px}

    .ck-room{position:fixed;inset:0;z-index:1300;background:#03030a;display:none;flex-direction:column;overflow:hidden}
    .ck-room.open{display:flex}
    .ck-room-bgfx{position:absolute;inset:0;background:radial-gradient(circle at 50% 0%,rgba(124,92,255,.28),transparent 55%),radial-gradient(circle at 50% 100%,rgba(255,111,181,.2),transparent 55%);pointer-events:none;z-index:0}

    .ck-video-stage{position:relative;flex:1;display:flex;flex-direction:column;overflow:hidden;z-index:1}
    .ck-video-tile{position:relative;flex:1;min-height:0;background:linear-gradient(135deg,#141428,#0a0a18);overflow:hidden}
    .ck-video-tile video{width:100%;height:100%;object-fit:cover;display:block}
    .ck-video-label{position:absolute;top:10px;left:12px;padding:4px 11px;border-radius:20px;background:rgba(0,0,0,.45);backdrop-filter:blur(8px);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;gap:6px;z-index:2}
    .ck-video-label .dot{width:7px;height:7px;border-radius:50%;background:#34d399;box-shadow:0 0 8px #34d399}
    .ck-video-tile.partner .ck-video-label .dot{background:#5b9bff;box-shadow:0 0 8px #5b9bff}
    .ck-video-tile.partner{ position:absolute; inset:0; max-height:none; z-index:0; }
.ck-video-tile.self{
  position:absolute; top:14px; right:14px;
  width:110px; height:160px; max-height:none;
  border-radius:16px; overflow:hidden; z-index:4;
  border:2px solid rgba(255,255,255,.25); box-shadow:0 8px 24px rgba(0,0,0,.5);
}

    .ck-lyrics-stage{position:absolute;left:0;right:0;bottom:130px;display:flex;align-items:flex-end;justify-content:center;pointer-events:none;z-index:3;padding:0 26px}
    .ck-lyrics-stage::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(0,0,0,.35),transparent 65%)}
    .ck-lyric-cur{position:relative;text-align:center;font-size:24px;font-weight:800;line-height:1.4;text-shadow:0 2px 18px rgba(0,0,0,.8);transition:all .3s cubic-bezier(.4,0,.2,1)}
    .ck-lyric-next{position:relative;text-align:center;font-size:15px;font-weight:600;color:rgba(255,255,255,.55);margin-top:10px;text-shadow:0 2px 12px rgba(0,0,0,.7)}
    .ck-lyric-cur.speaker-a{color:#7db8ff;text-shadow:0 0 22px rgba(91,155,255,.7),0 2px 14px rgba(0,0,0,.8)}
    .ck-lyric-cur.speaker-b{color:#ff8fce;text-shadow:0 0 22px rgba(255,111,181,.7),0 2px 14px rgba(0,0,0,.8)}
    .ck-lyric-cur.speaker-both{color:#d4b8ff;text-shadow:0 0 22px rgba(168,111,255,.7),0 2px 14px rgba(0,0,0,.8)}

    .ck-topbar{position:absolute;top:0;left:0;right:0;padding:14px 14px 0;display:flex;justify-content:space-between;align-items:center;z-index:5}
    .ck-topbar-chip{padding:6px 12px;border-radius:16px;background:rgba(0,0,0,.4);backdrop-filter:blur(10px);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;gap:6px}
    .ck-icon-btn{width:36px;height:36px;border-radius:50%;background:rgba(0,0,0,.4);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.15);color:#fff;font-size:15px;display:flex;align-items:center;justify-content:center;cursor:pointer}

    .ck-progress-wrap{position:relative;z-index:5;padding:6px 18px 2px}
    .ck-progress-bar{height:4px;border-radius:3px;background:rgba(255,255,255,.15);cursor:pointer;position:relative}
    .ck-progress-fill{height:100%;border-radius:3px;background:linear-gradient(90deg,#7c5cff,#ff6fb5);width:0%}
    .ck-times{display:flex;justify-content:space-between;font-size:10px;color:rgba(255,255,255,.5);margin-top:4px}

    .ck-controls{position:relative;z-index:5;display:flex;align-items:center;justify-content:center;gap:10px;padding:10px 12px calc(14px + env(safe-area-inset-bottom));flex-wrap:wrap}
    .ck-ctrl-btn{width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);color:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.2s}
    .ck-ctrl-btn:hover{background:rgba(255,255,255,.16)}
    .ck-ctrl-btn.active{background:linear-gradient(135deg,#7c5cff,#ff6fb5);border-color:transparent}
    .ck-ctrl-btn.rec{background:linear-gradient(135deg,#ff5b7f,#c0264e)}
    .ck-ctrl-btn.rec.live{animation:ckRecPulse 1s ease-in-out infinite}
    @keyframes ckRecPulse{0%{box-shadow:0 0 0 0 rgba(255,91,127,.5)}70%{box-shadow:0 0 0 14px rgba(255,91,127,0)}100%{box-shadow:0 0 0 0 rgba(255,91,127,0)}}
    .ck-ctrl-btn.play{width:54px;height:54px;font-size:20px;background:linear-gradient(135deg,#7c5cff,#5b9bff)}

    .ck-reactions-bar{position:relative;z-index:5;display:flex;justify-content:center;gap:14px;padding:0 12px 8px}
    .ck-reaction-pick{font-size:22px;cursor:pointer;transition:transform .15s}
    .ck-reaction-pick:hover{transform:scale(1.25)}
    .ck-floating-reaction{position:absolute;bottom:120px;font-size:30px;z-index:6;pointer-events:none;animation:ckFloatUp 3s ease-out forwards}
    @keyframes ckFloatUp{0%{opacity:0;transform:translateY(0) scale(.5)}15%{opacity:1;transform:translateY(-40px) scale(1.1)}100%{opacity:0;transform:translateY(-420px) scale(1)}}

    .ck-connecting{position:absolute;inset:0;z-index:10;background:rgba(3,3,10,.92);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;color:#fff}
    .ck-connecting-spin{width:44px;height:44px;border-radius:50%;border:3px solid rgba(255,255,255,.15);border-top-color:#ff6fb5;animation:ckSpin 1s linear infinite}
    @keyframes ckSpin{to{transform:rotate(360deg)}}
    `;
    const s = document.createElement('style'); s.id = 'ckStyles'; s.textContent = css; document.head.appendChild(s);
  }

  /* ═══════════════════════════════════════
     FAB + entry point
  ═══════════════════════════════════════ */
  function injectFab() {
    if (document.getElementById('ckFab')) return;
    const btn = document.createElement('button');
    btn.id = 'ckFab'; btn.className = 'ck-fab';
    btn.innerHTML = `<span class="ck-fab-ico">💞</span> Sing Together`;
    btn.onclick = openSongPickerForInvite;
    document.body.appendChild(btn);
  }

  function openSongPickerForInvite() {
    const songs = window.Store.songs;
    if (!songs.length) { window.MusicPlayer.toast('Upload a song first 🎵'); return; }
    const cur = window.AudioService.currentSong();
    const song = cur || songs.find(s => s.visibility !== 'partner') || songs[0];
    sendInvite(song);
  }

  /* ═══════════════════════════════════════
     INVITE FLOW
  ═══════════════════════════════════════ */
  let inviteHandler = null;
  function injectInviteOverlays() {
    if (document.getElementById('ckInviteOverlay')) return;
    const el = document.createElement('div');
    el.id = 'ckInviteOverlay'; el.className = 'ck-invite-overlay';
    el.innerHTML = `
      <div class="ck-invite-card">
        <div class="ck-invite-heart">❤️</div>
        <div class="ck-invite-text" id="ckInviteText">invited you to sing.</div>
        <div class="ck-invite-actions">
          <button class="ck-invite-btn decline" id="ckDeclineBtn">Decline</button>
          <button class="ck-invite-btn accept" id="ckAcceptBtn">Accept</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    document.getElementById('ckDeclineBtn').onclick = () => { Channel.send({ type: 'invite_declined' }); closeInviteOverlay(); };
    document.getElementById('ckAcceptBtn').onclick = () => { Channel.send({ type: 'invite_accepted' }); closeInviteOverlay(); joinRoom(window._ckPendingInvite.songId, false); };

    const waiting = document.createElement('div');
    waiting.id = 'ckWaitingOverlay'; waiting.className = 'ck-invite-overlay';
    waiting.innerHTML = `
      <div class="ck-invite-card">
        <div class="ck-invite-heart">💞</div>
        <div class="ck-invite-text">Waiting for your partner to accept…</div>
        <div class="ck-waiting-note">This will open automatically if they say yes.</div>
        <div class="ck-invite-actions"><button class="ck-invite-btn decline" id="ckCancelInviteBtn" style="flex:1">Cancel</button></div>
      </div>`;
    document.body.appendChild(waiting);
    document.getElementById('ckCancelInviteBtn').onclick = () => {
      Channel.send({ type: 'invite_cancel' });
      closeWaitingOverlay();
      if (inviteHandler) { Channel.off(inviteHandler); inviteHandler = null; }
    };
  }
  function openInviteOverlay(msg) {
    window._ckPendingInvite = msg;
    const name = (Channel.ctx && Channel.ctx.myName) || 'Your partner';
    document.getElementById('ckInviteText').innerHTML = `❤️ <strong>${esc(name)}</strong> invited you to sing.`;
    document.getElementById('ckInviteOverlay').classList.add('open');
  }
  function closeInviteOverlay() { document.getElementById('ckInviteOverlay').classList.remove('open'); }
  function openWaitingOverlay() { document.getElementById('ckWaitingOverlay').classList.add('open'); }
  function closeWaitingOverlay() { document.getElementById('ckWaitingOverlay').classList.remove('open'); }

  function sendInvite(song) {
    if (!Channel.init()) { window.MusicPlayer.toast('Not connected yet'); return; }
    if (inviteHandler) { Channel.off(inviteHandler); inviteHandler = null; }
    Channel.startPolling(true);
    Channel.send({ type: 'invite', songId: song.id, songTitle: song.title });
    openWaitingOverlay();
    inviteHandler = (msg) => {
      if (msg.type === 'invite_accepted') {
        closeWaitingOverlay();
        Channel.off(inviteHandler); inviteHandler = null;
        joinRoom(song.id, true);
      } else if (msg.type === 'invite_declined') {
        closeWaitingOverlay();
        window.MusicPlayer.toast('Invite declined 💔');
        Channel.off(inviteHandler); inviteHandler = null;
      }
    };
    Channel.on(inviteHandler);
  }

  function listenForInvites() {
    if (!Channel.init()) { setTimeout(listenForInvites, 1500); return; }
    Channel.startPolling(false);
    Channel.on((msg) => {
      if (msg.type === 'invite' && !Room.open) openInviteOverlay(msg);
      if (msg.type === 'invite_cancel') closeInviteOverlay();
    });
  }

  /* ═══════════════════════════════════════
     WEBRTC
  ═══════════════════════════════════════ */
  async function setupPeerConnection(isHost) {
    Room.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    Room.remoteStream = new MediaStream();
    document.getElementById('ckPartnerVideo').srcObject = Room.remoteStream;

    Room.pc.ontrack = (e) => { e.streams[0].getTracks().forEach(t => Room.remoteStream.addTrack(t)); };
    Room.pc.onicecandidate = (e) => { if (e.candidate) Channel.send({ type: 'ice', candidate: e.candidate.toJSON() }); };
    Room.pc.onconnectionstatechange = () => {
      if (Room.pc.connectionState === 'connected') hideConnecting();
    };

    try {
      Room.localStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: Room.cameraFacing }, audio: true });
    } catch (e) {
      window.MusicPlayer.toast('Camera/mic access denied — joining audio-lyrics only');
      Room.localStream = new MediaStream();
    }
    document.getElementById('ckSelfVideo').srcObject = Room.localStream;
    Room.localStream.getTracks().forEach(t => Room.pc.addTrack(t, Room.localStream));

    if (isHost) {
      const offer = await Room.pc.createOffer();
      await Room.pc.setLocalDescription(offer);
      Channel.send({ type: 'offer', sdp: offer });
    }
  }

  function wireSignalHandling() {
    Channel.on(async (msg) => {
      if (!Room.open) return;
      try {
        if (msg.type === 'offer' && Room.pc) {
          await Room.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          const answer = await Room.pc.createAnswer();
          await Room.pc.setLocalDescription(answer);
          Channel.send({ type: 'answer', sdp: answer });
        } else if (msg.type === 'answer' && Room.pc) {
          await Room.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        } else if (msg.type === 'ice' && Room.pc) {
          await Room.pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
        } else if (msg.type === 'sync' && !Room.isHost) {
          handleHostSync(msg);
        } else if (msg.type === 'control' && !Room.isHost) {
          handleHostControl(msg);
        } else if (msg.type === 'reaction') {
          spawnFloatingReaction(msg.emoji);
        } else if (msg.type === 'leave') {
          onPartnerLeft();
        }
      } catch (e) { console.warn('Couple Karaoke signal error', e); }
    });
  }

  /* ═══════════════════════════════════════
     PLAYBACK SYNC
  ═══════════════════════════════════════ */
  function broadcastSyncTick() {
    if (!Room.isHost || !Room.open) return;
    const s = window.AudioService.currentSong();
    if (!s) return;
    Channel.send({ type: 'sync', songId: s.id, currentTime: window.AudioService.audio.currentTime, playing: !window.AudioService.audio.paused });
  }
  function broadcastControl(action, extra) {
    if (!Room.isHost) return;
    Channel.send({ type: 'control', action, ...extra });
  }
  function handleHostSync(msg) {
    Room.lastHostSync = msg;
    if (Room.songId !== msg.songId) { loadGuestSong(msg.songId, msg.currentTime, msg.playing); return; }
    const travel = (Date.now() - msg.ts) / 1000;
    const expected = msg.currentTime + (msg.playing ? Math.max(0, travel) : 0);
    const audio = window.AudioService.audio;
    if (Math.abs(audio.currentTime - expected) > DRIFT_THRESHOLD) audio.currentTime = expected;
    if (msg.playing && audio.paused) audio.play().catch(() => {});
    if (!msg.playing && !audio.paused) audio.pause();
  }
  function handleHostControl(msg) {
    const audio = window.AudioService.audio;
    if (msg.action === 'play') audio.play().catch(() => {});
    if (msg.action === 'pause') audio.pause();
    if (msg.action === 'seek') audio.currentTime = msg.time;
    if (msg.action === 'track') loadGuestSong(msg.songId, 0, true);
  }
  async function loadGuestSong(songId, startAt, autoplay) {
    const ctx = window.MusicPlayer.getCoupleCtx();
    if (ctx) {
      try {
        const fresh = await window.MusicPlayer.api('GET', '/api/music/' + ctx.coupleId);
        const idx = window.Store.songs.findIndex(x => x.id === songId);
        const freshSong = fresh.find(x => x.id === songId);
        if (freshSong && idx > -1) window.Store.songs[idx] = freshSong;
      } catch (e) {}
    }
    const s = window.Store.songs.find(x => x.id === songId);
    if (!s) return;
    Room.songId = songId;
    window.AudioService.play(Room.songList.length ? Room.songList : window.Store.songs, songId);
    setTimeout(() => {
      window.AudioService.audio.currentTime = startAt || 0;
      if (!autoplay) window.AudioService.audio.pause();
    }, 200);
    loadDuetLyricsFor(s);
    updateRoomSongInfo(s);
  }

  /* ═══════════════════════════════════════
     ROOM UI
  ═══════════════════════════════════════ */
  function injectRoom() {
    if (document.getElementById('ckRoom')) return;
    const el = document.createElement('div');
    el.id = 'ckRoom'; el.className = 'ck-room';
    el.innerHTML = `
      <div class="ck-room-bgfx"></div>
      <div class="ck-connecting" id="ckConnecting"><div class="ck-connecting-spin"></div><div>Connecting to your partner…</div></div>

      <div class="ck-topbar">
        <div class="ck-topbar-chip" id="ckSongChip">🎵 —</div>
        <div style="display:flex;gap:8px">
          <button class="ck-icon-btn" id="ckLeaveBtn" title="Leave">✕</button>
        </div>
      </div>

      <div class="ck-video-stage">
        <div class="ck-video-tile partner">
          <div class="ck-video-label"><span class="dot"></span><span id="ckPartnerName">Partner</span></div>
          <video id="ckPartnerVideo" autoplay playsinline></video>
        </div>
        <div class="ck-lyrics-stage">
          <div>
            <div class="ck-lyric-cur speaker-both" id="ckLyricCur">🎤 Waiting for lyrics…</div>
            <div class="ck-lyric-next" id="ckLyricNext"></div>
          </div>
        </div>
        <div class="ck-video-tile self">
          <div class="ck-video-label"><span class="dot"></span>You</div>
          <video id="ckSelfVideo" autoplay playsinline muted></video>
        </div>
        <div id="ckReactionsLayer" style="position:absolute;inset:0;pointer-events:none;z-index:6"></div>
      </div>

      <div class="ck-progress-wrap">
        <div class="ck-progress-bar" id="ckProgressBar"><div class="ck-progress-fill" id="ckProgressFill"></div></div>
        <div class="ck-times"><span id="ckCurTime">0:00</span><span id="ckDurTime">0:00</span></div>
      </div>

      <div class="ck-reactions-bar">
        ${['❤️','😂','👏','🔥','🥹'].map(e => `<span class="ck-reaction-pick" data-e="${e}">${e}</span>`).join('')}
      </div>

      <div class="ck-controls">
        <button class="ck-ctrl-btn" id="ckPrevBtn" title="Previous">⏮</button>
        <button class="ck-ctrl-btn play" id="ckPlayBtn" title="Play/Pause">▶</button>
        <button class="ck-ctrl-btn" id="ckNextBtn" title="Next">⏭</button>
        <button class="ck-ctrl-btn" id="ckMuteBtn" title="Mute mic">🎙</button>
        <button class="ck-ctrl-btn" id="ckCamBtn" title="Camera on/off">📷</button>
        <button class="ck-ctrl-btn" id="ckSwitchCamBtn" title="Switch camera">🔄</button>
        <button class="ck-ctrl-btn" id="ckSpeakerBtn" title="Speaker">🔊</button>
        <button class="ck-ctrl-btn rec" id="ckRecBtn" title="Record Our Duet">⏺</button>
      </div>
    `;
    document.body.appendChild(el);

    document.getElementById('ckLeaveBtn').onclick = () => leaveRoom(false);
    document.getElementById('ckPlayBtn').onclick = () => {
      const audio = window.AudioService.audio;
      if (Room.isHost) {
        if (audio.paused) { audio.play().catch(() => {}); broadcastControl('play'); }
        else { audio.pause(); broadcastControl('pause'); }
      } else {
        window.MusicPlayer.toast('Only the host controls playback 🎤');
      }
    };
    document.getElementById('ckPrevBtn').onclick = () => { if (Room.isHost) { window.AudioService.prev(); broadcastControl('track', { songId: window.AudioService.currentSong()?.id }); } };
    document.getElementById('ckNextBtn').onclick = () => { if (Room.isHost) { window.AudioService.next(true); broadcastControl('track', { songId: window.AudioService.currentSong()?.id }); } };
    document.getElementById('ckProgressBar').onclick = (e) => {
      if (!Room.isHost) return;
      const r = e.currentTarget.getBoundingClientRect();
      const pct = (e.clientX - r.left) / r.width;
      const t = pct * (window.AudioService.audio.duration || 0);
      window.AudioService.audio.currentTime = t;
      broadcastControl('seek', { time: t });
    };
    document.getElementById('ckMuteBtn').onclick = toggleMic;
    document.getElementById('ckCamBtn').onclick = toggleCamera;
    document.getElementById('ckSwitchCamBtn').onclick = switchCamera;
    document.getElementById('ckSpeakerBtn').onclick = toggleSpeaker;
    document.getElementById('ckRecBtn').onclick = toggleRecording;
    el.querySelectorAll('.ck-reaction-pick').forEach(pick => {
      pick.onclick = () => { const e = pick.dataset.e; spawnFloatingReaction(e); Channel.send({ type: 'reaction', emoji: e }); };
    });

    window.AudioService.on('time', ({ cur, dur }) => {
      if (!Room.open || !dur) return;
      document.getElementById('ckProgressFill').style.width = (cur / dur * 100) + '%';
      document.getElementById('ckCurTime').textContent = fmtTime(cur);
      document.getElementById('ckDurTime').textContent = fmtTime(dur);
      updateDuetLyricHighlight(cur);
    });
    window.AudioService.on('state', (playing) => {
      const btn = document.getElementById('ckPlayBtn'); if (btn && Room.open) btn.textContent = playing ? '⏸' : '▶';
    });
  }

  function showConnecting() { const el = document.getElementById('ckConnecting'); if (el) el.style.display = 'flex'; }
  function hideConnecting() { const el = document.getElementById('ckConnecting'); if (el) el.style.display = 'none'; }

  function updateRoomSongInfo(s) {
    const chip = document.getElementById('ckSongChip');
    if (chip) chip.textContent = `🎵 ${s.title}${s.artist ? ' — ' + s.artist : ''}`;
  }

  /* ═══════════════════════════════════════
     DUET LYRICS RENDER
  ═══════════════════════════════════════ */
  let duetLines = [];
  function loadDuetLyricsFor(song) {
    duetLines = parseDuetLRC(song.lyrics);
    if (!duetLines.length) {
      document.getElementById('ckLyricCur').textContent = '🎤 No synced lyrics for this song yet';
      document.getElementById('ckLyricNext').textContent = '';
    }
  }
  function speakerClass(sp) { return sp === 'a' ? 'speaker-a' : sp === 'b' ? 'speaker-b' : 'speaker-both'; }
  function updateDuetLyricHighlight(t) {
    if (!duetLines.length) return;
    let idx = -1;
    for (let i = 0; i < duetLines.length; i++) if (duetLines[i].time <= t) idx = i;
    const cur = duetLines[idx], next = duetLines[idx + 1];
    const curEl = document.getElementById('ckLyricCur'), nextEl = document.getElementById('ckLyricNext');
    if (cur && curEl) {
      curEl.textContent = cur.text;
      curEl.className = 'ck-lyric-cur ' + speakerClass(cur.speaker);
    }
    if (nextEl) nextEl.textContent = next ? next.text : '';
  }

  /* ═══════════════════════════════════════
     REACTIONS
  ═══════════════════════════════════════ */
  function spawnFloatingReaction(emoji) {
    const layer = document.getElementById('ckReactionsLayer'); if (!layer) return;
    const el = document.createElement('div');
    el.className = 'ck-floating-reaction';
    el.textContent = emoji;
    el.style.left = (10 + Math.random() * 75) + '%';
    layer.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  /* ═══════════════════════════════════════
     DEVICE CONTROLS
  ═══════════════════════════════════════ */
  function toggleMic() {
    Room.muted = !Room.muted;
    Room.localStream?.getAudioTracks().forEach(t => t.enabled = !Room.muted);
    document.getElementById('ckMuteBtn').classList.toggle('active', Room.muted);
    document.getElementById('ckMuteBtn').textContent = Room.muted ? '🔇' : '🎙';
  }
  function toggleCamera() {
    Room.cameraOff = !Room.cameraOff;
    Room.localStream?.getVideoTracks().forEach(t => t.enabled = !Room.cameraOff);
    document.getElementById('ckCamBtn').classList.toggle('active', Room.cameraOff);
  }
  async function switchCamera() {
    Room.cameraFacing = Room.cameraFacing === 'user' ? 'environment' : 'user';
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: Room.cameraFacing }, audio: false });
      const newTrack = newStream.getVideoTracks()[0];
      const sender = Room.pc?.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) await sender.replaceTrack(newTrack);
      const oldTrack = Room.localStream.getVideoTracks()[0];
      if (oldTrack) { Room.localStream.removeTrack(oldTrack); oldTrack.stop(); }
      Room.localStream.addTrack(newTrack);
      document.getElementById('ckSelfVideo').srcObject = Room.localStream;
    } catch (e) { window.MusicPlayer.toast('Could not switch camera'); }
  }
  function toggleSpeaker() {
    Room.speakerMuted = !Room.speakerMuted;
    const v = document.getElementById('ckPartnerVideo');
    v.muted = Room.speakerMuted;
    document.getElementById('ckSpeakerBtn').classList.toggle('active', Room.speakerMuted);
    document.getElementById('ckSpeakerBtn').textContent = Room.speakerMuted ? '🔈' : '🔊';
  }

  /* ═══════════════════════════════════════
     RECORDING → "Our Duet" in Memories
  ═══════════════════════════════════════ */
  function toggleRecording() { Room.recording ? stopRecording() : startRecording(); }
  function startRecording() {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 720; canvas.height = 1280;
      const ctx2d = canvas.getContext('2d');
      const partnerVid = document.getElementById('ckPartnerVideo');
      const selfVid = document.getElementById('ckSelfVideo');

      function drawFrame() {
        if (!Room.recording) return;
        ctx2d.fillStyle = '#03030a'; ctx2d.fillRect(0, 0, canvas.width, canvas.height);
        try { ctx2d.drawImage(partnerVid, 0, 0, canvas.width, canvas.height * 0.5); } catch (e) {}
        try { ctx2d.drawImage(selfVid, 0, canvas.height * 0.5, canvas.width, canvas.height * 0.5); } catch (e) {}
        const curLyric = document.getElementById('ckLyricCur')?.textContent || '';
        ctx2d.fillStyle = 'rgba(0,0,0,.35)'; ctx2d.fillRect(0, canvas.height * 0.44, canvas.width, 70);
        ctx2d.font = 'bold 26px sans-serif'; ctx2d.fillStyle = '#fff'; ctx2d.textAlign = 'center';
        ctx2d.fillText(curLyric.slice(0, 46), canvas.width / 2, canvas.height * 0.44 + 44);
        Room.recRafId = requestAnimationFrame(drawFrame);
      }
      Room.recCanvasStream = canvas.captureStream(30);
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const dest = audioCtx.createMediaStreamDestination();
      [Room.localStream, Room.remoteStream].forEach(stream => {
        if (!stream) return;
        try { audioCtx.createMediaStreamSource(stream).connect(dest); } catch (e) {}
      });
      dest.stream.getAudioTracks().forEach(t => Room.recCanvasStream.addTrack(t));

      Room.recChunks = [];
      Room.recorder = new MediaRecorder(Room.recCanvasStream, { mimeType: 'video/webm;codecs=vp8,opus' });
      Room.recorder.ondataavailable = e => { if (e.data.size) Room.recChunks.push(e.data); };
      Room.recorder.onstop = saveDuetRecording;
      Room.recording = true;
      Room.recorder.start();
      drawFrame();
      document.getElementById('ckRecBtn').classList.add('live');
      window.MusicPlayer.toast('Recording Our Duet 🎥');
    } catch (e) { window.MusicPlayer.toast('Recording not supported on this device'); }
  }
  function stopRecording() {
    Room.recording = false;
    if (Room.recRafId) cancelAnimationFrame(Room.recRafId);
    if (Room.recorder && Room.recorder.state !== 'inactive') Room.recorder.stop();
    document.getElementById('ckRecBtn').classList.remove('live');
  }
  function saveDuetRecording() {
    const blob = new Blob(Room.recChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    try {
      const ctx = Channel.ctx || window.MusicPlayer.getCoupleCtx();
      const key = 'ck_memories_' + (ctx ? ctx.coupleId : 'local');
      const existing = JSON.parse(localStorage.getItem(key) || '[]');
      existing.unshift({ id: Date.now(), title: 'Our Duet', date: new Date().toISOString().slice(0, 10), url, blobSize: blob.size });
      localStorage.setItem(key, JSON.stringify(existing));
    } catch (e) {}
    window.MusicPlayer.toast('Saved as "Our Duet" in Memories 💕');
    const a = document.createElement('a'); a.href = url; a.download = 'our-duet.webm'; a.click();
  }

  /* ═══════════════════════════════════════
     ROOM LIFECYCLE
  ═══════════════════════════════════════ */
  async function joinRoom(songId, isHost) {
    Room.open = true; Room.isHost = isHost; Room.songId = songId;
    Room.songList = window.Store.songs;
    injectRoom();
    document.getElementById('ckRoom').classList.add('open');
    showConnecting();

    const ctx = window.MusicPlayer.getCoupleCtx();
    if (ctx) {
      try {
        const fresh = await window.MusicPlayer.api('GET', '/api/music/' + ctx.coupleId);
        const idx = window.Store.songs.findIndex(x => x.id === songId);
        const freshSong = fresh.find(x => x.id === songId);
        if (freshSong && idx > -1) window.Store.songs[idx] = freshSong;
      } catch (e) {}
    }
    const song = window.Store.songs.find(x => x.id === songId);
    if (song) { updateRoomSongInfo(song); loadDuetLyricsFor(song); }

    if (isHost) {
      window.AudioService.play(Room.songList, songId);
      Room.syncBroadcastTimer = setInterval(broadcastSyncTick, SYNC_BROADCAST_MS);
    } else {
      window.AudioService.audio.pause();
    }

    Channel.startPolling(true);
    await setupPeerConnection(isHost);

    setTimeout(hideConnecting, 6000);
  }

  function onPartnerLeft() {
    window.MusicPlayer.toast('Your partner left the room 💔');
    leaveRoom(true);
  }

  function leaveRoom(silent) {
    if (!silent) Channel.send({ type: 'leave' });
    Room.open = false;
    if (Room.syncBroadcastTimer) clearInterval(Room.syncBroadcastTimer);
    if (Room.recording) stopRecording();
    if (Room.pc) { Room.pc.close(); Room.pc = null; }
    if (Room.localStream) { Room.localStream.getTracks().forEach(t => t.stop()); Room.localStream = null; }
    window.AudioService.audio.pause();
    const el = document.getElementById('ckRoom'); if (el) el.classList.remove('open');
    Channel.stopPolling();
    listenForInvites();
  }

  /* ═══════════════════════════════════════
     INIT
  ═══════════════════════════════════════ */
  whenReady(function () {
    injectStyles();
    injectFab();
    injectInviteOverlays();
    injectRoom();
    wireSignalHandling();
    listenForInvites();
  });

  window.CoupleKaraoke = {
  sendInvite,
  sendInviteById: function(songId) {
    const s = window.Store.songs.find(x => x.id === songId);
    if (s) sendInvite(s);
    else window.MusicPlayer.toast('Song not found');
  },
  joinRoom,
  leaveRoom
};
})();