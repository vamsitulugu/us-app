/**
 * geolocation-service.js
 * ─────────────────────────────────────────────────────────────
 * Thin promise-based wrapper around the browser Geolocation API.
 * No external dependency. Used by search-service.js for "near me"
 * queries and by any page wanting the user's current position.
 * ─────────────────────────────────────────────────────────────
 */
(function (global) {
  let watchId = null;
  let lastKnown = null; // { lat, lng, accuracy, ts }

  /** One-shot position fetch. Resolves { lat, lng, accuracy, ts }. */
  function getCurrentPosition(opts = {}) {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) {
        reject(new Error('Geolocation not supported on this device'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        pos => {
          lastKnown = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            ts: Date.now()
          };
          resolve(lastKnown);
        },
        err => reject(new Error(mapGeoError(err))),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000, ...opts }
      );
    });
  }

  /** Starts a background watch (for live "nearby refreshes as you move"). */
  function startWatch(onUpdate, opts = {}) {
    if (!('geolocation' in navigator)) return null;
    stopWatch();
    watchId = navigator.geolocation.watchPosition(
      pos => {
        lastKnown = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          ts: Date.now()
        };
        onUpdate(lastKnown);
      },
      err => console.warn('[geolocation-service] watch error:', mapGeoError(err)),
      { enableHighAccuracy: true, maximumAge: 15000, ...opts }
    );
    return watchId;
  }

  function stopWatch() {
    if (watchId != null && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  function getLastKnown() { return lastKnown; }

  function mapGeoError(err) {
    switch (err.code) {
      case err.PERMISSION_DENIED: return 'Location permission denied';
      case err.POSITION_UNAVAILABLE: return 'Location unavailable';
      case err.TIMEOUT: return 'Location request timed out';
      default: return 'Unknown location error';
    }
  }

  global.GeolocationService = { getCurrentPosition, startWatch, stopWatch, getLastKnown };
})(window);