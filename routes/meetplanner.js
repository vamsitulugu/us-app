// ═══════════════════════════════════════════════════════
//  Meet Planner Routes v2 — City-based multi-stop itineraries
//  Free-API only (Nominatim / Overpass / OSRM calls happen
//  client-side in meetplanner.html — no keys, no server proxy).
//  This file persists plans + pushes completed meetups into
//  Memory Globe (globe_memories table).
//
//  Drop-in replacement for routes/meetplanner.js — all v1
//  fields (loc1/loc2/mid*) are still accepted for backward
//  compatibility with any already-saved plans.
// ═══════════════════════════════════════════════════════
const express  = require('express');
const supabase = require('../middleware/supabase');
const router   = express.Router();

let _sendPushToPartner;
try { _sendPushToPartner = require('./auth').sendPushToPartner; } catch (_) {}

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

// ─── CREATE plan (v2: city + stops) ────────────────────
router.post('/', async (req, res) => {
  const { coupleId, plan, senderRole, myName } = req.body;
  if (!coupleId || !plan) return res.status(400).json({ error: 'Missing data' });

  const { data, error } = await supabase
    .from('meetup_plans')
    .insert({
      couple_id:    coupleId,
      title:        plan.title || 'Our Meetup',
      meet_date:    plan.meetDate || null,
      budget:       plan.budget ?? null,
      currency:     plan.currency || 'INR',

      // v1 legacy fields — kept so old clients / old saved plans still work
      loc1_label:   plan.loc1Label || null,
      loc1_lat:     plan.loc1Lat ?? null,
      loc1_lng:     plan.loc1Lng ?? null,
      loc2_label:   plan.loc2Label || null,
      loc2_lat:     plan.loc2Lat ?? null,
      loc2_lng:     plan.loc2Lng ?? null,
      mid_lat:      plan.midLat ?? null,
      mid_lng:      plan.midLng ?? null,
      mid_city:     plan.midCity || plan.cityName || null,
      mid_state:    plan.midState || null,
      mid_country:  plan.midCountry || null,

      // v2 fields
      city_name:          plan.cityName || null,
      city_lat:           plan.cityLat ?? null,
      city_lng:           plan.cityLng ?? null,
      stops:              plan.stops || [],
      route_geometry:     plan.routeGeometry || null,
      total_distance_km:  plan.totalDistanceKm ?? null,
      total_duration_min: plan.totalDurationMin ?? null,

      travel_mode:  plan.travelMode || 'car',
      distance_km:  plan.distanceKm ?? plan.totalDistanceKm ?? null,
      duration_min: plan.durationMin ?? plan.totalDurationMin ?? null,
      checklist:    plan.checklist || [],
      notes:        plan.notes || null,
      status:       'planned',
      created_by:   plan.createdBy || 'user1'
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Notify partner about the new meetup plan
  if (_sendPushToPartner && senderRole) {
    const place = plan.cityName || plan.midCity || 'a new spot';
    _sendPushToPartner(coupleId, senderRole, {
      title: '💕 New Meetup Planned',
      body: (myName || 'Your partner') + ' planned a meetup in ' + place,
      icon: '/icons/icon-192.png',
      tag: 'meetplan',
      url: '/?page=meetplanner'
    }).catch(() => {});
  }

  return res.json(data);
});

// ─── UPDATE plan (edit details, stops, checklist, status) ─
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
    cityName: 'city_name', cityLat: 'city_lat', cityLng: 'city_lng',
    stops: 'stops', routeGeometry: 'route_geometry',
    totalDistanceKm: 'total_distance_km', totalDurationMin: 'total_duration_min',
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
  const { coupleId, mood, photos, extraNotes, senderRole, myName } = req.body;
  if (!coupleId) return res.status(400).json({ error: 'coupleId required' });

  const { data: plan, error: planErr } = await supabase
    .from('meetup_plans')
    .select('*')
    .eq('id', req.params.id)
    .eq('couple_id', coupleId)
    .maybeSingle();

  if (planErr) return res.status(500).json({ error: planErr.message });
  if (!plan) return res.status(404).json({ error: 'Plan not found' });

  if (plan.globe_synced && plan.globe_memory_id) {
    return res.json({ ok: true, alreadySynced: true, globeMemoryId: plan.globe_memory_id, plan });
  }

  // Build itinerary summary — prefer v2 stops, fall back to v1 midpoint text
  let itineraryText;
  const stops = Array.isArray(plan.stops) ? plan.stops : [];
  if (stops.length) {
    const ordered = [...stops].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    itineraryText = 'Itinerary: ' + ordered.map(s => s.name).join(' → ') + '.';
  } else {
    itineraryText = `Met up at the midpoint between ${plan.loc1_label || 'Partner A'} and ${plan.loc2_label || 'Partner B'}.`;
  }

  const cityLabel = plan.city_name || plan.mid_city || 'Our Meetup Spot';
  const anchor = stops.find(s => s.isAnchor) || stops[0];

  const memoryPayload = {
    couple_id:        coupleId,
    city:             cityLabel,
    country:          plan.mid_country || '',
    state:            plan.mid_state || null,
    lat:              anchor?.lat ?? plan.city_lat ?? plan.mid_lat,
    lng:              anchor?.lng ?? plan.city_lng ?? plan.mid_lng,
    trip_name:        plan.title || 'Our Meetup',
    date_from:        plan.meet_date || new Date().toISOString().slice(0, 10),
    date_to:          plan.meet_date || null,
    mood:             mood || null,
    weather:          null,
    temperature:      null,
    trip_cost:        plan.budget ?? null,
    currency:         plan.currency || 'INR',
    notes:            [
                        itineraryText,
                        plan.total_distance_km ? `Total distance: ${plan.total_distance_km} km.` : '',
                        plan.total_duration_min ? `Total travel time: ${Math.round(plan.total_duration_min)} min.` : '',
                        plan.notes || '',
                        extraNotes || ''
                      ].filter(Boolean).join(' '),
    favorite_moment:  null,
    restaurants:      stops.filter(s => s.category === 'restaurant').map(s => s.name),
    hotels:           stops.filter(s => s.category === 'hotel').map(s => s.name),
    gifts:            [],
    by_role:          plan.created_by || 'user1'
  };

  const { data: globeMemory, error: globeErr } = await supabase
    .from('globe_memories')
    .insert(memoryPayload)
    .select()
    .single();

  if (globeErr) return res.status(500).json({ error: 'Failed to create Memory Globe entry: ' + globeErr.message });

  if (Array.isArray(photos) && photos.length) {
    const mediaRows = photos.map(p => ({
      memory_id:  globeMemory.id,
      couple_id:  coupleId,
      type:       'photo',
      url:        p
    }));
    await supabase.from('globe_memory_media').insert(mediaRows);
  }

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

  // Notify partner that the meetup was marked complete and saved to the globe
  if (_sendPushToPartner && senderRole) {
    _sendPushToPartner(coupleId, senderRole, {
      title: '🌍 Meetup Saved to Memory Globe',
      body: (myName || 'Your partner') + ' marked "' + (plan.title || 'your meetup') + '" complete',
      icon: '/icons/icon-192.png',
      tag: 'meetup-complete',
      url: '/?page=globe'
    }).catch(() => {});
  }

  return res.json({ ok: true, alreadySynced: false, globeMemoryId: globeMemory.id, plan: updatedPlan });
});

module.exports = router;