/* Twin Hearts - web ads (Google AdSense).
 *
 * Why this file exists: the ONE place that decides whether a web ad may appear.
 * It stays completely OFF until you fill in CFG.client below (after AdSense approves the site).
 *
 * Ads are only ever shown to a signed-out visitor on a public page that has a
 * <div data-th-ad="landing"></div> in it. Never inside the installed app / Android wrapper,
 * and never to anyone signed in (so Pro's "No Ads" is always respected, chats and personal pages stay clean).
 * Until an ad has really filled, nothing is drawn (no empty box).
 */
(function () {
  'use strict';

  var CFG = {
    client: '',                 // e.g. 'ca-pub-8220558701111236' - from AdSense > Account > Settings
    slots: { landing: '' }      // ad unit ids from AdSense > Ads > By ad unit
  };

  if (!CFG.client) return;

  try {
    // Never in the Android wrapper or an installed PWA.
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) return;
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return;
    // Never for anyone signed in.
    var s = JSON.parse(localStorage.getItem('uwl_v5') || '{}');
    if (s && s.setupDone && s.coupleId) return;
  } catch (e) { /* storage blocked: treat as signed out */ }

  function loadLibrary() {
    if (document.querySelector('script[data-th-adsense]')) return;
    var sc = document.createElement('script');
    sc.async = true;
    sc.crossOrigin = 'anonymous';
    sc.setAttribute('data-th-adsense', '1');
    sc.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(CFG.client);
    document.head.appendChild(sc);
  }

  function buildUnit(holder, slotId) {
    var wrap = document.createElement('div');
    wrap.hidden = true; // shown only after Google reports the ad as filled
    wrap.style.cssText = 'max-width:728px;margin:24px auto;padding:0 16px;text-align:center';
    var label = document.createElement('div');
    label.textContent = 'Advertisement';
    label.style.cssText = 'font:11px/1.2 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;opacity:.55;margin-bottom:6px';
    var ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.setAttribute('data-ad-client', CFG.client);
    ins.setAttribute('data-ad-slot', slotId);
    ins.setAttribute('data-ad-format', 'auto');
    ins.setAttribute('data-full-width-responsive', 'true');
    wrap.appendChild(label);
    wrap.appendChild(ins);
    holder.appendChild(wrap);

    new MutationObserver(function (_, obs) {
      if (ins.getAttribute('data-ad-status') === 'filled') { wrap.hidden = false; obs.disconnect(); }
    }).observe(ins, { attributes: true, attributeFilter: ['data-ad-status'] });

    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* blocked by an ad blocker: fine */ }
  }

  function start() {
    loadLibrary(); // also needed while AdSense is reviewing the site
    var holders = document.querySelectorAll('[data-th-ad]');
    for (var i = 0; i < holders.length; i++) {
      var slotId = CFG.slots[holders[i].getAttribute('data-th-ad')];
      if (slotId) buildUnit(holders[i], slotId);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
