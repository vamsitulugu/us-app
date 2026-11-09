# Session fix: (1) no second "choose movie file", (2) hall door transparent + brown wall removed
Copy over each repo, same paths.

twin-cinemas/src/main.js    files that come from Twin Hearts (web handshake / Android stream / app's "next movie") are trusted: never dropped for a
                            length mismatch, never asked for again; "ready" no longer needs the two copies to match to the second
twin-cinemas/src/invite.js  Android: shows "Loading your movie…" (not the choose-file prompt) while the app's movie loads
twin-cinemas/src/hall.js    hall back wall now has a real doorway (it was a solid brown wall behind the door) -> door glass + open door show the lobby
twin-cinemas/src/lobby.js   while you are in the hall the two lobby lights nearest the door stay on (dimmed) so the lobby is visible through the door
twin-cinemas/dist/          rebuilt (delete old dist/assets/index-CxBGKvkf.js; new one is index-Bw7dORGy.js) — or just run: npm run build
us-app/public/cinema-invite.js  web: if the caller passes no file, the file picked on Watch Together is still used (was: null = "nofile")
us-app/public/sw.js         cache v78 so browsers pick up the new cinema-invite.js
Android app: no change needed.
