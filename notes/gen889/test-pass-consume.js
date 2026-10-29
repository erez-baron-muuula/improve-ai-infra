// /vet-code Step 4 pass-CONSUMPTION assertion for GEN-889 (adapted from
// notes/approval-popups/gen952-permissionrequest/test-pass-consume.js), in a FIXTURE tree (never the
// real target): for each pass-gated target of this change, the sanctioned single-line
// update-config.ps1 apply is APPROVED and CONSUMES a valid vetting pass; the multi-line form is
// REFUSED and leaves the pass untouched; with no pass the single-line form is BLOCKED.
// Gate under test: the INSTALLED ~/.claude/hooks/auto-approve.js (unchanged by GEN-889), copied into
// the fixture so its __dirname-derived paths resolve there.
// Usage: node test-pass-consume.js   (runs all five targets)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const TARGETS = ['inject-browser-refs.js', 'inject-edit-refs.js', 'inject-windows-mcp-refs.js', 'windows-mcp-approval.js', 'windows-mcp-approval.test.js'];
const REAL = path.join(os.homedir(), '.claude');
let ok = 0, total = 0;
for (const name of TARGETS) {
  const REL = 'hooks/' + name;
  const WC = path.join(__dirname, 'wc', 'hooks', name);
  const FIX = fs.mkdtempSync(path.join(os.tmpdir(), 'gen889-consume-'));
  const HOOKS = path.join(FIX, '.claude', 'hooks');
  const PASSES = path.join(FIX, '.claude-staging', 'vetting-passes');
  fs.mkdirSync(HOOKS, { recursive: true });
  fs.mkdirSync(PASSES, { recursive: true });
  fs.mkdirSync(path.join(FIX, '.claude', 'scripts'), { recursive: true });
  const gate = path.join(HOOKS, 'auto-approve.js');
  fs.writeFileSync(gate, fs.readFileSync(path.join(REAL, 'hooks', 'auto-approve.js')));
  fs.writeFileSync(path.join(HOOKS, 'secret-patterns.json'), fs.readFileSync(path.join(REAL, 'hooks', 'secret-patterns.json')));
  const targetFile = path.join(FIX, '.claude', REL);
  if (name !== 'auto-approve.js') fs.writeFileSync(targetFile, fs.readFileSync(path.join(REAL, REL)));
  const target = path.resolve(targetFile).replace(/\//g, '\\');
  const wc = path.resolve(WC).replace(/\//g, '\\');
  const single = '& "G:\\My Drive\\AI Projects\\_Tooling\\Claude\\update-config.ps1" -File "' + target + '" -Op write-file -ContentFile "' + wc + '"';
  const multi = '$f = "' + target + '"\n' + single;
  const run = (cmd) => {
    const env = Object.assign({}, process.env); delete env.CLAUDE_CONFIG_UNLOCK;
    const r = spawnSync(process.execPath, [gate], { input: JSON.stringify({ tool_name: 'PowerShell', tool_input: { command: cmd }, session_id: 'fx', cwd: FIX }), encoding: 'utf8', env });
    let dec = 'none'; try { dec = JSON.parse(r.stdout || '{}').hookSpecificOutput.permissionDecision; } catch (e) {}
    return { code: r.status, dec, err: (r.stderr || '').slice(0, 90).replace(/\s+/g, ' ') };
  };
  const mint = () => {
    const f = path.join(PASSES, 'fixture-vetting-pass.json');
    fs.writeFileSync(f, JSON.stringify({ kind: 'vetting', target: target.toLowerCase(), expires: new Date(Date.now() + 10 * 60000).toISOString() }));
    return f;
  };
  const out = [];
  const f1 = mint();
  const r1 = run(single);
  const after1 = fs.readdirSync(PASSES);
  out.push([REL + ': single-line + pass -> approved AND consumed', r1.code === 0 && r1.dec === 'allow' && !fs.existsSync(f1) && after1.some((x) => x.startsWith('fixture-vetting-pass.json.consumed.')), JSON.stringify(r1)]);
  for (const x of fs.readdirSync(PASSES)) fs.rmSync(path.join(PASSES, x));
  const f2 = mint();
  const r2 = run(multi);
  out.push([REL + ': multi-line + pass -> refused (exit 2), pass untouched', r2.code === 2 && fs.existsSync(f2), JSON.stringify(r2)]);
  fs.rmSync(f2);
  const r3 = run(single);
  out.push([REL + ': single-line, no pass -> blocked (exit 2)', r3.code === 2, JSON.stringify(r3)]);
  for (const [n, p, d] of out) { total++; if (p) ok++; console.log((p ? 'PASS ' : 'FAIL ') + n + '  [' + d + ']'); }
  fs.rmSync(FIX, { recursive: true, force: true });
}
console.log(ok + '/' + total + ' passed');
process.exitCode = ok === total ? 0 : 1;
