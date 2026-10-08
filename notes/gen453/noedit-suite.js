// Live checks of notion-write-verify.js that need no Notion write (real REST reads, real hook process).
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const HOOK = path.join(__dirname, 'notion-write-verify.js');
const TOOL = 'mcp__46ff9446-421e-4358-809c-6b8b01e661b2__notion-update-page';
const PP = '3f36e495d07c81f0b7c1d2ce5db8d12d';
const VOL8 = '3b36e495-d07c-815c-83c3-f57e03e42aee';
const VOL9 = '3f16e495-d07c-8163-8c5d-d253e0288ba4';
function run(event, id, ti, resp) {
  const input = { session_id: 'suite', hook_event_name: event, tool_name: TOOL, tool_input: ti, tool_use_id: id };
  if (event === 'PostToolUse') input.tool_response = [{ type: 'text', text: resp || '{"page_id":"x"}' }];
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), encoding: 'utf8' });
  let line = '';
  try { line = JSON.parse(r.stdout).hookSpecificOutput.additionalContext; } catch (e) { /* none */ }
  return { code: r.status, line: line, out: r.stdout, err: r.stderr };
}
const results = [];
const check = (name, ok, detail) => results.push([name, ok, detail]);
let r;
r = run('PostToolUse', 's1', { page_id: PP, command: 'update_content', content_updates: [{ old_str: 'a', new_str: 'b' }] }, '{"object":"async_task","id":"task_abcdef1234567890","status":"queued"}');
check('async -> NOT done yet', /NOT done yet/.test(r.line), r.line);
r = run('PostToolUse', 's2', { page_id: PP, command: 'insert_content', content: 'x' });
check('no snapshot -> NOT verified', /NOT verified \(no before-snapshot\)/.test(r.line), r.line);
run('PreToolUse', 's3', { page_id: '00000000-0000-4000-8000-000000000001', command: 'update_content', content_updates: [{ old_str: 'a', new_str: 'b' }] });
r = run('PostToolUse', 's3', { page_id: '00000000-0000-4000-8000-000000000001', command: 'update_content', content_updates: [{ old_str: 'a', new_str: 'b' }] });
check('unshared page -> NOT verified', /not shared/.test(r.line), r.line);
r = run('PreToolUse', 's4', { page_id: VOL8, command: 'insert_content', content: 'probe' });
check('append to Vol. 8 -> exit 2 with GEN-593 reason', r.code === 2 && /GEN-593/.test(r.err), 'code=' + r.code + ' ' + r.err.slice(0, 120));
r = run('PreToolUse', 's5', { page_id: VOL9, command: 'insert_content', content: 'probe' });
check('append to Vol. 9 -> passes (exit 0, no output)', r.code === 0 && !r.out, 'code=' + r.code);
r = run('PreToolUse', 's6', { page_id: 'https://app.notion.com/p/GEN-58-Reasoning-failure-instance-log-Vol-8-' + VOL8.replace(/-/g, ''), command: 'insert_content', content: 'probe' });
check('slug-URL page id for Vol. 8 -> still blocked', r.code === 2, 'code=' + r.code);
r = run('PreToolUse', 's7', { page_id: VOL8, command: 'update_content', content_updates: [{ old_str: 'a', new_str: 'b' }] });
check('editing (not appending) Vol. 8 -> passes', r.code === 0, 'code=' + r.code);
r = run('PostToolUse', 's8', { data: 'not json' });
check('unrecognised input -> NOT verified', /unrecognised input/.test(r.line), r.line);
r = run('PostToolUse', 's9', { page_id: PP, command: 'update_properties', properties: { title: 'x' } });
check('update_properties -> silent', r.code === 0 && !r.out, r.out);
run('PreToolUse', 's10', { page_id: PP, command: 'apply_template', template_id: 'x' });
r = run('PostToolUse', 's10', { page_id: PP, command: 'apply_template', template_id: 'x' });
check('apply_template, nothing yet -> NOT verified, do not re-apply', /do NOT re-apply/.test(r.line), r.line);
run('PreToolUse', 's11', { page_id: PP, command: 'replace_content', new_str: 'x' });
r = run('PostToolUse', 's11', { page_id: PP, command: 'replace_content', new_str: 'x' });
check('replace with no change on a nested page -> NOT verified (nested or did not land)', /NOT verified: no top-level change/.test(r.line), r.line);
let fails = 0;
for (const [n, ok, d] of results) { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); }
console.log(fails === 0 ? 'ALL PASS (' + results.length + ')' : fails + ' FAILED');
