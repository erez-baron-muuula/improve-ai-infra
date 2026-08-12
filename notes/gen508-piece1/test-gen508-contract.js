// GEN-508 Step 3, item 7: the hook<->skill CONTRACT test.
//
// The recurring finding class in this feature was a guarantee asserted in ONE artifact whose
// realisation lived in ANOTHER that did not match: five skill/hook drifts across three review rounds, a
// carve-out fixed three times, a reason-set that missed a real block path. The behavioural suite
// (test-gen508-v8-arm.js) tests the hook against payloads; it cannot see a hook<->skill seam, and it
// cannot see when a copy the TEST itself reproduces (the reason signatures, the housekeeping field set,
// the sweep's normaliser) drifts from the hook it mirrors. This file tests those seams at the SOURCE
// level, where a drift shows up as text rather than as a runtime miss -- which is the executable form of
// "make the cross-artifact contract checkable".
//
// Red-by-design specs (their fix is a later step) use expectPending, exactly as the arm suite does: they
// print as PEND and do NOT fail the gate, so a real regression still stands out.
//
// Run:  node test-gen508-contract.js
const H = require('./test-gen508-harness.js');
const fs = require('fs');
const path = require('path');
const { check, expectPending, state } = H.newChecker();

const hookSrc = fs.readFileSync(H.HOOK, 'utf8');
const skillSrc = fs.readFileSync(path.join(H.DIR, 'vet-ticket-SKILL.md'), 'utf8');

// The parked REST-arm reasons: present in blockTicketVetting but unreachable in piece 1a, and covered
// by test-gen508-rest-parked.js. Excluded from the wired-surface reason-set checks below.
const REST_REASONS = new Set(['rest-not-via-script', 'rest-template-cannot-express', 'rest-signal-no-target',
                              'rest-form-unrecognised', 'body-file-unreadable', 'rest-script-mismatch']);

console.log('\n== 1. the skill no longer asserts the disproven premises (BLOCKING 3) ==');
{
  // Each fragment is a premise a /check panel or a live test DISPROVED. They are STILL in the skill today;
  // Step 4's premise sweep removes them. Red-by-design: PEND now, auto-promote when the sweep lands.
  const killed = [
    ['the mint write "prompts him" / that prompt IS the gate', 'that prompt IS the'],
    ['the pass write "prompts him"', 'so the write prompts him'],
    ['the mint prompt is the waive\'s "second, deliberate confirmation"', 'the mint prompt is his second, deliberate confirmation'],
    ['raw REST writes "cannot run silently"', 'so neither runs silently']
  ];
  for (const [label, frag] of killed) {
    expectPending('skill no longer asserts: ' + label, skillSrc.indexOf(frag) === -1, 'Step 4: BLOCKING-3 premise sweep');
  }
}

console.log('\n== 2. the reason-mapper (harness) and the hook agree on the wired reason set ==');
{
  // ticketBlockReason maps a refusal to a reason KEY by a per-reason signature. If the hook gains or
  // renames a WIRED reason and the mapper is not updated, that block reads as no-pass and a reason-level
  // assertion for it passes silently. blockTicketVetting has one `else if (reason === 'X')` branch per
  // reason, so those literals are the authoritative wired set (minus no-pass, which is the default with
  // no branch, and minus the parked REST set).
  const handled = new Set();
  const re = /reason === '([a-z0-9-]+)'/g; let m;
  while ((m = re.exec(hookSrc))) handled.add(m[1]);
  const wired = [...handled].filter(r => !REST_REASONS.has(r));
  const sigKeys = Object.keys(H.TICKET_BLOCK_SIGNATURES);

  const missingSig = wired.filter(r => !H.TICKET_BLOCK_SIGNATURES[r]);
  check('every wired hook reason has a mapper signature (a new reason cannot read as no-pass)',
        missingSig.length === 0, 'missing signature for: ' + missingSig.join(', '));
  const extraSig = sigKeys.filter(k => !handled.has(k));
  check('every mapper signature maps to a reason the hook actually handles',
        extraSig.length === 0, 'signature with no hook reason: ' + extraSig.join(', '));
  // And each signature fragment is really present in the hook's message for that reason -- so the mapper
  // matches on text the hook emits, not on text that has since been reworded.
  const staleSig = sigKeys.filter(k => hookSrc.indexOf(H.TICKET_BLOCK_SIGNATURES[k]) === -1);
  check('every mapper signature fragment is present verbatim in the hook source',
        staleSig.length === 0, 'signature not found in hook: ' + staleSig.join(', '));
}

console.log('\n== 3. the content hash has ONE definition, called by both the gate and the CLI ==');
{
  const defs = (hookSrc.match(/function ticketContentHash\(/g) || []).length;
  check('ticketContentHash is defined exactly once (no duplicated hash assembly)', defs === 1, 'definitions: ' + defs);
  // 1 definition + a call from ticketScope + a call from ticketHashCli = at least 3 occurrences. Fewer
  // means a call site stopped routing through the shared function -- the exact drift the CLI comment
  // argues one-definition-called-by-both prevents.
  const occ = (hookSrc.match(/ticketContentHash\(/g) || []).length;
  check('ticketContentHash is called by both the gate path and the CLI (def + 2 call sites)', occ >= 3, 'occurrences: ' + occ);
}

console.log('\n== 4. the content hash BINDS the tool (BLOCKING 2) ==');
{
  // BLOCKING 2 (was): a pass minted for a payload cleared the SAME payload under a DIFFERENT tool,
  // because the hash was taken over the payload alone -- and notion-duplicate-page SPAWNS A LIVE TICKET,
  // so an update record spent on a duplicate is an unreviewed create. The fix folds the tool tag into
  // ticketContentHash. A WAIVED pass isolates the property under test from the reviewer path (no sidecar,
  // no token), so the ONLY thing that can refuse the cross-tool write is the tool-bound hash.
  //
  // This is a FORMULA-level test, not a plumbing test: the POSITIVE control proves the record clears
  // under its own tool, so the NEGATIVE proves the tool BINDS -- a `--tool` arg threaded through the
  // plumbing while ticketContentHash still ignored it would clear BOTH and fail the negative here.
  const payload = { page_id: H.PAGE, command: 'update_properties', properties: { Urgency: 'High' } };
  const p = path.join(H.DIR, 'test-payload.json');
  fs.writeFileSync(p, JSON.stringify(payload), 'utf8');
  // Mint the record for this payload as an UPDATE (the tool it was reviewed under).
  const h = H.cli(['--ticket-hash', p, '--tool', 'update']).out.trim();
  fs.mkdirSync(H.PASS_DIR, { recursive: true });
  const passFile = path.join(H.PASS_DIR, 'rec.json');
  const mint = () => fs.writeFileSync(passFile, JSON.stringify({
    kind: 'ticket', surface: 'notion-mcp', contentHash: h, verdict: 'PASS', waived: true,
    target: 'page ' + H.PAGE, expires: new Date(Date.now() + 15 * 60 * 1000).toISOString()
  }), 'utf8');

  // POSITIVE control: the update record DOES clear the same payload under update-page (and consumes it).
  mint();
  const rUpd = H.run({ tool_name: H.MCP + 'notion-update-page', tool_input: payload, cwd: H.DIR,
                       transcript_path: path.join(H.DIR, 'nope.jsonl') });
  check('control: the update record clears the same payload under update-page',
        H.approved(rUpd), 'code=' + rUpd.code + ' err=' + rUpd.err.slice(0, 160));

  // NEGATIVE (BLOCKING 2): re-mint (the control consumed it) and send the identical object under
  // notion-duplicate-page. The tool is folded into the hash, so the update record cannot clear it.
  mint();
  const rDup = H.run({ tool_name: H.MCP + 'notion-duplicate-page', tool_input: payload, cwd: H.DIR,
                       transcript_path: path.join(H.DIR, 'nope.jsonl') });
  check('a pass minted for one tool does NOT clear the same payload under another tool',
        !H.approved(rDup) && H.ticketBlockReason(rDup) !== null,
        'approved=' + H.approved(rDup) + ' reason=' + H.ticketBlockReason(rDup) + ' code=' + rDup.code);
  fs.rmSync(passFile, { force: true });
}

console.log('\n== 5. the --ticket-hash allow-list regex is still tightly pinned ==');
{
  // The self-approve regex (isSafeTicketHash) lets /vet-ticket run the hash CLI with no prompt. GEN-508
  // BLOCKING 2 added a REQUIRED `--tool <tag>` argument folded into the hash, so the regex now ends on
  // that tag, pinned to a fixed four-word enum. These pins assert the security-relevant shape: the script
  // and .json paths still exclude every shell metacharacter, and the tool arg is a CLOSED ENUM anchored to
  // the end (`$`, no `m` flag) -- so nothing can be chained/expanded/redirected after it and the tool arg
  // itself carries no metacharacter. A future change to the argv contract must deliberately update these.
  check('the regex still excludes shell metacharacters in the script path',
        hookSrc.indexOf('([^"<>|&;`$]+auto-approve\\.js)') !== -1, 'metachar exclusion on the path changed');
  check('the regex still excludes shell metacharacters in the .json argument',
        hookSrc.indexOf('--ticket-hash\\s+"([^"<>|&;`$]+\\.json)"') !== -1, 'the --ticket-hash .json arg shape changed');
  check('the regex ends on the fixed --tool enum (closed set, anchored as the last token)',
        hookSrc.indexOf('--tool\\s+"?(?:create|update|duplicate|move)"?$') !== -1, 'the --tool arg pin changed');
  check('isSafeTicketHash still gates the shell allow-list approve (call site intact)',
        hookSrc.indexOf('if (isSafeTicketHash(cmd)) return approve(') !== -1, 'the self-approve call site moved or changed');
}

console.log('\n== 6. the corpus sweep reproduces the hook housekeeping contract faithfully ==');
{
  // test-gen508-v8-arm.js's fail-open sweep reproduces the hook's exempt property set and name-normaliser
  // to judge housekeeping 'out' verdicts independently. If the hook's copy changes and the sweep's does
  // not, the sweep silently rubber-stamps again. Pin both so the drift is caught HERE, not in production.
  const hkMatch = hookSrc.match(/TICKET_HOUSEKEEPING_PROPS = new Set\(\[([^\]]*)\]\)/);
  const hkSet = hkMatch ? hkMatch[1].split(',').map(s => s.replace(/['"\s]/g, '')).filter(Boolean).sort() : [];
  check('the hook housekeeping set is exactly the five names the sweep reproduces',
        JSON.stringify(hkSet) === JSON.stringify(['assignee', 'project', 'reason', 'status', 'type']),
        'hook set is now: [' + hkSet.join(', ') + '] -- re-sync HK_PROPS in the sweep');
  check('the hook ticketPropName normaliser still strips the qualifier forms the sweep reproduces',
        hookSrc.indexOf('replace(/^(?:date|place|userDefined):/i') !== -1 &&
        hookSrc.indexOf('google_place_id)$/i') !== -1,
        'ticketPropName changed -- re-sync the propName normaliser in the sweep');
}

console.log('\n== 7. remaining source-level pins (BLOCKING #6 tripwire; skill pass shape) ==');
{
  // containerTeamTasks is dead output today (computed, read by no scope decision). BLOCKING #6's fix
  // (Step 5) may wire it. This asserts the CURRENT dead state; when Step 5 reads it, this fails and tells
  // whoever wires it to update the pin -- a deliberate tripwire, not a red-by-design pending.
  check('containerTeamTasks is still dead output (not yet read by any scope decision -- BLOCKING #6 open)',
        hookSrc.indexOf('containerTeamTasks') !== -1 &&
        hookSrc.indexOf('.containerTeamTasks') === -1,
        'containerTeamTasks is now READ -- if Step 5 wired #6, update this tripwire and the sweep');

  // The skill's PASS template must carry the singular reviewerAgentId the hook reads, and must NOT carry
  // the v7 nested-targets / plural-ids shape the 2026-08-05 review found (the arm suite guards the hook
  // side of that; this guards the skill side).
  check('the skill documents the singular reviewerAgentId the hook reads',
        skillSrc.indexOf('"reviewerAgentId"') !== -1, 'skill pass template lost reviewerAgentId');
  check('the skill does NOT reintroduce the v7 nested targets[] pass shape',
        skillSrc.indexOf('"targets"') === -1, 'skill reintroduced a nested targets[] pass shape');
}

H.cleanup();
console.log('\n' + (state.fail === 0 ? 'ALL PASS' : 'FAILURES') + ': ' + state.pass + ' passed, ' + state.fail +
            ' failed, ' + state.pending.length + ' pending (red-by-design, awaits Step 4/5)');
if (state.pending.length) { for (const pnd of state.pending) console.log('    PEND ' + pnd); }
console.log('');
process.exit(state.fail === 0 ? 0 : 1);
