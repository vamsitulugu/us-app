/* ═══════════════════════════════════════════════════════════
   LUCIDE ICON SYSTEM — replaces UI-chrome emoji with icons
   Does NOT touch: chat messages, mood picks, reactions, or any
   emoji embedded in user-entered content. Only static/interface
   chrome (sidebar nav, bottom nav, topbar, page/section titles,
   common action buttons) is affected.
   ═══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── 1. One-time icon size/alignment rules (structural only, no color/theme changes) ──
  const style = document.createElement('style');
  style.textContent = `
    .ui-ico {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      vertical-align: middle;
    }
    .ui-ico svg {
      width: 1em;
      height: 1em;
      stroke-width: 2px;
    }
    /* Match each context's original emoji font-size so icons align identically */
    .ni .ui-ico, .bot-ni .ui-ico { font-size: 16px; }
    .bot-ni .ui-ico { font-size: 20px; }
    .card-title .ui-ico, .settings-group-header .ui-ico { font-size: 15px; margin-right: 2px; }
    .btn .ui-ico, .ic-btn .ui-ico { font-size: 15px; }
    .settings-row-ico .ui-ico { font-size: 17px; }
    .empty-ico.ui-ico { font-size: 40px; }
  `;
  document.head.appendChild(style);

  // ── 2. Lucide names for every nav / chrome slot (per the requested mapping) ──
  const NAV_ICON = {
    dashboard: 'layout-dashboard',
    chat: 'message-circle',
    camera: 'images',
    profile: 'user-round',
    bucket: 'list-todo',
    calendar: 'calendar-days',
    map: 'map-pinned',
    globe: 'globe',
    places: 'map',
    meetplanner: 'calendar-heart',
    lovecounter: 'heart',
    collection: 'archive',
    music: 'music',
    games: 'gamepad-2',
    dreamgoals: 'target',
    money: 'wallet',
    fights: 'shield-alert',
    capsule: 'package-open',
    surprise: 'gift',
    level: 'trophy',
    dreamhome: 'home',
    virtualhome: 'home',
    myspace: 'flower-2',
    period: 'droplet',
    study: 'book-open',
    vault: 'lock',
    ai: 'bot',
    settings: 'settings'
  };

  // Common action-button glyphs → lucide name (matched by leading emoji character)
  const ACTION_ICON = {
    '🔍': 'search', '🔔': 'bell', '☁️': 'refresh-cw', '➕': 'plus', '+': null, // '+' handled separately
    '✏️': 'pencil', '🗑️': 'trash-2', '🔗': 'share-2', '📥': 'download', '📤': 'upload',
    '⭐': 'star', '←': 'arrow-left', '→': 'arrow-right', '✕': 'x', '☰': 'menu',
    '⚙️': 'settings', '📋': 'clipboard', '🔒': 'lock', '🔓': 'lock-open', '🔕': 'bell-off',
    '📌': 'pin', '📸': 'camera', '🎥': 'video', '⏹': 'square', '🔄': 'refresh-cw',
    '👤': 'user', '🎨': 'palette', '💾': 'save', '🚪': 'log-out', '📦': 'package',
    '🧹': 'brush'
  };

  function iconHTML(name, extraClass) {
    return `<i class="ui-ico ${extraClass || ''}" data-lucide="${name}"></i>`;
  }

  // ── 3. Replace sidebar + bottom-nav icons (span.ico inside elements with data-page) ──
  function replaceNavIcons() {
    document.querySelectorAll('[data-page] > .ico').forEach(span => {
      const page = span.closest('[data-page]').dataset.page;
      const name = NAV_ICON[page];
      if (name) span.outerHTML = iconHTML(name);
    });
  }

  // ── 4. Replace known static header/button emoji by exact text match ──
  // Each entry: [selector, emoji-to-strip, lucide-name]
  const STATIC_REPLACEMENTS = [
    ['#hamburger', '☰', 'menu'],
    ['[onclick="openSearch()"]', '🔍', 'search'],
    ['#syncBtn', '☁️', 'refresh-cw'],
    ['.img-viewer-close', '✕', 'x'],
    ['.modal-close', '✕', 'x'],
    ['[onclick="dismissAlarm()"]', '🔕', 'bell-off']
  ];

  function replaceStatic() {
    STATIC_REPLACEMENTS.forEach(([sel, emoji, name]) => {
      document.querySelectorAll(sel).forEach(el => {
        if (el.textContent.includes(emoji)) {
          el.innerHTML = el.innerHTML.replace(emoji, iconHTML(name));
        }
      });
    });

    // Settings-row icons (📤 📥 ☁️ 🚪 💕 🔒 ℹ️ etc.) — swap the leading emoji only
    document.querySelectorAll('.settings-row-ico').forEach(el => {
      const txt = el.textContent.trim();
      const map = { '📤': 'upload', '📥': 'download', '☁️': 'cloud', '🚪': 'log-out',
                    '🔒': 'lock', '📸': 'camera', '🔊': 'volume-2', '✨': 'sparkles',
                    '🗃️': 'database', '💫': 'sparkle', '🎭': 'drama', '🔔': 'bell', '⏰': 'clock' };
      if (map[txt]) el.innerHTML = iconHTML(map[txt]);
    });

    // Settings group headers (🎨 🔔 🔐 🔗 📸 🤖 ✨ 📦 💾 ℹ️)
    document.querySelectorAll('.settings-group-header').forEach(el => {
      const first = el.textContent.trim().slice(0, 2).trim();
      const map = { '👤': 'user', '🎨': 'palette', '🔔': 'bell', '🔐': 'shield',
                    '🔗': 'link', '📸': 'image', '🤖': 'bot', '✨': 'sparkles',
                    '📦': 'package', '💾': 'save', 'ℹ️': 'info' };
      if (map[first]) {
        el.innerHTML = el.innerHTML.replace(first, iconHTML(map[first]));
      }
    });
  }

  // ── 5. Helper for YOUR OWN template strings (use going forward in JS renders) ──
  // Usage inside any render function: `${uiIcon('trash-2')} Delete`
  window.uiIcon = function (name, sizeClass) {
    return iconHTML(name, sizeClass || '');
  };

  // ── 6. Run once DOM is ready, then ask Lucide to draw all <i data-lucide> tags ──
  function run() {
    replaceNavIcons();
    replaceStatic();
    if (window.lucide) window.lucide.createIcons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }

  // Re-run after major re-renders (settings page, sidebar rebuild) so new icons
  // get drawn too — safe to call repeatedly, it's idempotent.
  window.refreshUIIcons = run;
})();