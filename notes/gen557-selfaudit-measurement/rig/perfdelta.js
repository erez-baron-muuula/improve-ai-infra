// Controlled: same input through the LIVE detector and the WORKING one, so the
// 200k-single-line cost is attributed to the diff or to pre-existing code.
const fs = require('fs');
const path = require('path');
const START = 'const SELF_AUDIT_PATTERNS = [';
const END = '// Durable, append-only log of self-audit detections';
function load(f) {
  const s = fs.readFileSync(f, 'utf8');
  return new Function(s.slice(s.indexOf(START), s.indexOf(END)) + '\n; return findSelfAudit;')();
}
const live = load('C:\\Users\\Erez\\.claude\\hooks\\stop-claim-linter.js');
const work = load(path.join(__dirname, 'working.js'));

const cases = {
  '200k 1 line, quoted, ~10k matches': ('"' + 'nothing to correct '.repeat(11000)).slice(0, 200000),
  '200k 1 line, unquoted, ~10k matches': 'nothing to correct '.repeat(11000).slice(0, 200000),
  '200k 1 line, old-pattern phrase only': 'came back clean '.repeat(12500).slice(0, 200000),
  '200k ordinary prose lines': ('the quick brown fox jumped over it. '.repeat(6) + '\n').repeat(900).slice(0, 200000),
};
function best(fn, t) { let m = Infinity; for (let i = 0; i < 3; i++) { const a = process.hrtime.bigint(); fn(t); const d = Number(process.hrtime.bigint() - a) / 1e6; if (d < m) m = d; } return m; }
console.log('  live      working   delta   input');
for (const [k, t] of Object.entries(cases)) {
  const l = best(live, t), w = best(work, t);
  console.log('  ' + l.toFixed(1).padStart(7) + '  ' + w.toFixed(1).padStart(7) + '  ' +
              ((w - l) >= 0 ? '+' : '') + (w - l).toFixed(1).padStart(6) + '   ' + k);
}
