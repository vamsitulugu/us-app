# Admin check + version sync + picture / repeating notifications

## 1. One-time setup
1. Supabase SQL editor → run `migrations/admin_system.sql` (safe to run again). It creates the admin tables that had no
   migration (`app_releases`, `admin_notifications`, `admin_audit_log`, `feature_flags`) and adds the picture / schedule columns.
   Run `migrations/admin_telemetry.sql` too if you have not.
2. Render env: add `CRON_SECRET` (any long random string). Redeploy.
3. GitHub repo secrets: `SERVER_URL` (e.g. https://us-app-av6d.onrender.com) and `CRON_SECRET` (same value).
   The workflow `push-scheduler.yml` then pings the server every ~5 minutes, so scheduled pushes go out even when Render is asleep.
4. Supabase Storage: the bucket `couple-photos` must exist and be public (it already is for chat photos). Notification pictures go in `admin-notifications/`.

## 2. Releasing a new version (web + Android + admin in sync)
```
node scripts/bump-version.js 0.4.0 4 --android ../twin-hearts-android     # step 1: same number in web + Android
# build the release APK in Android Studio
node scripts/publish-apk.js app-release.apk 0.4.0 4 --title "What's new"  # step 2: upload APK + publish the release
```
Step 2 also publishes the release in the admin **Releases** list (needs `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` in `.env.local`).
Deploy the web app after step 1 so web users get the new number too.

Update type: `recommended` (default) = the card shows every time the app is opened until the app is updated.
`required` = cannot be closed. `optional` = same card as recommended.

## 3. Update card behaviour
- Android: card with **Update now / Later / Cancel**. Shown on every app open while the installed version is older than the published one.
  Later and Cancel close it for this visit only. It disappears for good once the new version is installed.
- Web: banner with Reload; the ✕ hides it for this visit only.

## 4. Picture + repeating notifications (Admin → Notifications → Compose)
- Add a picture (shrunk in the browser, max 3 MB), pick audience, then **Send now** or **Schedule**.
- Schedule: first push time (empty = now), tick **Repeat**, set **Every N hours** (0.5–336) and **Keep pushing until** a date.
- Edit a running campaign to change the hours or the end date. Pause / Resume / Stop are in the list.
- The last push is the last one that fits before the end date; then the campaign shows **completed**.

## 5. Tests
`npm run test:admin` (no database or Firebase needed). The Kotlin changes were not compiled here: build once in Android Studio.
