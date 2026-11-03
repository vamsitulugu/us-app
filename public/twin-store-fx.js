/* TWIN STORE EFFECTS (web) - makes purchased store items visible.
   themes -> chat page + music page colours   | frames -> avatar rings
   decor  -> "Cozy Corner" card on Home        | game packs -> Truth or Dare deck
   Reads the equipped items from /api/rewards/summary (equipped + partnerFrame)
   and re-applies whenever rewards.js equips something. Never sends amounts. */
'use strict';
const TwinStoreFx = (() => {
  const THEMES = {
    theme_sunset:   { dark:1, bg1:'#2A1230', bg2:'#4A1B3F', me1:'#FF7A59', me2:'#FF4F8B', partner:'#3B2142', accent:'#FFB36B', text:'#FFF3EC' },
    theme_midnight: { dark:1, bg1:'#0B0F2A', bg2:'#1E1550', me1:'#7C5CFF', me2:'#B65CFF', partner:'#1B2050', accent:'#8FB4FF', text:'#EEF0FF' },
    theme_rose:     { dark:0, bg1:'#FFF1F4', bg2:'#FFE0E8', me1:'#F2557B', me2:'#E83E8C', partner:'#FFFFFF', accent:'#C2185B', text:'#3A1B26' },
    theme_emerald:  { dark:1, bg1:'#06201C', bg2:'#0F3D3A', me1:'#1FD1A5', me2:'#3AA6FF', partner:'#12332F', accent:'#5CF2C7', text:'#E8FFF8' },
    theme_lavender: { dark:0, bg1:'#F5F0FF', bg2:'#E8DEFF', me1:'#8E6CF0', me2:'#B07CF5', partner:'#FFFFFF', accent:'#6A4CE0', text:'#2A1F4A' },
    theme_cotton:   { dark:0, bg1:'#FFF6F0', bg2:'#EAF4FF', me1:'#FF8FA8', me2:'#FFB38A', partner:'#FFFFFF', accent:'#6FB6FF', text:'#3A2A33' },
  };
  const FRAMES = { frame_gold_heart:'💛', frame_neon_pulse:'⚡', frame_royal_crown:'👑', frame_sparkle_ring:'✨' };
  const DECOR = {
    decor_fairy_lights: { title:'Fairy String Lights', line:'Warm lights twinkling over your Virtual Home' },
    decor_fireplace:    { title:'Cozy Fireplace',      line:'A crackling fire for warm evenings together' },
    decor_love_plant:   { title:'Eternal Love Plant',  line:'Blooms with every milestone you reach' },
    decor_teddy_corner: { title:'Giant Teddy Corner',  line:'A jumbo cuddle teddy waiting for you both' },
  };
  const PACKS = {
    pack_deep_love: { name:'Deep Intimacy Deck', emoji:'🔮',
      truths:['What is a fear you have never fully told me about?','When did you feel closest to me?','What do you need more of from us right now?','What is a memory of us you replay when you miss me?','What part of yourself are you still learning to trust me with?','What does feeling truly safe with me look like?','What is something I do that makes you feel deeply understood?','What did you think the first time you realised you loved me?'],
      dares:['Hold eye contact for one full minute without talking','Tell me three things you admire about me and why','Share one dream you have never said out loud','Write one honest line about how you feel tonight and read it to me','Describe our relationship in three words and explain each','Thank me for something small I did that you never mentioned','Say what you want us to be in ten years','Give me a slow, long hug and say what you are grateful for'] },
    pack_spicy_dares: { name:'Spicy Couple Dares', emoji:'🌶️',
      truths:['What outfit of mine can you not look away from?','What is the most flirty thing you have thought about me today?','Where is your favourite place for me to kiss you?','What is a date night idea that would make your heart race?','What is your boldest flirting moment with me?','What nickname from me gives you butterflies?'],
      dares:['Send me your most flirty voice note','Give me a slow dance, even with no music','Whisper something sweet and daring in my ear','Wink at me three different ways','Plan a surprise candlelit evening for us this week','Feed me something sweet while looking into my eyes','Give me a 30-second shoulder massage','Write a tiny love poem about me, right now'] },
    pack_future_dreams: { name:'Future & Dreams Deck', emoji:'✈️',
      truths:['Where in the world do you want us to wake up together?','What does our dream home look like?','What is one goal you want us to chase together this year?','What tradition do you want us to start?','What adventure is first on our bucket list?','How do you picture our ordinary Sunday in ten years?','What skill would you love us to learn together?','What would you want us to be remembered for?'],
      dares:['Plan our dream holiday in 2 minutes and pitch it','Add one new item to our bucket list right now','Draw our dream house on paper and show me','Pick a date for our next mini adventure and book it in','Name the pet we will have one day, and why','Write a one-line promise for our future and sign it','Choose a song for our future first dance','Describe our wedding or anniversary trip as a movie trailer'] },
  };

  let equipped = {}, partnerFrame = '', booted = false;
  const root = document.documentElement;
  const TW_VARS = ['--tw-bg1','--tw-bg2','--tw-me1','--tw-me2','--tw-partner','--tw-accent','--tw-text','--tw-text2','--tw-text3','--tw-g1','--tw-g2','--tw-border',
                   '--accent','--accent-d','--accent-l','--accent-glow','--accent2','--accent2-d','--accent2-glow',
                   '--mx-bg','--mx-surface','--mx-text','--mx-text2','--mx-text3','--mx-card','--mx-card2','--mx-line','--mx-line2',
                   '--white','--text','--text2','--text3','--g1','--g2','--g3','--border','--border2'];
  const hex2rgb = h => [1,3,5].map(i => parseInt(h.slice(i, i + 2), 16));
  const rgba = (h, a) => { const [r,g,b] = hex2rgb(h); return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'; };

  function themeVars(t) {
    const ink = t.dark ? '#FFFFFF' : '#000000';
    const v = {
      '--tw-bg1': t.bg1, '--tw-bg2': t.bg2, '--tw-me1': t.me1, '--tw-me2': t.me2, '--tw-partner': t.partner,
      '--tw-accent': t.accent, '--tw-text': t.text, '--tw-text2': rgba(t.text, .72), '--tw-text3': rgba(t.text, .5),
      '--tw-g1': rgba(ink, t.dark ? .05 : .04), '--tw-g2': t.dark ? t.partner : t.partner, '--tw-border': rgba(ink, t.dark ? .12 : .09),
      // music page (its own variables)
      '--mx-bg': t.bg1, '--mx-surface': t.partner, '--mx-text': t.text, '--mx-text2': rgba(t.text, .7), '--mx-text3': rgba(t.text, .46),
      '--mx-card': t.partner, '--mx-card2': rgba(ink, t.dark ? .1 : .06), '--mx-line': rgba(ink, t.dark ? .1 : .09), '--mx-line2': rgba(ink, t.dark ? .18 : .16),
      '--accent': t.me1, '--accent-d': t.me2, '--accent-l': t.accent, '--accent-glow': rgba(t.me1, .38),
      '--accent2': t.me2, '--accent2-d': t.me1, '--accent2-glow': rgba(t.me2, .34),
      '--white': t.text, '--text': t.text, '--text2': rgba(t.text, .7), '--text3': rgba(t.text, .46),
      '--g1': rgba(ink, t.dark ? .05 : .04), '--g2': rgba(ink, t.dark ? .09 : .07), '--g3': rgba(ink, t.dark ? .13 : .1),
      '--border': rgba(ink, t.dark ? .1 : .09), '--border2': rgba(ink, t.dark ? .18 : .16),
    };
    return v;
  }

  /* only the chat page keeps the app's other colours: tw vars are global, but the
     --accent/--text overrides are applied to the chat page + frames via CSS/messages */
  function applyTheme() {
    const t = THEMES[equipped.theme];
    TW_VARS.forEach(k => root.style.removeProperty(k));
    if (!t) { root.removeAttribute('data-twin-theme'); root.removeAttribute('data-twin-tone'); broadcast(null); return; }
    const v = themeVars(t);
    // Global: only the --tw-* tokens (safe). Chat page scopes the rest in CSS.
    Object.keys(v).filter(k => k.indexOf('--tw-') === 0).forEach(k => root.style.setProperty(k, v[k]));
    root.setAttribute('data-twin-theme', equipped.theme);
    root.setAttribute('data-twin-tone', t.dark ? 'dark' : 'light');
    broadcast(v);
  }

  /* send the theme to music + games iframes (music/app.js and games.html accept any --var) */
  function broadcast(vars) {
    const msg = vars ? { type: 'theme', vars } : { type: 'theme', vars: {}, reset: TW_VARS };
    const mf = document.getElementById('musicFrame'); if (mf) { try { mf.contentWindow.postMessage(msg, '*'); } catch (_) {} }
  }
  // called from index.html's syncThemeToFrame so frames that load later get it too
  function frameVars() { const t = THEMES[equipped.theme]; return t ? themeVars(t) : null; }

  function frameFor(owner) { return (owner === 'partner' ? partnerFrame : equipped.frame) || ''; }
  function applyFrames() {
    try { if (window.Avatar && Avatar.refreshAll) Avatar.refreshAll(); } catch (_) {}
    const mine = equipped.frame || '';
    const dash = document.getElementById('dashAv');
    if (dash) { mine ? dash.setAttribute('data-twin-frame', mine) : dash.removeAttribute('data-twin-frame'); }
  }

  /* DECOR: Cozy Corner card on Home */
  function sceneHTML(id) {
    if (id === 'decor_fairy_lights') return '<div class="tw-lights">' + Array.from({ length: 14 }, (_, i) => '<i style="--i:' + i + '"></i>').join('') + '</div>';
    if (id === 'decor_fireplace') return '<div class="tw-fire"><span class="tw-fl f1"></span><span class="tw-fl f2"></span><span class="tw-fl f3"></span><div class="tw-logs"></div></div>';
    if (id === 'decor_love_plant') return '<div class="tw-plant"><span>🪴</span><b class="h1">💚</b><b class="h2">💚</b><b class="h3">💚</b></div>';
    if (id === 'decor_teddy_corner') return '<div class="tw-teddy"><span>🧸</span></div>';
    return '';
  }
  function applyDecor() {
    let el = document.getElementById('twCozy');
    const d = DECOR[equipped.decor];
    if (!d) { if (el) el.remove(); return; }
    if (!el) {
      const host = document.getElementById('rwStrip') || document.querySelector('#page-dashboard .dh');
      if (!host) return;
      el = document.createElement('section'); el.id = 'twCozy'; el.className = 'tw-cozy';
      host.insertAdjacentElement(host.id === 'rwStrip' ? 'afterend' : 'afterend', el);
    }
    el.setAttribute('data-decor', equipped.decor);
    el.innerHTML = '<div class="tw-cozy-scene">' + sceneHTML(equipped.decor) + '</div>' +
      '<div class="tw-cozy-txt"><b>Your Cozy Corner</b><span>' + d.title + ' · ' + d.line + '</span></div>';
  }

  /* GAME PACK: add a deck to Truth or Dare (games.html listens for twinPack) */
  function sendPack() {
    const p = PACKS[equipped.game];
    const msg = { type: 'twinPack', pack: p ? { id: equipped.game, name: p.name, emoji: p.emoji, truths: p.truths, dares: p.dares } : null };
    document.querySelectorAll('iframe').forEach(f => { try { f.contentWindow.postMessage(msg, '*'); } catch (_) {} });
  }
  function gamePack() { const p = PACKS[equipped.game]; return p ? { id: equipped.game, name: p.name, emoji: p.emoji, truths: p.truths, dares: p.dares } : null; }

  function update(eq, pf) {
    equipped = eq || {}; partnerFrame = pf || '';
    try { localStorage.setItem('twin_fx_cache', JSON.stringify({ e: equipped, p: partnerFrame })); } catch (_) {}
    applyTheme(); applyFrames(); applyDecor(); sendPack();
  }

  async function refresh() {
    if (!(window.S && S.userId && S.coupleId)) return false;
    try {
      const base = typeof API !== 'undefined' ? API : '';
      const r = await fetch(base + '/api/rewards/summary?coupleId=' + encodeURIComponent(S.coupleId) + '&userId=' + encodeURIComponent(S.userId), { headers: { 'x-user-id': S.userId } });
      if (!r.ok) return false;
      const d = await r.json(); update(d.equipped, d.partnerFrame); return true;
    } catch (_) { return false; }
  }

  function boot() {
    if (booted) return; booted = true;
    try { const c = JSON.parse(localStorage.getItem('twin_fx_cache') || 'null'); if (c) update(c.e, c.p); } catch (_) {}   // paint instantly from last session
    let tries = 0; const iv = setInterval(async () => { if (await refresh() || ++tries > 40) clearInterval(iv); }, 1500);
    // frames and the home strip are created later: re-apply when they appear
    window.addEventListener('load', () => { setTimeout(() => { applyFrames(); applyDecor(); sendPack(); }, 1200); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    document.querySelectorAll('iframe').forEach(f => f.addEventListener('load', () => { if (f.id === 'musicFrame') broadcast(frameVars()); sendPack(); }));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  return { update, refresh, frameFor, frameVars, gamePack, THEMES, PACKS };
})();
window.TwinStoreFx = TwinStoreFx;
