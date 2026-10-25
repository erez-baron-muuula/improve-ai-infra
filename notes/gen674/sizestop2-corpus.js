// GEN-674 size stop redesign, Step 4 input realism: differential replay of real past tool calls.
// Usage: node sizestop2-corpus.js <live auto-approve.js> <working-copy auto-approve.js> <prompt hook> <fixtureRoot>
// Collects every PowerShell/Bash/Monitor command in this PC's transcripts (sub-agents included) that
// mentions update-config, update-global-rule, CLAUDE.md or the size switch, plus every Edit/Write of the
// two Drive scripts, and runs each through the LIVE hook and the WORKING-COPY hook in two identical
// fixture trees (a check pass minted before every call). Prints every call whose outcome differs, and
// how many calls the new prompt hook would have asked about. Decides only; executes nothing.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const [LIVE, WC, PROMPT, ROOT] = process.argv.slice(2);
const REAL_HOME = process.env.USERPROFILE;
const MENTION = /update-config|update-global-rule|claude\.md|approvesizeupto|rulesize/i;
const DRIVE_SCRIPT = /[\\/]_tooling[\\/]claude[\\/]update-(config|global-rule)\.ps1$/i;

function tree(name, hookSrc) {
  const home = path.join(ROOT, name, 'home');
  const cl = path.join(home, '.claude');
  fs.rmSync(path.join(ROOT, name), { recursive: true, force: true });
  for (const d of [path.join(cl, 'hooks'), path.join(home, '.claude-staging', 'check-passes'), path.join(home, '.claude-staging', 'vetting-passes'), path.join(cl, 'skills', 'demo')]) fs.mkdirSync(d, { recursive: true });
  fs.copyFileSync(hookSrc, path.join(cl, 'hooks', 'auto-approve.js'));
  fs.writeFileSync(path.join(cl, 'CLAUDE.md'), Array.from({ length: 186 }, (_, i) => 'r' + i).join('\n') + '\n');
  fs.writeFileSync(path.join(cl, 'settings.json'), fs.readFileSync(path.join(REAL_HOME, '.claude', 'settings.json')));
  fs.writeFileSync(path.join(cl, 'skills', 'demo', 'SKILL.md'), '# demo\n');
  return { home, cl, hook: path.join(cl, 'hooks', 'auto-approve.js'), passes: path.join(home, '.claude-staging', 'check-passes') };
}
const A = tree('live', LIVE);
const B = tree('wc', WC);

function walk(d, out) {
  let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of ents) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'tool-results') walk(p, out); }
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}
const calls = new Map();
for (const f of walk(path.join(REAL_HOME, '.claude', 'projects'), [])) {
  let text; try { text = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
  if (!MENTION.test(text)) continue;
  for (const ln of text.split('\n')) {
    if (ln.indexOf('"tool_use"') === -1) continue;
    let rec; try { rec = JSON.parse(ln); } catch (e) { continue; }
    const content = rec && rec.message && Array.isArray(rec.message.content) ? rec.message.content : [];
    for (const c of content) {
      if (!c || c.type !== 'tool_use' || !c.input) continue;
      let keep = false;
      if (['PowerShell', 'Bash', 'Monitor'].includes(c.name) && typeof c.input.command === 'string') keep = MENTION.test(c.input.command);
      else if (['Edit', 'Write', 'MultiEdit'].includes(c.name) && typeof c.input.file_path === 'string') keep = DRIVE_SCRIPT.test(c.input.file_path);
      if (!keep) continue;
      const key = c.name + '|~|' + JSON.stringify(c.input);
      if (!calls.has(key)) calls.set(key, { tool: c.name, input: c.input, cwd: rec.cwd || path.join(ROOT, 'work') });
    }
  }
}

function run(t, call) {
  for (const f of fs.readdirSync(t.passes)) fs.rmSync(path.join(t.passes, f), { force: true });
  fs.writeFileSync(path.join(t.passes, 'p.json'), JSON.stringify({ kind: 'check', target: path.join(t.cl, 'CLAUDE.md').toLowerCase(), expires: new Date(Date.now() + 900000).toISOString() }));
  const env = Object.assign({}, process.env); delete env.CLAUDE_CONFIG_UNLOCK;
  const r = spawnSync(process.execPath, [t.hook], { input: JSON.stringify({ tool_name: call.tool, tool_input: call.input, cwd: call.cwd, session_id: 'corpus' }), encoding: 'utf8', env, timeout: 30000 });
  let decision = null; try { decision = JSON.parse(r.stdout).hookSpecificOutput.permissionDecision; } catch (e) { /* none */ }
  const why = (r.stderr || '').replace(/\s+/g, ' ').slice(0, 90);
  return { code: r.status, decision, why };
}

let same = 0, asked = 0;
const diffs = [];
for (const call of calls.values()) {
  const a = run(A, call), b = run(B, call);
  if (a.code === b.code && a.decision === b.decision) same++;
  else diffs.push({ call, a, b });
  if (call.tool !== 'Edit' && call.tool !== 'Write' && call.tool !== 'MultiEdit') {
    const env = Object.assign({}, process.env, { USERPROFILE: path.join(ROOT, 'wc', 'home') });
    const p = spawnSync(process.execPath, [PROMPT], { input: JSON.stringify({ tool_name: call.tool, tool_input: call.input, permission_mode: 'auto' }), encoding: 'utf8', env, timeout: 30000 });
    if (/"ask"/.test(p.stdout || '')) asked++;
  }
}
console.log(JSON.stringify({ calls: calls.size, same, differ: diffs.length, promptHookWouldAsk: asked }));
for (const d of diffs) {
  console.log('- ' + d.call.tool + ' live=' + d.a.code + '/' + d.a.decision + ' new=' + d.b.code + '/' + d.b.decision + ' :: ' + d.b.why);
  console.log('    ' + JSON.stringify(d.call.input).replace(/\s+/g, ' ').slice(0, 220));
}
