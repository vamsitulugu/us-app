/* ══════════════════════════════════════════════════════════════
   DASHBOARD WIDGETS — extends #page-dashboard (see dashboard.js)
   DashWidgets.render()   events row · mood card · custom card photos
   DashWidgets.openMood() full-screen mood calendar (also logs today's mood)
   DashWidgets.openPhotos() 16:9 photo editor for the Hug/Touch/Miss card

   Data it reads/writes on the global state S (synced by the app):
     S.anniversary, S.myBday, S.ptBday, S.events, S.milestones   (read)
     S.profile.u1|u2.moods = { 'YYYY-MM-DD': 'Happy' }            (each person writes only their own;
                                                                   both are shown on the dashboard)
     S.dashImgs = { idle|hug|touch|miss: { url, path } }          (read/write, URLs only)
   Needs app globals: S, scheduleSave, goto, toast, todayStr, uploadMediaFile, API.
   ══════════════════════════════════════════════════════════════ */
'use strict';

const DashWidgets = (() => {
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = s => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  };
  const midnight = () => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); };
  const dayDiff = (a, b) => Math.round((b - a) / 86400000);
  const todayKey = () => (typeof window.todayStr === 'function' ? window.todayStr() : iso(new Date()));
  const fmtShort = d => d.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' });
  const ordinal = n => { const v = n % 100; return n + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th'); };
  const save = () => { if (typeof scheduleSave === 'function') scheduleSave(); };
  const say = m => { if (typeof toast === 'function') toast(m); };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;      // textContent only — event titles are user text
    return n;
  }
  const SVG = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs) => { const n = document.createElementNS(SVG, tag); Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v)); return n; };
  const ICON = {
    close: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    prev: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
    image: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="9" cy="9" r="1.8"/><path d="m21 15-4.5-4.5L5 21"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
    minus: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M8 11h6"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M8 11h6M11 8v6"/></svg>',
  };
  const stateOK = () => typeof window.S !== 'undefined' && window.S;

  /* ───────────────────────── EVENTS ROW ───────────────────────── */
  const EV_ICON = { Anniversary: '💕', Date: '🌹', Birthday: '🎂', Trip: '✈️', Special: '⭐', Study: '📚', Other: '📌' };
  const DAY_MARKS = [100, 200, 300, 365, 500, 730, 1000, 1500, 2000, 2500, 3000, 3650];

  function nextYearly(d, today) {
    let n = new Date(today.getFullYear(), d.getMonth(), d.getDate());
    if (n < today) n = new Date(today.getFullYear() + 1, d.getMonth(), d.getDate());
    return n;
  }

  function collectEvents() {
    const today = midnight(), out = [];
    const add = (icon, title, date, page, sub) => out.push({ icon, title, date, page, sub, days: dayDiff(today, date) });

    const mine = parseISO(S.myBday), pt = parseISO(S.ptBday);
    if (mine) add('🎂', 'Your birthday', nextYearly(mine, today), 'lovecounter');
    if (pt) add('🎂', `${S.partnerName || 'Partner'}'s birthday`, nextYearly(pt, today), 'lovecounter');

    const an = parseISO(S.anniversary);
    if (an && an <= today) {
      const yr = nextYearly(an, today);
      const years = yr.getFullYear() - an.getFullYear();
      if (years > 0) add('💕', `${ordinal(years)} anniversary`, yr, 'lovecounter');

      // monthly anniversary
      let y = today.getFullYear(), m = today.getMonth();
      const mk = (yy, mm) => new Date(yy, mm, Math.min(an.getDate(), new Date(yy, mm + 1, 0).getDate()));
      let nm = mk(y, m);
      if (nm < today) { m++; if (m > 11) { m = 0; y++; } nm = mk(y, m); }
      const months = (nm.getFullYear() - an.getFullYear()) * 12 + nm.getMonth() - an.getMonth();
      if (months > 0 && months % 12 !== 0) add('🥂', `${months} months together`, nm, 'lovecounter');

      // next "day N" milestone
      const together = dayDiff(an, today);
      const mark = DAY_MARKS.find(n => n >= together);
      if (mark) add('✨', `Day ${mark} together`, new Date(an.getFullYear(), an.getMonth(), an.getDate() + mark), 'lovecounter');
    }

    (S.events || []).forEach(e => {
      const d = parseISO(e.date);
      if (d && d >= today && e.title) add(EV_ICON[e.cat] || '📌', e.title, d, 'calendar', e.time || '');
    });
    (S.milestones || []).forEach(m => {
      const d = parseISO(m.date);
      if (d && d >= today && m.title) add(m.type || '💫', m.title, d, 'lovecounter');
    });

    out.sort((a, b) => a.days - b.days);
    return out.slice(0, 8);
  }

  function renderEvents() {
    const row = $('dwEvents');
    if (!row) return;
    const items = collectEvents();
    row.replaceChildren();
    if (!items.length) {
      const b = el('button', 'dw-ev is-empty');
      b.type = 'button';
      b.append(el('span', 'dw-ev-ico', '📅'));
      const t = el('span', 'dw-ev-tx');
      t.append(el('b', '', 'Nothing planned yet'), el('i', '', 'Add a birthday, anniversary or plan'));
      b.append(t);
      b.onclick = () => goto('calendar');
      row.append(b);
      return;
    }
    items.forEach(it => {
      const b = el('button', 'dw-ev' + (it.days === 0 ? ' is-today' : ''));
      b.type = 'button';
      b.append(el('span', 'dw-ev-ico', it.icon));
      const t = el('span', 'dw-ev-tx');
      const when = it.days === 0 ? 'Today' : it.days === 1 ? 'Tomorrow' : `in ${it.days} days`;
      t.append(el('b', '', it.title), el('i', '', `${when} · ${fmtShort(it.date)}${it.sub ? ' · ' + it.sub : ''}`));
      b.append(t, el('span', 'dw-ev-d', it.days === 0 ? '🎉' : it.days + 'd'));
      b.onclick = () => goto(it.page);
      row.append(b);
    });
  }

  /* ───────────────────────── MOODS (one set per person) ─────────────────────────
     Stored at S.profile.u1|u2.moods = { 'YYYY-MM-DD': 'Happy' }.
     Each person only ever writes their own entry (the server enforces this too),
     so the two moods never overwrite each other. */
  const MOODS = {
    Excited:  { e: '🤩', c: '#f5b301', s: 5 },
    Loved:    { e: '🥰', c: '#ff7aa8', s: 5 },
    Happy:    { e: '😊', c: '#ffd43b', s: 4 },
    Peaceful: { e: '😌', c: '#8fc46a', s: 4 },
    Tired:    { e: '🥱', c: '#b08968', s: 2 },
    Stressed: { e: '😤', c: '#ff9248', s: 2 },
    Sad:      { e: '😔', c: '#a779f2', s: 1 },
    Angry:    { e: '😡', c: '#ef5350', s: 1 },
  };
  const moodKey = str => {
    const w = String(str || '').replace(/^[^A-Za-z]+/, '').trim().toLowerCase();
    return Object.keys(MOODS).find(k => k.toLowerCase() === w) || null;
  };
  const myRk = () => (S.role === 'user2' ? 'u2' : 'u1');
  const ptRk = () => (S.role === 'user2' ? 'u1' : 'u2');
  const ptName = () => S.partnerName || 'Partner';
  const hasPartner = () => !!S.paired;
  const moodOf = (rk, dateKey) => {
    const m = S.profile && S.profile[rk] && S.profile[rk].moods;
    const k = m && m[dateKey];
    return MOODS[k] ? k : null;
  };

  // Writes MY mood only. mirror=true also keeps the older shared Wellness/Journal field in step.
  function writeMine(dateKey, mk, mirror) {
    if (!S.profile) S.profile = {};
    const rk = myRk();
    const entry = { ...(S.profile[rk] || {}) };
    const moods = { ...(entry.moods || {}) };
    if (mk) moods[dateKey] = mk; else delete moods[dateKey];
    entry.moods = moods;
    S.profile[rk] = entry;
    if (mirror) {
      if (!S.wellness) S.wellness = {};
      if (!S.wellness[dateKey]) S.wellness[dateKey] = {};
      if (mk) {
        S.wellness[dateKey].mood = `${MOODS[mk].e} ${mk}`;
        if (dateKey === todayKey()) S.selectedMood = S.wellness[dateKey].mood;
      } else delete S.wellness[dateKey].mood;
    }
    save();
  }
  function setMood(dateKey, mk) { writeMine(dateKey, mk, true); renderMood(); renderCal(); }

  // Other parts of the app set today's mood too (sidebar quick mood, Wellness save) — mirror those into my set.
  function hookLegacy() {
    [['quickMood', a => a[1]], ['saveWellness', () => S.selectedMood]].forEach(([name, pick]) => {
      const fn = window[name];
      if (typeof fn !== 'function' || fn._dw) return;
      const wrapped = function () {
        const r = fn.apply(this, arguments);
        try { const mk = moodKey(pick(arguments)); if (mk) { writeMine(todayKey(), mk, false); renderMood(); } } catch (_) { /* never break the app's own handler */ }
        return r;
      };
      wrapped._dw = true;
      window[name] = wrapped;
    });
  }

  function lastDays(n) {            // oldest → newest, ending today (app's own "today")
    const end = parseISO(todayKey()) || midnight(), out = [];
    for (let i = n - 1; i >= 0; i--) out.push(new Date(end.getFullYear(), end.getMonth(), end.getDate() - i));
    return out;
  }

  function streak(rk) {
    const end = parseISO(todayKey()) || midnight();
    let i = moodOf(rk, iso(end)) ? 0 : 1, n = 0;
    for (; i < 400; i++) {
      if (!moodOf(rk, iso(new Date(end.getFullYear(), end.getMonth(), end.getDate() - i)))) break;
      n++;
    }
    return n;
  }

  function renderMood() {
    const card = $('dwMood');
    if (!card) return;
    const days = lastDays(7);
    const W = 280, colW = W / 7;
    const y = s => 64 - ((s - 1) / 4) * 56;

    const svg = svgEl('svg', { viewBox: '0 0 280 72', class: 'dw-graph', 'aria-hidden': 'true', preserveAspectRatio: 'none' });
    [8, 36, 64].forEach(gy => svg.append(svgEl('line', { x1: 0, x2: W, y1: gy, y2: gy, class: 'g-grid' })));

    const draw = (rk, cls, r, ring) => {
      const pts = days.map((d, i) => { const k = moodOf(rk, iso(d)); return k ? { x: colW * (i + .5), y: y(MOODS[k].s), c: MOODS[k].c } : null; });
      let run = [];
      const flush = () => { if (run.length > 1) svg.append(svgEl('path', { class: cls, d: run.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') })); run = []; };
      pts.forEach(p => { if (p) run.push(p); else flush(); });
      flush();
      pts.forEach(p => { if (p) svg.append(svgEl('circle', { cx: p.x, cy: p.y, r, fill: p.c, stroke: ring, 'stroke-width': ring === '#fff' ? 1.5 : 2 })); });
    };
    const pair = hasPartner();
    if (pair) draw(ptRk(), 'g-line g-pt', 4.5, '#fff');
    draw(myRk(), 'g-line', 6, '#1b121a');

    const labels = el('div', 'dw-days');
    days.forEach((d, i) => labels.append(el('span', i === 6 ? 'is-today' : '', i === 6 ? 'Today' : ['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getDay()])));

    const tk = todayKey(), a = moodOf(myRk(), tk), b = pair ? moodOf(ptRk(), tk) : null, n = streak(myRk());
    const top = el('div', 'dw-mood-top');
    top.append(el('b', '', 'Mood'), el('span', 'dw-mood-streak', n >= 2 ? `🔥 ${n}-day streak` : 'Calendar ›'));

    let sub;
    if (!pair) sub = a ? `Today: ${MOODS[a].e} ${a}` : 'How are you feeling today?';
    else sub = `You ${a ? MOODS[a].e : '—'}  ·  ${ptName()} ${b ? MOODS[b].e : '—'}`;
    const kids = [top, el('p', 'dw-mood-sub', sub), svg, labels];
    if (pair) {
      const lg = el('div', 'dw-legend');
      lg.append(el('span', 'you', 'You'), el('span', 'pt', ptName()));
      kids.push(lg);
    }
    card.replaceChildren(...kids);
  }

  /* ── Mood calendar overlay ── */
  let moodOv = null;
  const cal = { y: 0, m: 0, sel: '', who: 'me' };

  function buildMoodOverlay() {
    const ov = el('div', 'dw-overlay');
    ov.id = 'dwMoodOv';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Mood calendar');
    const panel = el('div', 'dw-panel');
    const bar = el('div', 'dw-bar');
    const close = el('button', 'dw-icon'); close.type = 'button'; close.setAttribute('aria-label', 'Close'); close.innerHTML = ICON.close;
    close.onclick = () => closeOv(ov);
    const spacer = el('span'); spacer.style.width = '40px';
    bar.append(close, el('h2', '', 'Mood Calendar'), spacer);
    const sc = el('div', 'dw-scroll');
    const seg = el('div', 'dw-seg dw-who');
    ['me', 'pt'].forEach(w => {
      const b = el('button'); b.type = 'button'; b.dataset.w = w;
      b.onclick = () => { cal.who = w; renderCal(); };
      seg.append(b);
    });
    sc.append(seg, el('p', 'dw-q'), el('div', 'dw-moodchips'), el('p', 'dw-ptline'));
    const hint = el('p', 'dw-hint');
    hint.style.textAlign = 'left';
    const mb = el('div', 'dw-monthbar');
    const p = el('button', 'dw-icon'); p.type = 'button'; p.innerHTML = ICON.prev; p.setAttribute('aria-label', 'Previous month');
    const nx = el('button', 'dw-icon'); nx.type = 'button'; nx.innerHTML = ICON.next; nx.setAttribute('aria-label', 'Next month');
    p.onclick = () => { cal.m--; if (cal.m < 0) { cal.m = 11; cal.y--; } renderCal(); };
    nx.onclick = () => { cal.m++; if (cal.m > 11) { cal.m = 0; cal.y++; } renderCal(); };
    mb.append(p, el('b'), nx);
    sc.append(hint, mb, el('div', 'dw-cal'), el('div', 'dw-stats'));
    panel.append(bar, sc);
    ov.append(panel);
    ov.addEventListener('click', e => { if (e.target === ov) closeOv(ov); });
    document.body.append(ov);
    return ov;
  }

  function renderCal() {
    if (!moodOv) return;
    const tk = todayKey(), pair = hasPartner();
    if (!pair) cal.who = 'me';
    const mine = cal.who === 'me', rk = mine ? myRk() : ptRk();
    const sc = moodOv.querySelector('.dw-scroll');
    const seg = sc.querySelector('.dw-who'), q = sc.querySelector('.dw-q'), chips = sc.querySelector('.dw-moodchips');
    const ptLine = sc.querySelector('.dw-ptline'), hint = sc.querySelector('.dw-hint');
    const monthB = sc.querySelector('.dw-monthbar b'), grid = sc.querySelector('.dw-cal'), stats = sc.querySelector('.dw-stats');
    const nextBtn = sc.querySelectorAll('.dw-monthbar .dw-icon')[1];
    const selD = parseISO(cal.sel), dayTxt = selD ? fmtShort(selD) : 'this day';

    seg.style.display = pair ? '' : 'none';
    seg.querySelector('[data-w="me"]').textContent = 'You';
    seg.querySelector('[data-w="pt"]').textContent = ptName();
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('is-on', b.dataset.w === cal.who));

    q.textContent = mine
      ? (cal.sel === tk ? 'How are you feeling today?' : `How did you feel on ${dayTxt}?`)
      : `${ptName()} on ${dayTxt}`;
    const cur = moodOf(rk, cal.sel);

    chips.replaceChildren();
    chips.style.display = mine ? '' : 'none';
    if (mine) {
      Object.entries(MOODS).forEach(([k, v]) => {
        const b = el('button', 'dw-mc' + (cur === k ? ' is-sel' : ''), `${v.e} ${k}`);
        b.type = 'button'; b.style.setProperty('--mc', v.c);
        b.onclick = () => setMood(cal.sel, cur === k ? null : k);
        chips.append(b);
      });
    }
    // the other person's mood for the selected day
    const other = mine ? moodOf(ptRk(), cal.sel) : cur;
    ptLine.style.display = (pair && (mine || true)) ? '' : 'none';
    if (pair) {
      if (mine) ptLine.textContent = other ? `${ptName()} felt ${MOODS[other].e} ${other}` : `${ptName()} hasn't logged this day`;
      else ptLine.textContent = cur ? `${MOODS[cur].e} ${cur}` : 'No mood logged this day';
      ptLine.classList.toggle('big', !mine);
    }
    hint.textContent = mine
      ? 'Tap a day to log or change its mood. Tap the same mood again to clear it.'
      : `Viewing ${ptName()}'s moods — only they can change them.`;

    monthB.textContent = new Date(cal.y, cal.m, 1).toLocaleDateString('en', { month: 'long', year: 'numeric' });
    const tD = parseISO(tk) || midnight();
    nextBtn.disabled = cal.y > tD.getFullYear() || (cal.y === tD.getFullYear() && cal.m >= tD.getMonth());
    nextBtn.style.opacity = nextBtn.disabled ? .3 : 1;

    grid.replaceChildren();
    ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach(h => grid.append(el('div', 'h', h)));
    const lead = (new Date(cal.y, cal.m, 1).getDay() + 6) % 7;
    const dim = new Date(cal.y, cal.m + 1, 0).getDate();
    for (let i = 0; i < lead; i++) grid.append(el('div', 'dw-cell is-blank'));
    const counts = {}; let total = 0;
    for (let d = 1; d <= dim; d++) {
      const key = `${cal.y}-${pad(cal.m + 1)}-${pad(d)}`;
      const mk = moodOf(rk, key);
      const b = el('button', 'dw-cell' + (key === tk ? ' is-today' : '') + (key === cal.sel ? ' is-sel' : '') + (key > tk ? ' is-future' : ''));
      b.type = 'button';
      const c = el('span', 'c' + (mk ? ' has' : ''), mk ? MOODS[mk].e : '');
      if (mk) { c.style.setProperty('--mc', MOODS[mk].c); counts[mk] = (counts[mk] || 0) + 1; total++; }
      b.append(el('span', 'n', String(d)), c);
      b.onclick = () => { cal.sel = key; renderCal(); };
      grid.append(b);
    }

    const monthName = new Date(cal.y, cal.m, 1).toLocaleDateString('en', { month: 'long' });
    stats.replaceChildren(el('div', 'dw-stats-n', String(total)), el('p', 'dw-stats-l', `mood${total === 1 ? '' : 's'} logged in ${monthName}${mine ? '' : ' by ' + ptName()}`));
    const row = el('div', 'dw-stat-row');
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => {
      const s = el('div', 'dw-stat'); s.style.setProperty('--mc', MOODS[k].c);
      s.append(el('i'), document.createTextNode(String(n) + ' '), el('span', '', k));
      row.append(s);
    });
    if (total) stats.append(row);
  }

  function openMood() {
    if (!stateOK()) return;
    if (!moodOv) moodOv = buildMoodOverlay();
    const t = parseISO(todayKey()) || midnight();
    cal.y = t.getFullYear(); cal.m = t.getMonth(); cal.sel = todayKey(); cal.who = 'me';
    renderCal();
    requestAnimationFrame(() => moodOv.classList.add('open'));
  }

  /* ───────────────────────── PHOTO EDITOR ───────────────────────── */
  const SLOTS = [
    ['idle', 'Idle', '/images/dashboard/idle.svg'],
    ['hug', 'Hug', '/images/dashboard/hug.svg'],
    ['touch', 'Touch', '/images/dashboard/touch.svg'],
    ['miss', 'Miss You', '/images/dashboard/miss.svg'],
  ];
  const OUT_W = 1280, OUT_H = 720, MAX_Z = 4;
  let photoOv = null, ph = null;
  const pending = {};                          // slot -> { url, img, nw, nh, z, x, y, W, H, base, file }
  let slot = 'idle', busy = false;

  function applyImages() {
    if (!stateOK()) return;
    SLOTS.forEach(([k, , def]) => {
      const img = document.querySelector(`#dhCard .dh-img[data-k="${k}"]`);
      const url = (S.dashImgs && S.dashImgs[k] && S.dashImgs[k].url) || def;
      if (img && img.getAttribute('src') !== url) img.setAttribute('src', url);
    });
  }
  const currentUrl = k => (S.dashImgs && S.dashImgs[k] && S.dashImgs[k].url) || SLOTS.find(s => s[0] === k)[2];

  function buildPhotoOverlay() {
    const ov = el('div', 'dw-overlay');
    ov.id = 'dwPhotoOv';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Change card photos');
    const panel = el('div', 'dw-panel');

    const bar = el('div', 'dw-bar');
    const close = el('button', 'dw-icon'); close.type = 'button'; close.innerHTML = ICON.close; close.setAttribute('aria-label', 'Close');
    close.onclick = () => closeOv(ov);
    const sp = el('span'); sp.style.width = '40px';
    bar.append(close, el('h2', '', 'Card photos'), sp);

    const sc = el('div', 'dw-scroll');
    const seg = el('div', 'dw-seg');
    const segBtns = {};
    SLOTS.forEach(([k, label]) => {
      const b = el('button', '', label); b.type = 'button';
      b.onclick = () => { if (!busy) { slot = k; refreshEditor(); } };
      segBtns[k] = b; seg.append(b);
    });

    const stage = el('div', 'dw-stage');
    const stat = el('img', 'static'); stat.alt = ''; stat.draggable = false;
    const crop = el('img', 'crop'); crop.alt = ''; crop.draggable = false; crop.style.display = 'none';
    stage.append(stat, crop, el('div', 'grid'), el('div', 'dw-badge', '16:9'));

    const hint = el('p', 'dw-hint');
    const zoom = el('div', 'dw-zoom');
    const zin = el('input'); zin.type = 'range'; zin.min = '100'; zin.max = String(MAX_Z * 100); zin.value = '100'; zin.setAttribute('aria-label', 'Zoom');
    const zi1 = el('span'); zi1.innerHTML = ICON.minus; const zi2 = el('span'); zi2.innerHTML = ICON.plus;
    zoom.append(zi1.firstChild, zin, zi2.firstChild);
    const reset = el('button', 'dw-reset', 'Use default picture'); reset.type = 'button'; reset.hidden = true;
    sc.append(seg, stage, hint, zoom, reset);

    const foot = el('div', 'dw-foot');
    const change = el('button', 'dw-btn'); change.type = 'button'; change.innerHTML = ICON.image + '<span>Change photo</span>';
    const saveB = el('button', 'dw-btn primary'); saveB.type = 'button'; saveB.innerHTML = ICON.check + '<span>Save</span>';
    foot.append(change, saveB);

    const file = el('input'); file.type = 'file'; file.accept = 'image/*'; file.style.display = 'none';
    panel.append(bar, sc, foot, file);
    ov.append(panel);
    ov.addEventListener('click', e => { if (e.target === ov) closeOv(ov); });
    document.body.append(ov);

    ph = { ov, segBtns, stage, stat, crop, hint, zoom, zin, reset, change, saveB, file };
    wireEditor();
    return ov;
  }

  function cur() { return pending[slot] || null; }
  function geom(p) { const r = ph.stage.getBoundingClientRect(); p.W = r.width; p.H = r.height; p.base = Math.max(p.W / p.nw, p.H / p.nh); }
  function clampP(p) {
    const s = p.base * p.z;
    p.x = Math.min(0, Math.max(p.W - p.nw * s, p.x));
    p.y = Math.min(0, Math.max(p.H - p.nh * s, p.y));
  }
  function paint(p) {
    const s = p.base * p.z;
    ph.crop.style.width = p.nw + 'px'; ph.crop.style.height = p.nh + 'px';
    ph.crop.style.transform = `translate(${p.x}px,${p.y}px) scale(${s})`;
    ph.zin.value = String(Math.round(p.z * 100));
  }
  function zoomAt(p, z, px, py) {
    z = Math.min(MAX_Z, Math.max(1, z));
    const so = p.base * p.z, ix = (px - p.x) / so, iy = (py - p.y) / so;
    p.z = z;
    const sn = p.base * p.z;
    p.x = px - ix * sn; p.y = py - iy * sn;
    clampP(p); paint(p);
  }

  function wireEditor() {
    const { stage, zin, file, change, saveB, reset } = ph;
    const ptrs = new Map(); let pinch = null;
    const rel = e => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

    stage.addEventListener('pointerdown', e => {
      if (!cur()) return;
      stage.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: cur().z }; }
    });
    stage.addEventListener('pointermove', e => {
      const p = cur(); if (!p || !ptrs.has(e.pointerId)) return;
      const prev = ptrs.get(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) {
        p.x += e.clientX - prev.x; p.y += e.clientY - prev.y;
        clampP(p); paint(p);
      } else if (ptrs.size === 2 && pinch) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const r = stage.getBoundingClientRect();
        zoomAt(p, pinch.z * d / pinch.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      }
    });
    const up = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('wheel', e => {
      const p = cur(); if (!p) return;
      e.preventDefault();
      const o = rel(e);
      zoomAt(p, p.z * Math.exp(-e.deltaY * 0.0015), o.x, o.y);
    }, { passive: false });
    zin.addEventListener('input', () => { const p = cur(); if (p) zoomAt(p, zin.value / 100, p.W / 2, p.H / 2); });

    change.onclick = () => { if (!busy) file.click(); };
    file.onchange = () => { const f = file.files && file.files[0]; file.value = ''; if (f) loadFile(f); };
    saveB.onclick = saveSlot;
    reset.onclick = resetSlot;
    window.addEventListener('resize', () => { const p = cur(); if (p && ph.ov.classList.contains('open')) { const s0 = p.base * p.z; geom(p); p.z = Math.max(1, Math.min(MAX_Z, s0 / p.base)); clampP(p); paint(p); } });
  }

  function loadFile(f) {
    if (!/^image\//.test(f.type)) { say('Please choose an image'); return; }
    if (f.size > 30 * 1024 * 1024) { say('That photo is too large (max 30 MB)'); return; }
    const url = URL.createObjectURL(f), img = new Image();
    img.onload = () => {
      if (pending[slot]) URL.revokeObjectURL(pending[slot].url);
      const p = { url, img, nw: img.naturalWidth, nh: img.naturalHeight, z: 1, x: 0, y: 0 };
      pending[slot] = p;
      ph.crop.src = url;
      refreshEditor();                                    // makes crop visible so geom() can measure the stage
      geom(p);
      p.x = (p.W - p.nw * p.base) / 2; p.y = (p.H - p.nh * p.base) / 2;
      clampP(p); paint(p);
    };
    img.onerror = () => { URL.revokeObjectURL(url); say("Couldn't open that image"); };
    img.src = url;
  }

  function refreshEditor() {
    if (!ph) return;
    SLOTS.forEach(([k]) => ph.segBtns[k].classList.toggle('is-on', k === slot));
    const p = cur();
    ph.stage.classList.toggle('is-crop', !!p);
    ph.crop.style.display = p ? 'block' : 'none';
    if (p) { ph.crop.src = p.url; geom(p); clampP(p); paint(p); }
    ph.stat.style.display = p ? 'none' : 'block';
    ph.stat.src = currentUrl(slot);
    ph.zoom.classList.toggle('on', !!p);
    ph.hint.textContent = p ? 'Drag to move · pinch or use the slider to zoom' : 'Tap “Change photo” to pick a new picture for this card';
    ph.saveB.disabled = !p || busy;
    ph.change.disabled = busy;
    ph.reset.hidden = !!p || !(S.dashImgs && S.dashImgs[slot]);
  }

  async function saveSlot() {
    const p = cur();
    if (!p || busy) return;
    if (typeof uploadMediaFile !== 'function' || !S.coupleId) { say('Please sign in to save photos'); return; }
    busy = true; refreshEditor();
    const label = ph.saveB.querySelector('span'); label.textContent = 'Saving…';
    try {
      const s = p.base * p.z;
      const c = document.createElement('canvas'); c.width = OUT_W; c.height = OUT_H;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(p.img, -p.x / s, -p.y / s, p.W / s, p.H / s, 0, 0, OUT_W, OUT_H);
      const blob = await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Could not process the image')), 'image/jpeg', 0.88));
      const up = await uploadMediaFile(blob, `dashboard-${slot}.jpg`, 'image');
      const old = S.dashImgs && S.dashImgs[slot];
      if (!S.dashImgs) S.dashImgs = {};
      S.dashImgs[slot] = { url: up.url, path: up.path || '' };
      save();
      deleteOld(old);
      URL.revokeObjectURL(p.url); delete pending[slot];
      applyImages();
      say('Photo saved 💕');
    } catch (err) {
      say(err && err.message ? err.message : 'Could not save the photo');
    } finally {
      busy = false; label.textContent = 'Save'; refreshEditor();
    }
  }

  function deleteOld(old) {
    if (!old || !old.path || typeof API === 'undefined') return;
    try {
      fetch(API + '/api/media/delete', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: old.path, coupleId: S.coupleId }) }).catch(() => {});
    } catch (_) { /* best effort */ }
  }

  function resetSlot() {
    const old = S.dashImgs && S.dashImgs[slot];
    if (!old) return;
    delete S.dashImgs[slot];
    save(); deleteOld(old); applyImages(); refreshEditor();
    say('Back to the default picture');
  }

  function openPhotos(which) {
    if (!stateOK()) return;
    if (!photoOv) photoOv = buildPhotoOverlay();
    slot = SLOTS.some(s => s[0] === which) ? which : 'idle';
    photoOv.classList.add('open');
    requestAnimationFrame(refreshEditor);
  }

  /* ───────────────────────── shared ───────────────────────── */
  function closeOv(ov) { ov.classList.remove('open'); }
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const o = document.querySelector('.dw-overlay.open');
    if (o) closeOv(o);
  });

  /* ───────────────────────── ALL PAGES + QUOTE ───────────────────────── */
  const PAGES = [
    ['chat', '💬', 'Chat'], ['map', '📍', 'Live Map'], ['ai', '🤖', 'Twin'], ['lovecounter', '❤️', 'Love Counter'],
    ['profile', '💑', 'Profile'], ['level', '🏆', 'Level'], ['fights', '🥊', 'Fight Log'], ['globe', '🌍', 'Globe'],
    ['places', '📌', 'Places'], ['collection', '🎁', 'Collection'], ['capsule', '💌', 'Capsule'], ['surprise', '🎉', 'Surprises'],
    ['money', '💰', 'Money'], ['games', '🎮', 'Games'], ['study', '📚', 'Study'], ['dreamgoals', '🎯', 'Dream Goals'],
    ['dreamhome', '🏡', 'Dream Home'], ['virtualhome', '🏠', '3D Home'], ['myspace', '🌸', 'My Space'], ['period', '🌙', 'Period'],
    ['vault', '🔒', 'Vault'], ['settings', '⚙️', 'Settings'],
  ];
  const FOOT_QUOTES = [
    'Love is not about how many miles are between us, but how close we stay in our hearts.',
    'The best part of my day is the moment I get to talk to you.',
    'Distance is just a test of how far love can travel.',
    'Every “good morning” from you makes the day softer.',
    'Waiting for you is hard, but you are worth every day of it.',
    'Two places, one heart.',
    'I carry you with me, wherever the map says I am.',
    'Small moments with you become my favourite memories.',
    'Love grows quietly, one message at a time.',
    'Somewhere between hello and goodnight, I fall for you again.',
  ];

  function renderPages() {
    const g = $('dwPages');
    if (!g || g.childElementCount) return;               // static list — build once
    PAGES.forEach(([page, emoji, label]) => {
      const b = el('button', 'dw-page'); b.type = 'button';
      b.append(el('span', 'e', emoji), el('span', 'l', label));
      b.onclick = () => goto(page);
      g.append(b);
    });
  }
  function renderQuote() {
    const q = $('dwQuote');
    if (!q) return;
    const day = Math.floor(Date.now() / 86400000);
    q.textContent = FOOT_QUOTES[(day * 3 + 1) % FOOT_QUOTES.length];   // offset so it differs from the hero quote
  }

  /* ───────────────────────── public ───────────────────────── */
  function render() {
    if (!stateOK()) return;
    applyImages();
    renderEvents();
    renderMood();
    renderPages();
    renderQuote();
  }

  function init() {
    hookLegacy();
    const edit = $('dhEditBtn'); if (edit) edit.onclick = () => openPhotos(photoSlotForCard());
    const mood = $('dwMood'); if (mood) mood.onclick = openMood;
    const ml = $('dwMoodLink'); if (ml) ml.onclick = openMood;
    // keep "in N days" / streak fresh across midnight while the tab stays open
    setInterval(() => { if (!document.hidden) render(); }, 5 * 60 * 1000);
  }
  function photoSlotForCard() {
    const on = document.querySelector('#dhCard .dh-img.is-on');
    return on ? on.dataset.k : 'idle';
  }

  return { render, init, openMood, openPhotos };
})();

window.DashWidgets = DashWidgets;
(function autoInit() {
  const go = () => { DashWidgets.init(); DashWidgets.render(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
