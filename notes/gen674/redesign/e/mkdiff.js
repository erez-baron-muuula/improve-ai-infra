// Read-only: write the working-copy-vs-live unified diff of all GEN-674 option-E targets to wc.diff.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const WC = path.join(__dirname, 'wc');
const pairs = [
  ['G:/My Drive/AI Projects/_Tooling/Claude/update-config.ps1', 'update-config.ps1'],
  ['C:/Users/Erez/.claude/hooks/auto-approve.js', 'auto-approve.js'],
  ['C:/Users/Erez/.claude/hooks/sessionstart-backup-surfacer.js', 'sessionstart-backup-surfacer.js'],
  ['C:/Users/Erez/.claude/hooks/deny-askuserquestion.js', 'deny-askuserquestion.js'],
  ['C:/Users/Erez/.claude/settings.json', 'settings.json'],
];
let out = '';
for (const [live, name] of pairs) {
  const r = spawnSync('git', ['diff', '--no-index', '-U4', '--', live, path.join(WC, name)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  out += '### ' + name + ' (live: ' + live + ')\n' + (r.stdout || '') + '\n';
}
fs.writeFileSync(path.join(__dirname, 'wc.diff'), out);
console.log('wc.diff bytes', Buffer.byteLength(out), 'lines', out.split('\n').length);
