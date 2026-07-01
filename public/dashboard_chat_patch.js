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

/* ── CHAT WALLPAPER ── */
.chat-wallpaper-layer{
  position:absolute; inset:0; z-index:0; pointer-events:none;
  background-color:#0a0a14;
  background-image: radial-gradient(circle at 20% 15%, hsla(var(--h),100%,55%,0.10), transparent 55%),
                     radial-gradient(circle at 85% 85%, hsla(300,85%,60%,0.10), transparent 55%);
  transition:opacity 0.25s ease;
}
.chat-wallpaper-layer .wp-img-layer{
  position:absolute; inset:0;
  background-size:cover; background-position:center; background-repeat:no-repeat;
  will-change:filter, opacity;
}
.chat-wallpaper-layer .wp-overlay-layer{
  position:absolute; inset:0; background:#000;
}
.wp-fab{
  position:absolute; top:10px; right:12px; z-index:5;
  width:38px; height:38px; border-radius:50%;
  background:rgba(10,10,20,0.55); backdrop-filter:blur(12px);
  border:1px solid var(--border2); color:#fff; font-size:16px;
  cursor:pointer; display:flex; align-items:center; justify-content:center;
  transition:var(--t);
}
.wp-fab:hover{ background:rgba(10,10,20,0.8); transform:scale(1.06); }

.wp-preview-wrap{ position:relative; border-radius:16px; overflow:hidden; height:160px; border:1px solid var(--border); background:var(--g1); }
.wp-preview{ position:absolute; inset:0; background-size:cover; background-position:center; }
.wp-preview-hint{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:11px; color:var(--text3); pointer-events:none; }
.wp-preview-hint.hidden{ display:none; }

.wp-crop-box{
  position:relative; width:100%; aspect-ratio:9/14; max-height:280px;
  overflow:hidden; border-radius:14px; border:2px dashed var(--border2);
  margin:10px 0; background:#050508; touch-action:none; cursor:grab;
}
.wp-crop-box:active{ cursor:grabbing; }
.wp-crop-box img{
  position:absolute; top:50%; left:50%;
  transform-origin:center center;
  max-width:none; user-select:none; -webkit-user-drag:none;
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
   3. CHAT WALLPAPER MANAGER (Feature 2)
   ══════════════════════════════════════════════════════════════ */
const ChatWallpaper = (() => {

  const MAX_OUT_W = 720, MAX_OUT_H = 1280; // output raster size cap
  let rawImage = null;      // Image object of the freshly uploaded photo
  let pan = { x: 0, y: 0 }; // px offset applied to crop preview
  let zoom = 100;           // percent
  let dragging = false, dragStart = null;

  function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function open() {
    const m = document.getElementById('wpModal');
    if (!m) return;
    // Preload sliders from current saved wallpaper settings (if any)
    const w = (window.S && S.chatWallpaper) || {};
    document.getElementById('wpBlur').value = w.blur ?? 0;
    document.getElementById('wpBrightness').value = w.brightness ?? 100;
    document.getElementById('wpOverlay').value = w.overlay ?? 35;
    document.getElementById('wpOpacity').value = w.opacity ?? 100;
    document.getElementById('wpCropWrap').style.display = 'none';
    document.getElementById('wpPreviewHint').classList.remove('hidden');
    const prev = document.getElementById('wpPreview');
    if (w.dataUrl) { prev.style.backgroundImage = `url("${w.dataUrl}")`; document.getElementById('wpPreviewHint').classList.add('hidden'); }
    else prev.style.backgroundImage = '';
    updateFilters();
    m.classList.add('open');
  }
  function close() { document.getElementById('wpModal')?.classList.remove('open'); }

  function onFile(input) {
    const file = input.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      rawImage = new Image();
      rawImage.onload = () => {
        pan = { x: 0, y: 0 }; zoom = 100;
        document.getElementById('wpZoom').value = 100;
        const cropImg = document.getElementById('wpCropImg');
        cropImg.src = e.target.result;
        document.getElementById('wpCropWrap').style.display = 'block';
        _applyCropTransform();
        _bindDrag();
      };
      rawImage.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function onZoom(v) { zoom = parseFloat(v); _applyCropTransform(); }

  function _applyCropTransform() {
    const img = document.getElementById('wpCropImg');
    if (!img) return;
    img.style.transform = `translate(-50%,-50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom / 100})`;
  }

  function _bindDrag() {
    const box = document.getElementById('wpCropBox');
    if (!box || box._wpBound) return;
    box._wpBound = true;
    const start = (x, y) => { dragging = true; dragStart = { x: x - pan.x, y: y - pan.y }; };
    const move = (x, y) => { if (!dragging) return; pan = { x: x - dragStart.x, y: y - dragStart.y }; _applyCropTransform(); };
    const end = () => { dragging = false; };
    box.addEventListener('mousedown', e => start(e.clientX, e.clientY));
    window.addEventListener('mousemove', e => move(e.clientX, e.clientY));
    window.addEventListener('mouseup', end);
    box.addEventListener('touchstart', e => { const t = e.touches[0]; start(t.clientX, t.clientY); }, { passive: true });
    box.addEventListener('touchmove', e => { const t = e.touches[0]; move(t.clientX, t.clientY); }, { passive: true });
    box.addEventListener('touchend', end);
  }

  function updateFilters() {
    const blur = document.getElementById('wpBlur').value;
    const brightness = document.getElementById('wpBrightness').value;
    const overlay = document.getElementById('wpOverlay').value;
    const opacity = document.getElementById('wpOpacity').value;
    const prev = document.getElementById('wpPreview');
    if (prev) {
      prev.style.filter = `blur(${blur}px) brightness(${brightness}%)`;
      prev.style.opacity = (opacity / 100);
    }
    _liveApplyToLayer({ blur, brightness, overlay, opacity }, true);
  }

  /* Renders the crop box's current pan/zoom into a final compressed dataURL */
  function _renderCroppedDataUrl() {
    if (!rawImage) return (window.S && S.chatWallpaper && S.chatWallpaper.dataUrl) || null;
    const box = document.getElementById('wpCropBox');
    const boxRect = box.getBoundingClientRect();
    const outW = MAX_OUT_W, outH = Math.round(outW * (boxRect.height / boxRect.width));
    const canvas = document.createElement('canvas');
    canvas.width = outW; canvas.height = Math.min(outH, MAX_OUT_H);
    const ctx = canvas.getContext('2d');

    // Natural image size vs box: image is centered at box center, scaled by zoom,
    // offset by pan (in box-pixel units). Map box-pixel space -> output-pixel space.
    const scaleBoxToOut = outW / boxRect.width;
    const s = (zoom / 100) * scaleBoxToOut;
    const imgW = rawImage.naturalWidth * s;
    const imgH = rawImage.naturalHeight * s;
    const cx = canvas.width / 2 + pan.x * scaleBoxToOut;
    const cy = canvas.height / 2 + pan.y * scaleBoxToOut;

    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(rawImage, cx - imgW / 2, cy - imgH / 2, imgW, imgH);
    return canvas.toDataURL('image/jpeg', 0.72);
  }

  function apply() {
    const dataUrl = _renderCroppedDataUrl();
    if (!window.S) return;
    S.chatWallpaper = {
      dataUrl: dataUrl || null,
      blur: parseFloat(document.getElementById('wpBlur').value),
      brightness: parseFloat(document.getElementById('wpBrightness').value),
      overlay: parseFloat(document.getElementById('wpOverlay').value),
      opacity: parseFloat(document.getElementById('wpOpacity').value),
      updatedAt: Date.now()
    };
    scheduleSave();
    _applySavedToLayer();
    close();
    toast('Wallpaper applied 🖼️');
  }

  function reset() {
    if (!window.S) return;
    S.chatWallpaper = null;
    rawImage = null;
    scheduleSave();
    _applySavedToLayer();
    close();
    toast('Reset to default wallpaper');
  }

  /* ── Persistent layer rendering (never removed, never flickers) ── */
  function _ensureLayerDom() {
    let layer = document.getElementById('chatWallpaperLayer');
    if (!layer) return null;
    if (!layer.querySelector('.wp-img-layer')) {
      const img = document.createElement('div'); img.className = 'wp-img-layer';
      const ov = document.createElement('div'); ov.className = 'wp-overlay-layer';
      layer.appendChild(img); layer.appendChild(ov);
    }
    return layer;
  }

  function _liveApplyToLayer(vals, previewOnly) {
    const layer = _ensureLayerDom(); if (!layer) return;
    const img = layer.querySelector('.wp-img-layer');
    const ov = layer.querySelector('.wp-overlay-layer');
    const src = previewOnly && rawImage ? document.getElementById('wpCropImg')?.src : ((window.S && S.chatWallpaper && S.chatWallpaper.dataUrl) || null);
    // Only touch background-image if it actually changed — avoids repaint/flicker.
    if (src) {
      const cur = img.dataset.src;
      if (cur !== src) { img.style.backgroundImage = `url("${src}")`; img.dataset.src = src; }
      img.style.display = 'block';
    } else if (!previewOnly) {
      img.style.display = 'none'; img.dataset.src = '';
    }
    img.style.filter = `blur(${vals.blur}px) brightness(${vals.brightness}%)`;
    img.style.opacity = String((vals.opacity ?? 100) / 100);
    ov.style.opacity = String((vals.overlay ?? 0) / 100);
  }

  function _applySavedToLayer() {
    const w = (window.S && S.chatWallpaper) || null;
    if (!w || !w.dataUrl) {
      const layer = _ensureLayerDom(); if (!layer) return;
      const img = layer.querySelector('.wp-img-layer');
      img.style.display = 'none'; img.dataset.src = '';
      layer.querySelector('.wp-overlay-layer').style.opacity = '0';
      return;
    }
    _liveApplyToLayer(w, false);
  }

  function init() {
    // Apply once on load (from cloud-synced state) and again shortly after,
    // in case S.chatWallpaper loads asynchronously.
    _applySavedToLayer();
    setTimeout(_applySavedToLayer, 1500);
    setTimeout(_applySavedToLayer, 4000);

    // Re-apply after any cloud sync merges new state, but ONLY if the
    // wallpaper dataURL actually changed — never on every render tick.
    let lastSeenTs = 0;
    const check = () => {
      const w = (window.S && S.chatWallpaper) || null;
      const ts = w ? w.updatedAt : 0;
      if (ts !== lastSeenTs) { lastSeenTs = ts; _applySavedToLayer(); }
    };
    setInterval(check, 4000);
  }

  return { open, close, onFile, onZoom, updateFilters, apply, reset, init };
})();

/* ══════════════════════════════════════════════════════════════
   4. AUTO-INIT
   ══════════════════════════════════════════════════════════════ */
(function autoInit() {
  function tryInit() {
    if (typeof window.S !== 'undefined') {
      ConnCard.init();
      ChatWallpaper.init();
    } else {
      setTimeout(tryInit, 400);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(tryInit, 600));
  else setTimeout(tryInit, 600);
})();
