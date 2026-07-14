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
  { key: 'photos',        title: '📸 New Memory',         tag: 'photos',     pick: i => i.name || 'a new photo/video' },
  { key: 'notes',         title: '📝 New Note',           tag: 'notes',      pick: i => i.text },
  { key: 'journal',       title: '📖 New Journal Entry',  tag: 'journal',    pick: i => (i.mood ? i.mood + ' — ' : '') + (i.body || '').slice(0, 80) },
  { key: 'bucket',        title: '🌟 New Dream Added',    tag: 'bucket',     pick: i => i.title },
  { key: 'events',        title: '📅 New Event',          tag: 'events',     pick: i => i.title + (i.date ? ' on ' + i.date : '') },
  { key: 'transactions',  title: '💰 New Transaction',    tag: 'money',      pick: i => (i.desc || i.description || 'Transaction') + (i.amt ? ' — ₹' + i.amt : '') },
  { key: 'milestones',    title: '💫 New Milestone',      tag: 'milestone',  pick: i => i.title },
  { key: 'habits',        title: '✅ New Habit',          tag: 'habit',      pick: i => i.name },
  { key: 'fights',        title: '⚡ New Fight Logged',    tag: 'fight',      pick: i => i.title },
  { key: 'surprises',     title: '🎁 New Surprise',       tag: 'surprise',   pick: () => 'A surprise is waiting for you' },
  { key: 'capsules',      title: '💌 New Love Capsule',   tag: 'capsule',    pick: () => 'A sealed message is waiting' },
  { key: 'sharedSongs',   title: '🎵 New Song Shared',    tag: 'song',       pick: i => i.label || 'a song' },
  { key: 'dreamBoard',    title: '🏡 New Dream Home Idea', tag: 'dreamhome', pick: i => i.title },
  { key: 'vault',         title: '🔐 New Vault Item',     tag: 'vault',      pick: () => 'A new item was added to the vault' },
  { key: 'places',        title: '📍 New Place Added',    tag: 'places',     pick: () => 'A new important place was added', isObjectMap: true },
  { key: 'periods',       title: '🩷 Period Logged',      tag: 'period',     pick: () => 'A new period entry was logged' },
  { key: 'reminders',     title: '🔔 New Reminder',       tag: 'reminder',   pick: i => i.title }
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
        tag: w.tag
      });
    });
  });

  // ── Non-array "event" style fields (single-object signals) ──
  const role = senderRole;
  if (next.touch && next.touch.from === role && (!prev.touch || prev.touch.ts !== next.touch.ts)) {
    notifyBoth(coupleId, role, { title: '💓 Touch', body: (myName || 'Your partner') + ' sent you a touch', icon: '/icons/icon-192.png', tag: 'touch' });
  }
  if (next.missYou && next.missYou.from === role && (!prev.missYou || prev.missYou.ts !== next.missYou.ts)) {
    notifyBoth(coupleId, role, { title: '💔 Miss You', body: (myName || 'Your partner') + ' misses you', icon: '/icons/icon-192.png', tag: 'missyou' });
  }
  if (next.hug && next.hug.from === role && next.hug.status === 'pending' && (!prev.hug || prev.hug.id !== next.hug.id)) {
    notifyBoth(coupleId, role, { title: '🤗 Virtual Hug', body: (myName || 'Your partner') + ' sent you a hug!', icon: '/icons/icon-192.png', tag: 'hug' });
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
        url: '/#music'
      });
    }
  });

  // ── Profile-level nudge: partner joined / paired info changed, etc. ──
  if (next.paired && !prev.paired) {
    notifyBoth(coupleId, role, { title: '💕 Connected!', body: 'You are now linked with ' + (myName || 'your partner'), icon: '/icons/icon-192.png', tag: 'paired' });
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
  const { coupleId, state } = req.body;
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
    try { diffAndNotify(coupleId, state.role || merged.role, prevState, merged, state.myName || merged.myName); }
    catch (e) { console.warn('Notify diff error:', e.message); }
  }

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, savedAt: new Date().toISOString() });
});


// ─── EVENTS / CALENDAR ─────────────────────────────────

router.get('/events/:coupleId', async (req, res) => {
  const { data, error } = await supabase
    .from('events').select('*').eq('couple_id', req.params.coupleId)
    .order('date', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/events', async (req, res) => {
  const { coupleId, title, date, time, note, cat } = req.body;
  if (!coupleId || !title || !date) return res.status(400).json({ error: 'Missing data' });
  const { data, error } = await supabase.from('events').insert({
    couple_id: coupleId, title, date,
    time: time || null, note: note || null, cat: cat || 'Other',
    created_at: new Date().toISOString()
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/events/:id', async (req, res) => {
  const { coupleId } = req.body;
  await supabase.from('events').delete()
    .eq('id', req.params.id).eq('couple_id', coupleId);
  return res.json({ ok: true });
});

// ─── BUCKET LIST ───────────────────────────────────────

router.get('/bucket/:coupleId', async (req, res) => {
  const { data, error } = await supabase
    .from('bucket_items').select('*').eq('couple_id', req.params.coupleId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/bucket', async (req, res) => {
  const { coupleId, title, cat, date } = req.body;
  if (!coupleId || !title) return res.status(400).json({ error: 'Missing data' });
  const { data, error } = await supabase.from('bucket_items').insert({
    couple_id: coupleId, title, cat: cat || 'Other',
    target_date: date || null, done: false,
    created_at: new Date().toISOString()
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.patch('/bucket/:id', async (req, res) => {
  const { coupleId, done } = req.body;
  const { data, error } = await supabase.from('bucket_items')
    .update({ done, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).eq('couple_id', coupleId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/bucket/:id', async (req, res) => {
  const { coupleId } = req.body;
  await supabase.from('bucket_items').delete()
    .eq('id', req.params.id).eq('couple_id', coupleId);
  return res.json({ ok: true });
});

// ─── JOURNAL ───────────────────────────────────────────

router.get('/journal/:coupleId', async (req, res) => {
  const { data, error } = await supabase
    .from('journal_entries').select('*').eq('couple_id', req.params.coupleId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/journal', async (req, res) => {
  const { coupleId, body, mood, authorRole } = req.body;
  if (!coupleId || !body) return res.status(400).json({ error: 'Missing data' });
  const { data, error } = await supabase.from('journal_entries').insert({
    couple_id:   coupleId, body, mood: mood || null,
    author_role: authorRole || 'user1',
    date:        new Date().toISOString().slice(0, 10),
    created_at:  new Date().toISOString()
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/journal/:id', async (req, res) => {
  const { coupleId } = req.body;
  await supabase.from('journal_entries').delete()
    .eq('id', req.params.id).eq('couple_id', coupleId);
  return res.json({ ok: true });
});

// ─── HABITS ────────────────────────────────────────────

router.get('/habits/:coupleId', async (req, res) => {
  const { data, error } = await supabase
    .from('habits').select('*').eq('couple_id', req.params.coupleId)
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/habits', async (req, res) => {
  const { coupleId, name, emoji, goal, authorRole } = req.body;
  if (!coupleId || !name) return res.status(400).json({ error: 'Missing data' });
  const { data, error } = await supabase.from('habits').insert({
    couple_id:   coupleId, name, emoji: emoji || '✅',
    goal:        goal || 1, author_role: authorRole || 'user1',
    done_dates:  [], created_at: new Date().toISOString()
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.patch('/habits/:id/toggle', async (req, res) => {
  const { coupleId, date } = req.body;
  const { data: habit } = await supabase.from('habits')
    .select('done_dates').eq('id', req.params.id).eq('couple_id', coupleId).maybeSingle();
  if (!habit) return res.status(404).json({ error: 'Not found' });

  const dates = habit.done_dates || [];
  const updated = dates.includes(date) ? dates.filter(d => d !== date) : [...dates, date];

  const { data, error } = await supabase.from('habits')
    .update({ done_dates: updated }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/habits/:id', async (req, res) => {
  const { coupleId } = req.body;
  await supabase.from('habits').delete()
    .eq('id', req.params.id).eq('couple_id', coupleId);
  return res.json({ ok: true });
});

// ─── NOTES ─────────────────────────────────────────────

router.get('/notes/:coupleId', async (req, res) => {
  const { data, error } = await supabase
    .from('notes').select('*').eq('couple_id', req.params.coupleId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/notes', async (req, res) => {
  const { coupleId, text, authorRole, color } = req.body;
  if (!coupleId || !text) return res.status(400).json({ error: 'Missing data' });
  const { data, error } = await supabase.from('notes').insert({
    couple_id:   coupleId, text, author_role: authorRole || 'user1',
    color:       color || '#FDF2F6', created_at: new Date().toISOString()
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/notes/:id', async (req, res) => {
  const { coupleId } = req.body;
  await supabase.from('notes').delete()
    .eq('id', req.params.id).eq('couple_id', coupleId);
  return res.json({ ok: true });
});

// ─── TRANSACTIONS (Money) ──────────────────────────────

router.get('/transactions/:coupleId', async (req, res) => {
  const { data, error } = await supabase
    .from('transactions').select('*').eq('couple_id', req.params.coupleId)
    .order('date', { ascending: false }).limit(100);
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/transactions', async (req, res) => {
  const { coupleId, type, desc, amt, category, date } = req.body;
  if (!coupleId || !desc || !amt) return res.status(400).json({ error: 'Missing data' });
  const { data, error } = await supabase.from('transactions').insert({
    couple_id: coupleId, type: type || 'expense',
    description: desc, amount: parseFloat(amt),
    category: category || 'Other',
    date: date || new Date().toISOString().slice(0, 10),
    created_at: new Date().toISOString()
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/transactions/:id', async (req, res) => {
  const { coupleId } = req.body;
  await supabase.from('transactions').delete()
    .eq('id', req.params.id).eq('couple_id', coupleId);
  return res.json({ ok: true });
});

// ─── MILESTONES ────────────────────────────────────────

router.get('/milestones/:coupleId', async (req, res) => {
  const { data, error } = await supabase
    .from('milestones').select('*').eq('couple_id', req.params.coupleId)
    .order('date', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/milestones', async (req, res) => {
  const { coupleId, title, date, note } = req.body;
  if (!coupleId || !title || !date) return res.status(400).json({ error: 'Missing data' });
  const { data, error } = await supabase.from('milestones').insert({
    couple_id: coupleId, title, date, note: note || null,
    created_at: new Date().toISOString()
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/milestones/:id', async (req, res) => {
  const { coupleId } = req.body;
  await supabase.from('milestones').delete()
    .eq('id', req.params.id).eq('couple_id', coupleId);
  return res.json({ ok: true });
});

// ─── WELLNESS ──────────────────────────────────────────

router.get('/wellness/:coupleId', async (req, res) => {
  const { data, error } = await supabase
    .from('wellness').select('*').eq('couple_id', req.params.coupleId)
    .gte('date', new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/wellness', async (req, res) => {
  const { coupleId, date, water, sleep, exercise, mood, authorRole } = req.body;
  if (!coupleId || !date) return res.status(400).json({ error: 'Missing data' });
  const { data, error } = await supabase.from('wellness').upsert({
    couple_id:   coupleId, date,
    water:       water || 0, sleep: sleep || 0, exercise: exercise || 0,
    mood:        mood || null, author_role: authorRole || 'user1',
    updated_at:  new Date().toISOString()
  }, { onConflict: 'couple_id,date,author_role' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
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
    .select('id, connect_code, user1_name, user2_name, anniversary, user1_bio, user2_bio, user1_avatar, user2_avatar')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

module.exports = router;