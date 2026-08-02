// Pass A live probes: can the new code blow the hook's 5s watchdog on adversarial
// but reachable input? Uses the REAL detector sliced out of the working copy.
const fs = require('fs');
const path = require('path');
const START = 'const SELF_AUDIT_PATTERNS = [';
const END = '// Durable, append-only log of self-audit detections';
const src = fs.readFileSync(path.join(__dirname, 'working.js'), 'utf8');
const find = new Function(src.slice(src.indexOf(START), src.indexOf(END)) + '\n; return findSelfAudit;')();
const MAX = 200000; // the hook's MAX_SCAN_CHARS

function time(label, text) {
  const t0 = process.hrtime.bigint();
  const hits = find(text.slice(0, MAX));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log('  ' + ms.toFixed(1).padStart(9) + ' ms  ' + label + '  (hits ' + hits.length + ')');
  return ms;
}

console.log('--- Probe 1: isQuoted on ONE long line with very many matches ---');
// Single line, no newlines: isQuoted scans from lineStart(0) to the match each time.
// One leading quote makes parity odd, so EVERY match is suppressed -> the hit cap
// never trips and the loop runs over all matches.
time('200k single line, 1 quote + ~10k "nothing to correct"',
     '"' + 'nothing to correct '.repeat(11000));
time('200k single line, no quote (cap trips early)',
     'nothing to correct '.repeat(11000));

console.log('\n--- Probe 2: pattern 6 backtracking, sharper than the first pass ---');
// First bullet unit matches, second never does within the gap -> full 400-char
// gap exploration from every start.
time('200k of "- a done, verified" + 500 filler, repeated',
     ('- a done, verified\n' + 'x'.repeat(500) + '\n').repeat(400));
// Many bullet lines that ALMOST match the unit (no comma), forcing the .* + alternation
// to backtrack on every line.
time('200k of near-miss bullet lines ("done verified", no comma)',
     ('- ' + 'done verified '.repeat(20) + '\n').repeat(700));
// Long single bullet line packed with the alternation words but never the full unit.
time('one 200k bullet line packed with "done," and no "verified"',
     '- ' + 'done, '.repeat(33000));

console.log('\n--- Probe 3: pathological quote density ---');
time('200k of alternating quotes with matches on each line',
     ('"nothing to correct\n').repeat(9000));
