// Deterministically regenerate the GEN-557 working copy from the LIVE hook.
// Every anchor is asserted to occur exactly once (in its intended scope), so a
// drifted hook fails loud instead of silently patching the wrong place.
const fs = require('fs');
const path = require('path');
const HOOK = 'C:\\Users\\Erez\\.claude\\hooks\\stop-claim-linter.js';
const OUT = path.join(__dirname, 'working.js');

let s = fs.readFileSync(HOOK, 'utf8');
const live = s;

function count(hay, needle) {
  let n = 0, i = -1;
  while ((i = hay.indexOf(needle, i + 1)) !== -1) { n++; }
  return n;
}
function once(anchor, label, scope) {
  const n = count(scope === undefined ? s : scope, anchor);
  if (n !== 1) throw new Error('anchor "' + label + '" found ' + n + ' times, expected 1');
}
function sub(anchor, replacement, label) {
  once(anchor, label);
  s = s.replace(anchor, replacement);
}

const patterns = fs.readFileSync(path.join(__dirname, 'frag-patterns.txt'), 'utf8');
const maskFn = fs.readFileSync(path.join(__dirname, 'frag-mask.txt'), 'utf8');

// ---- 1. the six new patterns, appended inside SELF_AUDIT_PATTERNS ----------
const A_ARRAY_CLOSE = "  { re: /\\bnothing (?:to do|left to do)[,;]? (?:so )?cancel+ing\\b/i },\n];";
sub(A_ARRAY_CLOSE, A_ARRAY_CLOSE.replace('\n];', '\n') + patterns + '];', 'array-close');

// ---- 2. the suppression-mask builder, above findSelfAudit's header comment --
const A_HEADER = '// Find self-audit narration hits. Sentence/position-agnostic BY DESIGN:';
// The trailing '\n' restores the blank line this file keeps between top-level
// definitions -- without it the following comment block reads as part of the mask.
sub(A_HEADER, maskFn + '\n' + A_HEADER, 'mask-fn-insert');

// ---- 3. correct the header comment's stale block claim ---------------------
// Pre-existing and tracked on GEN-584, but it is false since GEN-467 v2.2 and now
// sits directly below 60 lines of new code, so a reader is actively misled.
const A_STALE_HEADER = `// Find self-audit narration hits. Sentence/position-agnostic BY DESIGN: a self-
// audit line is flagged wherever it appears, INCLUDING inside a "For you" block --
// the recurrence that prompted GEN-507 was exactly a self-audit line placed inside
// the block, so a block-membership exemption would swallow the target case. The`;
const NEW_HEADER = `// Find self-audit narration hits. Sentence/position-agnostic BY DESIGN: a self-
// audit line is flagged wherever it appears IN THE MESSAGES THIS STAGE SEES, with no
// sentence- or position-membership exemption -- the recurrence that prompted GEN-507
// was a self-audit line placed inside a "For you" block, so an exemption of that kind
// would have swallowed the target case.
// CORRECTION (GEN-557, 2026-08-02): this comment used to say the line is flagged
// "INCLUDING inside a 'For you' block". That stopped being true when GEN-467 v2.2
// removed the Arm-2 content gate: the Phase-2 guard now exits on EVERY branch before
// Phase 1 reaches this function, so a message the guard RECOGNISES as block-carrying
// is not scanned at all (1,771 of 4,356 real turns, 40.7%, measured 2026-08-02).
// The stale wording itself is tracked on GEN-584.
// Do NOT read the 40.7% as "no block-carrying message reaches here". At least three paths
// let one through, and this list is not claimed to be exhaustive: BLOCK_OPENER_RE does not
// recognise the markdown-heading form "## <pin> For you" (78 of those 4,356 turns, measured
// 2026-08-02); the guard is skipped outright when session_id or prompt_id is missing; and
// the opener test runs on stripFences(msg), so an odd number of fence markers can swallow
// a trailing opener along with the unpaired fence. Those are NOT part of GEN-584 -- they were
// found 2026-08-02, after it was filed -- and as of that date they have no ticket of their
// own; they are written up in the GEN-557 rig README under "Found on the way". Confirm
// before assuming either is tracked anywhere. The`;
sub(A_STALE_HEADER, NEW_HEADER, 'stale-header-claim');

// ---- 4. correct the stale MAINTENANCE note about forced-redo cost ----------
const A_STALE_MAINT = ` * errors. NOTE (Phase 2): a CLAIM_PATTERNS/SELF_AUDIT_PATTERNS false positive on
 * a block-carrying message now costs one visible forced redo, not just a nudge --
 * when adding patterns, run the guard-reason fixture (the guard's own reason
 * strings must never match any pattern) and weigh the redo cost.`;
const NEW_MAINT = ` * errors. NOTE (Phase 2): when adding patterns, run the guard-reason fixture (the
 * guard's own reason strings must never match any pattern).
 * CORRECTION (GEN-557, 2026-08-02): this note used to add that a false positive on a
 * block-carrying message "costs one visible forced redo, not just a nudge". That was
 * true only while the Arm-2 content gate existed; GEN-467 v2.2 removed it, so a pattern
 * false positive no longer costs a forced redo -- weigh the nudge cost, not a redo cost.
 * (Arm 1 still emits decision:'block' once per prompt_id, but on the duplicate-block
 * condition alone; it never consults either detector.) Do not upgrade that
 * into "block-carrying messages are never scanned": the Phase-2 guard skips only what
 * BLOCK_OPENER_RE RECOGNISES, which excludes the "## <pin> For you" heading form (78 of
 * 4,356 real turns, 2026-08-02) and is bypassed entirely when session_id/prompt_id is
 * missing. Required in-block report vocabulary can still reach a pattern by those paths.`;
sub(A_STALE_MAINT, NEW_MAINT, 'stale-maintenance-note');

// (No stripFences cross-reference: the self-audit mask no longer has any notion of a
// fence, so this file is back to ONE definition of a fenced span. The cross-reference
// added in the previous revision was removed with the fence handling it described.)

// ---- 5 & 6. inside findSelfAudit only: build the mask once, consult it per match --
// The zero-width-guard line is IDENTICAL in findNakedClaims and findSelfAudit, so the
// match loop is only ever touched within findSelfAudit's body.
const A_FN = 'function findSelfAudit(text) {\n  const hits = [];\n  const seen = new Set();';
const A_LOOP = '      if (m.index === re.lastIndex) { re.lastIndex++; } // guard against zero-width match loop';
const A_HIT = '      const hit = m[0].trim().slice(0, SELF_AUDIT_MAX_HIT); // hard cap (see const)';

once(A_FN, 'findSelfAudit-open');
const fnStart = s.indexOf(A_FN);
const fnEnd = s.indexOf('\n}\n', fnStart);
if (fnEnd < 0) { throw new Error('findSelfAudit end not found'); }
let body = s.slice(fnStart, fnEnd);
once(A_LOOP, 'match-loop (inside findSelfAudit)', body);
once(A_HIT, 'hit-construction (inside findSelfAudit)', body);
if (count(s.slice(0, fnStart), A_LOOP) !== 1) {
  throw new Error('expected exactly one sibling copy of the match loop in findNakedClaims');
}

body = body.replace(A_FN, A_FN +
  '\n  // One linear pass, then O(1) per match. Built here rather than tested per match --' +
  '\n  // the per-match form was O(line length) and uncapped. The measurement and the' +
  '\n  // structural bound are stated once, at buildSuppressionMask; not repeated here.' +
  '\n  const suppressed = buildSuppressionMask(text);');
body = body.replace(A_LOOP, A_LOOP +
  '\n      // A match inside a quote or an inline code span is DISCUSSION, not narration.' +
  '\n      // NOT fences -- those are deliberately uncovered; see buildSuppressionMask for' +
  '\n      // the semantics, the full residual list, and why the fence attempt was dropped.' +
  '\n      // Applies to ALL patterns, new and pre-GEN-557 (Erez\'s explicit call, 2026-08-02).' +
  '\n      if (suppressed[m.index] === 1) continue;');
// Collapse whitespace in the stored/echoed hit: the roll-call pattern spans two bullet
// lines, so without this the nudge embeds a multi-line blob inside one pair of quotes
// and the durable log gets multi-line entries. All 10 older patterns match short
// single-line phrases, so this is a no-op for them. (Pass A finding 3.)
body = body.replace(A_HIT,
  '      // .replace collapses whitespace FIRST: the roll-call pattern matches across two' +
  '\n      // bullet lines, and a multi-line hit is echoed into the nudge and the durable log.' +
  '\n      const hit = m[0].trim().replace(/\\s+/g, \' \').slice(0, SELF_AUDIT_MAX_HIT); // cap');
s = s.slice(0, fnStart) + body + s.slice(fnEnd);

fs.writeFileSync(OUT, s);
console.log('written ' + OUT);
console.log('live   : ' + live.length + ' chars, ' + live.split('\n').length + ' lines');
console.log('working: ' + s.length + ' chars, ' + s.split('\n').length + ' lines  (+' +
            (s.length - live.length) + ' chars, +' + (s.split('\n').length - live.split('\n').length) + ' lines)');
console.log('CRLF in working copy: ' + (s.includes('\r\n') ? 'YES (BAD)' : 'no'));
