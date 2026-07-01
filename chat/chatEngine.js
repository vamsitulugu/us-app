const ChatEngine = (() => {
  let coupleId, role, initialLoaded = false;

  async function init(cid, r) {
    coupleId = cid; role = r;
    const cached = await ChatDB.all();
    ChatStore.upsertMany(cached);
    Render.mount();
    await loadRecent();
    ChatQueue.flush();
    initialLoaded = true;
  }

  async function loadRecent() {
    const res = await fetch(API + '/api/chat/' + coupleId + '?limit=50');
    if (!res.ok) return;
    const rows = await res.json();
    const norm = rows.map(ChatQueue.normalize);
    ChatStore.upsertMany(norm);
    ChatDB.putMany(norm);
  }

  async function loadOlder() {
    const oldest = ChatStore.all()[0];
    if (!oldest) return;
    const res = await fetch(API + '/api/chat/' + coupleId + '?before=' + encodeURIComponent(oldest.created_at) + '&limit=40');
    if (!res.ok) return [];
    const rows = await res.json();
    const norm = rows.map(ChatQueue.normalize);
    ChatStore.upsertMany(norm);
    ChatDB.putMany(norm);
    return norm;
  }

  function send({ text, mediaUrl, audioData, duration, type, replyTo }) {
    const clientId = crypto.randomUUID();
    const optimistic = {
      client_id: clientId, id: null, couple_id: coupleId, sender_role: role,
      type: type || (mediaUrl ? 'photo' : audioData ? 'voice' : 'text'),
      text: text || null, media_url: mediaUrl || null, audio_data: audioData || null,
      duration: duration || null, reply_to: replyTo || null,
      pinned: false, starred: false, reactions: {}, read: false, deleted: false,
      created_at: new Date().toISOString(), _status: 'sending'
    };
    ChatStore.upsert(optimistic);
    ChatDB.put(optimistic);
    ChatQueue.enqueue({
      clientId, coupleId, senderRole: role, type: optimistic.type,
      text: optimistic.text, mediaUrl: optimistic.media_url,
      audioData: optimistic.audio_data, duration: optimistic.duration, replyTo: optimistic.reply_to
    });
    return clientId;
  }

  async function patch(id, coupleIdParam, fields) {
    const res = await fetch(API + '/api/chat/' + id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coupleId: coupleIdParam, ...fields })
    });
    if (res.ok) {
      const row = await res.json();
      const norm = ChatQueue.normalize(row);
      ChatStore.upsert(norm); ChatDB.put(norm);
    }
  }

  async function markRead(myRole) {
    await fetch(API + '/api/chat/' + coupleId + '/read', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coupleId, myRole })
    }).catch(() => {});
  }
// ── inside const ChatEngine = (() => { ... })(); add before the closing return{} ──

async function editText(clientOrId, newText) {
  const msg = ChatStore.get(clientOrId) || ChatStore.all().find(m => m.id === clientOrId);
  if (!msg) return;
  msg.text = newText;
  msg.edited = true;
  msg._editedLocalTs = Date.now();
  ChatStore.upsert(msg);
  ChatDB && ChatDB.put(msg);
  if (!msg.id) return; // still sending, will patch after server ack lands
  await patch(msg.id, coupleId, { text: newText, edited: true });
}

async function deleteForMe(clientOrId) {
  const msg = ChatStore.get(clientOrId) || ChatStore.all().find(m => m.id === clientOrId);
  if (!msg) return;
  // Local-only tombstone: store a per-device hidden set so it never re-syncs as visible
  const hidden = JSON.parse(localStorage.getItem('chat_hidden_for_me') || '[]');
  const key = msg.client_id;
  if (!hidden.includes(key)) hidden.push(key);
  localStorage.setItem('chat_hidden_for_me', JSON.stringify(hidden));
  ChatStore.remove(msg.client_id); // removes from in-memory render list
}

async function deleteForEveryone(clientOrId) {
  const msg = ChatStore.get(clientOrId) || ChatStore.all().find(m => m.id === clientOrId);
  if (!msg) return;
  msg.deleted = true; msg.text = ''; msg.media_url = null; msg.audio_data = null;
  ChatStore.upsert(msg);
  ChatDB && ChatDB.put(msg);
  if (!msg.id) return;
  await patch(msg.id, coupleId, { deleted: true, text: '' });
}

async function setPinned(clientOrId, pinned) {
  const msg = ChatStore.get(clientOrId) || ChatStore.all().find(m => m.id === clientOrId);
  if (!msg) return;
  msg.pinned = pinned; ChatStore.upsert(msg); ChatDB && ChatDB.put(msg);
  if (msg.id) await patch(msg.id, coupleId, { pinned });
}

async function setStarred(clientOrId, starred) {
  const msg = ChatStore.get(clientOrId) || ChatStore.all().find(m => m.id === clientOrId);
  if (!msg) return;
  msg.starred = starred; ChatStore.upsert(msg); ChatDB && ChatDB.put(msg);
  if (msg.id) await patch(msg.id, coupleId, { starred });
}

async function toggleReaction(clientOrId, emoji, myRole) {
  const msg = ChatStore.get(clientOrId) || ChatStore.all().find(m => m.id === clientOrId);
  if (!msg) return;
  const r = { ...(msg.reactions || {}) };
  const list = new Set(r[emoji] || []);
  if (list.has(myRole)) list.delete(myRole); else list.add(myRole);
  if (list.size) r[emoji] = Array.from(list); else delete r[emoji];
  msg.reactions = r; ChatStore.upsert(msg); ChatDB && ChatDB.put(msg);
  if (msg.id) await patch(msg.id, coupleId, { reactions: r });
}

async function forwardMessages(ids, myRole) {
  const res = await fetch(API + '/api/chat/forward', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ coupleId, senderRole: myRole, messageIds: ids })
  });
  if (!res.ok) return [];
  const rows = await res.json();
  const norm = rows.map(ChatQueue.normalize);
  ChatStore.upsertMany(norm);
  ChatDB.putMany(norm);
  return norm;
}

async function deliverAll(myRole) {
  try {
    const res = await fetch(API + '/api/chat/' + coupleId + '/deliver-all', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ myRole })
    });
    if (!res.ok) return;
    const { ids } = await res.json();
    ids.forEach(id => {
      const m = ChatStore.all().find(x => x.id === id);
      if (m) { m.delivered = true; ChatStore.upsert(m); ChatDB.put(m); }
    });
  } catch (e) {}
}

async function markAllRead(myRole) {
  try {
    const res = await fetch(API + '/api/chat/' + coupleId + '/read-all', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ myRole })
    });
    if (!res.ok) return;
    const { ids } = await res.json();
    ids.forEach(id => {
      const m = ChatStore.all().find(x => x.id === id);
      if (m) { m.read = true; m.delivered = true; ChatStore.upsert(m); ChatDB.put(m); }
    });
  } catch (e) {}
}

async function fetchMessageInfo(id) {
  const res = await fetch(API + '/api/chat/' + coupleId + '/info/' + id);
  if (!res.ok) return null;
  return res.json();
}

function search(query, filter) {
  const q = (query || '').toLowerCase();
  return ChatStore.all().filter(m => {
    if (m.deleted) return false;
    if (filter === 'media' && m.type !== 'photo') return false;
    if (filter === 'starred' && !m.starred) return false;
    if (filter === 'pinned' && !m.pinned) return false;
    if (filter === 'links' && !/https?:\/\//.test(m.text || '')) return false;
    if (!q) return true;
    return (m.text || '').toLowerCase().includes(q);
  });
}
  return {
  init, loadOlder, send, patch, markRead,
  editText, deleteForMe, deleteForEveryone,
  setPinned, setStarred, toggleReaction,
  forwardMessages, deliverAll, markAllRead,
  fetchMessageInfo, search
};
})();