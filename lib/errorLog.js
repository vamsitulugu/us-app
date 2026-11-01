// ═══════════════════════════════════════════════════════════════
//  App error log writer  (feeds Admin → App Health)
//  Takes only source/message/severity/context — never a request body or
//  chat text. Best-effort: a logging failure must never block a response.
//  `context` may carry { platform, appVersion }; those go in their own columns.
// ═══════════════════════════════════════════════════════════════
const supabase = require('../middleware/supabase');
const { scrub } = require('./telemetry');

async function logAppError(source, message, severity = 'warning', context = {}) {
  try {
    const ctx = Object.assign({}, context || {});
    const platform = ['android', 'web', 'server'].includes(ctx.platform) ? ctx.platform : 'server';
    const appVersion = ctx.appVersion ? String(ctx.appVersion).slice(0, 32) : null;
    delete ctx.platform; delete ctx.appVersion;
    const row = {
      source: String(source).slice(0, 200),
      message: scrub(message, 2000),
      severity: ['info', 'warning', 'critical'].includes(severity) ? severity : 'warning',
      context: ctx,
      platform, app_version: appVersion
    };
    let { error } = await supabase.from('app_error_log').insert(row);
    if (error && /platform|app_version/.test(error.message || '')) {
      // admin_telemetry.sql not run yet — still keep the error.
      delete row.platform; delete row.app_version;
      ({ error } = await supabase.from('app_error_log').insert(row));
    }
    if (error) throw error;
  } catch (e) {
    console.error('[error-log] failed to write app_error_log:', e.message);
  }
}

module.exports = { logAppError };
