/**
 * US APP — index.html PATCH SCRIPT
 * ============================================================
 * This file contains ALL the JavaScript additions needed in index.html.
 * Paste these functions into your existing <script> block,
 * or include this file with: <script src="/index_patch.js"></script>
 * just before the closing </script> tag of your main script.
 * ============================================================
 */

// ── 1. PAGE TITLES (merge into existing pageTitles object) ──
// ADD these two lines inside your pageTitles = { ... } object:
//   games: 'Couple Games 🎮',
//   dreamgoals: 'Dream Goals 🌟',

// ── 2. THEME SYNC ──
function syncThemeToFrame(frameId) {
  const frame = document.getElementById(frameId);
  if (!frame) return;
  const trySync = () => {
    try {
      const root = getComputedStyle(document.documentElement);
      const vars = {};
      ['--h','--accent','--accent-d','--accent-l','--accent-glow',
       '--accent2','--accent2-d','--accent2-glow'].forEach(v => {
        vars[v] = root.getPropertyValue(v).trim();
      });
      frame.contentWindow.postMessage({ type: 'theme', vars }, '*');
    } catch(e) {}
  };
  if (frame.contentDocument && frame.contentDocument.readyState === 'complete') trySync();
  else frame.addEventListener('load', trySync, { once: true });
}

// ── 3. PATCH setTheme to also sync iframes ──
(function patchSetTheme() {
  const orig = window.setTheme;
  if (!orig) return;
  window.setTheme = function(name, silent) {
    orig(name, silent);
    setTimeout(() => {
      ['gamesFrame', 'musicFrame', 'dreamgoalsFrame'].forEach(syncThemeToFrame);
    }, 150);
  };
})();

// ── 4. DREAM GOALS SYNC ──
function syncDreamGoalsToFrame() {
  const frame = document.getElementById('dreamgoalsFrame');
  if (!frame) return;
  const doSync = () => {
    try {
      frame.contentWindow.postMessage({
        type: 'names',
        my: S.myName || 'You',
        partner: S.partnerName || 'Partner'
      }, '*');
      if (S.dreamGoals && S.dreamGoals.length) {
        frame.contentWindow.postMessage({
          type: 'syncDreams',
          dreams: S.dreamGoals
        }, '*');
      }
    } catch(e) {}
  };
  if (frame.contentDocument && frame.contentDocument.readyState === 'complete') doSync();
  else frame.addEventListener('load', doSync, { once: true });
}

// ── 5. RECEIVE MESSAGES FROM IFRAMES ──
window.addEventListener('message', function(e) {
  if (!e.data || !e.data.type) return;
  // Dream Goals → save to cloud state
  if (e.data.type === 'dreamgoals') {
    S.dreamGoals = e.data.dreams || [];
    scheduleSave();
  }
});

// ── 6. PATCH goto() — add new page handlers ──
// Find your existing goto() function and ADD these lines
// at the end of the function body (before the closing brace):
//
//   if (page === 'games') syncThemeToFrame('gamesFrame');
//   if (page === 'music') syncThemeToFrame('musicFrame');
//   if (page === 'dreamgoals') {
//     syncThemeToFrame('dreamgoalsFrame');
//     syncDreamGoalsToFrame();
//   }
//
// ALSO add these to pageTitles:
//   games: 'Couple Games 🎮',
//   dreamgoals: 'Dream Goals 🌟',

// ── 7. DASHBOARD: show dream goals stats ──
// In renderDashboard(), you can add:
// document.getElementById('bucketCount').textContent =
//   (S.bucket || []).length + (S.dreamGoals || []).length;
