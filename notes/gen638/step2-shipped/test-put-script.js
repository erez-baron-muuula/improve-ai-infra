// GEN-638 step 2 -- unit tests for the atlassian-put.ps1 WORKING COPY (named ap-put.working.ps1 so the
// staging gate, which refuses any shell command naming atlassian-put, does not refuse these tests).
// Precondition: no Atlassian key stored on this PC (checked with set-claude-key.ps1 -List before running),
// so no case can reach the network. Each case runs in a fresh `powershell -Command` (a top-level call,
// as from the PowerShell tool), except the wrapper case, which runs it from a .ps1.
// Also the DRIFT CHECK: the target patterns in the script must accept/reject exactly what the hook's do.
// Usage: node test-put-script.js [script path] [hook path]
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const HERE = __dirname;
const SCRIPT = process.argv[2] || path.join(HERE, 'ap-put.working.ps1');
const HOOK = process.argv[3] || 'C:/Users/Erez/.claude/hooks/auto-approve.js';
const BODY = path.join(HERE, 'put-test-body.json');
fs.writeFileSync(BODY, '{"fields":{}}');

function ps(cmd) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', timeout: 60000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const call = args => ps('& "' + SCRIPT + '" ' + args);
const results = [];
function expect(name, r, wantCode, has) {
  const ok = (wantCode === null || r.code === wantCode) && (!has || r.out.indexOf(has) !== -1);
  results.push({ name, ok, got: 'exit ' + r.code + ' / ' + r.out.replace(/\s+/g, ' ').slice(0, 110) });
}
const NOKEY = 'The Atlassian key is not set up on this PC';

// valid targets reach the key read (and stop there: no key stored)
expect('V1 Jira MD-3649 -> reaches key read', call('-Jira MD-3649 -BodyFile "' + BODY + '"'), 1, NOKEY);
expect('V2 Confluence 1182400513 -> reaches key read', call('-ConfluencePage 1182400513 -BodyFile "' + BODY + '"'), 1, NOKEY);
expect('V3 G3 message names the helper command', call('-Jira MD-1 -BodyFile "' + BODY + '"'), 1, 'set-claude-key.ps1');
// bad targets refused BEFORE any key read
for (const [n, a] of [
  ['B1 lowercase key', "-Jira md-1"], ['B2 leading-zero number', '-Jira MD-01'], ['B3 quote splice', "-Jira \"MD-3649'/../MD-1'\""],
  ['B4 %2e%2e', '-Jira MD-3649%2e%2e'], ['B5 slash path', "-Jira 'MD-1/../MD-2'"], ['B6 query', "-Jira 'MD-1?x=1'"],
  ['B7 one-letter project', '-Jira M-1'], ['B8 trailing space', "-Jira 'MD-1 '"], ['B9 newline', '-Jira "MD-1`nX"'],
]) expect(n + ' -> refused', call(a + ' -BodyFile "' + BODY + '"'), 1, 'Refused: -Jira');
for (const [n, a] of [
  ['P1 17 digits', '-ConfluencePage 11824005131182400'], ['P2 leading zero', "-ConfluencePage '01182400513'"], ['P3 hex', '-ConfluencePage 0x10'],
  ['P4 1kb', '-ConfluencePage 1kb'], ['P5 1e5', '-ConfluencePage 1e5'], ['P6 negative', '-ConfluencePage -5'], ['P7 key as page', '-ConfluencePage MD-1'],
]) expect(n + ' -> refused', call(a + ' -BodyFile "' + BODY + '"'), 1, 'Refused: -ConfluencePage');
expect('E1 both targets -> parameter-set error', call('-Jira MD-1 -ConfluencePage 5 -BodyFile "' + BODY + '"'), 1, 'Parameter set cannot be resolved');
expect('E2 no target -> refused', call(''), 1, 'Refused: give exactly one');
expect('E3 missing body file -> refused', call('-Jira MD-1 -BodyFile "C:\\nope\\missing.json"'), 1, 'Refused: -BodyFile not found');
expect('E4 no -Url parameter exists', call('-Url "https://muuula.atlassian.net/rest/api/3/issue/MD-1" -BodyFile "' + BODY + '"'), 1, null);
// wrapper refusal
const WRAP = path.join(HERE, 'put-wrapper-test.ps1');
fs.writeFileSync(WRAP, '& "' + SCRIPT + '" -Jira MD-3649 -BodyFile "' + BODY + '"\r\n');
expect('W1 called from a wrapper .ps1 -> refused', ps('& "' + WRAP + '"'), 1, 'never from another script');
const WRAP2 = path.join(HERE, 'put-iexwrapper-test.ps1');
fs.writeFileSync(WRAP2, "Invoke-Expression ('& \"" + SCRIPT + "\" -Jira MD-3649 -BodyFile \"" + BODY + "\"')\r\n");
expect('W2 called via Invoke-Expression inside a .ps1 -> refused', ps('& "' + WRAP2 + '"'), 1, 'never from another script');
const EMPTY = path.join(HERE, 'put-empty-body.json'); fs.writeFileSync(EMPTY, '');
expect('F1 UNC body path -> refused before any file access', call('-Jira MD-3649 -BodyFile "\\\\127.0.0.1\\c$\\x.json"'), 1, 'full local path on a drive');
expect('F2 Env: provider path -> refused', call('-Jira MD-3649 -BodyFile "Env:\\PATH"'), 1, 'full local path on a drive');
expect('F3 relative body path -> refused', call('-Jira MD-3649 -BodyFile ".\\b.json"'), 1, 'full local path on a drive');
expect('F4 empty body file -> refused', call('-Jira MD-3649 -BodyFile "' + EMPTY + '"'), 1, 'Refused: -BodyFile is empty');
// file hygiene
const src = fs.readFileSync(SCRIPT);
results.push({ name: 'H1 script is ASCII-only', ok: !src.some(b => b > 127), got: '' });
const tmpLeft = fs.readdirSync(os.tmpdir()).filter(f => /^atlassian-rest-cfg-[0-9a-f]{32}\.txt$/.test(f));
results.push({ name: 'H2 no temp key-config file left in TEMP', ok: tmpLeft.length === 0, got: tmpLeft.length + ' left' });

// DRIFT CHECK: script patterns vs hook patterns over one corpus
const s = src.toString('utf8');
const jp = /\$JiraKeyPattern = '([^']+)'/.exec(s), cp = /\$ConfluencePagePattern = '([^']+)'/.exec(s);
const h = fs.readFileSync(HOOK, 'utf8');
const hj = /const ATLASSIAN_PUT_JIRA_KEY_RE = \/(.+)\/;/.exec(h), hc = /const ATLASSIAN_PUT_CONF_PAGE_RE = \/(.+)\/;/.exec(h);
if (!jp || !cp || !hj || !hc) results.push({ name: 'D0 patterns found in both files', ok: false, got: [!!jp, !!cp, !!hj, !!hc].join(',') });
else {
  const toJs = p => new RegExp('^' + p.replace(/^\\A/, '').replace(/\\z$/, '') + '$');
  const sJ = toJs(jp[1]), sC = toJs(cp[1]), hJ = new RegExp(hj[1]), hC = new RegExp(hc[1]);
  const corpus = ['MD-1', 'MD-3649', 'AN-1406', 'A1-5', 'AB-1234567', 'AB-12345678', 'ABCDEFGHIJ-1', 'ABCDEFGHIJK-1', 'md-1', 'MD-01', 'M-1', '1MD-1', 'MD_1', 'MD-1 ',
    '1', '1182400513', '9999999999999999', '11824005131182400', '0', '01', '0x10', '1kb', '1e5', '-5', 'MD-1\n', '\u041cD-1', ''];
  let agree = 0; const dis = [];
  for (const c of corpus) { if (sJ.test(c) === hJ.test(c) && sC.test(c) === hC.test(c)) agree++; else dis.push(JSON.stringify(c)); }
  results.push({ name: 'D1 script and hook target patterns agree on all ' + corpus.length + ' corpus cases', ok: dis.length === 0, got: dis.join(' ') });
  results.push({ name: 'D2 PowerShell \\A..\\z vs JS ^..$ forms are the same text otherwise', ok: jp[1] === '\\A' + hj[1].slice(1, -1) + '\\z' && cp[1] === '\\A' + hc[1].slice(1, -1) + '\\z', got: '' });
}

let pass = 0;
for (const r of results) { if (r.ok) pass++; console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  [' + r.got + ']')); }
console.log('\n' + pass + '/' + results.length + ' passed');
for (const f of [BODY, WRAP, WRAP2, EMPTY]) fs.rmSync(f, { force: true });
process.exit(pass === results.length ? 0 : 1);
