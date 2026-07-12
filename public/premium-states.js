/* ============================================================
   premium-states.js — JS trigger library for premium-states.css
   Mirrors the existing window.PM convention (premium-motion.js)
   so pages that already call PM.* for micro-interactions get a
   consistent second API, window.PS.*, for state rendering.
   Include AFTER premium-states.css.
   ============================================================ */
(function () {
  'use strict';
  const PS = {};

  // Minimal inline-SVG icon set so this file has zero external
  // dependencies (works even before ui-icons.js/Lucide loads).
  const ICONS = {
    dream:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z"/></svg>',
    heart:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0112 6a5.5 5.5 0 019.5 6c-2.5 4.5-9.5 9-9.5 9z"/></svg>',
    wallet:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M16 12h4M2 10h20"/></svg>',
    book:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4.5A2.5 2.5 0 016.5 2H20v18H6.5A2.5 2.5 0 004 17.5v-13z"/><path d="M4 17.5A2.5 2.5 0 016.5 15H20"/></svg>',
    home:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
    capsule: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="3" width="14" height="18" rx="7"/><path d="M5 12h14"/></svg>',
    warn:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 9v4M12 17h.01M10.3 3.9L2.7 17.5A2 2 0 004.4 20.6h15.2a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg>',
    check:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M4 12l6 6L20 6"/></svg>',
    retry:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12a9 9 0 11-3-6.7"/><path d="M21 3v6h-6"/></svg>',
    generic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/></svg>'
  };

  /**
   * PS.empty(container, { icon, title, desc, actionLabel, onAction,
   *   secondaryLabel, onSecondary, hint }) → replaces container's
   * content with a themed empty state. Safe to call repeatedly
   * (e.g. after a delete brings a list back to zero items).
   */
  PS.empty = function (container, cfg) {
    if (!container) return;
    cfg = cfg || {};
    const icon = ICONS[cfg.icon] || ICONS.generic;
    container.innerHTML =
      '<div class="ps-empty' + (cfg.compact ? ' ps-compact' : '') + '">' +
        '<div class="ps-empty-icon">' + icon + '</div>' +
        (cfg.title ? '<p class="ps-empty-title"></p>' : '') +
        (cfg.desc ? '<p class="ps-empty-desc"></p>' : '') +
        '<div class="ps-empty-actions">' +
          (cfg.actionLabel ? '<button class="ps-empty-btn" data-role="primary"></button>' : '') +
          (cfg.secondaryLabel ? '<button class="ps-empty-btn ps-secondary" data-role="secondary"></button>' : '') +
        '</div>' +
        (cfg.hint ? '<p class="ps-empty-hint"></p>' : '') +
      '</div>';
    // textContent, not innerHTML, for all user-facing copy — avoids
    // any markup/XSS surprise from dynamic titles.
    const set = (sel, text) => { const el = container.querySelector(sel); if (el) el.textContent = text; };
    set('.ps-empty-title', cfg.title || '');
    set('.ps-empty-desc', cfg.desc || '');
    set('.ps-empty-hint', cfg.hint || '');
    const primaryBtn = container.querySelector('[data-role="primary"]');
    if (primaryBtn) {
      primaryBtn.textContent = cfg.actionLabel;
      if (cfg.onAction) primaryBtn.addEventListener('click', cfg.onAction);
    }
    const secondaryBtn = container.querySelector('[data-role="secondary"]');
    if (secondaryBtn) {
      secondaryBtn.textContent = cfg.secondaryLabel;
      if (cfg.onSecondary) secondaryBtn.addEventListener('click', cfg.onSecondary);
    }
  };

  /**
   * PS.skeleton(container, { rows, variant }) → shows N shimmer
   * rows while data loads. variant: 'row' (avatar+lines) or 'card'.
   */
  PS.skeleton = function (container, cfg) {
    if (!container) return;
    cfg = cfg || {};
    const rows = cfg.rows || 3;
    const variant = cfg.variant || 'row';
    let html = '';
    for (let i = 0; i < rows; i++) {
      if (variant === 'card') {
        html += '<div class="ps-skel-block ps-skel-card"></div>';
      } else {
        html +=
          '<div class="ps-skel-row">' +
            '<div class="ps-skel-block ps-skel-circle"></div>' +
            '<div style="flex:1;display:flex;flex-direction:column;gap:8px;">' +
              '<div class="ps-skel-block ps-skel-line"></div>' +
              '<div class="ps-skel-block ps-skel-line short"></div>' +
            '</div>' +
          '</div>';
      }
    }
    container.innerHTML = html;
  };

  /**
   * PS.error(container, { title, desc, onRetry }) → error state with
   * a retry button that shows its own brief loading spin, so a slow
   * network doesn't look like the button did nothing.
   */
  PS.error = function (container, cfg) {
    if (!container) return;
    cfg = cfg || {};
    container.innerHTML =
      '<div class="ps-error">' +
        '<div class="ps-error-icon">' + ICONS.warn + '</div>' +
        '<p class="ps-error-title"></p>' +
        '<p class="ps-error-desc"></p>' +
        '<button class="ps-error-retry"><span class="ps-retry-ico">' + ICONS.retry + '</span><span class="ps-retry-label"></span></button>' +
      '</div>';
    container.querySelector('.ps-error-title').textContent = cfg.title || "Something didn't load";
    container.querySelector('.ps-error-desc').textContent = cfg.desc || "Check your connection and try again.";
    const btn = container.querySelector('.ps-error-retry');
    const label = btn.querySelector('.ps-retry-label');
    label.textContent = cfg.retryLabel || 'Try again';
    btn.addEventListener('click', function () {
      if (btn.classList.contains('ps-loading')) return;
      btn.classList.add('ps-loading');
      label.textContent = 'Retrying…';
      Promise.resolve(cfg.onRetry && cfg.onRetry())
        .catch(function () {})
        .finally(function () {
          btn.classList.remove('ps-loading');
          label.textContent = cfg.retryLabel || 'Try again';
        });
    });
  };

  /** PS.success(anchorEl) — small checkmark badge near an element
   *  (or screen-center if omitted) confirming save/create/complete. */
  PS.success = function (anchorEl) {
    const badge = document.createElement('div');
    badge.className = 'ps-check-badge';
    badge.innerHTML = ICONS.check;
    document.body.appendChild(badge);
    let x = window.innerWidth / 2, y = window.innerHeight / 2;
    if (anchorEl) {
      const r = anchorEl.getBoundingClientRect();
      x = r.left + r.width / 2; y = r.top + r.height / 2;
    }
    badge.style.left = (x - 26) + 'px';
    badge.style.top = (y - 26) + 'px';
    requestAnimationFrame(function () { badge.classList.add('ps-play'); });
    setTimeout(function () { badge.remove(); }, 950);
  };

  /** PS.ring(svgEl, pct) — updates a <circle class="ps-ring-fill">
   *  inside svgEl to pct (0-100). Track circle drawn once by caller. */
  PS.ring = function (svgEl, pct) {
    const fill = svgEl && svgEl.querySelector('.ps-ring-fill');
    if (!fill) return;
    const r = fill.r.baseVal.value;
    const c = 2 * Math.PI * r;
    fill.style.strokeDasharray = c;
    fill.style.strokeDashoffset = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  };

  /** PS.bar(barEl, pct) — updates a .ps-bar-fill width. */
  PS.bar = function (barEl, pct) {
    const fill = barEl && barEl.querySelector('.ps-bar-fill');
    if (!fill) return;
    fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
  };

  window.PS = PS;
})();
