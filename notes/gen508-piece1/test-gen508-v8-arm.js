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

const { mcp, cli, run, blocked, approved, fellThrough, ticketBlockReason, MCP, TT_DS, GEN58, PAGE, PASS_DIR, DIR } = H;
const { check, expectPending, state } = H.newChecker();

console.log('\n== A. the MCP surface ==');
{
  // Housekeeping-only: five fields, nothing else. Must fall through untouched.
  const r = mcp('notion-update-page', { page_id: PAGE, command: 'update_properties', properties: { Status: 'Done', Assignee: null } });
  check('housekeeping-only Status+Assignee falls through', fellThrough(r), 'code=' + r.code + ' err=' + r.err.slice(0, 120));
}
{
  // Parent item is SUBSTANCE under v8 (it was housekeeping in the old ten-field list).
  const r = mcp('notion-update-page', { page_id: PAGE, command: 'update_properties', properties: { 'Parent item': 'https://x/' + PAGE } });
  check('Parent item is now gated (was exempt in v7)', ticketBlockReason(r) === 'no-pass', 'reason=' + ticketBlockReason(r) + ' code=' + r.code);
}
{
  // Due Date / ID were also dropped from the exemption.
  const r = mcp('notion-update-page', { page_id: PAGE, command: 'update_properties', properties: { 'date:Due Date:start': '2026-09-01' } });
  check('Due Date is now gated', ticketBlockReason(r) === 'no-pass', 'reason=' + ticketBlockReason(r) + ' code=' + r.code);
}
{
  // A create carrying the Team-Tasks marker, nested two levels down and inside an envelope.
  const r = mcp('notion-create-pages', { data: JSON.stringify({ pages: [{ parent: { data_source_id: TT_DS }, properties: { Name: 'x' } }] }) });
  check('enveloped + nested create is caught by the marker scan', ticketBlockReason(r) === 'no-pass', 'reason=' + ticketBlockReason(r) + ' code=' + r.code);
}
{
  // Body edit on an arbitrary page: every page is a ticket, no network call.
  const r = mcp('notion-update-page', { page_id: PAGE, command: 'update_content', content_updates: [{ old_str: 'a', new_str: 'b' }] });
  check('body edit on any page is gated with no network call', ticketBlockReason(r) === 'no-pass', 'reason=' + ticketBlockReason(r) + ' code=' + r.code);
}
{
  // A truncated uuid is a malformed target, not an absent one.
  const r = mcp('notion-update-page', { page_id: '3a36e495d07c81fb9a55ddc3156', command: 'update_content', old_str: 'a', new_str: 'b' });
  check('truncated id -> bad-target', blocked(r, 'target is unreadable'), 'err=' + r.err.slice(0, 160));
}
{
  // The GEN-58 subtree carve-out, keyed on the hardcoded page id, IN THE SHAPE THE TOOL ACTUALLY
  // SENDS. Until 2026-08-05 this assertion used `{command:'update_content', old_str, new_str}` at the
  // root -- a shape the live notion-update-page schema cannot produce, since update_content carries
  // its edits in `content_updates[]` and root new_str belongs to replace_content alone. So the suite
  // was green on a fictional payload while every real GEN-58 log edit hard-blocked, which is how the
  // defect survived two review rounds. An assertion over a payload the tool cannot send is worse than
  // no assertion at all: it reports coverage it does not have.
  const r = mcp('notion-update-page', { page_id: GEN58, command: 'update_content',
                                        content_updates: [{ old_str: 'a', new_str: 'b' }] });
  check('GEN-58 content write is exempt (real content_updates[] shape)', fellThrough(r),
        'code=' + r.code + ' err=' + r.err.slice(0, 160));
}
{
  // ...but NOT with a destructive key present.
  const r = mcp('notion-update-page', { page_id: GEN58, command: 'update_content',
                                        content_updates: [{ old_str: 'a', new_str: 'b' }],
                                        allow_deleting_content: true });
  check('GEN-58 + allow_deleting_content is NOT exempt', ticketBlockReason(r) === 'no-pass', 'reason=' + ticketBlockReason(r) + ' code=' + r.code);
}
{
  // ...nor with an empty new_str (the one clause that costs a real write). NESTED, which is the only
  // place a real one can appear -- and the whole reason clause 4 had to become a recursive walk.
  const r = mcp('notion-update-page', { page_id: GEN58, command: 'update_content',
                                        content_updates: [{ old_str: 'a', new_str: '   ' }] });
  check('GEN-58 + whitespace-only nested new_str is NOT exempt', ticketBlockReason(r) === 'no-pass', 'reason=' + ticketBlockReason(r) + ' code=' + r.code);
}
{
  // replace_content is not one of the four content commands.
  const r = mcp('notion-update-page', { page_id: GEN58, command: 'replace_content', new_str: 'x' });
  check('GEN-58 + replace_content is NOT exempt', ticketBlockReason(r) === 'no-pass', 'reason=' + ticketBlockReason(r) + ' code=' + r.code);
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
  fs.writeFileSync(p, JSON.stringify({ page_id: PAGE, command: 'update_content', content_updates: [{ old_str: 'a', new_str: 'b' }] }), 'utf8');
  const r = cli(['--ticket-hash', p, '--tool', 'update']);
  check('--ticket-hash prints a 64-hex digest', r.code === 0 && /^[0-9a-f]{64}$/.test(r.out.trim()), 'code=' + r.code + ' out=' + r.out.slice(0, 80));

  // The envelope and the plain form MUST hash identically -- this is what the hoist buys.
  const p2 = path.join(DIR, 'test-payload-env.json');
  fs.writeFileSync(p2, JSON.stringify({ data: JSON.stringify({ page_id: PAGE, command: 'update_content', content_updates: [{ old_str: 'a', new_str: 'b' }] }) }), 'utf8');
  const r2 = cli(['--ticket-hash', p2, '--tool', 'update']);
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
  fs.writeFileSync(p, JSON.stringify({ page_id: PAGE, command: 'update_content', content_updates: [{ old_str: 'a', new_str: 'b' }] }), 'utf8');
  const hash = cli(['--ticket-hash', p, '--tool', 'update']).out.trim();
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
  const ti = { page_id: PAGE, command: 'update_content', content_updates: [{ old_str: 'a', new_str: 'b' }] };
  function callWith() {
    return run({ tool_name: MCP + 'notion-update-page', tool_input: ti, cwd: DIR,
                 transcript_path: sessionDir + '.jsonl' });
  }

  writeTranscript('PASS'); const f1 = writeRecord();
  const rOk = callWith();
  check('a valid record + PASS token APPROVES', approved(rOk),
        'code=' + rOk.code + ' out=' + rOk.out.slice(0, 200) + ' err=' + rOk.err.slice(0, 200));
  check('the record was consumed (single use)', !fs.existsSync(f1), 'still present');

  // Single use means the NEXT identical write, with no fresh record, must be refused.
  const rReplay = callWith();
  check('replaying the same write with no fresh record is refused',
        ticketBlockReason(rReplay) === 'no-pass', 'reason=' + ticketBlockReason(rReplay) + ' code=' + rReplay.code);

  writeTranscript('REVISE'); writeRecord();
  const rRevise = callWith();
  check('a REVISE token does NOT clear the gate', blocked(rRevise, 'does not end on'), 'code=' + rRevise.code + ' err=' + rRevise.err.slice(0, 200));

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
  check('a record for a different hash is stale-content (a record exists for the ids, wrong hash)',
        ticketBlockReason(rStale) === 'stale-content', 'reason=' + ticketBlockReason(rStale) + ' code=' + rStale.code);

  // The waive is the ONLY path that skips reviewer verification, so this assertion must DRIVE that skip
  // rather than ride leftover fixtures. It used to call writeTranscript('PASS') first, leaving a valid
  // sidecar + PASS token on disk -- so the waive cleared over evidence that would have passed
  // verification anyway, and never exercised the bypass it is named for. Remove the reviewer evidence
  // entirely: with no sidecar and no token, an UN-waived record blocks as reviewer-unverified (the
  // unrelated-id and wrong-agentType cases above prove that), so a waived record clearing here can only
  // be the verification-skip actually firing.
  fs.rmSync(path.join(subs, 'agent-' + agentId + '.jsonl'), { force: true });
  fs.rmSync(path.join(subs, 'agent-' + agentId + '.meta.json'), { force: true });
  writeRecord({ waived: true, verdict: 'REVISE' });
  const rWaived = callWith();
  check('a waived record clears with NO sidecar and NO token present (the real bypass)', approved(rWaived),
        'code=' + rWaived.code + ' err=' + rWaived.err.slice(0, 200));

  // A nested contentHash is the shape the skill used to document. It must NOT match -- this is the
  // regression guard for the defect the 2026-08-05 review found.
  fs.writeFileSync(path.join(passDir, 'rec.json'), JSON.stringify({
    kind: 'ticket', surface: 'notion', targets: [{ target: 'page ' + PAGE, contentHash: hash }],
    expires: new Date(Date.now() + 15 * 60 * 1000).toISOString()
  }), 'utf8');
  const rNested = callWith();
  check('a nested targets[] record does NOT match (the v7 skill shape)',
        ticketBlockReason(rNested) === 'no-pass', 'reason=' + ticketBlockReason(rNested) + ' code=' + rNested.code + ' err=' + rNested.err.slice(0, 160));

  // Regression guard for the fail-open the SECOND code review found (2026-08-05). A pass file whose
  // entire content is the literal `null` parses without throwing -- `null` IS valid JSON -- so the
  // reader's own try/catch never fires, and `pass.expires` then threw a TypeError that nothing on
  // that path caught. An uncaught throw exits non-2, which is NOT a refusal: the gated write went
  // through, and kept going through on every gated call until the file was deleted by hand.
  // Confirmed live before the fix (exit 1, no refusal on stderr) and after (refusal restored).
  //
  // The five values below are every JSON scalar/shape that survives JSON.parse but is not a usable
  // record. Only `null` ever threw; the rest are here so a future "simplify" of the guard cannot
  // narrow it back to a null-only check and silently reopen the others.
  //
  // This guard is worth more than its own gate: the reader it protects (findPassInDir) is shared with
  // the staging, vetting and check-due pass dirs, so the same fail-open was live in three ALREADY
  // INSTALLED gates -- including the one guarding this hook's own code.
  for (const junk of ['null', '[]', '0', 'false', '"str"']) {
    fs.writeFileSync(path.join(passDir, 'rec.json'), junk, 'utf8');
    const rJunk = callWith();
    check('a pass file containing ' + junk + ' refuses instead of crashing',
          ticketBlockReason(rJunk) === 'no-pass',
          'reason=' + ticketBlockReason(rJunk) + ' code=' + rJunk.code + ' err=' + rJunk.err.slice(0, 120));
  }
  fs.rmSync(path.join(passDir, 'rec.json'), { force: true });

  // Regression guard for a LOCKOUT the second review's own first fix introduced. That fix re-asserted
  // the hash after the record's second read using a bare `rec.contentHash !== sc.hash` -- stricter than
  // ticketRecordMatches, which compares `.trim().toLowerCase()`. Since `--ticket-hash` prints the digest
  // with a trailing newline, a skill that captures stdout without stripping produces exactly the record
  // the trim exists to absorb: it matched the finder, then failed the re-assert as `bad-record`, whose
  // remedy text says re-run /vet-ticket -- which regenerates an identical record. A closed loop whose
  // only exit was break-glass. The re-assert now calls ticketRecordMatches, so it re-asserts the SAME
  // predicate. This must APPROVE.
  writeTranscript('PASS'); writeRecord({ contentHash: hash + '\n' });
  const rTrailingNl = callWith();
  check('a record whose contentHash has the CLI trailing newline still APPROVES (no lockout)',
        approved(rTrailingNl),
        'code=' + rTrailingNl.code + ' err=' + rTrailingNl.err.slice(0, 160));

  writeTranscript('PASS'); writeRecord({ contentHash: hash.toUpperCase() });
  const rUpper = callWith();
  check('an upper-case contentHash still APPROVES (matcher and re-assert agree)',
        approved(rUpper),
        'code=' + rUpper.code + ' err=' + rUpper.err.slice(0, 160));
}

console.log('\n== A2. the housekeeping exemption is TOOL-SCOPED ==');
{
  // Regression guard for a silent approve the second review found: the housekeeping exemption was not
  // tool-scoped, so notion-duplicate-page with a property-edit-shaped payload returned 'out'. A
  // duplicate SPAWNS A LIVE TICKET, so that is a create reaching Notion with no review record.
  const hkShape = { page_id: PAGE, properties: { Status: 'Done' } };

  const rDup = mcp('notion-duplicate-page', hkShape);
  check('duplicate-page with a housekeeping-shaped payload is GATED, not exempt',
        ticketBlockReason(rDup) === 'no-pass', 'reason=' + ticketBlockReason(rDup) + ' code=' + rDup.code + ' err=' + rDup.err.slice(0, 160));

  const rMove = mcp('notion-move-pages', hkShape);
  check('move-pages with a housekeeping-shaped payload is GATED, not exempt',
        ticketBlockReason(rMove) === 'no-pass', 'reason=' + ticketBlockReason(rMove) + ' code=' + rMove.code + ' err=' + rMove.err.slice(0, 160));

  const rCreate = mcp('notion-create-pages', hkShape);
  check('create-pages with a housekeeping-shaped payload is GATED, not exempt',
        ticketBlockReason(rCreate) === 'no-pass', 'reason=' + ticketBlockReason(rCreate) + ' code=' + rCreate.code + ' err=' + rCreate.err.slice(0, 160));

  // The genuine housekeeping case must still fall through -- the scoping narrowed the exemption and
  // must not have removed it. `update_properties` on Status is the case the exemption exists for.
  const rKeep = mcp('notion-update-page',
                    { page_id: PAGE, command: 'update_properties', properties: { Status: 'Done' } });
  check('update-page housekeeping STILL falls through (exemption not lost)', fellThrough(rKeep),
        'code=' + rKeep.code + ' err=' + rKeep.err.slice(0, 160));

  // NOT asserted, deliberately, so nobody reads this suite as covering it: the same review added a
  // re-check that the matched record's contentHash still equals this write's hash after the SECOND
  // read of the file (findTicketPassFile matches on its own read, then returns only a path). That
  // branch is unreachable without a concurrent rewrite of the same filename between the two reads,
  // so it cannot be driven from a single-process suite. It is defence-in-depth with no test behind
  // it -- if a future change makes the two reads diverge by any means a test CAN reach, assert it.
}

// ---------------------------------------------------------------------------------------------------
// The four sections below are the THIRD review round's regression guards (2026-08-05). Each one is a
// defect that was CONFIRMED against live code or a live schema before being fixed, not a hypothesis.
// ---------------------------------------------------------------------------------------------------

// Shared builder for the token sections: a transcript whose assistant records have exactly the block
// structure real ones do (`text`, `thinking`, `tool_use`), so the block filter is tested against the
// real schema rather than a simplification of it.
function tokenFixture(agentId, sessionDir) {
  const subs = path.join(sessionDir, 'subagents');
  fs.mkdirSync(subs, { recursive: true });
  fs.mkdirSync(PASS_DIR, { recursive: true });
  fs.writeFileSync(path.join(subs, 'agent-' + agentId + '.meta.json'),
    JSON.stringify({ agentType: 'check-reviewer', model: 'opus' }), 'utf8');
  return {
    // `recs` is an array of assistant content-block arrays, written in order. A leading user record
    // carrying the PASS form is always included: it is the original trap and must stay covered.
    write: function (recs) {
      const lines = [JSON.stringify({ type: 'user',
        message: { content: 'end with TICKET-REVIEW-VERDICT: PASS <hash>' } })];
      for (const blocks of recs) lines.push(JSON.stringify({ type: 'assistant', message: { content: blocks } }));
      fs.writeFileSync(path.join(subs, 'agent-' + agentId + '.jsonl'), lines.join('\n') + '\n', 'utf8');
    },
    writeRaw: function (lines) {
      fs.writeFileSync(path.join(subs, 'agent-' + agentId + '.jsonl'), lines.join('\n') + '\n', 'utf8');
    },
    record: function (hash, over) {
      const f = path.join(PASS_DIR, 'rec.json');
      fs.writeFileSync(f, JSON.stringify(Object.assign({
        kind: 'ticket', surface: 'notion-mcp', contentHash: hash, reviewerAgentId: agentId,
        verdict: 'PASS', waived: false, target: 'page ' + PAGE,
        expires: new Date(Date.now() + 15 * 60 * 1000).toISOString()
      }, over || {})), 'utf8');
      return f;
    }
  };
}

console.log('\n== F. the verdict token is read from DELIVERED text only ==');
{
  // CONFIRMED against real transcripts before the fix: the scan JSON.stringify'd the whole assistant
  // record with no block-type filter, so a reviewer's `thinking` blocks -- reasoning it chose NOT to
  // deliver -- counted as its verdict, as did the arguments of its own `tool_use` calls. Both are
  // reachable without any forgery: a reviewer that rehearses a PASS and then talks itself out of it,
  // or one that greps for its own token format, produces exactly these transcripts.
  const sessionDir = path.join(DIR, 'sess');
  const agentId = 'a2222222222222222';
  const fx = tokenFixture(agentId, sessionDir);

  const ti = { page_id: PAGE, command: 'update_content', content_updates: [{ old_str: 'a', new_str: 'b' }] };
  const p = path.join(DIR, 'test-payload.json');
  fs.writeFileSync(p, JSON.stringify(ti), 'utf8');
  const hash = cli(['--ticket-hash', p, '--tool', 'update']).out.trim();
  const tok = v => 'TICKET-REVIEW-VERDICT: ' + v + ' ' + hash;
  const callWith = () => run({ tool_name: MCP + 'notion-update-page', tool_input: ti, cwd: DIR,
                               transcript_path: sessionDir + '.jsonl' });

  fx.write([[{ type: 'thinking', thinking: 'I could write ' + tok('PASS') + ' here.' },
             { type: 'text', text: 'Findings below.\n\n' + tok('REVISE') }]]);
  fx.record(hash);
  let r = callWith();
  check('a PASS in a thinking block does NOT override a delivered REVISE',
        blocked(r, 'does not end on'), 'code=' + r.code + ' err=' + r.err.slice(0, 180));

  fx.write([[{ type: 'thinking', thinking: 'Verdict: ' + tok('PASS') },
             { type: 'text', text: 'Findings below. No verdict line here.' }]]);
  fx.record(hash);
  r = callWith();
  check('a PASS in a thinking block alone is NOT a verdict',
        blocked(r, 'does not end on'), 'code=' + r.code + ' err=' + r.err.slice(0, 180));

  fx.write([[{ type: 'text', text: 'Let me check the format.' },
             { type: 'tool_use', name: 'Grep', input: { pattern: tok('PASS') } }]]);
  fx.record(hash);
  r = callWith();
  check('a PASS inside a tool_use argument is NOT a verdict',
        blocked(r, 'does not end on'), 'code=' + r.code + ' err=' + r.err.slice(0, 180));

  // "Last delivered message", not "last occurrence in the file": a token in an EARLIER message is not
  // the reviewer's sign-off, which is what the refusal text and the skill both say it must be.
  fx.write([[{ type: 'text', text: 'Preliminary: ' + tok('PASS') }],
            [{ type: 'text', text: 'On reflection there are two blockers. Details above.' }]]);
  fx.record(hash);
  r = callWith();
  check('a PASS in an earlier message does not clear a final message without one',
        blocked(r, 'does not end on'), 'code=' + r.code + ' err=' + r.err.slice(0, 180));

  // The converse must still work, or the fix would have created a lockout: an early REVISE followed by
  // a final PASS is a reviewer that changed its mind, and the last DELIVERED word is the verdict.
  fx.write([[{ type: 'text', text: 'First read: ' + tok('REVISE') }],
            [{ type: 'thinking', thinking: 'the second finding was mine, not the code\'s' },
             { type: 'text', text: 'Corrected. ' + tok('PASS') }]]);
  fx.record(hash);
  r = callWith();
  check('a final delivered PASS after an earlier REVISE APPROVES',
        approved(r),
        'code=' + r.code + ' err=' + r.err.slice(0, 180));

  // Grounded in this project's own transcripts: all 14 isApiErrorMessage records carry a text block
  // (API Error 529s), so one landing after a valid verdict would shadow it under a strict
  // "final text-bearing record" rule. Harness-authored records are skipped for exactly this case.
  fx.writeRaw([
    JSON.stringify({ type: 'user', message: { content: 'brief' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done. ' + tok('PASS') }] } }),
    JSON.stringify({ type: 'assistant', isApiErrorMessage: true,
                     message: { content: [{ type: 'text', text: 'API Error: 529 Overloaded.' }] } })
  ]);
  fx.record(hash);
  r = callWith();
  check('a trailing API-error record does not shadow a valid verdict',
        approved(r),
        'code=' + r.code + ' err=' + r.err.slice(0, 180));

  // A final message may deliver several text blocks; the token in any of them is delivered output.
  fx.write([[{ type: 'text', text: 'Summary first.' },
             { type: 'thinking', thinking: 'anything here is not delivered' },
             { type: 'text', text: tok('PASS') }]]);
  fx.record(hash);
  r = callWith();
  check('a multi-text-block final message is read whole', approved(r),
        'code=' + r.code + ' err=' + r.err.slice(0, 180));

  // LAST occurrence WITHIN the final message. Without this, taking the FIRST occurrence would pass
  // every other assertion in this section -- and this is the rule that stops a reviewer which restates
  // the required format after signing off from overriding its own delivered verdict. It is also the
  // exact trap the token design was built around, so it must be asserted rather than assumed.
  fx.write([[{ type: 'text', text: 'Draft verdict: ' + tok('PASS') + '\n\nOn reflection: ' + tok('REVISE') }]]);
  fx.record(hash);
  r = callWith();
  check('within one final message the LAST occurrence wins (PASS then REVISE blocks)',
        blocked(r, 'does not end on'), 'code=' + r.code + ' err=' + r.err.slice(0, 180));

  fx.write([[{ type: 'text', text: 'Quoting the form ' + tok('REVISE') + '\n\nActual: ' + tok('PASS') }]]);
  fx.record(hash);
  r = callWith();
  check('...and REVISE then PASS approves (not first-occurrence)',
        approved(r),
        'code=' + r.code + ' err=' + r.err.slice(0, 180));

  // An empty or whitespace-only trailing record must NOT become "the final message" and shadow a real
  // verdict behind it. Real transcripts write roughly one content block per record, so a near-empty
  // trailing text record is an ordinary shape, not an exotic one. Failure direction was a false refusal
  // whose remedy was an unexplained re-review.
  fx.write([[{ type: 'text', text: 'Done. ' + tok('PASS') }],
            [{ type: 'text', text: '   \n ' }]]);
  fx.record(hash);
  r = callWith();
  check('a whitespace-only trailing record does not shadow the verdict',
        approved(r),
        'code=' + r.code + ' err=' + r.err.slice(0, 180));

  fs.rmSync(path.join(PASS_DIR, 'rec.json'), { force: true });
}

console.log('\n== G. the caller\'s transcript path resolves when the caller is a sub-agent ==');
{
  // Before the fix ticketSessionDir only stripped `.jsonl`, so a SUB-AGENT caller -- whose
  // transcript_path is `<sessionDir>/subagents/agent-<self>.jsonl` -- resolved one directory too deep.
  // Every sidecar lookup then pointed at `<...>/agent-<self>/subagents/...`, which cannot exist, so a
  // legitimately minted record was refused as `reviewer-unverified`: a block whose stated remedy could
  // not clear it. (Whether PreToolUse fires for sub-agent calls at all is a separate open question for
  // /vet-code's live verification; this asserts the path is right IF it does.)
  const sessionDir = path.join(DIR, 'sess');
  const agentId = 'a3333333333333333';
  const fx = tokenFixture(agentId, sessionDir);

  const ti = { page_id: PAGE, command: 'update_content', content_updates: [{ old_str: 'x', new_str: 'y' }] };
  const p = path.join(DIR, 'test-payload.json');
  fs.writeFileSync(p, JSON.stringify(ti), 'utf8');
  const hash = cli(['--ticket-hash', p, '--tool', 'update']).out.trim();
  fx.write([[{ type: 'text', text: 'TICKET-REVIEW-VERDICT: PASS ' + hash }]]);

  // The caller is a DIFFERENT sub-agent in the same session, so its own transcript sits beside the
  // reviewer's -- the exact layout the strip-only version could not climb out of.
  const callerPath = path.join(sessionDir, 'subagents', 'agent-a4444444444444444.jsonl');
  fx.record(hash);
  const rSub = run({ tool_name: MCP + 'notion-update-page', tool_input: ti, cwd: DIR,
                     transcript_path: callerPath });
  check('a sub-agent caller resolves the reviewer sidecar and APPROVES',
        approved(rSub),
        'code=' + rSub.code + ' err=' + rSub.err.slice(0, 200));

  // The main-session path must not have regressed: the climb fires only inside a `subagents` dir.
  fx.write([[{ type: 'text', text: 'TICKET-REVIEW-VERDICT: PASS ' + hash }]]);
  fx.record(hash);
  const rMain = run({ tool_name: MCP + 'notion-update-page', tool_input: ti, cwd: DIR,
                      transcript_path: sessionDir + '.jsonl' });
  check('the main-session transcript path still resolves',
        approved(rMain),
        'code=' + rMain.code + ' err=' + rMain.err.slice(0, 200));

  fs.rmSync(path.join(PASS_DIR, 'rec.json'), { force: true });
}

console.log('\n== H. the GEN-58 carve-out reads the shape update_content really takes ==');
{
  // Confirmed against the live notion-update-page schema AND against the working hook: every real
  // GEN-58 log edit blocked, because `content_updates` was not a permitted root key. The naive fix --
  // permit the key -- would have opened a wipe path, because the emptiness clause only inspected root
  // `new_str` and could not see the ones nested inside the array. Both halves are asserted here, and
  // the emptying cases are the reason clause 4 became a recursive walk.
  const ok = cu => mcp('notion-update-page', { page_id: GEN58, command: 'update_content', content_updates: cu });

  let r = ok([{ old_str: 'a', new_str: 'b' }, { old_str: 'c', new_str: 'd' }]);
  check('a multi-edit GEN-58 log write is exempt', fellThrough(r), 'code=' + r.code + ' err=' + r.err.slice(0, 160));

  r = ok([{ old_str: 'a', new_str: 'b', replace_all_matches: true }]);
  check('replace_all_matches is a permitted element key', fellThrough(r), 'code=' + r.code + ' err=' + r.err.slice(0, 160));

  r = ok([{ old_str: 'a 6000-char block', new_str: '' }]);
  check('an EMPTYING nested edit is NOT exempt (the wipe path the fix must not open)', ticketBlockReason(r) === 'no-pass', 'reason=' + ticketBlockReason(r) + ' code=' + r.code);

  r = ok([{ old_str: 'a', new_str: 'b' }, { old_str: 'c', new_str: '  \n ' }]);
  check('one whitespace-only edit among several is NOT exempt', ticketBlockReason(r) === 'no-pass', 'reason=' + ticketBlockReason(r) + ' code=' + r.code);

  r = ok([{ old_str: 'a', new_str: 'b', unexpected_key: 1 }]);
  check('an unrecognised element key is NOT exempt (closed shape)', ticketBlockReason(r) === 'no-pass', 'reason=' + ticketBlockReason(r) + ' code=' + r.code);

  r = ok([{ new_str: 'b' }]);
  check('an element with no old_str is NOT exempt', ticketBlockReason(r) === 'no-pass', 'reason=' + ticketBlockReason(r) + ' code=' + r.code);

  r = ok([]);
  check('an empty content_updates array is NOT exempt', ticketBlockReason(r) === 'no-pass', 'reason=' + ticketBlockReason(r) + ' code=' + r.code);

  r = mcp('notion-update-page', { page_id: GEN58, command: 'update_content', content_updates: 'nope' });
  check('a non-array content_updates is NOT exempt', ticketBlockReason(r) === 'no-pass', 'reason=' + ticketBlockReason(r) + ' code=' + r.code);

  r = mcp('notion-update-page', { page_id: GEN58, command: 'update_content', old_str: 'a', new_str: 'b' });
  check('update_content with no content_updates is NOT exempt (malformed, not exempt)', ticketBlockReason(r) === 'no-pass', 'reason=' + ticketBlockReason(r) + ' code=' + r.code);

  // insert_content is the OTHER real command, and it carries no content_updates at all -- so clause 6
  // must not demand one. This is the assertion that would have caught an over-strict fix.
  r = mcp('notion-update-page', { page_id: GEN58, command: 'insert_content', content: '## Vol. 9', position: { type: 'end' } });
  check('insert_content (real shape) is still exempt', fellThrough(r), 'code=' + r.code + ' err=' + r.err.slice(0, 160));

  // A nested new_str is checked ANYWHERE, not only under content_updates -- the walk is over the tree,
  // because naming a field path is the mistake that produced this defect in the first place.
  r = mcp('notion-update-page', { data: JSON.stringify({ page_id: GEN58, command: 'update_content',
                                                         content_updates: [{ old_str: 'a', new_str: '' }] }) });
  check('an emptying edit inside an ENVELOPE is still caught', ticketBlockReason(r) === 'no-pass', 'reason=' + ticketBlockReason(r) + ' code=' + r.code);

  // And a live ticket is still gated in the real shape: the carve-out is keyed on the page, not on the
  // payload shape, so widening the shape must not have widened the exemption.
  r = mcp('notion-update-page', { page_id: PAGE, command: 'update_content',
                                  content_updates: [{ old_str: 'a', new_str: 'b' }] });
  check('the same real shape on a LIVE ticket is still gated', ticketBlockReason(r) === 'no-pass', 'reason=' + ticketBlockReason(r) + ' code=' + r.code);
}

console.log('\n== I. the two refusal texts that named no usable fix ==');
{
  // The exempt-list-overflow message used to end "find that bug rather than trimming the list", which
  // left break-glass as the only route out of a wedged gate -- nothing prunes the list automatically,
  // so while it is over-cap EVERY in-scope write is refused. It now names the in-band fix as well.
  const exemptFile = path.join(DIR, '..', '..', '.claude-staging', 'ticket-gate-exempt-pages.txt');
  fs.mkdirSync(path.dirname(exemptFile), { recursive: true });
  const lines = [];
  for (let i = 0; i < 4200; i++) lines.push(i.toString(16).padStart(32, '0'));
  fs.writeFileSync(exemptFile, lines.join('\n'), 'utf8');

  const r = mcp('notion-update-page', { page_id: PAGE, command: 'update_content',
                                        content_updates: [{ old_str: 'a', new_str: 'b' }] });
  check('an over-cap exemption list blocks', blocked(r, 'over its'), 'code=' + r.code + ' err=' + r.err.slice(0, 200));
  check('...and the refusal now names trimming as the in-band fix',
        r.err.indexOf('TRIM the list') !== -1 && r.err.indexOf('Do not reach for break-glass') !== -1,
        'err=' + r.err.slice(0, 400));
  fs.rmSync(exemptFile, { force: true });
}
{
  // The hash ASSEMBLY is now one function called by both the gate and the CLI; it used to be two
  // byte-identical copies, while the CLI's own comment argued that one definition called by both is
  // what removes skill/hook drift. What was duplicated is a DECISION -- which value is hashed when the
  // payload cannot be read end to end -- so the assertion that matters is that a record minted from the
  // CLI's FALLBACK digest clears the gate's block. If the two ever diverge on that branch, no record
  // can match and break-glass is the only escape.
  const sessionDir = path.join(DIR, 'sess');
  const agentId = 'a5555555555555555';
  const fx = tokenFixture(agentId, sessionDir);

  const ti = { data: '{"page_id": "unterminated' };
  const p = path.join(DIR, 'test-payload.json');
  fs.writeFileSync(p, JSON.stringify(ti), 'utf8');
  const c = cli(['--ticket-hash', p, '--tool', 'update']);
  check('the CLI still prints a fallback digest for an unreadable payload',
        c.code === 0 && /^[0-9a-f]{64}$/.test(c.out.trim()) && c.err.indexOf('raw-input fallback') !== -1,
        'code=' + c.code + ' out=' + c.out.slice(0, 80));

  fx.write([[{ type: 'text', text: 'TICKET-REVIEW-VERDICT: PASS ' + c.out.trim() }]]);
  fx.record(c.out.trim());
  const r = run({ tool_name: MCP + 'notion-update-page', tool_input: ti, cwd: DIR,
                  transcript_path: sessionDir + '.jsonl' });
  check('a record minted from that digest clears the unreadable-payload block (both sites agree)',
        approved(r),
        'code=' + r.code + ' err=' + r.err.slice(0, 200));
  fs.rmSync(path.join(PASS_DIR, 'rec.json'), { force: true });

  // NOT asserted, deliberately: the CLI's new `normalise-threw` branch, which now exits non-zero
  // instead of printing a hash the hook's internal-error block could never honour. ticketNormalise is
  // written not to throw on anything JSON.parse can produce -- no getters, no cycles, every budget
  // checked rather than trusted -- so there is no input a file-driven suite can hand it to reach that
  // branch. It is a guard against a future bug in the normaliser, and saying so is better than
  // implying coverage, which is the same call this suite already makes for the hash re-assert.
}

console.log('\n== J. branches with no assertion before Step 3 ==');
{
  // transcript-too-large: a matched record + a verified reviewer, but the transcript is over the 4 MB
  // read cap. This is a DISTINCT diagnosis from no-token (the review may well have happened), so it must
  // not read as a false no-token. Reachable: pad the delivered text past the cap, still ending on a valid
  // token. The cap is checked by statSync BEFORE the file is read, so the 5 MB is only written, not read.
  const sessionDir = path.join(DIR, 'sess');
  const agentId = 'a6666666666666666';
  const fx = tokenFixture(agentId, sessionDir);
  const ti = { page_id: PAGE, command: 'update_content', content_updates: [{ old_str: 'a', new_str: 'b' }] };
  const p = path.join(DIR, 'test-payload.json');
  fs.writeFileSync(p, JSON.stringify(ti), 'utf8');
  const hash = cli(['--ticket-hash', p, '--tool', 'update']).out.trim();
  fx.write([[{ type: 'text', text: 'x'.repeat(5 * 1024 * 1024) + '\nTICKET-REVIEW-VERDICT: PASS ' + hash }]]);
  fx.record(hash);
  const rBig = run({ tool_name: MCP + 'notion-update-page', tool_input: ti, cwd: DIR,
                     transcript_path: sessionDir + '.jsonl' });
  check('an over-4MB reviewer transcript blocks as transcript-too-large (not a false no-token)',
        ticketBlockReason(rBig) === 'transcript-too-large',
        'reason=' + ticketBlockReason(rBig) + ' code=' + rBig.code + ' err=' + rBig.err.slice(0, 180));
  fs.rmSync(path.join(PASS_DIR, 'rec.json'), { force: true });
}
{
  // scope:'out' producer -- a create into a NON-Team-Tasks container. Every page is a ticket, but a
  // create into ANOTHER database is free (the stated guarantee), so this must fall through. This is one
  // side of BLOCKING #6: the 'out' return logs no event today, so a ROTATED Team-Tasks data source would
  // read exactly like this and silently approve. Step 5's marker-liveness probe addresses the rotation
  // case OUT of the hot path; this locks in the intended behaviour for a genuine other-DB create, which
  // must keep falling through after that probe is added.
  const rOther = mcp('notion-create-pages', { data: JSON.stringify({ pages: [
    { parent: { data_source_id: '11111111-2222-3333-4444-555555555555' }, properties: { Name: 'x' } }] }) });
  check('a create into a NON-Team-Tasks container falls through (create into another DB is free)',
        fellThrough(rOther), 'reason=' + ticketBlockReason(rOther) + ' code=' + rOther.code + ' err=' + rOther.err.slice(0, 180));
}
{
  // scope:'out' producer -- a workspace-level create with no `parent` key at all (1 real corpus
  // instance). Also must fall through.
  const rWs = mcp('notion-create-pages', { data: JSON.stringify({ pages: [{ properties: { Name: 'x' } }] }) });
  check('a workspace-level create with no parent falls through',
        fellThrough(rWs), 'reason=' + ticketBlockReason(rWs) + ' code=' + rWs.code + ' err=' + rWs.err.slice(0, 180));
}
{
  // EXPIRY CEILING (Fix 2, landed). findPassInDir checks only `exp < now` (a lower bound), so a record
  // with a far-future expiry was honoured indefinitely. The ceiling caps the TTL in the TICKET-SCOPED
  // path -- NOT in the shared findPassInDir, which would lock out longer-TTL sibling passes (staging /
  // vetting / check-due, incl. /vet-code's, the gate that installs this very hook). This asserts the
  // far-future record is REJECTED as expiry-too-far.
  const sessionDir = path.join(DIR, 'sess');
  const agentId = 'a7777777777777777';
  const fx = tokenFixture(agentId, sessionDir);
  const ti = { page_id: PAGE, command: 'update_content', content_updates: [{ old_str: 'a', new_str: 'b' }] };
  const p = path.join(DIR, 'test-payload.json');
  fs.writeFileSync(p, JSON.stringify(ti), 'utf8');
  const hash = cli(['--ticket-hash', p, '--tool', 'update']).out.trim();
  fx.write([[{ type: 'text', text: 'TICKET-REVIEW-VERDICT: PASS ' + hash }]]);
  fx.record(hash, { expires: '2099-01-01T00:00:00.000Z' });
  const rFuture = run({ tool_name: MCP + 'notion-update-page', tool_input: ti, cwd: DIR,
                        transcript_path: sessionDir + '.jsonl' });
  check('a far-future (2099) expiry is REJECTED', ticketBlockReason(rFuture) === 'expiry-too-far',
        'reason=' + ticketBlockReason(rFuture) + ' code=' + rFuture.code + ' err=' + rFuture.err.slice(0, 180));
  fs.rmSync(path.join(PASS_DIR, 'rec.json'), { force: true });
}
{
  // GEN-508 closed-shape (Fix 3): a matched pass carrying an unrecognised key is REFUSED, not silently
  // accepted -- the "field written and read by nothing" class. Waived, to isolate it from the reviewer
  // path (a canonical record still APPROVES -- that is section D's first assertion).
  fs.mkdirSync(PASS_DIR, { recursive: true });
  const ti = { page_id: PAGE, command: 'update_content', content_updates: [{ old_str: 'a', new_str: 'b' }] };
  const p = path.join(DIR, 'test-payload.json');
  fs.writeFileSync(p, JSON.stringify(ti), 'utf8');
  const hash = cli(['--ticket-hash', p, '--tool', 'update']).out.trim();
  const passFile = path.join(PASS_DIR, 'rec.json');
  fs.writeFileSync(passFile, JSON.stringify({
    kind: 'ticket', surface: 'notion-mcp', contentHash: hash, verdict: 'PASS', waived: true,
    target: 'page ' + PAGE, expires: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    injectedExtra: 'not a field the mint template writes'
  }), 'utf8');
  const rExtra = run({ tool_name: MCP + 'notion-update-page', tool_input: ti, cwd: DIR,
                      transcript_path: path.join(DIR, 'nope.jsonl') });
  check('a record with an unrecognised key is refused (closed shape)',
        ticketBlockReason(rExtra) === 'unknown-record-key',
        'reason=' + ticketBlockReason(rExtra) + ' code=' + rExtra.code + ' err=' + rExtra.err.slice(0, 180));
  fs.rmSync(passFile, { force: true });
}

console.log('\n== L. BLOCKING-1: GEN-58 volume seed + exempt-file id normalization ==');
{
  // BLOCKING-1 (Step 5): a write to a SEEDED log-volume id falls through (the seed mechanism), and a DASHED
  // id in the exempt file is NOT recognized (the hook parser needs bare 32-hex) -- which is why the
  // /vet-ticket GEN-58 rollover lane MUST normalize before appending. The exempt file is the hook's
  // TICKET_EXEMPT_FILE = <staging>/ticket-gate-exempt-pages.txt; cleanup() removes the whole staging dir.
  // A fabricated volume id is used (not the live current volume, which is time-varying).
  const exemptFile = path.join(DIR, '..', '..', '.claude-staging', 'ticket-gate-exempt-pages.txt');
  fs.mkdirSync(path.dirname(exemptFile), { recursive: true });
  const volId = 'aa11bb22cc33dd44ee55ff6677889900';
  const ti = { page_id: volId, command: 'update_content', content_updates: [{ old_str: 'a', new_str: 'b' }] };

  fs.writeFileSync(exemptFile, volId + '\n', 'utf8');
  const rSeeded = mcp('notion-update-page', ti);
  check('a log-append to a SEEDED exempt volume id falls through (BLOCKING-1 seed)',
        fellThrough(rSeeded), 'reason=' + ticketBlockReason(rSeeded) + ' code=' + rSeeded.code + ' err=' + rSeeded.err.slice(0, 160));

  const dashed = 'aa11bb22-cc33-dd44-ee55-ff6677889900';
  fs.writeFileSync(exemptFile, dashed + '\n', 'utf8');
  const rDashed = mcp('notion-update-page', ti);
  check('a DASHED id in the exempt file does NOT exempt the volume (lane must normalize before appending)',
        ticketBlockReason(rDashed) === 'no-pass', 'reason=' + ticketBlockReason(rDashed) + ' code=' + rDashed.code);
  fs.rmSync(exemptFile, { force: true });
}
// DELIBERATELY NOT ASSERTED behaviourally here, each with its reason -- the same call this suite already
// makes for the hash re-assert (section A2) and the normalise-threw CLI branch (section I):
//   * consume-failed and internal-error: each needs a condition a file-driven, single-process black-box
//     cannot force -- a rename that throws mid-consume, and a throw inside ticketScope (ticketNormalise is
//     written not to throw on anything JSON.parse can produce). Their reason strings ARE pinned at the
//     source level by the contract test (every ticketBlockReason signature must map to a real hook
//     reason), so a rename or refactor that dropped them is caught there rather than here.
//   * isSafeTicketHash APPROVING its own --ticket-hash CLI: the self-approve regex matches a path ending
//     in `auto-approve.js`, but this suite runs `auto-approve.working.js`, whose name the regex cannot
//     match -- so the POSITIVE path is unreachable against the working copy by construction. The contract
//     test pins the regex SHAPE and the call site instead.

console.log('\n== K. corpus fail-open sweep (real payloads) ==');
{
  // Re-expressed from the stale test-gen508.js Part B, which CANNOT run against v8: its in-process
  // loadHook() names four symbols the v8 collapse removed (ReferenceError before any assertion), and its
  // resolver stub is inert now that "every page is a ticket" is the default. Here the sweep runs each REAL
  // payload through the wired hook's own ticketScope via the read-only --ticket-scope-batch CLI (ONE spawn,
  // not ~1,300), then INDEPENDENTLY judges every 'out' verdict from the raw payload: an out-of-scope verdict
  // is legitimate ONLY for a housekeeping property edit, a GEN-58-subtree content write, or a create with no
  // Team-Tasks marker. Anything else 'out' is a silent bypass. FIELD-level exemption correctness (which
  // properties are substance) is covered directly by sections A and A2; this sweep catches the SHAPE/TARGET
  // escapes across real traffic that the synthetic cases cannot enumerate.
  //
  // The corpus holds real ticket bodies, so it is NOT committed. Absent -> this section SKIPS with a notice
  // (not a failure), exactly as the stale Part B did. Build it first with:  node build-corpus.js
  const CORPUS = H.CORPUS;
  if (!fs.existsSync(CORPUS)) {
    console.log('  SKIP corpus sweep -- ' + CORPUS + ' not found. Build it first:  node build-corpus.js');
  } else {
    const CONTENT_CMDS = new Set(['update_content', 'insert_content', 'replace_content']);
    // The hook's exempt property set and name-normaliser, reproduced so the sweep judges housekeeping
    // INDEPENDENTLY rather than rubber-stamping every update_properties -- a substance key on an 'out'
    // verdict is a real fail-open. The contract test pins this set + normaliser against the hook's
    // TICKET_HOUSEKEEPING_PROPS / ticketPropName, so a drift between the two copies is caught there.
    const HK_PROPS = new Set(['status', 'assignee', 'type', 'project', 'reason']);
    const propName = k => String(k == null ? '' : k)
      .replace(/^(?:date|place|userDefined):/i, '')
      .replace(/:(?:start|end|is_datetime|name|address|latitude|longitude|google_place_id)$/i, '')
      .trim().toLowerCase();
    const unwrap = ti => {
      if (ti && typeof ti === 'object' && typeof ti.data === 'string') {
        try { const d = JSON.parse(ti.data); if (d && typeof d === 'object') return d; } catch (e) { /* not an envelope */ }
      }
      return ti;
    };
    const carriesId = (ti, id) => JSON.stringify(ti == null ? '' : ti).replace(/-/g, '').toLowerCase()
                                    .indexOf(String(id).replace(/-/g, '').toLowerCase()) !== -1;
    function legitimateOut(row) {
      const t = row.tool || '', u = unwrap(row.input), cmd = u && u.command;
      if (t.endsWith('notion-update-page') && cmd === 'update_properties') {
        // NOT a rubber stamp: every property key must normalise to one of the five exempt names.
        const props = (u && u.properties && typeof u.properties === 'object' && !Array.isArray(u.properties))
          ? Object.keys(u.properties) : [];
        return props.every(k => HK_PROPS.has(propName(k)));
      }
      if (t.endsWith('notion-update-page') && CONTENT_CMDS.has(cmd) && carriesId(row.input, GEN58)) return true; // GEN-58 content
      if (t.endsWith('notion-create-pages') && !carriesId(row.input, TT_DS)) return true; // create w/o the Team-Tasks marker
      return false;
    }

    // Negative control: the classifier MUST reject an illegitimate 'out' shape. Without this, a future
    // edit could turn legitimateOut into a rubber stamp that passes the sweep no matter what escapes --
    // and the sweep would look green while asserting nothing. A duplicate-page is not a valid out-shape;
    // a substance-property (Urgency) update_properties must fail the housekeeping-field check.
    check('the sweep classifier discriminates (rejects an illegitimate out shape)',
          !legitimateOut({ tool: MCP + 'notion-duplicate-page', input: { page_id: PAGE, properties: { Status: 'Done' } } }) &&
          !legitimateOut({ tool: MCP + 'notion-update-page', input: { page_id: PAGE, command: 'update_properties', properties: { Urgency: 'High' } } }),
          'legitimateOut is not discriminating -- it may have become a rubber stamp');

    const rows = fs.readFileSync(CORPUS, 'utf8').split(/\r?\n/).filter(l => l.trim());
    const res = cli(['--ticket-scope-batch', CORPUS]);
    const verdicts = res.out.split(/\r?\n/).filter(l => l.trim())
                        .map(l => { try { return JSON.parse(l); } catch (e) { return null; } });

    check('the batch CLI returned one verdict per non-blank corpus line (index-join is exact)',
          verdicts.length === rows.length && verdicts.every(Boolean),
          'rows=' + rows.length + ' verdicts=' + verdicts.length + ' code=' + res.code);

    const counts = { in: 0, out: 0, block: 0, threw: 0, other: 0 };
    const findings = [];
    for (let i = 0; i < Math.min(rows.length, verdicts.length); i++) {
      const v = verdicts[i]; if (!v) continue;
      if (v.scope === 'in') counts.in++;
      else if (v.scope === 'block') counts.block++;
      else if (v.scope === 'threw') { counts.threw++; findings.push('THREW ' + v.short + ': ' + v.why); }
      else if (v.scope === 'out') {
        counts.out++;
        let row; try { row = JSON.parse(rows[i]); } catch (e) { row = null; }
        if (!row || !legitimateOut(row)) { counts.other++; findings.push('BYPASS ' + (v.short || '?') + ' @line ' + (i + 1)); }
      } else { counts.other++; findings.push('UNEXPECTED scope ' + v.scope + ' @line ' + (i + 1)); }
    }
    console.log('  swept ' + rows.length + ' real payloads: in=' + counts.in + ' block=' + counts.block +
                ' out=' + counts.out + ' threw=' + counts.threw);
    check('no ticketScope threw on the real corpus', counts.threw === 0, findings.slice(0, 5).join(' | '));
    check('every out-of-scope verdict is a legitimate exemption (0 silent bypasses)',
          counts.other === 0, counts.other + ' unexplained: ' + findings.slice(0, 10).join(' | '));
  }
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

console.log('\n== M. #4: break-glass is scoped to MECHANICAL blocks only (mirrors enforceStaging) ==');
{
  const UNLOCK = Object.assign({}, process.env, { CLAUDE_CONFIG_UNLOCK: '1' });

  // A CONTENT decision stays UNBREAKABLE under break-glass. A body edit with no record is no-pass; before
  // #4 the global `if (configUnlocked()) return` at the top of enforceTicketVetting cleared it -- a silent,
  // session-wide hole. Now it still blocks even with break-glass on.
  const content = { page_id: PAGE, command: 'update_content', content_updates: [{ old_str: 'a', new_str: 'b' }] };
  const rContentBase = mcp('notion-update-page', content);
  check('baseline (no break-glass): a no-pass content write blocks',
        ticketBlockReason(rContentBase) === 'no-pass', 'reason=' + ticketBlockReason(rContentBase) + ' code=' + rContentBase.code);
  const rContentBG = mcp('notion-update-page', content, UNLOCK);
  check('break-glass does NOT clear a content (no-pass) block -- the #4 fix',
        ticketBlockReason(rContentBG) === 'no-pass', 'reason=' + ticketBlockReason(rContentBG) + ' code=' + rContentBG.code);

  // A MECHANICAL block (unreadable-payload) IS cleared by break-glass: no exit-2 refusal, and the advisory
  // rides along on stdout so the skip surfaces immediately. Without break-glass the same payload blocks.
  const mech = { data: '{"page_id": "unterminated' };
  const rMechBase = mcp('notion-update-page', mech);
  check('baseline (no break-glass): an unreadable-payload write blocks',
        ticketBlockReason(rMechBase) === 'unreadable-payload', 'reason=' + ticketBlockReason(rMechBase) + ' code=' + rMechBase.code);
  const rMechBG = mcp('notion-update-page', mech, UNLOCK);
  check('break-glass CLEARS a mechanical (unreadable-payload) block -- no exit-2 refusal',
        rMechBG.code !== 2 && ticketBlockReason(rMechBG) === null,
        'code=' + rMechBG.code + ' reason=' + ticketBlockReason(rMechBG));
  check('the cleared mechanical skip SURFACES an advisory on stdout (the immediate reader)',
        rMechBG.out.indexOf('break-glass') !== -1 && rMechBG.out.indexOf('UNREVIEWED') !== -1,
        'stdout=' + rMechBG.out.slice(0, 200));
}

H.cleanup();
console.log('\n' + (state.fail === 0 ? 'ALL PASS' : 'FAILURES') + ': ' + state.pass + ' passed, ' + state.fail +
            ' failed, ' + state.pending.length + ' pending (red-by-design, awaits Step 4/5)');
if (state.pending.length) { for (const pnd of state.pending) console.log('    PEND ' + pnd); }
console.log('');
process.exit(state.fail === 0 ? 0 : 1);
