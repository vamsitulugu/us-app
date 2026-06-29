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
  const furniture = {
    list:   (cid)       => req('GET',    `/furniture/${cid}`),
    add:    (payload)   => req('POST',   `/furniture`, payload),
    update: (id, data)  => req('PUT',    `/furniture/${id}`, data),
    remove: (id)        => req('DELETE', `/furniture/${id}`)
  };

  // ── Pets ───────────────────────────────────────
  const pets = {
    list:   (cid)         => req('GET',   `/pets/${cid}`),
    create: (payload)     => req('POST',  `/pets`, payload),
    action: (id, payload) => req('PATCH', `/pets/${id}`, payload)
  };

  // ── Memory objects ─────────────────────────────
  const memories = {
    list:   (cid)     => req('GET',    `/memories/${cid}`),
    add:    (payload) => req('POST',   `/memories`, payload),
    remove: (id)      => req('DELETE', `/memories/${id}`)
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