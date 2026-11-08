// In-memory Supabase stand-in for the Watch Together routes (shared by movie-sync.test.js and web-e2e.js).
const tables = { watch_sessions: [], watch_history: [], movie_chat_messages: [] };
function query(table) {
  const rows = tables[table]; let op = 'select', patch = null, filters = [], single = false, maybe = false;
  const api = {
    select() { return api; }, insert(v) { op = 'insert'; patch = v; return api; }, update(v) { op = 'update'; patch = v; return api; },
    upsert(v) { op = 'upsert'; patch = v; return api; }, delete() { op = 'delete'; return api; },
    eq(k, v) { filters.push(r => r[k] === v); return api; }, in(k, a) { filters.push(r => a.includes(r[k])); return api; },
    gt() { return api; }, order() { return api; }, limit() { return api; },
    single() { single = true; return api; }, maybeSingle() { maybe = true; return api; },
    then(res, rej) { return Promise.resolve(run()).then(res, rej); }
  };
  function run() {
    let m = rows.filter(r => filters.every(f => f(r)));
    if (op === 'insert') { rows.push({ ...patch }); m = [patch]; }
    else if (op === 'upsert') { const i = rows.findIndex(r => r.couple_id === patch.couple_id); if (i >= 0) rows[i] = { ...rows[i], ...patch }; else rows.push({ ...patch }); m = [rows.find(r => r.couple_id === patch.couple_id)]; }
    else if (op === 'update') m.forEach(r => Object.assign(r, patch));
    else if (op === 'delete') { m.forEach(r => rows.splice(rows.indexOf(r), 1)); m = []; }
    const out = m.map(r => ({ ...r }));
    if (single || maybe) return { data: out[0] || null, error: null };
    return { data: out, error: null };
  }
  return api;
}
const sbPath = require.resolve('../../middleware/supabase');
require.cache[sbPath] = { id: sbPath, filename: sbPath, loaded: true, exports: { from: query, channel: () => ({ send: async () => {} }) } };

module.exports = { tables };
