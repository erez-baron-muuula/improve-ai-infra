// End-to-end live-fire of the working copy + the file's own MAINTENANCE fixture
// ("the guard's own reason strings must never match any pattern" -- the
// MAINTENANCE note in the hook's header).
// REPOINTED 2026-08-09 (GEN-467 fix pass): WORK now targets the REAL working
// copy in the gen467-holistic-fix apply set -- the old __dirname-relative
// working.js was a stale local copy that silently diverged from what would
// ship. NOTE: the hook's logs are written relative to ITS __dirname, so runs
// deposit *.jsonl files beside the working copy. This script now removes those
// itself (see SELF-CLEAN at the bottom) -- deleting ONLY what the run deposited,
// measured against a snapshot taken before the first run.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const F = require('./fixtures.js');

const WORK = path.resolve(__dirname, '..', '..', 'gen467-holistic-fix', 'working', 'stop-claim-linter.js');
// Pre-run snapshot, for the SELF-CLEAN at the bottom of this file. Taken BEFORE any
// run so the cleanup can delete only what THIS run deposited. Do NOT replace this with
// an unconditional wildcard delete of *.jsonl in the directory: that also removes
// pre-existing evidence banked beside the apply set, and the blast radius follows WORK,
// which has already been repointed once (see the header). Repointed at the installed
// hook it would put ~/.claude/hooks/*.jsonl in range -- foryou-guard-events.jsonl (the
// evidence base for every GEN-467 bar), signal-surface-pending.jsonl,
// selfaudit-nudges.jsonl, and auto-approved-edits.jsonl (which a standing global rule
// requires reading each turn to report silent project edits).
const PRE_EXISTING_LOGS = new Set(
  fs.readdirSync(path.dirname(WORK)).filter(f => f.endsWith('.jsonl'))
);
function run(payload) {
  const out = execFileSync(process.execPath, [WORK], {
    input: JSON.stringify(payload), encoding: 'utf8',
  });
  return out;
}
function ctxOf(out) {
  if (!out.trim()) return null;
  const o = JSON.parse(out);
  return (o.hookSpecificOutput && o.hookSpecificOutput.additionalContext) || o.additionalContext || null;
}

// The hook dedups per (session_id, prompt_id) in a state dir under os.tmpdir() that
// PERSISTS between runs, so the nonce is required -- without it a second run of this
// script is silently deduped and reads as a false FAIL.
let n = 0;
const RUN = process.pid + '-' + Date.now();
const uid = () => 'gen557test' + RUN + '-' + (++n);
const cases = [
  ['mustFire', F.mustFire, true],
  ['mustStaySilentStatus', F.mustStaySilentStatus, false],
  ['mustStaySilentQuoting', F.mustStaySilentQuoting, false],
  ['mustStaySilentApplied', F.mustStaySilentApplied, false],
  ['mustStaySilentSelfCorrect', F.mustStaySilentSelfCorrect, false],
];
let injected = null;
console.log('--- live-fire through the real hook process ---');
for (const [name, text, wantFire] of cases) {
  const out = run({ last_assistant_message: text, session_id: uid(), prompt_id: uid() });
  const ctx = ctxOf(out);
  const fired = !!(ctx && /Self-audit, automatic/.test(ctx));
  if (fired && !injected) injected = ctx;
  console.log('  ' + (fired === wantFire ? 'PASS' : 'FAIL') + '  ' + name +
              ' -> ' + (fired ? 'nudge injected' : 'silent'));
}

// MAINTENANCE fixture: no pattern may match the hook's own injected strings.
const START = 'const SELF_AUDIT_PATTERNS = [';
const END = '// Durable, append-only log of self-audit detections';
const src = fs.readFileSync(WORK, 'utf8');
const findSelfAudit = new Function(src.slice(src.indexOf(START), src.indexOf(END)) + '\n; return findSelfAudit;')();
// arm1Reason: extracted from the working copy and invoked, not retyped.
const a1 = src.indexOf('function arm1Reason() {');
const a1end = src.indexOf('\n}', a1);
const arm1Reason = new Function(src.slice(a1, a1end + 2) + '\n; return arm1Reason;')();

console.log('\n--- MAINTENANCE guard-reason fixture (the hook header\'s MAINTENANCE note) ---');
const targets = [['arm1Reason()', arm1Reason()]];
if (injected) targets.push(['the self-audit nudge text it injects', injected]);
for (const [label, t] of targets) {
  const hits = findSelfAudit(t);
  console.log('  ' + (hits.length === 0 ? 'PASS' : 'FAIL') + '  ' + label +
              (hits.length ? ' -> MATCHES ' + JSON.stringify(hits) : ' -> no pattern matches'));
}
// SELF-CLEAN (2026-08-10; NARROWED same day after code review): the hook writes its
// logs relative to ITS __dirname, depositing them beside the apply-set working copy --
// stale test logs there would pollute combined.diff regeneration. Delete only the set
// difference against PRE_EXISTING_LOGS (snapshotted before the first run), never every
// *.jsonl in the directory: the first form could not tell what this run wrote from what
// was already there, while claiming in its own output that it had.
const nowLogs = fs.readdirSync(path.dirname(WORK)).filter(f => f.endsWith('.jsonl'));
const deposited = nowLogs.filter(f => !PRE_EXISTING_LOGS.has(f));
for (const f of deposited) { fs.unlinkSync(path.join(path.dirname(WORK), f)); }
const keptLogs = nowLogs.filter(f => PRE_EXISTING_LOGS.has(f));
console.log('\nlogs deposited by THIS run and self-cleaned: ' +
  (deposited.join(', ') || '(none)') +
  (keptLogs.length ? '\npre-existing *.jsonl left untouched: ' + keptLogs.join(', ') : ''));
