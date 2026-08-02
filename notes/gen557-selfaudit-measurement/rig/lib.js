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
const ARRAY_CLOSE = '  { re: /\\bnothing (?:to do|left to do)[,;]? (?:so )?cancel+ing\\b/i },\n];';
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
    if (s.indexOf(ARRAY_CLOSE) === -1) throw new Error('array close anchor not found');
    s = s.replace(ARRAY_CLOSE, ARRAY_CLOSE.replace('\n];', '\n') + addPatterns.join('\n') + '\n];');
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

// --- corpus -----------------------------------------------------------------
function corpus() {
  const p = path.join(__dirname, 'corpus.jsonl');
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

// Production reachability: Phase 2 exits before Phase 1 on any block-carrying msg.
const BLOCK_OPENER_RE = /^[ \t]{0,3}\*{0,2}\u{1F4CC}[ \t]*\*{0,2}[ \t]*For you/imu;
function stripFences(t) { return t.replace(/```[\s\S]*?(?:```|$)/g, ''); }
function reachable(t) { return !BLOCK_OPENER_RE.test(stripFences(t)); }

const MAX_SCAN_CHARS = 200000;
function scanText(t) { return t.length > MAX_SCAN_CHARS ? t.slice(0, MAX_SCAN_CHARS) : t; }

module.exports = { hookSource, compile, build, corpus, reachable, scanText };
