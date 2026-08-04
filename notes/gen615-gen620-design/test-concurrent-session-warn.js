// Verification harness for concurrent-session-warn.js — design-v7.md §6 phase A.
//
// Builds a throwaway CONCSESS_TEST_ROOT with a fabricated session registry, presence map and
// edit log, pipes hook payloads into the real hook as a child process, and asserts on what it
// injects. Nothing here touches ~/.claude — that is the whole point of the test root, since
// the real auto-approved-edits.jsonl is read by a standing reporting rule.
//
// Run: node test-concurrent-session-warn.js

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOK = path.join(__dirname, 'concurrent-session-warn.js');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'concsess-test-'));
const SESSIONS = path.join(ROOT, 'sessions');
const HOOKS = path.join(ROOT, 'hooks');

const SELF = 'aaaaaaaa-0000-0000-0000-000000000001';
const OTHER = 'bbbbbbbb-0000-0000-0000-000000000002';
const DEAD = 'cccccccc-0000-0000-0000-000000000003';

const PROJECT = path.join(ROOT, 'proj');
const SUBDIR = path.join(PROJECT, 'notes');
const OTHER_PROJECT = path.join(ROOT, 'proj2');

let pass = 0;
let fail = 0;

function reset(opts) {
  opts = opts || {};
  fs.rmSync(SESSIONS, { recursive: true, force: true });
  fs.rmSync(HOOKS, { recursive: true, force: true });
  fs.mkdirSync(SESSIONS, { recursive: true });
  fs.mkdirSync(HOOKS, { recursive: true });
  fs.mkdirSync(SUBDIR, { recursive: true });
  fs.mkdirSync(OTHER_PROJECT, { recursive: true });

  const now = Date.now();
  if (!opts.noSelfFile) {
    const self = {
      pid: process.pid, sessionId: SELF, startedAt: now - 3600e3,
      name: 'test-self', kind: 'interactive',
    };
    if (!opts.selfMissingCwd) self.cwd = PROJECT;
    if (opts.badSelfPid) self.pid = 'not-a-pid';
    fs.writeFileSync(path.join(SESSIONS, '1001.json'), JSON.stringify(self));
  }
  if (!opts.noOtherFile) {
    const other = {
      pid: process.pid, sessionId: OTHER, cwd: opts.otherCwd || PROJECT,
      name: 'test-other', kind: 'interactive',
    };
    if (!opts.otherNoStartedAt) other.startedAt = now - (opts.otherAgeMs || 7200e3);
    fs.writeFileSync(path.join(SESSIONS, '1002.json'), JSON.stringify(other));
  }
  if (opts.deadFile) {
    // A pid that cannot be running: max pid + 1 is not portable, so use a pid we know is free
    // by picking a very high value. If it happens to exist the test self-reports.
    fs.writeFileSync(path.join(SESSIONS, '1003.json'), JSON.stringify({
      pid: 4194303, sessionId: DEAD, cwd: PROJECT, startedAt: now - 7200e3, name: 'test-dead',
    }));
  }
  if (opts.mapRaw !== undefined) {
    fs.writeFileSync(path.join(HOOKS, 'session-tickets.json'), opts.mapRaw);
  } else if (opts.map) {
    fs.writeFileSync(path.join(HOOKS, 'session-tickets.json'), JSON.stringify(opts.map));
  }
  if (opts.editLog !== undefined) {
    fs.writeFileSync(path.join(HOOKS, 'auto-approved-edits.jsonl'), opts.editLog);
  }
  // Each case gets a fresh dedupe/marker file.
  const safe = SELF.replace(/[^A-Za-z0-9_-]/g, '');
  try { fs.rmSync(path.join(os.tmpdir(), 'claude-concsess-' + safe + '.json'), { force: true }); } catch (e) {}
}

function run(payload) {
  const out = execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    env: Object.assign({}, process.env, { CONCSESS_TEST_ROOT: ROOT }),
    encoding: 'utf8',
  });
  if (!out || !out.trim()) return '';
  try {
    return JSON.parse(out).hookSpecificOutput.additionalContext || '';
  } catch (e) {
    return '<<UNPARSABLE HOOK OUTPUT: ' + out + '>>';
  }
}

function prompt(text, extra) {
  return Object.assign({
    hook_event_name: 'UserPromptSubmit', session_id: SELF, cwd: PROJECT, prompt: text,
  }, extra || {});
}

function toolCall(file, tool, extra) {
  return Object.assign({
    hook_event_name: 'PreToolUse', session_id: SELF, cwd: PROJECT,
    tool_name: tool || 'Read', tool_input: { file_path: file },
  }, extra || {});
}

function check(name, got, expect) {
  const ok = expect(got);
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '\n        got: ' + JSON.stringify(got).slice(0, 400)); }
}

const has = s => got => typeof got === 'string' && got.indexOf(s) !== -1;
const silent = () => got => got === '';
const mapNow = () => {
  try { return JSON.parse(fs.readFileSync(path.join(HOOKS, 'session-tickets.json'), 'utf8')); }
  catch (e) { return null; }
};
const editEntry = (sid, file, agoMs) =>
  JSON.stringify({ ts: new Date(Date.now() - agoMs).toISOString(), tool: 'Edit', file: file, existed: true, session: sid });

console.log('test root: ' + ROOT + '\n');

// ---------------------------------------------------------------- ticket half

console.log('ticket half');

reset({});
check('lowercase cue and two ids both register',
  run(prompt('look at gen 615 and GEN-620 please')),
  silent()); // no other session has them yet -> silent, but both must be recorded
check('  ...both ids in the map',
  mapNow(),
  m => !!m && !!m[SELF] && typeof m[SELF].tickets['GEN-615'] === 'number' && typeof m[SELF].tickets['GEN-620'] === 'number');

reset({ map: { [OTHER]: { tickets: { 'GEN-615': Date.now() - 8 * 60e3 } } } });
check('warns when a live other session named the same ticket',
  run(prompt('working on GEN-615')),
  has('GEN-615'));

reset({ map: { [OTHER]: { tickets: { 'GEN-615': Date.now() - 8 * 60e3 } } } });
check('  ...names the other session and its pid',
  run(prompt('working on gen 615')),
  has('test-other'));

reset({ map: { [DEAD]: { tickets: { 'GEN-615': Date.now() - 8 * 60e3 } } }, deadFile: true });
check('silent for a dead session\'s registration',
  run(prompt('working on GEN-615')),
  silent());
check('  ...and that entry is pruned',
  mapNow(),
  m => !!m && !m[DEAD]);

reset({ map: { [OTHER]: { tickets: { 'GEN-615': Date.now() - 26 * 3600e3 } } } });
check('no age expiry: day-old registration still warns',
  run(prompt('GEN-615 again')),
  has('GEN-615'));

reset({ map: { [OTHER]: { tickets: { 'GEN-615': Date.now() - 8 * 60e3 } } } });
run(prompt('GEN-615 first mention'));
check('dedupe: same overlap warns once',
  run(prompt('GEN-615 second mention')),
  silent());

reset({ map: { [SELF]: { tickets: { 'GEN-443': Date.now() - 60e3 } } } });
run(prompt('now something unrelated'));
check('self-preservation: own registration survives prompts naming no ticket',
  mapNow(),
  m => !!m && !!m[SELF] && typeof m[SELF].tickets['GEN-443'] === 'number');

reset({ map: { [OTHER]: { tickets: { 'GEN-615': Date.now() - 8 * 60e3 } } }, otherCwd: OTHER_PROJECT });
check('cross-project: same ticket in a different project folder still warns',
  run(prompt('GEN-615')),
  has('GEN-615'));

reset({});
check('first run with no map: works, no degraded note',
  run(prompt('GEN-615')),
  silent());
check('  ...and the map was created',
  mapNow(),
  m => !!m && !!m[SELF]);

reset({ mapRaw: '{ this is not json' });
check('malformed map: degraded note',
  run(prompt('GEN-615')),
  has('degraded'));
check('  ...and the file is left untouched',
  fs.readFileSync(path.join(HOOKS, 'session-tickets.json'), 'utf8'),
  s => s === '{ this is not json');

reset({ noSelfFile: true });
check('self absent: degraded note',
  run(prompt('GEN-615')),
  has('no record'));
check('  ...and the presence map is not modified',
  mapNow(),
  m => m === null);

reset({ selfMissingCwd: true });
check('self record incomplete: degraded note',
  run(prompt('GEN-615')),
  has('missing a field'));

reset({ noSelfFile: true, noOtherFile: true });
check('no parsable session files: degraded note',
  run(prompt('GEN-615')),
  has('degraded'));

// ---------------------------------------------------------------- folder half

console.log('\nfolder half');

const target = path.join(SUBDIR, 'mine.md');
const theirs = path.join(SUBDIR, 'theirs.md');

reset({ editLog: editEntry(OTHER, theirs, 4 * 60e3) + '\n' });
check('warns on a read in a folder a live session wrote in',
  run(toolCall(target)),
  has('theirs.md'));

reset({ editLog: editEntry(OTHER, theirs, 4 * 60e3) + '\n' });
run(toolCall(target));
check('dedupe: second read in the same folder is silent',
  run(toolCall(target)),
  silent());

reset({ editLog: editEntry(OTHER, theirs, 4 * 60e3) + '\n' });
check('sub-agent read does not consume the parent slot (sub-agent warns)',
  run(toolCall(target, 'Read', { agent_id: 'agent-1' })),
  has('theirs.md'));
check('  ...and the parent still warns afterwards',
  run(toolCall(target)),
  has('theirs.md'));

reset({ editLog: editEntry(OTHER, path.join(PROJECT, 'HISTORY.md'), 4 * 60e3) + '\n' });
check('HISTORY.md is ignored',
  run(toolCall(path.join(PROJECT, 'CLAUDE.md'))),
  silent());

reset({ editLog: editEntry(OTHER, path.join(PROJECT, 'other', 'x.md'), 4 * 60e3) + '\n' });
fs.mkdirSync(path.join(PROJECT, 'other'), { recursive: true });
check('a different subfolder in the same project is silent',
  run(toolCall(target)),
  silent());

reset({ editLog: editEntry(OTHER, theirs, 4 * 60e3) + '\n', otherCwd: OTHER_PROJECT });
check('cross-cwd writer: warns even though the writer\'s cwd is another project',
  run(toolCall(target)),
  has('theirs.md'));

reset({ editLog: editEntry(SELF, theirs, 4 * 60e3) + '\n' });
check('own writes never self-warn',
  run(toolCall(target)),
  silent());

reset({ editLog: editEntry(DEAD, theirs, 4 * 60e3) + '\n', deadFile: true });
check('a dead session\'s writes are silent',
  run(toolCall(target)),
  silent());

reset({ editLog: 'not json\nalso not json\n' });
check('unparsable log window: degraded note, not silence',
  run(toolCall(target)),
  has('no parsable entries'));

reset({ editLog: editEntry(OTHER, path.join('C:\\Elsewhere', 'x.md'), 4 * 60e3) + '\n' });
check('a write outside my cwd is silent',
  run(toolCall(path.join('C:\\Elsewhere', 'y.md'))),
  silent());

// Cap binding. The other session must have started LONG before anything in the log, so the
// 256 KB tail genuinely cannot reach back to its start — otherwise the window covers the whole
// relevant period and there is nothing to report.
reset({ otherAgeMs: 30 * 24 * 3600e3 });
const filler = [];
for (let i = 0; i < 2600; i++) filler.push(editEntry(OTHER, path.join(PROJECT, 'other', 'o' + i + '.md'), 3 * 3600e3));
fs.writeFileSync(path.join(HOOKS, 'auto-approved-edits.jsonl'), filler.join('\n') + '\n');
check('cap binding with no hit in THIS folder: no false cap note',
  run(toolCall(target)),
  silent());

reset({ otherAgeMs: 30 * 24 * 3600e3 });
const filler2 = [];
for (let i = 0; i < 2600; i++) filler2.push(editEntry(OTHER, path.join(PROJECT, 'other', 'o' + i + '.md'), 3 * 3600e3));
filler2.push(editEntry(OTHER, theirs, 60e3));
fs.writeFileSync(path.join(HOOKS, 'auto-approved-edits.jsonl'), filler2.join('\n') + '\n');
const capOut = run(toolCall(target));
check('cap binding: a warning still fires from the retained tail',
  capOut,
  has('theirs.md'));
check('  ...and the cap note rides along rather than being swallowed',
  capOut,
  has('cap'));

// ---------------------------------------------------------------- notes and logging

console.log('\nnotes and logging');

reset({ noSelfFile: true });
run(toolCall(target));
check('degraded note is throttled once per session on the tool path',
  run(toolCall(target)),
  silent());

reset({ noSelfFile: true });
run(toolCall(target));
check('degraded note lands a line in the warnings log',
  fs.existsSync(path.join(HOOKS, 'concurrent-session-warnings.jsonl'))
    ? fs.readFileSync(path.join(HOOKS, 'concurrent-session-warnings.jsonl'), 'utf8')
    : '',
  s => /"kind":"degraded"/.test(s));

reset({ noSelfFile: true });
check('no note inside a sub-agent (no path to Erez)',
  run(toolCall(target, 'Read', { agent_id: 'agent-1' })),
  silent());

reset({ map: { [OTHER]: { tickets: { 'GEN-615': Date.now() - 8 * 60e3 } } } });
run(prompt('GEN-615'));
check('warning lands a line in the warnings log',
  fs.readFileSync(path.join(HOOKS, 'concurrent-session-warnings.jsonl'), 'utf8'),
  s => /"kind":"warning"/.test(s) && /"half":"ticket"/.test(s));

reset({});
check('non-file tool is ignored',
  run(toolCall(target, 'Bash')),
  silent());

// Findings fixed after the /code-review pass — each gets its own regression case.

reset({ editLog: editEntry(OTHER, theirs, 4 * 60e3) + '\n' });
check('MultiEdit triggers the folder half (the edit log records MultiEdit)',
  run(toolCall(target, 'MultiEdit')),
  has('theirs.md'));

// Reaching the old lastFile-stays-null crash needs BOTH an epoch-zero ts AND a session record
// with no startedAt — otherwise the "since that session started" filter drops the row first.
reset({
  otherNoStartedAt: true,
  editLog: JSON.stringify({ ts: '1970-01-01T00:00:00.000Z', tool: 'Edit', file: theirs, existed: true, session: OTHER }) + '\n',
});
check('an epoch-zero timestamp does not crash the folder half',
  run(toolCall(target)),
  has('theirs.md'));

reset({ badSelfPid: true });
check('an unusable self pid reports incomplete, not absent',
  run(toolCall(target)),
  has('missing a field'));

reset({});
check('malformed stdin fails open',
  (function () {
    const out = execFileSync(process.execPath, [HOOK], {
      input: 'not json at all',
      env: Object.assign({}, process.env, { CONCSESS_TEST_ROOT: ROOT }),
      encoding: 'utf8',
    });
    return out;
  })(),
  s => !s || !s.trim());

// ---------------------------------------------------------------- concurrency

// The sequential cases above cannot enter the read-modify-write window the atomic write
// exists to close, so drive real concurrent invocations from distinct sessions. The strong
// invariant is that the map is never left truncated or unparsable; entry survival is the
// lost-update window the design accepts as vanishingly narrow.
console.log('\nconcurrency');

reset({});
const RACERS = 6;
const racerIds = [];
for (let i = 0; i < RACERS; i++) {
  const sid = 'dddddddd-0000-0000-0000-0000000000' + String(10 + i);
  racerIds.push(sid);
  fs.writeFileSync(path.join(SESSIONS, '20' + (10 + i) + '.json'), JSON.stringify({
    pid: process.pid, sessionId: sid, cwd: PROJECT,
    startedAt: Date.now() - 600e3, name: 'racer-' + i, kind: 'interactive',
  }));
}
const { spawn } = require('child_process');
let done = 0;
for (let i = 0; i < RACERS; i++) {
  const child = spawn(process.execPath, [HOOK], {
    env: Object.assign({}, process.env, { CONCSESS_TEST_ROOT: ROOT }),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.end(JSON.stringify({
    hook_event_name: 'UserPromptSubmit', session_id: racerIds[i], cwd: PROJECT,
    prompt: 'all of us are on GEN-999',
  }));
  child.on('close', function () {
    done++;
    if (done === RACERS) finishRace();
  });
}

function finishRace() {
  const m = mapNow();
  check('concurrent writes never corrupt the map', m, x => x !== null && typeof x === 'object');
  const survived = m ? racerIds.filter(id => m[id] && m[id].tickets && m[id].tickets['GEN-999']).length : 0;
  check('concurrent writes: all ' + RACERS + ' registrations survive the merge',
    survived, n => n === RACERS);

  // ------------------------------------------------------------ cost of the folder half
  // This runs on every Read/Edit/Write, so the per-call cost is a real tax. Measure it
  // against a full-size log rather than a toy one.
  reset({});
  const bulk = [];
  for (let i = 0; i < 1400; i++) bulk.push(editEntry(OTHER, path.join(PROJECT, 'other', 'b' + i + '.md'), 60e3));
  fs.writeFileSync(path.join(HOOKS, 'auto-approved-edits.jsonl'), bulk.join('\n') + '\n');
  const N = 10;
  const t0 = Date.now();
  for (let i = 0; i < N; i++) run(toolCall(target));
  const perCall = (Date.now() - t0) / N;
  console.log('  INFO  folder half: ~' + perCall.toFixed(0) + ' ms per call including node startup, over a ' +
    (fs.statSync(path.join(HOOKS, 'auto-approved-edits.jsonl')).size / 1024).toFixed(0) + ' KB log');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail ? 1 : 0);
}

// The synchronous summary below is unreachable once the race is scheduled; finishRace() owns
// the exit. Kept only so a future edit that removes the race still reports.
return;

try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
