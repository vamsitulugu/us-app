#!/usr/bin/env node
/*
  scripts/publish-apk.js
  ────────────────────────────────────────────────────────────────
  Run this ONE command every time you build a new release APK:

      node scripts/publish-apk.js /path/to/app-release.apk <versionName> <versionCode>
      e.g. node scripts/publish-apk.js ./app-release.apk 1.0 1

  It will:
    1. Take versionName/versionCode from the command line (use the same
       values as in twin-hearts-android's app/build.gradle)
    2. Upload your APK to Vercel Blob Storage under a stable filename
       (twin-hearts.apk), overwriting the previous upload
    3. Write public/downloads/app-meta.json with the REAL size/date/version
       and the permanent Blob download URL — this is the single source
       of truth the landing page reads from (never hand-typed, so the
       landing page can't show stale info, and no APK bytes ever touch git)
  ──────────────────────────────────────────────────────────────── */
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');

async function main() {
  const apkArg = process.argv[2];
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

  const versionName = process.argv[3];
  const versionCode = process.argv[4];
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

  console.log('✅ Published:');
  console.log('   ' + JSON.stringify(meta, null, 2));
  console.log('\nDownload URL: ' + cacheBustedUrl);
  console.log('\nBump versionCode/versionName in twin-hearts-android (app/build.gradle) before your NEXT build,');
  console.log('and to commit the updated public/downloads/app-meta.json (the APK itself is NOT committed).');
}

main().catch((err) => {
  console.error('❌ Unexpected error:');
  console.error(err);
  process.exit(1);
});