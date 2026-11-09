// ═══════════════════════════════════════════════════════════════
//  Cron endpoint for scheduled / repeating admin pushes
//  ─────────────────────────────────────────────────────────────
//  server.js already checks for due pushes every minute while the server is awake.
//  On a free Render plan the server SLEEPS when nobody uses it, so a timer inside it
//  cannot be trusted alone. Point any free cron service (or the GitHub workflow in
//  .github/workflows/push-scheduler.yml) at this endpoint every 5 minutes:
//
//     POST https://<your-server>/api/cron/notifications
//     header  x-cron-secret: <CRON_SECRET>
//
//  CRON_SECRET must be set on the server; without it this endpoint stays off (503).
//  Calling it is harmless to repeat: every due push is claimed once, atomically.
// ═══════════════════════════════════════════════════════════════
const express = require('express');
const crypto = require('crypto');
const { runDueNotifications } = require('./admin-notifications');

const router = express.Router();

function secretOk(given) {
  const want = process.env.CRON_SECRET;
  if (!want || !given) return false;
  const a = Buffer.from(String(given)), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.all('/notifications', async (req, res) => {
  if (!process.env.CRON_SECRET) return res.status(503).json({ error: 'CRON_SECRET is not set on the server' });
  if (!secretOk(req.get('x-cron-secret'))) return res.status(401).json({ error: 'Bad secret' });
  try {
    const ran = await runDueNotifications();
    res.json({ ok: true, ran });
  } catch (e) {
    console.error('[cron] notifications failed:', e.message);
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
