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
const platformMiddleware = require('./middleware/platform');
const { logAppError } = require('./lib/errorLog');


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
  crossOriginEmbedderPolicy: false,
  // Helmet's default ("same-origin") cuts the link between a page and the popup it opens,
  // which breaks the Google sign-in popup. This keeps popups working.
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }
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
  // 300 per minute per IP. Chat polling, heartbeat/presence, the call listener and Live Map together
  // used about 80/min, so the old limit of 60 blocked a normal chat after ~45 s. Two phones on the
  // same Wi-Fi share one IP, so there must be room for both.
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down and try again in a minute.' }
});

// ── CORS ──────────────────────────────────────────────
// Only YOUR sites may call the API from a browser. Add preview deployments with
// ALLOWED_ORIGINS="https://my-preview.vercel.app,https://other.example.com" (comma separated) on Render.
const allowedOrigins = [
  'https://twinhearts.vercel.app',
  'https://useverythingtogether.vercel.app',
  'https://appassets.androidplatform.net',   // the Android app runs the bundled cinema from this private address
  process.env.APP_URL || 'https://us-app-av6d.onrender.com',
  ...String(process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean)
];
app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    try {
      // the Android / local WebView shells run on localhost
      const host = new URL(origin).hostname;
      if (host === 'localhost' || host === '127.0.0.1') return callback(null, true);
    } catch (e) { /* ignore invalid origin */ }
    callback(null, false);
  },
  credentials: true
}));

// Razorpay webhook needs the RAW body to check its signature, so it is mounted
// BEFORE express.json() (which would parse and discard the raw bytes).
app.post('/api/pro/webhook', express.raw({ type: '*/*', limit: '1mb' }), require('./routes/pro').webhook);

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

// ── Rate Limiting ───────────────────────────────────────
app.use('/api/auth', authLimiter);  // 20 attempts per 15 min per IP
app.use('/api/',     apiLimiter);   // 300 calls per minute per IP

// ── Which app is calling (Android native / Android WebView / web) ──
// Sets req.client; also records server 5xx responses on the Health page.
app.use('/api/', platformMiddleware);
app.use('/api/', (req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode >= 500 && !req.path.startsWith('/telemetry') && !req.path.startsWith('/admin')) {
      logAppError(`server:${req.method} ${req.baseUrl}${req.path}`.slice(0, 120), `HTTP ${res.statusCode}`,
        res.statusCode === 503 ? 'warning' : 'critical',
        { platform: req.client.platform, appVersion: req.client.version, kind: req.client.kind });
    }
  });
  next();
});

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
app.use('/api/chat', require('./routes/chat'));
app.use('/api/call', require('./routes/call'));
app.use('/api/cinema', require('./routes/cinema'));   // Twin Cinema movie-night invites
app.use('/api/music', require('./routes/music'));
app.use('/api/pro', require('./routes/pro'));
app.use('/api/rewards/cards', require('./routes/rewards-cards'));   // scratch cards won from couple games
app.use('/api/rewards', require('./routes/rewards'));   // Twin Rewards (wallet, check-in, streaks)
app.use('/api/movie-search', require('./routes/movie-search'));
app.use('/api/movie-fav', require('./routes/movie-favorites'));

// ── Admin Control Center ────────────────────────────────
app.use('/api/recordings', require('./routes/recordings'));
app.use('/api/highlights', require('./routes/highlights'));
app.use('/api/lyrics', require('./routes/lyrics'));
app.use('/api/search', require('./routes/search'));
app.use('/api/presence', require('./routes/presence'));
app.use('/api/movie', require('./routes/routes-movie'));
app.use('/api/movie-library', require('./routes/movie-library'));
app.use('/api/meetplanner', require('./routes/meetplanner'));
app.use('/api/daily-routine', require('./routes/daily-routine'));
app.use('/api/support', require('./routes/support'));
app.use('/api/telemetry', require('./routes/telemetry'));

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
app.use('/api/admin/support', require('./routes/admin-support'));
app.use('/api/admin/payments', require('./routes/admin-payments'));
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
  logAppError('server:unhandled', err.message, 'critical',
    { platform: req.client && req.client.platform, appVersion: req.client && req.client.version });
  res.status(500).json({ error: 'Internal server error' });
});
// ── Start ──────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n💕 Twin Hearts server running!`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Health:  http://localhost:${PORT}/api/health`);
  console.log(`   Press Ctrl+C to stop\n`);
});