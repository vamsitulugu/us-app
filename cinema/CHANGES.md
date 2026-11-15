# Lobby / invite / Start made reliable (Nov 15, 2026)
- **One room per couple** (`routes/cinema.js` `/create`): the first phone in is the host; a phone that arrives while the partner's room is live joins it as the GUEST automatically (no invite needed). If both arrive at the same instant the oldest live row wins and the other phone joins it. Before, each phone created its own room, so one saw "Invite partner" and the other "Waiting for host".
- `create` accepts `invite:true` (Movie page 3D button): open + invite in ONE request. Invite also works on a room left in `started` (was a 409). Sessions stay live 30 min after the last sign of life; the cinema pings every 4 min.
- `src/net.js`: presence heartbeat from a plain timer (not the render loop), 15 s silence = gone; a seat-conflict now needs a real second phone heard repeatedly (a reload no longer blocks you).
- `src/invite.js`: Start repeats `go` every 1.5 s until the partner answers `goack`; invite / status calls retry through a sleeping server and show a readable message.
- Tests: `node cinema/tests/handshake.test.mjs`, `node tests/cinema.test.js`.

# Cinema movie system rebuilt (Nov 9, 2026)
- New `src/watch.js`: own peer-to-peer timeline, "nobody waits for anybody" (fixes both phones freezing when one stalls), owner heartbeat, late-join handshake, ready gate.
- New `src/moviepick.js`: 🎞 Choose movie + ☁️ Cloud movies (R2) inside the theatre; Start is locked until both phones have the movie.
- `src/net.js`: `openChannel` (shared Supabase client). `src/invite.js`: removed the app hand-over (postMessage / Android stream / movie info); added `fetchCloudList` / `fetchCloudUrl`.
- `src/main.js`: uses the new engine + picker. The Twin Hearts room, shared clock, stall hold, scheduled start and file hand-over are gone.
- Tests: `tests/watch-sync.test.mjs` (24). See CINEMA_FLOW.md.
