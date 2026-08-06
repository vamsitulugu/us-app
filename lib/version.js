// ═══════════════════════════════════════════════════════════════
//  Version comparison utility
//  ─────────────────────────────────────────────────────────────
//  Deliberately NOT a string compare — "1.10.0" must be treated as
//  newer than "1.9.0", which `"1.10.0" > "1.9.0"` gets wrong as
//  strings (it compares character-by-character: '1' vs '1', then
//  '.', then '1' vs '9' → "1.9.0" wins as a string, which is backwards).
//
//  Used by both routes/admin-releases.js (min_supported_version /
//  update_type validation could use this later) and routes/releases.js
//  (the actual update-decision logic). Kept dependency-free.
// ═══════════════════════════════════════════════════════════════

// Parses "1.10.2" -> [1, 10, 2]. Non-numeric or missing segments become
// 0 rather than throwing, so a malformed version never crashes the
// update check — it just compares as conservatively as possible.
function parseVersion(v) {
  if (!v || typeof v !== 'string') return [0];
  return v
    .trim()
    .split('.')
    .map((part) => {
      const n = parseInt(part, 10);
      return Number.isNaN(n) ? 0 : n;
    });
}

// Returns -1 if a<b, 0 if equal, 1 if a>b — standard comparator shape.
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}

function isOlderThan(a, b) { return compareVersions(a, b) < 0; }
function isAtLeast(a, b) { return compareVersions(a, b) >= 0; }

module.exports = { parseVersion, compareVersions, isOlderThan, isAtLeast };
