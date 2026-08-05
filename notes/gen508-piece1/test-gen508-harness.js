// Shared harness for the GEN-508 behavioural suites. Extracted when the REST assertions were parked
// for piece 2 (2026-08-05): two files now spawn the same hook the same way, and a copy-pasted harness
// would drift exactly as the two statements of the housekeeping list once did.
//
// Every suite here runs the hook as a REAL PreToolUse process -- JSON on stdin, decision on
// stdout/stderr, exit code as the verdict -- rather than importing functions, so what is tested is
// what will run.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
// The hook under test. This is the working copy in this folder, NOT the installed hook: installing is
// /vet-code's job. (Until 2026-08-05 this pointed at `working-v8.js`, a filename that is not in the
// folder, so both suites failed at spawn and every assertion failed for that reason alone.)
const HOOK = path.join(DIR, 'auto-approve.working.js');
// Where the hook itself resolves the pinned REST script: <hookdir>/../scripts/. With the hook running
// from this folder that is notes/scripts/, which does NOT exist in the repo -- installScriptCopy()
// creates it on demand and removeScriptCopy() takes it away again.
const SCRIPT = path.join(DIR, '..', 'scripts', 'notion-rest-write.ps1');
const SCRIPT_SRC = path.join(DIR, 'notion-rest-write.ps1');
// The hook derives STAGING_DIR as <hookdir>/../../.claude-staging, so the records live two levels up.
// Getting this wrong made every record test read as "no record" on the first run.
const PASS_DIR = path.join(DIR, '..', '..', '.claude-staging', 'ticket-passes');

const MCP = 'mcp__46ff9446-421e-4358-809c-6b8b01e661b2__';
const TT_DS = 'bd2cd17b-f58f-4993-8b95-468e881272fa';
const GEN58 = '36d6e495d07c816e9e0cce265d694ab3';
const PAGE = '3a36e495d07c81fb9a55ddc315639c7f';

function run(input) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), encoding: 'utf8' });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
function mcp(tool, ti) {
  return run({ tool_name: MCP + tool, tool_input: ti, cwd: DIR, transcript_path: path.join(DIR, 'nope.jsonl') });
}
function sh(cmd) {
  return run({ tool_name: 'Bash', tool_input: { command: cmd }, cwd: DIR, transcript_path: path.join(DIR, 'nope.jsonl') });
}
function cli(args) {
  const r = spawnSync(process.execPath, [HOOK].concat(args), { encoding: 'utf8', input: '' });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function blocked(r, reason) { return r.code === 2 && r.err.indexOf(reason) !== -1; }
// "Fell through" = the arm did not act. A deferral prints no decision at all, so the test is exit 0
// with no gate refusal on stderr -- NOT the presence of a permissionDecision, which only an APPROVE
// emits.
function fellThrough(r) { return r.code === 0 && r.err.indexOf('ticket-quality gate') === -1; }

// Per-file counters, so two suites in one process could not pollute each other's totals.
function newChecker() {
  const state = { pass: 0, fail: 0, failed: [] };
  function check(name, cond, detail) {
    if (cond) { state.pass++; console.log('  ok   ' + name); }
    else { state.fail++; state.failed.push(name); console.log('  FAIL ' + name + (detail ? '  <- ' + detail : '')); }
  }
  return { check: check, state: state };
}

// ---- fixtures, created on demand so a suite that needs none leaves none behind ----
const bodyFile = path.join(DIR, 'test-body.json');
const badBodyFile = path.join(DIR, 'test-body-archived.json');

function writeRestFixtures() {
  fs.writeFileSync(bodyFile, JSON.stringify({ children: [{ paragraph: { rich_text: [] } }] }), 'utf8');
  fs.writeFileSync(badBodyFile, JSON.stringify({ archived: true }), 'utf8');
  const canonical = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + SCRIPT +
    '" -Method PATCH -Url "https://api.notion.com/v1/pages/' + PAGE + '" -BodyFile "' + bodyFile + '"';
  return { bodyFile: bodyFile, badBodyFile: badBodyFile, canonical: canonical };
}

// The pin tests tamper with the script and restore it, so they must operate on a COPY: a crash between
// write and restore would otherwise leave the repo's pinned script corrupt, and its bytes are what the
// hook's REST_SCRIPT_SHA256 is taken over.
function installScriptCopy() {
  fs.mkdirSync(path.dirname(SCRIPT), { recursive: true });
  fs.copyFileSync(SCRIPT_SRC, SCRIPT);
}
function removeScriptCopy() {
  try { fs.rmSync(path.dirname(SCRIPT), { recursive: true, force: true }); } catch (e) { /* best effort */ }
}

// Remove only what a suite created. Never recurse into anything not listed here.
function cleanup(extraPaths) {
  const targets = [bodyFile, badBodyFile,
                   path.join(DIR, 'test-payload.json'), path.join(DIR, 'test-payload-env.json'),
                   path.join(DIR, 'test-cmd.txt'), path.join(DIR, 'deferred-calls.jsonl')]
                  .concat(extraPaths || []);
  for (const t of targets) { try { fs.rmSync(t, { recursive: true, force: true }); } catch (e) { /* best effort */ } }
  try { fs.rmSync(path.join(DIR, 'sess'), { recursive: true, force: true }); } catch (e) { /* best effort */ }
  // The repo-local staging dir exists only because a suite ran; the real one is under ~/.claude.
  try { fs.rmSync(path.join(DIR, '..', '..', '.claude-staging'), { recursive: true, force: true }); } catch (e) { /* best effort */ }
}

module.exports = {
  DIR: DIR, HOOK: HOOK, SCRIPT: SCRIPT, PASS_DIR: PASS_DIR,
  MCP: MCP, TT_DS: TT_DS, GEN58: GEN58, PAGE: PAGE,
  run: run, mcp: mcp, sh: sh, cli: cli,
  blocked: blocked, fellThrough: fellThrough, newChecker: newChecker,
  writeRestFixtures: writeRestFixtures, installScriptCopy: installScriptCopy,
  removeScriptCopy: removeScriptCopy, cleanup: cleanup
};
