// GEN-674 option E: save byte-exact rollback copies of the five live targets into e/rollback/ (read-then-write,
// no shell copy), and print each one's sha256 (raw bytes) so a restore can be verified.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const OUT = path.join(__dirname, 'rollback');
const LIVE = [
  'G:/My Drive/AI Projects/_Tooling/Claude/update-config.ps1',
  'C:/Users/Erez/.claude/hooks/auto-approve.js',
  'C:/Users/Erez/.claude/hooks/sessionstart-backup-surfacer.js',
  'C:/Users/Erez/.claude/hooks/deny-askuserquestion.js',
  'C:/Users/Erez/.claude/settings.json',
];
fs.mkdirSync(OUT, { recursive: true });
for (const f of LIVE) {
  const b = fs.readFileSync(f);
  const dst = path.join(OUT, path.basename(f) + '.live-2026-10-25');
  fs.writeFileSync(dst, b);
  const same = Buffer.compare(fs.readFileSync(dst), b) === 0;
  console.log(same ? 'ok' : 'MISMATCH', path.basename(dst), b.length, crypto.createHash('sha256').update(b).digest('hex'));
}
