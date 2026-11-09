# Cinema: its own movie system (Nov 9, 2026)

The theatre has its **own** movie picker and its **own** video sync. Nothing about the movie comes from the Twin Hearts Watch Together page any more
(no "3D movie" button, no file hand-over, no Twin Hearts room). Files: `src/watch.js` (engine), `src/moviepick.js` (picker panel), `tests/watch-sync.test.mjs`.

## Flow
1. One partner opens the cinema (Together → Twin Cinema), walks in and **invites** the other. The invite card in Twin Hearts opens the cinema for the partner.
2. Both go to the lobby, the host presses *Start movie night*, both walk into the hall.
3. Inside the hall (walking / sitting) the **movie panel** (top centre) has two buttons:
   - **🎞 Choose movie**: a file on this device. The partner is asked to choose the same file (length must match within 3 s; otherwise "use THIS file instead?").
   - **☁️ Cloud movies**: the couple's Cloudflare R2 library. One tap, the partner loads the same movie by itself (each phone streams its own signed URL).
4. Chips show *You ✓ / Your partner ✓*. **Start movie** stays locked until both phones have the movie loaded.
5. Start (both seated) → curtains → the movie starts for both.

## Sync (src/watch.js) — why it no longer freezes
- Own channel `<session>~movie` (Supabase Realtime broadcast), separate from the scene channel.
- ONE timeline `{seq, playing, pos, at, by}`. Play / pause / seek write the next `seq`; each phone computes `expected = pos + (now - at)` while playing.
- **Nobody waits for anybody.** If one phone stalls, the other keeps playing (it only sees "⏳ Your partner is loading…"). The slow phone jumps to the timeline once its data is back. (Before: a stall paused BOTH phones and they re-triggered each other = the freezing.)
- The owner repeats the timeline every 3 s, so a lost message heals itself. A phone that joins/reloads asks (`want`) and gets the movie, the timeline and the ready flag.
- Drift: speed nudge ±6 % when 0.4–2.5 s off, ONE hard seek when further, never two seeks within 7 s, nothing while the video is loading.
- Cloud link errors: a fresh signed URL is fetched and the movie returns to the same second.

## Server (us-app `routes/cinema.js`)
- `GET /api/cinema/:session/cloud?coupleId&role` → `{movies:[{id,title,durationSec,sizeBytes}]}` (ready R2 movies of the couple)
- `GET /api/cinema/:session/cloud/:movieId/url?coupleId&role` → `{url,title,durationSec}` (fresh signed URL)
- Cloud playback needs CORS on the movie bucket for the cinema site: `GET, HEAD`, header `Range`.

## Run tests
`node tests/watch-sync.test.mjs` (24 tests, no install needed) · `node tests/cinema.test.js` in us-app (server routes).
