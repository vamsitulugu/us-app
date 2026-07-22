

/**
 * US APP — index.html PATCH SCRIPT
 * ============================================================
 * This file contains ALL the JavaScript additions needed in index.html.
 * Paste these functions into your existing <script> block,
 * or include this file with: <script src="/index_patch.js"></script>
 * just before the closing </script> tag of your main script.
 * ============================================================
 */

// ── 1. PAGE TITLES (merge into existing pageTitles object) ──
// ADD these two lines inside your pageTitles = { ... } object:
//   games: 'Couple Games 🎮',
//   dreamgoals: 'Dream Goals 🌟',

// ── 2. THEME SYNC ──
function syncThemeToFrame(frameId) {
  const frame = document.getElementById(frameId);
  if (!frame) return;
  const trySync = () => {
    try {
      const root = getComputedStyle(document.documentElement);
      const vars = {};
      ['--h','--accent','--accent-d','--accent-l','--accent-glow',
       '--accent2','--accent2-d','--accent2-glow'].forEach(v => {
        vars[v] = root.getPropertyValue(v).trim();
      });
      frame.contentWindow.postMessage({ type: 'theme', vars }, '*');
    } catch(e) {}
  };
  if (frame.contentDocument && frame.contentDocument.readyState === 'complete') trySync();
  else frame.addEventListener('load', trySync, { once: true });
}

// ── 3. PATCH setTheme to also sync iframes ──
(function patchSetTheme() {
  const orig = window.setTheme;
  if (!orig) return;
  window.setTheme = function(name, silent) {
    orig(name, silent);
    setTimeout(() => {
      ['gamesFrame', 'musicFrame', 'dreamgoalsFrame'].forEach(syncThemeToFrame);
    }, 150);
  };
})();

// ── 4. DREAM GOALS SYNC ──
function syncDreamGoalsToFrame() {
  const frame = document.getElementById('dreamgoalsFrame');
  if (!frame) return;
  const doSync = () => {
    try {
      frame.contentWindow.postMessage({
        type: 'names',
        my: S.myName || 'You',
        partner: S.partnerName || 'Partner'
      }, '*');
      if (S.dreamGoals && S.dreamGoals.length) {
        frame.contentWindow.postMessage({
          type: 'syncDreams',
          dreams: S.dreamGoals
        }, '*');
      }
    } catch(e) {}
  };
  if (frame.contentDocument && frame.contentDocument.readyState === 'complete') doSync();
  else frame.addEventListener('load', doSync, { once: true });
}

// ── 5. RECEIVE MESSAGES FROM IFRAMES ──
window.addEventListener('message', function(e) {
  if (!e.data || !e.data.type) return;
  // Dream Goals → save to cloud state
  if (e.data.type === 'dreamgoals') {
    S.dreamGoals = e.data.dreams || [];
    scheduleSave();
  }
});

// ── 6. PATCH goto() — add new page handlers ──
// Find your existing goto() function and ADD these lines
// at the end of the function body (before the closing brace):
//
//   if (page === 'games') syncThemeToFrame('gamesFrame');
//   if (page === 'music') syncThemeToFrame('musicFrame');
//   if (page === 'dreamgoals') {
//     syncThemeToFrame('dreamgoalsFrame');
//     syncDreamGoalsToFrame();
//   }
//
// ALSO add these to pageTitles:
//   games: 'Couple Games 🎮',
//   dreamgoals: 'Dream Goals 🌟',

// ── 7. DASHBOARD: show dream goals stats ──
// In renderDashboard(), you can add:
// document.getElementById('bucketCount').textContent =
//   (S.bucket || []).length + (S.dreamGoals || []).length;

/* ═══════════════════════════════════════════════════════════════
   HEARTBEAT CONNECTION — Global Feature for US ❤️ App
   File: public/index_patch.js
   Load AFTER the main <script> block in index.html
   ═══════════════════════════════════════════════════════════════ */

'use strict';

/* ── 1. HEARTBEAT MANAGER ───────────────────────────────────── */
const HeartbeatManager = (() => {

  /* Internal state */
  const _state = {
    myStatus: 'online',          // online | idle | away | typing | voice | video
    myActivity: null,            // chat | music | globe | meetplanner | …
    partnerStatus: 'offline',
    partnerActivity: null,
    partnerLastSeen: null,
    bothOnline: false,
    sessionStart: null,          // Date.now() when both came online
    currentTheme: 'crystal',     // unlockable heart theme
    rafId: null,
    pulseRafId: null,
    idleTimer: null,
    presencePushTimer: null,
    _lastPartnerTs: 0,
    initialized: false,
  };

  /* ── PUBLIC PRESENCE STATUS LABELS ── */
  const STATUS_LABELS = {
    online:      '🟢 Online',
    idle:        '🟡 Idle',
    away:        '⚫ Away',
    typing:      '💬 Typing…',
    voice:       '🎙️ On a Call',
    video:       '📹 Video Call',
    music:       '🎵 Listening',
    watching:    '🎬 Watching',
    gaming:      '🎮 Gaming',
    meetplanner: '📍 Meet Planner',
    globe:       '🌍 Memory Globe',
    offline:     '⚫ Offline',
  };

  /* ── HEART THEMES ── */
  const HEART_THEMES = {
    crystal:     { primary: '#a5f3fc', secondary: '#67e8f9', glow: 'rgba(165,243,252,0.6)', emoji: '💎' },
    galaxy:      { primary: '#818cf8', secondary: '#c084fc', glow: 'rgba(129,140,248,0.6)', emoji: '🌌' },
    golden:      { primary: '#fbbf24', secondary: '#f59e0b', glow: 'rgba(251,191,36,0.6)',  emoji: '🏆' },
    rose:        { primary: '#fb7185', secondary: '#f43f5e', glow: 'rgba(251,113,133,0.6)', emoji: '🌹' },
    fire:        { primary: '#fb923c', secondary: '#ef4444', glow: 'rgba(251,146,60,0.6)',  emoji: '🔥' },
    neon:        { primary: '#4ade80', secondary: '#22d3ee', glow: 'rgba(74,222,128,0.6)',  emoji: '⚡' },
    diamond:     { primary: '#e2e8f0', secondary: '#cbd5e1', glow: 'rgba(226,232,240,0.6)', emoji: '💠' },
    aurora:      { primary: '#86efac', secondary: '#67e8f9', glow: 'rgba(134,239,172,0.6)', emoji: '🌈' },
    anniversary: { primary: '#f9a8d4', secondary: '#f472b6', glow: 'rgba(249,168,212,0.6)', emoji: '💍' },
    valentine:   { primary: '#ff6b9d', secondary: '#c2185b', glow: 'rgba(255,107,157,0.6)', emoji: '💝' },
  };

  /* ── EMOJI REACTIONS ── */
  const REACTIONS = ['❤️','🥰','😘','😍','😭','😂','🔥','💕','✨','🌹'];

  /* ══════════════════════════════════════════════════════════════
     PRESENCE — push & receive
  ══════════════════════════════════════════════════════════════ */
  function pushPresence(status, activity) {
    _state.myStatus   = status   || _state.myStatus;
    _state.myActivity = activity || _state.myActivity;

    /* Write into the shared S state so saveToCloud picks it up */
    try {
      if (!window.S) return;
      if (!S.heartbeat) S.heartbeat = {};
      S.heartbeat.myPresence = {
        status:   _state.myStatus,
        activity: _state.myActivity,
        ts:       Date.now(),
        role:     S.role,
        name:     S.myName,
      };
      if (typeof window.scheduleSave === 'function') window.scheduleSave();
    } catch(e) {}
  }

  function pullPartnerPresence() {
    try {
      if (!window.S || !S.heartbeat) return;
      const pp = S.heartbeat.partnerPresence;
      if (!pp) { _handlePartnerOffline(); return; }

      /* Consider partner offline if last seen > 30s ago */
      const age = Date.now() - (pp.ts || 0);
      if (age > 30000) { _handlePartnerOffline(); return; }

      const wasOnline = _state.partnerStatus !== 'offline';
      _state.partnerStatus   = pp.status   || 'online';
      _state.partnerActivity = pp.activity || null;
      _state.partnerLastSeen = pp.ts;

      /* Detect newly both-online */
      const bothNow = _state.myStatus !== 'offline' && _state.partnerStatus !== 'offline';
      if (!_state.bothOnline && bothNow) {
        _state.bothOnline   = true;
        _state.sessionStart = Date.now();
        _onBothOnline();
      }
      if (_state.bothOnline && !bothNow) {
        _state.bothOnline = false;
        _onPartnerLeft();
      }

      _updateUI();
    } catch(e) {}
  }

  function _handlePartnerOffline() {
    if (_state.partnerStatus === 'offline') return;
    _state.partnerStatus = 'offline';
    if (_state.bothOnline) { _state.bothOnline = false; _onPartnerLeft(); }
    _updateUI();
  }

  /* Mirror own presence into the partner-readable slot when we're user1/user2 */
  function _mirrorPresenceForPartner() {
    try {
      if (!window.S || !S.heartbeat) return;
      /* user1 writes myPresence; user2 reads it as partnerPresence and vice-versa.
         The API just saves the whole state blob — both partners read
         S.heartbeat.myPresence from the OTHER user's last save.
         We label it properly so pullPartnerPresence works symmetrically. */
      if (!S.heartbeat.partnerPresenceKey) {
        /* First time: tag which key is ours so the other partner reads the right one */
        S.heartbeat.partnerPresenceKey = S.role === 'user1' ? 'p1' : 'p2';
      }
      /* Write role-tagged presence */
      const key = S.role === 'user1' ? 'presence_u1' : 'presence_u2';
      S.heartbeat[key] = {
        status:   _state.myStatus,
        activity: _state.myActivity,
        ts:       Date.now(),
        name:     S.myName,
        role:     S.role,
      };

      /* Read partner */
      const pKey = S.role === 'user1' ? 'presence_u2' : 'presence_u1';
      const pp   = S.heartbeat[pKey];
      if (pp) S.heartbeat.partnerPresence = pp;

    } catch(e) {}
  }

  /* ══════════════════════════════════════════════════════════════
     EVENTS
  ══════════════════════════════════════════════════════════════ */
  function _onBothOnline() {
    _renderHeartbeatWidget();
    _startPulseAnimation();
    if (typeof window.spawnPetals === 'function') window.spawnPetals(8);
    if (typeof window.toast === 'function') {
      window.toast('💓 ' + (window.S?.partnerName || 'Partner') + ' is online! You\'re connected ✨', 4000);
    }
    _sendHeartbeatNotification();
    /* Record session start for stats */
    if (!S.heartbeat) S.heartbeat = {};
    if (!S.heartbeat.stats) S.heartbeat.stats = {};
    S.heartbeat.stats.lastSessionStart = Date.now();
  }

  function _onPartnerLeft() {
    _stopPulseAnimation();
    _recordSession();
    _updateUI();
    if (typeof window.toast === 'function') {
      window.toast('💔 ' + (window.S?.partnerName || 'Partner') + ' went offline', 3000);
    }
  }

  function _recordSession() {
    if (!_state.sessionStart) return;
    const dur = Date.now() - _state.sessionStart;
    if (!S.heartbeat) S.heartbeat = {};
    if (!S.heartbeat.stats) S.heartbeat.stats = {};
    const stats = S.heartbeat.stats;
    stats.totalConnectionMs = (stats.totalConnectionMs || 0) + dur;
    stats.sessionsCount     = (stats.sessionsCount || 0) + 1;
    const today = new Date().toISOString().slice(0,10);
    if (!stats.daily) stats.daily = {};
    stats.daily[today] = (stats.daily[today] || 0) + dur;
    _state.sessionStart = null;
    if (typeof window.scheduleSave === 'function') window.scheduleSave();
  }

  function _sendHeartbeatNotification() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible' && document.hasFocus()) return;
    try {
      new Notification('💓 ' + (window.S?.partnerName || 'Partner') + ' is online!', {
        body: 'Your hearts are connected right now ✨',
        icon: '/icons/icon-192.png',
        tag:  'heartbeat-online',
      });
    } catch(e) {}
  }

  /* ══════════════════════════════════════════════════════════════
     UI — DASHBOARD WIDGET
  ══════════════════════════════════════════════════════════════ */
  function _renderHeartbeatWidget() {
    const container = document.getElementById('hbWidgetContainer');
    if (!container) return;

    const paired   = window.S?.paired;
    const pName    = window.S?.partnerName || 'Partner';
    const myName   = window.S?.myName || 'You';
    const theme    = HEART_THEMES[_state.currentTheme] || HEART_THEMES.crystal;
    const both     = _state.bothOnline;
    const pStatus  = STATUS_LABELS[_state.partnerStatus] || '⚫ Offline';
    const pAct     = _state.partnerActivity ? STATUS_LABELS[_state.partnerActivity] || '' : '';

    if (!paired) {
      container.innerHTML = `
        <div class="hb-card hb-unpaired">
          <div class="hb-title">💓 Heartbeat Connection</div>
          <div class="hb-sub" style="color:var(--text3);font-size:12px;margin-top:6px">
            Pair with your partner to activate real-time connection
          </div>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div class="hb-card ${both ? 'hb-both-online' : ''}">
        <!-- BOTH ONLINE BANNER -->
        ${both ? `
        <div class="hb-online-banner">
          <div class="hb-pulse-dot"></div>
          <span>Both online now</span>
          <span class="hb-session-time" id="hbSessionTime"></span>
        </div>` : ''}

        <!-- HEART ANIMATION -->
        <div class="hb-hearts-wrap" id="hbHeartsWrap">
          <div class="hb-heart-scene">
            <div class="hb-heart hb-heart-left ${both ? 'hb-merge' : ''}" id="hbHeartLeft">
              <div class="hb-av hb-av1">${_getAvatar('my')}</div>
            </div>
            <div class="hb-beam ${both ? 'hb-beam-active' : ''}" id="hbBeam"></div>
            <div class="hb-heart hb-heart-right ${both ? 'hb-merge' : ''}" id="hbHeartRight">
              <div class="hb-av hb-av2">${_getAvatar('pt')}</div>
            </div>
          </div>
          <!-- Particle canvas -->
          <canvas class="hb-canvas" id="hbCanvas"></canvas>
          <!-- Emoji reactions -->
          <div class="hb-reaction-row" id="hbReactionRow">
            ${REACTIONS.map(e => `<div class="hb-reaction-btn" onclick="HeartbeatManager.sendReaction('${e}')">${e}</div>`).join('')}
          </div>
        </div>

        <!-- PARTNER STATUS -->
        <div class="hb-status-row">
          <div class="hb-status-block">
            <div class="hb-status-name">${esc(myName)}</div>
            <div class="hb-status-badge hb-status-online">${STATUS_LABELS[_state.myStatus]}</div>
          </div>
          <div class="hb-status-divider">💕</div>
          <div class="hb-status-block">
            <div class="hb-status-name">${esc(pName)}</div>
            <div class="hb-status-badge ${_statusClass(_state.partnerStatus)}">${pStatus}${pAct ? ' · ' + pAct : ''}</div>
          </div>
        </div>

        <!-- STATS ROW -->
        <div class="hb-stats-row" id="hbStatsRow">
          <div class="hb-stat-mini">
            <div class="hb-stat-n" id="hbStatToday">0m</div>
            <div class="hb-stat-l">Today</div>
          </div>
          <div class="hb-stat-mini">
            <div class="hb-stat-n" id="hbStatStreak">0🔥</div>
            <div class="hb-stat-l">Streak</div>
          </div>
          <div class="hb-stat-mini">
            <div class="hb-stat-n" id="hbStatSessions">0</div>
            <div class="hb-stat-l">Sessions</div>
          </div>
          <div class="hb-stat-mini" style="cursor:pointer" onclick="HeartbeatManager.openStats()">
            <div class="hb-stat-n">📊</div>
            <div class="hb-stat-l">Stats</div>
          </div>
        </div>

        <!-- INCOMING REACTION DISPLAY -->
        <div class="hb-incoming-reaction" id="hbIncomingReaction"></div>
      </div>`;

    _updateStats();
    _startParticleEngine();
    _startSessionTimer();
  }

  function _getAvatar(who) {
    try {
      const src = who === 'my' ? window.S?.myAvatar : window.S?.partnerAvatar;
      const name = who === 'my' ? (window.S?.myName || 'U') : (window.S?.partnerName || 'P');
      if (src) return `<img src="${src}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;position:absolute;inset:0">`;
      return name[0] || (who === 'my' ? 'U' : 'P');
    } catch(e) { return who === 'my' ? 'U' : 'P'; }
  }

  function _statusClass(status) {
    if (status === 'online' || status === 'typing') return 'hb-status-online';
    if (status === 'idle')   return 'hb-status-idle';
    if (status === 'away')   return 'hb-status-away';
    return 'hb-status-offline';
  }

  function esc(s) { return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  /* ── SESSION TIMER ── */
  let _sessionTimerRaf;
  function _startSessionTimer() {
    function tick() {
      const el = document.getElementById('hbSessionTime');
      if (!el || !_state.sessionStart) return;
      const sec = Math.floor((Date.now() - _state.sessionStart) / 1000);
      const m = Math.floor(sec / 60), s = sec % 60;
      el.textContent = m + ':' + String(s).padStart(2,'0');
      _sessionTimerRaf = requestAnimationFrame(tick);
    }
    cancelAnimationFrame(_sessionTimerRaf);
    if (_state.sessionStart) _sessionTimerRaf = requestAnimationFrame(tick);
  }

  /* ── STATS UPDATE ── */
  function _updateStats() {
    try {
      const stats  = (window.S?.heartbeat?.stats) || {};
      const today  = new Date().toISOString().slice(0,10);
      const todayMs = (stats.daily || {})[today] || 0;
      const todayMin = Math.round(todayMs / 60000);
      const sessions = stats.sessionsCount || 0;

      /* Streak: count consecutive days with connection time */
      let streak = 0;
      const daily = stats.daily || {};
      for (let i = 0; i < 60; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const ds = d.toISOString().slice(0,10);
        if ((daily[ds] || 0) > 0) streak++;
        else if (i > 0) break;
      }

      const tn = document.getElementById('hbStatToday');
      const ts = document.getElementById('hbStatStreak');
      const tss = document.getElementById('hbStatSessions');
      if (tn)  tn.textContent  = todayMin >= 60 ? Math.floor(todayMin/60)+'h' : todayMin+'m';
      if (ts)  ts.textContent  = streak + '🔥';
      if (tss) tss.textContent = sessions;
    } catch(e) {}
  }

  /* ── UPDATE ALL UI ── */
  function _updateUI() {
    _renderHeartbeatWidget();
    _updateSidebarPresence();
    _updateTopbarPresence();
  }

  /* ── SIDEBAR PRESENCE DOT ── */
  function _updateSidebarPresence() {
    try {
      const el = document.getElementById('hbSidebarPresence');
      if (!el) return;
      const pName = window.S?.partnerName || 'Partner';
      const status = _state.partnerStatus;
      const label  = STATUS_LABELS[status] || '⚫ Offline';
      el.innerHTML = `
        <div class="hb-sb-row">
          <div class="hb-sb-dot hb-sb-${status === 'offline' ? 'off' : 'on'}"></div>
          <span class="hb-sb-label">${esc(pName)}: ${label}</span>
        </div>`;
    } catch(e) {}
  }

  /* ── TOPBAR PRESENCE PILL ── */
  function _updateTopbarPresence() {
    try {
      const el = document.getElementById('hbTopbarPill');
      if (!el) return;
      if (!window.S?.paired) { el.style.display = 'none'; return; }
      const status = _state.partnerStatus;
      el.style.display = 'inline-flex';
      el.className = `hb-topbar-pill hb-tp-${status === 'offline' ? 'off' : 'on'}`;
      el.innerHTML = `<div class="hb-tp-dot"></div><span>${esc(window.S?.partnerName || 'Partner')}</span>`;
    } catch(e) {}
  }

  /* ══════════════════════════════════════════════════════════════
     PARTICLE ENGINE (Canvas)
  ══════════════════════════════════════════════════════════════ */
  let _particles = [];
  let _particleRaf;

  function _startParticleEngine() {
    const canvas = document.getElementById('hbCanvas');
    if (!canvas) return;
    const parent = canvas.parentElement;
    canvas.width  = parent.offsetWidth  || 300;
    canvas.height = parent.offsetHeight || 180;

    _particles = [];
    cancelAnimationFrame(_particleRaf);

    function loop() {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      /* Spawn particles when both online */
      if (_state.bothOnline && Math.random() < 0.12) {
        _spawnParticle(canvas);
      }

      /* Update & draw */
      _particles = _particles.filter(p => p.life > 0);
      _particles.forEach(p => {
        p.x   += p.vx;
        p.y   += p.vy;
        p.vy  -= 0.04;
        p.life -= 1;
        p.scale = Math.max(0, p.life / p.maxLife);
        ctx.save();
        ctx.globalAlpha = p.scale * 0.8;
        ctx.font = `${p.size * p.scale}px serif`;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillText(p.emoji, 0, 0);
        ctx.restore();
      });

      _particleRaf = requestAnimationFrame(loop);
    }
    loop();
  }

  function _spawnParticle(canvas) {
    const emojis = ['💕','❤️','✨','💫','🌹'];
    _particles.push({
      x:      canvas.width  / 2 + (Math.random() - 0.5) * 80,
      y:      canvas.height / 2 + (Math.random() - 0.5) * 40,
      vx:     (Math.random() - 0.5) * 1.5,
      vy:     -(0.8 + Math.random() * 1.2),
      size:   14 + Math.random() * 10,
      emoji:  emojis[Math.floor(Math.random() * emojis.length)],
      maxLife:60 + Math.random() * 40,
      life:   60 + Math.random() * 40,
      scale:  1,
      rot:    (Math.random() - 0.5) * 0.5,
    });
  }

  /* Burst on message send */
  function burstParticles(x, y, count) {
    const canvas = document.getElementById('hbCanvas');
    if (!canvas || !_state.bothOnline) return;
    const emojis = ['💕','❤️','✨','💫'];
    for (let i = 0; i < (count || 8); i++) {
      _particles.push({
        x:      x || canvas.width  / 2,
        y:      y || canvas.height / 2,
        vx:     (Math.random() - 0.5) * 3,
        vy:     -(1 + Math.random() * 2.5),
        size:   16 + Math.random() * 10,
        emoji:  emojis[Math.floor(Math.random() * emojis.length)],
        maxLife:50,
        life:   50,
        scale:  1,
        rot:    (Math.random() - 0.5) * 0.8,
      });
    }
  }

  /* ══════════════════════════════════════════════════════════════
     PULSE ANIMATION (heartbeat rate changes with activity)
  ══════════════════════════════════════════════════════════════ */
  function _startPulseAnimation() {
    const ring = document.getElementById('hbPulseRing');
    if (ring) ring.classList.add('hb-ring-active');
  }

  function _stopPulseAnimation() {
    const ring = document.getElementById('hbPulseRing');
    if (ring) ring.classList.remove('hb-ring-active');
  }

  /* ══════════════════════════════════════════════════════════════
     CHAT INTEGRATION
  ══════════════════════════════════════════════════════════════ */
  function onChatTyping() {
    pushPresence('typing', 'chat');
    /* Accelerate heartbeat while typing */
    const card = document.querySelector('.hb-card');
    if (card) card.classList.add('hb-typing-active');
    clearTimeout(_state._typingTimeout);
    _state._typingTimeout = setTimeout(() => {
      pushPresence('online', 'chat');
      if (card) card.classList.remove('hb-typing-active');
    }, 2000);
  }

  function onMessageSent() {
    burstParticles();
    /* Global petal burst */
    if (typeof window.spawnPetals === 'function') window.spawnPetals(5);
  }

  function onVoiceCallStart() {
    pushPresence('voice', null);
    _updateUI();
    _activateVoiceWaveform();
  }

  function onVoiceCallEnd() {
    pushPresence('online', null);
    _updateUI();
    _deactivateVoiceWaveform();
  }

  function onVideoCallStart() {
    pushPresence('video', null);
    _updateUI();
  }

  function onVideoCallEnd() {
    pushPresence('online', null);
    _updateUI();
  }

  function onPageChange(page) {
    const pageToActivity = {
      music: 'music', globe: 'globe', games: 'gaming',
      meetplanner: 'meetplanner', chat: 'chat',
    };
    const activity = pageToActivity[page] || null;
    pushPresence('online', activity);
    _mirrorPresenceForPartner();
  }

  function _activateVoiceWaveform() {
    const wf = document.querySelector('.hb-voice-waveform');
    if (wf) wf.classList.add('hb-wf-active');
  }
  function _deactivateVoiceWaveform() {
    const wf = document.querySelector('.hb-voice-waveform');
    if (wf) wf.classList.remove('hb-wf-active');
  }

  /* ══════════════════════════════════════════════════════════════
     EMOJI REACTIONS
  ══════════════════════════════════════════════════════════════ */
  function sendReaction(emoji) {
    try {
      if (!window.S) return;
      if (!S.heartbeat) S.heartbeat = {};
      S.heartbeat.lastReaction = { emoji, from: S.role, ts: Date.now() };
      if (typeof window.scheduleSave === 'function') window.scheduleSave();
      _showReactionBurst(emoji);
      if (typeof window.toast === 'function') window.toast('Sent ' + emoji + ' to ' + (S.partnerName || 'partner') + '!');
    } catch(e) {}
  }

  let _lastReactionSeen = 0;
  function _checkIncomingReaction() {
    try {
      const r = window.S?.heartbeat?.lastReaction;
      if (!r || r.from === window.S?.role) return;
      if (r.ts <= _lastReactionSeen) return;
      _lastReactionSeen = r.ts;
      _showIncomingReaction(r.emoji);
    } catch(e) {}
  }

  function _showReactionBurst(emoji) {
    const wrap = document.getElementById('hbHeartsWrap');
    if (!wrap) return;
    for (let i = 0; i < 7; i++) {
      setTimeout(() => {
        const div = document.createElement('div');
        div.textContent = emoji;
        div.style.cssText = `
          position:absolute;font-size:${20+Math.random()*14}px;
          left:${20+Math.random()*60}%;top:${20+Math.random()*60}%;
          pointer-events:none;z-index:10;
          animation:hbReactionFloat 1.4s ease-out forwards;
        `;
        wrap.appendChild(div);
        setTimeout(() => div.remove(), 1500);
      }, i * 80);
    }
    burstParticles(null, null, 10);
  }

  function _showIncomingReaction(emoji) {
    const el = document.getElementById('hbIncomingReaction');
    if (!el) return;
    const pName = window.S?.partnerName || 'Partner';
    el.innerHTML = `<span class="hb-incoming-emoji">${emoji}</span><span>${esc(pName)} sent you ${emoji}</span>`;
    el.classList.add('hb-incoming-show');
    _showReactionBurst(emoji);
    if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
    if (typeof window.spawnPetals === 'function') window.spawnPetals(8);
    setTimeout(() => el.classList.remove('hb-incoming-show'), 4000);
  }

  /* ══════════════════════════════════════════════════════════════
     STATS DASHBOARD
  ══════════════════════════════════════════════════════════════ */
  function openStats() {
    try {
      const stats  = (window.S?.heartbeat?.stats) || {};
      const daily  = stats.daily || {};
      const today  = new Date().toISOString().slice(0,10);

      /* Build last 7 days */
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const ds = d.toISOString().slice(0,10);
        days.push({ label: d.toLocaleDateString('en',{weekday:'short'}), ms: daily[ds] || 0 });
      }
      const maxMs = Math.max(...days.map(d => d.ms), 1);

      /* Totals */
      const totalMs  = stats.totalConnectionMs || 0;
      const totalH   = Math.floor(totalMs / 3600000);
      const sessions = stats.sessionsCount || 0;
      const avgMs    = sessions ? totalMs / sessions : 0;
      const avgMin   = Math.round(avgMs / 60000);

      /* Streak */
      let streak = 0;
      for (let i = 0; i < 60; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        if ((daily[d.toISOString().slice(0,10)] || 0) > 0) streak++;
        else if (i > 0) break;
      }

      /* Show in a toast-style overlay */
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:8000;background:rgba(0,0,0,0.7);backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:center;padding:16px';
      overlay.innerHTML = `
        <div style="background:rgba(8,8,20,0.95);border:1px solid rgba(255,255,255,0.18);border-radius:22px;padding:24px;width:100%;max-width:400px;color:#fff;box-shadow:0 24px 80px rgba(0,0,0,0.5);animation:hbStatsPop 0.35s cubic-bezier(0.34,1.56,0.64,1)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
            <div style="font-family:'DM Serif Display',serif;font-size:20px">💓 Heartbeat Stats</div>
            <button onclick="this.closest('div[style*=fixed]').remove()" style="background:none;border:none;color:rgba(255,255,255,0.5);font-size:20px;cursor:pointer">✕</button>
          </div>

          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px">
            ${[
              { n: totalH + 'h', l: 'Total Together' },
              { n: sessions,     l: 'Sessions' },
              { n: avgMin + 'm', l: 'Avg Session' },
            ].map(s => `<div style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:12px;text-align:center">
              <div style="font-family:'DM Serif Display',serif;font-size:22px;color:#fff">${s.n}</div>
              <div style="font-size:9px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.5px;margin-top:3px">${s.l}</div>
            </div>`).join('')}
          </div>

          <div style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Last 7 Days</div>
          <div style="display:flex;gap:6px;align-items:flex-end;height:70px;margin-bottom:16px">
            ${days.map(d => {
              const pct = Math.max(4, Math.round((d.ms / maxMs) * 100));
              const min = Math.round(d.ms / 60000);
              return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
                <div style="font-size:9px;color:rgba(255,255,255,0.5)">${min>0?min+'m':''}</div>
                <div style="width:100%;border-radius:4px 4px 2px 2px;height:${pct}%;background:linear-gradient(135deg,var(--accent,#5b9bff),var(--accent2,hsl(300,85%,65%)));opacity:${d.ms>0?1:0.2};transition:height 0.6s ease"></div>
                <div style="font-size:9px;color:rgba(255,255,255,0.4);font-weight:600">${d.label}</div>
              </div>`;
            }).join('')}
          </div>

          <div style="display:flex;align-items:center;gap:10px;padding:12px;background:rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.25);border-radius:12px">
            <span style="font-size:24px">🔥</span>
            <div>
              <div style="font-size:14px;font-weight:700;color:#fff">${streak} Day Streak</div>
              <div style="font-size:11px;color:rgba(255,255,255,0.5)">Keep connecting every day!</div>
            </div>
          </div>
        </div>`;
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
      document.body.appendChild(overlay);
    } catch(e) { console.error('HB stats error:', e); }
  }

  /* ══════════════════════════════════════════════════════════════
     THEME MANAGER
  ══════════════════════════════════════════════════════════════ */
  function unlockTheme(themeKey) {
    if (!HEART_THEMES[themeKey]) return;
    _state.currentTheme = themeKey;
    if (window.S) {
      if (!S.heartbeat) S.heartbeat = {};
      S.heartbeat.heartTheme = themeKey;
      if (typeof window.scheduleSave === 'function') window.scheduleSave();
    }
    _renderHeartbeatWidget();
    if (typeof window.toast === 'function') window.toast('💎 ' + themeKey.charAt(0).toUpperCase() + themeKey.slice(1) + ' Heart unlocked!');
  }

  function _loadSavedTheme() {
    try {
      const saved = window.S?.heartbeat?.heartTheme;
      if (saved && HEART_THEMES[saved]) _state.currentTheme = saved;
    } catch(e) {}
  }

  /* ══════════════════════════════════════════════════════════════
     IDLE DETECTION
  ══════════════════════════════════════════════════════════════ */
  function _resetIdleTimer() {
    clearTimeout(_state.idleTimer);
    if (_state.myStatus === 'idle' || _state.myStatus === 'away') {
      pushPresence('online', _state.myActivity);
    }
    _state.idleTimer = setTimeout(() => {
      pushPresence('idle', _state.myActivity);
      _state.idleTimer = setTimeout(() => {
        pushPresence('away', null);
      }, 5 * 60 * 1000); // 5 min → away
    }, 2 * 60 * 1000); // 2 min → idle
  }

  /* ══════════════════════════════════════════════════════════════
     INIT
  ══════════════════════════════════════════════════════════════ */
  function init() {
    if (_state.initialized) return;
    _state.initialized = true;

    _loadSavedTheme();
    pushPresence('online', null);
    _mirrorPresenceForPartner();
    _resetIdleTimer();

    /* Hook idle detection */
    ['mousemove','keydown','touchstart','scroll','click'].forEach(ev => {
      document.addEventListener(ev, _resetIdleTimer, { passive: true });
    });

    /* Hook page visibility */
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) pushPresence('away', _state.myActivity);
      else { pushPresence('online', _state.myActivity); _resetIdleTimer(); }
      _mirrorPresenceForPartner();
    });

    /* Periodic presence mirror (every 8s) */
    _state.presencePushTimer = setInterval(() => {
      _mirrorPresenceForPartner();
      pullPartnerPresence();
      _checkIncomingReaction();
      _updateStats();
      _startSessionTimer();
    }, 8000);

    /* Initial UI render */
    setTimeout(() => {
      _renderHeartbeatWidget();
      _updateSidebarPresence();
      _updateTopbarPresence();
      pullPartnerPresence();
    }, 800);

    console.log('💓 HeartbeatManager initialized');
  }

  /* ══════════════════════════════════════════════════════════════
     HOOK INTO EXISTING APP FUNCTIONS
     (Called after app init, patches existing globals safely)
  ══════════════════════════════════════════════════════════════ */
  function hookIntoApp() {
    /* Hook goto() for page-change presence */
    const _origGoto = window.goto;
    if (_origGoto) {
      window.goto = function(page) {
        _origGoto(page);
        HeartbeatManager.onPageChange(page);
      };
    }


    /* Hook renderAll to re-render heartbeat widget */
    const _origRenderAll = window.renderAll;
    if (_origRenderAll) {
      window.renderAll = function() {
        _origRenderAll();
        setTimeout(() => {
          HeartbeatManager.pullPartnerPresence();
          HeartbeatManager._mirrorPresenceForPartner();
        }, 200);
      };
    }

    /* Hook loadFromCloud to pull presence after each sync */
    const _origLoad = window.loadFromCloud;
    if (_origLoad) {
      window.loadFromCloud = async function() {
        const result = await _origLoad();
        HeartbeatManager.pullPartnerPresence();
        HeartbeatManager._checkIncomingReaction();
        return result;
      };
    }
  }

  /* ── PUBLIC API ── */
  return {
    init,
    hookIntoApp,
    pushPresence,
    pullPartnerPresence,
    onPageChange,
    onChatTyping,
    onMessageSent,
    onVoiceCallStart,
    onVoiceCallEnd,
    onVideoCallStart,
    onVideoCallEnd,
    sendReaction,
    burstParticles,
    openStats,
    unlockTheme,
    _mirrorPresenceForPartner,
    _checkIncomingReaction,
    getState: () => ({ ..._state }),
  };

})();

/* ══════════════════════════════════════════════════════════════
   2. CSS INJECTION
   All heartbeat styles injected at runtime so index.html
   needs only ONE new line: <script src="/index_patch.js"></script>
══════════════════════════════════════════════════════════════ */
(function injectCSS() {
  const style = document.createElement('style');
  style.id = 'hb-styles';
  style.textContent = `

/* ── KEYFRAMES ── */
@keyframes hbReactionFloat {
  0%   { transform: translateY(0)  scale(1);   opacity:1 }
  100% { transform: translateY(-80px) scale(0.5); opacity:0 }
}
@keyframes hbStatsPop {
  from { opacity:0; transform:scale(0.88) translateY(20px) }
  to   { opacity:1; transform:scale(1)    translateY(0) }
}
@keyframes hbHeartPulse {
  0%,100% { transform: scale(1) }
  15%     { transform: scale(1.22) }
  30%     { transform: scale(1.08) }
  45%     { transform: scale(1.18) }
  60%     { transform: scale(1) }
}
@keyframes hbGlow {
  0%,100% { box-shadow: 0 0 18px var(--accent-glow); }
  50%     { box-shadow: 0 0 40px var(--accent-glow), 0 0 80px var(--accent2-glow); }
}
@keyframes hbBeamFlow {
  0%   { opacity:0.3; background-position: 0% 50%; }
  50%  { opacity:1;   background-position: 100% 50%; }
  100% { opacity:0.3; background-position: 0% 50%; }
}
@keyframes hbMergeLeft {
  0%,100% { transform: translateX(0) scale(1); }
  50%     { transform: translateX(8px) scale(1.06); }
}
@keyframes hbMergeRight {
  0%,100% { transform: translateX(0) scale(1); }
  50%     { transform: translateX(-8px) scale(1.06); }
}
@keyframes hbOnlineBanner {
  from { opacity:0; transform: translateY(-8px); }
  to   { opacity:1; transform: translateY(0); }
}
@keyframes hbRingPulse {
  0%   { transform: scale(1);    opacity:0.8; }
  50%  { transform: scale(1.12); opacity:0.4; }
  100% { transform: scale(1.22); opacity:0; }
}
@keyframes hbSbDotBlink {
  0%,100% { opacity:1 }
  50%     { opacity:0.3 }
}
@keyframes hbIncomingSlide {
  from { opacity:0; transform:translateY(8px); }
  to   { opacity:1; transform:translateY(0); }
}
@keyframes hbWaveform {
  from { transform:scaleY(0.4) }
  to   { transform:scaleY(1.0) }
}
@keyframes hbTypingPulse {
  0%,100% { box-shadow: 0 0 0 0 var(--accent-glow); }
  50%     { box-shadow: 0 0 0 8px transparent; }
}

/* ── HEARTBEAT CARD ── */
.hb-card {
  background: var(--g1);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid var(--border);
  border-radius: 22px;
  padding: 18px;
  margin-bottom: 16px;
  position: relative;
  overflow: hidden;
  transition: box-shadow 0.3s ease;
}
.hb-card.hb-both-online {
  border-color: rgba(255,255,255,0.2);
  animation: hbGlow 4s ease-in-out infinite;
}
.hb-card.hb-typing-active {
  animation: hbTypingPulse 0.6s ease-in-out infinite;
}

/* ── ONLINE BANNER ── */
.hb-online-banner {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  font-weight: 700;
  color: var(--green);
  background: var(--green-bg);
  border: 1px solid rgba(52,211,153,0.25);
  border-radius: 20px;
  padding: 5px 12px;
  margin-bottom: 14px;
  animation: hbOnlineBanner 0.4s ease;
  width: fit-content;
}
.hb-pulse-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--green);
  animation: hbSbDotBlink 1.5s ease-in-out infinite;
  flex-shrink: 0;
}
.hb-session-time {
  margin-left: auto;
  font-size: 10px;
  color: var(--green);
  font-variant-numeric: tabular-nums;
}

/* ── HEART SCENE ── */
.hb-hearts-wrap {
  position: relative;
  height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 14px;
}
.hb-canvas {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}
.hb-heart-scene {
  display: flex;
  align-items: center;
  gap: 16px;
  position: relative;
  z-index: 1;
}
.hb-heart {
  display: flex;
  align-items: center;
  justify-content: center;
  transition: var(--t);
}
.hb-av {
  width: 56px; height: 56px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px; font-weight: 700; color: #fff;
  position: relative; overflow: hidden;
  border: 3px solid rgba(255,255,255,0.35);
  box-shadow: 0 6px 24px rgba(0,0,0,0.3);
  animation: hbHeartPulse 2.4s ease-in-out infinite;
}
.hb-av1 { background: linear-gradient(135deg,var(--accent),var(--accent-d)); }
.hb-av2 { background: linear-gradient(135deg,var(--accent2),var(--accent2-d)); animation-delay: 0.15s; }
.hb-heart.hb-merge .hb-av1-wrap { animation: hbMergeLeft  2.4s ease-in-out infinite; }
.hb-heart.hb-merge .hb-av2-wrap { animation: hbMergeRight 2.4s ease-in-out infinite; }

/* ── CONNECTION BEAM ── */
.hb-beam {
  width: 60px; height: 4px; border-radius: 2px;
  background: var(--border);
  transition: all 0.6s ease;
  position: relative;
}
.hb-beam.hb-beam-active {
  background: linear-gradient(90deg,var(--accent),var(--accent2),var(--accent));
  background-size: 200% 100%;
  animation: hbBeamFlow 2s linear infinite;
  box-shadow: 0 0 12px var(--accent-glow);
}

/* ── PULSE RING ── */
#hbPulseRing {
  position: absolute;
  inset: 50%;
  transform: translate(-50%,-50%);
  width: 72px; height: 72px;
  border-radius: 50%;
  border: 2px solid var(--accent);
  pointer-events: none;
  opacity: 0;
}
#hbPulseRing.hb-ring-active {
  animation: hbRingPulse 2.4s ease-out infinite;
}

/* ── REACTION ROW ── */
.hb-reaction-row {
  position: absolute;
  bottom: 6px; left: 50%;
  transform: translateX(-50%);
  display: flex; gap: 4px;
  z-index: 2;
  background: rgba(8,8,20,0.6);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 4px 8px;
}
.hb-reaction-btn {
  font-size: 18px; cursor: pointer;
  padding: 2px 4px; border-radius: 8px;
  transition: transform 0.15s;
  user-select: none;
}
.hb-reaction-btn:hover { transform: scale(1.25); }
.hb-reaction-btn:active { transform: scale(0.9); }

/* ── STATUS ROW ── */
.hb-status-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.hb-status-block { flex: 1; text-align: center; }
.hb-status-name {
  font-size: 11px; font-weight: 700;
  color: var(--text2);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  margin-bottom: 4px;
}
.hb-status-badge {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 10px; font-weight: 600;
  padding: 3px 10px; border-radius: 20px;
}
.hb-status-online  { background: var(--green-bg);  color: var(--green);  border: 1px solid rgba(52,211,153,0.3); }
.hb-status-idle    { background: var(--yellow-bg); color: var(--yellow); border: 1px solid rgba(251,191,36,0.3); }
.hb-status-away    { background: var(--red-bg);    color: var(--red);    border: 1px solid rgba(248,113,113,0.3); }
.hb-status-offline { background: var(--g2);        color: var(--text3);  border: 1px solid var(--border); }
.hb-status-divider { font-size: 20px; flex-shrink: 0; animation: hbHeartPulse 2.4s ease-in-out infinite; }

/* ── MINI STATS ── */
.hb-stats-row {
  display: grid; grid-template-columns: repeat(4,1fr);
  gap: 8px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
  margin-top: 4px;
}
.hb-stat-mini { text-align: center; }
.hb-stat-n {
  font-family: 'DM Serif Display', Georgia, serif;
  font-size: 16px; color: var(--white); line-height: 1;
}
.hb-stat-l {
  font-size: 9px; color: var(--text3);
  text-transform: uppercase; letter-spacing: 0.5px;
  margin-top: 3px; font-weight: 600;
}

/* ── INCOMING REACTION ── */
.hb-incoming-reaction {
  display: none;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding: 8px 13px;
  background: rgba(255,107,157,0.12);
  border: 1px solid rgba(255,107,157,0.25);
  border-radius: 12px;
  font-size: 12px;
  color: var(--text2);
}
.hb-incoming-reaction.hb-incoming-show {
  display: flex;
  animation: hbIncomingSlide 0.4s ease;
}
.hb-incoming-emoji { font-size: 22px; }

/* ── SIDEBAR PRESENCE ── */
.hb-sb-row {
  display: flex; align-items: center; gap: 6px;
  font-size: 10px; color: var(--text3);
  padding: 4px 2px 2px;
}
.hb-sb-dot {
  width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
}
.hb-sb-on  { background: var(--green); animation: hbSbDotBlink 2s ease-in-out infinite; }
.hb-sb-off { background: var(--text3); }
.hb-sb-label { font-size: 10px; color: var(--text3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── TOPBAR PILL ── */
.hb-topbar-pill {
  display: none;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 20px;
  cursor: pointer;
  transition: var(--t);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.hb-tp-on  { background: var(--green-bg);  color: var(--green);  border: 1px solid rgba(52,211,153,0.3); }
.hb-tp-off { background: var(--g2);        color: var(--text3);  border: 1px solid var(--border); }
.hb-tp-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: currentColor;
}
.hb-tp-on .hb-tp-dot { animation: hbSbDotBlink 1.5s ease-in-out infinite; }

/* ── CHAT TYPING PULSE OVERLAY ── */
.hb-chat-typing-indicator {
  display: none;
  position: absolute;
  top: -2px; left: -2px; right: -2px; bottom: -2px;
  border-radius: inherit;
  pointer-events: none;
  border: 2px solid var(--accent);
  animation: hbTypingPulse 0.8s ease-in-out infinite;
  z-index: 0;
}
.hb-chat-typing-indicator.active { display: block; }

/* ── VOICE WAVEFORM WIDGET ── */
.hb-voice-waveform {
  display: none;
  align-items: center;
  gap: 3px;
  height: 24px;
}
.hb-voice-waveform.hb-wf-active { display: flex; }
.hb-voice-waveform span {
  display: inline-block;
  width: 3px;
  background: var(--accent);
  border-radius: 2px;
  animation: hbWaveform 0.6s ease-in-out infinite alternate;
}
.hb-voice-waveform span:nth-child(2n) { animation-delay: 0.1s; height: 14px; }
.hb-voice-waveform span:nth-child(3n) { animation-delay: 0.2s; height: 18px; }
.hb-voice-waveform span:nth-child(1)  { height: 10px; }
.hb-voice-waveform span:nth-child(4)  { height: 22px; }
.hb-voice-waveform span:nth-child(5)  { height: 8px;  }

/* ── MOBILE RESPONSIVE ── */
@media(max-width:700px) {
  .hb-hearts-wrap { height: 120px; }
  .hb-av { width: 46px; height: 46px; font-size: 16px; }
  .hb-beam { width: 40px; }
  .hb-stats-row { gap: 4px; }
  .hb-stat-n { font-size: 14px; }
  .hb-reaction-row { padding: 3px 6px; gap: 2px; }
  .hb-reaction-btn { font-size: 16px; }
  .hb-topbar-pill span { display: none; }
}
  `;
  document.head.appendChild(style);
})();

/* ══════════════════════════════════════════════════════════════
   3. AUTO-INIT after DOM + app are ready
══════════════════════════════════════════════════════════════ */
(function autoInit() {
  function tryInit() {
    if (typeof window.S !== 'undefined' && window.S.coupleId) {
      HeartbeatManager.init();
      HeartbeatManager.hookIntoApp();
    } else {
      setTimeout(tryInit, 500);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(tryInit, 1200));
  } else {
    setTimeout(tryInit, 1200);
  }
})();