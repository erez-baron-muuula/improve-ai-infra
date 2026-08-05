// Behavioural suite for the rebuilt GEN-508 v8 arm. Runs the hook as a REAL PreToolUse process --
// JSON on stdin, decision on stdout/stderr, exit code as the verdict -- rather than importing
// functions, so what is tested is what will run.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HOOK = path.join(__dirname, 'working-v8.js');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'notion-rest-write.ps1');
const MCP = 'mcp__46ff9446-421e-4358-809c-6b8b01e661b2__';
const TT_DS = 'bd2cd17b-f58f-4993-8b95-468e881272fa';
const GEN58 = '36d6e495d07c816e9e0cce265d694ab3';
const PAGE = '3a36e495d07c81fb9a55ddc315639c7f';

const bodyFile = path.join(__dirname, 'test-body.json');
fs.writeFileSync(bodyFile, JSON.stringify({ children: [{ paragraph: { rich_text: [] } }] }), 'utf8');
const badBodyFile = path.join(__dirname, 'test-body-archived.json');
fs.writeFileSync(badBodyFile, JSON.stringify({ archived: true }), 'utf8');

function run(input) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), encoding: 'utf8' });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
function mcp(tool, ti) { return run({ tool_name: MCP + tool, tool_input: ti, cwd: __dirname, transcript_path: path.join(__dirname, 'nope.jsonl') }); }
function sh(cmd) { return run({ tool_name: 'Bash', tool_input: { command: cmd }, cwd: __dirname, transcript_path: path.join(__dirname, 'nope.jsonl') }); }
function cli(args) {
  const r = spawnSync(process.execPath, [HOOK].concat(args), { encoding: 'utf8', input: '' });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  <- ' + detail : '')); }
}
function blocked(r, reason) { return r.code === 2 && r.err.indexOf(reason) !== -1; }
// "Fell through" = the arm did not act. A deferral prints no decision at all, so the test is exit 0
// with no gate refusal on stderr -- NOT the presence of a permissionDecision, which only an APPROVE
// emits.
function fellThrough(r) { return r.code === 0 && r.err.indexOf('ticket-quality gate') === -1; }
// The hook derives STAGING_DIR as <hookdir>/../../.claude-staging, so with the hook running from the
// scratchpad the records live two levels up, not one. Getting this wrong made every record test read
// as "no record" on the first run.
const PASS_DIR = path.join(__dirname, '..', '..', '.claude-staging', 'ticket-passes');

const canonical = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + SCRIPT +
  '" -Method PATCH -Url "https://api.notion.com/v1/pages/' + PAGE + '" -BodyFile "' + bodyFile + '"';

console.log('\n== A. the MCP surface ==');
{
  // Housekeeping-only: five fields, nothing else. Must fall through untouched.
  const r = mcp('notion-update-page', { page_id: PAGE, command: 'update_properties', properties: { Status: 'Done', Assignee: null } });
  check('housekeeping-only Status+Assignee falls through', fellThrough(r), 'code=' + r.code + ' err=' + r.err.slice(0, 120));
}
{
  // Parent item is SUBSTANCE under v8 (it was housekeeping in the old ten-field list).
  const r = mcp('notion-update-page', { page_id: PAGE, command: 'update_properties', properties: { 'Parent item': 'https://x/' + PAGE } });
  check('Parent item is now gated (was exempt in v7)', blocked(r, 'no usable ticket review record'), 'code=' + r.code);
}
{
  // Due Date / ID were also dropped from the exemption.
  const r = mcp('notion-update-page', { page_id: PAGE, command: 'update_properties', properties: { 'date:Due Date:start': '2026-09-01' } });
  check('Due Date is now gated', r.code === 2, 'code=' + r.code);
}
{
  // A create carrying the Team-Tasks marker, nested two levels down and inside an envelope.
  const r = mcp('notion-create-pages', { data: JSON.stringify({ pages: [{ parent: { data_source_id: TT_DS }, properties: { Name: 'x' } }] }) });
  check('enveloped + nested create is caught by the marker scan', blocked(r, 'no usable ticket review record'), 'code=' + r.code);
}
{
  // Body edit on an arbitrary page: every page is a ticket, no network call.
  const r = mcp('notion-update-page', { page_id: PAGE, command: 'update_content', old_str: 'a', new_str: 'b' });
  check('body edit on any page is gated with no network call', r.code === 2, 'code=' + r.code);
}
{
  // A truncated uuid is a malformed target, not an absent one.
  const r = mcp('notion-update-page', { page_id: '3a36e495d07c81fb9a55ddc3156', command: 'update_content', old_str: 'a', new_str: 'b' });
  check('truncated id -> bad-target', blocked(r, 'target is unreadable'), 'err=' + r.err.slice(0, 160));
}
{
  // The GEN-58 subtree carve-out, keyed on the hardcoded page id.
  const r = mcp('notion-update-page', { page_id: GEN58, command: 'update_content', old_str: 'a', new_str: 'b' });
  check('GEN-58 content write is exempt', fellThrough(r), 'code=' + r.code + ' err=' + r.err.slice(0, 120));
}
{
  // ...but NOT with a destructive key present.
  const r = mcp('notion-update-page', { page_id: GEN58, command: 'update_content', old_str: 'a', new_str: 'b', allow_deleting_content: true });
  check('GEN-58 + allow_deleting_content is NOT exempt', r.code === 2, 'code=' + r.code);
}
{
  // ...nor with an empty new_str (the one clause that costs a real write).
  const r = mcp('notion-update-page', { page_id: GEN58, command: 'update_content', old_str: 'a', new_str: '   ' });
  check('GEN-58 + whitespace-only new_str is NOT exempt', r.code === 2, 'code=' + r.code);
}
{
  // replace_content is not one of the four content commands.
  const r = mcp('notion-update-page', { page_id: GEN58, command: 'replace_content', new_str: 'x' });
  check('GEN-58 + replace_content is NOT exempt', r.code === 2, 'code=' + r.code);
}
{
  // A payload we cannot read end to end must block, with a hash a record could still match.
  const r = mcp('notion-update-page', { data: '{"page_id": "unterminated' });
  check('unparsable envelope -> unreadable-payload', blocked(r, 'could not be read end to end'), 'err=' + r.err.slice(0, 160));
}

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
  const r = sh(canonical.replace(bodyFile, path.join(__dirname, 'no-such-body.json')));
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

console.log('\n== E. the hash CLIs ==');
{
  const p = path.join(__dirname, 'test-payload.json');
  fs.writeFileSync(p, JSON.stringify({ page_id: PAGE, command: 'update_content', old_str: 'a', new_str: 'b' }), 'utf8');
  const r = cli(['--ticket-hash', p]);
  check('--ticket-hash prints a 64-hex digest', r.code === 0 && /^[0-9a-f]{64}$/.test(r.out.trim()), 'code=' + r.code + ' out=' + r.out.slice(0, 80));

  // The envelope and the plain form MUST hash identically -- this is what the hoist buys.
  const p2 = path.join(__dirname, 'test-payload-env.json');
  fs.writeFileSync(p2, JSON.stringify({ data: JSON.stringify({ page_id: PAGE, command: 'update_content', old_str: 'a', new_str: 'b' }) }), 'utf8');
  const r2 = cli(['--ticket-hash', p2]);
  check('enveloped and plain forms hash identically', r.out.trim() === r2.out.trim(), r.out.trim() + ' vs ' + r2.out.trim());
}
{
  const c = path.join(__dirname, 'test-cmd.txt');
  fs.writeFileSync(c, canonical, 'utf8');
  const r = cli(['--ticket-hash-shell', c]);
  check('--ticket-hash-shell prints a 64-hex digest', r.code === 0 && /^[0-9a-f]{64}$/.test(r.out.trim()), 'code=' + r.code + ' out=' + r.out.slice(0, 80) + ' err=' + r.err.slice(0, 160));

  fs.writeFileSync(c, '$r = ' + canonical, 'utf8');
  const r2 = cli(['--ticket-hash-shell', c]);
  check('--ticket-hash-shell REFUSES a non-canonical command (exit 3, no stdout)',
        r2.code === 3 && r2.out.trim() === '', 'code=' + r2.code + ' out=' + r2.out.slice(0, 80));
}

console.log('\n== F. the record path end to end ==');
{
  // Build a real record + a real reviewer transcript, and prove the gate consumes it -- then prove a
  // REVISE token does NOT clear it, which is the defect where `verdict` was read by nothing.
  const sessionDir = path.join(__dirname, 'sess');
  const subs = path.join(sessionDir, 'subagents');
  fs.mkdirSync(subs, { recursive: true });
  const passDir = PASS_DIR;
  fs.mkdirSync(passDir, { recursive: true });

  const p = path.join(__dirname, 'test-payload.json');
  const hash = cli(['--ticket-hash', p]).out.trim();
  const agentId = 'a1234567890abcdef';

  function writeTranscript(verdict) {
    fs.writeFileSync(path.join(subs, 'agent-' + agentId + '.meta.json'),
      JSON.stringify({ agentType: 'check-reviewer', model: 'sonnet' }), 'utf8');
    fs.writeFileSync(path.join(subs, 'agent-' + agentId + '.jsonl'),
      // line 1 is the USER prompt and contains the PASS form -- the exact trap a flat substring
      // search falls into.
      JSON.stringify({ type: 'user', message: { content: 'end with TICKET-REVIEW-VERDICT: PASS <hash>' } }) + '\n' +
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'TICKET-REVIEW-VERDICT: ' + verdict + ' ' + hash }] } }) + '\n',
      'utf8');
  }
  function writeRecord(over) {
    const f = path.join(passDir, 'rec.json');
    fs.writeFileSync(f, JSON.stringify(Object.assign({
      kind: 'ticket', surface: 'notion-mcp', contentHash: hash, reviewerAgentId: agentId,
      verdict: 'PASS', waived: false, target: 'page ' + PAGE,
      expires: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    }, over || {})), 'utf8');
    return f;
  }
  const ti = { page_id: PAGE, command: 'update_content', old_str: 'a', new_str: 'b' };
  function callWith() {
    return run({ tool_name: MCP + 'notion-update-page', tool_input: ti, cwd: __dirname,
                 transcript_path: sessionDir + '.jsonl' });
  }

  writeTranscript('PASS'); const f1 = writeRecord();
  const rOk = callWith();
  check('a valid record + PASS token APPROVES', rOk.code === 0 && rOk.out.indexOf('review record consumed') !== -1,
        'code=' + rOk.code + ' out=' + rOk.out.slice(0, 200) + ' err=' + rOk.err.slice(0, 200));
  check('the record was consumed (single use)', !fs.existsSync(f1), 'still present');

  // Single use means the NEXT identical write, with no fresh record, must be refused.
  const rReplay = callWith();
  check('replaying the same write with no fresh record is refused',
        blocked(rReplay, 'no usable ticket review record'), 'code=' + rReplay.code);

  writeTranscript('REVISE'); writeRecord();
  const rRevise = callWith();
  check('a REVISE token does NOT clear the gate', blocked(rRevise, 'does not END on'), 'code=' + rRevise.code + ' err=' + rRevise.err.slice(0, 200));

  writeTranscript('PASS'); writeRecord({ verdict: 'REVISE' });
  const rBadVerdict = callWith();
  check('verdict REVISE in the record is read (bad-verdict)', blocked(rBadVerdict, 'verdict is not PASS'), 'err=' + rBadVerdict.err.slice(0, 200));

  writeTranscript('PASS'); writeRecord({ reviewerAgentId: 'aunrelated0000000' });
  const rUnrelated = callWith();
  check('an unrelated reviewer id is refused', blocked(rUnrelated, 'sidecar is missing'), 'err=' + rUnrelated.err.slice(0, 200));

  writeTranscript('PASS');
  fs.writeFileSync(path.join(subs, 'agent-' + agentId + '.meta.json'), JSON.stringify({ agentType: 'general-purpose' }), 'utf8');
  writeRecord();
  const rWrongType = callWith();
  check('a non-check-reviewer agentType is refused', blocked(rWrongType, 'not check-reviewer'), 'err=' + rWrongType.err.slice(0, 200));

  writeTranscript('PASS'); writeRecord({ contentHash: 'f'.repeat(64) });
  const rStale = callWith();
  check('a record for a different hash does not match', rStale.code === 2, 'code=' + rStale.code);

  writeTranscript('PASS'); writeRecord({ waived: true, verdict: 'REVISE' });
  const rWaived = callWith();
  check('a waived record clears without a token', rWaived.code === 0 && rWaived.out.indexOf('review record consumed') !== -1,
        'code=' + rWaived.code + ' err=' + rWaived.err.slice(0, 200));
}

console.log('\n== G. the REST record path ==');
{
  const sessionDir = path.join(__dirname, 'sess');
  const subs = path.join(sessionDir, 'subagents');
  const passDir = PASS_DIR;
  const c = path.join(__dirname, 'test-cmd.txt');
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
  const r = run({ tool_name: 'Bash', tool_input: { command: canonical }, cwd: __dirname, transcript_path: sessionDir + '.jsonl' });
  check('a REST record minted from the CLI clears the arm', r.code === 0 && r.out.indexOf('review record consumed') !== -1,
        'code=' + r.code + ' out=' + r.out.slice(0, 200) + ' err=' + r.err.slice(0, 200));

  // The two surfaces must not cross-match: same three slots, different surface tag in the hash input.
  const p = path.join(__dirname, 'test-payload.json');
  check('MCP and REST hashes differ for the same target', cli(['--ticket-hash', p]).out.trim() !== hash, 'collision');
}

console.log('\n== H. latency ==');
{
  const big = { page_id: PAGE, command: 'update_content', old_str: 'a', new_str: 'x'.repeat(200000) };
  const t0 = Date.now();
  mcp('notion-update-page', big);
  const ms = Date.now() - t0;
  // The 250 ms budget is on the ARM, not on process start-up; a spawn is ~40-80 ms here, so this is a
  // ceiling check rather than the real assertion (which belongs in the rebuilt suite).
  check('a 200 KB payload completes well inside the process budget (' + ms + ' ms)', ms < 2000, ms + ' ms');
}

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILURES') + ': ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail === 0 ? 0 : 1);
