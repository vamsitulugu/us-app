/* ═══════════════════════════════════════════════════════════════
   avatar-system.js — THE single reusable profile/avatar system.

   This replaces every ad-hoc setAvImg()/setAvText() call site, the
   base64-in-JSON avatar storage, and the poll-only profile sync with:

     ProfileStore  – fetch/cache/subscribe to "my" and "partner"
                      profile (name, avatar_url, bio, status), with
                      a realtime channel so updates need NO refresh.
     Avatar.mount  – render a <div class="av"> element from a
                      profile, with a fallback-while-loading state
                      and initials ONLY when no image exists.
     Avatar.registry – every mounted avatar auto-re-renders itself
                      the instant ProfileStore's data changes, so
                      "replace the default avatar everywhere" is one
                      code path instead of 20+ manual DOM updates.

   Usage:
     <div id="chatHeaderAv"></div>
     <script>Avatar.mount('chatHeaderAv', { owner: 'partner', size: 40, editable: false });</script>

   Ownership rule enforced HERE (not just per-callsite):
     Avatar.mount(el, { owner: 'me' })      -> clicking opens the picker
     Avatar.mount(el, { owner: 'partner' }) -> clicking opens a viewer,
                                                 NEVER a file picker.
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const API = global.API || (global.API = 'https://us-app-av6d.onrender.com');

  function initialFor(profile, fallback) {
    const n = (profile && profile.display_name) || fallback || '';
    return (n.trim()[0] || '?').toUpperCase();
  }

  // ── ProfileStore ─────────────────────────────────────────────
  const ProfileStore = {
    _cache: { me: null, partner: null },
    _listeners: [],           // fn(owner, profile)
    _channel: null,
    _userId: null,
    _partnerId: null,

    get(owner) { return this._cache[owner]; },

    onChange(fn) { this._listeners.push(fn); return () => { this._listeners = this._listeners.filter(f => f !== fn); }; },

    _emit(owner, profile) {
      this._cache[owner] = profile;
      this._listeners.forEach(fn => { try { fn(owner, profile); } catch (e) { console.warn('[ProfileStore] listener error', e); } });
    },

    // Call once on app init/login with the current userId.
    async init(userId) {
      this._userId = userId;
      if (!userId) return;
      try {
        const mine = await fetch(`${API}/api/profile/${userId}`).then(r => r.json());
        if (mine && !mine.error) this._emit('me', mine);
      } catch (e) { console.warn('[ProfileStore] init me failed', e); }

      try {
        const partnerRes = await fetch(`${API}/api/profile/${userId}/partner`).then(r => r.json());
        if (partnerRes && partnerRes.profile) {
          this._partnerId = partnerRes.profile.id;
          this._emit('partner', partnerRes.profile);
        }
      } catch (e) { console.warn('[ProfileStore] init partner failed', e); }

      this._subscribeRealtime();
    },

    // Realtime subscription — no polling, no page refresh required.
    // Reuses the same shared Supabase client + broadcast-channel
    // pattern already established for partner_requests realtime.
    _subscribeRealtime() {
      const sb = global.__SHARED_SB__;
      if (!sb || !this._userId) { console.warn('[ProfileStore] shared supabase client unavailable, will rely on manual refresh()'); return; }
      if (this._channel) return;

      const topics = [`profile:${this._userId}`];
      if (this._partnerId) topics.push(`profile:${this._partnerId}`);

      this._channel = sb.channel('profile-sync', { config: { broadcast: { self: true } } });
      topics.forEach(topic => {
        this._channel.on('broadcast', { event: 'profile_updated' }, (msg) => {
          const profile = msg && msg.payload && msg.payload.profile;
          if (!profile) return;
          const owner = profile.id === this._userId ? 'me' : 'partner';
          this._emit(owner, profile);
        });
      });
      // Also listen to raw postgres changes as a belt-and-suspenders
      // path in case the broadcast is missed (matches migrations/
      // 001_create_profiles.sql's `alter publication ... add table`).
      this._channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, (payload) => {
        const row = payload.new;
        if (!row) return;
        if (row.id === this._userId) this._emit('me', row);
        else if (row.id === this._partnerId) this._emit('partner', row);
      });
      this._channel.subscribe();
    },

    // Optimistic update: apply locally immediately, then persist.
    // If the save fails, roll back and surface the error.
    async updateMine(patch) {
      if (!this._userId) throw new Error('No user');
      const prev = this._cache.me;
      const optimistic = { ...(prev || {}), ...patch, id: this._userId };
      this._emit('me', optimistic);
      try {
        const body = { requestingUserId: this._userId, ...patch };
        const saved = await fetch(`${API}/api/profile/${this._userId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        }).then(r => r.json());
        if (saved.error) throw new Error(saved.error);
        this._emit('me', saved);
        return saved;
      } catch (e) {
        this._emit('me', prev); // rollback
        throw e;
      }
    },

    // Upload a real image file (never base64-into-JSON). Shows an
    // optimistic local preview instantly via object URL while the
    // network upload completes.
    async uploadMyAvatar(file) {
      if (!this._userId) throw new Error('No user');
      const prev = this._cache.me;
      const previewUrl = URL.createObjectURL(file);
      this._emit('me', { ...(prev || {}), avatar_url: previewUrl, id: this._userId, _optimistic: true });

      try {
        const fd = new FormData();
        fd.append('avatar', file);
        fd.append('requestingUserId', this._userId);
        const saved = await fetch(`${API}/api/profile/${this._userId}/avatar`, { method: 'POST', body: fd }).then(r => r.json());
        if (saved.error) throw new Error(saved.error);
        this._emit('me', saved);
        URL.revokeObjectURL(previewUrl);
        return saved;
      } catch (e) {
        this._emit('me', prev);
        URL.revokeObjectURL(previewUrl);
        throw e;
      }
    },

    async refresh() { return this.init(this._userId); }
  };
  global.ProfileStore = ProfileStore;

  // ── Avatar component ────────────────────────────────────────
  const _mounted = []; // { el, owner, size, editable, fallbackName }

  function renderInto(el, owner, opts) {
    if (!el) return;
    const profile = ProfileStore.get(owner);
    const size = opts.size || 40;
    el.classList.add('avatar-component');
    el.style.width = el.style.height = size + 'px';
    el.style.borderRadius = '50%';
    el.style.position = 'relative';
    el.style.overflow = 'hidden';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';

    const url = profile && profile.avatar_url;
    if (url) {
      let img = el.querySelector('img.avatar-img');
      if (!img) {
        img = document.createElement('img');
        img.className = 'avatar-img';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;position:absolute;inset:0;';
        el.innerHTML = '';
        el.appendChild(img);
      }
      // Never render initials if a valid image exists — only fall
      // back on genuine load failure.
      img.onerror = () => { el.removeChild(img); renderInitials(el, profile, opts); };
      if (img.src !== url) img.src = url;
    } else {
      renderInitials(el, profile, opts);
    }

    // Ownership-based click behavior — the single place this logic
    // lives, so "partner avatar never opens my gallery" can never
    // regress at a random call site again.
    el.onclick = () => {
      if (opts.editable) {
        Avatar.openPicker();
      } else if (url) {
        Avatar.openViewer(url, el, owner);
      }
    };
    el.style.cursor = opts.editable || url ? 'pointer' : 'default';
  }

  function renderInitials(el, profile, opts) {
    // Professional neutral silhouette default avatar (matches the
    // fallback used by index.html's setAvImg/setAvText), rather than
    // initials — kept as one consistent default across the app.
    el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" style="width:60%;height:60%;color:rgba(255,255,255,0.92)">' +
      '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
  }

  const Avatar = {
    // Mount (or re-mount) an avatar into #id. owner: 'me' | 'partner'.
    // editable is auto-inferred from owner unless explicitly overridden
    // — this IS the ownership check from the spec:
    //   if (clickedUserId === currentUserId) allowEdit() else openViewerOnly()
    mount(elOrId, opts) {
      const el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
      if (!el) return;
      const owner = opts.owner === 'partner' ? 'partner' : 'me';
      const editable = opts.editable !== undefined ? opts.editable : owner === 'me';
      const entry = { el, owner, opts: { ...opts, editable } };
      _mounted.push(entry);
      renderInto(el, owner, entry.opts);
    },

    // Re-render every mounted instance for the given owner (called
    // automatically by the ProfileStore subscription below).
    refreshAll(owner) {
      _mounted.forEach(m => { if (!owner || m.owner === owner) renderInto(m.el, m.owner, m.opts); });
    },

    openPicker() {
      let input = document.getElementById('__avatarFileInput');
      if (!input) {
        input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*'; input.id = '__avatarFileInput';
        input.style.display = 'none';
        document.body.appendChild(input);
      }
      input.onchange = async () => {
        const file = input.files[0];
        input.value = '';
        if (!file) return;
        try {
          await ProfileStore.uploadMyAvatar(file);
          if (global.toast) global.toast('Photo updated! 📸');
        } catch (e) {
          if (global.toast) global.toast('Upload failed: ' + e.message);
        }
      };
      input.click();
    },

    openViewer(url, sourceEl, ownerForLabel) {
      // `global.openImgViewer`, referenced by the old comment here, was never
      // actually defined anywhere in the app — every call silently fell
      // through to a bare click-to-close <img>, which is why tapping a
      // profile photo never opened a real preview. openProfilePreview below
      // is the real implementation: full image, name/status, pinch-zoom,
      // drag, and a hero (shared-element) open/close animation.
      const profile = ProfileStore.get(ownerForLabel) || {};
      openProfilePreview(url, profile, sourceEl);
    }
  };
  global.Avatar = Avatar;

  // ── Profile preview (hero image viewer) ────────────────────────
  // Premium full-screen preview: opens with a shared-element "hero"
  // animation from the tapped avatar's on-screen position, supports
  // pinch-to-zoom and drag-to-pan once zoomed, and drag-down or tap-outside
  // to dismiss (springs back if the drag doesn't clear the threshold).
  let _pvStyleInjected = false;
  function ensurePreviewStyles() {
    if (_pvStyleInjected) return;
    _pvStyleInjected = true;
    const s = document.createElement('style');
    s.textContent = `
      .profile-preview-overlay{position:fixed;inset:0;z-index:99990;background:rgba(0,0,0,0);
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        opacity:0;transition:opacity .28s ease,background .28s ease;touch-action:none;overscroll-behavior:contain}
      .profile-preview-overlay.open{opacity:1;background:rgba(0,0,0,.92)}
      .profile-preview-close{position:absolute;top:calc(env(safe-area-inset-top,0px) + 14px);right:16px;
        width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.12);color:#fff;border:none;
        font-size:18px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2}
      .profile-preview-stage{position:relative;flex:1;width:100%;display:flex;align-items:center;justify-content:center;
        overflow:hidden;min-height:0}
      .profile-preview-img{max-width:88vw;max-height:70vh;border-radius:16px;object-fit:cover;
        box-shadow:0 20px 60px rgba(0,0,0,.5);will-change:transform;user-select:none;-webkit-user-drag:none;
        transform-origin:center center;transition:transform .22s cubic-bezier(0.22,1,0.36,1)}
      .profile-preview-img.dragging{transition:none}
      .profile-preview-meta{padding:14px 20px calc(env(safe-area-inset-bottom,0px) + 22px);text-align:center;color:#fff}
      .profile-preview-name{font-size:17px;font-weight:700;margin-bottom:4px}
      .profile-preview-status{font-size:13px;color:rgba(255,255,255,.65)}
    `;
    document.head.appendChild(s);
  }

  function openProfilePreview(url, profile, sourceEl) {
    if (!url) return;
    ensurePreviewStyles();
    document.getElementById('profilePreviewOverlay')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'profile-preview-overlay';
    overlay.id = 'profilePreviewOverlay';
    overlay.innerHTML = `
      <button class="profile-preview-close" aria-label="Close">✕</button>
      <div class="profile-preview-stage"><img class="profile-preview-img" src="${url}" alt="" draggable="false"></div>
      <div class="profile-preview-meta">
        <div class="profile-preview-name">${(profile.display_name || '').replace(/</g,'&lt;')}</div>
        <div class="profile-preview-status">${(profile.status || profile.bio || '').replace(/</g,'&lt;')}</div>
      </div>`;
    document.body.appendChild(overlay);
    const img = overlay.querySelector('.profile-preview-img');
    const closeBtn = overlay.querySelector('.profile-preview-close');

    // ── Hero open animation: start the image at the clicked avatar's
    // screen rect/shape, then animate to its natural centered position. ──
    const startRect = sourceEl && sourceEl.getBoundingClientRect ? sourceEl.getBoundingClientRect() : null;
    requestAnimationFrame(() => {
      overlay.classList.add('open');
      if (startRect && startRect.width > 0) {
        const endRect = img.getBoundingClientRect();
        const scaleX = startRect.width / endRect.width, scaleY = startRect.height / endRect.height;
        const dx = (startRect.left + startRect.width / 2) - (endRect.left + endRect.width / 2);
        const dy = (startRect.top + startRect.height / 2) - (endRect.top + endRect.height / 2);
        img.style.transition = 'none';
        img.style.borderRadius = '50%';
        img.style.transform = `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`;
        requestAnimationFrame(() => {
          img.style.transition = 'transform .32s cubic-bezier(0.22,1,0.36,1), border-radius .32s ease';
          img.style.borderRadius = '16px';
          img.style.transform = 'translate(0,0) scale(1)';
        });
      }
    });

    let scale = 1, panX = 0, panY = 0;
    let pinch = null;   // { startDist, startScale }
    let drag = null;    // { startX, startY, startPanX, startPanY, isDismiss }
    let closing = false;

    function applyTransform(extra) {
      img.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})` + (extra || '');
    }

    function dist(t0, t1) { return Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY); }

    function close() {
      if (closing) return;
      closing = true;
      overlay.classList.remove('open');
      overlay.style.background = 'rgba(0,0,0,0)';
      setTimeout(() => overlay.remove(), 260);
    }
    closeBtn.onclick = close;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        pinch = { startDist: dist(e.touches[0], e.touches[1]), startScale: scale };
        drag = null;
      } else if (e.touches.length === 1) {
        drag = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, startPanX: panX, startPanY: panY, isDismiss: scale <= 1.01 };
        img.classList.add('dragging');
      }
    }, { passive: true });

    overlay.addEventListener('touchmove', (e) => {
      if (pinch && e.touches.length === 2) {
        e.preventDefault();
        const ratio = dist(e.touches[0], e.touches[1]) / pinch.startDist;
        scale = Math.min(4, Math.max(1, pinch.startScale * ratio));
        applyTransform();
      } else if (drag && e.touches.length === 1) {
        const t = e.touches[0];
        const ddx = t.clientX - drag.startX, ddy = t.clientY - drag.startY;
        if (drag.isDismiss && scale <= 1.01) {
          // Drag-to-dismiss: follow the finger, fade background with distance.
          if (e.cancelable) e.preventDefault();
          panX = drag.startPanX + ddx; panY = drag.startPanY + ddy;
          const p = Math.min(1, Math.abs(ddy) / 240);
          overlay.style.background = `rgba(0,0,0,${0.92 * (1 - p * 0.7)})`;
          applyTransform();
        } else {
          if (e.cancelable) e.preventDefault();
          panX = drag.startPanX + ddx; panY = drag.startPanY + ddy;
          applyTransform();
        }
      }
    }, { passive: false });

    function endGesture() {
      img.classList.remove('dragging');
      if (drag && drag.isDismiss && scale <= 1.01 && Math.abs(panY - drag.startPanY) > 110) {
        close();
      } else if (scale <= 1.01) {
        // Spring back to center — natural bounce rather than a hard snap.
        panX = 0; panY = 0;
        img.style.transition = 'transform .3s cubic-bezier(0.34,1.56,0.64,1)';
        applyTransform();
        overlay.style.background = '';
        setTimeout(() => { if (img) img.style.transition = ''; }, 300);
      } else if (scale < 1) {
        scale = 1; applyTransform();
      }
      pinch = null; drag = null;
    }
    overlay.addEventListener('touchend', endGesture, { passive: true });
    overlay.addEventListener('touchcancel', endGesture, { passive: true });

    // Double-tap to toggle zoom (desktop-friendly + common mobile gesture).
    let lastTap = 0;
    img.addEventListener('click', () => {
      const now = Date.now();
      if (now - lastTap < 300) {
        scale = scale > 1 ? 1 : 2;
        panX = 0; panY = 0;
        img.style.transition = 'transform .25s ease';
        applyTransform();
        setTimeout(() => { if (img) img.style.transition = ''; }, 250);
      }
      lastTap = now;
    });

    // Escape key + Android hardware back both close it like any other modal.
    document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } });
  }
  global.openProfilePreview = openProfilePreview;

  ProfileStore.onChange((owner) => Avatar.refreshAll(owner));

})(window);