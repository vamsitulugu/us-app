(function () {
  'use strict';

  const CATEGORY_LABELS = {
    ui: 'Interface', chat: 'Chat', call: 'Calls', ai: 'AI Assistant',
    achievements: 'Achievements', love: 'Love Features', money: 'Money',
    study: 'Study', games: 'Games', home: 'Virtual Home',
    notification: 'Notifications', loading: 'System', music: 'Music', voice: 'Voice'
  };

  const STYLE_ID = 'sound-settings-inline-style';
  const STYLE = `
  .snd-row { display:flex; align-items:center; justify-content:space-between; gap:14px; padding:10px 0; }
  .snd-row + .snd-row { border-top:1px solid var(--border); }
  .snd-row label { font-size:12.5px; color:var(--white); flex:1; }
  .snd-row input[type="range"] { flex:1.5; accent-color:var(--accent); height:4px; }
  .snd-section-label { font-size:11px; text-transform:uppercase; letter-spacing:.6px; color:var(--text3); margin:14px 0 4px; }
  `;

  function injectStyleOnce() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  function buildRangeRow(labelText, value, onInput) {
    const row = document.createElement('div');
    row.className = 'snd-row';
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
    row.className = 'snd-row';
    const label = document.createElement('label');
    label.textContent = labelText;
    const toggle = document.createElement('div');
    toggle.className = 'toggle' + (checked ? ' on' : '');
    toggle.addEventListener('click', () => {
      const next = !toggle.classList.contains('on');
      toggle.classList.toggle('on', next);
      onChange(next);
    });
    row.appendChild(label); row.appendChild(toggle);
    return row;
  }

  function toggleRangesDisabled(container, disabled) {
    container.querySelectorAll('input[type="range"]').forEach((r) => { r.disabled = disabled; r.style.opacity = disabled ? '0.4' : '1'; });
  }

  function renderInto(container) {
    const engine = window.SoundEngine;
    if (!container || !engine) return;

    injectStyleOnce();
    container.innerHTML = '';

    const settings = engine.getSettings();

    container.appendChild(buildRangeRow('Master Volume', settings.master, (v) => engine.setMasterVolume(v)));
    container.appendChild(buildToggleRow('Mute All', settings.muted, (v) => {
      engine.setMuted(v);
      toggleRangesDisabled(container, v);
    }));
    container.appendChild(buildToggleRow('Night Mode', settings.nightMode, (v) => engine.setNightMode(v)));

    const sectionLabel = document.createElement('div');
    sectionLabel.className = 'snd-section-label';
    sectionLabel.textContent = 'Categories';
    container.appendChild(sectionLabel);

    Object.keys(settings.categories).forEach((cat) => {
      const label = CATEGORY_LABELS[cat] || cat;
      container.appendChild(buildRangeRow(label, settings.categories[cat], (v) => engine.setCategoryVolume(cat, v)));
    });

    toggleRangesDisabled(container, settings.muted);
  }

  window.SoundSettingsUI = { renderInto };
})();