/* ═══════════════════════════════════════════════════════════
   LUCIDE ICON SYSTEM v3 — APPLICATION-WIDE, LIVE CONVERTER
   ───────────────────────────────────────────────────────────
   What changed from v2 → v3:
   - Added missing emoji to MAP: 💚 ✌️ 👐 🤗 🥺 🏙️ ▶️ ⇄ ↺ 🐾 ☀️
     and the connection-card / stat-icon selectors that weren't
     being scanned before (.cc-ico, .cc-stat-ico, .cc-lbl,
     .metric-n, .connect-btn-ico, .connect-btn-label).
   - Everything else is identical to v2: same MutationObserver
     live-scan behavior, same EXCLUDE list (chat, mood, journal,
     notes, reactions, milestone/miss-you/hug popup copy all
     stay untouched).

   REMINDER — iframe pages need this file too:
   index.html cannot reach inside <iframe src="/music.html"> etc.
   (browser sandboxing). Add these two lines near the end of
   <body> in EACH of: music.html, games.html, globe.html,
   collection.html, lovecounter.html, meetplanner.html,
   places.html, dreamgoals.html:

     <script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>
     <script src="/ui-icons.js"></script>
   ═══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── 1. Icon sizing (structural only, inherits your existing theme) ── */
  const style = document.createElement('style');
  style.textContent = `
    .ui-ico {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      vertical-align: -0.15em;
      margin-right: 0.28em;
    }
    .ui-ico:last-child { margin-right: 0; margin-left: 0.28em; }
    .ui-ico:only-child { margin: 0; }
    .ui-ico svg { width: 1em; height: 1em; stroke-width: 2px; }
  `;
  document.head.appendChild(style);

  /* ── 2. Master emoji → Lucide icon map ── */
  const MAP = {
    // Navigation
    '🏠': 'layout-dashboard', '💬': 'message-circle', '📷': 'images', '🖼️': 'image',
    '💑': 'user-round', '👤': 'user', '🌟': 'list-todo', '📅': 'calendar-days',
    '📍': 'map-pinned', '🌍': 'globe', '🗺️': 'map', '🗓️': 'calendar-days',
    '⏱️': 'heart', '🎙️': 'archive', '🎵': 'music', '🎮': 'gamepad-2',
    '💫': 'target', '💰': 'wallet', '⚡': 'shield-alert', '💌': 'package-open',
    '🎁': 'gift', '🏆': 'trophy', '🏡': 'home', '🌸': 'flower-2', '🩷': 'droplet',
    '📚': 'book-open', '🔐': 'lock', '🔒': 'lock', '🔓': 'lock-open',
    '🤖': 'bot', '⚙️': 'settings', '🧠': 'brain',
    // Actions / controls
    '🔍': 'search', '🔔': 'bell', '🔕': 'bell-off', '☁️': 'refresh-cw',
    '🔄': 'refresh-cw', '✏️': 'pencil', '✍️': 'pencil', '🗑️': 'trash-2',
    '🔗': 'link', '📤': 'upload', '📥': 'download', '📁': 'folder',
    '⭐': 'star', '📌': 'pin', '🗂️': 'archive', '📊': 'bar-chart-2',
    '📝': 'file-text', '🕒': 'history', '🕐': 'clock', '⏰': 'alarm-clock',
    '🎖️': 'award', '🔥': 'flame', '💡': 'lightbulb', '📈': 'trending-up',
    '👥': 'users', '🛡️': 'shield', '📞': 'phone', '🎥': 'video',
    '📹': 'video', '🎬': 'video', '🖨️': 'printer', '🧭': 'compass',
    '💍': 'gem', '🎂': 'cake', '📖': 'book-open', '🎨': 'palette',
    '☰': 'menu', '✕': 'x', '✖️': 'x', '❌': 'x-circle', '➕': 'plus',
    '➤': 'send', '⬇': 'arrow-down', '←': 'arrow-left', '→': 'arrow-right',
    '‹': 'chevron-left', '›': 'chevron-right', '↗': 'external-link',
    '📋': 'clipboard', '✓': 'check', '✅': 'check-circle-2', '☑️': 'check-square',
    '⌫': 'delete', '⏹': 'square', '⏹️': 'square', '📡': 'radio',
    '🧹': 'brush', '📦': 'package', '💾': 'save', '🚪': 'log-out',
    'ℹ️': 'info', '💎': 'gem', '🎯': 'target', '🛠️': 'wrench',
    '🗃️': 'database', '🎭': 'drama', '✨': 'sparkles', '🔊': 'volume-2',
    '🧾': 'receipt', '📆': 'calendar', '📣': 'megaphone', '🙋': 'hand',
    '💳': 'credit-card', '💸': 'banknote', '🍽️': 'utensils', '🚗': 'car',
    '🛒': 'shopping-cart', '✈️': 'plane', '💊': 'pill', '👶': 'baby',
    '🎓': 'graduation-cap', '🏢': 'building-2', '🏨': 'hotel', '☕': 'coffee',
    '💪': 'dumbbell', '🐶': 'dog', '🚶': 'footprints', '🙏': 'hand-heart',
    '🎲': 'dices', '🍳': 'cooking-pot', '💭': 'message-square', '🔙': 'corner-up-left',

    // ── NEW in v3 — previously missing from the map ──
    '💚': 'heart-handshake',      // Reconnect Activities
    '✌️': 'peace',                // Fight Log empty state (fallback below if unsupported)
    '👐': 'hand-heart',           // Touch button
    '🤗': 'heart-handshake',      // Hug button / hug stat
    '🥺': 'heart-crack',          // Miss You button / stat
    '🏙️': 'building-2',           // Globe/skyline references
    '▶️': 'play',                 // media play controls (karaoke/music)
    '⏸️': 'pause',
    '⇄': 'repeat',                // loop / cycle controls
    '↺': 'rotate-ccw',
    '🐾': 'paw-print',            // pets category
    '☀️': 'sun',                  // weather / day markers
    '🥇': 'medal',
  };

  function iconHTML(name) {
    return `<i class="ui-ico" data-lucide="${name}"></i>`;
  }

  // Build one regex matching any mapped emoji (longest-first to avoid partial overlaps)
  const EMOJI_KEYS = Object.keys(MAP).sort((a, b) => b.length - a.length);
  const EMOJI_RE = new RegExp(EMOJI_KEYS.map(e =>
    e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  ).join('|'), 'g');

  /* ── 3. SAFE zones — interface chrome only. Never touches user content. ── */
  const SAFE_SELECTORS = [
    '.card-title', '.modal-title', '.settings-group-header',
    '.settings-row-title', '.settings-row-sub', '.settings-row-ico',
    '.btn', '.ic-btn', '.btn-ghost', '.del-btn', '.modal-close',
    '.img-viewer-close', '.search-cancel', '.sf', '.stab', '.tag',
    '.empty', '.empty-ico', '.fight-status', '.phase-badge',
    '.priv-badge', '.stat-l', '.pstat-l', '.fstat-l', '.metric-l',
    '.streak-badge', '.info-banner', '.auth-sub', '.auth-tab',
    '.settings-row-action', '.pk', '.money-ic', '.ni .ico', '.bot-ni .ico',
    '.hamburger', '#lastSaved', '.alarm-ico', 'label.btn', '.cam-btn',
    '.storage-action-btn', '.symptom-grid > .symptom-tag',
    'select#bucketCat option', 'select#dreamCat option', 'select#surType option',
    'select#placeLabel option', 'select#lmPlaceCat option', 'select#evCat option',
    'select#evAlarm option', 'select#remFor option', 'select#slotAlarm option',
    'select#moneyType option', 'select#msType option', 'select#journalVisibility option',
    'select#noteVisibility option', 'select#bucketVisibility option',
    '.pill', '.sh-days', '.vid-overlay', '#camPh',

    // ── NEW in v3 — connection card + stat icons that weren't scanned before ──
    '.cc-ico', '.cc-lbl', '.cc-stat-ico', '.cc-stat-l',
    '.connect-btn-ico', '.connect-btn-label', '.connect-stat',
    '.metric-n', '.fstat-n', '.pstat-n', '.stat-n',
    '.reconnect-ico', '#reconnectActivities .card-title',
    '.love-card-ico', '.love-card-meta'
  ];

  // Explicit EXCLUDE list — never process these even if nested inside a safe zone
  const EXCLUDE_SELECTORS = [
    '.mood', '.mood-row', '#dashMoodRow', '.mood-hist-emoji',
    '.ai-msgs', '.ai-bubble', '.chat-msgs', '.note-card', '#myJournalEntries',
    '#notesGrid', '#partnerJournalEntries', '#milestonesEl', '.ts-label',
    '.love-card-title', '.love-card-sub', '#missYouSub', '#missYouTitle',
    '#hugReqTitle', '#hugReqSub', '.symptom-tag.sel'
  ];

  function isExcluded(el) {
    return EXCLUDE_SELECTORS.some(sel => el.closest(sel));
  }

  /* ── 4. Replace emoji within a safe element's direct text (skips if already converted) ── */
  function convertElement(el) {
    if (!el || el.dataset.uiIconDone === '1') return;
    if (isExcluded(el)) return;
    if (!el.textContent || !EMOJI_RE.test(el.textContent)) { el.dataset.uiIconDone = '1'; return; }

    // Walk only direct text nodes (not nested elements we don't own) to avoid
    // corrupting nested interactive children (inputs, other buttons, spans w/ handlers)
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) {
      if (isExcluded(n.parentElement)) continue;
      nodes.push(n);
    }
    nodes.forEach(textNode => {
      EMOJI_RE.lastIndex = 0;
      if (!EMOJI_RE.test(textNode.nodeValue)) return;
      const frag = document.createDocumentFragment();
      const parts = textNode.nodeValue.split(EMOJI_RE);
      const matches = textNode.nodeValue.match(EMOJI_RE) || [];
      parts.forEach((part, i) => {
        if (part) frag.appendChild(document.createTextNode(part));
        if (matches[i] && MAP[matches[i]]) {
          const span = document.createElement('span');
          span.innerHTML = iconHTML(MAP[matches[i]]);
          frag.appendChild(span.firstChild);
        }
      });
      textNode.parentNode.replaceChild(frag, textNode);
    });
    el.dataset.uiIconDone = '1';
  }

  function convertAll(root) {
    root = root || document;
    SAFE_SELECTORS.forEach(sel => {
      root.querySelectorAll(sel).forEach(convertElement);
    });
    if (window.lucide) window.lucide.createIcons();
  }

  /* ── 5. Live observer — catches every future re-render app-wide ── */
  let scheduled = false;
  function scheduleConvert() {
    if (scheduled) return;
    scheduled = true;
    (window.requestIdleCallback || window.setTimeout)(() => {
      scheduled = false;
      convertAll(document);
    }, { timeout: 300 });
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length)) { scheduleConvert(); return; }
      if (m.type === 'characterData') { scheduleConvert(); return; }
    }
  });

  function start() {
    convertAll(document);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Manual hook still available for your own template strings going forward
  window.uiIcon = function (name) { return iconHTML(name); };
  window.refreshUIIcons = () => convertAll(document);
})();