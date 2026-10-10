/* ══════════════════════════════════════════════════════════════
   PROFILE PAGE — views, editors and actions for #page-profile
   Styles: /profile.css

   Screens (all inside the one #page-profile, switched in place):
     main        overview: couple hero, quick actions, stats, next date, story
     partner     partner details + connection
     settings    "Profile & Settings" grouped list
     milestones  relationship timeline
     love        love languages
     story       "Our Story" / about bios

   Data lives in the shared state `S` (myName, partnerName, anniversary,
   myBday, ptBday, myBio, partnerBio, myLoveLang, ptLoveLang, milestones,
   events, photos, bucket) — nothing new is stored. Avatars are kept in
   sync by the existing ids profAv1 / profAv2 / profAv3 (see applyNames()
   and the ProfileStore listener in index.html).
   ══════════════════════════════════════════════════════════════ */
'use strict';

(function () {
  const $ = id => document.getElementById(id);
  const DAY = 864e5;

  /* ── Icons (24px stroke set, inline so they never wait on a CDN) ── */
  const P = {
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    chev: '<path d="m9 18 6-6-6-6"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
    star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
    message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    cake: '<path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"/><path d="M2 21h20"/><path d="M7 8v3"/><path d="M12 8v3"/><path d="M17 8v3"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    unlink: '<path d="M2 21a8 8 0 0 1 13.292-6"/><circle cx="10" cy="8" r="5"/><path d="M22 19h-6"/>'
  };
  const ico = (n, c) => '<svg class="pf-i' + (c ? ' ' + c : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + P[n] + '</svg>';
  const chip = n => '<span class="pf-chip">' + ico(n) + '</span>';

  /* ── Love languages ── */
  const LANGS = [
    ['Words of Affirmation', '💬'], ['Quality Time', '⏰'], ['Acts of Service', '🛠️'],
    ['Physical Touch', '🤗'], ['Receiving Gifts', '🎁']
  ];
  const TIPS = {
    'Words of Affirmation + Quality Time': 'Say "I love you" during your quality time — compliments land deepest when you\'re fully present together.',
    'Words of Affirmation + Acts of Service': 'Leave sweet notes when you help with tasks — combine words with actions for maximum impact.',
    'Quality Time + Physical Touch': 'Cuddle while watching something together — your partner feels most loved when you\'re close AND present.',
    'Quality Time + Words of Affirmation': 'Plan date nights where you express feelings out loud. Undivided attention + kind words = their ideal love.',
    'Acts of Service + Receiving Gifts': 'Surprise them with a small gift AND do something helpful — both fill their love tank equally.',
    'Physical Touch + Receiving Gifts': 'A warm hug when you give them even a small gift makes it 10x more meaningful.',
    'default': 'Understanding each other\'s love language is the first step. Try expressing love in their language every day this week!'
  };

  /* ── Settings list (title, subtitle, icon, action) ── */
  const MENU = [
    ['Profile & Partner', [
      ['Personal Profile', 'Edit your name, bio, photo and dates', 'user', 'editMe'],
      ['Partner Connection', 'View and manage partner details', 'users', 'open:partner']
    ]],
    ['Relationship', [
      ['Special Dates', 'Birthdays, anniversaries and events', 'calendar', 'go:calendar'],
      ['Milestones', 'View and add relationship milestones', 'star', 'open:milestones'],
      ['Memories', 'Your shared photos and videos', 'image', 'go:camera'],
      ['Our Story', 'Write and edit your love story', 'book', 'open:story'],
      ['Love Languages', 'Yours and your partner\'s', 'heart', 'open:love'],
      ['Relationship Goals', 'Set and track goals together', 'target', 'go:dreamgoals']
    ]],
    ['App Settings', [
      ['Notifications', 'Message and date reminders', 'bell', 'setting:notifications'],
      ['Privacy & Security', 'Lock, PIN and visibility', 'lock', 'setting:privacy'],
      ['Backup & Sync', 'Keep your data safe across devices', 'cloud', 'setting:backup'],
      ['Theme & Appearance', 'Choose app theme and style', 'palette', 'setting:appearance'],
      ['Export My Data', 'Download your memories and data', 'download', 'exportData']
    ]]
  ];

  /* ── Small helpers ── */
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const parseD = s => new Date(s + 'T00:00:00');
  const isoDate = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const partnerName = () => S.partnerName || 'Partner';
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  function togetherSpan(from) {
    if (!from) return '';
    const a = parseD(from), t = today();
    if (a > t) return 'Starts ' + fmtDate(from);
    let y = t.getFullYear() - a.getFullYear(), m = t.getMonth() - a.getMonth(), d = t.getDate() - a.getDate();
    if (d < 0) { m--; d += new Date(t.getFullYear(), t.getMonth(), 0).getDate(); }
    if (m < 0) { y--; m += 12; }
    const parts = [];
    if (y) parts.push(plural(y, 'Year'));
    if (m) parts.push(plural(m, 'Month'));
    if (d || !parts.length) parts.push(plural(d, 'Day'));
    return parts.join(' • ');
  }

  function zodiac(s) {
    if (!s) return '';
    const d = parseD(s), m = d.getMonth() + 1, day = d.getDate();
    const starts = [[1, 20, 'Aquarius ♒'], [2, 19, 'Pisces ♓'], [3, 21, 'Aries ♈'], [4, 20, 'Taurus ♉'], [5, 21, 'Gemini ♊'], [6, 21, 'Cancer ♋'],
      [7, 23, 'Leo ♌'], [8, 23, 'Virgo ♍'], [9, 23, 'Libra ♎'], [10, 23, 'Scorpio ♏'], [11, 22, 'Sagittarius ♐'], [12, 22, 'Capricorn ♑']];
    let sign = 'Capricorn ♑';
    starts.forEach(([mo, sd, name]) => { if (m > mo || (m === mo && day >= sd)) sign = name; });
    return sign;
  }

  // Next time a yearly date (birthday / anniversary) comes round, today included.
  function nextYearly(s) {
    const d = parseD(s), t = today();
    let n = new Date(t.getFullYear(), d.getMonth(), d.getDate());
    if (n < t) n = new Date(t.getFullYear() + 1, d.getMonth(), d.getDate());
    return n;
  }

  function nextImportant() {
    const t = today(), list = [];
    (S.events || []).forEach(e => { if (e.date && parseD(e.date) >= t) list.push({ title: e.title, date: parseD(e.date), icon: e.cat === 'Birthday' ? 'cake' : 'gift' }); });
    if (S.anniversary) list.push({ title: 'Anniversary', date: nextYearly(S.anniversary), icon: 'heart' });
    if (S.myBday) list.push({ title: 'Your Birthday', date: nextYearly(S.myBday), icon: 'cake' });
    if (S.ptBday) list.push({ title: partnerName() + '\'s Birthday', date: nextYearly(S.ptBday), icon: 'cake' });
    list.sort((a, b) => a.date - b.date);
    return list[0] || null;
  }

  /* ── Views ── */
  const VIEWS = ['main', 'partner', 'settings', 'milestones', 'love', 'story'];
  let stack = ['main'];
  let built = false;

  const bar = (title, right) =>
    '<header class="pf-bar"><button class="pf-icon-btn" data-act="back" aria-label="Back">' + ico('back') + '</button><h1>' + title + '</h1>' + (right || '') + '</header>';

  function build() {
    const root = $('pf');
    if (!root || built) return;
    built = true;

    const menu = MENU.map(([title, rows]) =>
      '<div class="pf-group-t">' + title + '</div><div class="pf-list">' +
      rows.map(([t, sub, icon, act]) =>
        '<button class="pf-row" data-act="' + act + '">' + chip(icon) +
        '<span class="pf-row-t"><b>' + t + '</b><span>' + sub + '</span></span>' + ico('chev', 'pf-chev') + '</button>').join('') +
      '</div>').join('');

    root.innerHTML =
      /* main */
      '<section class="pf-view" data-view="main">' +
        '<header class="pf-bar"><div class="pf-brand"><img src="/icons/icon-192.png" alt=""><h1>Twin Hearts</h1></div>' +
        '<button class="pf-icon-btn" data-act="open:settings" aria-label="Profile and settings">' + ico('gear') + '</button></header>' +
        '<div class="pf-body">' +
          '<div class="pf-hero"><div class="pf-couple">' +
            '<div class="pf-person"><div class="pf-av-wrap"><button type="button" class="pf-av av1" id="profAv1" data-act="pickAvatar" aria-label="Change your photo"></button><span class="pf-cam">' + ico('camera') + '</span></div>' +
              '<div class="pf-name" id="profMyName">You</div></div>' +
            '<div class="pf-mid"><div class="pf-heart-link">' + ico('heart') + '</div>' +
              '<span class="pf-since-l">Together since</span>' +
              '<button class="pf-since-d" data-act="editMe"><span id="profAnnivText">—</span>' + ico('pencil') + '</button></div>' +
            '<div class="pf-person"><div class="pf-av-wrap"><button type="button" class="pf-av av2" id="profAv2" data-act="viewAvatar" aria-label="View partner photo"></button></div>' +
              '<div class="pf-name" id="profPtName">Partner</div><div class="pf-presence" id="pfPresence"></div></div>' +
          '</div><div class="pf-span" id="pfSpan"></div></div>' +
          '<div class="pf-actions">' +
            '<button class="pf-act" data-act="editMe">' + ico('user') + 'Edit Profile</button>' +
            '<button class="pf-act" data-act="open:partner">' + ico('users') + 'Partner Details</button>' +
            '<button class="pf-act is-primary" data-act="addDate">' + ico('calendar') + 'Add Date</button>' +
          '</div>' +
          '<div class="pf-stats">' +
            '<button class="pf-stat" data-act="go:camera">' + chip('image') + '<span><span class="pf-stat-n" id="pfStPhotos">0</span><span class="pf-stat-l">Memories</span></span></button>' +
            '<button class="pf-stat" data-act="open:milestones">' + chip('star') + '<span><span class="pf-stat-n" id="pfStMiles">0</span><span class="pf-stat-l">Milestones</span></span></button>' +
            '<button class="pf-stat" data-act="go:calendar">' + chip('calendar') + '<span><span class="pf-stat-n" id="pfStDates">0</span><span class="pf-stat-l">Special Dates</span></span></button>' +
            '<button class="pf-stat" data-act="go:bucket">' + chip('heart') + '<span><span class="pf-stat-n" id="pfStDreams">0</span><span class="pf-stat-l">Dreams</span></span></button>' +
          '</div>' +
          '<div class="pf-card"><div class="pf-card-head"><h2>Next Important Date</h2><button class="pf-link-btn" data-act="go:calendar">View All' + ico('chev') + '</button></div><div id="pfNext"></div></div>' +
          '<div class="pf-card pf-story" data-act="open:story">' + chip('book') +
            '<div class="pf-story-t"><b>Our Story<span class="pf-link-btn">Edit' + ico('chev') + '</span></b><p id="pfStoryPrev"></p></div></div>' +
        '</div>' +
      '</section>' +

      /* partner */
      '<section class="pf-view" data-view="partner" hidden>' + bar('Partner Details') +
        '<div class="pf-body">' +
          '<div class="pf-card pf-pcard">' +
            '<div class="pf-av-wrap"><button type="button" class="pf-av av2" id="profAv3" data-act="viewAvatar" aria-label="View partner photo"></button></div>' +
            '<div><h2 class="pf-pname" id="pfPName">Partner</h2></div><div><span class="pf-pill" id="pfPPill"></span></div>' +
            '<div class="pf-pbtns"><button class="pf-btn is-primary" id="pfMsgBtn" data-act="go:chat">' + ico('message') + 'Message</button>' +
            '<button class="pf-btn" data-act="editPartner">' + ico('pencil') + 'Edit Details</button></div>' +
          '</div>' +
          '<div class="pf-list" id="pfPList"></div>' +
          '<div class="pf-card" id="partnerConnectionBody">' +
            '<div class="pf-card-head"><h2>Partner Connection</h2></div>' +
            '<div id="pfConnectForm"><p class="pf-hint">Find your partner using their phone number.</p>' +
            '<div class="field"><label>Partner Phone Number</label><input type="tel" id="profPartnerPhone" placeholder="10-digit phone number" inputmode="numeric" maxlength="10" autocomplete="off"></div>' +
            '<button class="btn btn-accent" data-act="sendRequest">Send Connection Request</button></div>' +
            '<div id="profPairStatus" class="pf-hint" style="margin:10px 0 0">Not Connected</div>' +
          '</div>' +
          '<div class="pf-list" id="pfRemove" hidden><button class="pf-row is-danger" data-act="removePartner">' + chip('unlink') +
            '<span class="pf-row-t"><b>Remove Partner</b><span>Disconnect — your data stays safe</span></span></button></div>' +
        '</div>' +
      '</section>' +

      /* settings */
      '<section class="pf-view" data-view="settings" hidden>' + bar('Profile & Settings') + '<div class="pf-body">' + menu + '</div></section>' +

      /* milestones */
      '<section class="pf-view" data-view="milestones" hidden>' +
        bar('Milestones', '<button class="pf-icon-btn" data-act="addMilestone" aria-label="Add milestone">' + ico('plus') + '</button>') +
        '<div class="pf-body" id="pfMilestones"></div></section>' +

      /* love languages */
      '<section class="pf-view" data-view="love" hidden>' + bar('Love Languages') + '<div class="pf-body" id="pfLove"></div></section>' +

      /* story */
      '<section class="pf-view" data-view="story" hidden>' + bar('Our Story') +
        '<div class="pf-body">' +
          '<div class="field"><label>About you</label><textarea class="pf-ta" id="pfBioMe" placeholder="Write something sweet..."></textarea></div>' +
          '<div class="field"><label id="pfBioPtLabel">About your partner</label><textarea class="pf-ta" id="pfBioPt" placeholder="About your partner..."></textarea></div>' +
          '<button class="btn btn-accent" data-act="saveStory">Save</button>' +
        '</div></section>';

    root.addEventListener('click', onClick);
  }

  /* ── Navigation between screens ── */
  function show(view) {
    VIEWS.forEach(v => { const s = document.querySelector('#pf [data-view="' + v + '"]'); if (s) s.hidden = v !== view; });
    renderView(view);
    const c = document.querySelector('.content'); if (c) c.scrollTop = 0;
  }
  function open(view) { stack.push(view); show(view); }
  function back() { if (stack.length > 1) { stack.pop(); show(stack[stack.length - 1]); } else goBack(); }
  // Called by goBack() so the hardware Back button steps out of a sub-screen first.
  function handleBack() {
    const active = document.getElementById('page-profile');
    if (!active || !active.classList.contains('active') || stack.length < 2) return false;
    back(); return true;
  }

  /* ── Renderers ── */
  function renderView(v) {
    ({ main: renderMain, partner: renderPartner, milestones: renderMilestones, love: renderLove, story: renderStory })[v]?.();
  }

  function renderMain() {
    applyNames(); // names + avatar images for profAv1 / profAv2
    $('profAnnivText').textContent = S.anniversary ? fmtDate(S.anniversary) : 'Set date';
    $('pfSpan').textContent = togetherSpan(S.anniversary);
    $('pfStPhotos').textContent = (S.photos || []).length;
    $('pfStMiles').textContent = (S.milestones || []).length;
    $('pfStDates').textContent = (S.events || []).length;
    $('pfStDreams').textContent = (S.bucket || []).length;

    const pres = $('pfPresence'), ts = (S.ptLoc || {}).ts;
    if (S.paired && ts && Date.now() - ts < 5 * 60e3) pres.innerHTML = '<span class="pf-dot on"></span>Online';
    else if (S.paired && ts) pres.innerHTML = '<span class="pf-dot"></span>' + esc(fmtLastSeen(ts) || '');
    else pres.textContent = S.paired ? '' : 'Not connected';

    const n = nextImportant();
    $('pfNext').innerHTML = n
      ? (() => {
          const left = Math.round((n.date - today()) / DAY);
          return '<div class="pf-next" data-act="go:calendar">' + chip(n.icon) +
            '<div class="pf-next-t"><b>' + esc(n.title) + '</b><span>' + fmtDate(isoDate(n.date)) + '</span></div>' +
            '<div class="pf-days"><b>' + (left === 0 ? 'Today' : left) + '</b>' + (left === 0 ? '' : '<span>' + (left === 1 ? 'Day left' : 'Days left') + '</span>') + '</div></div>';
        })()
      : '<p class="pf-empty">No upcoming dates yet — tap Add Date to create one.</p>';

    $('pfStoryPrev').textContent = S.myBio || 'Write a few lines about the two of you.';
  }

  function renderPartner() {
    applyNames();
    setAvImg('profAv3', S.partnerAvatar);
    $('pfPName').textContent = partnerName();
    const pill = $('pfPPill');
    pill.className = 'pf-pill' + (S.paired ? ' ok' : '');
    pill.textContent = S.paired ? 'Connected' : (S.partnerRequestSent ? 'Waiting for partner' : 'Not connected');
    $('pfMsgBtn').hidden = !S.paired;
    $('pfConnectForm').hidden = S.paired || !!S.partnerRequestSent;
    $('pfRemove').hidden = !S.paired;
    $('profPairStatus').textContent = S.paired ? 'Connected with ' + partnerName() : (S.partnerRequestSent ? 'Waiting for Partner' : 'Not Connected');

    const rows = [];
    const row = (icon, label, value, act) =>
      '<' + (act ? 'button' : 'div') + ' class="pf-row' + (act ? '' : ' is-static') + '"' + (act ? ' data-act="' + act + '"' : '') + '>' + chip(icon) +
      '<span class="pf-row-t"><b>' + label + '</b><span>' + esc(value) + '</span></span>' + (act ? ico('chev', 'pf-chev') : '') + '</' + (act ? 'button' : 'div') + '>';
    rows.push(row('cake', 'Birthday', S.ptBday ? fmtDate(S.ptBday) : 'Not added', 'editPartner'));
    if (S.ptBday) rows.push(row('star', 'Zodiac', zodiac(S.ptBday)));
    rows.push(row('heart', 'Love Language', S.ptLoveLang || 'Not chosen', 'open:love'));
    rows.push(row('book', 'About ' + esc(partnerName()), S.partnerBio || 'Add a few words', 'editPartner'));
    const ts = (S.ptLoc || {}).ts;
    if (S.paired && ts) rows.push(row('clock', 'Last active', fmtLastSeen(ts) || ''));
    $('pfPList').innerHTML = rows.join('');
  }

  function renderMilestones() {
    const el = $('pfMilestones');
    const all = [...(S.milestones || [])].sort((a, b) => b.date.localeCompare(a.date));
    if (!all.length) {
      PS.empty(el, { icon: 'heart', title: 'No milestones yet', desc: 'Mark the moments that matter — firsts, trips, anniversaries.', actionLabel: 'Add Milestone', onAction: () => openM('milestoneModal'), compact: true });
      return;
    }
    let html = '', year = null;
    all.forEach(m => {
      const y = parseD(m.date).getFullYear();
      if (y !== year) { html += '<div class="pf-year">' + y + '</div>'; year = y; }
      html += '<div class="pf-ms"><span class="pf-ms-e">' + esc(m.type || '💫') + '</span><div class="pf-ms-t"><b>' + esc(m.title) + '</b><small>' + fmtDate(m.date) + '</small>' +
        (m.note ? '<p>' + esc(m.note) + '</p>' : '') + '</div><button class="pf-del" data-act="delMilestone:' + m.id + '" aria-label="Delete milestone">' + ico('trash') + '</button></div>';
    });
    el.innerHTML = '<div class="pf-tl">' + html + '</div>';
  }

  function renderLove() {
    const card = (who, title, current) =>
      '<div class="pf-group-t">' + esc(title) + '</div><div class="pf-list">' +
      LANGS.map(([name, emoji]) =>
        '<button class="pf-opt' + (current === name ? ' is-on' : '') + '" data-act="love:' + who + '|' + name + '"><span>' + emoji + '</span>' + name + '<span class="pf-radio"></span></button>').join('') +
      '</div>';
    const both = S.myLoveLang && S.ptLoveLang;
    $('pfLove').innerHTML = card('me', 'Your love language', S.myLoveLang) + card('pt', partnerName() + '\'s love language', S.ptLoveLang) +
      (both ? '<div class="pf-tip">💡<span>' + esc(TIPS[S.myLoveLang + ' + ' + S.ptLoveLang] || TIPS.default) + '</span></div>' : '');
  }

  function renderStory() {
    $('pfBioMe').value = S.myBio || '';
    $('pfBioPt').value = S.partnerBio || '';
    $('pfBioPtLabel').textContent = 'About ' + partnerName();
  }

  /* ── Bottom-sheet editors ── */
  function sheet(title, body, onSave) {
    let bg = $('pfSheet');
    if (!bg) { bg = document.createElement('div'); bg.id = 'pfSheet'; bg.className = 'modal-bg pf-sheet-bg'; document.body.appendChild(bg); }
    bg.innerHTML = '<div class="modal pf-sheet"><div class="pf-grab"></div><div class="modal-title">' + title +
      '<button class="modal-close" data-sheet="close" aria-label="Close">' + ico('x') + '</button></div>' + body +
      '<button class="btn btn-accent" style="width:100%;justify-content:center" data-sheet="save">Save</button></div>';
    bg.onclick = e => {
      if (e.target === bg || e.target.closest('[data-sheet="close"]')) { closeM('pfSheet'); return; }
      if (e.target.closest('[data-sheet="save"]')) { onSave(); closeM('pfSheet'); }
    };
    openM('pfSheet');
  }
  const field = (label, input) => '<div class="field"><label>' + label + '</label>' + input + '</div>';
  const val = id => $(id).value;

  function afterEdit() {
    applyNames(); scheduleSave();
    if (typeof renderDashboard === 'function') renderDashboard();
    if (typeof syncLoveCounterToFrame === 'function') syncLoveCounterToFrame();
    renderView(stack[stack.length - 1]);
  }

  function editMe() {
    const g = window.Gender ? Gender.mine() : '';
    sheet('Edit Profile',
      field('Your name', '<input type="text" id="pfEName" maxlength="40" value="' + esc(S.myName === 'You' ? '' : S.myName) + '" placeholder="Your name">') +
      field('Your birthday', '<input type="date" id="pfEBday" value="' + esc(S.myBday || '') + '">') +
      field('Together since', '<input type="date" id="pfEAnniv" value="' + esc(S.anniversary || '') + '">') +
      field('I am', '<select id="pfEGender"><option value="">Choose…</option><option value="female"' + (g === 'female' ? ' selected' : '') + '>Girl</option><option value="male"' + (g === 'male' ? ' selected' : '') + '>Boy</option></select>') +
      field('Bio', '<textarea id="pfEBio" maxlength="300" placeholder="Write something sweet...">' + esc(S.myBio || '') + '</textarea>'),
      () => {
        S.myName = val('pfEName').trim() || 'You';
        S.myBday = val('pfEBday'); S.anniversary = val('pfEAnniv'); S.myBio = val('pfEBio');
        const g2 = val('pfEGender'); if (g2 && window.Gender) Gender.set(g2);
        pushMyProfile(); afterEdit(); toast('Profile saved 💕');
      });
  }

  function editPartner() {
    // When connected, name + birthday come from the partner's own profile, so only the shared notes are editable.
    const own = S.paired;
    sheet('Edit Details',
      (own ? '' :
        field('Name', '<input type="text" id="pfPEName" maxlength="40" value="' + esc(S.partnerName === 'Partner' ? '' : S.partnerName) + '" placeholder="Partner name">') +
        field('Birthday', '<input type="date" id="pfPEBday" value="' + esc(S.ptBday || '') + '">')) +
      field('About ' + esc(partnerName()), '<textarea id="pfPEBio" maxlength="300" placeholder="About your partner...">' + esc(S.partnerBio || '') + '</textarea>'),
      () => {
        if (!own) { S.partnerName = val('pfPEName').trim() || 'Partner'; S.ptBday = val('pfPEBday'); }
        S.partnerBio = val('pfPEBio');
        afterEdit(); toast('Saved 💕');
      });
  }

  /* ── Actions ── */
  function openAppSetting(key) {
    goto('settings');
    setTimeout(() => {
      const h = [...document.querySelectorAll('#page-settings .settings-group-header')].find(x => x.textContent.toLowerCase().includes(key));
      if (h) h.closest('.settings-group').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }

  const ACTIONS = {
    open, back, editMe, editPartner,
    go: p => goto(p),
    setting: openAppSetting,
    addDate: () => openM('eventModal'),
    addMilestone: () => openM('milestoneModal'),
    pickAvatar: () => pickAvatar('my'),
    viewAvatar: () => viewAvatar('pt'),
    exportData: () => exportData(),
    sendRequest: () => sendPartnerRequestFromProfile(),
    removePartner: () => confirmRemovePartner(),
    delMilestone: id => delMilestone(Number(id)),
    love: arg => {
      const [who, name] = arg.split('|');
      if (who === 'me') S.myLoveLang = S.myLoveLang === name ? '' : name; else S.ptLoveLang = S.ptLoveLang === name ? '' : name;
      scheduleSave(); renderLove();
    },
    saveStory: () => {
      S.myBio = val('pfBioMe'); S.partnerBio = val('pfBioPt');
      scheduleSave(); toast('Saved 💕'); back();
    }
  };

  function onClick(e) {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const s = el.dataset.act, i = s.indexOf(':');
    const fn = ACTIONS[i < 0 ? s : s.slice(0, i)];
    if (fn) fn(i < 0 ? undefined : s.slice(i + 1));
  }

  /* ── Public entry points ── */
  function render() { build(); stack = ['main']; show('main'); }
  // Refresh whichever screen is showing (called after milestones change, etc.)
  function refresh() { if (built) renderView(stack[stack.length - 1]); }

  window.renderProfile = render;
  window.Prof = { render, refresh, open, back, handleBack };
})();
