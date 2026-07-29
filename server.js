require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const authRoutes  = require('./routes/auth');
// New phone-number based auth (Phase 1 of Couple-Code migration).
// Mounted separately from the legacy `authRoutes` above so existing
// couple-code signup/login/pairing keeps working untouched until the
// frontend cutover (Phase 3) and cleanup (Phase 4).
const authPhoneRoutes = require('./routes/auth-phone');
// Email-based auth — alternate login + password recovery method,
// same `users` table/JWT as phone auth (see routes/auth-email.js).
const authEmailRoutes = require('./routes/auth-email');
const dataRoutes  = require('./routes/data');
const aiRoutes    = require('./routes/ai');
const mediaRoutes = require('./routes/media');
const globeRoutes = require('./routes/globe');
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');
const compression = require('compression');


const app  = express();
const PORT = process.env.PORT || 3000;

// The app runs behind a single reverse-proxy hop on Render (and Vercel for
// the frontend) — without this, express-rate-limit either can't determine
// the real client IP (bucketing everyone together) or throws a validation
// error on the X-Forwarded-For header it receives. `1` trusts exactly one
// hop, which matches Render's setup.
app.set('trust proxy', 1);

// Express auto-generates ETags on JSON responses, which makes browsers
// 304-cache polling endpoints (like /api/call/signal) and reuse the FIRST
// response forever, even after the underlying data changes. Disable it.
app.disable('etag');

// ── Security headers ───────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // disabled because inline scripts in index.html
  crossOriginEmbedderPolicy: false
}));

// ── Gzip compression (faster loading) ─────────────────
app.use(compression());

// ── Rate limiting ──────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // max 20 auth attempts per 15 min per IP
  message: { error: 'Too many requests. Please wait 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});
// NOTE on the cap: the app itself is poll-heavy by design (app_state sync,
// chat presence/messages, call signaling, live location — several of these
// poll every 3-5s each, per device). A strict 60/min would throttle real
// usage during an active call or chat session, so this is set well above
// legitimate combined traffic from two devices and is only meant to stop
// scripted abuse/DoS, not to meter normal polling.
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 300,
  standardHeaders: true,
  legacyHeaders: false
});
// The AI Love Guide proxies every request straight to the Groq API using
// our own server-side key — with no coupleId/auth check on the route
// itself (see routes/ai.js), the only thing standing between this route
// and someone else quietly burning our Groq quota is a request-rate cap.
const aiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 15, // generous for two real people chatting, tight for a script
  message: { error: 'Too many AI requests. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false
});

// ── CORS ──────────────────────────────────────────────
const allowedOrigins = [
  'https://twinhearts.vercel.app',
  process.env.APP_URL || 'https://us-app-av6d.onrender.com',
  // The Android APK (Capacitor, androidScheme:'https') serves its bundled
  // web assets from this origin — without it, every fetch() call made
  // from inside the app would be blocked by CORS.
  'https://localhost',
  'capacitor://localhost',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001'
];
app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Static files ───────────────────────────────────────
// NOTE: express.static's own `etag`/`maxAge` options are independent of
// app.disable('etag') above (which only turns off auto-ETag on dynamic
// res.json()/res.send() responses from routes/*.js — that stays exactly
// as-is so the call/chat/presence polling endpoints keep behaving the
// way they were already fixed to behave). Static files get their own
// explicit etag + a short max-age, so a repeat visit within a day can
// skip re-downloading unchanged JS/CSS/images entirely, and after that
// the etag still forces a fresh copy the moment a file actually changes
// — nothing here can ever serve genuinely stale content.
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    // The service worker script controls PWA update rollout itself
    // (see sw.js's own versioned CACHE + skipWaiting/clients.claim
    // logic) — it must always be revalidated so a new deploy is picked
    // up immediately instead of waiting out a cache window.
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// ── API Routes ─────────────────────────────────────────
// Rate limiters were previously defined above but never actually attached
// to any route, leaving every endpoint — including login/register and the
// unauthenticated Groq-backed AI proxy — with zero request-rate protection.
// `apiLimiter` is applied globally first as a general-purpose ceiling, and
// the more targeted `authLimiter`/`aiLimiter` then apply their tighter caps
// on top of it for the routes that need them most.
app.use('/api/', apiLimiter);
app.use('/api/auth',  authLimiter, authRoutes);
app.use('/api/auth-phone', authLimiter, authPhoneRoutes);
app.use('/api/auth-email', authLimiter, authEmailRoutes);
app.use('/api/data',  dataRoutes);
app.use('/api/ai',    aiLimiter, aiRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/location', require('./routes/location'));
app.use('/api/route', require('./routes/route'));
app.use('/api/tracking', require('./routes/tracking'));
app.use('/api/globe', require('./routes/globe'));
app.use('/api/home', require('./routes/home'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/call', require('./routes/call'));
app.use('/api/music', require('./routes/music'));
app.use('/api/lyrics', require('./routes/lyrics'));
app.use('/api/search', require('./routes/search'));
// This route file already existed, fully implemented, but was never
// mounted — every Meet Planner action in the app has been hitting a 404
// in production. This restores the feature; it changes no code in the
// route file itself.
app.use('/api/meetplanner', require('./routes/meetplanner'));
// ── Health check ───────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Catch-all → serve frontend ─────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
// ── Global error handler ───────────────────────────────
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});
// ── Start ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n💕 Twin Hearts server running!`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Health:  http://localhost:${PORT}/api/health`);
  console.log(`   Press Ctrl+C to stop\n`);
});