// Behavioural suite for the GEN-508 v8 arm as it will be INSTALLED -- piece 1a, the Notion MCP
// surface only. Runs the hook as a REAL PreToolUse process (JSON on stdin, decision on
// stdout/stderr, exit code as the verdict) rather than importing functions, so what is tested is
// what will run.
//
// THIS SUITE MUST BE GREEN. It is the one that gates the install.
//
// The raw REST/curl assertions that used to live here moved to test-gen508-rest-parked.js on
// 2026-08-05, when Erez chose to install the MCP surface first and defer the REST arm to piece 2.
// They are not deleted and they are not skipped in place: they assert real behaviour of code that is
// still in the hook but no longer wired, so they belong in a file whose failures mean "still
// parked", not "regression". A suite that is permanently 19-red stops being read, and then a real
// failure hides in the noise.
const H = require('./test-gen508-harness.js');
const fs = require('fs');
const path = require('path');

const { mcp, cli, run, blocked, fellThrough, MCP, TT_DS, GEN58, PAGE, PASS_DIR, DIR } = H;
const { check, state } = H.newChecker();

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

console.log('\n== B. piece-1a scope: the REST arm is UNWIRED ==');
{
  // The deferral is asserted, not assumed. A shell command that would have been the canonical REST
  // invocation must now be none of this arm's business -- if this starts blocking, someone rewired
  // the arm without moving test-gen508-rest-parked.js back.
  const r = H.sh('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + H.SCRIPT +
    '" -Method PATCH -Url "https://api.notion.com/v1/pages/' + PAGE + '" -BodyFile "NONE"');
  check('a canonical REST invocation is untouched (arm unwired)', fellThrough(r), 'code=' + r.code + ' err=' + r.err.slice(0, 160));
}
{
  // The same for a bare direct write: detection is part of the parked arm.
  const r = H.sh('curl.exe -sk -X PATCH "https://api.notion.com/v1/pages/' + PAGE + '" --data-raw "{}"');
  check('a direct REST write is untouched (arm unwired)', fellThrough(r), 'code=' + r.code + ' err=' + r.err.slice(0, 160));
}
{
  // --ticket-hash-shell must not hand back a hash for a surface this build does not gate: a record
  // minted from it would bind a review to a write nothing checks.
  const c = path.join(DIR, 'test-cmd.txt');
  fs.writeFileSync(c, 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + H.SCRIPT +
    '" -Method PATCH -Url "https://api.notion.com/v1/pages/' + PAGE + '" -BodyFile "NONE"', 'utf8');
  const r = cli(['--ticket-hash-shell', c]);
  check('--ticket-hash-shell prints no hash (undispatched)', !/^[0-9a-f]{64}$/.test(r.out.trim()), 'out=' + r.out.slice(0, 80));
}

console.log('\n== C. the MCP hash CLI ==');
{
  const p = path.join(DIR, 'test-payload.json');
  fs.writeFileSync(p, JSON.stringify({ page_id: PAGE, command: 'update_content', old_str: 'a', new_str: 'b' }), 'utf8');
  const r = cli(['--ticket-hash', p]);
  check('--ticket-hash prints a 64-hex digest', r.code === 0 && /^[0-9a-f]{64}$/.test(r.out.trim()), 'code=' + r.code + ' out=' + r.out.slice(0, 80));

  // The envelope and the plain form MUST hash identically -- this is what the hoist buys.
  const p2 = path.join(DIR, 'test-payload-env.json');
  fs.writeFileSync(p2, JSON.stringify({ data: JSON.stringify({ page_id: PAGE, command: 'update_content', old_str: 'a', new_str: 'b' }) }), 'utf8');
  const r2 = cli(['--ticket-hash', p2]);
  check('enveloped and plain forms hash identically', r.out.trim() === r2.out.trim(), r.out.trim() + ' vs ' + r2.out.trim());
}

console.log('\n== D. the record path end to end ==');
{
  // Build a real record + a real reviewer transcript, and prove the gate consumes it -- then prove a
  // REVISE token does NOT clear it, which is the defect where `verdict` was read by nothing.
  //
  // This section is also the acceptance test for the /vet-ticket record FORMAT: the object built in
  // writeRecord() below is exactly what the skill's Step 5 tells you to mint. If the two ever drift,
  // every ticket write hard-blocks with break-glass as the only route -- which is what happened
  // between the v8 rebuild and 2026-08-05, when the skill still documented a nested targets[] array.
  const sessionDir = path.join(DIR, 'sess');
  const subs = path.join(sessionDir, 'subagents');
  fs.mkdirSync(subs, { recursive: true });
  const passDir = PASS_DIR;
  fs.mkdirSync(passDir, { recursive: true });

  const p = path.join(DIR, 'test-payload.json');
  fs.writeFileSync(p, JSON.stringify({ page_id: PAGE, command: 'update_content', old_str: 'a', new_str: 'b' }), 'utf8');
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
    return run({ tool_name: MCP + 'notion-update-page', tool_input: ti, cwd: DIR,
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

  // A nested contentHash is the shape the skill used to document. It must NOT match -- this is the
  // regression guard for the defect the 2026-08-05 review found.
  fs.writeFileSync(path.join(passDir, 'rec.json'), JSON.stringify({
    kind: 'ticket', surface: 'notion', targets: [{ target: 'page ' + PAGE, contentHash: hash }],
    expires: new Date(Date.now() + 15 * 60 * 1000).toISOString()
  }), 'utf8');
  const rNested = callWith();
  check('a nested targets[] record does NOT match (the v7 skill shape)',
        blocked(rNested, 'no usable ticket review record'), 'code=' + rNested.code + ' err=' + rNested.err.slice(0, 160));
}

console.log('\n== E. latency ==');
{
  const big = { page_id: PAGE, command: 'update_content', old_str: 'a', new_str: 'x'.repeat(200000) };
  const t0 = Date.now();
  mcp('notion-update-page', big);
  const ms = Date.now() - t0;
  // The 250 ms budget is on the ARM, not on process start-up; a spawn is ~40-80 ms here, so this is a
  // ceiling check rather than the real assertion (which belongs in the rebuilt suite).
  check('a 200 KB payload completes well inside the process budget (' + ms + ' ms)', ms < 2000, ms + ' ms');
}

H.cleanup();
console.log('\n' + (state.fail === 0 ? 'ALL PASS' : 'FAILURES') + ': ' + state.pass + ' passed, ' + state.fail + ' failed\n');
process.exit(state.fail === 0 ? 0 : 1);
