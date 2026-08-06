// ═══════════════════════════════════════════════════════════════
//  Admin Users routes
//  ─────────────────────────────────────────────────────────────
//  Privacy rule (per spec): this file surfaces account/operational
//  data only — id, name, email, phone, dates, status, pairing,
//  role. It never reads chat, journal, vault, or notes content, and
//  never will; if you need something from those tables later, it
//  must be a count/existence check at most, never message bodies.
// ═══════════════════════════════════════════════════════════════
const express = require('express');
const supabase = require('../middleware/supabase');
const { requireAdmin, logAudit } = require('../middleware/adminAuth');

const router = express.Router();
router.use(requireAdmin); // every route below requires a valid admin session

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 100;

// ── GET /api/admin/users ─────────────────────────────────────────
// Paginated, searchable, sortable list. Server-side filtering only —
// never pulls the whole users table to the browser.
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, parseInt(req.query.pageSize, 10) || PAGE_SIZE_DEFAULT));
    const search = (req.query.search || '').trim();
    const status = (req.query.status || '').trim(); // '', 'active', 'suspended', 'disabled'
    const sortBy = ['created_at', 'name', 'email'].includes(req.query.sortBy) ? req.query.sortBy : 'created_at';
    const sortDir = req.query.sortDir === 'asc' ? true : false;

    let query = supabase
      .from('users')
      .select('id, name, email, phone_number, couple_id, role, account_status, created_at, updated_at', { count: 'exact' });

    if (search) {
      // Search name/email/phone — ilike is fine at this data volume;
      // would need a proper search index well before this becomes slow.
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,phone_number.ilike.%${search}%`);
    }
    if (status && ['active', 'suspended', 'disabled'].includes(status)) {
      query = query.eq('account_status', status);
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.order(sortBy, { ascending: sortDir }).range(from, to);

    const { data, error, count } = await query;
    if (error) throw error;

    // Pairing status per row, without a second round trip per user:
    // batch-fetch the distinct couple rows involved in this page only.
    const coupleIds = [...new Set((data || []).map(u => u.couple_id).filter(Boolean))];
    let couplesById = {};
    if (coupleIds.length) {
      const { data: couples } = await supabase
        .from('couples').select('id, paired').in('id', coupleIds);
      couplesById = Object.fromEntries((couples || []).map(c => [c.id, c]));
    }

    const users = (data || []).map(u => ({
      ...u,
      paired: couplesById[u.couple_id]?.paired || false
    }));

    res.json({
      users,
      page,
      pageSize,
      total: count || 0,
      totalPages: Math.max(1, Math.ceil((count || 0) / pageSize))
    });
  } catch (e) {
    console.error('[admin-users] list failed:', e.message);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

// ── GET /api/admin/users/:id ──────────────────────────────────────
// Full detail panel: account info + pairing info + storage rollup.
// Deliberately does not touch chat/journal/vault/notes content.
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, email, phone_number, couple_id, role, account_status, created_at, updated_at')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!user) return res.status(404).json({ error: 'User not found' });

    let couple = null;
    let partner = null;
    if (user.couple_id) {
      const { data: coupleRow } = await supabase
        .from('couples')
        .select('id, user1_name, user2_name, paired, created_at')
        .eq('id', user.couple_id)
        .maybeSingle();
      couple = coupleRow || null;

      const partnerRole = user.role === 'user1' ? 'user2' : 'user1';
      const { data: partnerRow } = await supabase
        .from('users')
        .select('id, name, email, account_status, created_at')
        .eq('couple_id', user.couple_id)
        .eq('role', partnerRole)
        .maybeSingle();
      partner = partnerRow || null;
    }

    res.json({ user, couple, partner });
  } catch (e) {
    console.error('[admin-users] detail failed:', e.message);
    res.status(500).json({ error: 'Failed to load user' });
  }
});

// ── POST /api/admin/users/:id/status ──────────────────────────────
// Sets account_status to 'active' | 'suspended' | 'disabled'.
// This is the ONLY way those values are ever written — never exposed
// to the normal app's own routes.
router.post('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!['active', 'suspended', 'disabled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const { data: existing } = await supabase.from('users').select('id, email, account_status').eq('id', id).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'User not found' });

    const { error } = await supabase.from('users').update({ account_status: status, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;

    await logAudit(req.adminEmail, `user.status.${status}`, 'user', id, {
      previousStatus: existing.account_status,
      newStatus: status,
      email: existing.email
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('[admin-users] status update failed:', e.message);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// ── DELETE /api/admin/users/:id ────────────────────────────────────
// Destructive. Requires an explicit confirm flag in the body — the
// admin frontend must make the user type/confirm before this is ever
// called; this endpoint is the last line of defense, not the first.
// Handles related rows so nothing is left orphaned: if this account
// was the last one on its couple_id, the couple row and its media
// buckets' rows are removed too; if a partner still exists, only this
// user row is removed and the couple stays intact for the partner.
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { confirm } = req.body || {};
    if (confirm !== true) {
      return res.status(400).json({ error: 'Deletion requires confirm: true in the request body' });
    }

    const { data: user, error: fetchErr } = await supabase
      .from('users').select('id, email, couple_id, role').eq('id', id).maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { error: deleteErr } = await supabase.from('users').delete().eq('id', id);
    if (deleteErr) throw deleteErr;

    // Check whether the partner still exists on this couple_id before
    // deciding whether to remove the couple row too — never delete a
    // couple that still has a living member attached to it.
    let coupleDeleted = false;
    if (user.couple_id) {
      const { count: remaining } = await supabase
        .from('users').select('id', { count: 'exact', head: true }).eq('couple_id', user.couple_id);
      if (!remaining || remaining === 0) {
        // NOTE: this intentionally only removes the couples row itself.
        // Associated media in Storage buckets (couple-photos, vault-media,
        // etc.) is NOT auto-deleted here — that's a separate, larger
        // cleanup operation with its own risk profile, out of scope for
        // this endpoint. Flagging clearly rather than silently leaving
        // storage orphaned without mentioning it.
        await supabase.from('couples').delete().eq('id', user.couple_id);
        coupleDeleted = true;
      }
    }

    await logAudit(req.adminEmail, 'user.delete', 'user', id, {
      email: user.email,
      coupleId: user.couple_id,
      coupleDeleted
    });

    res.json({ ok: true, coupleDeleted });
  } catch (e) {
    console.error('[admin-users] delete failed:', e.message);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

module.exports = router;
