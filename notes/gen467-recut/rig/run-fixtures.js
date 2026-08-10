// GEN-467 re-cut — Step-4 live-fire fixture suite.
// Copies the working hooks into a fixture dir (so __dirname logs land here),
// pipes real Stop payloads via stdin (the hooks' REAL caller shape), and
// asserts decisions, log rows, state files, and note-text acceptance.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const FIX = __dirname;
const HOOKS = path.join(FIX, 'hooks');
const WORK = 'C:\\Users\\Erez\\AI Projects\\Improve AI Infra\\notes\\gen467-recut\\working';
const OLDWORK = 'C:\\Users\\Erez\\AI Projects\\Improve AI Infra\\notes\\gen467-holistic-fix\\working';
const LINTER_STATE = path.join(os.tmpdir(), 'claude-claim-linter-state');
const SS_STATE = path.join(os.tmpdir(), 'claude-signal-surface-state');

fs.mkdirSync(HOOKS, { recursive: true });
fs.copyFileSync(path.join(WORK, 'stop-claim-linter.js'), path.join(HOOKS, 'stop-claim-linter.js'));
fs.copyFileSync(path.join(WORK, 'stop-signal-surface.js'), path.join(HOOKS, 'stop-signal-surface.js'));
// Old (superseded-batch) signal-surface, run in its own dir for the note-equality acceptance.
const OLDHOOKS = path.join(FIX, 'oldhooks');
fs.mkdirSync(OLDHOOKS, { recursive: true });
fs.copyFileSync(path.join(OLDWORK, 'stop-signal-surface.js'), path.join(OLDHOOKS, 'stop-signal-surface.js'));

let n = 0, fails = [];
function check(name, cond, detail) {
  n++;
  if (!cond) fails.push(name + (detail ? ' :: ' + detail : ''));
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
}
function run(hookPath, payload) {
  const r = cp.spawnSync(process.execPath, [hookPath], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8', timeout: 20000,
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
function guardLog() {
  const p = path.join(HOOKS, 'foryou-guard-events.jsonl');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
}
function ssLog(dir) {
  const p = path.join(dir || HOOKS, 'signal-surface-pending.jsonl');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
}
function lastEvent() { const l = guardLog(); return l.length ? l[l.length - 1] : null; }
// Run-unique ids: the hooks' per-turn dedup markers live in the shared OS temp
// dir and persist across suite runs -- fixed ids collide with a prior run's state.
const RUN = Date.now().toString(36);
function sid(i) { return 'fx' + RUN + 's' + i; }
function pid(i) { return 'fx' + RUN + 'p' + i; }
function stopPayload(i, msg, extra) {
  return Object.assign({ session_id: sid(i), prompt_id: pid(i), last_assistant_message: msg, stop_hook_active: false }, extra || {});
}
function ssMarker(dir, i, file) {
  fs.mkdirSync(SS_STATE, { recursive: true });
  fs.writeFileSync(path.join(SS_STATE, sid(i) + '.' + pid(i)), JSON.stringify({ file: file || 'somefile.js' }));
}
const LINTER = path.join(HOOKS, 'stop-claim-linter.js');
const SS = path.join(HOOKS, 'stop-signal-surface.js');
const OLDSS = path.join(OLDHOOKS, 'stop-signal-surface.js');
const PIN = '\u{1F4CC}';
const BLOCK_BODY = 'Everything landed.\n\n---\n\n';

// ---------- claim-linter: guard + sighting + skip ----------
let r = run(LINTER, stopPayload(1, BLOCK_BODY + PIN + ' **For you**\n\nAll good, decision needed on X.'));
check('T1 narrow first block: silent release', r.code === 0 && r.out === '' && lastEvent().event === 'release-clean');
check('T1b release state file exists', fs.existsSync(path.join(LINTER_STATE, 'guard.' + sid(1) + '.' + pid(1) + '.released')));

r = run(LINTER, stopPayload(1, BLOCK_BODY + PIN + ' **For you**\n\nA DIFFERENT second block message.'));
check('T2 second narrow block: arm1-sighting, NO decision:block', r.code === 0 && r.out === '' && lastEvent().event === 'arm1-sighting');

const samemsg = BLOCK_BODY + PIN + ' **For you**\n\nIdentical content re-fire.';
run(LINTER, stopPayload(2, samemsg));
r = run(LINTER, stopPayload(2, samemsg));
check('T3 same-message re-fire: samemsg-release, silent', r.code === 0 && r.out === '' && lastEvent().event === 'arm1-samemsg-release');

r = run(LINTER, stopPayload(3, BLOCK_BODY + '## ' + PIN + ' For you\n\nIt defaults to 5000 and there are no other options.'));
check('T4 heading-form block: phase1-skip (claims present but suppressed)', r.code === 0 && r.out === '' && lastEvent().event === 'phase1-skip-blockform');
check('T4b heading-form wrote NO release record', !fs.existsSync(path.join(LINTER_STATE, 'guard.' + sid(3) + '.' + pid(3) + '.released')));

r = run(LINTER, stopPayload(4, BLOCK_BODY + PIN + PIN + ' For you\n\nDoubled pin form. It defaults to 5000.'));
check('T5 doubled-pin block: phase1-skip', r.code === 0 && r.out === '' && lastEvent().event === 'phase1-skip-blockform');

r = run(LINTER, stopPayload(5, 'Discussing the hook.\n\n> ' + PIN + ' For you\n\nThat quoted block defaults to 5000 stuff.'), );
check('T6 blockquoted opener: NOT skipped (note fires on the naked claim)', r.code === 0 && r.out.includes('additionalContext') && r.out.includes('Claim-linter'));

r = run(LINTER, stopPayload(6, 'Example only:\n```\n' + PIN + ' **For you**\nfenced example\n```\nIt defaults to 5000.'));
check('T7 fenced opener: NOT skipped (note fires)', r.code === 0 && r.out.includes('additionalContext'));

r = run(LINTER, stopPayload(7, 'the "' + PIN + ' For you" block is discussed mid-prose here. It defaults to 5000.'));
check('T8 mid-prose quoted opener: NOT skipped (note fires)', r.code === 0 && r.out.includes('additionalContext'));

r = run(LINTER, stopPayload(8, '    ' + PIN + ' For you\n\nIndented 4 spaces = code block. It defaults to 5000.'));
check('T9 4-space-indented opener: NOT skipped', r.code === 0 && r.out.includes('additionalContext'));

r = run(LINTER, { last_assistant_message: BLOCK_BODY + '## ' + PIN + ' For you\n\nNo session id on this payload, run ' + RUN + '. It defaults to 5000.' });
check('T10 heading-form + MISSING ids: skip still fires (fallback ids)', r.code === 0 && r.out === '' && lastEvent().event === 'phase1-skip-blockform' && lastEvent().session_id === 'nosession');

r = run(LINTER, stopPayload(9, 'Plain message. It defaults to 5000 with nothing nearby.'));
check('T11 non-block claim message: Phase-1 note fires (regression)', r.code === 0 && r.out.includes('Claim-linter, automatic'));
check('T11b note text carries "no block is due" (Part 4)', r.out.includes('no block is due') && !r.out.includes('no block is owed'));
check('T11c note text self-trigger check: no "the only"', !r.out.includes('the only'));

r = run(LINTER, stopPayload(10, 'I checked the config and it came back clean, nothing changed.'));
check('T12 self-audit narration: nudge fires (regression)', r.code === 0 && r.out.includes('Self-audit, automatic'));

r = run(LINTER, stopPayload(11, 'Ordinary message with a claim. It defaults to 5000.', { stop_hook_active: true }));
check('T13 stop_hook_active: silent (regression)', r.code === 0 && r.out === '');

r = run(LINTER, 'this is not json{{{');
check('T14 malformed stdin: silent exit 0', r.code === 0 && r.out === '');

const t0 = Date.now();
r = run(LINTER, stopPayload(12, BLOCK_BODY + '## ' + PIN + ' '.repeat(1) + ' For you' + ' '.repeat(100000) + '\n' + 'x'.repeat(80000)));
const elapsed = Date.now() - t0;
check('T15 pathological spaces perf <2000ms (measured ' + elapsed + 'ms)', r.code === 0 && elapsed < 2000);

// Regex form coverage (direct, all observed forms vs the wide regex in the working copy)
const src = fs.readFileSync(LINTER, 'utf8');
const m = src.match(/const WIDE_OPENER_RE = (\/.*\/[a-z]*);/);
check('T16 WIDE_OPENER_RE present in working copy', !!m);
const wide = eval(m[1]);
const stripFences = t => t.replace(/```[\s\S]*?(?:```|$)/g, '');
const forms = [PIN + ' **For you**', PIN + ' For you', '**' + PIN + ' For you', '## ' + PIN + ' For you', '### ' + PIN + ' For you', PIN + PIN + ' For you', '**' + PIN + '** For you'];
check('T17 wide regex matches all observed opener forms', forms.every(f => wide.test(stripFences('body\n' + f + '\ntail'))));
const negs = ['> ' + PIN + ' For you', '    ' + PIN + ' For you', 'the "' + PIN + ' For you" block', 'a ' + PIN + ' For you mention'];
check('T18 wide regex rejects quote/indent/mid-prose forms', negs.every(f => !wide.test('body\n' + f + '\ntail')));

// Reason-self-scan: every injected string in the NEW linter vs its own patterns.
// Extract noteParts texts by firing both note branches and scanning the emitted notes.
const noteClaim = run(LINTER, stopPayload(13, 'It defaults to 5000.')).out;
const noteAudit = run(LINTER, stopPayload(14, 'I checked it and it came back clean.')).out;
function patternsHit(noteJson) {
  if (!noteJson) return ['<no output>'];
  const text = JSON.parse(noteJson).hookSpecificOutput.additionalContext;
  const CLAIM_PATTERNS = [/\bI (?:can|can't|cannot)\b/i, /\bis(?:n't| not)? available\b/i, /\bdoes(?:n't| not) exist\b/i, /\bthere (?:is|are) no\b/i, /\bdefaults? to\b/i, /\bis configured\b/i, /\bexpires? (?:after|on|in)\b/i, /\b(?:it |the \w+ )?(?:filed|completed|succeeded|worked)\b/i, /\bran clean(?:ly)?\b/i, /\bthe only\b/i, /\bnothing else\b/i, /\balready covered\b/i, /\(verified\)/i, /\bGEN-\d+ (?:is|was) (?:open|done|closed|in progress|backlog|awaiting|blocked)\b/i, /\bthe latest\b/i, /\bhas(?:n't| not) been done\b/i, /\bno (?:ticket|issue|entry) (?:for|exists)\b/i, /\bGEN-\d+ (?:removed|says|is about|adds?|changes?)\b/i, /\balready (?:filed|created|been (?:filed|created|done))\b/i, /\bstill (?:open|done|closed|blocked|in progress|pending)\b/i, /\brenders? (?:cleanly|correctly|fine|properly)\b/i, /\b(?:it['\u2019]?s|that['\u2019]?s|this is) (?:done|complete|verified)\b/i];
  const SELF_AUDIT = [/\bcame back clean\b/i, /\bno (?:unverified|state) (?:assertions?|was changed|changes?)\b/i, /\bnothing (?:else )?(?:was )?touched\b/i, /\bno block (?:is|was) owed\b/i, /\bnot a memory claim\b/i, /\bfrom (?:this turn'?s?|the turn'?s?) own state\b/i, /\bverified (?:from|against) (?:this|the) turn'?s?\b/i, /\bnothing to (?:correct|fix)\b/i, /\bthat['\u2019]?s the complete set\b/i, /\bholds as written\b/i, /\u2713[ \t]*closed\b/i];
  const hits = [];
  // Strip the QUOTED echo of the triggering phrase (the note quotes the hit in "..."), then scan.
  const scanText = text.replace(/"[^"]{0,60}"/g, '""');
  for (const re of [...CLAIM_PATTERNS, ...SELF_AUDIT]) { if (re.test(scanText)) hits.push(String(re)); }
  if (wide.test(stripFences(scanText))) hits.push('LINE-START-OPENER');
  return hits;
}
const h1 = patternsHit(noteClaim), h2 = patternsHit(noteAudit);
check('T19 claim-note self-scan clean', h1.length === 0, h1.join(','));
check('T20 audit-note self-scan clean', h2.length === 0, h2.join(','));

// ---------- signal-surface: suppress / nudge / cleared ----------
ssMarker(null, 20, 'built-thing.js');
r = run(SS, stopPayload(20, 'I built the logger. Done.'));
let rows = ssLog();
let last = rows[rows.length - 1];
check('T21 nudge path: additionalContext emitted, decision nudge', r.code === 0 && r.out.includes('Signal-surfacing check') && last.decision === 'nudge');
const newNote = JSON.parse(r.out).hookSpecificOutput.additionalContext;

ssMarker(null, 21, 'built-thing.js');
r = run(SS, stopPayload(21, BLOCK_BODY + '## ' + PIN + ' For you\n\nOne decision below on the new mechanism.'));
rows = ssLog(); last = rows[rows.length - 1];
check('T22 SUPPRESSED: block already out -> no stdout, row suppressed-block-out', r.code === 0 && r.out === '' && last.decision === 'suppressed-block-out' && last.session === sid(21));

ssMarker(null, 22, 'built-thing.js');
r = run(SS, stopPayload(22, 'I built the counter and it surfaces in the /wrap log readout each session.'));
rows = ssLog(); last = rows[rows.length - 1];
check('T23 cleared-surfacing-designed: no stdout (regression)', r.code === 0 && r.out === '' && last.decision === 'cleared-surfacing-designed');

r = run(SS, stopPayload(23, 'No marker was set for this turn.'));
check('T24 no marker: silent, no row', r.code === 0 && r.out === '' && ssLog().length === rows.length);

ssMarker(null, 24, 'built-thing.js');
r = run(SS, stopPayload(24, 'I built the logger.', { stop_hook_active: true }));
check('T25 stop_hook_active: silent', r.code === 0 && r.out === '');

r = run(SS, '{{{not json');
check('T26 malformed stdin: silent exit 0', r.code === 0 && r.out === '');

ssMarker(null, 25, 'built-thing.js');
r = run(SS, stopPayload(25, 'I built the thing. Example block:\n```\n' + PIN + ' **For you**\nfenced\n```\nDone building it.'));
rows = ssLog(); last = rows[rows.length - 1];
check('T27 fenced opener only: NOT suppressed (nudge fires)', r.code === 0 && r.out.includes('Signal-surfacing check') && last.decision === 'nudge');

// r3 ACCEPTANCE: new unconditional note text CHARACTER-EQUAL to old working copy's
// common + else-branch tail (same fold-in exposure: marker present, no opener).
ssMarker(OLDHOOKS, 26, 'built-thing.js');
r = run(OLDSS, stopPayload(26, 'I built the logger. Done.'));
check('T28 old working hook emitted its fold-in note', r.out.includes('Signal-surfacing check'));
const oldNote = r.out ? JSON.parse(r.out).hookSpecificOutput.additionalContext : '<none>';
check('T29 note text CHARACTER-EQUAL to reviewed working common+tail', newNote === oldNote,
  newNote === oldNote ? '' : 'first divergence at index ' + [...newNote].findIndex((c, i) => c !== oldNote[i]));

// Signal-surface note self-scan (same pattern sets; via the linter's own detectors on the note text)
const h3 = patternsHit(JSON.stringify({ hookSpecificOutput: { additionalContext: newNote } }));
check('T30 signal-surface note self-scan clean', h3.length === 0, h3.join(','));

// ---------- fix-pass additions (code review 2026-08-10) ----------
// "For your" prose must NOT trip the skip (claim-linter) or suppression (signal-surface).
r = run(LINTER, stopPayload(30, PIN + ' For your reference, the settings moved. It defaults to 5000.'));
check('T31 line-start "For your" prose: NOT skipped (note fires)', r.code === 0 && r.out.includes('Claim-linter, automatic'));

ssMarker(null, 31, 'built-thing.js');
r = run(SS, stopPayload(31, PIN + ' For your records: I built the thing today.'));
rows = ssLog(); last = rows[rows.length - 1];
check('T32 "For your" prose: NOT suppressed (nudge fires)', r.code === 0 && r.out.includes('Signal-surfacing check') && last.decision === 'nudge');

// Narrow-regex pathological line must complete fast (bounded runs, both regexes).
const t1 = Date.now();
r = run(LINTER, stopPayload(32, 'body\n' + PIN + ' '.repeat(1) + ' '.repeat(100000) + 'Z\n' + 'tail It defaults to 5000.'));
const el2 = Date.now() - t1;
check('T33 pin+100K-space line completes <2000ms (measured ' + el2 + 'ms)', r.code === 0 && el2 < 2000);

// Byte-identity of the ported opener machinery across the two working copies.
const srcA = fs.readFileSync(path.join(WORK, 'stop-claim-linter.js'), 'utf8');
const srcB = fs.readFileSync(path.join(WORK, 'stop-signal-surface.js'), 'utf8');
const reA = (srcA.match(/const WIDE_OPENER_RE = (\/.*\/[a-z]*);/) || [])[1];
const reB = (srcB.match(/const WIDE_OPENER_RE = (\/.*\/[a-z]*);/) || [])[1];
const sfA = (srcA.match(/function stripFences\(t\) \{\n([\s\S]*?)\n\}/) || [])[1];
const sfB = (srcB.match(/function stripFences\(t\) \{\n([\s\S]*?)\n\}/) || [])[1];
check('T34 WIDE_OPENER_RE byte-identical across both files', !!reA && reA === reB, reA + ' vs ' + reB);
check('T35 stripFences body byte-identical across both files', !!sfA && sfA === sfB);

// Observed narrow forms still take the guard path under the bounded narrow regex.
r = run(LINTER, stopPayload(33, BLOCK_BODY + '**' + PIN + ' For you\n\nAsterisk-before-pin form, fresh turn.'));
check('T36 bounded narrow regex still releases observed forms', r.code === 0 && r.out === '' && lastEvent().event === 'release-clean');

console.log('\n' + (n - fails.length) + '/' + n + ' passed' + (fails.length ? '\nFAILURES:\n' + fails.join('\n') : ''));
process.exit(fails.length ? 1 : 0);
