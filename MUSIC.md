# Music page (v2)

The Music page (`public/music.html`) is loaded in an iframe by `index.html`.
It has two root tabs — **Music · My Recordings** — and pushes
everything else (library, playlists, search, karaoke, settings) as native-style
screens with a back arrow.

## One-time setup

Run `migrations/music_v2.sql` once in the Supabase SQL editor. It is additive and
idempotent. Until it is applied the app still works: likes fall back to the old
shared `songs.favorite` flag, and playlists show a
"needs a database update" notice instead of failing.

## Front-end (`public/music/`)

| File | Responsibility |
|---|---|
| `core.js` | event bus, icons, API client, settings, back/overlay stack, sheets & dialogs, screen navigation, data store (songs · playlists · movies · recordings), realtime |
| `player.js` | `AudioService` (queue, shuffle/repeat, crossfade, offline source, media-session, sleep timer, resume) · Web Audio sound chain (lazy) · `MX.offline` downloads |
| `library.js` | home, library lists, recently played, playlists, smart mixes, search, song menu / details / edit, add-songs entry |
| `nowplaying.js` | mini player, full player, queue, lyrics engine + lyrics screen |
| `karaoke.js` | karaoke list, Sing screen (record a take), sound-effects sheet |
| `recordings.js` | recordings tab, audio/video recorder, shared `saveBlob` upload |
| `settings.js` | settings screen (only settings that do something) |
| `app.js` | home shell, boot, `closeTopOverlayIfOpen()`, theme messages |
| `music.css` | design system + every screen (follows the app theme's `--accent*`) |

Services that keep their own logic and are loaded by `music.html`:
`couple-karaoke.js` (video-call karaoke), `lyrics-*.js`, `metadata-*.js`,
`artwork-service.js`, `cache-service.js`, `import-service.js`.
They talk to the page through `window.AudioService`, `window.Store` and
`window.MusicPlayer` (defined in `core.js` / `player.js` for compatibility).

### Parent-app contract
* `window.closeTopOverlayIfOpen()` → closes sheet → lyrics/player → pushed screen → returns to Music tab → `false` at root.
* `postMessage({type:'theme', vars})` from the parent sets CSS variables (only from `window.parent`).
* `postMessage({type:'ckJoinAsGuest'})` is handled by `couple-karaoke.js`.

## Back-end

| Route file | Mount | Notes |
|---|---|---|
| `routes/music.js` | `/api/music` | songs, per-partner likes/plays, playlists. List hides the partner's private songs and omits lyric bodies (`?full=1` / `GET /song/:id` for them). Only the uploader can edit metadata or delete; delete also removes storage files and dependent rows. |
| `routes/recordings.js` | `/api/recordings` | `kind` (`voice`/`karaoke`) + `song_id`; owner-only rename; `DELETE /:coupleId/mine` bulk delete |
| `routes/media.js` | `/api/media` | audio uploads are restricted to real audio formats and stored with an audio content-type |
| `lib/storage.js` | — | derives/validates storage paths from public URLs |

## Tests

`npm run test:music` runs the API tests against an in-memory fake of the Supabase
client (`tests/support/`), so no database or network is needed.

Movies are no longer part of the Music page — they live on the Movie page (`/api/movie-library`).
