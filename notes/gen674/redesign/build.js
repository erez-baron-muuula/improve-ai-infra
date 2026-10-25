// GEN-674 size-stop redesign: build working copies from the live files by exact-once replacements.
// Reads spec-*.txt (blocks of @@@OLD / @@@NEW / @@@END lines) and writes wc/<name>. Aborts on any
// replacement that does not match exactly once. Writes nothing outside wc/. Prints sha256 of each copy.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HERE = __dirname;
const WC = path.join(HERE, 'wc');
const DRIVE = 'G:/My Drive/AI Projects/_Tooling/Claude/';
const HOOKS = 'C:/Users/Erez/.claude/hooks/';
const JOBS = [
  { live: DRIVE + 'update-config.ps1', spec: 'spec-update-config.txt', out: 'update-config.ps1' },
  { live: HOOKS + 'auto-approve.js', spec: 'spec-auto-approve.txt', out: 'auto-approve.js' },
  { live: HOOKS + 'sessionstart-backup-surfacer.js', spec: 'spec-surfacer.txt', out: 'sessionstart-backup-surfacer.js' },
  { live: HOOKS + 'deny-askuserquestion.js', spec: 'spec-deny.txt', out: 'deny-askuserquestion.js' },
  { live: 'C:/Users/Erez/.claude/settings.json', spec: 'spec-settings.txt', out: 'settings.json' },
];

function parseSpec(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const reps = [];
  let mode = null, oldL = [], newL = [];
  for (const ln of lines) {
    if (ln === '@@@OLD') { mode = 'old'; oldL = []; newL = []; continue; }
    if (ln === '@@@NEW') { mode = 'new'; continue; }
    if (ln === '@@@END') { reps.push({ old: oldL.join('\n') + '\n', neu: newL.join('\n') + '\n' }); mode = null; continue; }
    if (mode === 'old') oldL.push(ln);
    else if (mode === 'new') newL.push(ln);
  }
  if (mode !== null) throw new Error('unterminated block');
  return reps;
}

fs.mkdirSync(WC, { recursive: true });
let failed = false;
for (const job of JOBS) {
  let s = fs.readFileSync(job.live, 'utf8');
  const reps = parseSpec(fs.readFileSync(path.join(HERE, job.spec), 'utf8'));
  reps.forEach((r, i) => {
    const n = s.split(r.old).length - 1;
    if (n !== 1) { console.log('FAIL', job.out, 'replacement', i + 1, 'matched', n, 'times'); failed = true; return; }
    s = s.replace(r.old, () => r.neu);
  });
  if (failed) continue;
  fs.writeFileSync(path.join(WC, job.out), s, 'utf8');
  console.log('ok', job.out, reps.length, 'replacements', crypto.createHash('sha256').update(s, 'utf8').digest('hex'));
}
const hook = fs.readFileSync(path.join(WC, 'size-approval-prompt.js'), 'utf8');
console.log('ok size-approval-prompt.js (authored)', crypto.createHash('sha256').update(hook, 'utf8').digest('hex'));
process.exit(failed ? 1 : 0);
