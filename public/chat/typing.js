const TypingManager = (() => {
  let localTimer = null;
  let remoteState = { typing: false, ts: 0 };
  const listeners = new Set();

  function onLocalInput(role) {
    ChatRealtime.broadcastTyping(role, true);
    clearTimeout(localTimer);
    localTimer = setTimeout(() => ChatRealtime.broadcastTyping(role, false), 1800);
  }
  function onRemoteTyping(payload) {
    remoteState = { typing: payload.isTyping, ts: payload.ts };
    listeners.forEach(fn => fn(remoteState));
    if (payload.isTyping) {
      clearTimeout(TypingManager._t);
      TypingManager._t = setTimeout(() => { remoteState.typing = false; listeners.forEach(fn => fn(remoteState)); }, 3000);
    }
  }
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  return { onLocalInput, onRemoteTyping, subscribe, get: () => remoteState };
})();