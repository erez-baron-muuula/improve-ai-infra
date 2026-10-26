// GEN-893 Part 2 /vet-rule Step 6: installed skill files byte-identical to the reviewed working
// copies, and no live (unconsumed) gen893 check pass left behind.
const fs = require('fs');
const path = require('path');
const os = require('os');
let bad = 0;
for (const s of ['suggest', 'vet-rule', 'vet-code', 'vet-ticket', 'check']) {
  const live = fs.readFileSync(path.join(os.homedir(), '.claude', 'skills', s, 'SKILL.md'));
  const wc = fs.readFileSync(path.join(__dirname, 'wc2', s, 'SKILL.md'));
  const same = live.equals(wc);
  if (!same) bad++;
  console.log((same ? 'identical ' : 'DIFFERENT ') + s);
}
const dir = path.join(os.homedir(), '.claude-staging', 'check-passes');
const left = fs.readdirSync(dir).filter(f => /^pass-gen893-.*\.json$/.test(f));
const consumed = fs.readdirSync(dir).filter(f => /^pass-gen893-.*\.consumed\./.test(f));
console.log('consumed passes: ' + consumed.length + '; live passes left: ' + left.length + (left.length ? ' ' + left.join(', ') : ''));
if (left.length) bad++;
process.exit(bad ? 1 : 0);
