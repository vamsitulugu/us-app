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