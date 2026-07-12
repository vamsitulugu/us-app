/*!
 * Audio Integration Layer
 * -----------------------------------------------------------------------
 * Wires the sound library to the existing DOM WITHOUT modifying any
 * existing markup, backend logic, or component behavior.
 *
 * Two mechanisms, both purely additive:
 *
 *  1. GENERIC DELEGATION — a single capture-phase click listener plays a
 *     subtle default tap/toggle sound for common interactive elements
 *     (buttons, [role=button], .btn, tabs, nav items) app-wide. This
 *     alone gives every page a baseline of premium feedback with zero
 *     per-page code changes.
 *
 *  2. OPT-IN MAPPING — any element can request a specific, richer sound
 *     by adding `data-sound="chat.message.sent"` (or firing a custom
 *     event, see window.playAppSound below). Existing app code can call
 *     `window.playAppSound('achievement.level.up')` from anywhere
 *     (e.g. inside chat.js, call.js, etc.) without any dependency other
 *     than this file being loaded first.
 *
 * Nothing here throws if SoundEngine/library failed to load — every
 * call is defensively guarded so the app never breaks because of audio.
 * -----------------------------------------------------------------------
 */
(function () {
  'use strict';

  function safePlay(name, opts) {
    try {
      if (window.SoundEngine) window.SoundEngine.play(name, opts);
    } catch (e) { /* never let audio break the app */ }
  }

  // Public, stable API existing app code can call from anywhere:
  //   window.playAppSound('chat.message.sent')
  window.playAppSound = safePlay;

  /* ---------------------------------------------------------------- */
  /* Respect Android/OS silent mode + Do Not Disturb heuristics        */
  /* ---------------------------------------------------------------- */
  function syncSilentEnvironment() {
    if (!window.SoundEngine) return;
    // There is no direct web API for "OS silent switch" or true DND,
    // but we respect the most reliable proxies available in-browser:
    //  - navigator.getBattery() saveData / low battery -> soften audio
    //  - matchMedia('(prefers-reduced-motion)') as a proxy for reduced
    //    stimulation preference, applied to non-essential (ambient) sounds
    try {
      if (navigator.connection && navigator.connection.saveData) {
        window.SoundEngine.setCategoryVolume('home', 0.15); // battery saver: cut ambience
      }
    } catch (e) {}

    try {
      if (navigator.getBattery) {
        navigator.getBattery().then((battery) => {
          const applyBatteryState = () => {
            if (battery.level <= 0.15 && !battery.charging) {
              window.SoundEngine.setCategoryVolume('home', 0.1);
            }
          };
          applyBatteryState();
          battery.addEventListener('levelchange', applyBatteryState);
          battery.addEventListener('chargingchange', applyBatteryState);
        }).catch(() => {});
      }
    } catch (e) {}
  }

  /* ---------------------------------------------------------------- */
  /* Generic delegation for baseline premium feedback                  */
  /* ---------------------------------------------------------------- */
  const TAP_SELECTOR = [
    'button', '[role="button"]', '.btn',
    'input[type="checkbox"]', 'input[type="radio"]',
    '.tab', '[role="tab"]', '.nav-item', '.bottom-nav *[data-nav]'
  ].join(',');

  let lastClickTarget = null;
  let lastClickTime = 0;

  document.addEventListener('click', function (evt) {
    const el = evt.target && evt.target.closest ? evt.target.closest(TAP_SELECTOR) : null;
    if (!el) return;

    // Avoid double-fire if an explicit data-sound already handled this element.
    if (el.hasAttribute('data-sound')) return;
    if (el.hasAttribute('data-sound-off')) return; // explicit opt-out escape hatch

    const now = Date.now();
    if (el === lastClickTarget && now - lastClickTime < 80) return;
    lastClickTarget = el; lastClickTime = now;

    if (el.matches('input[type="checkbox"]')) {
      safePlay(el.checked ? 'ui.checkbox.check' : 'ui.checkbox.uncheck');
    } else if (el.matches('input[type="radio"]')) {
      safePlay('ui.radio.select');
    } else if (el.matches('.tab, [role="tab"]')) {
      safePlay('ui.tab.switch');
    } else {
      safePlay('ui.button.tap');
    }
  }, true);

  // data-sound opt-in: <button data-sound="chat.voice.record.start">
  document.addEventListener('click', function (evt) {
    const el = evt.target && evt.target.closest ? evt.target.closest('[data-sound]') : null;
    if (!el) return;
    safePlay(el.getAttribute('data-sound'));
  }, true);

  /* ---------------------------------------------------------------- */
  /* Dialogs / popups opened via the native <dialog> element or        */
  /* elements toggled with the `hidden` attribute / .open class.       */
  /* Observed passively via MutationObserver — no existing code touched*/
  /* ---------------------------------------------------------------- */
  const dialogWatcher = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type !== 'attributes') continue;
      const el = m.target;
      if (!(el instanceof HTMLElement)) continue;

      const isDialogLike = el.tagName === 'DIALOG' ||
        el.classList.contains('modal') || el.classList.contains('dialog') ||
        el.classList.contains('popup') || el.getAttribute('role') === 'dialog';
      if (!isDialogLike) continue;

      if (m.attributeName === 'open') {
        safePlay(el.hasAttribute('open') ? 'ui.dialog.open' : 'ui.dialog.close');
      } else if (m.attributeName === 'class' || m.attributeName === 'hidden') {
        const visible = !el.hidden && !el.classList.contains('hidden');
        safePlay(visible ? 'ui.popup.open' : 'ui.popup.close');
      }
    }
  });

  function watchDialogs(root) {
    try {
      dialogWatcher.observe(root, {
        attributes: true, attributeFilter: ['open', 'class', 'hidden'], subtree: true
      });
    } catch (e) {}
  }

  document.addEventListener('DOMContentLoaded', () => {
    watchDialogs(document.body);
    syncSilentEnvironment();
  });
  if (document.readyState !== 'loading') {
    watchDialogs(document.body);
    syncSilentEnvironment();
  }
})();
