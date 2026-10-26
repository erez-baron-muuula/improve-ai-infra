// Build a settings.json working copy that adds the PermissionRequest registration (GEN-952).
// Reads live, writes scratch only. Live file is LF, 2-space JSON, trailing newline (round-trip verified).
const fs = require('fs');
const live = process.env.USERPROFILE + '/.claude/settings.json';
const out = 'C:/Users/Erez/AppData/Local/Temp/claude/C--Users-Erez-AI-Projects-Improve-AI-Infra/4ef27b5e-24b1-456a-a2fc-dc035aa90b06/scratchpad/settings.wc.json';
const s = fs.readFileSync(live, 'utf8');
const j = JSON.parse(s);
if (JSON.stringify(j, null, 2) + '\n' !== s) throw new Error('live settings.json does not round-trip; refusing');
if (j.hooks.PermissionRequest) throw new Error('PermissionRequest key already exists');
const entry = [{
  matcher: 'mcp__scheduled-tasks__list_scheduled_tasks|mcp__scheduled-tasks__list_task_runs|mcp__ccd_session_mgmt__list_events|mcp__ccd_settings__get_settings|mcp__claude-in-chrome__tabs_context_mcp',
  hooks: [{
    type: 'command',
    command: 'node "C:/Users/Erez/.claude/hooks/planmode-readonly-answer.js"',
    timeout: 10,
    onFailure: 'continue'
  }]
}];
const hooks = {};
for (const k of Object.keys(j.hooks)) {
  hooks[k] = j.hooks[k];
  if (k === 'PreToolUse') hooks.PermissionRequest = entry;
}
j.hooks = hooks;
fs.writeFileSync(out, JSON.stringify(j, null, 2) + '\n');
console.log('ok', Object.keys(j.hooks).join(','));
