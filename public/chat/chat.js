/*public/chat/chat.js*/

// ═══ CHAT MODULE — presence, fixed layout, emoji/gif, redesigned composer ═══
const Chat = (function () {
  let msgs = [];
  let lastMsgId = 0;
  let presence = { user1: null, user2: null };
  let presenceInterval = null;
  let pollInterval = null;
  let lastMsgTs = null;
  let selectMode = false;
  let selectedIds = new Set();
  let recording = false, mediaRecorder = null, recChunks = [], recStart = 0, recTimerInt = null, recCancelled = false;
  let replyingTo = null;
  let lpTimer = null, lpFired = false;
  let typingStopTimer = null, lastTypingSentAt = 0;
  let partnerTyping = false, partnerTypingTimeout = null;
  const seenIds = new Set();
  function trackKey(m) { return m.client_id || m.id; }

  function coupleId() { return window.S && window.S.coupleId; }
  function myRole() { return window.S && window.S.role; }
  function otherRole() { return myRole() === 'user1' ? 'user2' : 'user1'; }
  function isMine(m) { return m.sender_role === myRole(); }

  // ─── PRESENCE ───────────────────────────────────────
  let _presenceListenersAttached = false; // guards against duplicate listeners if startPresence() is ever called more than once
  function startPresence() {
    sendPresence('online');
    if (presenceInterval) clearInterval(presenceInterval);
    presenceInterval = setInterval(() => {
      // Backgrounded tab: skip entirely, no network call.
      if (document.hidden) return;
      sendPresence('online');
    }, 20000);

    if (_presenceListenersAttached) return; // listeners already wired once — never attach a second copy
    _presenceListenersAttached = true;
    document.addEventListener('visibilitychange', () => {
      sendPresence(document.visibilityState === 'visible' ? 'online' : 'away');
      if (document.visibilityState === 'visible') {
        // Coming back from background: the realtime socket may have been
        // suspended by the OS/browser and the poll loop was paused (see
        // startPolling's `if (document.hidden) return`), so without this
        // the newest incoming message wouldn't surface until the next
        // background tick (~20s) or a manual pull-to-refresh.
        pollNew();
        if (!realtimeChannel) startRealtime();
      }
    });
    window.addEventListener('pagehide', () => sendPresence('offline'));
    // Network drop/restore (airplane mode, wifi->cellular handoff, etc.) is
    // distinct from tab visibility — catch it too so "works after reconnect"
    // holds even if the tab was visible the whole time.
    window.addEventListener('online', () => { pollNew(); if (!realtimeChannel) startRealtime(); });
    window.addEventListener('pagehide', () => { clearTimeout(typingStopTimer); sendTypingSignal('stop'); });
    window.addEventListener('pagehide', () => {
      if (realtimeChannel) {
        try {
          const sb = _getChatSupabase();
          if (sb) sb.removeChannel(realtimeChannel);
        } catch (e) {}
        realtimeChannel = null;
      }
    });
    window.addEventListener('beforeunload', () => {
      if (coupleId()) navigator.sendBeacon(API + '/api/chat/' + coupleId() + '/presence',
        new Blob([JSON.stringify({ role: myRole(), status: 'offline' })], { type: 'application/json' }));
    });
  }

  async function sendPresence(status) {
    if (!coupleId() || !myRole()) return;
    try { await api('POST', '/api/chat/' + coupleId() + '/presence', { role: myRole(), status }); } catch (e) {}
  }

  async function fetchPresence() {
    if (!coupleId()) return;
    try {
      const rows = await api('GET', '/api/chat/' + coupleId() + '/presence');
      presence = { user1: null, user2: null };
      (rows || []).forEach(r => { presence[r.role] = r; });
      renderPresenceUI();
    } catch (e) {}
  }

  function presenceStatusFor(role) {
    const p = presence[role];
    if (!p) return { label: 'Offline', dot: '⚫', online: false };
    const last = new Date(p.last_seen).getTime();
    const ageMs = Date.now() - last;
    if (p.status === 'online' && ageMs < 35000) return { label: 'Online', dot: '🟢', online: true };
    if (ageMs < 120000) return { label: 'Away', dot: '🟡', online: false, away: true };
    return { label: 'Last seen ' + fmtAgo(last), dot: '⚫', online: false };
  }

  function fmtAgo(ts) {
    const mins = Math.floor((Date.now() - ts) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.floor(hrs / 24) + 'd ago';
  }

  function renderPresenceUI() {
    const st = presenceStatusFor(otherRole());
    const hs = document.getElementById('chatHeaderStatus');
    if (hs) { hs.innerHTML = st.dot + ' ' + st.label; hs.classList.toggle('online', !!st.online); }
    document.querySelectorAll('[data-presence-dot]').forEach(el => el.textContent = st.dot);
    const psb = document.getElementById('hbSidebarPresence');
    if (psb) psb.innerHTML = `<span style="font-size:11px;color:var(--text3)">${st.dot} ${esc(st.label)}</span>`;
    updateHeaderRing();
  }

  function updateTypingIndicatorUI() {
    const el = document.getElementById('chatTypingIndicator');
    if (!el) return;
    const box = document.getElementById('chatMsgs');
    const wasNearBottom = box && (box.scrollHeight - box.scrollTop - box.clientHeight < 150);
    el.classList.toggle('show', partnerTyping);
    if (partnerTyping && wasNearBottom) scrollToBottom(true);
  }

  // ─── LOAD / POLL MESSAGES ───────────────────────────
 async function loadMessages() {
  if (!coupleId()) return;
  try {
    const rows = await api('GET', '/api/chat/' + coupleId() + '?limit=200');
    msgs = rows || [];
    lastMsgTs = msgs.length ? msgs[msgs.length - 1].created_at : null;
    render();
    scrollToBottom(false);
    reanchorAfterImages();
    settleScrollBurst();
    // Any already-loaded partner messages that are still unread need
    // marking now — previously markRead() only fired reactively when a
    // *new* message arrived while the chat was already open, so opening
    // a chat that already had unread messages waiting never flipped
    // their ticks blue at all.
    if (msgs.some(m => !isMine(m) && !m.read) && chatBottomInView()) markRead();
  } catch (e) {}
}

// Catch-all safety net: re-pin to bottom a few more times over the next
// second, in case something other than images shifts layout after the
// initial render (web font swap, etc.) — cheap, and only acts while the
// user is still at/near the bottom.
function settleScrollBurst() {
  const box = document.getElementById('chatMsgs');
  if (!box) return;
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      const stillNearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 400;
      if (stillNearBottom) box.scrollTop = box.scrollHeight;
    });
  }
  [50, 200, 500, 1000].forEach(delay => {
    setTimeout(() => {
      const stillNearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 400;
      if (stillNearBottom) box.scrollTop = box.scrollHeight;
    }, delay);
  });
}

// Images (map previews, gifs, stickers, photos) finish loading after the
// synchronous scrollToBottom() call above, and each one that loads pushes
// the page taller — silently stranding the scroll position partway up the
// conversation instead of at the true bottom. Re-pin to bottom as each image
// resolves, but only while the user hasn't scrolled away from the bottom.
function reanchorAfterImages() {
  const box = document.getElementById('chatMsgs');
  if (!box) return;
  const imgs = box.querySelectorAll('img');
  imgs.forEach(img => {
    if (img.complete) return;
    const onDone = () => {
      const stillNearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 400;
      if (stillNearBottom) box.scrollTop = box.scrollHeight;
    };
    img.addEventListener('load', onDone, { once: true });
    img.addEventListener('error', onDone, { once: true });
  });
}

  async function pollNew() {
  if (!coupleId()) return;
  try {
    const q = lastMsgTs ? '?after=' + encodeURIComponent(lastMsgTs) : '';
    const rows = await api('GET', '/api/chat/' + coupleId() + q);
    if (rows && rows.length) {
      rows.forEach(r => {
        const idx = msgs.findIndex(m => m.id === r.id || (r.client_id && m.client_id === r.client_id));
        if (idx > -1) msgs[idx] = r; else msgs.push(r);
      });
      lastMsgTs = rows[rows.length - 1].created_at;
      render();
      const box = document.getElementById('chatMsgs');
      const nearBottom = box && (box.scrollHeight - box.scrollTop - box.clientHeight < 150);
      if (nearBottom || rows.some(isMine)) { scrollToBottom(true); reanchorAfterImages(); }
      else updateJumpBadge(rows.filter(r => !isMine(r)).length);
      if (rows.some(r => !isMine(r)) && chatBottomInView()) {
        markRead();
      } else if (rows.some(r => !isMine(r))) {
        // Not actively viewing the chat right now — reflect the new
        // unread(s) on the OS/PWA app icon immediately rather than waiting
        // for the person to open the app and find out some other way.
        syncAppBadge(msgs.filter(m => !isMine(m) && !m.read).length);
      }
    }
    await refreshRecentStatuses();
    fetchPresence();
  } catch (e) {}
}

  // The 'after' query above only ever returns brand-new rows, so an
  // UPDATE to a message already in `msgs` (read receipt, delivered
  // flag, reaction, edit) is invisible to it — that update only reaches
  // this device via the Realtime push. Re-checking the tail of the
  // conversation here means tick colors and reactions still refresh
  // within one poll cycle even if the Realtime socket never connected.
  async function refreshRecentStatuses() {
    if (!msgs.length) return;
    try {
      const rows = await api('GET', '/api/chat/' + coupleId() + '?limit=30');
      let changed = false;
      (rows || []).forEach(r => {
        const idx = msgs.findIndex(m => m.id === r.id || (r.client_id && m.client_id === r.client_id));
        if (idx > -1 && _msgSig(msgs[idx]) !== _msgSig(r)) { msgs[idx] = r; changed = true; }
      });
      if (changed) render();
    } catch (e) {}
  }

  function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    let _tick = 0;
    pollInterval = setInterval(() => {
      _tick++;
      // Tab backgrounded: no network calls at all.
      if (document.hidden) return;
      const chatActive = document.getElementById('page-chat')?.classList.contains('active');
      // Full 2.5s speed only while the chat page is actually open.
      // Elsewhere in the app, check every 8th tick (~20s) — just enough
      // to keep unread badges / last-message preview fresh.
      if (chatActive || _tick % 8 === 0) pollNew();
    }, 2500);
  }

  async function markRead() {
    if (!coupleId()) return;
    try {
      await api('POST', '/api/chat/' + coupleId() + '/read', { role: myRole() });
      clearReadNotifications();
    } catch (e) {}
  }

  // Notification badge / tray sync — previously nothing here at all, so a
  // push notification (and the OS/PWA app-icon badge) would sit there even
  // after the person opened the chat and read the message. This mirrors
  // WhatsApp: reading in-app clears both the notification tray entry and
  // the badge, and doesn't require the person to have tapped the push
  // notification itself to get there.
  function clearReadNotifications() {
    if (navigator.clearAppBadge) { try { navigator.clearAppBadge(); } catch (e) {} }
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      // 'chat-msg' is the ACTUAL tag routes/chat.js puts on chat push
      // notifications (see chatPayload.tag in the POST /api/chat handler).
      // 'us-app-love' / 'us-app' were stale tag names that never matched
      // anything shown, so the OS notification tray entry never actually
      // closed when the conversation was read in-app — this is the fix.
      navigator.serviceWorker.controller.postMessage({ type: 'clear_notifications', tag: 'chat-msg' });
      navigator.serviceWorker.controller.postMessage({ type: 'clear_notifications', tag: 'us-app-love' });
      navigator.serviceWorker.controller.postMessage({ type: 'clear_notifications', tag: 'us-app' });
    }
    document.querySelectorAll('[data-chat-badge]').forEach(el => { el.textContent = ''; el.style.display = 'none'; });
  }

  // Called whenever the unread count actually changes (new incoming
  // message while not focused/visible) so the OS app-icon badge reflects
  // reality even before the person opens the app.
  function syncAppBadge(unreadCount) {
    if (!navigator.setAppBadge) return;
    try {
      if (unreadCount > 0) navigator.setAppBadge(unreadCount);
      else if (navigator.clearAppBadge) navigator.clearAppBadge();
    } catch (e) {}
  }

  // ─── SCROLL (fixed input, no jumping) ───────────────
  // Custom rAF-driven smooth scroll instead of the native `behavior:'smooth'`
  // scrollTo(). Native smooth-scroll can't be cancelled or reasoned about —
  // if a new message triggers a second scrollToBottom() mid-animation, or the
  // user grabs the scrollbar while it's still gliding, native smooth-scroll
  // either queues/fights and stutters, or gets silently abandoned partway.
  // Driving it manually means every call can supersede the last one cleanly.
  let _scrollAnim = null; // rAF id of an in-flight programmatic scroll
  let _userScrolling = false, _userScrollIdleTimer = null;
  // BUG FIX (root cause of "tapping the jump-to-bottom button doesn't
  // actually scroll down"): #chatMsgs has onscroll="Chat.onChatScroll()"
  // wired directly in the markup, which fires for EVERY scrollTop change
  // — including the ones OUR OWN smooth-scroll animation makes every
  // frame. onChatScroll() used to unconditionally do
  // `if (_scrollAnim) cancelAnimationFrame(_scrollAnim)` on every single
  // scroll event, meaning the very first frame of our own animation
  // triggered a native scroll event that cancelled that same animation
  // a frame after it started — so tapping the button visibly moved the
  // list by about one frame's worth of distance and then just stopped.
  // This flag lets onChatScroll tell "I caused this scroll myself" apart
  // from "the person is actually touching/dragging the list", so it only
  // cancels the animation for genuine manual scrolls.
  let _programmaticScroll = false;

  function scrollToBottom(smooth) {
    const box = document.getElementById('chatMsgs');
    if (!box) return;
    if (_scrollAnim) { cancelAnimationFrame(_scrollAnim); _scrollAnim = null; }

    const target = box.scrollHeight - box.clientHeight;
    if (!smooth) {
      _programmaticScroll = true;
      box.scrollTop = target;
      // Give the resulting scroll event (fired async in most browsers,
      // including Android WebView) a moment to arrive before dropping
      // the flag, otherwise onChatScroll could still see it as manual.
      requestAnimationFrame(() => { _programmaticScroll = false; });
    } else {
      _programmaticScroll = true;
      const start = box.scrollTop;
      const dist = target - start;
      const dur = Math.min(420, Math.max(180, Math.abs(dist) * 0.35));
      const t0 = performance.now();
      // easeOutCubic — matches the button's own bounce-less, natural deceleration
      const ease = x => 1 - Math.pow(1 - x, 3);
      const step = now => {
        const p = Math.min(1, (now - t0) / dur);
        // Re-read scrollHeight each frame: images/new rows can grow the
        // container mid-scroll, so the target itself may shift.
        const liveTarget = box.scrollHeight - box.clientHeight;
        box.scrollTop = start + (liveTarget - start) * ease(p);
        if (p < 1) { _scrollAnim = requestAnimationFrame(step); }
        else {
          _scrollAnim = null; box.scrollTop = box.scrollHeight - box.clientHeight;
          requestAnimationFrame(() => { _programmaticScroll = false; });
        }
      };
      _scrollAnim = requestAnimationFrame(step);
    }
    document.getElementById('chatJumpBtn')?.classList.remove('show');
    updateJumpBadge(0);
  }

  let _scrollTick = false;
  // ─── VIEWPORT-BASED READ TRACKING ────────────────────
  // "Online" and "chat page open" are NOT the same as "actually seeing this
  // message" (see master spec). document.hasFocus() was the old gate here,
  // but it's unreliable on Android Chrome/PWA — a foregrounded webview
  // frequently reports hasFocus()===false after resuming from background,
  // which silently stopped read receipts from ever firing (the ✓✓ blue
  // bug in the screenshots). Page Visibility + "is the bottom of the
  // conversation actually scrolled into view" is a much more reliable
  // proxy for "the partner can see the newest message right now".
  function chatBottomInView() {
    const box = document.getElementById('chatMsgs');
    if (!box) return false;
    if (document.visibilityState !== 'visible') return false;
    if (!document.getElementById('page-chat')?.classList.contains('active')) return false;
    return box.scrollHeight - box.scrollTop - box.clientHeight < 150;
  }

  function onChatScroll() {
    const box = document.getElementById('chatMsgs');
    if (!box) return;
    // BUG FIX: this was declared with `const btn` inside the
    // `if (!_programmaticScroll)` block below, but also read further
    // down (outside that block) in the rAF show/hide tick — a
    // block-scoped const isn't visible outside its block, so that
    // later reference threw "btn is not defined" and crashed this
    // entire function every time it ran, which is why the jump button
    // could never show/hide or scroll at all. Hoisted to the top so
    // it's in scope for the whole function.
    const btn = document.getElementById('chatJumpBtn');

    // Ignore scroll events we caused ourselves (see _programmaticScroll
    // above) — only a genuine manual touch/wheel/scrollbar scroll should
    // cancel an in-flight animation or flip on the "user is scrolling"
    // state. Still fall through to the show/hide + read-tracking logic
    // below so the button/badge stay in sync while we animate.
    if (!_programmaticScroll) {
      // A manual scroll (wheel/touch/scrollbar drag) should immediately win
      // over any in-flight programmatic animation — otherwise the two fight
      // and the view stutters/snaps back.
      if (_scrollAnim) { cancelAnimationFrame(_scrollAnim); _scrollAnim = null; }

      if (btn && !_userScrolling) { _userScrolling = true; btn.classList.add('scrolling'); }
      clearTimeout(_userScrollIdleTimer);
      _userScrollIdleTimer = setTimeout(() => {
        _userScrolling = false;
        btn?.classList.remove('scrolling');
      }, 150);
    }

    // Throttle the show/hide + badge work to one per animation frame —
    // scroll fires far more often than the UI needs to react.
    if (_scrollTick) return;
    _scrollTick = true;
    requestAnimationFrame(() => {
      _scrollTick = false;
      const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 150;
      btn?.classList.toggle('show', !nearBottom);
      if (nearBottom) {
        updateJumpBadge(0);
        // Scrolling down into the latest message(s) is itself a read
        // event — e.g. arriving on the chat already at the bottom, or
        // the user scrolling back down after reading older history.
        if (msgs.some(m => !isMine(m) && !m.read) && chatBottomInView()) markRead();
      }
    });
  }
  function updateJumpBadge(n) {
    document.querySelectorAll('[data-chat-badge]').forEach(el => {
      el.textContent = n > 0 ? n : '';
      el.style.display = n > 0 ? 'inline-flex' : 'none';
    });
  }

  // Tracks the message signatures + last date-separator from the
  // previous render() call, so a pure tail-append (by far the most
  // frequent update — new message arrives, or a poll tick finds
  // nothing new) can patch the DOM incrementally instead of
  // re-rendering and re-decoding every bubble/image in the whole
  // conversation. The signature includes every field that changes a
  // bubble's appearance, so an edit/reaction/read-receipt/delete on an
  // *existing* message always invalidates the fast path and falls back
  // to the exact original full-rebuild behavior below.
  let _renderedSigs = [];
  let _renderedMsgIds = [];
  let _renderedLastDate = null;

  function _msgSig(m) {
    const rx = m.reactions ? Object.entries(m.reactions).map(([e, r]) => e + ':' + r.length).sort().join(',') : '';
    // pinned/starred_by were missing from the signature — toggling either
    // left currentSigs identical to _renderedSigs, so render() took the
    // "nothing changed" early-return and the bubble's pin/star icon never
    // actually updated (only the separate pinned-bar did).
    const starred = (m.starred_by || []).slice().sort().join(',');
    return trackKey(m) + '|' + (m.deleted ? 1 : 0) + '|' + (m.delivered ? 1 : 0) + '|' + (m.read ? 1 : 0) + '|' + (m.text || '') + '|' + rx + '|' + (m.pinned ? 1 : 0) + '|' + starred;
  }

  // ─── RENDER ──────────────────────────────────────────
  function render() {
    _renderImpl();
  }

  function _renderImpl() {
  const box = document.getElementById('chatMsgs');
  if (!box) return;
  const prevBottomOffset = box.scrollHeight - box.scrollTop; // distance from bottom
  const wasNearBottom = prevBottomOffset - box.clientHeight < 150;

  const visible = msgs.filter(m => !(m.deleted_for || '').split(',').includes(myRole()));
  const currentSigs = visible.map(_msgSig);

  // Fast path: everything previously rendered is still identical, in the
  // same order, and we only have new messages appended at the end.
  const isPureAppend = box.children.length > 0 &&
    _renderedSigs.length > 0 &&
    currentSigs.length >= _renderedSigs.length &&
    _renderedSigs.every((s, i) => currentSigs[i] === s);

  if (isPureAppend) {
    const newOnes = visible.slice(_renderedSigs.length);
    if (newOnes.length === 0) {
      // Nothing changed at all (typical poll tick) — skip touching the DOM.
      renderPinned();
      return;
    }
    let lastDate = _renderedLastDate;
    const frag = document.createDocumentFragment();
    const appendStart = _renderedSigs.length;
    newOnes.forEach((m, localI) => {
      const d = new Date(m.created_at);
      const ds = d.toDateString();
      if (ds !== lastDate) {
        lastDate = ds;
        const sep = document.createElement('div');
        sep.className = 'chat-date-sep';
        sep.innerHTML = `<span>${fmtDaySep(d)}</span>`;
        frag.appendChild(sep);
      }
      const isNew = !seenIds.has(trackKey(m));
      const wrap = document.createElement('div');
      wrap.innerHTML = renderBubble(m, isNew, groupPosAt(visible, appendStart + localI));
      frag.appendChild(wrap.firstElementChild || wrap);
      seenIds.add(trackKey(m));
    });
    box.appendChild(frag);
    // The row immediately before this batch may have gained a same-sender
    // neighbor (it was 'last'/standalone, now followed by a new message
    // from the same person) — refresh just its data-group attribute in
    // place so its bubble corner updates without a full re-render.
    if (appendStart > 0) {
      const prevRow = box.querySelector(`.chat-row[data-track="${CSS.escape(String(trackKey(visible[appendStart - 1])))}"]`);
      const newPos = groupPosAt(visible, appendStart - 1);
      if (prevRow) { if (newPos) prevRow.setAttribute('data-group', newPos); else prevRow.removeAttribute('data-group'); }
    }
    _renderedSigs = currentSigs;
    _renderedMsgIds = visible.map(trackKey);
    _renderedLastDate = lastDate;
    renderPinned();
    if (wasNearBottom) box.scrollTop = box.scrollHeight;
    else box.scrollTop = box.scrollHeight - prevBottomOffset;
    return;
  }

  // In-place patch: same number of messages, same order, but one or more
  // signatures changed (a reaction, edit, pin/star toggle, or a read/
  // delivered tick flipping — by far the most common non-append update,
  // since refreshRecentStatuses() and the realtime UPDATE handler both hit
  // this constantly). Previously ANY of these fell through to the full
  // rebuild below, which reset box.innerHTML for the *entire* conversation
  // — every image re-decoded/flickered, any in-flight bubble animation or
  // swipe-reply transform was destroyed, and it scaled with total message
  // count instead of the (usually 1) row that actually changed. Patching
  // just the changed rows keeps this O(changed) instead of O(all).
  const isPureMutation = box.children.length > 0 &&
    _renderedSigs.length === currentSigs.length &&
    visible.length === _renderedMsgIds.length &&
    visible.every((m, i) => trackKey(m) === _renderedMsgIds[i]);

  if (isPureMutation) {
    let changedCount = 0;
    for (let i = 0; i < currentSigs.length; i++) {
      if (currentSigs[i] === _renderedSigs[i]) continue;
      changedCount++;
      const m = visible[i];
      // BUG FIX: this used to look up the row by data-id="${m.id}". That's
      // fine for edits/reactions on an already-confirmed message, but for
      // a message that just went optimistic -> confirmed (temp_xxx id ->
      // real numeric id from the server), the DOM row still has the OLD
      // temp id as its data-id while `m.id` here is already the new real
      // id — the selector never matched, so the row (and its delivered/
      // read tick) silently never updated in place. It only ever looked
      // right again after a full rebuild (e.g. reopening the app, which
      // reloads messages fresh with real ids from the server). data-track
      // is trackKey(m) — client_id when present — which stays identical
      // across that optimistic -> confirmed swap, so the row is always
      // found.
      const oldRow = box.querySelector(`.chat-row[data-track="${CSS.escape(String(trackKey(m)))}"]`);
      if (!oldRow) continue; // shouldn't happen given the id-order check above, but stay safe
      const wrap = document.createElement('div');
      wrap.innerHTML = renderBubble(m, false, groupPosAt(visible, i));
      const newRow = wrap.firstElementChild;
      if (newRow) oldRow.replaceWith(newRow);
    }
    if (changedCount > 0) {
      _renderedSigs = currentSigs;
      renderPinned();
      // BUG FIX: an in-place mutation (e.g. an optimistic "sending" bubble
      // getting swapped for the server-confirmed row, a reaction, or a
      // tick flipping) can change a bubble's rendered height — most
      // commonly the just-sent message gaining a reply-quote block. This
      // branch used to always leave scroll position untouched (to avoid
      // fighting someone mid-read of older history), but when the person
      // was already pinned to the bottom and the LAST message is what
      // grew taller, that meant its new bottom portion (and its
      // timestamp) ended up scrolled out of view / hidden under the
      // composer bar, without the normal auto-scroll ever kicking in.
      // Re-pin to bottom only when we were already there.
      if (wasNearBottom) box.scrollTop = box.scrollHeight;
    }
    return;
  }

  // Full rebuild — anything that isn't a pure append or pure mutation
  // (deletes, reorders, first render).
  let html = '', lastDate = null;
  visible.forEach((m, i) => {
    const d = new Date(m.created_at);
    const ds = d.toDateString();
    if (ds !== lastDate) { lastDate = ds; html += `<div class="chat-date-sep"><span>${fmtDaySep(d)}</span></div>`; }
    const isNew = !seenIds.has(trackKey(m));
    html += renderBubble(m, isNew, groupPosAt(visible, i));
  });
  visible.forEach(m => seenIds.add(trackKey(m)));
  box.innerHTML = html || `<div class="empty" style="padding:60px 20px"><div class="empty-ico">💬</div>Say hello 👋</div>`;
  _renderedSigs = currentSigs;
  _renderedMsgIds = visible.map(trackKey);
  _renderedLastDate = lastDate;
  pruneMissingSelection();
  renderPinned();

  if (wasNearBottom) {
    box.scrollTop = box.scrollHeight;
  } else {
    box.scrollTop = box.scrollHeight - prevBottomOffset; // keep same visual position
  }
}

  // Shared 12-hour clock formatter — toLocaleTimeString([]) without an
  // explicit hour12 falls back to the OS/browser locale's default, which
  // for many locales (en-IN, en-GB, etc.) is 24-hour. Every clock-time
  // display in chat (bubbles, message info, reply preview, notifications,
  // media) should route through this so they're all consistently 12-hour
  // with an AM/PM suffix, regardless of device locale.
  function fmtClock(d) {
    return new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  function fmtDaySep(d) {
    const today = new Date(); const yest = new Date(); yest.setDate(yest.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yest.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // Telegram-style bubble grouping: returns 'first' | 'mid' | 'last' | null
  // (null = standalone, default full-tail bubble) for the message at index
  // i within a `visible` array, based on whether the immediately adjacent
  // message(s) are from the same sender on the same calendar day. Purely
  // a CSS hook (see .chat-row[data-group] in chat.css) — never changes
  // which messages exist or their order.
  function groupPosAt(visible, i) {
    const m = visible[i];
    if (!m || m.deleted || m.type === 'call_log') return null;
    const prevM = visible[i - 1], nextM = visible[i + 1];
    const sameDay = (a, b) => a && b && new Date(a.created_at).toDateString() === new Date(b.created_at).toDateString();
    const prevSame = prevM && !prevM.deleted && prevM.type !== 'call_log' && isMine(prevM) === isMine(m) && sameDay(prevM, m);
    const nextSame = nextM && !nextM.deleted && nextM.type !== 'call_log' && isMine(nextM) === isMine(m) && sameDay(nextM, m);
    if (!prevSame && !nextSame) return null;
    if (!prevSame) return 'first';
    if (!nextSame) return 'last';
    return 'mid';
  }

  // WhatsApp-style message status indicator, rendered as inline SVG (never
  // Unicode/emoji characters). Reads the real backend state on the message
  // (delivered / delivered_at / read / read_at) — a 'temp_' id means the
  // optimistic bubble hasn't been confirmed by the server yet, i.e. SENDING.
  // Two-check icons are shared markup; only the wrapper class/color differs
  // between delivered (muted) and read (blue), so CSS alone drives the
  // color swap and can transition it smoothly.
  function renderTicks(m) {
    const sending = typeof m.id === 'string' && m.id.indexOf('temp_') === 0;
    if (sending) {
      return `<span class="chat-ticks sending" title="Sending">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none"><circle cx="8" cy="8" r="6.2" stroke="currentColor" stroke-width="1.4" opacity=".55"/><path d="M8 4.4V8l2.6 1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/></svg>
      </span>`;
    }
    if (!m.delivered && !m.read) {
      // SENT — single tick
      return `<span class="chat-ticks sent" title="Sent">${TICK_SVG_SINGLE}</span>`;
    }
    if (m.read) {
      return `<span class="chat-ticks read" title="Read">${TICK_SVG_DOUBLE}</span>`;
    }
    // DELIVERED — two muted ticks
    return `<span class="chat-ticks delivered" title="Delivered">${TICK_SVG_DOUBLE}</span>`;
  }
  const TICK_SVG_SINGLE = `<svg viewBox="0 0 16 11" width="15" height="10" fill="none"><path d="M1 5.6 5 9.6 15 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const TICK_SVG_DOUBLE = `<svg viewBox="0 0 20 11" width="18" height="10" fill="none"><path d="M1 5.6 5 9.6 15 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 5.6 10 9.6 20 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  function renderBubble(m, isNew, groupPos) {
    if (m.deleted) {
      return `<div class="chat-row ${isMine(m) ? 'me' : 'them'}"><div class="chat-bubble deleted-bubble">🚫 Message deleted</div></div>`;
    }
    const mine = isMine(m);
    const time = fmtClock(m.created_at);
    let body = '';
    if (m.type === 'image') body = `<img src="${esc(m.media_url)}" class="chat-img" onclick="Chat.openMediaViewer('${m.id}')" loading="lazy">`;
    else if (m.type === 'gif') body = `<img src="${esc(m.media_url)}" class="chat-img chat-gif" onclick="Chat.openMediaViewer('${m.id}')" loading="lazy">`;
    else if (m.type === 'voice') body = renderVoice(m);
    else if (m.type === 'audio') body = `<audio controls src="${esc(m.media_url)}" style="max-width:220px"></audio>`;
    else if (m.type === 'location') {
      const lat = parseFloat(m.media_meta?.lat), lng = parseFloat(m.media_meta?.lng);
      const tile = lonLatToTile(lat, lng, 15);
      const mapImg = `https://tile.openstreetmap.org/15/${tile.x}/${tile.y}.png`;
      body = `<div class="msg-location" onclick="event.stopPropagation();window.open('https://maps.google.com/?q=${lat},${lng}','_blank')">
        <div class="msg-location-map-wrap">
          <img src="${mapImg}" class="msg-location-map" loading="lazy" alt="map preview" onerror="this.closest('.msg-location-map-wrap').classList.add('map-failed')">
          <div class="msg-location-pin">📍</div>
        </div>
        <div class="msg-location-info">
          <div class="msg-location-title">📍 Location</div>
          <div class="msg-location-sub">Tap to open in Maps</div>
        </div>
      </div>`;
    }
    else if (m.type === 'gift') body = `<div class="msg-gift"><div class="msg-gift-emoji">${esc(m.media_meta?.emoji || '🎁')}</div><div class="msg-gift-name">${esc(m.media_meta?.name || 'Gift')}</div></div>`;
    else if (m.type === 'sticker') body = `<div class="msg-sticker" title="${esc(m.media_meta?.name || '')}">${esc(m.media_meta?.emoji || '🙂')}</div>`;
    else if (m.type === 'contact') body = `<div class="msg-contact" onclick="event.stopPropagation();Chat.openContactCard('${esc(m.media_meta?.name || '')}')"><div class="msg-contact-av">${esc((m.media_meta?.name || '?')[0])}</div><div><div class="msg-contact-name">${esc(m.media_meta?.name || 'Contact')}</div><div class="msg-contact-sub">Contact card · tap to view</div></div></div>`;
    else if (m.type === 'poll') {
      const opts = m.media_meta?.options || [];
      body = `<div class="msg-poll">
        <div class="msg-poll-q">📊 ${esc(m.text || 'Poll')}</div>
        ${opts.map(o => `<div class="msg-poll-opt" onclick="event.stopPropagation();Chat.votePoll(${m.id},'${esc(o).replace(/'/g,"\\'")}')">${esc(o)}</div>`).join('')}
      </div>`;
    }
    else if (m.type === 'call_log') return `<div class="chat-call-log chat-system-event${isNew ? ' msg-pop-in' : ''}"><svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M3.6 1.4c.5-.2 1.1 0 1.3.5l1 2.2c.2.4.1.9-.2 1.2l-1 1c.6 1.5 1.8 2.7 3.3 3.3l1-1c.3-.3.8-.4 1.2-.2l2.2 1c.5.2.7.8.5 1.3l-.6 1.5c-.2.5-.7.8-1.2.7-4.6-.6-8.3-4.3-8.9-8.9-.1-.5.2-1 .7-1.2z"/></svg><span>${esc(m.text)}</span><span class="chat-call-time">${time}</span></div>`;
    else body = `<div class="chat-text">${linkify(esc(m.text || ''))}</div>${renderLinkPreview(m.text)}`;

    const reactions = m.reactions && Object.keys(m.reactions).length
      ? `<div class="chat-reactions">${Object.entries(m.reactions).map(([e, roles]) => `<span class="chat-reaction-pill">${e} ${roles.length}</span>`).join('')}</div>` : '';

    const status = mine ? renderTicks(m) : '';

    const quoted = m.reply_to ? renderQuote(m.reply_to) : '';

    return `<div class="chat-row ${mine ? 'me' : 'them'}${isNew ? ' msg-pop-in' : ''}${selectMode && selectedIds.has(m.id) ? ' sel-selected' : ''}" data-id="${m.id}" data-track="${esc(String(trackKey(m)))}"${groupPos ? ` data-group="${groupPos}"` : ''} onclick="Chat.onBubbleClick('${m.id}', event)" oncontextmenu="Chat.openMenu('${m.id}', event); return false;" ontouchstart="Chat.startLongPress('${m.id}', event)" ontouchend="Chat.endLongPress()" ontouchcancel="Chat.endLongPress()" ontouchmove="Chat.moveLongPress(event)">
      <div class="chat-swipe-reply-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg></div>
      <div class="chat-bubble ${mine ? 'mine' : 'theirs'}">
        ${quoted}
        ${body}
        ${reactions}
        <div class="chat-meta"><span>${time}${m.edited ? ' · edited' : ''}</span>${mine ? status : ''}</div>
      </div>
    </div>`;
  }

  function renderQuote(replyId) {
    const src = msgs.find(x => x.id === replyId || x.id === Number(replyId) || String(x.id) === String(replyId));
    if (!src) return `<div class="chat-quote"><div class="chat-quote-text">Original message</div></div>`;
    const who = isMine(src) ? (window.S.myName || 'You') : (window.S.partnerName || 'Partner');
    let preview = src.text;
    if (!preview) {
      preview = src.type === 'image' ? '📷 Photo' : src.type === 'gif' ? 'GIF' : src.type === 'voice' ? '🎤 Voice message'
        : src.type === 'audio' ? '🎵 Audio' : src.type === 'sticker' ? (src.media_meta?.emoji || '🙂') + ' Sticker'
        : src.type === 'gift' ? '🎁 Gift' : src.type === 'contact' ? '👤 Contact' : src.type === 'location' ? '📍 Location'
        : src.type === 'poll' ? '📊 Poll' : 'Message';
    }
    return `<div class="chat-quote" onclick="event.stopPropagation();Chat.scrollToMsg(${src.id})">
      <div class="chat-quote-name">${esc(who)}</div>
      <div class="chat-quote-text">${esc(String(preview).slice(0, 80))}</div>
    </div>`;
  }

  function linkify(text) {
    return text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  }
  // Lightweight link-preview chip (WhatsApp/Telegram-style card under the
  // text). Deliberately doesn't fetch the target page's og:title/image —
  // that needs a server-side proxy (browsers block cross-origin metadata
  // reads) which this app doesn't have — so it shows what's honestly
  // available client-side: the domain, a globe icon, and the full URL,
  // in a tappable card instead of a bare blue link.
  function renderLinkPreview(text) {
    if (!text) return '';
    const match = String(text).match(/https?:\/\/[^\s]+/);
    if (!match) return '';
    let host = '';
    try { host = new URL(match[0]).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
    return `<a class="chat-link-preview" href="${esc(match[0])}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
      <div class="chat-link-preview-ico">🔗</div>
      <div class="chat-link-preview-body">
        <div class="chat-link-preview-host">${esc(host)}</div>
        <div class="chat-link-preview-url">${esc(match[0])}</div>
      </div>
    </a>`;
  }
  function lonLatToTile(lat, lon, zoom) {
    const n = Math.pow(2, zoom);
    const x = Math.floor((lon + 180) / 360 * n);
    const latRad = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
  }

  function renderVoice(m) {
    const dur = (m.media_meta && m.media_meta.duration) || 0;
    // Bar heights were Math.random() on every call — since renderBubble()
    // can now legitimately re-run for the same message (a reaction, pin,
    // or read-receipt patch), that redrew the whole waveform with a brand
    // new random shape each time, visible as the waveform "jittering" for
    // reasons that have nothing to do with playback. Deriving the heights
    // deterministically from the message id keeps the shape stable across
    // any number of re-renders while still looking varied message-to-message.
    const seed = String(m.id || '').split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    function barHeight(i) {
      const x = Math.sin(seed + i * 12.9898) * 43758.5453;
      return 8 + (x - Math.floor(x)) * 16;
    }
    return `<div class="voice-msg">
      <button type="button" class="voice-play" aria-label="Play voice message" onclick="event.stopPropagation();Chat.toggleVoicePlay(this.parentElement,'${esc(m.media_url)}')">▶</button>
      <div class="voice-waveform">${Array.from({length:18}).map((_,i)=>`<span style="height:${barHeight(i).toFixed(1)}px"></span>`).join('')}</div>
      <div class="voice-dur">${Math.floor(dur/60)}:${String(dur%60).padStart(2,'0')}</div>
      <button type="button" class="voice-speed" aria-label="Playback speed" onclick="event.stopPropagation();Chat.cycleVoiceSpeed(this.parentElement)">1x</button>
    </div>`;
  }
  let _activeVoiceEl = null;
  const VOICE_SPEEDS = [1, 1.5, 2];
  // Telegram-style playback-speed cycling: tap the "1x" pill on a voice
  // bubble to step through 1x → 1.5x → 2x → back to 1x. Speed is stored
  // on the row's audio element (if already created) so it survives
  // pause/resume, and remembered per-row via a data attribute so a fresh
  // Audio() created later (first tap on Play) picks up the last-chosen
  // speed instead of resetting to 1x.
  function cycleVoiceSpeed(el) {
    const cur = Number(el.dataset.speed || 1);
    const idx = VOICE_SPEEDS.indexOf(cur);
    const next = VOICE_SPEEDS[(idx + 1) % VOICE_SPEEDS.length];
    el.dataset.speed = next;
    const btn = el.querySelector('.voice-speed');
    if (btn) btn.textContent = (next % 1 === 0 ? next : next.toFixed(1)) + 'x';
    if (el._audio) el._audio.playbackRate = next;
  }
  function toggleVoicePlay(el, url) {
    // Selection mode takes priority: tapping Play while in WhatsApp-style
    // multi-select mode must select/deselect the message rather than
    // start audio (the click never reaches onBubbleClick because it's
    // stopped in the inline handler above, so replicate the toggle here).
    if (selectMode) {
      const row = el.closest('.chat-row');
      const id = row && row.getAttribute('data-id');
      if (id != null) toggleSelect(id);
      return;
    }
    let audio = el._audio;
    if (!audio) {
      audio = new Audio(url); el._audio = audio;
      audio.playbackRate = Number(el.dataset.speed || 1);
      audio.onended = () => { el.querySelector('.voice-waveform').classList.remove('playing'); el.querySelector('.voice-play').textContent = '▶'; if (_activeVoiceEl === el) _activeVoiceEl = null; };
    }
    if (audio.paused) {
      // Only one voice message plays at a time — pause whichever one
      // (if any) was already playing before starting this one.
      if (_activeVoiceEl && _activeVoiceEl !== el && _activeVoiceEl._audio) {
        _activeVoiceEl._audio.pause();
        _activeVoiceEl.querySelector('.voice-waveform')?.classList.remove('playing');
        const btn = _activeVoiceEl.querySelector('.voice-play'); if (btn) btn.textContent = '▶';
      }
      _activeVoiceEl = el;
      audio.play(); el.querySelector('.voice-waveform').classList.add('playing'); el.querySelector('.voice-play').textContent = '⏸';
    }
    else { audio.pause(); el.querySelector('.voice-waveform').classList.remove('playing'); el.querySelector('.voice-play').textContent = '▶'; if (_activeVoiceEl === el) _activeVoiceEl = null; }
  }

  // Opens the app-wide gallery viewer (public/js/gallery-viewer.js via
  // openImgViewer in index.html) scoped to this chat's photos/gifs —
  // swiping moves between the actual photos in the conversation,
  // starting at whichever one was tapped, not always photo #1.
  function openMediaViewer(id) {
    const media = msgs.filter(m => !m.deleted && (m.type === 'image' || m.type === 'gif'));
    const idx = media.findIndex(m => String(m.id) === String(id));
    if (idx === -1) return;
    const collection = media.map(m => ({ url: m.media_url, type: 'image' }));
    if (window.openImgViewer) window.openImgViewer(media[idx].media_url, collection, idx);
  }

  function renderPinned() {
    const bar = document.getElementById('chatPinnedBar');
    if (!bar) return;
    const pinned = msgs.filter(m => m.pinned && !m.deleted);
    if (!pinned.length) { bar.innerHTML = ''; bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    bar.innerHTML = pinned.map(p => `<div class="chat-pinned-item" onclick="Chat.scrollToMsg(${p.id})">📌 ${esc((p.text||'Media').slice(0,50))}</div>`).join('');
  }
  function scrollToMsg(id) {
    const el = document.querySelector(`.chat-row[data-id="${id}"]`);
    // BUG FIX: this used to add class 'flash', but the CSS animation is
    // defined on '.msg-flash' (and, separately, was scoped to a
    // '.msg-row' selector that no rendered element actually has — rows
    // are '.chat-row'). Both mismatches meant tapping a reply quote,
    // pinned-message bar, or search result scrolled to the right message
    // but never actually highlighted it. Fixed to the class name the CSS
    // (now correctly scoped to .chat-row.msg-flash) expects.
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('msg-flash'); setTimeout(() => el.classList.remove('msg-flash'), 1300); }
  }

  // ─── SEND ────────────────────────────────────────────
  function genClientId() { return 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8); }

  async function sendMessage(payload) {
    if (!coupleId()) { toast('Not connected'); return; }
    const clientId = genClientId();
    const optimistic = {
      id: 'temp_' + clientId, client_id: clientId, couple_id: coupleId(), sender_role: myRole(),
      created_at: new Date().toISOString(), delivered: false, read: false, ...payload
    };
    msgs.push(optimistic); render(); scrollToBottom(true);
    if (window.playAppSound) {
      const soundByType = { gif: 'chat.gif.sent', image: 'chat.image.sent', file: 'chat.file.sent',
        sticker: 'chat.sticker.sent', voice: 'chat.voice.sent' };
      window.playAppSound(soundByType[payload.type] || 'chat.message.sent');
    }
    try {
      const saved = await api('POST', '/api/chat', { coupleId: coupleId(), clientId, senderRole: myRole(), ...payload });
      const idx = msgs.findIndex(m => m.client_id === clientId);
      if (idx > -1) msgs[idx] = saved;
      lastMsgId = Math.max(lastMsgId, saved.id);
      render();
      // Insurance for delivered/read ticks: the normal path for a tick to
      // flip live is the partner's client broadcasting 'message_status'
      // (see startRealtime's broadcast handler) the instant they come
      // online / read it. That depends on Realtime actually being
      // reachable end-to-end (dashboard config, socket staying connected,
      // etc.) — if it silently isn't, the only other thing that catches
      // it is the next background poll tick, up to ~2.5s away. A message
      // someone JUST sent is the single most likely moment for the
      // partner to immediately see/open the chat and read it, so give
      // this one message a few extra explicit status checks right after
      // sending, on top of (not instead of) the regular poll loop —
      // cheap, and it's exactly the window where "why hasn't my tick
      // updated yet" would be most noticeable.
      [1500, 4000, 8000].forEach(delay => setTimeout(refreshRecentStatuses, delay));
    } catch (e) {
      // The request itself errored (network blip, dropped connection,
      // etc.) — but the server upsert is idempotent on client_id, so it's
      // possible the write actually landed before the response was lost.
      // Check once before showing "failed" so a genuinely successful send
      // never gets a false failure toast.
      let confirmed = null;
      try {
        const q = lastMsgTs ? '?after=' + encodeURIComponent(lastMsgTs) : '?limit=20';
        const rows = await api('GET', '/api/chat/' + coupleId() + q);
        confirmed = (rows || []).find(r => r.client_id === clientId);
      } catch (e2) {}
      const idx = msgs.findIndex(m => m.client_id === clientId);
      if (confirmed) {
        if (idx > -1) msgs[idx] = confirmed;
        lastMsgId = Math.max(lastMsgId, confirmed.id);
        render();
      } else {
        if (idx > -1) msgs[idx]._failed = true;
        render();
        toast('Send failed — tap to retry');
      }
    }
  }

  function sendText() {
    const inp = document.getElementById('chatIn');
    const text = inp.value.trim();
    if (!text) return;
    if (editingId) { inp.value = ''; inp.style.height = 'auto'; saveEdit(text); return; }
    inp.value = ''; inp.style.height = 'auto';
    document.getElementById('chatSendBtn')?.classList.remove('has-text');
    clearTimeout(typingStopTimer);
    sendTypingSignal('stop');
    sendMessage({ type: 'text', text, replyTo: replyingTo });
    replyingTo = null; closeBanner();
  }

  // ─── TYPING INDICATOR (WhatsApp-style, via Supabase Realtime broadcast) ─
  function onTypingInput() {
    if (!coupleId() || !myRole() || !realtimeChannel) return;
    const now = Date.now();
    // Throttle "start" broadcasts so we're not sending one per keystroke —
    // one every 2.5s while the user keeps typing is plenty to keep the
    // partner's "typing…" indicator alive.
    if (now - lastTypingSentAt > 2500) {
      lastTypingSentAt = now;
      sendTypingSignal('start');
    }
    // Debounced "stop" — fires 3s after the user pauses typing.
    clearTimeout(typingStopTimer);
    typingStopTimer = setTimeout(() => sendTypingSignal('stop'), 3000);
  }

  function sendTypingSignal(status) {
    if (!realtimeChannel) return;
    try {
      realtimeChannel.send({
        type: 'broadcast',
        event: 'typing',
        payload: { role: myRole(), status }
      });
    } catch (e) {}
  }

  function handleTypingBroadcast(payload) {
    if (!payload || payload.role !== otherRole()) return;
    clearTimeout(partnerTypingTimeout);
    if (payload.status === 'start') {
      partnerTyping = true;
      // Safety net: auto-clear if a "stop" event is ever dropped (e.g. tab
      // killed mid-type without a pagehide firing in time).
      partnerTypingTimeout = setTimeout(() => { partnerTyping = false; updateTypingIndicatorUI(); }, 5000);
    } else {
      partnerTyping = false;
    }
    updateTypingIndicatorUI();
  }

  // Uploads a File/Blob to Supabase Storage instead of embedding it as
  // base64 text in the chat message — base64 media meant every chat
  // history load re-downloaded every image/audio/voice message ever sent,
  // full size, every time. mediaUrl is now a normal hosted URL.
  async function uploadChatMedia(fileOrBlob, filename) {
    const form = new FormData();
    form.append('file', fileOrBlob, filename || 'upload');
    form.append('coupleId', coupleId());
    const r = await fetch(API + '/api/media/upload', { method: 'POST', body: form });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Upload failed');
    return data.url;
  }

  async function onImagePick(input) {
    if (!input.files[0]) return;
    const file = input.files[0];
    input.value = '';
    try {
      const url = await uploadChatMedia(file, file.name);
      sendMessage({ type: 'image', mediaUrl: url });
    } catch (e) { toast('Image upload failed — please try again'); }
  }

 function sendGif(url) { sendMessage({ type: 'gif', mediaUrl: url }); closeSheet(); }

  async function onAudioPick(input) {
    if (!input.files[0]) return;
    const file = input.files[0];
    input.value = '';
    closeSheet();
    try {
      const url = await uploadChatMedia(file, file.name);
      sendMessage({ type: 'audio', mediaUrl: url, mediaMeta: { name: file.name } });
    } catch (e) { toast('Audio upload failed — please try again'); }
  }

  function sendLocation() {
    closeSheet();
    if (!navigator.geolocation) { toast('Location not supported on this device'); return; }
    toast('Getting your location...');
    navigator.geolocation.getCurrentPosition(
      pos => sendMessage({ type: 'location', mediaMeta: { lat: pos.coords.latitude, lng: pos.coords.longitude } }),
      () => toast('Location permission denied'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  const GIFTS = [
    { emoji: '🌹', name: 'Rose' }, { emoji: '💐', name: 'Bouquet' }, { emoji: '🍫', name: 'Chocolate' },
    { emoji: '🧸', name: 'Teddy' }, { emoji: '💍', name: 'Ring' }, { emoji: '🎂', name: 'Cake' },
    { emoji: '🎈', name: 'Balloon' }, { emoji: '🍰', name: 'Slice' }, { emoji: '🎁', name: 'Gift' }
  ];
  function openGiftPanel() {
    closeSheet();
    let panel = document.getElementById('chatGiftPanel');
    if (panel) { panel.classList.add('open'); return; }
    panel = document.createElement('div');
    panel.id = 'chatGiftPanel';
    panel.className = 'chat-bottom-sheet-overlay open';
    panel.innerHTML = `<div class="chat-bottom-sheet">
      <div class="chat-sheet-handle"></div>
      <div class="chat-sheet-grid">
        ${GIFTS.map(g => `<div class="chat-sheet-opt" onclick="Chat.sendGift('${g.emoji}','${g.name}')"><span>${g.emoji}</span>${g.name}</div>`).join('')}
      </div>
    </div>`;
    panel.onclick = e => { if (e.target === panel) panel.classList.remove('open'); };
    document.body.appendChild(panel);
  }
  function sendGift(emoji, name) {
    document.getElementById('chatGiftPanel')?.classList.remove('open');
    sendMessage({ type: 'gift', mediaMeta: { emoji, name } });
  }
  function sendEmoji(emoji) {
    const inp = document.getElementById('chatIn');
    inp.value += emoji;
    inp.focus();
  }

  // ─── VOICE RECORD ────────────────────────────────────
  // Picks the first MIME type the current browser/WebView's MediaRecorder
  // actually supports, instead of assuming one format works everywhere —
  // Chrome/most Android WebViews support audio/webm;codecs=opus, but not
  // every environment does, and Safari/iOS typically only supports
  // audio/mp4. Recording with an unsupported type either throws in the
  // MediaRecorder constructor or silently produces an empty/corrupt blob.
  const VOICE_MIME_CANDIDATES = [
    'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'
  ];
  function pickVoiceMimeType() {
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
    return VOICE_MIME_CANDIDATES.find(t => MediaRecorder.isTypeSupported(t)) || '';
  }
  async function toggleRecord() {
    if (recording) { stopRecording(); return; }
    if (_activeVoiceEl && _activeVoiceEl._audio && !_activeVoiceEl._audio.paused) {
      _activeVoiceEl._audio.pause();
      _activeVoiceEl.querySelector('.voice-waveform')?.classList.remove('playing');
      const btn = _activeVoiceEl.querySelector('.voice-play'); if (btn) btn.textContent = '▶';
      _activeVoiceEl = null;
    }
    if (typeof MediaRecorder === 'undefined') { toast('Voice recording isn\'t supported on this device'); return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) { toast('Mic permission denied'); return; }
    const mimeType = pickVoiceMimeType();
    try {
      mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch (e) {
      stream.getTracks().forEach(t => t.stop());
      toast('Voice recording isn\'t supported on this device');
      return;
    }
    const actualMimeType = mediaRecorder.mimeType || mimeType || 'audio/webm';
    recChunks = [];
    mediaRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) recChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      if (recCancelled) { recCancelled = false; return; }
      const dur = Math.round((Date.now() - recStart) / 1000);
      const blob = new Blob(recChunks, { type: actualMimeType });
      console.log('[voice] recorded', { mimeType: actualMimeType, size: blob.size, durationSec: dur });
      if (!blob || blob.size === 0) { toast('Recording was empty — please try again'); return; }
      try {
        const uploaded = await uploadVoiceMessage(blob, actualMimeType);
        sendMessage({ type: 'voice', mediaUrl: uploaded.url, mediaMeta: { duration: dur, path: uploaded.path, contentType: actualMimeType } });
      } catch (e) {
        console.error('[voice] upload failed:', e);
        toast('Voice message upload failed — ' + (e.message || 'please try again'));
      }
    };
    mediaRecorder.start();
    recording = true; recStart = Date.now();
    document.getElementById('chatRecTimer').style.display = 'inline';
    document.getElementById('chatStopRecBtn').style.display = 'flex';
    document.getElementById('chatCancelRecBtn').style.display = 'flex';
    document.getElementById('chatMoreBtn').style.display = 'none';
    document.getElementById('chatSendBtn').style.display = 'none';
    recTimerInt = setInterval(() => {
      const s = Math.floor((Date.now() - recStart) / 1000);
      document.getElementById('chatRecTimer').textContent = String(Math.floor(s/60)).padStart(2,'0') + ':' + String(s%60).padStart(2,'0');
    }, 500);
  }
  function stopRecording() {
    recording = false;
    clearInterval(recTimerInt);
    document.getElementById('chatRecTimer').style.display = 'none';
    document.getElementById('chatStopRecBtn').style.display = 'none';
    document.getElementById('chatCancelRecBtn').style.display = 'none';
    document.getElementById('chatMoreBtn').style.display = 'flex';
    document.getElementById('chatSendBtn').style.display = 'flex';
    if (mediaRecorder) mediaRecorder.stop();
  }
  function cancelRecording() {
    recCancelled = true;
    stopRecording();
    toast('Recording discarded');
  }
  // Dedicated voice-message upload — separate from uploadChatMedia()
  // because /api/media/upload's fileFilter only allows image/video
  // mimetypes; audio needs /api/media/upload-voice, which allows
  // audio/* and returns the storage path alongside the URL so it can be
  // saved in media_meta.path for later cleanup (see routes/chat.js
  // DELETE handler).
  async function uploadVoiceMessage(blob, mimeType) {
    const extFromMime = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3' };
    const baseMime = (mimeType || '').split(';')[0].trim().toLowerCase();
    const ext = extFromMime[baseMime] || 'webm';
    const form = new FormData();
    form.append('file', blob, `voice.${ext}`);
    form.append('coupleId', coupleId());
    form.append('senderRole', myRole());
    const r = await fetch(API + '/api/media/upload-voice', { method: 'POST', body: form });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Upload failed');
    return data;
  }

  // ─── BUBBLE ACTIONS / LONG-PRESS MENU ───────────────
  let _lastTapId = null, _lastTapTime = 0;
  function onBubbleClick(id, ev) {
    if (lpFired) { lpFired = false; return; }
    if (selectMode) { toggleSelect(id); return; }
    // Instagram-style double-tap-to-heart: two taps on the SAME bubble
    // within 300ms toggles a ❤️ reaction and shows a brief floating-heart
    // burst at the tap point. A single tap (or a double-tap that lands on
    // two different bubbles) does nothing — matches IG/WhatsApp behavior
    // of not hijacking normal taps.
    const now = Date.now();
    if (_lastTapId === id && now - _lastTapTime < 300) {
      _lastTapTime = 0; _lastTapId = null;
      const m = msgs.find(x => x.id === id || String(x.id) === String(id));
      if (m && !m.deleted) {
        const already = m.reactions && Object.entries(m.reactions).some(([e, roles]) => e === '❤️' && roles.includes(myRole()));
        reactTo(id, '❤️');
        if (!already) burstHeart(ev);
      }
      return;
    }
    _lastTapId = id; _lastTapTime = now;
  }
  function burstHeart(ev) {
    const heart = document.createElement('div');
    heart.className = 'dbl-tap-heart';
    heart.textContent = '❤️';
    const x = ev && ev.clientX ? ev.clientX : window.innerWidth / 2;
    const y = ev && ev.clientY ? ev.clientY : window.innerHeight / 2;
    heart.style.left = x + 'px'; heart.style.top = y + 'px';
    document.body.appendChild(heart);
    setTimeout(() => heart.remove(), 700);
  }
  let lpStartX = 0, lpStartY = 0;
  const LP_MOVE_TOLERANCE = 12; // px — real fingers jitter slightly during a hold; only cancel on real movement
  function startLongPress(id, ev) {
    lpFired = false;
    clearTimeout(lpTimer);
    const p = ev && ev.touches ? ev.touches[0] : ev;
    lpStartX = p ? p.clientX : 0;
    lpStartY = p ? p.clientY : 0;
    lpTimer = setTimeout(() => {
      lpFired = true;
      if (navigator.vibrate) navigator.vibrate(30);
      // WhatsApp-style: long-press selects the message immediately.
      // If a selection is already in progress, add/toggle this one;
      // otherwise start selection mode with this message selected.
      // (The full action menu — React/Reply/Forward/etc. — is still
      // reachable via right-click on desktop, or the toolbar's ⋮
      // button once exactly one message is selected.)
      if (selectMode) toggleSelect(id); else enterSelectMode(id);
    }, 450);
  }
  function moveLongPress(ev) {
    if (!lpTimer) return;
    const p = ev && ev.touches ? ev.touches[0] : ev;
    if (!p) return;
    const dx = Math.abs(p.clientX - lpStartX), dy = Math.abs(p.clientY - lpStartY);
    if (dx > LP_MOVE_TOLERANCE || dy > LP_MOVE_TOLERANCE) endLongPress();
  }
  function endLongPress() { clearTimeout(lpTimer); lpTimer = null; }
  function openMenu(id, ev) {
  // If selection mode is already active, long-press / right-click on
  // another message just adds it to the selection instead of popping
  // the action menu again — this is what makes multi-select feel
  // smooth (select first message, then long-press or tap the rest).
  if (selectMode) { toggleSelect(id); return; }
  const m = msgs.find(x => x.id === id); if (!m) return;
  document.getElementById('chatMsgMenu')?.remove();
  const isDesktop = window.innerWidth > 700 && ev && ev.clientX;
  const sheet = document.createElement('div');
  sheet.id = 'chatMsgMenu';
  if (isDesktop) {
    sheet.className = 'msg-ctx-bg';
    sheet.innerHTML = `<div class="msg-ctx-menu open" style="left:${ev.clientX}px;top:${ev.clientY}px">
      ${menuItemsHtml(m, id, true)}
    </div>`;
  } else {
    sheet.className = 'chat-sheet-overlay';
    sheet.innerHTML = `<div class="chat-sheet">${menuItemsHtml(m, id, true)}</div>`;
  }
  sheet.onclick = e => { if (e.target === sheet) sheet.remove(); };
  document.body.appendChild(sheet);
}
function menuItemsHtml(m, id, includeSelect) {
  const mine = isMine(m);
  return `
    ${includeSelect ? `<div class="ctx-item" onclick="Chat.enterSelectMode('${id}')">☑️ Select</div>` : ''}
    <div class="ctx-item" onclick="Chat.reactTo('${id}','❤️')">❤️ React</div>
    <div class="ctx-item" onclick="Chat.replyTo('${id}')">↩️ Reply</div>
    <div class="ctx-item" onclick="Chat.forwardMsg('${id}')">↪️ Forward</div>
    <div class="ctx-item" onclick="Chat.copyMsg('${id}')">📋 Copy</div>
    <div class="ctx-item" onclick="Chat.togglePin('${id}')">📌 Pin</div>
    <div class="ctx-item" onclick="Chat.toggleStar('${id}')">⭐ Star</div>
    ${mine && m.type === 'text' ? `<div class="ctx-item" onclick="Chat.editMsg('${id}')">✏️ Edit</div>` : ''}
    <div class="ctx-item" onclick="Chat.infoMsg('${id}')">ℹ️ Info</div>
    ${mine ? `<div class="ctx-item danger" onclick="Chat.confirmDeleteMsg('${id}','everyone')">🗑️ Delete for everyone</div>` : ''}
    <div class="ctx-item danger" onclick="Chat.confirmDeleteMsg('${id}','me')">🗑️ Delete for me</div>`;
}
  async function reactTo(id, emoji) {
    document.getElementById('chatMsgMenu')?.remove();
    try {
      const data = await api('POST', '/api/chat/' + id + '/react', { coupleId: coupleId(), role: myRole(), emoji });
      const idx = msgs.findIndex(m => m.id === id); if (idx > -1) msgs[idx] = data;
      render();
    } catch (e) {}
  }
  function replyTo(id) {
    document.getElementById('chatMsgMenu')?.remove();
    const m = msgs.find(x => x.id === id); if (!m) return;
    editingId = null;
    replyingTo = id;
    const banner = document.getElementById('chatComposerBanner');
    const who = isMine(m) ? (window.S.myName || 'You') : (window.S.partnerName || 'Partner');
    // Small attachment thumbnail for image/gif/sticker replies — gives
    // the reply preview the same "what am I replying to" context
    // WhatsApp shows, instead of just a text line.
    const thumbUrl = (m.type === 'image' || m.type === 'gif') ? m.media_url : null;
    let previewText = m.text;
    if (!previewText) {
      previewText = m.type === 'image' ? '📷 Photo' : m.type === 'gif' ? '🎞️ GIF' : m.type === 'voice' ? '🎤 Voice message'
        : m.type === 'audio' ? '🎵 Audio' : m.type === 'sticker' ? (m.media_meta?.emoji || '🙂') + ' Sticker'
        : m.type === 'gift' ? '🎁 Gift' : m.type === 'contact' ? '👤 Contact' : m.type === 'location' ? '📍 Location'
        : m.type === 'poll' ? '📊 Poll' : 'Message';
    }
    banner.innerHTML = `
      ${thumbUrl ? `<img class="banner-thumb" src="${esc(thumbUrl)}" alt="">` : ''}
      <div class="banner-body">
        <div class="banner-title">${esc(who)}</div>
        <div class="banner-sub">${esc(String(previewText).slice(0, 80))}</div>
      </div>
      <button class="banner-close" onclick="Chat.closeBanner()" aria-label="Cancel reply">✕</button>`;
    banner.classList.add('show');
    focusComposer();
  }
  // Focusing immediately after a touch gesture (swipe-to-reply) can silently
  // fail on mobile Safari/Chrome if it fires before the banner's layout
  // change has actually been applied — the keyboard then never opens even
  // though the reply preview is visible. Focusing once synchronously (to
  // catch the common case) and once more after layout settles on the next
  // frame covers both.
  function focusComposer() {
    const input = document.getElementById('chatIn');
    if (!input) return;
    const place = () => {
      input.focus({ preventScroll: false });
      if (typeof input.setSelectionRange === 'function' && input.value != null) {
        const len = input.value.length;
        try { input.setSelectionRange(len, len); } catch (e) {}
      }
    };
    place();
    requestAnimationFrame(place);
  }
  function closeBanner() { const b = document.getElementById('chatComposerBanner'); if (b) { b.classList.remove('show'); setTimeout(() => { if (!b.classList.contains('show')) b.innerHTML = ''; }, 200); } replyingTo = null; editingId = null; }
  async function togglePin(id, silent) {
    if (!silent) document.getElementById('chatMsgMenu')?.remove();
    const m = msgs.find(x => x.id === id); if (!m) return;
    try {
      const data = await api('POST', '/api/chat/' + id + '/pin', { coupleId: coupleId(), pinned: !m.pinned });
      const idx = msgs.findIndex(x => x.id === id); if (idx > -1) msgs[idx] = data;
      render();
    } catch (e) {}
  }
  async function toggleStar(id, silent) {
    if (!silent) document.getElementById('chatMsgMenu')?.remove();
    try {
      const data = await api('POST', '/api/chat/' + id + '/star', { coupleId: coupleId(), role: myRole() });
      const idx = msgs.findIndex(x => x.id === id); if (idx > -1) msgs[idx] = data;
      render();
      if (!silent) toast('Updated ⭐');
    } catch (e) {}
  }
  function forwardMsg(id) {
    document.getElementById('chatMsgMenu')?.remove();
    const m = msgs.find(x => x.id === id); if (!m) return;
    sendMessage({ type: m.type, text: m.text, mediaUrl: m.media_url, mediaMeta: m.media_meta, forwarded: true });
    toast('Forwarded');
  }
  function copyMsg(id) {
    document.getElementById('chatMsgMenu')?.remove();
    const m = msgs.find(x => x.id === id); if (!m) return;
    if (!m.text) { toast('Nothing to copy'); return; }
    navigator.clipboard?.writeText(m.text).then(() => toast('Copied')).catch(() => toast('Copy failed'));
  }
  let editingId = null;
  function editMsg(id) {
    document.getElementById('chatMsgMenu')?.remove();
    const m = msgs.find(x => x.id === id); if (!m || m.type !== 'text') return;
    replyingTo = null;
    editingId = id;
    const inp = document.getElementById('chatIn');
    inp.value = m.text || '';
    inp.focus();
    const banner = document.getElementById('chatComposerBanner');
    banner.innerHTML = `<div class="banner-body"><div class="banner-title">Editing message</div></div><button class="banner-close" onclick="Chat.cancelEdit()" aria-label="Cancel edit">✕</button>`;
    banner.classList.add('show');
  }
  function cancelEdit() { editingId = null; closeBanner(); document.getElementById('chatIn').value = ''; }
  async function saveEdit(text) {
    try {
      const data = await api('PATCH', '/api/chat/' + editingId, { coupleId: coupleId(), senderRole: myRole(), text });
      const idx = msgs.findIndex(m => m.id === editingId);
      if (idx > -1) msgs[idx] = data;
      render();
    } catch (e) { toast('Edit failed'); }
    editingId = null; closeBanner();
  }
  function infoMsg(id) {
    document.getElementById('chatMsgMenu')?.remove();
    const m = msgs.find(x => x.id === id); if (!m) return;
    const sent = fmtDaySep(new Date(m.created_at)) + ' at ' + fmtClock(m.created_at);
    const status = m.read ? 'Read' : m.delivered ? 'Delivered' : 'Sent';
    toast(`${status} · ${sent}`);
  }
  function openStarred() {
    const starred = msgs.filter(m => (m.starred_by || []).includes(myRole()));
    if (!starred.length) { toast('No starred messages'); return; }
    toast(starred.length + ' starred message(s)');
  }
  const deletingIds = new Set(); // guards against rapid double-tap firing two DELETE requests for the same message
  async function deleteMsg(id, mode) {
    document.getElementById('chatMsgMenu')?.remove();
    if (deletingIds.has(id)) return; // already in flight
    deletingIds.add(id);
    try {
      await api('DELETE', '/api/chat/' + id, { coupleId: coupleId(), senderRole: myRole(), mode });
      if (mode === 'everyone') { const idx = msgs.findIndex(x => x.id == id); if (idx > -1) { msgs[idx].deleted = true; } }
      else { const idx = msgs.findIndex(x => x.id == id); if (idx > -1) { msgs[idx].deleted_for = (msgs[idx].deleted_for || '') + ',' + myRole(); } }
      render();
    } finally { deletingIds.delete(id); }
  }
  // Menu-driven single delete — shows the shared confirm sheet first, wording
  // clearly stating the consequence ("for me" vs "for everyone" are genuinely
  // different outcomes here, so both get their own explicit message).
  function confirmDeleteMsg(id, mode) {
    document.getElementById('chatMsgMenu')?.remove();
    const everyone = mode === 'everyone';
    confirmDelete({
      title: everyone ? 'Delete for everyone?' : 'Delete for me?',
      itemType: 'message',
      message: everyone
        ? 'This message will be permanently removed for both of you.'
        : 'This message will be removed from your chat only — your partner will still see it.',
      destructiveLabel: everyone ? 'Delete for Everyone' : 'Delete for Me',
      onConfirm: () => deleteMsg(id, mode)
    });
  }

  // ─── SELECT MODE (WhatsApp-style: row-highlight only, no circles) ──
  // Selection state lives entirely in `selectedIds` (a Set of message
  // IDs — never DOM position), so realtime re-renders, insertions, and
  // deletions can never desync the selection from what's on screen.
  function markRowSelected(id, on) {
    const row = document.querySelector(`.chat-row[data-id="${id}"]`);
    if (!row) return;
    row.classList.toggle('sel-selected', on);
  }
  function enterSelectMode(id) {
    document.getElementById('chatMsgMenu')?.remove();
    selectMode = true; selectedIds = new Set([id]);
    document.getElementById('chatMsgs')?.classList.add('selecting');
    document.getElementById('chatSelectToolbar')?.classList.add('show');
    markRowSelected(id, true);
    renderSelectToolbar();
  }
  function toggleSelect(id) {
    if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
    markRowSelected(id, selectedIds.has(id));
    if (!selectedIds.size) exitSelectMode(); else renderSelectToolbar();
  }
  function exitSelectMode() {
    selectMode = false; selectedIds.clear();
    document.getElementById('chatMsgs')?.classList.remove('selecting');
    document.querySelectorAll('.chat-row.sel-selected').forEach(r => r.classList.remove('sel-selected'));
    document.getElementById('chatSelectToolbar')?.classList.remove('show');
    closeToolbarOverflow();
  }
  // Realtime safety: if a selected message is deleted/vanishes from `msgs`
  // (remote delete, sync), drop its id from the selection instead of
  // leaving a phantom entry in the count / bulk-action list.
  function pruneMissingSelection() {
    if (!selectMode) return;
    let changed = false;
    selectedIds.forEach(id => { if (!msgs.some(m => m.id === id)) { selectedIds.delete(id); changed = true; } });
    if (changed) { if (!selectedIds.size) exitSelectMode(); else renderSelectToolbar(); }
  }

  // ─── SELECTION TOOLBAR (context-aware, Lucide icons, responsive) ──
  function selectedMsgs() {
    return Array.from(selectedIds).map(id => msgs.find(m => m.id === id)).filter(Boolean);
  }
  function hasDownloadableMedia(m) {
    return !!m.media_url && ['image', 'gif', 'voice', 'audio'].includes(m.type);
  }
  const TOOLBAR_ACTIONS = [
    { key: 'reply', icon: 'reply', label: 'Reply',
      show: (ms) => ms.length === 1 && ms[0].type !== 'call_log',
      run: () => { replyTo(Array.from(selectedIds)[0]); exitSelectMode(); } },
    { key: 'star', icon: 'star', label: 'Star',
      show: (ms) => ms.length > 0 && ms.every(m => m.type !== 'call_log'),
      run: () => starSelected() },
    { key: 'pin', icon: 'pin', label: 'Pin',
      show: (ms) => ms.length > 0 && ms.every(m => m.type !== 'call_log'),
      run: () => pinSelected() },
    { key: 'delete', icon: 'trash-2', label: 'Delete',
      show: (ms) => ms.length > 0,
      run: () => deleteSelected() },
    { key: 'copy', icon: 'copy', label: 'Copy',
      show: (ms) => ms.length > 0 && ms.every(m => !!m.text),
      run: () => copySelected() },
    { key: 'share', icon: 'share-2', label: 'Share',
      show: (ms) => ms.length > 0,
      run: () => shareSelected() },
    { key: 'react', icon: 'smile-plus', label: 'React',
      show: (ms) => ms.length === 1 && ms[0].type !== 'call_log',
      run: (ev) => openReactionPicker(ev) },
    { key: 'download', icon: 'download', label: 'Download',
      show: (ms) => ms.some(hasDownloadableMedia),
      run: () => downloadSelected() }
  ];
  function renderSelectToolbar() {
    const bar = document.getElementById('chatSelectToolbar');
    if (!bar) return;
    const countEl = document.getElementById('chatSelectCount');
    if (countEl) countEl.textContent = String(selectedIds.size);
    const ms = selectedMsgs();
    const active = TOOLBAR_ACTIONS.filter(a => a.show(ms));
    const actionsEl = document.getElementById('chatSelectActions');
    const moreBtn = document.getElementById('chatSelectMoreBtn');
    if (!actionsEl) return;
    actionsEl.innerHTML = active.map((a, i) =>
      `<button type="button" class="cst-btn" data-action="${a.key}" data-idx="${i}" title="${a.label}" aria-label="${a.label}"><i data-lucide="${a.icon}"></i></button>`
    ).join('');
    if (window.lucide) { try { lucide.createIcons(); } catch (_) {} }
    actionsEl.querySelectorAll('.cst-btn').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        const def = active.find(a => a.key === btn.dataset.action);
        closeToolbarOverflow();
        if (def) def.run(ev);
      });
    });
    if (moreBtn) moreBtn.style.display = 'none'; // shown only if collapseOverflow finds hidden actions
    requestAnimationFrame(() => collapseToolbarOverflow(active));
  }
  // Fits as many action buttons as the header width allows, in priority
  // order, and moves whatever doesn't fit into the ⋮ overflow menu —
  // this is what makes the toolbar adapt to phone vs desktop widths
  // instead of squeezing 8 tiny icons into a narrow header.
  function collapseToolbarOverflow(active) {
    const bar = document.getElementById('chatSelectToolbar');
    const actionsEl = document.getElementById('chatSelectActions');
    const moreBtn = document.getElementById('chatSelectMoreBtn');
    if (!bar || !actionsEl || !moreBtn) return;
    const buttons = Array.from(actionsEl.querySelectorAll('.cst-btn'));
    if (!buttons.length) return;
    // Reset to fully visible, then measure.
    buttons.forEach(b => { b.style.display = ''; });
    moreBtn.style.display = 'none';
    const barRect = bar.getBoundingClientRect();
    const reserved = 44 /* back btn */ + 34 /* count */ + 16 /* padding/gaps */;
    const available = barRect.width - reserved;
    const btnWidth = 40; // measured footprint incl. gap for each icon button
    const maxFit = Math.max(1, Math.floor(available / btnWidth));
    if (buttons.length > maxFit) {
      // Reserve one slot for the ⋮ overflow button itself.
      const keep = Math.max(1, maxFit - 1);
      buttons.forEach((b, i) => { if (i >= keep) b.style.display = 'none'; });
      moreBtn.style.display = 'flex';
      moreBtn._overflowActions = active.slice(keep);
    } else {
      moreBtn._overflowActions = [];
    }
  }
  window.addEventListener('resize', () => { if (selectMode) renderSelectToolbar(); });
  function openToolbarOverflow(ev) {
    ev && ev.stopPropagation();
    const moreBtn = document.getElementById('chatSelectMoreBtn');
    const list = (moreBtn && moreBtn._overflowActions) || [];
    closeToolbarOverflow();
    if (!list.length) return;
    const menu = document.createElement('div');
    menu.id = 'chatToolbarOverflowMenu';
    menu.className = 'msg-ctx-bg';
    const rect = moreBtn.getBoundingClientRect();
    menu.innerHTML = `<div class="msg-ctx-menu open" style="right:8px;left:auto;top:${rect.bottom + 6}px">
      ${list.map(a => `<div class="ctx-item" data-action="${a.key}"><i data-lucide="${a.icon}" style="width:15px;height:15px;vertical-align:-3px;margin-right:8px"></i>${a.label}</div>`).join('')}
    </div>`;
    menu.onclick = (e) => {
      if (e.target === menu) { menu.remove(); return; }
      const item = e.target.closest('.ctx-item');
      if (item) { menu.remove(); const def = list.find(a => a.key === item.dataset.action); if (def) def.run(e); }
    };
    document.body.appendChild(menu);
    if (window.lucide) { try { lucide.createIcons(); } catch (_) {} }
  }
  function closeToolbarOverflow() { document.getElementById('chatToolbarOverflowMenu')?.remove(); }

  // ─── React (single selection) — reuses the same reactTo()/API used
  // elsewhere; this only adds a small emoji-picker UI, not a second
  // reactions system. ──
  const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '🙏', '👍'];
  function openReactionPicker(ev) {
    if (selectedIds.size !== 1) return;
    const id = Array.from(selectedIds)[0];
    document.getElementById('chatReactionPicker')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'chatReactionPicker';
    wrap.className = 'msg-ctx-bg';
    wrap.innerHTML = `<div class="chat-reaction-picker">
      ${QUICK_REACTIONS.map(e => `<span class="ctx-emoji" data-emoji="${e}">${e}</span>`).join('')}
    </div>`;
    wrap.onclick = (e) => {
      if (e.target === wrap) { wrap.remove(); return; }
      const span = e.target.closest('[data-emoji]');
      if (span) { wrap.remove(); reactTo(id, span.dataset.emoji); exitSelectMode(); }
    };
    document.body.appendChild(wrap);
  }

  // ─── Bulk star / pin — toggle-as-a-group: if every selected message
  // is already starred/pinned, the action unstars/unpins all of them;
  // otherwise it stars/pins only the ones that aren't yet, so a mixed
  // selection converges to "all on" in one tap rather than flipping
  // each message individually. Reuses the existing per-message
  // /star and /pin endpoints — no new backend/table involved. ──
  async function starSelected() {
    const ms = selectedMsgs(); if (!ms.length) return;
    const allStarred = ms.every(m => (m.starred_by || []).includes(myRole()));
    for (const m of ms) {
      const isStarred = (m.starred_by || []).includes(myRole());
      if (allStarred ? isStarred : !isStarred) await toggleStar(m.id, true);
    }
    toast(allStarred ? 'Unstarred' : (ms.length > 1 ? `${ms.length} messages starred` : 'Starred'));
    exitSelectMode();
  }
  async function pinSelected() {
    const ms = selectedMsgs(); if (!ms.length) return;
    const allPinned = ms.every(m => !!m.pinned);
    for (const m of ms) {
      if (allPinned ? m.pinned : !m.pinned) await togglePin(m.id, true);
    }
    toast(allPinned ? 'Unpinned' : (ms.length > 1 ? `${ms.length} messages pinned` : 'Pinned'));
    exitSelectMode();
  }
  function copySelected() {
    const ms = selectedMsgs().slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const text = ms.map(m => m.text).filter(Boolean).join('\n');
    if (!text) { toast('Nothing to copy'); return; }
    navigator.clipboard?.writeText(text).then(() => toast('Copied')).catch(() => toast('Copy failed'));
    exitSelectMode();
  }
  // Reuses the existing media_url / storage architecture — just fetches
  // each selected media message's file and triggers a browser download.
  // Falls back to opening the URL directly if the fetch is blocked
  // (e.g. cross-origin storage host without permissive CORS).
  async function downloadOne(m) {
    const url = m.media_url;
    const name = (m.media_meta && m.media_meta.name) || url.split('/').pop().split('?')[0] || 'file';
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { window.open(url, '_blank'); }
  }
  async function downloadSelected() {
    const ms = selectedMsgs().filter(hasDownloadableMedia);
    if (!ms.length) { toast('Nothing downloadable in this selection'); return; }
    toast(ms.length > 1 ? `Downloading ${ms.length} files…` : 'Downloading…');
    for (const m of ms) await downloadOne(m);
    exitSelectMode();
  }
  // Uses the Web Share API where supported (native share sheet); falls
  // back to copying text / opening the media link when unavailable.
  async function shareSelected() {
    const ms = selectedMsgs();
    if (!ms.length) return;
    const mediaMs = ms.filter(hasDownloadableMedia);
    try {
      if (navigator.share) {
        if (mediaMs.length && navigator.canShare) {
          const files = [];
          for (const m of mediaMs) {
            try {
              const res = await fetch(m.media_url);
              const blob = await res.blob();
              const name = (m.media_meta && m.media_meta.name) || m.media_url.split('/').pop().split('?')[0] || 'file';
              files.push(new File([blob], name, { type: blob.type || 'application/octet-stream' }));
            } catch (_) {}
          }
          if (files.length && navigator.canShare({ files })) { await navigator.share({ files }); exitSelectMode(); return; }
        }
        const text = ms.map(m => m.text).filter(Boolean).join('\n') || mediaMs.map(m => m.media_url).join('\n');
        if (text) { await navigator.share({ text }); exitSelectMode(); return; }
      }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    // Fallback: copy whatever we can, or open media in a new tab.
    const text = ms.map(m => m.text).filter(Boolean).join('\n');
    if (text) { navigator.clipboard?.writeText(text); toast('Share not supported — copied instead'); }
    else if (mediaMs.length) { mediaMs.forEach(m => window.open(m.media_url, '_blank')); }
    exitSelectMode();
  }
  // Bulk delete always deletes "for me" — safe regardless of whether the
  // selection mixes your own and your partner's messages (deleting a
  // partner's message "for everyone" isn't something you're allowed to do,
  // and the backend would reject it per-message anyway). Reports partial
  // failures instead of silently claiming everything was removed.
  async function deleteSelected() {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    confirmDelete({
      title: `Delete ${ids.length} selected message${ids.length > 1 ? 's' : ''}?`,
      count: ids.length,
      itemType: 'message',
      message: 'These messages will be removed from your chat only — your partner will still see their copies.',
      onConfirm: async () => {
        const trashBtn = document.querySelector('#chatSelectActions .cst-btn[data-action="delete"]');
        if (trashBtn) trashBtn.disabled = true;
        const { succeeded, failed } = await runBulkDelete(ids, (id) => deleteMsg(id, 'me'));
        if (trashBtn) trashBtn.disabled = false;
        selectedIds = new Set(failed.map(f => f.id)); // keep failed ones selected/visible
        if (!selectedIds.size) exitSelectMode();
        else renderSelectToolbar();
        if (failed.length) toast(`${succeeded.length} deleted. ${failed.length} couldn't be deleted.`);
        else toast(succeeded.length > 1 ? `${succeeded.length} messages deleted` : 'Deleted');
      }
    });
  }

  // ─── SEARCH ──────────────────────────────────────────
  function openSearch() { document.getElementById('chatSearchBar').classList.add('show'); document.getElementById('chatSearchInput').focus(); }
  function closeSearch() { document.getElementById('chatSearchBar').classList.remove('show'); document.getElementById('chatSearchInput').value=''; document.getElementById('chatSearchResults').innerHTML=''; }
  // Wraps every case-insensitive occurrence of `q` in escaped `text` with
  // <mark>, so the matched word/phrase stands out in the results list —
  // same idea as WhatsApp/Telegram's yellow-highlighted search hits.
  function highlightMatch(text, q) {
    const safe = esc(text);
    const qEsc = esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!qEsc) return safe;
    return safe.replace(new RegExp(qEsc, 'ig'), match => `<mark class="chat-search-mark">${match}</mark>`);
  }
  async function runSearch(q) {
    if (!q.trim()) { document.getElementById('chatSearchResults').innerHTML = ''; return; }
    try {
      const rows = await api('GET', '/api/chat/' + coupleId() + '/search?q=' + encodeURIComponent(q));
      const el = document.getElementById('chatSearchResults');
      el.innerHTML = (rows||[]).map(r => `<div class="chat-search-result" onclick="Chat.closeSearch();Chat.scrollToMsg(${r.id})">${highlightMatch((r.text||'Media').slice(0,80), q)}</div>`).join('') || '<div class="empty">No results</div>';
    } catch (e) {}
  }

  // ─── BOTTOM SHEET (⋮ menu) ───────────────────────────
  function openSheet() {
    let sheet = document.getElementById('chatBottomSheet');
    if (sheet) { sheet.classList.add('open'); return; }
    sheet = document.createElement('div');
    sheet.id = 'chatBottomSheet';
    sheet.className = 'chat-bottom-sheet-overlay open';
    sheet.innerHTML = `<div class="chat-bottom-sheet">
      <div class="chat-sheet-handle"></div>
      <div class="chat-sheet-grid">
        <div class="chat-sheet-opt" onclick="document.getElementById('chatGalleryInput').click()"><span>🖼</span>Photos</div>
        <div class="chat-sheet-opt" onclick="document.getElementById('chatCameraInput').click()"><span>📷</span>Camera</div>
        <div class="chat-sheet-opt" onclick="document.getElementById('chatVideoInput').click()"><span>🎥</span>Videos</div>
        <div class="chat-sheet-opt" onclick="document.getElementById('chatFileInput').click()"><span>📁</span>Documents</div>
        <div class="chat-sheet-opt" onclick="document.getElementById('chatAudioInput').click()"><span>🎵</span>Audio</div>
        <div class="chat-sheet-opt" onclick="Chat.closeSheet();Chat.toggleRecord()"><span>🎤</span>Voice</div>
        <div class="chat-sheet-opt" onclick="Chat.openGifPanel()"><span>🎬</span>GIFs</div>
        <div class="chat-sheet-opt" onclick="Chat.openStickerPanel()"><span>🎭</span>Stickers</div>
        <div class="chat-sheet-opt" onclick="Chat.openEmojiPanel()"><span>😊</span>Emojis</div>
        <div class="chat-sheet-opt" onclick="Chat.sendLocation()"><span>📍</span>Location</div>
        <div class="chat-sheet-opt" onclick="Chat.sendContactCard()"><span>👤</span>Contact</div>
        <div class="chat-sheet-opt" onclick="Chat.openGiftPanel()"><span>🎁</span>Couple Gifts</div>
        <div class="chat-sheet-opt" onclick="Chat.openMemories()"><span>📔</span>Memories</div>
        <div class="chat-sheet-opt" onclick="Chat.openPollComposer()"><span>📊</span>Poll</div>
      </div>
      <input type="file" id="chatCameraInput" accept="image/*" capture="environment" style="display:none" onchange="Chat.onImagePick(this)">
      <input type="file" id="chatGalleryInput" accept="image/*" multiple style="display:none" onchange="Chat.onImagePick(this)">
      <input type="file" id="chatVideoInput" accept="video/*" style="display:none" onchange="Chat.onImagePick(this)">
      <input type="file" id="chatFileInput" style="display:none" onchange="Chat.onImagePick(this)">
      <input type="file" id="chatAudioInput" accept="audio/*" style="display:none" onchange="Chat.onAudioPick(this)">
    </div>`;
    sheet.onclick = e => { if (e.target === sheet) closeSheet(); };
    document.body.appendChild(sheet);
  }
  function closeSheet() { document.getElementById('chatBottomSheet')?.classList.remove('open'); }

  // ─── PANEL LIFECYCLE ─────────────────────────────────
  // Every modal above (attach sheet, gift/emoji/sticker/poll/GIF panels,
  // contact sheet, message long-press menu) is appended straight to
  // document.body as a position:fixed overlay so it can sit above the whole
  // app. That also means the SPA router's page-swap — which only toggles the
  // .active class on .page elements — never touches them: they are outside
  // any .page and simply keep existing, which is how a GIF panel opened in
  // Chat could still be visible after Android Back or navigating elsewhere.
  // destroyPanels() removes every one of these overlay nodes from the DOM
  // outright (not just hiding them), which also drops any listeners attached
  // directly to those nodes. It's called from the app's central goto()
  // router on every navigation (including Android Back, since that also
  // resolves to a goto() via popstate), and from unload.
  const PANEL_IDS = ['chatGiftPanel', 'chatMsgMenu', 'chatBottomSheet', 'chatEmojiPanel',
    'chatStickerPanel', 'chatContactSheet', 'chatPollPanel', 'chatGifPanel',
    'chatReactionPicker', 'chatToolbarOverflowMenu'];
  // Overlays that live in the page markup itself (not body-appended, so
  // they aren't removed — just closed) plus non-DOM chat state that's only
  // meaningful while Chat is the active page. Leaving Chat via the bottom
  // nav/sidebar (not Back) should reset all of this in one shot, the same
  // way an app fully unwinds a screen's state when you jump away from it —
  // unlike closeTopOverlayIfOpen(), which unwinds Back one step at a time.
  function destroyPanels() {
    clearTimeout(gifDebounce);
    PANEL_IDS.forEach(id => document.getElementById(id)?.remove());
    document.getElementById('wpPreviewOverlay')?.classList.remove('open');
    document.getElementById('wpModalOverlay')?.classList.remove('open');
    if (_wpCropUrl) { URL.revokeObjectURL(_wpCropUrl); _wpCropUrl = null; }
    document.getElementById('chatSearchBar')?.classList.remove('show');
    document.getElementById('chatHeaderMenu')?.classList.remove('open');
    if (selectMode) exitSelectMode();
  }
  window.addEventListener('pagehide', destroyPanels);

  const EMOJI_CATEGORIES = {
    'Recent': [],
    'Smileys': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊','😇','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤗','🤩','🤔','🤨','😐','😑','😶','😏','😒','🙄','😬','😴','😪','😷','🤒','🤕'],
    'Emotions': ['😢','😭','😤','😠','😡','🥺','😨','😰','😥','😓','🤯','😳','🥵','🥶','😱','😖','😣','😞','😔','😟','😕','🙁','☹️','😩','😫','😵','🤐','🥴','🤢','🤮'],
    'Love': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💕','💞','💓','💗','💖','💘','💝','💟','💔','❣️','💌','😻','😽','💑','💏','👩‍❤️‍👨','👩‍❤️‍💋‍👨'],
    'Gestures': ['👍','👎','👊','✊','🤛','🤜','🤞','✌️','🤟','🤘','👌','🤏','👈','👉','👆','👇','☝️','✋','🤚','🖐️','🖖','👋','🤙','💪','🙏','👏','🙌','🤝','🫶'],
    'Celebration': ['🎉','🎊','🎈','🎁','🎂','🍾','🥂','✨','🌟','💫','🔥','💯','🏆','🥳','🎆','🎇','🪅','🎀'],
  };
  const EMOJI_KEYWORDS = {
    love:['❤️','😍','🥰','💕','💖','😘'], heart:['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔'],
    happy:['😀','😄','😊','🥳'], sad:['😢','😭','😞','😔'], laugh:['😂','🤣','😆'],
    angry:['😠','😡','😤'], kiss:['😘','😙','😚','💋'], hug:['🤗','🫂'], fire:['🔥'],
    party:['🎉','🎊','🥳','🎈'], cake:['🎂','🍰'], ring:['💍'], star:['🌟','✨','⭐'],
    thumbsup:['👍'], clap:['👏'], pray:['🙏'], think:['🤔'], cry:['😭','😢'],
    cool:['😎'], wink:['😉'], tired:['😴','😪'], sick:['🤒','🤢'], flower:['🌹','💐','🌸'],
  };
  function getRecentEmojis() {
    try { return JSON.parse(localStorage.getItem('chatRecentEmojis') || '[]'); } catch (e) { return []; }
  }
  function pushRecentEmoji(e) {
    try {
      let r = getRecentEmojis().filter(x => x !== e);
      r.unshift(e);
      r = r.slice(0, 24);
      localStorage.setItem('chatRecentEmojis', JSON.stringify(r));
    } catch (err) {}
  }
  let emojiActiveCat = 'Smileys';
  function openEmojiPanel() {
    closeSheet();
    let panel = document.getElementById('chatEmojiPanel');
    if (panel) { panel.classList.add('open'); return; }
    panel = document.createElement('div');
    panel.id = 'chatEmojiPanel';
    panel.className = 'chat-bottom-sheet-overlay open';
    panel.innerHTML = `<div class="chat-bottom-sheet chat-emoji-sheet" style="padding-bottom:4px">
      <div class="chat-sheet-handle"></div>
      <div class="picker-gif-search"><input type="text" id="emojiSearchInput" placeholder="Search emoji (e.g. love, fire, cake)..." oninput="Chat.filterEmoji(this.value)"></div>
      <div class="picker-tabs" id="emojiTabs">
        ${Object.keys(EMOJI_CATEGORIES).map(cat => `<div class="picker-tab${cat === emojiActiveCat ? ' active' : ''}" data-cat="${cat}" onclick="Chat.switchEmojiTab('${cat}')">${cat}</div>`).join('')}
      </div>
      <div class="picker-body" id="emojiBody" style="max-height:260px"></div>
    </div>`;
    panel.onclick = e => { if (e.target === panel) panel.classList.remove('open'); };
    document.body.appendChild(panel);
    renderEmojiGrid(emojiActiveCat);
  }
  function switchEmojiTab(cat) {
    emojiActiveCat = cat;
    document.querySelectorAll('#emojiTabs .picker-tab').forEach(t => t.classList.toggle('active', t.dataset.cat === cat));
    document.getElementById('emojiSearchInput').value = '';
    renderEmojiGrid(cat);
  }
  function renderEmojiGrid(cat) {
    const body = document.getElementById('emojiBody');
    if (!body) return;
    const list = cat === 'Recent' ? getRecentEmojis() : EMOJI_CATEGORIES[cat];
    body.innerHTML = list.length
      ? `<div class="picker-emoji-grid">${list.map(e => `<div class="picker-emoji" onclick="Chat.sendEmojiTap('${e}')">${e}</div>`).join('')}</div>`
      : `<div class="picker-loading">${cat === 'Recent' ? 'No recent emoji yet — send a few!' : 'No emoji here'}</div>`;
  }
  let emojiFilterDebounce;
  function filterEmoji(q) {
    clearTimeout(emojiFilterDebounce);
    emojiFilterDebounce = setTimeout(() => {
      const body = document.getElementById('emojiBody');
      const query = q.trim().toLowerCase();
      if (!query) { renderEmojiGrid(emojiActiveCat); return; }
      let results = [];
      Object.entries(EMOJI_KEYWORDS).forEach(([kw, emojis]) => { if (kw.includes(query)) results.push(...emojis); });
      results = [...new Set(results)];
      body.innerHTML = results.length
        ? `<div class="picker-emoji-grid">${results.map(e => `<div class="picker-emoji" onclick="Chat.sendEmojiTap('${e}')">${e}</div>`).join('')}</div>`
        : `<div class="picker-loading">No matches — try "love", "fire", "cake"...</div>`;
    }, 150);
  }
  function sendEmojiTap(e) { pushRecentEmoji(e); sendEmoji(e); }

  // ─── STICKERS ─────────────────────────────────────────
  const STICKERS = [
    { emoji: '😍', name: 'Adore' }, { emoji: '🥰', name: 'In Love' }, { emoji: '😘', name: 'Kiss' },
    { emoji: '🤗', name: 'Hug' }, { emoji: '😂', name: 'LOL' }, { emoji: '🥺', name: 'Puppy Eyes' },
    { emoji: '😴', name: 'Sleepy' }, { emoji: '🙈', name: 'Shy' }, { emoji: '💃', name: 'Dance' },
    { emoji: '🎉', name: 'Yay!' }, { emoji: '😤', name: 'Grumpy' }, { emoji: '🥳', name: 'Party' },
  ];
  function openStickerPanel() {
    closeSheet();
    let panel = document.getElementById('chatStickerPanel');
    if (panel) { panel.classList.add('open'); return; }
    panel = document.createElement('div');
    panel.id = 'chatStickerPanel';
    panel.className = 'chat-bottom-sheet-overlay open';
    panel.innerHTML = `<div class="chat-bottom-sheet">
      <div class="chat-sheet-handle"></div>
      <div class="picker-sticker-grid">
        ${STICKERS.map(s => `<div class="picker-sticker" onclick="Chat.sendSticker('${s.emoji}','${s.name}')"><div class="picker-sticker-emoji">${s.emoji}</div><div class="picker-sticker-name">${s.name}</div></div>`).join('')}
      </div>
    </div>`;
    panel.onclick = e => { if (e.target === panel) panel.classList.remove('open'); };
    document.body.appendChild(panel);
  }
  function sendSticker(emoji, name) {
    document.getElementById('chatStickerPanel')?.classList.remove('open');
    sendMessage({ type: 'sticker', mediaMeta: { emoji, name } });
  }

  // ─── CONTACT CARD ───────────────────────────────────────
  function sendContactCard() {
    closeSheet();
    const name = (window.S && window.S.myName) || 'Me';
    sendMessage({ type: 'contact', mediaMeta: { name } });
  }
  function openContactCard(name) {
    document.getElementById('chatContactSheet')?.remove();
    const isPartner = name && window.S && name === window.S.partnerName;
    const sheet = document.createElement('div');
    sheet.id = 'chatContactSheet';
    sheet.className = 'chat-sheet-overlay';
    sheet.innerHTML = `<div class="chat-sheet chat-contact-detail">
      <div class="chat-sheet-handle"></div>
      <div class="msg-contact-av" style="width:64px;height:64px;font-size:24px;margin:0 auto 12px">${esc((name||'?')[0])}</div>
      <div style="text-align:center;font-weight:700;font-size:16px;margin-bottom:2px">${esc(name||'Contact')}</div>
      <div style="text-align:center;color:rgba(255,255,255,.5);font-size:12.5px;margin-bottom:18px">Contact card</div>
      ${isPartner ? `
        <div class="ctx-item" onclick="document.getElementById('chatContactSheet').remove();Call.startCall('voice')">🎙️ Voice call</div>
        <div class="ctx-item" onclick="document.getElementById('chatContactSheet').remove();Call.startCall('video')">📹 Video call</div>
      ` : `<div class="ctx-item" style="opacity:.6;cursor:default">This contact isn't linked to a call</div>`}
      <div class="ctx-item" onclick="document.getElementById('chatContactSheet').remove()">Close</div>
    </div>`;
    sheet.onclick = e => { if (e.target === sheet) sheet.remove(); };
    document.body.appendChild(sheet);
  }

  // ─── MEMORIES (routes to the existing Camera/Memories page) ──
  function openMemories() {
    closeSheet();
    if (typeof window.goto === 'function') window.goto('camera');
    else toast('Open Memories from the menu 📔');
  }

  // ─── POLLS (lightweight — no schema/backend changes; stored in mediaMeta) ──
  function openPollComposer() {
    closeSheet();
    let panel = document.getElementById('chatPollPanel');
    if (panel) { panel.remove(); }
    panel = document.createElement('div');
    panel.id = 'chatPollPanel';
    panel.className = 'chat-bottom-sheet-overlay open';
    panel.innerHTML = `<div class="chat-bottom-sheet">
      <div class="chat-sheet-handle"></div>
      <div style="padding:4px 4px 10px;font-size:14px;font-weight:700;color:var(--white)">📊 Create a Poll</div>
      <input type="text" id="pollQuestion" placeholder="Ask a question..." style="width:100%;padding:10px 14px;border-radius:14px;border:1px solid var(--border);background:rgba(255,255,255,.05);color:#fff;margin-bottom:8px">
      <input type="text" id="pollOpt1" placeholder="Option 1" style="width:100%;padding:9px 14px;border-radius:12px;border:1px solid var(--border);background:rgba(255,255,255,.05);color:#fff;margin-bottom:8px">
      <input type="text" id="pollOpt2" placeholder="Option 2" style="width:100%;padding:9px 14px;border-radius:12px;border:1px solid var(--border);background:rgba(255,255,255,.05);color:#fff;margin-bottom:8px">
      <input type="text" id="pollOpt3" placeholder="Option 3 (optional)" style="width:100%;padding:9px 14px;border-radius:12px;border:1px solid var(--border);background:rgba(255,255,255,.05);color:#fff;margin-bottom:12px">
      <button class="chat-sheet-item" style="background:var(--accent);border-radius:12px;font-weight:700" onclick="Chat.submitPoll()">Send Poll</button>
    </div>`;
    panel.onclick = e => { if (e.target === panel) panel.remove(); };
    document.body.appendChild(panel);
  }
  function submitPoll() {
    const q = document.getElementById('pollQuestion')?.value.trim();
    const opts = [document.getElementById('pollOpt1')?.value.trim(), document.getElementById('pollOpt2')?.value.trim(), document.getElementById('pollOpt3')?.value.trim()].filter(Boolean);
    if (!q || opts.length < 2) { toast('Add a question and at least 2 options'); return; }
    document.getElementById('chatPollPanel')?.remove();
    sendMessage({ type: 'poll', text: q, mediaMeta: { options: opts } });
  }
  function votePoll(msgId, option) {
    sendMessage({ type: 'text', text: `🗳️ Voted "${option}"`, replyTo: msgId });
  }

  async function openGifPanel() {
    closeSheet();
    let panel = document.getElementById('chatGifPanel');
    if (panel) { panel.classList.add('open'); return; }
    panel = document.createElement('div');
    panel.id = 'chatGifPanel';
    panel.className = 'chat-bottom-sheet-overlay open';
    panel.innerHTML = `<div class="chat-bottom-sheet chat-gif-sheet">
      <div class="chat-sheet-handle"></div>
      <input type="text" id="gifSearchInput" placeholder="Search GIFs..." oninput="Chat.searchGifs(this.value)">
      <div id="gifResults" class="chat-gif-grid"><div class="empty">Type to search</div></div>
    </div>`;
    panel.onclick = e => { if (e.target === panel) panel.classList.remove('open'); };
    document.body.appendChild(panel);
    searchGifs('love');
  }
  let gifDebounce;
  function searchGifs(q) {
    clearTimeout(gifDebounce);
    gifDebounce = setTimeout(async () => {
      const el = document.getElementById('gifResults');
      el.innerHTML = '<div class="empty">Loading...</div>';
      try {
        // Tenor's public API was fully shut down by Google on June 30, 2026 —
        // that's why GIF search returned nothing no matter what you typed.
        // Switched to Giphy, using their long-standing public dev key (rate-limited
        // to 100 req/hr but needs no signup). Get your own free key at
        // https://developers.giphy.com for production use — swap it in below.
        const key = 'dc6zaTOxFJmzC';
        const r = await fetch(`https://api.giphy.com/v1/gifs/search?q=${encodeURIComponent(q||'love')}&api_key=${key}&limit=24&rating=pg-13`);
        const data = await r.json();
        const results = data.data || [];
        if (!results.length) { el.innerHTML = '<div class="empty">No GIFs found</div>'; return; }
        el.innerHTML = results
          .map(g => g.images?.fixed_height_small?.url || g.images?.fixed_height?.url || g.images?.downsized?.url)
          .filter(url => !!url)
          .map(url => `<img src="${esc(url)}" loading="lazy" onclick="Chat.sendGif('${esc(url)}')">`)
          .join('') || '<div class="empty">No GIFs found</div>';
      } catch (e) { el.innerHTML = '<div class="empty">GIF search failed — check connection</div>'; }
    }, 400);
  }
  // ─── SWIPE TO REPLY (WhatsApp-style) ──────────────────
  let swipeState = null;
  const SWIPE_TRIGGER = 64, SWIPE_MAX = 84;
  // Rubber-band curve: raw finger travel maps 1:1 up to SWIPE_TRIGGER, then
  // asymptotically approaches SWIPE_MAX rather than hard-clamping — gives
  // the "elastic resistance" feel instead of the finger hitting a wall.
  function swipeElastic(raw) {
    if (raw <= SWIPE_TRIGGER) return raw;
    const over = raw - SWIPE_TRIGGER;
    const room = SWIPE_MAX - SWIPE_TRIGGER;
    return SWIPE_TRIGGER + room * (1 - Math.exp(-over / (room * 1.6)));
  }
  function initSwipeToReply() {
    const box = document.getElementById('chatMsgs');
    if (!box || box._swipeInit) return;
    box._swipeInit = true;
    box.addEventListener('touchstart', onSwipeStart, { passive: true });
    box.addEventListener('touchmove', onSwipeMove, { passive: false });
    box.addEventListener('touchend', onSwipeEnd, { passive: true });
    box.addEventListener('touchcancel', onSwipeEnd, { passive: true });
    // Mouse support for desktop testing
    box.addEventListener('mousedown', onSwipeStart);
    box.addEventListener('mousemove', onSwipeMove);
    window.addEventListener('mouseup', onSwipeEnd);
  }
  function swipePoint(e) { return e.touches ? e.touches[0] : e; }
  function onSwipeStart(e) {
    const row = e.target.closest && e.target.closest('.chat-row');
    if (!row || e.target.closest('.chat-swipe-reply-icon')) return;
    const p = swipePoint(e);
    swipeState = { row, startX: p.clientX, startY: p.clientY, dx: 0, locked: null, id: row.dataset.id, crossed: false };
    // Bubble may still be mid-bounce-back from a previous swipe on this row;
    // clear any leftover transition so the new drag follows the finger
    // immediately instead of easing from the old position.
    const bubble = row.querySelector('.chat-bubble');
    if (bubble) bubble.style.transition = '';
  }
  function onSwipeMove(e) {
    if (!swipeState) return;
    const p = swipePoint(e);
    const rawDx = p.clientX - swipeState.startX;
    const dy = p.clientY - swipeState.startY;
    if (swipeState.locked === null) {
      if (Math.abs(rawDx) < 8 && Math.abs(dy) < 8) return;
      swipeState.locked = Math.abs(rawDx) > Math.abs(dy);
      if (swipeState.locked) endLongPress();
    }
    if (!swipeState.locked) { swipeState = null; return; }
    // Only swipe rightward, like WhatsApp; elastic curve softens the approach
    // to SWIPE_MAX instead of a hard clamp.
    swipeState.dx = rawDx <= 0 ? 0 : swipeElastic(rawDx);
    if (e.cancelable) e.preventDefault();
    const bubble = swipeState.row.querySelector('.chat-bubble');
    const icon = swipeState.row.querySelector('.chat-swipe-reply-icon');
    if (bubble) bubble.style.transform = `translateX(${swipeState.dx}px)`;
    if (icon) {
      const p2 = Math.min(1, swipeState.dx / SWIPE_TRIGGER);
      icon.style.opacity = p2;
      icon.style.transform = `translateX(${-8 + swipeState.dx * 0.3}px) scale(${0.7 + p2 * 0.3})`;
      // Telegram-style "armed" state: icon fills solid accent and its own
      // scale gets a tiny extra pop right when the drag crosses the
      // trigger, so the finger gets a clear "this will fire" signal
      // before release, not just a haptic buzz.
      icon.classList.toggle('armed', swipeState.dx >= SWIPE_TRIGGER);
    }
    // Light haptic tick the instant the drag crosses the trigger threshold —
    // mirrors WhatsApp's "armed" feedback, not just a buzz on release.
    const nowCrossed = swipeState.dx >= SWIPE_TRIGGER;
    if (nowCrossed && !swipeState.crossed && navigator.vibrate) navigator.vibrate(12);
    swipeState.crossed = nowCrossed;
  }
  function onSwipeEnd() {
    if (!swipeState) return;
    const { row, dx, id, crossed } = swipeState;
    const bubble = row.querySelector('.chat-bubble');
    const icon = row.querySelector('.chat-swipe-reply-icon');
    // Spring-style bounce back (slight overshoot, then settle) instead of a
    // linear ease — reads as an elastic release rather than a hard snap.
    const bounce = 'transform .32s cubic-bezier(0.34, 1.56, 0.64, 1)';
    if (bubble) { bubble.style.transition = bounce; bubble.style.transform = 'translateX(0)'; setTimeout(() => { if (bubble) bubble.style.transition = ''; }, 340); }
    if (icon) { icon.style.transition = 'opacity .2s ease, transform .2s ease'; icon.style.opacity = 0; icon.style.transform = ''; icon.classList.remove('armed'); setTimeout(() => { if (icon) icon.style.transition = ''; }, 220); }
    if (dx >= SWIPE_TRIGGER) {
      if (navigator.vibrate && !crossed) navigator.vibrate(25); // fallback if the crossing tick above didn't fire
      replyTo(id);
    }
    swipeState = null;
  }

  // ─── REALTIME (instant delivery + instant tick updates) ─
  // Supabase Realtime push replaces the wait for the next poll tick.
  // The 2.5s poll (startPolling, above) stays on as a fallback safety
  // net — if the socket ever drops, messages/read-receipts still
  // arrive within one poll cycle instead of being lost.
  let realtimeChannel = null;
  let _chatSb = null;
  function _getChatSupabase() {
    if (_chatSb) return _chatSb;
    if (window.__SHARED_SB__) { _chatSb = window.__SHARED_SB__; return _chatSb; }
    if (!window.supabase || !window.supabase.createClient) return null;
    if (!window.__SUPABASE_URL__ || !window.__SUPABASE_ANON_KEY__) return null;
    try { _chatSb = window.supabase.createClient(window.__SUPABASE_URL__, window.__SUPABASE_ANON_KEY__); }
    catch (e) { console.warn('Chat Supabase init failed', e); }
    return _chatSb;
  }
  function startRealtime() {
    if (realtimeChannel) return; // already subscribed
    if (!coupleId()) return;
    const sb = _getChatSupabase();
    if (!sb) return; // SDK not loaded / no client creds exposed — poll-only
    try {
      realtimeChannel = sb.channel('chat-' + coupleId())
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'chat_messages',
          filter: 'couple_id=eq.' + coupleId()
        }, (payload) => {
          const r = payload.new;
          if (!r) return;
          const idx = msgs.findIndex(m => m.id === r.id || (r.client_id && m.client_id === r.client_id));
          if (idx > -1) msgs[idx] = r; else msgs.push(r);
          // A late/out-of-order push can insert an older row after a newer
          // one — keep the working array sorted so render(), lastMsgTs, and
          // "last received message" all agree on what's actually newest.
          msgs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
          if (r.created_at && (!lastMsgTs || r.created_at > lastMsgTs)) lastMsgTs = r.created_at;
          render();
          const box = document.getElementById('chatMsgs');
          const nearBottom = box && (box.scrollHeight - box.scrollTop - box.clientHeight < 150);
          if (nearBottom || isMine(r)) { scrollToBottom(true); reanchorAfterImages(); }
          if (!isMine(r) && chatBottomInView()) {
            markRead();
          } else if (!isMine(r)) {
            syncAppBadge(msgs.filter(m => !isMine(m) && !m.read).length);
          }
        })
        .on('broadcast', { event: 'typing' }, (msg) => handleTypingBroadcast(msg.payload))
        .on('broadcast', { event: 'message_status' }, (msg) => {
          // Delivered/read status pushed directly from the server
          // (routes/chat.js broadcastEvent calls) over Realtime Broadcast.
          // This does NOT depend on chat_messages' Postgres replication
          // publication settings in the Supabase dashboard — unlike the
          // postgres_changes subscription below, Broadcast-over-HTTP always
          // fires, so delivered ticks and blue read ticks now update
          // instantly even if that dashboard setting is misconfigured.
          const p = msg.payload || {};
          const ids = p.ids || (p.id != null ? [p.id] : []);
          if (!ids.length) return;
          let changed = false;
          ids.forEach(id => {
            const idx = msgs.findIndex(m => m.id === id);
            if (idx === -1) return;
            if (p.delivered) { msgs[idx].delivered = true; msgs[idx].delivered_at = p.delivered_at || msgs[idx].delivered_at; changed = true; }
            if (p.read) { msgs[idx].read = true; msgs[idx].read_at = p.read_at || msgs[idx].read_at; changed = true; }
          });
          if (changed) render();
        })
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'chat_wallpaper',
          filter: 'couple_id=eq.' + coupleId()
        }, (payload) => {
          const row = payload.new;
          if (!row || !isWpShared()) return;
          // The partner just changed the shared wallpaper — apply it
          // immediately, no refresh, exactly like a new chat message.
          setSharedWpCache(row);
          applyWallpaper();
          if (document.getElementById('wpModalOverlay')?.classList.contains('open')) renderWpSwatches();
        })
        .subscribe((status) => {
          console.log('[Chat realtime]', status);
          if (status === 'SUBSCRIBED') {
            // Supabase Realtime does NOT backfill events missed while the
            // socket was down (backgrounded tab, dropped connection, cold
            // start) — it only pushes what happens *after* SUBSCRIBED fires.
            // Without this, reconnecting silently loses any message sent
            // during the gap until the next slow background poll catches up.
            pollNew();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            // Drop the dead channel and let the next trigger (poll tick,
            // visibility change, or manual retry) re-establish it — retrying
            // immediately here on every blip would spam reconnect attempts.
            try { sb.removeChannel(realtimeChannel); } catch (e) {}
            realtimeChannel = null;
            setTimeout(() => { if (!document.hidden) startRealtime(); }, 2000);
          }
        });
    } catch (e) { realtimeChannel = null; }
  }

  // ─── INIT ────────────────────────────────────────────
  function init() {
    if (!coupleId()) { setTimeout(init, 1000); return; }
    loadMessages();
    startPresence();
    startPolling();
    startRealtime();
    fetchPresence();
    initSwipeToReply();
    setStaticScreenHeight();
    initViewportKeyboardFix();
    initComposerResizeObserver();
    const nameEl = document.getElementById('chatHeaderNameText');
    if (nameEl) nameEl.textContent = window.S.partnerName || 'Partner';
    // Routed through the shared Avatar/ProfileStore system (public/js/avatar-system.js)
    // instead of manually writing an initial letter — this is what actually
    // gives the header photo a real image, square 1:1 cropping, and a tap
    // handler that opens the profile preview (name/status/pinch-zoom).
    if (window.Avatar) {
      Avatar.mount('chatHeaderAv', { owner: 'partner', size: 40, editable: false });
    } else {
      const avEl = document.getElementById('chatHeaderAv');
      if (avEl) avEl.textContent = (window.S.partnerName || 'P')[0];
    }
    // No standalone fetchPresence interval here — pollNew() already calls
    // fetchPresence() on every tick (2.5s on the chat page, ~20s elsewhere,
    // paused when backgrounded), so a separate 15s timer was pure duplication.
    applyWallpaper();
    if (isWpShared()) pullSharedWallpaper().then(applyWallpaper);
    initKeyboardFocusFix();
    initTheme();
    initHeaderRing();
    initMute();
    initNickname();
  }

  // ─── CLEAR CHAT (delete-for-me, everyone in one action) ──────────
  // Reuses the existing per-message "delete for me" path (deleteMsg with
  // mode 'me') for every visible message, so it obeys exactly the same
  // rules as deleting one at a time — nothing removed for your partner,
  // just cleared from your own view.
  function clearChat() {
    confirmDelete({
      title: 'Clear chat?',
      itemType: 'chat',
      message: 'Every message will be removed from your view only — your partner will still see the full conversation.',
      destructiveLabel: 'Clear Chat',
      onConfirm: async () => {
        const visible = msgs.filter(m => !(m.deleted_for || '').split(',').includes(myRole()));
        for (const m of visible) { await deleteMsg(m.id, 'me'); }
        toast && toast('Chat cleared');
      }
    });
  }

  // ─── MUTE NOTIFICATIONS (this chat, this device) ──────────────────
  // Client-side only — suppresses the in-app "new message" toast/badge
  // bump for this couple's chat while muted. Doesn't touch OS push
  // delivery (that's server/service-worker driven and out of scope for
  // a page-level toggle), so muted still means "won't interrupt you
  // while the app's open," same as WhatsApp's in-chat mute baseline.
  function muteKey() { return 'chat_muted_' + coupleId(); }
  function isMuted() { return localStorage.getItem(muteKey()) === '1'; }
  function initMute() { updateMuteUI(); }
  function toggleMute() {
    localStorage.setItem(muteKey(), isMuted() ? '0' : '1');
    updateMuteUI();
  }
  function updateMuteUI() {
    const sw = document.getElementById('chatMuteSwitch');
    if (sw) sw.classList.toggle('on', isMuted());
    const label = document.getElementById('chatMuteLabel');
    if (label) label.textContent = isMuted() ? 'Muted' : 'Mute notifications';
    const bell = document.getElementById('chatHeaderMuteBell');
    if (bell) bell.style.display = isMuted() ? 'inline' : 'none';
  }

  // ─── PARTNER NICKNAME (local pet name, header display only) ───────
  // Purely cosmetic and local to this device — overrides only what the
  // chat HEADER shows for your partner's name; never sent anywhere, never
  // changes their actual profile name, and each of you can set your own
  // without the other seeing or being affected.
  function nicknameKey() { return 'chat_nickname_' + coupleId(); }
  function initNickname() { applyNickname(); }
  function applyNickname() {
    const saved = localStorage.getItem(nicknameKey());
    const nameEl = document.getElementById('chatHeaderNameText');
    if (nameEl && saved) nameEl.textContent = saved;
  }
  function promptNickname() {
    const cur = localStorage.getItem(nicknameKey()) || '';
    const next = window.prompt('Pet name for ' + (window.S.partnerName || 'your partner') + ' (only you see this):', cur);
    if (next === null) return; // cancelled
    const trimmed = next.trim();
    if (trimmed) localStorage.setItem(nicknameKey(), trimmed); else localStorage.removeItem(nicknameKey());
    applyNickname();
    if (!trimmed) { const nameEl = document.getElementById('chatHeaderNameText'); if (nameEl) nameEl.textContent = window.S.partnerName || 'Partner'; }
  }

  // ─── THEME TOGGLE (chat page only) ───────────────────────
  // Persists to localStorage so it's remembered next visit; only ever
  // touches #page-chat's data-theme attribute — see the scoped CSS
  // overrides in chat.css (#page-chat[data-theme="light"]...).
  function initTheme() {
    const page = document.getElementById('page-chat');
    if (!page) return;
    const saved = localStorage.getItem('chat_theme') || 'dark';
    page.setAttribute('data-theme', saved);
    updateThemeSwitchUI(saved);
  }
  function toggleTheme() {
    const page = document.getElementById('page-chat');
    if (!page) return;
    const next = page.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    page.setAttribute('data-theme', next);
    localStorage.setItem('chat_theme', next);
    updateThemeSwitchUI(next);
  }
  function updateThemeSwitchUI(mode) {
    const sw = document.getElementById('chatThemeSwitch');
    if (sw) sw.classList.toggle('on', mode === 'light');
    const label = document.getElementById('chatThemeLabel');
    if (label) label.textContent = mode === 'light' ? 'Light mode' : 'Dark mode';
  }

  // ─── HEADER AVATAR "RING" ─────────────────────────────────
  // Not a fabricated Stories feature — it's a real, honest signal: the
  // Instagram-style gradient ring lights up on the header avatar only
  // when the partner has shared a photo/GIF you haven't opened yet
  // (checked against a locally-remembered "last seen" timestamp).
  // Tapping the avatar clears it, same as opening someone's story.
  function initHeaderRing() { updateHeaderRing(); }
  function updateHeaderRing() {
    const av = document.getElementById('chatHeaderAv');
    if (!av) return;
    const lastSeen = Number(localStorage.getItem('chat_ring_seen_ts') || 0);
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const hasUnseenMedia = msgs.some(m =>
      !m.deleted && !isMine(m) && (m.type === 'image' || m.type === 'gif') &&
      new Date(m.created_at).getTime() > Math.max(lastSeen, dayAgo));
    av.classList.toggle('has-ring', hasUnseenMedia);
    let dot = av.querySelector('.status-dot');
    if (!dot) { dot = document.createElement('div'); dot.className = 'status-dot'; av.appendChild(dot); }
    const st = presenceStatusFor(otherRole());
    dot.classList.toggle('online', !!(st && st.online));
    if (!av._ringWired) {
      av._ringWired = true;
      av.addEventListener('click', () => {
        localStorage.setItem('chat_ring_seen_ts', String(Date.now()));
        av.classList.remove('has-ring');
        openMediaGrid();
      });
    }
  }
  document.addEventListener('DOMContentLoaded', () => setTimeout(init, 500));

  // ══════════════════════════════════════════════════════════════
  // CHAT HEADER — 3-DOT MENU
  // ══════════════════════════════════════════════════════════════
  let _headerMenuOutsideBound = false;
  function toggleHeaderMenu(ev) {
    if (ev) ev.stopPropagation();
    const menu = document.getElementById('chatHeaderMenu');
    const btn = document.getElementById('chatMoreMenuBtn');
    if (!menu) return;
    const willOpen = !menu.classList.contains('open');
    menu.classList.toggle('open', willOpen);
    if (btn) btn.setAttribute('aria-expanded', String(willOpen));
    if (willOpen && !_headerMenuOutsideBound) {
      _headerMenuOutsideBound = true;
      document.addEventListener('click', function onDocClick(e) {
        const m = document.getElementById('chatHeaderMenu');
        if (m && !m.contains(e.target) && e.target.id !== 'chatMoreMenuBtn') {
          m.classList.remove('open');
          const b = document.getElementById('chatMoreMenuBtn');
          if (b) b.setAttribute('aria-expanded', 'false');
        }
      });
    }
  }

  // ══════════════════════════════════════════════════════════════
  // CHAT WALLPAPER
  // Device-local setting stored per couple+role: the actual image
  // lives in IndexedDB (never localStorage — a base64 photo string
  // there would be several MB and blow past storage quotas/limits),
  // while the small preferences (mode, dimming %) live in localStorage
  // since they're only a few bytes. This is intentionally device-local
  // rather than synced through Supabase — no schema change needed for
  // a per-device UI preference like this.
  // ══════════════════════════════════════════════════════════════
  const WP_DB_NAME = 'uwl_wallpaper_db';
  const WP_STORE = 'wallpapers';
  const WP_SETTINGS_KEY = 'uwl_wallpaper_settings_v1';
  const WP_SWATCHES = [
    { id: 'midnight', css: 'linear-gradient(160deg,#0b0b0f,#1b1420 60%,#241018)' },
    { id: 'noir', css: 'linear-gradient(160deg,#000,#161616)' },
    { id: 'wine', css: 'linear-gradient(160deg,#150507,#2a0d12 55%,#120406)' },
    { id: 'slate', css: 'linear-gradient(160deg,#0d1014,#1a1f26)' }
  ];
  let _wpDbPromise = null;

  function wpKey() {
    // Shared mode uses one key for the whole couple (both devices read the
    // same cached blob/settings); personal mode keeps the original
    // per-role isolation so each partner's local choice never leaks to
    // the other's device.
    return isWpShared() ? (coupleId() || 'anon') + '_shared' : (coupleId() || 'anon') + '_' + (myRole() || 'u');
  }
  const WP_SHARED_FLAG_KEY = 'uwl_wallpaper_shared_v1';
  function isWpShared() {
    // Shared is the default (spec: setting a wallpaper should sync to your
    // partner unless you deliberately opt out) — so an unset flag reads as
    // "on", and only an explicit '0' (user toggled it off) reads as "off".
    try { return localStorage.getItem(WP_SHARED_FLAG_KEY + '_' + (coupleId() || '')) !== '0'; } catch (e) { return true; }
  }
  function setWpShared(on) {
    try { localStorage.setItem(WP_SHARED_FLAG_KEY + '_' + (coupleId() || ''), on ? '1' : '0'); } catch (e) {}
  }
  async function toggleWallpaperShared() {
    const next = !isWpShared();
    setWpShared(next);
    const state = document.getElementById('wpSharedToggleState');
    if (state) state.textContent = next ? 'On' : 'Off';
    if (next) {
      // Switching on: pull whatever's already saved for the couple (if the
      // partner set one previously) rather than silently keeping whatever
      // was showing from personal mode.
      await pullSharedWallpaper();
    }
    await applyWallpaper();
  }

  function openWpDb() {
    if (_wpDbPromise) return _wpDbPromise;
    _wpDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(WP_DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(WP_STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return _wpDbPromise;
  }
  async function wpIdbSet(key, blob) {
    const db = await openWpDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(WP_STORE, 'readwrite');
      tx.objectStore(WP_STORE).put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function wpIdbGet(key) {
    const db = await openWpDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(WP_STORE, 'readonly');
      const req = tx.objectStore(WP_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }
  async function wpIdbDelete(key) {
    const db = await openWpDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(WP_STORE, 'readwrite');
      tx.objectStore(WP_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function loadWpSettings() {
    try { return JSON.parse(localStorage.getItem(WP_SETTINGS_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveWpSettings(all) {
    try { localStorage.setItem(WP_SETTINGS_KEY, JSON.stringify(all)); } catch (e) {}
  }
  function getWpSetting() {
    const all = loadWpSettings();
    return all[wpKey()] || { mode: 'default', dim: 0, swatch: null };
  }
  function setWpSetting(patch) {
    const all = loadWpSettings();
    all[wpKey()] = Object.assign({}, all[wpKey()] || { mode: 'default', dim: 0, swatch: null }, patch);
    saveWpSettings(all);
    return all[wpKey()];
  }

  let _sharedWpCache = null;
  function sharedWpCacheKey() { return 'uwl_wallpaper_shared_cache_' + (coupleId() || ''); }
  function getSharedWpCache() {
    if (_sharedWpCache) return _sharedWpCache;
    try { _sharedWpCache = JSON.parse(localStorage.getItem(sharedWpCacheKey()) || 'null'); } catch (e) { _sharedWpCache = null; }
    return _sharedWpCache || { mode: 'default', dim: 0, swatch: null, image_url: null };
  }
  function setSharedWpCache(row) {
    _sharedWpCache = row;
    try { localStorage.setItem(sharedWpCacheKey(), JSON.stringify(row)); } catch (e) {}
  }
  async function pullSharedWallpaper() {
    if (!coupleId()) return getSharedWpCache();
    try {
      const row = await api('GET', '/api/chat/' + coupleId() + '/wallpaper');
      if (row) setSharedWpCache(row);
    } catch (e) { /* keep last-known cache, e.g. offline */ }
    return getSharedWpCache();
  }
  async function pushSharedWallpaper(patch) {
    const merged = Object.assign({}, getSharedWpCache(), patch);
    setSharedWpCache(merged); // optimistic, so this device updates instantly too
    if (!coupleId()) return merged;
    try {
      const saved = await api('POST', '/api/chat/' + coupleId() + '/wallpaper',
        { mode: merged.mode, swatch: merged.swatch, image_url: merged.image_url, dim: merged.dim, role: myRole() });
      setSharedWpCache(saved);
      return saved;
    } catch (e) { toast('Could not sync wallpaper — will retry'); return merged; }
  }

  let _wpObjectUrl = null;
  async function applyWallpaper() {
    const layer = document.getElementById('chatWallpaperLayer');
    const dimEl = document.getElementById('chatWallpaperDim');
    if (!layer || !dimEl) return;
    const shared = isWpShared();
    const s = shared ? getSharedWpCache() : getWpSetting();
    dimEl.style.opacity = String((s.dim || 0) / 100);
    if (_wpObjectUrl) { URL.revokeObjectURL(_wpObjectUrl); _wpObjectUrl = null; }
    if (s.mode === 'custom') {
      if (shared) {
        if (s.image_url) { layer.style.backgroundImage = `url("${s.image_url}")`; return; }
      } else {
        try {
          const blob = await wpIdbGet(wpKey());
          if (blob) {
            _wpObjectUrl = URL.createObjectURL(blob);
            layer.style.backgroundImage = `url("${_wpObjectUrl}")`;
            return;
          }
        } catch (e) { /* fall through to default */ }
      }
    }
    if (s.mode === 'swatch' && s.swatch) {
      const sw = WP_SWATCHES.find(x => x.id === s.swatch);
      layer.style.backgroundImage = sw ? sw.css : '';
      return;
    }
    // default — restore the app's normal (transparent) chat background
    layer.style.backgroundImage = '';
  }

  function renderWpSwatches() {
    const box = document.getElementById('wpSwatches');
    if (!box) return;
    const s = isWpShared() ? getSharedWpCache() : getWpSetting();
    box.innerHTML = WP_SWATCHES.map(sw =>
      `<div class="wp-swatch${s.mode === 'swatch' && s.swatch === sw.id ? ' active' : ''}" style="background-image:${sw.css}" onclick="Chat.selectWpSwatch('${sw.id}')"></div>`
    ).join('');
  }
  function selectWpSwatch(id) {
    if (isWpShared()) { pushSharedWallpaper({ mode: 'swatch', swatch: id }); }
    else { setWpSetting({ mode: 'swatch', swatch: id }); }
    applyWallpaper();
    renderWpSwatches();
  }

  function openWallpaperModal() {
    document.getElementById('chatHeaderMenu')?.classList.remove('open');
    const shared = isWpShared();
    const s = shared ? getSharedWpCache() : getWpSetting();
    const slider = document.getElementById('wpDimSlider');
    const val = document.getElementById('wpDimVal');
    if (slider) slider.value = s.dim || 0;
    if (val) val.textContent = (s.dim || 0) + '%';
    const toggleState = document.getElementById('wpSharedToggleState');
    if (toggleState) toggleState.textContent = shared ? 'On' : 'Off';
    renderWpSwatches();
    document.getElementById('wpModalOverlay')?.classList.add('open');
    if (shared) pullSharedWallpaper().then(() => { applyWallpaper(); renderWpSwatches(); });
  }
  function closeWallpaperModal() {
    document.getElementById('wpModalOverlay')?.classList.remove('open');
  }
  function onDimSlider(val) {
    const v = Number(val) || 0;
    document.getElementById('wpDimVal').textContent = v + '%';
    document.getElementById('chatWallpaperDim').style.opacity = String(v / 100);
    if (isWpShared()) { pushSharedWallpaper({ dim: v }); } else { setWpSetting({ dim: v }); }
  }
  function setDefaultWallpaper() {
    if (isWpShared()) { pushSharedWallpaper({ mode: 'default', swatch: null, image_url: null }); }
    else { setWpSetting({ mode: 'default', swatch: null }); }
    applyWallpaper();
    renderWpSwatches();
    toast('Default wallpaper restored');
  }
  async function removeWallpaper() {
    if (isWpShared()) {
      await pushSharedWallpaper({ mode: 'default', swatch: null, image_url: null });
    } else {
      try { await wpIdbDelete(wpKey()); } catch (e) {}
      setWpSetting({ mode: 'default', swatch: null });
    }
    applyWallpaper();
    renderWpSwatches();
    toast('Wallpaper removed');
  }

  // ── Crop/adjust engine (Android "move and scale" style) ──
  // The user drags to pan and pinches (or scrolls) to zoom a full-res image
  // inside a viewport-sized stage; only the final visible crop is rendered
  // to a canvas and saved, so what they see is exactly what gets set.
  let _wpCropUrl = null;
  const wpCrop = {
    natW: 0, natH: 0, viewW: 0, viewH: 0,
    scale: 1, minScale: 1, maxScale: 1, x: 0, y: 0,
    pointers: new Map(), pinchStartDist: 0, pinchStartScale: 1, pinchMidX: 0, pinchMidY: 0,
    lastX: 0, lastY: 0, bound: false
  };

  function wpCropClamp() {
    wpCrop.scale = Math.min(wpCrop.maxScale, Math.max(wpCrop.minScale, wpCrop.scale));
    const w = wpCrop.natW * wpCrop.scale, h = wpCrop.natH * wpCrop.scale;
    const minX = Math.min(0, wpCrop.viewW - w), minY = Math.min(0, wpCrop.viewH - h);
    wpCrop.x = Math.max(minX, Math.min(0, wpCrop.x));
    wpCrop.y = Math.max(minY, Math.min(0, wpCrop.y));
  }
  function wpCropRender() {
    const img = document.getElementById('wpCropImg');
    if (img) img.style.transform = `translate(${wpCrop.x}px, ${wpCrop.y}px) scale(${wpCrop.scale})`;
  }
  function wpCropFadeHint() {
    const hint = document.getElementById('wpCropHint');
    if (hint) hint.classList.add('faded');
  }
  function wpCropDist(p1, p2) { return Math.hypot(p1.x - p2.x, p1.y - p2.y); }

  function wpCropOnPointerDown(e) {
    const stage = document.getElementById('wpCropStage');
    stage.setPointerCapture(e.pointerId);
    wpCrop.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stage.classList.add('dragging');
    wpCropFadeHint();
    if (wpCrop.pointers.size === 1) {
      wpCrop.lastX = e.clientX; wpCrop.lastY = e.clientY;
    } else if (wpCrop.pointers.size === 2) {
      const pts = [...wpCrop.pointers.values()];
      wpCrop.pinchStartDist = wpCropDist(pts[0], pts[1]);
      wpCrop.pinchStartScale = wpCrop.scale;
      const stageRect = stage.getBoundingClientRect();
      wpCrop.pinchMidX = (pts[0].x + pts[1].x) / 2 - stageRect.left;
      wpCrop.pinchMidY = (pts[0].y + pts[1].y) / 2 - stageRect.top;
    }
  }
  function wpCropOnPointerMove(e) {
    if (!wpCrop.pointers.has(e.pointerId)) return;
    wpCrop.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (wpCrop.pointers.size === 1) {
      const dx = e.clientX - wpCrop.lastX, dy = e.clientY - wpCrop.lastY;
      wpCrop.lastX = e.clientX; wpCrop.lastY = e.clientY;
      wpCrop.x += dx; wpCrop.y += dy;
      wpCropClamp(); wpCropRender();
    } else if (wpCrop.pointers.size === 2) {
      const pts = [...wpCrop.pointers.values()];
      const dist = wpCropDist(pts[0], pts[1]);
      if (wpCrop.pinchStartDist > 0) {
        const ratio = dist / wpCrop.pinchStartDist;
        const newScale = Math.min(wpCrop.maxScale, Math.max(wpCrop.minScale, wpCrop.pinchStartScale * ratio));
        // Zoom anchored at the pinch midpoint so the point under the fingers stays put.
        wpCrop.x = wpCrop.pinchMidX - (wpCrop.pinchMidX - wpCrop.x) * (newScale / wpCrop.scale);
        wpCrop.y = wpCrop.pinchMidY - (wpCrop.pinchMidY - wpCrop.y) * (newScale / wpCrop.scale);
        wpCrop.scale = newScale;
        wpCropClamp(); wpCropRender();
      }
    }
  }
  function wpCropOnPointerUp(e) {
    wpCrop.pointers.delete(e.pointerId);
    const stage = document.getElementById('wpCropStage');
    if (stage) {
      if (wpCrop.pointers.size === 0) stage.classList.remove('dragging');
      if (wpCrop.pointers.size === 1) {
        const [p] = [...wpCrop.pointers.values()];
        wpCrop.lastX = p.x; wpCrop.lastY = p.y;
      }
    }
  }
  function wpCropOnWheel(e) {
    e.preventDefault();
    const stage = document.getElementById('wpCropStage');
    const rect = stage.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const factor = Math.pow(1.0015, -e.deltaY);
    const newScale = Math.min(wpCrop.maxScale, Math.max(wpCrop.minScale, wpCrop.scale * factor));
    wpCrop.x = mx - (mx - wpCrop.x) * (newScale / wpCrop.scale);
    wpCrop.y = my - (my - wpCrop.y) * (newScale / wpCrop.scale);
    wpCrop.scale = newScale;
    wpCropClamp(); wpCropRender();
    wpCropFadeHint();
  }
  function wpCropBindStage() {
    const stage = document.getElementById('wpCropStage');
    if (!stage || wpCrop.bound) return;
    wpCrop.bound = true;
    stage.addEventListener('pointerdown', wpCropOnPointerDown);
    stage.addEventListener('pointermove', wpCropOnPointerMove);
    stage.addEventListener('pointerup', wpCropOnPointerUp);
    stage.addEventListener('pointercancel', wpCropOnPointerUp);
    stage.addEventListener('wheel', wpCropOnWheel, { passive: false });
  }

  async function onWallpaperFilePicked(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    const img = document.getElementById('wpCropImg');
    const stage = document.getElementById('wpCropStage');
    const hint = document.getElementById('wpCropHint');
    if (_wpCropUrl) { URL.revokeObjectURL(_wpCropUrl); _wpCropUrl = null; }
    _wpCropUrl = URL.createObjectURL(file);
    img.onload = () => {
      const rect = stage.getBoundingClientRect();
      wpCrop.natW = img.naturalWidth; wpCrop.natH = img.naturalHeight;
      wpCrop.viewW = rect.width; wpCrop.viewH = rect.height;
      // "Cover" fit as the starting point — same math as CSS background-size:cover —
      // so the wallpaper starts filling the screen with no gaps, same as Android's picker.
      const coverScale = Math.max(wpCrop.viewW / wpCrop.natW, wpCrop.viewH / wpCrop.natH);
      wpCrop.minScale = coverScale;
      wpCrop.maxScale = coverScale * 4;
      wpCrop.scale = coverScale;
      wpCrop.x = (wpCrop.viewW - wpCrop.natW * coverScale) / 2;
      wpCrop.y = (wpCrop.viewH - wpCrop.natH * coverScale) / 2;
      wpCropClamp(); wpCropRender();
      wpCropBindStage();
      hint?.classList.remove('faded');
      clearTimeout(wpCrop._hintTimer);
      wpCrop._hintTimer = setTimeout(wpCropFadeHint, 2400);
    };
    img.onerror = () => toast('Could not load that image — please try another');
    img.src = _wpCropUrl;
    const dim = document.getElementById('wpPreviewDim');
    const s = getWpSetting();
    if (dim) dim.style.opacity = String((s.dim || 0) / 100);
    closeWallpaperModal();
    document.getElementById('wpPreviewOverlay').classList.add('open');
  }
  function cancelWallpaperPreview() {
    if (_wpCropUrl) { URL.revokeObjectURL(_wpCropUrl); _wpCropUrl = null; }
    document.getElementById('wpPreviewOverlay')?.classList.remove('open');
    openWallpaperModal();
  }
  // Renders exactly what's visible in the crop stage to a canvas at the
  // device's pixel density (capped, so a 108MP photo doesn't produce a
  // multi-MB PNG) — what the user framed is exactly what gets saved.
  function wpCropExport() {
    return new Promise((resolve, reject) => {
      const img = document.getElementById('wpCropImg');
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const outW = Math.round(wpCrop.viewW * dpr);
      const outH = Math.round(wpCrop.viewH * dpr);
      const canvas = document.createElement('canvas');
      canvas.width = outW; canvas.height = outH;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.scale(dpr, dpr);
      ctx.translate(wpCrop.x, wpCrop.y);
      ctx.scale(wpCrop.scale, wpCrop.scale);
      ctx.drawImage(img, 0, 0, wpCrop.natW, wpCrop.natH);
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('toBlob failed')), 'image/jpeg', 0.86);
    });
  }
  async function confirmWallpaperPreview() {
    try {
      const blob = await wpCropExport();
      if (isWpShared()) {
        // Shared mode needs a URL both devices can load, not a local IDB
        // blob — reuse the existing /api/media/upload endpoint (same one
        // photos/vault already go through) to get a public URL, then save
        // that URL on the couple's row so the partner's device can render
        // it too. Note: the app's shared api() helper always JSON-encodes
        // its body, so a multipart upload has to go through a raw fetch()
        // instead — same pattern used elsewhere in index.html for photo/
        // avatar uploads.
        const fd = new FormData();
        fd.append('file', blob, 'wallpaper.jpg');
        fd.append('coupleId', coupleId());
        const uploadRes = await fetch(API + '/api/media/upload', { method: 'POST', body: fd });
        const uploaded = await uploadRes.json();
        if (!uploadRes.ok || uploaded.error) throw new Error(uploaded.error || 'Upload failed');
        await pushSharedWallpaper({ mode: 'custom', image_url: uploaded.url, swatch: null });
      } else {
        await wpIdbSet(wpKey(), blob);
        setWpSetting({ mode: 'custom' });
      }
      if (_wpCropUrl) { URL.revokeObjectURL(_wpCropUrl); _wpCropUrl = null; }
      document.getElementById('wpPreviewOverlay')?.classList.remove('open');
      await applyWallpaper();
      toast('Wallpaper set');
    } catch (e) {
      toast('Could not save wallpaper — please try again');
    }
  }

  // ══════════════════════════════════════════════════════════════
  // KEYBOARD FOCUS FIX
  // Root cause: the Send button (and the attach/camera icon buttons)
  // are plain focusable <button> elements. On Android/mobile, tapping
  // any focusable element moves focus to it — nothing in this file ever
  // called blur() explicitly, the keyboard was closing simply because
  // focus moved off the textarea onto the button that was tapped. The
  // fix is to stop that focus hand-off at the source (preventDefault on
  // pointerdown/mousedown/touchstart, which cancels the browser's default
  // "focus me" behavior but does NOT cancel the click event that follows,
  // so sending still works) rather than papering over it with a forced
  // .focus() call after every send.
  // ══════════════════════════════════════════════════════════════
  let _kbFixBound = false;
  function initKeyboardFocusFix() {
    if (_kbFixBound) return;
    _kbFixBound = true;
    const ids = ['chatSendBtn', 'chatMoreBtn', 'chatCancelRecBtn', 'chatStopRecBtn'];
    const preventFocusSteal = (e) => {
      const ta = document.getElementById('chatIn');
      // Only guard focus when the user was actually mid-typing — if the
      // input wasn't focused already, let the tap behave normally.
      if (ta && document.activeElement === ta) e.preventDefault();
    };
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('pointerdown', preventFocusSteal);
      el.addEventListener('mousedown', preventFocusSteal);
    });
    // Camera button is created inline without an id on the <button> itself
    document.querySelectorAll('.uc-input-wrap .uc-icon-btn').forEach(el => {
      el.addEventListener('pointerdown', preventFocusSteal);
      el.addEventListener('mousedown', preventFocusSteal);
    });

    // Tap-outside-to-close-keyboard: only when the tap lands on genuinely
    // empty conversation space (the scroll container or wallpaper layer
    // itself), never on a message row, action, or control — those all
    // stop propagation via their own handlers or simply aren't the
    // container element, so this never fights scrolling/selection/replies.
    const box = document.getElementById('chatMsgs');
    if (box) {
      box.addEventListener('click', (e) => {
        if (e.target === box) {
          const ta = document.getElementById('chatIn');
          if (ta && document.activeElement === ta) ta.blur();
        }
      });
    }
  }

  // ══════════════════════════════════════════════════════════════
  // KEYBOARD / VIEWPORT (Problem 1 — keyboard overlapping messages)
  // Uses the VisualViewport API as the source of truth for how much
  // vertical space is actually available once the on-screen keyboard is
  // up, and writes it to a CSS var that .chat-page-wrap's height is
  // built from (see chat.css).
  //
  // ROOT-CAUSE FIX: this used to write vv.height (the FULL device
  // viewport height, top of screen to bottom) straight into --chat-vvh,
  // and chat.css subtracted a hardcoded "118px" guess for how much
  // chrome (the app's own top bar + this page's own header, above
  // .chat-page-wrap) needed to be excluded. That's a magic number
  // fighting a real, measured value — on any build/device where the
  // actual chrome height isn't exactly 118px, .chat-page-wrap ends up
  // TALLER than the space .content (its scroll-clipped parent, see
  // ".content:has(#page-chat.active){overflow:hidden}" in chat.css) has
  // actually got. Because .content no longer scrolls while chat is
  // open, that extra height doesn't show up as "scroll down to see
  // more" — it's just silently sliced off by .content's own
  // overflow:hidden, permanently, no matter how far #chatMsgs itself is
  // scrolled. That's what was cutting off the composer/last message.
  // Fixed by measuring .chat-page-wrap's OWN real distance from the top
  // of the visual viewport every time this runs, instead of assuming a
  // constant — this is the one authoritative number, self-correcting
  // for any header height, device, or future layout change, with zero
  // guessing involved.
  // ══════════════════════════════════════════════════════════════
  // Sets --screen-h to a genuinely STATIC height that the wallpaper (see
  // .chat-wallpaper-layer/.chat-wallpaper-dim in chat.css) is sized
  // from. Deliberately measured with window.innerHeight (the LAYOUT
  // viewport, which real Android/Chrome + this app's own
  // interactive-widget=resizes-content meta tag keep stable while the
  // keyboard is open — unlike visualViewport.height, which is exactly
  // what shrinks for the keyboard) and only ever re-measured on a real
  // rotation/resize (guarded by a width change — the keyboard never
  // changes window width, only a genuine orientation/size change does),
  // never on every little visualViewport wiggle. That's what keeps the
  // wallpaper's size completely decoupled from the keyboard.
  let _lastScreenW = window.innerWidth;
  function setStaticScreenHeight() {
    document.documentElement.style.setProperty('--screen-h', window.innerHeight + 'px');
    _lastScreenW = window.innerWidth;
  }
  window.addEventListener('orientationchange', () => setTimeout(setStaticScreenHeight, 200));
  window.addEventListener('resize', () => {
    // Only a real rotation/window-size change moves the width; the
    // on-screen keyboard opening/closing never does. This is what lets
    // one shared 'resize' listener tell the two apart without needing
    // visualViewport at all.
    if (window.innerWidth !== _lastScreenW) setStaticScreenHeight();
  });

  let _vvBound = false;
  function initViewportKeyboardFix() {
    if (_vvBound) return;
    _vvBound = true;
    const vv = window.visualViewport;
    if (!vv) return; // unsupported browser — CSS falls back to 100dvh alone
    let raf = null;
    const apply = () => {
      raf = null;
      const wrap = document.querySelector('.chat-page-wrap');
      // wrap.getBoundingClientRect().top is how much chrome (app top
      // bar, etc.) currently sits above the chat page — the ACTUAL
      // number the old "118px" was only ever guessing at. Re-measured
      // on every call, so it's correct even if that chrome's height
      // ever changes (different device, safe-area, future redesign).
      const top = wrap ? Math.max(0, wrap.getBoundingClientRect().top) : 0;
      const available = Math.max(200, vv.height - top);
      document.documentElement.style.setProperty('--chat-wrap-h', available + 'px');
      // vv.height already excludes the on-screen keyboard once it's
      // open, so this shrinks exactly as much as the keyboard takes up
      // (and grows back exactly as much when it closes) with no manual
      // guessing of keyboard height needed.
      document.documentElement.style.setProperty('--chat-vvh', vv.height + 'px');
      // Keep the latest message pinned in view as the available height
      // changes (keyboard opening/closing, URL bar collapsing, etc.) —
      // exactly WhatsApp's "chat moves upward, latest message stays
      // visible" behavior, rather than leaving the scroll position
      // wherever it happened to be before the resize.
      const box = document.getElementById('chatMsgs');
      if (box) {
        const wasNearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 150;
        if (wasNearBottom) scrollToBottom(false);
      }
    };
    const onVvChange = () => { if (!raf) raf = requestAnimationFrame(apply); };
    vv.addEventListener('resize', onVvChange);
    vv.addEventListener('scroll', onVvChange);
    apply();
    // The very first apply() runs before layout has settled on some
    // devices (fonts/safe-area insets not applied to the first paint
    // yet), which would bake a slightly-wrong "top" measurement into
    // --chat-wrap-h. Re-measure a couple more times shortly after so it
    // self-corrects once everything has actually settled.
    setTimeout(apply, 250);
    setTimeout(apply, 1000);
  }

  // ResizeObserver keeps --uc-composer-h in sync with the composer's
  // REAL rendered height (recording UI, multi-line input growth, and
  // safe-area insets all change it) so the jump-to-bottom button and
  // typing indicator can size themselves relative to it instead of a
  // hardcoded guess — the root cause of the jump button previously
  // overlapping the send button.
  let _composerRoBound = false;
  function initComposerResizeObserver() {
    if (_composerRoBound) return;
    const composer = document.querySelector('.uc-composer');
    if (!composer || typeof ResizeObserver === 'undefined') return;
    _composerRoBound = true;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = entry.borderBoxSize?.[0]?.blockSize || entry.contentRect.height;
        document.documentElement.style.setProperty('--uc-composer-h', Math.ceil(h) + 'px');
      }
    });
    ro.observe(composer);
  }


  // ─── SHARED MEDIA GRID (Telegram/Instagram-style) ───────────────────
  // Full-screen overlay showing every photo/gif in this conversation as a
  // dense square grid, newest first. Tapping a tile opens the same
  // gallery viewer used from inline bubbles (openMediaViewer), scoped and
  // indexed to the same media collection so swiping still moves through
  // every photo in the chat, not just the grid.
  function openMediaGrid() {
    closeTopOverlayIfOpen();
    let overlay = document.getElementById('chatMediaGridOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'chatMediaGridOverlay';
      overlay.className = 'media-grid-overlay';
      document.body.appendChild(overlay);
    }
    const media = msgs.filter(m => !m.deleted && (m.type === 'image' || m.type === 'gif'))
      .slice().reverse(); // newest first for browsing
    overlay.innerHTML = `
      <div class="media-grid-topbar">
        <button class="media-grid-back" aria-label="Close"><i data-lucide="arrow-left"></i></button>
        <div class="media-grid-title">Shared Media <span class="media-grid-count">${media.length}</span></div>
      </div>
      <div class="media-grid-body">
        ${media.length ? `<div class="media-grid">${media.map(m => `<div class="media-grid-tile" data-id="${m.id}"><img src="${esc(m.media_url)}" loading="lazy"></div>`).join('')}</div>`
          : `<div class="media-grid-empty">📷<div>No photos yet</div></div>`}
      </div>`;
    overlay.querySelector('.media-grid-back').onclick = () => overlay.classList.remove('open');
    overlay.querySelectorAll('.media-grid-tile').forEach(tile => {
      tile.onclick = () => { overlay.classList.remove('open'); openMediaViewer(tile.getAttribute('data-id')); };
    });
    requestAnimationFrame(() => overlay.classList.add('open'));
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
  }

  function isSelecting() { return selectMode; }
  function closeMsgMenuIfOpen() {
    const el = document.getElementById('chatMsgMenu');
    if (el) { el.remove(); return true; }
    return false;
  }

  // ─── BACK-NAVIGATION ENTRY POINT ─────────────────────────
  // Every popup/menu/sheet/panel/modal Chat can have open at once, in the
  // exact priority a device Back press (or a visible back arrow) should
  // close them: deepest/most-recently-opened first, one at a time. This is
  // the single place the app-level Back handler asks "does Chat have
  // something open right now?" — it must stay in sync with every new
  // overlay Chat grows, or Back will skip straight past it to page nav.
  function closeTopOverlayIfOpen() {
    // 1) Free-floating context menus / pickers (appended to body, no page nav should occur under them)
    if (closeMsgMenuIfOpen()) return true;
    const mediaGrid = document.getElementById('chatMediaGridOverlay');
    if (mediaGrid && mediaGrid.classList.contains('open')) { mediaGrid.classList.remove('open'); return true; }
    const reactionPicker = document.getElementById('chatReactionPicker');
    if (reactionPicker) { reactionPicker.remove(); return true; }
    const overflowMenu = document.getElementById('chatToolbarOverflowMenu');
    if (overflowMenu) { overflowMenu.remove(); return true; }
    const contactSheet = document.getElementById('chatContactSheet');
    if (contactSheet) { contactSheet.remove(); return true; }
    // 2) Wallpaper flow — full-screen crop/preview is nested one level
    //    deeper than the wallpaper settings modal that opened it, so it
    //    must close first and land back on that modal, not on Chat itself.
    const wpPreview = document.getElementById('wpPreviewOverlay');
    if (wpPreview && wpPreview.classList.contains('open')) { cancelWallpaperPreview(); return true; }
    const wpModal = document.getElementById('wpModalOverlay');
    if (wpModal && wpModal.classList.contains('open')) { closeWallpaperModal(); return true; }
    // 3) Attach-menu sub-panels (GIF/sticker/emoji/gift/poll) and the
    //    attach sheet itself — a sub-panel implies the sheet beneath it
    //    is still logically open, so only the sub-panel closes first.
    const gifPanel = document.getElementById('chatGifPanel');
    if (gifPanel && gifPanel.classList.contains('open')) { gifPanel.classList.remove('open'); return true; }
    const stickerPanel = document.getElementById('chatStickerPanel');
    if (stickerPanel && stickerPanel.classList.contains('open')) { stickerPanel.classList.remove('open'); return true; }
    const emojiPanel = document.getElementById('chatEmojiPanel');
    if (emojiPanel && emojiPanel.classList.contains('open')) { emojiPanel.classList.remove('open'); return true; }
    const giftPanel = document.getElementById('chatGiftPanel');
    if (giftPanel && giftPanel.classList.contains('open')) { giftPanel.classList.remove('open'); return true; }
    const pollPanel = document.getElementById('chatPollPanel');
    if (pollPanel) { pollPanel.remove(); return true; }
    const bottomSheet = document.getElementById('chatBottomSheet');
    if (bottomSheet && bottomSheet.classList.contains('open')) { closeSheet(); return true; }
    // 4) Search bar
    const searchBar = document.getElementById('chatSearchBar');
    if (searchBar && searchBar.classList.contains('show')) { closeSearch(); return true; }
    // 5) Header 3-dot dropdown
    const headerMenu = document.getElementById('chatHeaderMenu');
    if (headerMenu && headerMenu.classList.contains('open')) { toggleHeaderMenu(); return true; }
    // 6) Multi-select toolbar (checked separately by callers via isSelecting(),
    //    kept here too so this function alone is a complete "anything open?" check)
    if (selectMode) { exitSelectMode(); return true; }
    return false;
  }

  return {
    onChatScroll, scrollToBottom, sendText, onTypingInput, onImagePick, toggleRecord,
    onBubbleClick, openMenu, reactTo, replyTo, closeBanner, togglePin, toggleStar,
    openStarred, deleteMsg, confirmDeleteMsg, enterSelectMode, deleteSelected, exitSelectMode,
    isSelecting, closeMsgMenuIfOpen, closeTopOverlayIfOpen, openToolbarOverflow, openMediaViewer,
    openSearch, closeSearch, runSearch, scrollToMsg, sendGif, sendEmoji, sendEmojiTap,
    openEmojiPanel, switchEmojiTab, filterEmoji, openGifPanel, searchGifs, markRead, init, openSheet, closeSheet,
    forwardMsg, copyMsg, editMsg, cancelEdit, infoMsg, cancelRecording, startLongPress, endLongPress, moveLongPress,
    onAudioPick, sendLocation, openGiftPanel, sendGift, toggleVoicePlay,
    openStickerPanel, sendSticker, sendContactCard, openContactCard, openMemories, openPollComposer, submitPoll, votePoll,
    destroyPanels,
    toggleHeaderMenu, openWallpaperModal, closeWallpaperModal, onDimSlider, setDefaultWallpaper, removeWallpaper,
    onWallpaperFilePicked, cancelWallpaperPreview, confirmWallpaperPreview, selectWpSwatch, applyWallpaper,
    loadMessages, toggleWallpaperShared, openMediaGrid, toggleTheme, cycleVoiceSpeed,
    clearChat, toggleMute, promptNickname
  };
})();
window.Chat = Chat;