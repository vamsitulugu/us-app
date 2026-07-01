const ChatDB = (() => {
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const req = indexedDB.open('us_chat_v2', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('messages')) {
          const s = db.createObjectStore('messages', { keyPath: 'client_id' });
          s.createIndex('created_at', 'created_at');
        }
        if (!db.objectStoreNames.contains('outbox')) {
          db.createObjectStore('outbox', { keyPath: 'client_id' });
        }
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    return dbp;
  }
  async function tx(store, mode) { return (await open()).transaction(store, mode).objectStore(store); }

  return {
    async putMany(msgs) {
      const s = await tx('messages', 'readwrite');
      msgs.forEach(m => s.put(m));
    },
    async put(msg) { (await tx('messages', 'readwrite')).put(msg); },
    async all() {
      const s = await tx('messages', 'readonly');
      return new Promise((res) => {
        const out = [];
        const req = s.openCursor();
        req.onsuccess = e => {
          const c = e.target.result;
          if (c) { out.push(c.value); c.continue(); } else res(out.sort((a, b) => a.created_at.localeCompare(b.created_at)));
        };
      });
    },
    async outboxAdd(item) { (await tx('outbox', 'readwrite')).put(item); },
    async outboxRemove(clientId) { (await tx('outbox', 'readwrite')).delete(clientId); },
    async outboxAll() {
      const s = await tx('outbox', 'readonly');
      return new Promise(res => {
        const out = [];
        const req = s.openCursor();
        req.onsuccess = e => { const c = e.target.result; if (c) { out.push(c.value); c.continue(); } else res(out); };
      });
    }
  };
})();