# Twin Cinema × Twin Hearts — setup (3 steps)

Flow: **Together → Twin Cinema → (host) cinema lobby → Invite → (partner) invite card → Accept → host presses Start → both go in.**

0. **The cinema is part of this repo.** Source: `cinema/` (Vite + Three.js). The built copy is committed in `public/cinema/` and served at `/cinema/` on the same domain — no separate repo, Vercel project or cinema env vars. After changing anything in `cinema/`, run `npm run build:cinema` and commit `public/cinema`. Edit the canteen menu: change `cinema/src/menu.js`, then `cd cinema && npm run export-menu`.
1. **Supabase** → SQL Editor → run `migrations/cinema_sessions.sql`.
2. **Render** (this app's backend) → deploy this commit. Delete the old `CINEMA_URL` env var if you set it — it is ignored now (the server always sends `https://twinhearts.vercel.app/cinema`).
3. Vercel needs no cinema env vars: the cinema reuses the web app's own public Supabase keys.

Test: `npm run test:cinema` (backend flow, no database needed).

Notes
- The room is the session id (an unguessable UUID); the couple id travels only in the URL hash and is removed from the address bar on load.
- Invites expire after 10 minutes; the host can re-invite after a decline/expiry.
- Android: if the WebView does not open the cinema page, open it in a Chrome Custom Tab / external browser (the URL is `https://…vercel.app/#s=…`).

## Lobby movie frames
The cinema lobby frames show the phone's own **Movie → Library** (browser storage `us_movies_v2`). `public/cinema-invite.js` adds it to the cinema link as `&lib=` (newest ≤40 movies, shrunk to ≤12 KB; uploaded `data:` posters are skipped → title card). The link hash never reaches a server and the cinema strips it after reading. An empty library shows "No movies yet". `GET /api/cinema/:id/library` (movie_favorites) is only the fallback when a link carries no `lib`.

## Canteen = Twin Hearts Gold Coins
The cinema canteen has no money: every order is paid with the buyer's **Gold Coins** (the Twin Rewards wallet).
- `GET /api/cinema/:id/wallet?coupleId=&role=` → `{ balance }` (shown in the canteen header).
- `POST /api/cinema/:id/canteen/order` `{ coupleId, role, clientId, for, lines:[{id,qty,sel}] }` — the server re-prices the order from `lib/canteen-menu.json`, then spends the coins with `reward_credit()` (kind `canteen_order`, idempotent per `clientId`). Not enough coins → `402 { code:'insufficient', balance, need }`.
- Opened without the Twin Hearts hand-off (no wallet) the canteen shows the menu but ordering is disabled.
- **Changing the menu / prices:** edit `cinema/src/menu.js`, then run `npm run export-menu` inside `cinema/` (rewrites `lib/canteen-menu.json`) and deploy. The server only accepts items in that JSON.
- No SQL migration needed (uses the existing `reward_wallets` / `coin_transactions`). Test: `npm run test:canteen`.

## Auto-share the movie (nobody chooses the same file twice)
The cinema uploads the movie once to your Cloudflare R2 bucket and the partner streams it. Needs the Shared Cloud Storage setup (`migrations/shared_movies.sql` + `R2_*` env vars) and **CORS on the R2 bucket** for the cinema site:
`AllowedOrigins` = `https://twinhearts.vercel.app` · `AllowedMethods` = `GET, HEAD, PUT` · `AllowedHeaders` = `*` · `ExposeHeaders` = `ETag, Content-Range, Content-Length, Accept-Ranges`.
Optional env: `CINEMA_AUTO_SHARE_FREE=1` (let free couples auto-share; default Pro only) · `CINEMA_SHARE_TTL_HOURS=48` (auto-shared movies are deleted after this). Endpoints: `POST /api/cinema/:id/share/init | :movieId/parts | :movieId/complete | :movieId/abort`.
