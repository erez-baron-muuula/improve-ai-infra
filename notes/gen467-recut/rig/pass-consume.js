// GEN-467 re-cut — Step-4 pass-CONSUMPTION assertion (GEN-503/506/562 bar).
// Runs the REAL auto-approve.js in a self-consistent fixture tree (every path it
// uses derives from __dirname), and asserts:
//   1. Write-tool apply to a protected hook WITH a valid pass -> allow + pass CONSUMED (renamed).
//   2. Same apply with NO pass -> blocked (exit 2), never silently approved.
//   3. SINGLE-LINE update-config.ps1 shell apply WITH a pass -> consumed.
//   4. MULTI-LINE form of the same command -> NOT consumed (defers) — the documented gap, proven.
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const FIX = path.join(__dirname, 'gate');
const CLAUDE = path.join(FIX, '.claude');
const HOOKS = path.join(CLAUDE, 'hooks');
const PASSES = path.join(FIX, '.claude-staging', 'vetting-passes');
fs.rmSync(FIX, { recursive: true, force: true });
fs.mkdirSync(HOOKS, { recursive: true });
fs.mkdirSync(PASSES, { recursive: true });
fs.copyFileSync('C:\\Users\\Erez\\.claude\\hooks\\auto-approve.js', path.join(HOOKS, 'auto-approve.js'));
// Sibling files the hook may read; keep minimal but present.
fs.writeFileSync(path.join(CLAUDE, 'settings.json'), '{}');
try { fs.copyFileSync('C:\\Users\\Erez\\.claude\\hooks\\secret-patterns.json', path.join(HOOKS, 'secret-patterns.json')); } catch (e) {}
// The protected fixture target: an EXISTING direct-child .js under fixture hooks\.
const TARGET = path.join(HOOKS, 'fixture-target.js');
fs.writeFileSync(TARGET, '// fixture protected hook\n');
const GATE = path.join(HOOKS, 'auto-approve.js');
const TARGET_KEY = TARGET.replace(/\//g, '\\').toLowerCase();

let n = 0, fails = [];
function check(name, cond, detail) {
  n++;
  if (!cond) fails.push(name + (detail ? ' :: ' + detail : ''));
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
}
function runGate(payload) {
  const env = Object.assign({}, process.env);
  delete env.CLAUDE_CONFIG_UNLOCK;
  const r = cp.spawnSync(process.execPath, [GATE], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 20000, env,
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
function mintFixturePass() {
  const exp = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const p = path.join(PASSES, 'pass-fixture-target.json');
  fs.writeFileSync(p, JSON.stringify({ kind: 'vetting', target: TARGET_KEY, expires: exp }));
  return p;
}
function livePasses() { return fs.readdirSync(PASSES).filter(f => f.endsWith('.json')); }
function consumedPasses() { return fs.readdirSync(PASSES).filter(f => /\.consumed\.\d+$/.test(f)); }

// Case 1: Write tool + valid pass -> allow + consumed.
let passFile = mintFixturePass();
let r = runGate({ hook_event_name: 'PreToolUse', session_id: 'fixgate', tool_name: 'Write',
  tool_input: { file_path: TARGET, content: '// new vetted content\n' }, cwd: FIX });
check('C1 Write w/ pass: allowed (exit 0, permissionDecision allow)',
  r.code === 0 && r.out.includes('"permissionDecision":"allow"'), 'code=' + r.code + ' out=' + r.out.slice(0, 200) + ' err=' + r.err.slice(0, 200));
check('C1b pass CONSUMED (renamed *.consumed.<ts>)', livePasses().length === 0 && consumedPasses().length === 1,
  'live=' + livePasses().join(',') + ' consumed=' + consumedPasses().join(','));

// Case 2: Write tool, NO pass -> blocked exit 2.
r = runGate({ hook_event_name: 'PreToolUse', session_id: 'fixgate', tool_name: 'Write',
  tool_input: { file_path: TARGET, content: '// unvetted content\n' }, cwd: FIX });
check('C2 Write w/o pass: BLOCKED (exit 2)', r.code === 2, 'code=' + r.code + ' out=' + r.out.slice(0, 120) + ' err=' + r.err.slice(0, 200));

// Case 3: SINGLE-LINE update-config.ps1 shell apply w/ pass -> consumed.
for (const f of consumedPasses()) fs.unlinkSync(path.join(PASSES, f));
passFile = mintFixturePass();
const oneLine = '& "G:\\My Drive\\AI Projects\\_Tooling\\Claude\\update-config.ps1" -File "' + TARGET + '" -Op write-file -ContentFile "C:\\tmp\\work.js"';
r = runGate({ hook_event_name: 'PreToolUse', session_id: 'fixgate', tool_name: 'Bash',
  tool_input: { command: oneLine }, cwd: FIX });
const c3consumed = livePasses().length === 0 && consumedPasses().length === 1;
check('C3 single-line update-config apply: pass consumed', c3consumed,
  'code=' + r.code + ' live=' + livePasses().join(',') + ' out=' + r.out.slice(0, 160) + ' err=' + r.err.slice(0, 160));

// Case 4: MULTI-LINE form of the same command -> NOT consumed (defers/blocks; pass stays live).
for (const f of consumedPasses()) fs.unlinkSync(path.join(PASSES, f));
passFile = mintFixturePass();
const multiLine = '$cf = "C:\\tmp\\work.js"\n' + oneLine.replace('"C:\\tmp\\work.js"', '$cf');
r = runGate({ hook_event_name: 'PreToolUse', session_id: 'fixgate', tool_name: 'Bash',
  tool_input: { command: multiLine }, cwd: FIX });
check('C4 multi-line form: pass NOT consumed (documented defer gap, proven)',
  livePasses().length === 1 && consumedPasses().length === 0,
  'code=' + r.code + ' live=' + livePasses().join(',') + ' consumed=' + consumedPasses().join(','));
console.log('C4 note: multi-line verdict handling exit code = ' + r.code + (r.err ? ' (stderr: ' + r.err.slice(0, 160).replace(/\n/g, ' ') + ')' : ''));

console.log('\n' + (n - fails.length) + '/' + n + ' passed' + (fails.length ? '\nFAILURES:\n' + fails.join('\n') : ''));
process.exit(fails.length ? 1 : 0);
