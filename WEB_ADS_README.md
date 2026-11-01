# Web ads (AdSense)

File: `public/js/web-ads.js` (loaded by `landing.html` and `index.html`). Everything is OFF until you fill the two ad unit ids.

## Turn it on
1. AdSense > Sites: add your site and wait for approval. Check `public/ads.txt` matches Account > Settings > Publisher ID.
2. AdSense > Ads > By ad unit > **Display ads**, type **Responsive**. Make two units (or one used twice): "landing" and "app".
3. Paste their ids into `CFG.slots.landing` and `CFG.slots.app` in `public/js/web-ads.js`. Deploy.
4. AdSense > Privacy & messaging: create and publish the consent message (needed for visitors in the EU/UK).

## Where ads appear
- Landing page, signed-out visitors: one ad above the footer.
- Signed-in app, FREE couples only: Home, Calendar, Money, Study, Bucket list, Level (list: `CALM_PAGES`).
- Never: Chat, Twin AI, Live Map, Games, Music, Movies, Calls, Settings, Pro, Vault, Period, Fights, My Space.
- Pro couples, the Android app / WebViews, and any time Pro cannot be confirmed: no ads.

## Rules that keep the AdSense account safe
No pop-ups or full-screen overlays, no timer refresh. An ad is requested when a page is opened; going back to it keeps the same ad; after 8 minutes (`REUSE_MS`) the next visit gets a fresh one.
Set `allowInstalledPwa: false` to keep ads out of the installed web app.
