// ═══════════════════════════════════════════════════════════════
//  App error log writer
//  ─────────────────────────────────────────────────────────────
//  Not part of the admin route files — this is called from ordinary
//  app code (any route's catch block) to record an operational error
//  for the Admin → App Health page. Deliberately takes only
//  source/message/severity/context — never a request body, chat
//  content, or anything that could smuggle in private message text.
//  Best-effort: a logging failure must never throw or block the
//  response that triggered it.
// ═══════════════════════════════════════════════════════════════
const supabase = require('../middleware/supabase');

async function logAppError(source, message, severity = 'warning', context = {}) {
  try {
    await supabase.from('app_error_log').insert({
      source: String(source).slice(0, 200),
      message: String(message).slice(0, 2000),
      severity: ['info', 'warning', 'critical'].includes(severity) ? severity : 'warning',
      context: context || {}
    });
  } catch (e) {
    console.error('[error-log] failed to write app_error_log:', e.message);
  }
}

module.exports = { logAppError };
