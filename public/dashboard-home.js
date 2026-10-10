/* Dashboard (Home) redesign — hero greeting/quote + love-image card.
   Tap Hug / Miss You / Touch -> existing ConnCard send logic runs AND the
   matching image shows. Images go in /public/images/dashboard/{hug,miss,touch}.png */
(function () {
  const QUOTES = [
    ['Distance means so little when ', 'someone', ' means so much'],
    ['Every day with you is my ', 'favorite', ' day'],
    ['Miles apart, but always ', 'close', ' at heart'],
    ['Wherever you are, my ', 'heart', ' is home'],
    ['Two hearts, one ', 'story', ''],
    ['Love grows ', 'stronger', ' across every mile'],
    ['You are my favorite ', 'notification', ''],
    ['Together is a ', 'feeling', ', not a place'],
    ['Close your eyes, I am ', 'right here', ''],
    ['Every moment with you is a ', 'memory', ' in the making']
  ];
  const SEND = { hug: 'sendHug', miss: 'sendMissYou', touch: 'sendTouch' };

  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }

  function renderDashHero() {
    const g = document.getElementById('dxGreet');
    const q = document.getElementById('dxQuote');
    if (!g || !q) return;
    const name = (window.S && S.myName) ? S.myName : 'love';
    g.textContent = greeting() + ', ' + name + ' 💕';
    const day = Math.floor(Date.now() / 86400000);
    const [pre, accent, post] = QUOTES[day % QUOTES.length];
    q.textContent = '';
    q.append(document.createTextNode(pre));
    const em = document.createElement('em'); em.textContent = accent; q.append(em);
    if (post) q.append(document.createTextNode(post));
  }

  function show(type) {
    document.querySelectorAll('#dxStage .dx-slide').forEach(s => s.classList.toggle('on', s.dataset.type === type));
    document.querySelectorAll('#dxActs .dx-act').forEach(b => {
      const on = b.dataset.type === type;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function tap(type) {
    show(type);
    try {
      if (typeof ConnCard !== 'undefined' && ConnCard[SEND[type]]) ConnCard[SEND[type]]();
    } catch (e) { console.warn('[dash] send failed', e); }
  }

  // image fallback: if the PNG isn't there yet, keep the emoji placeholder
  function wireImages() {
    document.querySelectorAll('#dxStage .dx-slide img').forEach(img => {
      img.addEventListener('error', () => { img.hidden = true; });
      img.addEventListener('load', () => { img.hidden = false; });
    });
  }

  window.renderDashHero = renderDashHero;
  window.DashLove = { tap, show };

  function init() { wireImages(); renderDashHero(); show('hug'); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
