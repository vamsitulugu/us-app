#!/usr/bin/env node
/*
  scripts/publish-apk.js
  ────────────────────────────────────────────────────────────────
  Run this ONE command every time you build a new release APK:

      node scripts/publish-apk.js /path/to/app-release.apk <versionName> <versionCode> [options]
      e.g. node scripts/publish-apk.js ./app-release.apk 0.3.0 3 --title "Image notifications"

  Options (all optional):
      --title "..."      release title shown in the update popup   (default: "Version <versionName>")
      --message "..."    one-line text shown in the popup
      --notes "..."      longer release notes
      --type recommended|optional|required   (default recommended: popup shows on every app open)
      --no-release       only upload the APK, do not touch the admin Releases list

  Run  node scripts/bump-version.js <versionName> <versionCode> --android <path>  BEFORE building the APK,
  so the app is built with the same number you publish here.

  It will:
    1. Take versionName/versionCode from the command line (use the same
       values as in twin-hearts-android's app/build.gradle)
    2. Upload your APK to Vercel Blob Storage under a stable filename
       (twin-hearts.apk), overwriting the previous upload
    4. (needs SUPABASE_URL + SUPABASE_SERVICE_KEY in .env.local) creates / updates the matching release
       in the admin Releases list and PUBLISHES it with this download link, so the Android popup and
       the web banner pick it up immediately — one command, nothing to paste in the admin page.
    3. Write public/downloads/app-meta.json with the REAL size/date/version
       and the permanent Blob download URL — this is the single source
       of truth the landing page reads from (never hand-typed, so the
       landing page can't show stale info, and no APK bytes ever touch git)
  ──────────────────────────────────────────────────────────────── */
require('dotenv').config({ path: '.env.local' });
require('dotenv').config(); // also .env (does not override values already set)
const fs = require('fs');
const path = require('path');

async function main() {
  const rawArgs = process.argv.slice(2);
  const opts = { title: null, message: null, notes: null, type: 'recommended', release: true };
  const positional = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a === '--no-release') opts.release = false;
    else if (['--title', '--message', '--notes', '--type'].includes(a)) opts[a.slice(2)] = rawArgs[++i];
    else positional.push(a);
  }
  if (!['optional', 'recommended', 'required'].includes(opts.type)) {
    console.error('--type must be optional, recommended or required'); process.exit(1);
  }
  const apkArg = positional[0];
  if (!apkArg) {
    console.error('Usage: node scripts/publish-apk.js <path-to-release.apk> <versionName> <versionCode>');
    process.exit(1);
  }
  const srcApk = path.resolve(apkArg);
  if (!fs.existsSync(srcApk)) {
    console.error('APK not found at: ' + srcApk);
    process.exit(1);
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.error('❌ Missing BLOB_READ_WRITE_TOKEN environment variable.');
    console.error('   Create a Blob store on Vercel and copy its token, e.g.:');
    console.error('   export BLOB_READ_WRITE_TOKEN="vercel_blob_rw_..."');
    process.exit(1);
  }

  let put;
  try {
    ({ put } = require('@vercel/blob'));
  } catch (e) {
    console.error('❌ The "@vercel/blob" package is not installed. Run: npm install');
    process.exit(1);
  }

  const versionName = positional[1];
  const versionCode = positional[2];
  if (!versionName || !/^\d+$/.test(versionCode || '')) {
    console.error('Usage: node scripts/publish-apk.js <path-to-release.apk> <versionName> <versionCode>');
    console.error('Example: node scripts/publish-apk.js ./app-release.apk 1.0 1');
    process.exit(1);
  }

  const sizeBytes = fs.statSync(srcApk).size;
  const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1) + ' MB';
  const updated = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  console.log('⬆️  Uploading ' + path.basename(srcApk) + ' (' + sizeMB + ') to Vercel Blob Storage…');

  let blobResult;
  try {
    const fileBuffer = fs.readFileSync(srcApk);
    blobResult = await put('downloads/twin-hearts.apk', fileBuffer, {
      access: 'public',
      addRandomSuffix: false,       // keep a stable, predictable filename
      allowOverwrite: true,         // overwrite the previous APK upload
      contentType: 'application/vnd.android.package-archive',
      // Force a real "attachment" download (not "view in browser") and
      // guarantee Android sees the right filename regardless of browser.
      contentDisposition: 'attachment; filename="twin-hearts.apk"',
      // BUG FIX: Vercel Blob's browser + edge CDN caches a public blob's
      // bytes for up to 1 MONTH by default. Because this upload reuses the
      // exact same URL every time (stable filename + overwrite), without
      // this option a re-publish can silently keep serving the PREVIOUS
      // build's bytes to anyone downloading — this is the most likely
      // cause of the APK "installing" but behaving like an old/different
      // build, or failing outright if the previous upload was ever
      // interrupted. 60 is the minimum allowed TTL.
      cacheControlMaxAge: 60,
      multipart: true,
      onUploadProgress: (p) => process.stdout.write('\r   ' + p.percentage.toFixed(0) + '%   '),
      token,
    });
  } catch (err) {
    console.error('❌ Upload to Vercel Blob Storage failed:');
    console.error('   ' + (err && err.message ? err.message : err));
    process.exit(1);
  }

  if (!blobResult || !blobResult.url) {
    console.error('❌ Upload finished but no public URL was returned.');
    process.exit(1);
  }

  const outDir = path.join(__dirname, '..', 'public', 'downloads');
  fs.mkdirSync(outDir, { recursive: true });

  const uploadedAt = new Date().toISOString();
  // BUG FIX (defense in depth on top of cacheControlMaxAge above): append
  // a version query string so every publish produces a brand-new URL from
  // the browser/CDN cache's point of view, even within the 60s TTL window
  // right after publishing. blobResult.downloadUrl already forces
  // Content-Disposition: attachment via Blob's own "?download=1" — we
  // append our cache-buster onto that.
  const cacheBustedUrl = (blobResult.downloadUrl || blobResult.url) +
    (((blobResult.downloadUrl || blobResult.url).includes('?')) ? '&' : '?') +
    'v=' + encodeURIComponent(versionCode + '-' + Date.parse(uploadedAt));

  const meta = {
    version: versionName,
    build: versionCode,
    size: sizeMB,
    updated,
    downloadUrl: cacheBustedUrl,
    uploadedAt,
  };

  try {
    fs.writeFileSync(path.join(outDir, 'app-meta.json'), JSON.stringify(meta, null, 2));
  } catch (err) {
    console.error('❌ APK uploaded, but failed to write public/downloads/app-meta.json:');
    console.error('   ' + (err && err.message ? err.message : err));
    process.exit(1);
  }

  if (opts.release) await syncRelease(meta, opts);

  console.log('✅ Published:');
  console.log('   ' + JSON.stringify(meta, null, 2));
  console.log('\nDownload URL: ' + cacheBustedUrl);
  console.log('\nBump versionCode/versionName in twin-hearts-android (app/build.gradle) before your NEXT build,');
  console.log('and to commit the updated public/downloads/app-meta.json (the APK itself is NOT committed).');
}

// Creates (or updates) the release in the admin list and publishes it with the APK link.
async function syncRelease(meta, opts) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.log('ℹ  SUPABASE_URL / SUPABASE_SERVICE_KEY not set: APK uploaded, but the admin Releases list was NOT updated.');
    console.log('   Add them to .env.local, or create/publish the release in the admin page (it can fill the link for you).');
    return;
  }
  try {
    const { createClient } = require('@supabase/supabase-js');
    const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
    const row = {
      version: meta.version,
      build: parseInt(meta.build, 10),
      title: opts.title || ('Version ' + meta.version),
      message: opts.message || ('Version ' + meta.version + ' is ready. Please update for the latest features and fixes.'),
      notes: opts.notes || null,
      update_type: opts.type,
      update_url: meta.downloadUrl,
      platform: 'all',
      status: 'published',
      published_at: new Date().toISOString(),
    };
    const { data: existing, error: findErr } = await db.from('app_releases').select('id, status').eq('version', meta.version).eq('platform', 'all').maybeSingle();
    if (findErr) throw findErr;
    let id;
    if (existing) {
      if (existing.status === 'archived') { console.log('⚠  Release ' + meta.version + ' is archived in the admin list: not changed.'); return; }
      const { error } = await db.from('app_releases').update(row).eq('id', existing.id);
      if (error) throw error;
      id = existing.id;
    } else {
      const { data, error } = await db.from('app_releases').insert(row).select('id').single();
      if (error) throw error;
      id = data.id;
    }
    await db.from('admin_audit_log').insert({ admin_email: 'cli:publish-apk', action: 'release.publish', target_type: 'release', target_id: String(id), metadata: { version: meta.version, via: 'scripts/publish-apk.js' } });
    console.log('✓ Admin release ' + meta.version + ' is published (' + opts.type + ').');
  } catch (e) {
    console.log('⚠  APK uploaded, but publishing the release failed: ' + (e.message || e));
    console.log('   (Tables missing? run migrations/admin_system.sql in the Supabase SQL editor.)');
  }
}

main().catch((err) => {
  console.error('❌ Unexpected error:');
  console.error(err);
  process.exit(1);
});