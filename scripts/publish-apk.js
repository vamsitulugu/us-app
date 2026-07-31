#!/usr/bin/env node
/*
  scripts/publish-apk.js
  ────────────────────────────────────────────────────────────────
  Run this ONE command every time you build a new release APK:

      node scripts/publish-apk.js /path/to/app-release.apk

  It will:
    1. Read the real versionName/versionCode from android/app/build.gradle
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
    console.error('Usage: node scripts/publish-apk.js <path-to-release.apk>');
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

  const gradlePath = path.join(__dirname, '..', 'android', 'app', 'build.gradle');
  const gradle = fs.readFileSync(gradlePath, 'utf8');
  const versionName = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1];
  const versionCode = (gradle.match(/versionCode\s+(\d+)/) || [])[1];
  if (!versionName || !versionCode) {
    console.error('Could not find versionName/versionCode in ' + gradlePath);
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

  const meta = {
    version: versionName,
    build: versionCode,
    size: sizeMB,
    updated,
    downloadUrl: blobResult.url,
    uploadedAt: new Date().toISOString(),
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
  console.log('\nDownload URL: ' + blobResult.url);
  console.log('\nDon\'t forget to bump versionCode/versionName in android/app/build.gradle before your NEXT build,');
  console.log('and to commit the updated public/downloads/app-meta.json (the APK itself is NOT committed).');
}

main().catch((err) => {
  console.error('❌ Unexpected error:');
  console.error(err);
  process.exit(1);
});
