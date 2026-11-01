// ═══════════════════════════════════════════════════════════════
//  POST /api/telemetry/ping   { }                         → counts the user as active today
//  POST /api/telemetry/error  { source, message, stack? } → shows on Admin → Health
//  The user is identified by the x-user-id header (same as the rest of the app).
// ═══════════════════════════════════════════════════════════════
const express = require('express');
const rateLimit = require('express-rate-limit');
const supabase = require('../middleware/supabase');
const { recordActivity, scrub } = require('../lib/telemetry');
const { logAppError } = require('../lib/errorLog');

const router = express.Router();
const limiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many reports.' } });
router.use(limiter);

async function validUserId(req) {
  const id = req.get('x-user-id') || (req.body && req.body.userId);
  if (!id) return null;
  const { data } = await supabase.from('users').select('id').eq('id', String(id)).maybeSingle();
  return data ? data.id : null;
}

router.post('/ping', async (req, res) => {
  try {
    const uid = await validUserId(req);
    if (uid) await recordActivity(uid, req.client);
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false }); }
});

router.post('/error', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.message) return res.status(400).json({ error: 'message required' });
    const uid = await validUserId(req); // optional: crashes before login are still useful
    await logAppError(
      `client:${String(b.source || 'app').slice(0, 60)}`,
      b.message,
      b.fatal ? 'critical' : 'warning',
      { platform: req.client.platform, appVersion: req.client.version, kind: req.client.kind,
        stack: b.stack ? scrub(b.stack, 1200) : undefined, hasUser: !!uid }
    );
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false }); }
});

module.exports = router;
