'use strict';

/* Header: name/avatar/status, wires into existing S + PresenceManager if present */
function renderChatHeader() {
  const nameEl = document.getElementById('chName');
  const avEl = document.getElementById('chAvatar');
  const dotEl = document.getElementById('chDot');
  const subEl = document.getElementById('chSub');
  if (!nameEl || !window.S) return;
  nameEl.textContent = S.partnerName || 'Partner';
  if (S.partnerAvatar) avEl.innerHTML = `<img src="${S.partnerAvatar}"><div class="ch-dot" id="chDot"></div>`;
  else avEl.childNodes[0] ? (avEl.childNodes[0].textContent = (S.partnerName||'P')[0]) : null;

  let online = false, typing = false;
  try { online = window.PresenceManager && PresenceManager.isOnline((S.role==='user1')?'user2':'user1'); } catch(e){}
  try { typing = window.TypingManager && TypingManager.get().typing; } catch(e){}

  const dot = document.getElementById('chDot');
  if (dot) dot.classList.toggle('on', !!online);

  const sub = document.getElementById('chSub');
  if (sub) {
    if (typing) sub.innerHTML = `<span class="ch-typing-dots"><span></span><span></span><span></span></span>typing…`;
    else sub.textContent = online ? 'Online' : 'Offline';
    sub.className = 'ch-sub' + (typing ? ' typing' : '');
  }
}
try { window.TypingManager && TypingManager.subscribe(renderChatHeader); } catch(e){}
try { window.PresenceManager && PresenceManager.subscribe(renderChatHeader); } catch(e){}
setInterval(renderChatHeader, 3000);

/* Menu */
const ChatMenu = (() => {
  let selectMode = false, selected = new Set(), muted = false;
  function toggle() { document.getElementById('chMenu').classList.toggle('open'); }
  function close() { document.getElementById('chMenu').classList.remove('open'); }
  function toggleMute() {
    muted = !muted;
    document.getElementById('muteIco').textContent = muted ? '🔕' : '🔔';
    document.getElementById('muteLbl').textContent = muted ? 'Unmute Notifications' : 'Mute Notifications';
    if (window.S) { S.settings = S.settings || {}; S.settings.chatMuted = muted; window.scheduleSave && scheduleSave(); }
    close(); window.toast && toast(muted ? 'Chat muted 🔕' : 'Chat unmuted 🔔');
  }
  function toggleSelect() {
    selectMode = !selectMode; selected.clear();
    document.getElementById('chatMsgs').classList.toggle('select-mode', selectMode);
    document.getElementById('selectBar').classList.toggle('active', selectMode);
    document.querySelectorAll('.msg.selected').forEach(m => m.classList.remove('selected'));
    _updateCount(); close();
  }
  function toggleMsgSelect(el, id) {
    if (!selectMode) return;
    if (selected.has(id)) { selected.delete(id); el.classList.remove('selected'); }
    else { selected.add(id); el.classList.add('selected'); }
    _updateCount();
  }
  function _updateCount() { const c = document.getElementById('selectCount'); if (c) c.textContent = selected.size + ' selected'; }
  function deleteSelected() {
    if (!selected.size) return;
    if (!confirm('Delete ' + selected.size + ' message(s)?')) return;
    selected.forEach(id => { try { window.ChatEngine && ChatEngine.patch(id, window.S.coupleId, { deleted: true }); } catch(e){} });
    toggleSelect();
  }
  function showMedia() { _filteredView('media'); close(); }
  function showLinks() { _filteredView('links'); close(); }
  function showStarred() { _filteredView('starred'); close(); }
  function _filteredView(kind) {
    let items = [];
    try {
      const all = window.ChatStore ? ChatStore.all() : (window.S.chatMessages || []);
      if (kind === 'media') items = all.filter(m => m.type === 'photo' || m.media_url || m.mediaUrl);
      if (kind === 'starred') items = all.filter(m => m.starred);
      if (kind === 'links') items = all.filter(m => /https?:\/\//.test(m.text || ''));
    } catch(e){}
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:5000;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);display:flex;align-items:flex-end;justify-content:center;padding:16px';
    overlay.innerHTML = `<div style="background:rgba(8,8,20,0.95);border:1px solid var(--border2);border-radius:20px 20px 0 0;width:100%;max-width:480px;padding:18px;max-height:65dvh;overflow-y:auto">
      <div style="font-family:var(--ff-serif);font-size:16px;color:#fff;margin-bottom:12px;text-transform:capitalize">${kind}</div>
      ${items.length ? items.map(m => `<div style="padding:9px;background:var(--g1);border-radius:10px;margin-bottom:6px;font-size:12px;color:var(--text)">${(m.text||m.media_url||m.mediaUrl||'').toString().slice(0,80)}</div>`).join('') : '<div style="color:var(--text3);font-size:12px;padding:20px 0;text-align:center">Nothing here yet</div>'}
      <button onclick="this.closest('div[style*=fixed]').remove()" style="width:100%;margin-top:6px;padding:11px;background:var(--g2);border:1px solid var(--border);border-radius:12px;color:#fff;cursor:pointer">Close</button>
    </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }
  document.addEventListener('click', e => {
    const menu = document.getElementById('chMenu');
    if (menu && menu.classList.contains('open') && !menu.contains(e.target) && !e.target.closest('[onclick*="ChatMenu.toggle()"]')) close();
  });
  return { toggle, close, toggleMute, toggleSelect, toggleMsgSelect, deleteSelected, showMedia, showLinks, showStarred };
})();

/* Scroll button unread badge + grouping/date-sep pass (visual only, runs after Render paints) */
function chatUiPostProcess() {
  const list = document.getElementById('chatMsgs');
  if (!list) return;
  const nodes = Array.from(list.querySelectorAll('.msg'));
  let lastSender = null, lastDate = null;
  nodes.forEach((n, i) => {
    const isMe = n.classList.contains('me');
    const sender = isMe ? 'me' : 'them';
    const prev = nodes[i-1], next = nodes[i+1];
    const prevSame = prev && prev.classList.contains(sender) === false ? false : (prev && ((isMe && prev.classList.contains('me')) || (!isMe && prev.classList.contains('them'))));
    const nextSame = next && ((isMe && next.classList.contains('me')) || (!isMe && next.classList.contains('them')));
    n.classList.remove('grp-start','grp-mid','grp-end','grp-single');
    if (!prevSame && !nextSame) n.classList.add('grp-single');
    else if (!prevSame && nextSame) n.classList.add('grp-start');
    else if (prevSame && nextSame) n.classList.add('grp-mid');
    else n.classList.add('grp-end');
  });
}
const _mo = new MutationObserver(() => chatUiPostProcess());
document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('chatMsgs');
  if (el) _mo.observe(el, { childList: true });
  setTimeout(chatUiPostProcess, 1000);
});