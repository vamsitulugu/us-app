// ═══════════════════════════════════════════════════════
//  Daily Routine Routes — per-partner daily timetable
//  Mirrors the routes/meetplanner.js pattern: dedicated
//  Supabase table, plain coupleId-scoped REST endpoints.
//
//  Recurrence/date-expansion happens on the client (same
//  small dataset either way, and keeps this file simple);
//  this file is the source of truth for the routine
//  templates + per-date status/reschedule overrides.
// ═══════════════════════════════════════════════════════
const express  = require('express');
const supabase = require('../middleware/supabase');
const router   = express.Router();

let _sendPushToPartner;
try { _sendPushToPartner = require('./auth').sendPushToPartner; } catch (_) {}

const TYPES      = ['routine','habit','task','event','meal','workout','couple','focus','break','sleep'];
const REPEATS     = ['none','daily','weekdays','weekends','custom'];
const REMINDERS   = ['none','at_time','5min','10min','15min','30min','1hour'];
const STATUSES    = ['upcoming','in_progress','completed','skipped','missed'];

function isHHMM(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }

function validateRoutine(r, { partial = false } = {}) {
  if (!partial || r.title !== undefined) {
    if (!r.title || !String(r.title).trim()) return 'Activity name is required';
  }
  if (!partial || r.startTime !== undefined) {
    if (!isHHMM(r.startTime)) return 'Start time is invalid';
  }
  if (!partial || r.endTime !== undefined) {
    if (!isHHMM(r.endTime)) return 'End time is invalid';
  }
  if (r.startTime && r.endTime && r.startTime === r.endTime) return 'End time cannot be the same as start time';
  if (r.type !== undefined && !TYPES.includes(r.type)) return 'Invalid activity type';
  if (r.repeat !== undefined && !REPEATS.includes(r.repeat)) return 'Invalid repeat option';
  if (r.reminder !== undefined && !REMINDERS.includes(r.reminder)) return 'Invalid reminder option';
  if (r.visibility !== undefined && !['private','shared'].includes(r.visibility)) return 'Invalid visibility';
  return null;
}

function rowOut(row) {
  return {
    id:          row.id,
    coupleId:    row.couple_id,
    role:        row.role,
    title:       row.title,
    description: row.description,
    type:        row.type,
    location:    row.location,
    notes:       row.notes,
    startTime:   row.start_time,
    endTime:     row.end_time,
    date:        row.routine_date,
    repeat:      row.repeat_rule,
    repeatDays:  row.repeat_days || null,
    visibility:  row.visibility,
    reminder:    row.reminder,
    habitId:     row.habit_id,
    taskId:      row.task_id,
    statusByDate: row.status_overrides || {},
    timeByDate:   row.time_overrides || {},
    createdBy:   row.created_by,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at
  };
}

// ─── LIST all (non-archived) routines for a couple ─────
// Client filters by tab (role) + date on its side — this is a small
// per-couple dataset, so one fetch per page-open is cheap and avoids
// re-querying on every date/tab flip.
router.get('/:coupleId', async (req, res) => {
  const { data, error } = await supabase
    .from('daily_routines')
    .select('*')
    .eq('couple_id', req.params.coupleId)
    .eq('archived', false)
    .order('start_time', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  return res.json((data || []).map(rowOut));
});

// ─── CREATE ─────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { coupleId, role, routine, myName } = req.body;
  if (!coupleId || !role || !routine) return res.status(400).json({ error: 'Missing data' });
  if (!['user1', 'user2'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

  const err = validateRoutine(routine);
  if (err) return res.status(400).json({ error: err });

  const { data, error } = await supabase
    .from('daily_routines')
    .insert({
      couple_id:    coupleId,
      role,
      title:        String(routine.title).trim(),
      description:  routine.description || null,
      type:         routine.type || 'routine',
      location:     routine.location || null,
      notes:        routine.notes || null,
      start_time:   routine.startTime,
      end_time:     routine.endTime,
      routine_date: routine.date || null,
      repeat_rule:  routine.repeat || 'none',
      repeat_days:  routine.repeatDays || null,
      visibility:   routine.visibility || 'private',
      reminder:     routine.reminder || 'none',
      habit_id:     routine.habitId || null,
      task_id:      routine.taskId || null,
      created_by:   myName || null
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  if (data.visibility === 'shared' && _sendPushToPartner) {
    _sendPushToPartner(coupleId, role, {
      title: '🗓️ New Routine',
      body: (myName || 'Your partner') + ' added "' + data.title + '" to the shared schedule',
      icon: '/icons/icon-192.png',
      tag: 'daily-routine',
      url: '/?page=dailyroutine'
    }).catch(() => {});
  }

  return res.json(rowOut(data));
});

// ─── UPDATE (edit template fields) ─────────────────────
router.put('/:id', async (req, res) => {
  const { routine } = req.body;
  if (!routine) return res.status(400).json({ error: 'Missing data' });

  const err = validateRoutine(routine, { partial: true });
  if (err) return res.status(400).json({ error: err });

  const patch = { updated_at: new Date().toISOString() };
  const map = {
    title: 'title', description: 'description', type: 'type', location: 'location',
    notes: 'notes', startTime: 'start_time', endTime: 'end_time', date: 'routine_date',
    repeat: 'repeat_rule', repeatDays: 'repeat_days', visibility: 'visibility',
    reminder: 'reminder', habitId: 'habit_id', taskId: 'task_id'
  };
  Object.entries(map).forEach(([k, col]) => { if (routine[k] !== undefined) patch[col] = routine[k]; });

  const { data, error } = await supabase
    .from('daily_routines')
    .update(patch)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(rowOut(data));
});

// ─── Set per-date status (complete / skip / reset) ─────
router.patch('/:id/status', async (req, res) => {
  const { date, status } = req.body;
  if (!date || !STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status update' });

  const { data: existing, error: fErr } = await supabase
    .from('daily_routines').select('status_overrides').eq('id', req.params.id).single();
  if (fErr) return res.status(500).json({ error: fErr.message });

  const overrides = { ...(existing.status_overrides || {}) };
  overrides[date] = status;

  const { data, error } = await supabase
    .from('daily_routines')
    .update({ status_overrides: overrides, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(rowOut(data));
});

// ─── Reschedule a single occurrence (doesn't touch template) ──
router.patch('/:id/reschedule', async (req, res) => {
  const { date, startTime, endTime } = req.body;
  if (!date || !isHHMM(startTime) || !isHHMM(endTime)) return res.status(400).json({ error: 'Invalid reschedule' });
  if (startTime === endTime) return res.status(400).json({ error: 'End time cannot be the same as start time' });

  const { data: existing, error: fErr } = await supabase
    .from('daily_routines').select('time_overrides').eq('id', req.params.id).single();
  if (fErr) return res.status(500).json({ error: fErr.message });

  const overrides = { ...(existing.time_overrides || {}) };
  overrides[date] = { start: startTime, end: endTime };

  const { data, error } = await supabase
    .from('daily_routines')
    .update({ time_overrides: overrides, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(rowOut(data));
});

// ─── Duplicate ──────────────────────────────────────────
router.post('/:id/duplicate', async (req, res) => {
  const { data: existing, error: fErr } = await supabase
    .from('daily_routines').select('*').eq('id', req.params.id).single();
  if (fErr) return res.status(500).json({ error: fErr.message });

  const copy = { ...existing };
  delete copy.id; delete copy.created_at; delete copy.updated_at;
  copy.title = copy.title + ' (copy)';
  copy.status_overrides = {};
  copy.time_overrides = {};

  const { data, error } = await supabase.from('daily_routines').insert(copy).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(rowOut(data));
});

// ─── DELETE (soft by default) ───────────────────────────
router.delete('/:id', async (req, res) => {
  const hard = req.query.hard === 'true';
  if (hard) {
    const { error } = await supabase.from('daily_routines').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }
  const { error } = await supabase
    .from('daily_routines')
    .update({ archived: true, updated_at: new Date().toISOString() })
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
});

module.exports = router;
