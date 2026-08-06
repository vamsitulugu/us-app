// ═══════════════════════════════════════════════════════════════
//  Admin Overview routes — dashboard KPI cards
//  ─────────────────────────────────────────────────────────────
//  Every number here is computed from a real query. Where the
//  underlying instrumentation doesn't exist (e.g. true "daily active
//  users" would need session tracking this app doesn't have), the
//  field is explicitly omitted rather than estimated, and the
//  frontend is expected to render an empty/"not tracked yet" state
//  for it — never a fabricated number.
// ═══════════════════════════════════════════════════════════════
const express = require('express');
const supabase = require('../middleware/supabase');
const { requireAdmin } = require('../middleware/adminAuth');

const router = express.Router();
router.use(requireAdmin);

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function daysAgo(n) { const x = new Date(); x.setDate(x.getDate() - n); return x; }

// ── GET /api/admin/overview ──────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const now = new Date();
    const todayStart = startOfDay(now).toISOString();
    const weekStart = daysAgo(7).toISOString();
    const monthStart = daysAgo(30).toISOString();

    const [
      totalUsersRes,
      newTodayRes,
      newWeekRes,
      newMonthRes,
      suspendedRes,
      couplesRes,
      pairedCouplesRes,
      currentReleaseRes,
      recentAuditRes
    ] = await Promise.all([
      supabase.from('users').select('id', { count: 'exact', head: true }),
      supabase.from('users').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('users').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('users').select('id', { count: 'exact', head: true }).gte('created_at', monthStart),
      supabase.from('users').select('id', { count: 'exact', head: true }).eq('account_status', 'suspended'),
      supabase.from('couples').select('id', { count: 'exact', head: true }),
      supabase.from('couples').select('id', { count: 'exact', head: true }).eq('paired', true),
      supabase.from('app_releases').select('version, published_at').eq('status', 'published').order('published_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('admin_audit_log').select('*').order('created_at', { ascending: false }).limit(10)
    ]);

    const errs = [totalUsersRes, newTodayRes, newWeekRes, newMonthRes, suspendedRes, couplesRes, pairedCouplesRes, currentReleaseRes, recentAuditRes]
      .map(r => r.error).filter(Boolean);
    if (errs.length) throw errs[0];

    const totalUsers = totalUsersRes.count || 0;
    const totalCouples = couplesRes.count || 0;
    const pairedCouples = pairedCouplesRes.count || 0;

    res.json({
      kpis: {
        totalUsers,
        newUsersToday: newTodayRes.count || 0,
        newUsersThisWeek: newWeekRes.count || 0,
        newUsersThisMonth: newMonthRes.count || 0,
        suspendedAccounts: suspendedRes.count || 0,
        totalCouples,
        pairedCouples,
        unpairedCouples: totalCouples - pairedCouples,
        currentReleaseVersion: currentReleaseRes.data ? currentReleaseRes.data.version : null
      },
      recentActivity: recentAuditRes.data || [],
      // Explicitly flagged rather than silently absent, so the frontend
      // can render an honest "not tracked yet" empty state instead of
      // guessing why a chart is missing.
      notTracked: ['dailyActiveUsers', 'aiUsage', 'storageUsage']
    });
  } catch (e) {
    console.error('[admin-overview] failed:', e.message);
    res.status(500).json({ error: 'Failed to load overview' });
  }
});

module.exports = router;
