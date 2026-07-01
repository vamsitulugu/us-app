const ChatQueue = (() => {
  let flushing = false;

  async function enqueue(payload) {
  const item = { ...payload, client_id: payload.clientId || payload.client_id };
  await ChatDB.outboxAdd(item);
  flush();
}

  async function flush() {
    if (flushing || !navigator.onLine) return;
    flushing = true;
    try {
      const items = await ChatDB.outboxAll();
      for (const item of items) {
        item._attempts = (item._attempts || 0) + 1;
        try {
          const res = await fetch(API + '/api/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item)
          });
          if (!res.ok) throw new Error('send failed');
          const saved = await res.json();
          const norm = normalize(saved);
          ChatStore.upsert(norm);
          await ChatDB.put(norm);
          await ChatDB.outboxRemove(item.client_id || item.clientId);
        } catch (e) {
          if (item._attempts >= 5) {
            const failing = ChatStore.get(item.client_id || item.clientId);
            if (failing) { failing._status = 'failed'; ChatStore.upsert(failing); }
            await ChatDB.outboxRemove(item.client_id || item.clientId); // stop retrying, user must tap retry
          } else {
            await ChatDB.outboxAdd(item); // re-queue with incremented attempts
          }
          break;
        }
      }
    } finally { flushing = false; }
  }

  function normalize(row) {
    return {
      client_id: row.client_id, id: row.id, couple_id: row.couple_id,
      sender_role: row.sender_role, type: row.type, text: row.text,
      media_url: row.media_url, audio_data: row.audio_data, duration: row.duration,
      reply_to: row.reply_to, pinned: row.pinned, starred: row.starred,
      reactions: row.reactions || {}, read: row.read, deleted: row.deleted,
      created_at: row.created_at, _status: 'sent'
    };
  }
async function retry(clientId) {
  const msg = ChatStore.get(clientId);
  if (!msg) return;
  msg._status = 'sending'; ChatStore.upsert(msg);
  await enqueue({
    clientId: msg.client_id, coupleId: msg.couple_id, senderRole: msg.sender_role,
    type: msg.type, text: msg.text, mediaUrl: msg.media_url,
    audioData: msg.audio_data, duration: msg.duration, replyTo: msg.reply_to
  });
}
// add `retry` to the returned object: return { enqueue, flush, normalize, retry };
  window.addEventListener('online', flush);
  setInterval(flush, 4000);

  return { enqueue, flush, normalize };
})();