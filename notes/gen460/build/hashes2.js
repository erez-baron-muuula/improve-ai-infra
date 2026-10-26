// GEN-460: normalized (UTF-8, LF) sha256 of each working copy, for the vetting records, plus whether
// each live target still matches the baseline the copy was built from (GEN-655).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const norm = (b) => crypto.createHash('sha256').update(b.toString('utf8').replace(/\r\n/g, '\n'), 'utf8').digest('hex');
const pairs = [
  ['auto-approve.working.js', 'auto-approve.live-baseline.js', 'C:/Users/Erez/.claude/hooks/auto-approve.js'],
  ['sync.working.ps1', 'sync.live-baseline.ps1', 'G:/My Drive/AI Projects/_Tooling/Claude/sync.ps1'],
];
for (const [wc, base, live] of pairs) {
  const liveB = fs.readFileSync(live);
  const baseB = fs.readFileSync(path.join(__dirname, base));
  console.log(wc, '| live==baseline:', norm(liveB) === norm(baseB), '| working copy hash', norm(fs.readFileSync(path.join(__dirname, wc))));
}
