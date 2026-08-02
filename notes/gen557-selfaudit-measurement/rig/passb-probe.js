// Measure Pass B's exact adversarial input, replacing its analytic 2-10s estimate.
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

// Pass B's input: one line, no \n, `"nothing to correct" ` repeated to 200k.
const passB = '"nothing to correct" '.repeat(Math.ceil(200000 / 21)).slice(0, 200000);
// Same shape but on a PRE-EXISTING pattern, so live/working is a fair comparison.
const passBOld = '"came back clean" '.repeat(Math.ceil(200000 / 18)).slice(0, 200000);

for (const [label, t] of [['new pattern (live has no such pattern)', passB],
                          ['pre-existing pattern "came back clean"', passBOld]]) {
  const a = process.hrtime.bigint(); const lh = live(t);
  const b = process.hrtime.bigint(); const wh = work(t);
  const c = process.hrtime.bigint();
  console.log(label);
  console.log('   live   : ' + (Number(b - a) / 1e6).toFixed(1).padStart(8) + ' ms (hits ' + lh.length + ')');
  console.log('   working: ' + (Number(c - b) / 1e6).toFixed(1).padStart(8) + ' ms (hits ' + wh.length + ')');
}
console.log('\nNote: nothing in-process bounds this. clearTimeout(watchdog) is the first');
console.log('statement in the stdin end handler (hook line 578), so all scanning runs');
console.log('after the 5s watchdog is disarmed, and settings.json sets no hook timeout.');
