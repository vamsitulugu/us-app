// ═══════════════════════════════════════════════════════════════
//  Admin Couples routes
//  ─────────────────────────────────────────────────────────────
//  Operational pairing data only: who's paired, when, whether both
//  accounts still exist. Never touches vault_pin, chat, journal, or
//  any relationship content — vault_pin isn't even selected below.
// ═══════════════════════════════════════════════════════════════
const express = require('express');
const supabase = require('../middleware/supabase');
const { requireAdmin, logAudit } = require('../middleware/adminAuth');

const router = express.Router();
router.use(requireAdmin);

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 100;

// ── GET /api/admin/couples ──────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, parseInt(req.query.pageSize, 10) || PAGE_SIZE_DEFAULT));
    const search = (req.query.search || '').trim();
    const pairedFilter = req.query.paired; // 'true' | 'false' | undefined

    let query = supabase
      .from('couples')
      .select('id, user1_name, user2_name, paired, anniversary, created_at, updated_at', { count: 'exact' });

    if (search) {
      query = query.or(`user1_name.ilike.%${search}%,user2_name.ilike.%${search}%`);
    }
    if (pairedFilter === 'true') query = query.eq('paired', true);
    if (pairedFilter === 'false') query = query.eq('paired', false);

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.order('created_at', { ascending: false }).range(from, to);

    const { data: couples, error, count } = await query;
    if (error) throw error;

    // Member counts for this page only, in one batched query rather
    // than one round trip per couple.
    const coupleIds = (couples || []).map(c => c.id);
    let memberCounts = {};
    if (coupleIds.length) {
      const { data: members } = await supabase
        .from('users').select('couple_id, account_status').in('couple_id', coupleIds);
      (members || []).forEach(m => {
        memberCounts[m.couple_id] = memberCounts[m.couple_id] || { total: 0, active: 0 };
        memberCounts[m.couple_id].total += 1;
        if (m.account_status === 'active') memberCounts[m.couple_id].active += 1;
      });
    }

    const result = (couples || []).map(c => {
      const counts = memberCounts[c.id] || { total: 0, active: 0 };
      // "Broken" pairing: marked as paired but doesn't actually have
      // two member accounts anymore (partner deleted, etc) — this is
      // the operational signal the spec asks admins to be able to spot.
      const broken = c.paired ? counts.total < 2 : false;
      return { ...c, memberCount: counts.total, activeMemberCount: counts.active, broken };
    });

    res.json({
      couples: result,
      page,
      pageSize,
      total: count || 0,
      totalPages: Math.max(1, Math.ceil((count || 0) / pageSize))
    });
  } catch (e) {
    console.error('[admin-couples] list failed:', e.message);
    res.status(500).json({ error: 'Failed to load couples' });
  }
});

// ── GET /api/admin/couples/orphaned ─────────────────────────────
// Dedicated view for the "identify broken/orphaned pairs" requirement:
// couples marked paired=true with fewer than 2 live member accounts,
// or couples with zero members at all (should basically never happen,
// but worth surfacing if it does).
router.get('/orphaned', async (req, res) => {
  try {
    const { data: couples, error } = await supabase
      .from('couples').select('id, user1_name, user2_name, paired, created_at, updated_at');
    if (error) throw error;

    const coupleIds = (couples || []).map(c => c.id);
    let memberCounts = {};
    if (coupleIds.length) {
      const { data: members } = await supabase.from('users').select('couple_id').in('couple_id', coupleIds);
      (members || []).forEach(m => {
        memberCounts[m.couple_id] = (memberCounts[m.couple_id] || 0) + 1;
      });
    }

    const orphaned = (couples || [])
      .map(c => ({ ...c, memberCount: memberCounts[c.id] || 0 }))
      .filter(c => c.memberCount === 0 || (c.paired && c.memberCount < 2));

    res.json({ orphaned, count: orphaned.length });
  } catch (e) {
    console.error('[admin-couples] orphaned lookup failed:', e.message);
    res.status(500).json({ error: 'Failed to load orphaned couples' });
  }
});

// ── GET /api/admin/couples/:id ───────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: couple, error } = await supabase
      .from('couples')
      .select('id, user1_name, user2_name, paired, anniversary, created_at, updated_at')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!couple) return res.status(404).json({ error: 'Couple not found' });

    const { data: members } = await supabase
      .from('users')
      .select('id, name, email, role, account_status, created_at')
      .eq('couple_id', id);

    res.json({ couple, members: members || [] });
  } catch (e) {
    console.error('[admin-couples] detail failed:', e.message);
    res.status(500).json({ error: 'Failed to load couple' });
  }
});

// ── POST /api/admin/couples/:id/reset-pairing ─────────────────────
// Repair action for a broken pair: forces paired=false so the
// remaining account can go through the normal in-app invite flow
// again cleanly, instead of being stuck "paired" to a partner who no
// longer has an account. Does not touch/delete any data.
router.post('/:id/reset-pairing', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: existing } = await supabase.from('couples').select('id, paired').eq('id', id).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Couple not found' });

    const { error } = await supabase.from('couples').update({ paired: false, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;

    await logAudit(req.adminEmail, 'couple.reset_pairing', 'couple', id, { previousPaired: existing.paired });
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin-couples] reset-pairing failed:', e.message);
    res.status(500).json({ error: 'Failed to reset pairing' });
  }
});

module.exports = router;
