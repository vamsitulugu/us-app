// ═══════════════════════════════════════════════════════
//  Meet Planner Routes — Live Meet Planner feature
//  Free-API only (OSM/Nominatim/Open-Meteo/OSRM/Overpass
//  calls happen client-side in meetplanner.html).
//  This file only persists plans + pushes completed
//  meetups into Memory Globe (globe_memories table).
// ═══════════════════════════════════════════════════════
const express  = require('express');
const supabase = require('../middleware/supabase');
const router   = express.Router();

// ─── LIST plans for a couple ───────────────────────────
router.get('/:coupleId', async (req, res) => {
  const { data, error } = await supabase
    .from('meetup_plans')
    .select('*')
    .eq('couple_id', req.params.coupleId)
    .order('meet_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ─── GET single plan ────────────────────────────────────
router.get('/plan/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('meetup_plans')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Plan not found' });
  return res.json(data);
});

// ─── CREATE plan ────────────────────────────────────────
router.post('/', async (req, res) => {
  const { coupleId, plan } = req.body;
  if (!coupleId || !plan) return res.status(400).json({ error: 'Missing data' });

  const { data, error } = await supabase
    .from('meetup_plans')
    .insert({
      couple_id:    coupleId,
      title:        plan.title || 'Our Meetup',
      meet_date:    plan.meetDate || null,
      budget:       plan.budget ?? null,
      currency:     plan.currency || 'INR',
      loc1_label:   plan.loc1Label || null,
      loc1_lat:     plan.loc1Lat ?? null,
      loc1_lng:     plan.loc1Lng ?? null,
      loc2_label:   plan.loc2Label || null,
      loc2_lat:     plan.loc2Lat ?? null,
      loc2_lng:     plan.loc2Lng ?? null,
      mid_lat:      plan.midLat ?? null,
      mid_lng:      plan.midLng ?? null,
      mid_city:     plan.midCity || null,
      mid_state:    plan.midState || null,
      mid_country:  plan.midCountry || null,
      travel_mode:  plan.travelMode || 'car',
      distance_km:  plan.distanceKm ?? null,
      duration_min: plan.durationMin ?? null,
      checklist:    plan.checklist || [],
      notes:        plan.notes || null,
      status:       'planned',
      created_by:   plan.createdBy || 'user1'
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ─── UPDATE plan (edit details, checklist, status, etc.) ─
router.patch('/:id', async (req, res) => {
  const { coupleId, plan } = req.body;
  if (!coupleId || !plan) return res.status(400).json({ error: 'Missing data' });

  const updates = {};
  const map = {
    title: 'title', meetDate: 'meet_date', budget: 'budget', currency: 'currency',
    loc1Label: 'loc1_label', loc1Lat: 'loc1_lat', loc1Lng: 'loc1_lng',
    loc2Label: 'loc2_label', loc2Lat: 'loc2_lat', loc2Lng: 'loc2_lng',
    midLat: 'mid_lat', midLng: 'mid_lng', midCity: 'mid_city',
    midState: 'mid_state', midCountry: 'mid_country',
    travelMode: 'travel_mode', distanceKm: 'distance_km', durationMin: 'duration_min',
    checklist: 'checklist', notes: 'notes', status: 'status'
  };
  Object.entries(map).forEach(([k, col]) => {
    if (plan[k] !== undefined) updates[col] = plan[k];
  });

  const { data, error } = await supabase
    .from('meetup_plans')
    .update(updates)
    .eq('id', req.params.id)
    .eq('couple_id', coupleId)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ─── DELETE plan ────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const { coupleId } = req.body;
  await supabase.from('meetup_plans').delete()
    .eq('id', req.params.id).eq('couple_id', coupleId);
  return res.json({ ok: true });
});

// ─── COMPLETE plan → push to Memory Globe ──────────────
// Idempotent: if globe_synced is already true, returns the
// existing globe_memory_id instead of creating a duplicate.
router.post('/:id/complete', async (req, res) => {
  const { coupleId, mood, photos, extraNotes } = req.body;
  if (!coupleId) return res.status(400).json({ error: 'coupleId required' });

  const { data: plan, error: planErr } = await supabase
    .from('meetup_plans')
    .select('*')
    .eq('id', req.params.id)
    .eq('couple_id', coupleId)
    .maybeSingle();

  if (planErr) return res.status(500).json({ error: planErr.message });
  if (!plan) return res.status(404).json({ error: 'Plan not found' });

  // Already synced — don't create a duplicate Memory Globe entry
  if (plan.globe_synced && plan.globe_memory_id) {
    return res.json({ ok: true, alreadySynced: true, globeMemoryId: plan.globe_memory_id, plan });
  }

  // Build the globe_memories row, matching routes/globe.js's insert shape exactly
  const memoryPayload = {
    couple_id:        coupleId,
    city:             plan.mid_city || 'Our Meetup Spot',
    country:          plan.mid_country || '',
    state:            plan.mid_state || null,
    lat:              plan.mid_lat,
    lng:              plan.mid_lng,
    trip_name:        plan.title || 'Our Meetup',
    date_from:        plan.meet_date || new Date().toISOString().slice(0, 10),
    date_to:          plan.meet_date || null,
    mood:             mood || null,
    weather:          null,
    temperature:      null,
    trip_cost:        plan.budget ?? null,
    currency:         plan.currency || 'INR',
    notes:            [
                        `Met up at the midpoint between ${plan.loc1_label || 'Partner A'} and ${plan.loc2_label || 'Partner B'}.`,
                        plan.notes || '',
                        extraNotes || ''
                      ].filter(Boolean).join(' '),
    favorite_moment:  null,
    restaurants:      [],
    hotels:           [],
    gifts:            [],
    by_role:          plan.created_by || 'user1'
  };

  const { data: globeMemory, error: globeErr } = await supabase
    .from('globe_memories')
    .insert(memoryPayload)
    .select()
    .single();

  if (globeErr) return res.status(500).json({ error: 'Failed to create Memory Globe entry: ' + globeErr.message });

  // Attach photos as globe_memory_media rows, same shape globe.js uses
  if (Array.isArray(photos) && photos.length) {
    const mediaRows = photos.map(p => ({
      memory_id:  globeMemory.id,
      couple_id:  coupleId,
      type:       'photo',
      data_url:   p
    }));
    await supabase.from('globe_memory_media').insert(mediaRows);
  }

  // Mark the plan as completed + synced, with the guard fields set
  const { data: updatedPlan, error: updateErr } = await supabase
    .from('meetup_plans')
    .update({
      status:          'completed',
      globe_synced:    true,
      globe_memory_id: globeMemory.id
    })
    .eq('id', plan.id)
    .select()
    .single();

  if (updateErr) return res.status(500).json({ error: updateErr.message });

  return res.json({ ok: true, alreadySynced: false, globeMemoryId: globeMemory.id, plan: updatedPlan });
});

module.exports = router;