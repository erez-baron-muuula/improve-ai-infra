// guidelines-limits.js -- shared reader for the size limits in notes/anthropic-guidelines.json (GEN-892).
// Not a hook: required by inject-notion-refs.js, inject-shell-refs.js, inject-topic-refs.js,
// inject-browser-refs.js, sessionstart-backup-surfacer.js and sessionstart-skill-restore.js. Each keeps its
// own FALLBACK_* number and requires this file inside try/catch, so a missing or broken copy means today's
// numbers. update-config.ps1 (Get-RulesLineLimit) reads the rules-file limit through this file's command line
// (bottom of the file), so one reader serves both.
//
// The weekly guidelines watch (release-review-tool.js guidelines-check --apply) updates a limit's number when
// Anthropic's docs change it, and appends a row to notes/release-review/guidelines-changes.jsonl. Rules here:
//   1. Unreadable limits file, unknown id, or a value that is not a whole number -> the caller's
//      fallback; a whole number outside [min, max] -> the fallback plus an outOfRange warning.
//   2. A value at or below the fallback is used (lowering a limit is always safe).
//   3. A value above the fallback is used only when the last applied row in the change log for that limit
//      and field carries the same value (rows whose changeId was later marked not-applied are ignored).
//      Otherwise the fallback, plus a warning the session-start surfacer reports. So a hand edit of the
//      limits file can lower a limit but cannot raise one.
// Never throws.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

function notesDir(home) {
  return path.join(home || os.homedir(), 'AI Projects', 'Improve AI Infra', 'notes');
}

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

// Rows of the change log in file order; a malformed line is skipped, a missing file gives [].
function readLog(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return []; }
  const rows = [];
  for (const line of stripBom(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && typeof row === 'object' && !Array.isArray(row)) rows.push(row);
    } catch (e) { /* skip a malformed line */ }
  }
  return rows;
}

// Explicit row shape: status and limit are strings; field is absent, null or '' (meaning 'value') or a string;
// changeId counts only as a non-empty string; new must be a whole number. Any other shape is skipped.
function rowField(r) {
  if (r.field === undefined || r.field === null || r.field === '') return 'value';
  return typeof r.field === 'string' ? r.field : null;
}
function rowChangeId(r) {
  return typeof r.changeId === 'string' && r.changeId ? r.changeId : null;
}

// The `new` value of the last applied row for this limit and field, or undefined.
function loggedValue(rows, id, field) {
  const notApplied = new Set();
  for (const r of rows) if (r.status === 'not-applied' && rowChangeId(r)) notApplied.add(rowChangeId(r));
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (typeof r.status !== 'string' || typeof r.limit !== 'string' || rowField(r) === null) continue;
    if (r.status !== 'applied' || r.limit !== id || rowField(r) !== field) continue;
    if (rowChangeId(r) && notApplied.has(rowChangeId(r))) continue;
    return Number.isInteger(r.new) ? r.new : undefined;
  }
  return undefined;
}

// opts: { fallback, min, max, field = 'value', home = os.homedir() }
// -> { value } | { value, warning: { id, field, value, fallback } } | { value, error }
function readLimit(id, opts) {
  const o = opts || {};
  const field = o.field || 'value';
  const fallback = o.fallback;
  try {
    const dir = notesDir(o.home);
    let g;
    try {
      g = JSON.parse(stripBom(fs.readFileSync(path.join(dir, 'anthropic-guidelines.json'), 'utf8')));
    } catch (e) {
      return { value: fallback, error: 'notes/anthropic-guidelines.json could not be read (' + ((e && (e.code || e.message)) || 'unknown error') + ')' };
    }
    // First entry whose id is exactly this string.
    const entry = g && Array.isArray(g.limits) ? g.limits.find(x => x && typeof x === 'object' && x.id === id) : null;
    const v = entry ? entry[field] : undefined;
    if (!Number.isInteger(v)) return { value: fallback };
    if (!(v >= o.min) || !(v <= o.max)) return { value: fallback, warning: { id, field, value: v, fallback, outOfRange: true } };
    if (v <= fallback) return { value: v };
    if (loggedValue(readLog(path.join(dir, 'release-review', 'guidelines-changes.jsonl')), id, field) === v) return { value: v };
    return { value: fallback, warning: { id, field, value: v, fallback } };
  } catch (e) {
    return { value: fallback, error: 'the limits reader failed (' + ((e && e.message) || 'unknown error') + ')' };
  }
}

module.exports = { readLimit, readLog, loggedValue, notesDir };

// Command line, for update-config.ps1: node guidelines-limits.js print <id> <fallback> <min> <max> <home>
// prints the limit's value (the fallback on any problem) as one line and exits 0. Bad arguments exit 2.
if (require.main === module) {
  const a = process.argv.slice(2);
  const num = s => (/^[0-9]{1,9}$/.test(s || '') ? Number(s) : NaN);
  const [fallback, min, max] = [num(a[2]), num(a[3]), num(a[4])];
  if (a.length !== 6 || a[0] !== 'print' || !a[1] || !a[5] || [fallback, min, max].some(Number.isNaN)) {
    process.stderr.write('usage: node guidelines-limits.js print <id> <fallback> <min> <max> <home>\n');
    process.exitCode = 2;
  } else {
    const r = readLimit(a[1], { fallback, min, max, home: a[5] });
    process.stdout.write(String(Number.isInteger(r.value) ? r.value : fallback) + '\n');
  }
}
