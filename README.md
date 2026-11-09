# Twin Hearts (us-app)

- **Web app**: `public/` — deployed on Vercel (twinhearts.vercel.app). `/api/*` goes to the backend.
- **Backend**: `server.js`, `routes/`, `lib/`, `migrations/` — deployed on Render.
- **Twin Cinema (3D theatre)**: source in `cinema/`, built copy in `public/cinema/` (served at `/cinema/`).
  After changing `cinema/`: `npm run build:cinema`, then commit `public/cinema`. Setup notes: `CINEMA_SETUP.md`.
- **Tests**: `npm run test:cinema`, `npm run test:canteen`, `npm run test:movie-sync`, `npm run test:music`, `npm run test:pro`.
- Android app: separate repo `twin-hearts-android`.
