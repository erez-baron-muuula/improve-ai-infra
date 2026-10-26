// Demo: change a limit in a copy of the thresholds file and show the size line follows it, with no
// change to the script. Read-only on real files; the copy lives in the OS temp folder.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const SCRIPT = path.join(__dirname, 'wc', 'config-health-scan.ps1');
const REAL = 'C:/Users/Erez/AI Projects/Improve AI Infra/notes/anthropic-guidelines.json';
const g = JSON.parse(fs.readFileSync(REAL, 'utf8'));
g.limits.find(l => l.id === 'hook-injected-text').value = 8000;
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gen893-demo-')), 'guidelines.json');
fs.writeFileSync(tmp, JSON.stringify(g, null, 2));
for (const [label, file] of [['real thresholds', REAL], ['limit changed to 8,000', tmp]]) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Action', 'size-check',
    '-Target', 'C:/Users/Erez/.claude/hooks/refs/shell.md', '-GuidelinesFile', file], { encoding: 'utf8' });
  const o = JSON.parse(r.stdout);
  console.log(label + ':\n  ' + [].concat(o.sizeLines).join('\n  ') + '\n  findings: ' + JSON.stringify(o.lines));
}
fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
