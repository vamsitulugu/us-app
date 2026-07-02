/* ══════════════════════════════════════════════════════════════
   public/chat/chat.js — Full couple chat frontend
   Save as: public/chat/chat.js
   Load in index.html (once, near bottom, after main app script):
     <link rel="stylesheet" href="/chat/chat.css">
     <script src="/chat/chat.js"></script>
   Depends on globals from main app: S, api (base fetch helper isn't
   reused directly — Chat has its own fetch calls), toast, esc,
   scheduleSave, spawnPetals, goto(), S.coupleId, S.role, S.myName,
   S.partnerName, S.myAvatar, S.partnerAvatar
   ══════════════════════════════════════════════════════════════ */
'use strict';

const Chat = (() => {
  const API = (typeof window !== 'undefined' && window.API) ? window.API : 'https://us-app-api.onrender.com';

  /* ── STATE ── */
  let messages = [];              // full message list, ascending by id
  let lastId = 0;                 // highest message id seen (for polling `after`)
  let replyingTo = null;          // message object being replied to
  let editingId = null;           // message id being edited
  let selectMode = false;
  let selectedIds = new Set();
  let searchOpen = false;
  let searchQuery = '';
  let pollTimer = null;
  let typingTimeout = null;
  let iAmTyping = false;
  let partnerPresence = { status: 'offline', last_seen: null };
  let offlineQueue = [];          // messages typed while offline
  let mediaRecorder = null, audioChunks = [], isRecording = false, recordStart = 0, recordTimerInt = null;
  let atBottom = true;
  let realtimeChannel = null;

  function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function toast(msg, dur) { if (typeof window.toast === 'function') window.toast(msg, dur); }
  function myRole() { return window.S?.role || 'user1'; }
  function otherRole() { return myRole() === 'user1' ? 'user2' : 'user1'; }
  function coupleId() { return window.S?.coupleId; }
  function isMine(m) { return m.sender_role === myRole(); }
  function uuid() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8); return v.toString(16); }); }

  /* ══════════════════════════════════════════════════════════════
     API CALLS
  ══════════════════════════════════════════════════════════════ */
  async function apiCall(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  let data;
  try { data = await r.json(); }
  catch (e) { data = { error: 'Non-JSON response (status ' + r.status + ')' }; }
  if (!r.ok) throw new Error(data.error || 'Chat API error');
  return data;
}
  async function fetchMessages(after) {
    const cid = coupleId(); if (!cid) return [];
    return apiCall('GET', `/api/chat/${cid}?after=${after || 0}&limit=250`);
  }

  async function sendToServer(row) {
    return apiCall('POST', '/api/chat', { coupleId: coupleId(), senderRole: myRole(), ...row });
  }

  /* ══════════════════════════════════════════════════════════════
     LOCAL CACHE (instant load, offline resilience)
  ══════════════════════════════════════════════════════════════ */
  function cacheKey() { return 'us_chat_cache_' + (coupleId() || 'anon'); }
  function loadCache() {
    try { const raw = localStorage.getItem(cacheKey()); if (raw) { messages = JSON.parse(raw); lastId = messages.reduce((m, x) => Math.max(m, x.id || 0), 0); } } catch (e) {}
  }
  function saveCache() {
    try { localStorage.setItem(cacheKey(), JSON.stringify(messages.slice(-500))); } catch (e) {}
  }

  /* ══════════════════════════════════════════════════════════════
     INIT / POLLING / REALTIME
  ══════════════════════════════════════════════════════════════ */
  async function init() {
    if (!coupleId()) { setTimeout(init, 500); return; }
    loadCache();
    render();
    await refresh();
    startPolling();
    trySupabaseRealtime();
    markRead();
    pushPresence('online');
    window.addEventListener('online', flushOfflineQueue);
    window.addEventListener('beforeunload', () => pushPresence('offline'));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { markRead(); refresh(); }
    });
  }

  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { refresh(); pollPresence(); }, 3500);
  }

  async function refresh() {
    if (!coupleId()) return;
    try {
      const fresh = await fetchMessages(lastId);
      if (fresh && fresh.length) {
        fresh.forEach(m => {
          const idx = messages.findIndex(x => x.id === m.id || (x._pending && x.client_id === m.client_id));
          if (idx >= 0) messages[idx] = m; else messages.push(m);
          lastId = Math.max(lastId, m.id);
        });
        messages.sort((a, b) => a.id - b.id);
        saveCache();
        render();
        if (document.getElementById('page-chat')?.classList.contains('active')) markRead();
      }
    } catch (e) { /* offline or server down — silent */ }
  }

  function trySupabaseRealtime() {
    try {
      if (!window.supabase || !window.__SUPABASE_URL__ || !window.__SUPABASE_ANON_KEY__) return;
      const sb = window.supabase.createClient(window.__SUPABASE_URL__, window.__SUPABASE_ANON_KEY__);
      realtimeChannel = sb.channel('chat-' + coupleId())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages', filter: `couple_id=eq.${coupleId()}` }, () => refresh())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_presence', filter: `couple_id=eq.${coupleId()}` }, () => pollPresence())
        .subscribe();
    } catch (e) { /* realtime optional */ }
  }

  /* ══════════════════════════════════════════════════════════════
     PRESENCE / TYPING
  ══════════════════════════════════════════════════════════════ */
  async function pushPresence(status) {
    if (!coupleId()) return;
    try { await apiCall('POST', `/api/chat/${coupleId()}/presence`, { role: myRole(), status }); } catch (e) {}
  }
  async function pollPresence() {
    if (!coupleId()) return;
    try {
      const rows = await apiCall('GET', `/api/chat/${coupleId()}/presence`);
      const p = (rows || []).find(r => r.role === otherRole());
      if (p) {
        const age = Date.now() - new Date(p.last_seen).getTime();
        partnerPresence = { status: age > 25000 ? 'offline' : p.status, last_seen: p.last_seen };
      } else partnerPresence = { status: 'offline', last_seen: null };
      renderHeader();
    } catch (e) {}
  }
  function onTypingInput() {
    if (!iAmTyping) { iAmTyping = true; pushPresence('typing'); }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => { iAmTyping = false; pushPresence('online'); }, 1800);
  }

  /* ══════════════════════════════════════════════════════════════
     SEND — text / image / voice
  ══════════════════════════════════════════════════════════════ */
  async function sendText() {
    const input = document.getElementById('chatIn');
    if (!input) return;
    const text = input.value.trim();
    if (!text && !editingId) return;

    if (editingId) { await commitEdit(editingId, text); return; }

    input.value = ''; autoGrow(input);
    const clientId = uuid();
    const optimistic = {
      id: 'tmp_' + clientId, client_id: clientId, _pending: true,
      couple_id: coupleId(), sender_role: myRole(), type: 'text',
      text, media_url: null, reply_to: replyingTo ? replyingTo.id : null,
      reactions: {}, starred_by: [], pinned: false, delivered: false, read: false,
      created_at: new Date().toISOString()
    };
    messages.push(optimistic); saveCache(); render(); scrollToBottom(true);
    const replySnapshot = replyingTo; clearReply();

    if (!navigator.onLine) { offlineQueue.push({ clientId, type: 'text', text, replyTo: replySnapshot?.id }); toast('📡 Offline — will send when back online'); return; }

    try {
      const saved = await sendToServer({ clientId, type: 'text', text, replyTo: replySnapshot?.id });
      const idx = messages.findIndex(m => m.client_id === clientId);
      if (idx >= 0) messages[idx] = saved;
      lastId = Math.max(lastId, saved.id);
      saveCache(); render();
      if (window.HeartbeatManager?.onMessageSent) window.HeartbeatManager.onMessageSent();
      if (typeof window.spawnPetals === 'function' && Math.random() < 0.15) window.spawnPetals(3);
    } catch (e) {
      const idx = messages.findIndex(m => m.client_id === clientId);
      if (idx >= 0) messages[idx]._failed = true;
      render(); toast('Failed to send — tap to retry');
    }
  }

  async function retryMessage(clientId) {
    const m = messages.find(x => x.client_id === clientId); if (!m) return;
    m._failed = false; render();
    try {
      const saved = await sendToServer({ clientId: m.client_id, type: m.type, text: m.text, mediaUrl: m.media_url, mediaMeta: m.media_meta, replyTo: m.reply_to });
      const idx = messages.findIndex(x => x.client_id === clientId);
      if (idx >= 0) messages[idx] = saved;
      saveCache(); render();
    } catch (e) { m._failed = true; render(); toast('Still failing — check connection'); }
  }

 async function flushOfflineQueue() {
  if (!offlineQueue.length) return;
  toast('📡 Back online — sending queued messages...');
  const q = [...offlineQueue]; offlineQueue = [];
  for (const item of q) {
    if (!item.text && !item.mediaUrl) continue; // skip empty/corrupt queued items
    try {
      const saved = await sendToServer({ clientId: item.clientId, type: item.type, text: item.text, mediaUrl: item.mediaUrl, mediaMeta: item.mediaMeta, replyTo: item.replyTo });
      const idx = messages.findIndex(m => m.client_id === item.clientId);
      if (idx >= 0) messages[idx] = saved; else messages.push(saved);
    } catch (e) { /* drop failed retries instead of re-queuing forever */ }
  }
  messages.sort((a, b) => (a.id || 0) - (b.id || 0));
  saveCache(); render();
}

  async function sendImage(file) {
    if (!file) return;
    const clientId = uuid();
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      const optimistic = {
        id: 'tmp_' + clientId, client_id: clientId, _pending: true,
        couple_id: coupleId(), sender_role: myRole(), type: 'image',
        text: null, media_url: dataUrl, reply_to: replyingTo ? replyingTo.id : null,
        reactions: {}, starred_by: [], pinned: false, delivered: false, read: false,
        created_at: new Date().toISOString()
      };
      messages.push(optimistic); saveCache(); render(); scrollToBottom(true);
      const replySnapshot = replyingTo; clearReply();
      try {
        let mediaUrl = dataUrl;
        // Try uploading via existing media endpoint if present; fall back to inline base64
        try {
          const up = await apiCall('POST', '/api/media/upload', { coupleId: coupleId(), dataUrl, filename: file.name });
          if (up && up.url) mediaUrl = up.url;
        } catch (_) { /* endpoint absent — keep base64 inline, still works */ }
        const saved = await sendToServer({ clientId, type: 'image', mediaUrl, replyTo: replySnapshot?.id });
        const idx = messages.findIndex(m => m.client_id === clientId);
        if (idx >= 0) messages[idx] = saved;
        lastId = Math.max(lastId, saved.id);
        saveCache(); render();
      } catch (err) {
        const idx = messages.findIndex(m => m.client_id === clientId);
        if (idx >= 0) messages[idx]._failed = true;
        render(); toast('Photo failed to send');
      }
    };
    reader.readAsDataURL(file);
  }

  function onImagePick(input) {
    const file = input.files[0]; if (!file) return;
    sendImage(file); input.value = '';
  }

  /* ── voice notes ── */
  async function toggleRecord() {
    if (isRecording) { stopRecording(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      mediaRecorder.onstop = onRecordingStop;
      mediaRecorder.start();
      isRecording = true; recordStart = Date.now();
      pushPresence('recording');
      const btn = document.getElementById('chatRecBtn'); if (btn) btn.classList.add('rec-active');
      const timerEl = document.getElementById('chatRecTimer'); if (timerEl) timerEl.style.display = 'inline';
      recordTimerInt = setInterval(() => {
        const sec = Math.floor((Date.now() - recordStart) / 1000);
        if (timerEl) timerEl.textContent = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
      }, 500);
    } catch (e) { toast('Microphone permission denied'); }
  }
  function stopRecording() {
    if (mediaRecorder && isRecording) mediaRecorder.stop();
    isRecording = false; clearInterval(recordTimerInt);
    const btn = document.getElementById('chatRecBtn'); if (btn) btn.classList.remove('rec-active');
    const timerEl = document.getElementById('chatRecTimer'); if (timerEl) timerEl.style.display = 'none';
    pushPresence('online');
  }
  async function onRecordingStop() {
    const durationSec = Math.round((Date.now() - recordStart) / 1000);
    if (durationSec < 1) { toast('Recording too short'); return; }
    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      const clientId = uuid();
      const optimistic = {
        id: 'tmp_' + clientId, client_id: clientId, _pending: true,
        couple_id: coupleId(), sender_role: myRole(), type: 'voice',
        text: null, media_url: dataUrl, media_meta: { duration: durationSec },
        reply_to: replyingTo ? replyingTo.id : null,
        reactions: {}, starred_by: [], pinned: false, delivered: false, read: false,
        created_at: new Date().toISOString()
      };
      messages.push(optimistic); saveCache(); render(); scrollToBottom(true);
      const replySnapshot = replyingTo; clearReply();
      try {
        const saved = await sendToServer({ clientId, type: 'voice', mediaUrl: dataUrl, mediaMeta: { duration: durationSec }, replyTo: replySnapshot?.id });
        const idx = messages.findIndex(m => m.client_id === clientId);
        if (idx >= 0) messages[idx] = saved;
        lastId = Math.max(lastId, saved.id);
        saveCache(); render();
      } catch (err) {
        const idx = messages.findIndex(m => m.client_id === clientId);
        if (idx >= 0) messages[idx]._failed = true;
        render();
      }
    };
    reader.readAsDataURL(blob);
  }

  /* ══════════════════════════════════════════════════════════════
     EDIT / DELETE
  ══════════════════════════════════════════════════════════════ */
  function startEdit(id) {
    const m = messages.find(x => String(x.id) === String(id)); if (!m || !isMine(m) || m.type !== 'text') return;
    editingId = id;
    const input = document.getElementById('chatIn');
    if (input) { input.value = m.text || ''; input.focus(); autoGrow(input); }
    renderComposerBanner();
    closeCtxMenu();
  }
  function cancelEdit() { editingId = null; const input = document.getElementById('chatIn'); if (input) input.value = ''; renderComposerBanner(); }
  async function commitEdit(id, text) {
    editingId = null;
    const input = document.getElementById('chatIn'); if (input) input.value = '';
    renderComposerBanner();
    if (!text) return;
    const m = messages.find(x => String(x.id) === String(id)); if (m) { m.text = text; m.edited = true; render(); }
    try { await apiCall('PATCH', `/api/chat/${id}`, { coupleId: coupleId(), senderRole: myRole(), text }); refresh(); }
    catch (e) { toast('Edit failed'); }
  }

  async function deleteMessage(id, mode) {
    const m = messages.find(x => String(x.id) === String(id)); if (!m) return;
    if (mode === 'everyone') { m.deleted = true; m.text = null; m.media_url = null; }
    else { messages = messages.filter(x => x.id !== id); }
    saveCache(); render(); closeCtxMenu();
    try { await apiCall('DELETE', `/api/chat/${id}`, { coupleId: coupleId(), senderRole: myRole(), mode }); }
    catch (e) { toast('Delete failed to sync'); }
  }
  function confirmDelete(id) {
    const m = messages.find(x => String(x.id) === String(id)); if (!m) return;
    const mine = isMine(m);
    showActionSheet([
      mine ? { label: '🗑️ Delete for everyone', danger: true, action: () => deleteMessage(id, 'everyone') } : null,
      { label: '🙈 Delete for me', danger: true, action: () => deleteMessage(id, 'me') },
      { label: 'Cancel', action: () => {} }
    ].filter(Boolean));
  }

  /* ══════════════════════════════════════════════════════════════
     REACTIONS / PIN / STAR / REPLY / FORWARD
  ══════════════════════════════════════════════════════════════ */
  const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '🙏', '🔥'];

  async function react(id, emoji) {
  const m = messages.find(x => String(x.id) === String(id)); if (!m) return;
  if (m._pending) { toast('Still sending — try again in a moment'); return; }
  if (!m.reactions) m.reactions = {};
  Object.keys(m.reactions).forEach(e => { m.reactions[e] = (m.reactions[e] || []).filter(r => r !== myRole()); if (!m.reactions[e].length) delete m.reactions[e]; });
  m.reactions[emoji] = [...(m.reactions[emoji] || []), myRole()];
  render();
  try { const saved = await apiCall('POST', `/api/chat/${id}/react`, { coupleId: coupleId(), role: myRole(), emoji }); const idx = messages.findIndex(x => x.id === id); if (idx >= 0) messages[idx] = saved; render(); }
  catch (e) {}
  closeReactionPicker();
}

async function togglePin(id) {
  const m = messages.find(x => String(x.id) === String(id)); if (!m) return;
  if (m._pending) { toast('Still sending — try again in a moment'); closeCtxMenu(); return; }
  m.pinned = !m.pinned; render(); closeCtxMenu();
  try { await apiCall('POST', `/api/chat/${id}/pin`, { coupleId: coupleId(), pinned: m.pinned }); } catch (e) {}
}

async function toggleStar(id) {
  const m = messages.find(x => String(x.id) === String(id)); if (!m) return;
  if (m._pending) { toast('Still sending — try again in a moment'); closeCtxMenu(); return; }
  const has = (m.starred_by || []).includes(myRole());
  m.starred_by = has ? m.starred_by.filter(r => r !== myRole()) : [...(m.starred_by || []), myRole()];
  render(); closeCtxMenu();
  try { await apiCall('POST', `/api/chat/${id}/star`, { coupleId: coupleId(), role: myRole() }); } catch (e) {}
}

  function setReply(id) {
    const m = messages.find(x => String(x.id) === String(id)); if (!m) return;
    replyingTo = m; renderComposerBanner(); closeCtxMenu();
    document.getElementById('chatIn')?.focus();
  }
  function clearReply() { replyingTo = null; renderComposerBanner(); }

  function forwardMessage(id) {
    const m = messages.find(x => String(x.id) === String(id)); if (!m) return;
    toast('Forward: paste into a new message manually for now 💌');
    const input = document.getElementById('chatIn');
    if (input && m.type === 'text') { input.value = m.text || ''; autoGrow(input); input.focus(); }
    closeCtxMenu();
  }

  function copyText(id) {
    const m = messages.find(x => String(x.id) === String(id)); if (!m || !m.text) return;
    navigator.clipboard?.writeText(m.text).then(() => toast('Copied 📋'));
    closeCtxMenu();
  }

  /* ══════════════════════════════════════════════════════════════
     MULTI-SELECT MODE
  ══════════════════════════════════════════════════════════════ */
  function enterSelectMode(id) {
    selectMode = true; selectedIds = new Set([id]); render(); closeCtxMenu();
  }
  function toggleSelect(id) {
    if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
    if (!selectedIds.size) selectMode = false;
    render();
  }
  function exitSelectMode() { selectMode = false; selectedIds.clear(); render(); }
  function deleteSelected() {
    const ids = [...selectedIds];
    showActionSheet([
      { label: `🗑️ Delete ${ids.length} message(s) for me`, danger: true, action: () => { ids.forEach(id => deleteMessage(id, 'me')); exitSelectMode(); } },
      { label: 'Cancel', action: () => {} }
    ]);
  }

  /* ══════════════════════════════════════════════════════════════
     READ / DELIVERED
  ══════════════════════════════════════════════════════════════ */
  let markReadDebounce = null;
  function markRead() {
    if (!coupleId()) return;
    clearTimeout(markReadDebounce);
    markReadDebounce = setTimeout(async () => {
      try { await apiCall('POST', `/api/chat/${coupleId()}/read`, { role: myRole() }); refresh(); } catch (e) {}
    }, 400);
  }

  /* ══════════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════════ */
  function visibleMessages() {
    return messages.filter(m => {
      const df = m.deleted_for || 'none';
      if (df === 'everyone') return false;
      if (df !== 'none' && df.split(',').includes(myRole())) return false;
      return true;
    });
  }

  function fmtDaySeparator(dateStr) {
    const d = new Date(dateStr); const today = new Date(); const yest = new Date(today); yest.setDate(yest.getDate() - 1);
    const sameDay = (a, b) => a.toDateString() === b.toDateString();
    if (sameDay(d, today)) return 'Today';
    if (sameDay(d, yest)) return 'Yesterday';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
  }
  function fmtTime(dateStr) { return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

  function bubbleTicks(m) {
    if (!isMine(m)) return '';
    if (m._pending) return '<span class="tick tick-pending">🕓</span>';
    if (m._failed) return '<span class="tick tick-failed" title="Tap to retry">⚠️</span>';
    if (m.read) return '<span class="tick tick-read">✓✓</span>';
    if (m.delivered) return '<span class="tick tick-delivered">✓✓</span>';
    return '<span class="tick tick-sent">✓</span>';
  }

  function reactionsHtml(m) {
    const r = m.reactions || {};
    const keys = Object.keys(r).filter(k => r[k] && r[k].length);
    if (!keys.length) return '';
    return `<div class="msg-reactions">${keys.map(e => `<span class="reaction-pill ${r[e].includes(myRole()) ? 'mine' : ''}" onclick="Chat.react('${m.id}','${e}')">${e} ${r[e].length > 1 ? r[e].length : ''}</span>`).join('')}</div>`;
  }

  function replyPreviewHtml(m) {
    if (!m.reply_to) return '';
    const orig = messages.find(x => x.id === m.reply_to);
    if (!orig) return '<div class="msg-reply-ref msg-reply-missing">Original message unavailable</div>';
    const who = isMine(orig) ? (window.S?.myName || 'You') : (window.S?.partnerName || 'Partner');
    const preview = orig.type === 'text' ? (orig.text || '').slice(0, 60) : (orig.type === 'image' ? '📷 Photo' : orig.type === 'voice' ? '🎙️ Voice message' : '🎬 Video');
    return `<div class="msg-reply-ref" onclick="Chat.scrollToMsg('${orig.id}')"><div class="reply-ref-name">${esc(who)}</div><div class="reply-ref-text">${esc(preview)}</div></div>`;
  }

  function bubbleContent(m) {
    if (m.deleted) return `<div class="msg-deleted">🚫 This message was deleted</div>`;
    if (m.type === 'image') {
      return `<img src="${m.media_url}" class="msg-img" loading="lazy" onclick="Chat.viewImage('${m.media_url}')">`;
    }
    if (m.type === 'voice') {
      const dur = (m.media_meta && m.media_meta.duration) || 0;
      const durLabel = String(Math.floor(dur / 60)).padStart(2, '0') + ':' + String(dur % 60).padStart(2, '0');
      return `<div class="voice-msg-chat" onclick="Chat.playVoice(this,'${m.media_url}')">
        <button class="voice-play-chat">▶</button>
        <div class="voice-wave-chat">${Array.from({length: 22}).map(() => `<span style="height:${6 + Math.random()*16}px"></span>`).join('')}</div>
        <span class="voice-dur-chat">${durLabel}</span>
      </div>`;
    }
    const editedTag = m.edited ? '<span class="edited-tag">edited</span>' : '';
    return `<div class="msg-text">${esc(m.text || '').replace(/\n/g, '<br>')}${editedTag}</div>`;
  }

  function renderBubble(m) {
    const mine = isMine(m);
    const starred = (m.starred_by || []).includes(myRole());
    const selecting = selectMode;
    const isSelected = selectedIds.has(m.id);
    return `
    <div class="msg-row ${mine ? 'me' : 'them'} ${isSelected ? 'selected' : ''}" data-id="${m.id}"
      onclick="${selecting ? `Chat.toggleSelect('${m.id}')` : (m._failed ? `Chat.retryMessage('${m.client_id}')` : '')}"
oncontextmenu="Chat.openCtxMenu(event,'${m.id}');return false;"
ontouchstart="Chat._touchStart(event,'${m.id}')" ontouchend="Chat._touchEnd(event)">
      ${selecting ? `<div class="msg-select-check ${isSelected ? 'checked' : ''}">${isSelected ? '✓' : ''}</div>` : ''}
      <div class="msg-bubble-wrap">
        ${m.pinned ? '<div class="pin-flag">📌 Pinned</div>' : ''}
        <div class="bubble">
          ${replyPreviewHtml(m)}
          ${m.forwarded ? '<div class="forwarded-tag">↪ Forwarded</div>' : ''}
          ${bubbleContent(m)}
          <div class="bubble-meta">
            ${starred ? '<span class="star-flag">⭐</span>' : ''}
            <span class="msg-time">${fmtTime(m.created_at)}</span>
            ${bubbleTicks(m)}
          </div>
        </div>
        ${reactionsHtml(m)}
      </div>
    </div>`;
  }

  function render() {
    const wrap = document.getElementById('chatMsgs');
    if (!wrap) return;
    const vis = visibleMessages();
    let html = '';
    let lastDay = null;
    vis.forEach(m => {
      const day = new Date(m.created_at).toDateString();
      if (day !== lastDay) { html += `<div class="date-sep"><span>${fmtDaySeparator(m.created_at)}</span></div>`; lastDay = day; }
      html += renderBubble(m);
    });
    if (!vis.length) html = `<div class="chat-empty"><div style="font-size:44px;margin-bottom:10px">💬</div>Say hi to start your conversation 💕</div>`;
    const wasAtBottom = atBottom;
    wrap.innerHTML = html;
    renderPinnedBar();
    renderHeader();
    if (wasAtBottom) scrollToBottom();
    else updateJumpBtn();
    updateUnreadBadge();

    const stb = document.getElementById('chatSelectToolbar');
    if (stb) {
      stb.classList.toggle('active', selectMode);
      const cnt = document.getElementById('chatSelectCount');
      if (cnt) cnt.textContent = selectedIds.size + ' selected';
    }
  }

  function renderHeader() {
    const nameEl = document.getElementById('chatHeaderName');
    const statusEl = document.getElementById('chatHeaderStatus');
    if (nameEl) nameEl.textContent = window.S?.partnerName || 'Partner';
    if (statusEl) {
      const st = partnerPresence.status;
      if (st === 'typing') statusEl.innerHTML = '<span class="typing-dots"><span></span><span></span><span></span></span> typing';
      else if (st === 'recording') statusEl.textContent = '🎙️ recording voice message...';
      else if (st === 'online') statusEl.textContent = '🟢 online';
      else if (partnerPresence.last_seen) statusEl.textContent = 'last seen ' + fmtLastSeen(partnerPresence.last_seen);
      else statusEl.textContent = 'offline';
    }
    const av = document.getElementById('chatHeaderAv');
    if (av) { av.textContent = (window.S?.partnerName || 'P')[0]; if (window.S?.partnerAvatar) av.innerHTML = `<img src="${window.S.partnerAvatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`; }
  }
  function fmtLastSeen(ts) {
    const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
    if (mins < 1) return 'just now'; if (mins < 60) return mins + 'm ago';
    const h = Math.floor(mins / 60); if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  function renderPinnedBar() {
    const bar = document.getElementById('chatPinnedBar');
    if (!bar) return;
    const pinned = visibleMessages().filter(m => m.pinned);
    if (!pinned.length) { bar.style.display = 'none'; return; }
    const latest = pinned[pinned.length - 1];
    bar.style.display = 'flex';
    bar.innerHTML = `<span class="pin-ico">📌</span><span class="pin-text" onclick="Chat.scrollToMsg('${latest.id}')">${esc((latest.text || (latest.type === 'image' ? 'Photo' : 'Voice message')).slice(0, 50))}</span><span class="pin-count">${pinned.length > 1 ? pinned.length : ''}</span>`;
  }

  function renderComposerBanner() {
    const banner = document.getElementById('chatComposerBanner');
    if (!banner) return;
    if (editingId) {
      const m = messages.find(x => x.id === editingId);
      banner.style.display = 'flex';
      banner.innerHTML = `<div class="banner-ico">✏️</div><div class="banner-body"><div class="banner-title">Editing message</div><div class="banner-sub">${esc((m?.text || '').slice(0, 60))}</div></div><button class="banner-close" onclick="Chat.cancelEdit()">✕</button>`;
    } else if (replyingTo) {
      const who = isMine(replyingTo) ? (window.S?.myName || 'You') : (window.S?.partnerName || 'Partner');
      const preview = replyingTo.type === 'text' ? replyingTo.text : (replyingTo.type === 'image' ? '📷 Photo' : '🎙️ Voice message');
      banner.style.display = 'flex';
      banner.innerHTML = `<div class="banner-ico">↩️</div><div class="banner-body"><div class="banner-title">Replying to ${esc(who)}</div><div class="banner-sub">${esc((preview || '').slice(0, 60))}</div></div><button class="banner-close" onclick="Chat.clearReply()">✕</button>`;
    } else {
      banner.style.display = 'none'; banner.innerHTML = '';
    }
  }

  function updateUnreadBadge() {
    const unread = visibleMessages().filter(m => !isMine(m) && !m.read).length;
    const badges = document.querySelectorAll('[data-chat-badge]');
    badges.forEach(b => { if (unread > 0) { b.style.display = 'inline-flex'; b.textContent = unread > 9 ? '9+' : unread; } else b.style.display = 'none'; });
  }

  /* ── scroll management ── */
  function scrollToBottom(force) {
    const wrap = document.getElementById('chatMsgs'); if (!wrap) return;
    if (force || atBottom) { wrap.scrollTop = wrap.scrollHeight; atBottom = true; updateJumpBtn(); }
  }
  function onChatScroll() {
    const wrap = document.getElementById('chatMsgs'); if (!wrap) return;
    atBottom = (wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight) < 60;
    updateJumpBtn();
    if (atBottom) markRead();
  }
  function updateJumpBtn() {
    const btn = document.getElementById('chatJumpBtn'); if (!btn) return;
    btn.style.display = atBottom ? 'none' : 'flex';
  }
  function scrollToMsg(id) {
    const el = document.querySelector(`.msg-row[data-id="${id}"]`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('msg-flash'); setTimeout(() => el.classList.remove('msg-flash'), 1200); }
  }

  function autoGrow(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; }

  /* ══════════════════════════════════════════════════════════════
     CONTEXT MENU (long-press / right-click)
  ══════════════════════════════════════════════════════════════ */
  let touchTimer = null;
  function _touchStart(e, id) { touchTimer = setTimeout(() => openCtxMenu(e, id), 480); }
  function _touchEnd() { clearTimeout(touchTimer); }

  function openCtxMenu(e, id) {
    if (e.preventDefault) e.preventDefault();
    if (navigator.vibrate) navigator.vibrate(30);
    const m = messages.find(x => String(x.id) === String(id)); if (!m || m.deleted) return;
    const mine = isMine(m);
    closeCtxMenu();
    const menu = document.createElement('div');
    menu.className = 'msg-ctx-menu';
    menu.id = 'msgCtxMenu';
    const items = [
      { label: '↩️ Reply', action: () => setReply(id) },
      m.type === 'text' ? { label: '📋 Copy', action: () => copyText(id) } : null,
      mine && m.type === 'text' ? { label: '✏️ Edit', action: () => startEdit(id) } : null,
      { label: (m.starred_by || []).includes(myRole()) ? '⭐ Unstar' : '☆ Star', action: () => toggleStar(id) },
      { label: m.pinned ? '📌 Unpin' : '📌 Pin', action: () => togglePin(id) },
      { label: '↪️ Forward', action: () => forwardMessage(id) },
      { label: '☑️ Select', action: () => enterSelectMode(id) },
      { label: '🗑️ Delete', danger: true, action: () => confirmDelete(id) },
    ].filter(Boolean);
    menu.innerHTML = `
      <div class="ctx-reactions">${QUICK_REACTIONS.map(em => `<span class="ctx-emoji" onclick="Chat.react('${id}','${em}')">${em}</span>`).join('')}</div>
      ${items.map((it, i) => `<div class="ctx-item ${it.danger ? 'danger' : ''}" data-i="${i}">${it.label}</div>`).join('')}
    `;
    document.body.appendChild(menu);
    items.forEach((it, i) => menu.querySelector(`.ctx-item[data-i="${i}"]`).addEventListener('click', () => { it.action(); closeCtxMenu(); }));

    const bg = document.createElement('div');
    bg.className = 'msg-ctx-bg'; bg.id = 'msgCtxBg';
    bg.addEventListener('click', closeCtxMenu);
    document.body.appendChild(bg);

    // position near touch/click point, clamp to viewport
    const x = (e.touches && e.touches[0]) ? e.touches[0].clientX : (e.clientX || window.innerWidth / 2);
    const y = (e.touches && e.touches[0]) ? e.touches[0].clientY : (e.clientY || window.innerHeight / 2);
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      let left = Math.min(x, window.innerWidth - rect.width - 12);
      let top = Math.min(y, window.innerHeight - rect.height - 12);
      menu.style.left = Math.max(12, left) + 'px';
      menu.style.top = Math.max(12, top) + 'px';
      menu.classList.add('open');
    });
  }
  function closeCtxMenu() {
    document.getElementById('msgCtxMenu')?.remove();
    document.getElementById('msgCtxBg')?.remove();
  }
  function closeReactionPicker() { /* reactions live inside ctx menu, nothing extra to close */ }

  /* ══════════════════════════════════════════════════════════════
     ACTION SHEET (delete confirm etc.)
  ══════════════════════════════════════════════════════════════ */
  function showActionSheet(items) {
    const bg = document.createElement('div');
    bg.className = 'msg-ctx-bg';
    bg.style.zIndex = 9500;
    const sheet = document.createElement('div');
    sheet.className = 'chat-action-sheet';
    sheet.innerHTML = items.map((it, i) => `<div class="sheet-item ${it.danger ? 'danger' : ''}" data-i="${i}">${it.label}</div>`).join('');
    bg.appendChild(sheet);
    document.body.appendChild(bg);
    requestAnimationFrame(() => sheet.classList.add('open'));
    items.forEach((it, i) => sheet.querySelector(`.sheet-item[data-i="${i}"]`).addEventListener('click', () => { it.action(); bg.remove(); }));
    bg.addEventListener('click', (e) => { if (e.target === bg) bg.remove(); });
  }

  /* ══════════════════════════════════════════════════════════════
     IMAGE VIEWER / VOICE PLAYBACK
  ══════════════════════════════════════════════════════════════ */
  function viewImage(url) {
    if (typeof window.openImgViewer === 'function') window.openImgViewer(url);
    else window.open(url, '_blank');
  }
  let _activeAudio = null, _activeAudioBtn = null;
  function playVoice(el, url) {
    const btn = el.querySelector('.voice-play-chat');
    const wave = el.querySelector('.voice-wave-chat');
    if (_activeAudio && _activeAudioBtn === btn && !_activeAudio.paused) { _activeAudio.pause(); btn.textContent = '▶'; wave.classList.remove('playing'); return; }
    if (_activeAudio) { _activeAudio.pause(); if (_activeAudioBtn) { _activeAudioBtn.textContent = '▶'; } }
    _activeAudio = new Audio(url); _activeAudioBtn = btn;
    _activeAudio.play(); btn.textContent = '⏸'; wave.classList.add('playing');
    _activeAudio.onended = () => { btn.textContent = '▶'; wave.classList.remove('playing'); };
  }

  /* ══════════════════════════════════════════════════════════════
     SEARCH
  ══════════════════════════════════════════════════════════════ */
  function openSearch() {
    searchOpen = true;
    const el = document.getElementById('chatSearchBar'); if (el) el.style.display = 'flex';
    document.getElementById('chatSearchInput')?.focus();
  }
  function closeSearch() {
    searchOpen = false; searchQuery = '';
    const el = document.getElementById('chatSearchBar'); if (el) el.style.display = 'none';
    const input = document.getElementById('chatSearchInput'); if (input) input.value = '';
    document.getElementById('chatSearchResults').innerHTML = '';
    document.getElementById('chatSearchResults').style.display = 'none';
  }
  function runSearch(q) {
    searchQuery = q;
    const box = document.getElementById('chatSearchResults');
    if (!q.trim()) { box.style.display = 'none'; return; }
    const hits = visibleMessages().filter(m => m.type === 'text' && m.text && m.text.toLowerCase().includes(q.toLowerCase()));
    box.style.display = 'block';
    if (!hits.length) { box.innerHTML = '<div class="search-none">No messages found</div>'; return; }
    box.innerHTML = hits.slice(-30).reverse().map(m => `
      <div class="search-hit" onclick="Chat.scrollToMsg('${m.id}');Chat.closeSearch()">
        <div class="search-hit-who">${isMine(m) ? (window.S?.myName || 'You') : (window.S?.partnerName || 'Partner')} · ${fmtTime(m.created_at)}</div>
        <div class="search-hit-text">${esc(m.text)}</div>
      </div>`).join('');
  }

  /* ══════════════════════════════════════════════════════════════
     STARRED MESSAGES VIEW
  ══════════════════════════════════════════════════════════════ */
  function openStarred() {
    const starred = visibleMessages().filter(m => (m.starred_by || []).includes(myRole()));
    showActionSheet(starred.length
      ? starred.map(m => ({ label: `⭐ ${(m.text || (m.type === 'image' ? '📷 Photo' : '🎙️ Voice')).slice(0, 40)}`, action: () => scrollToMsg(m.id) }))
      : [{ label: 'No starred messages yet', action: () => {} }]
    );
  }

  /* ══════════════════════════════════════════════════════════════
     PUBLIC API
  ══════════════════════════════════════════════════════════════ */
  return {
    init, refresh, sendText, onImagePick, toggleRecord, onTypingInput,
    react, togglePin, toggleStar, setReply, clearReply, forwardMessage, copyText,
    startEdit, cancelEdit, confirmDelete, deleteMessage, retryMessage,
    enterSelectMode, toggleSelect, exitSelectMode, deleteSelected,
    openCtxMenu, closeCtxMenu, _touchStart, _touchEnd,
    viewImage, playVoice, scrollToMsg, scrollToBottom, onChatScroll,
    openSearch, closeSearch, runSearch, openStarred, markRead,
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  // Hook into goto() so opening the chat page initializes/refreshes chat
  const tryHook = () => {
    if (typeof window.goto !== 'function') { setTimeout(tryHook, 300); return; }
    const orig = window.goto;
    window.goto = function (page) {
      orig(page);
      if (page === 'chat') { Chat.init(); }
    };
  };
  tryHook();
});