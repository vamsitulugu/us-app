/* ═══════════════════════════════════════════════════════════════
   MUSIC · now playing
   Mini player, full-screen player (swipe down to close), queue,
   playback speed / sleep timer, and the lyrics engine + lyrics screen
   (synced LRC, plain text, romanised script toggle, timing offset,
   paste / upload / re-search).
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const MX = window.MX, S = MX.S, Lib = MX.lib, A = window.AudioService;
  const esc = MX.esc, icon = MX.icon, $ = (s, r) => (r || document).querySelector(s);

  /* ═══════════════════════════════════════════════════════
     LYRICS ENGINE
  ═══════════════════════════════════════════════════════ */
  const L = (MX.lyrics = {});
  const lcache = new Map();
  const SIZES = [17, 20, 24, 29];

  /* Parse LRC ("[01:23.45]text", several stamps per line allowed) or plain text. */
  L.parse = function (text) {
    const out = { synced: false, lines: [] };
    if (!text || !String(text).trim()) return out;
    const raw = String(text).replace(/\r/g, '').split('\n');
    const stamp = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
    const timed = [];
    raw.forEach((ln) => {
      const times = []; let m; stamp.lastIndex = 0;
      while ((m = stamp.exec(ln))) times.push(+m[1] * 60 + +m[2] + (m[3] ? +('0.' + m[3].padEnd(3, '0').slice(0, 3)) : 0));
      if (!times.length) return;
      const txt = ln.replace(/\[[^\]]*\]/g, '').replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, '').trim();
      times.forEach((t) => timed.push({ t, text: txt }));
    });
    if (timed.length >= 2) { out.synced = true; out.lines = timed.sort((a, b) => a.t - b.t); return out; }
    out.lines = raw.filter((l) => !/^\[(ar|ti|al|by|offset|length|re|ve):/i.test(l.trim())).map((l) => ({ t: -1, text: l.trim() }));
    while (out.lines.length && !out.lines[0].text) out.lines.shift();
    return out;
  };
  const offKey = (id) => 'mx_lyr_off_' + id;
  L.offset = (id) => parseFloat(localStorage.getItem(offKey(id))) || 0;
  L.setOffset = (id, v) => { try { v ? localStorage.setItem(offKey(id), String(v)) : localStorage.removeItem(offKey(id)); } catch (e) {} };
  L.get = (song) => (song ? lcache.get(song.id) || null : null);
  L.script = () => MX.cache.get('lyrScript', 'native');
  L.activeIndex = function (lines, t) { // last line whose time <= t
    let lo = 0, hi = lines.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (lines[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  };
  function build(song, lrc, latin, provider) {
    const e = { state: 'found', provider: provider || song.lyrics_source || '', ...{ native: L.parse(lrc) } };
    e.latin = latin && latin.trim() ? L.parse(latin) : null;
    if (!e.native.lines.length) return { state: 'none' };
    return e;
  }
  /* explicit = the person asked to see lyrics (vs. background auto-fetch on play) */
  L.load = function (song, opts) {
    opts = opts || {};
    if (!song) return Promise.resolve(null);
    const cur = lcache.get(song.id);
    if (cur && !opts.force) {
      if (cur.state === 'found' || cur.state === 'loading' || cur.state === 'searching') return cur.promise || Promise.resolve(cur);
      if (cur.state === 'none' && !opts.explicit) return Promise.resolve(cur);
    }
    const entry = { state: 'loading' }; lcache.set(song.id, entry);
    entry.promise = (async () => {
      let res;
      try {
        await MX.data.ensureFullSong(song);
        let lrc = song.lyrics && song.lyrics.trim() ? song.lyrics : null, latin = song.lyrics_latin, provider = song.lyrics_source;
        if (!lrc && window.LyricsManager && MX.online()) {
          const c = MX.ctx();
          const r = await window.LyricsManager.getLyrics(song, c && c.coupleId);
          if (r.state === 'found') { lrc = r.lrc; latin = r.lrcLatin; provider = r.provider; }
          else if (r.state === 'searching') { res = { state: 'searching' }; }
        }
        if (!res) res = lrc ? build(song, lrc, latin, provider) : { state: 'none' };
      } catch (e) { res = { state: 'none' }; }
      lcache.set(song.id, res); MX.emit('lyrics', song.id); return res;
    })();
    MX.emit('lyrics', song.id);
    return entry.promise;
  };
  // background search finished (LyricsBackgroundWorker is a one-way global event feed)
  (function hookWorker() {
    if (!window.LyricsBackgroundWorker) { setTimeout(hookWorker, 400); return; }
    window.LyricsBackgroundWorker.on((id, res) => {
      const song = Lib.byId(id); if (!song) return;
      if (res && res.found) { song.has_lyrics = true; song.lyrics_cached = true; song.lyrics = undefined; song._full = false; lcache.delete(song.id); L.load(song, { explicit: true }); }
      else { lcache.set(song.id, { state: 'none' }); MX.emit('lyrics', song.id); }
    });
  })();
  /* Apply lyrics text the user supplied (paste / .lrc upload) */
  L.save = async function (song, text) {
    await MX.data.updateSong(song, { lyrics: text });
    song.lyrics = text; song._full = true; song.has_lyrics = !!text.trim(); song.lyrics_latin = null; lcache.delete(song.id);
    return L.load(song, { explicit: true, force: true });
  };
  L.research = async function (song) {
    if (!window.LyricsSearch) { MX.toast('Lyrics search is still loading'); return null; }
    if (!MX.online()) { MX.toast("You're offline"); return null; }
    const c = MX.ctx();
    lcache.set(song.id, { state: 'searching' }); MX.emit('lyrics', song.id);
    const r = await window.LyricsSearch.search({ cleanTitle: song.clean_title || song.title, cleanArtist: song.clean_artist || song.artist, cleanAlbum: song.clean_album || song.album }, song.duration_sec, { songId: song.id, coupleId: c.coupleId });
    if (r && r.found) {
      song.lyrics = r.lyricsNative; song.lyrics_latin = r.lyricsLatin || null; song._full = true; song.has_lyrics = true; song.lyrics_cached = true; lcache.delete(song.id);
      MX.toast('Lyrics found ✓'); return L.load(song, { explicit: true, force: true });
    }
    lcache.set(song.id, { state: 'none' }); MX.emit('lyrics', song.id);
    MX.toast(r && r.cooldown ? 'Searched recently — try again a bit later, or paste the lyrics' : 'No lyrics found online — you can paste them instead');
    return null;
  };
  /* The lines to show right now, honouring the script toggle. */
  L.view = function (entry) {
    if (!entry || entry.state !== 'found') return null;
    return (L.script() === 'latin' && entry.latin) ? entry.latin : entry.native;
  };
  /* Lyrics view renderer shared by the lyrics screen and the Sing screen. */
  L.renderInto = function (box, song, state) {
    state = state || {}; const entry = lcache.get(song.id);
    if (!entry || entry.state === 'loading') { box.innerHTML = '<div class="lyr-state"><div class="spin"></div>Loading lyrics…</div>'; return null; }
    if (entry.state === 'searching') { box.innerHTML = '<div class="lyr-state"><div class="spin"></div>Searching for lyrics…<br><small style="color:var(--mx-text3)">You can keep listening — they\'ll appear automatically.</small></div>'; return null; }
    if (entry.state === 'none') {
      box.innerHTML = `<div class="lyr-state">${icon('lyrics')}<h3 style="margin:10px 0 6px;color:#fff">No lyrics yet</h3>We couldn't find these online.<div style="display:flex;gap:10px;justify-content:center;margin-top:16px;flex-wrap:wrap">
        <button class="btn primary sm" data-act="lyr-research">${icon('refresh')} Search again</button><button class="btn sm" data-act="lyr-paste">${icon('edit')} Paste lyrics</button><button class="btn sm" data-act="lyr-upload">${icon('upload')} Upload .lrc</button></div></div>`;
      return null;
    }
    const v = L.view(entry);
    box.classList.toggle('lyr-plain', !v.synced);
    box.innerHTML = v.lines.map((ln, i) => `<div class="lyr-line" data-i="${i}"${v.synced ? ` data-t="${ln.t}"` : ''}>${ln.text ? esc(ln.text) : '&nbsp;'}</div>`).join('');
    return v;
  };

  /* ═══════════════════════════════════════════════════════
     RANGE SLIDER (touch + mouse)
  ═══════════════════════════════════════════════════════ */
  MX.range = function (el, cb) {
    el.innerHTML = '<div class="range-track"><div class="range-fill"></div></div><div class="range-thumb"></div>';
    const fill = $('.range-fill', el), thumb = $('.range-thumb', el);
    let dragging = false;
    const pct = (e) => { const r = el.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
    const paint = (p) => { fill.style.width = p * 100 + '%'; thumb.style.left = p * 100 + '%'; };
    el.addEventListener('pointerdown', (e) => { dragging = true; el.classList.add('drag'); try { el.setPointerCapture(e.pointerId); } catch (x) {} const p = pct(e); paint(p); cb.input && cb.input(p); });
    el.addEventListener('pointermove', (e) => { if (!dragging) return; const p = pct(e); paint(p); cb.input && cb.input(p); });
    const end = (e) => { if (!dragging) return; dragging = false; el.classList.remove('drag'); cb.commit && cb.commit(pct(e)); };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', () => { dragging = false; el.classList.remove('drag'); });
    return { set(p) { if (!dragging) paint(Math.max(0, Math.min(1, p || 0))); }, get dragging() { return dragging; } };
  };

  /* ═══════════════════════════════════════════════════════
     MINI PLAYER
  ═══════════════════════════════════════════════════════ */
  const mini = $('#mini');
  mini.innerHTML = `<div class="mini-bar"><div class="mini-fill" id="miniFill"></div></div><div class="mini-in" data-act="open-player">
    <div id="miniCover"></div><div class="mini-info"><div class="mini-title ellip" id="miniTitle"></div><div class="mini-sub ellip" id="miniSub"></div></div>
    <button class="mini-btn" data-act="p-prev" aria-label="Previous">${icon('prev')}</button>
    <button class="mini-btn play" data-act="p-toggle" id="miniPlay" aria-label="Play or pause">${icon('play')}</button>
    <button class="mini-btn" data-act="p-next" aria-label="Next">${icon('next')}</button></div>`;
  /* Swipe the mini player sideways to dismiss it (stops the music, like Spotify / YouTube Music). */
  (function () {
    let x0 = null, y0 = 0, dx = 0, lock = null, t0 = 0, swiped = false;
    const reset = () => { mini.classList.remove('drag'); mini.style.transform = ''; mini.style.opacity = ''; };
    mini.addEventListener('touchstart', (e) => { if (e.touches.length !== 1) { x0 = null; return; } x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; lock = null; t0 = Date.now(); }, { passive: true });
    mini.addEventListener('touchmove', (e) => {
      if (x0 == null) return;
      const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
      if (!lock && (Math.abs(mx) > 8 || Math.abs(my) > 8)) lock = Math.abs(mx) > Math.abs(my) * 1.2 ? 'x' : 'y';
      if (lock !== 'x') return;
      dx = mx; mini.classList.add('drag');
      mini.style.transform = `translateX(${dx}px)`; mini.style.opacity = String(Math.max(0.15, 1 - Math.abs(dx) / (mini.offsetWidth * 0.8)));
    }, { passive: true });
    const end = () => {
      if (x0 == null) return; const was = lock; x0 = null; lock = null;
      if (was !== 'x') return;
      swiped = true; setTimeout(() => { swiped = false; }, 400);   // swallow the click that follows a swipe
      const fast = Math.abs(dx) / Math.max(1, Date.now() - t0) > 0.5 && Math.abs(dx) > 50;
      if (Math.abs(dx) > mini.offsetWidth * 0.3 || fast) {
        mini.classList.remove('drag'); mini.classList.add('leaving');
        mini.style.transform = `translateX(${dx < 0 ? '-' : ''}110%)`; mini.style.opacity = '0';
        setTimeout(() => { A.stop(); mini.classList.add('drag'); reset(); mini.classList.remove('leaving'); requestAnimationFrame(() => mini.classList.remove('drag')); }, 180);
      } else { mini.classList.remove('drag'); reset(); }
      dx = 0;
    };
    mini.addEventListener('touchend', end); mini.addEventListener('touchcancel', end);
    mini.addEventListener('click', (e) => { if (swiped) { e.stopPropagation(); e.preventDefault(); } }, true);
  })();
  const setMiniSpace = (on) => document.documentElement.style.setProperty('--mx-mini', on ? '84px' : '0px');

  /* ═══════════════════════════════════════════════════════
     FULL PLAYER
  ═══════════════════════════════════════════════════════ */
  const P = $('#player');
  P.innerHTML = `<div class="pl-bg" id="plBg"></div><div class="pl-shade"></div>
    <div class="pl-wrap">
      <div class="pl-top"><button class="icon-btn bare" data-act="close-player" aria-label="Close">${icon('down')}</button><div class="pl-top-title">Now Playing</div><button class="icon-btn bare" data-act="open-queue" aria-label="Queue">${icon('queue')}</button></div>
      <div class="pl-body">
        <div class="cover fill pl-art" id="plArt"></div>
        <div class="pl-meta"><div class="pl-meta-t"><div class="pl-title ellip" id="plTitle"></div><div class="pl-artist ellip" id="plArtist"></div></div>
          <button class="heart pl-heart" id="plHeart" data-act="p-like" aria-label="Like">${icon('heart')}</button></div>
        <div class="seekbar"><div class="range" id="plRange"></div><div class="times"><span id="plCur">0:00</span><span id="plDur">0:00</span></div></div>
        <div class="ctrls">
          <button class="ctrl sub" id="plShuffle" data-act="p-shuffle" aria-label="Shuffle">${icon('shuffle')}</button>
          <button class="ctrl fill" data-act="p-prev" aria-label="Previous">${icon('prev')}</button>
          <button class="ctrl big fill" id="plPlay" data-act="p-toggle" aria-label="Play or pause">${icon('play')}</button>
          <button class="ctrl fill" data-act="p-next" aria-label="Next">${icon('next')}</button>
          <button class="ctrl sub" id="plRepeat" data-act="p-repeat" aria-label="Repeat">${icon('repeat')}</button>
        </div>
        <div class="acts">
          <button class="act" data-act="p-add">${icon('listPlus')}<span>Add</span></button>
          <button class="act" id="plDl" data-act="p-download">${icon('download')}<span>Download</span></button>
          <button class="act" data-act="p-lyrics">${icon('lyrics')}<span>Lyrics</span></button>
          <button class="act" data-act="p-share">${icon('share')}<span>Share</span></button>
          <button class="act" data-act="p-more">${icon('more')}<span>More</span></button>
        </div>
        <div class="pl-sleep hidden" id="plSleep"></div>
        <button class="together" data-act="p-together"><span class="ti">${icon('heart')}</span><span style="flex:1"><b>Play Together</b><span>Listen, sing or video call together</span></span>${icon('right')}</button>
      </div>
    </div>
    <div class="panel" id="queuePanel"></div>
    <div class="lyr" id="lyrScreen"></div>`;
  const plRange = MX.range($('#plRange'), {
    input: (p) => { const d = A.audio.duration; if (isFinite(d)) $('#plCur').textContent = MX.fmt(p * d); },
    commit: (p) => A.seekPct(p),
  });
  const song = () => A.currentSong();

  function paintSong(s) {
    const show = !!s;
    mini.classList.toggle('show', show); setMiniSpace(show);
    if (!show) { if (P.classList.contains('open')) closePlayer(); return; }
    $('#miniCover').innerHTML = MX.cover(s, 's'); $('#miniTitle').textContent = s.title; $('#miniSub').textContent = s.artist || 'Unknown Artist';
    $('#plArt').innerHTML = MX.icon('music') + (s.cover_url ? `<img src="${esc(s.cover_url)}" alt="">` : '');
    $('#plBg').style.backgroundImage = s.cover_url ? `url('${s.cover_url.replace(/'/g, '%27')}')` : 'none';
    $('#plTitle').textContent = s.title; $('#plArtist').textContent = s.artist || 'Unknown Artist';
    paintLike(s); paintDl(s);
    $('#plDur').textContent = MX.fmt(s.duration_sec); $('#plCur').textContent = '0:00';
  }
  function paintLike(s) { s = s || song(); if (!s) return; $('#plHeart').classList.toggle('on', !!s.liked); }
  function paintDl(s) {
    s = s || song(); if (!s) return; const b = $('#plDl'); const prog = MX.offline.progress[s.id]; const has = MX.offline.has(s);
    b.classList.toggle('on', has);
    b.innerHTML = (has ? icon('check') : icon('download')) + `<span>${has ? 'Saved' : prog != null ? Math.round(prog * 100) + '%' : 'Download'}</span>`;
  }
  function paintState(playing) {
    $('#miniPlay').innerHTML = icon(playing ? 'pause' : 'play'); $('#plPlay').innerHTML = icon(playing ? 'pause' : 'play');
    const lp = $('#lyrPlay'); if (lp) lp.innerHTML = icon(playing ? 'pause' : 'play');
    if (playing) startRaf(); else paintTime();
  }
  function paintTime() {
    const d = A.audio, dur = d.duration || (song() && song().duration_sec) || 0, cur = d.currentTime || 0;
    const p = dur ? Math.min(1, cur / dur) : 0;
    $('#miniFill').style.width = p * 100 + '%';
    plRange.set(p); if (!plRange.dragging) { $('#plCur').textContent = MX.fmt(cur); }
    if (isFinite(dur) && dur) $('#plDur').textContent = MX.fmt(dur);
    if (lyrOpen) paintLyricsTime(cur, dur, p);
  }
  let raf = 0;
  function startRaf() { if (raf) return; let last = 0; const tick = (now) => { raf = 0; if (!A.isPlaying) return; if (P.classList.contains('open') || lyrOpen || now - last > 250) { last = now; paintTime(); } raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick); }

  A.on('track', (s) => { paintSong(s); if (s && MX.settings.get('autoLyrics')) L.load(s); if (lyrOpen) openLyricsFor(s); if (!s) $('#queuePanel').classList.remove('open'); });
  A.on('meta', (s) => { if (s) paintSong(s); });
  A.on('state', (p) => { paintState(p); mini.classList.toggle('buffering', false); });
  A.on('time', () => { if (!raf) paintTime(); });
  A.on('loading', (b) => { mini.classList.toggle('buffering', b); P.classList.toggle('buffering', b); });
  A.on('error', (m) => MX.toast(m));
  A.on('shuffle', (v) => $('#plShuffle').classList.toggle('on', v));
  A.on('repeat', (m) => { const b = $('#plRepeat'); b.classList.toggle('on', m !== 'off'); b.innerHTML = icon(m === 'one' ? 'repeat1' : 'repeat'); });
  A.on('sleep', (v) => { const el = $('#plSleep'); if (!v) { el.classList.add('hidden'); return; } el.classList.remove('hidden'); el.textContent = v.end ? '🌙 Stopping after this song' : '🌙 Sleep timer · ' + Math.max(1, Math.round((v.until - Date.now()) / 60000)) + ' min left'; });
  setInterval(() => { const v = A.sleepInfo; if (v && v.until) { const el = $('#plSleep'); el.textContent = '🌙 Sleep timer · ' + Math.max(1, Math.round((v.until - Date.now()) / 60000)) + ' min left'; } }, 30000);
  MX.on('library', () => { const s = song(); if (s) { paintLike(s); paintDl(s); } });
  MX.on('downloads', () => paintDl());

  /* open / close */
  function openPlayer() { if (!song()) return; P.classList.add('open'); if (!MX.layers.has('player')) MX.layers.push('player', closePlayer); paintTime(); if (A.isPlaying) startRaf(); }
  function closePlayer() { MX.layers.remove('lyrics'); closeLyrics(true); closeQueue(true); P.classList.remove('open'); MX.layers.remove('player'); }
  MX.player = { open: openPlayer, close: closePlayer, openLyrics: async (s) => { if (s && (!song() || song().id !== s.id)) { await A.play([s].concat(S.songs.filter((x) => x.id !== s.id)), s.id); } openPlayer(); openLyricsFor(song()); }, };
  MX.act('open-player', openPlayer); MX.act('close-player', closePlayer);

  /* swipe down to close */
  (function () {
    let y0 = null, dy = 0;
    P.addEventListener('touchstart', (e) => { if (e.target.closest('.range,.panel,.lyr')) { y0 = null; return; } y0 = e.touches[0].clientY; dy = 0; }, { passive: true });
    P.addEventListener('touchmove', (e) => { if (y0 == null) return; dy = e.touches[0].clientY - y0; if (dy > 8) { P.classList.add('drag'); P.style.transform = `translateY(${dy}px)`; } }, { passive: true });
    P.addEventListener('touchend', () => { if (y0 == null) return; P.classList.remove('drag'); P.style.transform = ''; if (dy > 110) closePlayer(); y0 = null; dy = 0; });
  })();

  /* transport actions */
  MX.act('p-toggle', () => { A.togglePlay(); paintState(A.isPlaying); MX.haptic(); });
  MX.act('p-next', () => A.next(true)); MX.act('p-prev', () => A.prev());
  MX.act('p-shuffle', () => A.setShuffle(!A.shuffle)); MX.act('p-repeat', () => A.cycleRepeat());
  MX.act('p-like', () => { const s = song(); if (s) MX.data.toggleLike(s); });
  MX.act('p-add', () => { const s = song(); if (s) MX.addToPlaylistMenu(s); });
  MX.act('p-download', async () => {
    const s = song(); if (!s) return;
    if (MX.offline.has(s)) { const ok = await MX.confirm({ title: 'Remove download?', message: '“' + s.title + '” will stream instead of playing offline.', confirm: 'Remove' }); if (ok) MX.offline.remove(s); }
    else if (MX.offline.progress[s.id] == null) { MX.toast('Downloading…'); const ok = await MX.offline.download(s); if (ok) MX.toast('Saved for offline ✓'); }
  });
  MX.act('p-share', () => { const s = song(); if (s) MX.share('🎵 ' + s.title + ' — ' + (s.artist || '') + ' · listening on Us'); });
  MX.act('p-together', () => { const s = song(); if (s && window.CoupleKaraoke) CoupleKaraoke.sendInviteById(s.id); else MX.toast('Not ready yet'); });
  MX.act('p-lyrics', () => openLyricsFor(song()));
  MX.act('p-more', () => {
    const s = song(); if (!s) return; const mine = Lib.isMine(s);
    const head = `<div class="sheet-head">${MX.cover(s, 'm')}<div style="min-width:0"><div class="t ellip">${esc(s.title)}</div><div class="s ellip">${esc(s.artist || '')}</div></div></div>`;
    MX.menu(head, [
      { ico: 'gauge', label: 'Playback speed', hint: A.playbackRate === 1 ? 'Normal' : A.playbackRate + '×', run: speedSheet },
      { ico: 'moon', label: 'Sleep timer', hint: A.sleepInfo ? 'On' : 'Off', run: sleepSheet },
      { ico: 'sliders', label: 'Sound effects', run: () => MX.fxSheet && MX.fxSheet() },
      { ico: 'queue', label: 'Add to queue', run: () => { A.addToQueue([s.id]); MX.toast('Added to queue'); } },
      { ico: 'mic', label: 'Sing with lyrics', run: () => MX.sing.open(s) },
      { ico: 'info', label: 'Song details', run: () => MX.songDetails(s) },
      mine ? { ico: 'edit', label: 'Edit details', run: () => MX.songEdit(s) } : null,
      mine ? { ico: 'trash', label: 'Delete song', danger: true, run: () => MX.data.deleteSong(s) } : null,
    ]);
  });
  function speedSheet() {
    MX.menu('<h3>Playback speed</h3>', [0.75, 0.9, 1, 1.1, 1.25, 1.5, 2].map((r) => ({ ico: A.playbackRate === r ? 'check' : 'gauge', label: r === 1 ? 'Normal' : r + '×', on: A.playbackRate === r, run: () => A.setPlaybackRate(r) })));
  }
  function sleepSheet() {
    MX.menu('<h3>Sleep timer</h3>', [
      { ico: 'x', label: 'Off', run: () => A.setSleep(0) },
      ...[15, 30, 45, 60].map((m) => ({ ico: 'moon', label: m + ' minutes', run: () => A.setSleep(m) })),
      { ico: 'moon', label: 'End of this song', run: () => A.setSleep('end') },
    ]);
  }

  /* ── queue ─────────────────────────────────────────────── */
  const QP = $('#queuePanel');
  function drawQueue() {
    const q = A.getQueueSongs(), qi = A.queueIndex; const cur = song();
    const up = q.slice(qi + 1);
    QP.innerHTML = `<div class="panel-h"><button class="icon-btn bare" data-act="close-queue">${icon('down')}</button><h2>Queue</h2></div><div class="panel-b">
      ${cur ? `<div class="section-h" style="margin-top:4px"><h2 style="font-size:14px;color:var(--mx-text2)">Now playing</h2></div><div class="list">${MX.row(cur, 'all', { dur: false, heart: false })}</div>` : ''}
      <div class="section-h"><h2 style="font-size:14px;color:var(--mx-text2)">Next up · ${up.length}</h2></div>
      ${up.length ? `<div class="list">${up.map((s, i) => `<div class="trk" data-act="queue-jump" data-i="${qi + 1 + i}">${MX.cover(s, 's')}<div class="trk-main"><div class="trk-title ellip">${esc(s.title)}</div><div class="trk-sub ellip">${esc(s.artist || '')}</div></div>
        <div class="trk-end"><span class="trk-dur">${MX.fmt(s.duration_sec)}</span><button class="dots" data-act="queue-remove" data-id="${esc(s.id)}" aria-label="Remove">${icon('x')}</button></div></div>`).join('')}</div>` : '<div class="empty"><p>Nothing queued after this song.</p></div>'}</div>`;
  }
  function openQueue() { drawQueue(); QP.classList.add('open'); MX.layers.push('queue', () => closeQueue()); }
  function closeQueue(silent) { QP.classList.remove('open'); MX.layers.remove('queue'); }
  MX.act('open-queue', openQueue); MX.act('close-queue', () => closeQueue());
  MX.act('queue-jump', (d) => A.jumpTo(+d.i));
  MX.act('queue-remove', (d, el, e) => { e.stopPropagation(); A.removeFromQueue(d.id); });
  A.on('queue', () => { if (QP.classList.contains('open')) drawQueue(); });

  /* ═══════════════════════════════════════════════════════
     LYRICS SCREEN
  ═══════════════════════════════════════════════════════ */
  const LY = $('#lyrScreen'); let lyrOpen = false, lyrView = null, lyrIdx = -2, lyrSong = null, userScrollAt = 0;
  function lyrShell() {
    LY.innerHTML = `<div class="lyr-bg" id="lyrBg"></div>
      <div class="hdr" style="padding-bottom:6px"><button class="icon-btn bare" data-act="close-lyrics" aria-label="Back">${icon('down')}</button><h1>Lyrics</h1><div class="hdr-actions"><button class="btn sm" data-act="lyr-sync">${icon('refresh')} Sync Lyrics</button></div></div>
      <div class="lyr-card"><div id="lyrCover"></div><div style="flex:1;min-width:0"><div class="pl-title ellip" id="lyrTitle" style="font-size:15px"></div><div class="pl-artist ellip" id="lyrArtist" style="font-size:12.5px;margin-top:1px"></div></div>
        <button class="heart" id="lyrHeart" data-act="p-like" aria-label="Like">${icon('heart')}</button><button class="mini-btn play" id="lyrPlay" data-act="p-toggle" aria-label="Play or pause">${icon('play')}</button></div>
      <div class="lyr-chips" id="lyrChips"></div>
      <div class="lyr-scroll" id="lyrBox"></div>
      <div class="lyr-mini" style="margin-bottom:6px"><span class="times" style="margin:0;min-width:34px" id="lyrCur">0:00</span><div class="range" id="lyrRange"></div><span class="times" style="margin:0;min-width:34px;justify-content:flex-end" id="lyrDur">0:00</span></div>
      <div class="lyr-bar">
        <button class="act" data-act="lyr-font">${icon('font')}<span>Font</span></button>
        <button class="act" data-act="lyr-bg">${icon('image')}<span>Background</span></button>
        <button class="act" data-act="lyr-share">${icon('share')}<span>Share</span></button>
        <button class="act" data-act="lyr-karaoke">${icon('mic')}<span>Karaoke</span></button></div>`;
    lyrRange = MX.range($('#lyrRange'), { input: (p) => { const d = A.audio.duration; if (isFinite(d)) $('#lyrCur').textContent = MX.fmt(p * d); }, commit: (p) => A.seekPct(p) });
    const box = $('#lyrBox');
    box.addEventListener('touchstart', () => { userScrollAt = Date.now(); }, { passive: true });
    box.addEventListener('wheel', () => { userScrollAt = Date.now(); }, { passive: true });
    box.addEventListener('click', (e) => { const ln = e.target.closest('.lyr-line[data-t]'); if (!ln) return; A.seek(+ln.dataset.t - L.offset(lyrSong.id) + 0.01); userScrollAt = 0; });
  }
  let lyrRange = null;
  function applyLyricStyle() {
    LY.style.setProperty('--lyr-size', SIZES[MX.settings.get('lyricSize') || 0] + 'px');
    LY.classList.toggle('plain', !MX.settings.get('lyricBg'));
  }
  function paintLyrics() {
    if (!lyrSong) return; const box = $('#lyrBox'); if (!box) return;
    lyrView = L.renderInto(box, lyrSong); lyrIdx = -2;
    const e = L.get(lyrSong); const chips = $('#lyrChips');
    chips.innerHTML = e && e.state === 'found' && e.latin ? `<button class="chip${L.script() === 'native' ? ' active' : ''}" data-act="lyr-script" data-s="native">Original</button><button class="chip${L.script() === 'latin' ? ' active' : ''}" data-act="lyr-script" data-s="latin">Roman</button>` : '';
    paintLyricsTime(A.audio.currentTime, A.audio.duration, 0);
  }
  function paintLyricsTime(cur, dur, p) {
    if (!lyrOpen) return;
    const lc = $('#lyrCur'); if (lc && lyrRange && !lyrRange.dragging) { lc.textContent = MX.fmt(cur); $('#lyrDur').textContent = MX.fmt(dur || (lyrSong && lyrSong.duration_sec)); lyrRange.set(dur ? cur / dur : 0); }
    if (!lyrView || !lyrView.synced) return;
    const idx = L.activeIndex(lyrView.lines, cur + L.offset(lyrSong.id));
    if (idx === lyrIdx) return; lyrIdx = idx;
    const box = $('#lyrBox'); const els = box.children;
    for (let i = 0; i < els.length; i++) els[i].className = 'lyr-line' + (i === idx ? ' cur' : Math.abs(i - idx) === 1 ? ' near' : i < idx ? ' past' : '');
    if (idx >= 0 && Date.now() - userScrollAt > 3500) { const el = els[idx]; box.scrollTo({ top: el.offsetTop - box.clientHeight * 0.38, behavior: 'smooth' }); }
  }
  async function openLyricsFor(s) {
    if (!s) return; if (!LY.firstChild) lyrShell();
    lyrSong = s; lyrOpen = true; applyLyricStyle();
    $('#lyrCover').innerHTML = MX.cover(s, 's'); $('#lyrTitle').textContent = s.title; $('#lyrArtist').textContent = s.artist || '';
    $('#lyrHeart').classList.toggle('on', !!s.liked);
    $('#lyrBg').style.backgroundImage = s.cover_url ? `url('${s.cover_url.replace(/'/g, '%27')}')` : 'none';
    $('#lyrPlay').innerHTML = icon(A.isPlaying ? 'pause' : 'play');
    paintLyrics();
    if (!LY.classList.contains('open')) { LY.classList.add('open'); MX.layers.push('lyrics', () => closeLyrics()); }
    if (!P.classList.contains('open')) { P.classList.add('open'); if (!MX.layers.has('player')) MX.layers.push('player', closePlayer); }
    L.load(s, { explicit: true });
  }
  function closeLyrics() { lyrOpen = false; LY.classList.remove('open'); MX.layers.remove('lyrics'); }
  MX.on('lyrics', (id) => { if (lyrOpen && lyrSong && lyrSong.id === id) paintLyrics(); });
  MX.on('library', () => { if (lyrOpen && lyrSong) { const h = $('#lyrHeart'); if (h) h.classList.toggle('on', !!lyrSong.liked); } });
  MX.act('close-lyrics', () => closeLyrics());
  MX.act('lyr-script', (d) => { MX.cache.set('lyrScript', d.s); paintLyrics(); });
  MX.act('lyr-font', () => { MX.settings.set('lyricSize', ((MX.settings.get('lyricSize') || 0) + 1) % SIZES.length); applyLyricStyle(); lyrIdx = -2; });
  MX.act('lyr-bg', () => { MX.settings.set('lyricBg', !MX.settings.get('lyricBg')); applyLyricStyle(); });
  MX.act('lyr-share', () => {
    if (!lyrSong) return; let line = '';
    if (lyrView && lyrView.synced && lyrIdx >= 0) line = '“' + lyrView.lines[lyrIdx].text + '”\n';
    MX.share(line + '🎵 ' + lyrSong.title + ' — ' + (lyrSong.artist || ''));
  });
  MX.act('lyr-karaoke', () => { if (lyrSong) MX.sing.open(lyrSong); });
  MX.act('lyr-research', () => lyrSong && L.research(lyrSong));
  function pasteSheet() {
    const s = lyrSong; if (!s) return;
    const sh = MX.sheet(`<h3>Paste lyrics</h3><p class="msg">Synced lyrics look like <code>[01:23.45] line</code>. Plain text works too — it just won't highlight along.</p>
      <div class="field"><textarea id="lyTxt" placeholder="Paste lyrics here…">${esc(s.lyrics || '')}</textarea></div><div class="row2"><button class="btn ghost" data-k="no">Cancel</button><button class="btn primary" data-k="yes">Save</button></div>`, { modal: true });
    sh.el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-k]'); if (!b) return; if (b.dataset.k === 'no') { sh.close(); return; }
      const t = sh.$('#lyTxt').value; if (!t.trim()) { MX.toast('Paste some lyrics first'); return; }
      b.disabled = true; try { await L.save(s, t); MX.toast('Lyrics saved'); sh.close(); } catch (err) { MX.toast('Could not save — ' + err.message); b.disabled = false; }
    });
  }
  MX.act('lyr-paste', pasteSheet);
  MX.act('lyr-upload', () => { const i = $('#lrcIn'); i.value = ''; i.click(); });
  document.addEventListener('change', async (e) => {
    if (e.target.id !== 'lrcIn' || !e.target.files[0] || !lyrSong) return;
    const f = e.target.files[0]; if (f.size > 300 * 1024) { MX.toast('That file is too large for lyrics'); return; }
    try { await L.save(lyrSong, await MX.readFile(f)); MX.toast('Lyrics imported ✓'); } catch (err) { MX.toast('Could not import — ' + err.message); }
  });
  MX.act('lyr-sync', () => {
    const s = lyrSong; if (!s) return; const off = L.offset(s.id);
    MX.menu('<h3>Sync lyrics</h3>', [
      { ico: 'refresh', label: 'Search again online', run: () => L.research(s) },
      { ico: 'edit', label: 'Paste or edit lyrics', run: pasteSheet },
      { ico: 'upload', label: 'Import .lrc / .txt file', run: () => { const i = $('#lrcIn'); i.value = ''; i.click(); } },
      { ico: 'clock', label: 'Adjust timing', hint: off ? (off > 0 ? '+' : '') + off.toFixed(1) + 's' : 'In sync', run: offsetSheet },
    ]);
  });
  function offsetSheet() {
    const s = lyrSong; if (!s) return;
    const sh = MX.sheet(`<h3>Adjust timing</h3><p class="msg">If lyrics show too early or late, nudge them. Positive numbers make lyrics appear sooner.</p>
      <div style="display:flex;align-items:center;justify-content:center;gap:18px;margin:6px 0 18px"><button class="icon-btn" data-d="-0.5">${icon('left')}</button><b id="offV" style="font-size:22px;min-width:90px;text-align:center"></b><button class="icon-btn" data-d="0.5">${icon('right')}</button></div>
      <div class="row2"><button class="btn ghost" data-d="reset">Reset</button><button class="btn primary" data-d="done">Done</button></div>`);
    const paint = () => { const v = L.offset(s.id); sh.$('#offV').textContent = (v > 0 ? '+' : '') + v.toFixed(1) + 's'; lyrIdx = -2; };
    paint();
    sh.el.addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (!b) return; const d = b.dataset.d;
      if (d === 'done') { sh.close(); return; } if (d === 'reset') L.setOffset(s.id, 0); else L.setOffset(s.id, Math.round((L.offset(s.id) + +d) * 10) / 10); paint(); });
  }

  /* initial paint if the player restored a session */
  MX.nowPlaying = { paintSong };
})();
