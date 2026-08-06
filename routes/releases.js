// ═══════════════════════════════════════════════════════════════
//  Public release-check routes
//  ─────────────────────────────────────────────────────────────
//  This is what the APP itself calls on startup — deliberately NOT
//  behind requireAdmin (a normal user has no admin session and never
//  should). It only ever reads app_releases, never writes to it —
//  writes go exclusively through routes/admin-releases.js.
//
//  Decision logic:
//   1. Find the newest PUBLISHED release for this platform (by
//      version, not created_at — an admin could in principle publish
//      an older release after a newer one existed as a draft).
//   2. If the client's version is already >= that release's version,
//      no update needed.
//   3. Otherwise, the update type is whatever the release specifies
//      (optional/recommended/required) — EXCEPT: if the release (or
//      any published release) defines a min_supported_version and the
//      client is older than THAT, the update is forced to 'required'
//      regardless of what the release's own update_type says. This is
//      the mechanism for "versions below X should no longer access
//      the app" independent of any single release's configured type.
// ═══════════════════════════════════════════════════════════════
const express = require('express');
const supabase = require('../middleware/supabase');
const { compareVersions, isOlderThan } = require('../lib/version');

const router = express.Router();

// ── GET /api/releases/check ──────────────────────────────────────
// Query params: version (required), build (optional), platform
// (optional, defaults 'android' since that's the primary distribution
// channel today — the web/PWA build can pass platform=web explicitly).
router.get('/check', async (req, res) => {
  try {
    const clientVersion = (req.query.version || '').trim();
    const platform = (req.query.platform || 'android').trim();
    if (!clientVersion) {
      return res.status(400).json({ error: 'version query param is required' });
    }

    const { data: releases, error } = await supabase
      .from('app_releases')
      .select('id, version, build, title, message, notes, update_type, update_url, min_supported_version, platform, published_at')
      .eq('status', 'published')
      .in('platform', platform === 'web' ? ['all', 'web'] : ['all', 'android']);
    if (error) throw error;

    if (!releases || releases.length === 0) {
      // No published releases at all yet — never block the app; this
      // is the "brand new install of the update system" state.
      return res.json({ updateAvailable: false, updateType: null, release: null });
    }

    // Resolve "latest" by actual version comparison, not array order.
    let latest = releases[0];
    for (const r of releases) {
      if (compareVersions(r.version, latest.version) > 0) latest = r;
    }

    // Resolve the effective minimum supported version across ALL
    // published releases (not just the latest one) — an admin may have
    // raised the floor in an earlier release that's since been
    // superseded, and that floor should still apply.
    let effectiveMinVersion = null;
    for (const r of releases) {
      if (r.min_supported_version && (!effectiveMinVersion || compareVersions(r.min_supported_version, effectiveMinVersion) > 0)) {
        effectiveMinVersion = r.min_supported_version;
      }
    }

    const upToDate = compareVersions(clientVersion, latest.version) >= 0;
    if (upToDate) {
      return res.json({ updateAvailable: false, updateType: null, release: null });
    }

    const belowMinimum = effectiveMinVersion ? isOlderThan(clientVersion, effectiveMinVersion) : false;
    const updateType = belowMinimum ? 'required' : latest.update_type;

    return res.json({
      updateAvailable: true,
      updateType,
      release: {
        id: latest.id,
        version: latest.version,
        build: latest.build,
        title: latest.title,
        message: latest.message,
        notes: latest.notes,
        updateUrl: latest.update_url,
        publishedAt: latest.published_at
      }
    });
  } catch (e) {
    console.error('[releases] check failed:', e.message);
    // Fail SAFE, not blocked: a version-check outage must never lock
    // users out of the app. The client's own offline/cache logic
    // (built into the frontend, not here) is what handles "use the
    // last trusted config" — this endpoint just needs to never itself
    // manufacture a false 'required' update on a server hiccup.
    return res.status(503).json({ error: 'Version check temporarily unavailable', updateAvailable: false, updateType: null, release: null });
  }
});

module.exports = router;
