// R8 — centralized timestamp helpers.
//
// The schema historically mixes three temporal representations:
//   • SQLite CURRENT_TIMESTAMP  → 'YYYY-MM-DD HH:MM:SS' (UTC) text
//   • epoch milliseconds        → notifications.created_at, school_identity.updated_at
//   • datetime('now')           → support_sessions.created_at
//
// Rather than rewrite historical columns (risky, and the values are already
// consistent within each table), new code should standardize on
// `DATETIME DEFAULT CURRENT_TIMESTAMP` for schema defaults and use these helpers
// whenever a timestamp must be produced in JS, so the representation is explicit
// and consistent at the call site.

// Current time as epoch milliseconds — matches columns that store INTEGER epoch-ms
// (e.g. notifications.created_at, school_identity.updated_at).
function nowEpochMs() {
    return Date.now();
}

// Current time as an ISO-8601 string (e.g. '2026-07-07T12:34:56.000Z').
// Suitable for columns that already store ISO strings (e.g. sync last_*_at values).
function nowIso() {
    return new Date().toISOString();
}

// Current UTC time in SQLite's CURRENT_TIMESTAMP text format: 'YYYY-MM-DD HH:MM:SS'.
// Use when a DATETIME column must be set explicitly in JS but should read back
// identically to a CURRENT_TIMESTAMP default.
function nowSqlDatetime() {
    return toSqlDatetime(new Date());
}

// Convert a Date or epoch-ms value to SQLite's 'YYYY-MM-DD HH:MM:SS' UTC text format.
function toSqlDatetime(value) {
    const date = value instanceof Date ? value : new Date(Number(value));
    if (Number.isNaN(date.getTime())) {
        throw new Error('toSqlDatetime: invalid date value');
    }
    return date.toISOString().slice(0, 19).replace('T', ' ');
}

module.exports = { nowEpochMs, nowIso, nowSqlDatetime, toSqlDatetime };
