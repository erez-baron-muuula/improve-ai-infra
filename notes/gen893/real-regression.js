// GEN-893 regression on the real home folder: the working copy vs the live baseline script.
// size-sweep, size-check on 3 real files, and scan on the global CLAUDE.md must give identical
// findings / lines / counts, apart from command-file entries (GEN-926) and filesMeasured.
// Prints the working copy's sizeLines for the 3 files so they can be eyeballed.
const path = require('path');
const { spawnSync } = require('child_process');
const HERE = __dirname;
const NEW = path.join(HERE, 'wc', 'config-health-scan.ps1');
const OLD = path.join(HERE, 'wc', 'config-health-scan.live-baseline.ps1');
function run(script, args) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script].concat(args), { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  try { return JSON.parse(r.stdout); } catch (e) { return { parseError: String(e), stderr: r.stderr }; }
}
const isCmd = f => /[\\/]\.claude[\\/]commands[\\/]/i.test(f.file || '');
let fail = 0;
function ok(name, cond, info) { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) { fail++; if (info) console.log(JSON.stringify(info).slice(0, 1500)); } }

const sN = run(NEW, ['-Action', 'size-sweep']), sO = run(OLD, ['-Action', 'size-sweep']);
const nonCmd = s => JSON.stringify((s.findings || []).filter(f => !isCmd(f)).map(f => f.line));
const cmdN = (sN.findings || []).filter(isCmd);
ok('sweep non-command findings identical', nonCmd(sN) === nonCmd(sO), { n: sN.lines, o: sO.lines });
ok('sweep errors identical', JSON.stringify(sN.errors) === JSON.stringify(sO.errors), { n: sN.errors, o: sO.errors });
console.log('sweep filesMeasured: before ' + (sO.counts || {}).filesMeasured + ', after ' + (sN.counts || {}).filesMeasured + '; command findings: ' + JSON.stringify(cmdN.map(f => f.line)));

const files = [
  'C:/Users/Erez/.claude/skills/vet-rule/SKILL.md',
  'C:/Users/Erez/.claude/skills/vet-ticket/reference/../review.md'.replace('reference/../', ''),
  'C:/Users/Erez/.claude/hooks/refs/shell.md',
  'C:/Users/Erez/.claude/commands/loghistory.md',
];
for (const f of files) {
  const n = run(NEW, ['-Action', 'size-check', '-Target', f]);
  if (!/commands/.test(f)) {
    const o = run(OLD, ['-Action', 'size-check', '-Target', f]);
    ok('size-check unchanged: ' + f, JSON.stringify(n.findings) === JSON.stringify(o.findings) && JSON.stringify(n.lines) === JSON.stringify(o.lines), { n: n.lines, o: o.lines });
  }
  console.log('  sizeLines:\n    ' + [].concat(n.sizeLines || [n.parseError]).join('\n    '));
}
const cN = run(NEW, ['-Action', 'scan', '-Target', 'C:/Users/Erez/.claude/CLAUDE.md']);
const cO = run(OLD, ['-Action', 'scan', '-Target', 'C:/Users/Erez/.claude/CLAUDE.md']);
const drop = o => { const c = Object.assign({}, o); return JSON.stringify(c); };
ok('scan output identical (global CLAUDE.md)', drop(cN) === drop(cO), { n: cN.sizeFindings, o: cO.sizeFindings });
console.log(fail ? fail + ' FAILED' : 'all ok');
process.exit(fail ? 1 : 0);
