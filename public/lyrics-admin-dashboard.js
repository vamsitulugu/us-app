/* ═══════════════════════════════════════════════════════════════
   LYRICS ADMIN DASHBOARD — Step 16

   A self-contained panel showing cache/missing counts, per-provider
   success rates, cache size, and controls to refresh missing lyrics
   or clear the cache. Doesn't touch any existing UI — it's an
   entirely new overlay, opened via window.openLyricsAdminDashboard()
   (wire a button/menu-item to that wherever makes sense, e.g. next to
   the existing 🏅 achievements button in music.html).
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function whenReady(fn) {
    if (window.MusicPlayer && window.LyricsProvider) fn();
    else setTimeout(() => whenReady(fn), 150);
  }

  function injectStyles() {
    if (document.getElementById('ladStyles')) return;
    const css = `
    .lad-overlay{position:fixed;inset:0;z-index:1500;background:rgba(0,0,0,.7);backdrop-filter:blur(10px);display:none;align-items:center;justify-content:center;padding:16px}
    .lad-overlay.open{display:flex}
    .lad-card{width:100%;max-width:480px;max-height:88vh;overflow-y:auto;background:rgba(10,10,24,.97);backdrop-filter:blur(30px) saturate(200%);border:1px solid rgba(255,255,255,.15);border-radius:22px;padding:22px;color:#fff}
    .lad-title{font-family:var(--ff-serif,serif);font-size:18px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center}
    .lad-title button{background:none;border:none;color:rgba(255,255,255,.5);font-size:18px;cursor:pointer}
    .lad-stat-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}
    .lad-stat-box{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:12px;text-align:center}
    .lad-stat-n{font-family:var(--ff-serif,serif);font-size:22px}
    .lad-stat-l{font-size:10px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.4px;margin-top:2px}
    .lad-section-title{font-size:11px;font-weight:700;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.5px;margin:16px 0 8px}
    .lad-provider-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.08);font-size:12px}
    .lad-provider-name{font-weight:600}
    .lad-provider-meta{color:rgba(255,255,255,.45)}
    .lad-missing-row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;font-size:12px;border-bottom:1px solid rgba(255,255,255,.06)}
    .lad-actions{display:flex;gap:8px;margin-top:16px}
    .lad-btn{flex:1;padding:11px;border-radius:12px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#fff;font-weight:600;font-size:12px;cursor:pointer}
    .lad-btn.primary{background:linear-gradient(135deg,var(--accent,#5b9bff),var(--accent-d,#2f6feb));border:none}
    .lad-btn.danger{background:rgba(248,113,113,.15);border-color:rgba(248,113,113,.35);color:#f87171}
    .lad-empty{text-align:center;color:rgba(255,255,255,.4);font-size:12px;padding:14px}
    `;
    const s = document.createElement('style'); s.id = 'ladStyles'; s.textContent = css; document.head.appendChild(s);
  }

  function injectDom() {
    if (document.getElementById('ladOverlay')) return;
    const el = document.createElement('div');
    el.id = 'ladOverlay'; el.className = 'lad-overlay';
    el.innerHTML = `<div class="lad-card">
      <div class="lad-title"><span>🛠 Lyrics Dashboard</span><button id="ladClose">✕</button></div>
      <div class="lad-stat-row" id="ladStatRow"></div>
      <div class="lad-section-title">Provider Statistics</div>
      <div id="ladProviders"></div>
      <div class="lad-section-title">Missing Lyrics</div>
      <div id="ladMissingList"></div>
      <div class="lad-actions">
        <button class="lad-btn primary" id="ladRefreshBtn">🔄 Refresh Missing Lyrics</button>
        <button class="lad-btn danger" id="ladClearBtn">🗑 Clear Cache</button>
      </div>
    </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', e => { if (e.target === el) close(); });
    document.getElementById('ladClose').onclick = close;
    document.getElementById('ladRefreshBtn').onclick = refreshMissing;
    document.getElementById('ladClearBtn').onclick = clearCache;
  }

  function close() { document.getElementById('ladOverlay').classList.remove('open'); }

  async function load() {
    const ctx = window.MusicPlayer.getCoupleCtx();
    if (!ctx) return;
    try {
      const [stats, missing] = await Promise.all([
        window.MusicPlayer.api('GET', '/api/lyrics/stats/' + ctx.coupleId),
        window.MusicPlayer.api('GET', '/api/lyrics/missing/' + ctx.coupleId),
      ]);
      renderStats(stats);
      renderMissing(missing);
    } catch (e) {
      window.MusicPlayer.toast('Could not load lyrics dashboard: ' + e.message);
    }
  }

  function renderStats(stats) {
    document.getElementById('ladStatRow').innerHTML = `
      <div class="lad-stat-box"><div class="lad-stat-n">${stats.cachedCount}</div><div class="lad-stat-l">Cached</div></div>
      <div class="lad-stat-box"><div class="lad-stat-n">${stats.missingCount}</div><div class="lad-stat-l">Missing</div></div>
      <div class="lad-stat-box" style="grid-column:1/-1"><div class="lad-stat-n">${(stats.cacheSizeBytes / 1024).toFixed(1)} KB</div><div class="lad-stat-l">Cache Size</div></div>
    `;
    const provs = Object.entries(stats.providerStats || {});
    document.getElementById('ladProviders').innerHTML = provs.length ? provs.map(([id, s]) => `
      <div class="lad-provider-row">
        <span class="lad-provider-name">${window.LyricsProvider.labelFor(id)}</span>
        <span class="lad-provider-meta">${s.successes}/${s.attempts} · ${s.successRate}% · ${s.avgResponseMs}ms avg</span>
      </div>`).join('') : `<div class="lad-empty">No search attempts logged yet.</div>`;
  }

  function renderMissing(rows) {
    const el = document.getElementById('ladMissingList');
    if (!rows.length) { el.innerHTML = `<div class="lad-empty">Nothing missing 🎉</div>`; return; }
    el.innerHTML = rows.slice(0, 30).map(r => `
      <div class="lad-missing-row">
        <span>${escapeHtml(r.title)}${r.artist ? ' — ' + escapeHtml(r.artist) : ''}</span>
        <span class="lad-provider-meta">${r.attempts}x</span>
      </div>`).join('');
  }
  function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  async function refreshMissing() {
    const ctx = window.MusicPlayer.getCoupleCtx();
    if (!ctx) return;
    const btn = document.getElementById('ladRefreshBtn');
    const orig = btn.textContent; btn.textContent = 'Refreshing…'; btn.disabled = true;
    try {
      const res = await window.MusicPlayer.api('POST', '/api/lyrics/refresh-missing', { coupleId: ctx.coupleId, limit: 20 });
      window.MusicPlayer.toast(`Found lyrics for ${res.found}/${res.processed} songs 🎉`);
      await load();
      if (typeof window.renderMusicTracks === 'function') window.renderMusicTracks();
    } catch (e) {
      window.MusicPlayer.toast('Refresh failed: ' + e.message);
    } finally { btn.textContent = orig; btn.disabled = false; }
  }

  async function clearCache() {
    if (!confirm('Clear all cached lyrics for this couple? They will be re-searched next time each song is imported or refreshed.')) return;
    const ctx = window.MusicPlayer.getCoupleCtx();
    if (!ctx) return;
    try {
      await window.MusicPlayer.api('POST', '/api/lyrics/clear-cache', { coupleId: ctx.coupleId });
      window.MusicPlayer.toast('Lyrics cache cleared');
      await load();
    } catch (e) { window.MusicPlayer.toast('Could not clear cache: ' + e.message); }
  }

  window.openLyricsAdminDashboard = function () {
    injectStyles(); injectDom();
    document.getElementById('ladOverlay').classList.add('open');
    load();
  };

  whenReady(() => { injectStyles(); injectDom(); });
})();