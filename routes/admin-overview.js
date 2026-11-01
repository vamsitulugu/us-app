// ═══════════════════════════════════════════════════════════════
//  Admin Overview routes — dashboard KPI cards
//  ─────────────────────────────────────────────────────────────
//  Every number here is computed from a real query. DAU/WAU/MAU come
//  from app_activity (migrations/admin_telemetry.sql). Where the
//  underlying instrumentation doesn't exist, the
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
      recentAuditRes,
      activeRes,
      trendRes,
      versionsRes,
      openTicketsRes,
      payRes,
      proCouplesRes,
      platformUsersRes
    ] = await Promise.all([
      supabase.from('users').select('id', { count: 'exact', head: true }),
      supabase.from('users').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('users').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('users').select('id', { count: 'exact', head: true }).gte('created_at', monthStart),
      supabase.from('users').select('id', { count: 'exact', head: true }).eq('account_status', 'suspended'),
      supabase.from('couples').select('id', { count: 'exact', head: true }),
      supabase.from('couples').select('id', { count: 'exact', head: true }).eq('paired', true),
      supabase.from('app_releases').select('version, published_at').eq('status', 'published').order('published_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('admin_audit_log').select('*').order('created_at', { ascending: false }).limit(10),
      supabase.rpc('admin_active_stats'),
      supabase.rpc('admin_dau_trend', { n: 14 }),
      supabase.rpc('admin_version_spread'),
      supabase.from('support_tickets').select('id', { count: 'exact', head: true }).neq('status', 'resolved'),
      supabase.from('pro_payments').select('amount_paise, paid_at').eq('status', 'paid'),
      supabase.from('couples').select('pro_plan, pro_expires_at').not('pro_plan', 'is', null),
      supabase.from('users').select('last_platform')
    ]);

    const errs = [totalUsersRes, newTodayRes, newWeekRes, newMonthRes, suspendedRes, couplesRes, pairedCouplesRes, currentReleaseRes, recentAuditRes]
      .map(r => r.error).filter(Boolean);
    if (errs.length) throw errs[0];

    // New telemetry/payment/support numbers are optional: if admin_telemetry.sql has not been
    // run yet (or a table is missing) that one block is reported as unavailable instead of
    // breaking the whole Overview page.
    const telemetryReady = !activeRes.error && !trendRes.error;
    const activeRows = telemetryReady ? (activeRes.data || []) : [];
    const pick = (p) => activeRows.find(r => r.platform === p) || { dau: 0, wau: 0, mau: 0 };
    const num = (r) => ({ dau: Number(r.dau) || 0, wau: Number(r.wau) || 0, mau: Number(r.mau) || 0 });
    const monthAgo = Date.now() - 30 * 86400000;
    const paid = payRes.error ? [] : (payRes.data || []);
    const activePro = proCouplesRes.error ? 0 : (proCouplesRes.data || [])
      .filter(c => c.pro_plan === 'lifetime' || (c.pro_expires_at && new Date(c.pro_expires_at) > new Date())).length;
    const split = { android: 0, web: 0, unknown: 0 };
    (platformUsersRes.data || []).forEach(u => { split[u.last_platform || 'unknown']++; });

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
        currentReleaseVersion: currentReleaseRes.data ? currentReleaseRes.data.version : null,
        openSupportTickets: openTicketsRes.error ? null : (openTicketsRes.count || 0),
        activeProCouples: activePro,
        revenueTotal: paid.reduce((a, p) => a + p.amount_paise / 100, 0),
        revenue30d: paid.filter(p => p.paid_at && new Date(p.paid_at).getTime() >= monthAgo).reduce((a, p) => a + p.amount_paise / 100, 0)
      },
      active: telemetryReady ? { all: num(pick('all')), android: num(pick('android')), web: num(pick('web')) } : null,
      dauTrend: telemetryReady ? (trendRes.data || []).map(r => ({ day: r.day, android: Number(r.android) || 0, web: Number(r.web) || 0 })) : [],
      versions: versionsRes.error ? [] : (versionsRes.data || []).map(r => ({ platform: r.platform, version: r.app_version, users: Number(r.users) || 0 })),
      usersByPlatform: split,
      recentActivity: recentAuditRes.data || [],
      // Explicitly flagged rather than silently absent, so the frontend
      // can render an honest "not tracked yet" empty state instead of
      // guessing why a chart is missing.
      notTracked: telemetryReady ? ['aiUsage', 'storageUsage'] : ['dailyActiveUsers', 'aiUsage', 'storageUsage']
    });
  } catch (e) {
    console.error('[admin-overview] failed:', e.message);
    res.status(500).json({ error: 'Failed to load overview' });
  }
});

module.exports = router;
