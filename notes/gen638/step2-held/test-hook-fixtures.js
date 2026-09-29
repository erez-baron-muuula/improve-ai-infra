// GEN-638 step 2 -- fixture tests for the auto-approve.js working copy (key-sheet guard +
// atlassian-put staging branch). Builds a fake self-consistent ~/.claude tree under the
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

// ---- Staging branch: atlassian-put
const url = 'https://muuula.atlassian.net/rest/api/2/issue/MD-1';
const putCmd = '& "' + PUT + '" -Url "' + url + '" -BodyFile "C:\\tmp\\b.json"';
expect('S1 PowerShell atlassian-put, no pass -> staging block', run('PowerShell', { command: putCmd }), true, 'staging lock');
expect('S2 Bash atlassian-put, no pass -> staging block', run('Bash', { command: 'powershell -NoProfile -File "' + PUT.replace(/\\/g, '/') + '" -Url "' + url + '" -BodyFile /tmp/b.json' }), true, 'staging lock');
expect('S3 multi-line mentioning atlassian-put -> refused', run('PowerShell', { command: '$u = "' + url + '"\n' + putCmd }), true);
expect('S4 chained atlassian-put ; echo -> refused', run('PowerShell', { command: putCmd + '; echo done' }), true, 'chains other commands');
expect('S5 shortened params (-U/-B) still a write', run('PowerShell', { command: '& "' + PUT + '" -U "' + url + '" -B x.json' }), true, 'staging lock');
expect('S6 path without extension, other casing', run('PowerShell', { command: '& "$HOME\\.claude\\scripts\\Atlassian-PUT" -Url "' + url + '" -BodyFile x.json' }), true, 'staging lock');
expect('S7 cat of the script (documented cost) -> blocked', run('Bash', { command: 'cat "' + PUT.replace(/\\/g, '/') + '"' }), true, 'staging lock');
expect('S8 sandbox ticket MD-3649 -> exempt from staging', run('PowerShell', { command: '& "' + PUT + '" -Url "https://muuula.atlassian.net/rest/api/2/issue/MD-3649" -BodyFile "C:\\tmp\\b.json"' }), false);
expect('S9 atlassian-get (read-only) -> not a staging write', run('PowerShell', { command: '& "' + GET + '" -Url "' + url + '?expand=renderedFields"' }), false);
expect('S8b non-sandbox PUT whose BODY FILE name carries the sandbox key -> still needs a pass', run('PowerShell', { command: '& "' + PUT + '" -Url "' + url + '" -BodyFile "C:\\tmp\\redline-MD-3649.json"' }), true, 'staging lock');
expect('S8c sandbox key only in the query string -> still needs a pass', run('PowerShell', { command: '& "' + PUT + '" -Url "' + url + '?x=MD-3649" -BodyFile "C:\\tmp\\b.json"' }), true, 'staging lock');
expect('S8d path traversal through the sandbox key -> still needs a pass', run('PowerShell', { command: '& "' + PUT + '" -Url "https://muuula.atlassian.net/rest/api/2/issue/MD-3649/../MD-1" -BodyFile "C:\\tmp\\b.json"' }), true, 'staging lock');
expect('S8e curl PUT to the sandbox ticket -> exempt (regression)', run('Bash', { command: 'curl -sk -X PUT https://muuula.atlassian.net/rest/api/2/issue/MD-3649 -H "Content-Type: application/json" --data-binary @b.json' }), false);
expect('S8f curl PUT to non-sandbox with sandbox key in body filename -> needs a pass', run('Bash', { command: 'curl -sk -X PUT ' + url + ' --data-binary @MD-3649-redline.json' }), true, 'staging lock');
expect('S8g atlassian-put with a trailing # comment naming the sandbox -> needs a pass', run('PowerShell', { command: '& "' + PUT + '" -Url "' + url + '" -BodyFile "C:\\tmp\\b.json" # drafted on https://muuula.atlassian.net/browse/MD-3649' }), true, 'staging lock');
expect('S8h curl PUT to sandbox AND non-sandbox URL -> needs a pass', run('Bash', { command: 'curl -sk -X PUT https://muuula.atlassian.net/rest/api/2/issue/MD-3649 ' + url + ' --data-binary @b.json' }), true, 'staging lock');
expect('S8i Monitor running atlassian-put, no pass -> staging block', run('Monitor', { command: 'powershell -File "' + PUT.replace(/\\/g, '/') + '" -Url "' + url + '" -BodyFile b.json', description: 'x' }), true, 'staging lock');
expect('S8j Monitor running a curl PUT to Atlassian, no pass -> staging block', run('Monitor', { command: 'curl -sk -X PUT ' + url + ' --data-binary @b.json', description: 'x' }), true, 'staging lock');
expect('S8k curl PUT to sandbox with a -K config file (could hide URLs) -> needs a pass', run('Bash', { command: 'curl -sk -K extra.cfg -X PUT https://muuula.atlassian.net/rest/api/2/issue/MD-3649 --data-binary @b.json' }), true, 'staging lock');
expect('S8l sandbox PUT whose URL has a query string -> still exempt', run('PowerShell', { command: '& "' + PUT + '" -Url "https://muuula.atlassian.net/rest/api/2/issue/MD-3649?notifyUsers=false" -BodyFile "C:\\tmp\\b.json"' }), false);
expect('A25 Agent brief quoting the old rule (.gsheet name, no id) -> not blocked', run('Agent', { subagent_type: 'check-reviewer', description: 'x', prompt: 'old rule: read keys from `G:\\My Drive\\AI Projects\\API tokens and keys - AI.gsheet`' }), false);
expect('A26 Notion search quoting the .gsheet name -> not blocked', run('mcp__46ff9446-421e-4358-809c-6b8b01e661b2__notion-search', { query: 'old rule API tokens and keys - AI.gsheet' }), false);
expect('A24 shell opening the sheet shortcut file -> key-sheet guard', run('PowerShell', { command: 'Invoke-Item "G:\\My Drive\\AI Projects\\API tokens and keys - AI.gsheet"' }), true, G);
// regression on the existing curl arm
expect('S10 regression: curl PUT to Atlassian, no pass -> blocked', run('Bash', { command: 'curl -sk -X PUT ' + url + ' -H "Content-Type: application/json" --data-binary @b.json' }), true, 'staging lock');
expect('S11 regression: curl GET to Atlassian -> not blocked', run('Bash', { command: 'curl -sk ' + url }), false);

// pass consumption: with a valid shell pass, the script PUT is approved and the pass is consumed
const passFile = path.join(FIX_PASSES, 'fixture-shell-pass.json');
fs.writeFileSync(passFile, JSON.stringify({ surface: 'shell', expires: new Date(Date.now() + 10 * 60000).toISOString() }));
const before = fs.readdirSync(FIX_PASSES);
const rPass = run('PowerShell', { command: putCmd });
const after = fs.readdirSync(FIX_PASSES);
const consumed = !after.includes('fixture-shell-pass.json') && after.some(f => f.startsWith('fixture-shell-pass.json.consumed.'));
results.push({ name: 'S12 with a shell pass -> approved AND pass consumed', ok: rPass.code === 0 && rPass.decision === 'allow' && consumed, got: 'exit ' + rPass.code + ' / ' + rPass.decision + ' / before=' + before.join(',') + ' after=' + after.join(',') });
const rAgain = run('PowerShell', { command: putCmd });
results.push({ name: 'S13 same call again (pass spent) -> blocked', ok: rAgain.code === 2, got: 'exit ' + rAgain.code });

let pass = 0;
for (const r of results) { if (r.ok) pass++; console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + '  [' + r.got + ']'); }
console.log('\n' + pass + '/' + results.length + ' passed');
rmrf(FIX);
process.exit(pass === results.length ? 0 : 1);
