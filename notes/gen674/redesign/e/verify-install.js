// GEN-674 option E, /vet-code Step 8: installed files byte-identical to the vetted working copies (raw and
// LF-normalized hash), and no still-valid vetting pass left for any target.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const WC = path.join(__dirname, 'wc');
const PAIRS = [
  ['update-config.ps1', 'G:/My Drive/AI Projects/_Tooling/Claude/update-config.ps1'],
  ['auto-approve.js', 'C:/Users/Erez/.claude/hooks/auto-approve.js'],
  ['sessionstart-backup-surfacer.js', 'C:/Users/Erez/.claude/hooks/sessionstart-backup-surfacer.js'],
  ['deny-askuserquestion.js', 'C:/Users/Erez/.claude/hooks/deny-askuserquestion.js'],
  ['settings.json', 'C:/Users/Erez/.claude/settings.json'],
];
const h = s => crypto.createHash('sha256').update(s).digest('hex');
let ok = true;
for (const [name, live] of PAIRS) {
  const a = fs.readFileSync(path.join(WC, name));
  const b = fs.readFileSync(live);
  const same = Buffer.compare(a, b) === 0;
  if (!same) ok = false;
  console.log(same ? 'IDENTICAL' : 'DIFFERS ', name, h(b.toString('utf8').replace(/\r\n/g, '\n')));
}
const dir = path.join(os.homedir(), '.claude-staging', 'vetting-passes');
const live = fs.readdirSync(dir).filter(n => /\.json$/.test(n) && !/^record-/.test(n)).filter(n => {
  try { const p = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); return p.kind === 'vetting' && Date.parse(p.expires) > Date.now(); } catch (e) { return false; }
});
console.log('still-valid vetting passes:', live.length ? live.join(', ') : 'none');
if (live.length) ok = false;
console.log(ok ? 'VERIFY OK' : 'VERIFY FAILED');
process.exit(ok ? 0 : 1);
