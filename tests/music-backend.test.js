const { makeApp, db, storage, missingTables, rpcCalls } = require('./support/test-server');
const assert = require('assert');
let passed = 0, failed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); } };

(async () => {
  const server = makeApp().listen(0); const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, body) => { const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, body: j }; };
  const C = 'couple1';
  const audio = (n) => `https://proj.supabase.co/storage/v1/object/public/couple-music/${C}/${n}.mp3`;
  const cover = (n) => `https://proj.supabase.co/storage/v1/object/public/couple-music-covers/${C}/${n}.jpg`;
  storage['couple-music'] = new Map([[`${C}/a1.mp3`, {}], [`${C}/a2.mp3`, {}], [`${C}/a3.mp3`, {}]]);
  storage['couple-music-covers'] = new Map([[`${C}/shared.jpg`, {}]]);

  console.log('SONGS');
  let s1, s2, s3;
  await t('create validates audio URL belongs to the couple', async () => {
    const r = await call('POST', '/api/music', { coupleId: C, title: 'X', audioUrl: 'https://evil.com/a.mp3', uploadedBy: 'user1' });
    assert.equal(r.status, 400);
  });
  await t('create song (public, with lyrics)', async () => {
    const r = await call('POST', '/api/music', { coupleId: C, title: 'Kesariya', artist: 'Arijit', audioUrl: audio('a1'), coverUrl: cover('shared'), uploadedBy: 'user1', visibility: 'both', lyrics: '[00:01.00] hi', lyricsCached: true });
    assert.equal(r.status, 200); s1 = r.body; assert.ok(s1.id); assert.equal(s1.has_lyrics, true);
  });
  await t('create private song by user1', async () => {
    const r = await call('POST', '/api/music', { coupleId: C, title: 'Secret', audioUrl: audio('a2'), coverUrl: cover('shared'), uploadedBy: 'user1', visibility: 'my' });
    assert.equal(r.status, 200); s2 = r.body;
  });
  await t('create song by user2', async () => {
    const r = await call('POST', '/api/music', { coupleId: C, title: 'Balam', audioUrl: audio('a3'), uploadedBy: 'user2', visibility: 'partner' });
    assert.equal(r.status, 200); s3 = r.body;
  });
  await t('list hides partner private songs, owner sees them', async () => {
    const a = await call('GET', `/api/music/${C}?viewer=user2`);
    assert.deepEqual(a.body.map((x) => x.title).sort(), ['Balam', 'Kesariya']);
    const b = await call('GET', `/api/music/${C}?viewer=user1`);
    assert.equal(b.body.length, 3);
    const c = await call('GET', `/api/music/${C}`);
    assert.equal(c.body.length, 2, 'no viewer => no private songs');
  });
  await t('list omits lyrics body but reports has_lyrics; ?full=1 includes it', async () => {
    const a = await call('GET', `/api/music/${C}?viewer=user1`);
    const k = a.body.find((x) => x.title === 'Kesariya'); assert.equal(k.lyrics, undefined); assert.equal(k.has_lyrics, true);
    const f = await call('GET', `/api/music/${C}?viewer=user1&full=1`);
    assert.ok(f.body.find((x) => x.title === 'Kesariya').lyrics.includes('hi'));
  });
  await t('single song endpoint returns lyrics and enforces visibility', async () => {
    const ok = await call('GET', `/api/music/song/${s1.id}?coupleId=${C}&viewer=user2`); assert.ok(ok.body.lyrics.includes('hi'));
    const no = await call('GET', `/api/music/song/${s2.id}?coupleId=${C}&viewer=user2`); assert.equal(no.status, 404);
    const wrong = await call('GET', `/api/music/song/${s1.id}?coupleId=other&viewer=user1`); assert.equal(wrong.status, 404);
  });

  console.log('LIKES / PLAYS (migration applied)');
  await t('likes are per-partner', async () => {
    await call('PUT', `/api/music/${s1.id}/like`, { coupleId: C, viewer: 'user2', liked: true });
    const a = (await call('GET', `/api/music/${C}?viewer=user2`)).body.find((x) => x.id === s1.id);
    const b = (await call('GET', `/api/music/${C}?viewer=user1`)).body.find((x) => x.id === s1.id);
    assert.equal(a.liked, true); assert.equal(a.partner_liked, false);
    assert.equal(b.liked, false); assert.equal(b.partner_liked, true);
  });
  await t('unlike works; bad body rejected', async () => {
    await call('PUT', `/api/music/${s1.id}/like`, { coupleId: C, viewer: 'user2', liked: false });
    assert.equal((await call('GET', `/api/music/${C}?viewer=user2`)).body.find((x) => x.id === s1.id).liked, false);
    assert.equal((await call('PUT', `/api/music/${s1.id}/like`, { coupleId: C, viewer: 'user2' })).status, 400);
  });
  await t('cannot like a partner private song', async () => {
    assert.equal((await call('PUT', `/api/music/${s2.id}/like`, { coupleId: C, viewer: 'user2', liked: true })).status, 404);
  });
  await t('plays counted per user + total (rpc)', async () => {
    await call('POST', `/api/music/${s1.id}/play`, { coupleId: C, viewer: 'user2' });
    await call('POST', `/api/music/${s1.id}/play`, { coupleId: C, viewer: 'user2' });
    await call('POST', `/api/music/${s1.id}/play`, { coupleId: C, viewer: 'user1' });
    const a = (await call('GET', `/api/music/${C}?viewer=user2`)).body.find((x) => x.id === s1.id);
    const b = (await call('GET', `/api/music/${C}?viewer=user1`)).body.find((x) => x.id === s1.id);
    assert.equal(a.my_play_count, 2); assert.equal(b.my_play_count, 1);
    assert.equal(db.songs.find((x) => x.id === s1.id).play_count, 3);
  });
  await t('play falls back when rpc is missing', async () => {
    db.__noRpc = true; await call('POST', `/api/music/${s1.id}/play`, { coupleId: C, viewer: 'user1' });
    assert.equal(db.songs.find((x) => x.id === s1.id).play_count, 4); db.__noRpc = false;
  });

  console.log('PATCH permissions');
  await t('partner cannot edit title, but can add lyrics', async () => {
    assert.equal((await call('PATCH', `/api/music/${s1.id}`, { coupleId: C, viewer: 'user2', title: 'Hacked' })).status, 403);
    const r = await call('PATCH', `/api/music/${s1.id}`, { coupleId: C, viewer: 'user2', lyrics: '[00:02.00] new' });
    assert.equal(r.status, 200); assert.ok(r.body.lyrics.includes('new'));
  });
  await t('uploader can edit; invalid visibility rejected; empty patch rejected', async () => {
    assert.equal((await call('PATCH', `/api/music/${s1.id}`, { coupleId: C, viewer: 'user1', title: 'Kesariya (Remix)' })).body.title, 'Kesariya (Remix)');
    assert.equal((await call('PATCH', `/api/music/${s1.id}`, { coupleId: C, viewer: 'user1', visibility: 'weird' })).status, 400);
    assert.equal((await call('PATCH', `/api/music/${s1.id}`, { coupleId: C, viewer: 'user1' })).status, 400);
  });

  console.log('PLAYLISTS');
  let pl;
  await t('create playlist with songs (foreign ids ignored)', async () => {
    const r = await call('POST', '/api/music/playlists', { coupleId: C, viewer: 'user1', name: 'Road trip', songIds: [s1.id, s3.id, 'nope'] });
    assert.equal(r.status, 200); pl = r.body; assert.deepEqual(pl.song_ids, [s1.id, s3.id]);
  });
  await t('list playlists', async () => {
    const r = await call('GET', `/api/music/${C}/playlists`); assert.equal(r.body.available, true); assert.equal(r.body.playlists[0].song_ids.length, 2);
  });
  await t('add songs: dedupes and appends', async () => {
    const r = await call('POST', `/api/music/playlists/${pl.id}/songs`, { coupleId: C, viewer: 'user2', songIds: [s1.id, s2.id] });
    assert.equal(r.body.added, 1); assert.equal(r.body.alreadyIn, 1);
  });
  await t('reorder + remove', async () => {
    await call('PUT', `/api/music/playlists/${pl.id}/order`, { coupleId: C, songIds: [s2.id, s3.id, s1.id] });
    let r = await call('GET', `/api/music/${C}/playlists`); assert.deepEqual(r.body.playlists[0].song_ids, [s2.id, s3.id, s1.id]);
    await call('DELETE', `/api/music/playlists/${pl.id}/songs/${s3.id}`, { coupleId: C });
    r = await call('GET', `/api/music/${C}/playlists`); assert.deepEqual(r.body.playlists[0].song_ids, [s2.id, s1.id]);
  });
  await t('rename; other couple cannot touch it', async () => {
    assert.equal((await call('PATCH', `/api/music/playlists/${pl.id}`, { coupleId: C, name: 'Drive' })).body.name, 'Drive');
    assert.equal((await call('PATCH', `/api/music/playlists/${pl.id}`, { coupleId: 'zzz', name: 'x' })).status, 404);
  });

  console.log('DELETE song');
  await t('partner cannot delete my song', async () => {
    assert.equal((await call('DELETE', `/api/music/${s1.id}`, { coupleId: C, viewer: 'user2' })).status, 403);
  });
  await t('delete cleans files, state, playlist rows; shared cover kept while another song uses it', async () => {
    const r = await call('DELETE', `/api/music/${s1.id}`, { coupleId: C, viewer: 'user1' }); assert.equal(r.status, 200);
    assert.equal(storage['couple-music'].has(`${C}/a1.mp3`), false, 'audio removed');
    assert.equal(storage['couple-music-covers'].has(`${C}/shared.jpg`), true, 'shared cover kept (Secret still uses it)');
    assert.equal(db.music_user_state.filter((x) => x.song_id === String(s1.id)).length, 0);
    const pls = (await call('GET', `/api/music/${C}/playlists`)).body.playlists[0]; assert.ok(!pls.song_ids.includes(s1.id));
    await call('DELETE', `/api/music/${s2.id}`, { coupleId: C, viewer: 'user1' });
    assert.equal(storage['couple-music-covers'].has(`${C}/shared.jpg`), false, 'last user gone → cover removed');
  });
  await t('deleting twice is idempotent', async () => {
    assert.equal((await call('DELETE', `/api/music/${s1.id}`, { coupleId: C, viewer: 'user1' })).body.ok, true);
  });
  await t('delete playlist', async () => {
    await call('DELETE', `/api/music/playlists/${pl.id}`, { coupleId: C });
    assert.equal((await call('GET', `/api/music/${C}/playlists`)).body.playlists.length, 0);
    assert.equal(db.music_playlist_songs.length, 0);
  });

  console.log('GRACEFUL FALLBACK (migration NOT applied)');
  ['music_user_state', 'music_playlists', 'music_playlist_songs'].forEach((x) => missingTables.add(x));
  await t('list still works; liked falls back to songs.favorite', async () => {
    const r = await call('GET', `/api/music/${C}?viewer=user2`); assert.equal(r.status, 200); assert.equal(r.body[0].liked, false);
    await call('PUT', `/api/music/${s3.id}/like`, { coupleId: C, viewer: 'user2', liked: true });
    assert.equal((await call('GET', `/api/music/${C}?viewer=user2`)).body[0].liked, true);
  });
  await t('playlists report unavailable instead of crashing', async () => {
    assert.equal((await call('GET', `/api/music/${C}/playlists`)).body.available, false);
    assert.equal((await call('POST', '/api/music/playlists', { coupleId: C, viewer: 'user1', name: 'x' })).status, 503);
  });
  missingTables.clear();
  // clear the in-route "down" memo by waiting is too slow; restart app instance modules instead
  Object.keys(require.cache).filter((k) => k.includes('/us-app/routes/')).forEach((k) => delete require.cache[k]);
  server.close();
  const server2 = makeApp().listen(0); const base2 = `http://127.0.0.1:${server2.address().port}`;
  const call2 = async (m, p, body) => { const r = await fetch(base2 + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, body: j }; };

  console.log('RECORDINGS');
  await t('create recording rejects foreign storage path; accepts karaoke kind', async () => {
    const bad = await call2('POST', '/api/recordings', { coupleId: C, userId: 'user1', mediaType: 'audio', mediaUrl: 'https://x', storagePath: 'other/x.webm' });
    assert.equal(bad.status, 400);
    const ok = await call2('POST', '/api/recordings', { coupleId: C, userId: 'user1', title: 'Karaoke – Balam', mediaType: 'audio', mediaUrl: 'https://x', storagePath: `${C}/r1.webm`, kind: 'karaoke', songId: 's3' });
    assert.equal(ok.status, 200); assert.equal(ok.body.kind, 'karaoke');
  });
  await t('create recording falls back when migration columns are missing', async () => {
    db.__recordingsLegacy = true;
    const ok = await call2('POST', '/api/recordings', { coupleId: C, userId: 'user2', title: 'Voice', mediaType: 'audio', mediaUrl: 'https://x', storagePath: `${C}/r2.webm`, kind: 'karaoke' });
    assert.equal(ok.status, 200); db.__recordingsLegacy = false;
  });
  await t('bulk delete only removes caller\'s recordings + files', async () => {
    storage['couple-recordings'] = new Map([[`${C}/r1.webm`, {}], [`${C}/r2.webm`, {}]]);
    const r = await call2('DELETE', `/api/recordings/${C}/mine`, { userId: 'user1' });
    assert.equal(r.body.deleted, 1);
    assert.equal(storage['couple-recordings'].has(`${C}/r1.webm`), false); assert.equal(storage['couple-recordings'].has(`${C}/r2.webm`), true);
    assert.equal(db.personal_recordings.length, 1);
    assert.equal((await call2('DELETE', `/api/recordings/${C}/mine`, { userId: 'bad' })).status, 400);
  });

  console.log('AUDIO UPLOAD');
  const up = async (name, type, bytes) => { const fd = new FormData(); fd.append('coupleId', C); fd.append('file', new Blob([bytes], { type }), name); const r = await fetch(base2 + '/api/media/upload-audio', { method: 'POST', body: fd }); return { status: r.status, body: await r.json() }; };
  await t('accepts mp3/m4a (even with octet-stream), stores audio content-type', async () => {
    const a = await up('song.mp3', 'audio/mpeg', 'abc'); assert.equal(a.status, 200); assert.ok(a.body.url.includes(`/couple-music/${C}/`));
    const b = await up('song.m4a', 'application/octet-stream', 'abc'); assert.equal(b.status, 200);
    const stored = [...storage['couple-music'].entries()].find(([k]) => k === b.body.path)[1]; assert.equal(stored.contentType, 'audio/mp4');
  });
  await t('rejects html / script disguised as audio, and empty files', async () => {
    assert.equal((await up('x.html', 'text/html', '<script>')).status, 415);
    assert.equal((await up('x.mp3', 'text/html', '<script>')).status, 415);
    assert.equal((await up('empty.mp3', 'audio/mpeg', '')).status, 400);
  });

  server2.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
