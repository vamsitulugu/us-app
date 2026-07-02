// public/home/utils.js
// ════════════════════════════════════════════════
//  Shared utilities for Virtual Home
// ════════════════════════════════════════════════
const HomeUtils = (() => {

  // Read coupleId + myRole from parent window or localStorage
  function getCoupleId() {
    try {
      // When loaded in iframe from index.html, parent has window.ST
      if (window.parent && window.parent.ST) return window.parent.ST.coupleId;
    } catch(_) {}
    return localStorage.getItem('coupleId') || null;
  }

  function getMyRole() {
    try {
      if (window.parent && window.parent.ST) return window.parent.ST.myRole || 'user1';
    } catch(_) {}
    return localStorage.getItem('myRole') || 'user1';
  }

  function getMyName() {
    try {
      if (window.parent && window.parent.ST) {
        const st = window.parent.ST;
        return st.myRole === 'user1' ? st.user1Name : st.user2Name;
      }
    } catch(_) {}
    return 'You';
  }

  function getPartnerName() {
    try {
      if (window.parent && window.parent.ST) {
        const st = window.parent.ST;
        return st.myRole === 'user1' ? st.user2Name : st.user1Name;
      }
    } catch(_) {}
    return 'Partner';
  }

  // Debounce utility
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // Throttle
  function throttle(fn, ms) {
    let last = 0;
    return (...args) => {
      const now = Date.now();
      if (now - last >= ms) { last = now; fn(...args); }
    };
  }

  // Linear interpolation
  function lerp(a, b, t) { return a + (b - a) * t; }

  // Clamp
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  // Random in range
  function rand(min, max) { return min + Math.random() * (max - min); }

  // Random int
  function randInt(min, max) { return Math.floor(rand(min, max + 1)); }

  // Show a toast notification
  function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.style.cssText = `
      position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
      background:rgba(12,12,28,0.92);backdrop-filter:blur(16px);
      border:1px solid rgba(255,255,255,0.15);border-radius:12px;
      padding:10px 18px;font-size:13px;color:#fff;z-index:9999;
      animation:toastIn 0.3s cubic-bezier(0.34,1.56,0.64,1);
      white-space:nowrap;pointer-events:none;
    `;
    el.textContent = msg;
    if (type === 'error') el.style.borderColor = 'rgba(248,113,113,0.4)';
    if (type === 'success') el.style.borderColor = 'rgba(52,211,153,0.4)';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  return { getCoupleId, getMyRole, getMyName, getPartnerName, debounce, throttle, lerp, clamp, rand, randInt, toast };
})();

window.HomeUtils = HomeUtils;