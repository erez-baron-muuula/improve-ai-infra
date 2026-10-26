// /vet-code Step 4 input realism for planmode-readonly-answer.js (GEN-952): feed REAL tool calls from the
// last 14 days of this PC's transcripts to the hook as PermissionRequest inputs, once as plan mode and once
// as default mode, in a fixture tree holding a copy of the live settings.json. Counts fires, expected fires,
// false fires and misses. Prints no tool inputs. Usage: node realism.js <hook working copy>
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const HOOK_SRC = path.resolve(process.argv[2]);
const home = os.homedir();
const TOOLS = new Set(['mcp__scheduled-tasks__list_scheduled_tasks', 'mcp__scheduled-tasks__list_task_runs',
  'mcp__ccd_session_mgmt__list_events', 'mcp__ccd_settings__get_settings', 'mcp__claude-in-chrome__tabs_context_mcp']);
const PER_TOOL = 4;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gen952-realism-'));
try {
  fs.mkdirSync(path.join(root, '.claude', 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tmp'));
  const hook = path.join(root, '.claude', 'hooks', 'planmode-readonly-answer.js');
  fs.writeFileSync(hook, fs.readFileSync(HOOK_SRC, 'utf8'));
  const settingsText = fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8');
  fs.writeFileSync(path.join(root, '.claude', 'settings.json'), settingsText);
  const allow = new Set(JSON.parse(settingsText).permissions.allow || []);

  const proj = path.join(home, '.claude', 'projects');
  const calls = []; const seen = {}; let n = 0;
  for (const d of fs.readdirSync(proj)) {
    let files; try { files = fs.readdirSync(path.join(proj, d)).filter(f => f.endsWith('.jsonl')); } catch (e) { continue; }
    for (const f of files) {
      const p = path.join(proj, d, f);
      if (Date.now() - fs.statSync(p).mtimeMs > 14 * 864e5) continue;
      for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        if (!line.includes('"tool_use"')) continue;
        let j; try { j = JSON.parse(line); } catch (e) { continue; }
        const c = j.message && Array.isArray(j.message.content) ? j.message.content : [];
        for (const x of c) if (x.type === 'tool_use') {
          n++;
          seen[x.name] = (seen[x.name] || 0) + 1;
          if (TOOLS.has(x.name) || seen[x.name] <= PER_TOOL) calls.push({ name: x.name, input: x.input || {} });
        }
      }
    }
  }
  const env = Object.assign({}, process.env, { TEMP: path.join(root, 'tmp'), TMP: path.join(root, 'tmp') });
  let fires = 0, expected = 0, falseFires = 0, misses = 0, runs = 0; const falseNames = {}, missNames = {};
  for (const call of calls) for (const mode of ['plan', 'default']) {
    const r = spawnSync(process.execPath, [hook], { input: JSON.stringify({ hook_event_name: 'PermissionRequest', permission_mode: mode, tool_name: call.name, tool_input: call.input, session_id: 'realism', cwd: root }), encoding: 'utf8', env, timeout: 10000 });
    runs++;
    const fired = (r.stdout || '').includes('"behavior":"allow"');
    const should = mode === 'plan' && TOOLS.has(call.name) && allow.has(call.name) &&
      !(call.name === 'mcp__claude-in-chrome__tabs_context_mcp' && call.input && call.input.createIfEmpty);
    if (fired) fires++;
    if (should) expected++;
    if (fired && !should) { falseFires++; falseNames[call.name] = (falseNames[call.name] || 0) + 1; }
    if (!fired && should) { misses++; missNames[call.name] = (missNames[call.name] || 0) + 1; }
  }
  const createIfEmpty = calls.filter(c => c.name === 'mcp__claude-in-chrome__tabs_context_mcp' && c.input && c.input.createIfEmpty).length;
  console.log(`tool calls seen: ${n}; distinct tools: ${Object.keys(seen).length}; real calls replayed: ${calls.length} (${calls.filter(c => TOOLS.has(c.name)).length} of the 5 tools, ${createIfEmpty} tabs_context with createIfEmpty); hook runs: ${runs}`);
  console.log(`fires: ${fires}; expected fires: ${expected}; false fires: ${falseFires} ${JSON.stringify(falseNames)}; misses: ${misses} ${JSON.stringify(missNames)}`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
