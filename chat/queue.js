const ChatQueue = (() => {
  let flushing = false;

  async function enqueue(payload) {
    await ChatDB.outboxAdd(payload);
    flush();
  }

  async function flush() {
    if (flushing || !navigator.onLine) return;
    flushing = true;
    try {
      const items = await ChatDB.outboxAll();
      for (const item of items) {
        try {
          const res = await fetch(API + '/api/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item)
          });
          if (!res.ok) throw new Error('send failed');
          const saved = await res.json();
          ChatStore.upsert(normalize(saved));
          await ChatDB.put(normalize(saved));
          await ChatDB.outboxRemove(item.clientId);
        } catch (e) {
          break; // stop on first failure, retry later (backoff via interval)
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

  window.addEventListener('online', flush);
  setInterval(flush, 4000);

  return { enqueue, flush, normalize };
})();