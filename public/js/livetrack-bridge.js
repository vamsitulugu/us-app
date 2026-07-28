/* ═══════════════════════════════════════════════════════════════
   public/js/livetrack-bridge.js
   Additive bridge between the existing Live Map page (public/
   livemap.js — untouched) and the new native background tracking.

   Load this AFTER livemap.js in whatever page embeds the live map
   (e.g. add one line to public/index.html or wherever livemap.js is
   currently <script>-included):

     <script src="/js/livetrack-bridge.js"></script>

   It does three additive things, none of which alter existing UI:
     1. On the native app (Capacitor), starts the real background
        Foreground Service via BackgroundLocationPlugin instead of
        relying solely on navigator.geolocation.watchPosition (which
        livemap.js keeps using as-is for the in-page live view AND as
        the automatic web/PWA fallback when the plugin isn't present).
     2. Renders a small "Background Tracking" toggle + status chip
        into the Live Map page using the app's existing CSS variables
        (--accent, --g1, --border, etc.) so it matches the current
        theme without any redesign.
     3. Surfaces the new geofence-events feed ("Reached Home", "Left
        Work") as a lightweight list, reusing the app's existing
        .money-row / .empty class patterns already defined by
        livemap.js's own stylesheet.
   ══════════════════════════════════════════════════════════════ */
(function () {
  const API = (window.S && window.S.apiBase) || window.__US_API_BASE__ || '';
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  function getIdentity() {
    // Reuses the exact same identity source livemap.js and games.html
    // already read from — no new storage key introduced.
    try {
      const raw = localStorage.getItem('uwl_v5');
      if (raw) {
        const s = JSON.parse(raw);
        if (s.coupleId) return { coupleId: s.coupleId, role: s.role || 'user1' };
      }
    } catch (e) {}
    return null;
  }

  const LiveTrackBridge = {
    enabled: false,
    lastError: null,

    async init() {
      this.mountUI();
      if (isNative) {
        try {
          const { BackgroundLocation } = window.Capacitor.Plugins;
          const st = await BackgroundLocation.status();
          this.enabled = !!st.enabled;
        } catch (e) { /* plugin not present in this build yet — UI still renders, toggle will just report the error */ }
      }
      this.renderToggle();
      this.loadGeofenceFeed();
    },

    async toggle() {
      const id = getIdentity();
      if (!id) { this.toast('Pair with your partner first'); return; }

      if (!isNative) {
        this.toast('Background tracking (screen-off/app-closed) requires the Android app — the web version still tracks live while this page is open.');
        return;
      }

      const { BackgroundLocation } = window.Capacitor.Plugins || {};
      if (!BackgroundLocation) { this.toast('Update the app to enable background tracking'); return; }

      try {
        if (this.enabled) {
          await BackgroundLocation.stop();
          this.enabled = false;
          this.toast('Background tracking turned off');
        } else {
          const res = await BackgroundLocation.start({ coupleId: id.coupleId, role: id.role, apiBase: API });
          this.enabled = true;
          this.toast(res.backgroundGranted
            ? 'Background tracking is on — location keeps sharing even when the app is closed'
            : 'Tracking is on while the app is open/minimized. For tracking while fully closed, allow "Location: Allow all the time" in Android Settings > Apps > Twin Hearts > Permissions.');
        }
      } catch (e) {
        this.lastError = e && e.message;
        this.toast('Could not change background tracking: ' + (this.lastError || 'unknown error'));
      }
      this.renderToggle();
    },

    toast(msg) {
      if (window.toast) { window.toast(msg); return; }
      console.log('[LiveTrackBridge]', msg);
    },

    mountUI() {
      if (document.getElementById('ltbPanel')) return;
      // Anchor point: livemap.js's own markup includes a settings/
      // controls area — this looks for a couple of likely containers
      // and falls back to appending to <body> so it never throws even
      // if the host page's DOM shifts.
      const host = document.getElementById('lmControls') || document.getElementById('mapControls') || document.body;
      const panel = document.createElement('div');
      panel.id = 'ltbPanel';
      panel.style.cssText = 'margin:10px 4px;padding:12px 14px;border-radius:14px;background:var(--g1,rgba(255,255,255,.045));border:1px solid var(--border,rgba(255,255,255,.11));backdrop-filter:blur(20px)';
      panel.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <div>
            <div style="font-size:12.5px;font-weight:700;color:#fff">📍 Background Tracking</div>
            <div id="ltbStatusLine" style="font-size:10.5px;color:var(--text3,rgba(255,255,255,.4));margin-top:2px">Checking…</div>
          </div>
          <button id="ltbToggleBtn" style="padding:8px 14px;border-radius:20px;border:none;font-size:11.5px;font-weight:700;color:#fff;cursor:pointer;background:var(--accent,#3a8bff)">…</button>
        </div>
        <div id="ltbGeofenceFeed" style="margin-top:10px;display:none"></div>
      `;
      host.appendChild(panel);
      document.getElementById('ltbToggleBtn').addEventListener('click', () => this.toggle());
    },

    renderToggle() {
      const btn = document.getElementById('ltbToggleBtn');
      const line = document.getElementById('ltbStatusLine');
      if (!btn || !line) return;
      btn.textContent = this.enabled ? 'ON' : 'Turn On';
      btn.style.background = this.enabled ? 'linear-gradient(135deg,#34d399,#0d8f60)' : 'var(--accent,#3a8bff)';
      line.textContent = !isNative
        ? 'Live while this page is open (install the Android app for always-on tracking)'
        : (this.enabled ? 'Tracking continues when the app is closed or your screen is off' : 'Currently off — location only updates while this page is open');
    },

    async loadGeofenceFeed() {
      const id = getIdentity();
      const feedEl = document.getElementById('ltbGeofenceFeed');
      if (!id || !feedEl) return;
      try {
        const r = await fetch(`${API}/api/tracking/${id.coupleId}/${id.role === 'user1' ? 'user2' : 'user1'}/geofence-events`);
        if (!r.ok) return;
        const events = await r.json();
        if (!events.length) return;
        feedEl.style.display = 'block';
        feedEl.innerHTML = `<div style="font-size:10px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:var(--text3,rgba(255,255,255,.4));margin-bottom:6px">Recent Activity</div>` +
          events.slice(0, 5).map(e => `
            <div style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:12px;color:var(--text2,rgba(255,255,255,.64))">
              <span>${e.event_type === 'enter' ? '📍' : '🚶'}</span>
              <span>${e.event_type === 'enter' ? 'Reached' : 'Left'} <strong style="color:#fff">${escapeHtml(e.label)}</strong></span>
              <span style="margin-left:auto;font-size:10px;color:var(--text3,rgba(255,255,255,.4))">${new Date(e.occurred_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>`).join('');
      } catch (e) { /* feed is a nice-to-have, never blocks the page */ }
    }
  };

  function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  window.LiveTrackBridge = LiveTrackBridge;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => LiveTrackBridge.init());
  else LiveTrackBridge.init();
})();
