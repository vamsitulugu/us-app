# Notifications v2: default sound, never miss one, Hug / Touch / Miss You popup

Not compiled here (no Android SDK). Build in Android Studio: Sync, Run.

## What changed
- Every channel plays the phone's DEFAULT notification sound (calls keep the ringtone).
  Channel ids are now "_v3" so the sound applies to everyone, including people who already installed.
- If a rich notification fails (bad photo, odd data) a plain one is shown instead: nothing is dropped.
- Hug / Touch / Miss You notifications no longer replace each other: each one gets its own card.
- New Accept popup on ANY screen: "Name sent you a touch" / "Name misses you" / "Name is sending you a hug".
  Accept / Later. Hug Accept = the real hug accept (server). Touch / Miss You Accept = remembered on this phone.
  On Home the hug keeps its own inline card; touch and miss use the popup. Not shown during a call.
- Accepting also clears the matching phone notifications.

## IMPORTANT: one server change
Put `backend-changes/notifications/high-priority-push.patch.md` into us-app (routes/auth.js) and redeploy.
Without it Android may delay chat / hug / miss pushes while the phone sleeps.

## Test
1. Install, open once. Partner taps Touch -> sound + notification; with app open a popup appears; tap Accept.
2. Partner taps Miss You twice quickly -> two cards, popup shows them one by one.
3. Partner taps Hug while you are on Map -> popup "is sending you a hug" -> Accept -> Home shows "hugged".
4. App closed + screen off: Hug / chat arrive with the default sound (needs the server change).
5. Phone Settings > Apps > Twin Hearts > Notifications: all categories show the default sound.

## Not possible without a bigger backend change
Messages sent while the phone is offline for more than a day, or while the token is lost, cannot be
replayed: the server keeps no notification inbox. Say so if you want one (new table + endpoint).
