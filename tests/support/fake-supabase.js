// Minimal in-memory stand-in for @supabase/supabase-js (service-role client),
// good enough to exercise routes/*.js end to end without a real database.
const crypto = require('crypto');

const db = {
  songs: [], music_user_state: [], music_playlists: [], music_playlist_songs: [],
  personal_recordings: [], cached_lyrics: [], missing_lyrics: [],
};
// Tables that "don't exist yet" (simulates the migration not being applied).
const missingTables = new Set();
const storage = {}; // bucket -> Map(path -> {buffer, contentType})
const rpcCalls = [];

const uuid = () => crypto.randomUUID();
const PK = { music_user_state: ['song_id', 'user_id'], music_playlist_songs: ['playlist_id', 'song_id'] };

function missingErr(table) {
  return { code: '42P01', message: `relation "public.${table}" does not exist` };
}

class Query {
  constructor(table) { this.table = table; this.op = 'select'; this.filters = []; this._order = null; this._limit = null; this._single = null; this._payload = null; this._opts = {}; this._returning = false; }
  select() { if (this.op === 'select') this.op = 'select'; else this._returning = true; return this; }
  insert(p) { this.op = 'insert'; this._payload = p; return this; }
  update(p) { this.op = 'update'; this._payload = p; return this; }
  upsert(p, o) { this.op = 'upsert'; this._payload = p; this._opts = o || {}; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c, v) { this.filters.push((r) => String(r[c]) === String(v)); return this; }
  neq(c, v) { this.filters.push((r) => String(r[c]) !== String(v)); return this; }
  in(c, vs) { const set = new Set(vs.map(String)); this.filters.push((r) => set.has(String(r[c]))); return this; }
  order(c, o) { this._order = { c, asc: !o || o.ascending !== false }; return this; }
  limit(n) { this._limit = n; return this; }
  single() { this._single = 'single'; return this; }
  maybeSingle() { this._single = 'maybe'; return this; }
  then(res, rej) { return Promise.resolve(this._run()).then(res, rej); }

  _run() {
    if (missingTables.has(this.table)) return { data: null, error: missingErr(this.table) };
    const rows = db[this.table];
    if (!rows) return { data: null, error: { code: '42P01', message: `relation "${this.table}" does not exist` } };
    const match = (r) => this.filters.every((f) => f(r));
    let out = [];
    const now = new Date().toISOString();
    if (this.op === 'insert') {
      const list = Array.isArray(this._payload) ? this._payload : [this._payload];
      // simulate migration columns missing on personal_recordings
      if (this.table === 'personal_recordings' && db.__recordingsLegacy && list.some((r) => 'kind' in r || 'song_id' in r)) {
        return { data: null, error: { message: "Could not find the 'kind' column of 'personal_recordings' in the schema cache" } };
      }
      list.forEach((r) => {
        const row = { ...r };
        if (!PK[this.table] && row.id === undefined) row.id = uuid();
        if (row.created_at === undefined) row.created_at = now;
        if (this.table === 'couple_movies' && row.updated_at === undefined) row.updated_at = now;
        if (PK[this.table]) {
          const k = PK[this.table];
          if (rows.some((x) => k.every((c) => String(x[c]) === String(row[c])))) { out = null; return; }
        }
        rows.push(row); out.push(row);
      });
      if (out === null) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
    } else if (this.op === 'upsert') {
      const list = Array.isArray(this._payload) ? this._payload : [this._payload];
      const k = (this._opts.onConflict || '').split(',').filter(Boolean);
      list.forEach((r) => {
        const idx = k.length ? rows.findIndex((x) => k.every((c) => String(x[c]) === String(r[c]))) : -1;
        if (idx >= 0) { Object.assign(rows[idx], r); out.push(rows[idx]); }
        else { const row = { ...r }; if (!PK[this.table] && row.id === undefined) row.id = uuid(); rows.push(row); out.push(row); }
      });
    } else if (this.op === 'update') {
      rows.filter(match).forEach((r) => { Object.assign(r, this._payload); out.push(r); });
    } else if (this.op === 'delete') {
      const keep = []; rows.forEach((r) => { if (match(r)) out.push(r); else keep.push(r); });
      rows.length = 0; keep.forEach((r) => rows.push(r));
    } else {
      out = rows.filter(match);
      if (this._order) { const { c, asc } = this._order; out = out.slice().sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1)); }
      if (this._limit != null) out = out.slice(0, this._limit);
    }
    const returning = this.op === 'select' || this._returning;
    if (this._single) {
      if (!returning) return { data: null, error: null };
      if (!out.length) return this._single === 'maybe' ? { data: null, error: null } : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
      return { data: out[0], error: null };
    }
    return { data: returning ? out.map((r) => ({ ...r })) : null, error: null };
  }
}

const fake = {
  from: (t) => new Query(t),
  rpc: async (name, args) => {
    rpcCalls.push({ name, args });
    if (name === 'music_increment_play' && !db.__noRpc) {
      const s = db.songs.find((x) => String(x.id) === String(args.p_song_id));
      if (s) { s.play_count = (s.play_count || 0) + 1; s.last_played = new Date().toISOString(); }
      return { data: null, error: null };
    }
    return { data: null, error: { message: 'function does not exist' } };
  },
  storage: {
    from: (bucket) => ({
      upload: async (path, buffer, opts) => {
        storage[bucket] = storage[bucket] || new Map();
        if (storage[bucket].has(path)) return { error: { message: 'exists' } };
        storage[bucket].set(path, { buffer, contentType: opts && opts.contentType });
        return { error: null };
      },
      remove: async (paths) => { (paths || []).forEach((p) => storage[bucket] && storage[bucket].delete(p)); return { error: null }; },
      getPublicUrl: (path) => ({ data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
      createSignedUrl: async (path) => ({ data: { signedUrl: `https://proj.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=abc` } }),
    }),
  },
};

module.exports = { fake, db, storage, missingTables, rpcCalls };
