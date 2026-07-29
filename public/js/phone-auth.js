// ═══════════════════════════════════════════════════════
//  Phone-Number Auth — client module (Phase 3)
//  Talks to /api/auth-phone/* on the API host. Handles JWT
//  storage, silent refresh-on-expiry, OTP/login/signup, and
//  partner search/invite/accept/decline.
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
    const res = await fetch(API + '/api/auth-phone/refresh', {
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
  const PhoneAuth = {
    getSession,
    clearSession,
    isSignedIn: () => { const s = getSession(); return !!(s && s.accessToken); },

    signup: (phoneNumber, name, password) =>
      request('POST', '/api/auth-phone/signup', { phoneNumber, name, password }),

    requestOtp: (phoneNumber, purpose) =>
      request('POST', '/api/auth-phone/otp/request', { phoneNumber, purpose }),

    verifyOtp: async (phoneNumber, code, purpose) => {
      const data = await request('POST', '/api/auth-phone/verify-otp', { phoneNumber, code, purpose });
      setSession({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
      return data;
    },

    login: async (phoneNumber, password) => {
      const data = await request('POST', '/api/auth-phone/login', { phoneNumber, password });
      setSession({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
      return data;
    },

    logout: async () => {
      const session = getSession();
      if (session && session.refreshToken) {
        await request('POST', '/api/auth-phone/logout', { refreshToken: session.refreshToken }).catch(() => {});
      }
      clearSession();
    },

    me: () => request('GET', '/api/auth-phone/me', undefined, { auth: true }),

    searchPartner: (phone) =>
      request('GET', '/api/auth-phone/partner/search?phone=' + encodeURIComponent(phone), undefined, { auth: true }),

    invitePartner: (targetPhoneNumber) =>
      request('POST', '/api/auth-phone/partner/invite', { targetPhoneNumber }, { auth: true }),

    listInvitations: () =>
      request('GET', '/api/auth-phone/partner/invitations', undefined, { auth: true }),

    acceptInvitation: (id) =>
      request('POST', '/api/auth-phone/partner/invitations/' + id + '/accept', undefined, { auth: true }),

    declineInvitation: (id) =>
      request('POST', '/api/auth-phone/partner/invitations/' + id + '/decline', undefined, { auth: true }),

    // ── Pre-pairing push registration ──────────────────────
    // A signed-in-but-not-yet-paired user still needs to receive
    // partner invite/accept/decline pushes. Those are delivered via
    // /api/auth-phone/* (user_id-keyed), which is a completely
    // separate subscription store from the couple+role-keyed one
    // index.html registers post-pairing — so this must be called
    // independently, as soon as we have a signed-in session.
    setupPushForCurrentUser: async () => {
      if (!PhoneAuth.isSignedIn()) return;
      try {
        // Native (Capacitor/Android) FCM registration
        if (global.Capacitor && global.Capacitor.isNativePlatform && global.Capacitor.isNativePlatform()) {
          const { PushNotifications } = global.Capacitor.Plugins;
          const perm = await PushNotifications.requestPermissions();
          if (perm.receive === 'granted') {
            await PushNotifications.register();
            PushNotifications.addListener('registration', async (token) => {
              try { await request('POST', '/api/auth-phone/fcm/register', { token: token.value }, { auth: true }); }
              catch (e) { console.warn('[push] fcm register failed', e.message); }
            });
          }
        }
        // Web Push registration
        if ('serviceWorker' in global.navigator && 'PushManager' in global.window) {
          if (global.Notification && global.Notification.permission === 'denied') return;
          const { publicKey } = await request('GET', '/api/auth-phone/push/vapidkey');
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
          await request('POST', '/api/auth-phone/push/subscribe', { subscription: sub.toJSON() }, { auth: true });
        }
      } catch (e) {
        console.warn('[push] pre-pairing push setup failed:', e.message);
      }
    },

    // Existing couple-code endpoint (unauthenticated, still live) — used
    // purely to read back user1_name/user2_name/anniversary for the
    // couple a phone-auth user just got paired into.
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

  global.PhoneAuth = PhoneAuth;
})(window);