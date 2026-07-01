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
  if (m.type === 'photo') inner = `<img src="${esc(m.media_url)}" class="msg-img" onclick="openImgViewer('${esc(m.media_url)}')">`;
  else if (m.type === 'voice') inner = `<div class="voice-msg"><button class="voice-play">▶</button><div class="voice-waveform">${Array.from({length:16},()=>`<span style="height:${8+Math.random()*14}px"></span>`).join('')}</div><span class="voice-dur">${esc(m.duration||'')}</span></div>`;
  else inner = esc(m.text || '');

  const ticks = isMe
    ? (m._status === 'sending' ? '⏳' : m.read ? '<span class="tick-read">✓✓</span>' : '<span class="tick-sent">✓✓</span>')
    : '';
  const time = m.created_at ? new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';

  return `<div class="bubble${m.type==='photo'?' has-img':''}">
    ${m.pinned ? '<div class="bpin">📌</div>' : ''}
    ${m.starred ? '<div class="bstar">⭐</div>' : ''}
    ${inner}
    <div class="bmeta"><span>${time}</span><span class="tick-row">${ticks}</span></div>
  </div>`;
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