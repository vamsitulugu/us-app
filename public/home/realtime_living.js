// public/home/realtime_living.js
// ════════════════════════════════════════════════
//  Realtime Living — Phase 6, Feature 6
//  Partner joins/leaves, avatar movement/animation sync,
//  pet movement sync. Supabase Realtime, NO POLLING.
//  NEW MODULE — does not modify rooms/furniture/memories
//  realtime channels from Phase 5 (kept on its own channel
//  name so the two don't collide).
// ════════════════════════════════════════════════
const HomeRealtimeLiving = (() => {

  let supabaseClient = null;
  let channel        = null;
  let coupleId        = null;
  let myRole          = null;
  let connected        = false;

  // Throttle outbound position broadcasts so we don't flood the
  // channel every animation frame (movement.js calls broadcastPosition
  // every tick; we coalesce to ~12/sec which is plenty smooth with
  // client-side lerping on the receiving end).
  const BROADCAST_HZ = 12;
  let _lastBroadcast = 0;

  // Remote state buffers — movement.js/pets.js consult these via the
  // getters below to drive the *other* avatar/pets smoothly.
  const remote = {
    avatarPos:   {},   // role -> { x, z, ry, anim, ts }
    petPos:      {},   // petId -> { x, z, ry, anim, ts }
    interaction: null, // { key, opts, ts }
    presence:    {}     // role -> { online, lastSeen }
  };

  // ── Supabase client bootstrap ──────────────────────
  // Reuses the same project credentials the rest of the app already
  // uses (exposed globally by index.html's app shell as window.SUPABASE_URL
  // / window.SUPABASE_ANON_KEY if present; otherwise falls back to the
  // public anon client pattern most Supabase-Realtime-only browser
  // contexts use). If the createClient global isn't available, this
  // module degrades to a no-op (movement/pets/interactions still work
  // locally, they just won't sync to the partner).
  function _getClient() {
    if (supabaseClient) return supabaseClient;
    try {
      if (window.supabase && window.supabase.createClient && window.SUPABASE_URL && window.SUPABASE_ANON_KEY) {
        supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
        return supabaseClient;
      }
      if (window.parent && window.parent.supabaseClient) {
        // Some app shells expose an already-initialized client on the
        // parent window (outside this iframe) — reuse it if present.
        supabaseClient = window.parent.supabaseClient;
        return supabaseClient;
      }
    } catch (e) {
      console.warn('[HomeRealtimeLiving] Supabase client unavailable:', e.message);
    }
    return null;
  }

  // ── Connect ─────────────────────────────────────────
  function init() {
    coupleId = HomeUtils.getCoupleId();
    myRole   = HomeUtils.getMyRole();
    if (!coupleId) {
      console.warn('[HomeRealtimeLiving] No coupleId — realtime sync disabled.');
      return;
    }
    const client = _getClient();
    if (!client) {
      console.warn('[HomeRealtimeLiving] No Supabase client available — running in local-only mode.');
      return;
    }

    channel = client.channel('home_living_' + coupleId, {
      config: { broadcast: { self: false }, presence: { key: myRole } }
    });

    channel
      .on('broadcast', { event: 'avatar_move' }, ({ payload }) => _onAvatarMove(payload))
      .on('broadcast', { event: 'pet_move' },    ({ payload }) => _onPetMove(payload))
      .on('broadcast', { event: 'interaction' }, ({ payload }) => _onInteraction(payload))
      .on('broadcast', { event: 'pet_adopted' }, ({ payload }) => _onPetAdopted(payload))
      .on('broadcast', { event: 'pet_action' },  ({ payload }) => _onPetAction(payload))
      .on('presence', { event: 'join' }, ({ key }) => _onPresenceJoin(key))
      .on('presence', { event: 'leave' }, ({ key }) => _onPresenceLeave(key))
      .subscribe((status) => {
        connected = (status === 'SUBSCRIBED');
        if (connected) {
          channel.track({ online: true, role: myRole, ts: Date.now() });
          HomeUtils.toast('🌐 Living World connected', 'success');
        }
      });
  }

  // ── Outbound broadcasts (called by movement.js / interactions.js / pets.js) ──
  function broadcastPosition(role, x, z, ry, anim) {
    if (!channel || !connected) return;
    const now = performance.now();
    if (now - _lastBroadcast < 1000 / BROADCAST_HZ) return;
    _lastBroadcast = now;
    channel.send({
      type: 'broadcast', event: 'avatar_move',
      payload: { role, x, z, ry, anim, ts: Date.now() }
    });
  }

  // Click-to-move sends the intended destination immediately (not
  // throttled) so the partner sees the path start right away; ongoing
  // per-frame corrections still go through broadcastPosition above.
  function broadcastMove(role, x, z, run) {
    if (!channel || !connected) return;
    channel.send({
      type: 'broadcast', event: 'avatar_move',
      payload: { role, x, z, ry: null, anim: run ? 'run' : 'walk', isTarget: true, ts: Date.now() }
    });
  }

  function broadcastInteraction(key, opts) {
    if (!channel || !connected) return;
    channel.send({
      type: 'broadcast', event: 'interaction',
      payload: { key, opts: opts || {}, by: myRole, ts: Date.now() }
    });
  }

  function broadcastPetMove(petId, x, z, ry, anim) {
    if (!channel || !connected) return;
    channel.send({
      type: 'broadcast', event: 'pet_move',
      payload: { petId, x, z, ry, anim, ts: Date.now() }
    });
  }

  function broadcastPetAdopted(petData) {
    if (!channel || !connected) return;
    channel.send({ type: 'broadcast', event: 'pet_adopted', payload: { pet: petData, ts: Date.now() } });
  }

  function broadcastPetAction(petId, action, value) {
    if (!channel || !connected) return;
    channel.send({ type: 'broadcast', event: 'pet_action', payload: { petId, action, value, ts: Date.now() } });
  }

  // ── Inbound handlers ───────────────────────────────
  function _onAvatarMove(payload) {
    if (!payload || payload.role === myRole) return; // ignore our own echoes (self:false should already prevent this)
    remote.avatarPos[payload.role] = payload;

    if (payload.isTarget) {
      // Partner clicked to move — drive their avatar via the same
      // path-following system used locally, so it benefits from
      // collision + smooth turning instead of teleporting.
      HomeMovement.moveTo(payload.role, payload.x, payload.z, payload.anim === 'run');
    } else {
      // Continuous correction: snap-lerp toward the broadcast position
      // to avoid drift between the two clients' local simulations.
      const avatar = HomeAvatars.get(payload.role);
      if (avatar) {
        const cur = avatar.state.position;
        const drift = Math.hypot(payload.x - cur.x, payload.z - cur.z);
        // Only hard-correct on larger drift; small drift self-resolves
        // as the partner's own movement.js path-follow continues.
        if (drift > 0.5) avatar.setPosition(payload.x, 0, payload.z);
        if (payload.ry !== null && payload.ry !== undefined) avatar.setRotationY(payload.ry);
        if (payload.anim) avatar.play(payload.anim, 0.2);
      }
    }
  }

  function _onPetMove(payload) {
    if (!payload) return;
    remote.petPos[payload.petId] = payload;
    const pet = window.HomePets ? HomePets.getById(payload.petId) : null;
    if (pet) {
      const drift = Math.hypot(payload.x - pet.state.position.x, payload.z - pet.state.position.z);
      if (drift > 0.4) pet.setPosition(payload.x, pet.state.position.y, payload.z);
      if (payload.anim) pet.play(payload.anim, 0.2);
    }
  }

  function _onInteraction(payload) {
    if (!payload || payload.by === myRole) return;
    remote.interaction = payload;
    if (window.HomeInteractions) {
      // Apply without re-broadcasting (avoid echo loop) by calling the
      // internal trigger directly — HomeInteractions.trigger itself
      // re-broadcasts, but since payload.by !== myRole this client
      // hasn't broadcast this event, so a normal trigger() call is safe.
      HomeInteractions.trigger(payload.key, payload.opts);
    }
  }

  function _onPetAdopted(payload) {
    if (!payload || !payload.pet) return;
    if (!window.HomePets) return;
    // Avoid duplicating a pet we already have locally
    if (HomePets.getById(payload.pet.id)) return;
    const pet = new HomePets.Pet(payload.pet);
    HomePets.getAll().push(pet);
    if (window.HomeScene) HomeScene.add(pet.group);
    HomeUtils.toast('🐾 ' + (payload.pet.name || 'A new pet') + ' joined the family!', 'success');
  }

  function _onPetAction(payload) {
    if (!payload) return;
    const pet = window.HomePets ? HomePets.getById(payload.petId) : null;
    if (!pet) return;
    if (payload.action === 'feed') pet.feed();
    else if (payload.action === 'play') pet.playWith();
    else if (payload.action === 'rename') pet.rename(payload.value);
  }

  function _onPresenceJoin(key) {
    remote.presence[key] = { online: true, lastSeen: Date.now() };
    if (key !== myRole) {
      HomeUtils.toast((HomeUtils.getPartnerName() || 'Partner') + ' entered the Living World 🏡', 'success');
    }
  }

  function _onPresenceLeave(key) {
    remote.presence[key] = { online: false, lastSeen: Date.now() };
    if (key !== myRole) {
      HomeUtils.toast((HomeUtils.getPartnerName() || 'Partner') + ' left', 'info');
    }
  }

  function isPartnerOnline() {
    const partnerRole = myRole === 'user1' ? 'user2' : 'user1';
    const p = remote.presence[partnerRole];
    return !!(p && p.online);
  }

  function isConnected() { return connected; }

  function dispose() {
    if (channel) {
      try { channel.untrack(); channel.unsubscribe(); } catch (_) {}
      channel = null;
    }
    connected = false;
  }

  return {
    init, dispose,
    broadcastPosition, broadcastMove, broadcastInteraction,
    broadcastPetMove, broadcastPetAdopted, broadcastPetAction,
    isPartnerOnline, isConnected,
    remote // exposed for debugging / ai_behavior reactive checks if needed
  };
})();

window.HomeRealtimeLiving = HomeRealtimeLiving;