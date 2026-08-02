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
    setTimeout(() => { confirmBtn.onclick = null; }, 200);
  }

  function setBusy(v) {
    busy = v;
    confirmBtn.disabled = v;
    cancelBtn.disabled = v;
    confirmBtn.classList.toggle('sd-loading', v);
    confirmBtn.textContent = v ? '' : (confirmBtn.dataset.label || 'Delete');
  }

  /**
   * confirmDelete({title, message, itemType, count, destructiveLabel, onConfirm})
   * onConfirm may be async; while it runs the confirm button is disabled
   * (prevents double-delete / double-tap). Modal only closes after
   * onConfirm resolves successfully, or stays open + shows the thrown
   * error message if it rejects.
   */
  window.confirmDelete = function ({ title, message, itemType, count, destructiveLabel, onConfirm }) {
    ensureDom();
    const label = itemType || 'item';
    const n = count || 1;
    titleEl.textContent = title || (n > 1 ? `Delete ${n} selected ${label}${n === 1 ? '' : 's'}?` : `Delete this ${label}?`);
    msgEl.textContent = message || `This action can't be undone.`;
    confirmBtn.dataset.label = destructiveLabel || 'Delete';
    confirmBtn.textContent = confirmBtn.dataset.label;
    setBusy(false);
    overlay.classList.add('show');

    confirmBtn.onclick = async () => {
      if (busy) return; // guard against rapid double-tap
      setBusy(true);
      try {
        await onConfirm();
        setBusy(false);
        overlay.classList.remove('show');
      } catch (err) {
        setBusy(false);
        msgEl.textContent = 'Something went wrong: ' + (err && err.message ? err.message : 'delete failed') + '. Nothing else was deleted — you can try again.';
      }
    };
  };
})();

/* ── Long-press helper (pointer events, scroll-safe) ─────────── */
/**
 * attachLongPress(el, { onLongPress, onTap, threshold=500, moveTolerance=10 })
 * - Quick tap  -> onTap(e)
 * - Hold ~threshold ms without moving more than moveTolerance px -> onLongPress(e)
 * - Any scroll/drag movement cancels the long-press timer so scrolling
 *   long lists is never interrupted.
 */
window.attachLongPress = function (el, opts) {
  const { onLongPress, onTap, threshold = 500, moveTolerance = 10 } = opts || {};
  let timer = null, startX = 0, startY = 0, longPressed = false, active = false;

  function clearTimer() { if (timer) { clearTimeout(timer); timer = null; } }

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    active = true;
    longPressed = false;
    startX = e.clientX; startY = e.clientY;
    clearTimer();
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
    if (dx > moveTolerance || dy > moveTolerance) clearTimer(); // treat as scroll/drag
  }

  function onUp(e) {
    if (!active) return;
    active = false;
    const wasLongPress = longPressed;
    clearTimer();
    longPressed = false;
    if (!wasLongPress) onTap && onTap(e);
  }

  function onCancel() { active = false; longPressed = false; clearTimer(); }

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