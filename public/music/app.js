/* ═══════════════════════════════════════════════════════════════
   MUSIC · app shell
   Root screen (Music · My Recordings), boot sequence and the
   hooks the parent app relies on:
     • window.closeTopOverlayIfOpen()  — Android Back / gesture handling
     • postMessage {type:'theme'}      — accent colours follow the app theme
     • postMessage {type:'ckJoinAsGuest'} — handled by couple-karaoke.js
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const MX = window.MX, S = MX.S, A = window.AudioService;
  const esc = MX.esc, icon = MX.icon, $ = (s, r) => (r || document).querySelector(s);

  const home = $('#home');
  home.innerHTML = `<header class="hdr"><div class="hdr-brand"><div class="hdr-logo">${icon('heart', 'fill')}</div>
      <div><div class="hdr-title">Music</div><div class="hdr-sub">Feel the same beat together ${icon('heart')}</div></div></div>
      <div class="hdr-actions"><button class="icon-btn" data-act="open-search" aria-label="Search">${icon('search')}</button><button class="icon-btn" data-act="open-settings" aria-label="Settings">${icon('settings')}</button></div></header>
    <nav class="tabs" id="homeTabs"><button class="tab" data-act="home-tab" data-t="music">Music</button><button class="tab" data-act="home-tab" data-t="recs">My Recordings</button></nav>
    <div id="paneMusic"></div><div id="paneRecs" class="hidden"></div>`;
  $('#home svg.fill') && ($('#home .hdr-logo svg').style.fill = '#fff');

  let tab = 'music'; const mounted = {};
  function setTab(t) {
    tab = t;
    home.querySelectorAll('#homeTabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.t === t));
    [['music', '#paneMusic'], ['recs', '#paneRecs']].forEach(([k, sel]) => $(sel).classList.toggle('hidden', k !== t));
    if (!mounted[t]) {
      mounted[t] = true;
      if (t === 'music') MX.homeMusic($('#paneMusic'));
      else MX.recordings.mountTab($('#paneRecs'));
    }
    try { sessionStorage.setItem('mx_home_tab', t); } catch (e) {}
  }
  MX.act('home-tab', (d) => { setTab(d.t); home.scrollTo({ top: 0 }); });

  /* ── Android Back / parent integration ─────────────────── */
  window.closeTopOverlayIfOpen = function () {
    if (MX.layers.closeTop()) return true;
    if (MX.nav.depth()) { MX.nav.pop(); return true; }
    if (tab !== 'music') { setTab('music'); return true; }
    return false;
  };

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    const d = e.data; if (!d || d.type !== 'theme' || !d.vars) return;
    const r = document.documentElement;
    Object.entries(d.vars).forEach(([k, v]) => { if (/^--[a-z0-9-]+$/i.test(k) && typeof v === 'string' && v.length < 120) r.style.setProperty(k, v); });
  });

  /* ── boot ──────────────────────────────────────────────── */
  function connectPrompt() {
    $('#paneMusic').innerHTML = `<div class="section"><div class="empty"><div class="ico">${icon('heart')}</div><h3>Connect with your partner</h3><p>Music and recordings are shared between the two of you. Finish pairing in the app and they'll appear here.</p></div></div>`;
  }
  async function boot() {
    setTab((function () { try { return (['music','recs'].includes(sessionStorage.getItem('mx_home_tab')) ? sessionStorage.getItem('mx_home_tab') : 'music'); } catch (e) { return 'music'; } })());
    let ctx = MX.ctx(), tries = 0;
    while (!ctx && tries++ < 40) { await new Promise((r) => setTimeout(r, 250)); ctx = MX.ctx(); }
    if (!ctx) { connectPrompt(); return; }

    // paint instantly from the last session's cache (works offline), then refresh
    const cs = MX.cache.get('songs', null);
    if (cs) { S.songs = cs; S.loaded.songs = true; }
    const cp = MX.cache.get('playlists', null); if (cp) { S.playlists = cp; S.loaded.playlists = true; }
    const cr = MX.cache.get('recs', null); if (cr) { S.recordings = cr; S.loaded.recordings = true; }
    MX.emit('library'); MX.emit('playlists'); MX.emit('recordings');

    await MX.data.loadSongs(true);
    A.restore();
    MX.data.loadPlaylists(); MX.data.loadRecordings();
    MX.rt.start(); MX.offline.verify();
    if (MX.settings.get('autoLyrics') && window.LyricsBackgroundWorker && window.LyricsManager) {
      // quietly queue lyric searches for songs that never had one (a couple at a time, never blocking playback)
      setTimeout(() => { S.songs.filter((s) => !s.has_lyrics && !s.lyrics_cached).slice(0, 6).forEach((s) => { try { window.LyricsBackgroundWorker.enqueue(s, ctx.coupleId); } catch (e) {} }); }, 4000);
    }
  }
  // keep the ripple of "something changed" flowing to open screens that don't self-subscribe
  ['library', 'playlists', 'recordings', 'downloads'].forEach((e) => MX.on(e, () => MX.nav.update(e)));
  boot();
})();
