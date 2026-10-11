// ═══════════════════════════════════════════════════════
//  routes/movie-library.js — Watch Together "Shared Cloud Storage"
//
//  Movies live in a PRIVATE Cloudflare R2 bucket. The browser uploads
//  straight to R2 with short-lived presigned multipart-part URLs (so
//  multi-GB files never pass through this server) and streams with a
//  short-lived presigned GET URL (R2 honours HTTP Range → seeking works).
//  R2 credentials exist ONLY in this file's environment.
//
//  Authorization: every request must carry the caller's `x-user-id`
//  header; the server verifies that user really belongs to :coupleId
//  (same userId/coupleId model the rest of this app uses).
//
//  Wire up in server.js:
//    app.use('/api/movie-library', require('./routes/movie-library'));
// ═══════════════════════════════════════════════════════
const express  = require('express');
const crypto   = require('crypto');
const supabase = require('../middleware/supabase');
const router   = express.Router();

const {
  S3Client, CreateMultipartUploadCommand, UploadPartCommand,
  CompleteMultipartUploadCommand, AbortMultipartUploadCommand,
  GetObjectCommand, HeadObjectCommand, DeleteObjectCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// ── Config (all from env — nothing secret in the repo/frontend) ──
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_KEY_ID     = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET     = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET     = process.env.R2_BUCKET;
// Free tier is 10 GB-month; stop a little short so a couple can't tip into paid usage.
const STORAGE_LIMIT_BYTES = Number(process.env.R2_STORAGE_LIMIT_BYTES) || 9.5e9;
const MAX_FILE_BYTES      = Number(process.env.R2_MAX_FILE_BYTES) || 5e9;
const PLAYBACK_URL_TTL    = Number(process.env.R2_PLAYBACK_URL_TTL_SECONDS) || 6 * 3600; // longer than any movie
const PART_URL_TTL        = 3600;
const PART_SIZE           = 16 * 1024 * 1024; // 16 MiB (R2 min 5 MiB, max 10,000 parts)
const STALE_UPLOAD_MS     = 24 * 3600 * 1000;

const MIME_EXT = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/x-m4v': 'm4v', 'video/quicktime': 'mov' };
const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function r2Configured() { return !!(R2_ACCOUNT_ID && R2_KEY_ID && R2_SECRET && R2_BUCKET); }

let _s3 = null;
function s3() {
  if (_s3) return _s3;
  _s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_KEY_ID, secretAccessKey: R2_SECRET },
    // Newer SDK versions add CRC32 checksum params by default, which end up
    // in presigned URLs and which R2 browser uploads then fail on.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED'
  });
  return _s3;
}

// ── Gate 1: storage must be configured (direct mode never hits this router) ──
router.use((req, res, next) => {
  if (!r2Configured()) return res.status(503).json({ error: 'Shared cloud storage is not set up yet.' });
  next();
});

// ── Gate 2: caller must be a real, active member of :coupleId ──
async function requireCoupleMember(req, res, next) {
  const userId = req.get('x-user-id');
  const { coupleId } = req.params;
  if (!userId || !coupleId) return res.status(401).json({ error: 'Not signed in.' });
  const { data: user, error } = await supabase
    .from('users').select('id, couple_id, role, account_status').eq('id', userId).maybeSingle();
  if (error || !user) return res.status(401).json({ error: 'Session no longer valid.' });
  if (user.account_status === 'suspended' || user.account_status === 'disabled') {
    return res.status(403).json({ error: 'This account is not active.' });
  }
  if (!user.couple_id || String(user.couple_id) !== String(coupleId)) {
    return res.status(403).json({ error: 'Not allowed.' });
  }
  req.user = user;
  next();
}

const fail = (res, status, msg) => res.status(status).json({ error: msg });
const dbFail = (res, error) => { console.error('[movie-library]', error.message || error); return fail(res, 500, 'Something went wrong. Please try again.'); };

async function getMovie(coupleId, movieId) {
  if (!UUID_RE.test(movieId || '')) return null;
  const { data } = await supabase.from('shared_movies').select('*').eq('id', movieId).eq('couple_id', coupleId).maybeSingle();
  return data || null;
}

async function usageBytes(coupleId) {
  const { data } = await supabase.from('shared_movies').select('size_bytes').eq('couple_id', coupleId);
  return (data || []).reduce((sum, r) => sum + Number(r.size_bytes || 0), 0);
}

// Best-effort: free abandoned uploads (tab closed mid-upload) so they stop
// reserving quota. R2 should ALSO have a lifecycle rule (see setup notes).
async function sweepStaleUploads(coupleId) {
  const cutoff = new Date(Date.now() - STALE_UPLOAD_MS).toISOString();
  const { data } = await supabase.from('shared_movies').select('*')
    .eq('couple_id', coupleId).eq('status', 'uploading').lt('created_at', cutoff);
  for (const m of data || []) {
    try { await s3().send(new AbortMultipartUploadCommand({ Bucket: R2_BUCKET, Key: m.object_key, UploadId: m.upload_id })); } catch (_) {}
    await supabase.from('shared_movies').delete().eq('id', m.id);
  }
}

const publicMovie = m => ({
  id: m.id, title: m.title, sizeBytes: Number(m.size_bytes), durationSec: Number(m.duration_sec),
  status: m.status, uploadedBy: m.uploaded_by, createdAt: m.created_at
});

// GET /api/movie-library/:coupleId — library + storage usage
router.get('/:coupleId', requireCoupleMember, async (req, res) => {
  const { coupleId } = req.params;
  try { await sweepStaleUploads(coupleId); } catch (_) {}
  const { data, error } = await supabase.from('shared_movies').select('*')
    .eq('couple_id', coupleId).order('created_at', { ascending: false });
  if (error) return dbFail(res, error);
  const movies = data || [];
  const usedBytes = movies.reduce((s, m) => s + Number(m.size_bytes || 0), 0);
  return res.json({
    movies: movies.map(publicMovie),
    usage: { usedBytes, limitBytes: STORAGE_LIMIT_BYTES, maxFileBytes: Math.min(MAX_FILE_BYTES, STORAGE_LIMIT_BYTES) }
  });
});

// POST /api/movie-library/:coupleId/uploads — start a multipart upload
// body: { title, size, mime, durationSec }
router.post('/:coupleId/uploads', requireCoupleMember, async (req, res) => {
  const { coupleId } = req.params;
  const title = String(req.body.title || '').trim().slice(0, 200);
  const size = Number(req.body.size);
  const mime = String(req.body.mime || '').toLowerCase();
  const durationSec = Number(req.body.durationSec);

  if (!title) return fail(res, 400, 'Missing title.');
  if (!MIME_EXT[mime]) return fail(res, 415, 'Unsupported video type. Use MP4, WebM, M4V or MOV.');
  if (!Number.isFinite(size) || size <= 0) return fail(res, 400, 'Invalid file size.');
  if (!Number.isFinite(durationSec) || durationSec <= 0) return fail(res, 400, 'Could not read the video duration.');
  if (size > Math.min(MAX_FILE_BYTES, STORAGE_LIMIT_BYTES)) {
    return fail(res, 413, `That file is too large (max ${(Math.min(MAX_FILE_BYTES, STORAGE_LIMIT_BYTES) / 1e9).toFixed(1)} GB).`);
  }

  try { await sweepStaleUploads(coupleId); } catch (_) {}
  const used = await usageBytes(coupleId);
  if (used + size > STORAGE_LIMIT_BYTES) {
    return fail(res, 413, `Not enough shared storage left (${((STORAGE_LIMIT_BYTES - used) / 1e9).toFixed(2)} GB free). Delete a movie first.`);
  }

  const key = `movies/${coupleId}/${crypto.randomUUID()}.${MIME_EXT[mime]}`;
  let uploadId;
  try {
    const out = await s3().send(new CreateMultipartUploadCommand({ Bucket: R2_BUCKET, Key: key, ContentType: mime }));
    uploadId = out.UploadId;
  } catch (e) { console.error('[movie-library] create multipart', e.message); return fail(res, 502, 'Cloud storage is unavailable right now.'); }

  const { data, error } = await supabase.from('shared_movies').insert({
    couple_id: coupleId, title, object_key: key, mime_type: mime, size_bytes: size,
    duration_sec: durationSec, status: 'uploading', upload_id: uploadId, uploaded_by: req.user.id
  }).select().single();
  if (error) {
    try { await s3().send(new AbortMultipartUploadCommand({ Bucket: R2_BUCKET, Key: key, UploadId: uploadId })); } catch (_) {}
    return dbFail(res, error);
  }
  return res.json({ movieId: data.id, partSize: PART_SIZE, totalParts: Math.ceil(size / PART_SIZE) });
});

// POST /api/movie-library/:coupleId/uploads/:movieId/parts — sign part URLs just-in-time
// body: { partNumbers: [1,2,3] }  → { urls: { "1": "https://…" } }
router.post('/:coupleId/uploads/:movieId/parts', requireCoupleMember, async (req, res) => {
  const m = await getMovie(req.params.coupleId, req.params.movieId);
  if (!m || m.status !== 'uploading') return fail(res, 404, 'Upload not found.');
  const total = Math.ceil(Number(m.size_bytes) / PART_SIZE);
  const nums = Array.isArray(req.body.partNumbers) ? req.body.partNumbers.map(Number) : [];
  if (!nums.length || nums.length > 50 || nums.some(n => !Number.isInteger(n) || n < 1 || n > total)) {
    return fail(res, 400, 'Invalid part numbers.');
  }
  try {
    const urls = {};
    for (const n of nums) {
      urls[n] = await getSignedUrl(s3(), new UploadPartCommand({
        Bucket: R2_BUCKET, Key: m.object_key, UploadId: m.upload_id, PartNumber: n
      }), { expiresIn: PART_URL_TTL });
    }
    return res.json({ urls });
  } catch (e) { console.error('[movie-library] sign part', e.message); return fail(res, 502, 'Cloud storage is unavailable right now.'); }
});

// POST /api/movie-library/:coupleId/uploads/:movieId/complete
// body: { parts: [{ PartNumber, ETag }] }
router.post('/:coupleId/uploads/:movieId/complete', requireCoupleMember, async (req, res) => {
  const m = await getMovie(req.params.coupleId, req.params.movieId);
  if (!m || m.status !== 'uploading') return fail(res, 404, 'Upload not found.');
  const total = Math.ceil(Number(m.size_bytes) / PART_SIZE);
  const parts = (Array.isArray(req.body.parts) ? req.body.parts : [])
    .map(p => ({ PartNumber: Number(p.PartNumber), ETag: String(p.ETag || '') }))
    .sort((a, b) => a.PartNumber - b.PartNumber);
  if (parts.length !== total || parts.some((p, i) => p.PartNumber !== i + 1 || !p.ETag)) {
    return fail(res, 400, 'Upload is incomplete — some parts are missing.');
  }
  try {
    await s3().send(new CompleteMultipartUploadCommand({
      Bucket: R2_BUCKET, Key: m.object_key, UploadId: m.upload_id, MultipartUpload: { Parts: parts }
    }));
    // Don't trust the client: confirm the stored object is exactly the size we reserved.
    const head = await s3().send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: m.object_key }));
    if (Number(head.ContentLength) !== Number(m.size_bytes)) {
      try { await s3().send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: m.object_key })); } catch (_) {}
      await supabase.from('shared_movies').delete().eq('id', m.id);
      return fail(res, 400, 'Upload was corrupted (size mismatch). Please try again.');
    }
  } catch (e) { console.error('[movie-library] complete', e.message); return fail(res, 502, 'Could not finish the upload. Please try again.'); }

  const { data, error } = await supabase.from('shared_movies')
    .update({ status: 'ready', upload_id: null, completed_at: new Date().toISOString() })
    .eq('id', m.id).select().single();
  if (error) return dbFail(res, error);
  return res.json(publicMovie(data));
});

// POST /api/movie-library/:coupleId/uploads/:movieId/abort — cancel / clean up a failed upload
router.post('/:coupleId/uploads/:movieId/abort', requireCoupleMember, async (req, res) => {
  const m = await getMovie(req.params.coupleId, req.params.movieId);
  if (!m) return res.json({ ok: true });
  if (m.status !== 'uploading') return fail(res, 409, 'That movie is already uploaded.');
  try { await s3().send(new AbortMultipartUploadCommand({ Bucket: R2_BUCKET, Key: m.object_key, UploadId: m.upload_id })); }
  catch (e) { if (e.name !== 'NoSuchUpload') { console.error('[movie-library] abort', e.message); return fail(res, 502, 'Could not cancel the upload.'); } }
  await supabase.from('shared_movies').delete().eq('id', m.id);
  return res.json({ ok: true });
});

// GET /api/movie-library/:coupleId/:movieId/url — temporary signed playback URL
router.get('/:coupleId/:movieId/url', requireCoupleMember, async (req, res) => {
  const m = await getMovie(req.params.coupleId, req.params.movieId);
  if (!m || m.status !== 'ready') return fail(res, 404, 'Movie not found.');
  try {
    const url = await getSignedUrl(s3(), new GetObjectCommand({
      Bucket: R2_BUCKET, Key: m.object_key, ResponseContentType: m.mime_type
    }), { expiresIn: PLAYBACK_URL_TTL });
    res.set('Cache-Control', 'no-store');
    return res.json({ url, expiresInSec: PLAYBACK_URL_TTL });
  } catch (e) { console.error('[movie-library] sign get', e.message); return fail(res, 502, 'Cloud storage is unavailable right now.'); }
});

// POST /api/movie-library/:coupleId/:movieId/select — put this movie in the Watch Together room
// Fills BOTH partners' selection so the existing ready → countdown flow just works.
router.post('/:coupleId/:movieId/select', requireCoupleMember, async (req, res) => {
  const { coupleId } = req.params;
  const m = await getMovie(coupleId, req.params.movieId);
  if (!m || m.status !== 'ready') return fail(res, 404, 'Movie not found.');

  const { data: existing } = await supabase.from('watch_sessions').select('*').eq('couple_id', coupleId).maybeSingle();
  if (existing && ['start_requested', 'countdown', 'watching'].includes(existing.status)) {
    return fail(res, 409, 'A movie session is already in progress.');
  }
  const row = {
    ...(existing || {}),
    couple_id: coupleId,
    user1_movie_title: m.title, user2_movie_title: m.title,
    user1_duration_sec: m.duration_sec, user2_duration_sec: m.duration_sec,
    user1_ready: false, user2_ready: false,
    movies_match: true, status: 'selecting', shared_movie_id: m.id,
    start_requested_by: null, playing: false, position_sec: 0,
    // Date.now()-based like the client's own sequence numbers, and always
    // higher than before, so the partner's applyRemoteRoom accepts the broadcast.
    action_seq: Math.max(((existing && existing.action_seq) || 0) + 1, Date.now()),
    updated_by: req.user.role || 'user1', updated_at: new Date().toISOString()
  };
  const { data, error } = await supabase.from('watch_sessions').upsert(row, { onConflict: 'couple_id' }).select().single();
  if (error) return dbFail(res, error);
  return res.json(data);
});

// DELETE /api/movie-library/:coupleId/:movieId — delete the R2 object AND the DB record
router.delete('/:coupleId/:movieId', requireCoupleMember, async (req, res) => {
  const { coupleId } = req.params;
  const m = await getMovie(coupleId, req.params.movieId);
  if (!m) return res.json({ ok: true }); // already gone

  const { data: room } = await supabase.from('watch_sessions').select('*').eq('couple_id', coupleId).maybeSingle();
  const inRoom = room && room.shared_movie_id === m.id;
  if (inRoom && ['start_requested', 'countdown', 'watching'].includes(room.status)) {
    return fail(res, 409, 'This movie is being watched right now.');
  }

  // 1) Remove the bytes first. If this fails we KEEP the DB record so the
  //    user can retry — never leave a billable object with no record.
  try {
    if (m.status === 'uploading') {
      try { await s3().send(new AbortMultipartUploadCommand({ Bucket: R2_BUCKET, Key: m.object_key, UploadId: m.upload_id })); }
      catch (e) { if (e.name !== 'NoSuchUpload') throw e; }
    } else {
      await s3().send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: m.object_key })); // idempotent: OK if already absent
    }
  } catch (e) { console.error('[movie-library] delete object', e.message); return fail(res, 502, 'Could not delete the movie from cloud storage. Please try again.'); }

  // 2) Then the record.
  const { error } = await supabase.from('shared_movies').delete().eq('id', m.id);
  if (error) return dbFail(res, error);

  // 3) If an idle room still points at it, clear that selection so nobody streams a ghost.
  if (inRoom) {
    await supabase.from('watch_sessions').update({
      shared_movie_id: null, user1_movie_title: null, user2_movie_title: null,
      user1_duration_sec: null, user2_duration_sec: null, user1_ready: false, user2_ready: false,
      movies_match: false, status: 'selecting', playing: false,
      action_seq: Math.max((room.action_seq || 0) + 1, Date.now()), updated_at: new Date().toISOString()
    }).eq('couple_id', coupleId);
  }
  return res.json({ ok: true });
});

module.exports = router;
