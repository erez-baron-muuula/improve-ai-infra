// /vet-code Step 4 pass-CONSUMPTION assertion, in a FIXTURE tree (never the real target):
// the sanctioned single-line update-config.ps1 apply of auto-approve.js is APPROVED and CONSUMES a
// valid vetting pass; the multi-line form is REFUSED and leaves the pass untouched; with no pass,
// the single-line form is BLOCKED. Hook under test: the lock-only working copy.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const HERE = __dirname;
const FIX = path.join(HERE, 'fixture-consume');
const HOOKS = path.join(FIX, '.claude', 'hooks');
const PASSES = path.join(FIX, '.claude-staging', 'vetting-passes');
fs.rmSync(FIX, { recursive: true, force: true });
fs.mkdirSync(HOOKS, { recursive: true });
fs.mkdirSync(PASSES, { recursive: true });
fs.mkdirSync(path.join(FIX, '.claude', 'scripts'), { recursive: true });
const hookPath = path.join(HOOKS, 'auto-approve.js');
fs.writeFileSync(hookPath, fs.readFileSync(path.join(HERE, 'auto-approve.guard-only.js')));
fs.writeFileSync(path.join(HOOKS, 'secret-patterns.json'), fs.readFileSync('C:/Users/Erez/.claude/hooks/secret-patterns.json'));
fs.writeFileSync(path.join(FIX, '.claude', 'settings.json'), fs.readFileSync('C:/Users/Erez/.claude/settings.json'));
const target = path.resolve(hookPath).replace(/\//g, '\\');
const wc = path.join(HERE, 'auto-approve.guard-only.js').replace(/\//g, '\\');
const single = '& "G:\\My Drive\\AI Projects\\_Tooling\\Claude\\update-config.ps1" -File "' + target + '" -Op write-file -ContentFile "' + wc + '"';
const multi = '$f = "' + target + '"\n' + single;

function run(cmd) {
  const env = Object.assign({}, process.env); delete env.CLAUDE_CONFIG_UNLOCK;
  const r = spawnSync(process.execPath, [hookPath], { input: JSON.stringify({ tool_name: 'PowerShell', tool_input: { command: cmd }, session_id: 'fx', cwd: HERE }), encoding: 'utf8', env });
  let dec = 'none'; try { dec = JSON.parse(r.stdout || '{}').hookSpecificOutput.permissionDecision; } catch (e) {}
  return { code: r.status, dec, err: (r.stderr || '').slice(0, 90).replace(/\s+/g, ' ') };
}
function mint() {
  const f = path.join(PASSES, 'fixture-vetting-pass.json');
  fs.writeFileSync(f, JSON.stringify({ kind: 'vetting', target: target.toLowerCase(), expires: new Date(Date.now() + 10 * 60000).toISOString() }));
  return f;
}
const out = [];
const f1 = mint();
const r1 = run(single);
const after1 = fs.readdirSync(PASSES);
out.push(['single-line + pass -> approved AND consumed', r1.code === 0 && r1.dec === 'allow' && !fs.existsSync(f1) && after1.some(x => x.startsWith('fixture-vetting-pass.json.consumed.')), JSON.stringify(r1) + ' ' + after1.join(',')]);
for (const x of fs.readdirSync(PASSES)) fs.rmSync(path.join(PASSES, x));
const f2 = mint();
const r2 = run(multi);
out.push(['multi-line + pass -> refused (exit 2), pass untouched', r2.code === 2 && fs.existsSync(f2), JSON.stringify(r2)]);
fs.rmSync(f2);
const r3 = run(single);
out.push(['single-line, no pass -> blocked (exit 2)', r3.code === 2, JSON.stringify(r3)]);
let ok = 0;
for (const [n, p, d] of out) { if (p) ok++; console.log((p ? 'PASS ' : 'FAIL ') + n + '  [' + d + ']'); }
console.log(ok + '/' + out.length + ' passed');
fs.rmSync(FIX, { recursive: true, force: true });
