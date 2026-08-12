// PARKED: the GEN-508 raw REST/curl assertions -- piece 2, not piece 1a.
// ============================================================================
// These assert the behaviour of §4.5 of the hook, which is BUILT BUT NOT WIRED (see the NOT WIRED
// banner above that section in auto-approve.working.js). Erez's decision, 2026-08-05: install the
// Notion MCP surface first and defer this one.
//
// SO FAILURES HERE ARE NOT A REGRESSION -- they are the deferral, and this file measures how wide it
// is. It exits 0 while exactly EXPECTED_FAILURES assertions fail, and NON-ZERO the moment that number
// moves in either direction:
//   * MORE failures than the baseline -> something else broke; investigate.
//   * FEWER -> someone reconnected the arm (or part of it). That is the piece-2 event: fix the three
//     items in the NOT WIRED banner, move these assertions back into test-gen508-v8-arm.js, and
//     delete this file. Do NOT just lower the baseline.
//
// The six assertions that pass today are the ones asserting that something is left UNTOUCHED, which
// an unwired arm satisfies trivially. They are kept rather than moved because they must keep passing
// after reconnection too, for a different reason.
//
// Run it the same way as the main suite: `node test-gen508-rest-parked.js`.
const H = require('./test-gen508-harness.js');
const fs = require('fs');
const path = require('path');

const { sh, cli, run, blocked, fellThrough, MCP, GEN58, PAGE, PASS_DIR, DIR, SCRIPT } = H;
const { check, state } = H.newChecker();

// Baseline measured 2026-08-05, immediately after the arm was unwired: 25 assertions, 19 failing.
const EXPECTED_FAILURES = 19;

// The pin tests tamper with the script, so they run against a COPY at the path the hook resolves.
H.installScriptCopy();
const { bodyFile, badBodyFile, canonical } = H.writeRestFixtures();

console.log('\n== B. the raw-REST surface, branch A ==');
{
  const r = sh(canonical);
  check('canonical invocation reaches the record path (no record -> no-pass)',
        r.code === 2 && r.err.indexOf('no usable ticket review record') !== -1 &&
        r.err.indexOf('rest-') === -1 && r.err.indexOf('Reissue it as the canonical') === -1,
        'err=' + r.err.slice(0, 200));
}
{
  // THE ROUND-1 FAIL-OPEN, found independently by all three lenses: an assignment prefix. Under the
  // first v8 draft this was neither prefix-matched NOR detected -> silent approve on a page create.
  const r = sh('$r = ' + canonical);
  check('assignment-prefixed canonical is BLOCKED (the POST fail-open)', blocked(r, 'not the EXACT canonical invocation'), 'code=' + r.code + ' err=' + r.err.slice(0, 160));
}
{
  // The other half of the same hole: abbreviated parameters carry no -Method token at all.
  const r = sh('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + SCRIPT + '" -M POST -U "https://api.notion.com/v1/pages" -B NONE');
  check('abbreviated parameters are BLOCKED', blocked(r, 'not the EXACT canonical invocation'), 'err=' + r.err.slice(0, 160));
}
{
  // Newline separation: an anchored whole-string match with \s+ would have accepted this, minted a
  // record, and never run the write.
  const r = sh(canonical.replace(' -Method', '\n  -Method'));
  check('newline-separated invocation is BLOCKED', r.code === 2, 'code=' + r.code);
}
{
  const r = sh(canonical + ' ; echo done');
  check('chained canonical is BLOCKED (no chain guard needed)', r.code === 2, 'code=' + r.code);
}
{
  const r = sh('cat "' + SCRIPT + '"');
  check('merely naming the script hard-blocks (stated cost)', blocked(r, 'references the Notion write script'), 'err=' + r.err.slice(0, 160));
}
{
  const r = sh(canonical.replace('/v1/pages/' + PAGE, '/v1/comments'));
  check('an unadmitted URL family is BLOCKED', r.code === 2, 'code=' + r.code);
}
{
  const r = sh(canonical.replace(bodyFile, path.join(DIR, 'no-such-body.json')));
  check('missing body file -> body-file-unreadable', blocked(r, 'body file named by -BodyFile'), 'err=' + r.err.slice(0, 160));
}
{
  // The GEN-58 REST append exemption, over slots.
  const r = sh('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + SCRIPT +
    '" -Method PATCH -Url "https://api.notion.com/v1/blocks/' + GEN58 + '/children" -BodyFile "' + bodyFile + '"');
  check('canonical GEN-58 append is exempt', fellThrough(r), 'code=' + r.code + ' err=' + r.err.slice(0, 160));
}
{
  const r = sh('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + SCRIPT +
    '" -Method PATCH -Url "https://api.notion.com/v1/blocks/' + GEN58 + '/children" -BodyFile "' + badBodyFile + '"');
  check('GEN-58 append with an `archived` KEY is not exempt', r.code === 2, 'code=' + r.code);
}
{
  const r = sh('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + SCRIPT +
    '" -Method PATCH -Url "https://api.notion.com/v1/blocks/' + PAGE + '/children" -BodyFile "' + bodyFile + '"');
  check('append to a NON-exempt page is gated', r.code === 2 && r.err.indexOf('no usable ticket review record') !== -1, 'err=' + r.err.slice(0, 160));
}

console.log('\n== C. the raw-REST surface, branch B (the three refusal classes) ==');
{
  const r = sh('curl.exe -sk -X PATCH "https://api.notion.com/v1/pages/' + PAGE + '" --data-binary "@' + bodyFile + '"');
  check('class 1: a direct write -> rest-not-via-script', blocked(r, 'Reissue it as the canonical invocation'), 'err=' + r.err.slice(0, 200));
}
{
  const r = sh('curl.exe -sk -X PATCH "https://api.notion.com/v1/comments" --data-binary "@' + bodyFile + '"');
  check('class 2: an inexpressible URL -> rest-template-cannot-express', blocked(r, 'over-gating signal'), 'err=' + r.err.slice(0, 200));
}
{
  const r = sh("curl.exe -sk \"https://api.notion.com/v1/blocks/" + PAGE + "/children\" | tr -d '\\r'");
  check("class 3: a read tripping `tr -d` -> rest-signal-no-target", blocked(r, 'long-form flag'), 'err=' + r.err.slice(0, 200));
}
{
  const r = sh('curl.exe -sk "https://api.notion.com/v1/pages/' + PAGE + '"');
  check('a plain GET read is untouched', r.code === 0 && r.err === '', 'code=' + r.code + ' err=' + r.err.slice(0, 160));
}
{
  const r = sh('curl.exe -sk -X POST "https://api.notion.com/v1/databases/' + PAGE + "/query\" --data-binary '{}'");
  check('a /query POST read is untouched (read allow-list)', r.code === 0 && r.err === '', 'code=' + r.code + ' err=' + r.err.slice(0, 160));
}
{
  // The native-call widening, and its hard/soft split: a native PATCH is HARD (bypasses the
  // read allow-list); a native POST to a /query path is SOFT and must NOT hard-block.
  const r1 = sh('node -e "fetch(\'https://api.notion.com/v1/pages/' + PAGE + '\',{method:\'PATCH\'})"');
  check('native PATCH is detected (hard)', r1.code === 2, 'code=' + r1.code);
  const r2 = sh('node -e "fetch(\'https://api.notion.com/v1/databases/' + PAGE + '/query\',{method:\'POST\'})"');
  check('native POST to /query is NOT hard-blocked (the split)', r2.code === 0 && r2.err === '', 'code=' + r2.code + ' err=' + r2.err.slice(0, 160));
}
{
  // A non-Notion command must be completely unaffected.
  const r = sh('curl.exe -sk -X POST "https://example.com/v1/pages" --data-binary "@' + bodyFile + '"');
  check('a non-Notion write is untouched', r.err.indexOf('ticket-quality gate') === -1, 'err=' + r.err.slice(0, 160));
}

console.log('\n== D. the pin ==');
{
  const saved = fs.readFileSync(SCRIPT);
  fs.writeFileSync(SCRIPT, Buffer.concat([saved, Buffer.from('\n# tampered\n')]));
  const r = sh(canonical);
  fs.writeFileSync(SCRIPT, saved);
  check('a modified script -> rest-script-mismatch', blocked(r, 'does NOT match the hash pinned'), 'err=' + r.err.slice(0, 200));
}
{
  const saved = fs.readFileSync(SCRIPT);
  fs.writeFileSync(SCRIPT, saved.toString('utf8').replace(/\n/g, '\r\n'), 'utf8');
  const r = sh(canonical);
  fs.writeFileSync(SCRIPT, saved);
  check('CRLF normalisation breaks the pin (disclosed fragility, fail-CLOSED)', blocked(r, 'does NOT match the hash pinned'), 'err=' + r.err.slice(0, 160));
}

console.log('\n== E. the shell hash CLI ==');
{
  const c = path.join(DIR, 'test-cmd.txt');
  fs.writeFileSync(c, canonical, 'utf8');
  const r = cli(['--ticket-hash-shell', c]);
  check('--ticket-hash-shell prints a 64-hex digest', r.code === 0 && /^[0-9a-f]{64}$/.test(r.out.trim()), 'code=' + r.code + ' out=' + r.out.slice(0, 80) + ' err=' + r.err.slice(0, 160));

  fs.writeFileSync(c, '$r = ' + canonical, 'utf8');
  const r2 = cli(['--ticket-hash-shell', c]);
  check('--ticket-hash-shell REFUSES a non-canonical command (exit 3, no stdout)',
        r2.code === 3 && r2.out.trim() === '', 'code=' + r2.code + ' out=' + r2.out.slice(0, 80));
}

console.log('\n== G. the REST record path ==');
{
  const sessionDir = path.join(DIR, 'sess');
  const subs = path.join(sessionDir, 'subagents');
  fs.mkdirSync(subs, { recursive: true });
  const passDir = PASS_DIR;
  fs.mkdirSync(passDir, { recursive: true });
  const c = path.join(DIR, 'test-cmd.txt');
  fs.writeFileSync(c, canonical, 'utf8');
  const hash = cli(['--ticket-hash-shell', c]).out.trim();
  const agentId = 'b1234567890abcdef';
  fs.writeFileSync(path.join(subs, 'agent-' + agentId + '.meta.json'), JSON.stringify({ agentType: 'check-reviewer' }), 'utf8');
  fs.writeFileSync(path.join(subs, 'agent-' + agentId + '.jsonl'),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'TICKET-REVIEW-VERDICT: PASS ' + hash }] } }) + '\n', 'utf8');
  fs.writeFileSync(path.join(passDir, 'rest.json'), JSON.stringify({
    kind: 'ticket', surface: 'notion-rest', contentHash: hash, reviewerAgentId: agentId,
    verdict: 'PASS', waived: false, target: 'rest', expires: new Date(Date.now() + 9e5).toISOString()
  }), 'utf8');
  const r = run({ tool_name: 'Bash', tool_input: { command: canonical }, cwd: DIR, transcript_path: sessionDir + '.jsonl' });
  check('a REST record minted from the CLI clears the arm', r.code === 0 && r.out.indexOf('review record consumed') !== -1,
        'code=' + r.code + ' out=' + r.out.slice(0, 200) + ' err=' + r.err.slice(0, 200));

  // The two surfaces must not cross-match: same three slots, different surface tag in the hash input.
  const p = path.join(DIR, 'test-payload.json');
  fs.writeFileSync(p, JSON.stringify({ page_id: PAGE, command: 'update_content', old_str: 'a', new_str: 'b' }), 'utf8');
  check('MCP and REST hashes differ for the same target', cli(['--ticket-hash', p, '--tool', 'update']).out.trim() !== hash, 'collision');
}

H.removeScriptCopy();
H.cleanup();

const total = state.pass + state.fail;
console.log('\nPARKED (piece 2): ' + state.pass + ' passed, ' + state.fail + ' failed of ' + total +
            ' -- baseline is ' + EXPECTED_FAILURES + ' expected failures while §4.5 is unwired.');
if (state.fail === EXPECTED_FAILURES) {
  console.log('OK: the deferral is exactly as wide as recorded. Nothing to do.\n');
  process.exit(0);
}
if (state.fail < EXPECTED_FAILURES) {
  console.log('CHANGED: FEWER failures than the baseline -- part of §4.5 is wired again. Fix the three\n' +
              'items in its NOT WIRED banner, move these assertions back into test-gen508-v8-arm.js,\n' +
              'and delete this file. Do not lower the baseline.\n');
} else {
  console.log('CHANGED: MORE failures than the baseline -- something beyond the deferral is broken.\n' +
              'These failed: ' + state.failed.join('; ') + '\n');
}
process.exit(1);
