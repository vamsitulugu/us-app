const Render = (() => {
  let container, unsub;
  const rendered = new Map(); // client_id -> DOM node

  function mount() {
    container = document.getElementById('chatMsgs');
    if (!container) return;
    container.innerHTML = '';
    rendered.clear();
    ChatStore.all().forEach(m => appendNode(m));
    scrollToBottom(true);
    unsub && unsub();
    unsub = ChatStore.on(handlePatch);
  }

  function handlePatch({ type, msg }) {
    if (type === 'insert') { appendNode(msg); if (isNearBottom()) scrollToBottom(false); }
    else if (type === 'update') updateNode(msg);
    else if (type === 'remove') { rendered.get(msg.client_id)?.remove(); rendered.delete(msg.client_id); }
  }

  function isNearBottom() {
    if (!container) return true;
    return container.scrollHeight - container.scrollTop - container.clientHeight < 120;
  }
  function scrollToBottom(instant) {
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: instant ? 'auto' : 'smooth' });
  }

  function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function bubbleHtml(m) {
    const isMe = m.sender_role === (window.S ? S.role : 'user1');
    let inner = '';
    if (m.type === 'photo') inner = `<img src="${esc(m.media_url)}" class="msg-img" loading="lazy">`;
    else if (m.type === 'voice') inner = `🎙️ ${esc(m.duration || '')}`;
    else inner = esc(m.text || '');
    const status = m._status === 'failed'
      ? `<span class="tick-sent" style="color:var(--red);cursor:pointer" onclick="retrySend('${m.client_id}')" title="Tap to retry">⚠ Retry</span>`
      : m._status === 'sending' ? '⏳'
      : m.read ? '<span class="tick-read">✓✓</span>'
      : m.delivered ? '<span class="tick-sent">✓✓</span>'
      : '<span class="tick-sent">✓</span>';
    return `<div class="bubble">${inner}<div style="float:right;font-size:10px;opacity:.6;margin-left:8px">${status}</div><div style="clear:both"></div></div>`;
  }

  function appendNode(m) {
    if (rendered.has(m.client_id)) return updateNode(m);
    const div = document.createElement('div');
    div.className = 'msg ' + (m.sender_role === (window.S ? S.role : 'user1') ? 'me' : 'them');
    div.id = 'msg-' + m.client_id;
    div.innerHTML = bubbleHtml(m);
    container.appendChild(div);
    rendered.set(m.client_id, div);
  }

  function updateNode(m) {
    const node = rendered.get(m.client_id);
    if (!node) return appendNode(m);
    node.innerHTML = bubbleHtml(m);
  }

  return { mount, scrollToBottom };
})();