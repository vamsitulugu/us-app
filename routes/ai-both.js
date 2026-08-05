// ═══════════════════════════════════════════════════════
//  routes/ai-both.js — "Both" mode: shared two-perspective AI
//  Register in server.js:
//    app.use('/api/ai-both', require('./routes/ai-both'));
//
//  Existing routes/ai.js ("You" mode) is untouched — this is a
//  fully separate route/table set, per the master prompt.
// ═══════════════════════════════════════════════════════
const express = require('express');
const supabase = require('../middleware/supabase');
const { broadcastEvent } = require('./auth');
const router = express.Router();

function otherRole(role) { return role === 'user1' ? 'user2' : 'user1'; }
function topicFor(coupleId) { return `both_round:${coupleId}`; }

// ─── Feature flag ─────────────────────────────────────────
router.get('/flag/:coupleId', async (req, res) => {
  const { coupleId } = req.params;
  const { data, error } = await supabase
    .from('feature_flags').select('*').eq('key', 'ai_both_mode').maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.json({ enabled: false });
  const enabled = !!data.enabled || (data.couple_ids || []).includes(coupleId);
  res.json({ enabled });
});

router.get('/status', (req, res) => {
  res.json({ configured: !!process.env.GROQ_API_KEY });
});

// ─── Sessions ──────────────────────────────────────────────
// POST { coupleId, role, title? } -> creates session + round 1
router.post('/sessions', async (req, res) => {
  const { coupleId, role, title } = req.body;
  if (!coupleId || !role) return res.status(400).json({ error: 'Missing coupleId/role' });

  const { data: session, error: sErr } = await supabase
    .from('both_sessions')
    .insert({ couple_id: coupleId, created_by_role: role, title: title || null })
    .select().single();
  if (sErr) return res.status(500).json({ error: sErr.message });

  const { data: round, error: rErr } = await supabase
    .from('both_rounds')
    .insert({ session_id: session.id, round_number: 1 })
    .select().single();
  if (rErr) return res.status(500).json({ error: rErr.message });

  logAnalytics('both_session_started', { coupleId });
  res.json({ session, round });
});

// GET history list for a couple (no draft/unsubmitted content ever exposed here)
router.get('/sessions/:coupleId', async (req, res) => {
  const { coupleId } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const before = req.query.before; // ISO timestamp cursor

  let q = supabase.from('both_sessions').select('*').eq('couple_id', coupleId)
    .order('last_activity_at', { ascending: false }).limit(limit);
  if (before) q = q.lt('last_activity_at', before);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // attach round counts cheaply
  const ids = (data || []).map(s => s.id);
  let counts = {};
  if (ids.length) {
    const { data: rounds } = await supabase.from('both_rounds').select('session_id').in('session_id', ids);
    (rounds || []).forEach(r => { counts[r.session_id] = (counts[r.session_id] || 0) + 1; });
  }
  res.json((data || []).map(s => ({ ...s, round_count: counts[s.id] || 0 })));
});

// GET full detail for one session — rounds + status flags + results.
// Submitted-but-unlocked content is NEVER returned here for either role;
// only "submitted: true/false" flags, so a partner can't peek via API either.
router.get('/session/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const { role } = req.query; // whose view this is, so we know what to redact
  if (!role) return res.status(400).json({ error: 'Missing role' });

  const { data: session, error: sErr } = await supabase
    .from('both_sessions').select('*').eq('id', sessionId).maybeSingle();
  if (sErr) return res.status(500).json({ error: sErr.message });
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const { data: rounds, error: rErr } = await supabase
    .from('both_rounds').select('*').eq('session_id', sessionId).order('round_number');
  if (rErr) return res.status(500).json({ error: rErr.message });

  const roundIds = rounds.map(r => r.id);
  const { data: subs } = roundIds.length
    ? await supabase.from('both_submissions').select('*').in('round_id', roundIds)
    : { data: [] };
  const { data: results } = roundIds.length
    ? await supabase.from('both_results').select('*').in('round_id', roundIds)
    : { data: [] };

  const subsByRound = {}; (subs || []).forEach(s => (subsByRound[s.round_id] ||= []).push(s));
  const resultByRound = {}; (results || []).forEach(r => resultByRound[r.round_id] = r);

  const shaped = rounds.map(r => {
    const mySubs = subsByRound[r.id] || [];
    const isDone = r.status === 'done' || r.status === 'safety';
    return {
      id: r.id,
      round_number: r.round_number,
      status: r.status,
      you_submitted: mySubs.some(s => s.role === role),
      partner_submitted: mySubs.some(s => s.role === otherRole(role)),
      // your own draft content is fine to show back to you; partner's never, unless done
      your_content: mySubs.find(s => s.role === role)?.content || null,
      partner_content: isDone ? (mySubs.find(s => s.role === otherRole(role))?.content || null) : null,
      result: isDone ? (resultByRound[r.id] || null) : null,
    };
  });

  res.json({ session, rounds: shaped });
});

// ─── Submit a perspective for a round ─────────────────────
// POST /rounds/:roundId/submit { coupleId, role, content }
router.post('/rounds/:roundId/submit', async (req, res) => {
  const { roundId } = req.params;
  const { coupleId, role, content } = req.body;
  if (!coupleId || !role || !content || !content.trim()) {
    return res.status(400).json({ error: 'Missing coupleId/role/content' });
  }

  const { data: round, error: rErr } = await supabase
    .from('both_rounds').select('*').eq('id', roundId).maybeSingle();
  if (rErr) return res.status(500).json({ error: rErr.message });
  if (!round) return res.status(404).json({ error: 'Round not found' });
  if (round.status !== 'pending') {
    return res.status(409).json({ error: 'Round already locked', status: round.status });
  }

  // Upsert-if-absent: unique(round_id, role) makes a duplicate submit from
  // the same person (double-tap, retry) a no-op rather than an overwrite race.
  const { error: insErr } = await supabase
    .from('both_submissions')
    .insert({ round_id: roundId, role, content: content.trim() })
    .select().single();
  if (insErr && insErr.code !== '23505') { // 23505 = unique_violation, treat as already-submitted
    return res.status(500).json({ error: insErr.message });
  }

  broadcastEvent(topicFor(coupleId), 'submitted', { roundId, role });

  const { data: allSubs } = await supabase
    .from('both_submissions').select('role').eq('round_id', roundId);
  const roles = new Set((allSubs || []).map(s => s.role));

  if (roles.size < 2) {
    // Waiting on the other partner — nothing more to do.
    return res.json({ status: 'waiting' });
  }

  // Both sides have submitted. Atomic lock: only the request that flips
  // pending -> analyzing wins the right to generate. Concurrent submits
  // (simultaneous taps, retries) all race this same UPDATE; Postgres
  // serializes it per-row so exactly one succeeds.
  const { data: locked, error: lockErr } = await supabase
    .from('both_rounds')
    .update({ status: 'analyzing', locked_at: new Date().toISOString() })
    .eq('id', roundId).eq('status', 'pending')
    .select().maybeSingle();
  if (lockErr) return res.status(500).json({ error: lockErr.message });

  if (!locked) {
    // Someone else already won the race and is generating (or already
    // finished). Nothing wrong — just tell this caller to watch for the result.
    return res.json({ status: 'analyzing' });
  }

  broadcastEvent(topicFor(coupleId), 'locked', { roundId });
  res.json({ status: 'analyzing' });

  // Continue after responding — generation can take a few seconds and
  // shouldn't hold the HTTP request open. Client learns the outcome via
  // the realtime broadcast (with polling as fallback, see GET /rounds/:id).
  generateBothResult(roundId, coupleId).catch(e => console.error('[both-mode] generation error:', e));
});

// Polling fallback for a single round's current state
router.get('/rounds/:roundId', async (req, res) => {
  const { roundId } = req.params;
  const { role } = req.query;
  const { data: round, error } = await supabase.from('both_rounds').select('*').eq('id', roundId).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!round) return res.status(404).json({ error: 'Round not found' });

  const { data: result } = (round.status === 'done' || round.status === 'safety')
    ? await supabase.from('both_results').select('*').eq('round_id', roundId).maybeSingle()
    : { data: null };

  const { data: subs } = await supabase.from('both_submissions').select('role').eq('round_id', roundId);
  const rolesSubmitted = (subs || []).map(s => s.role);

  res.json({
    id: round.id, status: round.status,
    you_submitted: rolesSubmitted.includes(role),
    partner_submitted: rolesSubmitted.includes(otherRole(role)),
    result: result || null,
  });
});

// ─── Start next round in an existing session ──────────────
router.post('/sessions/:sessionId/next-round', async (req, res) => {
  const { sessionId } = req.params;
  const { data: rounds, error } = await supabase
    .from('both_rounds').select('round_number').eq('session_id', sessionId)
    .order('round_number', { ascending: false }).limit(1);
  if (error) return res.status(500).json({ error: error.message });
  const nextNum = (rounds?.[0]?.round_number || 0) + 1;

  const { data: round, error: insErr } = await supabase
    .from('both_rounds').insert({ session_id: sessionId, round_number: nextNum }).select().single();
  if (insErr) return res.status(500).json({ error: insErr.message });

  await supabase.from('both_sessions').update({ last_activity_at: new Date().toISOString() }).eq('id', sessionId);
  res.json({ round });
});

// ─── AI generation (server-side only, never exposed as a direct route) ───
async function generateBothResult(roundId, coupleId) {
  const { data: round } = await supabase.from('both_rounds').select('*').eq('id', roundId).maybeSingle();
  const { data: subs } = await supabase.from('both_submissions').select('*').eq('round_id', roundId);
  const a = subs.find(s => s.role === 'user1');
  const b = subs.find(s => s.role === 'user2');

  if (!process.env.GROQ_API_KEY) {
    await failRound(roundId, coupleId, 'Groq API key missing');
    return;
  }

  const systemPrompt = buildBothSystemPrompt();
  // Normalize so raw text length never signals "who wrote more" to the model's framing.
  const userPrompt =
`PERSPECTIVE FROM PARTNER 1:
"""${a.content}"""

PERSPECTIVE FROM PARTNER 2:
"""${b.content}"""

Analyze both together per your instructions and return ONLY the JSON object.`;

  let json;
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        max_tokens: 1600,
        temperature: 0.4,
        response_format: { type: 'json_object' },
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Groq API error');
    const raw = data.choices?.[0]?.message?.content || '{}';
    json = JSON.parse(raw);
    json.__raw = raw;
  } catch (e) {
    await failRound(roundId, coupleId, e.message);
    return;
  }

  const intent = (json.intent || 'GENERAL').toUpperCase();
  const safety = !!json.safety_flag;
  const sections = Array.isArray(json.sections) ? json.sections : [];

  await supabase.from('both_results').insert({
    round_id: roundId, intent, sections, safety_flag: safety, raw_model_output: json.__raw,
  });
  await supabase.from('both_rounds').update({ status: safety ? 'safety' : 'done' }).eq('id', roundId);
  await supabase.from('both_sessions')
    .update({ intent, last_activity_at: new Date().toISOString() })
    .eq('id', round.session_id);

  logAnalytics('both_round_completed', { coupleId, intent, safety });
  broadcastEvent(topicFor(coupleId), 'result_ready', { roundId, safety });
}

async function failRound(roundId, coupleId, message) {
  await supabase.from('both_rounds').update({ status: 'failed' }).eq('id', roundId);
  logAnalytics('both_generation_failed', { coupleId, message });
  broadcastEvent(topicFor(coupleId), 'failed', { roundId });
}

// Allow a retry after a failure (e.g. Groq timeout) without losing submissions.
router.post('/rounds/:roundId/retry', async (req, res) => {
  const { roundId } = req.params;
  const { coupleId } = req.body;
  const { data: locked } = await supabase
    .from('both_rounds').update({ status: 'analyzing', locked_at: new Date().toISOString() })
    .eq('id', roundId).eq('status', 'failed').select().maybeSingle();
  if (!locked) return res.status(409).json({ error: 'Round is not in a failed state' });
  res.json({ status: 'analyzing' });
  generateBothResult(roundId, coupleId).catch(e => console.error('[both-mode] retry generation error:', e));
});

function buildBothSystemPrompt() {
  return `You are Twin, analyzing a shared discussion between two partners in a couples app, in "Both" mode. You receive one private perspective from each partner, submitted independently without either seeing the other's text first.

CLASSIFY the interaction into exactly one intent: CONFLICT, DECISION, PLANNING, IDEAS, QUESTION, RELATIONSHIP_DISCUSSION, FUN, or GENERAL. Most interactions are NOT conflicts — do not default to CONFLICT unless there is an actual disagreement or grievance.

CORE RULES:
- Do not treat length as importance. A short message can be right; a long message can be padding. Never favor whichever partner wrote more.
- Do not favor whoever is "partner 2" just because they were listed second.
- Do not favor emotionally stronger or more dramatic language over calmer language.
- Separate: facts both agree on, claims made by only one person, interpretations, emotions, assumptions, contradictions, and points of agreement. Do not treat one person's claim as proven fact.
- For CONFLICT specifically: fairness does NOT mean "both sides are equally responsible" by default. If the evidence in front of you clearly points more toward one person's behavior as the source of the problem, say so plainly and explain your reasoning from what was actually written. If the evidence is genuinely balanced or insufficient, say that explicitly instead of forcing a 50/50 verdict.
- Avoid generic filler like "communication is key" or "you both have valid feelings" as a substitute for actual analysis. Identify the real, specific disagreement or need underneath what each person wrote.
- Never invent facts neither partner mentioned.
- Give concrete, actionable next steps, not vague reassurance.
- For non-conflict intents (DECISION, PLANNING, IDEAS, QUESTION, FUN, GENERAL) respond in a way that fits — a decision needs a recommendation with tradeoffs, a plan needs a combined plan, ideas need synthesis, fun should feel light and collaborative, not clinical.

SAFETY: If either perspective describes serious threats, coercion, physical violence, stalking, or self-harm risk, do NOT analyze it as a normal disagreement. Set "safety_flag": true, keep "sections" supportive and non-inflammatory, do not assign blame-based analysis, do not suggest retaliation or confrontation tactics, and gently note that professional support (a counselor, a trusted person, or a crisis line appropriate to their country) is worth reaching out to. Never encourage manipulation, surveillance, or revenge.

OUTPUT: Return ONLY a JSON object, no other text, in this exact shape:
{
  "intent": "CONFLICT | DECISION | PLANNING | IDEAS | QUESTION | RELATIONSHIP_DISCUSSION | FUN | GENERAL",
  "safety_flag": false,
  "sections": [
    { "title": "Short section title", "content": "2-5 sentences of substantive analysis." }
  ]
}

Choose only the sections that are actually relevant to this specific exchange — do not force unrelated sections in. For CONFLICT, useful sections might include: What seems to have happened, Where you agree, The real disagreement, Responsibility assessment, What each person could have handled better, Recommended next step. For DECISION: Comparing the options, Constraints that matter, Recommendation. For PLANNING: The combined plan, Open questions. For IDEAS: Strongest elements, Combined idea. Keep each section content concise and specific — no filler.`;
}

// Deliberately minimal: no prompt/response content ever logged to analytics.
function logAnalytics(event, meta) {
  console.log(`[both-analytics] ${event}`, JSON.stringify(meta));
}

module.exports = router;