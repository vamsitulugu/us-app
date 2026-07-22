# US ❤️ — Complete Application Audit
Repository: `vamsitulugu/us-app` · Audited commit: `9e81873` (main)
Auditor scope note is at the bottom of this document — read it before treating any "Broken" verdict as certain.

---

## 1. What this app actually is

A single Node/Express server (`server.js`) serves a static frontend from `/public` and exposes ~90 JSON API routes under `/api/*`, backed entirely by Supabase (Postgres + Storage), using the **service-role key** (RLS is bypassed server-side — every route is its own gatekeeper, there is no database-level safety net).

There is **no session/token layer**. Login/pairing returns a `coupleId` (UUID) and the client stores it locally; every subsequent API call just trusts whatever `coupleId` it's given in the request body/params/query. This single fact drives most of the Security section below, so it's stated up front rather than buried.

Two frontend architectures coexist:
- **Inline SPA pages** — `public/index.html` (9,906 lines) contains `<div class="page" id="page-X">` blocks for dashboard, chat, live map, money, study, habits, etc., all sharing one `S` state object synced via `POST/GET /api/data/state/:coupleId`.
- **Iframe micro-apps** — Globe, Music, Games, Dream Goals, Places, Collection, Love Counter, and the Three.js Virtual Home are each a standalone HTML file (`globe.html`, `music.html`, …) loaded in an `<iframe>` inside index.html, each syncing its own slice of state independently.

This hybrid is a real architectural decision (keeps the SPA shell light, lets heavy features like Virtual Home load lazily), not an accident — but it does mean "state" lives in two shapes: the shared `app_state` blob and several dozen dedicated tables (chat, songs, furniture, locations, etc.) for anything high-frequency or large.

---

## 2. Folder structure (as it actually exists — not as `PROJECT_STRUCTURE.md` describes)

```
us-app/
├── server.js                  Express entry point, route mounting, security headers
├── package.json                23 runtime deps, 4 dev deps
├── middleware/
│   └── supabase.js             Single service-role Supabase client (10 lines)
├── routes/                     15 files, ~3,200 lines total — see §5
├── public/                     ~29,000 lines of JS + 9 standalone HTML apps
│   ├── index.html               SPA shell (9,906 lines: inline <style>, inline pages, ~40 <script> tags)
│   ├── livemap.js               2,458 lines — Live Map engine (just redesigned, see §9)
│   ├── livemap-redesign.{css,js}  Additive UI layer added this session
│   ├── chat/                    call.js (1,044), chat.js (1,219), call.css, chat.css, lyrics-manager.js
│   ├── home/                    35 files — Three.js Virtual Home (scene, rooms, avatars, weather, pets…)
│   ├── search/                  8 files — multi-provider place search (Overpass/Nominatim/Photon + IndexedDB cache)
│   ├── js/audio/                4 files — a full custom Web Audio sound-effects engine
│   ├── lyrics-*.js              7 top-level files — Smart Lyrics Engine (fetch, cache, admin dashboard, background worker)
│   ├── *.html                   9 standalone iframe apps (globe, music, games, dreamgoals, places, collection, lovecounter, meetplanner, landing)
│   ├── *.css                    6 additive override stylesheets (app-polish, premium-motion, premium-states, responsive-fix, theme-burgundy, composer)
│   └── sw.js, manifest.json     PWA service worker + manifest
├── css-src/                     Human-readable originals of the 6 minified public/*.css files
├── android/                     Capacitor 8 native Android project (Java, Gradle)
├── scripts/                     1 one-off migration script (base64 → Supabase Storage)
├── resources/                   Capacitor icon/splash source images
├── PROJECT_OVERVIEW.md, PROJECT_STRUCTURE.md, README.md, structure.txt   — see §11, these are stale
└── index.html.patch             Leftover artifact from a previous session's patch delivery (see §8)
```

`node_modules/` (not audited — third-party code) and `.env` (not present in the repo; correctly gitignored) were excluded, as expected.

---

## 3. Full feature inventory

For each feature: what it does, where it lives, backend/DB it touches, and status **as verified by reading the code**, not assumed from naming.

| # | Feature | Frontend | Backend routes | Tables | Status |
|---|---|---|---|---|---|
| 1 | Couple pairing (connect-code) | index.html onboarding | `POST /api/auth/setup`, `/pair`, `/unpair` | `couples` | ✅ Complete |
| 2 | Email/password auth | index.html onboarding | `POST /api/auth/register`, `/login` | `couples` | ✅ Complete, but runs **parallel** to #1 (see §7.3) |
| 3 | Vault PIN | index.html | `/verify-pin`, `/change-pin` | `couples.vault_pin` | ✅ Complete |
| 4 | Shared app state sync | index.html (`S` object, 5s poll) | `GET/POST /api/data/state/:coupleId` | `app_state` | ✅ Complete, ⚠️ no auth check (§7.1) |
| 5 | Diff-based push notifications | server-side only | `diffAndNotify()` in `data.js` | reads `app_state` | ✅ Complete — 17 watched content types |
| 6 | Web Push + FCM dual delivery | `sw.js`, native Android | `/push/subscribe`, `/register-fcm-token` | `push_subscriptions`, `fcm_tokens` | ✅ Complete |
| 7 | Chat (text/image/video/voice) | `chat/chat.js` (1,219 ln) | `routes/chat.js` (252 ln, 11 endpoints) | `chat_messages`, `chat_presence` | ✅ Complete — edit, delete (for-me/everyone), reactions, pin, star, in-chat search |
| 8 | Voice/video calling (WebRTC) | `chat/call.js` (1,044 ln) | `routes/call.js` (signal, TURN creds, log, notify) | `call_signals` | ✅ Complete — PiP minimize; **new split-screen mode added this session** (§9) |
| 9 | Live Map — presence, tracking | `livemap.js` + redesign layer | `routes/location.js` | `live_locations`, `live_location_history` | ✅ Complete |
| 10 | Live Map — search, directions, POI-along-route | `livemap.js` | `routes/search.js` (Overpass proxy + cache) | `poi_cache` | ✅ Complete; **fallback chain (route→dest→current) added this session** |
| 11 | Live Map — daily route history / stop detection | `livemap.js` | `routes/route.js` | `route_points` | ✅ Complete, clever haversine clustering |
| 12 | Memory Globe (trips/photos/timeline) | `globe.html` (3,193 ln) + `js/globe-adaptive.js` | `routes/globe.js` | `globe_memories`, `globe_memory_media` | ✅ Complete |
| 13 | Meet Planner | `public/meetplanner.js` (611 ln) + `meetplanner.html` | `routes/meetplanner.js` (258 ln, fully written) | `meetup_plans` | 🔴 **BROKEN IN PRODUCTION** — route file is never mounted in `server.js` (§6) |
| 14 | Music player + shared playlist | `music-player.js` (811 ln), `music.html` | `routes/music.js` | `songs` | ✅ Complete |
| 15 | Smart Lyrics Engine (multi-provider, caching, karaoke sync) | `lyrics-*.js` (7 files), `player-lyrics-hook.js` | `routes/lyrics.js` (413 ln) | `cached_lyrics`, `missing_lyrics`, `lyrics_search_history` | ✅ Complete — LRCLIB primary, cooldown on repeated misses, admin dashboard |
| 16 | Karaoke mode (recording + duet invites) | `couple-karaoke.js` (896 ln) | `/api/media/upload-recording`, small-signal endpoints | `signals` (unmounted, see below) | ⚠️ Partial — invite signaling (`ck_*` keys) is written through `app_state`/`diffAndNotify`, **not** through `routes/signal.js`, which is dead code (§6) |
| 17 | Virtual Home (Three.js) — structure, furniture, decoration | `home/*.js` (35 files) | `routes/home.js` (furniture CRUD) | `home_furniture` | ✅ Complete (Phases 1–5 per docs) |
| 18 | Virtual Home — pets | `home/pets.js` | `routes/home.js` | `home_pets` | ✅ Complete |
| 19 | Virtual Home — memory objects (photo frames, shelf) | `home/memories.js` (1,552 ln) | `routes/home.js` | `home_memory_objects` | ✅ Complete |
| 20 | Virtual Home — presence/multiplayer position | `home/realtime_living.js` | `routes/home.js` | `home_presence` | ✅ Complete |
| 21 | Virtual Home — Living World (avatars, pets AI, weather, day/night) | `home/avatars.js`, `weather.js`, `sky.js`, `ai_behavior.js`, `event_engine.js`, `emotion_engine.js`, `npc_behavior.js`, etc. | environment synced via Realtime broadcast, not a dedicated table | — | ✅ Complete — **docs say this is still "Planned Phase 6/7"; code says otherwise** (§11) |
| 22 | AI Love Guide (Groq/Llama chat) | not yet wired to a visible page in the files sampled | `routes/ai.js` (chat + SSE streaming) | none | ⚠️ Backend complete, **no rate limiting, no auth, costs Vamsi's Groq quota** (§7.2) |
| 23 | Games hub | `games.html` (1,624 ln), `couple-games-addon.js` | uses `/api/data/state` | `app_state` | ✅ Complete |
| 24 | Dream Goals | `dreamgoals.html` | `/api/data/state` | `app_state` | ✅ Complete |
| 25 | Love Counter | `lovecounter.html` | `/api/data/state` | `app_state` | ✅ Complete |
| 26 | Collection (gifts/collectibles) | `collection.html` | `/api/data/state` | `app_state` | ✅ Complete |
| 27 | Places (important-place memories) | `places.html` | via Live Map's places CRUD, stored in `app_state.places` | `app_state` | ✅ Complete |
| 28 | Photo/video upload (general + vault) | index.html | `POST /api/media/upload` | Storage: `couple-photos`, `vault-media` | ✅ Complete, ⚠️ delete endpoint is an IDOR (§7.1) |
| 29 | PWA / offline shell | `sw.js`, `manifest.json` | — | — | ✅ Complete — network-first for scripts/HTML, cache-first w/ revalidation for style/font/image, API never intercepted |
| 30 | Android native wrapper | `android/` (Capacitor 8) | native Java (`CallAudioPlugin`, `MainActivity`) | — | ✅ Complete — custom notification channels for touch/calls, deep links, haptics |
| 31 | Live Map redesign (this session) | `livemap-redesign.{css,js}` | none (pure UI) | none | ✅ Complete, **unverified in a live browser** — see prior turn's caveat |

### Hidden / easy-to-miss features found while reading code
- **Emergency location share** with a 10-minute partner-visible banner (`routes/location.js`, `EMERGENCY_ALERT_WINDOW_MS`).
- **Invisible Mode** for location sharing — deliberately does *not* write a `paused` status, so the partner can't detect it's on (by design, per the code comment).
- **Metadata Normalization Engine** for music — keeps both `raw_*` (original ID3) and `clean_*` (display) title/artist/album fields permanently, never overwriting the original.
- **Indic transliteration** support in the lyrics engine (`@indic-transliteration/sanscript`), optional/soft dependency.
- **Overpass mirror racing** — `routes/search.js` fires the same query at 6 different Overpass mirrors in parallel via `Promise.any`, takes the first success, and caches it — a genuinely resilient design most hobby apps skip.
- **A diagnostic-only route**, `GET /api/search/_diag`, explicitly commented "delete this route once the mirror issue is resolved" — it wasn't deleted (§6).

---

## 4. Architecture diagrams (text)

### 4.1 Request flow
```
Browser / Android WebView
   │
   ├─ Static assets ── express.static('/public', etag+1d cache, sw.js always no-cache)
   │
   └─ /api/* ── CORS allowlist → helmet → compression → express.json(50mb)
                 → route handlers → middleware/supabase.js (SERVICE ROLE, bypasses RLS)
                 → Postgres (Supabase) / Supabase Storage
                 → (fire-and-forget) Web Push + FCM to partner
```

### 4.2 Page / navigation hierarchy
```
index.html (SPA shell)
├── Onboarding (setup / pair / login)
├── Dashboard
├── Chat ───────────────── chat/chat.js + chat/call.js (WebRTC)
├── Live Map ───────────── livemap.js + livemap-redesign.{css,js}
├── Money / Study / Habits (analytics pages, app_state-only)
├── [iframe] Memory Globe ── globe.html
├── [iframe] Virtual Home ── home/home.html (Three.js)
├── [iframe] Music ───────── music.html
├── [iframe] Games ───────── games.html
├── [iframe] Dream Goals ── dreamgoals.html
├── [iframe] Places ──────── places.html
├── [iframe] Collection ──── collection.html
├── [iframe] Love Counter ── lovecounter.html
└── Meet Planner ─────────── meetplanner.html (🔴 backend unreachable, §6)
```

### 4.3 State management flow
```
Client `S` object (in-memory)
   ⇅ 5s poll / on-change save        ⇅ dedicated tables for hot-path features
GET/POST /api/data/state/:coupleId   GET/POST specific /api/<feature> routes
   ⇅                                    ⇅
app_state (single JSONB row/couple)  chat_messages, songs, home_furniture,
                                      live_locations, route_points, call_signals, …
```
Every save to `app_state` is a **merge**, not a replace (explicitly commented as a past-bug fix), and `profile` is deep-merged specifically so one device can't clobber the other's avatar/bio written moments earlier.

### 4.4 Authentication flow
```
Setup (connect-code path)                Register/Login (password path)
POST /api/auth/setup                     POST /api/auth/register
 → couples row, paired=false              → couples row + password_hash, paired=false
                                           POST /api/auth/login → bcrypt.compare
POST /api/auth/pair (partner device)      → returns coupleId (no token)
 → connect_code matched, paired=true

Client stores coupleId (+ role) in localStorage.
EVERY subsequent request just sends coupleId back — nothing re-verifies
the caller is who they say they are. There is no session, no JWT, no
cookie, no expiry, no logout-side invalidation.
```

### 4.5 Realtime / polling flow
Mixed strategy, not fully consistent:
- **Supabase Realtime channels**: Virtual Home environment sync, some of Live Map (per earlier session's memory).
- **HTTP polling**: chat (`after` timestamp cursor), call signaling (`after` id cursor), app_state (5s), presence.
- The signaling `GET /api/call/signal/:coupleId` route explicitly disables ETag caching (`Cache-Control: no-store`) — a documented fix for a real bug (browser 304-caching a stale empty array forever).

---

## 5. Database schema (reverse-engineered from code — no `schema.sql` exists in this repo)

23 tables are referenced across the codebase:

| Table | Written by | Purpose |
|---|---|---|
| `couples` | auth.js | Core identity: names, connect_code, password_hash, vault_pin, paired flag |
| `app_state` | data.js | Single JSONB blob per couple — photos, journal, money, habits, vault, profile, etc. |
| `push_subscriptions` | auth.js | Web Push endpoints per couple+role |
| `fcm_tokens` | auth.js | Firebase Cloud Messaging tokens per couple+role |
| `chat_messages` | chat.js, call.js (call logs) | Full chat history incl. reactions, pins, stars, soft-delete |
| `chat_presence` | chat.js | Online/typing status |
| `call_signals` | call.js | WebRTC SDP/ICE signaling rows |
| `live_locations` | location.js | Last-known GPS + sharing status per couple+role |
| `live_location_history` | location.js | Rolling 60-point breadcrumb trail |
| `route_points` | location.js, route.js | Daily route history, prunable |
| `poi_cache` | search.js | Cached Overpass query results (6h TTL) |
| `globe_memories` | globe.js | Trips |
| `globe_memory_media` | globe.js | Photos/videos per trip |
| `home_furniture` | home.js | Virtual Home furniture placement |
| `home_pets` | home.js | Virtual Home pets |
| `home_memory_objects` | home.js | Virtual Home photo frames/shelf items |
| `home_settings` | home.js | Theme/weather/time-of-day/active room |
| `home_presence` | home.js | Avatar position per couple+role |
| `songs` | music.js | Song metadata (incl. raw/clean ID3 fields) |
| `cached_lyrics`, `missing_lyrics`, `lyrics_search_history` | lyrics.js | Smart Lyrics Engine cache + failure cooldown + audit log |
| `signals` | signal.js (route is unmounted — see §6) | Generic small-value signaling — currently dead |
| `meetup_plans` | meetplanner.js (route is unmounted — see §6) | Saved meeting plans — currently unreachable |

**No RLS policy files, migrations, or SQL exist in this repo** — the schema lives entirely in Supabase's dashboard/history, outside version control. That's a real risk: the schema can't be reconstructed from this repo alone, and there's no record of what RLS policies (if any) exist on these tables, though it's moot for the API server since it uses the service-role key regardless.

---

## 6. Broken / dead / unused — verified, not guessed

| Finding | Evidence | Impact |
|---|---|---|
| 🔴 **Meet Planner backend is unreachable** | `routes/meetplanner.js` exists (258 lines, fully implemented) but `server.js` never does `app.use('/api/meetplanner', ...)`. `public/meetplanner.js` calls `POST/GET/PATCH/DELETE /api/meetplanner*` regardless. | Every Meet Planner action returns Express's default 404 HTML page in production right now. This is the single highest-value fix in this report — it's one missing line in `server.js`. |
| 🟡 `routes/signal.js` is dead code | Never mounted in `server.js`, and no frontend file calls `/api/signal/*`. | 62 lines of otherwise-clean code doing nothing. Karaoke invites (`ck_*` keys) are actually delivered through the `app_state` blob's `diffAndNotify`, not this route. Safe to delete, or wire up and migrate karaoke signaling onto it later. |
| 🟡 Rate limiters defined but never applied | `authLimiter` and `apiLimiter` are constructed in `server.js` but neither is passed to `app.use()` anywhere. | Every route, including `/api/auth/*` and the Groq-backed `/api/ai/chat`, has **zero** request-rate protection. |
| 🟡 Diagnostic route left in production | `GET /api/search/_diag` — the code comment says "delete this route once the mirror issue is resolved." | Minor: exposes internal mirror list/timings publicly; harmless but should be removed per its own comment. |
| 🟡 `index.html.patch` committed to repo root | Leftover from this session's earlier patch delivery — sits in the project root, not `public/`. | Cosmetic clutter; safe to delete once you've confirmed it applied (which the terminal screenshots confirm it did). |
| 🟡 `typescript` devDependency, zero `.ts` files anywhere | `package.json` devDependencies + full-repo file search. | Dead dependency, safe to remove, trims `npm install` time slightly. |
| 🟡 Duplicate Supabase client construction | `routes/globe.js` builds its **own** `createClient(...)` instead of importing `middleware/supabase.js`, which every other route uses. | Not a bug (same result) but it's a second source of truth for connection config — should be unified for maintainability. |
| 🟢 Stale docs, not stale code | `PROJECT_OVERVIEW.md` calls Virtual Home Phases 6/7 (Living World, weather, day/night) "Planned" — the code (`home/avatars.js`, `weather.js`, `sky.js`, `ai_behavior.js`, `event_engine.js`…) shows them fully built. `PROJECT_STRUCTURE.md` describes routes (`heartbeat.js`, `notifications.js`, `sync.js`, `settings.js`, `movies.js`) and folders (`sql/`, `docs/`, `storage/`) that don't exist in this repo at all — it appears to be a template/aspirational doc, not documentation of the actual repo. | Not a functional bug, but anyone (including a future you, or an AI assistant) reading these docs first will build a wrong mental model of the app. Worth regenerating from the real repo. |
| 🟢 `README.md` at repo root is a one-off patch-instructions file | It's not a project README at all — it's instructions for applying a *previous* bandwidth-fix patch ("Everything in here mirrors your project's folder structure..."). | Confusing for anyone opening the repo fresh; should be replaced with an actual project README (this audit's §1–§2 could seed one). |

---

## 7. Security audit

### 7.1 Authorization model — the core issue
The app has **no session tokens**. `coupleId` (and sometimes a bare record `id`) is the *only* credential checked, and it's checked inconsistently:

- **Well-guarded**: `chat.js` (edit/delete verify `sender_role` matches and `couple_id` matches before mutating), `music.js` PATCH/DELETE (`.eq('couple_id', coupleId)` on every mutation).
- **Not guarded (IDOR)**: `globe.js` PUT/DELETE `/:id` and `/media/:mediaId`, `home.js` PUT/DELETE on furniture/memories, `media.js` `DELETE /delete` (accepts an arbitrary `path` + `bucket` string with no ownership check at all). Anyone who obtains a record UUID or a storage path — via a shared screenshot, browser devtools on a synced session, or simple enumeration if IDs are ever sequential anywhere — can edit or delete another couple's data through these endpoints.
- **The state endpoint itself**, `GET/POST /api/data/state/:coupleId`, has no check that the caller is a member of that couple at all — knowledge of the UUID (which the frontend puts in `localStorage`, and which appears in some notification `url` fields) is sufficient for full read/write access to that couple's entire shared state: photos, journal, financial transactions, vault metadata, everything.

This isn't a "someone forgot a line" issue in one place — it's the overall design (coupleId as bearer secret, never re-verified). Fixing it properly means adding a real session layer (signed JWT or opaque token issued at login/pair, required on every route, checked against the resource's `couple_id`) — a genuinely significant engineering task, not a one-line patch, and worth planning deliberately rather than bolting on.

### 7.2 Unauthenticated, unmetered LLM proxy
`POST /api/ai/chat` and `/api/ai/chat/stream` require no `coupleId`, no auth, and (per §6) no rate limiting. If this Render URL is discoverable (it is — it's the public API host), anyone can consume your Groq quota for free indefinitely.

### 7.3 Two parallel auth systems
Connect-code pairing (`/setup`, `/pair`) and email/password (`/register`, `/login`) both create rows in the same `couples` table with overlapping but not identical fields, and nothing in the code appears to reconcile a couple created one way with the other path. Worth deciding whether both are meant to stay long-term or whether one is legacy.

### 7.4 Secrets handling
`.env` is correctly gitignored and not present in the repo. No hardcoded API keys, connection strings, or credentials were found in any committed file. `server.js` correctly uses `process.env.*` throughout for Supabase, Groq, Firebase, VAPID, and Metered TURN credentials.

### 7.5 Other findings
- `helmet()` is applied but `contentSecurityPolicy: false` — reasonable given the inline `<script>`/`<style>` in `index.html`, but means no CSP protection against injected scripts if an XSS were ever introduced elsewhere.
- Chat search (`ilike('text', '%${q}%')`) and most other queries use the Supabase client's parameterized query builder, not raw SQL string concatenation — no SQL-injection vectors were found in any route read.
- No input length/type validation on most POST bodies beyond presence checks (`if (!coupleId) return 400`) — e.g. `state` in `POST /api/data/state` is merged into the DB with no schema validation, so a malformed client payload could corrupt `app_state` shape for a couple.
- CORS allowlist is a fixed array (good — not a wildcard), but note it includes `http://localhost:3000/3001` and `http://127.0.0.1` origins permanently, which is normal for dev but worth confirming those stay harmless in production (they do — CORS only affects browser-enforced requests, not a real attack vector on their own).

---

## 8. Performance audit

- **Static asset caching** is well-tuned: `etag: true, maxAge: '1d'` for everything except `sw.js` (forced no-cache, correct for a service worker). `compression()` (gzip) is applied globally.
- **`app.disable('etag')`** on dynamic JSON responses is a deliberate, documented fix so polling endpoints (`call/signal`, presumably `data/state`) aren't 304-cached by the browser — correct call given the polling architecture, though it does mean those responses are never cache-eligible even when they haven't changed.
- **Polling vs Realtime is inconsistent** across the app (§4.5) — chat, call signaling, and `app_state` are all interval/cursor-polled rather than pushed via Supabase Realtime, which the app clearly has access to (Virtual Home already uses Realtime broadcast). This is a real, fixable bandwidth cost, and matches what your own memory notes as an "underway" migration — the routes confirm it isn't finished yet: `data.js`, `chat.js`, and `call.js` all still expect the client to poll.
- **`index.html` at 9,906 lines** with `<style>` and ~40 `<script src>` tags loaded on first paint is a heavy shell. Nothing in the file is lazy-loaded except the iframes (`loading="lazy"` is used correctly there). A future pass splitting the inline `<style>` block into its own cached file, or code-splitting the biggest inline `<script>` sections, would meaningfully cut first-load bytes.
- **`livemap.js` at 2,458 lines** is by far the largest single script; it's already the subject of this session's redesign work, so no further comment beyond what was covered there.
- **N+1 / chatty patterns found**: `routes/location.js`'s route-point trimming (fire a `select`, then a `delete .in(ids)`) runs on every single `/ping` call — functionally fine (best-effort, non-blocking) but is an extra 1–2 DB round trips per GPS ping that could be batched or moved to a scheduled job instead.
- No obvious render-loop or memory-leak issues were found in the backend (stateless request handlers throughout, except the small in-memory `Map` in `location.js` for route-point deduping, which is intentionally unbounded-but-tiny and resets on redeploy — acceptable).
- Frontend render-loop/GPU-cost analysis for the Three.js Virtual Home (35 files) was **not** performed in this pass — that would need a dedicated deep-dive given its size and is the single most likely place to find real perf issues (particle counts, shadow maps, texture sizes) that this backend-focused pass didn't reach.

---

## 9. UI/UX audit

This session's own work (Live Map redesign) is the most recent UI change and hasn't been visually verified in a browser yet — see the caveat from the previous turn. Beyond that:

- **Design system exists but is fragmented across 6 additive CSS files** (`app-polish.css`, `premium-motion.css`, `premium-states.css`, `responsive-fix.css`, `theme-burgundy.css`, `composer.css`) plus inline `<style>` in `index.html` plus now `livemap-redesign.css`. This additive-patch style is deliberate (matches your stated workflow of never rewriting core files) and it works, but it means there's no single source of truth for color/spacing tokens — `livemap-redesign.css` had to invent its own `--lm2-*` variable namespace rather than reuse existing `--g1`/`--text3`/etc. tokens site-wide, because those tokens aren't consistently available/scoped everywhere.
- **Loading/empty/error states**: present and thoughtful in the parts read — e.g. Live Map's route-POI search shows a "Searching…" message, a specific "no more X ahead" empty state, and a distinct network-failure message (pre-redesign); the redesign this session added skeleton loaders and retry affordances on top of that.
- **Accessibility**: no `aria-*` attributes, `role` attributes, or skip-links were observed in the portions of `index.html` and `livemap.js` read. Touch target sizing (48×48/40×40) was only enforced where this session's new CSS added it — the rest of the app wasn't audited for tap-target size.
- **Responsive design**: `responsive-fix.css` and extensive `@media (max-width:700px)` rules throughout confirm mobile is a first-class target, consistent with this being primarily an Android/Capacitor app.

A full screen-by-screen UI audit (every page, every state) was **not completed** in this pass — it would require rendering each of the 9 standalone HTML apps and every SPA page, which is out of scope for a code-reading pass alone.

---

## 10. Dependency report

| Package | Version | Used? | Notes |
|---|---|---|---|
| express | ^4.19.2 | ✅ | Core server |
| @supabase/supabase-js | ^2.45.0 | ✅ | DB/Storage client |
| bcryptjs | ^2.4.3 | ✅ | Password/PIN hashing |
| cors | ^2.8.5 | ✅ | Origin allowlist |
| helmet | ^8.2.0 | ✅ | Security headers |
| express-rate-limit | ^8.5.2 | ⚠️ Imported, **configured but never applied** | See §6 |
| compression | ^1.8.1 | ✅ | Gzip |
| dotenv | ^16.4.5 | ✅ | Env loading |
| multer | ^1.4.5-lts.1 | ✅ | Upload handling (media.js) |
| node-fetch | ^3.3.2 | ✅ | Used for TURN/Overpass/Groq server-side fetches |
| uuid | ^10.0.0 | ✅ | Couple ID generation |
| web-push | ^3.6.7 | ✅ | Web Push notifications |
| firebase-admin | ^14.1.0 | ✅ | FCM native push |
| @indic-transliteration/sanscript | ^1.3.3 | ✅ (optional/soft) | Lyrics transliteration, wrapped in try/catch |
| @capacitor/* (7 packages) | ^8.x | ✅ | Android native wrapper |
| typescript | ^7.0.2 (dev) | ❌ **Unused** | Zero `.ts` files in the repo — removable |
| nodemon | ^3.1.4 (dev) | ✅ | `npm run dev` |
| @capacitor/assets, @capacitor/cli | (dev) | ✅ | Android build tooling |

No abandoned/unmaintained-looking packages found; versions are all reasonably current as of this app's last update.

---

## 11. Scores

These are judgment calls based on the code actually read in this pass (full backend, full routing, package/config, PWA layer, and representative frontend sampling) — treat them as directional, not lab-measured.

| Category | Score | Why |
|---|---|---|
| Architecture | 7/10 | Sound hybrid SPA+iframe model, clean separation of hot-path tables from the app_state blob, thoughtful notification diffing engine. Loses points for two unreconciled auth systems and undocumented DB schema. |
| UI | — / not scored | Insufficient direct visual coverage this pass to score responsibly (see §9). |
| Performance | 6/10 | Good static-asset caching and compression; polling-heavy realtime strategy is a known, partially-addressed cost; no backend N+1 disasters found. |
| Security | 4/10 | No session/token layer, several IDOR-shaped endpoints, an open unmetered AI proxy, rate limiters built but disconnected. Secrets handling itself is clean. |
| Scalability | 6/10 | Supabase + stateless Express scales fine for a 2-user app by design; the in-memory dedupe Map and full-polling patterns wouldn't scale past this app's actual (intentionally tiny) user base, which is fine given the product. |
| Code quality | 7/10 | Consistently commented, explains *why* not just *what* (the `app.disable('etag')` and merge-not-replace comments are good examples), consistent route file structure. Docs drift and a couple of dead files are the main blemishes. |
| Maintainability | 7/10 | Additive-patch CSS/JS convention is unusual but genuinely coherent once you know the pattern; route-per-feature backend is easy to navigate. |
| Production readiness | 5/10 | Runs today, but the Meet Planner 404 and the auth/IDOR gaps are the kind of thing that should block calling this "done" for anything beyond the two of you using it privately. |

**Overall (backend + architecture, this pass's actual coverage): ~64/100.** I'm not giving a single "Overall App Score /100" that folds in UI/frontend depth I didn't actually verify — that would be a number dressed up as more rigorous than the audit behind it.

---

## 12. Recommended next steps, in the order I'd do them

1. **One-line fix**: mount `routes/meetplanner.js` in `server.js`. Immediately un-breaks a feature that's fully built.
2. **Decide on `routes/signal.js`**: delete it, or actually migrate karaoke invites onto it as originally intended.
3. **Wire up the rate limiters** that already exist — `app.use('/api/auth', authLimiter, authRoutes)` and `app.use('/api/', apiLimiter)` (or per-route) — cheap, high-value.
4. **Add ownership checks** to the IDOR-shaped endpoints (globe/home CRUD, media delete) — pass `coupleId` and filter every mutation by it, the way `chat.js`/`music.js` already do correctly.
5. **Plan (don't rush) a real session layer** — this is the one item here that's genuinely a design decision, not a patch, and worth thinking through deliberately rather than bolting on.
6. **Regenerate `PROJECT_OVERVIEW.md`/`PROJECT_STRUCTURE.md`** from what's actually in the repo (this document's §1–§5 can seed that) and replace the root `README.md` with an actual project readme.
7. When you have a spare pass, a dedicated **Three.js performance audit** of `public/home/*` and a **screen-by-screen UI audit** would close the two gaps this pass couldn't reach.

---

## Auditor's scope note (read this before trusting any verdict above)

This audit **fully read**: `server.js`, `middleware/supabase.js`, all 15 files in `routes/` (every line), `package.json`, `manifest.json`, `sw.js` (first half), all top-level docs (`README.md`, `PROJECT_OVERVIEW.md`, `PROJECT_STRUCTURE.md`, `structure.txt`), and cross-referenced every Supabase table/bucket name and every frontend call to `/api/*` against what's actually mounted in `server.js`.

This audit **sampled, rather than fully read line-by-line**: the ~29,000 lines of frontend JavaScript across `public/` — I read `livemap.js` and `chat/call.js` closely (from this session's earlier redesign work), confirmed the existence, size, and role of every other file, and grep'd for specific patterns (API calls, table names, `require()` graphs) rather than reading e.g. all 35 Virtual Home files or all 9 standalone HTML apps top-to-bottom. The 9 standalone HTML files and the Android/Java native layer were inventoried and spot-checked, not fully read.

Everything reported as **🔴 Broken** or a **security finding** was verified directly against the code (I traced the actual `require`/`app.use` graph rather than trusting file names or comments). Everything reported as a **UI/UX or performance** observation beyond what's stated above should be treated as a starting point for a follow-up pass, not a final verdict — I did not click through a running instance of the app.
