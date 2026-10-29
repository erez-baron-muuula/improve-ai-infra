// GEN-892: write notes/gen892/wc.diff, the unified diff of every live file against its working copy.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const WC = path.join(__dirname, 'wc');
const PAIRS = [
  ['C:/Users/Erez/.claude/hooks/guidelines-limits.js', 'hooks/guidelines-limits.js'],
  ['C:/Users/Erez/.claude/hooks/inject-notion-refs.js', 'hooks/inject-notion-refs.js'],
  ['C:/Users/Erez/.claude/hooks/inject-shell-refs.js', 'hooks/inject-shell-refs.js'],
  ['C:/Users/Erez/.claude/hooks/inject-topic-refs.js', 'hooks/inject-topic-refs.js'],
  ['C:/Users/Erez/.claude/hooks/inject-browser-refs.js', 'hooks/inject-browser-refs.js'],
  ['C:/Users/Erez/.claude/hooks/sessionstart-backup-surfacer.js', 'hooks/sessionstart-backup-surfacer.js'],
  ['C:/Users/Erez/.claude/hooks/sessionstart-skill-restore.js', 'hooks/sessionstart-skill-restore.js'],
  ['G:/My Drive/AI Projects/_Tooling/Claude/update-config.ps1', 'drive/update-config.ps1'],
  ['C:/Users/Erez/.claude/skills/config-health/config-health-scan.ps1', 'skills/config-health-scan.ps1'],
  [path.join(__dirname, '..', 'release-review', 'release-review-tool.js'), 'notes/release-review/release-review-tool.js'],
  [path.join(__dirname, '..', 'anthropic-guidelines.json'), 'notes/anthropic-guidelines.json'],
];
let out = '';
for (const [live, rel] of PAIRS) {
  const wc = path.join(WC, rel);
  const a = fs.existsSync(live) ? live : 'NUL';
  const r = spawnSync('git', ['diff', '--no-index', '--no-color', '--ignore-cr-at-eol', '--', a, wc], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  out += '### ' + rel + ' (live: ' + live + (a === 'NUL' ? ', NEW FILE' : '') + ')\n' + r.stdout + '\n';
}
fs.writeFileSync(path.join(__dirname, 'wc.diff'), out, 'utf8');
console.log('wc.diff', out.length, 'characters,', out.split('\n').length, 'lines');
