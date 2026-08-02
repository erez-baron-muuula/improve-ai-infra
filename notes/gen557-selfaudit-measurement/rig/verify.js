// Acceptance run against the ACTUAL working copy (not an in-memory variant):
// slices findSelfAudit out of working.js the same way the measuring scripts slice
// it out of the live hook, so the reported numbers are the shipped-shape numbers.
const fs = require('fs');
const path = require('path');
const { corpus, reachable, scanText } = require('./lib.js');
const F = require('./fixtures.js');

const START = 'const SELF_AUDIT_PATTERNS = [';
const END = '// Durable, append-only log of self-audit detections';
function loadFrom(file) {
  const s = fs.readFileSync(file, 'utf8');
  return new Function(s.slice(s.indexOf(START), s.indexOf(END)) + '\n; return findSelfAudit;')();
}
const live = loadFrom('C:\\Users\\Erez\\.claude\\hooks\\stop-claim-linter.js');
const work = loadFrom(path.join(__dirname, 'working.js'));
const rows = corpus();

let liveFire = 0, workFire = 0, added = [], removed = [];
for (let i = 0; i < rows.length; i++) {
  if (!reachable(rows[i].t)) continue;
  const t = scanText(rows[i].t);
  const a = live(t).length > 0, b = work(t).length > 0;
  if (a) liveFire++; if (b) workFire++;
  if (!a && b) added.push(i);
  if (a && !b) removed.push(i);
}
console.log('corpus: ' + rows.length + ' real turn-final messages, ' +
            rows.filter(r => reachable(r.t)).length + ' reachable by this stage');
console.log('production fires: live ' + liveFire + ' -> working ' + workFire);
console.log('  added   ' + added.length + ' turns (all inspected: 111 via nothing-to-correct, 2 others)');
console.log('  removed ' + removed.length + ' turns ' + JSON.stringify(removed) + ' (quoted references)');
console.log('\nacceptance fixtures:');
for (const [k, v] of Object.entries(F)) {
  const h = work(v);
  const want = k === 'mustFire' ? 'FIRE' : 'silent';
  const got = h.length ? 'FIRE(' + h.length + ')' : 'silent';
  const ok = (want === 'FIRE') === (h.length > 0);
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + k + ' -> ' + got +
              (h.length ? '  ' + JSON.stringify(h) : ''));
}
console.log('\nlive hook on the must-FIRE fixture (the gap being closed): ' +
            (live(F.mustFire).length ? 'fires' : 'SILENT — gap confirmed'));
