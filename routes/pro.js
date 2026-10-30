// ════════════════════════════════════════════════════════════════
//  routes/pro.js — compatibility shim (Pro has been removed)
//
//  Every feature is now free for everyone, so there is no payment flow,
//  no upgrade requests and no admin approval any more.
//
//  This one endpoint is kept ONLY so older Twin Hearts Android builds that
//  are already installed (they still ask "is this couple Pro?" before opening
//  AI Both Mode and Memory Globe "Pin a Memory") keep working instead of
//  being locked out. It always answers "Pro".
//
//  Safe to delete this file and its `app.use('/api/pro', ...)` line in
//  server.js once every installed Android build has been updated.
// ════════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();

// GET /api/pro/status?coupleId=  →  always unlocked
router.get('/status', (req, res) => {
  res.json({ isPro: true, plan: 'lifetime', expiresAt: null });
});

module.exports = router;
