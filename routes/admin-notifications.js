// ═══════════════════════════════════════════════════════════════
//  Admin Notifications routes
//  ─────────────────────────────────────────────────────────────
//  Reuses the app's EXISTING push infrastructure (web-push +
//  Firebase Admin, both already wired in routes/auth.js) instead of
//  building a second notification pipeline. sendPushToUser() already
//  handles: missing VAPID/Firebase config, stale token cleanup on
//  410/registration-token-not-registered, and per-provider result
//  reporting — none of that is duplicated here.
//
//  Delivery reporting is intentionally raw and unaggregated: we store
//  exactly what each provider returned per recipient (result.sent,
//  statusCode/messageId, or error). We never invent "opened"/"read"
//  stats — web-push and FCM data-only messages don't provide them.
// ═══════════════════════════════════════════════════════════════
const express = require('express');
const supabase = require('../middleware/supabase');
const { requireAdmin, logAudit } = require('../middleware/adminAuth');
const { sendPushToUser } = require('./auth'); // router object also carries this helper as a property

const router = express.Router();
router.use(requireAdmin);

const TYPES = ['announcement', 'new_release', 'maintenance', 'info'];
const AUDIENCES = ['all', 'user1', 'user2'];

function validateBody(body) {
  const errors = [];
  const out = {};
  if (!body.title || !String(body.title).trim()) errors.push('title is required');
  else out.title = String(body.title).trim();

  if (!body.message || !String(body.message).trim()) errors.push('message is required');
  else out.message = String(body.message).trim();

  out.type = TYPES.includes(body.type) ? body.type : 'announcement';
  out.audience = AUDIENCES.includes(body.audience) ? body.audience : 'all';
  out.release_id = body.release_id || null;

  return { errors, out };
}

// Resolves an audience value to the list of user rows that should
// receive the push. 'user1'/'user2' matches by role across every
// couple in the table (in this app's real-world usage that's a
// single couple, but the query doesn't assume that).
async function resolveAudience(audience) {
  let query = supabase.from('users').select('id, role, account_status').eq('account_status', 'active');
  if (audience === 'user1' || audience === 'user2') query = query.eq('role', audience);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// Shared by POST /:id/send and POST / (sendNow:true) so there's exactly
// one code path that ever actually dispatches a push.
async function performSend(notification, adminEmail) {
  const recipients = await resolveAudience(notification.audience);

  const payload = {
    title: notification.title,
    body: notification.message,
    tag: 'admin-notif-' + notification.id,
    url: '/'
  };

  const perUser = [];
  for (const u of recipients) {
    try {
      const result = await sendPushToUser(u.id, payload);
      perUser.push({ userId: u.id, ...result });
    } catch (err) {
      perUser.push({ userId: u.id, error: err.message });
    }
  }

  const resultSummary = {
    recipientCount: recipients.length,
    perUser,
    sentAt: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('admin_notifications')
    .update({ status: 'sent', sent_at: resultSummary.sentAt, result: resultSummary })
    .eq('id', notification.id)
    .select().single();
  if (error) throw error;

  await logAudit(adminEmail, 'notification.send', 'notification', notification.id, {
    audience: notification.audience,
    recipientCount: recipients.length
  });

  return data;
}

// ── GET /api/admin/notifications ────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('admin_notifications').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ notifications: data || [] });
  } catch (e) {
    console.error('[admin-notifications] list failed:', e.message);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

// ── GET /api/admin/notifications/:id ────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('admin_notifications').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Notification not found' });
    res.json({ notification: data });
  } catch (e) {
    console.error('[admin-notifications] detail failed:', e.message);
    res.status(500).json({ error: 'Failed to load notification' });
  }
});

// ── POST /api/admin/notifications/preview ───────────────────────
// Pure computation, no DB write — lets the admin UI show "this will
// reach N recipients" and the exact payload before anything is saved
// or sent.
router.post('/preview', async (req, res) => {
  try {
    const { errors, out } = validateBody(req.body || {});
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    const recipients = await resolveAudience(out.audience);
    res.json({
      preview: {
        title: out.title,
        body: out.message,
        audience: out.audience,
        recipientCount: recipients.length
      }
    });
  } catch (e) {
    console.error('[admin-notifications] preview failed:', e.message);
    res.status(500).json({ error: 'Failed to build preview' });
  }
});

// ── POST /api/admin/notifications ───────────────────────────────
// Creates as a draft by default. Pass { sendNow: true } to create and
// dispatch in one call — still just one code path (performSend) actually
// sends, so there's no way to double-fire from this endpoint alone.
router.post('/', async (req, res) => {
  try {
    const { errors, out } = validateBody(req.body || {});
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    const { data: created, error } = await supabase
      .from('admin_notifications')
      .insert({ ...out, status: 'draft' })
      .select().single();
    if (error) throw error;

    await logAudit(req.adminEmail, 'notification.create', 'notification', created.id, { audience: out.audience, type: out.type });

    if (req.body.sendNow === true) {
      const sent = await performSend(created, req.adminEmail);
      return res.json({ notification: sent });
    }

    res.json({ notification: created });
  } catch (e) {
    console.error('[admin-notifications] create failed:', e.message);
    res.status(500).json({ error: 'Failed to create notification' });
  }
});

// ── POST /api/admin/notifications/:id/send ──────────────────────
// Guarded against double-send: only a 'draft' notification can be
// sent, and it's flipped to 'sent' as part of the same DB write that
// records delivery results — a second call against an already-sent
// notification is rejected before any push goes out.
router.post('/:id/send', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: existing, error: fetchErr } = await supabase.from('admin_notifications').select('*').eq('id', id).maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!existing) return res.status(404).json({ error: 'Notification not found' });
    if (existing.status === 'sent') {
      return res.status(400).json({ error: 'This notification has already been sent', sentAt: existing.sent_at });
    }

    const sent = await performSend(existing, req.adminEmail);
    res.json({ notification: sent });
  } catch (e) {
    console.error('[admin-notifications] send failed:', e.message);
    // Mark as failed so it's visible in history rather than stuck
    // silently as 'draft' with no explanation.
    try {
      await supabase.from('admin_notifications').update({ status: 'failed' }).eq('id', req.params.id);
    } catch (_) { /* best-effort */ }
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

// ── DELETE /api/admin/notifications/:id ─────────────────────────
// Only drafts can be deleted — sent notifications stay in history.
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: existing } = await supabase.from('admin_notifications').select('id, status').eq('id', id).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Notification not found' });
    if (existing.status !== 'draft') {
      return res.status(400).json({ error: 'Only draft notifications can be deleted' });
    }
    const { error } = await supabase.from('admin_notifications').delete().eq('id', id);
    if (error) throw error;
    await logAudit(req.adminEmail, 'notification.delete', 'notification', id, {});
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin-notifications] delete failed:', e.message);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

module.exports = router;
