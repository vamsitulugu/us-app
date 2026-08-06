// ═══════════════════════════════════════════════════════
//  public/both-mode.js — "Both" mode client
//  Depends on globals already defined in index.html's inline
//  <script>: api(), esc(), S, API, window.__SHARED_SB__.
//  Loaded after twin-orb.js. Does not touch You-mode's askAI/
//  sendAI code path at all.
// ═══════════════════════════════════════════════════════
(function () {
  const INTENT_LABEL = {
    CONFLICT: '⚡ Conflict', DECISION: '🧭 Decision', PLANNING: '📅 Planning',
    IDEAS: '💡 Ideas', QUESTION: '❓ Question', RELATIONSHIP_DISCUSSION: '💬 Discussion',
    FUN: '🎉 Fun', GENERAL: '✨ General',
  };

  let state = {
    flagChecked: false, flagEnabled: false,
    mode: 'you',
    session: null,        // current session row
    round: null,          // shaped round from GET /session/:id (current active round)
    channel: null,         // realtime channel subscription
    subscribedTopic: null,
    pollTimer: null,
    view: 'home',          // 'home' | 'session'
    names: null,           // { user1, user2 } real display names
  };

  function coupleId() { return S.coupleId; }
  function myRole() { return S.role; }
  function myName() { return S.myName || (myRole() === 'user1' ? (state.names && state.names.user1) : (state.names && state.names.user2)) || 'You'; }
  function partnerName() { return S.partnerName || (myRole() === 'user1' ? (state.names && state.names.user2) : (state.names && state.names.user1)) || 'Partner'; }

  // ─── Persist which discussion is open across refresh ───────
  function storageKey() { return `both_open_${coupleId()}`; }
  function saveOpenSession(sessionId) {
    try { sessionStorage.setItem(storageKey(), sessionId); } catch (e) {}
  }
  function clearOpenSession() {
    try { sessionStorage.removeItem(storageKey()); } catch (e) {}
  }
  function getSavedOpenSession() {
    try { return sessionStorage.getItem(storageKey()); } catch (e) { return null; }
  }

  // ─── Entry points called from goto() in index.html ────
  async function onEnterAiPage() {
    if (!state.flagChecked) {
      state.flagChecked = true;
      // Both mode is a finished, stable feature now — always show the
      // selector. (This used to be gated behind a `feature_flags` DB
      // row that was never created, which silently hid it forever.)
      const sel = document.getElementById('twinModeSelector');
      if (sel) sel.style.display = 'flex';
    }
    if (!state.names) {
      try { state.names = await api('GET', `/api/ai-both/names/${coupleId()}`); }
      catch (e) { state.names = { user1: 'Partner 1', user2: 'Partner 2' }; }
    }
    if (state.mode === 'both') restoreOrHome();
  }

  // If a discussion was open when the page last refreshed, reopen the same
  // one instead of dropping back to the "start new" screen.
  function restoreOrHome() {
    const savedId = getSavedOpenSession();
    if (savedId) openSession(savedId);
    else renderBothHome();
  }

  function onLeaveAiPage() {
    unsubscribeRealtime();
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  }

  function switchMode(mode) {
    if (mode === state.mode) return;
    state.mode = mode;
    document.getElementById('twinModeYouBtn').classList.toggle('active', mode === 'you');
    document.getElementById('twinModeBothBtn').classList.toggle('active', mode === 'both');
    document.getElementById('aiWrapYou').style.display = mode === 'you' ? '' : 'none';
    document.getElementById('bothModeWrap').style.display = mode === 'both' ? '' : 'none';
    if (mode === 'both') {
      restoreOrHome();
    } else {
      unsubscribeRealtime();
      if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
    }
  }

  // ─── Realtime (mirrors the existing broadcast-over-HTTP pattern) ───
  function subscribeRealtime(onEvent) {
    unsubscribeRealtime();
    const sb = window.__SHARED_SB__;
    const topic = `both_round:${coupleId()}`;
    if (!sb) { startPolling(onEvent); return; } // graceful fallback if shared client unavailable
    try {
      const ch = sb.channel(topic, { config: { broadcast: { self: true } } })
        .on('broadcast', { event: 'submitted' }, p => onEvent('submitted', p.payload))
        .on('broadcast', { event: 'locked' }, p => onEvent('locked', p.payload))
        .on('broadcast', { event: 'result_ready' }, p => onEvent('result_ready', p.payload))
        .on('broadcast', { event: 'failed' }, p => onEvent('failed', p.payload))
        .subscribe();
      state.channel = ch; state.subscribedTopic = topic;
    } catch (e) {
      console.warn('[both-mode] realtime subscribe failed, falling back to polling:', e.message);
      startPolling(onEvent);
    }
    // Polling stays on as a light safety net even with realtime connected —
    // covers missed-broadcast edge cases (reconnect gaps) without being wasteful.
    startPolling(onEvent, 6000);
  }

  function startPolling(onEvent, intervalMs) {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(() => onEvent('poll', {}), intervalMs || 3000);
  }

  function unsubscribeRealtime() {
    if (state.channel) { try { state.channel.unsubscribe(); } catch (e) {} state.channel = null; }
    state.subscribedTopic = null;
  }

  // ─── HOME: start / continue ───────────────────────────
  async function renderBothHome() {
    state.view = 'home';
    state.session = null; state.round = null;
    clearOpenSession();
    unsubscribeRealtime();
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
    const wrap = document.getElementById('bothModeWrap');
    const n = state.names || { user1: 'You', user2: 'Partner' };
    wrap.innerHTML = `
      <div class="both-home">
        <div class="both-hero">
          <div class="both-couple-row">
            ${avatarHtml(S.myAvatar, myName())}
            <div class="both-couple-vs">Twin</div>
            ${avatarHtml(S.partnerAvatar, partnerName())}
          </div>
          <div class="both-hero-title">Both</div>
          <div class="both-hero-sub">Share your perspective privately. Twin reveals one shared answer once you both submit.</div>
          <button class="btn btn-accent both-start-btn" onclick="TwinBoth.startNewSession()">Start Together</button>
        </div>
        <div class="both-history-label">Recent discussions</div>
        <div id="bothHistoryList" class="both-history-list"><div class="empty">Loading…</div></div>
      </div>`;
    try {
      const list = await api('GET', `/api/ai-both/sessions/${coupleId()}`);
      const el = document.getElementById('bothHistoryList');
      if (!el) return;
      if (!list.length) { el.innerHTML = '<div class="empty">No discussions yet — start one above 💬</div>'; return; }
      el.innerHTML = list.map(s => `
        <div class="both-history-item" data-sid="${esc(s.id)}">
          <div class="both-history-click" onclick="TwinBoth.openSession('${esc(s.id)}')">
            <div class="both-history-top">
              <span class="both-history-intent">${esc(INTENT_LABEL[s.intent] || (s.intent ? s.intent : '…'))}</span>
              <span class="both-history-date">${new Date(s.last_activity_at).toLocaleDateString()}</span>
            </div>
            <div class="both-history-title">${esc(s.title || 'Untitled discussion')}</div>
            <div class="both-history-meta">${s.round_count} round${s.round_count === 1 ? '' : 's'}</div>
          </div>
          <div class="both-history-menu-wrap">
            <button class="both-history-menu-btn" onclick="event.stopPropagation(); TwinBoth.toggleCardMenu(this)">⋮</button>
            <div class="both-history-menu">
              <button class="both-history-menu-item danger" onclick="event.stopPropagation(); TwinBoth.confirmDelete('${esc(s.id)}')">🗑 Delete Discussion</button>
            </div>
          </div>
        </div>`).join('');
    } catch (e) {
      const el = document.getElementById('bothHistoryList');
      if (el) el.innerHTML = `<div class="empty">Couldn't load history. <span class="both-retry-link" onclick="TwinBoth.renderBothHome()">Retry</span></div>`;
    }
  }

  function avatarHtml(url, name) {
    const initial = esc((name || '?').trim().charAt(0).toUpperCase() || '?');
    return url
      ? `<img class="both-avatar" src="${esc(url)}" alt="${esc(name)}">`
      : `<div class="both-avatar both-avatar-fallback">${initial}</div>`;
  }

  function toggleCardMenu(btn) {
    const menu = btn.nextElementSibling;
    document.querySelectorAll('.both-history-menu.open').forEach(m => { if (m !== menu) m.classList.remove('open'); });
    menu.classList.toggle('open');
    const closeOnOutside = (ev) => {
      if (!menu.contains(ev.target) && ev.target !== btn) {
        menu.classList.remove('open');
        document.removeEventListener('click', closeOnOutside);
      }
    };
    setTimeout(() => document.addEventListener('click', closeOnOutside), 0);
  }

  function confirmDelete(sessionId) {
    const wrap = document.getElementById('bothModeWrap');
    const dialog = document.createElement('div');
    dialog.className = 'both-confirm-overlay';
    dialog.innerHTML = `
      <div class="both-confirm-card">
        <div class="both-confirm-title">Delete this discussion?</div>
        <div class="both-confirm-body">This permanently deletes all rounds, submissions, and Twin's results for this discussion. This can't be undone.</div>
        <div class="both-confirm-actions">
          <button class="btn both-confirm-cancel">Cancel</button>
          <button class="btn both-confirm-delete">Delete</button>
        </div>
      </div>`;
    wrap.appendChild(dialog);
    dialog.querySelector('.both-confirm-cancel').onclick = () => dialog.remove();
    dialog.querySelector('.both-confirm-delete').onclick = async () => {
      const btn = dialog.querySelector('.both-confirm-delete');
      btn.disabled = true; btn.textContent = 'Deleting…';
      try {
        await api('DELETE', `/api/ai-both/session/${sessionId}`, { coupleId: coupleId() });
        dialog.remove();
        if (state.session && state.session.id === sessionId) clearOpenSession();
        renderBothHome();
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Delete';
        alertToast('Could not delete — try again.');
      }
    };
  }

  async function startNewSession() {
    try {
      const r = await api('POST', '/api/ai-both/sessions', { coupleId: coupleId(), role: myRole() });
      state.session = r.session;
      saveOpenSession(r.session.id);
      openSessionRound(r.round);
    } catch (e) {
      alertToast('Could not start — check your connection.');
    }
  }

  async function openSession(sessionId) {
    // Render a lightweight loading shell immediately so the click always
    // feels like "opening a discussion", never a blank/начать flash.
    state.view = 'session';
    const wrap = document.getElementById('bothModeWrap');
    if (wrap) wrap.innerHTML = `<div class="both-session"><div class="both-status-card both-analyzing"><div class="both-spinner"></div>Opening discussion…</div></div>`;
    try {
      const detail = await api('GET', `/api/ai-both/session/${sessionId}?role=${myRole()}`);
      state.session = detail.session;
      saveOpenSession(sessionId);
      const active = [...detail.rounds].reverse().find(r => r.status !== 'done' && r.status !== 'safety') || detail.rounds[detail.rounds.length - 1];
      renderSessionShell(detail.rounds);
      const prior = detail.rounds.filter(r => r.id !== active.id && (r.status === 'done' || r.status === 'safety'));
      renderPriorRounds(prior);
      loadRound(active);
    } catch (e) {
      clearOpenSession();
      alertToast('Could not open this discussion.');
      renderBothHome();
    }
  }

  function openSessionRound(round) {
    renderSessionShell([{ id: round.id, round_number: round.round_number, status: round.status, you_submitted: false, partner_submitted: false }]);
    loadRound({ id: round.id, round_number: round.round_number, status: round.status });
  }

  function renderSessionShell(rounds) {
    state.view = 'session';
    const wrap = document.getElementById('bothModeWrap');
    wrap.innerHTML = `
      <div class="both-session">
        <div class="both-session-header">
          <button class="both-back-btn" onclick="TwinBoth.renderBothHome()">‹ Back</button>
          <div class="both-session-title">${esc((state.session && state.session.title) || 'Discussion')}</div>
          <div class="both-round-indicator" id="bothRoundIndicator">Round ${rounds[rounds.length - 1].round_number}</div>
        </div>
        <div class="both-couple-row both-couple-row-compact">
          ${avatarHtml(S.myAvatar, myName())} <span class="both-couple-name">${esc(myName())}</span>
          <span class="both-couple-vs-sm">Twin</span>
          ${avatarHtml(S.partnerAvatar, partnerName())} <span class="both-couple-name">${esc(partnerName())}</span>
        </div>
        <div id="bothPriorRounds" class="both-prior-rounds"></div>
        <div id="bothRoundBody" class="both-round-body"></div>
      </div>`;
  }

  // Show earlier completed rounds (and Twin's results for each) above the
  // current active round, so reopening a discussion shows the full history
  // instead of only the latest round.
  function renderPriorRounds(rounds) {
    const el = document.getElementById('bothPriorRounds');
    if (!el) return;
    if (!rounds.length) { el.innerHTML = ''; return; }
    el.innerHTML = rounds.map(r => {
      const result = r.result;
      const sections = result && !result.safety_flag
        ? (result.sections || []).map(s => `
            <div class="both-result-section">
              <div class="both-result-section-title">${esc(s.title)}</div>
              <div class="both-result-section-content">${esc(s.content)}</div>
            </div>`).join('')
        : '';
      const safetyBody = result && result.safety_flag
        ? `<div class="both-safety-body">${(result.sections || []).map(s => `<p><strong>${esc(s.title)}:</strong> ${esc(s.content)}</p>`).join('')}</div>`
        : '';
      return `
        <details class="both-prior-round">
          <summary>Round ${r.round_number}${result ? ` — ${esc(INTENT_LABEL[result.intent] || result.intent)}` : ''}</summary>
          <div class="both-prior-round-body">
            ${result ? (result.safety_flag ? safetyBody : sections) : '<div class="empty">No result.</div>'}
          </div>
        </details>`;
    }).join('');
  }

  // ─── Round lifecycle ───────────────────────────────────
  async function loadRound(round) {
    state.round = round;
    document.getElementById('bothRoundIndicator').textContent = `Round ${round.round_number}`;
    if (round.status === 'done' || round.status === 'safety') {
      await refreshRoundFromServer(round.id);
      renderResult();
    } else if (round.status === 'failed') {
      await refreshRoundFromServer(round.id);
      renderFailed();
    } else {
      renderSubmitOrWaiting();
      subscribeRealtime(onRealtimeEvent);
    }
  }

  async function refreshRoundFromServer(roundId) {
    try {
      const r = await api('GET', `/api/ai-both/rounds/${roundId}?role=${myRole()}`);
      state.round = { ...state.round, ...r };
    } catch (e) { /* keep last known state; polling/realtime will retry */ }
  }

  async function onRealtimeEvent(type, payload) {
    if (!state.round) return;
    if (payload.roundId && payload.roundId !== state.round.id && type !== 'poll') return;

    // Snapshot before refresh so a no-op poll tick never touches the DOM —
    // otherwise re-rendering the submit textarea on every 3-6s poll wipes
    // out whatever the person is mid-typing.
    const before = { status: state.round.status, you: state.round.you_submitted, partner: state.round.partner_submitted };
    await refreshRoundFromServer(state.round.id);
    const st = state.round.status;
    const unchanged = type === 'poll' &&
      st === before.status &&
      !!state.round.you_submitted === !!before.you &&
      !!state.round.partner_submitted === !!before.partner;
    if (unchanged) return;

    if (st === 'done' || st === 'safety') { unsubscribeRealtime(); if (state.pollTimer) clearInterval(state.pollTimer); renderResult(); }
    else if (st === 'failed') { unsubscribeRealtime(); if (state.pollTimer) clearInterval(state.pollTimer); renderFailed(); }
    else renderSubmitOrWaiting();
  }

  function renderSubmitOrWaiting() {
    const body = document.getElementById('bothRoundBody');
    if (!body) return;
    const r = state.round;
    if (r.you_submitted && r.partner_submitted) {
      body.innerHTML = `<div class="both-status-card both-analyzing"><div class="both-spinner"></div>Both responses received. Analyzing…</div>`;
      return;
    }
    if (r.you_submitted) {
      body.innerHTML = `
        <div class="both-status-card both-waiting">
          <div class="both-check">✓</div>
          <div>Your response is submitted.</div>
          <div class="both-waiting-sub">Waiting for ${esc(partnerName())}…</div>
        </div>`;
      return;
    }
    body.innerHTML = `
      <div class="both-submit-card">
        <textarea id="bothInputArea" class="both-input" rows="4" placeholder="Share your side — Twin won't show ${esc(partnerName())} until you both submit."></textarea>
        <button class="btn btn-accent both-submit-btn" onclick="TwinBoth.submitCurrent()">Submit privately</button>
        ${r.partner_submitted ? `<div class="both-waiting-sub">${esc(partnerName())} has already submitted theirs.</div>` : ''}
      </div>`;
  }

  async function submitCurrent() {
    const ta = document.getElementById('bothInputArea');
    const content = ta && ta.value.trim();
    if (!content) return;
    const btn = document.querySelector('.both-submit-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
    try {
      const r = await api('POST', `/api/ai-both/rounds/${state.round.id}/submit`, {
        coupleId: coupleId(), role: myRole(), content,
      });
      state.round.you_submitted = true;
      if (r.status === 'analyzing') state.round.partner_submitted = true;
      renderSubmitOrWaiting();
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Submit privately'; }
      alertToast('Could not submit — try again.');
    }
  }

  function renderResult() {
    unsubscribeRealtime();
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
    const body = document.getElementById('bothRoundBody');
    if (!body) return;
    const result = state.round.result;
    if (!result) { body.innerHTML = '<div class="empty">Result unavailable.</div>'; return; }

    if (result.safety_flag) {
      body.innerHTML = `
        <div class="both-safety-card">
          <div class="both-safety-title">💛 Let's pause here</div>
          <div class="both-safety-body">${(result.sections || []).map(s => `<p><strong>${esc(s.title)}:</strong> ${esc(s.content)}</p>`).join('')}</div>
          <div class="both-safety-note">If you're in immediate danger, please contact local emergency services or a crisis line for your country.</div>
        </div>`;
      return;
    }

    const sections = (result.sections || []).map(s => `
      <div class="both-result-section">
        <div class="both-result-section-title">${esc(s.title)}</div>
        <div class="both-result-section-content">${esc(s.content)}</div>
      </div>`).join('');

    body.innerHTML = `
      <div class="both-result-card">
        <div class="both-result-intent">${esc(INTENT_LABEL[result.intent] || result.intent)}</div>
        ${sections}
        <button class="btn btn-accent both-continue-btn" onclick="TwinBoth.continueTogether()">Continue Together</button>
      </div>`;
  }

  function renderFailed() {
    const body = document.getElementById('bothRoundBody');
    if (!body) return;
    body.innerHTML = `
      <div class="both-status-card both-failed">
        <div>Twin couldn't finish analyzing this round.</div>
        <button class="btn btn-accent" onclick="TwinBoth.retryRound()">Retry</button>
      </div>`;
  }

  async function retryRound() {
    try {
      await api('POST', `/api/ai-both/rounds/${state.round.id}/retry`, { coupleId: coupleId() });
      state.round.status = 'analyzing';
      renderSubmitOrWaiting();
      subscribeRealtime(onRealtimeEvent);
    } catch (e) { alertToast('Still failing — please try again shortly.'); }
  }

  async function continueTogether() {
    try {
      const r = await api('POST', `/api/ai-both/sessions/${state.session.id}/next-round`, {});
      openSessionRound(r.round);
    } catch (e) { alertToast('Could not start the next round.'); }
  }

  function alertToast(msg) {
    // Reuses whatever lightweight toast the app already has if present, else a fallback.
    if (typeof window.showToast === 'function') window.showToast(msg);
    else console.warn('[both-mode]', msg);
  }

  // ─── Android hardware back button ──────────────────────
  // Called from the CapApp 'backButton' listener in index.html, same
  // pattern as Chat/LiveMap's own closeTopOverlayIfOpen(). Only acts
  // while Both mode is actually the active AI sub-mode — returns false
  // otherwise so the caller falls through to normal page navigation.
  function closeTopOverlayIfOpen() {
    if (state.mode !== 'both') return false;
    // 1) Delete-confirmation dialog takes priority over everything else.
    const confirmOverlay = document.querySelector('.both-confirm-overlay');
    if (confirmOverlay) { confirmOverlay.remove(); return true; }
    // 2) An open card ⋮ menu on a discussion in the history list.
    const openMenu = document.querySelector('.both-history-menu.open');
    if (openMenu) { openMenu.classList.remove('open'); return true; }
    // 3) Inside a discussion — back out to the Both home list instead of
    //    leaving the AI page entirely (mirrors a normal "page back").
    if (state.view === 'session') { renderBothHome(); return true; }
    return false;
  }

  window.TwinBoth = {
    onEnterAiPage, onLeaveAiPage, switchMode,
    startNewSession, openSession, submitCurrent, continueTogether, retryRound,
    renderBothHome, toggleCardMenu, confirmDelete, closeTopOverlayIfOpen,
  };
})();