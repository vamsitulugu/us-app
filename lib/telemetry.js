// ═══════════════════════════════════════════════════════════════
//  lib/telemetry.js — activity + scrubbed error reporting
//  Everything here is best-effort: it must never throw into a request.
// ═══════════════════════════════════════════════════════════════
const supabase = require('../middleware/supabase');

function today() { return new Date().toISOString().slice(0, 10); }

/** Remove emails, phone numbers, bearer tokens and long secrets from free text. */
function scrub(text, max = 1500) {
  return String(text == null ? '' : text)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\b(Bearer|Token)\s+[\w.~+/=-]{8,}/gi, '$1 [token]')
    .replace(/\b(eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,})\b/g, '[jwt]')
    .replace(/\+?\d[\d\s().-]{8,}\d/g, '[number]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[secret]')
    .slice(0, max);
}

/** Count this user as active today on this platform and remember their latest app version. */
async function recordActivity(userId, client) {
  if (!userId || !client) return;
  try {
    const now = new Date().toISOString();
    await supabase.from('app_activity').upsert(
      { day: today(), user_id: String(userId), platform: client.platform, kind: client.kind, app_version: client.version, last_seen_at: now },
      { onConflict: 'day,user_id,platform' }
    );
    await supabase.from('users').update({
      last_platform: client.platform, last_app_version: client.version, last_seen_at: now
    }).eq('id', String(userId));
  } catch (e) {
    console.error('[telemetry] recordActivity failed:', e.message);
  }
}

module.exports = { scrub, recordActivity };
