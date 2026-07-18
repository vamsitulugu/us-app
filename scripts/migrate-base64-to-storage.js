// ═══════════════════════════════════════════════════════════════
//  migrate-base64-to-storage.js
//
//  ONE-TIME migration: finds base64 (data:...) media that was saved
//  directly into the database before this fix — in app_state.state
//  (photos / vault) and in chat_messages.media_url — uploads each one
//  to Supabase Storage, and rewrites the row to point at the new URL
//  instead of carrying the base64 text.
//
//  WHY THIS EXISTS
//  Earlier versions of the app stored uploaded photos/videos/vault
//  items/chat images/voice messages as base64 text directly inside
//  the row. That's what this migration cleans up — after it runs,
//  existing media keeps working (now via a hosted URL instead of
//  inline base64) and the database rows shrink dramatically.
//
//  SAFETY
//  - Dry-run by default. Nothing is written unless you pass --apply.
//  - Every row it's about to change is printed before (dry-run) or as
//    (apply) it's changed, so you can see exactly what happened.
//  - It only ever ADDS a Storage object and rewrites a URL string —
//    it never deletes anything from app_state/chat_messages, and it
//    never touches non-base64 (already-a-URL) entries.
//  - Run it against a fresh Supabase backup/export first if you can.
//
//  USAGE
//    cd US/
//    node scripts/migrate-base64-to-storage.js            # dry run — reports only
//    node scripts/migrate-base64-to-storage.js --apply     # actually uploads + rewrites
//    node scripts/migrate-base64-to-storage.js --apply --couple=<coupleId>   # limit to one couple, useful for testing first
//
//  Requires the same env vars as the running server (SUPABASE_URL,
//  SUPABASE_SERVICE_KEY) — loads them from .env the same way server.js does.
// ═══════════════════════════════════════════════════════════════

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

const APPLY = process.argv.includes('--apply');
const coupleArg = process.argv.find(a => a.startsWith('--couple='));
const ONLY_COUPLE = coupleArg ? coupleArg.split('=')[1] : null;

let uploadCount = 0;
let bytesSaved = 0;

function parseDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!m) return null;
  return { mime: m[1], buffer: Buffer.from(m[2], 'base64') };
}

function extFromMime(mime) {
  if (mime.includes('jpeg')) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('mpeg')) return 'mp3';
  if (mime.includes('quicktime')) return 'mov';
  return 'bin';
}

async function uploadBase64(coupleId, dataUrl, bucket) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  const ext = extFromMime(parsed.mime);
  const name = `${coupleId}/migrated_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

  if (APPLY) {
    const { error } = await supabase.storage.from(bucket).upload(name, parsed.buffer, {
      contentType: parsed.mime,
      upsert: false
    });
    if (error) throw new Error(`upload failed (${bucket}/${name}): ${error.message}`);
  }

  uploadCount++;
  bytesSaved += parsed.buffer.length;

  if (bucket === 'vault-media') {
    if (!APPLY) return { url: '[would-generate-signed-url]', path: name };
    const { data: signed, error: signErr } = await supabase.storage
      .from(bucket).createSignedUrl(name, 60 * 60 * 24 * 365 * 10);
    if (signErr) throw new Error(`sign failed (${name}): ${signErr.message}`);
    return { url: signed.signedUrl, path: name };
  }

  if (!APPLY) return { url: '[would-generate-public-url]', path: name };
  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(name);
  return { url: urlData.publicUrl, path: name };
}

function isBase64(val) {
  return typeof val === 'string' && val.startsWith('data:');
}

// ─── app_state: photos + vault ─────────────────────────
async function migrateAppState() {
  console.log('\n── app_state (photos / vault) ──');
  let query = supabase.from('app_state').select('couple_id, state');
  if (ONLY_COUPLE) query = query.eq('couple_id', ONLY_COUPLE);
  const { data: rows, error } = await query;
  if (error) { console.error('Failed to read app_state:', error.message); return; }

  for (const row of rows || []) {
    const state = row.state || {};
    let changed = false;

    if (Array.isArray(state.photos)) {
      for (const p of state.photos) {
        if (isBase64(p.url)) {
          console.log(`  [${row.couple_id}] photo "${p.name || p.id}" is base64 (${(p.url.length / 1024).toFixed(0)}KB) → uploading`);
          const bucket = p.type === 'video' ? 'couple-photos' : 'couple-photos';
          const uploaded = await uploadBase64(row.couple_id, p.url, bucket);
          if (uploaded) { p.url = uploaded.url; changed = true; }
        }
      }
    }

    if (Array.isArray(state.vault)) {
      for (const v of state.vault) {
        if (isBase64(v.url)) {
          console.log(`  [${row.couple_id}] vault item ${v.id} is base64 (${(v.url.length / 1024).toFixed(0)}KB) → uploading`);
          const uploaded = await uploadBase64(row.couple_id, v.url, 'vault-media');
          if (uploaded) { v.url = uploaded.url; v.path = uploaded.path; changed = true; }
        }
      }
    }

    if (Array.isArray(state.placesMemories)) {
      for (const p of state.placesMemories) {
        if (isBase64(p.banner)) {
          console.log(`  [${row.couple_id}] place "${p.name || p.id}" banner is base64 (${(p.banner.length / 1024).toFixed(0)}KB) → uploading`);
          const uploaded = await uploadBase64(row.couple_id, p.banner, 'couple-photos');
          if (uploaded) { p.banner = uploaded.url; changed = true; }
        }
        if (Array.isArray(p.photos)) {
          for (let i = 0; i < p.photos.length; i++) {
            if (isBase64(p.photos[i])) {
              console.log(`  [${row.couple_id}] place "${p.name || p.id}" photo ${i} is base64 (${(p.photos[i].length / 1024).toFixed(0)}KB) → uploading`);
              const uploaded = await uploadBase64(row.couple_id, p.photos[i], 'couple-photos');
              if (uploaded) { p.photos[i] = uploaded.url; changed = true; }
            }
          }
        }
      }
    }

    if (changed && APPLY) {
      const { error: upErr } = await supabase.from('app_state')
        .update({ state, updated_at: new Date().toISOString() })
        .eq('couple_id', row.couple_id);
      if (upErr) console.error(`  ! failed to save couple ${row.couple_id}:`, upErr.message);
      else console.log(`  ✓ saved couple ${row.couple_id}`);
    }
  }
}

// ─── chat_messages: images / audio / voice ─────────────
async function migrateChatMessages() {
  console.log('\n── chat_messages (image / audio / voice) ──');
  let query = supabase.from('chat_messages').select('id, couple_id, type, media_url')
    .in('type', ['image', 'audio', 'voice']);
  if (ONLY_COUPLE) query = query.eq('couple_id', ONLY_COUPLE);
  const { data: rows, error } = await query;
  if (error) { console.error('Failed to read chat_messages:', error.message); return; }

  for (const row of rows || []) {
    if (!isBase64(row.media_url)) continue;
    console.log(`  [${row.couple_id}] message ${row.id} (${row.type}) is base64 (${(row.media_url.length / 1024).toFixed(0)}KB) → uploading`);
    const uploaded = await uploadBase64(row.couple_id, row.media_url, 'couple-photos');
    if (!uploaded) continue;
    if (APPLY) {
      const { error: upErr } = await supabase.from('chat_messages')
        .update({ media_url: uploaded.url })
        .eq('id', row.id);
      if (upErr) console.error(`  ! failed to save message ${row.id}:`, upErr.message);
      else console.log(`  ✓ saved message ${row.id}`);
    }
  }
}

// ─── globe_memory_media: photos / voice / video ────────
async function migrateGlobeMedia() {
  console.log('\n── globe_memory_media (photo / voice / video) ──');
  let query = supabase.from('globe_memory_media').select('id, couple_id, type, url, data_url');
  if (ONLY_COUPLE) query = query.eq('couple_id', ONLY_COUPLE);
  const { data: rows, error } = await query;
  if (error) { console.error('Failed to read globe_memory_media:', error.message); return; }

  for (const row of rows || []) {
    const raw = row.data_url; // legacy column — url takes priority once set
    if (!isBase64(raw)) continue;
    console.log(`  [${row.couple_id}] globe media ${row.id} (${row.type}) is base64 (${(raw.length / 1024).toFixed(0)}KB) → uploading`);
    const uploaded = await uploadBase64(row.couple_id, raw, 'couple-photos');
    if (!uploaded) continue;
    if (APPLY) {
      const { error: upErr } = await supabase.from('globe_memory_media')
        .update({ url: uploaded.url, data_url: null })
        .eq('id', row.id);
      if (upErr) console.error(`  ! failed to save globe media ${row.id}:`, upErr.message);
      else console.log(`  ✓ saved globe media ${row.id}`);
    }
  }
}

// ─── home_memory_objects: thumbnail + voice note in meta ──
async function migrateHomeMemories() {
  console.log('\n── home_memory_objects (thumbnail / voice note) ──');
  let query = supabase.from('home_memory_objects').select('id, couple_id, thumbnail, meta');
  if (ONLY_COUPLE) query = query.eq('couple_id', ONLY_COUPLE);
  const { data: rows, error } = await query;
  if (error) { console.error('Failed to read home_memory_objects:', error.message); return; }

  for (const row of rows || []) {
    let changed = false;
    let thumbnail = row.thumbnail;
    let meta = row.meta || {};

    if (isBase64(thumbnail)) {
      console.log(`  [${row.couple_id}] memory ${row.id} thumbnail is base64 (${(thumbnail.length / 1024).toFixed(0)}KB) → uploading`);
      const uploaded = await uploadBase64(row.couple_id, thumbnail, 'couple-photos');
      if (uploaded) { thumbnail = uploaded.url; meta.thumbnail = uploaded.url; changed = true; }
    }
    if (isBase64(meta.audioData)) {
      console.log(`  [${row.couple_id}] memory ${row.id} voice note is base64 (${(meta.audioData.length / 1024).toFixed(0)}KB) → uploading`);
      const uploaded = await uploadBase64(row.couple_id, meta.audioData, 'couple-photos');
      if (uploaded) { meta.audioData = uploaded.url; changed = true; }
    }

    if (changed && APPLY) {
      const { error: upErr } = await supabase.from('home_memory_objects')
        .update({ thumbnail, meta })
        .eq('id', row.id);
      if (upErr) console.error(`  ! failed to save memory ${row.id}:`, upErr.message);
      else console.log(`  ✓ saved memory ${row.id}`);
    }
  }
}

(async () => {
  console.log(APPLY ? '=== APPLY MODE — this will upload files and rewrite rows ===' : '=== DRY RUN — nothing will be written. Pass --apply to actually run it. ===');
  if (ONLY_COUPLE) console.log('Limited to couple_id =', ONLY_COUPLE);

  await migrateAppState();
  await migrateChatMessages();
  await migrateGlobeMedia();
  await migrateHomeMemories();

  console.log(`\nDone. ${uploadCount} base64 item(s) ${APPLY ? 'uploaded' : 'found'}, ~${(bytesSaved / 1024 / 1024).toFixed(2)}MB of inline base64 ${APPLY ? 'moved to Storage' : 'would be moved to Storage'}.`);
  if (!APPLY) console.log('Re-run with --apply when you\'re ready — try --couple=<id> on one couple first.');
})().catch(e => { console.error('Migration failed:', e); process.exit(1); });
