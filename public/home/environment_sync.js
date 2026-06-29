// public/home/environment_sync.js
// ════════════════════════════════════════════════
//  EnvironmentSync — Phase 7, Feature 10
//  Supabase Realtime channel for weather, sky time,
//  fireplace, curtains, TV, room lights, and
//  window states.  Both partners see every env
//  change in real time.
//
//  Architecture:
//   - Uses the existing Supabase client exposed by
//     the parent window (window.parent.supabase) or
//     falls back to polling via HomeAPI.settings.
//   - Broadcasts via Supabase Broadcast (ephemeral)
//     AND writes durable state to the settings row
//     so a rejoining partner sees the latest state.
//   - Does NOT rewrite any Phase 1–6 module.
//   - Monkey-patches the HomeEnvironment/HomeSky/
//     HomeWeather public APIs to intercept local
//     changes and propagate them automatically.
// ════════════════════════════════════════════════
const HomeEnvironmentSync = (() => {

  // ── Config ────────────────────────────────────
  const CHANNEL_PREFIX   = 'home:env:';
  const POLL_INTERVAL_MS = 20_000;   // fallback polling interval
  const DEBOUNCE_MS      = 300;      // debounce outbound broadcasts

  // ── Internal state ────────────────────────────
  let _channel      = null;   // Supabase RealtimeChannel
  let _supabase     = null;   // Supabase client ref
  let _coupleId     = null;
  let _myRole       = null;
  let _pollTimer    = null;
  let _ready        = false;
  let _disposed     = false;

  // Pending broadcast (debounced)
  let _pendingBroadcast = null;
  let _broadcastTimer   = null;

  // ── Snapshot of last-sent state (avoid echo loops) ──
  let _lastSent = {};

  // ─────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────
  function _getSupabase() {
    // 1. Parent window exposes supabase directly
    try {
      if (window.parent && window.parent.supabase) return window.parent.supabase;
    } catch (_) {}
    // 2. Module loaded alongside supabase.js in same window
    if (window.supabase) return window.supabase;
    return null;
  }

  function _buildStateSnapshot() {
    const snap = {};

    // Weather
    if (window.HomeWeather) snap.weather = HomeWeather.getCurrent();

    // Sky time (0–1)
    if (window.HomeSky) snap.skyTime = HomeSky.getTime();

    // Environment toggles
    if (window.HomeEnvironment) {
      const es = HomeEnvironment.getState();
      snap.fireplace = es.fireplace;
      snap.tv        = es.tv;
      snap.curtains  = es.curtains;
      snap.candles   = es.candles;
      snap.lamps     = es.lamps;
      snap.windows   = { ...es.windows };
      snap.lights    = { ...es.lights };
    }

    // Fireplace (explicit module)
    if (window.HomeFireplace) snap.fireplaceActive = HomeFireplace.isActive();

    return snap;
  }

  // ─────────────────────────────────────────────
  // OUTBOUND  —  local change → broadcast + persist
  // ─────────────────────────────────────────────
  function _scheduleBroadcast(partial) {
    // Merge partial into pending batch
    _pendingBroadcast = Object.assign(_pendingBroadcast || {}, partial);

    clearTimeout(_broadcastTimer);
    _broadcastTimer = setTimeout(() => {
      if (_disposed) return;
      _flushBroadcast();
    }, DEBOUNCE_MS);
  }

  function _flushBroadcast() {
    if (!_pendingBroadcast || _disposed) return;
    const payload = { ..._pendingBroadcast, _sender: _myRole, _ts: Date.now() };
    _pendingBroadcast = null;

    // Avoid echo: skip if identical to last sent
    const payloadKey = JSON.stringify(payload);
    if (payloadKey === _lastSent._key) return;
    _lastSent._key = payloadKey;

    // 1. Supabase Broadcast (ephemeral, low-latency)
    if (_channel) {
      _channel.send({
        type:    'broadcast',
        event:   'env_change',
        payload
      }).catch(e => console.warn('[EnvSync] broadcast error:', e));
    }

    // 2. Durable persist via settings API so rejoining partner picks it up
    if (_coupleId && window.HomeAPI) {
      const durable = {};
      if (payload.weather        !== undefined) durable.weather        = payload.weather;
      if (payload.skyTime        !== undefined) durable.sky_time       = payload.skyTime;
      if (payload.fireplace      !== undefined) durable.fireplace      = payload.fireplace;
      if (payload.fireplaceActive!== undefined) durable.fireplace      = payload.fireplaceActive;
      if (payload.tv             !== undefined) durable.tv             = payload.tv;
      if (payload.curtains       !== undefined) durable.curtains       = payload.curtains;
      if (Object.keys(durable).length) {
        HomeAPI.settings.save(_coupleId, durable).catch(() => {});
      }
    }
  }

  // ─────────────────────────────────────────────
  // INBOUND  —  remote change → apply locally
  // ─────────────────────────────────────────────
  function _applyRemotePayload(payload) {
    if (!payload) return;

    // Skip our own echoes
    if (payload._sender === _myRole) return;

    // Weather
    if (payload.weather !== undefined && window.HomeWeather) {
      if (HomeWeather.getCurrent() !== payload.weather) {
        HomeWeather.setWeather(payload.weather, false);
        _emitLocal('home:weatherChange', { weather: payload.weather });
      }
    }

    // Sky time
    if (payload.skyTime !== undefined && window.HomeSky) {
      HomeSky.setTime(payload.skyTime);
    }

    // Environment aggregate state
    if (window.HomeEnvironment) {
      const patch = {};
      if (payload.fireplace !== undefined) patch.fireplace = payload.fireplace;
      if (payload.tv        !== undefined) patch.tv        = payload.tv;
      if (payload.curtains  !== undefined) patch.curtains  = payload.curtains;
      if (payload.candles   !== undefined) patch.candles   = payload.candles;
      if (payload.lamps     !== undefined) patch.lamps     = payload.lamps;
      if (payload.windows   !== undefined) patch.windows   = payload.windows;
      if (payload.lights    !== undefined) patch.lights    = payload.lights;
      if (Object.keys(patch).length) HomeEnvironment.applyRemoteState(patch);
    }

    // Fireplace module (explicit)
    if (payload.fireplaceActive !== undefined && window.HomeFireplace) {
      if (HomeFireplace.isActive() !== payload.fireplaceActive) {
        HomeFireplace.setActive(payload.fireplaceActive);
      }
    }

    _emitLocal('home:envSyncApplied', payload);
  }

  // ─────────────────────────────────────────────
  // POLLING fallback (no Supabase client available)
  // ─────────────────────────────────────────────
  function _startPolling() {
    if (_pollTimer) return;
    _pollTimer = setInterval(() => {
      if (_disposed || !_coupleId || !window.HomeAPI) return;
      HomeAPI.settings.get(_coupleId)
        .then(data => {
          if (!data) return;
          // Build a synthetic payload from settings row
          const payload = { _sender: 'remote' };
          if (data.weather  ) payload.weather         = data.weather;
          if (data.sky_time ) payload.skyTime          = parseFloat(data.sky_time);
          if (data.fireplace!== undefined) payload.fireplace = !!data.fireplace;
          if (data.tv       !== undefined) payload.tv        = !!data.tv;
          if (data.curtains ) payload.curtains         = data.curtains;
          _applyRemotePayload(payload);
        })
        .catch(() => {});
    }, POLL_INTERVAL_MS);
  }

  function _stopPolling() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  // ─────────────────────────────────────────────
  // DOM event helper
  // ─────────────────────────────────────────────
  function _emitLocal(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  // ─────────────────────────────────────────────
  // HOOK LOCAL MODULE EVENTS
  // ─────────────────────────────────────────────
  function _wireLocalEvents() {
    // Weather change (from UI or HomeWeather.setWeather)
    window.addEventListener('home:weatherChange', e => {
      if (_disposed || !e.detail) return;
      _scheduleBroadcast({ weather: e.detail.weather });
    });

    // Fireplace toggle (from HomeFireplace.setActive or HomeEnvironment)
    window.addEventListener('home:fireplaceState', e => {
      if (_disposed) return;
      const on = e.detail && e.detail.on;
      _scheduleBroadcast({ fireplace: !!on, fireplaceActive: !!on });
    });

    // TV toggle (from HomeEnvironment)
    window.addEventListener('home:tvState', e => {
      if (_disposed) return;
      _scheduleBroadcast({ tv: !!(e.detail && e.detail.on) });
    });

    // Curtain change
    window.addEventListener('home:curtainChange', e => {
      if (_disposed || !e.detail) return;
      _scheduleBroadcast({ curtains: e.detail.state });
    });

    // Room light change
    window.addEventListener('home:roomLightChange', e => {
      if (_disposed || !e.detail) return;
      _scheduleBroadcast({ lights: e.detail });
    });

    // Sky time change (emitted by HomeSky when setTime is called manually)
    window.addEventListener('home:skyTimeChange', e => {
      if (_disposed || !e.detail) return;
      _scheduleBroadcast({ skyTime: e.detail.time });
    });

    // Full env state request (partner reconnected)
    window.addEventListener('home:envSyncRequest', () => {
      if (_disposed) return;
      _scheduleBroadcast(_buildStateSnapshot());
    });
  }

  // ─────────────────────────────────────────────
  // LOAD DURABLE STATE on first join
  // ─────────────────────────────────────────────
  function _loadInitialState() {
    if (!_coupleId || !window.HomeAPI) return;
    HomeAPI.settings.get(_coupleId)
      .then(data => {
        if (!data || _disposed) return;
        const payload = { _sender: 'remote' };
        if (data.weather  ) payload.weather  = data.weather;
        if (data.sky_time ) payload.skyTime   = parseFloat(data.sky_time);
        if (data.fireplace!== undefined) payload.fireplace = !!data.fireplace;
        if (data.tv       !== undefined) payload.tv        = !!data.tv;
        if (data.curtains ) payload.curtains  = data.curtains;
        _applyRemotePayload(payload);
      })
      .catch(() => {});
  }

  // ─────────────────────────────────────────────
  // SUPABASE CHANNEL SETUP
  // ─────────────────────────────────────────────
  function _setupChannel() {
    _supabase = _getSupabase();
    if (!_supabase || !_coupleId) {
      console.warn('[EnvSync] No Supabase client — using polling fallback.');
      _startPolling();
      return;
    }

    const channelName = CHANNEL_PREFIX + _coupleId;

    try {
      _channel = _supabase.channel(channelName, {
        config: { broadcast: { self: false } }
      });

      _channel
        .on('broadcast', { event: 'env_change' }, ({ payload }) => {
          _applyRemotePayload(payload);
        })
        .on('presence', { event: 'join' }, ({ newPresences }) => {
          // When partner joins, broadcast our full state so they sync up
          _scheduleBroadcast(_buildStateSnapshot());
          _emitLocal('home:partnerJoined', { presences: newPresences });
        })
        .subscribe(status => {
          if (status === 'SUBSCRIBED') {
            _ready = true;
            // Track own presence
            _channel.track({
              role:     _myRole,
              room:     window.HomeScene ? HomeScene.state.currentRoom : 'living',
              joinedAt: Date.now()
            }).catch(() => {});
            // Broadcast initial state to partner
            setTimeout(() => _scheduleBroadcast(_buildStateSnapshot()), 500);
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('[EnvSync] Channel error, falling back to polling.');
            _startPolling();
          }
        });
    } catch (e) {
      console.warn('[EnvSync] Channel setup failed:', e);
      _startPolling();
    }
  }

  // ─────────────────────────────────────────────
  // PUBLIC API — broadcastEnvChange (called by HomeWeather etc.)
  // ─────────────────────────────────────────────
  function broadcastEnvChange(partial) {
    if (_disposed) return;
    _scheduleBroadcast(partial);
  }

  function broadcastSkyTime(time) {
    if (_disposed) return;
    _scheduleBroadcast({ skyTime: time });
  }

  function broadcastFullState() {
    if (_disposed) return;
    _scheduleBroadcast(_buildStateSnapshot());
  }

  function isReady() { return _ready; }

  // ─────────────────────────────────────────────
  // INIT / UPDATE / DISPOSE
  // ─────────────────────────────────────────────
  function init() {
    _disposed  = false;
    _ready     = false;
    _coupleId  = HomeUtils.getCoupleId();
    _myRole    = HomeUtils.getMyRole();

    _wireLocalEvents();
    _loadInitialState();
    _setupChannel();
  }

  // Called by the P7 loop — lightweight (no per-frame work needed;
  // Supabase is event-driven). Reserved for future heartbeat use.
  function update(_dt) { /* intentionally empty */ }

  function dispose() {
    _disposed = true;
    clearTimeout(_broadcastTimer);
    _stopPolling();
    if (_channel) {
      try { _channel.unsubscribe(); } catch (_) {}
      _channel = null;
    }
    _ready = false;
  }

  return {
    init, update, dispose,
    broadcastEnvChange,
    broadcastSkyTime,
    broadcastFullState,
    isReady
  };
})();

window.HomeEnvironmentSync = HomeEnvironmentSync;