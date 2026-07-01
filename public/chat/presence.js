const PresenceManager = (() => {
  let onlineRoles = new Set();
  const listeners = new Set();
  function onSync(state) {
    onlineRoles = new Set(Object.keys(state));
    listeners.forEach(fn => fn(onlineRoles));
  }
  function isOnline(role) { return onlineRoles.has(role); }
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  return { onSync, isOnline, subscribe };
})();