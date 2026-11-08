# Twin Cinema × Twin Hearts — setup (3 steps)

Flow: **Together → Twin Cinema → (host) cinema lobby → Invite → (partner) invite card → Accept → host presses Start → both go in.**

1. **Supabase** → SQL Editor → run `migrations/cinema_sessions.sql`.
2. **Render** (this app's backend) → deploy this commit. Optional env var `CINEMA_URL` (default `https://twin-cinemas.vercel.app`) — use whichever cinema URL you keep as official.
3. **Vercel → twin-cinemas → Settings → Environment Variables** → add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Supabase → Settings → API → *anon public* key, NOT the service key), then **redeploy**.
   Without these the cinema falls back to "local test mode" and the two phones can never meet (the lobby shows a warning).

Test: `npm run test:cinema` (backend flow, no database needed).

Notes
- The room is the session id (an unguessable UUID); the couple id travels only in the URL hash and is removed from the address bar on load.
- Invites expire after 10 minutes; the host can re-invite after a decline/expiry.
- Android: if the WebView does not open the cinema page, open it in a Chrome Custom Tab / external browser (the URL is `https://…vercel.app/#s=…`).

## Lobby movie frames
The cinema lobby frames show the phone's own **Movie → Library** (browser storage `us_movies_v2`). `public/cinema-invite.js` adds it to the cinema link as `&lib=` (newest ≤40 movies, shrunk to ≤12 KB; uploaded `data:` posters are skipped → title card). The link hash never reaches a server and the cinema strips it after reading. An empty library shows "No movies yet". `GET /api/cinema/:id/library` (movie_favorites) is only the fallback when a link carries no `lib`.
