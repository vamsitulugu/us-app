// routes/home_living.js
// ════════════════════════════════════════════════
//  Phase 6 backend — Living World persistence
//  Pet CRUD, avatar customization, and per-couple
//  living-world settings (time-of-day overrides, etc.
//  reuse existing app_state/settings tables where the
//  data is already covered; pets get their own table
//  since they have rich, frequently-updated stats).
//  NEW ROUTE FILE — does not modify routes/home.js,
//  routes/data.js, or routes/globe.js.
// ════════════════════════════════════════════════
const express  = require('express');
const supabase = require('../middleware/supabase');
const router   = express.Router();

// ─── PETS ───────────────────────────────────────────────
// Expected Supabase table: home_pets
//   id (uuid, default gen_random_uuid()), couple_id (text/uuid),
//   species (text), name (text), owner_role (text),
//   stats (jsonb), pos_x (float8), pos_z (float8),
//   created_at (timestamptz default now()), updated_at (timestamptz)

// GET all pets for a couple
router.get('/pets/:coupleId', async (req, res) => {
  try {
    const { coupleId } = req.params;
    const { data, error } = await supabase
      .from('home_pets')
      .select('*')
      .eq('couple_id', coupleId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST adopt a new pet
router.post('/pets', async (req, res) => {
  try {
    const { coupleId, species, name, owner_role, stats, pos_x, pos_z } = req.body;
    if (!coupleId || !species) return res.status(400).json({ error: 'Missing coupleId or species' });

    const { data, error } = await supabase
      .from('home_pets')
      .insert([{
        couple_id: coupleId,
        species,
        name: name || species,
        owner_role: owner_role || 'user1',
        stats: stats || { mood: 80, energy: 80, happiness: 80, health: 100, friendship: 0, level: 1, xp: 0 },
        pos_x: pos_x ?? 1.2,
        pos_z: pos_z ?? 1.2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH update pet (stats, position, name, feed/play actions, rename)
router.patch('/pets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { coupleId, name, stats, pos_x, pos_z } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (name !== undefined)  updates.name = name;
    if (stats !== undefined) updates.stats = stats;
    if (pos_x !== undefined) updates.pos_x = pos_x;
    if (pos_z !== undefined) updates.pos_z = pos_z;

    let query = supabase.from('home_pets').update(updates).eq('id', id);
    if (coupleId) query = query.eq('couple_id', coupleId);

    const { data, error } = await query.select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE a pet (release/rehome — not part of spec UI yet, included for completeness)
router.delete('/pets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { coupleId } = req.body;
    let query = supabase.from('home_pets').delete().eq('id', id);
    if (coupleId) query = query.eq('couple_id', coupleId);
    const { error } = await query;
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── AVATAR CUSTOMIZATION ───────────────────────────────
// Stored as JSON blobs inside the existing home_settings table
// (same table HomeAPI.settings.get/save already reads/writes for
// active_room / time_of_day / weather), keyed per role. This avoids
// introducing a new table for a small, infrequently-changed payload.
// Expected existing table: home_settings (couple_id PK, ...jsonb cols
// or a single settings jsonb column — adapting to either shape below).

router.get('/avatar-customization/:coupleId', async (req, res) => {
  try {
    const { coupleId } = req.params;
    const { data, error } = await supabase
      .from('home_settings')
      .select('avatar_custom_user1, avatar_custom_user2')
      .eq('couple_id', coupleId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') throw error;
    res.json({
      user1: data && data.avatar_custom_user1 ? data.avatar_custom_user1 : null,
      user2: data && data.avatar_custom_user2 ? data.avatar_custom_user2 : null
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/avatar-customization', async (req, res) => {
  try {
    const { coupleId, role, customization } = req.body;
    if (!coupleId || !role || !customization) return res.status(400).json({ error: 'Missing data' });

    const column = role === 'user2' ? 'avatar_custom_user2' : 'avatar_custom_user1';
    const { error } = await supabase
      .from('home_settings')
      .upsert({
        couple_id: coupleId,
        [column]: customization,
        updated_at: new Date().toISOString()
      }, { onConflict: 'couple_id' });

    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── LIVING WORLD SESSION STATE (avatar last position, sit/sleep state) ──
// Lightweight resume-where-you-left-off support — separate from the
// Realtime channel (which only handles live sync while both are online).
router.get('/living-state/:coupleId', async (req, res) => {
  try {
    const { coupleId } = req.params;
    const { data, error } = await supabase
      .from('home_settings')
      .select('living_state')
      .eq('couple_id', coupleId)
      .maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    res.json((data && data.living_state) || null);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/living-state', async (req, res) => {
  try {
    const { coupleId, state } = req.body;
    if (!coupleId || !state) return res.status(400).json({ error: 'Missing data' });
    const { error } = await supabase
      .from('home_settings')
      .upsert({
        couple_id: coupleId,
        living_state: state,
        updated_at: new Date().toISOString()
      }, { onConflict: 'couple_id' });
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;