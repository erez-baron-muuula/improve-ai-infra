// GEN-674 size stop, Step 4 input realism: replay every real PowerShell command from this machine's
// transcripts that wrote the global CLAUDE.md through update-config.ps1 / update-global-rule.ps1,
// through the fixture hook with a valid check pass, and classify each decision.
// Usage: node sizestop-corpus.js <fixtureRoot built by sizestop-test.js>
// A "false fire" is a refusal for SHAPE on a command that was a routine, legitimate apply. A
// refusal because a past -ContentFile no longer exists is expected (fail closed) and is counted
// separately; those commands are re-run with a stand-in content file of the same path shape.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = process.argv[2];
const HOME = process.env.USERPROFILE;
const FX = path.join(ROOT, 'home');
const HOOK = path.join(FX, '.claude', 'hooks', 'auto-approve.js');
const GCM = path.join(FX, '.claude', 'CLAUDE.md');
const PASSES = path.join(FX, '.claude-staging', 'check-passes');
const STAND_IN = path.join(ROOT, 'work', 'stand-in.md');
fs.writeFileSync(GCM, Array.from({ length: 186 }, (_, i) => 'r' + i).join('\n') + '\n');
fs.writeFileSync(STAND_IN, Array.from({ length: 150 }, (_, i) => 's' + i).join('\n') + '\n');

function walk(d, out) {
  let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of ents) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'subagents' && e.name !== 'tool-results') walk(p, out); }
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}
const cmds = new Map();
for (const f of walk(path.join(HOME, '.claude', 'projects'), [])) {
  let text; try { text = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
  if (text.indexOf('update-global-rule.ps1') === -1 && text.indexOf('update-config.ps1') === -1) continue;
  for (const ln of text.split('\n')) {
    if (ln.indexOf('"tool_use"') === -1) continue;
    let rec; try { rec = JSON.parse(ln); } catch (e) { continue; }
    const content = rec && rec.message && Array.isArray(rec.message.content) ? rec.message.content : [];
    for (const c of content) {
      if (!c || c.type !== 'tool_use' || c.name !== 'PowerShell' || !c.input || typeof c.input.command !== 'string') continue;
      const cmd = c.input.command;
      const isUgr = /update-global-rule\.ps1/i.test(cmd);
      const isUcGlobal = /update-config\.ps1/i.test(cmd) && /-File\s+["']?CLAUDE\.md["']?(\s|$)/i.test(cmd);
      if (!isUgr && !isUcGlobal) continue;
      if (/^\s*(Get-Content|Select-String|cat|type|grep|rg)\b/i.test(cmd)) continue; // reads that merely name the script
      if (!cmds.has(cmd)) cmds.set(cmd, path.basename(f));
    }
  }
}

function run(command) {
  for (const f of fs.readdirSync(PASSES)) fs.rmSync(path.join(PASSES, f), { force: true });
  fs.writeFileSync(path.join(PASSES, 'p.json'), JSON.stringify({ kind: 'check', target: GCM.toLowerCase(), expires: new Date(Date.now() + 900000).toISOString() }));
  const input = { tool_name: 'PowerShell', tool_input: { command }, cwd: path.join(ROOT, 'work'), transcript_path: path.join(ROOT, 'work', 't1.jsonl') };
  const env = Object.assign({}, process.env); delete env.CLAUDE_CONFIG_UNLOCK;
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), encoding: 'utf8', env });
  let decision = null; try { decision = JSON.parse(r.stdout).hookSpecificOutput.permissionDecision; } catch (e) {}
  return { code: r.status, decision, stderr: (r.stderr || '').trim() };
}

const tally = { total: 0, approved: 0, missingContentFile: 0, approvedWithStandIn: 0, multiline: 0, shapeRefused: 0, other: 0 };
const shapeRefusals = [];
for (const [cmd, src] of cmds) {
  tally.total++;
  const r = run(cmd);
  if (r.code === 0 && r.decision === 'allow') { tally.approved++; continue; }
  if (/could not read the -ContentFile/.test(r.stderr)) {
    tally.missingContentFile++;
    const cmd2 = cmd.replace(/(-ContentFile\s+)("[^"]*"|'[^']*'|\S+)/i, (m, a) => a + '"' + STAND_IN + '"');
    const r2 = run(cmd2);
    if (r2.code === 0 && r2.decision === 'allow') tally.approvedWithStandIn++;
    else { tally.shapeRefused++; shapeRefusals.push({ src, why: r2.stderr.slice(0, 160), cmd: cmd2.slice(0, 160) }); }
    continue;
  }
  if (/multi-line|MULTILINE|cannot read with certainty|here-string/i.test(r.stderr)) { tally.multiline++; continue; }
  if (/size stop/.test(r.stderr)) { tally.shapeRefused++; shapeRefusals.push({ src, why: r.stderr.slice(0, 160), cmd: cmd.slice(0, 160) }); continue; }
  tally.other++; shapeRefusals.push({ src, why: 'OTHER: ' + r.stderr.slice(0, 160), cmd: cmd.slice(0, 160) });
}
console.log(JSON.stringify(tally));
for (const s of shapeRefusals) console.log('- ' + s.src + ' :: ' + s.why + '\n    ' + s.cmd);
