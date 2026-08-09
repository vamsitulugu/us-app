/* ═══════════════════════════════════════════════════════════
   SAFE DELETE — shared confirmation modal + long-press
   multi-select helper, used across Twin Hearts pages.

   Public API:
     confirmDelete({ title, message, itemType, count, destructiveLabel, onConfirm })
     attachLongPress(el, { onLongPress, onTap, threshold, moveTolerance })
     createSelectionController({ onChange }) -> { ids, toggle, clear, has, size }
   ═══════════════════════════════════════════════════════════ */

/* ── Confirmation modal (replaces confirm()/alert()) ────────── */
(function () {
  if (window.confirmDelete) return; // don't double-init if included twice

  let overlay, box, titleEl, msgEl, cancelBtn, confirmBtn, busy = false;

  function ensureDom() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'sd-overlay';
    overlay.innerHTML = `
      <div class="sd-sheet" role="alertdialog" aria-modal="true">
        <div class="sd-icon"><i data-lucide="trash-2"></i></div>
        <div class="sd-title"></div>
        <div class="sd-msg"></div>
        <div class="sd-actions">
          <button type="button" class="sd-btn sd-cancel">Cancel</button>
          <button type="button" class="sd-btn sd-confirm">Delete</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    box = overlay.querySelector('.sd-sheet');
    titleEl = overlay.querySelector('.sd-title');
    msgEl = overlay.querySelector('.sd-msg');
    cancelBtn = overlay.querySelector('.sd-cancel');
    confirmBtn = overlay.querySelector('.sd-confirm');

    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    cancelBtn.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (overlay.classList.contains('show') && e.key === 'Escape') close();
    });
    if (window.lucide) { try { lucide.createIcons(); } catch (_) {} }
  }

  function close() {
    if (busy) return; // don't allow closing mid-delete via backdrop/esc race
    overlay.classList.remove('show');
    setTimeout(() => {
      confirmBtn.onclick = null;
      // Multi-option mode injects extra buttons ahead of sd-confirm —
      // strip them back out so the next single-option call gets a clean
      // two-button sheet again instead of accumulating stale buttons.
      overlay.querySelectorAll('.sd-actions .sd-btn[data-extra]').forEach(b => b.remove());
      confirmBtn.style.display = '';
      overlay.querySelector('.sd-actions').classList.remove('sd-multi');
    }, 200);
  }

  function setBusy(v, btn) {
    busy = v;
    const actionBtns = overlay.querySelectorAll('.sd-actions .sd-btn:not(.sd-cancel)');
    actionBtns.forEach(b => { b.disabled = v; });
    cancelBtn.disabled = v;
    const target = btn || confirmBtn;
    target.classList.toggle('sd-loading', v);
    target.textContent = v ? '' : (target.dataset.label || 'Delete');
  }

  /**
   * confirmDelete({title, message, itemType, count, destructiveLabel, onConfirm})
   *   — single destructive action (original signature, unchanged for
   *   every existing caller across the app).
   * confirmDelete({title, message, itemType, count, options})
   *   — WhatsApp-style sheet with 2+ destructive choices stacked above
   *   Cancel, e.g. [{ label: 'Delete for everyone', onConfirm }, { label:
   *   'Delete for me', onConfirm }]. Only pass the options the backend
   *   can actually perform for the current selection — this modal never
   *   decides eligibility itself, the caller does.
   * Each onConfirm may be async; its own button is disabled while it
   * runs (prevents double-tap), and the whole sheet only closes once it
   * resolves — a rejection keeps the sheet open and shows the error so
   * the user can retry instead of silently losing the action.
   */
  window.confirmDelete = function ({ title, message, itemType, count, destructiveLabel, onConfirm, options }) {
    ensureDom();
    const label = itemType || 'item';
    const n = count || 1;
    titleEl.textContent = title || (n > 1 ? `Delete ${n} selected ${label}${n === 1 ? '' : 's'}?` : `Delete this ${label}?`);
    msgEl.textContent = message || `This action can't be undone.`;
    setBusy(false);

    async function runOption(fn, btn) {
      if (busy) return; // guard against rapid double-tap across any of the buttons
      setBusy(true, btn);
      try {
        await fn();
        setBusy(false, btn);
        overlay.classList.remove('show');
      } catch (err) {
        setBusy(false, btn);
        msgEl.textContent = 'Something went wrong: ' + (err && err.message ? err.message : 'delete failed') + '. Nothing else was deleted — you can try again.';
      }
    }

    const actionsEl = overlay.querySelector('.sd-actions');
    actionsEl.classList.toggle('sd-multi', !!(options && options.length));

    if (options && options.length) {
      // Multi-choice sheet: one button per option, all above Cancel,
      // each independently disabled/spinning only while its own
      // onConfirm is in flight.
      confirmBtn.style.display = 'none';
      overlay.querySelectorAll('.sd-actions .sd-btn[data-extra]').forEach(b => b.remove());
      const actions = actionsEl;
      // Insert each option directly before Cancel, in the order given —
      // Cancel always ends up last, matching the WhatsApp sheet layout
      // (destructive choices stacked above Cancel, not mixed with it).
      options.forEach(opt => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sd-btn sd-confirm';
        btn.setAttribute('data-extra', '1');
        btn.dataset.label = opt.label;
        btn.textContent = opt.label;
        btn.onclick = () => runOption(opt.onConfirm, btn);
        actions.insertBefore(btn, cancelBtn);
      });
    } else {
      confirmBtn.dataset.label = destructiveLabel || 'Delete';
      confirmBtn.textContent = confirmBtn.dataset.label;
      confirmBtn.onclick = () => runOption(onConfirm, confirmBtn);
    }

    overlay.classList.add('show');
  };
})();

/* ── Long-press helper (pointer events, scroll-safe) ─────────── */
/**
 * attachLongPress(el, { onLongPress, onTap, onPressStart, onPressCancel,
 *   threshold=380, moveTolerance=14, ignoreSelector })
 * - Quick tap  -> onTap(e)
 * - Hold ~threshold ms without moving more than moveTolerance px -> onLongPress(e)
 * - onPressStart fires immediately on touch/mouse-down (before the long-press
 *   fires) so the UI can give instant feedback that the press registered,
 *   instead of feeling dead until the timer completes.
 * - onPressCancel fires if the press is released/cancelled before the
 *   long-press threshold (covers both a quick tap and a scroll-cancel).
 * - ignoreSelector: if the press started on an element matching this
 *   selector (e.g. a waveform that has its own drag-to-seek, or action
 *   buttons), the long-press timer never starts at all and the normal
 *   tap/click on that sub-element behaves exactly as before — this is
 *   what makes it safe to attach long-press to a whole card/row that
 *   already has other gestures living inside it.
 * - Any scroll/drag movement cancels the long-press timer so scrolling
 *   long lists is never interrupted.
 */
window.attachLongPress = function (el, opts) {
  const { onLongPress, onTap, onPressStart, onPressCancel, threshold = 380, moveTolerance = 14, ignoreSelector } = opts || {};
  let timer = null, startX = 0, startY = 0, longPressed = false, active = false;

  function clearTimer() { if (timer) { clearTimeout(timer); timer = null; } }

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (ignoreSelector && e.target.closest(ignoreSelector)) return; // let that sub-element's own gesture (drag-seek, button tap) own this touch entirely
    active = true;
    longPressed = false;
    startX = e.clientX; startY = e.clientY;
    clearTimer();
    onPressStart && onPressStart(e);
    timer = setTimeout(() => {
      if (!active) return;
      longPressed = true;
      timer = null;
      if (navigator.vibrate) { try { navigator.vibrate(15); } catch (_) {} }
      onLongPress && onLongPress(e);
    }, threshold);
  }

  function onMove(e) {
    if (!active || !timer) return;
    const dx = Math.abs(e.clientX - startX), dy = Math.abs(e.clientY - startY);
    if (dx > moveTolerance || dy > moveTolerance) { clearTimer(); onPressCancel && onPressCancel(e); } // treat as scroll/drag
  }

  function onUp(e) {
    if (!active) return;
    active = false;
    const wasLongPress = longPressed;
    const hadTimer = !!timer;
    clearTimer();
    longPressed = false;
    if (!wasLongPress) {
      if (hadTimer) onPressCancel && onPressCancel(e);
      onTap && onTap(e);
    }
  }

  function onCancel(e) { const had = active || timer; active = false; longPressed = false; clearTimer(); if (had) onPressCancel && onPressCancel(e); }

  el.addEventListener('pointerdown', onDown, { passive: true });
  el.addEventListener('pointermove', onMove, { passive: true });
  el.addEventListener('pointerup', onUp, { passive: true });
  el.addEventListener('pointercancel', onCancel, { passive: true });
  el.addEventListener('pointerleave', onCancel, { passive: true });

  return function detach() {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancel);
    el.removeEventListener('pointerleave', onCancel);
    clearTimer();
  };
};

/* ── Page-scoped selection state controller ──────────────────── */
/**
 * createSelectionController({ onChange }) -> controller
 * Intentionally NOT a global singleton — call this once per page/list
 * so selection never leaks between Chat, Memories, Bucket List, etc.
 * Call controller.clear() when navigating away from the page.
 */
window.createSelectionController = function ({ onChange } = {}) {
  const ids = new Set();
  function fire() { onChange && onChange(ids); }
  return {
    ids,
    get size() { return ids.size; },
    has: (id) => ids.has(id),
    toggle(id) { ids.has(id) ? ids.delete(id) : ids.add(id); fire(); return ids.has(id); },
    select(id) { ids.add(id); fire(); },
    deselect(id) { ids.delete(id); fire(); },
    clear() { ids.clear(); fire(); },
    all() { return Array.from(ids); }
  };
};

/* ── Bulk-delete runner with partial-failure reporting ───────── */
/**
 * runBulkDelete(ids, deleteOneFn) -> { succeeded: [], failed: [{id, error}] }
 * deleteOneFn(id) must return a promise. Runs sequentially-safe (small
 * concurrency) and never reports success unless the backend actually
 * confirmed each one.
 */
window.runBulkDelete = async function (ids, deleteOneFn) {
  const succeeded = [], failed = [];
  for (const id of ids) {
    try { await deleteOneFn(id); succeeded.push(id); }
    catch (err) { failed.push({ id, error: err && err.message ? err.message : 'failed' }); }
  }
  return { succeeded, failed };
};