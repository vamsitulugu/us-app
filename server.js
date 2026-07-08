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
  'https://useverythingtogether.vercel.app',
  process.env.APP_URL || 'https://us-app-api.onrender.com',
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
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ─────────────────────────────────────────
app.use('/api/auth',  authRoutes);
app.use('/api/data',  dataRoutes);
app.use('/api/ai',    aiRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/data', require('./routes/data'));
app.use('/api/location', require('./routes/location'));
app.use('/api/globe', require('./routes/globe'));
app.use('/api/home', require('./routes/home'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/call', require('./routes/call'));
app.use('/api/music', require('./routes/music'));
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
  console.log(`\n💕 Us With Love server running!`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Health:  http://localhost:${PORT}/api/health`);
  console.log(`   Press Ctrl+C to stop\n`);
});