/* ═══════════════════════════════════════════════════════════════
   MUSIC · karaoke
   • Karaoke list (Sing / My Takes)
   • Sing screen — scrolling synced lyrics, 3-2-1 countdown, mic level,
     records your voice while the track plays, preview, then saves the take
     to the couple's Recordings (kind = karaoke) so your partner can hear it.
   • Sound-effects sheet (vocal reduction, bass/treble, reverb, echo,
     volume normalisation) — shared with the player's More menu.
   (Video-call karaoke with your partner lives in couple-karaoke.js.)
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const MX = window.MX, S = MX.S, Lib = MX.lib, A = window.AudioService, L = MX.lyrics;
  const esc = MX.esc, icon = MX.icon, $ = (s, r) => (r || document).querySelector(s);

  /* ── Karaoke list ──────────────────────────────────────── */
  MX.nav.register('karaoke', (el) => {
    let tab = 'sing', chip = 'all', q = '';
    el.innerHTML = MX.hdr('Karaoke', `<button class="icon-btn" data-act="open-fx" aria-label="Sound effects">${icon('sliders')}</button>`) +
      `<div class="tabs compact"><button class="tab" data-act="k-tab" data-t="sing">Sing</button><button class="tab" data-act="k-tab" data-t="takes">My Takes</button></div>
       <div id="kTools"></div><div class="section" id="kBody"></div>`;
    const tools = $('#kTools', el), body = $('#kBody', el);
    const topArtists = () => { const m = {}; S.songs.forEach((s) => { const a = (s.artist || '').trim(); if (a && a !== 'Unknown Artist') m[a] = (m[a] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 4).map((e) => e[0]); };
    const render = () => {
      el.querySelectorAll('.tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.t === tab));
      if (tab === 'takes') {
        tools.innerHTML = '';
        const takes = S.recordings.filter((r) => r.kind === 'karaoke' || /^karaoke\b/i.test(r.title || ''));
        body.innerHTML = takes.length ? `<div class="list">${takes.map((r) => MX.recRow(r)).join('')}</div>` : `<div class="empty"><div class="ico">${icon('mic')}</div><h3>No takes yet</h3><p>Sing along to a song and save it — your takes show up here.</p></div>`;
        return;
      }
      tools.innerHTML = `<div class="searchbar">${icon('search')}<input id="kq" type="search" placeholder="Search songs for karaoke…" value="${esc(q)}" autocomplete="off"></div>
        <div class="chips">${[['all', 'All'], ['lyrics', 'With lyrics'], ['played', 'Most played'], ['liked', 'Liked']].concat(topArtists().map((a) => ['a:' + a, a])).map(([k, l]) => `<button class="chip${chip === k ? ' active' : ''}" data-act="k-chip" data-c="${esc(k)}">${esc(l)}</button>`).join('')}</div>`;
      const inp = $('#kq', tools); inp.addEventListener('input', MX.debounce(() => { q = inp.value; renderList(); }, 140));
      renderList();
    };
    const renderList = () => {
      let list = S.songs.slice();
      if (chip === 'lyrics') list = list.filter((s) => s.has_lyrics); else if (chip === 'liked') list = list.filter((s) => s.liked);
      else if (chip === 'played') list = list.filter((s) => s.my_play_count).sort((a, b) => b.my_play_count - a.my_play_count);
      else if (chip.startsWith('a:')) list = list.filter((s) => s.artist === chip.slice(2));
      if (q.trim()) { const hit = new Set(Lib.search(q).map((s) => s.id)); list = list.filter((s) => hit.has(s.id)); }
      body.innerHTML = list.length ? `<div class="list">${list.map((s) => `<div class="trk" data-act="sing-song" data-id="${esc(s.id)}">${MX.cover(s, 's')}<div class="trk-main"><div class="trk-title ellip">${esc(s.title)}</div><div class="trk-sub ellip">${esc(s.artist || 'Unknown Artist')}${s.has_lyrics ? '' : ' · no lyrics yet'}</div></div>
          <div class="trk-end"><span class="sing-btn">${icon('mic')} Sing</span></div></div>`).join('')}</div>` :
        `<div class="empty"><div class="ico">${icon('mic')}</div><h3>${S.songs.length ? 'No songs match' : 'No songs yet'}</h3><p>${S.songs.length ? 'Try a different filter.' : 'Add songs to start singing.'}</p></div>`;
    };
    render();
    const offs = ['library', 'recordings'].map((e) => MX.on(e, () => (tab === 'takes' ? render() : renderList())));
    MX._karaokeCtl = { setTab: (t) => { tab = t; render(); }, setChip: (c) => { chip = c; render(); } };
    return { destroy: () => offs.forEach((f) => f()) };
  });
  MX.act('k-tab', (d) => MX._karaokeCtl && MX._karaokeCtl.setTab(d.t));
  MX.act('k-chip', (d) => MX._karaokeCtl && MX._karaokeCtl.setChip(d.c));
  MX.act('sing-song', (d) => { const s = Lib.byId(d.id); if (s) MX.sing.open(s); });
  MX.act('open-fx', () => MX.fxSheet());

  /* ═══════════════════════════════════════════════════════
     SING SCREEN
  ═══════════════════════════════════════════════════════ */
  const SG = $('#sing');
  const sing = (MX.sing = {});
  let st = null; // session state

  function micSupported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder); }
  function bestAudioMime() { const c = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']; return c.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || ''; }

  sing.open = async function (song) {
    if (!song) return;
    if (!MX.online() && !MX.offline.has(song)) { MX.toast("You're offline — download this song to sing offline"); return; }
    MX.player && MX.player.close && MX.layers.has('player') && MX.player.close();
    st = { song, phase: 'idle', stream: null, rec: null, chunks: [], t0: 0, raf: 0, blob: null, url: '', lyrIdx: -2, view: null, ctxA: null, analyser: null, scrollAt: 0, timer: 0 };
    SG.innerHTML = `<div class="lyr-bg" id="sgBg"></div>
      <div class="sing-top"><button class="icon-btn bare" data-act="sing-close" aria-label="Close">${icon('down')}</button>
        <div class="t"><b class="ellip">${esc(song.title)}</b><span class="ellip">${esc(song.artist || '')}</span></div>
        <button class="icon-btn bare" data-act="open-fx" aria-label="Sound effects">${icon('sliders')}</button></div>
      <div class="sing-lyrics" id="sgLyr"></div>
      <div class="sing-dock">
        <div class="count" id="sgCount"></div>
        <div class="sing-timer" id="sgTimer">Ready when you are</div>
        <canvas class="wave" id="sgWave" width="480" height="92"></canvas>
        <div class="sing-ctrls"><button class="ctrl sub" data-act="sing-vocal" id="sgVocal" aria-label="Vocal reduction"><span style="font-size:10px;font-weight:700;display:block">VOCAL</span></button>
          <button class="rec-btn" id="sgRec" data-act="sing-main" aria-label="Start">${icon('mic')}</button>
          <button class="ctrl sub" data-act="sing-restart" aria-label="Restart">${icon('refresh')}</button></div>
      </div>`;
    $('#sgBg').style.backgroundImage = song.cover_url ? `url('${song.cover_url.replace(/'/g, '%27')}')` : 'none';
    SG.classList.add('open'); MX.layers.push('sing', () => sing.close());
    paintVocal();
    // get the track ready (paused at 0) and the lyrics loading
    A.stop(); A.play([song], song.id, { paused: true });
    L.load(song, { explicit: true });
    paintLyr(); drawIdleWave();
  };
  const paintVocal = () => { const b = $('#sgVocal'); if (b) b.classList.toggle('on', !!MX.settings.get('vocalReduce')); };
  function paintLyr() {
    if (!st) return; const box = $('#sgLyr'); if (!box) return;
    st.view = L.renderInto(box, st.song); st.lyrIdx = -2;
    box.onclick = (e) => { const ln = e.target.closest('.lyr-line[data-t]'); if (ln && st.phase !== 'rec') A.seek(+ln.dataset.t - L.offset(st.song.id) + .01); };
    box.ontouchstart = () => { st.scrollAt = Date.now(); };
  }
  MX.on('lyrics', (id) => { if (st && st.song.id === id) paintLyr(); });
  MX.on('settings', (e) => { if (st && e.key === 'vocalReduce') paintVocal(); });
  A.on('time', ({ cur }) => {
    if (!st || !SG.classList.contains('open')) return;
    if (st.view && st.view.synced) {
      const idx = L.activeIndex(st.view.lines, cur + L.offset(st.song.id));
      if (idx !== st.lyrIdx) {
        st.lyrIdx = idx; const box = $('#sgLyr'), els = box.children;
        for (let i = 0; i < els.length; i++) els[i].className = 'lyr-line' + (i === idx ? ' cur' : Math.abs(i - idx) === 1 ? ' near' : i < idx ? ' past' : '');
        if (idx >= 0 && Date.now() - st.scrollAt > 3000) box.scrollTo({ top: els[idx].offsetTop - box.clientHeight * .38, behavior: 'smooth' });
      }
    }
  });
  A.on('queueEnd', () => { if (st && st.phase === 'rec') finishTake(); });
  A.on('state', (p) => { if (st && st.phase === 'rec' && !p && A.audio.ended) finishTake(); });

  /* waveform */
  function drawIdleWave() { const c = $('#sgWave'); if (!c) return; const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height); g.fillStyle = 'rgba(255,255,255,.18)'; for (let i = 0; i < 48; i++) g.fillRect(i * 10 + 2, c.height / 2 - 2, 6, 4); }
  function drawWave() {
    if (!st || st.phase !== 'rec') return; const c = $('#sgWave'); if (!c) return; const g = c.getContext('2d');
    const data = new Uint8Array(st.analyser.frequencyBinCount); st.analyser.getByteTimeDomainData(data);
    g.clearRect(0, 0, c.width, c.height); const bars = 48, step = Math.floor(data.length / bars);
    const grad = getComputedStyle(document.documentElement).getPropertyValue('--accent2').trim() || '#F0489F';
    g.fillStyle = grad;
    for (let i = 0; i < bars; i++) { let m = 0; for (let k = 0; k < step; k++) m = Math.max(m, Math.abs(data[i * step + k] - 128)); const h = Math.max(4, (m / 128) * c.height * 1.6); g.fillRect(i * 10 + 2, (c.height - h) / 2, 6, h); }
    const e = (Date.now() - st.t0) / 1000; $('#sgTimer').innerHTML = `<span class="rec-dot"></span>Recording ${MX.fmt(e)}`;
    st.raf = requestAnimationFrame(drawWave);
  }

  async function startTake() {
    if (!micSupported()) { MX.toast("Recording isn't supported in this browser"); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { MX.toast(e && e.name === 'NotAllowedError' ? 'Allow microphone access to sing 🎤' : 'Could not open the microphone'); return; }
    st.stream = stream;
    // countdown
    st.phase = 'count'; const cnt = $('#sgCount'); cnt.classList.add('show');
    for (let n = 3; n >= 1; n--) { cnt.textContent = n; await new Promise((r) => setTimeout(r, 800)); if (!st || st.phase !== 'count') { stream.getTracks().forEach((t) => t.stop()); return; } }
    cnt.classList.remove('show');
    try {
      const AC = window.AudioContext || window.webkitAudioContext; st.ctxA = new AC(); const src = st.ctxA.createMediaStreamSource(stream);
      st.analyser = st.ctxA.createAnalyser(); st.analyser.fftSize = 512; src.connect(st.analyser);
    } catch (e) { st.analyser = null; }
    const mime = bestAudioMime(); st.mime = mime;
    st.rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); st.chunks = [];
    st.rec.ondataavailable = (e) => { if (e.data && e.data.size) st.chunks.push(e.data); };
    st.rec.onstop = onRecStop;
    st.rec.start(250); st.t0 = Date.now(); st.phase = 'rec';
    $('#sgRec').classList.add('live'); $('#sgRec').innerHTML = icon('stop'); $('#sgRec').setAttribute('aria-label', 'Stop');
    A.seek(0); A.audio.play().catch(() => A.togglePlay());
    if (st.analyser) drawWave(); else $('#sgTimer').innerHTML = '<span class="rec-dot"></span>Recording…';
  }
  function finishTake() { if (!st || st.phase !== 'rec') return; st.phase = 'stopping'; A.pause(); try { st.rec.stop(); } catch (e) { onRecStop(); } }
  function cleanupMedia() {
    if (!st) return; cancelAnimationFrame(st.raf);
    if (st.stream) st.stream.getTracks().forEach((t) => t.stop()); st.stream = null;
    if (st.ctxA) { try { st.ctxA.close(); } catch (e) {} st.ctxA = null; }
    const r = $('#sgRec'); if (r) { r.classList.remove('live'); r.innerHTML = icon('mic'); r.setAttribute('aria-label', 'Start'); }
  }
  function onRecStop() {
    if (!st) return; const dur = Math.round((Date.now() - st.t0) / 1000); cleanupMedia();
    const blob = new Blob(st.chunks, { type: st.mime || 'audio/webm' });
    if (dur < 3 || blob.size < 2000) { st.phase = 'idle'; $('#sgTimer').textContent = 'That was too short — try again'; drawIdleWave(); return; }
    st.phase = 'review'; st.blob = blob; st.dur = dur; st.url = URL.createObjectURL(blob);
    $('#sgTimer').textContent = 'Nice take! ' + MX.fmt(dur); drawIdleWave(); reviewSheet();
  }
  function reviewSheet() {
    const s = st.song; let saving = false;
    const sh = MX.sheet(`<h3>Your take 🎤</h3><p class="msg">${esc(s.title)} · ${MX.fmt(st.dur)}</p><audio controls src="${esc(st.url)}" style="width:100%;display:block;margin:0 0 14px"></audio>
      <div class="field"><label>Title</label><input id="tkT" maxlength="120" value="${esc('Karaoke – ' + s.title)}"></div>
      <div class="row2"><button class="btn ghost" data-k="again">Try again</button><button class="btn primary" data-k="save">Save take</button></div><button class="sa danger" data-k="discard" style="justify-content:center">Discard</button>`,
      { modal: true, sticky: true, onClose: () => { if (st && st.phase === 'review' && !saving) { URL.revokeObjectURL(st.url); st.phase = 'idle'; } } });
    const au = sh.$('audio'); au.style.display = 'block';
    sh.el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-k]'); if (!b) return; const k = b.dataset.k;
      if (k === 'discard') { sh.close(); return; }
      if (k === 'again') { sh.close(); st.phase = 'idle'; A.seek(0); $('#sgTimer').textContent = 'Ready when you are'; return; }
      if (k === 'save') {
        saving = true; b.disabled = true; b.textContent = 'Saving…';
        try { await MX.recordings.saveBlob(st.blob, { title: sh.$('#tkT').value.trim() || 'Karaoke – ' + s.title, mediaType: 'audio', durationSec: st.dur, kind: 'karaoke', songId: s.id, mime: st.mime }); sh.close(); st.phase = 'idle'; MX.toast('Saved to your recordings 🎙'); $('#sgTimer').textContent = 'Saved ✓ — sing another?'; }
        catch (err) { saving = false; b.disabled = false; b.textContent = 'Save take'; MX.toast('Could not save — ' + err.message); }
      }
    });
  }
  sing.close = function () {
    if (!st) return;
    if (st.phase === 'rec' || st.phase === 'count') { st.phase = 'cancel'; try { st.rec && st.rec.state !== 'inactive' && (st.rec.onstop = null, st.rec.stop()); } catch (e) {} }
    cleanupMedia(); A.pause();
    SG.classList.remove('open'); MX.layers.remove('sing'); st = null;
  };
  MX.act('sing-close', () => sing.close());
  MX.act('sing-main', () => {
    if (!st) return;
    if (st.phase === 'idle') startTake(); else if (st.phase === 'rec') finishTake(); else if (st.phase === 'count') { st.phase = 'idle'; $('#sgCount').classList.remove('show'); }
  });
  MX.act('sing-restart', () => { if (!st || st.phase === 'rec') return; A.seek(0); st.lyrIdx = -2; const b = $('#sgLyr'); if (b) b.scrollTo({ top: 0, behavior: 'smooth' }); });
  MX.act('sing-vocal', () => { MX.settings.set('vocalReduce', !MX.settings.get('vocalReduce')); MX.toast(MX.settings.get('vocalReduce') ? 'Vocal reduction on — works best on stereo studio tracks' : 'Vocal reduction off'); });

  /* ═══════════════════════════════════════════════════════
     SOUND EFFECTS SHEET
  ═══════════════════════════════════════════════════════ */
  const PRESETS = {
    flat: { label: 'Flat', fx: { reverb: 0, delay: 0, bass: 0, treble: 0 } },
    studio: { label: 'Studio', fx: { reverb: .18, delay: 0, bass: 2, treble: 2 } },
    bathroom: { label: 'Bathroom', fx: { reverb: .55, delay: .12, bass: 1, treble: 3 } },
    stadium: { label: 'Stadium', fx: { reverb: .8, delay: .3, bass: 3, treble: 1 } },
    bass: { label: 'Bass boost', fx: { reverb: 0, delay: 0, bass: 8, treble: -1 } },
    vocal: { label: 'Bright', fx: { reverb: .1, delay: 0, bass: -2, treble: 6 } },
  };
  MX.fxSheet = function () {
    const fx = Object.assign({ preset: 'flat', reverb: 0, delay: 0, bass: 0, treble: 0 }, MX.settings.get('fx'));
    const sh = MX.sheet(`<h3>Sound effects</h3><div class="presets">${Object.entries(PRESETS).map(([k, p]) => `<button class="chip${fx.preset === k ? ' active' : ''}" data-p="${k}">${p.label}</button>`).join('')}</div>
      ${[['reverb', 'Reverb', 0, 1, .05], ['delay', 'Echo', 0, 1, .05], ['bass', 'Bass', -10, 10, 1], ['treble', 'Treble', -10, 10, 1]].map(([k, l, mn, mx, stp]) => `<div class="fx-row"><span>${l}</span><input type="range" data-k="${k}" min="${mn}" max="${mx}" step="${stp}" value="${fx[k]}"><output>${k === 'reverb' || k === 'delay' ? Math.round(fx[k] * 100) + '%' : (fx[k] > 0 ? '+' : '') + fx[k]}</output></div>`).join('')}
      <div class="set-card" style="margin-top:10px"><button class="set-row" data-t="vocalReduce"><div class="st"><b>Vocal reduction</b><span>Fades the lead vocal on stereo tracks</span></div><span class="switch${MX.settings.get('vocalReduce') ? ' on' : ''}"></span></button>
      <button class="set-row" data-t="normalize"><div class="st"><b>Normalise volume</b><span>Keeps loud and quiet songs even</span></div><span class="switch${MX.settings.get('normalize') ? ' on' : ''}"></span></button></div>
      <div class="row2"><button class="btn ghost" data-r="1">Reset</button><button class="btn primary" data-d="1">Done</button></div>`);
    const save = (patch) => { const cur = Object.assign({}, MX.settings.get('fx'), patch); MX.settings.set('fx', cur); };
    sh.el.addEventListener('click', (e) => {
      const p = e.target.closest('[data-p]'); const t = e.target.closest('[data-t]');
      if (p) { const pr = PRESETS[p.dataset.p]; save(Object.assign({ preset: p.dataset.p }, pr.fx)); sh.close(); MX.fxSheet(); return; }
      if (t) { const k = t.dataset.t; MX.settings.set(k, !MX.settings.get(k)); t.querySelector('.switch').classList.toggle('on', MX.settings.get(k)); return; }
      if (e.target.closest('[data-r]')) { MX.settings.set('fx', { preset: 'flat', reverb: 0, delay: 0, bass: 0, treble: 0 }); MX.settings.set('vocalReduce', false); MX.settings.set('normalize', false); sh.close(); MX.fxSheet(); return; }
      if (e.target.closest('[data-d]')) sh.close();
    });
    sh.el.addEventListener('input', (e) => {
      const r = e.target.closest('input[type=range]'); if (!r) return; const k = r.dataset.k, v = +r.value;
      r.nextElementSibling.textContent = k === 'reverb' || k === 'delay' ? Math.round(v * 100) + '%' : (v > 0 ? '+' : '') + v;
      save({ [k]: v, preset: 'custom' });
    });
  };
})();
