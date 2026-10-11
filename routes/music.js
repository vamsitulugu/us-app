// ═══════════════════════════════════════════════════════
//  Music Routes — songs, per-user listening state, shared playlists.
//  Mounted at /api/music (server.js).
//
//  Trust model (same as every other route in this app): `coupleId` scopes
//  every query, and `viewer` ('user1' | 'user2') says which partner is asking.
//
//  What this file guarantees:
//   · GET  /:coupleId            — never returns the partner's private songs
//                                  ('my' / 'self' / 'private' visibility)
//                                  and ships a light payload (no lyrics body)
//                                  unless ?full=1
//   · PUT  /:id/like             — per-partner likes (not one shared flag)
//   · POST /:id/play             — per-partner play counts + listening history
//   · PATCH/DELETE               — only the uploader may edit metadata or
//                                  delete; either partner may add lyrics
//   · DELETE                     — also removes the audio/cover files from
//                                  storage and every row that points at the
//                                  song (likes, playlists, cached lyrics), so
//                                  nothing is orphaned
//   · playlists                  — shared, ordered, couple-scoped
//
//  New tables live in migrations/music_v2.sql. If it has not been applied
//  yet every endpoint degrades gracefully (likes fall back to songs.favorite,
//  playlists report available:false) instead of failing.
// ═══════════════════════════════════════════════════════
const express  = require('express');
const supabase = require('../middleware/supabase');
const { pathFromPublicUrl, removeObjects } = require('../lib/storage');
const router   = express.Router();

let _sendPushToPartner;
try { _sendPushToPartner = require('./auth').sendPushToPartner; } catch (_) {}

const ROLES        = ['user1', 'user2'];
const PRIVATE_VIS  = ['my', 'self', 'private'];
const VISIBILITIES = ['both', 'my', 'partner'];
const AUDIO_BUCKET = 'couple-music';
const COVER_BUCKET = 'couple-music-covers';
const MAX_LYRICS   = 200 * 1024;

// ── small helpers ───────────────────────────────────────
const okRole   = (r) => (ROLES.includes(r) ? r : null);
const otherOf  = (r) => (r === 'user1' ? 'user2' : 'user1');
const str      = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : v);
const int      = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : null; };
const isIdish  = (v) => typeof v === 'string' && v.length > 0 && v.length <= 80 && !/[\s,()'"]/.test(v);

function visibleTo(row, viewer) {
  if (viewer && row.uploaded_by === viewer) return true;
  return !PRIVATE_VIS.includes(row.visibility);
}

// Tables from migrations/music_v2.sql may not exist yet. Remember that for a
// minute so we don't hammer the DB with queries that are known to fail.
const downUntil = {};
const isMissing = (err) => !!err && /42P01|PGRST205|PGRST200|does not exist|schema cache|could not find/i.test(`${err.code || ''} ${err.message || ''}`);
const isDown    = (name) => !!downUntil[name] && Date.now() < downUntil[name];
function markIfMissing(name, err) {
  if (isMissing(err)) { downUntil[name] = Date.now() + 60 * 1000; return true; }
  return false;
}

async function getSong(songId, coupleId) {
  const { data, error } = await supabase.from('songs').select('*').eq('id', songId).eq('couple_id', coupleId).maybeSingle();
  if (error) throw error;
  return data || null;
}

// ── shaping rows for the client ─────────────────────────
function shapeSong(row, viewer, stateBySong, stateAvailable, full) {
  const { lyrics, lyrics_native, lyrics_latin, ...rest } = row;
  const out = full ? { ...row } : rest;
  out.has_lyrics = !!(row.lyrics_cached || (typeof lyrics === 'string' && lyrics.trim()));
  if (stateAvailable) {
    const mine    = (stateBySong[row.id] || {})[viewer] || {};
    const partner = (stateBySong[row.id] || {})[otherOf(viewer)] || {};
    out.liked               = !!mine.is_liked;
    out.partner_liked       = !!partner.is_liked;
    out.my_play_count       = mine.play_count || 0;
    out.my_last_played      = mine.last_played || null;
    out.partner_last_played = partner.last_played || null;
  } else {
    out.liked               = !!row.favorite;
    out.partner_liked       = false;
    out.my_play_count       = row.play_count || 0;
    out.my_last_played      = row.last_played || null;
    out.partner_last_played = null;
  }
  return out;
}

async function loadStateMap(coupleId) {
  if (isDown('userState')) return { map: {}, available: false };
  const { data, error } = await supabase.from('music_user_state').select('*').eq('couple_id', coupleId);
  if (error) {
    if (markIfMissing('userState', error)) return { map: {}, available: false };
    throw error;
  }
  const map = {};
  (data || []).forEach((r) => { (map[r.song_id] = map[r.song_id] || {})[r.user_id] = r; });
  return { map, available: true };
}

// ═══════════════════════════════════════════════════════
//  SONGS
// ═══════════════════════════════════════════════════════

// GET one song with its full lyrics body (the list endpoint omits it).
// Declared before '/:coupleId/...' routes so 'song' is never read as a coupleId.
router.get('/song/:id', async (req, res) => {
  const { coupleId } = req.query;
  const viewer = okRole(req.query.viewer);
  if (!coupleId) return res.status(400).json({ error: 'coupleId required' });
  try {
    const row = await getSong(req.params.id, coupleId);
    if (!row || !visibleTo(row, viewer)) return res.status(404).json({ error: 'Song not found' });
    const { map, available } = await loadStateMap(coupleId);
    return res.json(shapeSong(row, viewer, map, available, true));
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// GET all songs visible to `viewer`
router.get('/:coupleId', async (req, res) => {
  const viewer = okRole(req.query.viewer);
  const full   = req.query.full === '1' || req.query.full === 'true';
  try {
    const { data, error } = await supabase.from('songs').select('*')
      .eq('couple_id', req.params.coupleId).order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const { map, available } = await loadStateMap(req.params.coupleId);
    const rows = (data || []).filter((r) => visibleTo(r, viewer)).map((r) => shapeSong(r, viewer, map, available, full));
    return res.json(rows);
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// POST create song metadata (call AFTER audio+cover are uploaded to storage)
router.post('/', async (req, res) => {
  const b = req.body || {};
  const coupleId   = b.coupleId;
  const uploadedBy = okRole(b.uploadedBy);
  const title      = str(b.title, 200);
  const audioUrl   = typeof b.audioUrl === 'string' ? b.audioUrl : '';

  if (!coupleId || !title || !audioUrl || !uploadedBy) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  // The audio must be a file this couple uploaded through /api/media/upload-audio.
  if (!/^https:\/\//i.test(audioUrl) || !pathFromPublicUrl(audioUrl, AUDIO_BUCKET, coupleId)) {
    return res.status(400).json({ error: 'audioUrl must point to this couple\'s uploaded audio' });
  }
  if (b.coverUrl && !/^https:\/\//i.test(b.coverUrl)) {
    return res.status(400).json({ error: 'coverUrl must be an https URL' });
  }
  const visibility = VISIBILITIES.includes(b.visibility) ? b.visibility : 'both';
  if (typeof b.lyrics === 'string' && b.lyrics.length > MAX_LYRICS) {
    return res.status(413).json({ error: 'Lyrics are too long' });
  }

  const row = {
    couple_id:    coupleId,
    title,
    artist:       str(b.artist, 200) || 'Unknown Artist',
    audio_url:    audioUrl,
    cover_url:    b.coverUrl || null,
    duration_sec: int(b.durationSec) || 0,
    lyrics:       b.lyrics || '',
    visibility,
    uploaded_by:  uploadedBy,
    album:            str(b.album, 200) || null,
    album_artist:     str(b.albumArtist, 200) || null,
    composer:         str(b.composer, 200) || null,
    genre:            str(b.genre, 80) || null,
    year:             b.year || null,
    track:            b.track || null,
    disc:             b.disc || null,
    duration_ms:      b.durationMs || null,
    bitrate:          b.bitrate || null,
    file_size:        b.fileSize || null,
    lyrics_cached:    !!b.lyricsCached,
    lyrics_source:    b.lyricsSource || null,
    lyrics_updated_at: b.lyricsUpdatedAt || null,
    raw_title:          b.rawTitle || null,
    clean_title:        b.cleanTitle || null,
    raw_artist:         b.rawArtist || null,
    clean_artist:       b.cleanArtist || null,
    raw_album:          b.rawAlbum || null,
    clean_album:        b.cleanAlbum || null,
    raw_album_artist:   b.rawAlbumArtist || null,
    clean_album_artist: b.cleanAlbumArtist || null,
  };

  const { data, error } = await supabase.from('songs').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });

  if (_sendPushToPartner && !PRIVATE_VIS.includes(visibility)) {
    _sendPushToPartner(coupleId, uploadedBy, {
      title: '🎵 New Song Shared',
      body: title + (row.artist && row.artist !== 'Unknown Artist' ? ' — ' + row.artist : ''),
      icon: '/icons/icon-192.png',
      tag: 'music-song',
      url: '/?page=music'
    }).catch(() => {});
  }

  const { map, available } = await loadStateMap(coupleId).catch(() => ({ map: {}, available: false }));
  return res.json(shapeSong(data, uploadedBy, map, available, true));
});

// Fields only the uploader may change vs. fields either partner may change.
const META_FIELDS = {
  title: 'title', artist: 'artist', visibility: 'visibility', coverUrl: 'cover_url',
  album: 'album', albumArtist: 'album_artist', composer: 'composer', genre: 'genre',
  year: 'year', track: 'track', disc: 'disc', durationMs: 'duration_ms', durationSec: 'duration_sec',
  bitrate: 'bitrate', fileSize: 'file_size',
  rawTitle: 'raw_title', cleanTitle: 'clean_title', rawArtist: 'raw_artist', cleanArtist: 'clean_artist',
  rawAlbum: 'raw_album', cleanAlbum: 'clean_album', rawAlbumArtist: 'raw_album_artist', cleanAlbumArtist: 'clean_album_artist',
};

// PATCH update a song
router.patch('/:id', async (req, res) => {
  const { coupleId, viewer: rawViewer, ...fields } = req.body || {};
  const viewer = okRole(rawViewer);
  if (!coupleId) return res.status(400).json({ error: 'coupleId required' });

  let song;
  try { song = await getSong(req.params.id, coupleId); }
  catch (e) { return res.status(500).json({ error: e.message }); }
  if (!song || !visibleTo(song, viewer)) return res.status(404).json({ error: 'Song not found' });

  const updates = {};
  const metaKeys = Object.keys(META_FIELDS).filter((k) => fields[k] !== undefined);
  if (metaKeys.length) {
    if (!viewer || song.uploaded_by !== viewer) {
      return res.status(403).json({ error: 'Only the person who added this song can edit it' });
    }
    metaKeys.forEach((k) => { updates[META_FIELDS[k]] = fields[k]; });
    if (updates.title !== undefined) { updates.title = str(updates.title, 200); if (!updates.title) return res.status(400).json({ error: 'Title cannot be empty' }); }
    if (updates.artist !== undefined) updates.artist = str(updates.artist, 200) || 'Unknown Artist';
    if (updates.visibility !== undefined && !VISIBILITIES.includes(updates.visibility)) return res.status(400).json({ error: 'Invalid visibility' });
  }

  // Lyrics are collaborative — either partner can add them.
  if (fields.lyrics !== undefined) {
    const text = typeof fields.lyrics === 'string' ? fields.lyrics : '';
    if (text.length > MAX_LYRICS) return res.status(413).json({ error: 'Lyrics are too long' });
    updates.lyrics            = text;
    updates.lyrics_cached     = !!text.trim();
    updates.lyrics_source     = text.trim() ? (fields.lyricsSource || 'manual') : null;
    updates.lyrics_updated_at = new Date().toISOString();
    // Hand-written lyrics supersede any provider copy, including its
    // transliteration, so the old text never resurfaces from the cache.
    updates.lyrics_native = text;
    updates.lyrics_latin  = null;
    Promise.resolve(supabase.from('cached_lyrics').delete().eq('song_id', String(req.params.id))).then(() => {}, () => {});
  }

  // Legacy shared favourite flag (kept so old clients and the fallback path work).
  if (fields.favorite !== undefined) updates.favorite = !!fields.favorite;

  if (fields.incrementPlay) await recordPlay(song, viewer).catch(() => {});

  if (!Object.keys(updates).length) {
    if (fields.incrementPlay) return res.json({ ok: true });
    return res.status(400).json({ error: 'Nothing to update' });
  }

  const { data, error } = await supabase.from('songs').update(updates)
    .eq('id', req.params.id).eq('couple_id', coupleId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// PUT like / unlike — per partner
router.put('/:id/like', async (req, res) => {
  const { coupleId, liked } = req.body || {};
  const viewer = okRole(req.body && req.body.viewer);
  if (!coupleId || !viewer || typeof liked !== 'boolean') {
    return res.status(400).json({ error: 'coupleId, viewer and liked are required' });
  }
  try {
    const song = await getSong(req.params.id, coupleId);
    if (!song || !visibleTo(song, viewer)) return res.status(404).json({ error: 'Song not found' });

    if (!isDown('userState')) {
      const { data: prev, error: pErr } = await supabase.from('music_user_state')
        .select('is_liked').eq('song_id', String(song.id)).eq('user_id', viewer).maybeSingle();
      if (!pErr || !markIfMissing('userState', pErr)) {
        const { error } = await supabase.from('music_user_state').upsert({
          couple_id: coupleId, song_id: String(song.id), user_id: viewer,
          is_liked: liked, liked_at: liked ? new Date().toISOString() : null,
        }, { onConflict: 'song_id,user_id' });
        if (error) return res.status(500).json({ error: error.message });

        // A little love note when your partner likes a song you added.
        if (liked && !(prev && prev.is_liked) && song.uploaded_by !== viewer && _sendPushToPartner) {
          _sendPushToPartner(coupleId, viewer, {
            title: '❤️ Your song was liked', body: `${song.title} — your partner loved it`,
            icon: '/icons/icon-192.png', tag: 'music-like', url: '/?page=music'
          }).catch(() => {});
        }
        return res.json({ ok: true, liked });
      }
    }
    // Fallback — migration not applied: one shared flag on the song row.
    const { error } = await supabase.from('songs').update({ favorite: liked }).eq('id', song.id).eq('couple_id', coupleId);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, liked, legacy: true });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

async function recordPlay(song, viewer) {
  const now = new Date().toISOString();
  if (viewer && !isDown('userState')) {
    const { data: ex, error: exErr } = await supabase.from('music_user_state')
      .select('play_count').eq('song_id', String(song.id)).eq('user_id', viewer).maybeSingle();
    if (!exErr || !markIfMissing('userState', exErr)) {
      await supabase.from('music_user_state').upsert({
        couple_id: song.couple_id, song_id: String(song.id), user_id: viewer,
        play_count: ((ex && ex.play_count) || 0) + 1, last_played: now,
      }, { onConflict: 'song_id,user_id' });
    }
  }
  // Total plays on the song itself — atomic via RPC when available.
  const { error: rpcErr } = await supabase.rpc('music_increment_play', { p_song_id: String(song.id) });
  if (rpcErr) {
    await supabase.from('songs').update({ play_count: (song.play_count || 0) + 1, last_played: now })
      .eq('id', song.id).eq('couple_id', song.couple_id);
  }
}

// POST register a play (called once per listen, after a few seconds of playback)
router.post('/:id/play', async (req, res) => {
  const { coupleId } = req.body || {};
  const viewer = okRole(req.body && req.body.viewer);
  if (!coupleId || !viewer) return res.status(400).json({ error: 'coupleId and viewer are required' });
  try {
    const song = await getSong(req.params.id, coupleId);
    if (!song || !visibleTo(song, viewer)) return res.status(404).json({ error: 'Song not found' });
    await recordPlay(song, viewer);
    return res.json({ ok: true });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// DELETE song — uploader only; also cleans storage + every dependent row
router.delete('/:id', async (req, res) => {
  const { coupleId } = req.body || {};
  const viewer = okRole(req.body && req.body.viewer);
  if (!coupleId) return res.status(400).json({ error: 'coupleId required' });
  if (!viewer)   return res.status(400).json({ error: 'viewer required' });

  let song;
  try { song = await getSong(req.params.id, coupleId); }
  catch (e) { return res.status(500).json({ error: e.message }); }
  if (!song) return res.json({ ok: true, alreadyGone: true });
  if (song.uploaded_by !== viewer) {
    return res.status(403).json({ error: 'Only the person who added this song can delete it' });
  }

  const { error } = await supabase.from('songs').delete().eq('id', song.id).eq('couple_id', coupleId);
  if (error) return res.status(500).json({ error: error.message });

  // Dependent rows + files — best effort, the song itself is already gone.
  const id = String(song.id);
  const quiet = (p) => Promise.resolve(p).then(() => {}, () => {});
  await Promise.all([
    quiet(supabase.from('music_user_state').delete().eq('song_id', id)),
    quiet(supabase.from('music_playlist_songs').delete().eq('song_id', id)),
    quiet(supabase.from('cached_lyrics').delete().eq('song_id', id)),
    quiet(supabase.from('missing_lyrics').delete().eq('song_id', id)),
  ]);

  // Several songs from one album can share a single cover file; only remove
  // a file when no other song still points at it.
  async function removeIfUnshared(column, url, bucket) {
    const path = pathFromPublicUrl(url, bucket, coupleId);
    if (!path) return;
    const { data: others } = await supabase.from('songs').select('id').eq(column, url).limit(1);
    if (others && others.length) return;
    await removeObjects(supabase, bucket, [path]);
  }
  await removeIfUnshared('audio_url', song.audio_url, AUDIO_BUCKET);
  await removeIfUnshared('cover_url', song.cover_url, COVER_BUCKET);

  return res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════
//  PLAYLISTS (shared — either partner can edit)
// ═══════════════════════════════════════════════════════
const unavailable = (res) => res.status(503).json({
  error: 'Playlists need the music_v2 database update (migrations/music_v2.sql).',
  code: 'MIGRATION_REQUIRED'
});

async function getPlaylist(pid, coupleId) {
  const { data, error } = await supabase.from('music_playlists').select('*').eq('id', pid).eq('couple_id', coupleId).maybeSingle();
  if (error) throw error;
  return data || null;
}
function shapePlaylist(p, songs) {
  return {
    id: p.id, name: p.name, description: p.description || '', created_by: p.created_by,
    created_at: p.created_at, updated_at: p.updated_at,
    song_ids: (songs || []).filter((s) => s.playlist_id === p.id).sort((a, b) => a.position - b.position).map((s) => s.song_id),
  };
}
async function filterOwnedSongIds(ids, coupleId) {
  const clean = Array.from(new Set((ids || []).map(String).filter(isIdish))).slice(0, 500);
  if (!clean.length) return [];
  const { data } = await supabase.from('songs').select('id').eq('couple_id', coupleId).in('id', clean);
  const owned = new Set((data || []).map((r) => String(r.id)));
  return clean.filter((id) => owned.has(id));
}

router.get('/:coupleId/playlists', async (req, res) => {
  if (isDown('playlists')) return res.json({ available: false, playlists: [] });
  const { data: lists, error } = await supabase.from('music_playlists').select('*')
    .eq('couple_id', req.params.coupleId).order('created_at', { ascending: true });
  if (error) {
    if (markIfMissing('playlists', error)) return res.json({ available: false, playlists: [] });
    return res.status(500).json({ error: error.message });
  }
  let songs = [];
  if ((lists || []).length) {
    const { data: ps, error: e2 } = await supabase.from('music_playlist_songs').select('*').in('playlist_id', lists.map((l) => l.id));
    if (e2) return res.status(500).json({ error: e2.message });
    songs = ps || [];
  }
  return res.json({ available: true, playlists: (lists || []).map((l) => shapePlaylist(l, songs)) });
});

router.post('/playlists', async (req, res) => {
  const { coupleId, songIds } = req.body || {};
  const viewer = okRole(req.body && req.body.viewer);
  const name = str(req.body && req.body.name, 60);
  if (!coupleId || !viewer || !name) return res.status(400).json({ error: 'coupleId, viewer and name are required' });
  if (isDown('playlists')) return unavailable(res);

  const { data: pl, error } = await supabase.from('music_playlists').insert({
    couple_id: coupleId, name, description: str(req.body.description, 200) || null, created_by: viewer,
  }).select().single();
  if (error) { if (markIfMissing('playlists', error)) return unavailable(res); return res.status(500).json({ error: error.message }); }

  const ids = await filterOwnedSongIds(songIds, coupleId);
  if (ids.length) {
    await supabase.from('music_playlist_songs').insert(ids.map((song_id, i) => ({ playlist_id: pl.id, song_id, position: i, added_by: viewer })));
  }
  return res.json(shapePlaylist(pl, ids.map((song_id, i) => ({ playlist_id: pl.id, song_id, position: i }))));
});

router.patch('/playlists/:pid', async (req, res) => {
  const { coupleId } = req.body || {};
  if (!coupleId) return res.status(400).json({ error: 'coupleId required' });
  if (isDown('playlists')) return unavailable(res);
  try {
    const pl = await getPlaylist(req.params.pid, coupleId);
    if (!pl) return res.status(404).json({ error: 'Playlist not found' });
    const updates = { updated_at: new Date().toISOString() };
    if (req.body.name !== undefined) { updates.name = str(req.body.name, 60); if (!updates.name) return res.status(400).json({ error: 'Name cannot be empty' }); }
    if (req.body.description !== undefined) updates.description = str(req.body.description, 200) || null;
    const { data, error } = await supabase.from('music_playlists').update(updates).eq('id', pl.id).eq('couple_id', coupleId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  } catch (e) { if (markIfMissing('playlists', e)) return unavailable(res); return res.status(500).json({ error: e.message }); }
});

router.delete('/playlists/:pid', async (req, res) => {
  const { coupleId } = req.body || {};
  if (!coupleId) return res.status(400).json({ error: 'coupleId required' });
  if (isDown('playlists')) return unavailable(res);
  try {
    const pl = await getPlaylist(req.params.pid, coupleId);
    if (!pl) return res.json({ ok: true, alreadyGone: true });
    await supabase.from('music_playlist_songs').delete().eq('playlist_id', pl.id);
    const { error } = await supabase.from('music_playlists').delete().eq('id', pl.id).eq('couple_id', coupleId);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  } catch (e) { if (markIfMissing('playlists', e)) return unavailable(res); return res.status(500).json({ error: e.message }); }
});

router.post('/playlists/:pid/songs', async (req, res) => {
  const { coupleId, songIds } = req.body || {};
  const viewer = okRole(req.body && req.body.viewer);
  if (!coupleId || !Array.isArray(songIds)) return res.status(400).json({ error: 'coupleId and songIds[] are required' });
  if (isDown('playlists')) return unavailable(res);
  try {
    const pl = await getPlaylist(req.params.pid, coupleId);
    if (!pl) return res.status(404).json({ error: 'Playlist not found' });
    const ids = await filterOwnedSongIds(songIds, coupleId);
    if (!ids.length) return res.status(400).json({ error: 'No valid songs to add' });

    const { data: existing } = await supabase.from('music_playlist_songs').select('song_id, position').eq('playlist_id', pl.id);
    const have = new Set((existing || []).map((r) => r.song_id));
    let pos = (existing || []).reduce((m, r) => Math.max(m, r.position), -1) + 1;
    const fresh = ids.filter((id) => !have.has(id));
    if (fresh.length) {
      const { error } = await supabase.from('music_playlist_songs').insert(
        fresh.map((song_id) => ({ playlist_id: pl.id, song_id, position: pos++, added_by: viewer })));
      if (error) return res.status(500).json({ error: error.message });
      await supabase.from('music_playlists').update({ updated_at: new Date().toISOString() }).eq('id', pl.id);
    }
    return res.json({ ok: true, added: fresh.length, alreadyIn: ids.length - fresh.length });
  } catch (e) { if (markIfMissing('playlists', e)) return unavailable(res); return res.status(500).json({ error: e.message }); }
});

router.delete('/playlists/:pid/songs/:songId', async (req, res) => {
  const { coupleId } = req.body || {};
  if (!coupleId) return res.status(400).json({ error: 'coupleId required' });
  if (isDown('playlists')) return unavailable(res);
  try {
    const pl = await getPlaylist(req.params.pid, coupleId);
    if (!pl) return res.status(404).json({ error: 'Playlist not found' });
    const { error } = await supabase.from('music_playlist_songs').delete().eq('playlist_id', pl.id).eq('song_id', req.params.songId);
    if (error) return res.status(500).json({ error: error.message });
    await supabase.from('music_playlists').update({ updated_at: new Date().toISOString() }).eq('id', pl.id);
    return res.json({ ok: true });
  } catch (e) { if (markIfMissing('playlists', e)) return unavailable(res); return res.status(500).json({ error: e.message }); }
});

router.put('/playlists/:pid/order', async (req, res) => {
  const { coupleId, songIds } = req.body || {};
  if (!coupleId || !Array.isArray(songIds)) return res.status(400).json({ error: 'coupleId and songIds[] are required' });
  if (isDown('playlists')) return unavailable(res);
  try {
    const pl = await getPlaylist(req.params.pid, coupleId);
    if (!pl) return res.status(404).json({ error: 'Playlist not found' });
    const { data: existing } = await supabase.from('music_playlist_songs').select('song_id, added_by').eq('playlist_id', pl.id);
    const byId = new Map((existing || []).map((r) => [r.song_id, r]));
    const ordered = Array.from(new Set(songIds.map(String))).filter((id) => byId.has(id));
    if (!ordered.length) return res.json({ ok: true });
    const rows = ordered.map((song_id, i) => ({ playlist_id: pl.id, song_id, position: i, added_by: byId.get(song_id).added_by }));
    const { error } = await supabase.from('music_playlist_songs').upsert(rows, { onConflict: 'playlist_id,song_id' });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  } catch (e) { if (markIfMissing('playlists', e)) return unavailable(res); return res.status(500).json({ error: e.message }); }
});

module.exports = router;
