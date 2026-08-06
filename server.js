require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const authRoutes  = require('./routes/auth');
const dataRoutes  = require('./routes/data');
const aiRoutes    = require('./routes/ai');
const mediaRoutes = require('./routes/media');
const globeRoutes = require('./routes/globe');
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');
const compression = require('compression');


const app  = express();
const PORT = process.env.PORT || 3000;

// ── Trust proxy ─────────────────────────────────────────
// Render puts every request behind exactly one reverse proxy, which sets
// X-Forwarded-For. Express's default ('trust proxy' = false) makes
// express-rate-limit refuse to trust that header (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR)
// and, more importantly, means req.ip would resolve to Render's internal
// proxy IP instead of the real client IP, breaking IP-based rate limiting.
// Use the numeric hop count (1) rather than `true`: `true` trusts every
// hop in the chain (spoofable by a client sending its own X-Forwarded-For),
// while `1` trusts only the single hop Render actually adds.
// This must be set before any express-rate-limit middleware is registered,
// on this app instance and any router mounted on it (admin-auth.js's
// rate limiter included, since it shares this same app/router chain).
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
  message: { error: 'Too many requests. Please wait 15 minutes.' }
});
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60 // 60 API calls per minute
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
app.use('/api/auth',  authRoutes);
app.use('/api/data',  dataRoutes);
app.use('/api/partner', require('./routes/partner'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/ai',    aiRoutes);
app.use('/api/ai-both', require('./routes/ai-both'));
app.use('/api/media', mediaRoutes);
app.use('/api/location', require('./routes/location'));
app.use('/api/route', require('./routes/route'));
app.use('/api/tracking', require('./routes/tracking'));
app.use('/api/globe', require('./routes/globe'));
app.use('/api/home', require('./routes/home'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/call', require('./routes/call'));
app.use('/api/music', require('./routes/music'));
app.use('/api/recordings', require('./routes/recordings'));
app.use('/api/lyrics', require('./routes/lyrics'));
app.use('/api/search', require('./routes/search'));
app.use('/api/presence', require('./routes/presence'));
app.use('/api/movie', require('./routes/routes-movie'));
app.use('/api/meetplanner', require('./routes/meetplanner'));

// ── Public release/flag endpoints (no auth — called by the app itself) ─
app.use('/api/releases', require('./routes/releases'));
app.use('/api/flags', require('./routes/flags'));

// ── Admin Control Center ────────────────────────────────
// Deliberately separate from everything above: its own auth routes,
// its own admin-only API routes (every one gated by requireAdmin
// inside the route file itself — never trust this mount point alone),
// and its own static frontend served from ./admin (a sibling of
// ./public, NOT inside it) so it is never bundled into the Vercel
// static site, never picked up by the PWA service worker's caching,
// and never linked from anywhere in the normal app. It only exists
// at this Render origin, same-origin with its own API, which is also
// required for the SameSite=Strict admin session cookie to work.
app.use('/api/admin/auth', require('./routes/admin-auth'));
app.use('/api/admin/overview', require('./routes/admin-overview'));
app.use('/api/admin/users', require('./routes/admin-users'));
app.use('/api/admin/couples', require('./routes/admin-couples'));
app.use('/api/admin/releases', require('./routes/admin-releases'));
app.use('/api/admin/notifications', require('./routes/admin-notifications'));
app.use('/api/admin/flags', require('./routes/admin-flags'));
app.use('/api/admin/health', require('./routes/admin-health'));
app.use('/admin', express.static(path.join(__dirname, 'admin'), {
  etag: true,
  lastModified: true,
  // Always revalidate — this is a low-traffic internal tool, not the
  // main app, so there's no reason to trade freshness for caching here.
  maxAge: 0
}));

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