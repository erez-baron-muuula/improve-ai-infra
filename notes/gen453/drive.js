// Drive notion-write-verify.js as a real hook process (JSON on stdin), without registering it.
// Usage: node drive.js pre  <toolUseId> '<tool_input json>'
//        node drive.js post <toolUseId> '<tool_input json>' '<tool_response text>'
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const HOOK = path.join(__dirname, 'notion-write-verify.js');
const TOOL = 'mcp__46ff9446-421e-4358-809c-6b8b01e661b2__notion-update-page';
const [mode, id, tiJson, respText] = process.argv.slice(2);
const input = {
  session_id: 'drive', hook_event_name: mode === 'pre' ? 'PreToolUse' : 'PostToolUse',
  tool_name: TOOL, tool_input: JSON.parse(tiJson), tool_use_id: id
};
if (mode === 'post') input.tool_response = [{ type: 'text', text: respText || '{"page_id":"x"}' }];
const t0 = Date.now();
const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), encoding: 'utf8' });
console.log('exit', r.status, (Date.now() - t0) + 'ms');
console.log('stdout', r.stdout || '(none)');
if (r.stderr) console.log('stderr', r.stderr.slice(0, 300));
