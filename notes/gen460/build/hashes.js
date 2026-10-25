// GEN-460: compare the live targets with the baselines the working copies were built from, and
// print the normalized (UTF-8, LF) sha256 of each working copy for the vetting records.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const wc = path.join(__dirname, '..', 'gen460');
const norm = (b) => crypto.createHash('sha256').update(b.toString('utf8').replace(/\r\n/g, '\n'), 'utf8').digest('hex');
const pairs = [
  ['auto-approve.js', 'C:/Users/Erez/.claude/hooks/auto-approve.js'],
  ['sync.ps1', 'G:/My Drive/AI Projects/_Tooling/Claude/sync.ps1'],
];
for (const [name, live] of pairs) {
  const liveB = fs.readFileSync(live);
  const origB = fs.readFileSync(path.join(wc, name + '.orig'));
  const st = fs.statSync(live);
  console.log(name, '| live==baseline:', norm(liveB) === norm(origB), '| live mtime', st.mtime.toISOString(), '| working copy hash', norm(fs.readFileSync(path.join(wc, name))));
}
