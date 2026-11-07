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

## Normal movie / 3D movie (Watch Together)
The Watch Together page has no separate 3D button any more. Flow: **both pick the same movie (from their devices, or one shared cloud movie) → both press I'M READY → two buttons appear: 🎬 Normal movie (as before) · 🍿 3D movie.**
- Either partner can pick **3D movie**: they enter the cinema lobby (their avatar) with the invite already sent; the other phone is on the same screen, notices within ~2 s and follows automatically (if they are not on that screen they get the normal invite card / push).
- **Cloud movie** → the cinema streams the same movie from a short-lived signed URL (`GET /api/cinema/:id/movie`). Your movie bucket (Cloudflare R2) must allow CORS for the cinema site, otherwise the 3D screen stays black: bucket → Settings → CORS policy: AllowedOrigins `https://twin-cinemas.vercel.app`, AllowedMethods `GET, HEAD`, AllowedHeaders `*` (Range), ExposeHeaders `Content-Length, Content-Range`.
- **Device movie** → the cinema lobby asks both to choose their own copy of the movie; the length must match (±3 s, same rule as the Watch Together page). The host can press Start when both have chosen.
- The Together → Twin Cinema row is unchanged (opens the lobby without a movie picked).
