// Replay real tool calls through a copy of the live hook and the working copy, in isolated fixture trees,
// and compare decisions. Never touches ~/.claude. Usage: node replay.js
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const home = process.env.USERPROFILE;
const S = 'C:/Users/Erez/AppData/Local/Temp/claude/C--Users-Erez--claude-spares-spare-MUPJ0U/f9a3d27b-2297-43fc-8134-be504e0921d1/scratchpad/';
const TARGET = new Set(['mcp__scheduled-tasks__list_scheduled_tasks', 'mcp__scheduled-tasks__list_task_runs',
  'mcp__ccd_session_mgmt__list_events', 'mcp__ccd_settings__get_settings', 'mcp__claude-in-chrome__tabs_context_mcp']);
function fixture(name, hookSrc) {
  const hooks = path.join(S, name, '.claude', 'hooks');
  fs.mkdirSync(hooks, { recursive: true });
  fs.mkdirSync(path.join(S, name, '.claude-staging'), { recursive: true });
  fs.writeFileSync(path.join(hooks, 'auto-approve.js'), fs.readFileSync(hookSrc, 'utf8'));
  fs.writeFileSync(path.join(hooks, 'secret-patterns.json'), fs.readFileSync(path.join(home, '.claude', 'hooks', 'secret-patterns.json'), 'utf8'));
  fs.writeFileSync(path.join(S, name, '.claude', 'settings.json'), fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
  return path.join(hooks, 'auto-approve.js');
}
const liveHook = fixture('fx-live', path.join(home, '.claude', 'hooks', 'auto-approve.js'));
const wcHook = fixture('fx-wc', path.join(S, 'auto-approve.wc.js'));

// Corpus: every call of the 5 target tools + every 20th other tool call, last 14 days.
const root = path.join(home, '.claude', 'projects');
const calls = []; let n = 0;
for (const d of fs.readdirSync(root)) {
  let files; try { files = fs.readdirSync(path.join(root, d)).filter(f => f.endsWith('.jsonl')); } catch (e) { continue; }
  for (const f of files) {
    const p = path.join(root, d, f);
    if (Date.now() - fs.statSync(p).mtimeMs > 14 * 864e5) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      if (!line.includes('"tool_use"')) continue;
      let j; try { j = JSON.parse(line); } catch (e) { continue; }
      const c = j.message && Array.isArray(j.message.content) ? j.message.content : [];
      for (const x of c) if (x.type === 'tool_use') {
        n++;
        if (TARGET.has(x.name) || n % 20 === 0) calls.push({ tool_name: x.name, tool_input: x.input || {}, cwd: j.cwd || '', session_id: 'replay', hook_event_name: 'PreToolUse', permission_mode: j.permissionMode || 'default' });
      }
    }
  }
}
function run(hook, inp) {
  const r = spawnSync(process.execPath, [hook], { input: JSON.stringify(inp), encoding: 'utf8', timeout: 20000 });
  let dec = 'defer';
  try { const o = JSON.parse(r.stdout); dec = (o.hookSpecificOutput && o.hookSpecificOutput.permissionDecision) || 'other'; } catch (e) { if (r.stdout && r.stdout.trim()) dec = 'unparsed'; }
  return r.status + ':' + dec;
}
const tally = {}; let diffsNonTarget = 0; const examples = [];
for (const inp of calls) {
  const a = run(liveHook, inp), b = run(wcHook, inp);
  const t = TARGET.has(inp.tool_name) ? inp.tool_name.split('__').pop() : 'other';
  const k = t + ' | live ' + a + ' -> wc ' + b;
  tally[k] = (tally[k] || 0) + 1;
  if (a !== b && t === 'other') { diffsNonTarget++; if (examples.length < 5) examples.push(inp.tool_name); }
}
console.log('corpus', calls.length, 'of', n, 'tool calls');
for (const [k, v] of Object.entries(tally).sort()) console.log(v, k);
console.log('non-target differences:', diffsNonTarget, examples.join(', '));
