/* ═══════════════════════════════════════════════════════════
   LUCIDE ICON SYSTEM v5 — APPLICATION-WIDE, LIVE CONVERTER
   ───────────────────────────────────────────────────────────
   What changed from v4 → v5:
   - Rolled out to every page: music.html, games.html, globe.html,
     collection.html, lovecounter.html, meetplanner.html,
     places.html and dreamgoals.html now all include this file
     (previously only index.html did — this is why those pages
     were still showing raw emoji everywhere).
   - Added ~110 new emoji → icon mappings covering everything
     those pages use (stars, party/celebration, currency, home
     decor items, weather, media/instrument icons, etc).
   - Fixed a matching bug: emoji written with vs. without a
     variation selector (e.g. "🗑️" vs "🗑") used to be treated
     as different characters and only one form converted. Now
     both forms always match the same map entry.
   - SAFE_SELECTORS is now also substring-based (e.g. any class
     ending in "-btn", or containing "-tab"/"-chip"/"-title"/
     "-emoji"/etc), so page-specific prefixed classnames like
     pm-modal-close, dg-save-btn, mp-tab, lc-bday-emoji are all
     picked up automatically instead of needing to be hardcoded
     one by one per page.
   - EXCLUDE_SELECTORS extended with the free-typed content
     areas on these pages (journal entries, memory/notes fields)
     so user-typed text is never touched, same as chat/journal/
     notes already were on the home page.

   Every page below now needs (and has) these two lines near the
   end of <body>, after any other scripts:
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
  const RAW_MAP = {
    // Navigation
    '🏠': 'layout-dashboard', '💬': 'message-circle', '📷': 'images', '🖼️': 'image',
    '💑': 'user-round', '👤': 'user', '🌟': 'list-todo', '📅': 'calendar-days',
    '📍': 'map-pinned', '🌍': 'globe', '🗺️': 'map', '🗓️': 'calendar-days',
    '⏱️': 'heart', '🎙️': 'mic', '🎵': 'music', '🎮': 'gamepad-2',
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
    '✌️': 'smile',                // Fight Log empty state ('peace' is not a valid Lucide icon name)
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

    // ── NEW in v4 — reported as still unconverted ──
    '❤️': 'heart',
    '📸': 'camera',
    '💝': 'gift',
    '🌹': 'flower',
    '💞': 'heart-handshake',
    '💕': 'heart',
    '💜': 'heart',
    '🛋️': 'sofa',
    '🎤': 'mic',
    '🏝️': 'palmtree',
    '📺': 'tv',

    // ── NEW in v5 — rollout to music/games/globe/collection/lovecounter/meetplanner/places/dreamgoals ──
    '☆': 'star', '★': 'star', '🎉': 'party-popper', '🎊': 'party-popper',
    '🪙': 'coins', '💱': 'arrow-left-right', '📜': 'scroll-text',
    '🏅': 'medal', '🥇': 'medal', '🐚': 'shell', '🥰': 'heart',
    '😊': 'smile', '🤩': 'sparkles', '😂': 'laugh', '😅': 'smile',
    '😍': 'heart', '😳': 'meh',
    '🎛️': 'sliders-horizontal', '🎛': 'sliders-horizontal',
    '🎸': 'music', '🎹': 'music', '🎺': 'music', '🎻': 'music',
    '🥁': 'music', '🎼': 'music', '🎧': 'headphones', '🎷': 'music',
    '🪗': 'music', '♪': 'music', '⚠️': 'alert-triangle', '⚠': 'alert-triangle',
    '🏖️': 'umbrella', '🏖': 'umbrella', '⛱️': 'umbrella', '⛱': 'umbrella',
    '🪑': 'armchair', '💺': 'armchair', '🛏️': 'bed', '🛏': 'bed',
    '🏔️': 'mountain', '🏔': 'mountain', '🌱': 'sprout', '🌳': 'trees',
    '🪴': 'flower-2', '🌷': 'flower-2', '🌈': 'rainbow',
    '↩️': 'corner-up-left', '↩': 'corner-up-left', '🚀': 'rocket',
    '🍿': 'sparkles', '🍹': 'sparkles', '🥂': 'sparkles',
    '🎶': 'music', '👑': 'crown', '🧩': 'puzzle', '🏊': 'waves',
    '🌊': 'waves', '🦋': 'sparkles', '🎈': 'party-popper',
    '💼': 'briefcase', '🔴': 'circle', '🟢': 'circle', '🟡': 'circle',
    '🔵': 'circle', '🟫': 'square', '⬜': 'square', '⬛': 'square',
    '💥': 'zap', '😰': 'frown', '😔': 'frown', '😤': 'angry',
    '😌': 'smile', '🥹': 'smile', '👻': 'ghost', '🧙': 'wand-2',
    '📽️': 'video', '📽': 'video', '📼': 'video', '🎪': 'tent',
    '🏗️': 'construction', '🏗': 'construction', '🎡': 'circle-dot',
    '🤍': 'heart', '🕸️': 'network', '🕸': 'network',
    '🔎': 'search', '🌙': 'moon', '🌅': 'sunrise', '🌇': 'sunset',
    '🌃': 'moon', '🌧️': 'cloud-rain', '🌧': 'cloud-rain', '🌡️': 'thermometer',
    '🌡': 'thermometer', '🔮': 'sparkles', '♾️': 'infinity', '♾': 'infinity',
    '⛵': 'sailboat', '🏰': 'landmark', '🪔': 'flame', '🧊': 'square',
    '🪞': 'square', '🗄️': 'archive', '🗄': 'archive', '🍎': 'apple',
    '🕰️': 'clock', '🕰': 'clock', '⛲': 'droplet', '🎠': 'circle-dot',
    '🔭': 'telescope', '🛌': 'bed', '🕹️': 'gamepad-2', '🕹': 'gamepad-2',
    '🤿': 'waves', '🦩': 'sparkles', '🏍️': 'bike', '🏍': 'bike',
    '🧰': 'wrench', '🚲': 'bike', '🛁': 'bath',
    '🧽': 'sparkles', '🤔': 'help-circle', '🏚️': 'home', '🏚': 'home',
    '🧸': 'gift', '📗': 'book-open', '📕': 'book-open', '📘': 'book-open',
    '📙': 'book-open', '📓': 'book-open', '🕯️': 'flame', '🕯': 'flame',
    '🖋️': 'pen-line', '🖋': 'pen-line', '🖌️': 'paintbrush', '🖌': 'paintbrush',
    '🦀': 'shell', '🌴': 'palmtree', '👏': 'sparkles', '♥': 'heart',
    '♥️': 'heart', '💗': 'heart', '💖': 'heart', '🗿': 'landmark',
    '🛍️': 'shopping-bag', '🛍': 'shopping-bag', '🏛️': 'landmark',
    '🏛': 'landmark', '🛕': 'landmark', '🏋️': 'dumbbell', '🏋': 'dumbbell',
    '🚿': 'droplet', '🏟️': 'landmark', '🏟': 'landmark', '🔁': 'repeat',
    '🔉': 'volume-1', '👫': 'users', '👨': 'user', '👩': 'user', '👧': 'user',
    '🗝️': 'key', '🥹': 'smile',
  };

  function iconHTML(name) {
    return `<i class="ui-ico" data-lucide="${name}"></i>`;
  }

  // Normalize away variation selectors (U+FE0E/FE0F) so keys written with or
  // without them (and text using either form) always match the same entry.
  const MAP = {};
  Object.keys(RAW_MAP).forEach(k => {
    MAP[k.replace(/[\uFE0E\uFE0F]/g, '')] = RAW_MAP[k];
  });

  // Build one regex matching any mapped emoji (longest-first to avoid partial
  // overlaps), each optionally followed by a variation selector in the source text.
  const EMOJI_KEYS = Object.keys(MAP).sort((a, b) => b.length - a.length);
  const EMOJI_RE = new RegExp(EMOJI_KEYS.map(e =>
    e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\uFE0E\\uFE0F]?'
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
    '.love-card-ico', '.love-card-meta',

    // ── NEW in v4 — dream board tabs, type selects, misc inline icon buttons ──
    '#dreamTabs .stab', 'select#msType option', 'select#surType option',
    '.touch-heart-btn', '.sh-heart', '.logo-heart', '.hug-btn .connect-btn-ico',
    '.missyou-btn .connect-btn-ico', '.cb-snap', '.pt-btn',
    '.storage-cat-ico', '.storage-ring-label',

    // ── NEW in v5 — page-agnostic chrome catch-alls (music/games/globe/
    // collection/lovecounter/meetplanner/places/dreamgoals all use their own
    // prefixed class names — e.g. pm-modal-close, dg-save-btn, mp-tab,
    // lc-bday-emoji — so match by suffix/substring instead of hardcoding
    // every page's classes one by one) ──
    '.filter-chip', '.vt-btn', '.view-toggle', '.top-title', '.top-actions',
    '[class*="-btn"]', '[class$="btn"]', '[class*="-tab"]', '[class*="-chip"]',
    '[class*="-badge"]', '[class*="-ico"]', '[class*="-close"]',
    '[class*="-title"]', '[class*="-emoji"]', '[class*="-label"]',
    '[class*="-tag"]', '[class*="-banner"]', '[class*="stat"]',
    '[class*="-sub"]', '[class*="section-title"]'
  ];

  // Explicit EXCLUDE list — never process these even if nested inside a safe zone
  const EXCLUDE_SELECTORS = [
    '.mood', '.mood-row', '#dashMoodRow', '.mood-hist-emoji',
    '.ai-msgs', '.ai-bubble', '.chat-msgs', '.note-card', '#myJournalEntries',
    '#notesGrid', '#partnerJournalEntries', '#milestonesEl', '.ts-label',
    '.love-card-title', '.love-card-sub', '#missYouSub', '#missYouTitle',
    '#hugReqTitle', '#hugReqSub', '.symptom-tag.sel',

    // ── NEW in v5 — free-typed user content on the other pages, never convert ──
    '.journal-entry', '#formNotes', '#formJournal', '.pm-empty-text',
    '#pmMemText', 'textarea', 'input'
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
        const iconName = matches[i] && MAP[matches[i].replace(/[\uFE0E\uFE0F]/g, '')];
        if (iconName) {
          const span = document.createElement('span');
          span.innerHTML = iconHTML(iconName);
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