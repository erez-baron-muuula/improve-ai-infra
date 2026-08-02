// Post-fix verification of the two code-review findings that drove code changes.
const fs = require('fs');
const path = require('path');
const F = require('./fixtures.js');
const START = 'const SELF_AUDIT_PATTERNS = [';
const END = '// Durable, append-only log of self-audit detections';
function load(f) {
  const s = fs.readFileSync(f, 'utf8');
  return new Function(s.slice(s.indexOf(START), s.indexOf(END)) + '\n; return findSelfAudit;')();
}
const live = load('C:\\Users\\Erez\\.claude\\hooks\\stop-claim-linter.js');
const work = load(path.join(__dirname, 'working.js'));

console.log('=== Finding 1: per-match O(line) cost -> one linear pass ===');
const cases = {
  'Pass B input: 200k 1-line `"came back clean" ` x N': '"came back clean" '.repeat(Math.ceil(200000 / 18)).slice(0, 200000),
  'Pass B input: 200k 1-line `"nothing to correct" ` x N': '"nothing to correct" '.repeat(Math.ceil(200000 / 21)).slice(0, 200000),
  '200k ordinary prose lines': ('the quick brown fox jumped over it. '.repeat(6) + '\n').repeat(900).slice(0, 200000),
};
for (const [label, t] of Object.entries(cases)) {
  const a = process.hrtime.bigint(); live(t);
  const b = process.hrtime.bigint(); work(t);
  const c = process.hrtime.bigint();
  const l = Number(b - a) / 1e6, w = Number(c - b) / 1e6;
  console.log('  live ' + l.toFixed(1).padStart(8) + ' ms   working ' + w.toFixed(1).padStart(8) +
              ' ms   ' + label);
}

console.log('\n=== Finding 2: a FENCED example of the roll-call must stay silent ===');
const fencedRollcall = 'Here is the shape GEN-557 targets:\n\n```\n' +
  '- GEN-428 Part 1 — done, verified. ✓ closed\n' +
  '- GEN-551, GEN-554 — filed, verified. ✓ closed\n' +
  '```\n\nThat is the pattern I am adding a matcher for.';
const fencedWhole = 'Explaining the fixture:\n\n```\n' + F.mustFire + '\n```\n\nThat is the trigger text.';
const bareRollcall = 'Where things stand:\n\n' +
  '- GEN-428 Part 1 — done, verified. ✓ closed\n' +
  '- GEN-551, GEN-554 — filed, verified. ✓ closed\n';
for (const [label, t, want] of [
  ['fenced roll-call example', fencedRollcall, 'silent'],
  ['fenced copy of the whole must-FIRE fixture', fencedWhole, 'silent'],
  ['UNfenced roll-call (must still fire)', bareRollcall, 'FIRE'],
  ['the must-FIRE fixture itself', F.mustFire, 'FIRE'],
]) {
  const h = work(t);
  const got = h.length ? 'FIRE(' + h.length + ')' : 'silent';
  const ok = (want === 'FIRE') === (h.length > 0);
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  want ' + want.padEnd(6) + ' got ' +
              got.padEnd(8) + '  ' + label);
}

console.log('\n=== Finding 3: hit echoed into the nudge is single-line ===');
const h = work(bareRollcall);
console.log('  hits: ' + JSON.stringify(h));
console.log('  any hit containing a newline: ' + h.some(x => x.includes('\n')));

console.log('\n=== mask semantics equivalence spot-check (non-fenced input) ===');
// The mask must reproduce the original per-line parity test exactly on unfenced text.
function isQuotedOld(text, at) {
  const ls = text.lastIndexOf('\n', at - 1) + 1;
  const b = text.slice(ls, at);
  return ((b.match(/"/g) || []).length % 2 === 1) || ((b.match(/`/g) || []).length % 2 === 1) ||
         (((b.match(/“/g) || []).length - (b.match(/”/g) || []).length) > 0);
}
const wsrc = fs.readFileSync(path.join(__dirname, 'working.js'), 'utf8');
const mk = new Function(wsrc.slice(wsrc.indexOf('function buildSuppressionMask'),
  wsrc.indexOf('// Find self-audit narration hits')) + '\n; return buildSuppressionMask;')();
const samples = require('./lib.js').corpus().slice(0, 400).map(r => r.t).filter(t => !t.includes('```'));
let checked = 0, mismatch = 0;
for (const t of samples) {
  const mask = mk(t);
  for (let i = 0; i < t.length; i += 7) {
    checked++;
    if ((mask[i] === 1) !== isQuotedOld(t, i)) { mismatch++; if (mismatch < 4) console.log('  MISMATCH at ' + i); }
  }
}
console.log('  positions checked ' + checked + ' across ' + samples.length +
            ' unfenced real messages, mismatches: ' + mismatch);
