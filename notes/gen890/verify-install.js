// GEN-890: confirm every installed file is byte-identical (LF-normalized) to its reviewed working copy,
// and that no unconsumed gen890 check pass is left behind.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const h = s => crypto.createHash('sha256').update(s.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
const WC = path.join(__dirname, 'wc', 'text');
const SK = 'C:/Users/Erez/.claude/skills/';
const files = ['config-health/SKILL.md', 'config-health/size-weekly.md', 'wrap/SKILL.md', 'wrap/step1-capture.md',
  'notion-ticket-lookup/SECURE-LOOKUP-DESIGN.md', 'wrap/readouts-3d-3j.md', 'vet-ticket/record-card-mint.md',
  'vet-code/reviews.md', 'vet-code/live-verify.md', 'vet-code/gate-mechanics.md'];
let bad = 0;
for (const f of files) {
  const same = h(fs.readFileSync(SK + f, 'utf8')) === h(fs.readFileSync(path.join(WC, f), 'utf8'));
  if (!same) bad++;
  console.log((same ? 'match ' : 'MISMATCH ') + f);
}
const sc = fs.readFileSync(SK + 'config-health/config-health-scan.ps1'), wcs = fs.readFileSync(path.join(__dirname, 'wc', 'config-health-scan.ps1'));
console.log((sc.equals(wcs) ? 'match ' : 'MISMATCH ') + 'config-health/config-health-scan.ps1');
if (!sc.equals(wcs)) bad++;
const live = fs.readdirSync('C:/Users/Erez/.claude-staging/check-passes/').filter(n => /^gen890-.*\.check\.json$/.test(n));
console.log('unconsumed gen890 passes: ' + live.length + (live.length ? ' ' + live.join(', ') : ''));
process.exit(bad || live.length ? 1 : 0);
