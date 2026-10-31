/* ════════════════════════════════════════════════════════════════
   Twin Hearts — Pro (Razorpay) · shared module
   Monthly ₹99 (30 days) · Yearly ₹499 (365 days) · Lifetime ₹999
   Include in any page / iframe that gates a feature:
     <script src="/js/pro-card.js"></script>
   Then:   if (await ProCard.requirePro('Pin a Memory')) { ...do it... }
   requirePro() → true when the couple is Pro; otherwise it opens the
   upgrade sheet and resolves true only if they finish paying.
   Prices are only for display: the server decides what is charged.
 ═════════════════════════════════════════════════════════════════ */
'use strict';
(function () {
  if (window.ProCard) return;

  var RENDER = 'https://us-app-av6d.onrender.com';
  function apiBase() {
    try { if (window.parent && window.parent.API) return String(window.parent.API).replace(/\/$/, ''); } catch (e) {}
    return (window.API && String(window.API).replace(/\/$/, '')) || RENDER;
  }

  var PLANS = [
    { id: 'monthly',  label: 'Monthly',  price: 99,  per: '30 days',  note: 'One-time payment · no auto-renew' },
    { id: 'yearly',   label: 'Yearly',   price: 499, per: '365 days', note: 'Save 58% vs monthly', badge: 'Popular' },
    { id: 'lifetime', label: 'Lifetime', price: 999, per: 'forever',  note: 'Pay once, keep Pro forever', badge: 'Best value' }
  ];

  var MODAL_ID = 'th-pro-modal';
  var CACHE_MS = 60 * 1000;
  var cache = { key: null, st: null, ts: 0 };
  var listeners = [];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function session() {
    try { var s = window.parent && window.parent.S; if (s && s.coupleId && s.userId) return { coupleId: s.coupleId, userId: s.userId }; } catch (e) {}
    try {
      var d = JSON.parse(localStorage.getItem('uwl_v5') || 'null');
      if (d && d.coupleId && d.userId) return { coupleId: d.coupleId, userId: d.userId };
      if (d && d.coupleId) return { coupleId: d.coupleId, userId: null };
    } catch (e) {}
    return null;
  }

  async function call(method, path, body) {
    var s = session();
    var res = await fetch(apiBase() + path, {
      method: method,
      headers: { 'Content-Type': 'application/json', 'x-user-id': (s && s.userId) || '' },
      body: body ? JSON.stringify(body) : undefined
    });
    var data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) { var err = new Error(data.error || ('Request failed (' + res.status + ')')); err.status = res.status; throw err; }
    return data;
  }

  /* ── status ───────────────────────────────────────────────────── */
  async function status(force) {
    var s = session();
    if (!s) return { isPro: false, plan: null, expiresAt: null };
    var now = Date.now();
    // A known-Pro answer is trusted longer, so the gated button can open a file picker right away
    // (browsers only allow it within a few seconds of the tap). The server re-checks anyway.
    var ttl = cache.st && cache.st.isPro ? 5 * CACHE_MS : CACHE_MS;
    if (!force && cache.key === s.coupleId && cache.st && now - cache.ts < ttl) return cache.st;
    try {
      var st = await call('GET', '/api/pro/status?coupleId=' + encodeURIComponent(s.coupleId));
      cache = { key: s.coupleId, st: st, ts: now };
      return st;
    } catch (e) {
      // Offline / server asleep: keep the last known answer instead of locking a paying couple out.
      if (cache.key === s.coupleId && cache.st) return cache.st;
      throw e;
    }
  }
  async function isPro(force) { try { return !!(await status(force)).isPro; } catch (e) { return false; } }

  function changed(st) {
    listeners.forEach(function (fn) { try { fn(st); } catch (e) {} });
    try { localStorage.setItem('th_pro_ping', String(Date.now())); } catch (e) {}
  }
  function onChange(fn) { listeners.push(fn); }
  // Another tab / the Pro page / a sibling iframe just changed Pro → drop the cache.
  window.addEventListener('storage', function (e) {
    if (e.key === 'th_pro_ping') { cache.ts = 0; status(true).then(changed2).catch(function () {}); }
  });
  function changed2(st) { listeners.forEach(function (fn) { try { fn(st); } catch (e) {} }); }

  /* ── Razorpay checkout ────────────────────────────────────────── */
  var rzpLoading = null;
  function loadRazorpay() {
    if (window.Razorpay) return Promise.resolve();
    if (rzpLoading) return rzpLoading;
    rzpLoading = new Promise(function (resolve, reject) {
      var sc = document.createElement('script');
      sc.src = 'https://checkout.razorpay.com/v1/checkout.js';
      sc.onload = resolve;
      sc.onerror = function () { rzpLoading = null; reject(new Error('Could not load the payment window. Check your internet.')); };
      document.head.appendChild(sc);
    });
    return rzpLoading;
  }

  /** Pays for a plan. Resolves { ok:true, status } | { ok:false, cancelled:true } ; rejects with a readable Error. */
  async function pay(planId) {
    var s = session();
    if (!s || !s.userId) throw new Error('Please sign in again to upgrade.');
    await loadRazorpay();
    var order = await call('POST', '/api/pro/create-order', { coupleId: s.coupleId, userId: s.userId, plan: planId });

    return new Promise(function (resolve, reject) {
      var done = false;
      var rz = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: 'Twin Hearts',
        description: 'Pro · ' + order.planLabel,
        prefill: order.prefill || {},
        theme: { color: '#ff3fa4' },
        retry: { enabled: true },
        modal: { ondismiss: function () { if (!done) { done = true; resolve({ ok: false, cancelled: true }); } } },
        handler: async function (resp) {
          done = true;
          try {
            var st = await call('POST', '/api/pro/verify', {
              coupleId: s.coupleId, userId: s.userId,
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature
            });
            cache = { key: s.coupleId, st: st, ts: Date.now() };
            changed(st);
            resolve({ ok: true, status: st });
          } catch (e) { reject(e); }
        }
      });
      rz.on('payment.failed', function (r) {
        if (done) return;
        done = true;
        var d = r && r.error && r.error.description;
        reject(new Error(d || 'Payment failed. You were not charged — please try again.'));
      });
      rz.open();
    });
  }

  /* ── upgrade sheet ────────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('th-pro-styles')) return;
    var st = document.createElement('style');
    st.id = 'th-pro-styles';
    st.textContent =
      '#' + MODAL_ID + '{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:flex-end;justify-content:center;background:rgba(6,2,5,.62);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);opacity:0;pointer-events:none;transition:opacity .22s ease;font-family:Inter,system-ui,sans-serif}' +
      '#' + MODAL_ID + '.open{opacity:1;pointer-events:auto}' +
      '#' + MODAL_ID + ' .th-sheet{width:100%;max-width:440px;max-height:92dvh;overflow-y:auto;background:#14070f;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:24px 24px 0 0;padding:22px 20px calc(22px + env(safe-area-inset-bottom));transform:translateY(24px);transition:transform .25s cubic-bezier(.4,0,.2,1)}' +
      '@media(min-width:560px){#' + MODAL_ID + '{align-items:center}#' + MODAL_ID + ' .th-sheet{border-radius:24px}}' +
      '#' + MODAL_ID + '.open .th-sheet{transform:none}' +
      '#' + MODAL_ID + ' .th-x{float:right;background:rgba(255,255,255,.08);border:0;color:#fff;width:32px;height:32px;border-radius:50%;font-size:16px;cursor:pointer}' +
      '#' + MODAL_ID + ' .th-gem{font-size:34px;line-height:1}' +
      '#' + MODAL_ID + ' h2{margin:8px 0 4px;font-size:21px;font-weight:700}' +
      '#' + MODAL_ID + ' .th-sub{margin:0 0 16px;font-size:13px;color:rgba(255,255,255,.62);line-height:1.5}' +
      '#' + MODAL_ID + ' .th-plan{display:flex;align-items:center;gap:12px;width:100%;text-align:left;margin:0 0 10px;padding:13px 14px;border-radius:16px;border:2px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:#fff;cursor:pointer;font:inherit}' +
      '#' + MODAL_ID + ' .th-plan.sel{border-color:#ff3fa4;background:rgba(255,63,164,.12)}' +
      '#' + MODAL_ID + ' .th-radio{width:18px;height:18px;border-radius:50%;border:2px solid rgba(255,255,255,.35);flex:none;position:relative}' +
      '#' + MODAL_ID + ' .th-plan.sel .th-radio{border-color:#ff3fa4}' +
      '#' + MODAL_ID + ' .th-plan.sel .th-radio::after{content:"";position:absolute;inset:3px;border-radius:50%;background:#ff3fa4}' +
      '#' + MODAL_ID + ' .th-pm{flex:1;min-width:0}' +
      '#' + MODAL_ID + ' .th-pn{font-weight:700;font-size:15px}' +
      '#' + MODAL_ID + ' .th-pd{font-size:12px;color:rgba(255,255,255,.55);margin-top:2px}' +
      '#' + MODAL_ID + ' .th-pp{font-weight:800;font-size:18px;white-space:nowrap}' +
      '#' + MODAL_ID + ' .th-bd{font-size:10px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#fbbf24;margin-left:6px}' +
      '#' + MODAL_ID + ' .th-pay{width:100%;margin-top:6px;padding:14px;border:0;border-radius:14px;font:inherit;font-weight:700;font-size:15px;color:#fff;cursor:pointer;background:linear-gradient(135deg,#ff3fa4,#e0187f);box-shadow:0 8px 24px rgba(255,63,164,.35)}' +
      '#' + MODAL_ID + ' .th-pay[disabled]{opacity:.6;cursor:default}' +
      '#' + MODAL_ID + ' .th-err{margin:10px 0 0;font-size:13px;color:#f87171;min-height:0}' +
      '#' + MODAL_ID + ' .th-foot{margin:12px 0 0;text-align:center;font-size:11px;color:rgba(255,255,255,.45)}' +
      '#' + MODAL_ID + ' .th-link{background:none;border:0;color:rgba(255,255,255,.6);font:inherit;font-size:12px;text-decoration:underline;cursor:pointer;margin-top:8px}' +
      '#' + MODAL_ID + ' .th-ok{text-align:center;padding:18px 0 6px}' +
      '#' + MODAL_ID + ' .th-ok .th-gem{font-size:54px}';
    document.head.appendChild(st);
  }

  var activeResolve = null;
  function closeSheet(result) {
    var el = document.getElementById(MODAL_ID);
    if (el) el.classList.remove('open');
    var r = activeResolve; activeResolve = null;
    if (r) r(!!result);
  }

  function priceText(p) { return '₹' + p.price; }

  function openPlans(feature, opts) {
    opts = opts || {};
    injectStyles();
    var el = document.getElementById(MODAL_ID);
    if (el) el.remove();
    el = document.createElement('div');
    el.id = MODAL_ID;
    var sel = opts.plan || 'yearly';

    function render(state) {
      state = state || {};
      var plansHtml = PLANS.map(function (p) {
        return '<button type="button" class="th-plan' + (p.id === sel ? ' sel' : '') + '" data-plan="' + p.id + '">' +
          '<span class="th-radio"></span><span class="th-pm"><div class="th-pn">' + esc(p.label) +
          (p.badge ? '<span class="th-bd">' + esc(p.badge) + '</span>' : '') + '</div><div class="th-pd">' + esc(p.note) + '</div></span>' +
          '<span class="th-pp">' + priceText(p) + '</span></button>';
      }).join('');
      var cur = PLANS.filter(function (p) { return p.id === sel; })[0];
      el.innerHTML =
        '<div class="th-sheet" role="dialog" aria-modal="true">' +
        '<button class="th-x" aria-label="Close">✕</button>' +
        (state.success
          ? '<div class="th-ok"><div class="th-gem">🎉</div><h2>You\'re Pro!</h2><p class="th-sub">Pro is active for both of you. Enjoy every feature.</p></div>'
          : '<div class="th-gem">💎</div>' +
            '<h2>' + (feature ? 'Unlock ' + esc(feature) : 'Go Pro together') + '</h2>' +
            '<p class="th-sub">' + (feature ? esc(feature) + ' is a Pro feature. ' : '') + 'One payment unlocks Pro for you <b>and</b> your partner.</p>' +
            plansHtml +
            '<button class="th-pay" type="button"' + (state.busy ? ' disabled' : '') + '>' + (state.busy ? 'Opening secure payment…' : 'Pay ' + priceText(cur) + ' securely') + '</button>' +
            '<div class="th-err">' + esc(state.error || '') + '</div>' +
            '<p class="th-foot">🔒 Secured by Razorpay · UPI, cards, netbanking &amp; wallets</p>' +
            '<div style="text-align:center"><button class="th-link" type="button" data-act="restore">Already paid? Refresh status</button></div>') +
        '</div>';
    }

    el.addEventListener('click', async function (e) {
      var t = e.target;
      if (t === el || t.closest('.th-x')) { closeSheet(false); return; }
      var planBtn = t.closest('.th-plan');
      if (planBtn) { sel = planBtn.getAttribute('data-plan'); render(); return; }
      if (t.closest('[data-act="restore"]')) {
        render({ busy: true });
        try { var st = await status(true); if (st.isPro) { changed(st); render({ success: true }); setTimeout(function () { closeSheet(true); }, 1400); } else render({ error: 'No active Pro found yet. If you just paid, wait a minute and try again.' }); }
        catch (err) { render({ error: err.message }); }
        return;
      }
      if (t.closest('.th-pay')) {
        render({ busy: true });
        try {
          var r = await pay(sel);
          if (r.ok) { render({ success: true }); setTimeout(function () { closeSheet(true); }, 1600); }
          else render();
        } catch (err) { render({ error: err.message }); }
      }
    });

    document.body.appendChild(el);
    render();
    requestAnimationFrame(function () { el.classList.add('open'); });
    return new Promise(function (resolve) { activeResolve = resolve; });
  }

  /** Gate a feature. true → go ahead. false → not Pro (the upgrade sheet was shown). */
  async function requirePro(feature) {
    if (await isPro()) return true;
    // Could be a stale cache or a slow server — ask once, fresh, before showing the paywall.
    if (await isPro(true)) return true;
    return openPlans(feature);
  }

  // Warm the cache shortly after load so the first tap on a gated feature is instant.
  setTimeout(function () { status().catch(function () {}); }, 1200);

  window.ProCard = {
    PLANS: PLANS, status: status, isPro: isPro, pay: pay, openPlans: openPlans,
    requirePro: requirePro, onChange: onChange, call: call, session: session
  };
})();
