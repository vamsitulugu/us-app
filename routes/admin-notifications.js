// ═══════════════════════════════════════════════════════════════
//  Admin Notifications routes
//  ─────────────────────────────────────────────────────────────
//  Reuses the app's EXISTING push infrastructure (web-push +
//  Firebase Admin, both wired in routes/auth.js) via sendPushToUser().
//
//  Features
//   • Optional picture (uploaded here, stored in the public
//     `couple-photos` bucket, sent as `image` in the push).
//   • Send now, save as draft, or SCHEDULE.
//   • Repeat every N hours (adjustable, e.g. 4 or 5) until a date.
//     A repeating campaign can be edited, paused, resumed or stopped.
//
//  Scheduling model: a row with status 'scheduled' has `next_run_at`.
//  runDueNotifications() (called every minute by server.js AND by the
//  external cron endpoint /api/cron/notifications) finds due rows,
//  CLAIMS each one with a conditional update (so two callers can never
//  send the same run twice) and then dispatches it.
//
//  Delivery reporting is raw: what each provider returned per user.
//  We never invent "opened"/"read" stats.
// ═══════════════════════════════════════════════════════════════
const express = require('express');
const crypto = require('crypto');
const supabase = require('../middleware/supabase');
const { requireAdmin, logAudit } = require('../middleware/adminAuth');
const { sendPushToUser } = require('./auth'); // router object also carries this helper as a property

const router = express.Router();

const TYPES = ['announcement', 'new_release', 'maintenance', 'info'];
const AUDIENCES = ['all', 'user1', 'user2', 'android', 'web'];  // android / web = the app each person last used
const IMAGE_BUCKET = 'couple-photos';           // existing public bucket (routes/media.js)
const IMAGE_PREFIX = 'admin-notifications';
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MIN_REPEAT_HOURS = 0.5;
const MAX_REPEAT_HOURS = 24 * 14;
const HOUR = 60 * 60 * 1000;

// ── helpers ─────────────────────────────────────────────────────
function parseDate(v) {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;   // undefined = invalid
}

function isHttpUrl(u) {
  try { const p = new URL(u); return p.protocol === 'https:' || p.protocol === 'http:'; } catch (_) { return false; }
}

// Validates the composer body. `mode` is 'draft' | 'now' | 'schedule' (default draft).
// Returns { errors, out } where `out` holds only DB columns.
function validateBody(body, { partial = false } = {}) {
  const errors = [];
  const out = {};
  const has = (k) => body[k] !== undefined;

  if (!partial || has('title')) {
    if (!body.title || !String(body.title).trim()) errors.push('title is required');
    else out.title = String(body.title).trim().slice(0, 120);
  }
  if (!partial || has('message')) {
    if (!body.message || !String(body.message).trim()) errors.push('message is required');
    else out.message = String(body.message).trim().slice(0, 500);
  }
  if (!partial || has('type')) out.type = TYPES.includes(body.type) ? body.type : 'announcement';
  if (!partial || has('audience')) out.audience = AUDIENCES.includes(body.audience) ? body.audience : 'all';
  if (!partial || has('release_id')) out.release_id = body.release_id || null;

  if (has('image_url')) {
    if (!body.image_url) out.image_url = null;
    else if (!isHttpUrl(String(body.image_url))) errors.push('image_url must be an http(s) link');
    else out.image_url = String(body.image_url).trim();
  }

  // ── schedule ──
  if (has('repeat_every_hours')) {
    if (body.repeat_every_hours === null || body.repeat_every_hours === '') out.repeat_every_hours = null;
    else {
      const h = Number(body.repeat_every_hours);
      if (!Number.isFinite(h) || h < MIN_REPEAT_HOURS || h > MAX_REPEAT_HOURS) {
        errors.push(`repeat_every_hours must be between ${MIN_REPEAT_HOURS} and ${MAX_REPEAT_HOURS}`);
      } else out.repeat_every_hours = h;
    }
  }
  for (const k of ['start_at', 'repeat_until']) {
    if (has(k)) {
      const d = parseDate(body[k]);
      if (d === undefined) errors.push(`${k} is not a valid date`);
      else out[k] = d ? d.toISOString() : null;
    }
  }
  return { errors, out };
}

// Checks the combined schedule once all fields are known. Returns an error string or null.
function checkSchedule(row) {
  const now = Date.now();
  const start = row.start_at ? new Date(row.start_at).getTime() : now;
  if (row.repeat_every_hours) {
    if (!row.repeat_until) return 'Pick the date the repeating push should stop ("until")';
    const until = new Date(row.repeat_until).getTime();
    if (until <= now) return '"Until" must be in the future';
    if (until <= start) return '"Until" must be after the first send time';
  } else if (row.repeat_until) {
    return 'Set "repeat every … hours" or clear the "until" date';
  }
  return null;
}

// Resolves an audience value to the list of user rows that should receive the push.
async function resolveAudience(audience) {
  let query = supabase.from('users').select('id, role, account_status').eq('account_status', 'active');
  if (audience === 'user1' || audience === 'user2') query = query.eq('role', audience);
  if (audience === 'android' || audience === 'web') query = query.eq('last_platform', audience);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// Actually pushes one notification to its audience. The ONLY place that sends.
async function dispatch(notification) {
  const recipients = await resolveAudience(notification.audience);

  const payload = {
    title: notification.title,
    body: notification.message,
    tag: 'admin-notif-' + notification.id,
    url: '/',
    id: notification.id,                       // Android: one card per campaign; repeats replace their own card
    ...(notification.image_url ? { image: notification.image_url } : {})
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
  const delivered = perUser.filter(p => (p.webpush && p.webpush.sent) || (p.fcm && p.fcm.sent)).length;
  return { recipientCount: recipients.length, deliveredCount: delivered, perUser, sentAt: new Date().toISOString() };
}

// Next run time after `from`, or null when the campaign is over.
function nextRunAfter(row, from) {
  if (!row.repeat_every_hours) return null;
  const next = from + Number(row.repeat_every_hours) * HOUR;
  if (row.repeat_until && next > new Date(row.repeat_until).getTime()) return null;
  return new Date(next);
}

// Send a draft/failed notification right now (no schedule).
async function performSend(notification, adminEmail) {
  const summary = await dispatch(notification);
  const { data, error } = await supabase
    .from('admin_notifications')
    .update({ status: 'sent', sent_at: summary.sentAt, last_run_at: summary.sentAt, run_count: (notification.run_count || 0) + 1, result: summary, last_error: null })
    .eq('id', notification.id)
    .select().single();
  if (error) throw error;
  await logAudit(adminEmail, 'notification.send', 'notification', notification.id, {
    audience: notification.audience, recipientCount: summary.recipientCount, hasImage: !!notification.image_url
  });
  return data;
}

// Turns a notification into a scheduled one (first run at start_at, or right away).
async function startSchedule(notification, adminEmail) {
  const problem = checkSchedule(notification);
  if (problem) { const e = new Error(problem); e.status = 400; throw e; }
  const first = notification.start_at ? new Date(notification.start_at) : new Date();
  const { data, error } = await supabase
    .from('admin_notifications')
    .update({ status: 'scheduled', next_run_at: first.toISOString(), start_at: first.toISOString(), last_error: null })
    .eq('id', notification.id).select().single();
  if (error) throw error;
  await logAudit(adminEmail, 'notification.schedule', 'notification', notification.id, {
    start: first.toISOString(), everyHours: notification.repeat_every_hours || null, until: notification.repeat_until || null
  });
  return data;
}

// Sends every scheduled push that is due. Safe to call from several places at once.
async function runDueNotifications({ limit = 20 } = {}) {
  const nowIso = new Date().toISOString();
  const { data: due, error } = await supabase
    .from('admin_notifications').select('*')
    .eq('status', 'scheduled').lte('next_run_at', nowIso)
    .order('next_run_at', { ascending: true }).limit(limit);
  if (error) throw error;

  const ran = [];
  for (const n of due || []) {
    const now = Date.now();
    const next = nextRunAfter(n, now);
    // CLAIM: only the caller whose update matches the old next_run_at wins this run.
    const claim = next
      ? { next_run_at: next.toISOString(), last_run_at: new Date(now).toISOString() }
      : { status: 'completed', next_run_at: null, last_run_at: new Date(now).toISOString() };
    const { data: claimed, error: claimErr } = await supabase
      .from('admin_notifications').update(claim)
      .eq('id', n.id).eq('status', 'scheduled').eq('next_run_at', n.next_run_at).select();
    if (claimErr || !claimed || claimed.length === 0) continue;   // someone else took it (or it changed)

    try {
      const summary = await dispatch(n);
      await supabase.from('admin_notifications').update({
        sent_at: summary.sentAt, result: summary, run_count: (n.run_count || 0) + 1, last_error: null,
        // a one-time scheduled push is 'sent'; a finished repeating one is 'completed'
        ...(next ? {} : { status: n.repeat_every_hours ? 'completed' : 'sent' })
      }).eq('id', n.id);
      ran.push({ id: n.id, recipients: summary.recipientCount, delivered: summary.deliveredCount });
    } catch (e) {
      console.error('[admin-notifications] scheduled send failed:', n.id, e.message);
      await supabase.from('admin_notifications').update({ last_error: String(e.message).slice(0, 300) }).eq('id', n.id);
    }
  }
  return ran;
}

// ═══════════════════════════════════════════════════════════════
//  Routes (all admin-only)
// ═══════════════════════════════════════════════════════════════
router.use(requireAdmin);

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

// ── POST /api/admin/notifications/upload-image ──────────────────
// Body: { dataUrl: "data:image/jpeg;base64,..." }  (the composer sends this)
router.post('/upload-image', async (req, res) => {
  try {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String((req.body || {}).dataUrl || ''));
    if (!m) return res.status(400).json({ error: 'Send a JPG, PNG or WebP image' });
    const buffer = Buffer.from(m[2], 'base64');
    if (buffer.length === 0) return res.status(400).json({ error: 'Empty image' });
    if (buffer.length > MAX_IMAGE_BYTES) return res.status(400).json({ error: 'Image is too big (max 3 MB)' });

    const name = `${IMAGE_PREFIX}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${IMAGE_TYPES[m[1]]}`;
    const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(name, buffer, { contentType: m[1], upsert: false });
    if (error) throw error;
    const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(name);
    await logAudit(req.adminEmail, 'notification.upload_image', 'notification', null, { bytes: buffer.length });
    res.json({ url: data.publicUrl });
  } catch (e) {
    console.error('[admin-notifications] image upload failed:', e.message);
    res.status(500).json({ error: 'Image upload failed. Check that the "couple-photos" bucket exists and is public.' });
  }
});

// ── POST /api/admin/notifications/preview ───────────────────────
router.post('/preview', async (req, res) => {
  try {
    const { errors, out } = validateBody(req.body || {});
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
    const recipients = await resolveAudience(out.audience);
    res.json({ preview: { title: out.title, body: out.message, audience: out.audience, recipientCount: recipients.length } });
  } catch (e) {
    console.error('[admin-notifications] preview failed:', e.message);
    res.status(500).json({ error: 'Failed to build preview' });
  }
});

// ── POST /api/admin/notifications/run-due ───────────────────────
// Lets the admin trigger the scheduler by hand (the same code the timer runs).
router.post('/run-due', async (req, res) => {
  try { res.json({ ran: await runDueNotifications() }); }
  catch (e) { console.error('[admin-notifications] run-due failed:', e.message); res.status(500).json({ error: 'Failed to run due notifications' }); }
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

// ── POST /api/admin/notifications ───────────────────────────────
// body.mode: 'draft' (default) | 'now' | 'schedule'.  (sendNow:true is still accepted = mode 'now')
router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const mode = body.sendNow === true ? 'now' : (['draft', 'now', 'schedule'].includes(body.mode) ? body.mode : 'draft');
    const { errors, out } = validateBody(body);
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
    if (mode === 'schedule') {
      const problem = checkSchedule(out);
      if (problem) return res.status(400).json({ error: problem });
    }
    if (mode !== 'schedule') { delete out.repeat_every_hours; delete out.repeat_until; delete out.start_at; }

    const { data: created, error } = await supabase
      .from('admin_notifications').insert({ ...out, status: 'draft' }).select().single();
    if (error) throw error;
    await logAudit(req.adminEmail, 'notification.create', 'notification', created.id, { audience: out.audience, type: out.type, mode });

    if (mode === 'now') return res.json({ notification: await performSend(created, req.adminEmail) });
    if (mode === 'schedule') {
      const scheduled = await startSchedule(created, req.adminEmail);
      // First run due right now? Don't make the admin wait for the next timer tick.
      if (new Date(scheduled.next_run_at).getTime() <= Date.now()) {
        await runDueNotifications();
        const { data: fresh } = await supabase.from('admin_notifications').select('*').eq('id', created.id).maybeSingle();
        return res.json({ notification: fresh || scheduled });
      }
      return res.json({ notification: scheduled });
    }
    res.json({ notification: created });
  } catch (e) {
    console.error('[admin-notifications] create failed:', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to create notification' });
  }
});

// ── PUT /api/admin/notifications/:id ────────────────────────────
// Edit a draft, or change a scheduled / paused campaign (e.g. make it "every 5 hours" instead of 4,
// or move the end date). Already-sent / completed ones are history.
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: existing, error: fetchErr } = await supabase.from('admin_notifications').select('*').eq('id', id).maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!existing) return res.status(404).json({ error: 'Notification not found' });
    if (!['draft', 'scheduled', 'paused', 'failed'].includes(existing.status)) {
      return res.status(400).json({ error: `A ${existing.status} notification cannot be edited` });
    }
    const { errors, out } = validateBody(req.body || {}, { partial: true });
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
    if (Object.keys(out).length === 0) return res.status(400).json({ error: 'No valid fields to update' });

    const merged = { ...existing, ...out };
    if (['scheduled', 'paused'].includes(existing.status)) {
      const problem = checkSchedule(merged);
      if (problem) return res.status(400).json({ error: problem });
      // Changing the interval re-times the NEXT run from the last one (or now), so "4h → 5h" takes effect at once.
      if (existing.status === 'scheduled' && (out.repeat_every_hours !== undefined || out.start_at !== undefined)) {
        const base = existing.last_run_at ? new Date(existing.last_run_at).getTime() : Date.now();
        const next = out.start_at && !existing.last_run_at
          ? new Date(out.start_at)
          : (merged.repeat_every_hours ? new Date(base + Number(merged.repeat_every_hours) * HOUR) : new Date(base));
        out.next_run_at = (next.getTime() < Date.now() ? new Date() : next).toISOString();
      }
    }
    const { data, error } = await supabase.from('admin_notifications').update(out).eq('id', id).select().single();
    if (error) throw error;
    await logAudit(req.adminEmail, 'notification.update', 'notification', id, { fields: Object.keys(out) });
    res.json({ notification: data });
  } catch (e) {
    console.error('[admin-notifications] update failed:', e.message);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

// ── POST /api/admin/notifications/:id/schedule ──────────────────
// Turn a saved draft into a scheduled push using the schedule fields already on it (or in the body).
router.post('/:id/schedule', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: existing } = await supabase.from('admin_notifications').select('*').eq('id', id).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Notification not found' });
    if (!['draft', 'failed', 'paused'].includes(existing.status)) return res.status(400).json({ error: `A ${existing.status} notification cannot be scheduled` });
    const { errors, out } = validateBody(req.body || {}, { partial: true });
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
    const merged = { ...existing, ...out };
    if (existing.status === 'paused') { merged.start_at = new Date().toISOString(); }
    await supabase.from('admin_notifications').update({ ...out, start_at: merged.start_at }).eq('id', id);
    res.json({ notification: await startSchedule(merged, req.adminEmail) });
  } catch (e) {
    console.error('[admin-notifications] schedule failed:', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to schedule notification' });
  }
});

// ── POST /api/admin/notifications/:id/pause | resume | stop ─────
router.post('/:id/pause', async (req, res) => {
  try {
    const { data: existing } = await supabase.from('admin_notifications').select('id, status').eq('id', req.params.id).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Notification not found' });
    if (existing.status !== 'scheduled') return res.status(400).json({ error: 'Only a scheduled notification can be paused' });
    const { data, error } = await supabase.from('admin_notifications').update({ status: 'paused' }).eq('id', existing.id).select().single();
    if (error) throw error;
    await logAudit(req.adminEmail, 'notification.pause', 'notification', existing.id, {});
    res.json({ notification: data });
  } catch (e) { console.error('[admin-notifications] pause failed:', e.message); res.status(500).json({ error: 'Failed to pause' }); }
});

router.post('/:id/resume', async (req, res) => {
  try {
    const { data: existing } = await supabase.from('admin_notifications').select('*').eq('id', req.params.id).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Notification not found' });
    if (existing.status !== 'paused') return res.status(400).json({ error: 'Only a paused notification can be resumed' });
    const problem = checkSchedule({ ...existing, start_at: null });
    if (problem) return res.status(400).json({ error: problem + ' — edit it first' });
    // Next push one interval after now (not a burst of missed ones).
    const next = existing.repeat_every_hours ? new Date(Date.now() + Number(existing.repeat_every_hours) * HOUR) : new Date();
    const { data, error } = await supabase.from('admin_notifications').update({ status: 'scheduled', next_run_at: next.toISOString() }).eq('id', existing.id).select().single();
    if (error) throw error;
    await logAudit(req.adminEmail, 'notification.resume', 'notification', existing.id, {});
    res.json({ notification: data });
  } catch (e) { console.error('[admin-notifications] resume failed:', e.message); res.status(500).json({ error: 'Failed to resume' }); }
});

router.post('/:id/stop', async (req, res) => {
  try {
    const { data: existing } = await supabase.from('admin_notifications').select('id, status').eq('id', req.params.id).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Notification not found' });
    if (!['scheduled', 'paused'].includes(existing.status)) return res.status(400).json({ error: 'Only a scheduled or paused notification can be stopped' });
    const { data, error } = await supabase.from('admin_notifications').update({ status: 'cancelled', next_run_at: null }).eq('id', existing.id).select().single();
    if (error) throw error;
    await logAudit(req.adminEmail, 'notification.stop', 'notification', existing.id, {});
    res.json({ notification: data });
  } catch (e) { console.error('[admin-notifications] stop failed:', e.message); res.status(500).json({ error: 'Failed to stop' }); }
});

// ── POST /api/admin/notifications/:id/send ──────────────────────
// Send a draft (or retry a failed one) right now. Guarded against double-send.
router.post('/:id/send', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: existing, error: fetchErr } = await supabase.from('admin_notifications').select('*').eq('id', id).maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!existing) return res.status(404).json({ error: 'Notification not found' });
    if (!['draft', 'failed'].includes(existing.status)) {
      return res.status(400).json({ error: `This notification is ${existing.status} and cannot be sent from here`, sentAt: existing.sent_at });
    }
    res.json({ notification: await performSend(existing, req.adminEmail) });
  } catch (e) {
    console.error('[admin-notifications] send failed:', e.message);
    try { await supabase.from('admin_notifications').update({ status: 'failed', last_error: String(e.message).slice(0, 300) }).eq('id', req.params.id); } catch (_) { /* best-effort */ }
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

// ── DELETE /api/admin/notifications/:id ─────────────────────────
// Drafts, failed and stopped ones can be deleted — sent / completed stay in history.
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: existing } = await supabase.from('admin_notifications').select('id, status').eq('id', id).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Notification not found' });
    if (!['draft', 'failed', 'cancelled'].includes(existing.status)) {
      return res.status(400).json({ error: 'Only draft, failed or stopped notifications can be deleted (stop a scheduled one first)' });
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
module.exports.runDueNotifications = runDueNotifications;
module.exports._test = { validateBody, checkSchedule, nextRunAfter };
