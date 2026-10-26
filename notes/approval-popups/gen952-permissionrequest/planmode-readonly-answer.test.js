// Tests for planmode-readonly-answer.js (GEN-952). Runs the hook as a child process with synthetic
// PermissionRequest input in an isolated fixture tree (its own .claude/settings.json and temp dir);
// never touches ~/.claude. Usage: node planmode-readonly-answer.test.js [path to hook file]
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');

const SRC = path.resolve(process.argv[2] || path.join(__dirname, 'planmode-readonly-answer.js'));
const TOOLS = ['mcp__scheduled-tasks__list_scheduled_tasks', 'mcp__scheduled-tasks__list_task_runs',
  'mcp__ccd_session_mgmt__list_events', 'mcp__ccd_settings__get_settings', 'mcp__claude-in-chrome__tabs_context_mcp'];
const TABS = TOOLS[4];
const ALLOW_JSON = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmra-test-'));
let pass = 0, fail = 0;
try {
  const hooksDir = path.join(root, '.claude', 'hooks');
  const tmp = path.join(root, 'tmp');
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.mkdirSync(tmp);
  const hook = path.join(hooksDir, 'planmode-readonly-answer.js');
  fs.writeFileSync(hook, fs.readFileSync(SRC, 'utf8'));
  const settings = path.join(root, '.claude', 'settings.json');
  const setAllow = list => fs.writeFileSync(settings, JSON.stringify({ permissions: { allow: list } }, null, 2));
  const marker = path.join(tmp, 'planmode-answer-trace.on'), traceFile = path.join(tmp, 'planmode-answer-trace.jsonl');

  const run = (stdin) => {
    const env = Object.assign({}, process.env, { TEMP: tmp, TMP: tmp, TMPDIR: tmp });
    const r = spawnSync(process.execPath, [hook], { input: stdin, encoding: 'utf8', env, timeout: 10000 });
    return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
  };
  const req = (o) => JSON.stringify(Object.assign({ hook_event_name: 'PermissionRequest', permission_mode: 'plan', tool_name: TOOLS[0], tool_input: {}, session_id: 't', cwd: root }, o));
  const check = (name, got, want) => {
    if (got.code === 0 && got.out === want && got.err === '') pass++;
    else { fail++; console.log('FAIL', name, JSON.stringify(got)); }
  };
  const truthy = (name, ok, detail) => { if (ok) pass++; else { fail++; console.log('FAIL', name, detail || ''); } };

  setAllow(TOOLS.concat(['Read', 'Bash(git status:*)']));
  for (const t of TOOLS) check('plan + ' + t, run(req({ tool_name: t })), ALLOW_JSON);
  for (const m of ['default', 'auto', 'acceptEdits', 'bypassPermissions', 'dontAsk', '', 'PLAN']) check('mode ' + JSON.stringify(m), run(req({ permission_mode: m })), '');
  check('mode missing', run(JSON.stringify({ hook_event_name: 'PermissionRequest', tool_name: TOOLS[0] })), '');
  check('unlisted tool (allow-listed in fixture)', run(req({ tool_name: 'Read' })), '');
  check('unlisted mcp write tool', run(req({ tool_name: 'mcp__46ff9446-421e-4358-809c-6b8b01e661b2__notion-update-page' })), '');
  check('name variant Claude_in_Chrome', run(req({ tool_name: 'mcp__Claude_in_Chrome__tabs_context_mcp' })), '');
  check('wrong event PreToolUse', run(req({ hook_event_name: 'PreToolUse' })), '');
  check('event missing', run(JSON.stringify({ permission_mode: 'plan', tool_name: TOOLS[0] })), '');
  check('bad JSON', run('{not json'), '');
  check('empty input', run(''), '');
  check('JSON null', run('null'), '');
  check('JSON array', run('[]'), '');
  check('tool_name not a string', run(req({ tool_name: ['x'] })), '');
  check('tabs_context createIfEmpty true', run(req({ tool_name: TABS, tool_input: { createIfEmpty: true } })), '');
  check('tabs_context createIfEmpty "false" string (safe side)', run(req({ tool_name: TABS, tool_input: { createIfEmpty: 'false' } })), '');
  check('tabs_context createIfEmpty false',run(req({ tool_name: TABS, tool_input: { createIfEmpty: false } })), ALLOW_JSON);
  check('tabs_context no tool_input', run(JSON.stringify({ hook_event_name: 'PermissionRequest', permission_mode: 'plan', tool_name: TABS })), ALLOW_JSON);
  check('other tool with createIfEmpty field', run(req({ tool_input: { createIfEmpty: true } })), ALLOW_JSON);

  setAllow(TOOLS.slice(1));
  check('removed from allow list', run(req({ tool_name: TOOLS[0] })), '');
  check('still listed one passes', run(req({ tool_name: TOOLS[1] })), ALLOW_JSON);
  setAllow(TOOLS.map(t => t + '(*)'));
  check('only a parenthesised rule, not bare', run(req({ tool_name: TOOLS[0] })), '');
  fs.writeFileSync(settings, String.fromCharCode(0xFEFF) + JSON.stringify({ permissions: { allow: TOOLS } }));
  check('settings with byte-order mark', run(req()), ALLOW_JSON);
  fs.writeFileSync(settings, '{ broken');
  check('unreadable settings', run(req()), '');
  fs.writeFileSync(settings, JSON.stringify({ permissions: { allow: 'not-an-array' } }));
  check('allow not an array', run(req()), '');
  fs.unlinkSync(settings);
  check('settings missing', run(req()), '');

  // Trace off: no file written.
  setAllow(TOOLS);
  run(req()); run(req({ permission_mode: 'default' }));
  truthy('trace off writes nothing', !fs.existsSync(traceFile));
  // Trace on: one line per call, decision unchanged.
  fs.writeFileSync(marker, '');
  check('trace on, plan', run(req()), ALLOW_JSON);
  check('trace on, default', run(req({ permission_mode: 'default' })), '');
  check('trace on, bad JSON', run('{x'), '');
  const lines = fs.existsSync(traceFile) ? fs.readFileSync(traceFile, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];
  const want = [[true, 'answered'], [false, 'not plan mode'], [false, 'unreadable input']];
  truthy('trace lines', lines.length === 3 && lines.every((l, i) => l.answered === want[i][0] && l.reason === want[i][1]), JSON.stringify(lines));
  // Trace over the size cap: no further growth, decision unchanged.
  fs.writeFileSync(traceFile, 'x'.repeat(256 * 1024 + 1));
  check('trace over cap, plan', run(req()), ALLOW_JSON);
  truthy('trace over cap does not grow', fs.statSync(traceFile).size === 256 * 1024 + 1);
  // Trace file unwritable (a directory in its place): decision unchanged.
  fs.unlinkSync(traceFile); fs.mkdirSync(traceFile);
  check('trace unwritable, plan', run(req()), ALLOW_JSON);
} catch (e) {
  fail++;
  console.log('FAIL test harness threw:', e && e.message);
} finally {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { console.log('note: fixture not removed:', root); }
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
