/*public/chat/chat.js*/

// ═══ CHAT MODULE — presence, fixed layout, emoji/gif, redesigned composer ═══
const Chat = (function () {
  let msgs = [];
  let lastMsgId = 0;
  let presence = { user1: null, user2: null };
  let presenceInterval = null;
  let pollInterval = null;
  let lastMsgTs = null;
  let selectMode = false;
  let selectedIds = new Set();
  let recording = false, mediaRecorder = null, recChunks = [], recStart = 0, recTimerInt = null, recCancelled = false;
  let replyingTo = null;
  let lpTimer = null, lpFired = false;
  const seenIds = new Set();
  function trackKey(m) { return m.client_id || m.id; }

  function coupleId() { return window.S && window.S.coupleId; }
  function myRole() { return window.S && window.S.role; }
  function otherRole() { return myRole() === 'user1' ? 'user2' : 'user1'; }
  function isMine(m) { return m.sender_role === myRole(); }

  // ─── PRESENCE ───────────────────────────────────────
  let _presenceListenersAttached = false; // guards against duplicate listeners if startPresence() is ever called more than once
  function startPresence() {
    sendPresence('online');
    if (presenceInterval) clearInterval(presenceInterval);
    presenceInterval = setInterval(() => {
      // Backgrounded tab: skip entirely, no network call.
      if (document.hidden) return;
      sendPresence('online');
    }, 20000);

    if (_presenceListenersAttached) return; // listeners already wired once — never attach a second copy
    _presenceListenersAttached = true;
    document.addEventListener('visibilitychange', () => {
      sendPresence(document.visibilityState === 'visible' ? 'online' : 'away');
    });
    window.addEventListener('pagehide', () => sendPresence('offline'));
    window.addEventListener('pagehide', () => {
      if (realtimeChannel && window.supabase) {
        try {
          const sb = window.supabase.createClient(window.__SUPABASE_URL__, window.__SUPABASE_ANON_KEY__);
          sb.removeChannel(realtimeChannel);
        } catch (e) {}
        realtimeChannel = null;
      }
    });
    window.addEventListener('beforeunload', () => {
      if (coupleId()) navigator.sendBeacon(API + '/api/chat/' + coupleId() + '/presence',
        new Blob([JSON.stringify({ role: myRole(), status: 'offline' })], { type: 'application/json' }));
    });
  }

  async function sendPresence(status) {
    if (!coupleId() || !myRole()) return;
    try { await api('POST', '/api/chat/' + coupleId() + '/presence', { role: myRole(), status }); } catch (e) {}
  }

  async function fetchPresence() {
    if (!coupleId()) return;
    try {
      const rows = await api('GET', '/api/chat/' + coupleId() + '/presence');
      presence = { user1: null, user2: null };
      (rows || []).forEach(r => { presence[r.role] = r; });
      renderPresenceUI();
    } catch (e) {}
  }

  function presenceStatusFor(role) {
    const p = presence[role];
    if (!p) return { label: 'Offline', dot: '⚫', online: false };
    const last = new Date(p.last_seen).getTime();
    const ageMs = Date.now() - last;
    if (p.status === 'online' && ageMs < 35000) return { label: 'Online', dot: '🟢', online: true };
    if (ageMs < 120000) return { label: 'Away', dot: '🟡', online: false, away: true };
    return { label: 'Last seen ' + fmtAgo(last), dot: '⚫', online: false };
  }

  function fmtAgo(ts) {
    const mins = Math.floor((Date.now() - ts) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.floor(hrs / 24) + 'd ago';
  }

  function renderPresenceUI() {
    const st = presenceStatusFor(otherRole());
    const hs = document.getElementById('chatHeaderStatus');
    if (hs) hs.innerHTML = st.dot + ' ' + st.label;
    document.querySelectorAll('[data-presence-dot]').forEach(el => el.textContent = st.dot);
    const psb = document.getElementById('hbSidebarPresence');
    if (psb) psb.innerHTML = `<span style="font-size:11px;color:var(--text3)">${st.dot} ${esc(st.label)}</span>`;
  }

  // ─── LOAD / POLL MESSAGES ───────────────────────────
 async function loadMessages() {
  if (!coupleId()) return;
  try {
    const rows = await api('GET', '/api/chat/' + coupleId() + '?limit=200');
    msgs = rows || [];
    lastMsgTs = msgs.length ? msgs[msgs.length - 1].created_at : null;
    render();
    scrollToBottom(false);
    reanchorAfterImages();
    settleScrollBurst();
    // Any already-loaded partner messages that are still unread need
    // marking now — previously markRead() only fired reactively when a
    // *new* message arrived while the chat was already open, so opening
    // a chat that already had unread messages waiting never flipped
    // their ticks blue at all.
    if (msgs.some(m => !isMine(m) && !m.read) && document.hasFocus()) markRead();
  } catch (e) {}
}

// Catch-all safety net: re-pin to bottom a few more times over the next
// second, in case something other than images shifts layout after the
// initial render (web font swap, etc.) — cheap, and only acts while the
// user is still at/near the bottom.
function settleScrollBurst() {
  const box = document.getElementById('chatMsgs');
  if (!box) return;
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      const stillNearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 400;
      if (stillNearBottom) box.scrollTop = box.scrollHeight;
    });
  }
  [50, 200, 500, 1000].forEach(delay => {
    setTimeout(() => {
      const stillNearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 400;
      if (stillNearBottom) box.scrollTop = box.scrollHeight;
    }, delay);
  });
}

// Images (map previews, gifs, stickers, photos) finish loading after the
// synchronous scrollToBottom() call above, and each one that loads pushes
// the page taller — silently stranding the scroll position partway up the
// conversation instead of at the true bottom. Re-pin to bottom as each image
// resolves, but only while the user hasn't scrolled away from the bottom.
function reanchorAfterImages() {
  const box = document.getElementById('chatMsgs');
  if (!box) return;
  const imgs = box.querySelectorAll('img');
  imgs.forEach(img => {
    if (img.complete) return;
    const onDone = () => {
      const stillNearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 400;
      if (stillNearBottom) box.scrollTop = box.scrollHeight;
    };
    img.addEventListener('load', onDone, { once: true });
    img.addEventListener('error', onDone, { once: true });
  });
}

  async function pollNew() {
  if (!coupleId()) return;
  try {
    const q = lastMsgTs ? '?after=' + encodeURIComponent(lastMsgTs) : '';
    const rows = await api('GET', '/api/chat/' + coupleId() + q);
    if (rows && rows.length) {
      rows.forEach(r => {
        const idx = msgs.findIndex(m => m.id === r.id || (r.client_id && m.client_id === r.client_id));
        if (idx > -1) msgs[idx] = r; else msgs.push(r);
      });
      lastMsgTs = rows[rows.length - 1].created_at;
      render();
      const box = document.getElementById('chatMsgs');
      const nearBottom = box && (box.scrollHeight - box.scrollTop - box.clientHeight < 150);
      if (nearBottom || rows.some(isMine)) { scrollToBottom(true); reanchorAfterImages(); }
      else updateJumpBadge(rows.filter(r => !isMine(r)).length);
      if (rows.some(r => !isMine(r)) && document.getElementById('page-chat')?.classList.contains('active') && document.hasFocus()) {
        markRead();
      }
    }
    await refreshRecentStatuses();
    fetchPresence();
  } catch (e) {}
}

  // The 'after' query above only ever returns brand-new rows, so an
  // UPDATE to a message already in `msgs` (read receipt, delivered
  // flag, reaction, edit) is invisible to it — that update only reaches
  // this device via the Realtime push. Re-checking the tail of the
  // conversation here means tick colors and reactions still refresh
  // within one poll cycle even if the Realtime socket never connected.
  async function refreshRecentStatuses() {
    if (!msgs.length) return;
    try {
      const rows = await api('GET', '/api/chat/' + coupleId() + '?limit=30');
      let changed = false;
      (rows || []).forEach(r => {
        const idx = msgs.findIndex(m => m.id === r.id || (r.client_id && m.client_id === r.client_id));
        if (idx > -1 && _msgSig(msgs[idx]) !== _msgSig(r)) { msgs[idx] = r; changed = true; }
      });
      if (changed) render();
    } catch (e) {}
  }

  function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    let _tick = 0;
    pollInterval = setInterval(() => {
      _tick++;
      // Tab backgrounded: no network calls at all.
      if (document.hidden) return;
      const chatActive = document.getElementById('page-chat')?.classList.contains('active');
      // Full 2.5s speed only while the chat page is actually open.
      // Elsewhere in the app, check every 8th tick (~20s) — just enough
      // to keep unread badges / last-message preview fresh.
      if (chatActive || _tick % 8 === 0) pollNew();
    }, 2500);
  }

  async function markRead() {
    if (!coupleId()) return;
    try { await api('POST', '/api/chat/' + coupleId() + '/read', { role: myRole() }); } catch (e) {}
  }

  // ─── SCROLL (fixed input, no jumping) ───────────────
  function scrollToBottom(smooth) {
    const box = document.getElementById('chatMsgs');
    if (!box) return;
    box.scrollTo({ top: box.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    document.getElementById('chatJumpBtn')?.classList.remove('show');
    updateJumpBadge(0);
  }
  function onChatScroll() {
    const box = document.getElementById('chatMsgs');
    if (!box) return;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 150;
    document.getElementById('chatJumpBtn')?.classList.toggle('show', !nearBottom);
  }
  function updateJumpBadge(n) {
    document.querySelectorAll('[data-chat-badge]').forEach(el => {
      el.textContent = n > 0 ? n : '';
      el.style.display = n > 0 ? 'inline-flex' : 'none';
    });
  }

  // Tracks the message signatures + last date-separator from the
  // previous render() call, so a pure tail-append (by far the most
  // frequent update — new message arrives, or a poll tick finds
  // nothing new) can patch the DOM incrementally instead of
  // re-rendering and re-decoding every bubble/image in the whole
  // conversation. The signature includes every field that changes a
  // bubble's appearance, so an edit/reaction/read-receipt/delete on an
  // *existing* message always invalidates the fast path and falls back
  // to the exact original full-rebuild behavior below.
  let _renderedSigs = [];
  let _renderedLastDate = null;

  function _msgSig(m) {
    const rx = m.reactions ? Object.entries(m.reactions).map(([e, r]) => e + ':' + r.length).sort().join(',') : '';
    return trackKey(m) + '|' + (m.deleted ? 1 : 0) + '|' + (m.delivered ? 1 : 0) + '|' + (m.read ? 1 : 0) + '|' + (m.text || '') + '|' + rx;
  }

  // ─── RENDER ──────────────────────────────────────────
  function render() {
  const box = document.getElementById('chatMsgs');
  if (!box) return;
  const prevBottomOffset = box.scrollHeight - box.scrollTop; // distance from bottom
  const wasNearBottom = prevBottomOffset - box.clientHeight < 150;

  const visible = msgs.filter(m => !(m.deleted_for || '').split(',').includes(myRole()));
  const currentSigs = visible.map(_msgSig);

  // Fast path: everything previously rendered is still identical, in the
  // same order, and we only have new messages appended at the end.
  const isPureAppend = box.children.length > 0 &&
    _renderedSigs.length > 0 &&
    currentSigs.length >= _renderedSigs.length &&
    _renderedSigs.every((s, i) => currentSigs[i] === s);

  if (isPureAppend) {
    const newOnes = visible.slice(_renderedSigs.length);
    if (newOnes.length === 0) {
      // Nothing changed at all (typical poll tick) — skip touching the DOM.
      renderPinned();
      return;
    }
    let lastDate = _renderedLastDate;
    const frag = document.createDocumentFragment();
    newOnes.forEach(m => {
      const d = new Date(m.created_at);
      const ds = d.toDateString();
      if (ds !== lastDate) {
        lastDate = ds;
        const sep = document.createElement('div');
        sep.className = 'chat-date-sep';
        sep.innerHTML = `<span>${fmtDaySep(d)}</span>`;
        frag.appendChild(sep);
      }
      const isNew = !seenIds.has(trackKey(m));
      const wrap = document.createElement('div');
      wrap.innerHTML = renderBubble(m, isNew);
      frag.appendChild(wrap.firstElementChild || wrap);
      seenIds.add(trackKey(m));
    });
    box.appendChild(frag);
    _renderedSigs = currentSigs;
    _renderedLastDate = lastDate;
    renderPinned();
    if (wasNearBottom) box.scrollTop = box.scrollHeight;
    else box.scrollTop = box.scrollHeight - prevBottomOffset;
    return;
  }

  // Full rebuild — anything that isn't a pure append (edits, deletes,
  // reactions, reorders, first render). Identical to the original
  // implementation.
  let html = '', lastDate = null;
  visible.forEach(m => {
    const d = new Date(m.created_at);
    const ds = d.toDateString();
    if (ds !== lastDate) { lastDate = ds; html += `<div class="chat-date-sep"><span>${fmtDaySep(d)}</span></div>`; }
    const isNew = !seenIds.has(trackKey(m));
    html += renderBubble(m, isNew);
  });
  visible.forEach(m => seenIds.add(trackKey(m)));
  box.innerHTML = html || `<div class="empty" style="padding:60px 20px"><div class="empty-ico">💬</div>Say hello 👋</div>`;
  _renderedSigs = currentSigs;
  _renderedLastDate = lastDate;
  renderPinned();

  if (wasNearBottom) {
    box.scrollTop = box.scrollHeight;
  } else {
    box.scrollTop = box.scrollHeight - prevBottomOffset; // keep same visual position
  }
}

  function fmtDaySep(d) {
    const today = new Date(); const yest = new Date(); yest.setDate(yest.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yest.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function renderBubble(m, isNew) {
    if (m.deleted) {
      return `<div class="chat-row ${isMine(m) ? 'me' : 'them'}"><div class="chat-bubble deleted-bubble">🚫 Message deleted</div></div>`;
    }
    const mine = isMine(m);
    const time = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    let body = '';
    if (m.type === 'image') body = `<img src="${esc(m.media_url)}" class="chat-img" onclick="openImgViewer('${esc(m.media_url)}')" loading="lazy">`;
    else if (m.type === 'gif') body = `<img src="${esc(m.media_url)}" class="chat-img chat-gif" onclick="openImgViewer('${esc(m.media_url)}')" loading="lazy">`;
    else if (m.type === 'voice') body = renderVoice(m);
    else if (m.type === 'audio') body = `<audio controls src="${esc(m.media_url)}" style="max-width:220px"></audio>`;
    else if (m.type === 'location') {
      const lat = parseFloat(m.media_meta?.lat), lng = parseFloat(m.media_meta?.lng);
      const tile = lonLatToTile(lat, lng, 15);
      const mapImg = `https://tile.openstreetmap.org/15/${tile.x}/${tile.y}.png`;
      body = `<div class="msg-location" onclick="event.stopPropagation();window.open('https://maps.google.com/?q=${lat},${lng}','_blank')">
        <div class="msg-location-map-wrap">
          <img src="${mapImg}" class="msg-location-map" loading="lazy" alt="map preview" onerror="this.closest('.msg-location-map-wrap').classList.add('map-failed')">
          <div class="msg-location-pin">📍</div>
        </div>
        <div class="msg-location-info">
          <div class="msg-location-title">📍 Location</div>
          <div class="msg-location-sub">Tap to open in Maps</div>
        </div>
      </div>`;
    }
    else if (m.type === 'gift') body = `<div class="msg-gift"><div class="msg-gift-emoji">${esc(m.media_meta?.emoji || '🎁')}</div><div class="msg-gift-name">${esc(m.media_meta?.name || 'Gift')}</div></div>`;
    else if (m.type === 'sticker') body = `<div class="msg-sticker" title="${esc(m.media_meta?.name || '')}">${esc(m.media_meta?.emoji || '🙂')}</div>`;
    else if (m.type === 'contact') body = `<div class="msg-contact" onclick="event.stopPropagation();Chat.openContactCard('${esc(m.media_meta?.name || '')}')"><div class="msg-contact-av">${esc((m.media_meta?.name || '?')[0])}</div><div><div class="msg-contact-name">${esc(m.media_meta?.name || 'Contact')}</div><div class="msg-contact-sub">Contact card · tap to view</div></div></div>`;
    else if (m.type === 'poll') {
      const opts = m.media_meta?.options || [];
      body = `<div class="msg-poll">
        <div class="msg-poll-q">📊 ${esc(m.text || 'Poll')}</div>
        ${opts.map(o => `<div class="msg-poll-opt" onclick="event.stopPropagation();Chat.votePoll(${m.id},'${esc(o).replace(/'/g,"\\'")}')">${esc(o)}</div>`).join('')}
      </div>`;
    }
    else if (m.type === 'call_log') return `<div class="chat-call-log${isNew ? ' msg-pop-in' : ''}"><span>${esc(m.text)}</span><span class="chat-call-time">${time}</span></div>`;
    else body = `<div class="chat-text">${linkify(esc(m.text || ''))}</div>`;

    const reactions = m.reactions && Object.keys(m.reactions).length
      ? `<div class="chat-reactions">${Object.entries(m.reactions).map(([e, roles]) => `<span class="chat-reaction-pill">${e} ${roles.length}</span>`).join('')}</div>` : '';

    const status = mine ? (m.read ? '✓✓' : m.delivered ? '✓✓' : '✓') : '';
    const statusClass = mine && m.read ? 'read' : '';

    const quoted = m.reply_to ? renderQuote(m.reply_to) : '';

    return `<div class="chat-row ${mine ? 'me' : 'them'}${isNew ? ' msg-pop-in' : ''}" data-id="${m.id}" onclick="Chat.onBubbleClick('${m.id}', event)" oncontextmenu="Chat.openMenu('${m.id}', event); return false;" ontouchstart="Chat.startLongPress('${m.id}')" ontouchend="Chat.endLongPress()" ontouchmove="Chat.endLongPress()">
      <div class="chat-swipe-reply-icon">↩️</div>
      <div class="chat-bubble ${mine ? 'mine' : 'theirs'}">
        ${quoted}
        ${body}
        ${reactions}
        <div class="chat-meta"><span>${time}${m.edited ? ' · edited' : ''}</span>${mine ? `<span class="chat-status ${statusClass}">${status}</span>` : ''}</div>
      </div>
    </div>`;
  }

  function renderQuote(replyId) {
    const src = msgs.find(x => x.id === replyId || x.id === Number(replyId) || String(x.id) === String(replyId));
    if (!src) return `<div class="chat-quote"><div class="chat-quote-text">Original message</div></div>`;
    const who = isMine(src) ? (window.S.myName || 'You') : (window.S.partnerName || 'Partner');
    let preview = src.text;
    if (!preview) {
      preview = src.type === 'image' ? '📷 Photo' : src.type === 'gif' ? 'GIF' : src.type === 'voice' ? '🎤 Voice message'
        : src.type === 'audio' ? '🎵 Audio' : src.type === 'sticker' ? (src.media_meta?.emoji || '🙂') + ' Sticker'
        : src.type === 'gift' ? '🎁 Gift' : src.type === 'contact' ? '👤 Contact' : src.type === 'location' ? '📍 Location'
        : src.type === 'poll' ? '📊 Poll' : 'Message';
    }
    return `<div class="chat-quote" onclick="event.stopPropagation();Chat.scrollToMsg(${src.id})">
      <div class="chat-quote-name">${esc(who)}</div>
      <div class="chat-quote-text">${esc(String(preview).slice(0, 80))}</div>
    </div>`;
  }

  function linkify(text) {
    return text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  }
  function lonLatToTile(lat, lon, zoom) {
    const n = Math.pow(2, zoom);
    const x = Math.floor((lon + 180) / 360 * n);
    const latRad = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
  }

  function renderVoice(m) {
    const dur = (m.media_meta && m.media_meta.duration) || 0;
    return `<div class="voice-msg" onclick="event.stopPropagation();Chat.toggleVoicePlay(this,'${esc(m.media_url)}')">
      <button class="voice-play">▶</button>
      <div class="voice-waveform">${Array.from({length:18}).map((_,i)=>`<span style="height:${8+Math.random()*16}px"></span>`).join('')}</div>
      <div class="voice-dur">${Math.floor(dur/60)}:${String(dur%60).padStart(2,'0')}</div>
    </div>`;
  }
  function toggleVoicePlay(el, url) {
    let audio = el._audio;
    if (!audio) { audio = new Audio(url); el._audio = audio; audio.onended = () => { el.querySelector('.voice-waveform').classList.remove('playing'); el.querySelector('.voice-play').textContent = '▶'; }; }
    if (audio.paused) { audio.play(); el.querySelector('.voice-waveform').classList.add('playing'); el.querySelector('.voice-play').textContent = '⏸'; }
    else { audio.pause(); el.querySelector('.voice-waveform').classList.remove('playing'); el.querySelector('.voice-play').textContent = '▶'; }
  }

  function renderPinned() {
    const bar = document.getElementById('chatPinnedBar');
    if (!bar) return;
    const pinned = msgs.filter(m => m.pinned && !m.deleted);
    if (!pinned.length) { bar.innerHTML = ''; bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    bar.innerHTML = pinned.map(p => `<div class="chat-pinned-item" onclick="Chat.scrollToMsg(${p.id})">📌 ${esc((p.text||'Media').slice(0,50))}</div>`).join('');
  }
  function scrollToMsg(id) {
    const el = document.querySelector(`.chat-row[data-id="${id}"]`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1200); }
  }

  // ─── SEND ────────────────────────────────────────────
  function genClientId() { return 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8); }

  async function sendMessage(payload) {
    if (!coupleId()) { toast('Not connected'); return; }
    const clientId = genClientId();
    const optimistic = {
      id: 'temp_' + clientId, client_id: clientId, couple_id: coupleId(), sender_role: myRole(),
      created_at: new Date().toISOString(), delivered: false, read: false, ...payload
    };
    msgs.push(optimistic); render(); scrollToBottom(true);
    if (window.playAppSound) {
      const soundByType = { gif: 'chat.gif.sent', image: 'chat.image.sent', file: 'chat.file.sent',
        sticker: 'chat.sticker.sent', voice: 'chat.voice.sent' };
      window.playAppSound(soundByType[payload.type] || 'chat.message.sent');
    }
    try {
      const saved = await api('POST', '/api/chat', { coupleId: coupleId(), clientId, senderRole: myRole(), ...payload });
      const idx = msgs.findIndex(m => m.client_id === clientId);
      if (idx > -1) msgs[idx] = saved;
      lastMsgId = Math.max(lastMsgId, saved.id);
      render();
    } catch (e) {
      // The request itself errored (network blip, dropped connection,
      // etc.) — but the server upsert is idempotent on client_id, so it's
      // possible the write actually landed before the response was lost.
      // Check once before showing "failed" so a genuinely successful send
      // never gets a false failure toast.
      let confirmed = null;
      try {
        const q = lastMsgTs ? '?after=' + encodeURIComponent(lastMsgTs) : '?limit=20';
        const rows = await api('GET', '/api/chat/' + coupleId() + q);
        confirmed = (rows || []).find(r => r.client_id === clientId);
      } catch (e2) {}
      const idx = msgs.findIndex(m => m.client_id === clientId);
      if (confirmed) {
        if (idx > -1) msgs[idx] = confirmed;
        lastMsgId = Math.max(lastMsgId, confirmed.id);
        render();
      } else {
        if (idx > -1) msgs[idx]._failed = true;
        render();
        toast('Send failed — tap to retry');
      }
    }
  }

  function sendText() {
    const inp = document.getElementById('chatIn');
    const text = inp.value.trim();
    if (!text) return;
    if (editingId) { inp.value = ''; inp.style.height = 'auto'; saveEdit(text); return; }
    inp.value = ''; inp.style.height = 'auto';
    sendMessage({ type: 'text', text, replyTo: replyingTo });
    replyingTo = null; closeBanner();
  }

  function onTypingInput() {}

  // Uploads a File/Blob to Supabase Storage instead of embedding it as
  // base64 text in the chat message — base64 media meant every chat
  // history load re-downloaded every image/audio/voice message ever sent,
  // full size, every time. mediaUrl is now a normal hosted URL.
  async function uploadChatMedia(fileOrBlob, filename) {
    const form = new FormData();
    form.append('file', fileOrBlob, filename || 'upload');
    form.append('coupleId', coupleId());
    const r = await fetch(API + '/api/media/upload', { method: 'POST', body: form });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Upload failed');
    return data.url;
  }

  async function onImagePick(input) {
    if (!input.files[0]) return;
    const file = input.files[0];
    input.value = '';
    try {
      const url = await uploadChatMedia(file, file.name);
      sendMessage({ type: 'image', mediaUrl: url });
    } catch (e) { toast('Image upload failed — please try again'); }
  }

 function sendGif(url) { sendMessage({ type: 'gif', mediaUrl: url }); closeSheet(); }

  async function onAudioPick(input) {
    if (!input.files[0]) return;
    const file = input.files[0];
    input.value = '';
    closeSheet();
    try {
      const url = await uploadChatMedia(file, file.name);
      sendMessage({ type: 'audio', mediaUrl: url, mediaMeta: { name: file.name } });
    } catch (e) { toast('Audio upload failed — please try again'); }
  }

  function sendLocation() {
    closeSheet();
    if (!navigator.geolocation) { toast('Location not supported on this device'); return; }
    toast('Getting your location...');
    navigator.geolocation.getCurrentPosition(
      pos => sendMessage({ type: 'location', mediaMeta: { lat: pos.coords.latitude, lng: pos.coords.longitude } }),
      () => toast('Location permission denied'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  const GIFTS = [
    { emoji: '🌹', name: 'Rose' }, { emoji: '💐', name: 'Bouquet' }, { emoji: '🍫', name: 'Chocolate' },
    { emoji: '🧸', name: 'Teddy' }, { emoji: '💍', name: 'Ring' }, { emoji: '🎂', name: 'Cake' },
    { emoji: '🎈', name: 'Balloon' }, { emoji: '🍰', name: 'Slice' }, { emoji: '🎁', name: 'Gift' }
  ];
  function openGiftPanel() {
    closeSheet();
    let panel = document.getElementById('chatGiftPanel');
    if (panel) { panel.classList.add('open'); return; }
    panel = document.createElement('div');
    panel.id = 'chatGiftPanel';
    panel.className = 'chat-bottom-sheet-overlay open';
    panel.innerHTML = `<div class="chat-bottom-sheet">
      <div class="chat-sheet-handle"></div>
      <div class="chat-sheet-grid">
        ${GIFTS.map(g => `<div class="chat-sheet-opt" onclick="Chat.sendGift('${g.emoji}','${g.name}')"><span>${g.emoji}</span>${g.name}</div>`).join('')}
      </div>
    </div>`;
    panel.onclick = e => { if (e.target === panel) panel.classList.remove('open'); };
    document.body.appendChild(panel);
  }
  function sendGift(emoji, name) {
    document.getElementById('chatGiftPanel')?.classList.remove('open');
    sendMessage({ type: 'gift', mediaMeta: { emoji, name } });
  }
  function sendEmoji(emoji) {
    const inp = document.getElementById('chatIn');
    inp.value += emoji;
    inp.focus();
  }

  // ─── VOICE RECORD ────────────────────────────────────
  async function toggleRecord() {
    if (recording) { stopRecording(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      recChunks = [];
      mediaRecorder.ondataavailable = e => recChunks.push(e.data);
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (recCancelled) { recCancelled = false; return; }
        const blob = new Blob(recChunks, { type: 'audio/webm' });
        const dur = Math.round((Date.now() - recStart) / 1000);
        try {
          const url = await uploadChatMedia(blob, 'voice.webm');
          sendMessage({ type: 'voice', mediaUrl: url, mediaMeta: { duration: dur } });
        } catch (e) { toast('Voice message upload failed — please try again'); }
      };
      mediaRecorder.start();
      recording = true; recStart = Date.now();
      document.getElementById('chatRecTimer').style.display = 'inline';
      document.getElementById('chatStopRecBtn').style.display = 'flex';
      document.getElementById('chatCancelRecBtn').style.display = 'flex';
      document.getElementById('chatMoreBtn').style.display = 'none';
      document.getElementById('chatSendBtn').style.display = 'none';
      recTimerInt = setInterval(() => {
        const s = Math.floor((Date.now() - recStart) / 1000);
        document.getElementById('chatRecTimer').textContent = String(Math.floor(s/60)).padStart(2,'0') + ':' + String(s%60).padStart(2,'0');
      }, 500);
    } catch (e) { toast('Mic permission denied'); }
  }
  function stopRecording() {
    recording = false;
    clearInterval(recTimerInt);
    document.getElementById('chatRecTimer').style.display = 'none';
    document.getElementById('chatStopRecBtn').style.display = 'none';
    document.getElementById('chatCancelRecBtn').style.display = 'none';
    document.getElementById('chatMoreBtn').style.display = 'flex';
    document.getElementById('chatSendBtn').style.display = 'flex';
    if (mediaRecorder) mediaRecorder.stop();
  }
  function cancelRecording() {
    recCancelled = true;
    stopRecording();
    toast('Recording discarded');
  }

  // ─── BUBBLE ACTIONS / LONG-PRESS MENU ───────────────
  function onBubbleClick(id, ev) {
    if (lpFired) { lpFired = false; return; }
    if (selectMode) { toggleSelect(id); return; }
  }
  function startLongPress(id) {
    lpFired = false;
    clearTimeout(lpTimer);
    lpTimer = setTimeout(() => {
      lpFired = true;
      if (navigator.vibrate) navigator.vibrate(30);
      openMenu(id);
    }, 450);
  }
  function endLongPress() { clearTimeout(lpTimer); }
  function openMenu(id, ev) {
  const m = msgs.find(x => x.id === id); if (!m) return;
  document.getElementById('chatMsgMenu')?.remove();
  const isDesktop = window.innerWidth > 700 && ev && ev.clientX;
  const sheet = document.createElement('div');
  sheet.id = 'chatMsgMenu';
  if (isDesktop) {
    sheet.className = 'msg-ctx-bg';
    sheet.innerHTML = `<div class="msg-ctx-menu open" style="left:${ev.clientX}px;top:${ev.clientY}px">
      ${menuItemsHtml(m, id)}
    </div>`;
  } else {
    sheet.className = 'chat-sheet-overlay';
    sheet.innerHTML = `<div class="chat-sheet">${menuItemsHtml(m, id)}</div>`;
  }
  sheet.onclick = e => { if (e.target === sheet) sheet.remove(); };
  document.body.appendChild(sheet);
}
function menuItemsHtml(m, id) {
  const mine = isMine(m);
  return `
    <div class="ctx-item" onclick="Chat.reactTo('${id}','❤️')">❤️ React</div>
    <div class="ctx-item" onclick="Chat.replyTo('${id}')">↩️ Reply</div>
    <div class="ctx-item" onclick="Chat.forwardMsg('${id}')">↪️ Forward</div>
    <div class="ctx-item" onclick="Chat.copyMsg('${id}')">📋 Copy</div>
    <div class="ctx-item" onclick="Chat.togglePin('${id}')">📌 Pin</div>
    <div class="ctx-item" onclick="Chat.toggleStar('${id}')">⭐ Star</div>
    ${mine && m.type === 'text' ? `<div class="ctx-item" onclick="Chat.editMsg('${id}')">✏️ Edit</div>` : ''}
    <div class="ctx-item" onclick="Chat.infoMsg('${id}')">ℹ️ Info</div>
    ${mine ? `<div class="ctx-item danger" onclick="Chat.deleteMsg('${id}','everyone')">🗑️ Delete for everyone</div>` : ''}
    <div class="ctx-item danger" onclick="Chat.deleteMsg('${id}','me')">🗑️ Delete for me</div>`;
}
  async function reactTo(id, emoji) {
    document.getElementById('chatMsgMenu')?.remove();
    try {
      const data = await api('POST', '/api/chat/' + id + '/react', { coupleId: coupleId(), role: myRole(), emoji });
      const idx = msgs.findIndex(m => m.id === id); if (idx > -1) msgs[idx] = data;
      render();
    } catch (e) {}
  }
  function replyTo(id) {
    document.getElementById('chatMsgMenu')?.remove();
    const m = msgs.find(x => x.id === id); if (!m) return;
    editingId = null;
    replyingTo = id;
    const banner = document.getElementById('chatComposerBanner');
    banner.style.display = 'flex';
    banner.innerHTML = `<div class="chat-banner-text">↩️ Replying to: ${esc((m.text||'Media').slice(0,60))}</div><button onclick="Chat.closeBanner()">✕</button>`;
    document.getElementById('chatIn').focus();
  }
  function closeBanner() { const b = document.getElementById('chatComposerBanner'); if (b) { b.style.display = 'none'; b.innerHTML = ''; } replyingTo = null; editingId = null; }
  async function togglePin(id) {
    document.getElementById('chatMsgMenu')?.remove();
    const m = msgs.find(x => x.id === id); if (!m) return;
    try {
      const data = await api('POST', '/api/chat/' + id + '/pin', { coupleId: coupleId(), pinned: !m.pinned });
      const idx = msgs.findIndex(x => x.id === id); if (idx > -1) msgs[idx] = data;
      render();
    } catch (e) {}
  }
  async function toggleStar(id) {
    document.getElementById('chatMsgMenu')?.remove();
    try {
      const data = await api('POST', '/api/chat/' + id + '/star', { coupleId: coupleId(), role: myRole() });
      const idx = msgs.findIndex(x => x.id === id); if (idx > -1) msgs[idx] = data;
      render(); toast('Updated ⭐');
    } catch (e) {}
  }
  function forwardMsg(id) {
    document.getElementById('chatMsgMenu')?.remove();
    const m = msgs.find(x => x.id === id); if (!m) return;
    sendMessage({ type: m.type, text: m.text, mediaUrl: m.media_url, mediaMeta: m.media_meta, forwarded: true });
    toast('Forwarded');
  }
  function copyMsg(id) {
    document.getElementById('chatMsgMenu')?.remove();
    const m = msgs.find(x => x.id === id); if (!m) return;
    if (!m.text) { toast('Nothing to copy'); return; }
    navigator.clipboard?.writeText(m.text).then(() => toast('Copied')).catch(() => toast('Copy failed'));
  }
  let editingId = null;
  function editMsg(id) {
    document.getElementById('chatMsgMenu')?.remove();
    const m = msgs.find(x => x.id === id); if (!m || m.type !== 'text') return;
    replyingTo = null;
    editingId = id;
    const inp = document.getElementById('chatIn');
    inp.value = m.text || '';
    inp.focus();
    const banner = document.getElementById('chatComposerBanner');
    banner.style.display = 'flex';
    banner.innerHTML = `<div class="chat-banner-text">✏️ Editing message</div><button onclick="Chat.cancelEdit()">✕</button>`;
  }
  function cancelEdit() { editingId = null; closeBanner(); document.getElementById('chatIn').value = ''; }
  async function saveEdit(text) {
    try {
      const data = await api('PATCH', '/api/chat/' + editingId, { coupleId: coupleId(), senderRole: myRole(), text });
      const idx = msgs.findIndex(m => m.id === editingId);
      if (idx > -1) msgs[idx] = data;
      render();
    } catch (e) { toast('Edit failed'); }
    editingId = null; closeBanner();
  }
  function infoMsg(id) {
    document.getElementById('chatMsgMenu')?.remove();
    const m = msgs.find(x => x.id === id); if (!m) return;
    const sent = new Date(m.created_at).toLocaleString();
    const status = m.read ? 'Read' : m.delivered ? 'Delivered' : 'Sent';
    toast(`${status} · ${sent}`);
  }
  function openStarred() {
    const starred = msgs.filter(m => (m.starred_by || []).includes(myRole()));
    if (!starred.length) { toast('No starred messages'); return; }
    toast(starred.length + ' starred message(s)');
  }
  async function deleteMsg(id, mode) {
    document.getElementById('chatMsgMenu')?.remove();
    try {
      await api('DELETE', '/api/chat/' + id, { coupleId: coupleId(), senderRole: myRole(), mode });
      if (mode === 'everyone') { const idx = msgs.findIndex(x => x.id == id); if (idx > -1) { msgs[idx].deleted = true; } }
      else { const idx = msgs.findIndex(x => x.id == id); if (idx > -1) { msgs[idx].deleted_for = (msgs[idx].deleted_for || '') + ',' + myRole(); } }
      render();
    } catch (e) { toast('Delete failed'); }
  }

  // ─── SELECT MODE ─────────────────────────────────────
  function enterSelectMode(id) {
    document.getElementById('chatMsgMenu')?.remove();
    selectMode = true; selectedIds = new Set([id]);
    document.getElementById('chatSelectToolbar').classList.add('show');
    updateSelectCount();
  }
  function toggleSelect(id) {
    if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
    if (!selectedIds.size) exitSelectMode(); else updateSelectCount();
  }
  function updateSelectCount() { document.getElementById('chatSelectCount').textContent = selectedIds.size + ' selected'; }
  function exitSelectMode() { selectMode = false; selectedIds.clear(); document.getElementById('chatSelectToolbar').classList.remove('show'); }
  async function deleteSelected() {
    for (const id of selectedIds) await deleteMsg(id, 'me');
    exitSelectMode();
  }

  // ─── SEARCH ──────────────────────────────────────────
  function openSearch() { document.getElementById('chatSearchBar').classList.add('show'); document.getElementById('chatSearchInput').focus(); }
  function closeSearch() { document.getElementById('chatSearchBar').classList.remove('show'); document.getElementById('chatSearchInput').value=''; document.getElementById('chatSearchResults').innerHTML=''; }
  async function runSearch(q) {
    if (!q.trim()) { document.getElementById('chatSearchResults').innerHTML = ''; return; }
    try {
      const rows = await api('GET', '/api/chat/' + coupleId() + '/search?q=' + encodeURIComponent(q));
      const el = document.getElementById('chatSearchResults');
      el.innerHTML = (rows||[]).map(r => `<div class="chat-search-result" onclick="Chat.closeSearch();Chat.scrollToMsg(${r.id})">${esc((r.text||'Media').slice(0,80))}</div>`).join('') || '<div class="empty">No results</div>';
    } catch (e) {}
  }

  // ─── BOTTOM SHEET (⋮ menu) ───────────────────────────
  function openSheet() {
    let sheet = document.getElementById('chatBottomSheet');
    if (sheet) { sheet.classList.add('open'); return; }
    sheet = document.createElement('div');
    sheet.id = 'chatBottomSheet';
    sheet.className = 'chat-bottom-sheet-overlay open';
    sheet.innerHTML = `<div class="chat-bottom-sheet">
      <div class="chat-sheet-handle"></div>
      <div class="chat-sheet-grid">
        <div class="chat-sheet-opt" onclick="document.getElementById('chatGalleryInput').click()"><span>🖼</span>Photos</div>
        <div class="chat-sheet-opt" onclick="document.getElementById('chatCameraInput').click()"><span>📷</span>Camera</div>
        <div class="chat-sheet-opt" onclick="document.getElementById('chatVideoInput').click()"><span>🎥</span>Videos</div>
        <div class="chat-sheet-opt" onclick="document.getElementById('chatFileInput').click()"><span>📁</span>Documents</div>
        <div class="chat-sheet-opt" onclick="document.getElementById('chatAudioInput').click()"><span>🎵</span>Audio</div>
        <div class="chat-sheet-opt" onclick="Chat.closeSheet();Chat.toggleRecord()"><span>🎤</span>Voice</div>
        <div class="chat-sheet-opt" onclick="Chat.openGifPanel()"><span>🎬</span>GIFs</div>
        <div class="chat-sheet-opt" onclick="Chat.openStickerPanel()"><span>🎭</span>Stickers</div>
        <div class="chat-sheet-opt" onclick="Chat.openEmojiPanel()"><span>😊</span>Emojis</div>
        <div class="chat-sheet-opt" onclick="Chat.sendLocation()"><span>📍</span>Location</div>
        <div class="chat-sheet-opt" onclick="Chat.sendContactCard()"><span>👤</span>Contact</div>
        <div class="chat-sheet-opt" onclick="Chat.openGiftPanel()"><span>🎁</span>Couple Gifts</div>
        <div class="chat-sheet-opt" onclick="Chat.openMemories()"><span>📔</span>Memories</div>
        <div class="chat-sheet-opt" onclick="Chat.openPollComposer()"><span>📊</span>Poll</div>
      </div>
      <input type="file" id="chatCameraInput" accept="image/*" capture="environment" style="display:none" onchange="Chat.onImagePick(this)">
      <input type="file" id="chatGalleryInput" accept="image/*" multiple style="display:none" onchange="Chat.onImagePick(this)">
      <input type="file" id="chatVideoInput" accept="video/*" style="display:none" onchange="Chat.onImagePick(this)">
      <input type="file" id="chatFileInput" style="display:none" onchange="Chat.onImagePick(this)">
      <input type="file" id="chatAudioInput" accept="audio/*" style="display:none" onchange="Chat.onAudioPick(this)">
    </div>`;
    sheet.onclick = e => { if (e.target === sheet) closeSheet(); };
    document.body.appendChild(sheet);
  }
  function closeSheet() { document.getElementById('chatBottomSheet')?.classList.remove('open'); }

  // ─── PANEL LIFECYCLE ─────────────────────────────────
  // Every modal above (attach sheet, gift/emoji/sticker/poll/GIF panels,
  // contact sheet, message long-press menu) is appended straight to
  // document.body as a position:fixed overlay so it can sit above the whole
  // app. That also means the SPA router's page-swap — which only toggles the
  // .active class on .page elements — never touches them: they are outside
  // any .page and simply keep existing, which is how a GIF panel opened in
  // Chat could still be visible after Android Back or navigating elsewhere.
  // destroyPanels() removes every one of these overlay nodes from the DOM
  // outright (not just hiding them), which also drops any listeners attached
  // directly to those nodes. It's called from the app's central goto()
  // router on every navigation (including Android Back, since that also
  // resolves to a goto() via popstate), and from unload.
  const PANEL_IDS = ['chatGiftPanel', 'chatMsgMenu', 'chatBottomSheet', 'chatEmojiPanel',
    'chatStickerPanel', 'chatContactSheet', 'chatPollPanel', 'chatGifPanel'];
  function destroyPanels() {
    clearTimeout(gifDebounce);
    PANEL_IDS.forEach(id => document.getElementById(id)?.remove());
  }
  window.addEventListener('pagehide', destroyPanels);

  const EMOJI_CATEGORIES = {
    'Recent': [],
    'Smileys': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊','😇','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤗','🤩','🤔','🤨','😐','😑','😶','😏','😒','🙄','😬','😴','😪','😷','🤒','🤕'],
    'Emotions': ['😢','😭','😤','😠','😡','🥺','😨','😰','😥','😓','🤯','😳','🥵','🥶','😱','😖','😣','😞','😔','😟','😕','🙁','☹️','😩','😫','😵','🤐','🥴','🤢','🤮'],
    'Love': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💕','💞','💓','💗','💖','💘','💝','💟','💔','❣️','💌','😻','😽','💑','💏','👩‍❤️‍👨','👩‍❤️‍💋‍👨'],
    'Gestures': ['👍','👎','👊','✊','🤛','🤜','🤞','✌️','🤟','🤘','👌','🤏','👈','👉','👆','👇','☝️','✋','🤚','🖐️','🖖','👋','🤙','💪','🙏','👏','🙌','🤝','🫶'],
    'Celebration': ['🎉','🎊','🎈','🎁','🎂','🍾','🥂','✨','🌟','💫','🔥','💯','🏆','🥳','🎆','🎇','🪅','🎀'],
  };
  const EMOJI_KEYWORDS = {
    love:['❤️','😍','🥰','💕','💖','😘'], heart:['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔'],
    happy:['😀','😄','😊','🥳'], sad:['😢','😭','😞','😔'], laugh:['😂','🤣','😆'],
    angry:['😠','😡','😤'], kiss:['😘','😙','😚','💋'], hug:['🤗','🫂'], fire:['🔥'],
    party:['🎉','🎊','🥳','🎈'], cake:['🎂','🍰'], ring:['💍'], star:['🌟','✨','⭐'],
    thumbsup:['👍'], clap:['👏'], pray:['🙏'], think:['🤔'], cry:['😭','😢'],
    cool:['😎'], wink:['😉'], tired:['😴','😪'], sick:['🤒','🤢'], flower:['🌹','💐','🌸'],
  };
  function getRecentEmojis() {
    try { return JSON.parse(localStorage.getItem('chatRecentEmojis') || '[]'); } catch (e) { return []; }
  }
  function pushRecentEmoji(e) {
    try {
      let r = getRecentEmojis().filter(x => x !== e);
      r.unshift(e);
      r = r.slice(0, 24);
      localStorage.setItem('chatRecentEmojis', JSON.stringify(r));
    } catch (err) {}
  }
  let emojiActiveCat = 'Smileys';
  function openEmojiPanel() {
    closeSheet();
    let panel = document.getElementById('chatEmojiPanel');
    if (panel) { panel.classList.add('open'); return; }
    panel = document.createElement('div');
    panel.id = 'chatEmojiPanel';
    panel.className = 'chat-bottom-sheet-overlay open';
    panel.innerHTML = `<div class="chat-bottom-sheet chat-emoji-sheet" style="padding-bottom:4px">
      <div class="chat-sheet-handle"></div>
      <div class="picker-gif-search"><input type="text" id="emojiSearchInput" placeholder="Search emoji (e.g. love, fire, cake)..." oninput="Chat.filterEmoji(this.value)"></div>
      <div class="picker-tabs" id="emojiTabs">
        ${Object.keys(EMOJI_CATEGORIES).map(cat => `<div class="picker-tab${cat === emojiActiveCat ? ' active' : ''}" data-cat="${cat}" onclick="Chat.switchEmojiTab('${cat}')">${cat}</div>`).join('')}
      </div>
      <div class="picker-body" id="emojiBody" style="max-height:260px"></div>
    </div>`;
    panel.onclick = e => { if (e.target === panel) panel.classList.remove('open'); };
    document.body.appendChild(panel);
    renderEmojiGrid(emojiActiveCat);
  }
  function switchEmojiTab(cat) {
    emojiActiveCat = cat;
    document.querySelectorAll('#emojiTabs .picker-tab').forEach(t => t.classList.toggle('active', t.dataset.cat === cat));
    document.getElementById('emojiSearchInput').value = '';
    renderEmojiGrid(cat);
  }
  function renderEmojiGrid(cat) {
    const body = document.getElementById('emojiBody');
    if (!body) return;
    const list = cat === 'Recent' ? getRecentEmojis() : EMOJI_CATEGORIES[cat];
    body.innerHTML = list.length
      ? `<div class="picker-emoji-grid">${list.map(e => `<div class="picker-emoji" onclick="Chat.sendEmojiTap('${e}')">${e}</div>`).join('')}</div>`
      : `<div class="picker-loading">${cat === 'Recent' ? 'No recent emoji yet — send a few!' : 'No emoji here'}</div>`;
  }
  let emojiFilterDebounce;
  function filterEmoji(q) {
    clearTimeout(emojiFilterDebounce);
    emojiFilterDebounce = setTimeout(() => {
      const body = document.getElementById('emojiBody');
      const query = q.trim().toLowerCase();
      if (!query) { renderEmojiGrid(emojiActiveCat); return; }
      let results = [];
      Object.entries(EMOJI_KEYWORDS).forEach(([kw, emojis]) => { if (kw.includes(query)) results.push(...emojis); });
      results = [...new Set(results)];
      body.innerHTML = results.length
        ? `<div class="picker-emoji-grid">${results.map(e => `<div class="picker-emoji" onclick="Chat.sendEmojiTap('${e}')">${e}</div>`).join('')}</div>`
        : `<div class="picker-loading">No matches — try "love", "fire", "cake"...</div>`;
    }, 150);
  }
  function sendEmojiTap(e) { pushRecentEmoji(e); sendEmoji(e); }

  // ─── STICKERS ─────────────────────────────────────────
  const STICKERS = [
    { emoji: '😍', name: 'Adore' }, { emoji: '🥰', name: 'In Love' }, { emoji: '😘', name: 'Kiss' },
    { emoji: '🤗', name: 'Hug' }, { emoji: '😂', name: 'LOL' }, { emoji: '🥺', name: 'Puppy Eyes' },
    { emoji: '😴', name: 'Sleepy' }, { emoji: '🙈', name: 'Shy' }, { emoji: '💃', name: 'Dance' },
    { emoji: '🎉', name: 'Yay!' }, { emoji: '😤', name: 'Grumpy' }, { emoji: '🥳', name: 'Party' },
  ];
  function openStickerPanel() {
    closeSheet();
    let panel = document.getElementById('chatStickerPanel');
    if (panel) { panel.classList.add('open'); return; }
    panel = document.createElement('div');
    panel.id = 'chatStickerPanel';
    panel.className = 'chat-bottom-sheet-overlay open';
    panel.innerHTML = `<div class="chat-bottom-sheet">
      <div class="chat-sheet-handle"></div>
      <div class="picker-sticker-grid">
        ${STICKERS.map(s => `<div class="picker-sticker" onclick="Chat.sendSticker('${s.emoji}','${s.name}')"><div class="picker-sticker-emoji">${s.emoji}</div><div class="picker-sticker-name">${s.name}</div></div>`).join('')}
      </div>
    </div>`;
    panel.onclick = e => { if (e.target === panel) panel.classList.remove('open'); };
    document.body.appendChild(panel);
  }
  function sendSticker(emoji, name) {
    document.getElementById('chatStickerPanel')?.classList.remove('open');
    sendMessage({ type: 'sticker', mediaMeta: { emoji, name } });
  }

  // ─── CONTACT CARD ───────────────────────────────────────
  function sendContactCard() {
    closeSheet();
    const name = (window.S && window.S.myName) || 'Me';
    sendMessage({ type: 'contact', mediaMeta: { name } });
  }
  function openContactCard(name) {
    document.getElementById('chatContactSheet')?.remove();
    const isPartner = name && window.S && name === window.S.partnerName;
    const sheet = document.createElement('div');
    sheet.id = 'chatContactSheet';
    sheet.className = 'chat-sheet-overlay';
    sheet.innerHTML = `<div class="chat-sheet chat-contact-detail">
      <div class="chat-sheet-handle"></div>
      <div class="msg-contact-av" style="width:64px;height:64px;font-size:24px;margin:0 auto 12px">${esc((name||'?')[0])}</div>
      <div style="text-align:center;font-weight:700;font-size:16px;margin-bottom:2px">${esc(name||'Contact')}</div>
      <div style="text-align:center;color:rgba(255,255,255,.5);font-size:12.5px;margin-bottom:18px">Contact card</div>
      ${isPartner ? `
        <div class="ctx-item" onclick="document.getElementById('chatContactSheet').remove();Call.startCall('voice')">🎙️ Voice call</div>
        <div class="ctx-item" onclick="document.getElementById('chatContactSheet').remove();Call.startCall('video')">📹 Video call</div>
      ` : `<div class="ctx-item" style="opacity:.6;cursor:default">This contact isn't linked to a call</div>`}
      <div class="ctx-item" onclick="document.getElementById('chatContactSheet').remove()">Close</div>
    </div>`;
    sheet.onclick = e => { if (e.target === sheet) sheet.remove(); };
    document.body.appendChild(sheet);
  }

  // ─── MEMORIES (routes to the existing Camera/Memories page) ──
  function openMemories() {
    closeSheet();
    if (typeof window.goto === 'function') window.goto('camera');
    else toast('Open Memories from the menu 📔');
  }

  // ─── POLLS (lightweight — no schema/backend changes; stored in mediaMeta) ──
  function openPollComposer() {
    closeSheet();
    let panel = document.getElementById('chatPollPanel');
    if (panel) { panel.remove(); }
    panel = document.createElement('div');
    panel.id = 'chatPollPanel';
    panel.className = 'chat-bottom-sheet-overlay open';
    panel.innerHTML = `<div class="chat-bottom-sheet">
      <div class="chat-sheet-handle"></div>
      <div style="padding:4px 4px 10px;font-size:14px;font-weight:700;color:var(--white)">📊 Create a Poll</div>
      <input type="text" id="pollQuestion" placeholder="Ask a question..." style="width:100%;padding:10px 14px;border-radius:14px;border:1px solid var(--border);background:rgba(255,255,255,.05);color:#fff;margin-bottom:8px">
      <input type="text" id="pollOpt1" placeholder="Option 1" style="width:100%;padding:9px 14px;border-radius:12px;border:1px solid var(--border);background:rgba(255,255,255,.05);color:#fff;margin-bottom:8px">
      <input type="text" id="pollOpt2" placeholder="Option 2" style="width:100%;padding:9px 14px;border-radius:12px;border:1px solid var(--border);background:rgba(255,255,255,.05);color:#fff;margin-bottom:8px">
      <input type="text" id="pollOpt3" placeholder="Option 3 (optional)" style="width:100%;padding:9px 14px;border-radius:12px;border:1px solid var(--border);background:rgba(255,255,255,.05);color:#fff;margin-bottom:12px">
      <button class="chat-sheet-item" style="background:var(--accent);border-radius:12px;font-weight:700" onclick="Chat.submitPoll()">Send Poll</button>
    </div>`;
    panel.onclick = e => { if (e.target === panel) panel.remove(); };
    document.body.appendChild(panel);
  }
  function submitPoll() {
    const q = document.getElementById('pollQuestion')?.value.trim();
    const opts = [document.getElementById('pollOpt1')?.value.trim(), document.getElementById('pollOpt2')?.value.trim(), document.getElementById('pollOpt3')?.value.trim()].filter(Boolean);
    if (!q || opts.length < 2) { toast('Add a question and at least 2 options'); return; }
    document.getElementById('chatPollPanel')?.remove();
    sendMessage({ type: 'poll', text: q, mediaMeta: { options: opts } });
  }
  function votePoll(msgId, option) {
    sendMessage({ type: 'text', text: `🗳️ Voted "${option}"`, replyTo: msgId });
  }

  async function openGifPanel() {
    closeSheet();
    let panel = document.getElementById('chatGifPanel');
    if (panel) { panel.classList.add('open'); return; }
    panel = document.createElement('div');
    panel.id = 'chatGifPanel';
    panel.className = 'chat-bottom-sheet-overlay open';
    panel.innerHTML = `<div class="chat-bottom-sheet chat-gif-sheet">
      <div class="chat-sheet-handle"></div>
      <input type="text" id="gifSearchInput" placeholder="Search GIFs..." oninput="Chat.searchGifs(this.value)">
      <div id="gifResults" class="chat-gif-grid"><div class="empty">Type to search</div></div>
    </div>`;
    panel.onclick = e => { if (e.target === panel) panel.classList.remove('open'); };
    document.body.appendChild(panel);
    searchGifs('love');
  }
  let gifDebounce;
  function searchGifs(q) {
    clearTimeout(gifDebounce);
    gifDebounce = setTimeout(async () => {
      const el = document.getElementById('gifResults');
      el.innerHTML = '<div class="empty">Loading...</div>';
      try {
        // Tenor's public API was fully shut down by Google on June 30, 2026 —
        // that's why GIF search returned nothing no matter what you typed.
        // Switched to Giphy, using their long-standing public dev key (rate-limited
        // to 100 req/hr but needs no signup). Get your own free key at
        // https://developers.giphy.com for production use — swap it in below.
        const key = 'dc6zaTOxFJmzC';
        const r = await fetch(`https://api.giphy.com/v1/gifs/search?q=${encodeURIComponent(q||'love')}&api_key=${key}&limit=24&rating=pg-13`);
        const data = await r.json();
        const results = data.data || [];
        if (!results.length) { el.innerHTML = '<div class="empty">No GIFs found</div>'; return; }
        el.innerHTML = results
          .map(g => g.images?.fixed_height_small?.url || g.images?.fixed_height?.url || g.images?.downsized?.url)
          .filter(url => !!url)
          .map(url => `<img src="${esc(url)}" loading="lazy" onclick="Chat.sendGif('${esc(url)}')">`)
          .join('') || '<div class="empty">No GIFs found</div>';
      } catch (e) { el.innerHTML = '<div class="empty">GIF search failed — check connection</div>'; }
    }, 400);
  }
  // ─── SWIPE TO REPLY (WhatsApp-style) ──────────────────
  let swipeState = null;
  const SWIPE_TRIGGER = 64, SWIPE_MAX = 84;
  function initSwipeToReply() {
    const box = document.getElementById('chatMsgs');
    if (!box || box._swipeInit) return;
    box._swipeInit = true;
    box.addEventListener('touchstart', onSwipeStart, { passive: true });
    box.addEventListener('touchmove', onSwipeMove, { passive: false });
    box.addEventListener('touchend', onSwipeEnd, { passive: true });
    box.addEventListener('touchcancel', onSwipeEnd, { passive: true });
    // Mouse support for desktop testing
    box.addEventListener('mousedown', onSwipeStart);
    box.addEventListener('mousemove', onSwipeMove);
    window.addEventListener('mouseup', onSwipeEnd);
  }
  function swipePoint(e) { return e.touches ? e.touches[0] : e; }
  function onSwipeStart(e) {
    const row = e.target.closest && e.target.closest('.chat-row');
    if (!row || e.target.closest('.chat-swipe-reply-icon')) return;
    const p = swipePoint(e);
    swipeState = { row, startX: p.clientX, startY: p.clientY, dx: 0, locked: null, id: row.dataset.id };
  }
  function onSwipeMove(e) {
    if (!swipeState) return;
    const p = swipePoint(e);
    const dx = p.clientX - swipeState.startX;
    const dy = p.clientY - swipeState.startY;
    if (swipeState.locked === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      swipeState.locked = Math.abs(dx) > Math.abs(dy);
      if (swipeState.locked) endLongPress();
    }
    if (!swipeState.locked) { swipeState = null; return; }
    if (dx <= 0) { swipeState.dx = 0; } // only swipe rightward, like WhatsApp
    else { swipeState.dx = Math.min(dx, SWIPE_MAX); }
    if (e.cancelable) e.preventDefault();
    const bubble = swipeState.row.querySelector('.chat-bubble');
    const icon = swipeState.row.querySelector('.chat-swipe-reply-icon');
    if (bubble) bubble.style.transform = `translateX(${swipeState.dx}px)`;
    if (icon) {
      const p2 = Math.min(1, swipeState.dx / SWIPE_TRIGGER);
      icon.style.opacity = p2;
      icon.style.transform = `translateX(${-8 + swipeState.dx * 0.3}px) scale(${0.7 + p2 * 0.3})`;
    }
  }
  function onSwipeEnd() {
    if (!swipeState) return;
    const { row, dx, id } = swipeState;
    const bubble = row.querySelector('.chat-bubble');
    const icon = row.querySelector('.chat-swipe-reply-icon');
    if (bubble) { bubble.style.transition = 'transform .2s ease'; bubble.style.transform = 'translateX(0)'; setTimeout(() => { if (bubble) bubble.style.transition = ''; }, 220); }
    if (icon) { icon.style.transition = 'opacity .2s ease, transform .2s ease'; icon.style.opacity = 0; icon.style.transform = ''; setTimeout(() => { if (icon) icon.style.transition = ''; }, 220); }
    if (dx >= SWIPE_TRIGGER) {
      if (navigator.vibrate) navigator.vibrate(25);
      replyTo(id);
    }
    swipeState = null;
  }

  // ─── REALTIME (instant delivery + instant tick updates) ─
  // Supabase Realtime push replaces the wait for the next poll tick.
  // The 2.5s poll (startPolling, above) stays on as a fallback safety
  // net — if the socket ever drops, messages/read-receipts still
  // arrive within one poll cycle instead of being lost.
  let realtimeChannel = null;
  function startRealtime() {
    if (realtimeChannel) return; // already subscribed
    if (!window.supabase || !window.supabase.createClient) return; // SDK not loaded — poll-only
    if (!window.__SUPABASE_URL__ || !window.__SUPABASE_ANON_KEY__) return; // no client creds exposed
    if (!coupleId()) return;
    try {
      const sb = window.supabase.createClient(window.__SUPABASE_URL__, window.__SUPABASE_ANON_KEY__);
      realtimeChannel = sb.channel('chat-' + coupleId())
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'chat_messages',
          filter: 'couple_id=eq.' + coupleId()
        }, (payload) => {
          const r = payload.new;
          if (!r) return;
          const idx = msgs.findIndex(m => m.id === r.id || (r.client_id && m.client_id === r.client_id));
          if (idx > -1) msgs[idx] = r; else msgs.push(r);
          if (r.created_at && (!lastMsgTs || r.created_at > lastMsgTs)) lastMsgTs = r.created_at;
          render();
          const box = document.getElementById('chatMsgs');
          const nearBottom = box && (box.scrollHeight - box.scrollTop - box.clientHeight < 150);
          if (nearBottom || isMine(r)) { scrollToBottom(true); reanchorAfterImages(); }
          if (!isMine(r) && document.getElementById('page-chat')?.classList.contains('active') && document.hasFocus()) {
            markRead();
          }
        })
        .subscribe((status) => {
          console.log('[Chat realtime]', status);
        });
    } catch (e) { realtimeChannel = null; }
  }

  // ─── INIT ────────────────────────────────────────────
  function init() {
    if (!coupleId()) { setTimeout(init, 1000); return; }
    loadMessages();
    startPresence();
    startPolling();
    startRealtime();
    fetchPresence();
    initSwipeToReply();
    const nameEl = document.getElementById('chatHeaderName');
    if (nameEl) nameEl.textContent = window.S.partnerName || 'Partner';
    const avEl = document.getElementById('chatHeaderAv');
    if (avEl) avEl.textContent = (window.S.partnerName || 'P')[0];
    // No standalone fetchPresence interval here — pollNew() already calls
    // fetchPresence() on every tick (2.5s on the chat page, ~20s elsewhere,
    // paused when backgrounded), so a separate 15s timer was pure duplication.
  }
  document.addEventListener('DOMContentLoaded', () => setTimeout(init, 500));

  return {
    onChatScroll, scrollToBottom, sendText, onTypingInput, onImagePick, toggleRecord,
    onBubbleClick, openMenu, reactTo, replyTo, closeBanner, togglePin, toggleStar,
    openStarred, deleteMsg, enterSelectMode, deleteSelected, exitSelectMode,
    openSearch, closeSearch, runSearch, scrollToMsg, sendGif, sendEmoji, sendEmojiTap,
    openEmojiPanel, switchEmojiTab, filterEmoji, openGifPanel, searchGifs, markRead, init, openSheet, closeSheet,
    forwardMsg, copyMsg, editMsg, cancelEdit, infoMsg, cancelRecording, startLongPress, endLongPress,
    onAudioPick, sendLocation, openGiftPanel, sendGift, toggleVoicePlay,
    openStickerPanel, sendSticker, sendContactCard, openContactCard, openMemories, openPollComposer, submitPoll, votePoll,
    destroyPanels
  };
})();
window.Chat = Chat;