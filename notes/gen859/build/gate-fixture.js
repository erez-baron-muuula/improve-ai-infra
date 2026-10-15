// Step-4 pass-consumption assertion in a FIXTURE tree: a copy of the live gate (auto-approve.js) in a fake
// home, a throwaway protected fixture file, and fixture vetting passes. Never touches the real tree.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const REAL_GATE = path.join(process.env.USERPROFILE, '.claude', 'hooks', 'auto-approve.js');
const H = path.join(__dirname, 'gatefix', 'home');
fs.rmSync(path.join(__dirname, 'gatefix'), { recursive: true, force: true });
const hooks = path.join(H, '.claude', 'hooks');
const passes = path.join(H, '.claude-staging', 'vetting-passes');
fs.mkdirSync(hooks, { recursive: true });
fs.mkdirSync(path.join(H, '.claude', 'scripts'), { recursive: true });
fs.mkdirSync(passes, { recursive: true });
fs.writeFileSync(path.join(hooks, 'auto-approve.js'), fs.readFileSync(REAL_GATE));
const target = path.join(hooks, 'sessionstart-backup-surfacer.js');
fs.writeFileSync(target, '// fixture protected file\n');
const env = { ...process.env, USERPROFILE: H, HOME: H };

function mint() {
  const f = path.join(passes, `vetting-fixture-${Date.now()}.json`);
  fs.writeFileSync(f, JSON.stringify({ kind: 'vetting', target: target.toLowerCase(), expires: new Date(Date.now() + 15 * 60e3).toISOString() }));
  return f;
}
function gate(payload) {
  return spawnSync(process.execPath, [path.join(hooks, 'auto-approve.js')], { input: JSON.stringify(payload), env, encoding: 'utf8' });
}
const listing = () => fs.readdirSync(passes).sort();
let pass = 0, fail = 0;
function check(name, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', name, extra || ''); } }
const writeCall = { hook_event_name: 'PreToolUse', session_id: 'fixture', cwd: H, tool_name: 'Write', tool_input: { file_path: target, content: '// new\n' } };

// 1. Write tool with a valid pass -> approved AND the pass consumed
let p = mint();
let r = gate(writeCall);
check('write+pass: not blocked', r.status !== 2, `status=${r.status} stderr=${r.stderr.slice(0, 300)}`);
check('write+pass: approve decision', /allow|approve/i.test(r.stdout), r.stdout.slice(0, 300));
check('write+pass: pass consumed', !fs.existsSync(p) && listing().some(n => n.includes('.consumed.')), JSON.stringify(listing()));
// 2. Same Write with NO pass -> blocked
for (const n of fs.readdirSync(passes)) fs.rmSync(path.join(passes, n));
r = gate(writeCall);
check('write, no pass: blocked (exit 2)', r.status === 2, `status=${r.status} stdout=${r.stdout.slice(0, 200)}`);
// 3. Single-line update-config.ps1 write-file with a pass -> approved + consumed
const uc = 'G:\\My Drive\\AI Projects\\_Tooling\\Claude\\update-config.ps1';
const content = path.join(__dirname, 'sessionstart-backup-surfacer.js');
p = mint();
r = gate({ hook_event_name: 'PreToolUse', session_id: 'fixture', cwd: H, tool_name: 'PowerShell', tool_input: { command: `& "${uc}" -File "${target}" -Op write-file -ContentFile "${content}"` } });
check('single-line update-config + pass: not blocked', r.status !== 2, `status=${r.status} stderr=${r.stderr.slice(0, 300)}`);
check('single-line update-config + pass: consumed', !fs.existsSync(p), JSON.stringify(listing()));
// 4. Multi-line form of the same command with a pass -> refused, pass NOT consumed
p = mint();
r = gate({ hook_event_name: 'PreToolUse', session_id: 'fixture', cwd: H, tool_name: 'PowerShell', tool_input: { command: `$x = 1\n& "${uc}" -File "${target}" -Op write-file -ContentFile "${content}"` } });
check('multi-line update-config: refused (exit 2)', r.status === 2, `status=${r.status} stdout=${r.stdout.slice(0, 200)}`);
check('multi-line update-config: pass NOT consumed', fs.existsSync(p), JSON.stringify(listing()));
console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
