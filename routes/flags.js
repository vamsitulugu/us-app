// ═══════════════════════════════════════════════════════════════
//  Public feature-flags read endpoint
//  ─────────────────────────────────────────────────────────────
//  No admin auth — this is what the app itself calls to know which
//  features are on for the current user. Read-only against
//  feature_flags; writes only ever happen through admin-flags.js.
//
//  Percentage rollout is DETERMINISTIC per (userId, flagKey): the same
//  user always lands on the same side of the rollout percentage rather
//  than being randomly reassigned on every request/launch, per spec.
//  Achieved with a stable hash (SHA-256 of `${flagKey}:${userId}`,
//  first 4 bytes as a uint32) mod 100 — no randomness, no state to store.
// ═══════════════════════════════════════════════════════════════
const express = require('express');
const crypto = require('crypto');
const supabase = require('../middleware/supabase');

const router = express.Router();

function stableBucket(flagKey, userId) {
  const hash = crypto.createHash('sha256').update(`${flagKey}:${userId}`).digest();
  const n = hash.readUInt32BE(0);
  return n % 100; // 0-99
}

function resolveFlag(flag, userId) {
  if (!flag.enabled) return false; // master switch always wins
  switch (flag.rollout_type) {
    case 'everyone':
      return true;
    case 'test_users': {
      const ids = (flag.rollout_value && flag.rollout_value.userIds) || [];
      return !!userId && ids.includes(userId);
    }
    case 'percentage': {
      if (!userId) return false; // no stable identity to bucket -> withheld, not granted
      const pct = Math.max(0, Math.min(100, Number((flag.rollout_value && flag.rollout_value.percentage) || 0)));
      return stableBucket(flag.key, userId) < pct;
    }
    default:
      return false;
  }
}

// ── GET /api/flags?userId=... ───────────────────────────────────
// Returns { flags: { flagKey: boolean, ... } } — a flat map, cheap
// for the client to cache and consult without re-fetching on every
// page (client-side caching is the frontend's responsibility; this
// endpoint just needs to be cheap enough to call once per session).
router.get('/', async (req, res) => {
  try {
    const userId = (req.query.userId || '').trim() || null;
    const { data, error } = await supabase.from('feature_flags').select('key, enabled, rollout_type, rollout_value');
    if (error) throw error;

    const flags = {};
    for (const f of data || []) {
      flags[f.key] = resolveFlag(f, userId);
    }
    res.json({ flags });
  } catch (e) {
    console.error('[flags] resolve failed:', e.message);
    // Fail safe: every flag defaults to off rather than the request
    // failing outright — a flags-service outage should degrade to
    // "baseline app behavior", never crash the app or leak an
    // experimental feature to everyone.
    res.status(200).json({ flags: {}, degraded: true });
  }
});

module.exports = router;
