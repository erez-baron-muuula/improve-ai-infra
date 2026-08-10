// Shared harness for GEN-557 measurement. Slices the LIVE detector out of the
// hook rather than reimplementing it, so every number reflects shipped logic.
const fs = require('fs');
const path = require('path');

const HOOK = 'C:\\Users\\Erez\\.claude\\hooks\\stop-claim-linter.js';
const START = 'const SELF_AUDIT_PATTERNS = [';
const END = '// Durable, append-only log of self-audit detections';

function hookSource() {
  const s = fs.readFileSync(HOOK, 'utf8');
  return s.slice(s.indexOf(START), s.indexOf(END));
}

// Compile a detector from a (possibly modified) slice of the hook.
function compile(slice) {
  return new Function(slice + '\n; return findSelfAudit;')();
}

// --- variant builders -------------------------------------------------------
// Locate SELF_AUDIT_PATTERNS' closing bracket STRUCTURALLY, not by pinning whichever
// pattern happens to be last. The original anchor was the literal source of the
// pre-GEN-557 final pattern followed by "\n];", and it went dead the moment the six
// GEN-557 patterns were appended above the close on install -- build() then threw
// 'array close anchor not found' for every caller (GEN-616, fixed 2026-08-03).
// hookSource() slices from the array's declaration to the log-const comment, and the
// FIRST "\n];" inside that slice is this array's close: verified 2026-08-03 that the
// slice holds three such sequences (the two later ones close SELF_AUDIT_CLEAN_MARKERS
// and SELF_AUDIT_CLEAR_MARKERS) and that the first is preceded by the roll-call pattern,
// i.e. the last element of SELF_AUDIT_PATTERNS. Being count-independent, this survives
// the next pattern addition -- which is the property the old anchor lacked.
function arrayCloseIndex(s) {
  const i = s.indexOf('\n];');
  if (i === -1) throw new Error('array close anchor not found');
  return i;
}
const LOOP_ANCHOR = '      if (m.index === re.lastIndex) { re.lastIndex++; } // guard against zero-width match loop';

const IS_QUOTED_FN = `
function isQuoted(text, at) {
  const lineStart = text.lastIndexOf('\\n', at - 1) + 1;
  const before = text.slice(lineStart, at);
  const straight = (before.match(/"/g) || []).length;
  const ticks = (before.match(/\`/g) || []).length;
  const smart = (before.match(/\\u201C/g) || []).length - (before.match(/\\u201D/g) || []).length;
  return (straight % 2 === 1) || (ticks % 2 === 1) || smart > 0;
}
`;

// addPatterns: array of source strings, e.g. '  { re: /x/i },'
// quoteGuard: 'none' | 'all' | 'new'   ('new' = only patterns tagged isNew:true)
function build(addPatterns, quoteGuard) {
  let s = hookSource();
  if (addPatterns && addPatterns.length) {
    const at = arrayCloseIndex(s);
    s = s.slice(0, at) + '\n' + addPatterns.join('\n') + s.slice(at);
  }
  if (quoteGuard && quoteGuard !== 'none') {
    if (s.indexOf(LOOP_ANCHOR) === -1) throw new Error('loop anchor not found');
    const cond = quoteGuard === 'all'
      ? '      if (isQuoted(text, m.index)) continue;'
      : '      if (pat.isNew && isQuoted(text, m.index)) continue;';
    s = s.replace(LOOP_ANCHOR, LOOP_ANCHOR + '\n' + cond);
    s = IS_QUOTED_FN + s;
  }
  return compile(s);
}

// --- pattern partition (GEN-467 fix pass, 2026-08-09; re-anchored 2026-08-10) --
// The GEN-602 reorder moved the six GEN-557 patterns to the TOP of
// SELF_AUDIT_PATTERNS, which silently broke the old comment-anchor text-slicing
// partition (crowdout.js sliced an EMPTY old set and reported a fabricated
// all-clear; oldonly.js's loud "old patterns lost" probe was satisfied by the
// literal "came back clean" inside a buildSuppressionMask comment). Partition
// by the g557:true MEMBERSHIP TAG the hook's own array now carries (GEN-467
// batch) -- self-describing, no cross-repo regex list to hand-sync. FALLBACK
// for the pre-tag live hook (until the batch applies): source-string
// membership against GEN557_SOURCES below. Either way the 10/6 counts are
// asserted loudly; a pattern added to the hook later changes them -- that is
// the desired loud failure; tag it g557 (or update the expected counts) in
// the same session.
const GEN557_SOURCES = [
  /✓[ \t]*closed\b/i,
  /\bthat['’]?s the complete set\b/i,
  /\bholds as written\b/i,
  /\bexhaustiveness claim\b[^.\n]{0,80}?\b(?:holds|stands|is accurate|checks out|survives)\b/i,
  /\bnothing to (?:correct|fix)\b/i,
  /^[ \t]*[-*]\s.*\b(?:done|filed|shipped|applied|resolved)[,;]\s*(?:and\s+)?verified\b[\s\S]{0,400}?^[ \t]*[-*]\s.*\b(?:done|filed|shipped|applied|resolved)[,;]\s*(?:and\s+)?verified\b/im,
].map(r => r.source);

// Eval the live SELF_AUDIT_PATTERNS array (declaration through its close).
function selfAuditArray() {
  const s = hookSource();
  const close = arrayCloseIndex(s);
  return new Function(s.slice(0, close + 3) + '\n; return SELF_AUDIT_PATTERNS;')();
}

// { olds, news } split by the g557 tag (source-list fallback pre-tag), counts
// asserted (10 old / 6 new).
function patternPartition() {
  const arr = selfAuditArray();
  const tagged = arr.some(p => p.g557 === true);
  const isNew = tagged
    ? (p => p.g557 === true)
    : (p => GEN557_SOURCES.indexOf(p.re.source) !== -1);
  const news = arr.filter(isNew);
  const olds = arr.filter(p => !isNew(p));
  if (news.length !== 6 || olds.length !== 10) {
    throw new Error('partition drift (' + (tagged ? 'tag' : 'source-fallback') +
      ' mode): expected 10 old / 6 GEN-557, got ' + olds.length + '/' + news.length +
      ' -- the hook array changed; re-derive');
  }
  return { olds, news };
}

// Compile a detector whose SELF_AUDIT_PATTERNS is exactly `patterns` (the rest
// of the detector -- masks, markers, findSelfAudit -- stays the live source).
// Serialization is PROPERTY-GENERIC (code-review 2026-08-10; the first form
// whitelisted re+needsClean and would silently strip any future per-pattern
// flag, making rig variants diverge from shipped semantics with no loud
// failure): every own property round-trips -- `re` via toString(), the rest
// via JSON.stringify.
function buildFrom(patterns) {
  const s = hookSource();
  const open = s.indexOf('[');           // the array's opening bracket
  const close = arrayCloseIndex(s);
  const body = patterns.map(p => {
    const props = Object.keys(p).map(k =>
      k === 're' ? 're: ' + p.re.toString() : k + ': ' + JSON.stringify(p[k]));
    return '  { ' + props.join(', ') + ' },';
  }).join('\n');
  return compile(s.slice(0, open + 1) + '\n' + body + s.slice(close));
}

// --- corpus -----------------------------------------------------------------
function corpus() {
  const p = path.join(__dirname, 'corpus.jsonl');
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

// Production reachability: Phase 2 exits before Phase 1 on any message whose
// stripped text carries a RECOGNISED opener (every guard branch exits without
// the Phase-1 scan, including the release-skipped-tail path).
// DERIVED FROM THE HOOK SOURCE, never a hand-typed copy (code-review
// 2026-08-10: a forward-synced copy here made the rig measure a HYBRID regime
// -- post-apply reachability gating a pre-apply detector -- with no drift
// detector; deriving honors this file's own header: every number reflects
// shipped logic). Reads the same file hookSource() slices, so reachability
// and detector always describe the SAME regime, pre- or post-apply. Fails
// loudly if the declaration moves.
function hookOpenerRe() {
  const s = fs.readFileSync(HOOK, 'utf8');
  const m = s.match(/const BLOCK_OPENER_RE = (\/.*\/[a-z]*);/);
  if (!m) throw new Error('BLOCK_OPENER_RE declaration not found in ' + HOOK + ' -- re-derive');
  return new Function('return ' + m[1] + ';')();
}
const BLOCK_OPENER_RE = hookOpenerRe();
function stripFences(t) { return t.replace(/```[\s\S]*?(?:```|$)/g, ''); }
function reachable(t) { return !BLOCK_OPENER_RE.test(stripFences(t)); }

const MAX_SCAN_CHARS = 200000;
function scanText(t) { return t.length > MAX_SCAN_CHARS ? t.slice(0, MAX_SCAN_CHARS) : t; }

module.exports = { hookSource, compile, build, corpus, reachable, scanText,
  selfAuditArray, patternPartition, buildFrom };
