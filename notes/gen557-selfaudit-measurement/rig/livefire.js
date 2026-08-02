// End-to-end live-fire of the working copy + the file's own MAINTENANCE fixture
// ("the guard's own reason strings must never match any pattern", hook lines 47-54).
// Runs working.js as a real Stop hook over stdin. Its logs are __dirname-relative,
// so they land in this scratchpad, never in ~/.claude/hooks/.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const F = require('./fixtures.js');

const WORK = path.join(__dirname, 'working.js');
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

console.log('\n--- MAINTENANCE guard-reason fixture (hook lines 47-54) ---');
const targets = [['arm1Reason()', arm1Reason()]];
if (injected) targets.push(['the self-audit nudge text it injects', injected]);
for (const [label, t] of targets) {
  const hits = findSelfAudit(t);
  console.log('  ' + (hits.length === 0 ? 'PASS' : 'FAIL') + '  ' + label +
              (hits.length ? ' -> MATCHES ' + JSON.stringify(hits) : ' -> no pattern matches'));
}
console.log('\nlogs written by this run (scratchpad, not ~/.claude/hooks): ' +
  fs.readdirSync(__dirname).filter(f => f.endsWith('.jsonl') && f !== 'corpus.jsonl').join(', '));
