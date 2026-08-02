// Deterministically regenerate the GEN-557 working copy from the LIVE hook.
// Asserts each anchor occurs exactly once, so a drifted hook fails loud.
const fs = require('fs');
const path = require('path');
const HOOK = 'C:\\Users\\Erez\\.claude\\hooks\\stop-claim-linter.js';
const OUT = path.join(__dirname, 'working.js');

const A_ARRAY_CLOSE = "  { re: /\\bnothing (?:to do|left to do)[,;]? (?:so )?cancel+ing\\b/i },\n];";
const A_LOOP = "      if (m.index === re.lastIndex) { re.lastIndex++; } // guard against zero-width match loop";
const A_HEADER = "// Find self-audit narration hits. Sentence/position-agnostic BY DESIGN:";

function once(s, anchor, label) {
  let n = 0, i = -1;
  while ((i = s.indexOf(anchor, i + 1)) !== -1) n++;
  if (n !== 1) throw new Error('anchor "' + label + '" found ' + n + ' times, expected 1');
}

let s = fs.readFileSync(HOOK, 'utf8');
for (const [a, l] of [[A_ARRAY_CLOSE, 'array-close'], [A_HEADER, 'findSelfAudit-header']]) once(s, a, l);
// The zero-width guard line is IDENTICAL in findNakedClaims and findSelfAudit
// (lines 293 and 403 of the live hook). A whole-file replace would patch the WRONG
// detector, so the match loop is only ever touched inside findSelfAudit's body.
const fnStart = s.indexOf('function findSelfAudit(text) {');
if (fnStart < 0) throw new Error('findSelfAudit not found');
const fnEnd = s.indexOf('\n}\n', fnStart);
if (fnEnd < 0) throw new Error('findSelfAudit end not found');
once(s.slice(fnStart, fnEnd), A_LOOP, 'match-loop (inside findSelfAudit)');
if (s.slice(0, fnStart).indexOf(A_LOOP) === -1) throw new Error('expected the sibling copy in findNakedClaims');

const patterns = fs.readFileSync(path.join(__dirname, 'frag-patterns.txt'), 'utf8');
const isquoted = fs.readFileSync(path.join(__dirname, 'frag-isquoted.txt'), 'utf8');

// 1. append the six new patterns inside SELF_AUDIT_PATTERNS
s = s.replace(A_ARRAY_CLOSE, A_ARRAY_CLOSE.replace('\n];', '\n') + patterns + '];');
// 2. insert isQuoted() above findSelfAudit's header comment
s = s.replace(A_HEADER, isquoted + A_HEADER);
// 3. call it first in the match loop -- scoped to findSelfAudit's body only
const at = s.indexOf('function findSelfAudit(text) {');
const end = s.indexOf('\n}\n', at);
const body = s.slice(at, end);
const patchedBody = body.replace(A_LOOP, A_LOOP +
  "\n      // A match inside a quote/code span is DISCUSSION, not narration (see isQuoted)." +
  "\n      // Applies to ALL patterns, new and pre-GEN-557 (Erez's explicit call, 2026-08-02)." +
  "\n      if (isQuoted(text, m.index)) continue;");
if (patchedBody === body) throw new Error('match-loop insertion did not apply');
s = s.slice(0, at) + patchedBody + s.slice(end);

fs.writeFileSync(OUT, s);
const live = fs.readFileSync(HOOK, 'utf8');
console.log('written ' + OUT);
console.log('live  : ' + live.length + ' bytes, ' + live.split('\n').length + ' lines');
console.log('working: ' + s.length + ' bytes, ' + s.split('\n').length + ' lines  (+' +
            (s.length - live.length) + ' bytes, +' + (s.split('\n').length - live.split('\n').length) + ' lines)');
console.log('CRLF in working copy: ' + (s.includes('\r\n') ? 'YES (BAD)' : 'no'));
