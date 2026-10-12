// GEN-699 live-verify: run the installed hook and a candidate over the same real payload corpus and
// list every payload whose scope verdict differs. Read-only: both hooks are spawned with the read-only
// --ticket-scope-batch CLI.
//   node verdict-diff.js <candidate hook path> [corpus path]
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LIVE = path.join(os.homedir(), '.claude', 'hooks', 'auto-approve.js');
const CAND = process.argv[2];
const CORPUS = process.argv[3] || path.join(os.tmpdir(), 'gen508-notion-payload-corpus.jsonl');
if (!CAND) { console.error('usage: node verdict-diff.js <candidate hook> [corpus]'); process.exit(3); }

function batch(hook) {
  const r = spawnSync(process.execPath, [hook, '--ticket-scope-batch', CORPUS],
                      { encoding: 'utf8', input: '', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) { console.error(hook + ' exited ' + r.status + ': ' + (r.stderr || '').slice(0, 300)); process.exit(3); }
  return r.stdout.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l));
}

const a = batch(LIVE), b = batch(CAND);
if (a.length !== b.length) { console.error('verdict count differs: ' + a.length + ' vs ' + b.length); process.exit(1); }
const rows = fs.readFileSync(CORPUS, 'utf8').split(/\r?\n/).filter(l => l.trim());
let diffs = 0;
for (let i = 0; i < a.length; i++) {
  const ka = a[i].scope + '/' + (a[i].reason || '') + '/' + (a[i].why || '');
  const kb = b[i].scope + '/' + (b[i].reason || '') + '/' + (b[i].why || '');
  if (ka !== kb) {
    diffs++;
    let ts = ''; try { ts = JSON.parse(rows[i]).ts; } catch (e) { /* ignore */ }
    console.log('line ' + (i + 1) + ' ' + a[i].short + ' ' + ts + ': ' + ka + '  ->  ' + kb);
  }
}
console.log(a.length + ' payloads, ' + diffs + ' verdict changes');
process.exit(diffs === 0 ? 0 : 1);
