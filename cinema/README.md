# Door fix (twin-cinemas) — copy over the repo, same paths
- src/hall.js : push bar on the hall face of the door, doorDir() helper
- src/main.js : simple enter walk, exit starts when you walk up to the door, same door pushes open into the lobby
(main.js also contains the earlier sync changes you already applied, so it is safe to overwrite.)
Then run:  npm run build   (refreshes dist/)
