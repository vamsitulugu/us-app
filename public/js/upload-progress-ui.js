/* ============================================================
   upload-progress-ui.js — small shared "Uploading memories…"
   progress panel used by every bulk-photo upload surface.

   Does not touch the page's theme: uses its own scoped class
   names and inline-safe styling, injected once via <style>.
   ============================================================ */
(function (global) {
  'use strict';

  var styleInjected = false;
  function injectStyle() {
    if (styleInjected) return;
    styleInjected = true;
    var css = '' +
      '.uq-panel{position:fixed;left:50%;bottom:calc(18px + env(safe-area-inset-bottom,0px));' +
      'transform:translateX(-50%);z-index:99999;min-width:240px;max-width:88vw;' +
      'background:rgba(20,20,28,0.92);color:#fff;border-radius:14px;padding:12px 16px;' +
      'font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'box-shadow:0 8px 28px rgba(0,0,0,0.35);backdrop-filter:blur(8px);' +
      '-webkit-backdrop-filter:blur(8px);transition:opacity .2s ease, transform .2s ease}' +
      '.uq-panel[hidden]{display:none}' +
      '.uq-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;gap:10px}' +
      '.uq-title{font-weight:600;opacity:.95}' +
      '.uq-count{opacity:.75;font-variant-numeric:tabular-nums}' +
      '.uq-bar{height:5px;border-radius:99px;background:rgba(255,255,255,0.16);overflow:hidden}' +
      '.uq-bar-fill{height:100%;border-radius:99px;background:#34d399;transition:width .2s ease}' +
      '.uq-fail{color:#f87171;margin-top:6px;display:flex;align-items:center;justify-content:space-between;gap:10px}' +
      '.uq-retry{background:rgba(255,255,255,0.14);border:none;color:#fff;border-radius:8px;' +
      'padding:4px 10px;font-size:12px;cursor:pointer}';
    var el = document.createElement('style');
    el.textContent = css;
    document.head.appendChild(el);
  }

  function create(label) {
    injectStyle();
    var panel = document.createElement('div');
    panel.className = 'uq-panel';
    panel.hidden = true;
    panel.innerHTML =
      '<div class="uq-row"><span class="uq-title">' + (label || 'Uploading memories') + '</span>' +
      '<span class="uq-count">0 / 0</span></div>' +
      '<div class="uq-bar"><div class="uq-bar-fill" style="width:0%"></div></div>' +
      '<div class="uq-fail" hidden><span class="uq-fail-text"></span><button type="button" class="uq-retry">Retry</button></div>';
    document.body.appendChild(panel);

    var countEl = panel.querySelector('.uq-count');
    var fillEl = panel.querySelector('.uq-bar-fill');
    var failEl = panel.querySelector('.uq-fail');
    var failTextEl = panel.querySelector('.uq-fail-text');
    var retryBtn = panel.querySelector('.uq-retry');

    return {
      show: function () { panel.hidden = false; },
      update: function (state) {
        panel.hidden = false;
        var pct = state.total ? Math.round((state.completed / state.total) * 100) : 0;
        countEl.textContent = state.completed + ' of ' + state.total + ' uploaded';
        fillEl.style.width = pct + '%';
      },
      showFailures: function (failCount, onRetry) {
        if (!failCount) { failEl.hidden = true; return; }
        failEl.hidden = false;
        failTextEl.textContent = failCount + ' failed';
        retryBtn.onclick = onRetry || null;
      },
      finish: function (delayMs) {
        setTimeout(function () { panel.hidden = true; }, delayMs != null ? delayMs : 1400);
      },
      destroy: function () { panel.remove(); }
    };
  }

  global.UploadProgressUI = { create: create };
})(window);
