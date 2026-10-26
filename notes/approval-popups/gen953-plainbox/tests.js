// GEN-953 step 1 tests: unit checks of planOpensPlain, integration through the
// real stdin/exit-code path in a fixture hooks folder, and a realism replay of
// every plan file in ~/.claude/plans against the live baseline.
// Usage: node tests.js            (unit + integration)
//        node tests.js --replay   (also the plan-corpus replay)
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const LIVE_HOOKS = path.join(os.homedir(), '.claude', 'hooks');
const PLANS = path.join(os.homedir(), '.claude', 'plans');

// Fixture folders: each holds a hook copy plus the Stop hook it requires, so
// the guide loads as in production and logs land in the fixture, not the live log.
function fixture(name, hookSource) {
  const dir = path.join(HERE, 'fixture', name, 'hooks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pretooluse-effort-tag-gate.js'), fs.readFileSync(hookSource));
  fs.writeFileSync(path.join(dir, 'stop-foryou-nudge.js'), fs.readFileSync(path.join(LIVE_HOOKS, 'stop-foryou-nudge.js')));
  const log = path.join(dir, 'effort-tag-gate.jsonl');
  try { fs.unlinkSync(log); } catch (e) { /* none */ }
  return { hook: path.join(dir, 'pretooluse-effort-tag-gate.js'), log: log };
}
const NEW = fixture('new', path.join(HERE, 'wc', 'pretooluse-effort-tag-gate.js'));
const OLD = fixture('old', path.join(HERE, 'live-baseline.js'));
// The fixture copy needs the reference file the guide reads; buildEffortReference
// resolves it from its own path, so a missing file falls back -- record which.

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) pass++; else { fail++; console.log('FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}

let seq = 0;
const RUN = 'gen953t-' + Date.now();
function run(fx, payload) {
  const r = spawnSync(process.execPath, [fx.hook], { input: JSON.stringify(payload), encoding: 'utf8', timeout: 15000 });
  return { code: r.status, err: r.stderr || '', out: r.stdout || '' };
}
function plan(text, opts) {
  opts = opts || {};
  return {
    hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode',
    session_id: opts.session || (RUN + '-' + (++seq)), prompt_id: opts.prompt || 'p1',
    tool_input: opts.path ? { planFilePath: opts.path } : { plan: text }
  };
}
function lastLog(fx) {
  const lines = fs.readFileSync(fx.log, 'utf8').trim().split('\n');
  return JSON.parse(lines[lines.length - 1]);
}

// ---------------- unit ----------------
const M = require(path.join(HERE, 'wc', 'pretooluse-effort-tag-gate.js'));
const P = M.planOpensPlain;
const U = [
  ['# T\n\n## In plain words (for Erez)\nx', true],
  ['# T\n## In plain terms\nx', true],
  ['# T\n## Context (plain language)\n', true],
  ['# T\n## How it works for Erez\n', true],
  ['## In plain words\nx', true],
  ['# In plain words\n## Context\n', true],
  ['# T\n## Context\n## In plain words\n', false],
  ['# T\nintro text\n', false],
  ['', false],
  ['# T\n**Tickets**\n## Context (plain language)\n', true],
  ['# T\n**Effort to execute: xhigh**\n## In plain terms\n', true],
  ['# T\n**In plain words**\ntext\n## Context\n', true],
  ['# T\n```\n## In plain words\n```\n## Context\n', false],
  ['# T\n~~~~\n## Context\n~~~\n## still fenced\n~~~~\n## In plain terms\n', true],
  ['# T\r\n\r\n## In plain words\r\n', true],
  ["# T\n## Steps (each waits for Erez's OK)\n", false],
  ['# T\n## Steps (each waits for Erez’s OK)\n', false],
  ['# T\n## Assumptions for Erez to confirm\n', false],
  ['# T\n## What this means for Erez\n', true],
  ['# T\n# Part 1 - In plain terms\n', true],
  ['# T\n# Part 1 - Context\n', false],
  ['    ## In plain words (indented code)\n# T\n## Context\n', false],
  ['#Title-no-space\n## In plain words\n', true],
  ['# ' + 'L'.repeat(320) + '\n# Part 1 - Context\n## In plain words\n', false],
  ['# ' + 'L'.repeat(320) + '\n## In plain words\n', true],
  ['# T\n## Put plainly\n', true],
  ['# T\n```\ncode\n```js\n## In plain words\n```\n## Context\n', false],
  ['# T\n```x``` inline\n## In plain words\n', true],
  ['# T\r\r\n## In plain words\r\r\n', true],
  ['# T\n## In plain words extra\n', true],
  ['# T\n## Context \n## In plain words\n', false]
];
U.forEach((c, i) => ok(P(c[0]) === c[1], 'unit ' + i + ' ' + JSON.stringify(c[0]).slice(0, 60), 'got ' + P(c[0])));
{
  const big = '# T\n**' + '** '.repeat(330000) + '\n## In plain words\n';
  const t0 = Date.now(); const v = P(big);
  ok(v === true && Date.now() - t0 < 500, 'long pathological line is fast', (Date.now() - t0) + ' ms');
}
ok(/In plain words \(for Erez\)/.test(M.planReason(['plain'], 'G')) && !/G$/.test(M.planReason(['plain'], 'G')), 'reason plain-only has ask, no guide');
ok(/Effort to execute/.test(M.planReason(['effort'], 'G')) && /G$/.test(M.planReason(['effort'], 'G')) && !/In plain words/.test(M.planReason(['effort'], 'G')), 'reason effort-only');
ok(/plain words and has no effort/.test(M.planReason(['effort', 'plain'], 'G')), 'reason both');
{
  const crs = '# T\n' + '\r'.repeat(400000) + '## Context\n## In plain words\n';
  const t0 = Date.now(); P(crs);
  ok(Date.now() - t0 < 500, 'long CR run is fast', (Date.now() - t0) + ' ms');
}
ok(/move your existing plain-words section there/.test(M.planReason(['plain'], 'G')), 'reason says move existing section');
{
  const big2 = '# T\n' + ('#  ' + ' '.repeat(290) + ' \n').repeat(3500) + '## In plain words\n';
  const t0 = Date.now(); const v = P(big2);
  ok(Date.now() - t0 < 1500, 'many U+2028 heading lines are fast', (Date.now() - t0) + ' ms, v=' + v);
}

// ---------------- integration ----------------
const GOOD = '# Plan\n\n## In plain words (for Erez)\nWhat changes...\n\nEffort to execute: high\n';
const NOPLAIN = '# Plan\n\n## Context\nstuff\n\nEffort to execute: high\n';
const NOEFFORT = '# Plan\n\n## In plain words\nstuff\n';
const NEITHER = '# Plan\n\n## Context\nstuff\n';

let r = run(NEW, plan(GOOD)); ok(r.code === 0 && !r.err, 'good plan passes', r.code + ' ' + r.err);
ok(lastLog(NEW).outcome === 'tagged', 'good plan logged tagged');

const s1 = RUN + '-retry';
r = run(NEW, plan(NOPLAIN, { session: s1 })); ok(r.code === 2 && /In plain words \(for Erez\)/.test(r.err) && !/Effort to execute/.test(r.err), 'no-plain blocked with plain ask', r.code + ' ' + r.err.slice(0, 200));
let L = lastLog(NEW); ok(L.outcome === 'blocked' && JSON.stringify(L.missing) === '["plain"]', 'no-plain log row', JSON.stringify(L));
r = run(NEW, plan(NOPLAIN, { session: s1 })); ok(r.code === 0, 'no-plain retry passes (block once)', r.code);
L = lastLog(NEW); ok(L.outcome === 'passed-after-deny' && JSON.stringify(L.missing) === '["plain"]', 'retry log row', JSON.stringify(L));
r = run(NEW, plan(NOPLAIN, { session: s1 })); ok(r.code === 2, 'later separate plan gated again', r.code);

r = run(NEW, plan(NOEFFORT)); ok(r.code === 2 && /Effort to execute/.test(r.err) && !/In plain words \(for/.test(r.err) && /Pick the level/.test(r.err), 'no-effort blocked with guide', r.err.slice(0, 200));
r = run(NEW, plan(NEITHER)); ok(r.code === 2 && /In plain words \(for Erez\)/.test(r.err) && /Effort to execute/.test(r.err), 'both missing: one combined refusal', r.err.slice(0, 200));
ok(JSON.stringify(lastLog(NEW).missing) === '["effort","plain"]', 'both missing log');

// planFilePath form, inside ~/.claude/plans (a real plan) and outside (unavailable).
const files = fs.readdirSync(PLANS).filter((f) => f.endsWith('.md'));
const sample = files.map((f) => path.join(PLANS, f)).find((p) => M.planOpensPlain(fs.readFileSync(p, 'utf8')) && M.planHasEffort(fs.readFileSync(p, 'utf8')));
if (sample) { r = run(NEW, plan(null, { path: sample })); ok(r.code === 0, 'planFilePath good plan passes', r.code + ' ' + r.err); }
r = run(NEW, plan(null, { path: path.join(HERE, 'design.md') })); ok(r.code === 0 && lastLog(NEW).outcome === 'plan-unavailable', 'plan path outside plans dir fails open');

// Sub-agent and other tools untouched.
const sub = plan(NEITHER); sub.agent_id = 'x'; r = run(NEW, sub); ok(r.code === 0 && lastLog(NEW).outcome === 'subagent', 'subagent skipped');
r = run(NEW, { hook_event_name: 'PreToolUse', tool_name: 'Read', session_id: RUN, tool_input: {} }); ok(r.code === 0 && !r.err, 'other tool ignored');
r = run(NEW, { not: 'json-shape' }); ok(r.code === 0, 'odd payload fails open');
const raw = spawnSync(process.execPath, [NEW.hook], { input: '{bad json', encoding: 'utf8' }); ok(raw.status === 0, 'bad json fails open');

// Box regression: same outcome old vs new.
const box = (labels) => ({ hook_event_name: 'PreToolUse', tool_name: 'mcp__ccd_turn__wrap_up', session_id: RUN + '-box-' + (++seq), prompt_id: 'p',
  tool_input: { recap: 'r', ask: 'Do it?', actions: labels.map((l) => ({ label: l, message: l })) } });
[[['Yes, do it'], 2], [['Yes (xhigh)', 'Not now'], 0], [['Not now'], 0]].forEach((c, i) => {
  const a = run(NEW, box(c[0])), b = run(OLD, box(c[0]));
  ok(a.code === c[1] && b.code === c[1] && a.err === b.err, 'box regression ' + i, a.code + '/' + b.code);
});

// PostToolUse after-box path unchanged.
const post = { hook_event_name: 'PostToolUse', tool_name: 'mcp__ccd_turn__wrap_up', session_id: RUN + '-post', tool_input: { recap: 'r', ask: 'q?' }, tool_response: {} };
const pa = run(NEW, post), pb = run(OLD, post);
ok(pa.code === 0 && pa.out === pb.out, 'after-box note identical', pa.out.slice(0, 80) + ' vs ' + pb.out.slice(0, 80));

console.log('unit+integration: ' + pass + ' passed, ' + fail + ' failed');

// ---------------- realism replay ----------------
if (process.argv.indexOf('--replay') !== -1) {
  const H = require(path.join(LIVE_HOOKS, 'pretooluse-effort-tag-gate.js'));
  const rows = [];
  let effortMismatch = 0;
  for (const f of files) {
    const text = fs.readFileSync(path.join(PLANS, f), 'utf8');
    const a = run(NEW, plan(text)), b = run(OLD, plan(text));
    const newMissing = a.code === 2 ? lastLog(NEW).missing : [];
    const oldBlocked = b.code === 2;
    if (oldBlocked !== (newMissing.indexOf('effort') !== -1)) { effortMismatch++; console.log('EFFORT-MISMATCH ' + f); }
    const plainAnywhere = /^ {0,3}#{1,6}[ \t]+.*(\bplain\b|\bfor Erez\b(?!['’]s\b|\s+to\b))/im.test(text);
    const firstHeads = text.split(/\r?\n/).filter((l) => /^ {0,3}#{1,6}\s|^\s*\*\*.+\*\*:?\s*$/.test(l)).slice(0, 3).join(' | ').slice(0, 140);
    rows.push({ f: f, code: a.code, missing: newMissing, plainAnywhere: plainAnywhere, heads: firstHeads, sameAsLive: H.planHasEffort(text) === !oldBlocked });
  }
  const plainFires = rows.filter((x) => x.missing.indexOf('plain') !== -1);
  console.log('replay: ' + rows.length + ' plans; plain fires ' + plainFires.length + ' (of which plain section lower down: ' +
    plainFires.filter((x) => x.plainAnywhere).length + '); effort mismatches vs live ' + effortMismatch);
  fs.writeFileSync(path.join(HERE, 'replay-fires.txt'), plainFires.map((x) => (x.plainAnywhere ? 'LOWER ' : 'NONE  ') + x.f + '  ::  ' + x.heads).join('\n') + '\n');
  fs.writeFileSync(path.join(HERE, 'replay-passes.txt'), rows.filter((x) => x.missing.indexOf('plain') === -1).map((x) => x.f + '  ::  ' + x.heads).join('\n') + '\n');
  console.log('lists: replay-fires.txt, replay-passes.txt');
}
process.exitCode = fail ? 1 : 0;
