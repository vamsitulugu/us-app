/* ═══════════════════════════════════════════════════════════════
   MUSIC · library screens
   Home (Music tab), library lists (My / Partner / Liked), recently played,
   custom playlists, "Made for Us" smart mixes, search, song menu,
   add-to-playlist, song details, upload entry point.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const MX = window.MX, S = MX.S, Lib = MX.lib, A = () => window.AudioService;
  const esc = MX.esc, icon = MX.icon;

  /* ── row rendering ─────────────────────────────────────── */
  /* ctx = list key used when a row is tapped ("my", "partner", "liked", "recent", "all", "pl:<id>", "mix:<id>", "ids:a,b,c") */
  function row(s, ctx, opts) {
    opts = opts || {};
    const cur = A().currentSong(); const isCur = cur && String(cur.id) === String(s.id);
    const dl = MX.offline.has(s), prog = MX.offline.progress[s.id];
    const offlineBlocked = !MX.online() && !dl;
    const mine = Lib.isMine(s);
    const sub = [s.artist || 'Unknown Artist'];
    return `<div class="trk${isCur ? ' current' : ''}${offlineBlocked ? ' unavailable' : ''}" data-act="play-song" data-id="${esc(s.id)}" data-ctx="${esc(ctx)}" data-song="${esc(s.id)}">
      ${MX.cover(s, 's')}
      <div class="trk-main">
        <div class="trk-title ellip">${esc(s.title)}</div>
        <div class="trk-sub"><span class="eq"><i></i><i></i><i></i></span><span class="ellip">${esc(sub.join(' · '))}</span>
          ${dl ? '<span class="badge dl">Saved</span>' : prog != null ? `<span class="badge">${Math.round(prog * 100)}%</span>` : ''}
          ${!mine && opts.showOwner ? `<span class="badge">${esc(MX.names().partner)}</span>` : ''}
          ${s.visibility === 'my' && mine ? `<span class="badge">${icon('lock')}</span>` : ''}</div>
      </div>
      <div class="trk-end">
        ${opts.dur === false ? '' : `<span class="trk-dur">${MX.fmt(s.duration_sec)}</span>`}
        ${opts.heart === false ? '' : `<button class="heart${s.liked ? ' on' : ''}" data-act="like" data-id="${esc(s.id)}" aria-label="Like">${icon('heart')}</button>`}
        ${opts.remove ? `<button class="dots" data-act="pl-remove" data-id="${esc(s.id)}" aria-label="Remove">${icon('x')}</button>`
          : `<button class="dots" data-act="song-menu" data-id="${esc(s.id)}" data-ctx="${esc(ctx)}" aria-label="More">${icon('more')}</button>`}
      </div>
    </div>`;
  }
  MX.row = row;
  const isMobileUI = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '') || (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) || window.matchMedia('(max-width: 820px)').matches;
  const skeleton = (n) => isMobileUI() ? '<div class="mx-spinner-wrap"><div class="mx-spinner"></div></div>' : Array.from({ length: n || 5 }, () => '<div class="skel-row"><div class="skel" style="width:44px;height:44px"></div><div style="flex:1"><div class="skel" style="height:12px;width:60%;margin-bottom:8px"></div><div class="skel" style="height:10px;width:35%"></div></div></div>').join('');
  const emptyBlock = (ico, title, msg, btn) => `<div class="empty"><div class="ico">${icon(ico)}</div><h3>${esc(title)}</h3><p>${msg}</p>${btn || ''}</div>`;

  /* Resolve a list key to songs (so a tap always plays "the list you were looking at"). */
  function listFor(ctx) {
    if (!ctx) return S.songs;
    if (ctx === 'my') return Lib.mine(); if (ctx === 'partner') return Lib.partner();
    if (ctx === 'liked') return Lib.liked(); if (ctx === 'recent') return Lib.recent(); if (ctx === 'all') return S.songs;
    if (ctx.startsWith('pl:')) { const p = S.playlists.find((x) => x.id === ctx.slice(3)); return p ? Lib.playlistSongs(p) : []; }
    if (ctx.startsWith('mix:')) return mixById(ctx.slice(4)).songs;
    if (ctx.startsWith('ids:')) return ctx.slice(4).split(',').map(Lib.byId).filter(Boolean);
    return S.songs;
  }
  MX.listFor = listFor;
  const orderedFor = (ctx, key) => (ctx === 'my' || ctx === 'partner' || ctx === 'liked') ? Lib.sort(listFor(ctx), key || MX.settings.get('sort')) : listFor(ctx);

  /* ── actions: playing ──────────────────────────────────── */
  MX.act('play-song', (d) => {
    const song = Lib.byId(d.id); if (!song) return;
    if (!MX.online() && !MX.offline.has(song)) { MX.toast("You're offline — download songs to play them offline"); return; }
    const list = orderedFor(d.ctx, d.sort).filter((s) => MX.online() || MX.offline.has(s));
    A().play(list.length ? list : [song], song.id);
    MX.haptic();
  });
  MX.act('like', (d) => { const s = Lib.byId(d.id); if (s) MX.data.toggleLike(s); });
  MX.act('play-list', (d) => {
    const list = orderedFor(d.ctx).filter((s) => MX.online() || MX.offline.has(s));
    if (!list.length) { MX.toast('Nothing to play yet'); return; }
    if (d.shuffle) A().playShuffled(list); else { A().setShuffle(false); A().play(list, list[0].id); }
  });

  /* ═══════════════════════════════════════════════════════
     SMART MIXES — "Made for Us"
     Computed from real listening data, never invented.
  ═══════════════════════════════════════════════════════ */
  function mixes() {
    const out = []; const me = MX.names().me, pn = MX.names().partner;
    const all = S.songs; if (!all.length) return out;
    out.push({ id: 'ours', name: 'Our Mix', sub: 'Everything we love', songs: MX.shuffleArray(all), ico: 'sparkles' });
    const both = all.filter((s) => s.liked && s.partner_liked);
    if (both.length) out.push({ id: 'both', name: 'Loved by Both', sub: both.length + ' songs we both ♥', songs: both, ico: 'heart' });
    const pl = all.filter((s) => s.partner_liked && !s.liked);
    if (pl.length) out.push({ id: 'theirs', name: pn + "'s Favourites", sub: pl.length + ' songs', songs: pl, ico: 'user' });
    const top = all.filter((s) => (s.my_play_count || 0) > 1).sort((a, b) => b.my_play_count - a.my_play_count).slice(0, 25);
    if (top.length >= 3) out.push({ id: 'repeat', name: 'On Repeat', sub: 'Your most played', songs: top, ico: 'refresh' });
    const fresh = all.filter((s) => Date.now() - MX.ts(s.created_at) < 14 * 864e5);
    if (fresh.length) out.push({ id: 'new', name: 'New Together', sub: 'Added in the last 2 weeks', songs: Lib.sort(fresh, 'added'), ico: 'plus' });
    const lyr = all.filter((s) => s.has_lyrics);
    if (lyr.length >= 3) out.push({ id: 'sing', name: 'Sing Along', sub: 'Songs with lyrics ready', songs: lyr, ico: 'mic' });
    return out;
  }
  const mixById = (id) => mixes().find((m) => m.id === id) || { id, name: 'Mix', songs: [] };
  function artGrid(songs, ico) {
    const covers = songs.filter((s) => s.cover_url).slice(0, 4);
    if (!covers.length) return `<div class="mix-ico">${icon(ico || 'music')}</div>`;
    if (covers.length < 4) return `<img src="${esc(covers[0].cover_url)}" alt="" loading="lazy">`;
    return covers.map((s) => `<img src="${esc(s.cover_url)}" alt="" loading="lazy">`).join('');
  }
  const mixCard = (m) => `<button class="mix" data-act="open-mix" data-id="${esc(m.id)}"><div class="mix-art${m.songs.filter((s) => s.cover_url).length >= 4 ? '' : ' single'}">${artGrid(m.songs, m.ico)}<div class="mix-name">${esc(m.name)}</div></div><div class="mix-sub ellip">${esc(m.sub)}</div></button>`;
  const plCard = (p) => { const songs = Lib.playlistSongs(p); return `<button class="mix" data-act="open-playlist" data-id="${esc(p.id)}"><div class="mix-art${songs.filter((s) => s.cover_url).length >= 4 ? '' : ' single'}">${artGrid(songs, 'queue')}<div class="mix-name">${esc(p.name)}</div></div><div class="mix-sub">${songs.length} song${songs.length === 1 ? '' : 's'}</div></button>`; };

  /* ═══════════════════════════════════════════════════════
     HOME — Music tab
  ═══════════════════════════════════════════════════════ */
  function homeMusic(el) {
    const names = MX.names();
    const render = () => {
      if (!S.loaded.songs) { el.innerHTML = `<div class="section">${skeleton(6)}</div>`; return; }
      const songs = S.songs;
      const banner = !MX.online() ? `<div class="banner" style="margin:0 0 12px">${icon('wifiOff')}<span>You're offline — downloaded songs still play.</span></div>` : '';
      if (!songs.length) {
        el.innerHTML = `<div class="section">${banner}<div class="hero"><div><h2>Music brings us closer</h2><p>Add your first song and share it with ${esc(names.partner)}.</p></div></div>
          ${emptyBlock('music', 'Your library is empty', 'Upload songs from your phone. We\'ll read the title, artist and artwork automatically, and look up synced lyrics in the background.',
            `<button class="btn primary" data-act="add-songs">${icon('plus')} Add songs</button>`)}</div>`;
        return;
      }
      const recent = Lib.recent(4);
      const mx = mixes().slice(0, 8);
      const lists = S.playlists.slice(-8).reverse();
      const hero = Lib.recent(1)[0] || songs.find((s) => s.cover_url);
      el.innerHTML = `<div class="section">${banner}
        <div class="hero">${hero && hero.cover_url ? `<div class="hero-art" style="background-image:url('${esc(hero.cover_url)}')"></div>` : ''}
          <div><h2>Music brings<br>us closer</h2><p>Listen together, sing together, feel together.</p></div>
          <button class="hero-play" data-act="play-list" data-ctx="all" data-shuffle="1" aria-label="Play">${icon('play')}</button></div>
        <div class="tiles">
          <button class="tile" data-act="open-library" data-tab="my"><span class="tile-ico">${icon('music')}</span>My Playlist<span class="n">${Lib.mine().length}</span></button>
          <button class="tile" data-act="open-library" data-tab="partner"><span class="tile-ico">${icon('heart')}</span>Partner<span class="n">${Lib.partner().length}</span></button>
          <button class="tile" data-act="open-karaoke"><span class="tile-ico">${icon('mic')}</span>Karaoke<span class="n">${songs.filter((s) => s.has_lyrics).length} ready</span></button>
          <button class="tile" data-act="sing-together"><span class="tile-ico">${icon('video')}</span>Sing Together<span class="n">&nbsp;</span></button>
        </div>
        ${recent.length ? `<div class="section-h"><h2>Recently Played</h2><button class="link" data-act="open-recent">See All ${icon('right')}</button></div><div class="list">${recent.map((s) => row(s, 'recent')).join('')}</div>` : ''}
        <div class="section-h"><h2>Quick Actions</h2></div>
        <div class="quick">
          <button class="tile accent" data-act="play-list" data-ctx="all"><span class="tile-ico">${icon('play')}</span>Play All</button>
          <button class="tile" data-act="play-list" data-ctx="all" data-shuffle="1"><span class="tile-ico">${icon('shuffle')}</span>Shuffle</button>
          <button class="tile" data-act="download-all"><span class="tile-ico">${icon('download')}</span>Download</button>
          <button class="tile" data-act="open-search"><span class="tile-ico">${icon('search')}</span>Search</button><button class="tile accent" data-act="search-online"><span class="tile-ico">🌐</span>Search Online</button>
        </div>
        ${mx.length ? `<div class="section-h"><h2>Made for Us</h2></div><div class="hscroll">${mx.map(mixCard).join('')}</div>` : ''}
        <div class="section-h"><h2>Our Playlists</h2>${S.playlistsAvailable ? `<button class="link" data-act="new-playlist">New ${icon('plus')}</button>` : ''}</div>
        ${S.playlistsAvailable ? `<div class="hscroll">${lists.map(plCard).join('')}<button class="mix new" data-act="new-playlist"><div class="mix-art">${icon('plus')}</div><div class="mix-sub">New playlist</div></button></div>`
          : `<div class="banner">${icon('info')}<span>Playlists need a one-time database update (migrations/music_v2.sql).</span></div>`}
      </div>`;
    };
    render();
    if (window.LyricsPreFetch) window.LyricsPreFetch.warmUp(S.songs);
    const evs = ['library', 'playlists', 'downloads', 'connectivity'];
    const offs = evs.map((e) => MX.on(e, () => render()));
    A().on('track', () => render());
    return { destroy() { offs.forEach((f) => f()); } };
  }
  MX.homeMusic = homeMusic;

  MX.act('open-library', (d) => MX.nav.push('library', { tab: d.tab || 'my' }));
  MX.act('open-recent', () => MX.nav.push('recent'));
  MX.act('open-search', () => MX.nav.push('search'));
  MX.act('open-karaoke', () => MX.nav.push('karaoke'));
  MX.act('open-mix', (d) => MX.nav.push('mix', { id: d.id }));
  MX.act('open-playlist', (d) => MX.nav.push('playlist', { id: d.id }));
  MX.act('download-all', async () => {
    if (!MX.offline.supported()) { MX.toast("Downloads aren't supported in this browser"); return; }
    const todo = S.songs.filter((s) => !MX.offline.has(s));
    if (!todo.length) { MX.toast('Everything is already downloaded'); return; }
    const est = todo.reduce((n, s) => n + (s.file_size || (s.duration_sec || 200) * 16000), 0);
    const ok = await MX.confirm({ title: 'Download ' + todo.length + ' song' + (todo.length > 1 ? 's' : '') + '?', message: 'About ' + MX.fmtBytes(est) + ' will be saved on this device so you can listen offline.', confirm: 'Download' });
    if (ok) MX.offline.downloadMany(todo);
  });
  MX.act('sing-together', () => {
    if (!window.CoupleKaraoke) { MX.toast('Sing Together is still loading…'); return; }
    const songs = S.songs.filter((s) => s.has_lyrics !== false);
    if (!songs.length) { MX.toast('Add a song first 🎵'); return; }
    const cur = A().currentSong();
    MX.pickSong({ title: 'Choose a song to sing together', subtitle: 'We\'ll invite ' + MX.names().partner + ' to join you on video', list: songs, selected: cur && cur.id }).then((s) => { if (s) CoupleKaraoke.sendInviteById(s.id); });
  });

  /* ═══════════════════════════════════════════════════════
     LIBRARY — My Playlist / Partner Playlist / Liked Songs
  ═══════════════════════════════════════════════════════ */
  const LIB_TABS = [['my', 'My Playlist'], ['partner', 'Partner Playlist'], ['liked', 'Liked Songs']];
  MX.nav.register('library', (el, params) => {
    let tab = params.tab || 'my', q = '';
    el.innerHTML = MX.hdr('Playlists', `<button class="icon-btn" data-act="lib-search" aria-label="Search">${icon('search')}</button><button class="icon-btn primary" data-act="add-songs" aria-label="Add songs">${icon('plus')}</button><button class="icon-btn accent" data-act="search-online" aria-label="Search Online">🌐</button>`) +
      `<div class="tabs compact" id="libTabs">${LIB_TABS.map(([k, l]) => `<button class="tab" data-act="lib-tab" data-tab="${k}">${l}</button>`).join('')}</div>
       <div id="libSearchWrap"></div><div class="section" id="libBody"></div>`;
    const body = el.querySelector('#libBody');
    const render = () => {
      el.querySelectorAll('#libTabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
      if (!S.loaded.songs) { body.innerHTML = skeleton(7); return; }
      const sortKey = MX.settings.get('sort');
      let base = Lib.sort(listFor(tab), sortKey);
      if (q) { const hit = new Set(Lib.search(q).map((s) => s.id)); base = base.filter((s) => hit.has(s.id)); }
      const total = Lib.totalSec(base);
      let head = '';
      if (tab === 'partner') {
        const pn = MX.names().partner;
        head = `<div class="hero" style="min-height:104px"><div><h2 style="font-size:21px">${esc(pn)}'s Playlist</h2><p>Songs ${esc(pn)} shared with you ♥</p></div>${base.length ? `<button class="hero-play" data-act="play-list" data-ctx="partner" aria-label="Play">${icon('play')}</button>` : ''}</div>`;
      }
      const tools = base.length ? `<div class="list-tools"><button class="btn primary" data-act="play-list" data-ctx="${tab}" data-shuffle="1">${icon('shuffle')} Shuffle Play</button>
        <button class="btn ghost" data-act="sort-menu">${icon('sort')} Sort</button></div>
        <div class="mix-sub" style="margin:0 2px 6px">${base.length} song${base.length === 1 ? '' : 's'} · ${MX.fmtLong(total)}</div>` : '';
      let list;
      if (!base.length) {
        const msg = q ? emptyBlock('search', 'No matches', 'Nothing in this list matches “' + esc(q) + '”.')
          : tab === 'my' ? emptyBlock('music', 'Nothing here yet', 'Songs you add show up here, and ' + esc(MX.names().partner) + ' can listen too.', `<button class="btn primary" data-act="add-songs">${icon('plus')} Add songs</button>`)
          : tab === 'partner' ? emptyBlock('heart', 'No songs from ' + esc(MX.names().partner) + ' yet', 'When they add a song and share it, it appears here.')
          : emptyBlock('heart', 'No liked songs', 'Tap the heart on any song to keep it here.');
        list = msg;
      } else list = `<div class="list">${base.map((s) => row(s, tab, { showOwner: tab === 'liked' })).join('')}</div>`;
      body.innerHTML = head + tools + list;
    };
    render();
    const offs = ['library', 'downloads', 'connectivity'].map((e) => MX.on(e, render));
    const ctl = {
      events: [], destroy() { offs.forEach((f) => f()); delete MX._libCtl; },
      setTab(t) { tab = t; render(); }, toggleSearch() {
        const w = el.querySelector('#libSearchWrap');
        if (w.innerHTML) { w.innerHTML = ''; q = ''; render(); return; }
        w.innerHTML = `<div class="searchbar">${icon('search')}<input id="libQ" type="search" placeholder="Search this playlist" autocomplete="off"></div>`;
        const inp = w.querySelector('input'); inp.focus(); inp.addEventListener('input', MX.debounce(() => { q = inp.value; render(); }, 150));
      }, rerender: render,
    };
    MX._libCtl = ctl; return ctl;
  });
  MX.act('lib-tab', (d) => MX._libCtl && MX._libCtl.setTab(d.tab));
  MX.act('lib-search', () => MX._libCtl && MX._libCtl.toggleSearch());
  MX.act('sort-menu', () => {
    const cur = MX.settings.get('sort');
    MX.menu('<h3>Sort by</h3>', Object.entries(Lib.sorters).map(([k, v]) => ({ ico: k === cur ? 'check' : 'sort', label: v.label, on: k === cur, run: () => { MX.settings.set('sort', k); MX._libCtl && MX._libCtl.rerender(); } })));
  });

  /* Recently played */
  MX.nav.register('recent', (el) => {
    el.innerHTML = MX.hdr('Recently Played') + '<div class="section" id="rb"></div>';
    const body = el.querySelector('#rb');
    const render = () => { const l = Lib.recent(60); body.innerHTML = l.length ? `<div class="list">${l.map((s) => row(s, 'recent')).join('')}</div>` : emptyBlock('clock', 'Nothing played yet', 'Songs you listen to will show up here.'); };
    render(); const offs = ['library', 'downloads'].map((e) => MX.on(e, render));
    return { destroy: () => offs.forEach((f) => f()) };
  });

  /* Smart mix */
  MX.nav.register('mix', (el, params) => {
    const m0 = mixById(params.id); const frozen = m0.songs.map((s) => s.id).join(',');
    el.innerHTML = MX.hdr(m0.name, '', m0.sub) + '<div class="section" id="mb"></div>';
    const body = el.querySelector('#mb');
    const render = () => {
      const list = m0.songs.map((s) => Lib.byId(s.id)).filter(Boolean);
      body.innerHTML = list.length ? `<div class="list-tools"><button class="btn primary" data-act="play-list" data-ctx="ids:${esc(frozen)}">${icon('play')} Play</button><button class="btn ghost" data-act="play-list" data-ctx="ids:${esc(frozen)}" data-shuffle="1">${icon('shuffle')} Shuffle</button></div>
        <div class="list">${list.map((s) => row(s, 'ids:' + frozen, { showOwner: true })).join('')}</div>` : emptyBlock('music', 'Empty mix', 'This mix fills up as you listen and like songs.');
    };
    render(); const offs = ['library', 'downloads'].map((e) => MX.on(e, render));
    return { destroy: () => offs.forEach((f) => f()) };
  });

  /* ═══════════════════════════════════════════════════════
     CUSTOM PLAYLISTS
  ═══════════════════════════════════════════════════════ */
  MX.nav.register('playlist', (el, params) => {
    const id = params.id;
    const pl = () => S.playlists.find((p) => p.id === id);
    el.innerHTML = MX.hdr('Playlist', `<button class="icon-btn" data-act="pl-menu" data-id="${esc(id)}" aria-label="More">${icon('more')}</button>`) + '<div class="section" id="pb"></div>';
    const body = el.querySelector('#pb'); let editing = false;
    const render = () => {
      const p = pl(); if (!p) { MX.nav.pop(); return; }
      el.querySelector('h1').firstChild.textContent = p.name;
      const songs = Lib.playlistSongs(p); const ctx = 'pl:' + p.id;
      body.innerHTML = `<div class="hero" style="min-height:112px"><div><h2 style="font-size:22px">${esc(p.name)}</h2><p>${songs.length} song${songs.length === 1 ? '' : 's'} · ${MX.fmtLong(Lib.totalSec(songs))}</p></div>${songs.length ? `<button class="hero-play" data-act="play-list" data-ctx="${esc(ctx)}" aria-label="Play">${icon('play')}</button>` : ''}</div>
        <div class="list-tools"><button class="btn primary" data-act="pl-add" data-id="${esc(p.id)}">${icon('plus')} Add songs</button>
        ${songs.length > 1 ? `<button class="btn ghost" data-act="play-list" data-ctx="${esc(ctx)}" data-shuffle="1">${icon('shuffle')} Shuffle</button>` : ''}</div>
        ${songs.length ? `<div class="list">${songs.map((s, i) => `<div class="pl-item" data-sid="${esc(s.id)}">${row(s, ctx, { remove: editing, heart: !editing })}</div>`).join('')}</div>` :
          emptyBlock('queue', 'Empty playlist', 'Add songs from your library to start it off.', `<button class="btn primary" data-act="pl-add" data-id="${esc(p.id)}">${icon('plus')} Add songs</button>`)}`;
    };
    render();
    const offs = ['library', 'playlists', 'downloads'].map((e) => MX.on(e, render));
    return { destroy: () => offs.forEach((f) => f()), toggleEdit() { editing = !editing; render(); }, get editing() { return editing; }, id };
  });
  const activePlaylistCtl = () => { const t = MX.nav.top(); return t && t.name === 'playlist' ? t.ctl : null; };
  MX.act('pl-remove', async (d) => { const c = activePlaylistCtl(); if (!c) return; const p = S.playlists.find((x) => x.id === c.id); if (p) await MX.data.removeFromPlaylist(p, d.id); });
  MX.act('pl-menu', (d) => {
    const p = S.playlists.find((x) => x.id === d.id); if (!p) return; const c = activePlaylistCtl();
    MX.menu(`<h3>${esc(p.name)}</h3>`, [
      { ico: 'play', label: 'Play', run: () => { const l = Lib.playlistSongs(p); if (l.length) A().play(l, l[0].id); } },
      { ico: 'shuffle', label: 'Shuffle', run: () => { const l = Lib.playlistSongs(p); if (l.length) A().playShuffled(l); } },
      { ico: 'listPlus', label: 'Add songs', run: () => pickForPlaylist(p) },
      { ico: 'edit', label: 'Rename', run: async () => { const n = await MX.prompt({ title: 'Rename playlist', value: p.name, label: 'Name', max: 60 }); if (n) MX.data.renamePlaylist(p, n); } },
      { ico: 'sort', label: c && c.editing ? 'Done editing' : 'Remove songs', run: () => c && c.toggleEdit() },
      { ico: 'trash', label: 'Delete playlist', danger: true, run: async () => { if (await MX.data.deletePlaylist(p)) MX.nav.pop(); } },
    ]);
  });
  MX.act('pl-add', (d) => { const p = S.playlists.find((x) => x.id === d.id); if (p) pickForPlaylist(p); });
  async function pickForPlaylist(p) {
    const inPl = new Set(p.song_ids.map(String));
    const picks = await MX.pickSongs({ title: 'Add to ' + p.name, list: S.songs, disabled: inPl, confirm: 'Add' });
    if (picks && picks.length) { const r = await MX.data.addToPlaylist(p, picks.map((s) => s.id)); if (r) MX.toast('Added ' + r.added + ' song' + (r.added === 1 ? '' : 's')); }
  }
  MX.act('new-playlist', async () => {
    if (!S.playlistsAvailable) { MX.toast('Playlists need a quick database update — see migrations/music_v2.sql'); return; }
    const name = await MX.prompt({ title: 'New playlist', label: 'Name', placeholder: 'Road trip, Sunday morning…', confirm: 'Create', max: 60 }); if (!name) return;
    const pl = await MX.data.createPlaylist(name, []); if (pl) { MX.nav.push('playlist', { id: pl.id }); }
  });

  /* ── add to playlist (from a song) ─────────────────────── */
  MX.addToPlaylistMenu = function (song) {
    const rows = S.playlists.map((p) => ({ ico: p.song_ids.map(String).includes(String(song.id)) ? 'check' : 'queue', label: p.name, hint: p.song_ids.length + '', on: p.song_ids.map(String).includes(String(song.id)),
      run: async () => { if (p.song_ids.map(String).includes(String(song.id))) { MX.toast('Already in ' + p.name); return; } const r = await MX.data.addToPlaylist(p, [song.id]); if (r) MX.toast('Added to ' + p.name); } }));
    MX.menu(`<h3>Add to playlist</h3>`, [{ ico: 'plus', label: 'New playlist', run: async () => {
      if (!S.playlistsAvailable) { MX.toast('Playlists need a quick database update'); return; }
      const name = await MX.prompt({ title: 'New playlist', label: 'Name', confirm: 'Create', max: 60 }); if (!name) return;
      const pl = await MX.data.createPlaylist(name, [song.id]); if (pl) MX.toast('Added to ' + pl.name); } }, ...rows]);
  };

  /* ── multi-select song picker ──────────────────────────── */
  MX.pickSongs = function (o) {
    return new Promise((resolve) => {
      const sel = new Set(); let result = null; let q = '';
      const list = o.list || S.songs; const disabled = o.disabled || new Set();
      const s = MX.sheet(`<h3>${esc(o.title || 'Choose songs')}</h3><div class="searchbar" style="margin:0 0 10px;max-width:none">${icon('search')}<input id="psQ" type="search" placeholder="Search" autocomplete="off"></div>
        <div id="psList" style="max-height:48vh;overflow-y:auto"></div><div class="row2"><button class="btn ghost" data-k="no">Cancel</button><button class="btn primary" data-k="yes" id="psOk">${esc(o.confirm || 'Done')}</button></div>`,
        { onClose: () => resolve(result) });
      const listEl = s.$('#psList');
      const draw = () => {
        const items = q ? list.filter((x) => Lib.norm([x.title, x.artist].join(' ')).includes(Lib.norm(q))) : list;
        listEl.innerHTML = items.length ? items.map((x) => `<div class="trk${disabled.has(String(x.id)) ? ' unavailable' : ''}" data-pick="${esc(x.id)}">${MX.cover(x, 's')}<div class="trk-main"><div class="trk-title ellip">${esc(x.title)}</div><div class="trk-sub ellip">${esc(x.artist || '')}</div></div>
          <span class="check${sel.has(String(x.id)) || disabled.has(String(x.id)) ? ' on' : ''}">${sel.has(String(x.id)) || disabled.has(String(x.id)) ? icon('check') : ''}</span></div>`).join('') : '<div class="empty"><p>No songs found</p></div>';
        s.$('#psOk').textContent = (o.confirm || 'Done') + (sel.size ? ' (' + sel.size + ')' : '');
      };
      draw();
      s.$('#psQ').addEventListener('input', MX.debounce((e) => { q = e.target.value; draw(); }, 120));
      s.el.addEventListener('click', (e) => {
        const r = e.target.closest('[data-pick]');
        if (r) { const id = r.dataset.pick; if (disabled.has(id)) return; sel.has(id) ? sel.delete(id) : sel.add(id); draw(); return; }
        const b = e.target.closest('[data-k]'); if (!b) return;
        if (b.dataset.k === 'yes') result = list.filter((x) => sel.has(String(x.id)));
        s.close();
      });
    });
  };
  MX.pickSong = function (o) {
    return new Promise((resolve) => {
      let result = null; let q = '';
      const s = MX.sheet(`<h3>${esc(o.title || 'Choose a song')}</h3>${o.subtitle ? `<p class="msg">${esc(o.subtitle)}</p>` : ''}<div class="searchbar" style="margin:0 0 10px;max-width:none">${icon('search')}<input id="psQ" type="search" placeholder="Search" autocomplete="off"></div><div id="psList" style="max-height:52vh;overflow-y:auto"></div>`, { onClose: () => resolve(result) });
      const listEl = s.$('#psList');
      const draw = () => { const items = q ? o.list.filter((x) => Lib.norm([x.title, x.artist].join(' ')).includes(Lib.norm(q))) : o.list;
        listEl.innerHTML = items.map((x) => `<div class="trk${String(x.id) === String(o.selected) ? ' current' : ''}" data-pick="${esc(x.id)}">${MX.cover(x, 's')}<div class="trk-main"><div class="trk-title ellip">${esc(x.title)}</div><div class="trk-sub ellip">${esc(x.artist || '')}</div></div></div>`).join('') || '<div class="empty"><p>No songs found</p></div>'; };
      draw(); s.$('#psQ').addEventListener('input', MX.debounce((e) => { q = e.target.value; draw(); }, 120));
      s.el.addEventListener('click', (e) => { const r = e.target.closest('[data-pick]'); if (!r) return; result = o.list.find((x) => String(x.id) === r.dataset.pick) || null; s.close(); });
    });
  };

  /* ═══════════════════════════════════════════════════════
     SONG MENU, DETAILS, EDIT
  ═══════════════════════════════════════════════════════ */
  MX.songMenu = function (song, ctx) {
    if (!song) return; const mine = Lib.isMine(song); const dl = MX.offline.has(song);
    const head = `<div class="sheet-head">${MX.cover(song, 'm')}<div style="min-width:0"><div class="t ellip">${esc(song.title)}</div><div class="s ellip">${esc(song.artist || 'Unknown Artist')}</div></div></div>`;
    MX.menu(head, [
      { ico: 'play', label: 'Play', run: () => MX.act && document.dispatchEvent(new CustomEvent('mx-play', { detail: { id: song.id, ctx } })) },
      { ico: 'next', label: 'Play next', run: () => { A().addToQueue([song.id], { next: true }); MX.toast('Will play next'); } },
      { ico: 'queue', label: 'Add to queue', run: () => { A().addToQueue([song.id]); MX.toast('Added to queue'); } },
      { ico: 'heart', label: song.liked ? 'Remove from liked' : 'Add to liked', on: song.liked, run: () => MX.data.toggleLike(song) },
      { ico: 'listPlus', label: 'Add to playlist', run: () => MX.addToPlaylistMenu(song) },
      { ico: dl ? 'check' : 'download', label: dl ? 'Remove download' : 'Download for offline', on: dl, run: () => (dl ? MX.offline.remove(song) : MX.offline.download(song)) },
      { ico: 'mic', label: 'Sing with lyrics', run: () => MX.sing.open(song) },
      { ico: 'video', label: 'Sing together (video)', run: () => window.CoupleKaraoke ? CoupleKaraoke.sendInviteById(song.id) : MX.toast('Not ready yet') },
      { ico: 'lyrics', label: 'Lyrics', run: () => MX.player.openLyrics(song) },
      { ico: 'info', label: 'Song details', run: () => MX.songDetails(song) },
      { ico: 'share', label: 'Share', run: () => MX.share('🎵 ' + song.title + ' — ' + (song.artist || '')) },
      mine ? { ico: 'edit', label: 'Edit details', run: () => MX.songEdit(song) } : null,
      mine ? { ico: 'trash', label: 'Delete song', danger: true, run: () => MX.data.deleteSong(song) } : null,
    ]);
  };
  document.addEventListener('mx-play', (e) => { const d = e.detail; const s = Lib.byId(d.id); if (!s) return; const l = orderedFor(d.ctx).filter((x) => MX.online() || MX.offline.has(x)); A().play(l.length ? l : [s], s.id); });
  MX.act('song-menu', (d) => MX.songMenu(Lib.byId(d.id), d.ctx));

  MX.songDetails = function (s) {
    const names = MX.names(); const rows = [
      ['Title', s.title], ['Artist', s.artist], ['Album', s.album], ['Genre', s.genre], ['Year', s.year], ['Duration', MX.fmt(s.duration_sec)],
      ['Added by', Lib.isMine(s) ? 'You' : names.partner], ['Added', MX.date(s.created_at)], ['Your plays', s.my_play_count || 0],
      ['Lyrics', s.has_lyrics ? (s.lyrics_source ? 'Ready · ' + s.lyrics_source : 'Ready') : 'Not found yet'], ['Offline', MX.offline.has(s) ? 'Downloaded' : 'Streaming'],
      ['Visible to', s.visibility === 'my' ? 'Only the person who added it' : s.visibility === 'partner' ? 'Dedicated to partner' : 'Both of us'],
    ].filter((r) => r[1] !== undefined && r[1] !== null && r[1] !== '');
    MX.sheet(`<div class="sheet-head">${MX.cover(s, 'l')}<div style="min-width:0"><div class="t">${esc(s.title)}</div><div class="s">${esc(s.artist || '')}</div></div></div>` +
      rows.map(([k, v]) => `<div class="set-row" style="padding:10px 4px"><div class="st"><span>${esc(k)}</span><b style="font-weight:500">${esc(v)}</b></div></div>`).join(''));
  };
  MX.songEdit = function (s) {
    const sh = MX.sheet(`<h3>Edit song</h3>
      <div class="field"><label>Title</label><input id="seT" value="${esc(s.title)}" maxlength="200"></div>
      <div class="field"><label>Artist</label><input id="seA" value="${esc(s.artist || '')}" maxlength="200"></div>
      <div class="field"><label>Album</label><input id="seB" value="${esc(s.album || '')}" maxlength="200"></div>
      <div class="field"><label>Visibility</label><select id="seV"><option value="both">Both of us</option><option value="my">Only me</option><option value="partner">Dedicated to partner</option></select></div>
      <div class="row2"><button class="btn ghost" data-k="no">Cancel</button><button class="btn primary" data-k="yes">Save</button></div>`, { modal: true });
    sh.$('#seV').value = s.visibility || 'both';
    sh.el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-k]'); if (!b) return; if (b.dataset.k === 'no') { sh.close(); return; }
      const title = sh.$('#seT').value.trim(); if (!title) { MX.toast('Title can\'t be empty'); return; }
      b.disabled = true;
      try { await MX.data.updateSong(s, { title, artist: sh.$('#seA').value.trim() || 'Unknown Artist', album: sh.$('#seB').value.trim() || null, visibility: sh.$('#seV').value }); MX.toast('Saved'); sh.close(); }
      catch (err) { MX.toast(err.message); b.disabled = false; }
    });
  };

  /* ═══════════════════════════════════════════════════════
     ADD SONGS — hands files to the existing import pipeline
     (reads tags + artwork, finds lyrics, de-duplicates, uploads).
  ═══════════════════════════════════════════════════════ */
  MX.act('search-online', async () => {
    if (!MX.ctx()) { MX.toast('Connect with your partner first'); return; }
    if (!MX.online()) { MX.toast("You're offline — connect to search"); return; }
    if (window.MusicSearch) window.MusicSearch.open();
  });

  MX.act('add-songs', async () => {
    if (!MX.ctx()) { MX.toast('Connect with your partner first'); return; }
    if (!MX.online()) { MX.toast("You're offline — connect to add songs"); return; }
    // ══ Pro gate ══ adding songs is a Pro feature
    if (window.ProCard) {
      const ok = await window.ProCard.requirePro('Music');
      if (!ok) return; // Pro upgrade card is now open
    }
    const inp = document.getElementById('fileIn'); if (inp) { inp.value = ''; inp.click(); }
  });
  document.addEventListener('change', (e) => {
    if (e.target.id !== 'fileIn') return;
    if (window.ImportService && window.ImportService.enqueueFiles) window.ImportService.enqueueFiles(e.target.files, e.target);
    else MX.toast('The importer is still loading — try again in a moment');
  });

  /* ═══════════════════════════════════════════════════════
     SEARCH — songs (title / artist / album / lyrics), playlists
  ═══════════════════════════════════════════════════════ */
  MX.nav.register('search', (el) => {
    let q = ''; const recents = MX.cache.get('recentSearches', []);
    el.innerHTML = MX.hdr('Search') + `<div class="searchbar">${icon('search')}<input id="gq" type="search" placeholder="Songs, artists, playlists, lyrics" autocomplete="off"><button id="gx" class="hidden" aria-label="Clear">${icon('x')}</button></div><div class="section" id="gb"></div>`;
    const inp = el.querySelector('#gq'), body = el.querySelector('#gb'), clr = el.querySelector('#gx');
    const render = () => {
      clr.classList.toggle('hidden', !q);
      if (!q.trim()) {
        const r = MX.cache.get('recentSearches', []);
        body.innerHTML = r.length ? `<div class="section-h"><h2>Recent</h2><button class="link" data-act="clear-recents">Clear</button></div><div class="chips" style="padding:0;flex-wrap:wrap">${r.map((x) => `<button class="chip" data-act="use-query" data-q="${esc(x)}">${esc(x)}</button>`).join('')}</div>`
          : emptyBlock('search', 'Find anything', 'Search by song title, artist, album, or even a line from the lyrics.'); return;
      }
      const songs = Lib.search(q);
      const norm = Lib.norm(q).trim();
      const byLyrics = norm.length >= 3 ? S.songs.filter((s) => !songs.includes(s) && s.lyrics && Lib.norm(s.lyrics).includes(norm)) : [];
      const pls = S.playlists.filter((p) => Lib.norm(p.name).includes(norm));
      const recs = S.recordings.filter((r) => Lib.norm(r.title).includes(norm));
      const none = !songs.length && !pls.length && !byLyrics.length && !recs.length;
      body.innerHTML = none ? emptyBlock('search', 'No results', 'Nothing matches “' + esc(q) + '”.') :
        (songs.length ? `<div class="section-h"><h2>Songs</h2></div><div class="list">${songs.slice(0, 40).map((s) => row(s, 'ids:' + songs.map((x) => x.id).join(','), { showOwner: true })).join('')}</div>` : '') +
        (byLyrics.length ? `<div class="section-h"><h2>In the lyrics</h2></div><div class="list">${byLyrics.slice(0, 15).map((s) => row(s, 'all')).join('')}</div>` : '') +
        (pls.length ? `<div class="section-h"><h2>Playlists</h2></div><div class="hscroll">${pls.map(plCard).join('')}</div>` : '') +
        (recs.length ? `<div class="section-h"><h2>Recordings</h2></div><div class="list">${recs.slice(0, 8).map((r) => MX.recRow ? MX.recRow(r) : '').join('')}</div>` : '');
    };
    const saveQ = MX.debounce(() => { const t = q.trim(); if (t.length < 2) return; const r = [t, ...MX.cache.get('recentSearches', []).filter((x) => x !== t)].slice(0, 8); MX.cache.set('recentSearches', r); }, 1200);
    inp.addEventListener('input', MX.debounce(() => { q = inp.value; render(); saveQ(); }, 120));
    clr.addEventListener('click', () => { inp.value = ''; q = ''; render(); inp.focus(); });
    render(); setTimeout(() => inp.focus(), 280);
    // lyrics of every song are only searchable once downloaded; fetch quietly in the background
    S.songs.filter((s) => s.has_lyrics && s.lyrics === undefined).slice(0, 40).forEach((s) => MX.data.ensureFullSong(s).then(() => { if (q) render(); }));
    const offs = ['library', 'playlists', 'recordings'].map((e) => MX.on(e, render));
    MX._searchCtl = { set(v) { inp.value = v; q = v; render(); } };
    return { destroy: () => offs.forEach((f) => f()) };
  });
  MX.act('use-query', (d) => MX._searchCtl && MX._searchCtl.set(d.q));
  MX.act('clear-recents', () => { MX.cache.del('recentSearches'); MX._searchCtl && MX._searchCtl.set(''); });
})();
