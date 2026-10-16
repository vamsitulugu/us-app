/* ═══════════════════════════════════════════════════════════════
   MUSIC · player engine
   • AudioService — queue, shuffle/repeat, gapless-ish auto-advance,
     real crossfade (two decks), offline source, media-session controls,
     sleep timer, resume-where-you-left-off.
   • Sound chain — Web Audio graph (vocal reduction, bass/treble,
     reverb/echo, volume normalisation). It is created lazily, only when a
     feature that needs it is switched on, so the default path is a plain
     <audio> element with zero Web Audio involvement.
   • MX.offline — downloads songs into the Cache API for offline playback.

   The public AudioService surface is kept compatible with couple-karaoke.js:
   on('play'|'state'|'time'|'error'), audio, play(list,id), prev(), next(),
   currentSong().
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const MX = window.MX;

  /* ═══════════════════════════════════════════════════════
     OFFLINE DOWNLOADS
  ═══════════════════════════════════════════════════════ */
  const CACHE_NAME = 'mx-music-v1';
  const off = (MX.offline = {});
  const urlCache = new Map(); // songId -> blob: URL (kept short, revoked oldest-first)
  off.supported = () => typeof caches !== 'undefined' && !!window.isSecureContext;
  const manifest = () => MX.cache.get('dl', {});
  const saveManifest = (m) => MX.cache.set('dl', m);
  off.has = (song) => { if (!song) return false; const e = manifest()[song.id]; return !!e && e.url === song.audio_url; };
  off.count = () => Object.keys(manifest()).length;
  off.bytes = () => Object.values(manifest()).reduce((n, e) => n + (e.size || 0), 0);
  off.progress = {}; // songId -> 0..1 while downloading

  off.download = async function (song) {
    if (!song || !song.audio_url) return false;
    if (!off.supported()) { MX.toast("Downloads aren't supported in this browser"); return false; }
    if (off.has(song)) return true;
    if (off.progress[song.id] != null) return false; // already in flight
    if (!MX.online()) { MX.toast("You're offline"); return false; }
    off.progress[song.id] = 0; MX.emit('downloads', song.id);
    try {
      const res = await fetch(song.audio_url, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const total = Number(res.headers.get('content-length')) || song.file_size || 0;
      let blob;
      if (res.body && res.body.getReader && total) {
        const reader = res.body.getReader(); const chunks = []; let got = 0;
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          chunks.push(value); got += value.length;
          off.progress[song.id] = Math.min(.99, got / total); MX.emit('downloads', song.id);
        }
        blob = new Blob(chunks, { type: res.headers.get('content-type') || 'audio/mpeg' });
      } else { blob = await res.blob(); }
      const cache = await caches.open(CACHE_NAME);
      await cache.put(song.audio_url, new Response(blob, { headers: { 'Content-Type': blob.type || 'audio/mpeg', 'Content-Length': String(blob.size) } }));
      const m = manifest(); m[song.id] = { url: song.audio_url, size: blob.size, at: Date.now() }; saveManifest(m);
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
      return true;
    } catch (e) {
      const quota = e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''));
      MX.toast(quota ? 'Not enough storage on this device' : 'Download failed — ' + (e.message || 'try again'));
      return false;
    } finally { delete off.progress[song.id]; MX.emit('downloads', song.id); }
  };
  off.remove = async function (song) {
    if (!song) return;
    const m = manifest(); const e = m[song.id]; if (!e) return;
    delete m[song.id]; saveManifest(m);
    const u = urlCache.get(song.id); if (u) { URL.revokeObjectURL(u); urlCache.delete(song.id); }
    try { if (off.supported()) { const c = await caches.open(CACHE_NAME); await c.delete(e.url); } } catch (err) {}
    MX.emit('downloads', song.id);
  };
  off.clear = async function () {
    urlCache.forEach((u) => URL.revokeObjectURL(u)); urlCache.clear();
    saveManifest({});
    try { if (typeof caches !== 'undefined') await caches.delete(CACHE_NAME); } catch (e) {}
    MX.emit('downloads');
  };
  off.blobUrl = async function (song) {
    if (!off.has(song) || !off.supported()) return null;
    if (urlCache.has(song.id)) return urlCache.get(song.id);
    try {
      const c = await caches.open(CACHE_NAME); const r = await c.match(song.audio_url);
      if (!r) { const m = manifest(); delete m[song.id]; saveManifest(m); MX.emit('downloads', song.id); return null; }
      const u = URL.createObjectURL(await r.blob());
      urlCache.set(song.id, u);
      if (urlCache.size > 4) { const first = urlCache.keys().next().value; URL.revokeObjectURL(urlCache.get(first)); urlCache.delete(first); }
      return u;
    } catch (e) { return null; }
  };
  /* Downloads that survived a cache clear by the OS are dropped from the manifest. */
  off.verify = async function () {
    if (!off.supported()) return;
    try {
      const c = await caches.open(CACHE_NAME); const m = manifest(); let changed = false;
      for (const id of Object.keys(m)) { if (!(await c.match(m[id].url))) { delete m[id]; changed = true; } }
      if (changed) { saveManifest(m); MX.emit('downloads'); }
    } catch (e) {}
  };
  off.downloadMany = async function (songs) {
    const todo = songs.filter((s) => !off.has(s)); if (!todo.length) { MX.toast('Everything is already downloaded'); return; }
    MX.toast('Downloading ' + todo.length + ' song' + (todo.length > 1 ? 's' : '') + '…');
    let ok = 0;
    for (const s of todo) { if (!MX.online()) break; if (await off.download(s)) ok++; }
    MX.toast(ok === todo.length ? '✓ ' + ok + ' downloaded' : ok + ' of ' + todo.length + ' downloaded');
  };

  /* ═══════════════════════════════════════════════════════
     AUDIO SERVICE
  ═══════════════════════════════════════════════════════ */
  const listeners = {};
  const on = (e, fn) => { (listeners[e] = listeners[e] || []).push(fn); };
  const emit = (e, p) => (listeners[e] || []).slice().forEach((fn) => { try { fn(p); } catch (err) { console.error('[audio]', e, err); } });
  const mkDeck = () => {
    const a = new Audio(); a.preload = 'auto'; a.crossOrigin = 'anonymous'; a.setAttribute('playsinline', ''); a.style.display = 'none';
    document.body.appendChild(a); return a;
  };
  const decks = [mkDeck(), mkDeck()];
  let active = 0, queue = [], origQueue = [], qi = -1, shuffle = false, repeat = 'off', rate = 1;
  let loadToken = 0, curObj = null, corsFailed = false, retriedCors = false;
  let xf = null;               // active crossfade { from, to, timer }
  let pendingStart = 0;        // resume position for the next load
  let listenAcc = 0, lastTick = 0, countedKey = null, trackStamp = 0;
  let sleepTimer = null, sleepEnd = false, sleepUntil = 0;

  const byId = (id) => MX.lib.byId(id);
  const currentSong = () => { if (qi < 0) return null; const s = byId(queue[qi]); if (s) { curObj = s; return s; } return curObj && String(curObj.id) === String(queue[qi]) ? curObj : null; };
  const isRoomActive = () => !!document.querySelector('#ckRoom.open');
  const deck = () => decks[active];

  /* ── Web Audio graph (lazy) ────────────────────────────── */
  const G = { ctx: null, ok: false, failed: false, gains: [], n: {} };
  function ensureGraph() {
    if (G.ok) { if (G.ctx.state === 'suspended') G.ctx.resume().catch(() => {}); return true; }
    if (G.failed || corsFailed) return false;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { G.failed = true; return false; }
    let ctx, sources = [];
    try {
      ctx = new AC();
      const n = G.n;
      const input = ctx.createGain();
      const dry = ctx.createGain();
      const splitter = ctx.createChannelSplitter(2), inv = ctx.createGain(), sum = ctx.createGain();
      inv.gain.value = -1;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 180;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
      const cut = ctx.createGain(), keep = ctx.createGain(), bus = ctx.createGain();
      const bass = ctx.createBiquadFilter(); bass.type = 'lowshelf'; bass.frequency.value = 200;
      const treble = ctx.createBiquadFilter(); treble.type = 'highshelf'; treble.frequency.value = 4500;
      const comp = ctx.createDynamicsCompressor(); comp.knee.value = 30; comp.attack.value = .003; comp.release.value = .25; comp.threshold.value = -24; comp.ratio.value = 1;
      const makeup = ctx.createGain();
      const master = ctx.createGain();
      const rvSend = ctx.createGain(), conv = ctx.createConvolver();
      const dlSend = ctx.createGain(), dl = ctx.createDelay(1), fb = ctx.createGain();
      dl.delayTime.value = .28; fb.gain.value = .34; rvSend.gain.value = 0; dlSend.gain.value = 0;
      const analyser = ctx.createAnalyser(); analyser.fftSize = 256;
      // vocal reducer: (L − R) keeps what's different between the channels, dropping the centred vocal
      input.connect(dry); dry.connect(bus);
      input.connect(splitter); splitter.connect(sum, 0); splitter.connect(inv, 1); inv.connect(sum); sum.connect(hp); hp.connect(cut); cut.connect(bus);
      input.connect(lp); lp.connect(keep); keep.connect(bus);
      cut.gain.value = 0; keep.gain.value = 0;
      bus.connect(bass); bass.connect(treble); treble.connect(comp); comp.connect(makeup); makeup.connect(master);
      makeup.connect(rvSend); rvSend.connect(conv); conv.connect(master);
      makeup.connect(dlSend); dlSend.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(master);
      master.connect(analyser); analyser.connect(ctx.destination);
      // impulse response for the reverb (decaying noise)
      const len = Math.floor(ctx.sampleRate * 2.2), buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4); }
      conv.buffer = buf;
      Object.assign(n, { dry, cut, keep, bass, treble, comp, makeup, rvSend, dlSend, analyser, master });
      // sources last: from here the elements are captured by the graph, so connect straight away
      decks.forEach((d, i) => { const s = ctx.createMediaElementSource(d); sources.push(s); const g = ctx.createGain(); G.gains[i] = g; s.connect(g); g.connect(input); });
      G.ctx = ctx; G.ok = true;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      applyFx();
      return true;
    } catch (e) {
      console.warn('[audio] graph unavailable', e); G.failed = true;
      // never leave an element captured but silent
      try { sources.forEach((s) => s.connect(ctx.destination)); } catch (err) {}
      return false;
    }
  }
  function applyFx() {
    if (!G.ok) return;
    const fx = MX.settings.get('fx') || {}, t = G.ctx.currentTime, n = G.n;
    const vocal = !!MX.settings.get('vocalReduce'), norm = !!MX.settings.get('normalize');
    const set = (p, v) => { try { p.setTargetAtTime(v, t, .03); } catch (e) { p.value = v; } };
    set(n.dry.gain, vocal ? 0 : 1); set(n.cut.gain, vocal ? 1.25 : 0); set(n.keep.gain, vocal ? 1 : 0);
    set(n.bass.gain, +fx.bass || 0); set(n.treble.gain, +fx.treble || 0);
    set(n.rvSend.gain, (+fx.reverb || 0) * 1.1); set(n.dlSend.gain, (+fx.delay || 0) * .7);
    n.comp.ratio.value = norm ? 4 : 1; set(n.makeup.gain, norm ? 1.25 : 1);
  }
  const fxActive = () => { const fx = MX.settings.get('fx') || {}; return !!(MX.settings.get('vocalReduce') || MX.settings.get('normalize') || fx.reverb || fx.delay || fx.bass || fx.treble); };
  function syncGraphNeed() { if (fxActive()) { if (!ensureGraph()) MX.toast("Sound effects aren't available for this audio source"); else applyFx(); } else if (G.ok) applyFx(); }
  MX.on('settings', (e) => { if (['vocalReduce', 'normalize', 'fx'].includes(e.key)) syncGraphNeed(); });

  let volumeWorks = null;
  const canSetVolume = () => { if (volumeWorks === null) { const t = decks[0]; const o = t.volume; t.volume = .5; volumeWorks = Math.abs(t.volume - .5) < .01; t.volume = o; } return volumeWorks; };
  const canFade = () => G.ok || canSetVolume() || ensureGraph();
  function setLevel(i, v) { if (G.ok && G.gains[i]) G.gains[i].gain.value = v; else if (canSetVolume()) decks[i].volume = v; }

  /* ── source resolution ─────────────────────────────────── */
  // Songs added from search use signed Deezer preview links that expire — fetch a fresh one when needed.
  const dzUrl = (u) => /dzcdn\.net/i.test(u || '');
  const dzExpired = (u) => { const m = /(?:^|[?&~=])exp=(\d+)/.exec(u || ''); return m ? (+m[1] * 1000 < Date.now() + 5 * 60 * 1000) : false; };
  async function refreshDeezer(song) {
    try {
      const r = await fetch(MX.API + '/api/music/deezer-refresh?title=' + encodeURIComponent(song.title || '') + '&artist=' + encodeURIComponent(song.artist || ''), { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null; const j = await r.json(); return j.preview || null;
    } catch (e) { return null; }
  }
  const dzTried = {};
  async function resolveSrc(song) {
    const b = await off.blobUrl(song); if (b) return b;
    if (dzUrl(song.audio_url) && dzExpired(song.audio_url)) { const f = await refreshDeezer(song); if (f) { song.audio_url = f; return f; } }
    return song.audio_url;
  }

  /* ── core playback ─────────────────────────────────────── */
  function cancelCrossfade(finish) {
    if (!xf) return;
    clearInterval(xf.timer);
    const { from, to } = xf; xf = null;
    try { decks[from].pause(); } catch (e) {}
    setLevel(from, 1); setLevel(to, 1);
    if (finish === false) { try { decks[to].pause(); } catch (e) {} }
  }
  function startFlags(s) { trackStamp = Date.now(); listenAcc = 0; lastTick = 0; countedKey = null; curObj = s; }

  async function playCurrent(opts) {
    opts = opts || {};
    const s = currentSong(); if (!s) return;
    const token = ++loadToken;
    cancelCrossfade();
    emit('track', s); emit('queue');   // update the mini player / title right away, before the (async) source lookup
    emit('loading', true);
    let url;
    try { url = await resolveSrc(s); } catch (e) { url = s.audio_url; }
    if (token !== loadToken) return;
    if (!url) { try { deck().pause(); } catch (e) {} emit('loading', false); emit('error', 'This song has no audio file — try re-adding it.'); emit('state', false); return; }
    if (!MX.online() && !/^blob:/.test(url)) {
      emit('loading', false);
      try { deck().pause(); } catch (e) {}  // never leave the previous song playing under the wrong title
      const nxt = findPlayable(qi, 1);
      if (nxt >= 0 && nxt !== qi && !opts.noSkip) { MX.toast("Offline — skipping to a downloaded song"); qi = nxt; return playCurrent({ noSkip: true }); }
      emit('error', "You're offline — download songs to play them without internet."); emit('state', false); return;
    }
    const d = deck(); const other = decks[1 - active];
    try { other.pause(); } catch (e) {}
    startFlags(s); setLevel(active, 1);
    if (G.ok && G.ctx.state === 'suspended') G.ctx.resume().catch(() => {});
    d.src = url; d.load(); d.playbackRate = rate;
    const startAt = opts.startAt != null ? opts.startAt : pendingStart; pendingStart = 0;
    if (startAt > 0) { const seek = () => { try { d.currentTime = startAt; } catch (e) {} d.removeEventListener('loadedmetadata', seek); }; d.addEventListener('loadedmetadata', seek); }
    if (opts.paused) { emit('loading', false); emit('state', false); return; }
    try {
      await d.play();
      if (token !== loadToken) return;
      emit('loading', false); emit('play', s); pushMediaSession(s); saveSession();
    } catch (err) {
      if (token !== loadToken) return;
      emit('loading', false);
      if (err && err.name === 'NotAllowedError') { emit('state', false); emit('error', 'Tap play to start the music.'); }
      else if (err && err.name !== 'AbortError') emit('error', 'Playback failed — ' + (err.message || 'unknown error'));
    }
  }
  function findPlayable(from, dir) {
    for (let k = 1; k <= queue.length; k++) {
      const i = ((from + dir * k) % queue.length + queue.length) % queue.length;
      const s = byId(queue[i]); if (s && (MX.online() || off.has(s))) return i;
    }
    return -1;
  }
  function peekNext() {
    if (!queue.length) return -1;
    if (qi + 1 < queue.length) return qi + 1;
    return repeat === 'all' ? 0 : -1;
  }

  function reshuffle() {
    const cur = queue[qi]; const rest = MX.shuffleArray(queue.filter((id, i) => i !== qi));
    queue = cur != null ? [cur, ...rest] : rest; qi = cur != null ? 0 : -1;
  }
  function play(list, id, opts) {
    opts = opts || {};
    origQueue = list.map((s) => s.id); queue = origQueue.slice(); qi = queue.indexOf(id);
    if (qi < 0) { queue = [id]; origQueue = [id]; qi = 0; }
    if (shuffle && !opts.keepOrder) reshuffle();
    return playCurrent(opts);
  }
  function playShuffled(list) {
    if (!list.length) return; shuffle = true; emit('shuffle', true);
    const start = list[Math.floor(Math.random() * list.length)];
    play(list, start.id);
  }
  function togglePlay() {
    const s = currentSong(); if (!s) { emit('error', 'Pick a song first'); return; }
    const d = deck();
    if (!d.src || d.ended || d.error) { playCurrent({ startAt: d.ended ? 0 : undefined }); return; }
    if (d.paused) { if (G.ok && G.ctx.state === 'suspended') G.ctx.resume().catch(() => {}); d.play().catch((e) => emit('error', 'Playback failed — ' + e.message)); }
    else { cancelCrossfade(); d.pause(); }
  }
  function pause() { cancelCrossfade(); deck().pause(); }
  function stop() { loadToken++; cancelCrossfade(); decks.forEach((d) => { try { d.pause(); d.removeAttribute('src'); d.load(); } catch (e) {} }); queue = []; origQueue = []; qi = -1; curObj = null; emit('track', null); emit('state', false); emit('queue'); MX.cache.del('session'); }
  function next(manual) {
    if (!queue.length) return;
    if (repeat === 'one' && !manual) { const d = deck(); d.currentTime = 0; d.play().catch(() => {}); return; }
    let i = qi + 1;
    if (i >= queue.length) { if (repeat === 'all' || manual) i = 0; else { endOfQueue(); return; } }
    qi = i; playCurrent();
  }
  function endOfQueue() { const d = deck(); try { d.pause(); d.currentTime = 0; } catch (e) {} emit('state', false); emit('queueEnd'); emit('time', { cur: 0, dur: d.duration || 0 }); }
  function prev() {
    if (!queue.length) return;
    const d = deck(); if (d.currentTime > 3) { d.currentTime = 0; return; }
    qi = qi - 1 < 0 ? (repeat === 'all' ? queue.length - 1 : 0) : qi - 1; playCurrent();
  }
  function jumpTo(i) { if (i < 0 || i >= queue.length) return; qi = i; playCurrent(); }
  function setShuffle(v) {
    if (shuffle === v) return; shuffle = v;
    if (queue.length) {
      if (v) reshuffle(); else { const cur = queue[qi]; queue = origQueue.filter((id) => byId(id) || id === cur); qi = Math.max(0, queue.indexOf(cur)); }
    }
    emit('shuffle', v); emit('queue'); saveSession();
  }
  function cycleRepeat() { repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off'; emit('repeat', repeat); saveSession(); }
  function seek(t) { const d = deck(); if (isFinite(d.duration)) d.currentTime = Math.max(0, Math.min(d.duration, t)); }
  function seekPct(p) { const d = deck(); if (isFinite(d.duration)) d.currentTime = Math.max(0, Math.min(1, p)) * d.duration; }
  function setRate(r) { rate = r; decks.forEach((d) => { d.playbackRate = r; }); emit('rate', r); }
  function queueSongs() { return queue.map(byId).filter(Boolean); }
  function addToQueue(ids, o) {
    ids = [].concat(ids).map(String); if (!ids.length) return;
    if (qi < 0) { origQueue = ids.slice(); queue = ids.slice(); qi = 0; playCurrent(); return; }
    if (o && o.next) { queue.splice(qi + 1, 0, ...ids); origQueue.push(...ids); } else { queue.push(...ids); origQueue.push(...ids); }
    emit('queue'); saveSession();
  }
  function removeFromQueue(id) {
    id = String(id); const idx = queue.findIndex((x) => String(x) === id); if (idx < 0) return;
    queue.splice(idx, 1); origQueue = origQueue.filter((x) => String(x) !== id);
    if (idx < qi) qi--; else if (idx === qi) { if (qi >= queue.length) qi = queue.length - 1; if (qi >= 0) playCurrent(); }
    emit('queue');
  }

  /* ── crossfade ─────────────────────────────────────────── */
  async function startCrossfade(cf) {
    const ni = peekNext(); if (ni < 0) return;
    const ns = byId(queue[ni]); if (!ns) return;
    if (!MX.online() && !off.has(ns)) return;
    if (!canFade()) return;
    xf = { pending: true }; const token = loadToken;
    let url; try { url = await resolveSrc(ns); } catch (e) { xf = null; return; }
    if (token !== loadToken || !xf) { xf = null; return; }
    const from = active, to = 1 - active, dTo = decks[to];
    dTo.src = url; dTo.load(); dTo.playbackRate = rate; setLevel(to, 0);
    try { await dTo.play(); } catch (e) { xf = null; setLevel(to, 1); return; }
    if (token !== loadToken || !xf) { try { dTo.pause(); } catch (e) {} xf = null; return; }
    qi = ni; active = to; startFlags(ns); loadToken++;
    const t0 = performance.now();
    xf = { from, to, timer: setInterval(() => {
      const p = Math.min(1, (performance.now() - t0) / (cf * 1000));
      setLevel(from, 1 - p); setLevel(to, p);
      if (p >= 1) { clearInterval(xf.timer); try { decks[from].pause(); } catch (e) {} setLevel(from, 1); xf = null; }
    }, 60) };
    emit('track', ns); emit('play', ns); emit('queue'); pushMediaSession(ns); saveSession();
  }

  /* ── deck events ───────────────────────────────────────── */
  decks.forEach((d, i) => {
    const isActive = () => i === active;
    d.addEventListener('timeupdate', () => {
      if (!isActive()) return;
      const cur = d.currentTime, dur = d.duration || 0;
      emit('time', { cur, dur });
      // listen time → one "play" counted per listen
      if (!d.paused) { if (lastTick && cur >= lastTick && cur - lastTick < 1.5) listenAcc += cur - lastTick; lastTick = cur; }
      const s = currentSong();
      if (s && !countedKey && listenAcc >= Math.min(8, Math.max(3, dur * .3))) { countedKey = trackStamp; registerPlay(s); }
      const cf = +MX.settings.get('crossfade') || 0;
      if (cf && !xf && repeat !== 'one' && dur > cf * 2 + 2 && dur - cur <= cf && !isRoomActive() && !sleepEnd) startCrossfade(cf);
    });
    d.addEventListener('play', () => { if (!isActive()) return; emit('state', true); });
    d.addEventListener('pause', () => { if (!isActive() || d.ended) return; emit('state', false); saveSession(); });
    d.addEventListener('playing', () => { if (isActive()) emit('loading', false); });
    d.addEventListener('waiting', () => { if (isActive() && !d.paused) emit('loading', true); });
    d.addEventListener('ended', () => {
      if (!isActive() || xf) return;
      if (sleepEnd) { sleepEnd = false; sleepUntil = 0; emit('sleep', null); emit('state', false); return; }
      next(false);
    });
    d.addEventListener('error', () => {
      if (!isActive() || !d.src) return;
      const remote = /^https?:/i.test(d.src);
      // Storage without CORS headers: retry once as a plain (non-graph) element.
      if (remote && d.crossOrigin && !retriedCors && !G.ok) {
        retriedCors = true; corsFailed = true; decks.forEach((x) => x.removeAttribute('crossorigin'));
        const t = d.currentTime; playCurrent({ startAt: t }); return;
      }
      const cs = currentSong();
      if (remote && cs && dzUrl(d.src) && !dzTried[cs.id]) {
        dzTried[cs.id] = 1;
        refreshDeezer(cs).then((f) => { if (f) { cs.audio_url = f; playCurrent(); } else { emit('loading', false); emit('error', 'This song could not be loaded.'); emit('state', false); } });
        return;
      }
      emit('loading', false);
      emit('error', 'This song could not be loaded.');
      emit('state', false);
    });
  });

  function registerPlay(song) {
    const c = MX.ctx(); if (!c) return;
    song.my_play_count = (song.my_play_count || 0) + 1; song.my_last_played = new Date().toISOString();
    MX.emit('library', { play: song.id });
    MX.api('POST', '/api/music/' + song.id + '/play', { coupleId: c.coupleId, viewer: c.role }).catch(() => {});
  }

  /* ── sleep timer ───────────────────────────────────────── */
  function setSleep(v) {
    clearTimeout(sleepTimer); sleepEnd = false; sleepUntil = 0;
    if (!v) { emit('sleep', null); return; }
    if (v === 'end') { sleepEnd = true; emit('sleep', { end: true }); MX.toast('Music will stop after this song'); return; }
    sleepUntil = Date.now() + v * 60000; emit('sleep', { until: sleepUntil });
    sleepTimer = setTimeout(() => {
      const d = deck(), v0 = G.ok ? 1 : d.volume; let k = 0;
      const fade = setInterval(() => { k++; setLevel(active, Math.max(0, 1 - k / 20)); if (k >= 20) { clearInterval(fade); d.pause(); setLevel(active, 1); sleepUntil = 0; emit('sleep', null); MX.toast('Sleep timer — music paused 🌙'); } }, 250);
    }, v * 60000);
    MX.toast('Sleep timer set for ' + v + ' min');
  }

  /* ── media session (lock screen / notification controls) ─ */
  function pushMediaSession(s) {
    if (!('mediaSession' in navigator) || !s) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: s.title, artist: s.artist || 'Unknown Artist', album: s.album || 'Our Music',
        artwork: s.cover_url ? [{ src: s.cover_url, sizes: '512x512' }] : [],
      });
      const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) {} };
      h('play', () => togglePlay()); h('pause', () => togglePlay());
      h('previoustrack', () => prev()); h('nexttrack', () => next(true));
      h('seekto', (d) => { if (d.seekTime != null) seek(d.seekTime); });
      h('seekbackward', () => seek(deck().currentTime - 10)); h('seekforward', () => seek(deck().currentTime + 10));
    } catch (e) {}
  }
  on('state', (p) => { try { navigator.mediaSession.playbackState = p ? 'playing' : 'paused'; } catch (e) {} document.body.classList.toggle('playing', !!p); });
  let lastPos = 0;
  on('time', ({ cur, dur }) => { const now = Date.now(); if (now - lastPos < 1000 || !dur || !isFinite(dur)) return; lastPos = now; try { navigator.mediaSession.setPositionState({ duration: dur, playbackRate: rate, position: Math.min(cur, dur) }); } catch (e) {} });

  /* ── resume where you left off ─────────────────────────── */
  let sessT = 0;
  function saveSession() {
    const now = Date.now(); if (now - sessT < 1500 && arguments.length === 0) return; sessT = now;
    if (qi < 0) return;
    MX.cache.set('session', { queue, origQueue, qi, shuffle, repeat, t: deck().currentTime || 0 });
  }
  setInterval(() => { if (!deck().paused) saveSession(); }, 5000);
  window.addEventListener('pagehide', () => saveSession());
  function restore() {
    if (qi >= 0) return;
    const ss = MX.cache.get('session', null); if (!ss || !ss.queue || !ss.queue.length) return;
    const valid = ss.queue.filter((id) => byId(id)); if (!valid.length) return;
    const cur = ss.queue[ss.qi]; if (!byId(cur)) return;
    queue = valid; origQueue = (ss.origQueue || valid).filter((id) => byId(id)); qi = queue.indexOf(cur);
    shuffle = !!ss.shuffle; repeat = ss.repeat || 'off'; pendingStart = ss.t || 0;
    curObj = byId(cur);
    emit('shuffle', shuffle); emit('repeat', repeat); emit('track', curObj); emit('queue'); emit('state', false);
    const dur = curObj.duration_sec || 0; if (dur) emit('time', { cur: pendingStart, dur });
  }

  /* ── keyboard (desktop) ────────────────────────────────── */
  document.addEventListener('keydown', (e) => {
    const t = e.target; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.code === 'ArrowRight') seek(deck().currentTime + 5);
    else if (e.code === 'ArrowLeft') seek(deck().currentTime - 5);
  });

  /* ── public API ────────────────────────────────────────── */
  window.AudioService = {
    on, play, playShuffled, togglePlay, pause, stop, next, prev, jumpTo, seek, seekPct, restore,
    setShuffle, cycleRepeat, setPlaybackRate: setRate, setSleep,
    addToQueue, removeFromQueue, getQueueSongs: queueSongs, currentSong,
    setLibrary: () => MX.emit('library'),
    get audio() { return deck(); },
    get shuffle() { return shuffle; }, get repeatMode() { return repeat; }, get playbackRate() { return rate; },
    get queueIndex() { return qi; }, get isPlaying() { return !deck().paused && !deck().ended; },
    get sleepInfo() { return sleepEnd ? { end: true } : sleepUntil ? { until: sleepUntil } : null; },
    get analyser() { return G.ok ? G.n.analyser : null; },
    ensureGraph, applyFx,
  };
  MX.audio = window.AudioService;
  // library changes (rename, delete…) should refresh whatever is showing the current song
  MX.on('library', () => { const s = currentSong(); if (s) emit('meta', s); });
})();
