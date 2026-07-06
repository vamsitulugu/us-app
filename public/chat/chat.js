/*public/chat/chat.js*/
// ═══ CHAT MODULE — presence, fixed layout, emoji/gif, redesigned composer ═══
// v2: Realtime-first (Supabase websockets) with polling fallback for instant,
// low-egress delivery. Falls back to the old 2.5s polling automatically if
// Realtime can't connect (e.g. project misconfigured), so nothing breaks.
const Chat = (function () {
  let msgs = [];
  let presence = { user1: null, user2: null };
  let presenceInterval = null;
  let pollInterval = null;
  let lastMsgTs = null;
  let selectMode = false;
  let selectedIds = new Set();
  let recording = false, mediaRecorder = null, recChunks = [], recStart = 0, recTimerInt = null, recCancelled = false;
  let replyingTo = null;
  let lpTimer = null, lpFired = false;

  // ─── REALTIME STATE ──────────────────────────────────
  let sbClient = null;
  let rtChannel = null;
  let rtConnected = false;
  let rtRetryDelay = 2000; // backoff on reconnect attempts

  function coupleId() { return window.S && window.S.coupleId; }
  function myRole() { return window.S && window.S.role; }
  function otherRole() { return myRole() === 'user1' ? 'user2' : 'user1'; }
  function isMine(m) { return m.sender_role === myRole(); }

  // ─── SUPABASE CLIENT (read-only, for Realtime only) ──
  // All writes still go through the existing Express API — this client is
  // only used to subscribe to postgres_changes so new rows/updates arrive
  // instantly instead of via polling.
  function getSbClient() {
    if (sbClient) return sbClient;
    if (!window.supabase || !window.__SUPABASE_URL__ || !window.__SUPABASE_ANON_KEY__) return null;
    try {
      sbClient = window.supabase.createClient(window.__SUPABASE_URL__, window.__SUPABASE_ANON_KEY__, {
        realtime: { params: { eventsPerSecond: 10 } }
      });
    } catch (e) { sbClient = null; }
    return sbClient;
  }

  // ─── PRESENCE ───────────────────────────────────────
  function startPresence() {
    sendPresence('online');
    if (presenceInterval) clearInterval(presenceInterval);
    presenceInterval = setInterval(() => {
      if (document.visibilityState === 'visible') sendPresence('online');
    }, 20000);

    document.addEventListener('visibilitychange', () => {
      sendPresence(document.visibilityState === 'visible' ? 'online' : 'away');
    });
    window.addEventListener('pagehide', () => sendPresence('offline'));
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

  // ─── LOAD MESSAGES (initial, always via REST) ───────
  async function loadMessages() {
    if (!coupleId()) return;
    try {
      const rows = await api('GET', '/api/chat/' + coupleId() + '?limit=200');
      msgs = rows || [];
      lastMsgTs = msgs.length ? msgs[msgs.length - 1].created_at : null;
      render();
      scrollToBottom(false);
    } catch (e) {}
  }

  // ─── Merge one incoming row (from realtime OR poll) ─
  function mergeIncoming(rows) {
    if (!rows || !rows.length) return;
    let changed = false;
    rows.forEach(r => {
      const idx = msgs.findIndex(m => m.id === r.id || (r.client_id && m.client_id === r.client_id));
      if (idx > -1) msgs[idx] = r; else msgs.push(r);
      changed = true;
    });
    if (!changed) return;
    msgs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    lastMsgTs = msgs.length ? msgs[msgs.length - 1].created_at : lastMsgTs;
    render();
    const box = document.getElementById('chatMsgs');
    const nearBottom = box && (box.scrollHeight - box.scrollTop - box.clientHeight < 150);
    if (nearBottom || rows.some(isMine)) scrollToBottom(true);
    else updateJumpBadge(rows.filter(r => !isMine(r)).length);
    if (rows.some(r => !isMine(r)) && document.getElementById('page-chat')?.classList.contains('active') && document.hasFocus()) {
      markRead();
    }
  }

  // ─── REALTIME SUBSCRIPTION (instant delivery) ───────
  function startRealtime() {
    const client = getSbClient();
    if (!client || !coupleId()) { startPolling(); return; }

    if (rtChannel) { try { client.removeChannel(rtChannel); } catch (e) {} rtChannel = null; }

    rtChannel = client.channel('chat-' + coupleId())
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'chat_messages',
        filter: 'couple_id=eq.' + coupleId()
      }, payload => {
        const row = payload.new || payload.old;
        if (!row) return;
        mergeIncoming([row]);
      })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'chat_presence',
        filter: 'couple_id=eq.' + coupleId()
      }, () => { fetchPresence(); })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          rtConnected = true;
          rtRetryDelay = 2000;
          // Realtime is live — stop the polling fallback to save egress.
          if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          rtConnected = false;
          // Fall back to polling immediately so messages keep flowing,
          // then keep trying to re-establish Realtime in the background.
          startPolling();
          setTimeout(() => { if (!rtConnected) startRealtime(); }, rtRetryDelay);
          rtRetryDelay = Math.min(rtRetryDelay * 1.6, 30000);
        }
      });
  }

  // ─── POLLING FALLBACK (only runs if Realtime is down) ─
  async function pollNew() {
    if (!coupleId()) return;
    try {
      const q = lastMsgTs ? '?after=' + encodeURIComponent(lastMsgTs) : '';
      const rows = await api('GET', '/api/chat/' + coupleId() + q);
      if (rows && rows.length) mergeIncoming(rows);
      fetchPresence();
    } catch (e) {}
  }

  function startPolling() {
    if (rtConnected) return; // Realtime already handling delivery
    if (pollInterval) return; // already polling
    pollInterval = setInterval(pollNew, 4000);
    pollNew();
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

  // ─── RENDER ──────────────────────────────────────────
  function render() {
    const box = document.getElementById('chatMsgs');
    if (!box) return;
    const prevBottomOffset = box.scrollHeight - box.scrollTop; // distance from bottom
    const wasNearBottom = prevBottomOffset - box.clientHeight < 150;

    const visible = msgs.filter(m => !(m.deleted_for || '').split(',').includes(myRole()));
    let html = '', lastDate = null;
    visible.forEach(m => {
      const d = new Date(m.created_at);
      const ds = d.toDateString();
      if (ds !== lastDate) { lastDate = ds; html += `<div class="chat-date-sep"><span>${fmtDaySep(d)}</span></div>`; }
      html += renderBubble(m);
    });
    box.innerHTML = html || `<div class="empty" style="padding:60px 20px"><div class="empty-ico">💬</div>Say hello 👋</div>`;
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

  function renderBubble(m) {
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
      const lat = m.media_meta?.lat, lng = m.media_meta?.lng;
      body = `<a href="https://maps.google.com/?q=${lat},${lng}" target="_blank" rel="noopener" style="display:block;color:inherit;text-decoration:none">📍 <u>Shared location</u></a>`;
    }
    else if (m.type === 'gift') body = `<div class="msg-gift"><div class="msg-gift-emoji">${esc(m.media_meta?.emoji || '🎁')}</div><div class="msg-gift-name">${esc(m.media_meta?.name || 'Gift')}</div></div>`;
    else if (m.type === 'call_log') return `<div class="chat-call-log"><span>${esc(m.text)}</span><span class="chat-call-time">${time}</span></div>`;
    else body = `<div class="chat-text">${linkify(esc(m.text || ''))}</div>`;

    const reactions = m.reactions && Object.keys(m.reactions).length
      ? `<div class="chat-reactions">${Object.entries(m.reactions).map(([e, roles]) => `<span class="chat-reaction-pill">${e} ${roles.length}</span>`).join('')}</div>` : '';

    const status = mine ? (m.read ? '✓✓' : m.delivered ? '✓✓' : '✓') : '';
    const statusClass = mine && m.read ? 'read' : '';
    const failedTag = m._failed ? `<span class="chat-retry" onclick="event.stopPropagation();Chat.retrySend('${m.client_id}')" style="color:#ff6b6b;font-size:10px;cursor:pointer;margin-left:6px">⚠️ tap to retry</span>` : '';

    return `<div class="chat-row ${mine ? 'me' : 'them'}" data-id="${m.id}" data-client-id="${m.client_id || ''}" onclick="Chat.onBubbleClick('${m.id}', event)" oncontextmenu="Chat.openMenu('${m.id}', event); return false;" ontouchstart="Chat.startLongPress('${m.id}')" ontouchend="Chat.endLongPress()" ontouchmove="Chat.endLongPress()">
      <div class="chat-bubble ${mine ? 'mine' : 'theirs'}">
        ${body}
        ${reactions}
        <div class="chat-meta"><span>${time}${m.edited ? ' · edited' : ''}</span>${mine ? `<span class="chat-status ${statusClass}">${status}</span>` : ''}${failedTag}</div>
      </div>
    </div>`;
  }

  function linkify(text) {
    return text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
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

  async function sendMessage(payload, retryClientId) {
    if (!coupleId()) { toast('Not connected'); return; }
    const clientId = retryClientId || genClientId();
    let optimistic = msgs.find(m => m.client_id === clientId);
    if (!optimistic) {
      optimistic = {
        id: 'temp_' + clientId, client_id: clientId, couple_id: coupleId(), sender_role: myRole(),
        created_at: new Date().toISOString(), delivered: false, read: false, ...payload
      };
      msgs.push(optimistic);
    } else {
      optimistic._failed = false;
    }
    render(); scrollToBottom(true);
    try {
      const saved = await api('POST', '/api/chat', { coupleId: coupleId(), clientId, senderRole: myRole(), ...payload });
      const idx = msgs.findIndex(m => m.client_id === clientId);
      if (idx > -1) msgs[idx] = saved;
      render();
    } catch (e) {
      const idx = msgs.findIndex(m => m.client_id === clientId);
      if (idx > -1) msgs[idx]._failed = true;
      render();
      toast('Send failed — tap to retry');
    }
  }

  function retrySend(clientId) {
    const m = msgs.find(x => x.client_id === clientId);
    if (!m) return;
    const payload = { type: m.type, text: m.text, mediaUrl: m.media_url, mediaMeta: m.media_meta, replyTo: m.reply_to };
    sendMessage(payload, clientId);
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

  function onImagePick(input) {
    if (!input.files[0]) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = e => { sendMessage({ type: 'image', mediaUrl: e.target.result }); input.value = ''; };
    reader.readAsDataURL(file);
  }

  function sendGif(url) { sendMessage({ type: 'gif', mediaUrl: url }); closeSheet(); }

  function onAudioPick(input) {
    if (!input.files[0]) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = e => { sendMessage({ type: 'audio', mediaUrl: e.target.result, mediaMeta: { name: file.name } }); input.value = ''; };
    reader.readAsDataURL(file);
    closeSheet();
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
        const reader = new FileReader();
        reader.onload = e => sendMessage({ type: 'voice', mediaUrl: e.target.result, mediaMeta: { duration: dur } });
        reader.readAsDataURL(blob);
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
    const row = ev && ev.currentTarget;
    const clientId = row && row.dataset && row.dataset.clientId;
    if (clientId) {
      const m = msgs.find(x => x.client_id === clientId);
      if (m && m._failed) { retrySend(clientId); return; }
    }
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
        <div class="chat-sheet-opt" onclick="Chat.openEmojiPanel()"><span>😊</span>Emoji</div>
        <div class="chat-sheet-opt" onclick="Chat.openGifPanel()"><span>🎬</span>GIF</div>
        <div class="chat-sheet-opt" onclick="Chat.openGiftPanel()"><span>🎁</span>Gifts</div>
        <div class="chat-sheet-opt" onclick="Chat.closeSheet();Chat.toggleRecord()"><span>🎤</span>Voice</div>
        <div class="chat-sheet-opt" onclick="document.getElementById('chatCameraInput').click()"><span>📷</span>Camera</div>
        <div class="chat-sheet-opt" onclick="document.getElementById('chatGalleryInput').click()"><span>🖼</span>Gallery</div>
        <div class="chat-sheet-opt" onclick="document.getElementById('chatFileInput').click()"><span>📁</span>Files</div>
        <div class="chat-sheet-opt" onclick="Chat.sendLocation()"><span>📍</span>Location</div>
        <div class="chat-sheet-opt" onclick="document.getElementById('chatAudioInput').click()"><span>🎵</span>Audio</div>
        <div class="chat-sheet-opt" onclick="toast('Coming soon')"><span>📞</span>Contact</div>
      </div>
      <input type="file" id="chatCameraInput" accept="image/*" capture="environment" style="display:none" onchange="Chat.onImagePick(this)">
      <input type="file" id="chatGalleryInput" accept="image/*,video/*" style="display:none" onchange="Chat.onImagePick(this)">
      <input type="file" id="chatFileInput" style="display:none" onchange="Chat.onImagePick(this)">
      <input type="file" id="chatAudioInput" accept="audio/*" style="display:none" onchange="Chat.onAudioPick(this)">
    </div>`;
    sheet.onclick = e => { if (e.target === sheet) closeSheet(); };
    document.body.appendChild(sheet);
  }
  function closeSheet() { document.getElementById('chatBottomSheet')?.classList.remove('open'); }

  const EMOJIS = ['😀','😂','🥰','😍','😘','😊','😉','😢','😭','😡','🥺','😴','🤗','👍','👎','👏','🙏','💪','❤️','🧡','💛','💚','💙','💜','🖤','🤍','💕','💖','💗','💓','💯','🔥','✨','🎉','😎','🤔','😅','😜','🤩','😇'];
  function openEmojiPanel() {
    closeSheet();
    let panel = document.getElementById('chatEmojiPanel');
    if (panel) { panel.classList.toggle('open'); return; }
    panel = document.createElement('div');
    panel.id = 'chatEmojiPanel';
    panel.className = 'chat-bottom-sheet-overlay open';
    panel.innerHTML = `<div class="chat-bottom-sheet chat-emoji-sheet">
      <div class="chat-sheet-handle"></div>
      <div class="chat-emoji-grid">${EMOJIS.map(e => `<span onclick="Chat.sendEmojiTap('${e}')">${e}</span>`).join('')}</div>
    </div>`;
    panel.onclick = e => { if (e.target === panel) panel.classList.remove('open'); };
    document.body.appendChild(panel);
  }
  function sendEmojiTap(e) { sendEmoji(e); }

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
        const key = 'ptJ3RSKMUd0ovjoM12Ra11JvlsssLRK4';
        const r = await fetch(`https://api.giphy.com/v1/gifs/search?q=${encodeURIComponent(q||'love')}&api_key=${key}&limit=24`);
        const data = await r.json();
        const results = data.data || [];
        if (!results.length) { el.innerHTML = '<div class="empty">No GIFs found</div>'; return; }
        el.innerHTML = results
          .map(g => g.images?.fixed_height_small?.url || g.images?.original?.url)
          .filter(url => !!url)
          .map(url => `<img src="${esc(url)}" loading="lazy" onclick="Chat.sendGif('${esc(url)}')">`)
          .join('') || '<div class="empty">No GIFs found</div>';
      } catch (e) { el.innerHTML = '<div class="empty">GIF search failed — check connection</div>'; }
    }, 400);
  }
  function closePanels() {
    document.getElementById('chatEmojiPanel')?.classList.remove('open');
    document.getElementById('chatGifPanel')?.classList.remove('open');
  }

  // ─── INIT ────────────────────────────────────────────
  function init() {
    if (!coupleId()) { setTimeout(init, 1000); return; }
    loadMessages();
    startPresence();
    startRealtime();     // instant delivery via websockets
    startPolling();      // safety net until Realtime confirms SUBSCRIBED
    fetchPresence();
    const nameEl = document.getElementById('chatHeaderName');
    if (nameEl) nameEl.textContent = window.S.partnerName || 'Partner';
    const avEl = document.getElementById('chatHeaderAv');
    if (avEl) avEl.textContent = (window.S.partnerName || 'P')[0];
    setInterval(fetchPresence, 15000);

    // Reconnect Realtime after coming back online / tab refocus
    window.addEventListener('online', () => { if (!rtConnected) startRealtime(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !rtConnected) startRealtime();
    });
  }

  return {
    onChatScroll, scrollToBottom, sendText, onTypingInput, onImagePick, toggleRecord,
    onBubbleClick, openMenu, reactTo, replyTo, closeBanner, togglePin, toggleStar,
    openStarred, deleteMsg, enterSelectMode, deleteSelected, exitSelectMode,
    openSearch, closeSearch, runSearch, scrollToMsg, sendGif, sendEmoji, sendEmojiTap,
    openEmojiPanel, openGifPanel, searchGifs, markRead, init, openSheet, closeSheet,
    forwardMsg, copyMsg, editMsg, cancelEdit, infoMsg, cancelRecording, startLongPress, endLongPress,
    onAudioPick, sendLocation, openGiftPanel, sendGift, toggleVoicePlay, retrySend
  };
})();
window.Chat = Chat;
