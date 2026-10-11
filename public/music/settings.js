/* ═══════════════════════════════════════════════════════════════
   MUSIC · settings
   Only settings that actually do something are listed here.
   Device-level (like every music app): crossfade, lyrics, normalisation,
   vocal reduction, offline storage. Library/recordings actions hit the server.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const MX = window.MX, S = MX.S, Lib = MX.lib, A = window.AudioService;
  const esc = MX.esc, icon = MX.icon;

  const toggle = (key, ico, title, sub) => `<button class="set-row" data-act="set-toggle" data-k="${key}">${icon(ico)}<div class="st"><b>${title}</b><span>${sub}</span></div><span class="switch${MX.settings.get(key) ? ' on' : ''}"></span></button>`;
  const link = (act, ico, title, sub, val, cls) => `<button class="set-row${cls ? ' ' + cls : ''}" data-act="${act}">${icon(ico)}<div class="st"><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}</div>${val ? `<span class="val">${esc(val)}</span>` : ''}${cls ? '' : icon('right')}</button>`;

  /* computed from live data — nothing to persist, so nothing re-toasts on every launch */
  function milestones() {
    const songs = S.songs, mine = Lib.mine().length, part = Lib.partner().length;
    return [
      ['🎵', 'First Note', songs.length >= 1], ['🎶', 'Growing Collection', songs.length >= 5], ['🎸', 'Music Lover', songs.length >= 10],
      ['❤️', 'Fan', songs.some((s) => s.liked)], ['💕', 'True Fan', songs.filter((s) => s.liked).length >= 5], ['👫', 'Our Soundtrack', mine >= 1 && part >= 1],
      ['💞', 'Same Taste', songs.some((s) => s.liked && s.partner_liked)], ['📜', 'Poet', songs.some((s) => s.has_lyrics)],
      ['🎙', 'On Air', S.recordings.some((r) => r.user_id === MX.role())], ['🎤', 'Stage Star', S.recordings.some((r) => r.kind === 'karaoke' && r.user_id === MX.role())],
      ['🔥', 'On Repeat', songs.reduce((n, s) => n + (s.my_play_count || 0), 0) >= 50],
    ];
  }

  MX.nav.register('settings', (el) => {
    const render = () => {
      const cf = +MX.settings.get('crossfade') || 0; const dlN = MX.offline.count(), dlB = MX.offline.bytes();
      const ms = milestones(); const got = ms.filter((m) => m[2]).length;
      el.innerHTML = MX.hdr('Music Settings') + `<div class="wrap" style="padding-top:4px">
        <div class="set-group"><h4>Playback</h4><div class="set-card">
          ${link('set-crossfade', 'sliders', 'Crossfade', 'Smooth transition between songs', cf ? cf + ' s' : 'Off')}
          ${toggle('autoLyrics', 'lyrics', 'Find lyrics automatically', 'Look up lyrics as songs play')}
          ${toggle('normalize', 'volume', 'Normalise volume', 'Keep loud and quiet songs even')}
          ${link('open-fx', 'sparkles', 'Sound effects', 'Bass, treble, reverb, echo', '')}
        </div></div>
        <div class="set-group"><h4>Karaoke</h4><div class="set-card">
          ${toggle('vocalReduce', 'mic', 'Vocal reduction', 'Fades the lead vocal on stereo tracks')}
        </div></div>
        <div class="set-group"><h4>Library</h4><div class="set-card">
          ${link('add-songs', 'plus', 'Add songs', 'Import from this device', '')}
          ${link('set-sync', 'refresh', 'Sync now', 'Refresh songs, playlists and recordings', '')}
          ${link('set-lyrics-lib', 'fileText', 'Lyrics library', 'See songs missing lyrics and refresh them', '')}
        </div></div>
        <div class="set-group"><h4>Storage</h4><div class="set-card">
          <div class="set-row">${icon('download')}<div class="st"><b>Downloaded music</b><span>${dlN} song${dlN === 1 ? '' : 's'} saved for offline</span></div><span class="val">${MX.fmtBytes(dlB)}</span></div>
          ${link('set-clear-dl', 'trash', 'Clear downloaded content', 'Removes offline copies — your songs stay in the library', '', 'danger')}
          ${link('set-del-recs', 'trash', 'Delete all my recordings', 'Removes every voice, video and karaoke take you made', '', 'danger')}
        </div></div>
        <div class="set-group"><h4>Milestones · ${got}/${ms.length}</h4><div class="set-card"><div class="ach">${ms.map(([e, n, on]) => `<div class="${on ? 'on' : ''}"><b>${e}</b>${esc(n)}</div>`).join('')}</div></div></div>
      </div>`;
    };
    render();
    const offs = ['settings', 'downloads', 'library', 'recordings'].map((e) => MX.on(e, render));
    return { destroy: () => offs.forEach((f) => f()) };
  });

  MX.act('open-settings', () => MX.nav.push('settings'));
  MX.act('set-toggle', (d) => {
    const k = d.k; MX.settings.set(k, !MX.settings.get(k));
    if (k === 'autoLyrics' && MX.settings.get(k)) { const s = A.currentSong(); if (s) MX.lyrics.load(s); }
  });
  MX.act('set-crossfade', () => {
    const cur = +MX.settings.get('crossfade') || 0;
    const sh = MX.sheet(`<h3>Crossfade</h3><p class="msg">Overlap the end of one song with the start of the next. Turned off while a video-call karaoke room is open.</p>
      <div class="set-slider"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px"><span>Off</span><b id="cfV">${cur ? cur + ' seconds' : 'Off'}</b><span>12 s</span></div><input type="range" id="cfR" min="0" max="12" step="1" value="${cur}" style="width:100%;accent-color:var(--mx-red)"></div>
      <div class="row2"><button class="btn primary" data-d="1">Done</button></div>`);
    sh.$('#cfR').addEventListener('input', (e) => { const v = +e.target.value; sh.$('#cfV').textContent = v ? v + ' seconds' : 'Off'; MX.settings.set('crossfade', v); });
    sh.el.addEventListener('click', (e) => { if (e.target.closest('[data-d]')) sh.close(); });
  });
  MX.act('set-sync', async () => { MX.toast('Syncing…'); await MX.data.loadAll(); MX.toast('Up to date ✓'); });
  MX.act('set-lyrics-lib', () => { if (window.openLyricsAdminDashboard) window.openLyricsAdminDashboard(); else MX.toast('Not ready yet'); });
  MX.act('set-clear-dl', async () => {
    if (!MX.offline.count()) { MX.toast('Nothing downloaded'); return; }
    if (await MX.confirm({ title: 'Clear downloaded music?', message: MX.offline.count() + ' offline copies (' + MX.fmtBytes(MX.offline.bytes()) + ') will be removed from this device. Your songs stay in the library.', confirm: 'Clear', danger: true })) { await MX.offline.clear(); MX.toast('Downloads cleared'); }
  });
  MX.act('set-del-recs', async () => {
    const mine = S.recordings.filter((r) => r.user_id === MX.role()); if (!mine.length) { MX.toast('You have no recordings'); return; }
    if (!(await MX.confirm({ title: 'Delete all your recordings?', message: mine.length + ' recording' + (mine.length > 1 ? 's' : '') + ' (including karaoke takes) will be permanently deleted. ' + MX.names().partner + "'s recordings are not affected.", confirm: 'Delete all', danger: true }))) return;
    const c = MX.ctx();
    try { const r = await MX.api('DELETE', '/api/recordings/' + encodeURIComponent(c.coupleId) + '/mine', { userId: c.role }); S.recordings = S.recordings.filter((x) => x.user_id !== c.role); MX.emit('recordings'); MX.rt.ping('recordings'); MX.toast(r.deleted + ' recordings deleted'); }
    catch (e) { MX.toast('Could not delete — ' + e.message); }
  });
})();
