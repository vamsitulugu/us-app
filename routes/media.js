// ═══════════════════════════════════════════════════════
//  Media Routes — Photos & Videos via Supabase Storage
//  REPLACES: routes/media.js
//  Adds: /api/media/upload-audio, /api/media/upload-cover
// ═══════════════════════════════════════════════════════
const express  = require('express');
const multer   = require('multer');
const supabase = require('../middleware/supabase');
const router   = express.Router();

// Both couple-photos and vault-media only ever receive images/videos from
// the app itself (see index.html's photo/vault upload flows) — nothing in
// the UI uploads any other type here. Restricting to that on the server
// prevents someone hitting this endpoint directly from uploading an HTML
// or SVG file (which can execute script when opened) or any other
// unexpected/executable content, without changing what real users can do.
const ALLOWED_MEDIA_MIME = /^(image\/(jpeg|png|gif|webp|heic|heif)|video\/(mp4|quicktime|webm|3gpp|x-matroska))$/i;
function mediaFileFilter(req, file, cb) {
    if (!ALLOWED_MEDIA_MIME.test(file.mimetype)) {
        return cb(new Error('Unsupported file type'));
    }
    cb(null, true);
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
    fileFilter: mediaFileFilter
});
const uploadAudio = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 60 * 1024 * 1024 } // 60MB max for songs
});

// ── POST /api/media/upload ─────────────────────────────
router.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const { coupleId, type } = req.body;
    if (!coupleId) return res.status(400).json({ error: 'coupleId required' });

    const ext    = req.file.originalname.split('.').pop() || 'jpg';
    const name   = `${coupleId}/${Date.now()}.${ext}`;
    const bucket = type === 'vault' ? 'vault-media' : 'couple-photos';

    const { error } = await supabase.storage
        .from(bucket)
        .upload(name, req.file.buffer, {
            contentType: req.file.mimetype,
            upsert: false
        });

    if (error) return res.status(500).json({ error: error.message });

    if (bucket === 'vault-media') {
        // Vault items get linked from a couple's saved state indefinitely,
        // not just for a single session — a short-lived signed URL would
        // silently break old vault entries once it expired. Sign for a
        // very long window (10 years) instead of the previous 7 days.
        const { data: signed, error: signError } =
            await supabase.storage.from(bucket).createSignedUrl(name, 60 * 60 * 24 * 365 * 10);
        if (signError) return res.status(500).json({ error: signError.message });
        return res.json({ url: signed.signedUrl, path: name });
    }

    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(name);
    return res.json({ url: urlData.publicUrl, path: name });
});

// ── POST /api/media/upload-audio ───────────────────────
// Uploads a song file to the public 'couple-music' bucket.
router.post('/upload-audio', uploadAudio.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const { coupleId } = req.body;
    if (!coupleId) return res.status(400).json({ error: 'coupleId required' });

    const ext    = (req.file.originalname.split('.').pop() || 'mp3').toLowerCase();
    const name   = `${coupleId}/${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;
    const bucket = 'couple-music';

    const { error } = await supabase.storage
        .from(bucket)
        .upload(name, req.file.buffer, {
            contentType: req.file.mimetype || 'audio/mpeg',
            upsert: false
        });
    if (error) return res.status(500).json({ error: error.message });

    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(name);
    return res.json({ url: urlData.publicUrl, path: name });
});

// ── POST /api/media/upload-cover ───────────────────────
// Uploads album art to the public 'couple-music-covers' bucket.
router.post('/upload-cover', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const { coupleId } = req.body;
    if (!coupleId) return res.status(400).json({ error: 'coupleId required' });

    const ext    = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
    const name   = `${coupleId}/${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;
    const bucket = 'couple-music-covers';

    const { error } = await supabase.storage
        .from(bucket)
        .upload(name, req.file.buffer, {
            contentType: req.file.mimetype || 'image/jpeg',
            upsert: false
        });
    if (error) return res.status(500).json({ error: error.message });

    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(name);
    return res.json({ url: urlData.publicUrl, path: name });
});

// ── DELETE /api/media/delete ───────────────────────────
// Previously accepted an arbitrary `path` + `bucket` string with no check
// that the path belonged to the caller's own coupleId — anyone who knew
// or guessed another couple's storage path (paths are `${coupleId}/...`,
// so this required knowing their coupleId too, but there was still no
// enforcement) could delete their photos/vault media. Also added a
// path-traversal guard since `path` is used directly in a storage call.
const ALLOWED_MEDIA_BUCKETS = ['couple-photos', 'vault-media'];
router.delete('/delete', async (req, res) => {
    const { path, bucket, coupleId } = req.body;
    if (!path) return res.status(400).json({ error: 'path required' });
    if (!coupleId) return res.status(400).json({ error: 'coupleId required' });
    if (path.includes('..') || path.startsWith('/')) {
        return res.status(400).json({ error: 'Invalid path' });
    }
    const targetBucket = bucket || 'couple-photos';
    if (!ALLOWED_MEDIA_BUCKETS.includes(targetBucket)) {
        return res.status(400).json({ error: 'Invalid bucket' });
    }
    // Every path is written as `${coupleId}/...` at upload time (see
    // /upload above) — enforce that the caller can only ever delete
    // objects under their own coupleId prefix.
    if (!path.startsWith(`${coupleId}/`)) {
        return res.status(403).json({ error: 'Not authorized to delete this file' });
    }
    await supabase.storage.from(targetBucket).remove([path]);
    return res.json({ ok: true });
});

// ── POST /api/media/upload-recording ──────────────────
router.post('/upload-recording', uploadAudio.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const { coupleId, trackTitle } = req.body;
    if (!coupleId) return res.status(400).json({ error: 'coupleId required' });

    const safe  = (trackTitle || 'recording').replace(/[^a-z0-9]/gi, '_').slice(0, 40);
    const name  = `${coupleId}/${Date.now()}_${safe}.webm`;
    const bucket = 'couple-recordings';

    const { error } = await supabase.storage
        .from(bucket)
        .upload(name, req.file.buffer, {
            contentType: req.file.mimetype || 'audio/webm',
            upsert: false
        });
    if (error) return res.status(500).json({ error: error.message });

    const { data: signed } = await supabase.storage
        .from(bucket)
        .createSignedUrl(name, 60 * 60 * 24 * 7);
    return res.json({ url: signed.signedUrl, path: name });
});

// ── DELETE /api/media/delete-recording ────────────────
router.delete('/delete-recording', async (req, res) => {
    const { path, coupleId } = req.body;
    if (!path) return res.status(400).json({ error: 'path required' });
    if (!coupleId) return res.status(400).json({ error: 'coupleId required' });
    if (path.includes('..') || path.startsWith('/')) {
        return res.status(400).json({ error: 'Invalid path' });
    }
    if (!path.startsWith(`${coupleId}/`)) {
        return res.status(403).json({ error: 'Not authorized to delete this file' });
    }
    await supabase.storage.from('couple-recordings').remove([path]);
    return res.json({ ok: true });
});

module.exports = router;

// Router-level error handler — catches multer errors (unsupported file
// type from mediaFileFilter above, or file-too-large) and returns a
// proper JSON response instead of falling through to server.js's generic
// "Internal server error" handler.
router.use((err, req, res, next) => {
    if (err) {
        return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    next();
});