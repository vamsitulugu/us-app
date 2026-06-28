// routes/globe.js
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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
    const { coupleId, memory } = req.body;
    if (!coupleId || !memory) return res.status(400).json({ error: 'Missing data' });

    const { data, error } = await supabase
      .from('globe_memories')
      .insert([{ ...memory, couple_id: coupleId }])
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT update memory
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { memory } = req.body;
    const { data, error } = await supabase
      .from('globe_memories')
      .update(memory)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE memory
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('globe_memories')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST add media to memory
router.post('/:memoryId/media', async (req, res) => {
  try {
    const { memoryId } = req.params;
    const { coupleId, media } = req.body;

    const { data, error } = await supabase
      .from('globe_memory_media')
      .insert([{ ...media, memory_id: memoryId, couple_id: coupleId }])
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE media
router.delete('/media/:mediaId', async (req, res) => {
  try {
    const { mediaId } = req.params;
    const { error } = await supabase
      .from('globe_memory_media')
      .delete()
      .eq('id', mediaId);

    if (error) throw error;
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