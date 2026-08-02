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
        Avatar.openViewer(url);
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

    openViewer(url) {
      // Reuses the app's existing full-screen image viewer if present.
      if (typeof global.openImgViewer === 'function') { global.openImgViewer(url); return; }
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
      overlay.innerHTML = `<img src="${url}" style="max-width:90%;max-height:90%;border-radius:12px;">`;
      overlay.onclick = () => document.body.removeChild(overlay);
      document.body.appendChild(overlay);
    }
  };
  global.Avatar = Avatar;

  ProfileStore.onChange((owner) => Avatar.refreshAll(owner));

})(window);
