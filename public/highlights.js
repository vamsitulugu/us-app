/* ══════════════════════════════════════════════════════════════
   PROFILE HIGHLIGHTS — Instagram-style circles under the couple card.
   Styles: /highlights.css · API: /api/highlights (routes/highlights.js)

   • "+" circle  → Record video (camera) or Upload from device
   • then choose: New highlight (name + category) or Add to an existing one
   • tap a circle → full-screen story viewer (tap sides, hold to pause)
   • owner can edit name/category, add clips, delete a clip or the highlight
   Uses the app globals: S, API, api(), esc(), toast().
   ══════════════════════════════════════════════════════════════ */
'use strict';
(function () {
  const $ = id => document.getElementById(id);

  const CATS = [
    ['travel', 'Travel', '✈️'], ['love', 'Love', '💕'], ['dates', 'Date Nights', '🍷'],
    ['friends', 'Friends', '👯'], ['family', 'Family', '👨‍👩‍👧'], ['food', 'Food', '🍕'],
    ['events', 'Events', '🎉'], ['fun', 'Fun', '😂'], ['other', 'Other', '✨']
  ];
  const catOf = k => CATS.find(c => c[0] === k) || CATS[CATS.length - 1];
  const MAX_BYTES = 150 * 1024 * 1024;   // same ceiling as the server
  const MAX_PICK = 10;                   // clips per upload
  const IMG_MS = 5000;                   // how long a photo stays on screen

  const P = {
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    video: '<path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    more: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>'
  };
  const ico = n => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + P[n] + '</svg>';

  let groups = null;          // null = not loaded yet
  let phase = 'idle';         // idle | loading | error
  const filters = { mine: 'all', partner: 'all' };   // category chip selected in each row
  const MOUNTS = [['pfHl', 'mine'], ['pfHlPartner', 'partner']];   // where the rows live: my row on Our Profile, my partner's row on their profile screen
  let loadSeq = 0;

  const mineRole = () => S.role || 'user1';
  const isMine = g => g.user_id === mineRole();
  const ownerName = g => isMine(g) ? (S.myName && S.myName !== 'You' ? S.myName : 'You') : (S.partnerName || 'Partner');
  const fmtWhen = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };
  const errMsg = e => (e && e.message) || 'Something went wrong';

  /* ── Data ── */
  async function load() {
    if (!S.coupleId) { groups = []; phase = 'idle'; paint(); return; }
    const seq = ++loadSeq;
    if (groups === null) phase = 'loading';
    paint();
    try {
      const data = await api('GET', '/api/highlights/' + encodeURIComponent(S.coupleId));
      if (seq !== loadSeq) return;
      groups = Array.isArray(data) ? data : [];
      phase = 'idle';
    } catch (e) {
      if (seq !== loadSeq) return;
      phase = groups === null ? 'error' : 'idle';   // keep what we already show if a refresh fails
      if (groups === null) groups = [];
    }
    paint();
  }

  /* ── Circles row ── */
  function coverHtml(g) {
    const it = (g.items || [])[0];
    if (!it) return '<span style="font-size:26px">' + catOf(g.category)[2] + '</span>';
    return it.media_type === 'video'
      ? '<video src="' + esc(it.media_url) + '#t=0.1" muted playsinline preload="metadata"></video>'
      : '<img src="' + esc(it.media_url) + '" alt="" loading="lazy" decoding="async">';
  }

  // Highlights shown in one row: only mine, or only my partner's.
  const ownedBy = who => (groups || []).filter(g => (g.items || []).length && isMine(g) === (who === 'mine'));
  const visible = who => ownedBy(who).filter(g => filters[who] === 'all' || g.category === filters[who]);

  function paint() { MOUNTS.forEach(([id, who]) => paintRow($(id), who)); }

  function paintRow(root, who) {
    if (!root) return;
    root.classList.add('pfh'); root.dataset.who = who;
    const own = who === 'mine';
    const used = [...new Set(ownedBy(who).map(g => g.category))];
    if (filters[who] !== 'all' && !used.includes(filters[who])) filters[who] = 'all';
    const filter = filters[who];

    const chips = used.length >= 2
      ? '<div class="pfh-chips" role="tablist" aria-label="Highlight categories">' +
        '<button type="button" class="pfh-chip' + (filter === 'all' ? ' is-on' : '') + '" data-hl="filter:all">All</button>' +
        CATS.filter(c => used.includes(c[0])).map(c =>
          '<button type="button" class="pfh-chip' + (filter === c[0] ? ' is-on' : '') + '" data-hl="filter:' + c[0] + '">' + c[2] + ' ' + c[1] + '</button>').join('') +
        '</div>'
      : '';

    // Only my own row has the "+" circle; my partner's highlights are watch-only.
    const add = own ? '<button type="button" class="pfh-it pfh-new" data-hl="new" aria-label="New highlight"><span class="pfh-ring"><span class="pfh-in">' + ico('plus') + '</span></span><span class="pfh-lab">New</span></button>' : '';
    let body;
    if (phase === 'loading') {
      body = [1, 2, 3].map(() => '<div class="pfh-it pfh-skel" aria-hidden="true"><span class="pfh-ring"></span><span class="pfh-lab"></span></div>').join('');
    } else {
      body = visible(who).map(g =>
        '<button type="button" class="pfh-it' + (isMine(g) ? '' : ' is-partner') + '" data-hl="open:' + esc(g.id) + '" data-own="' + (isMine(g) ? '1' : '0') + '" aria-label="' + esc(g.title) + ' highlight">' +
        '<span class="pfh-ring"><span class="pfh-in">' + coverHtml(g) + '</span><span class="pfh-badge">' + catOf(g.category)[2] + '</span></span>' +
        '<span class="pfh-lab">' + esc(g.title) + '</span></button>').join('');
    }
    const empty = phase === 'idle' && groups && !ownedBy(who).length;
    const note = phase === 'error'
      ? '<p class="pfh-msg">Couldn’t load highlights. <button type="button" data-hl="retry">Try again</button></p>'
      : (empty ? '<p class="pfh-msg">' + (own
        ? 'Keep your favourite moments here — tap + to add a video or photo.'
        : esc(S.partnerName || 'Your partner') + ' hasn’t added any highlights yet.') + '</p>' : '');
    root.innerHTML = chips + (add || body ? '<div class="pfh-row">' + add + body + '</div>' : '') + note;
  }

  /* ── Sheets ── */
  let sheetBusy = false;
  let sheetCleanup = null;
  function sheetEl() {
    let bg = $('pfhSheet');
    if (!bg) {
      bg = document.createElement('div');
      bg.id = 'pfhSheet'; bg.className = 'modal-bg pf-sheet-bg';
      document.body.appendChild(bg);
      bg.addEventListener('click', e => { if (e.target === bg && !sheetBusy) closeSheet(); });
    }
    return bg;
  }
  function openSheet(html) {
    const bg = sheetEl();
    bg.innerHTML = '<div class="modal pf-sheet" role="dialog" aria-modal="true"><div class="pf-grab"></div>' + html + '</div>';
    bg.classList.add('open');
    return bg.firstChild;
  }
  function closeSheet() {
    const bg = $('pfhSheet'); if (bg) bg.classList.remove('open');
    sheetBusy = false;
    if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; }
  }
  const sheetTitle = t => '<div class="pfh-sheet-t"><span>' + t + '</span><button type="button" data-close aria-label="Close">' + ico('x') + '</button></div>';

  const catChips = sel => '<div class="pfh-cats">' + CATS.map(c =>
    '<button type="button" class="pfh-cat' + (c[0] === sel ? ' is-on' : '') + '" data-cat="' + c[0] + '">' + c[2] + ' ' + c[1] + '</button>').join('') + '</div>';

  function wireCats(root, onPick) {
    root.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => {
      root.querySelectorAll('[data-cat]').forEach(x => x.classList.toggle('is-on', x === b));
      onPick(b.dataset.cat);
    }));
  }

  /* Step 1 — where do the clips come from? */
  function openSource(preGroupId) {
    const m = openSheet(sheetTitle(preGroupId ? 'Add to highlight' : 'New highlight') +
      '<div class="pfh-src">' +
        '<button type="button" data-src="record">' + ico('video') + 'Record video</button>' +
        '<button type="button" data-src="upload">' + ico('image') + 'Upload from device</button>' +
      '</div>');
    m.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) return closeSheet();
      const b = e.target.closest('[data-src]'); if (!b) return;
      pickFiles(b.dataset.src === 'record', preGroupId);
    });
  }

  // The file input must be clicked inside the tap that started it, so it is created here, not later.
  function pickFiles(record, preGroupId) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = record ? 'video/*' : 'image/*,video/*';
    if (record) inp.setAttribute('capture', 'environment');
    else inp.multiple = true;
    inp.onchange = () => { const f = Array.from(inp.files || []); if (f.length) handleFiles(f, preGroupId); };
    inp.click();
  }

  function handleFiles(files, preGroupId) {
    const ok = [];
    let tooBig = 0, wrong = 0;
    files.forEach(f => {
      if (!/^(image|video)\//i.test(f.type)) wrong++;
      else if (f.size > MAX_BYTES) tooBig++;
      else ok.push(f);
    });
    if (files.length > MAX_PICK) toast('Only the first ' + MAX_PICK + ' clips were added');
    if (!ok.length) { toast(tooBig ? 'That file is too large (150 MB max)' : 'Please choose a photo or a video'); return; }
    if (tooBig || wrong) toast('Some files were skipped');
    openAdd(ok.slice(0, MAX_PICK), preGroupId);
  }

  /* Step 2 — new highlight or add to an existing one */
  function videoSeconds(file) {
    return new Promise(resolve => {
      if (!/^video\//i.test(file.type)) return resolve(0);
      const v = document.createElement('video'), url = URL.createObjectURL(file);
      const done = n => { URL.revokeObjectURL(url); resolve(Number.isFinite(n) ? Math.round(n) : 0); };
      v.preload = 'metadata'; v.onloadedmetadata = () => done(v.duration); v.onerror = () => done(0);
      setTimeout(() => done(0), 3000);
      v.src = url;
    });
  }

  function openAdd(files, preGroupId) {
    const mine = (groups || []).filter(g => isMine(g) && (g.items || []).length);
    const urls = files.map(f => URL.createObjectURL(f));
    let mode = preGroupId && mine.some(g => g.id === preGroupId) ? 'existing' : 'new';
    let cat = 'love', gid = mode === 'existing' ? preGroupId : (mine[0] && mine[0].id) || null;

    const prev = '<div class="pfh-prev">' + files.map((f, i) =>
      '<div>' + (/^video\//i.test(f.type) ? '<video src="' + urls[i] + '#t=0.1" muted playsinline preload="metadata"></video><span>🎬</span>' : '<img src="' + urls[i] + '" alt="">') + '</div>').join('') + '</div>';
    const existing = mine.length
      ? '<div class="pfh-list">' + mine.map(g =>
        '<button type="button" class="pfh-opt' + (g.id === gid ? ' is-on' : '') + '" data-gid="' + esc(g.id) + '"><span class="pfh-mini">' + coverHtml(g) + '</span><span><b>' + esc(g.title) + '</b><small>' + catOf(g.category)[2] + ' ' + catOf(g.category)[1] + ' · ' + g.items.length + (g.items.length === 1 ? ' clip' : ' clips') + '</small></span></button>').join('') + '</div>'
      : '';

    const m = openSheet(sheetTitle(files.length === 1 ? '1 clip ready' : files.length + ' clips ready') + prev +
      '<div class="pfh-seg"><button type="button" data-mode="new">New highlight</button><button type="button" data-mode="existing"' + (mine.length ? '' : ' disabled') + '>Add to existing</button></div>' +
      '<div data-pane="new"><label class="pfh-lbl" for="pfhName">Name</label>' +
        '<input type="text" id="pfhName" maxlength="24" placeholder="e.g. Goa trip" autocomplete="off" style="width:100%;margin-bottom:14px">' +
        '<span class="pfh-lbl">Category</span>' + catChips(cat) + '</div>' +
      '<div data-pane="existing" hidden>' + existing + '</div>' +
      '<div class="pfh-bar" data-bar hidden><i></i></div><p class="pfh-err" data-err hidden></p>' +
      '<button type="button" class="btn btn-accent" data-go style="width:100%;justify-content:center">Add to highlights</button>');
    sheetCleanup = () => urls.forEach(u => URL.revokeObjectURL(u));

    const go = m.querySelector('[data-go]'), err = m.querySelector('[data-err]'), bar = m.querySelector('[data-bar]');
    const showMode = () => {
      m.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('is-on', b.dataset.mode === mode));
      m.querySelector('[data-pane="new"]').hidden = mode !== 'new';
      m.querySelector('[data-pane="existing"]').hidden = mode !== 'existing';
    };
    showMode();
    wireCats(m, c => { cat = c; });
    m.addEventListener('click', e => {
      if (sheetBusy) return;
      if (e.target.closest('[data-close]')) return closeSheet();
      const md = e.target.closest('[data-mode]');
      if (md && !md.disabled) { mode = md.dataset.mode; showMode(); }
      const g = e.target.closest('[data-gid]');
      if (g) { gid = g.dataset.gid; m.querySelectorAll('[data-gid]').forEach(x => x.classList.toggle('is-on', x === g)); }
    });

    go.addEventListener('click', async () => {
      if (sheetBusy) return;
      if (mode === 'existing' && !gid) { err.textContent = 'Choose a highlight first'; err.hidden = false; return; }
      const title = (m.querySelector('#pfhName').value || '').trim() || catOf(cat)[1];
      sheetBusy = true; go.disabled = true; err.hidden = true; bar.hidden = false;
      const fill = bar.firstChild, total = files.length;
      let done = 0, target = mode === 'existing' ? gid : null;
      try {
        while (files.length) {
          const f = files[0];
          const fd = new FormData();
          fd.append('coupleId', S.coupleId); fd.append('userId', mineRole());
          fd.append('durationSec', String(await videoSeconds(f)));
          if (target) fd.append('highlightId', target); else { fd.append('title', title); fd.append('category', cat); }
          fd.append('file', f, f.name || 'clip');
          const res = await postClip(fd, p => { fill.style.width = Math.round(((done + p) / total) * 100) + '%'; });
          if (!target && res.highlight) target = res.highlight.id;   // the rest of the clips join the highlight just created
          files.shift(); done++;
        }
        closeSheet();
        toast('Highlight saved 💕');
        await load();
      } catch (e) {
        sheetBusy = false; go.disabled = false;
        err.textContent = (done ? done + ' of ' + total + ' added. ' : '') + errMsg(e) + ' — tap to try again.'; err.hidden = false;
        if (target && mode === 'new') { mode = 'existing'; gid = target; }   // retry continues in the same highlight
        if (done) load();
      }
    });
  }

  function postClip(fd, onProgress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', API + '/api/highlights/upload');
      x.timeout = 10 * 60e3;
      x.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      x.onload = () => {
        let d = {}; try { d = JSON.parse(x.responseText); } catch (_) {}
        if (x.status >= 200 && x.status < 300) resolve(d); else reject(new Error(d.error || 'Upload failed'));
      };
      x.onerror = () => reject(new Error('No connection'));
      x.ontimeout = () => reject(new Error('Upload timed out'));
      x.send(fd);
    });
  }

  /* ── Edit / delete ── */
  function openEdit(g) {
    let cat = g.category;
    const m = openSheet(sheetTitle('Edit highlight') +
      '<label class="pfh-lbl" for="pfhEName">Name</label>' +
      '<input type="text" id="pfhEName" maxlength="24" value="' + esc(g.title) + '" autocomplete="off" style="width:100%;margin-bottom:14px">' +
      '<span class="pfh-lbl">Category</span>' + catChips(cat) +
      '<p class="pfh-err" data-err hidden></p>' +
      '<button type="button" class="btn btn-accent" data-save style="width:100%;justify-content:center">Save</button>');
    wireCats(m, c => { cat = c; });
    m.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });
    const save = m.querySelector('[data-save]'), err = m.querySelector('[data-err]');
    save.addEventListener('click', async () => {
      const title = (m.querySelector('#pfhEName').value || '').trim();
      if (!title) { err.textContent = 'Please give it a name'; err.hidden = false; return; }
      save.disabled = true; sheetBusy = true; err.hidden = true;
      try {
        const row = await api('PATCH', '/api/highlights/' + encodeURIComponent(g.id), { coupleId: S.coupleId, userId: mineRole(), title, category: cat });
        g.title = row.title; g.category = row.category;
        sheetBusy = false; closeSheet(); toast('Saved 💕');
        paint(); if (V.g === g) renderViewerHead();
      } catch (e) { sheetBusy = false; save.disabled = false; err.textContent = errMsg(e); err.hidden = false; }
    });
  }

  function openConfirm(title, message, label, run) {
    const m = openSheet(sheetTitle(esc(title)) + '<p style="color:var(--text2);font-size:14px;line-height:1.5;margin:0 0 16px">' + esc(message) + '</p>' +
      '<p class="pfh-err" data-err hidden></p>' +
      '<div class="pfh-menu"><button type="button" class="pfh-danger" data-ok>' + esc(label) + '</button><button type="button" data-close>Cancel</button></div>');
    const ok = m.querySelector('[data-ok]'), err = m.querySelector('[data-err]');
    m.addEventListener('click', e => { if (e.target.closest('[data-close]') && !sheetBusy) closeSheet(); });
    ok.addEventListener('click', async () => {
      ok.disabled = true; sheetBusy = true; err.hidden = true;
      try { await run(); sheetBusy = false; closeSheet(); }
      catch (e) { sheetBusy = false; ok.disabled = false; err.textContent = errMsg(e); err.hidden = false; }
    });
  }

  async function deleteHighlight(g) {
    await api('DELETE', '/api/highlights/' + encodeURIComponent(g.id), { coupleId: S.coupleId, userId: mineRole() });
    groups = groups.filter(x => x !== g);
    closeViewer(); paint(); toast('Highlight deleted');
  }
  async function deleteClip(g, it) {
    const r = await api('DELETE', '/api/highlights/item/' + encodeURIComponent(it.id), { coupleId: S.coupleId, userId: mineRole() });
    g.items = g.items.filter(x => x !== it);
    if (r.highlightDeleted || !g.items.length) { groups = groups.filter(x => x !== g); closeViewer(); }
    else showClip(Math.min(V.i, g.items.length - 1));
    paint(); toast('Clip deleted');
  }

  function openOwnerMenu(g) {
    pauseViewer(true);
    const it = g.items[V.i];
    const m = openSheet(sheetTitle(esc(g.title)) +
      '<div class="pfh-menu"><button type="button" data-a="edit">Edit name &amp; category</button>' +
      '<button type="button" data-a="add">Add more clips</button>' +
      '<button type="button" class="pfh-danger" data-a="clip">Delete this clip</button>' +
      '<button type="button" class="pfh-danger" data-a="all">Delete highlight</button></div>');
    sheetCleanup = () => pauseViewer(false);
    m.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) return closeSheet();
      const a = e.target.closest('[data-a]'); if (!a) return;
      const act = a.dataset.a;
      if (act === 'edit') openEdit(g);
      else if (act === 'add') { closeViewer(); closeSheet(); openSource(g.id); }
      else if (act === 'clip') openConfirm('Delete this clip?', 'It will be removed from “' + g.title + '” for both of you.', 'Delete clip', () => deleteClip(g, it));
      else openConfirm('Delete highlight?', '“' + g.title + '” and all ' + g.items.length + (g.items.length === 1 ? ' clip' : ' clips') + ' will be removed for both of you.', 'Delete highlight', () => deleteHighlight(g));
    });
  }

  /* ── Full-screen viewer ── */
  const V = { g: null, i: 0, el: null, media: null, raf: 0, paused: false, menuPause: false, held: false, holdT: 0, elapsed: 0, last: 0, dur: IMG_MS };

  function buildViewer() {
    if (V.el) return;
    const el = document.createElement('div');
    el.className = 'pfh-v'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.innerHTML = '<div class="pfh-stage"><div data-media></div><div class="pfh-spin" data-spin hidden></div>' +
      '<div class="pfh-top"><div class="pfh-segs" data-segs></div><div class="pfh-head"><span class="pfh-mini" data-mini></span>' +
      '<span class="pfh-who"><b data-title></b><span data-sub></span></span>' +
      '<button type="button" data-v="menu" aria-label="More" hidden>' + ico('more') + '</button>' +
      '<button type="button" data-v="close" aria-label="Close">' + ico('x') + '</button></div></div>' +
      '<button type="button" class="pfh-tap l" data-tap="prev" aria-label="Previous"></button>' +
      '<button type="button" class="pfh-tap r" data-tap="next" aria-label="Next"></button></div>';
    document.body.appendChild(el);
    V.el = el;
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-v]'); if (!b) return;
      if (b.dataset.v === 'close') closeViewer(); else if (V.g) openOwnerMenu(V.g);
    });
    el.querySelectorAll('[data-tap]').forEach(z => {
      z.addEventListener('pointerdown', () => { V.held = false; clearTimeout(V.holdT); V.holdT = setTimeout(() => { V.held = true; pauseViewer(true); }, 220); });
      const up = cancel => {
        clearTimeout(V.holdT);
        if (V.held) { V.held = false; pauseViewer(false); return; }
        if (cancel) return;
        z.dataset.tap === 'next' ? nextClip() : prevClip();
      };
      z.addEventListener('pointerup', () => up(false));
      z.addEventListener('pointercancel', () => up(true));
      z.addEventListener('pointerleave', () => { if (V.held) up(true); });
      z.addEventListener('contextmenu', e => e.preventDefault());
    });
    document.addEventListener('keydown', e => {
      if (!V.g || V.el.hidden || $('pfhSheet')?.classList.contains('open')) return;
      if (e.key === 'Escape') closeViewer(); else if (e.key === 'ArrowRight') nextClip(); else if (e.key === 'ArrowLeft') prevClip();
    });
  }

  function openViewer(id) {
    const g = (groups || []).find(x => x.id === id);
    if (!g || !g.items.length) return;
    buildViewer();
    V.g = g; V.el.hidden = false;
    V.el.querySelector('[data-v="menu"]').hidden = !isMine(g);
    renderViewerHead();
    showClip(0);
  }
  function closeViewer() {
    if (!V.el) return;
    cancelAnimationFrame(V.raf); clearTimeout(V.holdT);
    stopMedia(); V.g = null; V.el.hidden = true;
  }
  function renderViewerHead() {
    if (!V.g) return;
    const g = V.g, it = g.items[V.i] || g.items[0];
    V.el.querySelector('[data-title]').textContent = g.title;
    V.el.querySelector('[data-sub]').textContent = catOf(g.category)[2] + ' ' + ownerName(g) + (it ? ' · ' + fmtWhen(it.created_at) : '');
    V.el.querySelector('[data-mini]').innerHTML = coverHtml(g);
  }
  function stopMedia() {
    const v = V.media;
    if (v && v.tagName === 'VIDEO') { try { v.pause(); } catch (_) {} v.removeAttribute('src'); v.load(); }
    V.media = null;
    if (V.el) V.el.querySelector('[data-media]').innerHTML = '';
  }

  function setSeg(frac) {
    const segs = V.el.querySelectorAll('[data-segs] i');
    segs.forEach((s, n) => { if (n === V.i) s.firstChild.style.width = Math.round(frac * 100) + '%'; });
  }

  function showClip(i) {
    const g = V.g; if (!g) return;
    cancelAnimationFrame(V.raf); stopMedia();
    V.i = i; V.paused = false; V.elapsed = 0;
    V.el.querySelector('[data-segs]').innerHTML = g.items.map((_, n) => '<i class="' + (n < i ? 'done' : '') + '"><b></b></i>').join('');
    renderViewerHead();
    const it = g.items[i], host = V.el.querySelector('[data-media]'), spin = V.el.querySelector('[data-spin]');
    spin.hidden = false;
    if (it.media_type === 'video') {
      const v = document.createElement('video');
      v.playsInline = true; v.autoplay = true; v.preload = 'auto'; v.src = it.media_url;
      v.onplaying = () => { spin.hidden = true; };
      v.onwaiting = () => { spin.hidden = false; };
      v.ontimeupdate = () => { if (v.duration) setSeg(v.currentTime / v.duration); };
      v.onended = nextClip;
      v.onerror = () => failClip(host, spin);
      host.appendChild(v); V.media = v;
      const p = v.play();
      if (p && p.catch) p.catch(() => { v.muted = true; v.play().catch(() => {}); });   // browser blocked sound → play muted
    } else {
      const img = document.createElement('img');
      img.alt = '';
      img.onload = () => { spin.hidden = true; V.last = performance.now(); tickImage(); };
      img.onerror = () => failClip(host, spin);
      img.src = it.media_url;
      host.appendChild(img); V.media = img;
    }
  }
  function failClip(host, spin) {
    spin.hidden = true;
    host.innerHTML = '<div class="pfh-vmsg">Couldn’t play this clip.<br>Tap right to skip.</div>';
  }
  function tickImage() {
    cancelAnimationFrame(V.raf);
    const step = now => {
      if (!V.g || !V.media || V.media.tagName !== 'IMG') return;
      if (!V.paused) V.elapsed += now - V.last;
      V.last = now;
      setSeg(Math.min(1, V.elapsed / IMG_MS));
      if (V.elapsed >= IMG_MS) return nextClip();
      V.raf = requestAnimationFrame(step);
    };
    V.raf = requestAnimationFrame(step);
  }
  function pauseViewer(on) {
    V.paused = on;
    const v = V.media;
    if (v && v.tagName === 'VIDEO') { if (on) v.pause(); else v.play().catch(() => {}); }
    else if (!on) V.last = performance.now();
  }
  function nextClip() { if (!V.g) return; if (V.i + 1 < V.g.items.length) showClip(V.i + 1); else closeViewer(); }
  function prevClip() { if (V.g) showClip(Math.max(0, V.i - 1)); }

  /* ── Row interactions (tap, long-press to edit your own) ── */
  let pressT = 0, pressed = false;
  function wireRow(root) {
    if (!root || root.dataset.wired) return;
    root.dataset.wired = '1';
    root.addEventListener('pointerdown', e => {
      const it = e.target.closest('[data-own="1"]'); if (!it) return;
      pressed = false; clearTimeout(pressT);
      pressT = setTimeout(() => { pressed = true; const g = (groups || []).find(x => x.id === it.dataset.hl.slice(5)); if (g) openEdit(g); }, 550);
    });
    ['pointerup', 'pointercancel', 'pointerleave', 'pointermove'].forEach(t => root.addEventListener(t, () => clearTimeout(pressT)));
    root.addEventListener('contextmenu', e => { if (e.target.closest('[data-own]')) e.preventDefault(); });
    root.addEventListener('click', e => {
      if (pressed) { pressed = false; return; }
      const el = e.target.closest('[data-hl]'); if (!el) return;
      const s = el.dataset.hl, i = s.indexOf(':'), act = i < 0 ? s : s.slice(0, i), arg = i < 0 ? '' : s.slice(i + 1);
      if (act === 'new') openSource(null);
      else if (act === 'open') openViewer(arg);
      else if (act === 'filter') { filters[root.dataset.who || 'mine'] = arg; paint(); }
      else if (act === 'retry') load();
    });
  }

  function render() { MOUNTS.forEach(([id]) => wireRow($(id))); paint(); load(); }
  window.Highlights = { render, refresh: load };
})();
