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

// ── Sync v2 helpers ──────────────────────────────────────────────────────────
// A playing room is described by ONE anchor: "at updated_at (server time) the movie was at position_sec".
// Every device computes   expected = position_sec + (serverNow - updated_at)   so they all agree.
// Previously the status stayed 'countdown' forever and nobody wrote the real start, so phones that only
// poll (Android, background tabs) never saw pauses/seeks and each phone invented its own start position.
const MAX_ANCHOR_SKEW_MS = 10000;   // a client-supplied anchor further than this from server time is ignored

// Withhold server-only fields? none today. Adds the server clock so every poll also refines the client clock.
const withNow = (row) => (row ? { ...row, server_now: Date.now() } : row);

// When the countdown is over, the SERVER starts the movie: status 'watching', playing, position 0 anchored
// exactly at scheduled_start_at. Both devices then derive the same position, and nobody has to write "play".
async function settleCountdown(row) {
  if (!row || row.status !== 'countdown' || !row.scheduled_start_at) return row;
  const startMs = new Date(row.scheduled_start_at).getTime();
  if (!(Date.now() >= startMs)) return row;
  const { data } = await supabase.from('watch_sessions').update({
    status: 'watching',
    playing: true,
    position_sec: 0,
    playback_rate: 1,
    updated_at: new Date(startMs).toISOString(),
    action_seq: (row.action_seq || 0) + 1
  }).eq('couple_id', row.couple_id).eq('status', 'countdown').select().maybeSingle();
  if (data) return data;
  // Lost the race to the partner's request: read what they wrote.
  const { data: fresh } = await supabase.from('watch_sessions').select('*').eq('couple_id', row.couple_id).maybeSingle();
  return fresh || row;
}

// GET /api/movie/time — authoritative server clock, used by movie.js to
// compute each device's clock offset so the Start Together countdown and
// playback-start timestamp are measured against ONE shared clock instead
// of each device's own (frequently skewed by 1-2s) system clock.
router.get('/time', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ now: Date.now() }); });

// GET /api/movie/:coupleId — fetch current room (used on load + reconnect)
router.get('/:coupleId', async (req, res) => {
  const { data, error } = await supabase
    .from('watch_sessions').select('*').eq('couple_id', req.params.coupleId).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.setHeader('Cache-Control', 'no-store');
  return res.json(withNow(await settleCountdown(data)) || null);
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

  // Shared Cloud Storage: picking a local file leaves cloud mode. Only runs when
  // the room was cloud-linked (shared_movie_id exists AND is set), so Direct
  // Device Video behaves exactly as before — even if the migration isn't applied.
  if (existing && existing.shared_movie_id) {
    const { data: cleared } = await supabase.from('watch_sessions')
      .update({ shared_movie_id: null }).eq('couple_id', coupleId).select().single();
    if (cleared) return res.json(withNow(cleared));
  }
  return res.json(withNow(data));
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
  return res.json(withNow(data));
});

// POST /api/movie/:coupleId/request-start — the initiating partner asks
// to begin. Does NOT start anything yet — flips status to
// 'start_requested' and waits for the partner to accept. This replaces
// the old immediate-start behavior that caused each partner to have to
// press Start independently.
// body: { role }
router.post('/:coupleId/request-start', async (req, res) => {
  const { coupleId } = req.params;
  const { role } = req.body;
  if (!role) return res.status(400).json({ error: 'Missing role' });

  const { data: existing, error: fErr } = await supabase.from('watch_sessions').select('*').eq('couple_id', coupleId).maybeSingle();
  if (fErr) return res.status(500).json({ error: fErr.message });
  if (!existing) return res.status(404).json({ error: 'No room yet' });

  const { data, error } = await supabase.from('watch_sessions').update({
    status: 'start_requested',
    start_requested_by: role,
    action_seq: (existing.action_seq || 0) + 1,
    updated_by: role,
    updated_at: new Date().toISOString()
  }).eq('couple_id', coupleId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(withNow(data));
});

// POST /api/movie/:coupleId/cancel-start — initiator cancels while
// waiting, or partner declines ("NOT NOW"). Returns to 'ready'.
// body: { role }
router.post('/:coupleId/cancel-start', async (req, res) => {
  const { coupleId } = req.params;
  const { role } = req.body;

  const { data: existing } = await supabase.from('watch_sessions').select('action_seq').eq('couple_id', coupleId).maybeSingle();

  const { data, error } = await supabase.from('watch_sessions').update({
    status: 'ready',
    start_requested_by: null,
    action_seq: (existing?.action_seq || 0) + 1,
    updated_by: role,
    updated_at: new Date().toISOString()
  }).eq('couple_id', coupleId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(withNow(data));
});

// POST /api/movie/:coupleId/accept-start — the invited partner accepts.
// Establishes ONE authoritative scheduled_start_at that both clients
// count down against, so network delivery jitter can't let one phone
// start meaningfully earlier than the other.
// body: { role, countdownMs }
router.post('/:coupleId/accept-start', async (req, res) => {
  const { coupleId } = req.params;
  const { role, countdownMs } = req.body;
  const cd = Math.min(15000, Math.max(3000, Number(countdownMs) || 5000)); // time for both devices to load the movie
  const startAt = new Date(Date.now() + cd).toISOString();

  const { data: existing } = await supabase.from('watch_sessions').select('action_seq').eq('couple_id', coupleId).maybeSingle();

  const { data, error } = await supabase.from('watch_sessions')
    .update({
      status: 'countdown',
      scheduled_start_at: startAt,
      playing: false,
      position_sec: 0,
      start_requested_by: null,
      action_seq: (existing?.action_seq || 0) + 1,
      updated_by: role,
      updated_at: new Date().toISOString()
    })
    .eq('couple_id', coupleId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(withNow(data));
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
  const { role, playing, positionSec, actionSeq, playbackRate, clientTs } = req.body;
  if (!role || actionSeq === undefined) return res.status(400).json({ error: 'Missing role/actionSeq' });

  const { data: found, error: fErr } = await supabase.from('watch_sessions').select('*').eq('couple_id', coupleId).maybeSingle();
  if (fErr) return res.status(500).json({ error: fErr.message });
  if (!found) return res.status(404).json({ error: 'No room' });
  const existing = await settleCountdown(found);

  // Nothing can be controlled before the countdown ends or after the movie ended.
  if (existing.status === 'countdown' || existing.status === 'ended' || existing.status === 'idle') {
    return res.json(withNow(existing));
  }
  if (!(Number(actionSeq) > (existing.action_seq || 0))) {
    // Stale/out-of-order — ignore write, but return current authoritative state
    return res.json(withNow(existing));
  }

  // Anchor: the client says "at (shared-clock) time clientTs I was at positionSec". Using that instead of the
  // moment the request ARRIVED removes the network delay from the position (it used to make the partner late).
  const now = Date.now();
  let anchorMs = now;
  const ts = Number(clientTs);
  if (Number.isFinite(ts) && Math.abs(ts - now) <= MAX_ANCHOR_SKEW_MS) anchorMs = Math.min(ts, now);

  let pos = Number(positionSec);
  if (!Number.isFinite(pos)) pos = Number(existing.position_sec) || 0;
  pos = Math.max(0, pos);
  const rate = Number(playbackRate);

  const patch = {
    playing: !!playing,
    position_sec: pos,
    playback_rate: Number.isFinite(rate) && rate > 0 && rate <= 4 ? rate : 1,
    action_seq: Number(actionSeq),
    status: 'watching',
    updated_by: role,
    updated_at: new Date(anchorMs).toISOString()
  };
  const { data, error } = await supabase.from('watch_sessions').update(patch).eq('couple_id', coupleId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(withNow(data));
});

// ── Movie Chat (Task 4) — deliberately a SEPARATE table/endpoint from
// /api/chat so these messages can never mix with the normal Chat page. ──

// POST /api/movie/:coupleId/chat — send a movie-session message.
// body: { role, sessionKey, movieTitle, text, positionSec }
router.post('/:coupleId/chat', async (req, res) => {
  const { coupleId } = req.params;
  const { role, sessionKey, movieTitle, text, positionSec } = req.body;
  if (!role || !sessionKey || !text) return res.status(400).json({ error: 'Missing role/sessionKey/text' });
  const { data, error } = await supabase.from('movie_chat_messages').insert({
    couple_id: coupleId, session_key: sessionKey, movie_title: movieTitle || null,
    sender_role: role, text, playback_position_sec: positionSec ?? null
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// GET /api/movie/:coupleId/chat?sessionKey=...&after=ISO — messages for
// ONE watch session (never returns messages from other sessions or from
// normal Chat).
router.get('/:coupleId/chat', async (req, res) => {
  const { coupleId } = req.params;
  const { sessionKey, after, limit } = req.query;
  if (!sessionKey) return res.status(400).json({ error: 'Missing sessionKey' });
  let q = supabase.from('movie_chat_messages').select('*')
    .eq('couple_id', coupleId).eq('session_key', sessionKey)
    .order('created_at', { ascending: true });
  q = after ? q.gt('created_at', after) : q.limit(Number(limit) || 50);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /api/movie/:coupleId/end — end session (movie finished, or a
// partner chose "End Session"). Resets to idle so the room can be reused.
router.post('/:coupleId/end', async (req, res) => {
  const { coupleId } = req.params;
  const { role, movieTitle, durationSec, completedPct, sessionKey, positionSec } = req.body;

  if (movieTitle) {
    try {
      await supabase.from('watch_history').insert({
        couple_id: coupleId, movie_title: movieTitle,
        duration_sec: durationSec || null, completed_pct: completedPct || 0,
        session_key: sessionKey || null, last_position_sec: positionSec ?? null
      });
    } catch (_) {}
  }

  const { data, error } = await supabase.from('watch_sessions').update({
    status: 'ended', playing: false, updated_by: role, updated_at: new Date().toISOString()
  }).eq('couple_id', coupleId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(withNow(data));
});

// POST /api/movie/:coupleId/reset — fully clear the room (new session)
router.post('/:coupleId/reset', async (req, res) => {
  const { coupleId } = req.params;
  const { error } = await supabase.from('watch_sessions').delete().eq('couple_id', coupleId);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
});

// DELETE /api/movie/:coupleId/history/:id — delete ONE history entry.
// Also removes that session's movie chat messages so nothing orphaned is
// left behind once the history entry referencing it is gone.
router.delete('/:coupleId/history/:id', async (req, res) => {
  const { coupleId, id } = req.params;
  const { data: row } = await supabase.from('watch_history')
    .select('session_key').eq('couple_id', coupleId).eq('id', id).maybeSingle();
  const { error } = await supabase.from('watch_history').delete().eq('couple_id', coupleId).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  if (row && row.session_key) {
    try { await supabase.from('movie_chat_messages').delete().eq('couple_id', coupleId).eq('session_key', row.session_key); } catch (_) {}
  }
  return res.json({ ok: true });
});

// DELETE /api/movie/:coupleId/history — clear ALL history for this couple
// (their explicit "delete all" action). Also clears all movie chat
// messages for this couple, since every one of them belongs to a
// session that no longer has a history entry after this.
router.delete('/:coupleId/history', async (req, res) => {
  const { coupleId } = req.params;
  const { error } = await supabase.from('watch_history').delete().eq('couple_id', coupleId);
  if (error) return res.status(500).json({ error: error.message });
  try { await supabase.from('movie_chat_messages').delete().eq('couple_id', coupleId); } catch (_) {}
  return res.json({ ok: true });
});

// GET /api/movie/:coupleId/history — lightweight watch history
router.get('/:coupleId/history', async (req, res) => {
  const { data, error } = await supabase.from('watch_history')
    .select('*').eq('couple_id', req.params.coupleId)
    .order('watched_at', { ascending: false }).limit(30);
  if (error) return res.status(500).json({ error: error.message });
  const rows = data || [];

  // Attach a chat-message count per session (Task 5's "movie chat
  // indicator") in one extra query instead of one per row.
  const sessionKeys = rows.map(r => r.session_key).filter(Boolean);
  if (sessionKeys.length) {
    try {
      const { data: chatRows } = await supabase.from('movie_chat_messages')
        .select('session_key').eq('couple_id', req.params.coupleId).in('session_key', sessionKeys);
      const counts = {};
      (chatRows || []).forEach(c => { counts[c.session_key] = (counts[c.session_key] || 0) + 1; });
      rows.forEach(r => { r.chat_count = r.session_key ? (counts[r.session_key] || 0) : 0; });
    } catch (_) { rows.forEach(r => { r.chat_count = 0; }); }
  } else {
    rows.forEach(r => { r.chat_count = 0; });
  }
  return res.json(rows);
});

// ── Reactions (emoji while watching): short-lived, memory only, never saved ──
// The Android app cannot join Supabase Realtime, so it sends and polls these two routes.
// `relay: true` (Android) also broadcasts to the web page's realtime channel so the partner's browser shows it.
const REACTION_TTL_MS = 10000;
const REACTION_EMOJI = new Set(['❤️', '😂', '🥺', '😱', '😘']);
const reactionBuf = new Map();   // coupleId -> [{ at, role, emoji }]
const reactionChannels = new Map();

router.post('/:coupleId/reaction', (req, res) => {
  const { role, emoji, relay } = req.body || {};
  const coupleId = req.params.coupleId;
  if (!['user1', 'user2'].includes(role) || !REACTION_EMOJI.has(emoji)) return res.status(400).json({ error: 'Invalid reaction.' });
  const now = Date.now();
  const list = (reactionBuf.get(coupleId) || []).filter(x => now - x.at < REACTION_TTL_MS);
  const last = list.length ? list[list.length - 1].at : 0;
  list.push({ at: Math.max(now, last + 1), role, emoji });   // strictly increasing: the app never shows one twice
  reactionBuf.set(coupleId, list.slice(-30));
  if (relay) {
    try {
      let ch = reactionChannels.get(coupleId);
      if (!ch) { ch = supabase.channel('watch_together:' + coupleId); reactionChannels.set(coupleId, ch); }
      Promise.resolve(ch.send({ type: 'broadcast', event: 'wt_reaction', payload: { emoji, from: role } })).catch(() => {});
    } catch (e) { /* the app still gets it by polling */ }
  }
  res.json({ ok: true });
});

router.get('/:coupleId/reactions', (req, res) => {
  const after = Number(req.query.after) || 0;
  const now = Date.now();
  res.json((reactionBuf.get(req.params.coupleId) || []).filter(x => x.at > after && now - x.at < REACTION_TTL_MS));
});


// ═══════════════════════════════════════════════════════
//  Shared ad break ("intermission") while a movie plays.
//  Every AD_BREAK_GAP_MS of watching, BOTH phones show one ad at the same moment, and close it by themselves.
//   POST /:coupleId/ad-break       { role }   asks for a break (the server refuses if the last one was < AD_BREAK_GAP_MS ago)
//   GET  /:coupleId/ad-break                  the current break (or null) + server time, polled by both phones
//   POST /:coupleId/ad-break/done  { role, id } this phone's ad has finished / was closed
//  Held in memory like reactions: a break lasts a minute or two, so a server restart simply skips one.
// ═══════════════════════════════════════════════════════
const AD_BREAK_GAP_MS = 15 * 60 * 1000;
const AD_BREAK_LEAD_MS = 2500;        // both phones start together: the break begins this far in the future
const AD_BREAK_MAX_MS = 3 * 60 * 1000; // a stuck break is dropped after this, so the movie can always resume
const adBreaks = new Map();           // coupleId -> { id, startAt, lastAt, done: Set(role), startedBy }

function adBreakView(b, now) {
  if (!b || now - b.startAt > AD_BREAK_MAX_MS) return null;
  return { id: b.id, startAt: b.startAt, startedBy: b.startedBy, done: [...b.done], allDone: b.done.size >= 2 };
}

router.post('/:coupleId/ad-break', (req, res) => {
  const { role } = req.body || {};
  if (!['user1', 'user2'].includes(role)) return res.status(400).json({ error: 'Invalid role.' });
  const coupleId = req.params.coupleId, now = Date.now();
  const cur = adBreaks.get(coupleId);
  if (cur && now - cur.lastAt < AD_BREAK_GAP_MS) {
    return res.json({ ok: true, created: false, serverNow: now, break: adBreakView(cur, now) });
  }
  const b = { id: now, startAt: now + AD_BREAK_LEAD_MS, lastAt: now, done: new Set(), startedBy: role };
  adBreaks.set(coupleId, b);
  res.json({ ok: true, created: true, serverNow: now, break: adBreakView(b, now) });
});

router.get('/:coupleId/ad-break', (req, res) => {
  const now = Date.now();
  res.json({ serverNow: now, break: adBreakView(adBreaks.get(req.params.coupleId), now) });
});

router.post('/:coupleId/ad-break/done', (req, res) => {
  const { role, id } = req.body || {};
  if (!['user1', 'user2'].includes(role)) return res.status(400).json({ error: 'Invalid role.' });
  const b = adBreaks.get(req.params.coupleId);
  if (b && Number(id) === b.id) b.done.add(role);
  const now = Date.now();
  res.json({ ok: true, serverNow: now, break: adBreakView(b, now) });
});

module.exports = router;
module.exports._test = { AD_BREAK_GAP_MS };
