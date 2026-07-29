// ═══════════════════════════════════════════════════════
//  Email Auth — client module
//  Talks to /api/auth-email/* on the API host. Handles JWT
//  storage, silent refresh-on-expiry, signup/verify/login,
//  and partner search/invite/accept/decline (phone number is
//  a profile field used for partner discovery only — it is
//  NOT an authentication method).
//
//  IMPORTANT: this does NOT touch how index.html works. Once
//  a user is signed up AND paired, we write the same
//  `uwl_v5` localStorage shape the old couple-code flow
//  already used (coupleId/role/myName/...), so the rest of
//  the app keeps working completely unmodified.
// ═══════════════════════════════════════════════════════
(function (global) {
  const API = (global.TWINHEARTS_API_BASE) || 'https://us-app-av6d.onrender.com';
  const JWT_KEY = 'twinhearts_jwt_v1';

  function getSession() {
    try { return JSON.parse(localStorage.getItem(JWT_KEY) || 'null'); } catch (e) { return null; }
  }
  function setSession(session) {
    localStorage.setItem(JWT_KEY, JSON.stringify(session));
  }
  function clearSession() {
    localStorage.removeItem(JWT_KEY);
  }

  // Core request helper. Attaches the access token, and on a 401 with
  // code TOKEN_EXPIRED, silently refreshes once and retries the request
  // before giving up.
  async function request(method, path, body, { auth = false, _retried = false } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    let session = getSession();
    if (auth) {
      if (!session || !session.accessToken) throw new Error('Not signed in');
      headers.Authorization = 'Bearer ' + session.accessToken;
    }
    const res = await fetch(API + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* no body */ }

    if (res.status === 401 && data.code === 'TOKEN_EXPIRED' && auth && !_retried && session && session.refreshToken) {
      const refreshed = await refresh(session.refreshToken).catch(() => null);
      if (refreshed) return request(method, path, body, { auth, _retried: true });
      clearSession();
    }

    if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
    return data;
  }

  async function refresh(refreshToken) {
    const res = await fetch(API + '/api/auth-email/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Refresh failed');
    setSession({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
    return data;
  }

  // ── Public API ──────────────────────────────────────────
  const EmailAuth = {
    getSession,
    clearSession,
    isSignedIn: () => { const s = getSession(); return !!(s && s.accessToken); },

    // name, email, password, phoneNumber — phone is required at signup
    // but is only ever used as a searchable profile field afterward.
    signup: (email, name, password, phoneNumber) =>
      request('POST', '/api/auth-email/signup', { email, name, password, phoneNumber }),

    resendVerification: (email) =>
      request('POST', '/api/auth-email/resend', { email }),

    // Confirms the emailed verification link's token and signs the user in.
    verifyEmail: async (token) => {
      const data = await request('POST', '/api/auth-email/verify', { token });
      setSession({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
      return data;
    },

    login: async (email, password) => {
      const data = await request('POST', '/api/auth-email/login', { email, password });
      setSession({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
      return data;
    },

    forgotPassword: (email) =>
      request('POST', '/api/auth-email/forgot-password', { email }),

    resetPassword: (token, newPassword) =>
      request('POST', '/api/auth-email/reset-password', { token, newPassword }),

    logout: async () => {
      const session = getSession();
      if (session && session.refreshToken) {
        await request('POST', '/api/auth-email/logout', { refreshToken: session.refreshToken }).catch(() => {});
      }
      clearSession();
    },

    me: () => request('GET', '/api/auth-email/me', undefined, { auth: true }),

    searchPartner: (phone) =>
      request('GET', '/api/auth-email/partner/search?phone=' + encodeURIComponent(phone), undefined, { auth: true }),

    invitePartner: (targetPhoneNumber) =>
      request('POST', '/api/auth-email/partner/invite', { targetPhoneNumber }, { auth: true }),

    listInvitations: () =>
      request('GET', '/api/auth-email/partner/invitations', undefined, { auth: true }),

    acceptInvitation: (id) =>
      request('POST', '/api/auth-email/partner/invitations/' + id + '/accept', undefined, { auth: true }),

    declineInvitation: (id) =>
      request('POST', '/api/auth-email/partner/invitations/' + id + '/decline', undefined, { auth: true }),

    // ── Pre-pairing push registration ──────────────────────
    // A signed-in-but-not-yet-paired user still needs to receive
    // partner invite/accept/decline pushes. Those are delivered via
    // /api/auth-email/* (user_id-keyed), which is a completely
    // separate subscription store from the couple+role-keyed one
    // index.html registers post-pairing — so this must be called
    // independently, as soon as we have a signed-in session.
    setupPushForCurrentUser: async () => {
      if (!EmailAuth.isSignedIn()) return;
      try {
        // Native (Capacitor/Android) FCM registration
        if (global.Capacitor && global.Capacitor.isNativePlatform && global.Capacitor.isNativePlatform()) {
          const { PushNotifications } = global.Capacitor.Plugins;
          const perm = await PushNotifications.requestPermissions();
          if (perm.receive === 'granted') {
            await PushNotifications.register();
            PushNotifications.addListener('registration', async (token) => {
              try { await request('POST', '/api/auth-email/fcm/register', { token: token.value }, { auth: true }); }
              catch (e) { console.warn('[push] fcm register failed', e.message); }
            });
          }
        }
        // Web Push registration
        if ('serviceWorker' in global.navigator && 'PushManager' in global.window) {
          if (global.Notification && global.Notification.permission === 'denied') return;
          const { publicKey } = await request('GET', '/api/auth-email/push/vapidkey');
          if (!publicKey) return;
          const reg = await global.navigator.serviceWorker.ready.catch(() => null);
          if (!reg) return;
          let sub = await reg.pushManager.getSubscription();
          if (!sub) {
            if (global.Notification && global.Notification.permission !== 'granted') {
              const p = await global.Notification.requestPermission();
              if (p !== 'granted') return;
            }
            const raw = atob(publicKey.replace(/-/g, '+').replace(/_/g, '/'));
            const key = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) key[i] = raw.charCodeAt(i);
            sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
          }
          await request('POST', '/api/auth-email/push/subscribe', { subscription: sub.toJSON() }, { auth: true });
        }
      } catch (e) {
        console.warn('[push] pre-pairing push setup failed:', e.message);
      }
    },

    // Existing couple-code endpoint (unauthenticated, still live) — used
    // purely to read back user1_name/user2_name/anniversary for the
    // couple a user just got paired into.
    getCoupleDetails: (coupleId) => request('GET', '/api/auth/couple/' + coupleId),

    // Writes the classic `uwl_v5` shape so the rest of the app (index.html),
    // which only knows about coupleId/role/myName/etc, needs zero changes.
    saveLegacySessionAndGo: (user) => {
      const freshState = {
        coupleId: user.coupleId, connectCode: null,
        myName: user.name, partnerName: user.partnerName || 'Partner',
        anniversary: user.anniversary || '', role: user.role || 'user1',
        setupDone: true, paired: !!user.coupleId, theme: 't-blue'
      };
      localStorage.setItem('uwl_v5', JSON.stringify(freshState));
      global.location.href = '/';
    }
  };

  global.EmailAuth = EmailAuth;
  // Back-compat alias in case any inline script still references the old
  // global name during the transition window.
  global.PhoneAuth = EmailAuth;
})(window);