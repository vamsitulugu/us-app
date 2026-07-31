// ═══════════════════════════════════════════════════════
//  Data Routes — All couple data synced via Supabase
// ═══════════════════════════════════════════════════════
const express  = require('express');
const supabase = require('../middleware/supabase');
const router   = express.Router();
let _sendPushToPartner, _sendFCMToPartner;
try { _sendPushToPartner = require('./auth').sendPushToPartner; } catch(_) {}
try { _sendFCMToPartner = require('./auth').sendFCMToPartner; } catch(_) {}

function notifyBoth(coupleId, role, payload) {
  if (_sendPushToPartner) _sendPushToPartner(coupleId, role, payload).catch(() => {});
  if (_sendFCMToPartner) _sendFCMToPartner(coupleId, role, payload).catch(() => {});
}

// ─── FULL STATE (save/load entire app) ─────────────────

router.get('/state/:coupleId', async (req, res) => {
  const { data, error } = await supabase
    .from('app_state')
    .select('state')
    .eq('couple_id', req.params.coupleId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    return res.status(500).json({ error: error.message });
  }
  return res.json(data?.state || null);
});

// ─── Generic content-diff notification engine ──────────
// Detects meaningful additions between the previous saved state and the
// incoming state, and pushes a notification to the partner for each one.
// This intentionally ignores pure UI/theme/settings/background fields.

// Config: array-based content. Each entry describes a list field to diff.
// `pick(item)` returns a short display string used in the notification body.
const ARRAY_WATCHERS = [
  // NOTE: i.name is the original filename from the phone/gallery/camera
  // (e.g. "18f91de5-83d6-488f-9260-1bc70bfd....jpg" for photos saved by
  // Android's camera app with UUID filenames), never a user-entered
  // caption — the app has no caption field for photos/videos. Showing it
  // in a notification just leaked a meaningless raw filename/UUID to the
  // partner. Describe the memory by type instead.
  { key: 'photos',        title: '📸 New Memory',         tag: 'photos',     page: 'camera',    pick: i => i.type === 'video' ? 'a new video' : 'a new photo' },
  { key: 'notes',         title: '📝 New Note',           tag: 'notes',      page: 'myspace',   pick: i => i.text },
  { key: 'journal',       title: '📖 New Journal Entry',  tag: 'journal',    page: 'myspace',   pick: i => (i.mood ? i.mood + ' — ' : '') + (i.body || '').slice(0, 80) },
  { key: 'bucket',        title: '🌟 New Dream Added',    tag: 'bucket',     page: 'bucket',    pick: i => i.title },
  { key: 'events',        title: '📅 New Event',          tag: 'events',     page: 'calendar',  pick: i => i.title + (i.date ? ' on ' + i.date : '') },
  { key: 'transactions',  title: '💰 New Transaction',    tag: 'money',      page: 'money',     pick: i => (i.desc || i.description || 'Transaction') + (i.amt ? ' — ₹' + i.amt : '') },
  { key: 'milestones',    title: '💫 New Milestone',      tag: 'milestone',  page: 'profile',   pick: i => i.title },
  { key: 'habits',        title: '✅ New Habit',          tag: 'habit',      page: 'myspace',   pick: i => i.name },
  { key: 'fights',        title: '⚡ New Fight Logged',    tag: 'fight',      page: 'fights',    pick: i => i.title },
  { key: 'surprises',     title: '🎁 New Surprise',       tag: 'surprise',   page: 'surprise',  pick: () => 'A surprise is waiting for you' },
  { key: 'capsules',      title: '💌 New Love Capsule',   tag: 'capsule',    page: 'capsule',   pick: () => 'A sealed message is waiting' },
  { key: 'sharedSongs',   title: '🎵 New Song Shared',    tag: 'song',       page: 'music',     pick: i => i.label || 'a song' },
  { key: 'dreamBoard',    title: '🏡 New Dream Home Idea', tag: 'dreamhome', page: 'dreamhome', pick: i => i.title },
  { key: 'vault',         title: '🔐 New Vault Item',     tag: 'vault',      page: 'vault',     pick: () => 'A new item was added to the vault' },
  { key: 'places',        title: '📍 New Place Added',    tag: 'places',     page: 'map',       pick: () => 'A new important place was added', isObjectMap: true },
  { key: 'periods',       title: '🩷 Period Logged',      tag: 'period',     page: 'period',    pick: () => 'A new period entry was logged' },
  { key: 'reminders',     title: '🔔 New Reminder',       tag: 'reminder',   page: 'myspace',   pick: i => i.title }
];

function diffAndNotify(coupleId, senderRole, prevState, nextState, myName) {
  if (!_sendPushToPartner && !_sendFCMToPartner) return;
  const prev = prevState || {};
  const next = nextState || {};

  ARRAY_WATCHERS.forEach(w => {
    let prevArr, nextArr;
    if (w.isObjectMap) {
      // e.g. `places` is a keyed object, not an array
      prevArr = Object.values(prev[w.key] || {});
      nextArr = Object.values(next[w.key] || {});
    } else {
      prevArr = Array.isArray(prev[w.key]) ? prev[w.key] : [];
      nextArr = Array.isArray(next[w.key]) ? next[w.key] : [];
    }
    if (nextArr.length <= prevArr.length) return; // only notify on growth (new items)

    // Only notify if the addition was made by the sender's role, when
    // that info is available on the item; otherwise notify anyway since
    // it's a net-new item the partner hasn't seen.
    const added = nextArr.slice(prevArr.length);
    added.forEach(item => {
      if (item && item.by && item.by !== senderRole) return; // came from partner already, skip
      if (item && item.visibility === 'self') return; // private item, don't leak via notification
      let body;
      try { body = w.pick(item) || 'Check the app for details'; } catch (_) { body = 'Check the app for details'; }
      notifyBoth(coupleId, senderRole, {
        title: w.title,
        body: (myName || 'Your partner') + ': ' + String(body).slice(0, 120),
        icon: '/icons/icon-192.png',
        tag: w.tag,
        url: '/?page=' + w.page
      });
    });
  });

  // ── Non-array "event" style fields (single-object signals) ──
  const role = senderRole;
  if (next.touch && next.touch.from === role && (!prev.touch || prev.touch.ts !== next.touch.ts)) {
    notifyBoth(coupleId, role, { title: '💓 Touch', body: (myName || 'Your partner') + ' sent you a touch', icon: '/icons/icon-192.png', tag: 'touch', url: '/?page=dashboard' });
  }
  if (next.missYou && next.missYou.from === role && (!prev.missYou || prev.missYou.ts !== next.missYou.ts)) {
    notifyBoth(coupleId, role, { title: '💔 Miss You', body: (myName || 'Your partner') + ' misses you', icon: '/icons/icon-192.png', tag: 'missyou', url: '/?page=dashboard' });
  }
  if (next.hug && next.hug.from === role && next.hug.status === 'pending' && (!prev.hug || prev.hug.id !== next.hug.id)) {
    notifyBoth(coupleId, role, { title: '🤗 Virtual Hug', body: (myName || 'Your partner') + ' sent you a hug!', icon: '/icons/icon-192.png', tag: 'hug', url: '/?page=dashboard' });
  }
  ['ck_user1', 'ck_user2'].forEach(key => {
    const nArr = Array.isArray(next[key]) ? next[key] : [];
    const pArr = Array.isArray(prev[key]) ? prev[key] : [];
    if (nArr.length <= pArr.length) return;
    const last = nArr[nArr.length - 1];
    if (last && last.type === 'invite' && last.from === role) {
      notifyBoth(coupleId, role, {
        title: '🎤 Sing Together',
        body: (myName || 'Your partner') + ' invited you to sing "' + (last.songTitle || 'a song') + '"',
        icon: '/icons/icon-192.png',
        tag: 'ck-invite',
        url: '/?page=music'
      });
    }
  });

  // ── Profile-level nudge: partner joined / paired info changed, etc. ──
  if (next.paired && !prev.paired) {
    notifyBoth(coupleId, role, { title: '💕 Connected!', body: 'You are now linked with ' + (myName || 'your partner'), icon: '/icons/icon-192.png', tag: 'paired', url: '/?page=dashboard' });
  }

  // ── Music player (music.html syncs metadata under music_user1/music_user2,
  //    not through the /api/music route) — notify when the sender's own
  //    playlist grows. Only the sender's own key should ever grow in a
  //    save they authored, so no cross-role filtering needed here. ──
  const myMusicKey = 'music_' + role;
  const prevTracks = (prev[myMusicKey] && Array.isArray(prev[myMusicKey].tracks)) ? prev[myMusicKey].tracks : [];
  const nextTracks = (next[myMusicKey] && Array.isArray(next[myMusicKey].tracks)) ? next[myMusicKey].tracks : [];
  if (nextTracks.length > prevTracks.length) {
    const added = nextTracks.slice(prevTracks.length);
    added.forEach(t => {
      if (t && t.visibility === 'my') return; // kept private, don't notify
      notifyBoth(coupleId, role, {
        title: '🎵 New Song Added',
        body: (myName || 'Your partner') + ' added "' + (t.title || 'a song') + '" to their playlist',
        icon: '/icons/icon-192.png',
        tag: 'music-track',
        url: '/?page=music'
      });
    });
  }

  // ── Karaoke recordings (musicState.recordings synced via app_state too) ──
  const prevRecs = Array.isArray(prev.recordings) ? prev.recordings : [];
  const nextRecs = Array.isArray(next.recordings) ? next.recordings : [];
  if (nextRecs.length > prevRecs.length) {
    const added = nextRecs.slice(prevRecs.length);
    added.forEach(r => {
      notifyBoth(coupleId, role, {
        title: '🎙️ New Karaoke Recording',
        body: (myName || 'Your partner') + ' recorded "' + (r.trackTitle || 'a song') + '"',
        icon: '/icons/icon-192.png',
        tag: 'karaoke-rec',
        url: '/?page=music'
      });
    });
  }
}

router.post('/state', async (req, res) => {
  const { coupleId, state, senderRole, myName } = req.body;
  if (!coupleId || !state) return res.status(400).json({ error: 'Missing data' });

  const { data: prevRow } = await supabase
    .from('app_state').select('state').eq('couple_id', coupleId).maybeSingle();
  const prevState = prevRow?.state || null;

  // MERGE instead of REPLACE — this was wiping your whole DB on every call signal
  const merged = { ...(prevState || {}), ...state };

  // Deep-merge the nested `profile` object specifically, so one device's
  // save can never wipe out the other person's avatar/name/bday that
  // was written moments earlier by their device.
  if (state.profile) {
    merged.profile = { ...((prevState || {}).profile || {}), ...state.profile };
  }

  const { error } = await supabase.from('app_state').upsert({
    couple_id:  coupleId,
    state:      merged,
    updated_at: new Date().toISOString()
  }, { onConflict: 'couple_id' });

  if (!error) {
    // ROOT CAUSE FIX (notification pipeline): prefer the explicit
    // top-level senderRole/myName the client sends on every save
    // (see saveToCloud() in index.html) over state.role/merged.role.
    // Partial-state saves (karaoke ck_* invites, single-key quick
    // saves) never include `role` inside `state`, so this used to fall
    // back to merged.role — a field living in the single SHARED
    // app_state row, last overwritten by whichever partner saved a
    // full state most recently. That is not necessarily who is
    // sending THIS save, so diffAndNotify's senderRole (and therefore
    // the partnerRole it pushes to) could be computed backwards,
    // silently sending the notification to the wrong device — often
    // the sender's own subscription — while the real partner got
    // nothing.
    const resolvedRole = senderRole || state.role || merged.role;
    const resolvedName = myName || state.myName || merged.myName;
    try { diffAndNotify(coupleId, resolvedRole, prevState, merged, resolvedName); }
    catch (e) { console.warn('Notify diff error:', e.message); }
  }

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, savedAt: new Date().toISOString() });
});


// ─── PROFILE ───────────────────────────────────────────

router.patch('/profile/:coupleId', async (req, res) => {
  const { myBio, partnerBio, user1Avatar, user2Avatar, myName, partnerName, anniversary } = req.body;
  const updates = {};
  if (myName      !== undefined) updates.user1_name   = myName;
  if (partnerName !== undefined) updates.user2_name   = partnerName;
  if (anniversary !== undefined) updates.anniversary  = anniversary;
  if (myBio       !== undefined) updates.user1_bio    = myBio;
  if (partnerBio  !== undefined) updates.user2_bio    = partnerBio;
  if (user1Avatar)               updates.user1_avatar = user1Avatar;
  if (user2Avatar)               updates.user2_avatar = user2Avatar;
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('couples').update(updates).eq('id', req.params.coupleId)
    .select('id, user1_name, user2_name, anniversary, user1_bio, user2_bio, user1_avatar, user2_avatar')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

module.exports = router;