/* public/movie.js — "Watch Together" V2
   Loaded inside an iframe from index.html (same pattern as music.html /
   games.html). The movie file itself NEVER leaves this device — only
   tiny JSON room state goes through the API + Supabase Realtime.

   STATE MACHINE (single source of truth — UI is a pure function of this):
   SETUP → START_REQUESTED (mine) → COUNTDOWN → WATCHING → ENDED
   The invited partner sees an INVITATION modal layered on SETUP, then
   also moves to COUNTDOWN once they accept.
*/
(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════
  // SECTION 1 — Couple/session context (same pattern as music.html)
  // ═══════════════════════════════════════════════════════
  const API = (function () {
    try { return window.parent.API || 'https://us-app-av6d.onrender.com'; }
    catch (e) { return 'https://us-app-av6d.onrender.com'; }
  })();

  function getCtx() {
    try {
      const s = window.parent.S;
      if (s && s.coupleId) {
        return { coupleId: s.coupleId, role: s.role || 'user1', myName: s.myName || 'You', partnerName: s.partnerName || 'Partner' };
      }
    } catch (e) {}
    try {
      const raw = localStorage.getItem('uwl_v5');
      if (raw) {
        const d = JSON.parse(raw);
        if (d.coupleId) return { coupleId: d.coupleId, role: d.role || 'user1', myName: d.myName || 'You', partnerName: d.partnerName || 'Partner' };
      }
    } catch (e) {}
    return null;
  }

  const ctx = getCtx();
  const ROLE = ctx ? ctx.role : 'user1';
  const OTHER_ROLE = ROLE === 'user1' ? 'user2' : 'user1';
  const COUPLE_ID = ctx ? ctx.coupleId : null;

  async function api(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(API + '/api/movie' + path, opts);
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error((data && data.error) || 'Request failed');
    return data;
  }

  // ═══════════════════════════════════════════════════════
  // Clock sync — see root-cause note on serverNow() below. offsetMs is
  // (serverClock - myDeviceClock); add it to Date.now() to get an estimate
  // of the CURRENT shared server time, which both devices agree on
  // (unlike each device's own Date.now(), which can differ by 1-2s+).
  // ═══════════════════════════════════════════════════════
  let clockOffsetMs = 0;
  let clockSynced = false;
  async function syncClockOnce() {
    const t0 = Date.now();
    let r;
    try { r = await fetch(API + '/api/movie/time'); } catch (e) { return null; }
    const t1 = Date.now();
    const rtt = t1 - t0;
    let body;
    try { body = await r.json(); } catch (e) { return null; }
    if (!body || typeof body.now !== 'number') return null;
    // Best estimate of "server time at t1" assumes the request and response
    // legs took roughly equal time: serverAtT1 ≈ body.now + rtt/2.
    const estOffset = (body.now + rtt / 2) - t1;
    return { offset: estOffset, rtt };
  }
  // Take several samples and keep the one with the lowest round-trip time
  // (least network jitter = most accurate offset estimate), a standard
  // NTP-style approach — cheap enough to redo before every countdown.
  async function syncClock(samples) {
    let best = null;
    for (let i = 0; i < (samples || 3); i++) {
      const s = await syncClockOnce();
      if (s && (!best || s.rtt < best.rtt)) best = s;
    }
    if (best) { clockOffsetMs = best.offset; clockSynced = true; }
    return clockSynced;
  }
  function serverNow() { return Date.now() + clockOffsetMs; }
  // Sync as early as possible so it's ready before the first countdown.
  syncClock(3);
  // Raw chat backend — reused as-is, no second messaging system created.
  async function chatApi(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(API + path, opts);
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error((data && data.error) || 'Request failed');
    return data;
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 2 — Supabase Realtime (broadcast-only channel)
  // ═══════════════════════════════════════════════════════
  const WT_SUPABASE_URL = 'https://jmhsyhpmuszyphwjfcuk.supabase.co';
  const WT_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImptaHN5aHBtdXN6eXBod2pmY3VrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5NzAzODIsImV4cCI6MjA5OTU0NjM4Mn0.hXmVIoESJ5SkbhIaN-UyWLbJ4XdvZD_dd7U2WzFfvNI';
  let _sb = null, _channel = null, _presenceState = { partnerOnline: false };

  function getSb() {
    if (_sb) return _sb;
    try { _sb = window.supabase.createClient(WT_SUPABASE_URL, WT_SUPABASE_KEY); } catch (e) { _sb = null; }
    return _sb;
  }

  function setupRealtime() {
    if (_channel || !COUPLE_ID) return;
    const sb = getSb();
    if (!sb) return;
    _channel = sb.channel('watch_together:' + COUPLE_ID, {
      config: { broadcast: { self: false }, presence: { key: ROLE } }
    })
      .on('broadcast', { event: 'wt_state' }, (msg) => applyRemoteState(msg.payload))
      .on('broadcast', { event: 'wt_room' }, (msg) => applyRemoteRoom(msg.payload))
      .on('broadcast', { event: 'wt_reaction' }, (msg) => showReaction(msg.payload.emoji, false))
      .on('presence', { event: 'sync' }, () => {
        const st = _channel.presenceState();
        _presenceState.partnerOnline = Object.keys(st).some(k => k === OTHER_ROLE);
        updatePartnerPresenceUI();
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') { try { await _channel.track({ role: ROLE, at: Date.now() }); } catch (e) {} }
      });
  }

  function broadcastState(partialPayload) {
    if (!_channel) return;
    try { _channel.send({ type: 'broadcast', event: 'wt_state', payload: partialPayload }); } catch (e) {}
  }
  // Full-room broadcasts (request-start / accept / cancel / end) so the
  // partner reacts INSTANTLY instead of waiting on a poll.
  function broadcastRoom(room) {
    if (!_channel) return;
    try { _channel.send({ type: 'broadcast', event: 'wt_room', payload: room }); } catch (e) {}
  }
  function broadcastReaction(emoji) {
    if (!_channel) return;
    try { _channel.send({ type: 'broadcast', event: 'wt_reaction', payload: { emoji, from: ROLE } }); } catch (e) {}
  }

  window.addEventListener('pagehide', teardownRealtime);
  function teardownRealtime() {
    if (_channel && _sb) { try { _sb.removeChannel(_channel); } catch (e) {} _channel = null; }
    clearAllTimers();
    try { const Call = window.parent.Call; if (Call) Call.clearWatchSession(); } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 3 — Local state
  // ═══════════════════════════════════════════════════════
  const state = {
    room: null,
    localFile: null,
    localObjectUrl: null,
    pendingResumeSec: null,
    myDuration: null,
    myTitle: null,
    mode: 'direct',        // which setup tab is showing: 'direct' | 'cloud'
    cloudMovieId: null,    // set while the current session streams a shared R2 movie
    lastActionSeq: 0,
    applyingRemote: false,
    countdownTimer: null,
    driftTimer: null,
    hideTimer: null,
    chatPollTimer: null,
    lastChatTs: null,
    reconnectPending: false,
    scrubbing: false,
    uiState: 'boot' // setup | countdown | watching | ended
  };

  const $ = (id) => document.getElementById(id);
  // Lucide's createIcons() replaces the <i data-lucide="x"> element with
  // the <svg> itself (attributes incl. id/class are carried over). To
  // change an icon later we have to hand it a fresh <i> and re-run
  // createIcons — just editing data-lucide on the existing <svg> does
  // nothing.
  function setIcon(el, name) {
    if (!el) return;
    const i = document.createElement('i');
    i.id = el.id; i.className = el.className; i.setAttribute('data-lucide', name);
    el.replaceWith(i);
    if (window.lucide) window.lucide.createIcons();
    return i;
  }
  const els = {
    setup: $('stateSetup'), countdown: $('stateCountdown'), watching: $('stateWatching'),
    empty: $('wtEmptyCard'), lobby: $('wtLobby'), waiting: $('waitingBlock'),
    fileInput: $('movieFileInput'), video: $('wtVideo'), wrap: $('playerWrap'),
    toast: $('wtToast'), banner: $('wtBanner'), bannerText: $('wtBannerText'), bannerActions: $('wtBannerActions')
  };

  function showState(name) {
    state.uiState = name;
    [els.setup, els.countdown, els.watching].forEach(el => { if (el) el.hidden = true; });
    document.getElementById('wtPage').classList.toggle('is-watching', name === 'watching');
    if (name === 'setup') els.setup.hidden = false;
    else if (name === 'countdown') els.countdown.hidden = false;
    else if (name === 'watching') { els.watching.hidden = false; if (typeof syncChatGap === 'function') requestAnimationFrame(syncChatGap); if (typeof syncReactionsAnchor === 'function') requestAnimationFrame(syncReactionsAnchor); }
  }

  function showSetupSub(sub) {
    // sub: 'empty' | 'lobby' | 'waiting'
    els.empty.hidden = sub !== 'empty';
    els.lobby.hidden = sub === 'empty';
    els.waiting.hidden = sub !== 'waiting';
    $('bothReadyBlock').hidden = sub === 'waiting' || $('bothReadyBlock').hidden;
    const cm = $('btnCancelMovie'); if (cm) cm.hidden = sub !== 'lobby';
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
  }

  function toast(msg, ms) {
    els.toast.textContent = msg; els.toast.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => els.toast.hidden = true, ms || 2500);
  }

  function showBanner(text, actions) {
    els.bannerText.textContent = text;
    els.bannerActions.innerHTML = '';
    (actions || []).forEach(a => {
      const b = document.createElement('button');
      b.textContent = a.label; if (a.secondary) b.className = 'secondary';
      b.onclick = a.onClick;
      els.bannerActions.appendChild(b);
    });
    els.banner.hidden = false;
  }
  function hideBanner() { els.banner.hidden = true; }

  function setStatusPill(text, kind) {
    const pill = $('statusPill');
    if (!text) { pill.hidden = true; return; }
    pill.hidden = false;
    pill.textContent = text;
    pill.className = 'wt-status-pill' + (kind ? ' is-' + kind : '');
    clearTimeout(setStatusPill._t);
    if (kind !== 'warn') setStatusPill._t = setTimeout(() => { pill.hidden = true; }, 2200);
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 4 — Local movie selection
  // ═══════════════════════════════════════════════════════
  $('btnChooseMovie').onclick = () => els.fileInput.click();
  $('btnChangeMovie').onclick = () => {
    if (state.mode === 'cloud') { showSetupSub('empty'); setMode('cloud'); }
    else els.fileInput.click();
  };

  els.fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!/^video\//.test(file.type)) { toast("That file doesn't look like a supported video."); return; }

    if (state.localObjectUrl) URL.revokeObjectURL(state.localObjectUrl);
    state.localFile = file;
    state.localObjectUrl = URL.createObjectURL(file);

    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.src = state.localObjectUrl;
    probe.onloadedmetadata = async () => {
      state.myDuration = probe.duration;
      state.myTitle = file.name.replace(/\.[^/.]+$/, '');
      const sizeGb = (file.size / 1e9).toFixed(file.size > 1e9 ? 1 : 2);
      renderMyMovieCard(state.myTitle, state.myDuration, file.type, sizeGb);
      try {
        state.room = await api('POST', `/${COUPLE_ID}/movie`, { role: ROLE, title: state.myTitle, durationSec: state.myDuration });
        renderFromRoom();
      } catch (err) { toast('Could not save selection — check your connection.'); }
    };
    probe.onerror = () => toast("This video format may not be supported by your device's player.");
  });

  function renderMyMovieCard(title, duration, type, sizeGb) {
    $('myMovieCard').hidden = false;
    $('myMovieTitle').textContent = title;
    $('myMovieMeta').textContent = [fmtTime(duration), (type.split('/')[1] || '').toUpperCase(), sizeGb && sizeGb !== '—' ? `${sizeGb} GB` : ''].filter(Boolean).join(' • ');
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 4b — Shared Cloud Storage (private Cloudflare R2).
  // Direct Device Video (Section 4) is untouched. This block only runs
  // when the "Shared Cloud Storage" tab is opened or the room carries a
  // shared_movie_id. The browser never sees R2 credentials: uploads use
  // short-lived presigned part URLs and playback a short-lived signed
  // GET URL, both minted by /api/movie-library after it verifies you
  // belong to this couple.
  // ═══════════════════════════════════════════════════════
  const USER_ID = (function () {
    try { const s = window.parent.S; if (s && s.userId) return s.userId; } catch (e) {}
    try { const d = JSON.parse(localStorage.getItem('uwl_v5') || '{}'); if (d.userId) return d.userId; } catch (e) {}
    return null;
  })();
  const cloud = { movies: [], usage: null, uploading: false, cancel: false, activeId: null, xhrs: new Set(), errTimes: [] };
  const CLOUD_MIME = { mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', webm: 'video/webm' };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function libApi(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json', 'x-user-id': USER_ID || '' } };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(API + '/api/movie-library/' + COUPLE_ID + path, opts);
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error((data && data.error) || 'Request failed');
    return data;
  }

  function fmtBytes(n) {
    n = Number(n) || 0;
    return n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + ' MB';
  }

  function setMode(mode, opts) {
    state.mode = mode;
    $('modeDirect').classList.toggle('is-active', mode === 'direct');
    $('modeCloud').classList.toggle('is-active', mode === 'cloud');
    $('wtDirectPane').hidden = mode !== 'direct';
    $('wtCloudPane').hidden = mode !== 'cloud';
    if (mode === 'cloud' && !(opts && opts.load === false)) loadLibrary();
  }
  $('modeDirect').onclick = () => setMode('direct');
  $('modeCloud').onclick = () => setMode('cloud');

  async function loadLibrary() {
    if (!cloud.movies.length) $('cloudList').innerHTML = '<p class="wt-hint">Loading…</p>';
    try {
      const d = await libApi('GET', '');
      cloud.movies = d.movies; cloud.usage = d.usage;
      renderLibrary();
    } catch (e) {
      $('cloudList').innerHTML = `<p class="wt-hint">${escapeHtml(e.message)}</p>`;
    }
  }

  function renderLibrary() {
    const u = cloud.usage;
    if (u) {
      $('cloudUsageText').textContent = `${fmtBytes(u.usedBytes)} of ${fmtBytes(u.limitBytes)} used`;
      const pct = Math.min(100, (u.usedBytes / u.limitBytes) * 100);
      $('cloudUsageFill').style.width = pct + '%';
      const pctEl = $('cloudUsagePct'); if (pctEl) pctEl.textContent = Math.round(pct) + '%';
    }
    const selected = state.room && state.room.shared_movie_id;
    const rows = cloud.movies.filter(m => m.id !== cloud.activeId).map(m => {
      const ready = m.status === 'ready';
      return `<div class="wt-cloud-row${m.id === selected ? ' is-selected' : ''}">
        <div class="wt-cloud-thumb"><i data-lucide="film"></i></div>
        <div class="wt-cloud-info">
          <div class="wt-movie-title">${escapeHtml(m.title)}</div>
          <div class="wt-movie-meta">${ready ? fmtTime(m.durationSec) + ' • ' + fmtBytes(m.sizeBytes) : 'Incomplete upload'}</div>
        </div>
        ${ready ? `<button class="wt-round-btn wt-round-play" data-act="pick" data-id="${m.id}" aria-label="Watch"><i data-lucide="play"></i></button>` : ''}
        <button class="wt-round-btn" data-act="del" data-id="${m.id}" aria-label="Delete"><i data-lucide="trash-2"></i></button>
      </div>`;
    });
    $('cloudList').innerHTML = rows.length ? rows.join('') : '<p class="wt-hint">No shared movies yet. Upload one to get started.</p>';
    if (window.lucide) window.lucide.createIcons();
  }

  $('cloudList').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    btn.disabled = true;
    try {
      if (btn.dataset.act === 'pick') {
        state.room = await libApi('POST', `/${id}/select`);
        if (state.room.action_seq && state.room.action_seq > state.lastActionSeq) state.lastActionSeq = state.room.action_seq;
        broadcastRoom(state.room);
        renderFromRoom();
      } else if (btn.dataset.act === 'del') {
        const m = cloud.movies.find(x => x.id === id);
        if (!window.confirm(`Delete "${m ? m.title : 'this movie'}" for both of you? This removes it from cloud storage permanently.`)) { btn.disabled = false; return; }
        await libApi('DELETE', `/${id}`);
        toast('Movie deleted');
        if (state.room && state.room.shared_movie_id === id) { state.room = await api('GET', `/${COUPLE_ID}`); renderFromRoom(); }
        await loadLibrary();
      }
    } catch (err) { toast(err.message, 3500); btn.disabled = false; }
  });

  // ── Upload (multipart, straight to R2) ──
  function probeDuration(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => { URL.revokeObjectURL(url); isFinite(v.duration) && v.duration > 0 ? resolve(v.duration) : reject(new Error("Couldn't read this video's length.")); };
      v.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This video format may not be supported by your device's player.")); };
      v.src = url;
    });
  }

  function putPart(url, blob, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      cloud.xhrs.add(xhr);
      xhr.open('PUT', url);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded); };
      xhr.onload = () => {
        cloud.xhrs.delete(xhr);
        if (xhr.status >= 200 && xhr.status < 300) {
          const etag = xhr.getResponseHeader('ETag');
          etag ? resolve(etag) : reject(new Error('NO_ETAG'));
        } else reject(Object.assign(new Error('HTTP ' + xhr.status), { status: xhr.status }));
      };
      xhr.onerror = () => { cloud.xhrs.delete(xhr); reject(new Error('NETWORK')); };
      xhr.onabort = () => { cloud.xhrs.delete(xhr); reject(new Error('ABORTED')); };
      xhr.send(blob);
    });
  }

  function showUploadUi(on) {
    $('cloudProgress').hidden = !on;
    $('btnCloudUpload').hidden = on;
  }
  function setUploadProgress(frac, text) {
    $('cloudProgressFill').style.width = Math.round(frac * 100) + '%';
    if (text) $('cloudProgressText').textContent = text;
  }

  $('btnCloudUpload').onclick = () => $('cloudFileInput').click();
  $('btnCloudCancel').onclick = () => {
    cloud.cancel = true;
    cloud.xhrs.forEach(x => { try { x.abort(); } catch (e) {} });
  };
  window.addEventListener('beforeunload', (e) => { if (cloud.uploading) { e.preventDefault(); e.returnValue = ''; } });

  $('cloudFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || cloud.uploading) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const mime = Object.values(CLOUD_MIME).includes(file.type) ? file.type : CLOUD_MIME[ext];
    if (!mime) { toast('Please choose an MP4, WebM, M4V or MOV video.', 3500); return; }

    let duration;
    try { duration = await probeDuration(file); } catch (err) { toast(err.message, 3500); return; }

    cloud.uploading = true; cloud.cancel = false;
    showUploadUi(true); setUploadProgress(0, 'Starting…');
    let init = null;
    try {
      init = await libApi('POST', '/uploads', { title: file.name.replace(/\.[^/.]+$/, ''), size: file.size, mime, durationSec: duration });
      cloud.activeId = init.movieId;
      const parts = await uploadAllParts(file, init);
      if (cloud.cancel) throw new Error('ABORTED');
      setUploadProgress(1, 'Finishing…');
      await libApi('POST', `/uploads/${init.movieId}/complete`, { parts });
      toast('Uploaded ❤️ Ready to watch together');
    } catch (err) {
      if (init) { try { await libApi('POST', `/uploads/${init.movieId}/abort`); } catch (_) {} }
      if (err.message === 'ABORTED') toast('Upload cancelled');
      else if (err.message === 'NO_ETAG') toast('Cloud storage is not set up for browser uploads yet (CORS). See setup notes.', 5000);
      else toast('Upload failed: ' + err.message, 4500);
    } finally {
      cloud.uploading = false; cloud.activeId = null; cloud.cancel = false;
      showUploadUi(false);
      loadLibrary();
    }
  });

  // Uploads every part (3 at a time), fetching signed URLs just-in-time and
  // retrying each part with backoff (fresh URL on every retry) so a flaky
  // mobile connection or an expired part URL doesn't kill a multi-GB upload.
  async function uploadAllParts(file, init) {
    const total = init.totalParts, partSize = init.partSize;
    const etags = new Array(total), loaded = new Array(total).fill(0), urls = {};
    let next = 1;
    const t0 = Date.now();

    async function urlFor(n, fresh) {
      if (fresh || !urls[n]) {
        const nums = [];
        for (let i = n; i <= total && nums.length < 6; i++) if (fresh ? i === n : !urls[i]) nums.push(i);
        const r = await libApi('POST', `/uploads/${init.movieId}/parts`, { partNumbers: nums });
        Object.keys(r.urls).forEach(k => { urls[k] = r.urls[k]; });
      }
      return urls[n];
    }
    function progress() {
      const sent = loaded.reduce((a, b) => a + b, 0);
      const secs = (Date.now() - t0) / 1000;
      const mbps = secs > 3 ? ` • ${(sent / 1e6 / secs).toFixed(1)} MB/s` : '';
      setUploadProgress(sent / file.size, `Uploading ${Math.round((sent / file.size) * 100)}% • ${fmtBytes(sent)} of ${fmtBytes(file.size)}${mbps}`);
    }
    async function worker() {
      while (!cloud.cancel) {
        const n = next++;
        if (n > total) return;
        const blob = file.slice((n - 1) * partSize, Math.min(n * partSize, file.size));
        for (let attempt = 0; ; attempt++) {
          try {
            const url = await urlFor(n, attempt > 0);
            etags[n - 1] = await putPart(url, blob, (b) => { loaded[n - 1] = b; progress(); });
            loaded[n - 1] = blob.size; progress();
            break;
          } catch (err) {
            loaded[n - 1] = 0;
            if (cloud.cancel || err.message === 'ABORTED' || err.message === 'NO_ETAG' || attempt >= 7) throw err;
            await sleep(Math.min(15000, 1000 * Math.pow(2, attempt)));
          }
        }
      }
    }
    const run = () => worker().catch((err) => { cloud.cancel = true; cloud.xhrs.forEach(x => { try { x.abort(); } catch (e) {} }); throw err; });
    await Promise.all([run(), run(), run()]);
    return etags.map((ETag, i) => ({ PartNumber: i + 1, ETag }));
  }

  // ── Playback: signed URL → <video>. R2 supports HTTP Range, so seeking works natively. ──
  async function attachCloudSource(resume) {
    const id = state.cloudMovieId;
    if (!id) return;
    let url;
    try {
      const r = await libApi('GET', `/${id}/url`);
      url = r.url;
    } catch (e) {
      showBanner('Could not load the shared movie: ' + e.message, [
        { label: 'Retry', onClick: () => { hideBanner(); attachCloudSource(resume); } }
      ]);
      return;
    }
    if (state.cloudMovieId !== id) return; // session ended while the URL was being fetched
    els.video.addEventListener('loadedmetadata', function onMeta() {
      els.video.removeEventListener('loadedmetadata', onMeta);
      const r = state.room || {};
      let target, play;
      if (resume) { target = resume.at; play = resume.playing; }
      else if (r.status === 'watching' && !r.playing) { target = r.position_sec || 0; play = false; }
      else {
        const sinceStart = r.scheduled_start_at ? (serverNow() - new Date(r.scheduled_start_at).getTime()) / 1000 : 0;
        target = r.playing ? expectedPosition(r) : Math.max(0, sinceStart) + expectedPosition(r);
        play = true;
      }
      els.video.currentTime = Math.max(0, target);
      if (play) {
        els.video.play().catch(() => showBanner('Tap to start the movie.', [
          { label: '▶ Play', onClick: () => { hideBanner(); els.video.play().catch(() => {}); sendAction(true, els.video.currentTime); } }
        ]));
      } else els.video.pause();
      updatePlayPauseIcon();
    });
    els.video.src = url;
    console.info('[WT] VIDEO cloud source assigned');
  }

  // Expired URL / dropped connection mid-movie → fresh URL, same position.
  function recoverCloudPlayback() {
    const now = Date.now();
    cloud.errTimes = cloud.errTimes.filter(t => now - t < 60000);
    cloud.errTimes.push(now);
    const resume = {
      at: els.video.currentTime > 1 ? els.video.currentTime : expectedPosition(state.room),
      playing: !!(state.room && state.room.playing)
    };
    if (cloud.errTimes.length > 3) {
      showBanner('The shared movie keeps failing to load. Check your connection.', [
        { label: 'Retry', onClick: () => { cloud.errTimes = []; hideBanner(); recoverCloudPlayback(); } }
      ]);
      return;
    }
    setStatusPill('Reconnecting video…', 'warn');
    attachCloudSource(resume);
  }
  els.video.addEventListener('canplay', () => {
    if (state.cloudMovieId) { cloud.errTimes = []; setStatusPill(null); }
  });

  // ═══════════════════════════════════════════════════════
  // SECTION 5 — Central room → UI dispatcher. This is the ONLY place
  // that decides which top-level state (+ setup sub-state) is shown, so
  // behavior stays deterministic instead of inferred from scattered
  // hidden/shown DOM flags (per spec's "no dozens of unrelated elements"
  // requirement).
  // ═══════════════════════════════════════════════════════
  function renderFromRoom() {
    const r = state.room;
    if (r && r.shared_movie_id) {
      // Room is in Shared Cloud Storage mode (either partner may have picked it).
      state.myTitle = r[`${ROLE}_movie_title`] || state.myTitle;
      state.myDuration = Number(r[`${ROLE}_duration_sec`]) || state.myDuration;
      if (state.mode !== 'cloud') setMode('cloud', { load: false });
    }
    if (!r || r.status === 'idle' || r.status === 'ended') {
      if (state.uiState === 'watching') clearWatchCallSession(); // partner ended / reconnect found a dead room — kill any lingering call
      showState('setup'); showSetupSub('empty'); hideInviteModal(); return;
    }

    if (r.status === 'countdown' && r.scheduled_start_at) {
      hideInviteModal();
      runCountdown(r.scheduled_start_at);
      return;
    }
    if (r.status === 'watching') { hideInviteModal(); enterWatching(r); return; }

    // Non-watching statuses render inside the SETUP state.
    showState('setup');

    if (r.status === 'start_requested') {
      if (r.start_requested_by === ROLE) {
        renderLobby(r); // keep movie card + partner chips accurate under the waiting card
        showSetupSub('waiting');
        $('btnReady').hidden = true;
      } else {
        showSetupSub('lobby'); // stays on lobby underneath the modal
        showInviteModal(r);
      }
      return;
    }
    hideInviteModal();

    const mine = ROLE === 'user1' ? r.user1_duration_sec : r.user2_duration_sec;
    if (!mine) { showSetupSub('empty'); return; }
    showSetupSub('lobby');
    renderLobby(r);
  }

  function renderLobby(r) {
    const mine = ROLE === 'user1' ? r.user1_duration_sec : r.user2_duration_sec;
    const theirs = ROLE === 'user1' ? r.user2_duration_sec : r.user1_duration_sec;
    const myReady = ROLE === 'user1' ? r.user1_ready : r.user2_ready;
    const theirReady = ROLE === 'user1' ? r.user2_ready : r.user1_ready;

    if (mine) renderMyMovieCard(r[`${ROLE}_movie_title`] || state.myTitle || 'Selected movie', mine, 'video/mp4', '—');

    if (mine && theirs) {
      const banner = $('matchBanner'); banner.hidden = false;
      if (r.movies_match) {
        banner.className = 'wt-match-banner match'; banner.textContent = '✅ Movie Match';
        $('btnReady').hidden = false;
      } else {
        banner.className = 'wt-match-banner mismatch';
        banner.textContent = '⚠️ Your movie versions appear to have different durations. Please select matching versions before starting.';
        $('btnReady').hidden = true;
      }
    } else {
      $('matchBanner').hidden = true;
      $('btnReady').hidden = !mine;
    }

    $('stateMe').textContent = myReady ? '✓ Ready' : (mine ? 'Movie Selected' : 'Selecting…');
    $('chipMe').classList.toggle('is-ready', !!myReady);
    $('statePartner').textContent = theirReady ? '✓ Ready' : (theirs ? 'Movie Selected' : 'Waiting…');
    $('chipPartner').classList.toggle('is-ready', !!theirReady);
    if (ctx && ctx.partnerName) $('partnerNameLabel').textContent = ctx.partnerName;

    $('btnReady').classList.toggle('is-active', !!myReady);
    $('btnReady').textContent = myReady ? '✓ READY' : "I'M READY";

    const bothReady = r.movies_match && r.user1_ready && r.user2_ready;
    $('bothReadyBlock').hidden = !bothReady;
  }

  $('btnReady').onclick = async () => {
    const r = state.room;
    const currentlyReady = ROLE === 'user1' ? r.user1_ready : r.user2_ready;
    try {
      state.room = await api('POST', `/${COUPLE_ID}/ready`, { role: ROLE, ready: !currentlyReady });
      renderFromRoom();
    } catch (e) { toast('Could not update ready state.'); }
  };

  // ═══════════════════════════════════════════════════════
  // SECTION 6 — Start request / accept / cancel flow. B never has to
  // manually press Start after accepting — accept-start alone schedules
  // the shared countdown for BOTH clients.
  // ═══════════════════════════════════════════════════════
  $('btnStart').onclick = async () => {
    try {
      state.room = await api('POST', `/${COUPLE_ID}/request-start`, { role: ROLE });
      broadcastRoom(state.room);
      renderFromRoom();
    } catch (e) { toast('Could not start session: ' + e.message); }
  };

  // Leave the "I'm ready" lobby and return to the movie section without
  // closing the page. Ends the pending (not-yet-started) session for both
  // partners — no watch-history entry is written because no movieTitle is sent.
  $('btnCancelMovie').onclick = async () => {
    const btn = $('btnCancelMovie'); btn.disabled = true;
    try {
      state.room = await api('POST', `/${COUPLE_ID}/end`, { role: ROLE });
      try { broadcastRoom(state.room); } catch (_) {}
      if (state.localObjectUrl) { try { URL.revokeObjectURL(state.localObjectUrl); } catch (_) {} state.localObjectUrl = null; }
      state.localFile = null; state.myTitle = null; state.myDuration = null;
      renderFromRoom();
      toast('Movie Together cancelled');
    } catch (e) { toast('Could not cancel.'); }
    finally { btn.disabled = false; }
  };

  $('btnCancelStart').onclick = async () => {
    try {
      state.room = await api('POST', `/${COUPLE_ID}/cancel-start`, { role: ROLE });
      broadcastRoom(state.room);
      renderFromRoom();
    } catch (e) { toast('Could not cancel.'); }
  };

  function showInviteModal(r) {
    $('inviteMovieName').textContent = r[`${OTHER_ROLE}_movie_title`] || state.myTitle || 'Selected movie';
    $('inviteModalBackdrop').hidden = false;
  }
  function hideInviteModal() { $('inviteModalBackdrop').hidden = true; }

  $('btnDeclineInvite').onclick = async () => {
    hideInviteModal();
    try {
      state.room = await api('POST', `/${COUPLE_ID}/cancel-start`, { role: ROLE });
      broadcastRoom(state.room);
    } catch (e) {}
  };
  $('btnAcceptInvite').onclick = async () => {
    hideInviteModal();
    try {
      state.room = await api('POST', `/${COUPLE_ID}/accept-start`, { role: ROLE, countdownMs: 4000 });
      broadcastRoom(state.room);
      runCountdown(state.room.scheduled_start_at);
    } catch (e) { toast('Could not accept.'); }
  };

  // Instant partner-side reaction to a room-level broadcast (request /
  // accept / cancel / end) without waiting on the next poll.
  function applyRemoteRoom(room) {
    if (!room) return;
    if (room.action_seq && state.room && room.action_seq <= (state.room.action_seq || 0)) return;
    state.room = room;
    renderFromRoom();
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 7 — Countdown (shared future timestamp)
  // ═══════════════════════════════════════════════════════
  function runCountdown(startAtIso) {
    if (state.uiState === 'countdown' && state._countdownFor === startAtIso) return; // already running this one
    state._countdownFor = startAtIso;
    showState('countdown');
    const startAt = new Date(startAtIso).getTime();
    clearInterval(state.countdownTimer);
    // Re-sync right before the countdown that actually matters — accuracy
    // here is what determines whether playback starts in lockstep.
    syncClock(3).then(() => tickCountdown());
    function tickCountdown() {
      // secLeft is derived from serverNow(), the ONE shared clock both
      // devices agree on — not from each device's own Date.now(), which
      // is the root cause this replaces (see clock-sync note above).
      const secLeft = Math.ceil((startAt - serverNow()) / 1000);
      if (secLeft <= 0) {
        clearInterval(state.countdownTimer);
        setTimeout(() => enterWatching(state.room), 150);
      } else {
        $('countdownNum').textContent = String(Math.min(3, secLeft));
      }
    }
    state.countdownTimer = setInterval(tickCountdown, 200);
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 8 — Player + clock-based sync engine
  // ═══════════════════════════════════════════════════════
  // The session id the Watch Together call engine scopes every media
  // signal to. `scheduled_start_at` is established fresh by the server
  // on every accept-start (routes/routes-movie.js) — it is stable for the
  // whole life of ONE movie session and different for every new one, so
  // it's exactly the "unique per Watch Together session" identifier the
  // call lifecycle needs (spec §4) without any new server field.
  function watchSessionIdFor(room) {
    return (room && room.scheduled_start_at) ? (COUPLE_ID + ':' + room.scheduled_start_at) : null;
  }
  function registerWatchCallSession(room) {
    try {
      const Call = window.parent.Call;
      const id = watchSessionIdFor(room);
      if (Call && id) Call.registerWatchSession(id);
    } catch (e) {}
  }
  function clearWatchCallSession() {
    try { const Call = window.parent.Call; if (Call) Call.clearWatchSession(); } catch (e) {}
    // Local mini-UI state must reset too, or a NEW session could briefly
    // render with a leftover collapsed/minimized presentation choice.
    if (callTimerInt) { clearInterval(callTimerInt); callTimerInt = null; }
    callStartedAt = null; restoreMovieAudio(); videoMinimized = false; voiceCollapsed = false;
  }

  function enterWatching(room) {
    if (state.uiState === 'watching') return;
    showState('watching');
    console.info('[WT] PLAYER mounted');
    setupRealtime();
    registerWatchCallSession(room);
    $('wtNowTitle').textContent = state.myTitle || room[`${ROLE}_movie_title`] || 'Movie';

    state.cloudMovieId = room.shared_movie_id || null;
    if (state.cloudMovieId) {
      // Shared Cloud Storage: stream from a short-lived signed R2 URL.
      attachCloudSource(null);
    } else if (!state.localObjectUrl) {
      // The in-memory object URL/File reference didn't survive to this
      // point (most commonly: the page/iframe reloaded between movie
      // selection and now, e.g. Android backgrounding the WebView).
      // Surface this clearly instead of silently leaving #wtVideo with
      // no source (which is what produced the blank/placeholder video).
      console.warn('[WT] enterWatching: state.localObjectUrl missing — video has no source');
      showBanner('Your movie file needs to be reselected on this device.', [
        { label: 'Choose Movie', onClick: () => { showState('setup'); showSetupSub('empty'); hideBanner(); } }
      ]);
    } else {
      els.video.src = state.localObjectUrl;
      console.info('[WT] VIDEO source assigned');
    }

    // Late-start correction: if this client's clock lands here later
    // than another (backgrounded tab, slow event delivery), compute how
    // far into playback we already are rather than starting from 0.
    const elapsedSinceStart = room.scheduled_start_at ? (serverNow() - new Date(room.scheduled_start_at).getTime()) / 1000 : 0;
    const target = Math.max(0, elapsedSinceStart) + expectedPosition(room);
    els.video.currentTime = target;
    els.video.play().then(() => console.info('[WT] play() resolved')).catch((e) => console.warn('[WT] play() rejected:', e && e.message));
    if (state.pendingResumeSec != null && state.localObjectUrl) {
      // Task 5 "Continue Watching": local-file architecture means we can't
      // silently resume from a saved file handle across a restart — the
      // user just reselected the file via the History panel, so honor
      // their saved position now, once, and never again for this session.
      els.video.currentTime = state.pendingResumeSec;
      toast('Resumed from your last position');
      state.pendingResumeSec = null;
    }
    if (!room.playing) {
      // Countdown just finished — this is the moment playback truly begins.
      sendAction(true, target);
    }
    startDriftLoop();
    setupCallBridge();
    setupControlsAutoHide();
    startChatPolling();
    updatePlayPauseIcon();
    // Load this session's prior movie-chat messages (e.g. reconnect
    // mid-session) so the log panel isn't empty until a NEW message
    // arrives.
    if (room.scheduled_start_at) {
      movieChatLog.length = 0;
      api('GET', `/${COUPLE_ID}/chat?sessionKey=` + encodeURIComponent(room.scheduled_start_at) + '&limit=200')
        .then(rows => { (rows || []).forEach(r => movieChatLog.push({ role: r.sender_role, text: r.text, posSec: r.playback_position_sec, createdAtIso: r.created_at })); renderMovieChatLog(); })
        .catch(() => {});
    }
  }

  function expectedPosition(room) {
    if (!room) return 0;
    if (!room.playing) return room.position_sec || 0;
    const elapsed = (serverNow() - new Date(room.updated_at).getTime()) / 1000;
    return (room.position_sec || 0) + Math.max(0, elapsed);
  }

  function nextSeq() { return (state.lastActionSeq = Math.max(state.lastActionSeq + 1, Date.now())); }

  async function sendAction(playing, positionSec) {
    const seq = nextSeq();
    const payload = { role: ROLE, playing, positionSec, actionSeq: seq, updated_at: new Date().toISOString(), updated_by: ROLE };
    broadcastState(payload);
    try { state.room = await api('PATCH', `/${COUPLE_ID}/state`, { role: ROLE, playing, positionSec, actionSeq: seq }); }
    catch (e) { /* durable write failed; broadcast may still have reached partner — reconciled on next reconnect */ }
  }

  function applyRemoteState(payload) {
    if (!payload || payload.actionSeq <= state.lastActionSeq) return; // stale/out-of-order — ignore
    state.lastActionSeq = payload.actionSeq;
    state.room = { ...(state.room || {}), playing: payload.playing, position_sec: payload.positionSec, updated_at: payload.updated_at };

    state.applyingRemote = true;
    const target = expectedPosition(state.room);
    if (Math.abs(els.video.currentTime - target) > 0.5) els.video.currentTime = target;
    if (payload.playing) els.video.play().catch(() => {}); else els.video.pause();
    setTimeout(() => { state.applyingRemote = false; }, 250);

    updatePlayPauseIcon();
    if (!payload.playing) setStatusPill(payload.updated_by === ROLE ? 'Paused' : 'Paused by Partner', 'warn');
    else setStatusPill(null);
    wakeControls();
  }

  function updatePlayPauseIcon() { setIcon($('playIcon'), els.video.paused ? 'play' : 'pause'); }

  $('btnPlayPause').onclick = () => {
    if (state.applyingRemote) return;
    if (els.video.paused) { els.video.play(); sendAction(true, els.video.currentTime); setStatusPill(null); }
    else { els.video.pause(); sendAction(false, els.video.currentTime); setStatusPill('Paused', 'warn'); }
    updatePlayPauseIcon();
    wakeControls();
  };
  $('btnSeekBack').onclick = () => { userSeek(els.video.currentTime - 10); wakeControls(); };
  $('btnSeekFwd').onclick = () => { userSeek(els.video.currentTime + 10); wakeControls(); };

  // Timeline: only sync to partner once the user finishes dragging
  // ("change"), never per-pixel on "input" — spec §Timeline.
  const timelineEl = $('wtTimeline');
  timelineEl.addEventListener('pointerdown', () => { state.scrubbing = true; wakeControls(true); });
  function setTimelineProgress(frac) {
    timelineEl.style.setProperty('--wt-progress', (Math.max(0, Math.min(1, frac)) * 100) + '%');
  }
  timelineEl.addEventListener('input', () => {
    setTimelineProgress(parseFloat(timelineEl.value) / 1000);
    if (!els.video.duration) return;
    const t = (parseFloat(timelineEl.value) / 1000) * els.video.duration;
    $('wtTimeCur').textContent = fmtTime(t);
  });
  timelineEl.addEventListener('change', (e) => {
    state.scrubbing = false;
    if (!els.video.duration) return;
    const t = (parseFloat(e.target.value) / 1000) * els.video.duration;
    userSeek(t);
  });
  function userSeek(t) {
    if (state.applyingRemote) return;
    els.video.currentTime = Math.max(0, t);
    sendAction(!els.video.paused, els.video.currentTime);
  }

  els.video.addEventListener('loadedmetadata', () => console.info('[WT] VIDEO loadedmetadata, duration=', els.video.duration));
  els.video.addEventListener('canplay', () => console.info('[WT] VIDEO canplay'));
  els.video.addEventListener('error', () => {
    console.warn('[WT] VIDEO error', els.video.error);
    // Shared Cloud Storage: most likely an expired/refused signed URL or a network drop —
    // fetch a fresh URL and resume from the same spot. (Ignore the empty-src error that
    // fires when we tear the player down.)
    if (state.cloudMovieId) {
      if (state.uiState === 'watching' && els.video.getAttribute('src')) recoverCloudPlayback();
      return;
    }
    // Previously silent — the screen just sat there with no video and no
    // explanation. Surface it with the same Error/retry pattern already
    // used when localObjectUrl is missing entirely.
    showBanner('This movie file couldn\u2019t be played. Please reselect it.', [
      { label: 'Choose Movie', onClick: () => { showState('setup'); showSetupSub('empty'); hideBanner(); } }
    ]);
  });
  els.video.addEventListener('timeupdate', () => {
    if (!els.video.duration || state.scrubbing) return;
    timelineEl.value = (els.video.currentTime / els.video.duration) * 1000;
    setTimelineProgress(els.video.currentTime / els.video.duration);
    $('wtTimeCur').textContent = fmtTime(els.video.currentTime);
    $('wtTimeTotal').textContent = fmtTime(els.video.duration);
  });
  els.video.addEventListener('ended', async () => {
    try {
      state.room = await api('POST', `/${COUPLE_ID}/end`, { role: ROLE, movieTitle: state.myTitle, durationSec: state.myDuration, completedPct: 100, sessionKey: state.room && state.room.scheduled_start_at, positionSec: Math.round(els.video.currentTime || 0) });
    } catch (e) {}
    toast('Movie finished ❤️');
  });

  // ── Periodic drift correction — reads only, never writes to server ──
  function startDriftLoop() {
    clearInterval(state.driftTimer);
    state.driftTimer = setInterval(() => {
      if (!state.room || !state.room.playing || state.applyingRemote || document.hidden || state.scrubbing) return;
      const expected = expectedPosition(state.room);
      const diff = expected - els.video.currentTime;
      const abs = Math.abs(diff);
      if (abs < 0.5) {
        els.video.playbackRate = 1;
      } else if (abs < 2) {
        els.video.playbackRate = diff > 0 ? 1.03 : 0.97;
      } else {
        els.video.playbackRate = 1;
        els.video.currentTime = expected;
      }
    }, 1000);
  }

  // FIXED SYNC: compute the authoritative expected position (accounting
  // for elapsed time since the last state write) and hard-seek to it
  // WITHOUT pausing or re-broadcasting — this is what was silently
  // failing before because there was no visible confirmation and the
  // 1s drift loop and the manual sync could visually fight each other.
  $('btnSync').onclick = async () => {
    if (!state.room) return;
    try {
      // Pull the authoritative row first so Sync also fixes a stale
      // local copy, not just clock drift on an already-fresh one.
      const fresh = await api('GET', `/${COUPLE_ID}`);
      if (fresh) state.room = { ...state.room, ...fresh };
    } catch (e) { /* fall back to local state.room if offline */ }
    const wasPlaying = !els.video.paused;
    const target = expectedPosition(state.room);
    els.video.currentTime = target;
    els.video.playbackRate = 1;
    if (wasPlaying) els.video.play().catch(() => {}); // never leave it paused
    setStatusPill('✓ In Sync', 'good');
    wakeControls();
  };

  function clearAllTimers() { clearInterval(state.countdownTimer); clearInterval(state.driftTimer); clearTimeout(state.hideTimer); clearInterval(state.chatPollTimer); }

  // ═══════════════════════════════════════════════════════
  // SECTION 9 — Auto-hiding controls. Single timer, single source of
  // truth (playerWrap.controls-hidden class), no competing timers.
  // ═══════════════════════════════════════════════════════
  let controlsLocked = false; // true while paused-needs-controls, dragging, chat/call open, or a modal is up
  let tapControlsSetup = false;
  function setupControlsAutoHide() {
    clearTimeout(state.hideTimer);
    els.wrap.classList.remove('controls-hidden');
    if (!tapControlsSetup) {
      tapControlsSetup = true;
      // ROOT CAUSE (found via mobile-input audit): this used to arm
      // wakeControls() on the *wrap's* pointerdown/touchstart AND ALSO
      // toggle controls off on the tap-catcher's click. On a quick tap
      // those two fired back-to-back — pointerdown showed the controls,
      // then the click (touchend) immediately hid them again a few ms
      // later, so a normal tap looked like "nothing happened". A long
      // press never produced a synthesized click the same way (it was
      // interpreted as a hold, not a tap), so the click-hide branch
      // never ran and the controls stayed visible — which is why only
      // long-press appeared to "work". Fix: ONE listener, Pointer
      // Events, on the tap-catcher only, with a movement threshold so
      // it never fires during a drag — and it only ever SHOWS controls,
      // never hides them (hiding is solely the inactivity timer's job).
      const tc = $('tapCatcher');
      let tsx = 0, tsy = 0, tMoved = false;
      tc.addEventListener('pointerdown', (e) => { tsx = e.clientX; tsy = e.clientY; tMoved = false; }, { passive: true });
      tc.addEventListener('pointermove', (e) => {
        if (Math.abs(e.clientX - tsx) > 10 || Math.abs(e.clientY - tsy) > 10) tMoved = true;
      }, { passive: true });
      tc.addEventListener('pointerup', (e) => {
        if (tMoved) return; // was a drag, not a tap — don't toggle controls
        onPlayerTap();
      });
    }
    armHideTimer();
  }
  function anyModalOpen() {
    return !$('endModalBackdrop').hidden || !$('inviteModalBackdrop').hidden || !$('moreBackdrop').hidden;
  }
  function onPlayerTap() {
    if (anyModalOpen()) return; // modal owns all interaction while open
    // Fix 3: tap toggles — SHOW if hidden, HIDE immediately if already
    // visible — while a stretch of inactivity still auto-hides via the
    // existing single timer (armHideTimer), never a second competing
    // timer. Special states (scrubbing, chat open, dragging mini video,
    // reaction bar, modal) are already funneled through `controlsLocked`
    // / the checks below, so a background tap can't fight them.
    if (controlsLocked || state.scrubbing) return;
    const currentlyHidden = els.wrap.classList.contains('controls-hidden');
    if (currentlyHidden) {
      wakeControls();
    } else {
      clearTimeout(state.hideTimer);
      hideControlsNow();
    }
  }
  function wakeControls(forceLock) {
    els.wrap.classList.remove('controls-hidden');
    if (forceLock) return;
    armHideTimer();
  }
  function hideControlsNow() {
    if (controlsLocked) return;
    els.wrap.classList.add('controls-hidden');
  }
  function armHideTimer() {
    clearTimeout(state.hideTimer);
    state.hideTimer = setTimeout(() => {
      const paused = els.video.paused;
      const chatOpen = !$('chatComposer').hidden;
      if (paused || chatOpen || anyModalOpen() || controlsLocked || state.scrubbing) return;
      hideControlsNow();
    }, 3000);
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 10 — Reactions (ephemeral only — never written to the DB)
  // ═══════════════════════════════════════════════════════
  $('reactionToggle').onclick = () => {
    const bar = $('reactionBar');
    bar.hidden = !bar.hidden;
    wakeControls(!bar.hidden);
  };
  document.querySelectorAll('#reactionBar button').forEach(btn => {
    btn.onclick = () => { const emoji = btn.dataset.r; showReaction(emoji, true); broadcastReaction(emoji); };
  });
  function showReaction(emoji, mine) {
    const el = document.createElement('div');
    el.className = 'wt-reaction-float';
    el.textContent = emoji;
    el.style.left = (mine ? 70 : (20 + Math.random() * 20)) + '%';
    $('reactionsLayer').appendChild(el);
    setTimeout(() => el.remove(), 2300);
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 11 — Fullscreen + Fit/Fill/Zoom display-mode cycling.
  // Tapping the control the FIRST time (not fullscreen yet) enters
  // fullscreen at Fit. While already fullscreen, tapping the SAME
  // control cycles Fit → Fill → Zoom → Fit instead of exiting — exiting
  // fullscreen is left to the system back gesture / Escape, which the
  // browser/WebView already handles via 'fullscreenchange' below.
  // ═══════════════════════════════════════════════════════
  const DISPLAY_MODES = ['fit', 'fill', 'zoom'];
  let displayModeIdx = 0;
  function applyDisplayMode(mode) {
    els.wrap.classList.remove('wt-mode-fit', 'wt-mode-fill', 'wt-mode-zoom');
    els.wrap.classList.add('wt-mode-' + mode);
    const label = $('wtModeLabel');
    if (!label) return;
    label.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
    label.hidden = false;
    clearTimeout(applyDisplayMode._t);
    applyDisplayMode._t = setTimeout(() => { label.hidden = true; }, 1000);
  }
  $('btnFullscreen').onclick = async () => {
    if (!document.fullscreenElement) {
      await els.wrap.requestFullscreen().catch(() => {});
      try { screen.orientation && screen.orientation.lock && await screen.orientation.lock('landscape'); } catch (e) {}
      displayModeIdx = 0;
      applyDisplayMode(DISPLAY_MODES[displayModeIdx]);
    } else {
      displayModeIdx = (displayModeIdx + 1) % DISPLAY_MODES.length;
      applyDisplayMode(DISPLAY_MODES[displayModeIdx]);
    }
    wakeControls();
  };
  // Fullscreen/orientation changes must never duplicate listeners —
  // this handler is attached exactly once at module scope.
  document.addEventListener('fullscreenchange', () => {
    setIcon($('fullscreenIcon'), document.fullscreenElement ? 'shrink' : 'expand');
    if (!document.fullscreenElement) {
      // Leaving fullscreen (system back/Escape) — reset to Fit for next time.
      displayModeIdx = 0;
      els.wrap.classList.remove('wt-mode-fill', 'wt-mode-zoom');
      els.wrap.classList.add('wt-mode-fit');
      try { screen.orientation && screen.orientation.unlock && screen.orientation.unlock(); } catch (e) {}
    }
    wakeControls();
    setTimeout(() => { if (typeof syncChatGap === 'function') syncChatGap(); if (typeof syncReactionsAnchor === 'function') syncReactionsAnchor(); }, 200);
  });

  // ═══════════════════════════════════════════════════════
  // SECTION 12 — Mini call UI, bridged to the EXISTING call engine via
  // window.parent.Call's Watch Together bridge (registerWatchSession /
  // startWatchCall / endWatchCall / getWatchState / getRemoteStream /
  // getRemoteCamOn — see public/chat/call.js). No new WebRTC/backend is
  // created here — Watch Together direct-joins through the SAME engine
  // Chat calls use, but the fullscreen ringing/incoming/PiP presentation
  // in call.js is never invoked for it, so this mini UI is the ONLY
  // thing ever shown:
  //   • VOICE  → compact mini bar (collapsible to a pill)
  //   • VIDEO  → small vertical-rectangle window, minimizable to a
  //              circular live-video bubble (same stream, no reconnect)
  // The Chat page's own calling behavior is completely unaffected — it
  // never touches any of the watch-* functions.
  // ═══════════════════════════════════════════════════════
  function getCall() { try { return window.parent.Call; } catch (e) { return null; } }

  let callBridgeSetup = false;
  let callDucked = false, prevVolume = 1;
  let callTimerInt = null, callStartedAt = null;
  let videoMinimized = false;
  let voiceCollapsed = false;

  function callDurationStr() {
    if (!callStartedAt) return '00:00';
    const s = Math.max(0, Math.floor((Date.now() - callStartedAt) / 1000));
    const m = Math.floor(s / 60), r = s % 60;
    return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
  }

  // NOTE: this used to force els.video.volume down to 0.15 whenever a
  // Watch Together voice/video call connected (and restore it on call
  // end). That was intentional app-level audio ducking, but it made the
  // movie nearly inaudible during a call, which isn't the desired
  // experience — Watch Together calls are meant to let both the movie
  // and partner audio play together. These are now no-ops kept in place
  // (rather than removing every call site) so the rest of the call-bridge
  // logic below doesn't need to change. Movie volume is left exactly as
  // the user set it, before, during, and after a call.
  function duckMovieAudio() {}
  function restoreMovieAudio() {}

  function setupCallBridge() {
    if (callBridgeSetup) return; // guard against duplicate listeners across rerenders/fullscreen toggles
    callBridgeSetup = true;

    const voiceBar = $('wtVoiceBar'), voicePill = $('wtVoicePill');
    const videoWin = $('wtVideoWin'), videoWinVideo = $('wtVideoWinVideo'), videoWinFallback = $('wtVideoWinAvatarFallback');
    const videoRuntime = $('wtVideoRuntime'), videoRuntimeTime = $('wtVideoRuntimeTime'), videoVMenu = $('wtVideoVMenu');
    const videoBubble = $('wtVideoBubble'), videoBubbleVideo = $('wtVideoBubbleVideo'), videoBubbleFallback = $('wtVideoBubbleAvatarFallback');

    // Bind a remote <video> element to `stream` and make sure it actually
    // starts playing — assigning srcObject alone doesn't guarantee frames
    // render on every WebView (root cause of the rectangle staying on its
    // avatar-fallback letter even once a live track exists).
    function bindRemoteVideo(el, stream) {
      if (el.srcObject !== stream) el.srcObject = stream;
      const p = el.play();
      if (p && p.catch) p.catch(() => {});
    }

    function refresh() {
      const Call = getCall();
      if (!Call || typeof Call.getWatchState !== 'function') {
        voiceBar.hidden = true; voicePill.hidden = true; videoWin.hidden = true; videoBubble.hidden = true;
        if (callTimerInt) { clearInterval(callTimerInt); callTimerInt = null; }
        callStartedAt = null; restoreMovieAudio();
        return;
      }
      // getWatchState().active is ONLY true for a call tagged
      // context:'watch_together' belonging to THIS device's currently
      // registered watch session (see registerWatchSession() calls
      // below) — a leftover/stale call from a previous session, or a
      // normal Chat call, can never make this true. This is what stops
      // the mini call UI from ever auto-appearing on its own.
      const st = Call.getWatchState();
      if (!st.active) {
        voiceBar.hidden = true; voicePill.hidden = true; videoWin.hidden = true; videoBubble.hidden = true;
        if (callTimerInt) { clearInterval(callTimerInt); callTimerInt = null; }
        callStartedAt = null; restoreMovieAudio();
        return;
      }
      const stream = Call.getRemoteStream();
      if (!callTimerInt) {
        duckMovieAudio();
        callTimerInt = setInterval(updateTimers, 1000);
      }
      // The timer ALWAYS comes from the media session's own authoritative
      // connect timestamp (Call.getWatchState().startedAt), never from a
      // locally-captured Date.now() — that's what previously let an old
      // duration silently keep counting into a brand-new movie session.
      callStartedAt = st.startedAt || null;

      if (st.callType === 'video') {
        voiceBar.hidden = true; voicePill.hidden = true;
        const muteIcon = $('vmenuMuteBtn').querySelector('svg');
        if (muteIcon) setIcon(muteIcon, st.muted ? 'mic-off' : 'mic');
        $('vmenuMuteBtn').classList.toggle('is-active', !!st.muted);
        const spkIcon = $('vmenuSpeakerBtn').querySelector('svg');
        if (spkIcon) setIcon(spkIcon, st.speakerOn ? 'volume-2' : 'volume-x');
        $('vmenuSpeakerBtn').classList.toggle('is-active', !!st.speakerOn);
        const camOn = typeof Call.getRemoteCamOn === 'function' ? Call.getRemoteCamOn() : true;
        if (videoMinimized) {
          videoWin.hidden = true; videoBubble.hidden = false;
          if (stream && camOn) { bindRemoteVideo(videoBubbleVideo, stream); videoBubbleVideo.hidden = false; videoBubbleFallback.hidden = true; }
          else { videoBubbleVideo.hidden = true; videoBubbleFallback.hidden = false; videoBubbleFallback.textContent = (ctx && ctx.partnerName ? ctx.partnerName[0] : 'P'); }
        } else {
          videoBubble.hidden = true; videoWin.hidden = false;
          if (stream && camOn) { bindRemoteVideo(videoWinVideo, stream); videoWinVideo.hidden = false; videoWinFallback.hidden = true; }
          else { videoWinVideo.hidden = true; videoWinFallback.hidden = false; videoWinFallback.textContent = (ctx && ctx.partnerName ? ctx.partnerName[0] : 'P'); }
        }
      } else {
        videoWin.hidden = true; videoBubble.hidden = true;
        if (voiceCollapsed) { voiceBar.hidden = true; voicePill.hidden = false; }
        else { voicePill.hidden = true; voiceBar.hidden = false; }
        $('wtVoiceBarName').textContent = (ctx && ctx.partnerName) || 'Partner';
        setIcon($('voiceMuteBtn').firstElementChild, st.muted ? 'mic-off' : 'mic');
        setIcon($('voiceSpeakerBtn').firstElementChild, st.speakerOn ? 'volume-2' : 'volume-x');
      }
    }
    function updateTimers() {
      const t = callDurationStr();
      $('wtVoiceBarTime').textContent = t;
      $('wtVoicePillTime').textContent = t;
      videoRuntimeTime.textContent = t;
    }

    try { window.parent.addEventListener('uwl:call-stream-changed', refresh); } catch (e) {}
    refresh();
    setInterval(refresh, 3000);

    // ── Voice bar ──
    $('voiceMuteBtn').onclick = (e) => { e.stopPropagation(); try { getCall().toggleMute(); } catch (err) {} refresh(); };
    $('voiceSpeakerBtn').onclick = (e) => { e.stopPropagation(); try { getCall().toggleSpeaker(); } catch (err) {} refresh(); };
    $('voiceEndBtn').onclick = (e) => { e.stopPropagation(); try { getCall().endWatchCall(); } catch (err) {} restoreMovieAudio(); refresh(); };
    // Fix 2: the WHOLE bar (name, runtime, phone icon, empty background)
    // collapses it — not a tiny corner hitbox — because the three real
    // action buttons above already stop the click from ever reaching
    // this handler.
    voiceBar.addEventListener('click', () => { voiceCollapsed = true; refresh(); });
    $('wtVoicePill').onclick = () => { voiceCollapsed = false; refresh(); };

    // ── Video window: drag repositions (unchanged) ──
    let vsx, vsy, vox, voy, vDragging = false, vDragMoved = false;
    videoWin.addEventListener('pointerdown', (e) => {
      if (videoRuntime.contains(e.target) || videoVMenu.contains(e.target)) return; // let the pill/menu own their own taps
      vDragging = true; vDragMoved = false; vsx = e.clientX; vsy = e.clientY;
      const r = videoWin.getBoundingClientRect(); vox = r.left; voy = r.top;
      videoWin.setPointerCapture(e.pointerId);
    });
    videoWin.addEventListener('pointermove', (e) => {
      if (!vDragging) return;
      const dx = e.clientX - vsx, dy = e.clientY - vsy;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) vDragMoved = true;
      if (vDragMoved) {
        const p = clampDragXY(videoWin, vox + dx, voy + dy);
        videoWin.style.left = p.left + 'px'; videoWin.style.top = p.top + 'px';
        videoWin.style.right = 'auto'; videoWin.style.bottom = 'auto';
        if (videoVMenu.classList.contains('is-open')) positionVMenu(); // keep it from drifting off-screen mid-drag
      }
    });
    videoWin.addEventListener('pointerup', () => {
      vDragging = false;
      if (vDragMoved) { snapToSafeEdge(videoWin); vDragMoved = false; }
    });
    function snapToSafeEdge(el) {
      const wrap = els.wrap.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const snapLeft = (r.left - wrap.left) < (wrap.width / 2);
      el.style.left = el.style.top = el.style.right = el.style.bottom = '';
      el.style.left = snapLeft ? '12px' : 'auto';
      el.style.right = snapLeft ? 'auto' : '12px';
      el.style.top = '12px';
    }
    // Fix 3 (2G carried over): clamp using the element's OWN current
    // size, read live off the DOM — so this keeps working correctly no
    // matter how large the circular bubble is sized in CSS, without
    // hard-coding its diameter here. Reserves room at the bottom for the
    // timeline/reaction stack/bottom nav so a dragged bubble/rectangle
    // can never end up under them.
    const DRAG_BOTTOM_RESERVE = 150;
    function clampDragXY(el, left, top) {
      const wrap = els.wrap.getBoundingClientRect();
      const w = el.offsetWidth, h = el.offsetHeight;
      const minLeft = 4, maxLeft = Math.max(minLeft, wrap.width - w - 4);
      const minTop = 4, maxTop = Math.max(minTop, wrap.height - h - DRAG_BOTTOM_RESERVE);
      return { left: Math.min(Math.max(left, minLeft), maxLeft), top: Math.min(Math.max(top, minTop), maxTop) };
    }

    // ── 2C/2D — Runtime pill tap → vertical menu expands/collapses.
    // 2G — pick up/down automatically based on free space so the menu
    // never renders under the timeline/bottom nav/Android nav area. ──
    const VMENU_HEIGHT_ESTIMATE = 250; // 5 buttons + gaps + padding, roughly
    function positionVMenu() {
      const winRect = videoWin.getBoundingClientRect();
      const wrapRect = els.wrap.getBoundingClientRect();
      const spaceBelow = wrapRect.bottom - winRect.bottom;
      const spaceAbove = winRect.top - wrapRect.top;
      const opensUp = spaceBelow < VMENU_HEIGHT_ESTIMATE && spaceAbove > spaceBelow;
      videoVMenu.classList.toggle('opens-up', opensUp);
    }
    videoRuntime.onclick = (e) => {
      e.stopPropagation();
      const isOpen = videoVMenu.classList.contains('is-open');
      if (isOpen) { videoVMenu.classList.remove('is-open'); return; }
      positionVMenu();
      videoVMenu.classList.add('is-open');
    };
    document.addEventListener('pointerdown', (e) => {
      if (!videoVMenu.classList.contains('is-open')) return;
      if (videoVMenu.contains(e.target) || videoRuntime.contains(e.target)) return;
      videoVMenu.classList.remove('is-open'); // tap outside collapses, never ends the call
    });
    $('vmenuMuteBtn').onclick = (e) => { e.stopPropagation(); try { getCall().toggleMute(); } catch (err) {} refresh(); };
    $('vmenuSpeakerBtn').onclick = (e) => {
      e.stopPropagation();
      const Call = getCall();
      // Only toggle real speaker routing if the call engine actually
      // exposes it — never fake the icon state if the platform can't
      // do it (spec 2E/2F: no faking).
      if (Call && typeof Call.toggleSpeaker === 'function') Call.toggleSpeaker();
      refresh();
    };
    $('vmenuMinBtn').onclick = (e) => { e.stopPropagation(); videoVMenu.classList.remove('is-open'); videoMinimized = true; refresh(); };
    let isSwitchingCamera = false;
    $('vmenuSwapBtn').onclick = async (e) => {
      e.stopPropagation();
      if (isSwitchingCamera) return; // debounce — flipCamera() already uses replaceTrack() on the
      isSwitchingCamera = true;      // existing sender, never touches call/signaling/timer
      const btn = $('vmenuSwapBtn');
      btn.style.opacity = '0.5';
      try {
        const Call = getCall();
        if (Call && typeof Call.flipCamera === 'function') await Call.flipCamera();
      } catch (err) { /* rear camera unavailable etc — current camera stays active */ }
      finally { isSwitchingCamera = false; btn.style.opacity = ''; }
    };
    $('vmenuEndBtn').onclick = (e) => {
      e.stopPropagation();
      videoVMenu.classList.remove('is-open');
      try { getCall().endWatchCall(); } catch (err) {}
      restoreMovieAudio();
      refresh();
    };

    // ── Circular bubble: tap restores rectangle, draggable too ──
    let bsx, bsy, box_, boy, bDragging = false, bDragMoved = false;
    videoBubble.addEventListener('pointerdown', (e) => {
      bDragging = true; bDragMoved = false; bsx = e.clientX; bsy = e.clientY;
      const r = videoBubble.getBoundingClientRect(); box_ = r.left; boy = r.top;
      videoBubble.setPointerCapture(e.pointerId);
    });
    videoBubble.addEventListener('pointermove', (e) => {
      if (!bDragging) return;
      const dx = e.clientX - bsx, dy = e.clientY - bsy;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) bDragMoved = true;
      if (bDragMoved) {
        const p = clampDragXY(videoBubble, box_ + dx, boy + dy);
        videoBubble.style.left = p.left + 'px'; videoBubble.style.top = p.top + 'px';
        videoBubble.style.right = 'auto'; videoBubble.style.bottom = 'auto';
      }
    });
    videoBubble.addEventListener('pointerup', () => {
      bDragging = false;
      if (bDragMoved) { snapToSafeEdge(videoBubble); bDragMoved = false; return; }
      videoMinimized = false; refresh(); // restore rectangle — same stream, no reconnect
    });
  }

  // Voice / Video call buttons — connect DIRECTLY through the shared call
  // engine's Watch Together bridge. No outgoing screen is ever rendered:
  // startWatchCall() creates the offer immediately, and the partner's
  // handleWatchOffer() auto-joins as soon as it arrives (see call.js) —
  // this is what makes Watch Together voice/video a direct-join
  // experience rather than a traditional ring→accept phone call.
  $('btnVoiceCall').onclick = () => {
    try {
      const Call = window.parent.Call;
      if (Call && typeof Call.startWatchCall === 'function') Call.startWatchCall('voice');
      else toast('Call system unavailable.');
    } catch (e) { toast('Call system unavailable.'); }
    wakeControls();
  };
  $('btnVideoCall').onclick = () => {
    try {
      const Call = window.parent.Call;
      if (Call && typeof Call.startWatchCall === 'function') Call.startWatchCall('video');
      else toast('Call system unavailable.');
    } catch (e) { toast('Call system unavailable.'); }
    wakeControls();
  };

  // ═══════════════════════════════════════════════════════
  // SECTION 13 — Movie-chat: a lightweight composer over the player that
  // reuses the EXISTING /api/chat backend (same table/rows real Chat
  // messages use) instead of a second messaging system.
  // ═══════════════════════════════════════════════════════
  const composer = $('chatComposer'), composerInput = $('chatComposerInput');
  $('btnChat').onclick = () => {
    composer.hidden = false;
    controlsLocked = true;
    wakeControls(true);
    setTimeout(() => composerInput.focus(), 50); // let layout settle before opening keyboard
  };
  $('chatComposerClose').onclick = closeComposer;
  function closeComposer() {
    composer.hidden = true;
    composerInput.blur();
    controlsLocked = false;
    armHideTimer();
  }
  async function sendMovieChat() {
    const text = composerInput.value.trim();
    if (!text || !COUPLE_ID || !state.room) return;
    const sessionKey = state.room.scheduled_start_at;
    if (!sessionKey) return; // no active watch session to attach this message to
    composerInput.value = '';
    const posSec = Math.round(els.video.currentTime || 0);
    showChatBubble(ctx && ctx.myName ? ctx.myName : 'You', text, true);
    addMovieChatToLog(ROLE, text, posSec, new Date().toISOString());
    try {
      // Dedicated movie_chat_messages table/endpoint — deliberately separate
      // from /api/chat (normal Chat) so these never mix (Task 4).
      await api('POST', `/${COUPLE_ID}/chat`, {
        role: ROLE, sessionKey, movieTitle: state.myTitle || null, text, positionSec: posSec
      });
    } catch (e) { toast('Message failed to send.'); }
  }
  $('chatComposerSend').onclick = sendMovieChat;
  composerInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMovieChat(); });

  // Centered subtitle-style toast, text only (no username/sender label),
  // shown ABOVE the timeline. Only one message is ever on screen — a
  // burst of messages is queued and shown one-at-a-time so the movie
  // never gets a stacked wall of bubbles.
  // Fix 5: keep the reaction toggle anchored just above the right end of
  // the timeline — measured live off the timeline row's own position
  // (not a hard-coded top:50%), so it tracks correctly across
  // portrait/landscape/fullscreen and Fit/Fill/Zoom.
  function syncReactionsAnchor() {
    const timelineRow = document.querySelector('.wt-timeline-row');
    const overlay = $('wtBottomOverlay');
    if (!timelineRow || !overlay) return;
    const wrapRect = els.wrap.getBoundingClientRect();
    const rowRect = timelineRow.getBoundingClientRect();
    const gap = (wrapRect.bottom - rowRect.top) + 12; // 12px clearance above the timeline
    els.wrap.style.setProperty('--wt-reactions-bottom', gap + 'px');
  }
  window.addEventListener('resize', syncReactionsAnchor);
  window.addEventListener('orientationchange', () => setTimeout(syncReactionsAnchor, 150));

  // Fix 4: gap between the message bubble and the timeline must survive
  // portrait/landscape and any future change to the bottom overlay's own
  // height, so it's measured live rather than hard-coded.
  function syncChatGap() {
    const overlay = $('wtBottomOverlay');
    if (!overlay) return;
    const gap = overlay.offsetHeight + 16; // 16px visible breathing room
    els.wrap.style.setProperty('--wt-chat-gap-bottom', gap + 'px');
  }
  window.addEventListener('resize', syncChatGap);
  window.addEventListener('orientationchange', () => setTimeout(syncChatGap, 150));

  const chatQueue = [];
  let chatShowing = false;
  function showChatBubble(name, text, mine) {
    chatQueue.push(text);
    if (!mine) wakeControls();
    if (!chatShowing) drainChatQueue();
  }
  function drainChatQueue() {
    const text = chatQueue.shift();
    if (text === undefined) { chatShowing = false; return; }
    chatShowing = true;
    syncChatGap();
    const layer = $('chatFloatLayer');
    layer.innerHTML = '';
    const b = document.createElement('div');
    b.className = 'wt-chat-toast';
    b.textContent = text;
    layer.appendChild(b);
    // fade/slide in, hold ~3.5s, fade out, then show next queued message
    requestAnimationFrame(() => b.classList.add('in'));
    setTimeout(() => {
      b.classList.remove('in'); b.classList.add('out');
      setTimeout(() => { b.remove(); drainChatQueue(); }, 300);
    }, 3500);
  }

  function startChatPolling() {
    clearInterval(state.chatPollTimer);
    state.lastChatTs = new Date().toISOString(); // only show messages sent after entering watch mode
    state.chatPollTimer = setInterval(async () => {
      if (document.hidden || !COUPLE_ID || !state.room || !state.room.scheduled_start_at) return;
      try {
        const sessionKey = state.room.scheduled_start_at;
        const q = '?sessionKey=' + encodeURIComponent(sessionKey) + '&after=' + encodeURIComponent(state.lastChatTs);
        const rows = await api('GET', `/${COUPLE_ID}/chat` + q);
        if (rows && rows.length) {
          rows.forEach(r => {
            state.lastChatTs = r.created_at;
            if (r.sender_role !== ROLE) {
              showChatBubble(ctx && ctx.partnerName ? ctx.partnerName : 'Partner', r.text, false);
              addMovieChatToLog(r.sender_role, r.text, r.playback_position_sec, r.created_at);
            }
          });
        }
      } catch (e) {}
    }, 2500);
  }

  // ── Movie Chat history panel (Task 4) — compact bottom sheet showing
  // this session's message log with sender/text/timestamp/movie-time,
  // separate from both the floating subtitle toasts above and from
  // normal Chat. Reuses the existing .wt-modal-backdrop/.wt-modal sheet
  // component already used by the invite/end modals — no new visual
  // language introduced.
  const movieChatLog = [];
  function addMovieChatToLog(role, text, posSec, createdAtIso) {
    movieChatLog.push({ role, text, posSec, createdAtIso });
    if (!$('movieChatLogBackdrop').hidden) renderMovieChatLog();
  }
  function renderMovieChatLog() {
    const list = $('movieChatLogList');
    if (!list) return;
    if (!movieChatLog.length) {
      list.innerHTML = '<div class="wt-chatlog-empty">No messages yet in this session.</div>';
      return;
    }
    // Conversational bubble layout (matches the main Chat page's message
    // language: right/left alignment, compact content-sized bubbles,
    // grouped consecutive messages) instead of one full-width card per
    // message. Movie time is kept — it's the one thing normal Chat
    // doesn't have — but shown as subtle inline metadata next to the
    // sent time rather than its own labeled row.
    let lastRole = null;
    list.innerHTML = movieChatLog.map((m, i) => {
      const mine = m.role === ROLE;
      const partnerName = ctx && ctx.partnerName ? ctx.partnerName : 'Partner';
      const sentAt = m.createdAtIso ? new Date(m.createdAtIso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
      const movieTime = (typeof m.posSec === 'number') ? fmtTime(m.posSec) : null;
      // Only label the sender when it's the partner and the previous
      // message in the log was from someone else — never relabel my own
      // messages, and never repeat the label down a run of consecutive
      // messages from the same person.
      const showName = !mine && m.role !== lastRole;
      const grouped = m.role === lastRole;
      lastRole = m.role;
      return `<div class="wt-chatlog-row ${mine ? 'mine' : 'theirs'}${grouped ? ' grouped' : ''}">
        <div class="wt-chatlog-bubble">
          ${showName ? `<div class="wt-chatlog-name">${escapeHtml(partnerName)}</div>` : ''}
          <div class="wt-chatlog-text">${escapeHtml(m.text)}</div>
          <div class="wt-chatlog-meta">${movieTime ? `<span class="wt-chatlog-movietime">🎬 ${movieTime}</span>` : ''}<span class="wt-chatlog-sent">${sentAt}</span></div>
        </div>
      </div>`;
    }).join('');
    list.scrollTop = list.scrollHeight;
  }
  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  const btnMovieChatLog = $('btnMovieChatLog');
  if (btnMovieChatLog) {
    btnMovieChatLog.onclick = () => { $('movieChatLogBackdrop').hidden = false; renderMovieChatLog(); };
  }
  const btnMovieChatLogClose = $('btnMovieChatLogClose');
  if (btnMovieChatLogClose) btnMovieChatLogClose.onclick = () => { $('movieChatLogBackdrop').hidden = true; };

  // ═══════════════════════════════════════════════════════
  // Watch History panel (Task 5) — the header clock/history icon
  // (wtHistoryBtn) previously did nothing; wired up here.
  // ═══════════════════════════════════════════════════════
  function groupHistoryLabel(watchedAtIso) {
    if (!watchedAtIso) return 'Earlier';
    const d = new Date(watchedAtIso), now = new Date();
    const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
    if (diffDays <= 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    return 'Earlier';
  }
  async function renderHistoryPanel() {
    const list = $('historyList');
    if (!list) return;
    list.innerHTML = '<div class="wt-history-empty">Loading…</div>';
    let rows;
    try { rows = await api('GET', `/${COUPLE_ID}/history`); }
    catch (e) { list.innerHTML = '<div class="wt-history-empty">Could not load history.</div>'; return; }
    if (!rows || !rows.length) {
      list.innerHTML = '<div class="wt-history-empty">No movies watched together yet.</div>';
      return;
    }
    let html = '';
    let lastGroup = null;
    rows.forEach(r => {
      const group = groupHistoryLabel(r.watched_at);
      if (group !== lastGroup) { html += `<div class="wt-history-group-label">${escapeHtml(group)}</div>`; lastGroup = group; }
      const when = r.watched_at ? new Date(r.watched_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
      const pct = r.completed_pct || 0;
      const isComplete = pct >= 95;
      const durationLabel = r.duration_sec ? fmtTime(r.duration_sec) : null;
      const watchedLabel = (r.last_position_sec != null && durationLabel) ? `${fmtTime(r.last_position_sec)} / ${durationLabel}` : (durationLabel || null);
      // Continue Watching only makes sense for an unfinished movie where
      // we actually have a saved position AND the same session's local
      // file can plausibly be reselected — never pretend the browser
      // still has a handle to the original file.
      const canContinue = !isComplete && r.last_position_sec != null && r.last_position_sec > 5;
      html += `<div class="wt-history-row">
        <div class="wt-history-row-top">
          <div class="wt-history-title">${escapeHtml(r.movie_title || 'Untitled movie')}</div>
          <div class="wt-history-time">${escapeHtml(when)}</div>
        </div>
        <div class="wt-history-meta">
          ${r.watched_together ? '<span class="wt-history-badge">👥 Watched together</span>' : ''}
          <span class="wt-history-badge ${isComplete ? 'is-complete' : 'is-partial'}">${isComplete ? '✓ Completed' : pct + '% watched'}</span>
          ${watchedLabel ? `<span class="wt-history-badge">${escapeHtml(watchedLabel)}</span>` : ''}
          ${r.chat_count ? `<span class="wt-history-badge">💬 ${r.chat_count}</span>` : ''}
        </div>
        ${canContinue ? `<button class="wt-history-continue" data-resume="${r.last_position_sec}" data-title="${escapeHtml(r.movie_title || '')}">Continue Watching</button>` : ''}
        <div class="wt-history-row-actions">
          <button class="wt-history-delete" data-delete-id="${r.id}">Delete</button>
        </div>
      </div>`;
    });
    list.innerHTML = html;
    list.querySelectorAll('.wt-history-delete').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.getAttribute('data-delete-id');
        if (!id || !confirm('Delete this history entry? This cannot be undone.')) return;
        btn.disabled = true;
        try {
          await api('DELETE', `/${COUPLE_ID}/history/${id}`);
          renderHistoryPanel();
        } catch (e) { toast('Could not delete — check your connection.'); btn.disabled = false; }
      };
    });
    list.querySelectorAll('.wt-history-continue').forEach(btn => {
      btn.onclick = () => {
        state.pendingResumeSec = Number(btn.getAttribute('data-resume')) || 0;
        const title = btn.getAttribute('data-title');
        $('historyBackdrop').hidden = true;
        showState('setup'); showSetupSub('empty');
        toast(title ? `Select "${title}" again to resume` : 'Select the same movie again to resume');
      };
    });
  }
  const wtHistoryBtn = $('wtHistoryBtn');
  if (wtHistoryBtn) wtHistoryBtn.onclick = () => { $('historyBackdrop').hidden = false; renderHistoryPanel(); };
  const btnHistoryClose = $('btnHistoryClose');
  if (btnHistoryClose) btnHistoryClose.onclick = () => { $('historyBackdrop').hidden = true; };
  const btnHistoryClearAll = $('btnHistoryClearAll');
  if (btnHistoryClearAll) {
    btnHistoryClearAll.onclick = async () => {
      if (!confirm('Delete ALL watch history? This also deletes all movie chat messages tied to it. This cannot be undone.')) return;
      btnHistoryClearAll.disabled = true;
      try {
        await api('DELETE', `/${COUPLE_ID}/history`);
        renderHistoryPanel();
      } catch (e) { toast('Could not clear history — check your connection.'); }
      btnHistoryClearAll.disabled = false;
    };
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 14 — End movie (with confirmation)
  // ═══════════════════════════════════════════════════════
  $('btnEndMovie').onclick = () => { controlsLocked = true; $('endModalBackdrop').hidden = false; wakeControls(true); };
  $('btnCancelEnd').onclick = () => { $('endModalBackdrop').hidden = true; controlsLocked = false; armHideTimer(); };
  $('btnConfirmEnd').onclick = async () => { $('endModalBackdrop').hidden = true; controlsLocked = false; await endSession(); };
  $('btnExitWatching').onclick = () => {
    // While fullscreen, this button's first job is exiting fullscreen
    // (spec §28's "clear EXIT FULLSCREEN behavior") — it does NOT also
    // open the End Movie confirmation in the same tap; tap again
    // afterward for that.
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
    controlsLocked = true; $('endModalBackdrop').hidden = false; wakeControls(true);
  };

  async function endSession() {
    hideBanner();
    // Mandatory ordering (spec §11): terminate Watch Together media FIRST,
    // then the movie session — never leave WebRTC running after exit.
    clearWatchCallSession();
    try {
      const posSec = Math.round(els.video.currentTime || 0);
      const completedPct = (state.myDuration && posSec) ? Math.min(100, Math.round((posSec / state.myDuration) * 100)) : 0;
      const room = await api('POST', `/${COUPLE_ID}/end`, { role: ROLE, movieTitle: state.myTitle, durationSec: state.myDuration, completedPct, sessionKey: state.room && state.room.scheduled_start_at, positionSec: posSec });
      broadcastRoom(room);
      state.room = room;
    } catch (e) {}

    // Full cleanup — spec §End Movie 1–10.
    clearAllTimers();
    state.cloudMovieId = null;
    els.video.pause();
    els.video.removeAttribute('src'); els.video.load();
    if (state.localObjectUrl) { URL.revokeObjectURL(state.localObjectUrl); state.localObjectUrl = null; }
    composer.hidden = true; controlsLocked = false;
    if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch (e) {} }
    try { screen.orientation && screen.orientation.unlock && screen.orientation.unlock(); } catch (e) {}

    state.myTitle = null; state.myDuration = null; state.localFile = null;
    movieChatLog.length = 0;
    if ($('movieChatLogBackdrop')) $('movieChatLogBackdrop').hidden = true;
    showState('setup'); showSetupSub('empty');
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 15 — Partner presence / left-room handling
  // ═══════════════════════════════════════════════════════
  function updatePartnerPresenceUI() {
    if (state.uiState === 'watching') {
      setStatusPill(_presenceState.partnerOnline ? null : 'Partner reconnecting…', _presenceState.partnerOnline ? null : 'warn');
    }
    if (!_presenceState.partnerOnline && state.room && state.room.status === 'watching') {
      showBanner('Partner left the room.', [
        { label: 'Continue Alone', onClick: hideBanner },
        { label: 'Wait for Partner', secondary: true, onClick: hideBanner },
        { label: 'End Session', secondary: true, onClick: endSession }
      ]);
    } else if (_presenceState.partnerOnline) {
      hideBanner();
    }
  }

  // ═══════════════════════════════════════════════════════
  // SECTION 16 — Reconnect handling (network + app resume)
  // ═══════════════════════════════════════════════════════
  async function reconcile() {
    if (!COUPLE_ID || state.reconnectPending) return;
    state.reconnectPending = true;
    try {
      const room = await api('GET', `/${COUPLE_ID}`);
      state.reconnectPending = false;
      if (!room) return;
      state.room = room;
      if (room.action_seq && room.action_seq > state.lastActionSeq) state.lastActionSeq = room.action_seq;
      if (state.uiState === 'watching') {
        const target = expectedPosition(room);
        if (Math.abs(els.video.currentTime - target) > 1) els.video.currentTime = target;
        if (room.playing) els.video.play().catch(() => {}); else els.video.pause();
        updatePlayPauseIcon();
      } else {
        renderFromRoom();
      }
      hideBanner();
    } catch (e) {
      state.reconnectPending = false;
      if (state.uiState === 'watching') showBanner('⚠️ Connection lost. Trying to reconnect…', []);
    }
  }
  window.addEventListener('online', reconcile);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reconcile(); });
  window.addEventListener('pageshow', reconcile);
  window.addEventListener('focus', reconcile);


  // ═══════════════════════════════════════════════════════
  // SECTION 16b — More Options (player ⋮ menu) + local-only extras
  //   • Movie Info          — title / length / source / size
  //   • Subtitles           — load a .srt/.vtt from THIS device (each
  //                           partner loads their own; nothing is uploaded)
  //   • Screen Fit          — Fit / Fill / Zoom (same as fullscreen cycle)
  //   • Picture in Picture  — browser PiP on this device
  //   • Sleep Timer         — pauses the movie for BOTH of you via the
  //                           normal sendAction(false) path
  //   • Keep Screen On      — Wake Lock while the movie is playing
  //   • End Room            — opens the existing End confirmation
  // None of this touches room state, sync, calls, chat or R2 code.
  // ═══════════════════════════════════════════════════════
  const more = { subsUrl: null, subsName: '', sleepMin: 0, sleepTimer: null, wake: null };
  const SLEEP_STEPS = [0, 15, 30, 45, 60];

  function srtToVtt(txt) {
    txt = String(txt || '').replace(/^\uFEFF/, '').replace(/\r/g, '');
    if (/^WEBVTT/.test(txt)) return txt;
    return 'WEBVTT\n\n' + txt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  }
  function refreshSubsLabels() {
    const v = more.subsUrl ? 'On' : 'Off';
    if ($('moreSubsVal')) $('moreSubsVal').textContent = v;
    if ($('pbSubsVal')) $('pbSubsVal').textContent = v;
    const t = $('pbSubs'); if (t) t.classList.toggle('is-on', !!more.subsUrl);
  }
  function removeSubs() {
    els.video.querySelectorAll('track').forEach(t => t.remove());
    if (more.subsUrl) { try { URL.revokeObjectURL(more.subsUrl); } catch (e) {} }
    more.subsUrl = null; more.subsName = '';
    refreshSubsLabels();
  }
  function pickSubs() {
    if (more.subsUrl) { removeSubs(); toast('Subtitles off'); return; }
    $('subsInput').click();
  }
  $('subsInput').onchange = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const vtt = srtToVtt(await f.text());
      removeSubs();
      more.subsUrl = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
      more.subsName = f.name;
      const tr = document.createElement('track');
      tr.kind = 'subtitles'; tr.label = 'Subtitles'; tr.srclang = 'en'; tr.src = more.subsUrl; tr.default = true;
      els.video.appendChild(tr);
      try { tr.track.mode = 'showing'; } catch (er) {}
      refreshSubsLabels();
      toast('Subtitles loaded ✓');
    } catch (err) { toast('Could not read that subtitle file'); }
  };
  if ($('pbSubs')) $('pbSubs').onclick = pickSubs;

  async function setWake(on) {
    try {
      if (on && 'wakeLock' in navigator && !more.wake) {
        more.wake = await navigator.wakeLock.request('screen');
        more.wake.addEventListener('release', () => { more.wake = null; });
      } else if (!on && more.wake) { await more.wake.release(); more.wake = null; }
    } catch (e) { more.wake = null; }
  }
  const awakeOn = () => !$('moreAwake') || $('moreAwake').checked;
  els.video.addEventListener('playing', () => { if (awakeOn()) setWake(true); });
  els.video.addEventListener('pause', () => setWake(false));
  els.video.addEventListener('ended', () => setWake(false));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !els.video.paused && awakeOn()) setWake(true); });
  try { const saved = localStorage.getItem('wt_keep_awake'); if (saved === '0') $('moreAwake').checked = false; } catch (e) {}
  $('moreAwake').onchange = () => {
    try { localStorage.setItem('wt_keep_awake', awakeOn() ? '1' : '0'); } catch (e) {}
    setWake(awakeOn() && !els.video.paused);
  };

  function setSleep(min) {
    clearTimeout(more.sleepTimer); more.sleepTimer = null; more.sleepMin = min;
    $('moreSleepVal').textContent = min ? min + ' min' : 'Off';
    if (!min) return;
    more.sleepTimer = setTimeout(() => {
      more.sleepTimer = null; more.sleepMin = 0; $('moreSleepVal').textContent = 'Off';
      if (state.uiState === 'watching' && !els.video.paused) {
        els.video.pause(); sendAction(false, els.video.currentTime); updatePlayPauseIcon();
        setStatusPill('Paused', 'warn');
        toast('Sleep timer — paused for both of you 🌙', 5000);
      }
    }, min * 60000);
  }

  function movieInfoHtml() {
    const row = (k, v) => v ? `<div><b>${k}:</b> ${v}</div>` : '';
    const dur = isFinite(els.video.duration) && els.video.duration > 0 ? els.video.duration : state.myDuration;
    let size = '';
    if (state.cloudMovieId) { const m = cloud.movies.find(x => x.id === state.cloudMovieId); if (m) size = fmtBytes(m.sizeBytes); }
    return row('Title', $('wtNowTitle').textContent.replace(/[<>&]/g, '')) +
      row('Length', dur ? fmtTime(dur) : '') +
      row('Source', state.cloudMovieId ? 'Shared Cloud Storage' : 'This device (Direct)') +
      row('Size', size) +
      row('Subtitles', more.subsName ? more.subsName.replace(/[<>&]/g, '') : 'Off');
  }
  function openMore() {
    $('moreInfoBox').hidden = true;
    $('moreFitVal').textContent = DISPLAY_MODES[displayModeIdx].replace(/^./, c => c.toUpperCase());
    $('morePip').hidden = !(document.pictureInPictureEnabled && els.video.requestPictureInPicture);
    refreshSubsLabels();
    // Inside fullscreen only the fullscreen element is painted — host the sheet there.
    (document.fullscreenElement || document.body).appendChild($('moreBackdrop'));
    controlsLocked = true; $('moreBackdrop').hidden = false; wakeControls(true);
    if (window.lucide) window.lucide.createIcons();
  }
  function closeMore() { $('moreBackdrop').hidden = true; controlsLocked = false; armHideTimer(); }

  $('btnMore').onclick = openMore;
  $('btnMoreClose').onclick = closeMore;
  $('moreBackdrop').addEventListener('click', (e) => { if (e.target === $('moreBackdrop')) closeMore(); });
  $('moreInfo').onclick = () => { const b = $('moreInfoBox'); b.innerHTML = movieInfoHtml(); b.hidden = !b.hidden; };
  $('moreSubs').onclick = () => { pickSubs(); };
  $('moreFit').onclick = () => {
    displayModeIdx = (displayModeIdx + 1) % DISPLAY_MODES.length;
    applyDisplayMode(DISPLAY_MODES[displayModeIdx]);
    $('moreFitVal').textContent = DISPLAY_MODES[displayModeIdx].replace(/^./, c => c.toUpperCase());
  };
  $('morePip').onclick = async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await els.video.requestPictureInPicture();
      closeMore();
    } catch (e) { toast('Picture in Picture isn’t available here'); }
  };
  $('moreSleep').onclick = () => { setSleep(SLEEP_STEPS[(SLEEP_STEPS.indexOf(more.sleepMin) + 1) % SLEEP_STEPS.length]); };
  $('moreEnd').onclick = () => { $('moreBackdrop').hidden = true; $('btnEndMovie').click(); };

  // ═══════════════════════════════════════════════════════
  // SECTION 17 — Boot
  // ═══════════════════════════════════════════════════════
  $('wtBack').onclick = () => { try { window.parent.postMessage({ type: 'uwl:close-watch-together' }, '*'); } catch (e) {} };

  
  // lucide.js is loaded with `defer`, so it finishes after this
  // synchronous script runs — wait for DOMContentLoaded (which fires
  // after all defer scripts) before the first icon render.
  document.addEventListener('DOMContentLoaded', () => { if (window.lucide) window.lucide.createIcons(); });
  if (document.readyState !== 'loading' && window.lucide) window.lucide.createIcons();

  // ── Android/device Back support ────────────────────────────
  // Watch Together lives in its own same-origin iframe (like Chat/Live
  // Map/Globe/Places/Meet Planner/Collection/Music/Games). Back must
  // unwind its stacked overlays one at a time: the end-session confirm,
  // the movie chat log, the watch-history sheet, the incoming invite,
  // the video-call options menu, then an expanded video call (minimizes
  // to the bubble rather than ending the call) — instead of falling
  // straight through to page navigation. Ending the session itself
  // always requires the explicit End button, never Back.
  function closeTopOverlayIfOpen() {
    if (window.MC && window.MC.closeTop && window.MC.closeTop()) return true;
    if ($('moreBackdrop') && !$('moreBackdrop').hidden) { closeMore(); return true; }
    if ($('endModalBackdrop') && !$('endModalBackdrop').hidden) { $('btnCancelEnd')?.click(); return true; }
    if ($('movieChatLogBackdrop') && !$('movieChatLogBackdrop').hidden) { $('btnMovieChatLogClose')?.click(); return true; }
    if ($('historyBackdrop') && !$('historyBackdrop').hidden) { $('btnHistoryClose')?.click(); return true; }
    if ($('inviteModalBackdrop') && !$('inviteModalBackdrop').hidden) { $('btnDeclineInvite')?.click(); return true; }
    if ($('wtVideoVMenu')?.classList.contains('is-open')) { $('wtVideoVMenu').classList.remove('is-open'); return true; }
    if ($('wtVideoWin') && !$('wtVideoWin').hidden) { $('vmenuMinBtn')?.click(); return true; }
    return false;
  }
  window.closeTopOverlayIfOpen = closeTopOverlayIfOpen;

  (async function init() {
    if (!COUPLE_ID) { toast('Could not find your couple pairing.'); showState('setup'); showSetupSub('empty'); return; }
    setupRealtime();
    try {
      const room = await api('GET', `/${COUPLE_ID}`);
      state.room = room;
      if (room && room.action_seq) state.lastActionSeq = room.action_seq;
      renderFromRoom();

    } catch (e) { showState('setup'); showSetupSub('empty'); }
  })();


})();