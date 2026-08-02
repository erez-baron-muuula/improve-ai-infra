// Pass A round 2: probe buildSuppressionMask's edges by execution, not reasoning.
const fs = require('fs');
const path = require('path');
const F = require('./fixtures.js');
const src = fs.readFileSync(path.join(__dirname, 'working.js'), 'utf8');
const START = 'const SELF_AUDIT_PATTERNS = [';
const END = '// Durable, append-only log of self-audit detections';
const work = new Function(src.slice(src.indexOf(START), src.indexOf(END)) + '\n; return findSelfAudit;')();
const mask = new Function(src.slice(src.indexOf('function buildSuppressionMask'),
  src.indexOf('// Find self-audit narration hits')) + '\n; return buildSuppressionMask;')();

function fires(t) { return work(t).length > 0; }
const T = [];
function t(label, text, want) { T.push([label, text, want]); }

// Expectations below assert the behaviour AFTER fence handling was dropped
// (Erez's call, 2026-08-02). Fences carry no special meaning any more: the only
// suppression is per-line quote/backtick/smart-quote parity.

// --- CRLF ---
t('CRLF: plain narration must still fire', 'I checked it.\r\nEverything came back clean.\r\n', true);

// --- what dropping fence handling FIXED: no more whole-message silencing ---
t('stray ``` no longer silences the rest of the message',
  'Here is a snippet:\n```\nsome code\n\nLater, unrelated: everything came back clean and nothing to correct.\n', true);
t('fenced example containing a fence opener (odd nesting) no longer silences',
  'To open a fence type:\n```\n```js\n```\nThen I checked and it came back clean.\n', true);
t('4-space-indented ``` no longer silences',
  'text\n    ```\nnothing to correct\n', true);

// --- what dropping it COSTS: the accepted residual, tracked on GEN-592 ---
t('ACCEPTED RESIDUAL: a fenced example now fires',
  'Example:\n```\nEverything came back clean.\n```\nThat is the shape.\n', true);
t('ACCEPTED RESIDUAL: a fenced roll-call example now fires',
  'The shape GEN-557 targets:\n\n```\n- GEN-428 Part 1 — done, verified. ✓ closed\n' +
  '- GEN-551, GEN-554 — filed, verified. ✓ closed\n```\n\nThat is what I am matching.', true);
// The mitigation that DOES survive: a blockquoted example still cannot fire the
// roll-call pattern, because the line-start anchor rejects the "> " prefix.
t('blockquoted roll-call example does not fire the roll-call pattern',
  'The shape:\n\n> - GEN-428 Part 1 — done, verified\n> - GEN-551, GEN-554 — filed, verified\n', false);

// --- parity still works (pre-existing semantics, unchanged) ---
t('inline-code span suppresses (odd backtick parity)',
  'Type ``` to fence. Nothing to correct.\n', false);
t('quoted phrase suppresses (odd double-quote parity)',
  'The flagged phrase was "nothing to correct" in that message.\n', false);

// --- the must-fire fixture must survive all of this ---
t('ticket must-FIRE fixture', F.mustFire, true);

let fail = 0;
for (const [label, text, want] of T) {
  const got = fires(text);
  const ok = got === want;
  if (!ok) { fail++; }
  console.log('  ' + (ok ? 'ok  ' : 'DIFF') + '  want ' + (want ? 'FIRE  ' : 'silent') +
              '  got ' + (got ? 'FIRE  ' : 'silent') + '  ' + label);
}
console.log('\nunexpected: ' + fail + ' of ' + T.length +
            '  (DIFF lines are behaviours to judge, not necessarily bugs)');

// The regression this drop was FOR: a stray fence used to mask ~91% of this message.
const strayLen = 'x\n```\n' + 'filler line\n'.repeat(50) + 'it came back clean\n';
const m = mask(strayLen);
let masked = 0;
for (let i = 0; i < m.length; i++) { if (m[i] === 1) { masked++; } }
console.log('\nstray-fence reach now: ' + masked + ' of ' + m.length + ' chars masked (' +
            (100 * masked / m.length).toFixed(0) + '%) -- was 571/625 (91%) with fence handling');
