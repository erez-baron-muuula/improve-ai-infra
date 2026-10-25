// Build the auto-approve.js working copy with the PLAN_MODE_PROMPTLESS change. Reads live, writes scratch only.
const fs = require('fs');
const live = process.env.USERPROFILE + '\\.claude\\hooks\\auto-approve.js';
const out = 'C:/Users/Erez/AppData/Local/Temp/claude/C--Users-Erez--claude-spares-spare-MUPJ0U/f9a3d27b-2297-43fc-8134-be504e0921d1/scratchpad/auto-approve.wc.js';
let s = fs.readFileSync(live, 'utf8');
const eol = s.includes('\r\n') ? '\r\n' : '\n';
const L = a => a.join(eol);
function once(hay, needle) { if (hay.split(needle).length !== 2) throw new Error('anchor not unique: ' + needle.slice(0, 60)); }

const setAnchor = L(['// Tools whose payload is a shell command string we must classify.']);
once(s, setAnchor);
s = s.replace(setAnchor, L([
  '// Read-only tools that are bare entries in settings.json permissions.allow but still raised a',
  '// prompt in plan mode (14-day transcript scan, 2026-10-25: 10 prompts, none in other modes).',
  '// The bare-allow-list check in the stdin end handler defers before SAFE_TOOLS is reached, so these',
  '// get their own explicit approve, placed after every guard and before that defer, and only while',
  '// the name is still in the settings allow list (removing it there still makes it ask). tabs_context_mcp',
  '// can open an empty tab group, so it is near-read-only, not strictly read-only. The hooks docs say a hook',
  '// allow is honoured in plan mode for read-only calls only; a live plan-mode test after install',
  '// decides whether it covers these. A name that still prompts in plan mode has no effect here and',
  '// can be removed.',
  'const PLAN_MODE_PROMPTLESS = new Set([',
  "  'mcp__scheduled-tasks__list_scheduled_tasks',",
  "  'mcp__scheduled-tasks__list_task_runs',",
  "  'mcp__ccd_session_mgmt__list_events',",
  "  'mcp__ccd_settings__get_settings',",
  "  'mcp__claude-in-chrome__tabs_context_mcp',",
  ']);',
  '',
  setAnchor,
]));

const callAnchor = L([
  '  enforceTicketVetting(tool, input);',
  '',
  '  // Already allow-listed by settings (bare names) => no action, no log.',
]);
once(s, callAnchor);
s = s.replace(callAnchor, L([
  '  enforceTicketVetting(tool, input);',
  '',
  '  // Plan-mode prompt fix: approve these read-only tools explicitly, after every guard above and',
  '  // before the bare-allow-list defer below (which would otherwise leave them to plan mode\'s prompt).',
  "  if (PLAN_MODE_PROMPTLESS.has(tool) && bareAllowList().has(tool)) return approve('Auto-approved: read-only tool, approved explicitly so planning mode does not prompt');",
  '',
  '  // Already allow-listed by settings (bare names) => no action, no log.',
]));
fs.writeFileSync(out, s);
console.log('ok eol=' + JSON.stringify(eol));
