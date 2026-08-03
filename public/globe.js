// routes/globe.js
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

let _sendPushToPartner;
try { _sendPushToPartner = require('./auth').sendPushToPartner; } catch (_) {}

// GET all memories for a couple
router.get('/:coupleId', async (req, res) => {
  try {
    const { coupleId } = req.params;
    const { data, error } = await supabase
      .from('globe_memories')
      .select(`
        *,
        globe_memory_media (*)
      `)
      .eq('couple_id', coupleId)
      .order('date_from', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST create memory
router.post('/', async (req, res) => {
  try {
    const { coupleId, memory, senderRole, myName } = req.body;
    if (!coupleId || !memory) return res.status(400).json({ error: 'Missing data' });

    const { data, error } = await supabase
      .from('globe_memories')
      .insert([{ ...memory, couple_id: coupleId }])
      .select()
      .single();

    if (error) throw error;

    // Notify partner about the new memory pin
    if (_sendPushToPartner && senderRole) {
      const place = [memory.city, memory.country].filter(Boolean).join(', ') || 'a new place';
      _sendPushToPartner(coupleId, senderRole, {
        title: '🌍 New Memory on the Globe',
        body: (myName || 'Your partner') + ' added ' + place,
        icon: '/icons/icon-192.png',
        tag: 'globe-memory',
        url: '/?page=globe'
      }).catch(() => {});
    }

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT update memory
// Previously this updated by `id` alone with no check that the memory
// actually belongs to the caller's couple — anyone who obtained a memory
// UUID (e.g. from a shared screenshot or a synced-session devtools poke)
// could edit another couple's globe memory. Now requires coupleId and
// scopes the update to it, the same pattern chat.js/music.js already use.
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { memory, coupleId } = req.body;
    if (!coupleId) return res.status(400).json({ error: 'coupleId required' });

    const { data, error } = await supabase
      .from('globe_memories')
      .update(memory)
      .eq('id', id)
      .eq('couple_id', coupleId)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Memory not found' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE memory — same ownership fix as PUT above.
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const coupleId = req.body?.coupleId || req.query.coupleId;
    if (!coupleId) return res.status(400).json({ error: 'coupleId required' });

    const { data, error } = await supabase
      .from('globe_memories')
      .delete()
      .eq('id', id)
      .eq('couple_id', coupleId)
      .select();

    if (error) throw error;
    if (!data || !data.length) return res.status(404).json({ error: 'Memory not found' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST add media to memory. Accepts either a single media object
// (`media`) for backward compatibility, or an array of media objects
// (`mediaList`) so a bulk photo add can insert every row in one
// request instead of one round-trip per photo.
router.post('/:memoryId/media', async (req, res) => {
  try {
    const { memoryId } = req.params;
    const { coupleId, media, mediaList, senderRole, myName } = req.body;

    const rows = Array.isArray(mediaList) && mediaList.length
      ? mediaList.map((m) => ({ ...m, memory_id: memoryId, couple_id: coupleId }))
      : [{ ...media, memory_id: memoryId, couple_id: coupleId }];

    const { data, error } = await supabase
      .from('globe_memory_media')
      .insert(rows)
      .select();

    if (error) throw error;

    if (_sendPushToPartner && senderRole) {
      _sendPushToPartner(coupleId, senderRole, {
        title: '🌍 New Photo Added to Globe',
        body: (myName || 'Your partner') + (rows.length > 1 ? ` added ${rows.length} photos to a memory` : ' added a photo to a memory'),
        icon: '/icons/icon-192.png',
        tag: 'globe-media',
        url: '/?page=globe'
      }).catch(() => {});
    }

    // Keep the single-object response shape when called the old way,
    // so any other existing caller of this endpoint is unaffected.
    res.json(Array.isArray(mediaList) && mediaList.length ? data : data[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE media — was previously deletable by anyone who knew the media
// UUID; now scoped to the caller's couple the same way as memory delete.
router.delete('/media/:mediaId', async (req, res) => {
  try {
    const { mediaId } = req.params;
    const coupleId = req.body?.coupleId || req.query.coupleId;
    if (!coupleId) return res.status(400).json({ error: 'coupleId required' });

    const { data, error } = await supabase
      .from('globe_memory_media')
      .delete()
      .eq('id', mediaId)
      .eq('couple_id', coupleId)
      .select();

    if (error) throw error;
    if (!data || !data.length) return res.status(404).json({ error: 'Media not found' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET stats for a couple
router.get('/:coupleId/stats/summary', async (req, res) => {
  try {
    const { coupleId } = req.params;
    const { data, error } = await supabase
      .from('globe_memories')
      .select('country, city, trip_cost, currency, mood, date_from')
      .eq('couple_id', coupleId);

    if (error) throw error;

    const countries = new Set((data || []).map(m => m.country));
    const cities = new Set((data || []).map(m => m.city));
    const totalCost = (data || []).reduce((s, m) => s + (parseFloat(m.trip_cost) || 0), 0);
    const moods = {};
    (data || []).forEach(m => { if (m.mood) moods[m.mood] = (moods[m.mood] || 0) + 1; });

    res.json({
      totalMemories: (data || []).length,
      totalCountries: countries.size,
      totalCities: cities.size,
      totalCost,
      topMood: Object.entries(moods).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
      recentMemory: (data || []).sort((a, b) => (b.date_from || '').localeCompare(a.date_from || ''))[0] || null
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;