const ChatStore = (() => {
  let messages = [];              // sorted array, source of truth for UI
  const byId = new Map();
  const listeners = new Set();

  function notify(patch) { listeners.forEach(fn => fn(patch)); }
  function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function upsert(msg) {
    const existing = byId.get(msg.client_id);
    if (existing) Object.assign(existing, msg);
    else {
      byId.set(msg.client_id, msg);
      const idx = messages.findIndex(m => m.created_at > msg.created_at);
      if (idx === -1) messages.push(msg); else messages.splice(idx, 0, msg);
    }
    notify({ type: existing ? 'update' : 'insert', msg });
  }
  function upsertMany(list) { list.forEach(upsert); }
  function remove(clientId) {
    const i = messages.findIndex(m => m.client_id === clientId);
    if (i > -1) { const [m] = messages.splice(i, 1); byId.delete(clientId); notify({ type: 'remove', msg: m }); }
  }
  function all() { return messages; }
  function get(clientId) { return byId.get(clientId); }

  return { upsert, upsertMany, remove, all, get, on };
})();