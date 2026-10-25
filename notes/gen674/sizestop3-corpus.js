// GEN-674 size stop, option E, Step 4 input realism: differential replay of real past tool calls.
// Usage: node sizestop3-corpus.js <live auto-approve.js> <working-copy auto-approve.js> <fixtureRoot>
// Collects every PowerShell/Bash/Monitor command in this PC's transcripts (sub-agents included) that
// mentions update-config, update-global-rule or CLAUDE.md, plus every Edit/Write/MultiEdit of the two
// Drive scripts, and runs each through the LIVE hook and the WORKING-COPY hook in two identical fixture
// trees (a check pass minted before every call). The hook derives every path from its own folder, so a
// fixture tree alone cannot see real paths; this replay therefore rewrites the real home folder
// (C:\Users\Erez in its backslash, slash and /c/ forms) to the fixture home in each command, path and
// cwd, so a real-path write of the global CLAUDE.md is judged as one. The Drive scripts keep their real
// G:\ paths (the hook names them absolutely). Live staging and log files are never touched. Prints every
// call whose outcome differs, and how many past commands hold the word the new ask rules match (the
// prompts they would have raised). Decides only; executes nothing.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const [LIVE, WC, ROOT] = process.argv.slice(2);
if (!LIVE || !WC || !ROOT) { console.error('usage: node sizestop3-corpus.js <live hook> <wc hook> <fixtureRoot>'); process.exit(1); }
const REAL_HOME = process.env.USERPROFILE;
const MENTION = /update-config|update-global-rule|claude\.md/i;
const ASK_WORD = /approvesizeupto/i;
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

// Rewrite the real home folder to a fixture home, in each of the forms commands use.
const homeBs = REAL_HOME.replace(/\//g, '\\');                         // C:\Users\Erez
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const forms = [
  { re: new RegExp(esc(homeBs).replace(/\\\\/g, '[\\\\/]+'), 'gi'), to: h => h },          // C:\Users\Erez or C:/Users/Erez
  { re: new RegExp('/' + homeBs[0] + esc(homeBs.slice(2)).replace(/\\\\/g, '/'), 'gi'), to: h => '/' + h[0].toLowerCase() + h.slice(2).replace(/\\/g, '/') },
];
function rewrite(v, home) {
  if (typeof v === 'string') { let s = v; for (const f of forms) s = s.replace(f.re, () => f.to(home)); return s; }
  if (Array.isArray(v)) return v.map(x => rewrite(x, home));
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = rewrite(v[k], home); return o; }
  return v;
}

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
let askWordCommands = 0;
const askWordSeen = new Set();
for (const f of walk(path.join(REAL_HOME, '.claude', 'projects'), [])) {
  let text; try { text = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
  if (!MENTION.test(text) && !ASK_WORD.test(text)) continue;
  for (const ln of text.split('\n')) {
    if (ln.indexOf('"tool_use"') === -1) continue;
    let rec; try { rec = JSON.parse(ln); } catch (e) { continue; }
    const content = rec && rec.message && Array.isArray(rec.message.content) ? rec.message.content : [];
    for (const c of content) {
      if (!c || c.type !== 'tool_use' || !c.input) continue;
      const isShell = ['PowerShell', 'Bash', 'Monitor'].includes(c.name) && typeof c.input.command === 'string';
      if (isShell && ASK_WORD.test(c.input.command)) {
        const k = c.name + '|' + c.input.command;
        if (!askWordSeen.has(k)) { askWordSeen.add(k); askWordCommands++; }
      }
      let keep = false;
      if (isShell) keep = MENTION.test(c.input.command);
      else if (['Edit', 'Write', 'MultiEdit'].includes(c.name) && typeof c.input.file_path === 'string') keep = DRIVE_SCRIPT.test(c.input.file_path);
      if (!keep) continue;
      const key = c.name + '|~|' + JSON.stringify(c.input);
      if (!calls.has(key)) calls.set(key, { tool: c.name, input: c.input, cwd: rec.cwd || REAL_HOME });
    }
  }
}

function run(t, call) {
  for (const f of fs.readdirSync(t.passes)) fs.rmSync(path.join(t.passes, f), { force: true });
  fs.writeFileSync(path.join(t.passes, 'p.json'), JSON.stringify({ kind: 'check', target: path.join(t.cl, 'CLAUDE.md').toLowerCase(), expires: new Date(Date.now() + 900000).toISOString() }));
  const env = Object.assign({}, process.env, { USERPROFILE: t.home, HOME: t.home }); delete env.CLAUDE_CONFIG_UNLOCK;
  const input = { tool_name: call.tool, tool_input: rewrite(call.input, t.home), cwd: rewrite(call.cwd, t.home), session_id: 'corpus' };
  const r = spawnSync(process.execPath, [t.hook], { input: JSON.stringify(input), encoding: 'utf8', env, timeout: 30000 });
  let decision = null; try { decision = JSON.parse(r.stdout).hookSpecificOutput.permissionDecision; } catch (e) { /* none */ }
  const why = (r.stderr || '').replace(/\s+/g, ' ').slice(0, 110);
  return { code: r.status, decision, why };
}

let same = 0, realPathRulesCalls = 0;
const diffs = [];
const homeRe = new RegExp(esc(homeBs).replace(/\\\\/g, '[\\\\/]+') + '[\\\\/]+\\.claude[\\\\/]+claude\\.md', 'i');
for (const call of calls.values()) {
  if (homeRe.test(JSON.stringify(call.input).replace(/\\\\/g, '\\'))) realPathRulesCalls++;
  const a = run(A, call), b = run(B, call);
  if (a.code === b.code && a.decision === b.decision) same++;
  else diffs.push({ call, a, b });
}
console.log(JSON.stringify({ calls: calls.size, namingRealGlobalClaudeMd: realPathRulesCalls, same, differ: diffs.length, pastCommandsHoldingTheAskWord: askWordCommands }));
for (const d of diffs) {
  console.log('- ' + d.call.tool + ' live=' + d.a.code + '/' + d.a.decision + ' new=' + d.b.code + '/' + d.b.decision + ' :: ' + d.b.why);
  console.log('    ' + JSON.stringify(d.call.input).replace(/\s+/g, ' ').slice(0, 240));
}
