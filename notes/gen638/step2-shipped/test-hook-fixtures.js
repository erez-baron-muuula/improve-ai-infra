// GEN-638 step 2 -- fixture tests for the auto-approve.js working copy (key-sheet guard +
// atlassian-put anchored-template staging branch, GEN-638 redesign 2026-10-04). Builds a fake self-consistent ~/.claude tree under the
// scratchpad so every HOOK_DIR-relative path (settings.json allow-list, staging passes,
// sandbox registry, logs) resolves to fixtures; drives the real hook via spawnSync/stdin.
// Usage: node test-hook-fixtures.js
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const WORKING = process.env.HOOK_UNDER_TEST || path.join(HERE, 'auto-approve.working.js');
const LIVE_CLAUDE = 'C:/Users/Erez/.claude';
const FIX = path.join(HERE, 'fixture-home');
const FIX_CLAUDE = path.join(FIX, '.claude');
const FIX_HOOKS = path.join(FIX_CLAUDE, 'hooks');
const FIX_STAGING = path.join(FIX, '.claude-staging');
const FIX_PASSES = path.join(FIX_STAGING, 'passes');
const SHEET_ID = '139jAZeYXzh14gkTY4goGuCybc-Vo5idOPyGJbk2kpX8';
const DRIVE = 'mcp__29434d4d-f523-42ae-803a-2fb8d7bd3ee2__';
const PUT = 'C:\\Users\\Erez\\.claude\\scripts\\atlassian-put.ps1';
const GET = 'C:\\Users\\Erez\\.claude\\scripts\\atlassian-get.ps1';

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function setupTree(hookSource) {
  rmrf(FIX);
  fs.mkdirSync(FIX_HOOKS, { recursive: true });
  fs.mkdirSync(FIX_PASSES, { recursive: true });
  fs.writeFileSync(path.join(FIX_HOOKS, 'auto-approve.js'), fs.readFileSync(hookSource));
  fs.writeFileSync(path.join(FIX_HOOKS, 'secret-patterns.json'), fs.readFileSync(path.join(LIVE_CLAUDE, 'hooks', 'secret-patterns.json')));
  fs.writeFileSync(path.join(FIX_CLAUDE, 'settings.json'), fs.readFileSync(path.join(LIVE_CLAUDE, 'settings.json')));
  fs.writeFileSync(path.join(FIX_STAGING, 'sandboxes.json'), fs.readFileSync('C:/Users/Erez/.claude-staging/sandboxes.json'));
}

function run(tool, toolInput, extra) {
  const env = Object.assign({}, process.env);
  delete env.CLAUDE_CONFIG_UNLOCK;
  const payload = Object.assign({ tool_name: tool, session_id: 'fixture', cwd: 'C:\\Users\\Erez\\AI Projects\\Improve AI Infra' }, extra || {});
  if (toolInput !== '__omit__') payload.tool_input = toolInput;
  const r = spawnSync(process.execPath, [path.join(FIX_HOOKS, 'auto-approve.js')], { input: JSON.stringify(payload), encoding: 'utf8', env, timeout: 20000 });
  let decision = 'none';
  try { const j = JSON.parse(r.stdout || '{}'); decision = (j.hookSpecificOutput && j.hookSpecificOutput.permissionDecision) || j.decision || 'none'; } catch (e) { decision = 'unparsed'; }
  return { code: r.status, stderr: r.stderr || '', decision };
}

const results = [];
function expect(name, r, wantBlock, stderrHas) {
  let ok = wantBlock ? r.code === 2 : r.code === 0;
  if (ok && stderrHas) ok = r.stderr.indexOf(stderrHas) !== -1;
  results.push({ name, ok, got: 'exit ' + r.code + ' / ' + r.decision + (r.code === 2 ? ' / ' + r.stderr.slice(0, 70).replace(/\s+/g, ' ') : '') });
}

setupTree(WORKING);
const G = 'key-sheet guard';

// ---- Part A: the sheet id in any route that can reach it -> blocked
expect('A1 Drive read_file_content with sheet id', run(DRIVE + 'read_file_content', { fileId: SHEET_ID }), true, G);
expect('A2 Drive download_file_content with sheet id', run(DRIVE + 'download_file_content', { fileId: SHEET_ID }), true, G);
expect('A3 Drive get_file_metadata with sheet id', run(DRIVE + 'get_file_metadata', { fileId: SHEET_ID }), true, G);
expect('A4 Drive copy_file with sheet id', run(DRIVE + 'copy_file', { fileId: SHEET_ID, title: 'x' }), true, G);
expect('A5 built-in browser navigate to the sheet', run('mcp__Claude_Browser__navigate', { url: 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/edit' }), true, G);
expect('A6 Chrome navigate to the sheet', run('mcp__claude-in-chrome__navigate', { url: 'docs.google.com/spreadsheets/d/' + SHEET_ID }), true, G);
expect('A7 WebFetch of the sheet', run('WebFetch', { url: 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv', prompt: 'x' }), true, G);
expect('A8 Bash curl to Sheets API with id', run('Bash', { command: 'curl -sk https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID }), true, G);
expect('A9 PowerShell with id', run('PowerShell', { command: 'curl.exe -sk "https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID + '/values/A1:Z99"' }), true, G);
expect('A10 id nested deep in MCP input', run(DRIVE + 'read_file_content', { opts: { list: ['x', { id: SHEET_ID }] } }), true, G);

// ---- Part A must NOT fire on local file tools or unrelated input
expect('A11 Write whose content contains the id (not blocked by guard)', run('Write', { file_path: 'C:\\Users\\Erez\\AI Projects\\Improve AI Infra\\notes\\x.md', content: 'id ' + SHEET_ID }), false);
expect('A12 Edit whose new_string contains the id', run('Edit', { file_path: 'C:\\Users\\Erez\\AI Projects\\Improve AI Infra\\notes\\x.md', old_string: 'a', new_string: SHEET_ID }), false);
expect('A13 Read tool', run('Read', { file_path: 'C:\\Users\\Erez\\AI Projects\\Improve AI Infra\\notes\\x.md' }), false);
expect('A14 Grep for the id', run('Grep', { pattern: SHEET_ID, path: 'C:\\Users\\Erez\\AI Projects' }), false);
expect('A15 Drive read of a different file', run(DRIVE + 'read_file_content', { fileId: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdEFG' }), false);
expect('A16 id minus its last char (no substring match)', run(DRIVE + 'read_file_content', { fileId: SHEET_ID.slice(0, -1) }), false);
expect('A17 MCP tool with tool_input omitted (no crash)', run(DRIVE + 'read_file_content', '__omit__'), false);
expect('A18 MCP tool with tool_input null (no crash)', run(DRIVE + 'get_file_metadata', null), false);
expect('A20 Monitor command with the id -> blocked', run('Monitor', { command: 'curl -sk https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID, description: 'x' }), true, G);
expect('A21 CronCreate prompt with the id -> blocked', run('CronCreate', { prompt: 'open https://docs.google.com/spreadsheets/d/' + SHEET_ID, cron: '0 9 * * *' }), true, G);
expect('A22 MultiEdit with the id -> not blocked by guard', run('MultiEdit', { file_path: 'C:\\Users\\Erez\\AI Projects\\Improve AI Infra\\notes\\x.md', edits: [{ old_string: 'a', new_string: SHEET_ID }] }), false);
expect('A23 Agent prompt without the id -> unaffected', run('Agent', { subagent_type: 'check-reviewer', prompt: 'review x', description: 'x' }), false);
expect('A19 Notion fetch unrelated',run('mcp__46ff9446-421e-4358-809c-6b8b01e661b2__notion-fetch', { id: 'https://app.notion.com/p/36d6e495d07c816e9e0cce265d694ab3' }), false);

// ---- Part B: Drive previews off
expect('B1 search_files without flag', run(DRIVE + 'search_files', { query: "title contains 'invoice'" }), true, 'excludeContentSnippets');
expect('B2 search_files flag false', run(DRIVE + 'search_files', { query: "title contains 'invoice'", excludeContentSnippets: false }), true, 'excludeContentSnippets');
expect('B3 search_files flag "true" as a string', run(DRIVE + 'search_files', { query: 'x', excludeContentSnippets: 'true' }), true, 'excludeContentSnippets');
expect('B4 search_files flag true -> allowed', run(DRIVE + 'search_files', { query: "title contains 'invoice'", excludeContentSnippets: true }), false);
expect('B5 list_recent_files without flag', run(DRIVE + 'list_recent_files', {}), true, 'excludeContentSnippets');
expect('B6 list_recent_files flag true -> allowed', run(DRIVE + 'list_recent_files', { excludeContentSnippets: true, pageSize: 5 }), false);
expect('B7 search_files with tool_input omitted -> blocked, no crash', run(DRIVE + 'search_files', '__omit__'), true, 'excludeContentSnippets');
expect('B8 search_files on another server prefix without flag', run('mcp__abcdef__search_files', { query: 'x' }), true, 'excludeContentSnippets');
expect('B9 search_session_transcripts (not a Drive listing) untouched', run('mcp__ccd_session_mgmt__search_session_transcripts', { query: 'x' }), false);

// ---- GEN-638 redesign (2026-10-04): atlassian-put anchored template + raw-curl arm
function runEnv(tool, toolInput, envExtra) {
  const env = Object.assign({}, process.env);
  delete env.CLAUDE_CONFIG_UNLOCK;
  Object.assign(env, envExtra || {});
  const payload = { tool_name: tool, session_id: 'fixture', cwd: 'C:\\Users\\Erez\\AI Projects\\Improve AI Infra', tool_input: toolInput };
  const r = spawnSync(process.execPath, [path.join(FIX_HOOKS, 'auto-approve.js')], { input: JSON.stringify(payload), encoding: 'utf8', env, timeout: 20000 });
  let decision = 'none';
  try { const j = JSON.parse(r.stdout || '{}'); decision = (j.hookSpecificOutput && j.hookSpecificOutput.permissionDecision) || j.decision || 'none'; } catch (e) { decision = 'unparsed'; }
  return { code: r.status, stderr: r.stderr || '', decision };
}
const SL = 'staging lock';
const HEAD = '& "$HOME\\.claude\\scripts\\atlassian-put.ps1"';
const T = (kind, target, body) => HEAD + ' -' + kind + ' ' + target + ' -BodyFile ' + (body || '"C:\\tmp\\b.json"');
const PS = cmd => run('PowerShell', { command: cmd });
const passPath = n => path.join(FIX_PASSES, n);
const mint = (n, obj) => fs.writeFileSync(passPath(n), JSON.stringify(Object.assign({ expires: new Date(Date.now() + 10 * 60000).toISOString() }, obj)));
const live = n => fs.existsSync(passPath(n));
const consumedOf = n => fs.readdirSync(FIX_PASSES).some(f => f.startsWith(n + '.consumed.'));
const clearPasses = () => { for (const f of fs.readdirSync(FIX_PASSES)) fs.unlinkSync(passPath(f)); };

// -- the template, sandbox targets -> exempt (exit 0, no staging refusal)
expect('R1 template Jira sandbox MD-3649 -> exempt', PS(T('Jira', 'MD-3649')), false);
expect('R2 template Confluence sandbox 1182400513 -> exempt', PS(T('ConfluencePage', '1182400513')), false);
expect('R3 template Jira sandbox AN-1406 -> exempt', PS(T('Jira', 'AN-1406')), false);
expect('R3b template, single-quoted body path -> exempt', PS(T('Jira', 'MD-3649', "'C:\\Users\\Erez\\AppData\\Local\\Temp\\claude\\scratch-pad\\redline_r1.json'")), false);
expect('R3c template with trailing spaces -> exempt', PS(T('Jira', 'MD-3649') + '   '), false);

// -- non-sandbox targets, no pass -> blocked
expect('R4 template Jira MD-1, no pass -> blocked', PS(T('Jira', 'MD-1')), true, 'No staging pass for the REST write to MD-1');
expect('R5 template Confluence 12345, no pass -> blocked', PS(T('ConfluencePage', '12345')), true, 'No staging pass');

// -- pass binding and consumption
clearPasses();
mint('rest-md1.json', { surface: 'rest', target: 'MD-1' });
let r = PS(T('Jira', 'MD-1'));
results.push({ name: 'R6 matching rest pass -> approved AND consumed', ok: r.code === 0 && r.decision === 'allow' && !live('rest-md1.json') && consumedOf('rest-md1.json'), got: 'exit ' + r.code + ' / ' + r.decision });
r = PS(T('Jira', 'MD-1'));
results.push({ name: 'R6b same call again (pass spent) -> blocked', ok: r.code === 2, got: 'exit ' + r.code });
clearPasses();
mint('rest-md2.json', { surface: 'rest', target: 'MD-2' });
r = PS(T('Jira', 'MD-1'));
results.push({ name: 'R7 pass for a different target -> blocked, that pass untouched', ok: r.code === 2 && live('rest-md2.json'), got: 'exit ' + r.code });
clearPasses();
mint('shell-any.json', { surface: 'shell' });
r = PS(T('Jira', 'MD-1'));
results.push({ name: 'R8 untargeted shell pass does not satisfy the script -> blocked, untouched', ok: r.code === 2 && live('shell-any.json'), got: 'exit ' + r.code });
clearPasses();
mint('rest-lc.json', { surface: 'rest', target: 'md-1' });
r = PS(T('Jira', 'MD-1'));
results.push({ name: 'R9 pass target matched case-insensitively -> approved, consumed', ok: r.code === 0 && consumedOf('rest-lc.json'), got: 'exit ' + r.code + ' / ' + r.decision });
clearPasses();
mint('rest-conf.json', { surface: 'rest', target: '12345' });
r = PS(T('ConfluencePage', '12345'));
results.push({ name: 'R10 Confluence rest pass -> approved, consumed', ok: r.code === 0 && consumedOf('rest-conf.json'), got: 'exit ' + r.code + ' / ' + r.decision });
clearPasses();
mint('rest-exp.json', { surface: 'rest', target: 'MD-1', expires: new Date(Date.now() - 60000).toISOString() });
r = PS(T('Jira', 'MD-1'));
results.push({ name: 'R11 expired rest pass -> blocked', ok: r.code === 2, got: 'exit ' + r.code });
clearPasses();

// -- attack corpus: every one refused (exit 2, staging lock), and a live rest pass for MD-1 is never consumed
mint('bait.json', { surface: 'rest', target: 'MD-1' });
const BT = '\u0060';
const attacks = [
  ['X1 Pass B: quote splice MD-3649\'/../MD-1\'', T('Jira', "MD-3649'/../MD-1'")],
  ['X2 Pass B: MD-3649\'0\'', T('Jira', "MD-3649'0'")],
  ['X3 Pass B: %2e%2e', T('Jira', 'MD-3649%2e%2e')],
  ['X4 single-quoted target', T('Jira', "'MD-3649'")],
  ['X5 double-quoted target', T('Jira', '"MD-3649"')],
  ['X6 $() target', T('Jira', '$(echo MD-1)')],
  ['X7 backtick in target', T('Jira', 'MD-36' + BT + '49')],
  ['X8 abbreviated -J', HEAD + ' -J MD-3649 -BodyFile "C:\\tmp\\b.json"'],
  ['X9 colon form -Jira:MD-3649', HEAD + ' -Jira:MD-3649 -BodyFile "C:\\tmp\\b.json"'],
  ['X10 en-dash parameter', HEAD + ' \u2013Jira MD-3649 -BodyFile "C:\\tmp\\b.json"'],
  ['X11 second target', HEAD + ' -Jira MD-3649 -Jira MD-1 -BodyFile "C:\\tmp\\b.json"'],
  ['X12 trailing extra parameter', T('Jira', 'MD-3649') + ' -ConfluencePage 1'],
  ['X13 chained ;', T('Jira', 'MD-3649') + '; echo x'],
  ['X14 chained &&', T('Jira', 'MD-3649') + ' && echo x'],
  ['X15 newline then a second call', T('Jira', 'MD-3649') + '\n' + T('Jira', 'MD-1')],
  ['X16 script copy under TEMP', '& "C:\\Users\\Erez\\AppData\\Local\\Temp\\atlassian-put.ps1" -Jira MD-3649 -BodyFile "C:\\tmp\\b.json"'],
  ['X17 relative .\\atlassian-put.ps1', '& ".\\atlassian-put.ps1" -Jira MD-3649 -BodyFile "C:\\tmp\\b.json"'],
  ['X18 17-digit page id', T('ConfluencePage', '11824005131182400')],
  ['X19 leading-zero page id', T('ConfluencePage', '01182400513')],
  ['X20 lowercase key', T('Jira', 'md-3649')],
  ['X21 Cyrillic homoglyph key', T('Jira', '\u041cD-3649')],
  ['X22 lowercase $home', '& "$home\\.claude\\scripts\\atlassian-put.ps1" -Jira MD-3649 -BodyFile "C:\\tmp\\b.json"'],
  ['X23 $ in body path', T('Jira', 'MD-3649', '"C:\\tmp\\$x.json"')],
  ['X24 curly quote in body path injecting a 2nd target', T('Jira', 'MD-3649', '"C:\\tmp\\b.json\u201d -ConfluencePage 1 \u201c"')],
  ['X25 unquoted body path', T('Jira', 'MD-3649', 'C:\\tmp\\b.json')],
  ['X26 missing call operator', '"$HOME\\.claude\\scripts\\atlassian-put.ps1" -Jira MD-3649 -BodyFile "C:\\tmp\\b.json"'],
  ['X27 numeric id as -Jira', T('Jira', '1182400513')],
  ['X28 key as -ConfluencePage', T('ConfluencePage', 'MD-3649')],
  ['X29 parameters out of order', HEAD + ' -BodyFile "C:\\tmp\\b.json" -Jira MD-3649'],
  ['X30 mixed-case parameter -jira', HEAD + ' -jira MD-3649 -BodyFile "C:\\tmp\\b.json"'],
  ['X31 Get-Content of the script (mention)', 'Get-Content "$HOME\\.claude\\scripts\\atlassian-put.ps1"'],
  ['X32 # comment after the template', T('Jira', 'MD-3649') + ' # note'],
  ['X40 body path carrying " -ConfluencePage 5"', T('Jira', 'MD-3649', '"C:\\x -ConfluencePage 5"')],
  ['X41 body path starting with -', T('Jira', 'MD-3649', "'-x.json'")],
];
for (const [name, cmd] of attacks) {
  const rr = PS(cmd);
  const okBlock = rr.code === 2 && rr.stderr.indexOf(SL) !== -1;
  results.push({ name: name + ' -> refused, bait untouched', ok: okBlock && live('bait.json'), got: 'exit ' + rr.code + ' / ' + rr.stderr.slice(0, 60).replace(/\s+/g, ' ') });
}
// other tools carrying the exact template text
for (const [name, tool, cmd] of [
  ['X34 Bash tool with the exact template text', 'Bash', T('Jira', 'MD-3649')],
  ['X35 Bash: powershell -File script', 'Bash', 'powershell -NoProfile -File "$HOME/.claude/scripts/atlassian-put.ps1" -Jira MD-3649 -BodyFile "x.json"'],
  ['X36 Bash: cat the script', 'Bash', 'cat ~/.claude/scripts/atlassian-put.ps1'],
  ['X37 Bash: git add the held copy', 'Bash', 'git add notes/gen638/step2-held/atlassian-put.ps1'],
]) {
  const rr = run(tool, { command: cmd });
  results.push({ name: name + ' -> refused, bait untouched', ok: rr.code === 2 && rr.stderr.indexOf(SL) !== -1 && live('bait.json'), got: 'exit ' + rr.code });
}
{
  const rr = run('Monitor', { command: T('Jira', 'MD-3649'), description: 'x' });
  results.push({ name: 'X38 Monitor with the template -> refused, bait untouched', ok: rr.code === 2 && rr.stderr.indexOf(SL) !== -1 && live('bait.json'), got: 'exit ' + rr.code });
}
// known-accepted residual, pinned: a name assembled at run time is NOT seen by the gate (step2-approach.md Residual)
{
  const rr = PS('& ("$HOME\\.claude\\scripts\\atlassian-pu" + "t.ps1") -Jira MD-1 -BodyFile "x.json"');
  results.push({ name: 'P1 PINNED RESIDUAL: run-time-assembled name is not matched by the staging gate', ok: rr.code === 0 && rr.stderr.indexOf(SL) === -1 && live('bait.json'), got: 'exit ' + rr.code + ' / ' + rr.decision });
}
// break-glass clears NEITHER the shape refusal (Pass B finding: it is the only check for a reshaped call)
// nor a pass-miss
{
  clearPasses();
  const BG = { CLAUDE_CONFIG_UNLOCK: '1' };
  for (const [name, tool, cmd] of [
    ['G1 break-glass + chained template', 'PowerShell', T('Jira', 'MD-3649') + '; echo x'],
    ['G4 break-glass + quoted key -Jira "MD-1"', 'PowerShell', T('Jira', '"MD-1"')],
    ['G5 break-glass + -Jira:MD-1', 'PowerShell', HEAD + ' -Jira:MD-1 -BodyFile "C:\\tmp\\b.json"'],
    ['G6 break-glass + Bash -File form', 'Bash', 'powershell -NoProfile -File "$HOME/.claude/scripts/atlassian-put.ps1" -Jira MD-1 -BodyFile "x.json"'],
  ]) {
    const rr = runEnv(tool, { command: cmd }, BG);
    results.push({ name: name + ' -> still refused', ok: rr.code === 2 && rr.stderr.indexOf('names atlassian-put') !== -1, got: 'exit ' + rr.code });
  }
  const rm = runEnv('Monitor', { command: 'curl -sk -X PUT https://muuula.atlassian.net/rest/api/3/issue/MD-1 --data-binary @b.json', description: 'x' }, BG);
  results.push({ name: 'G7 break-glass + Monitor curl PUT -> still refused', ok: rm.code === 2 && rm.stderr.indexOf('Monitor command looks like') !== -1, got: 'exit ' + rm.code });
  mint('bad-target.json', { surface: 'rest', target: { toString: 0 } });
  const rb = PS(T('Jira', 'MD-1'));
  results.push({ name: 'M5 malformed pass (object target) -> no crash, blocked, untouched', ok: rb.code === 2 && rb.stderr.indexOf('No staging pass') !== -1 && live('bad-target.json'), got: 'exit ' + rb.code });
  clearPasses();
  const r2 = runEnv('PowerShell', { command: T('Jira', 'MD-1') }, { CLAUDE_CONFIG_UNLOCK: '1' });
  results.push({ name: 'G2 break-glass does NOT clear a pass-miss on a template call', ok: r2.code === 2 && r2.stderr.indexOf('No staging pass') !== -1, got: 'exit ' + r2.code });
  const r3 = runEnv('Bash', { command: 'curl -sk -X PUT https://muuula.atlassian.net/rest/api/3/issue/MD-1 --data-binary @b.json # atlassian-put' }, { CLAUDE_CONFIG_UNLOCK: '1' });
  results.push({ name: 'G3 break-glass + raw curl PUT that mentions atlassian-put -> refused', ok: r3.code === 2 && r3.stderr.indexOf(SL) !== -1, got: 'exit ' + r3.code + ' / ' + r3.stderr.slice(0, 60).replace(/\s+/g, ' ') });
}
{
  mint('bait.json', { surface: 'rest', target: 'MD-1' });
  const rr = PS('& "$HOME\\.claude\\scripts\\ATLASS~1.PS1" -Jira MD-1 -BodyFile "C:\\tmp\\b.json"');
  results.push({ name: 'X39 8.3 short name ATLASS~1.PS1 -> refused, bait untouched', ok: rr.code === 2 && rr.stderr.indexOf(SL) !== -1 && live('bait.json'), got: 'exit ' + rr.code + ' / bait ' + live('bait.json') + ' / ' + rr.stderr.slice(0, 160).replace(/\s+/g, ' ') });
}
clearPasses();

expect('X33 non-sandbox target whose body path names the sandbox, no pass -> blocked', PS(T('Jira', 'MD-1', '"C:\\tmp\\MD-3649.json"')), true, 'No staging pass');

// -- raw-curl arm
const url = 'https://muuula.atlassian.net/rest/api/3/issue/MD-1';
const sbx = 'https://muuula.atlassian.net/rest/api/3/issue/MD-3649';
expect('C1 curl PUT to the SANDBOX, no pass -> now blocked (exemption dropped)', run('Bash', { command: 'curl -sk -X PUT ' + sbx + ' --data-binary @b.json' }), true, 'No staging pass for a direct Atlassian write');
expect('C2 curl PUT to non-sandbox, no pass -> blocked', run('Bash', { command: 'curl -sk -X PUT ' + url + ' --data-binary @b.json' }), true, SL);
mint('rest-c.json', { surface: 'rest', target: 'MD-1' });
r = run('Bash', { command: 'curl -sk -X PUT ' + url + ' --data-binary @b.json' });
results.push({ name: 'C3 a rest pass does not satisfy raw curl -> blocked, untouched', ok: r.code === 2 && live('rest-c.json'), got: 'exit ' + r.code });
clearPasses();
mint('shell-c.json', { surface: 'shell' });
r = run('Bash', { command: 'curl -sk -X PUT ' + url + ' --data-binary @b.json' });
results.push({ name: 'C4 shell pass -> curl PUT approved AND consumed', ok: r.code === 0 && r.decision === 'allow' && consumedOf('shell-c.json'), got: 'exit ' + r.code + ' / ' + r.decision });
clearPasses();
expect('C5 Monitor curl PUT -> refused', run('Monitor', { command: 'curl -sk -X PUT ' + url + ' --data-binary @b.json', description: 'x' }), true, 'Monitor command looks like');
expect('C6 curl GET -> not blocked', run('Bash', { command: 'curl -sk ' + url }), false);
expect('C7 chained curl PUT ; echo -> refused', run('Bash', { command: 'curl -sk -X PUT ' + url + ' --data-binary @b.json; echo done' }), true, 'chains other commands');
expect('C8 multi-line curl PUT -> refused', run('Bash', { command: 'echo a\ncurl -sk -X PUT ' + url + ' --data-binary @b.json' }), true);
expect('C9 PowerShell Invoke-RestMethod PUT to sandbox, no pass -> blocked', run('PowerShell', { command: 'Invoke-RestMethod -Method Put -Uri "' + sbx + '" -InFile b.json' }), true, SL);
expect('C10 atlassian-get (read-only) -> not a staging write', run('PowerShell', { command: '& "$HOME\\.claude\\scripts\\atlassian-get.ps1" -Url "' + url + '?expand=renderedFields"' }), false);

// -- MCP front door regression
const EJ = 'mcp__9da13451-799f-4bf6-9a8f-58fe25fc6c80__editJiraIssue';
const UC = 'mcp__9da13451-799f-4bf6-9a8f-58fe25fc6c80__updateConfluencePage';
expect('M1 editJiraIssue description on MD-1, no pass -> blocked', run(EJ, { issueIdOrKey: 'MD-1', fields: { description: 'x' } }), true, SL);
expect('M2 editJiraIssue on sandbox MD-3649 -> exempt', run(EJ, { issueIdOrKey: 'MD-3649', fields: { description: 'x' } }), false);
expect('M3 updateConfluencePage on sandbox -> exempt', run(UC, { pageId: '1182400513', body: 'x' }), false);
expect('M4 updateConfluencePage non-sandbox, no pass -> blocked', run(UC, { pageId: '99', body: 'x' }), true, SL);

let pass = 0;
for (const r of results) { if (r.ok) pass++; console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + '  [' + r.got + ']'); }
console.log('\n' + pass + '/' + results.length + ' passed');
rmrf(FIX);
process.exit(pass === results.length ? 0 : 1);
