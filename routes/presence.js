const express = require('express');
const router = express.Router();

// ── In-memory "who's looking at what" tracker ────────────────────────
// Keyed by `${coupleId}:${role}` (not a real user_id — this app already
// keys push_subscriptions/fcm_tokens the same way, so this stays
// consistent with the rest of the codebase and needs no schema change).
//
// This is intentionally in-memory, not a DB table: presence is
// inherently short-lived (a client is only "viewing chat" for as long
// as its heartbeat keeps landing), and hitting Supabase on every
// message send just to read a value that's stale the instant someone
// navigates away would add latency for no benefit. The tradeoff: this
// resets on every server restart/deploy (fine — clients re-report
// within seconds of the page being visible) and would need moving to
// something shared (Redis, a Supabase table) if this app ever runs
// more than one server instance behind a load balancer.
const activeView = new Map();
const STALE_MS = 25000; // heartbeat interval on the client is 15s (see index.html); 25s gives one missed beat of slack before treating someone as "left"

router.post('/view', (req, res) => {
  const { coupleId, role, page } = req.body;
  if (!coupleId || !role) return res.status(400).json({ error: 'Missing coupleId/role' });
  const key = coupleId + ':' + role;
  if (!page) {
    // Explicit "I left" signal (tab hidden / navigated away / app backgrounded) —
    // remove immediately rather than waiting for the entry to go stale,
    // so a push fires right away instead of up to STALE_MS late.
    activeView.delete(key);
  } else {
    activeView.set(key, { page, updatedAt: Date.now() });
  }
  res.json({ ok: true });
});

// Used by routes/chat.js before sending a push: true only if that
// partner's most recent heartbeat says they're on the chat page AND it
// arrived recently enough to still be trusted.
function isViewingChat(coupleId, role) {
  const entry = activeView.get(coupleId + ':' + role);
  if (!entry) return false;
  if (Date.now() - entry.updatedAt > STALE_MS) return false;
  return entry.page === 'chat';
}

module.exports = router;
module.exports.isViewingChat = isViewingChat;
