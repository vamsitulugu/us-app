/* ═══════════════════════════════════════════════════════════════
   MUSIC · recordings
   "My Recordings" tab: your voice notes, videos and karaoke takes (and your
   partner's), the recorder, playback, favourites, rename, delete, multi-select.
   Files live in the private 'couple-recordings' bucket; rows in
   personal_recordings (routes/recordings.js).
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const MX = window.MX, S = MX.S, A = window.AudioService;
  const esc = MX.esc, icon = MX.icon, $ = (s, r) => (r || document).querySelector(s);
  const REC = (MX.recordings = {});

  /* upload the file, then register it in the library */
  REC.saveBlob = async function (blob, o) {
    const c = MX.ctx(); if (!c) throw new Error('Not connected yet');
    const mime = (o.mime || blob.type || (o.mediaType === 'video' ? 'video/webm' : 'audio/webm')).split(';')[0];
    const ext = /mp4/.test(mime) ? 'mp4' : /ogg/.test(mime) ? 'ogg' : 'webm';
    const fd = new FormData();
    fd.append('file', new File([blob], 'recording.' + ext, { type: mime }));
    fd.append('coupleId', c.coupleId); fd.append('trackTitle', o.title || 'recording'); fd.append('mediaType', o.mediaType);
    const up = await MX.api('POST', '/api/media/upload-recording', fd);
    let row;
    try {
      row = await MX.api('POST', '/api/recordings', { coupleId: c.coupleId, userId: c.role, title: o.title, mediaType: o.mediaType, mediaUrl: up.url, storagePath: up.path, durationSec: o.durationSec || 0, kind: o.kind || 'voice', songId: o.songId || null });
    } catch (e) {
      // don't leave an orphaned file behind if the row couldn't be created
      MX.api('DELETE', '/api/media/delete-recording', { path: up.path, coupleId: c.coupleId }).catch(() => {});
      throw e;
    }
    S.recordings.unshift(row); MX.emit('recordings'); MX.rt.ping('recordings');
    return row;
  };

  /* ── list rendering ────────────────────────────────────── */
  const isVideo = (r) => r.media_type === 'video';
  const mineRec = (r) => r.user_id === MX.role();
  let playing = null; // { id, el }
  function recRow(r) {
    const who = mineRec(r) ? 'You' : MX.names().partner; const on = playing && playing.id === r.id && !playing.el.paused;
    const kind = r.kind === 'karaoke' || /^karaoke\b/i.test(r.title || '') ? 'Karaoke' : isVideo(r) ? 'Video' : 'Voice';
    return `<div class="rec-row" data-rid="${esc(r.id)}">
      <div class="rec-ico${isVideo(r) ? ' video' : ''}">${icon(isVideo(r) ? 'video' : kind === 'Karaoke' ? 'mic' : 'music')}</div>
      <div class="rec-main"><div class="rec-t ellip">${esc(r.title)}${r.is_favorite ? ' ❤️' : ''}</div><div class="rec-s ellip">${esc(who)} · ${MX.date(r.created_at)} · ${MX.fmt(r.duration_sec)}</div></div>
      <button class="rec-play" data-act="rec-play" data-id="${esc(r.id)}" aria-label="Play">${icon(on ? 'pause' : 'play')}</button>
      <button class="dots" data-act="rec-menu" data-id="${esc(r.id)}" aria-label="More">${icon('more')}</button></div>`;
  }
  MX.recRow = recRow;

  /* ── tab ───────────────────────────────────────────────── */
  let tab = 'audio', who = 'all', selecting = false; const picked = new Set();
  function mountTab(el) {
    const render = () => {
      if (!S.loaded.recordings) { el.innerHTML = '<div class="section"><div class="skel" style="height:56px;margin-bottom:10px"></div><div class="skel" style="height:56px;margin-bottom:10px"></div><div class="skel" style="height:56px"></div></div>'; return; }
      let list = S.recordings.slice();
      if (who === 'mine') list = list.filter(mineRec); else if (who === 'partner') list = list.filter((r) => !mineRec(r));
      if (tab === 'audio') list = list.filter((r) => !isVideo(r)); else if (tab === 'video') list = list.filter(isVideo); else list = list.filter((r) => r.is_favorite);
      const count = (f) => S.recordings.filter(f).length;
      el.innerHTML = `<div class="section">
        <div class="tabs compact" style="padding:0 0 12px">${[['audio', 'Audio'], ['video', 'Video'], ['fav', 'Favorites']].map(([k, l]) => `<button class="tab${tab === k ? ' active' : ''}" data-act="rec-tab" data-t="${k}">${l}</button>`).join('')}</div>
        <div class="rec-actions"><button class="btn primary" data-act="rec-new" data-m="audio">${icon('mic')} Record Audio</button><button class="btn" data-act="rec-new" data-m="video">${icon('video')} Record Video</button></div>
        <div class="chips" style="padding:0 0 8px;margin:0">${[['all', 'Everyone'], ['mine', 'Mine'], ['partner', MX.names().partner + "'s"]].map(([k, l]) => `<button class="chip${who === k ? ' active' : ''}" data-act="rec-who" data-w="${k}">${esc(l)}</button>`).join('')}</div>
        ${list.length ? `<div class="list">${list.map((r) => selecting ? `<div data-act="rec-pick" data-id="${esc(r.id)}" style="display:flex;align-items:center;gap:8px"><span class="check${picked.has(r.id) ? ' on' : ''}">${picked.has(r.id) ? icon('check') : ''}</span><div style="flex:1;min-width:0;pointer-events:none">${recRow(r)}</div></div>` : recRow(r)).join('')}</div>`
          : `<div class="empty"><div class="ico">${icon(tab === 'video' ? 'video' : 'mic')}</div><h3>${tab === 'fav' ? 'No favorites yet' : 'Nothing recorded yet'}</h3><p>${tab === 'fav' ? 'Tap ⋯ on a recording and choose Favorite.' : 'Record a voice note, a video message, or sing a karaoke take.'}</p></div>`}
        ${S.recordings.some(mineRec) ? `<button class="link" style="margin:14px auto 0" data-act="rec-select">${selecting ? 'Cancel selection' : 'Select recordings'}</button>` : ''}
      </div>
      ${selecting && picked.size ? `<div class="sel-bar"><span>${picked.size} selected</span><button class="btn danger sm" data-act="rec-del-picked">${icon('trash')} Delete</button></div>` : ''}`;
    };
    render();
    MX.on('recordings', render); MX.on('connectivity', render);
    REC.rerender = render;
    return render;
  }
  REC.mountTab = mountTab;
  MX.act('rec-tab', (d) => { tab = d.t; REC.rerender(); });
  MX.act('rec-who', (d) => { who = d.w; REC.rerender(); });
  MX.act('rec-select', () => { selecting = !selecting; picked.clear(); REC.rerender(); });
  MX.act('rec-pick', (d) => { const r = S.recordings.find((x) => x.id === d.id); if (!r || !mineRec(r)) { MX.toast('You can only delete your own recordings'); return; } picked.has(d.id) ? picked.delete(d.id) : picked.add(d.id); REC.rerender(); });
  MX.act('rec-del-picked', async () => {
    const ids = [...picked]; if (!ids.length) return;
    if (!(await MX.confirm({ title: 'Delete ' + ids.length + ' recording' + (ids.length > 1 ? 's' : '') + '?', message: 'This can\'t be undone.', confirm: 'Delete', danger: true }))) return;
    let n = 0; for (const id of ids) { if (await deleteRec(id, true)) n++; }
    picked.clear(); selecting = false; MX.toast(n + ' deleted'); REC.rerender();
  });

  /* ── playback ──────────────────────────────────────────── */
  const audioEl = new Audio(); audioEl.preload = 'none';
  audioEl.addEventListener('ended', () => { playing = null; MX.emit('recordings'); });
  audioEl.addEventListener('pause', () => MX.emit('recordings'));
  audioEl.addEventListener('play', () => MX.emit('recordings'));
  audioEl.addEventListener('error', () => { if (audioEl.src) { MX.toast('This recording could not be played'); playing = null; MX.emit('recordings'); } });
  function playRec(id) {
    const r = S.recordings.find((x) => x.id === id); if (!r) return;
    if (isVideo(r)) { videoSheet(r); return; }
    if (playing && playing.id === r.id) { audioEl.paused ? audioEl.play() : audioEl.pause(); return; }
    if (A.isPlaying) A.pause();
    audioEl.src = r.media_url; playing = { id: r.id, el: audioEl };
    audioEl.play().catch(() => { MX.toast('Could not play this recording'); playing = null; });
  }
  MX.act('rec-play', (d) => playRec(d.id));
  function videoSheet(r) {
    if (A.isPlaying) A.pause(); audioEl.pause();
    const sh = MX.sheet(`<div class="sheet-head"><div style="min-width:0"><div class="t ellip">${esc(r.title)}</div><div class="s">${MX.date(r.created_at)}</div></div></div><video src="${esc(r.media_url)}" controls autoplay playsinline style="width:100%;border-radius:14px;max-height:62vh;background:#000"></video>`);
    const v = sh.$('video'); v.onerror = () => MX.toast('This video could not be played');
    const orig = sh.close; sh.close = (x) => { try { v.pause(); } catch (e) {} orig(x); };
  }

  /* ── menu / edit / delete ──────────────────────────────── */
  async function deleteRec(id, silent) {
    const c = MX.ctx(); const r = S.recordings.find((x) => x.id === id); if (!r) return false;
    if (!silent && !(await MX.confirm({ title: 'Delete “' + r.title + '”?', message: 'This can\'t be undone.', confirm: 'Delete', danger: true }))) return false;
    try { await MX.api('DELETE', '/api/recordings/' + id, { coupleId: c.coupleId, userId: c.role }); }
    catch (e) { MX.toast('Delete failed — ' + e.message); return false; }
    if (playing && playing.id === id) { audioEl.pause(); audioEl.removeAttribute('src'); playing = null; }
    S.recordings = S.recordings.filter((x) => x.id !== id); MX.emit('recordings'); MX.rt.ping('recordings');
    return true;
  }
  MX.act('rec-menu', (d) => {
    const r = S.recordings.find((x) => x.id === d.id); if (!r) return; const mine = mineRec(r), c = MX.ctx();
    MX.menu(`<div class="sheet-head"><div class="rec-ico${isVideo(r) ? ' video' : ''}">${icon(isVideo(r) ? 'video' : 'mic')}</div><div style="min-width:0"><div class="t ellip">${esc(r.title)}</div><div class="s">${mine ? 'You' : esc(MX.names().partner)} · ${MX.date(r.created_at)}</div></div></div>`, [
      { ico: 'play', label: 'Play', run: () => playRec(r.id) },
      { ico: 'heart', label: r.is_favorite ? 'Remove favorite' : 'Favorite', on: r.is_favorite, run: async () => {
        const next = !r.is_favorite; r.is_favorite = next; MX.emit('recordings');
        try { await MX.api('PATCH', '/api/recordings/' + r.id, { coupleId: c.coupleId, userId: c.role, isFavorite: next }); MX.rt.ping('recordings'); } catch (e) { r.is_favorite = !next; MX.emit('recordings'); MX.toast('Could not update'); } } },
      mine ? { ico: 'edit', label: 'Rename', run: async () => { const n = await MX.prompt({ title: 'Rename recording', value: r.title, label: 'Title', max: 120 }); if (!n) return;
        try { await MX.api('PATCH', '/api/recordings/' + r.id, { coupleId: c.coupleId, userId: c.role, title: n }); r.title = n; MX.emit('recordings'); MX.rt.ping('recordings'); } catch (e) { MX.toast(e.message); } } } : null,
      { ico: 'share', label: 'Share', run: () => MX.share('🎙 ' + r.title + ' — from our music room') },
      mine ? { ico: 'trash', label: 'Delete', danger: true, run: () => deleteRec(r.id) } : null,
    ]);
  });

  /* ═══════════════════════════════════════════════════════
     RECORDER (audio / video)
  ═══════════════════════════════════════════════════════ */
  const RC = $('#recorder'); let rc = null;
  const mimes = (video) => (video ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'] : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']);
  const pickMime = (video) => mimes(video).find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
  MX.act('rec-new', (d) => openRecorder(d.m === 'video'));

  async function openRecorder(video) {
    if (!MX.ctx()) { MX.toast('Connect with your partner first'); return; }
    if (!MX.online()) { MX.toast("You're offline — recordings need a connection to save"); return; }
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder)) { MX.toast("Recording isn't supported in this browser"); return; }
    if (A.isPlaying) A.pause(); audioEl.pause();
    rc = { video, facing: 'user', stream: null, rec: null, chunks: [], t0: 0, timer: 0, state: 'init', mime: pickMime(video), blob: null };
    RC.classList.add('open'); MX.layers.push('recorder', closeRecorder);
    draw();
    await startStream();
  }
  async function startStream() {
    try {
      if (rc.stream) rc.stream.getTracks().forEach((t) => t.stop());
      rc.stream = await navigator.mediaDevices.getUserMedia(rc.video ? { audio: true, video: { facingMode: rc.facing, width: { ideal: 960 }, height: { ideal: 1280 } } } : { audio: { echoCancellation: true, noiseSuppression: true } });
      rc.state = 'ready'; draw();
    } catch (e) {
      MX.toast(e && e.name === 'NotAllowedError' ? 'Allow ' + (rc.video ? 'camera & microphone' : 'microphone') + ' access to record' : 'Could not start the ' + (rc.video ? 'camera' : 'microphone'));
      closeRecorder();
    }
  }
  function draw() {
    if (!rc) return; const v = rc.video;
    RC.innerHTML = `<div class="sheet"><div class="rec-stage${v ? '' : ' audio'}">${v ? '<video id="rcVid" autoplay muted playsinline></video>' : `<div style="text-align:center;color:var(--mx-text2)">${icon('mic', '')}<div style="margin-top:8px;font-size:13px">${rc.state === 'rec' ? 'Recording…' : 'Microphone ready'}</div></div>`}</div>
      <div class="rec-timer" id="rcTimer">${rc.state === 'rec' ? '<span class="rec-dot"></span>' : ''}0:00</div>
      <div style="display:flex;align-items:center;gap:22px">
        ${v && rc.state !== 'rec' ? `<button class="icon-btn" data-act="rc-flip" aria-label="Flip camera">${icon('flip')}</button>` : '<span style="width:42px"></span>'}
        <button class="rec-btn${rc.state === 'rec' ? ' live' : ''}" data-act="rc-main" aria-label="${rc.state === 'rec' ? 'Stop' : 'Record'}">${icon(rc.state === 'rec' ? 'stop' : v ? 'camera' : 'mic')}</button>
        <button class="icon-btn" data-act="rc-close" aria-label="Close">${icon('x')}</button></div></div>`;
    if (v && rc.stream) { const el = $('#rcVid'); el.srcObject = rc.stream; el.play().catch(() => {}); }
  }
  MX.act('rc-flip', async () => { rc.facing = rc.facing === 'user' ? 'environment' : 'user'; await startStream(); });
  MX.act('rc-close', () => closeRecorder());
  MX.act('rc-main', () => { if (!rc || !rc.stream) return; if (rc.state === 'rec') stopRec(); else startRec(); });
  function startRec() {
    rc.chunks = []; rc.rec = new MediaRecorder(rc.stream, rc.mime ? { mimeType: rc.mime } : undefined);
    rc.rec.ondataavailable = (e) => { if (e.data && e.data.size) rc.chunks.push(e.data); };
    rc.rec.onstop = onStopped; rc.rec.start(300); rc.t0 = Date.now(); rc.state = 'rec'; draw();
    rc.timer = setInterval(() => { const t = $('#rcTimer'); if (t) t.innerHTML = '<span class="rec-dot"></span>' + MX.fmt((Date.now() - rc.t0) / 1000); if (Date.now() - rc.t0 > 10 * 60 * 1000) stopRec(); }, 250);
  }
  function stopRec() { clearInterval(rc.timer); try { rc.rec.stop(); } catch (e) { onStopped(); } }
  function onStopped() {
    if (!rc) return; const dur = Math.round((Date.now() - rc.t0) / 1000); rc.stream && rc.stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(rc.chunks, { type: rc.mime || (rc.video ? 'video/webm' : 'audio/webm') });
    if (dur < 1 || blob.size < 1000) { MX.toast('That was too short'); closeRecorder(); return; }
    review(blob, dur);
  }
  function review(blob, dur) {
    const video = rc.video, mime = rc.mime; const url = URL.createObjectURL(blob);
    const def = (video ? 'Video message' : 'Voice note') + ' · ' + new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    closeRecorder(true);
    let saving = false;
    const sh = MX.sheet(`<h3>${video ? 'Your video' : 'Your recording'} ${MX.fmt(dur)}</h3>${video ? `<video controls playsinline src="${esc(url)}" style="width:100%;border-radius:14px;max-height:44vh;background:#000;margin-bottom:12px"></video>` : `<audio controls src="${esc(url)}" style="width:100%;margin-bottom:12px;display:block"></audio>`}
      <div class="field"><label>Title</label><input id="rvT" maxlength="120" value="${esc(def)}"></div><div class="row2"><button class="btn ghost" data-k="no">Discard</button><button class="btn primary" data-k="yes">Save</button></div>`,
      { modal: true, sticky: true, onClose: () => { if (!saving) URL.revokeObjectURL(url); } });
    sh.el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-k]'); if (!b) return; if (b.dataset.k === 'no') { sh.close(); return; }
      saving = true; b.disabled = true; b.textContent = 'Saving…';
      try { await REC.saveBlob(blob, { title: sh.$('#rvT').value.trim() || def, mediaType: video ? 'video' : 'audio', durationSec: dur, kind: 'voice', mime }); URL.revokeObjectURL(url); sh.close(); MX.toast('Saved ✓ — your partner can see it too'); }
      catch (err) { saving = false; b.disabled = false; b.textContent = 'Save'; MX.toast('Could not save — ' + err.message); }
    });
  }
  function closeRecorder(keepData) {
    if (!rc) return; clearInterval(rc.timer);
    if (rc.rec && rc.rec.state !== 'inactive') { rc.rec.onstop = null; try { rc.rec.stop(); } catch (e) {} }
    if (rc.stream) rc.stream.getTracks().forEach((t) => t.stop());
    RC.classList.remove('open'); RC.innerHTML = ''; MX.layers.remove('recorder'); rc = null;
  }
})();
