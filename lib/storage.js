// ═══════════════════════════════════════════════════════
//  Storage helpers shared by the music / movie / recordings routes.
//
//  Rows store the *public URL* of an uploaded file. To clean the file up
//  when its row is deleted we need the object path inside the bucket.
//  Every upload path is written as `${coupleId}/<name>` (see
//  routes/media.js), so a path is only ever accepted if it sits under the
//  caller's own coupleId prefix and contains no traversal segments.
// ═══════════════════════════════════════════════════════

/**
 * Extract the in-bucket object path from a Supabase public URL.
 * Returns null if the URL does not belong to `bucket` / `coupleId`.
 */
function pathFromPublicUrl(url, bucket, coupleId) {
  if (!url || typeof url !== 'string' || !bucket || !coupleId) return null;
  const marker = `/${bucket}/`;
  const i = url.indexOf(marker);
  if (i < 0) return null;
  let p;
  try { p = decodeURIComponent(url.slice(i + marker.length).split('?')[0].split('#')[0]); }
  catch (_) { return null; }
  if (!p || p.includes('..') || p.startsWith('/')) return null;
  if (!p.startsWith(coupleId + '/')) return null;
  return p;
}

/** Best-effort removal: never throws, resolves to true if the call succeeded. */
async function removeObjects(supabase, bucket, paths) {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return true;
  try {
    const { error } = await supabase.storage.from(bucket).remove(list);
    return !error;
  } catch (_) { return false; }
}

module.exports = { pathFromPublicUrl, removeObjects };
