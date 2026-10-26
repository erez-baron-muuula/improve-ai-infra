// GEN-460 /vet-code Step 4 for the auto-approve.js working copy, all in FIXTURE trees (never the real
// hook dir): (A) pass-consumption assertion; (B) the new -TriageDecide allow shape, accepted forms and
// rejected variants; (C) input realism: real Bash/PowerShell commands from this machine's transcripts
// run through the INSTALLED hook and the WORKING COPY side by side -- any decision difference is listed
// (redacted). Adapted from notes/gen860/build/test-pass-consume.js.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const WC = path.resolve(__dirname, 'auto-approve.working.js');
const REAL = path.join(os.homedir(), '.claude');

function makeFixture(tag, gateSource) {
  const fix = fs.mkdtempSync(path.join(os.tmpdir(), 'gen460-' + tag + '-'));
  const hooks = path.join(fix, '.claude', 'hooks');
  fs.mkdirSync(hooks, { recursive: true });
  fs.mkdirSync(path.join(fix, '.claude-staging', 'vetting-passes'), { recursive: true });
  fs.mkdirSync(path.join(fix, '.claude', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(hooks, 'auto-approve.js'), fs.readFileSync(gateSource));
  fs.writeFileSync(path.join(hooks, 'secret-patterns.json'), fs.readFileSync(path.join(REAL, 'hooks', 'secret-patterns.json')));
  return fix;
}
function run(fix, tool, cmd) {
  const env = Object.assign({}, process.env); delete env.CLAUDE_CONFIG_UNLOCK;
  const gate = path.join(fix, '.claude', 'hooks', 'auto-approve.js');
  const r = spawnSync(process.execPath, [gate], { input: JSON.stringify({ tool_name: tool, tool_input: { command: cmd }, session_id: 'fx', cwd: fix }), encoding: 'utf8', env, timeout: 30000 });
  let dec = 'none'; try { dec = JSON.parse(r.stdout || '{}').hookSpecificOutput.permissionDecision || 'none'; } catch (e) {}
  return { code: r.status, dec };
}
const results = [];
function check(name, ok, detail) { results.push([name, !!ok, detail || '']); }

// ---- (A) pass consumption, gate = working copy, target = the fixture's own auto-approve.js ----
{
  const fix = makeFixture('consume', WC);
  const passes = path.join(fix, '.claude-staging', 'vetting-passes');
  const target = path.resolve(path.join(fix, '.claude', 'hooks', 'auto-approve.js')).replace(/\//g, '\\');
  const single = '& "G:\\My Drive\\AI Projects\\_Tooling\\Claude\\update-config.ps1" -File "' + target + '" -Op write-file -ContentFile "' + WC.replace(/\//g, '\\') + '"';
  const multi = '$f = "' + target + '"\n' + single;
  const mint = () => { const f = path.join(passes, 'fixture-vetting-pass.json'); fs.writeFileSync(f, JSON.stringify({ kind: 'vetting', target: target.toLowerCase(), expires: new Date(Date.now() + 600000).toISOString() })); return f; };
  let f = mint(); let r = run(fix, 'PowerShell', single); let after = fs.readdirSync(passes);
  check('A1 single-line + pass -> approved AND consumed', r.code === 0 && r.dec === 'allow' && !fs.existsSync(f) && after.some((x) => x.startsWith('fixture-vetting-pass.json.consumed.')), JSON.stringify(r) + ' ' + after.join(','));
  for (const x of fs.readdirSync(passes)) fs.rmSync(path.join(passes, x));
  f = mint(); r = run(fix, 'PowerShell', multi);
  check('A2 multi-line + pass -> refused (exit 2), pass untouched', r.code === 2 && fs.existsSync(f), JSON.stringify(r));
  fs.rmSync(f);
  r = run(fix, 'PowerShell', single);
  check('A3 single-line, no pass -> blocked (exit 2)', r.code === 2, JSON.stringify(r));
  fs.rmSync(fix, { recursive: true, force: true });
}

// ---- (B) the -TriageDecide allow shape ----
{
  const fix = makeFixture('shape', WC);
  const S = "& 'G:\\My Drive\\AI Projects\\_Tooling\\Claude\\sync.ps1'";
  const good = [
    S + " -TriageDecide 'spares' -As skip -Reason 'empty folder made by the Claude app'",
    S + " -TriageDecide '..\\.claude.json.tmp.1.ab' -As skip -Reason 'app temp save'",
    '& "G:\\My Drive\\AI Projects\\_Tooling\\Claude\\sync.ps1" -TriageDecide "state" -As skip -Reason "app cache (MCP discovery)"',
  ];
  const bad = [
    S + " -TriageDecide 'x' -As skip -Reason 'r'; Remove-Item C:\\x",
    S + " -TriageDecide 'x' -As skip -Reason 'r' -RootOverride 'C:\\tmp'",
    S + " -TriageDecide 'C:\\Windows\\x' -As skip -Reason 'r'",
    S + " -TriageDecide 'x' -As delete -Reason 'r'",
    S + " -TriageDecide 'notes.md' -As backup -Reason 'shared notes file'",
    S + " -TriageDecide 'hooks\\old-hook.js' -As retired -Reason 'removed on purpose 2026-10-25'",
    S + " -TriageDecide 'x' -As skip",
    S + " -As skip -TriageDecide 'x' -Reason 'r'",
    '& "G:\\My Drive\\AI Projects\\_Tooling\\Claude\\sync.ps1" -TriageDecide "x" -As skip -Reason "$(Remove-Item C:\\x)"',
    S + " -TriageDecide 'x' -As skip -Reason 'it`s'",
    S + " -TriageDecide 'x' -As skip -Reason '%TEMP%'",
    S + " -TriageDecide 'x' -As skip -Reason 'curly \u201Cquote\u201D'",
    S + " -TriageDecide 'x' -As skip -Reason 'line\nRemove-Item C:\\x'",
    S + " -TriageDecide '' -As skip -Reason 'r'",
    "& 'G:\\My Drive\\AI Projects\\_Tooling\\Claude\\update-config.ps1' -TriageDecide 'x' -As skip -Reason 'r'",
    S + " -TriageDecide 'x' -As skip -Reason '" + 'a'.repeat(301) + "'",
  ];
  for (const c of good) { const r = run(fix, 'PowerShell', c); check('B allow: ' + c.slice(56, 120), r.code === 0 && r.dec === 'allow', JSON.stringify(r)); }
  for (const c of bad) { const r = run(fix, 'PowerShell', c); check('B not-allow: ' + c.slice(56, 120).replace(/\n/g, '\\n'), r.dec !== 'allow', JSON.stringify(r)); }
  fs.rmSync(fix, { recursive: true, force: true });
}

// ---- (C) input realism: real commands, installed hook vs working copy ----
{
  const projDir = path.join(REAL, 'projects');
  const files = [];
  for (const p of fs.readdirSync(projDir)) {
    const d = path.join(projDir, p);
    let st; try { st = fs.statSync(d); } catch (e) { continue; }
    if (!st.isDirectory()) continue;
    for (const f of fs.readdirSync(d)) if (f.endsWith('.jsonl')) { const full = path.join(d, f); files.push([full, fs.statSync(full).mtimeMs]); }
  }
  files.sort((a, b) => b[1] - a[1]);
  const syncCmds = new Map(); const other = new Map();
  for (const [f] of files.slice(0, 120)) {
    let text; try { text = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
    for (const line of text.split('\n')) {
      if (!line.includes('"tool_use"')) continue;
      let o; try { o = JSON.parse(line); } catch (e) { continue; }
      const content = o && o.message && Array.isArray(o.message.content) ? o.message.content : [];
      for (const c of content) {
        if (c.type !== 'tool_use' || (c.name !== 'Bash' && c.name !== 'PowerShell') || !c.input || typeof c.input.command !== 'string') continue;
        const key = c.name + '\u0000' + c.input.command;
        if (/sync\.ps1/i.test(c.input.command)) syncCmds.set(key, [c.name, c.input.command]);
        else if (other.size < 4000) other.set(key, [c.name, c.input.command]);
      }
    }
  }
  const otherArr = [...other.values()];
  const sample = [];
  for (let i = 0; i < otherArr.length && sample.length < 250; i += Math.max(1, Math.floor(otherArr.length / 250))) sample.push(otherArr[i]);
  const corpus = [...syncCmds.values(), ...sample];
  const fixLive = makeFixture('live', path.join(REAL, 'hooks', 'auto-approve.js'));
  const fixWc = makeFixture('wc', WC);
  let diffs = 0; const diffNotes = [];
  let newAllows = 0;
  for (const [tool, cmd] of corpus) {
    const a = run(fixLive, tool, cmd); const b = run(fixWc, tool, cmd);
    if (a.code !== b.code || a.dec !== b.dec) {
      diffs++;
      if (b.dec === 'allow') newAllows++;
      const red = cmd.replace(/[A-Za-z0-9_\-]{24,}/g, '<long>').slice(0, 100).replace(/\n/g, '\\n');
      diffNotes.push(tool + ' live=' + JSON.stringify(a) + ' wc=' + JSON.stringify(b) + ' :: ' + red);
    }
  }
  check('C real corpus: ' + corpus.length + ' commands (' + syncCmds.size + ' naming sync.ps1), decision differences = ' + diffs + ' (new allows ' + newAllows + ')', diffs === 0, diffNotes.slice(0, 10).join(' | '));
  fs.rmSync(fixLive, { recursive: true, force: true });
  fs.rmSync(fixWc, { recursive: true, force: true });
}

let ok = 0;
for (const [n, p, d] of results) { if (p) ok++; else console.log('FAIL ' + n + '  [' + d + ']'); }
for (const [n, p] of results) if (p && /^(A|C)/.test(n)) console.log('PASS ' + n);
console.log(ok + '/' + results.length + ' passed');
process.exitCode = ok === results.length ? 0 : 1;
