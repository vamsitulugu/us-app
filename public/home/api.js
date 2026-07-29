// public/home/api.js
// ════════════════════════════════════════════════
//  API layer — all fetch calls to /api/home/*
// ════════════════════════════════════════════════
const HomeAPI = (() => {
  const BASE = '/api/home';

  async function req(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(BASE + path, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    return res.json();
  }

  // ── Furniture ──────────────────────────────────
  // update/remove now also send coupleId — the backend verifies the
  // furniture item actually belongs to that couple before mutating it.
  const furniture = {
    list:   (cid)              => req('GET',    `/furniture/${cid}`),
    add:    (payload)           => req('POST',   `/furniture`, payload),
    update: (id, data, cid)     => req('PUT',    `/furniture/${id}`, { ...data, coupleId: cid || data.coupleId }),
    remove: (id, cid)           => req('DELETE', `/furniture/${id}`, { coupleId: cid })
  };

  // ── Pets ───────────────────────────────────────
  const pets = {
    list:   (cid)              => req('GET',   `/pets/${cid}`),
    create: (payload)          => req('POST',  `/pets`, payload),
    action: (id, payload, cid) => req('PATCH', `/pets/${id}`, { ...payload, coupleId: cid || payload.coupleId })
  };

  // ── Memory objects ─────────────────────────────
  const memories = {
    list:   (cid)     => req('GET',    `/memories/${cid}`),
    add:    (payload) => req('POST',   `/memories`, payload),
    remove: (id, cid) => req('DELETE', `/memories/${id}`, { coupleId: cid })
  };

  // ── Settings ───────────────────────────────────
  const settings = {
    get:  (cid)          => req('GET', `/settings/${cid}`),
    save: (cid, payload) => req('PUT', `/settings/${cid}`, payload)
  };

  // ── Presence ───────────────────────────────────
  const presence = {
    get:    (cid)          => req('GET', `/presence/${cid}`),
    update: (payload)      => req('PUT', `/presence`, payload)
  };

  return { furniture, pets, memories, settings, presence };
})();

window.HomeAPI = HomeAPI;