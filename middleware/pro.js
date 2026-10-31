// ════════════════════════════════════════════════════════════════
//  middleware/pro.js — Pro lookups + server-side feature gate
//  The apps hide Pro features for free couples, but the server is what
//  really enforces it: requirePro() answers 402 when the couple is not Pro.
// ════════════════════════════════════════════════════════════════
const supabase = require('./supabase');
const { statusFromCouple } = require('../lib/pro-plans');

/** { isPro, plan, expiresAt } for a couple. Throws on a database error. */
async function getProStatus(coupleId) {
  const { data, error } = await supabase
    .from('couples').select('id, pro_plan, pro_expires_at').eq('id', coupleId).maybeSingle();
  if (error) throw error;
  return statusFromCouple(data);
}

/**
 * Express middleware. `pick(req)` returns the coupleId for this request.
 * Missing coupleId → 400. Not Pro → 402 { code: 'PRO_REQUIRED' }.
 * If Pro cannot be checked (database down) → 503, so a free couple is
 * never let through by accident and a Pro couple just retries.
 */
function requirePro(pick) {
  return async (req, res, next) => {
    try {
      const coupleId = pick(req);
      if (!coupleId) return res.status(400).json({ error: 'coupleId required' });
      const st = await getProStatus(coupleId);
      if (!st.isPro) {
        return res.status(402).json({ error: 'This is a Pro feature.', code: 'PRO_REQUIRED' });
      }
      next();
    } catch (e) {
      console.error('[pro] gate check failed:', e.message);
      res.status(503).json({ error: 'Could not verify Pro right now. Please try again.' });
    }
  };
}

/** The signed-in user (x-user-id header, or userId in body/query) must belong to this couple. */
async function loadMember(req, coupleId) {
  const userId = req.get('x-user-id') || (req.body && req.body.userId) || (req.query && req.query.userId);
  if (!userId || !coupleId) return null;
  const { data: user, error } = await supabase
    .from('users').select('id, name, phone_number, couple_id, account_status').eq('id', userId).maybeSingle();
  if (error || !user) return null;
  if (user.account_status === 'suspended' || user.account_status === 'disabled') return null;
  if (!user.couple_id || String(user.couple_id) !== String(coupleId)) return null;
  return user;
}

module.exports = { getProStatus, requirePro, loadMember };
