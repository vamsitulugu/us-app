#!/usr/bin/env node
/*
  scripts/publish-apk.js
  ────────────────────────────────────────────────────────────────
  Run this ONE command every time you build a new release APK:

      node scripts/publish-apk.js /path/to/app-release.apk

  It will:
    1. Read the real versionName/versionCode from android/app/build.gradle
    2. Copy your APK into public/downloads/twin-hearts.apk
    3. Write public/downloads/app-meta.json with the REAL size/date/version
       (never hand-typed, so the landing page can't show stale info)
  ──────────────────────────────────────────────────────────────── */
const fs = require('fs');
const path = require('path');

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

const gradlePath = path.join(__dirname, '..', 'android', 'app', 'build.gradle');
const gradle = fs.readFileSync(gradlePath, 'utf8');
const versionName = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1];
const versionCode = (gradle.match(/versionCode\s+(\d+)/) || [])[1];
if (!versionName || !versionCode) {
  console.error('Could not find versionName/versionCode in ' + gradlePath);
  process.exit(1);
}

const outDir = path.join(__dirname, '..', 'public', 'downloads');
fs.mkdirSync(outDir, { recursive: true });

const destApk = path.join(outDir, 'twin-hearts.apk');
fs.copyFileSync(srcApk, destApk);

const sizeBytes = fs.statSync(destApk).size;
const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1) + ' MB';
const updated = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const meta = { version: versionName, build: versionCode, size: sizeMB, updated };
fs.writeFileSync(path.join(outDir, 'app-meta.json'), JSON.stringify(meta, null, 2));

console.log('✅ Published:');
console.log('   ' + destApk);
console.log('   ' + JSON.stringify(meta, null, 2));
console.log('\nDon\'t forget to bump versionCode/versionName in android/app/build.gradle before your NEXT build.');
