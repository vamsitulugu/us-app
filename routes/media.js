// ═══════════════════════════════════════════════════════
//  Media Routes — Photos & Videos via Supabase Storage
// ═══════════════════════════════════════════════════════
const express  = require('express');
const multer   = require('multer');
const supabase = require('../middleware/supabase');
const router   = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 } // 20MB max
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

    // Vault: private signed URL (expires in 7 days)
    if (bucket === 'vault-media') {
        const { data: signed } = await supabase.storage
            .from(bucket)
            .createSignedUrl(name, 60 * 60 * 24 * 7);
        return res.json({ url: signed.signedUrl, path: name });
    }

    // ✅ FIX: Regular photos — return public URL
    const { data: urlData } = supabase.storage
        .from(bucket)
        .getPublicUrl(name);
    return res.json({ url: urlData.publicUrl, path: name });
});

// ── DELETE /api/media/delete ───────────────────────────
router.delete('/delete', async (req, res) => {
    const { path, bucket } = req.body;
    if (!path) return res.status(400).json({ error: 'path required' });
    await supabase.storage.from(bucket || 'couple-photos').remove([path]);
    return res.json({ ok: true });
});

module.exports = router;