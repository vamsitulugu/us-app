/* ═══════════════════════════════════════════════════════
   SESSION MANAGER — multi-account registry + startup session
   validation.

   This file is ADDITIVE ONLY. It never talks to the database
   directly, never issues tokens, and never changes how
   signup/signin/partner-connect work. It just:

   1. Remembers which accounts have signed in on this device
      (uwl_accounts), so the app can offer an account picker.
   2. Validates a remembered account against the backend on
      startup via GET /api/auth/session/:userId — the same
      users/couples tables /login already reads.
   3. Provides one clearAuthData() used whenever a session turns
      out to be invalid (expired / deleted account), so we never
      leave partial or stale auth data lying around.
   ═══════════════════════════════════════════════════════ */
(function (global) {
  const API = 'https://us-app-av6d.onrender.com';
  const ACCOUNTS_KEY = 'uwl_accounts';   // [{userId,email,myName,coupleId}]
  const ACTIVE_KEY = 'uwl_active_user';  // userId last opened

  function safeParse(raw, fallback) {
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }

  function getAccounts() {
    return safeParse(localStorage.getItem(ACCOUNTS_KEY), []) || [];
  }

  function saveAccounts(list) {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list));
  }

  // Adds or updates a remembered account. Called right after a
  // successful login/register — never on its own initiative.
  function rememberAccount({ userId, email, myName, coupleId }) {
    if (!userId) return;
    const list = getAccounts().filter(a => a.userId !== userId);
    list.push({ userId, email: email || '', myName: myName || 'You', coupleId: coupleId || null });
    saveAccounts(list);
    localStorage.setItem(ACTIVE_KEY, userId);
  }

  function forgetAccount(userId) {
    saveAccounts(getAccounts().filter(a => a.userId !== userId));
    if (localStorage.getItem(ACTIVE_KEY) === userId) localStorage.removeItem(ACTIVE_KEY);
  }

  function getLastActive() {
    return localStorage.getItem(ACTIVE_KEY) || null;
  }

  function setLastActive(userId) {
    if (userId) localStorage.setItem(ACTIVE_KEY, userId);
  }

  // Validates a remembered account against the backend. Resolves with
  // fresh {userId,coupleId,myName,partnerName,anniversary,paired,role,...}
  // on success, or null if the session is no longer valid (deleted
  // account, etc). Never throws — network errors are treated as
  // "couldn't validate right now", distinct from "invalid", so callers
  // can fall back to offline/local mode instead of wrongly logging out.
  async function validateSession(userId) {
    if (!userId) return { ok: false, reason: 'missing' };
    try {
      const r = await fetch(API + '/api/auth/session/' + encodeURIComponent(userId));
      if (r.status === 401 || r.status === 404) return { ok: false, reason: 'invalid' };
      if (!r.ok) return { ok: false, reason: 'network' };
      const data = await r.json();
      return { ok: true, data };
    } catch (e) {
      return { ok: false, reason: 'network' };
    }
  }

  // Clears every trace of local auth/session data — used whenever the
  // backend confirms a session is invalid (expired/deleted account) or
  // the user explicitly logs out of every account on this device.
  function clearAuthData({ keepOtherAccounts } = {}) {
    localStorage.removeItem('uwl_v5');
    ['uwl_lastTouchSeen', 'uwl_lastMissSeen', 'uwl_lastHugSeen',
     'uwl_lastHugResultSeen', 'uwl_justPairedAt'].forEach(k => localStorage.removeItem(k));
    if (!keepOtherAccounts) {
      localStorage.removeItem(ACCOUNTS_KEY);
      localStorage.removeItem(ACTIVE_KEY);
    }
    try { sessionStorage.clear(); } catch (e) {}
  }

  global.SessionManager = {
    getAccounts, saveAccounts, rememberAccount, forgetAccount,
    getLastActive, setLastActive, validateSession, clearAuthData
  };
})(window);
