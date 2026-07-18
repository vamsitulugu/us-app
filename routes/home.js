// routes/home.js
// ════════════════════════════════════════════════
//  Virtual Home — Backend API Routes
// ════════════════════════════════════════════════
const express  = require('express');
const supabase = require('../middleware/supabase');
const router   = express.Router();

let _sendPushToPartner;
try { _sendPushToPartner = require('./auth').sendPushToPartner; } catch (_) {}

// ─── FURNITURE ──────────────────────────────────

// GET all furniture for a couple
router.get('/furniture/:coupleId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('home_furniture')
      .select('id, room, obj_type, label, pos_x, pos_y, pos_z, rot_y, scale, color')
      .eq('couple_id', req.params.coupleId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST add furniture
router.post('/furniture', async (req, res) => {
  try {
    const { coupleId, room, obj_type, obj_key, label, pos_x, pos_y, pos_z, rot_y, scale, color, meta, senderRole, myName } = req.body;
    if (!coupleId || !room || !obj_type) return res.status(400).json({ error: 'Missing required fields' });
    const { data, error } = await supabase
      .from('home_furniture')
      .insert([{
        couple_id: coupleId, room, obj_type, obj_key: obj_key || obj_type,
        label: label || obj_type, pos_x: pos_x || 0, pos_y: pos_y || 0,
        pos_z: pos_z || 0, rot_y: rot_y || 0, scale: scale || 1,
        color: color || '#ffffff', meta: meta || {},
        updated_at: new Date().toISOString()
      }])
      .select().single();
    if (error) throw error;

    if (_sendPushToPartner && senderRole) {
      _sendPushToPartner(coupleId, senderRole, {
        title: '🏠 New Furniture Added',
        body: (myName || 'Your partner') + ' added ' + (label || obj_type) + ' to the ' + room,
        icon: '/icons/icon-192.png',
        tag: 'home-furniture',
        url: '/?page=virtualhome'
      }).catch(() => {});
    }

    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT update furniture position/rotation/color
router.put('/furniture/:id', async (req, res) => {
  try {
    const { pos_x, pos_y, pos_z, rot_y, scale, color, label, meta } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (pos_x   !== undefined) updates.pos_x  = pos_x;
    if (pos_y   !== undefined) updates.pos_y  = pos_y;
    if (pos_z   !== undefined) updates.pos_z  = pos_z;
    if (rot_y   !== undefined) updates.rot_y  = rot_y;
    if (scale   !== undefined) updates.scale  = scale;
    if (color   !== undefined) updates.color  = color;
    if (label   !== undefined) updates.label  = label;
    if (meta    !== undefined) updates.meta   = meta;
    const { data, error } = await supabase
      .from('home_furniture').update(updates)
      .eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE furniture
router.delete('/furniture/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('home_furniture').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── PETS ────────────────────────────────────────

// GET pets for a couple
router.get('/pets/:coupleId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('home_pets').select('*').eq('couple_id', req.params.coupleId);
    if (error) throw error;
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST create pet
router.post('/pets', async (req, res) => {
  try {
    const { coupleId, name, species, color, senderRole, myName } = req.body;
    if (!coupleId) return res.status(400).json({ error: 'Missing coupleId' });
    const { data, error } = await supabase
      .from('home_pets')
      .insert([{
        couple_id: coupleId,
        name: name || 'Buddy',
        species: species || 'cat',
        color: color || '#f4a261',
        mood: 'happy', hunger: 80, happiness: 80,
        last_fed: new Date().toISOString(),
        last_played: new Date().toISOString()
      }])
      .select().single();
    if (error) throw error;

    if (_sendPushToPartner && senderRole) {
      _sendPushToPartner(coupleId, senderRole, {
        title: '🐾 New Pet Adopted!',
        body: (myName || 'Your partner') + ' brought home ' + (name || 'a new pet') + ' the ' + (species || 'cat'),
        icon: '/icons/icon-192.png',
        tag: 'home-pet',
        url: '/?page=virtualhome'
      }).catch(() => {});
    }

    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH pet — feed / play / update mood
router.patch('/pets/:id', async (req, res) => {
  try {
    const { action, name, color } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (action === 'feed') {
      updates.hunger = 100;
      updates.mood = 'happy';
      updates.last_fed = new Date().toISOString();
    } else if (action === 'play') {
      updates.happiness = 100;
      updates.mood = 'playful';
      updates.last_played = new Date().toISOString();
    }
    if (name  !== undefined) updates.name  = name;
    if (color !== undefined) updates.color = color;
    const { data, error } = await supabase
      .from('home_pets').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── MEMORY OBJECTS ──────────────────────────────

router.get('/memories/:coupleId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('home_memory_objects').select('*')
      .eq('couple_id', req.params.coupleId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/memories', async (req, res) => {
  try {
    const { coupleId, room, memory_type, ref_id, label, thumbnail, pos_x, pos_y, pos_z, meta, senderRole, myName } = req.body;
    if (!coupleId || !room) return res.status(400).json({ error: 'Missing required fields' });
    const { data, error } = await supabase
      .from('home_memory_objects')
      .insert([{
        couple_id: coupleId, room,
        memory_type: memory_type || 'note',
        ref_id: ref_id || null, label: label || '',
        thumbnail: thumbnail || null,
        pos_x: pos_x || 0, pos_y: pos_y || 1.5, pos_z: pos_z || 0,
        rot_y: 0, meta: meta || {}
      }])
      .select().single();
    if (error) throw error;

    if (_sendPushToPartner && senderRole) {
      _sendPushToPartner(coupleId, senderRole, {
        title: '🖼️ New Memory Object Placed',
        body: (myName || 'Your partner') + ' placed ' + (label || 'a memory') + ' in the ' + room,
        icon: '/icons/icon-192.png',
        tag: 'home-memory',
        url: '/?page=virtualhome'
      }).catch(() => {});
    }

    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/memories/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('home_memory_objects').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── SETTINGS ────────────────────────────────────

router.get('/settings/:coupleId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('home_settings').select('*').eq('couple_id', req.params.coupleId).maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    res.json(data || { theme: 'cozy', time_of_day: 'day', weather: 'clear', music_track: 'lofi', active_room: 'living' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/settings/:coupleId', async (req, res) => {
  try {
    const { theme, time_of_day, weather, music_track, active_room } = req.body;
    const { data, error } = await supabase
      .from('home_settings')
      .upsert({
        couple_id: req.params.coupleId,
        theme, time_of_day, weather, music_track, active_room,
        updated_at: new Date().toISOString()
      }, { onConflict: 'couple_id' })
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── PRESENCE ────────────────────────────────────

router.put('/presence', async (req, res) => {
  try {
    const { coupleId, userRole, room, avatar_x, avatar_z } = req.body;
    if (!coupleId || !userRole) return res.status(400).json({ error: 'Missing fields' });
    const { data, error } = await supabase
      .from('home_presence')
      .upsert({
        couple_id: coupleId, user_role: userRole,
        room: room || 'living',
        avatar_x: avatar_x || 0, avatar_z: avatar_z || 0,
        last_seen: new Date().toISOString()
      }, { onConflict: 'couple_id,user_role' })
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/presence/:coupleId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('home_presence').select('user_role, room, last_seen').eq('couple_id', req.params.coupleId);
    if (error) throw error;
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;