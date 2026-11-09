#!/usr/bin/env node
/*
  scripts/bump-version.js  —  step 1 of a release: put ONE version number everywhere
  ────────────────────────────────────────────────────────────────
      node scripts/bump-version.js <versionName> <versionCode> [--android <path-to-twin-hearts-android>]
      e.g. node scripts/bump-version.js 0.3.0 3 --android ../twin-hearts-android

  Updates, in one go:
    • web app        public/js/app-telemetry.js        (WEB_VERSION)
    • Android app    <android>/app/build.gradle.kts     (versionName + versionCode)
  Then build the APK, then run step 2:  node scripts/publish-apk.js app-release.apk <versionName> <versionCode>

  Why: the update popup compares the version the app REPORTS with the newest published release.
  If the app is built with a different number than the one you publish, the popup never goes away.
*/
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : null; };
const androidDir = flag('--android');
const [versionName, versionCode] = args;

if (!/^\d+(\.\d+){1,3}$/.test(versionName || '') || !/^\d+$/.test(versionCode || '')) {
  console.error('Usage: node scripts/bump-version.js <versionName e.g. 0.3.0> <versionCode e.g. 3> [--android <path>]');
  process.exit(1);
}

function edit(file, fn) {
  const before = fs.readFileSync(file, 'utf8');
  const after = fn(before);
  if (after === before) console.log('• unchanged  ' + file);
  else { fs.writeFileSync(file, after); console.log('✓ updated    ' + file); }
}

edit(path.join(__dirname, '..', 'public', 'js', 'app-telemetry.js'), (s) => {
  if (!/var WEB_VERSION = '[^']*';/.test(s)) throw new Error('WEB_VERSION line not found in app-telemetry.js');
  return s.replace(/var WEB_VERSION = '[^']*';/, `var WEB_VERSION = '${versionName}';`);
});

if (androidDir) {
  const gradle = path.join(path.resolve(androidDir), 'app', 'build.gradle.kts');
  if (!fs.existsSync(gradle)) { console.error('Not found: ' + gradle); process.exit(1); }
  edit(gradle, (s) => {
    if (!/versionCode = \d+/.test(s) || !/versionName = "[^"]*"/.test(s)) throw new Error('versionCode / versionName not found in build.gradle.kts');
    return s.replace(/versionCode = \d+/, `versionCode = ${versionCode}`).replace(/versionName = "[^"]*"/, `versionName = "${versionName}"`);
  });
} else {
  console.log('ℹ  No --android path given: remember to set versionName "' + versionName + '" / versionCode ' + versionCode + ' in app/build.gradle.kts.');
}
console.log(`\nNext: build the release APK, then  node scripts/publish-apk.js <apk> ${versionName} ${versionCode}`);
