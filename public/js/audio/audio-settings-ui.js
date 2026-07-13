/*!
 * Audio Settings Panel
 * -----------------------------------------------------------------------
 * Self-injecting settings UI — no changes to any existing HTML template
 * are required. Adds a small floating speaker toggle button (bottom
 * corner, out of the way of existing UI) that opens a lightweight
 * panel with master volume, per-category volumes, mute, and night mode.
 *
 * Everything is namespaced under `.se-` classes and a shadow-free but
 * uniquely-prefixed stylesheet to avoid colliding with existing CSS.
 * -----------------------------------------------------------------------
 */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  const CATEGORY_LABELS = {
    ui: 'Interface', chat: 'Chat', call: 'Calls', ai: 'AI Assistant',
    achievements: 'Achievements', love: 'Love Features', money: 'Money',
    study: 'Study', games: 'Games', home: 'Virtual Home',
    notification: 'Notifications', loading: 'System', music: 'Music', voice: 'Voice'
  };

  const STYLE = `
  .se-fab {
    position: fixed; right: 16px; bottom: 16px; z-index: 9998;
    width: 46px; height: 46px; border-radius: 50%;
    background: rgba(20,20,24,0.85); backdrop-filter: blur(6px);
    color: #fff; border: 1px solid rgba(255,255,255,0.12);
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,0.25);
    transition: transform .15s ease, background .15s ease;
    font-size: 20px; user-select: none;
  }
  .se-fab:active { transform: scale(0.92); }
  .se-panel {
    position: fixed; right: 16px; bottom: 72px; z-index: 9999;
    width: 300px; max-height: 70vh; overflow-y: auto;
    background: rgba(24,24,28,0.96); backdrop-filter: blur(10px);
    border: 1px solid rgba(255,255,255,0.1); border-radius: 16px;
    padding: 16px; color: #f2f2f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    box-shadow: 0 12px 40px rgba(0,0,0,0.35);
    display: none; opacity: 0; transform: translateY(8px);
    transition: opacity .18s ease, transform .18s ease;
  }
  .se-panel.se-open { display: block; }
  .se-panel.se-visible { opacity: 1; transform: translateY(0); }
  .se-title { font-size: 14px; font-weight: 600; margin: 0 0 12px; letter-spacing: .2px; }
  .se-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; gap: 10px; }
  .se-row label { font-size: 12.5px; opacity: .85; flex: 1; }
  .se-row input[type="range"] { flex: 1.4; accent-color: #8b7cf6; height: 4px; }
  .se-toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-top: 1px solid rgba(255,255,255,0.08); margin-top: 6px; }
  .se-switch { position: relative; width: 38px; height: 22px; }
  .se-switch input { opacity: 0; width: 0; height: 0; }
  .se-slider { position: absolute; inset: 0; background: rgba(255,255,255,0.18); border-radius: 999px; cursor: pointer; transition: .15s; }
  .se-slider:before { content: ""; position: absolute; width: 16px; height: 16px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: .15s; }
  .se-switch input:checked + .se-slider { background: #8b7cf6; }
  .se-switch input:checked + .se-slider:before { transform: translateX(16px); }
  .se-section-label { font-size: 11px; text-transform: uppercase; letter-spacing: .6px; opacity: .5; margin: 14px 0 6px; }
  .se-hint { font-size: 11px; opacity: .45; margin-top: 12px; line-height: 1.4; }
  `;

  function injectStyle() {
    const s = document.createElement('style');
    s.setAttribute('data-audio-settings', 'true');
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  function buildRangeRow(labelText, value, onInput) {
    const row = document.createElement('div');
    row.className = 'se-row';
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'range'; input.min = '0'; input.max = '100'; input.value = String(Math.round(value * 100));
    input.addEventListener('input', () => onInput(Number(input.value) / 100));
    row.appendChild(label); row.appendChild(input);
    return row;
  }

  function buildToggleRow(labelText, checked, onChange) {
    const row = document.createElement('div');
    row.className = 'se-toggle-row';
    const label = document.createElement('label');
    label.textContent = labelText;
    label.style.fontSize = '12.5px'; label.style.opacity = '.85';
    const sw = document.createElement('label');
    sw.className = 'se-switch';
    const input = document.createElement('input');
    input.type = 'checkbox'; input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    const slider = document.createElement('span');
    slider.className = 'se-slider';
    sw.appendChild(input); sw.appendChild(slider);
    row.appendChild(label); row.appendChild(sw);
    return row;
  }

  function buildPanel(engine) {
    const panel = document.createElement('div');
    panel.className = 'se-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Sound settings');

    const title = document.createElement('p');
    title.className = 'se-title';
    title.textContent = 'Sound';
    panel.appendChild(title);

    const settings = engine.getSettings();

    panel.appendChild(buildRangeRow('Master Volume', settings.master, (v) => engine.setMasterVolume(v)));

    panel.appendChild(buildToggleRow('Mute All', settings.muted, (v) => {
      engine.setMuted(v);
      toggleRangesDisabled(panel, v);
    }));
    panel.appendChild(buildToggleRow('Night Mode', settings.nightMode, (v) => engine.setNightMode(v)));

    const sectionLabel = document.createElement('div');
    sectionLabel.className = 'se-section-label';
    sectionLabel.textContent = 'Categories';
    panel.appendChild(sectionLabel);

    Object.keys(settings.categories).forEach((cat) => {
      const label = CATEGORY_LABELS[cat] || cat;
      panel.appendChild(buildRangeRow(label, settings.categories[cat], (v) => engine.setCategoryVolume(cat, v)));
    });

    const hint = document.createElement('div');
    hint.className = 'se-hint';
    hint.textContent = 'Sounds automatically soften on low battery and respect this device\u2019s Do Not Disturb settings.';
    panel.appendChild(hint);

    return panel;
  }

  function toggleRangesDisabled(panel, disabled) {
    panel.querySelectorAll('input[type="range"]').forEach((r) => { r.disabled = disabled; r.style.opacity = disabled ? '0.4' : '1'; });
  }

  ready(function init() {
    const engine = window.SoundEngine;
    if (!engine) return;

    injectStyle();

    const fab = document.createElement('button');
    fab.className = 'se-fab';
    fab.type = 'button';
    fab.setAttribute('aria-label', 'Sound settings');
    fab.innerHTML = '\u{1F50A}';

    const panel = buildPanel(engine);
    toggleRangesDisabled(panel, engine.getSettings().muted);

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    let open = false;
    fab.addEventListener('click', (e) => {
      e.stopPropagation();
      open = !open;
      if (open) {
        panel.classList.add('se-open');
        requestAnimationFrame(() => panel.classList.add('se-visible'));
        fab.innerHTML = '\u{1F507}'.length ? '\u{2715}' : '\u{1F50A}';
      } else {
        panel.classList.remove('se-visible');
        setTimeout(() => panel.classList.remove('se-open'), 180);
        fab.innerHTML = '\u{1F50A}';
      }
      if (window.SoundEngine) window.SoundEngine.play('ui.popup.' + (open ? 'open' : 'close'));
    });

    document.addEventListener('click', (e) => {
      if (open && !panel.contains(e.target) && e.target !== fab) {
        open = false;
        panel.classList.remove('se-visible');
        setTimeout(() => panel.classList.remove('se-open'), 180);
        fab.innerHTML = '\u{1F50A}';
      }
    });
  });
})();