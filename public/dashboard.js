/* ══════════════════════════════════════════════════════════════
   DASHBOARD — behaviour for #page-dashboard (markup is in index.html)
   Dashboard.render()  greeting, daily quote, profile avatar, love card
   ConnCard            Hug / Touch / Miss You buttons. Wraps the app's
                       sendHug / sendTouch / sendMissYou and the incoming
                       checks, then shows the matching image on the card.

   Card images: /images/dashboard/{idle,hug,touch,miss}.svg (16:9).
   To use generated artwork, replace those files or change the <img src>
   values in the #dhCard markup in index.html.

   Needs globals from the main app: S, scheduleSave, setAvImg/setAvText.
   ══════════════════════════════════════════════════════════════ */
'use strict';

const Dashboard = (() => {
  // [before, highlighted word, after] — one per day, no network.
  const QUOTES = [
    ['Distance means so little when someone means ', 'everything', '.'],
    ['Every day with you is my favourite ', 'memory', '.'],
    ['Home is wherever I am with ', 'you', '.'],
    ['Miles apart, but always ', 'together', '.'],
    ['You are my today and all of my ', 'tomorrows', '.'],
    ['Love grows stronger with every ', 'heartbeat', '.'],
    ['Two hearts, one ', 'story', '.'],
  ];

  function greeting() {
    const h = new Date().getHours();
    return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Good night';
  }

  function renderHero() {
    const g = document.getElementById('dhGreet');
    if (g) {
      const name = window.S && S.myName ? ', ' + S.myName : '';
      g.textContent = greeting() + name + ' 👋';
    }
    const q = document.getElementById('dhQuote');
    if (q) {
      const day = Math.floor(Date.now() / 86400000);
      const [before, word, after] = QUOTES[day % QUOTES.length];
      const em = document.createElement('em');
      em.textContent = word;
      q.replaceChildren(before, em, after);
    }
    if (typeof setAvImg === 'function') setAvImg('dashAv', window.S && S.myAvatar);
  }

  function render() { renderHero(); ConnCard.render(); }
  return { render };
})();

const ConnCard = (() => {
  // img = which card image to show; btn = button element id
  const KINDS = {
    hug:     { fn: 'sendHug',     check: 'checkIncomingHug',     btn: 'ccHugBtn',   img: 'hug',   label: 'Hug',      emoji: '🤗' },
    touch:   { fn: 'sendTouch',   check: 'checkIncomingTouch',   btn: 'ccTouchBtn', img: 'touch', label: 'Touch',    emoji: '❤️' },
    missyou: { fn: 'sendMissYou', check: 'checkIncomingMissYou', btn: 'ccMissBtn',  img: 'miss',  label: 'Miss You', emoji: '🥺' },
  };

  // How each incoming check tells that something NEW arrived from the partner.
  const INCOMING = {
    touch:   { snap: () => S.touch && S.touch.ts,        hit: b => S.touch && S.touch.from !== S.role && S.touch.ts !== b },
    missyou: { snap: () => S.missYou && S.missYou.ts,    hit: b => S.missYou && S.missYou.from !== S.role && S.missYou.ts !== b },
    hug:     { snap: () => S.hug && S.hug.acceptedTs,    hit: b => S.hug && S.hug.status === 'accepted' && S.hug.acceptedTs !== b },
  };

  const originals = {};   // kind -> app's original send function
  const checks = {};      // kind -> app's original incoming check

  function fmtAgo(ts) {
    if (!ts) return '';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 10) return 'just now';
    if (s < 60) return s + 's ago';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    return h < 24 ? h + 'h ago' : Math.floor(h / 24) + 'd ago';
  }

  function send(kind) {
    const k = KINDS[kind];
    const fn = originals[kind] || (typeof window[k.fn] === 'function' && !window[k.fn]._ccWrapped ? window[k.fn] : null);
    if (!fn || !window.S) return;                        // app not ready yet
    fn();
    S.lastInteraction = { type: kind, from: S.role, ts: Date.now() };
    const btn = document.getElementById(k.btn);
    if (btn) {
      btn.classList.add('is-sent');
      setTimeout(() => btn.classList.remove('is-sent'), 650);
    }
    scheduleSave();
    render();
  }

  function received(kind) {
    S.lastInteraction = { type: kind, from: S.role === 'user1' ? 'user2' : 'user1', ts: Date.now() };
    S.lastReceivedInteraction = { type: kind, ts: Date.now() };
    render();
  }

  function render() {
    if (!window.S) return;
    const li = S.lastInteraction;
    const k = li && KINDS[li.type];

    const showImg = k ? k.img : 'idle';
    document.querySelectorAll('#dhCard .dh-img').forEach(el => el.classList.toggle('is-on', el.dataset.k === showImg));

    const cap = document.getElementById('dhCaption');
    if (cap) {
      cap.textContent = k
        ? `${k.emoji} ${k.label} ${li.from === S.role ? 'sent' : 'received'} · ${fmtAgo(li.ts)}`
        : 'Send some love 💕';
    }
    Object.entries(KINDS).forEach(([kind, def]) => {
      document.getElementById(def.btn)?.classList.toggle('is-active', !!k && li.type === kind);
    });
  }

  // The app defines sendHug etc. later in index.html, so wrap them once they exist.
  function hook() {
    Object.entries(KINDS).forEach(([kind, def]) => {
      if (typeof window[def.fn] === 'function' && !window[def.fn]._ccWrapped) {
        originals[kind] = window[def.fn];
        window[def.fn] = () => send(kind);
        window[def.fn]._ccWrapped = true;
      }
      if (typeof window[def.check] === 'function' && !window[def.check]._ccWrapped) {
        checks[kind] = window[def.check];
        const inc = INCOMING[kind];
        window[def.check] = function () {
          const before = inc.snap();
          checks[kind]();
          if (inc.hit(before)) received(kind);
        };
        window[def.check]._ccWrapped = true;
      }
    });
  }

  function init() {
    let tries = 0;
    const iv = setInterval(() => {
      hook();
      render();
      const ready = Object.keys(KINDS).every(kind => originals[kind] && checks[kind]);
      if (ready || ++tries > 30) clearInterval(iv);
    }, 300);
    // keep the "2m ago" caption fresh while the tab is open
    setInterval(() => { if (!document.hidden) render(); }, 30000);
  }

  return {
    sendHug: () => send('hug'),
    sendTouch: () => send('touch'),
    sendMissYou: () => send('missyou'),
    render,
    init,
  };
})();

// top-level const is not a window property; index.html's renderDashboard() looks it up there
window.Dashboard = Dashboard;
window.ConnCard = ConnCard;

(function autoInit() {
  const start = () => {
    if (typeof window.S === 'undefined') return setTimeout(start, 400);
    Dashboard.render();
    ConnCard.init();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 600));
  else setTimeout(start, 600);
})();
