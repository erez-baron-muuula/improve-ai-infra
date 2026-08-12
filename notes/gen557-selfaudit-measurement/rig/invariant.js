// rig/invariant.js -- injected-string invariant GUARDRAIL (GEN-597, 2026-08-12)
// =============================================================================
// The hook `~/.claude/hooks/stop-claim-linter.js` documents an invariant in two
// places -- its header MAINTENANCE note ("the guard's own reason strings must
// never match any pattern") and the "Injected-string CONSTRAINT" note (~line 801):
//
//   every string this file INJECTS (the Phase-1 noteParts: the claim-linter note
//   AND the self-audit note) must never match any CLAIM_PATTERNS / SELF_AUDIT_
//   PATTERNS entry, and must not contain a line-start block opener.
//
// GEN-597 was a violation of exactly this: the claim-linter note once contained
// "no block is owed", which matched self-audit pattern /\bno block (?:is|was)
// owed\b/i, so a later message quoting the note could re-trip the detector. The
// 2026-08-10 re-cut reworded it ("no block is due"), but the only check that
// existed (rig/livefire.js's MAINTENANCE fixture) tested just ONE note (self-audit)
// against just ONE family (self-audit patterns) -- so it could not have caught a
// claim-linter-note violation, and would not catch the next one.
//
// THIS is the comprehensive guardrail: it checks BOTH injected notes against BOTH
// pattern families, plus the opener arm. It is the check that would have caught
// GEN-597 before it shipped.
//
// HOW IT WORKS -- and why it can't drift:
//  * It DRIVES a byte-identical working copy (rig/working.js, re-banked from the
//    live hook; sha checked at step 0) as a REAL Stop hook over stdin and reads the
//    ACTUAL emitted note text. Testing emitted output, not a re-typed copy, is the
//    GEN-597 lesson -- an author who rewords a note in the source can't reword it
//    out of this check. (working.js, not the live hook, so the hook's log writes
//    land in this rig dir and are self-cleaned, never polluting ~/.claude/hooks/
//    selfaudit-nudges.jsonl / foryou-guard-events.jsonl, which /wrap and the
//    gen467 scheduled scan read.)
//  * A note ECHOES the turn's flagged phrases back, wrapped in quotes -- those
//    match a pattern by construction. So the checker applies the hook's OWN
//    buildSuppressionMask and judges a match only where it is NOT inside a quoted /
//    inline-code span: exactly the hook's own definition of "authored text vs
//    quoted echo". Only the hook's constant instructional prose is judged.
//  * A self-test proves the checker actually fires (an unquoted planted phrase must
//    be caught) and that its suppression is honest (the same phrase quoted must be
//    ignored) -- so a green run can never be vacuous.
//
// WIRING (how this signal reaches a decision -- required, not deferred): this is
// the canonical injected-text invariant check for stop-claim-linter.js. Run it on
// EVERY gated edit to that file, as part of /vet-code Step 4 (mandatory detector
// live-fire). A non-zero exit is a FAIL that must block the vetting pass. See the
// rig README's "Injected-string invariant guardrail" section.
//
// Run: `node invariant.js` from this dir. Exit 0 = invariant holds; 1 = violated.
// =============================================================================
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const L = require('./lib.js');
const F = require('./fixtures.js');

const WORK = path.resolve(__dirname, 'working.js');
const RIG_DIR = __dirname;
let failures = 0;
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

console.log('--- injected-string invariant guardrail (GEN-597) ---');
console.log('  live hook  : ' + L.HOOK);
console.log('  drive copy : ' + WORK);

// --- 0. The regime check. lib.js slices patterns from the LIVE hook; this script
// DRIVES working.js. If they are not byte-identical, the captured notes and the
// patterns tested against them describe different code -- so refuse to proceed.
const liveSha = sha(L.HOOK);
const workSha = sha(WORK);
if (liveSha !== workSha) {
  console.log('  FAIL  working.js is NOT byte-identical to the live hook -- drive copy is stale.');
  console.log('        live=' + liveSha.slice(0, 16) + '  work=' + workSha.slice(0, 16));
  console.log('        Re-bank working.js from the live hook before trusting this run.');
  process.exit(1); // nothing driven yet -> no logs to self-clean
}
console.log('  PASS  drive copy byte-identical to live hook (sha ' + workSha.slice(0, 16) + ')');

// Snapshot pre-existing *.jsonl BEFORE driving, so self-clean deletes only what
// THIS run deposits (corpus.jsonl and any banked logs are preserved).
const preLogs = new Set(fs.readdirSync(RIG_DIR).filter(f => f.endsWith('.jsonl')));

// --- 1. Slice the live patterns + the hook's own suppression mask.
const claimPatterns = L.claimPatternsArray();
const selfAuditPatterns = L.selfAuditArray();
const buildSuppressionMask = L.suppressionMaskFn();
const BLOCK_OPENER_RE = L.blockOpenerRe();
const WIDE_OPENER_RE = L.WIDE_OPENER_RE;
const allPatterns = [
  ...claimPatterns.map(p => ({ fam: 'claim', re: p.re })),
  ...selfAuditPatterns.map(p => ({ fam: 'self-audit', re: p.re })),
];

// --- 2. The checker. A pattern match counts only where the hook's own mask does
// NOT suppress it (i.e. outside a quoted / inline-code echo). Plus the opener arm:
// no injected note may contain a line-start block opener (fence-stripped, as the
// hook tests it).
function check(note) {
  const mask = buildSuppressionMask(note);
  const violations = [];
  for (const pat of allPatterns) {
    const re = new RegExp(pat.re.source, pat.re.flags.includes('g') ? pat.re.flags : pat.re.flags + 'g');
    let m;
    while ((m = re.exec(note)) !== null) {
      if (m.index === re.lastIndex) { re.lastIndex++; } // zero-width guard
      if (mask[m.index] === 1) continue;                // inside a quoted echo
      violations.push({ fam: pat.fam, phrase: m[0].trim().slice(0, 80), pattern: pat.re.source });
    }
  }
  const stripped = note.replace(/```[\s\S]*?(?:```|$)/g, ''); // stripFences, as the hook does
  if (BLOCK_OPENER_RE.test(stripped)) violations.push({ fam: 'opener', phrase: '(line-start BLOCK_OPENER_RE)', pattern: BLOCK_OPENER_RE.source });
  if (WIDE_OPENER_RE.test(stripped)) violations.push({ fam: 'opener', phrase: '(line-start WIDE_OPENER_RE)', pattern: WIDE_OPENER_RE.source });
  return violations;
}

// --- 3. Drive working.js and capture the ACTUAL injected notes.
let n = 0;
const RUN = process.pid + '-' + Date.now();
const uid = () => 'gen597inv' + RUN + '-' + (++n); // unique per call -> no cross-run dedup
function drive(text) {
  const out = execFileSync(process.execPath, [WORK], {
    input: JSON.stringify({ last_assistant_message: text, session_id: uid(), prompt_id: uid() }),
    encoding: 'utf8',
  });
  if (!out.trim()) return null;
  const o = JSON.parse(out);
  return (o.hookSpecificOutput && o.hookSpecificOutput.additionalContext) || o.additionalContext || null;
}

// A claim that trips the claim-linter (uncleared Class-A "I can" + "the only", no
// evidence marker nearby); F.mustFire trips the self-audit detector.
const CLAIM_FIXTURE = 'Here is where things stand. I can finish the write-up today, and the only step left is a review.';
const captures = [drive(CLAIM_FIXTURE), drive(F.mustFire)];

// Split each capture into its labeled sections (noteParts are joined by '\n\n').
const notes = {};
for (const ctx of captures) {
  if (!ctx) continue;
  for (const section of ctx.split('\n\n')) {
    if (/^Claim-linter, automatic:/.test(section)) notes['claim-linter'] = section;
    else if (/^Self-audit, automatic:/.test(section)) notes['self-audit'] = section;
  }
}

// --- 4. Both notes must be captured, or the run is vacuous.
console.log('\n--- captured injected notes ---');
for (const label of ['claim-linter', 'self-audit']) {
  if (notes[label]) {
    console.log('  captured ' + label + ' note (' + notes[label].length + ' chars)');
  } else {
    console.log('  FAIL  did NOT capture the ' + label + ' note -- its fixture no longer trips it; check is vacuous');
    failures++;
  }
}

// --- 5. The invariant: no captured note matches any pattern / contains an opener.
console.log('\n--- invariant: no injected note matches any pattern or carries an opener ---');
for (const label of Object.keys(notes)) {
  const v = check(notes[label]);
  if (v.length === 0) {
    console.log('  PASS  ' + label + ' note -> no pattern matches, no opener');
  } else {
    console.log('  FAIL  ' + label + ' note -> ' + v.length + ' violation(s):');
    for (const x of v) console.log('        [' + x.fam + '] "' + x.phrase + '"  matches  ' + x.pattern);
    failures++;
  }
}

// --- 6. Non-vacuous self-test: the checker MUST catch an unquoted planted phrase,
// and MUST stay silent when the same phrase is quoted.
console.log('\n--- self-test: the checker actually fires (and suppresses honestly) ---');
const BAD = 'Self-audit, automatic: narrating that no block is owed is exactly the banned thing.';
const QUOTED = 'Self-audit, automatic: the phrase "no block is owed" is only being quoted here.';
const badV = check(BAD);
if (badV.some(x => /no block/i.test(x.phrase))) {
  console.log('  PASS  an unquoted "no block is owed" is caught (' + badV.length + ' hit) -- not vacuous');
} else {
  console.log('  FAIL  the checker did NOT catch an unquoted "no block is owed" -- guardrail is broken');
  failures++;
}
const quotedV = check(QUOTED);
if (quotedV.length === 0) {
  console.log('  PASS  a quoted "no block is owed" is suppressed -- the mask excludes echoes, not authored text');
} else {
  console.log('  FAIL  a quoted "no block is owed" was flagged (' + quotedV.length + ') -- mask/echo handling is wrong');
  failures++;
}

// --- 7. Self-clean any logs working.js deposited beside itself (see header).
const nowLogs = fs.readdirSync(RIG_DIR).filter(f => f.endsWith('.jsonl'));
const deposited = nowLogs.filter(f => !preLogs.has(f));
for (const f of deposited) { fs.unlinkSync(path.join(RIG_DIR, f)); }
console.log('\nlogs deposited by this run and self-cleaned: ' + (deposited.join(', ') || '(none)'));

// --- 8. Verdict + exit code (non-zero FAIL so /vet-code Step 4 can gate on it).
console.log('\n=== ' + (failures === 0
  ? 'PASS -- injected-string invariant holds (both notes, both families, openers)'
  : 'FAIL -- ' + failures + ' problem(s); the injected-string invariant is VIOLATED') + ' ===');
process.exitCode = failures === 0 ? 0 : 1;
