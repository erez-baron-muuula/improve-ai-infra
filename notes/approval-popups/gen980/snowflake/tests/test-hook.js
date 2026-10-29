// /vet-code Step 4 for GEN-980, all in FIXTURE trees (never the real targets):
//  A. isSafeSnowflakeRead decisions through the WORKING-COPY hook (exact command approved, variants not).
//  B. PROTECTED_FILES: the working-copy hook refuses a direct Edit/Write of the installed script path.
//  C. Pass consumption on each sanctioned apply: single-line update-config.ps1 + valid pass -> approved
//     AND consumed; multi-line + pass -> refused, pass untouched; single-line, no pass -> blocked.
//     auto-approve.js is applied under the INSTALLED hook; set-claude-key.ps1 and later changes to
//     snowflake-read.ps1 under the WORKING-COPY hook (installed by then).
//  D. Replay: every Bash/PowerShell command in this PC's session transcripts (30 days) through
//     isSafeSnowflakeRead; prints how many it would approve (expected 0: the path never existed).
// Usage: node test-hook.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const REAL = path.join(os.homedir(), '.claude');
const WCDIR = path.join(__dirname, '..');
const WC_HOOK = path.join(WCDIR, 'wc', 'auto-approve.js');
const out = [];
const check = (name, ok, detail) => out.push([name, !!ok, detail || '']);

function makeFixture(hookSrc) {
  const fix = fs.mkdtempSync(path.join(os.tmpdir(), 'gen980-hook-'));
  const hooks = path.join(fix, '.claude', 'hooks');
  fs.mkdirSync(hooks, { recursive: true });
  fs.mkdirSync(path.join(fix, '.claude', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(fix, '.claude-staging', 'vetting-passes'), { recursive: true });
  fs.writeFileSync(path.join(hooks, 'auto-approve.js'), fs.readFileSync(hookSrc));
  fs.writeFileSync(path.join(hooks, 'secret-patterns.json'), fs.readFileSync(path.join(REAL, 'hooks', 'secret-patterns.json')));
  return fix;
}
function run(fix, tool, input) {
  const env = Object.assign({}, process.env); delete env.CLAUDE_CONFIG_UNLOCK;
  const r = spawnSync(process.execPath, [path.join(fix, '.claude', 'hooks', 'auto-approve.js')], {
    input: JSON.stringify({ tool_name: tool, tool_input: input, session_id: 'fx', cwd: fix }), encoding: 'utf8', env });
  let dec = 'none'; try { dec = JSON.parse(r.stdout || '{}').hookSpecificOutput.permissionDecision; } catch (e) {}
  return { code: r.status, dec, err: (r.stderr || '').slice(0, 80).replace(/\s+/g, ' ') };
}

// ---- A. decisions ----
const fxA = makeFixture(WC_HOOK);
const S = "C:\\Users\\Erez\\.claude\\scripts\\snowflake-read.ps1";
const T = "C:\\Users\\Erez\\AppData\\Local\\Temp\\claude\\proj\\sess\\scratchpad\\q1.sql";
const cases = [
  [true, "& '" + S + "' -SqlFile '" + T + "'"],
  [true, '& "' + S + '" -SqlFile "' + T + '"'],
  [true, "& '" + S.toLowerCase() + "' -SqlFile '" + T.toLowerCase() + "'"],
  [true, "& '" + S + "' -SqlFile 'C:\\Users\\Erez\\AppData\\Local\\Temp\\a b\\x-1_2.sql'"],
  [false, "& '" + S + "' -SqlFile 'C:\\Users\\Erez\\Documents\\q1.sql'"],
  [false, "& '" + S + "' -SqlFile 'C:\\Users\\Erez\\AppData\\Local\\Temp\\..\\..\\q1.sql'"],
  [false, "& '" + S + "' -SqlFile '" + T + "'; Remove-Item C:\\x"],
  [false, "& '" + S + "' -SqlFile '" + T + "'\nRemove-Item C:\\x"],
  [false, "& '" + S + "' -SqlFile \"$env:TEMP\\q1.sql\""],
  [false, "& '" + S + "' -SqlFile \"C:\\Users\\Erez\\AppData\\Local\\Temp\\`$(calc).sql\""],
  [false, "& 'C:\\Users\\Erez\\.claude\\scripts\\snowflake-read2.ps1' -SqlFile '" + T + "'"],
  [false, "& '" + S + "' -SqlFile '" + T + "x'"],
  [false, "& '" + S + "' -SqlFile '" + T + "' -Extra 1"],
  [false, "& '" + S + "' -SqlFile 'C:\\Users\\Erez\\AppData\\Local\\Temp\\q.sql:ads'"],
  [false, "& '" + S + "' -SqlFile '" + T + "\" "],
  [false, "& '" + S + "' -SqlFile '\\\\server\\share\\q.sql'"],
];
for (const [want, cmd] of cases) {
  const r = run(fxA, 'PowerShell', { command: cmd });
  check('A ' + (want ? 'approve' : 'not approve') + ': ' + cmd.replace(/\n/g, '\\n').slice(0, 110), want ? (r.dec === 'allow') : (r.dec !== 'allow'), JSON.stringify(r));
}
// Regression: an existing exact-match rule still approves.
const r0 = run(fxA, 'PowerShell', { command: "& 'C:\\Users\\Erez\\.claude\\scripts\\notion-ticket-lookup.ps1' 980" });
check('A regression: notion-ticket-lookup still approved', r0.dec === 'allow', JSON.stringify(r0));

// ---- B. PROTECTED_FILES ----
for (const tool of ['Edit', 'Write']) {
  const input = tool === 'Edit' ? { file_path: S, old_string: 'a', new_string: 'b' } : { file_path: S, content: 'x' };
  const r = run(fxA, tool, input);
  check('B ' + tool + ' of installed script path refused (exit 2)', r.code === 2, JSON.stringify(r));
}
fs.rmSync(fxA, { recursive: true, force: true });

// ---- C. pass consumption ----
function consume(hookSrc, rel, label) {
  const fix = makeFixture(hookSrc);
  const passes = path.join(fix, '.claude-staging', 'vetting-passes');
  const targetFile = path.join(fix, '.claude', rel);
  fs.writeFileSync(targetFile, fs.existsSync(path.join(REAL, rel)) ? fs.readFileSync(path.join(REAL, rel)) : 'placeholder\n');
  const target = path.resolve(targetFile).replace(/\//g, '\\');
  const wcFile = path.join(fix, 'wc.txt'); fs.writeFileSync(wcFile, 'x\n');
  const single = '& "G:\\My Drive\\AI Projects\\_Tooling\\Claude\\update-config.ps1" -File "' + target + '" -Op write-file -ContentFile "' + wcFile + '"';
  const multi = '$f = "' + target + '"\n' + single;
  const mint = () => { const f = path.join(passes, 'fixture-vetting-pass.json'); fs.writeFileSync(f, JSON.stringify({ kind: 'vetting', target: target.toLowerCase(), expires: new Date(Date.now() + 600000).toISOString() })); return f; };
  const f1 = mint(); const r1 = run(fix, 'PowerShell', { command: single }); const after1 = fs.readdirSync(passes);
  check('C ' + label + ' ' + rel + ': single-line + pass -> approved AND consumed', r1.dec === 'allow' && !fs.existsSync(f1) && after1.some((x) => x.startsWith('fixture-vetting-pass.json.consumed.')), JSON.stringify(r1));
  for (const x of fs.readdirSync(passes)) fs.rmSync(path.join(passes, x));
  const f2 = mint(); const r2 = run(fix, 'PowerShell', { command: multi });
  check('C ' + label + ' ' + rel + ': multi-line + pass -> refused, pass untouched', r2.code === 2 && fs.existsSync(f2), JSON.stringify(r2));
  fs.rmSync(f2);
  const r3 = run(fix, 'PowerShell', { command: single });
  check('C ' + label + ' ' + rel + ': single-line, no pass -> blocked', r3.code === 2, JSON.stringify(r3));
  fs.rmSync(fix, { recursive: true, force: true });
}
consume(path.join(REAL, 'hooks', 'auto-approve.js'), 'hooks\\auto-approve.js', 'installed-hook');
consume(WC_HOOK, 'scripts\\set-claude-key.ps1', 'new-hook');
consume(WC_HOOK, 'scripts\\snowflake-read.ps1', 'new-hook');

// ---- D. replay ----
const src = fs.readFileSync(WC_HOOK, 'utf8');
const m = src.match(/function isSafeSnowflakeRead\(command\) \{[\s\S]*?\n\}/);
const isSafe = new Function('return ' + m[0])();
const root = path.join(REAL, 'projects');
let total = 0, approved = 0;
for (const d of fs.readdirSync(root)) {
  let files; try { files = fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith('.jsonl')); } catch (e) { continue; }
  for (const f of files) {
    const fp = path.join(root, d, f);
    if (Date.now() - fs.statSync(fp).mtimeMs > 30 * 864e5) continue;
    for (const line of fs.readFileSync(fp, 'utf8').split('\n')) {
      if (line.indexOf('"tool_use"') < 0) continue;
      let e; try { e = JSON.parse(line); } catch (x) { continue; }
      const c = e.message && e.message.content; if (!Array.isArray(c)) continue;
      for (const x of c) {
        if (x.type !== 'tool_use' || !/^(Bash|PowerShell)$/.test(x.name) || !x.input || typeof x.input.command !== 'string') continue;
        total++; if (isSafe(x.input.command)) approved++;
      }
    }
  }
}
check('D replay: ' + total + ' real Bash/PowerShell commands (30 days), newly approved = ' + approved, total > 100 && approved === 0);

let ok = 0;
for (const [n, p, d] of out) { if (p) ok++; console.log((p ? 'PASS ' : 'FAIL ') + n + (p ? '' : '  [' + d + ']')); }
console.log(ok + '/' + out.length + ' passed');
process.exitCode = ok === out.length ? 0 : 1;
