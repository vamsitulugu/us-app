// top of chat/init.js, before boot()
window.renderChat = window.renderChat || function () {
  if (window.Render && typeof Render.mount === 'function') Render.mount();
};


(function () {
  const SUPABASE_URL = window.__SUPABASE_URL__;      // inject via server-rendered <script> or /api/config
  const SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY__;

  async function boot() {
    if (!window.S || !S.coupleId) return setTimeout(boot, 400);
    ChatRealtime.init(SUPABASE_URL, SUPABASE_ANON_KEY, S.coupleId, S.role, S.myName);
    await ChatEngine.init(S.coupleId, S.role);
    ChatEngine.deliverAll(S.role);
      window.addEventListener('online', () => { ChatEngine.deliverAll(S.role); ChatQueue.flush(); });
    const chatIn = document.getElementById('chatIn');
    chatIn?.addEventListener('input', () => TypingManager.onLocalInput(S.role));

    document.getElementById('chatMsgs')?.addEventListener('scroll', () => {
      if (document.getElementById('chatMsgs').scrollTop < 60) ChatEngine.loadOlder();
    });
  }
  boot();

  // Global overrides so existing HTML onclick="sendChat()" etc. keep working
  window.sendChat = function () {
    const inp = document.getElementById('chatIn');
    const txt = inp.value.trim(); if (!txt) return;
    inp.value = ''; inp.style.height = 'auto';
    ChatEngine.send({ text: txt });
  };
  window.sendPhotoMsg = function (input) {
    if (!input.files[0]) return;
    const r = new FileReader();
    r.onload = e => ChatEngine.send({ mediaUrl: e.target.result, type: 'photo' });
    r.readAsDataURL(input.files[0]);
  };
})();