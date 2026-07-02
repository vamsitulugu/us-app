/* ══════════════════════════════════════════════════════════════
   DASHBOARD + CHAT PATCH — us-app
   Feature 1: Unified "Stay Connected" card (Touch + Hug + Miss You)
   Feature 2: WhatsApp-style Chat Wallpaper Manager (crop/blur/
              brightness/overlay/opacity, stored as base64 — no
              network fetch, so nothing to flicker or re-download)

   Load AFTER your main index.html script (and after index_patch.js /
   livemap.js if present):
     <script src="/dashboard_chat_patch.js"></script>

   Requires globals from your main app: S, api, toast, esc, scheduleSave,
   goto, spawnPetals, sendTouch, sendHug, sendMissYou, acceptHug,
   checkIncomingTouch, checkIncomingMissYou, checkIncomingHug,
   renderMissYouStats, renderHugStats (all already defined in index.html).
   ══════════════════════════════════════════════════════════════ */
'use strict';

/* ══════════════════════════════════════════════════════════════
   1. CSS INJECTION
   ══════════════════════════════════════════════════════════════ */
(function injectCSS() {
  const style = document.createElement('style');
  style.id = 'dc-patch-styles';
  style.textContent = `
/* ── CONNECTION CARD ── */
.cc-card{
  background:linear-gradient(160deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02));
  backdrop-filter:blur(28px) saturate(190%);
  -webkit-backdrop-filter:blur(28px) saturate(190%);
  border:1px solid var(--border2);
  position:relative; overflow:hidden;
}
.cc-card::before{
  content:'';position:absolute;inset:0;
  background:radial-gradient(ellipse at 50% -10%, hsla(var(--h),100%,62%,0.14), transparent 60%);
  pointer-events:none;
}
.cc-actions{
  display:flex; justify-content:center; gap:14px;
  padding:6px 0 18px; position:relative; z-index:1;
}
.cc-btn{
  display:flex; flex-direction:column; align-items:center; gap:6px;
  background:var(--g1); border:1px solid var(--border);
  border-radius:20px; padding:14px 18px; cursor:pointer;
  transition:var(--t-spring); color:#fff; font-family:var(--ff-sans);
  min-width:78px;
}
.cc-btn:hover{ transform:translateY(-3px); background:var(--g2); }
.cc-btn:active{ transform:scale(0.92); }
.cc-btn .cc-ico{ font-size:26px; line-height:1; transition:var(--t-spring); }
.cc-btn .cc-lbl{ font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.4px; color:var(--text2); }
.cc-touch{ box-shadow:0 4px 0 0 transparent; }
.cc-touch:hover .cc-ico{ transform:scale(1.15); }
.cc-hug:hover .cc-ico{ transform:rotate(-8deg) scale(1.1); }
.cc-miss:hover .cc-ico{ transform:scale(1.15) rotate(5deg); }
.cc-btn.cc-sent{ animation:ccSentPulse 0.6s ease; }
@keyframes ccSentPulse{0%{transform:scale(1)}40%{transform:scale(0.86)}70%{transform:scale(1.12)}100%{transform:scale(1)}}
.cc-btn.cc-touch.cc-active{ background:linear-gradient(135deg,var(--accent),var(--accent-d)); border-color:transparent; box-shadow:0 6px 18px var(--accent-glow); }
.cc-btn.cc-hug.cc-active{ background:linear-gradient(135deg,var(--accent2),var(--accent2-d)); border-color:transparent; box-shadow:0 6px 18px var(--accent2-glow); }
.cc-btn.cc-miss.cc-active{ background:linear-gradient(135deg,#ff6b9d,#c2185b); border-color:transparent; box-shadow:0 6px 18px rgba(255,107,157,0.4); }

.cc-burst-layer{
  position:absolute; inset:0; pointer-events:none; overflow:hidden; z-index:2;
}
.cc-burst-emoji{
  position:absolute; font-size:20px; opacity:0;
  animation:ccBurstUp 1.3s ease-out forwards;
}
@keyframes ccBurstUp{
  0%{ opacity:0; transform:translateY(0) scale(0.5); }
  15%{ opacity:1; transform:translateY(-6px) scale(1.1); }
  100%{ opacity:0; transform:translateY(-70px) scale(0.8); }
}

.cc-stats{
  display:grid; grid-template-columns:repeat(4,1fr); gap:8px;
  border-top:1px solid var(--border); padding-top:14px; position:relative; z-index:1;
}
.cc-stat{ text-align:center; }
.cc-stat-ico{ font-size:15px; margin-bottom:2px; }
.cc-stat-v{
  font-family:var(--ff-serif); font-size:14px; color:var(--white); line-height:1.1;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.cc-stat-l{ font-size:8px; color:var(--text3); text-transform:uppercase; letter-spacing:0.4px; margin-top:3px; font-weight:600; }
@media(max-width:420px){
  .cc-stats{ grid-template-columns:repeat(2,1fr); gap:12px 8px; }
  .cc-btn{ padding:12px 14px; min-width:66px; }
}


`;
  document.head.appendChild(style);
})();

/* ══════════════════════════════════════════════════════════════
   2. CONNECTION CARD (Feature 1)
   ══════════════════════════════════════════════════════════════ */
const ConnCard = (() => {

  function fmtAgo(ts) {
    if (!ts) return '—';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 10) return 'now';
    if (s < 60) return s + 's ago';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function burst(btnId, emojis) {
    const layer = document.getElementById('ccBurstLayer');
    const btn = document.getElementById(btnId);
    if (!layer || !btn) return;
    const cardRect = layer.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const cx = btnRect.left - cardRect.left + btnRect.width / 2;
    const cy = btnRect.top - cardRect.top;
    for (let i = 0; i < 6; i++) {
      setTimeout(() => {
        const el = document.createElement('div');
        el.className = 'cc-burst-emoji';
        el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
        el.style.left = (cx + (Math.random() - 0.5) * 40) + 'px';
        el.style.top = cy + 'px';
        layer.appendChild(el);
        setTimeout(() => el.remove(), 1400);
      }, i * 90);
    }
  }

  function markMine(type) {
    if (!window.S) return;
    S.lastInteraction = { type, from: S.role, ts: Date.now() };
  }
  function markIncoming(type) {
    if (!window.S) return;
    S.lastInteraction = { type, from: S.role === 'user1' ? 'user2' : 'user1', ts: Date.now() };
    S.lastReceivedInteraction = { type, ts: Date.now() };
  }

  function sendTouch() {
    if (typeof window.sendTouch === '_origMissing') return;
    _origSendTouch();
    markMine('touch');
    burst('ccTouchBtn', ['❤️', '💓', '💕']);
    document.getElementById('ccTouchBtn')?.classList.add('cc-sent');
    setTimeout(() => document.getElementById('ccTouchBtn')?.classList.remove('cc-sent'), 650);
    scheduleSave(); render();
  }
  function sendHug() {
    _origSendHug();
    markMine('hug');
    burst('ccHugBtn', ['🤗', '💗', '✨']);
    document.getElementById('ccHugBtn')?.classList.add('cc-sent');
    setTimeout(() => document.getElementById('ccHugBtn')?.classList.remove('cc-sent'), 650);
    scheduleSave(); render();
  }
  function sendMissYou() {
    _origSendMissYou();
    markMine('missyou');
    burst('ccMissBtn', ['🥺', '💔', '💌']);
    document.getElementById('ccMissBtn')?.classList.add('cc-sent');
    setTimeout(() => document.getElementById('ccMissBtn')?.classList.remove('cc-sent'), 650);
    scheduleSave(); render();
  }

  const TYPE_LABEL = { touch: '❤️ Touch', hug: '🤗 Hug', missyou: '🥺 Miss You' };

  function render() {
    if (!window.S) return;
    const li = S.lastInteraction;
    const el1 = document.getElementById('ccLastInteraction');
    if (el1) el1.textContent = li ? (TYPE_LABEL[li.type] || li.type) + ' · ' + fmtAgo(li.ts) : '—';

    const hugTotal = (S.hugStats || {}).total || 0;
    const el2 = document.getElementById('ccHugTotal'); if (el2) el2.textContent = hugTotal;

    const missMine = (S.missCounts || {})[S.role] || 0;
    const missTheirs = (S.missCounts || {})[S.role === 'user1' ? 'user2' : 'user1'] || 0;
    const el3 = document.getElementById('ccMissTotal'); if (el3) el3.textContent = missMine + missTheirs;

    const lr = S.lastReceivedInteraction;
    const el4 = document.getElementById('ccLastReceived'); if (el4) el4.textContent = lr ? fmtAgo(lr.ts) : '—';
  }

  /* Preserve originals, then wrap */
  let _origSendTouch, _origSendHug, _origSendMissYou;
  let _origCheckTouch, _origCheckMiss, _origCheckHug;

  function hook() {
    if (typeof window.sendTouch === 'function' && !window.sendTouch._ccWrapped) {
      _origSendTouch = window.sendTouch;
      window.sendTouch = function () { sendTouch(); };
      window.sendTouch._ccWrapped = true;
    }
    if (typeof window.sendHug === 'function' && !window.sendHug._ccWrapped) {
      _origSendHug = window.sendHug;
      window.sendHug = function () { sendHug(); };
      window.sendHug._ccWrapped = true;
    }
    if (typeof window.sendMissYou === 'function' && !window.sendMissYou._ccWrapped) {
      _origSendMissYou = window.sendMissYou;
      window.sendMissYou = function () { sendMissYou(); };
      window.sendMissYou._ccWrapped = true;
    }
    if (typeof window.checkIncomingTouch === 'function' && !window.checkIncomingTouch._ccWrapped) {
      _origCheckTouch = window.checkIncomingTouch;
      window.checkIncomingTouch = function () {
        const before = S.touch && S.touch.ts;
        _origCheckTouch();
        if (S.touch && S.touch.from !== S.role && S.touch.ts !== before) { markIncoming('touch'); burst('ccTouchBtn', ['💓', '❤️']); render(); }
      };
      window.checkIncomingTouch._ccWrapped = true;
    }
    if (typeof window.checkIncomingMissYou === 'function' && !window.checkIncomingMissYou._ccWrapped) {
      _origCheckMiss = window.checkIncomingMissYou;
      window.checkIncomingMissYou = function () {
        const before = S.missYou && S.missYou.ts;
        _origCheckMiss();
        if (S.missYou && S.missYou.from !== S.role && S.missYou.ts !== before) { markIncoming('missyou'); burst('ccMissBtn', ['🥺', '💔']); render(); }
      };
      window.checkIncomingMissYou._ccWrapped = true;
    }
    if (typeof window.checkIncomingHug === 'function' && !window.checkIncomingHug._ccWrapped) {
      _origCheckHug = window.checkIncomingHug;
      window.checkIncomingHug = function () {
        const beforeStatus = S.hug && S.hug.status, beforeAccTs = S.hug && S.hug.acceptedTs;
        _origCheckHug();
        if (S.hug && S.hug.from !== S.role && S.hug.status === 'pending') { /* request popup handled by original */ }
        if (S.hug && S.hug.status === 'accepted' && S.hug.acceptedTs !== beforeAccTs) { markIncoming('hug'); burst('ccHugBtn', ['🤗', '💗']); render(); }
      };
      window.checkIncomingHug._ccWrapped = true;
    }
    /* Re-render whenever the app re-renders / dashboard is shown */
    if (typeof window.renderDashboard === 'function' && !window.renderDashboard._ccWrapped) {
      const _origRD = window.renderDashboard;
      window.renderDashboard = function () { _origRD(); render(); };
      window.renderDashboard._ccWrapped = true;
    }
  }

  function init() {
    let tries = 0;
    const iv = setInterval(() => {
      hook();
      render();
      tries++;
      if ((_origSendTouch && _origSendHug && _origSendMissYou) || tries > 30) clearInterval(iv);
    }, 300);
  }

  return { sendTouch, sendHug, sendMissYou, render, init };
})();

/* ══════════════════════════════════════════════════════════════
   4. AUTO-INIT
   ══════════════════════════════════════════════════════════════ */
(function autoInit() {
  function tryInit() {
    if (typeof window.S !== 'undefined') {
      ConnCard.init();
    } else {
      setTimeout(tryInit, 400);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(tryInit, 600));
  else setTimeout(tryInit, 600);
})();
