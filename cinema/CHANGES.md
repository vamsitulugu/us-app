# Cinema movie system rebuilt (Nov 9, 2026)
- New `src/watch.js`: own peer-to-peer timeline, "nobody waits for anybody" (fixes both phones freezing when one stalls), owner heartbeat, late-join handshake, ready gate.
- New `src/moviepick.js`: 🎞 Choose movie + ☁️ Cloud movies (R2) inside the theatre; Start is locked until both phones have the movie.
- `src/net.js`: `openChannel` (shared Supabase client). `src/invite.js`: removed the app hand-over (postMessage / Android stream / movie info); added `fetchCloudList` / `fetchCloudUrl`.
- `src/main.js`: uses the new engine + picker. The Twin Hearts room, shared clock, stall hold, scheduled start and file hand-over are gone.
- Tests: `tests/watch-sync.test.mjs` (24). See CINEMA_FLOW.md.
