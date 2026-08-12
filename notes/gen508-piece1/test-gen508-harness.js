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
// An APPROVE is exit 0 with the arm's own confirmation on stdout ("review record consumed"). This is
// the ONLY thing that string appears on, so matching it identifies a ticket-arm approve exactly.
function approved(r) { return r.code === 0 && r.out.indexOf('review record consumed') !== -1; }
// "Fell through" = the arm did not act. A deferral prints no decision at all, so the test is exit 0
// with no gate refusal on stderr AND no APPROVE confirmation on stdout. The second half is load-bearing:
// an approve is ALSO exit-0-with-no-gate-refusal, so without it fellThrough could not tell a genuine
// deferral from a record-consuming approve -- a payload meant to fall through but instead cleared by a
// stray record would read as a pass. (README adversarial audit: fellThrough could not distinguish the
// two.) It excludes only the ticket-arm approve string, so a shell command approved by another arm --
// which prints a different decision -- still reads as a fall-through of THIS arm, which is correct.
function fellThrough(r) { return r.code === 0 && r.err.indexOf('ticket-quality gate') === -1 && r.out.indexOf('review record consumed') === -1; }

// The shared prefix on EVERY ticket-gate refusal. Matching it proves a ticket-arm block fired, but not
// WHICH reason -- so an assertion that binds only to this (or to bare exit 2) passes for a block fired
// for the wrong reason, which is the exact gap the README adversarial audit named for the 18 exit-2-only
// assertions.
const TICKET_REFUSAL_PREFIX = 'Refused (ticket-quality gate): no usable ticket review record for';
// One distinctive fragment of each reason's `why` sentence in blockTicketVetting. `no-pass` is the reason
// with NO `why` (an in-scope write with no record), so it is the classification when the shared prefix is
// present but no signature matched. Only one `why` is ever written per block, so at most one matches.
// WIRED-SURFACE reasons only; the parked REST arm's reasons live in test-gen508-rest-parked.js. The
// contract test asserts every key here is a reason the wired hook actually produces and that no wired
// producer's reason is missing here -- so a new hook reason cannot silently read as no-pass.
const TICKET_BLOCK_SIGNATURES = {
  'internal-error': 'reserved for a bug in the gate itself',
  'unreadable-payload': 'could not be read end to end',
  'bad-target': 'Its target is unreadable',
  'bad-verdict': 'its verdict is not PASS',
  'reviewer-unverified': 'sub-agent sidecar is missing, or whose agentType',
  'no-token': 'does not end on',
  'bad-record': 'reviewer transcript could not be read at all',
  'transcript-too-large': 'exceeds the 4 MB read cap',
  'consume-failed': 'could not be consumed',
  'stale-content': 'minted for a DIFFERENT payload',
  'exempt-list-overflow': 'exemption list is over its',
  'exempt-list-unreadable': 'exemption list could not be read'
};
// Map a refusal to its reason KEY (or null if it is not a ticket-arm block). Use `ticketBlockReason(r)
// === '<reason>'` for reason-level assertions instead of `blocked(r, sharedPrefix)` or `r.code === 2`.
function ticketBlockReason(r) {
  if (r.code !== 2 || r.err.indexOf(TICKET_REFUSAL_PREFIX) === -1) return null;
  for (const key of Object.keys(TICKET_BLOCK_SIGNATURES)) {
    if (r.err.indexOf(TICKET_BLOCK_SIGNATURES[key]) !== -1) return key;
  }
  return 'no-pass';
}

// Per-file counters, so two suites in one process could not pollute each other's totals.
function newChecker() {
  const state = { pass: 0, fail: 0, failed: [], pending: [] };
  function check(name, cond, detail) {
    if (cond) { state.pass++; console.log('  ok   ' + name); }
    else { state.fail++; state.failed.push(name); console.log('  FAIL ' + name + (detail ? '  <- ' + detail : '')); }
  }
  // A spec whose TARGET FIX lands in a LATER step (Step 4/5). It SHOULD be false now, so it is recorded
  // as PENDING -- visible in the output but NOT counted as a suite failure. This is deliberate and
  // follows this suite's own rule that a permanently-red gate stops being read and then hides a real
  // regression (see the header of test-gen508-v8-arm.js -- the same reason the parked REST assertions
  // live in their own file). If `cond` is unexpectedly TRUE, the target fix has landed: it counts as a
  // pass and is flagged for promotion to a normal assertion.
  function expectPending(name, cond, mapsTo) {
    if (cond) { state.pass++; console.log('  ok   ' + name + '  (NOW PASSES -- promote to a normal assert; ' + mapsTo + ' may be done)'); }
    else { state.pending.push(name + '  ->  ' + mapsTo); console.log('  PEND ' + name + '  (red-by-design, awaits ' + mapsTo + ')'); }
  }
  return { check: check, expectPending: expectPending, state: state };
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
  blocked: blocked, approved: approved, fellThrough: fellThrough, newChecker: newChecker,
  ticketBlockReason: ticketBlockReason, TICKET_BLOCK_SIGNATURES: TICKET_BLOCK_SIGNATURES,
  TICKET_REFUSAL_PREFIX: TICKET_REFUSAL_PREFIX,
  writeRestFixtures: writeRestFixtures, installScriptCopy: installScriptCopy,
  removeScriptCopy: removeScriptCopy, cleanup: cleanup
};
