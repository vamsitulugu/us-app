// Ad breaks in the theatre. Edit THIS file only.
//   1) your own Twin Hearts video ad plays first (public/ads/twin-hearts-ad.mp4)
//   2) then a real Google ad (AdSense video / IMA) plays — it stays OFF until your AdSense account is approved
export const AD={
 enabled:true,                    // false = no ad breaks at all
 firstAfterMin:20,                // first break once the MOVIE has played this many minutes
 everyMin:20,                     // then again every this many movie minutes (0 = only one break)
 skipLastMin:3,                   // never interrupt in the last minutes of the movie
 own:{
  enabled:true,
  src:import.meta.env.BASE_URL+'ads/twin-hearts-ad.mp4',  // your video (32 s). Replace the file to change the ad
  label:'Twin Hearts',            // small "Ad · …" tag
  skipAfterSec:5,                 // "Skip ad" button appears after this many seconds (0 = cannot be skipped)
 },
 google:{
  enabled:false,                  // ← set to true after AdSense approves the site AND you pasted the ad tag below
  publisherId:'ca-pub-8220558701111236',   // same id as us-app/public/ads.txt
  adTagUrl:'',                    // AdSense for Video / Ad Manager VAST tag URL (https://pubads.g.doubleclick.net/gampad/ads?...)
  loadTimeoutSec:12,              // no ad arrived in this time (no-fill / blocked) -> carry on with the movie
 },
 waitForPartnerSec:40,            // after YOUR ad ends, wait this long for your partner's ad to end before resuming together
};
