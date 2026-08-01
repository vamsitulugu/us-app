// ═══════════════════════════════════════════════════════
//  routes/movie.js — "Watch Together" room state
//
//  Mirrors routes/recordings.js / routes/music.js patterns: the server
//  (service-role key) is the only thing that touches watch_sessions /
//  watch_history. Every write carries an incrementing action_seq so a
//  late/stale request can never clobber a newer one (see PATCH /state).
//
//  The movie FILE never passes through here — only tiny JSON state.
//  Wire up in server.js:
//    app.use('/api/movie', require('./routes/movie'));
// ═══════════════════════════════════════════════════════
const express  = require('express');
const supabase = require('../middleware/supabase');
const router   = express.Router();

const DURATION_TOLERANCE_SEC = 3; // ≤3s difference is considered a match

function computeMatch(row) {
  if (!row.user1_duration_sec || !row.user2_duration_sec) return false;
  return Math.abs(row.user1_duration_sec - row.user2_duration_sec) <= DURATION_TOLERANCE_SEC;
}

// GET /api/movie/:coupleId — fetch current room (used on load + reconnect)
router.get('/:coupleId', async (req, res) => {
  const { data, error } = await supabase
    .from('watch_sessions').select('*').eq('couple_id', req.params.coupleId).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || null);
});

// POST /api/movie/:coupleId/movie — a partner selected/cleared a local movie
// body: { role, title, durationSec }  (durationSec null clears selection)
router.post('/:coupleId/movie', async (req, res) => {
  const { coupleId } = req.params;
  const { role, title, durationSec } = req.body;
  if (!role || (role !== 'user1' && role !== 'user2')) return res.status(400).json({ error: 'Missing/invalid role' });

  const patch = {
    couple_id: coupleId,
    [`${role}_movie_title`]: title || null,
    [`${role}_duration_sec`]: durationSec || null,
    [`${role}_ready`]: false, // selecting a new movie always resets ready
    status: 'selecting',
    updated_by: role,
    updated_at: new Date().toISOString()
  };

  const { data: existing } = await supabase.from('watch_sessions').select('*').eq('couple_id', coupleId).maybeSingle();
  const merged = { ...(existing || {}), ...patch };
  merged.movies_match = computeMatch(merged);
  if (merged.movies_match && existing) merged.status = (existing.user1_ready || existing.user2_ready) ? 'waiting' : 'selecting';

  const { data, error } = await supabase.from('watch_sessions').upsert(merged, { onConflict: 'couple_id' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// POST /api/movie/:coupleId/ready — toggle "I'm ready"
// body: { role, ready }
router.post('/:coupleId/ready', async (req, res) => {
  const { coupleId } = req.params;
  const { role, ready } = req.body;
  if (!role) return res.status(400).json({ error: 'Missing role' });

  const { data: existing, error: fErr } = await supabase.from('watch_sessions').select('*').eq('couple_id', coupleId).maybeSingle();
  if (fErr) return res.status(500).json({ error: fErr.message });
  if (!existing) return res.status(404).json({ error: 'No room yet — select a movie first' });

  const patch = { [`${role}_ready`]: !!ready, updated_by: role, updated_at: new Date().toISOString() };
  const merged = { ...existing, ...patch };
  const bothReady = merged.user1_ready && merged.user2_ready && merged.movies_match;
  merged.status = bothReady ? 'ready' : (merged.user1_ready || merged.user2_ready ? 'waiting' : 'selecting');

  const { data, error } = await supabase.from('watch_sessions').update(merged).eq('couple_id', coupleId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// POST /api/movie/:coupleId/start — begin the shared countdown
// body: { role, countdownMs }  -> sets scheduled_start_at = now + countdownMs
router.post('/:coupleId/start', async (req, res) => {
  const { coupleId } = req.params;
  const { role, countdownMs } = req.body;
  const startAt = new Date(Date.now() + (countdownMs || 3500)).toISOString();

  const { data: existing } = await supabase.from('watch_sessions').select('action_seq').eq('couple_id', coupleId).maybeSingle();

  const { data, error } = await supabase.from('watch_sessions')
    .update({
      status: 'countdown',
      scheduled_start_at: startAt,
      playing: false,
      position_sec: 0,
      action_seq: (existing?.action_seq || 0) + 1,
      updated_by: role,
      updated_at: new Date().toISOString()
    })
    .eq('couple_id', coupleId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// PATCH /api/movie/:coupleId/state — play/pause/seek control action.
// body: { role, playing, positionSec, actionSeq, playbackRate }
//
// actionSeq is a client-incrementing counter (Date.now()-based is fine,
// or a simple local counter) — we only apply the update if it is NEWER
// than what's stored, so an out-of-order/late network request can never
// undo a more recent action (handles simultaneous play/pause, seek
// races, and stale reconnect payloads per the spec).
router.patch('/:coupleId/state', async (req, res) => {
  const { coupleId } = req.params;
  const { role, playing, positionSec, actionSeq, playbackRate } = req.body;
  if (!role || actionSeq === undefined) return res.status(400).json({ error: 'Missing role/actionSeq' });

  const { data: existing, error: fErr } = await supabase.from('watch_sessions').select('*').eq('couple_id', coupleId).maybeSingle();
  if (fErr) return res.status(500).json({ error: fErr.message });
  if (!existing) return res.status(404).json({ error: 'No room' });

  if (actionSeq <= (existing.action_seq || 0)) {
    // Stale/out-of-order — ignore write, but return current authoritative state
    return res.json(existing);
  }

  const patch = {
    playing: !!playing,
    position_sec: positionSec ?? existing.position_sec,
    playback_rate: playbackRate || 1,
    action_seq: actionSeq,
    status: existing.status === 'countdown' ? existing.status : 'watching',
    updated_by: role,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await supabase.from('watch_sessions').update(patch).eq('couple_id', coupleId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// POST /api/movie/:coupleId/end — end session (movie finished, or a
// partner chose "End Session"). Resets to idle so the room can be reused.
router.post('/:coupleId/end', async (req, res) => {
  const { coupleId } = req.params;
  const { role, movieTitle, durationSec, completedPct } = req.body;

  if (movieTitle) {
    try {
      await supabase.from('watch_history').insert({
        couple_id: coupleId, movie_title: movieTitle,
        duration_sec: durationSec || null, completed_pct: completedPct || 0
      });
    } catch (_) {}
  }

  const { data, error } = await supabase.from('watch_sessions').update({
    status: 'ended', playing: false, updated_by: role, updated_at: new Date().toISOString()
  }).eq('couple_id', coupleId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// POST /api/movie/:coupleId/reset — fully clear the room (new session)
router.post('/:coupleId/reset', async (req, res) => {
  const { coupleId } = req.params;
  const { error } = await supabase.from('watch_sessions').delete().eq('couple_id', coupleId);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
});

// GET /api/movie/:coupleId/history — lightweight watch history
router.get('/:coupleId/history', async (req, res) => {
  const { data, error } = await supabase.from('watch_history')
    .select('*').eq('couple_id', req.params.coupleId)
    .order('watched_at', { ascending: false }).limit(30);
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

module.exports = router;
