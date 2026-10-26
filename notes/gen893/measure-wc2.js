// Run the installed size checker on each GEN-893 Part 2 draft as if it were the real file; print sizeLines.
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const SCRIPT = 'C:/Users/Erez/.claude/skills/config-health/config-health-scan.ps1';
const lines = [];
for (const s of ['suggest', 'vet-rule', 'vet-code', 'vet-ticket', 'check']) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Action', 'size-check',
    '-Target', path.join(__dirname, 'wc2', s, 'SKILL.md'), '-AsIfPath', 'C:/Users/Erez/.claude/skills/' + s + '/SKILL.md'], { encoding: 'utf8' });
  const o = JSON.parse(r.stdout);
  for (const l of [].concat(o.sizeLines)) lines.push(l);
  if ((o.lines || []).length) lines.push('  findings: ' + JSON.stringify(o.lines));
}
fs.writeFileSync(path.join(__dirname, 'wc2', 'size-lines.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
