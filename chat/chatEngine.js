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

  return { init, loadOlder, send, patch, markRead };
})();