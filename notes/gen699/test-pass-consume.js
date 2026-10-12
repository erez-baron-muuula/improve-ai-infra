// /vet-code Step 4 pass-CONSUMPTION assertion for GEN-699, in a FIXTURE tree (never the real target): the
// sanctioned single-line update-config.ps1 apply of auto-approve.js is APPROVED and CONSUMES a valid vetting
// pass; the multi-line form is REFUSED and leaves the pass untouched; with no pass, the single-line form is
// BLOCKED. Run twice: with the INSTALLED gate (which gates this install) and with the candidate (which gates
// every later one). Adapted from notes/gen812/test-pass-consume.js.
// Usage: node test-pass-consume.js <gate source: installed hook or candidate> <working copy>
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const GATE_SRC = process.argv[2];
const WC = process.argv[3];
if (!GATE_SRC || !WC || !fs.existsSync(GATE_SRC) || !fs.existsSync(WC)) {
  console.log('usage: node test-pass-consume.js <gate source> <working copy>'); process.exit(1);
}
const FIX = fs.mkdtempSync(path.join(os.tmpdir(), 'gen699-consume-'));
const HOOKS = path.join(FIX, '.claude', 'hooks');
const PASSES = path.join(FIX, '.claude-staging', 'vetting-passes');
fs.mkdirSync(HOOKS, { recursive: true });
fs.mkdirSync(PASSES, { recursive: true });
fs.mkdirSync(path.join(FIX, '.claude', 'scripts'), { recursive: true });
const REAL = path.join(os.homedir(), '.claude');
const gate = path.join(HOOKS, 'auto-approve.js');
fs.writeFileSync(gate, fs.readFileSync(GATE_SRC));
fs.writeFileSync(path.join(HOOKS, 'secret-patterns.json'), fs.readFileSync(path.join(REAL, 'hooks', 'secret-patterns.json')));
// The protected target is the fixture's own auto-approve.js (the gate guards itself), as for the real apply.
const target = path.resolve(gate).replace(/\//g, '\\');
const wc = path.resolve(WC).replace(/\//g, '\\');
const single = '& "G:\\My Drive\\AI Projects\\_Tooling\\Claude\\update-config.ps1" -File "' + target + '" -Op write-file -ContentFile "' + wc + '"';
const multi = '$f = "' + target + '"\n' + single;

function run(cmd) {
  const env = Object.assign({}, process.env); delete env.CLAUDE_CONFIG_UNLOCK;
  const r = spawnSync(process.execPath, [gate], { input: JSON.stringify({ tool_name: 'PowerShell', tool_input: { command: cmd }, session_id: 'fx', cwd: FIX }), encoding: 'utf8', env });
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
out.push(['single-line + pass -> approved AND consumed', r1.code === 0 && r1.dec === 'allow' && !fs.existsSync(f1) && after1.some((x) => x.startsWith('fixture-vetting-pass.json.consumed.')), JSON.stringify(r1) + ' ' + after1.join(',')]);
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
process.exitCode = ok === out.length ? 0 : 1;
