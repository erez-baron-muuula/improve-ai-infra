// GEN-699 live-verify for the verdict-token change: run every real ticket-reviewer transcript on this
// machine through --ticket-verify on the installed hook and on a candidate, and list every outcome that
// differs. The hash checked is the one in the transcript's own LAST verdict token, so a genuine PASS
// review reads `ok` on the installed hook.
//   node token-diff.js <candidate hook path>
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LIVE = path.join(os.homedir(), '.claude', 'hooks', 'auto-approve.js');
const CAND = process.argv[2];
if (!CAND) { console.error('usage: node token-diff.js <candidate hook>'); process.exit(3); }
const PROJ = path.join(os.homedir(), '.claude', 'projects');
const PREFIX = 'TICKET-REVIEW-VERDICT:';

const files = [];
(function walk(d, depth) {
  if (depth > 4) return;
  let ents = [];
  try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, depth + 1);
    else if (/^agent-.+\.jsonl$/.test(e.name) && path.basename(d) === 'subagents') files.push(p);
  }
})(PROJ, 0);

function verify(hook, file, hash) {
  const r = spawnSync(process.execPath, [hook, '--ticket-verify', file, '--hash', hash], { encoding: 'utf8', input: '' });
  return (r.stdout || '').trim() + ' (exit ' + r.status + ')';
}

let n = 0, diffs = 0, ok = 0;
const tally = {};
for (const f of files) {
  let txt; try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
  if (txt.indexOf(PREFIX) === -1) continue;
  const all = txt.match(/TICKET-REVIEW-VERDICT:\s*(?:PASS|REVISE)\s+([0-9a-f]{64})/gi);
  if (!all) continue;
  const hash = all[all.length - 1].match(/([0-9a-f]{64})/i)[1].toLowerCase();
  n++;
  const a = verify(LIVE, f, hash), b = verify(CAND, f, hash);
  tally[a] = (tally[a] || 0) + 1;
  if (a.startsWith('ok')) ok++;
  if (a !== b) { diffs++; console.log(path.basename(f) + ' ' + hash.slice(0, 12) + ': ' + a + '  ->  ' + b); }
}
console.log(n + ' reviewer transcripts with a verdict token; installed-hook outcomes ' + JSON.stringify(tally) +
            '; ' + diffs + ' outcome changes');
process.exit(diffs === 0 ? 0 : 1);
