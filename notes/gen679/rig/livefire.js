// GEN-679 Step-4 live-fire rig. Exercises the WORKING COPY of stop-signal-surface.js
// through its real caller shape (JSON Stop payload on stdin), asserts decisions from
// exit code + stdout + the durable-log rows the copy writes NEXT TO ITSELF (its
// __dirname-derived DURABLE_LOG lands in the working-copy dir, never the real log).
// Also runs a DIFFERENTIAL replay against a byte-identical baseline of the live hook
// (in rig/baseline/) over real transcript messages, and replays /wrap Step 3b's
// session+prompt pairing over the REAL Aug-3 orphan detect line + the fixture deliver
// row the new code produces for it (the ticket's acceptance criterion, observed
// literally). Self-cleaning: fixture markers + fixture logs are removed at start and
// end; the rig never writes outside os.tmpdir() fixture keys and the rig/scratch dirs.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RIG = __dirname;
const NEW_HOOK = path.join(RIG, '..', 'stop-signal-surface.js');
const NEW_LOG = path.join(RIG, '..', 'signal-surface-pending.jsonl');
const BASE_HOOK = path.join(RIG, 'baseline', 'stop-signal-surface.js');
const BASE_LOG = path.join(RIG, 'baseline', 'signal-surface-pending.jsonl');
const STATE_DIR = path.join(os.tmpdir(), 'claude-signal-surface-state');
const REAL_LOG = 'C:\\Users\\Erez\\.claude\\hooks\\signal-surface-pending.jsonl';
const PROJECTS = 'C:\\Users\\Erez\\.claude\\projects';
const FIX = 'gen679fix';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; } else { fail++; failures.push(name + (detail ? ' :: ' + detail : '')); }
}

function readRows(logPath) {
  try {
    return fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch (e) { return []; }
}
function clearLog(logPath) { try { fs.unlinkSync(logPath); } catch (e) {} }
function writeMarker(sid, pid, data) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(path.join(STATE_DIR, sid + '.' + pid), JSON.stringify(data));
}
function markerExists(sid, pid) { return fs.existsSync(path.join(STATE_DIR, sid + '.' + pid)); }
function sweepFixtureMarkers() {
  try {
    for (const f of fs.readdirSync(STATE_DIR)) if (f.startsWith(FIX)) fs.unlinkSync(path.join(STATE_DIR, f));
  } catch (e) {}
}
function runHook(hookPath, payload) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const r = spawnSync(process.execPath, [hookPath], { input, encoding: 'utf8', timeout: 15000 });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

sweepFixtureMarkers(); clearLog(NEW_LOG); clearLog(BASE_LOG);

// ---- Case 1: continuation turn + marker -> consumed, paired skipped-continuation, NO stdout
writeMarker(FIX + 'A', 'p1', { file: 'C:\\somewhere\\counter.js' });
let r = runHook(NEW_HOOK, { session_id: FIX + 'A', prompt_id: 'p1', stop_hook_active: true, last_assistant_message: 'built a log appender with appendFileSync' });
let rows = readRows(NEW_LOG);
ok('1 exit0', r.code === 0, 'code=' + r.code + ' err=' + r.err);
ok('1 no stdout', r.out === '', r.out.slice(0, 120));
ok('1 marker consumed', !markerExists(FIX + 'A', 'p1'));
ok('1 one row', rows.length === 1, 'rows=' + rows.length);
ok('1 row shape', rows.length === 1 && rows[0].kind === 'deliver' && rows[0].decision === 'skipped-continuation' &&
  rows[0].session === FIX + 'A' && rows[0].prompt === 'p1' && rows[0].file === 'C:\\somewhere\\counter.js',
  JSON.stringify(rows[0] || null));

// ---- Case 2: continuation turn, NO marker -> silent, no row
clearLog(NEW_LOG);
r = runHook(NEW_HOOK, { session_id: FIX + 'B', prompt_id: 'p1', stop_hook_active: true, last_assistant_message: 'plain' });
ok('2 exit0 silent', r.code === 0 && r.out === '');
ok('2 no row', readRows(NEW_LOG).length === 0);

// ---- Case 3 (regression): normal turn + marker + plain message -> nudge + row decision=nudge
clearLog(NEW_LOG);
writeMarker(FIX + 'C', 'p1', { file: 'C:\\somewhere\\counter.js' });
r = runHook(NEW_HOOK, { session_id: FIX + 'C', prompt_id: 'p1', stop_hook_active: false, last_assistant_message: 'I finished the refactor and committed it.' });
rows = readRows(NEW_LOG);
ok('3 nudge stdout', r.code === 0 && r.out.includes('Signal-surfacing check') && r.out.includes('hookEventName'), r.out.slice(0, 80));
ok('3 row nudge', rows.length === 1 && rows[0].decision === 'nudge', JSON.stringify(rows[0] || null));
ok('3 marker consumed', !markerExists(FIX + 'C', 'p1'));

// ---- Case 4 (regression): normal turn + marker + surfacing-designed message -> cleared, no stdout
clearLog(NEW_LOG);
writeMarker(FIX + 'D', 'p1', { file: 'C:\\somewhere\\counter.js' });
r = runHook(NEW_HOOK, { session_id: FIX + 'D', prompt_id: 'p1', last_assistant_message: 'The new counter is read at /wrap: who reads it is settled there.' });
rows = readRows(NEW_LOG);
ok('4 cleared silent', r.code === 0 && r.out === '');
ok('4 row cleared', rows.length === 1 && rows[0].decision === 'cleared-surfacing-designed', JSON.stringify(rows[0] || null));

// ---- Case 5 (regression): normal turn + marker + block-carrying message -> suppressed-block-out, no stdout
clearLog(NEW_LOG);
writeMarker(FIX + 'E', 'p1', { file: 'C:\\somewhere\\counter.js' });
r = runHook(NEW_HOOK, { session_id: FIX + 'E', prompt_id: 'p1', last_assistant_message: 'Done.\n\n\uD83D\uDCCC For you\n\nThe result is X.' });
rows = readRows(NEW_LOG);
ok('5 suppressed silent', r.code === 0 && r.out === '');
ok('5 row suppressed', rows.length === 1 && rows[0].decision === 'suppressed-block-out', JSON.stringify(rows[0] || null));

// ---- Case 6: malformed stdin -> fail-open, silent, no row
clearLog(NEW_LOG);
r = runHook(NEW_HOOK, 'this is not json {{{');
ok('6 failopen', r.code === 0 && r.out === '');
ok('6 no row', readRows(NEW_LOG).length === 0);

// ---- Case 7: guard precedence -- continuation + marker + message that would BOTH nudge and carry a block
clearLog(NEW_LOG);
writeMarker(FIX + 'G', 'p1', { file: 'C:\\somewhere\\counter.js' });
r = runHook(NEW_HOOK, { session_id: FIX + 'G', prompt_id: 'p1', stop_hook_active: true, last_assistant_message: 'Done.\n\n\uD83D\uDCCC For you\n\nresult' });
rows = readRows(NEW_LOG);
ok('7 skipped wins', r.code === 0 && r.out === '' && rows.length === 1 && rows[0].decision === 'skipped-continuation', JSON.stringify(rows[0] || null));

// ---- Case 8: weird field types (fail-open discipline) -- numeric ids, null message
clearLog(NEW_LOG);
r = runHook(NEW_HOOK, { session_id: 12345, prompt_id: null, stop_hook_active: true });
ok('8 weird types silent', r.code === 0 && r.out === '');

// ---- Case 10: unlink-failure path (marker is a DIRECTORY: read throws EISDIR into
// the inner catch, unlink throws EPERM into the outer catch) -> markerData reset:
// NO row, NO stdout, marker dir survives. Exercised on BOTH branch flavors.
for (const cont of [true, false]) {
  clearLog(NEW_LOG);
  const sid = FIX + (cont ? 'U1' : 'U2');
  const dirMarker = path.join(STATE_DIR, sid + '.p1');
  fs.mkdirSync(dirMarker, { recursive: true });
  r = runHook(NEW_HOOK, { session_id: sid, prompt_id: 'p1', stop_hook_active: cont, last_assistant_message: 'built a log with appendFileSync' });
  ok('10 unlink-fail silent (cont=' + cont + ')', r.code === 0 && r.out === '');
  ok('10 unlink-fail no row (cont=' + cont + ')', readRows(NEW_LOG).length === 0);
  ok('10 unlink-fail marker survives (cont=' + cont + ')', fs.existsSync(dirMarker));
  try { fs.rmdirSync(dirMarker); } catch (e) {}
}

// ---- Case 11: falsy-but-valid JSON marker (literal null) -> consumed AND paired
// with file '(unknown)' on both branches (the coercion fix).
clearLog(NEW_LOG);
fs.mkdirSync(STATE_DIR, { recursive: true });
fs.writeFileSync(path.join(STATE_DIR, FIX + 'F1.p1'), 'null');
r = runHook(NEW_HOOK, { session_id: FIX + 'F1', prompt_id: 'p1', stop_hook_active: true, last_assistant_message: 'x' });
rows = readRows(NEW_LOG);
ok('11 null marker cont: consumed+paired', r.code === 0 && r.out === '' && !markerExists(FIX + 'F1', 'p1') &&
  rows.length === 1 && rows[0].decision === 'skipped-continuation' && rows[0].file === '(unknown)', JSON.stringify(rows[0] || null));
clearLog(NEW_LOG);
fs.writeFileSync(path.join(STATE_DIR, FIX + 'F2.p1'), 'null');
r = runHook(NEW_HOOK, { session_id: FIX + 'F2', prompt_id: 'p1', stop_hook_active: false, last_assistant_message: 'I finished the refactor.' });
rows = readRows(NEW_LOG);
ok('11 null marker normal: consumed+paired+nudge', r.code === 0 && r.out.includes('Signal-surfacing check') &&
  rows.length === 1 && rows[0].decision === 'nudge' && rows[0].file === '(unknown)', JSON.stringify(rows[0] || null));

// ---- Case 12: /wrap Step-3b extended-reader replay -- un-acked skipped-continuation
// rows report; a matching ack (session+prompt+file) retires; orphan detects still
// report; masked-paired detects still close.
{
  const D = (s, p, f) => ({ kind: 'detect', session: s, prompt: p, file: f });
  const V = (s, p, f, d) => ({ kind: 'deliver', session: s, prompt: p, file: f, decision: d });
  const A = (s, p, f) => ({ kind: 'ack', session: s, prompt: p, file: f });
  const report = all => {
    const orphans = all.filter(x => x.kind === 'detect' &&
      !all.some(v => v.kind === 'deliver' && v.session === x.session && v.prompt === x.prompt) &&
      !all.some(a => a.kind === 'ack' && a.session === x.session && a.prompt === x.prompt && a.file === x.file));
    const unsurfaced = all.filter(x => x.kind === 'deliver' && x.decision === 'skipped-continuation' &&
      !all.some(a => a.kind === 'ack' && a.session === x.session && a.prompt === x.prompt && a.file === x.file));
    return { orphans, unsurfaced };
  };
  const log1 = [D('s1', 'p1', 'a.js'), V('s1', 'p1', 'a.js', 'skipped-continuation')];
  const r1 = report(log1);
  ok('12 un-acked skipped-cont reports', r1.orphans.length === 0 && r1.unsurfaced.length === 1);
  const log2 = log1.concat([A('s1', 'p1', 'a.js')]);
  const r2 = report(log2);
  ok('12 acked skipped-cont retired', r2.unsurfaced.length === 0);
  const log3 = [D('s2', 'p1', 'b.js')];
  const r3 = report(log3);
  ok('12 orphan detect still reports', r3.orphans.length === 1);
  const log4 = [D('s3', 'p1', 'c.js'), V('s3', 'p1', 'c.js', 'nudge')];
  const r4 = report(log4);
  ok('12 nudged detect closed, no unsurfaced', r4.orphans.length === 0 && r4.unsurfaced.length === 0);
}

// ---- ACCEPTANCE replay (ticket bar): the continuation-ONLY bug class ----
// The bug manifests when a turn's ONLY signal build happens in a continuation: no
// deliver row ever exists for that (session,prompt) key, so /wrap Step 3b (pairing
// by session+prompt) reports the detect as a crash-orphan forever. Replay Step 3b
// literally, before and after: [detect alone] must read UNPAIRED (the pre-fix
// state); [detect + the deliver row the NEW hook writes for that continuation]
// must read PAIRED. The real Aug-3 detect (session f00041c7..., prompt 0ed597c4...,
// file auto-approve.working.js) supplies the real-world field values; its live-log
// twin turned out to be MASKED-paired by a same-key deliver for a different file
// (Step 3b keys on session+prompt only), so the pre-state is reconstructed with a
// fixture key rather than asserted on the live log. Informational: the live-log
// pairing state of that line is printed, not asserted.
const realRows = readRows(REAL_LOG);
const seed = realRows.find(x => x.kind === 'detect' && x.session && String(x.session).startsWith('f00041c7') && String(x.prompt).startsWith('0ed597c4') && /auto-approve\.working\.js/.test(String(x.file)));
ok('9 real Aug-3 detect exists in live log', !!seed, 'not found');
if (seed) {
  const liveMasked = realRows.some(x => x.kind === 'deliver' && x.session === seed.session && x.prompt === seed.prompt);
  console.log('INFO: live-log state of the Aug-3 detect: ' + (liveMasked ? 'masked-paired by a same-key deliver (different file)' : 'unpaired'));
  clearLog(NEW_LOG);
  const sid = FIX + 'ORPH', pid = 'p' + String(seed.prompt).slice(0, 8);
  const fixtureDetect = { kind: 'detect', session: sid, prompt: pid, file: seed.file, ts: seed.ts };
  const step3b = all => all.filter(x => x.kind === 'detect').every(d =>
    all.some(v => v.kind === 'deliver' && v.session === d.session && v.prompt === d.prompt));
  ok('9 pre-fix state reads UNPAIRED under Step-3b rule', step3b([fixtureDetect]) === false);
  writeMarker(sid, pid, { file: seed.file });
  r = runHook(NEW_HOOK, { session_id: sid, prompt_id: pid, stop_hook_active: true, last_assistant_message: 'continuation build' });
  const all = [fixtureDetect].concat(readRows(NEW_LOG));
  ok('9 post-fix state reads PAIRED under Step-3b rule', step3b(all) && r.out === '', JSON.stringify(all));
}

// ---- DIFFERENTIAL + INPUT-REALISM replay (GEN-566) ----
// Real corpus: turn-final-shaped assistant texts from this machine's own recent
// transcripts. Both hooks get identical payloads; on normal turns their stdout and
// row-decisions must be IDENTICAL (regression bar: zero differences). On continuation
// turns the NEW hook must always stay silent and pair iff a marker exists (the
// designed delta; baseline writes nothing there by construction of the old bug).
function collectRealMessages(cap) {
  const texts = [];
  const cutoff = Date.now() - 14 * 24 * 3600 * 1000;
  let files = [];
  try {
    for (const slug of fs.readdirSync(PROJECTS)) {
      const dir = path.join(PROJECTS, slug);
      let entries; try { entries = fs.readdirSync(dir); } catch (e) { continue; }
      for (const f of entries) {
        if (!f.endsWith('.jsonl')) continue;
        const fp = path.join(dir, f);
        try { const st = fs.statSync(fp); if (st.isFile() && st.mtimeMs > cutoff) files.push({ fp, m: st.mtimeMs }); } catch (e) {}
      }
    }
  } catch (e) {}
  files.sort((a, b) => b.m - a.m);
  for (const { fp } of files.slice(0, 12)) {
    let lines; try { lines = fs.readFileSync(fp, 'utf8').split('\n'); } catch (e) { continue; }
    for (const line of lines) {
      if (texts.length >= cap) return texts;
      if (line.indexOf('"assistant"') === -1) continue;
      let j; try { j = JSON.parse(line); } catch (e) { continue; }
      const c = j && j.message && Array.isArray(j.message.content) ? j.message.content : null;
      if (!c) continue;
      const t = c.filter(x => x && x.type === 'text' && typeof x.text === 'string').map(x => x.text).join('\n');
      if (t && t.length > 40) texts.push(t);
    }
  }
  return texts;
}
const corpus = collectRealMessages(300);
const blockCarrying = corpus.filter(t => t.includes('\uD83D\uDCCC For you')).length;
let diffs = 0, contNoise = 0, n = 0;
for (const text of corpus) {
  n++;
  const sid = FIX + 'R' + n;
  // normal-turn differential, marker present for both
  clearLog(NEW_LOG); clearLog(BASE_LOG);
  writeMarker(sid, 'pn', { file: 'C:\\real\\replay.jsonl' });
  const a = runHook(NEW_HOOK, { session_id: sid, prompt_id: 'pn', stop_hook_active: false, last_assistant_message: text });
  writeMarker(sid, 'pn', { file: 'C:\\real\\replay.jsonl' });
  const b = runHook(BASE_HOOK, { session_id: sid, prompt_id: 'pn', stop_hook_active: false, last_assistant_message: text });
  const ra = readRows(NEW_LOG).map(x => x.decision).join(',');
  const rb = readRows(BASE_LOG).map(x => x.decision).join(',');
  if (a.out !== b.out || a.code !== b.code || ra !== rb) { diffs++; if (diffs <= 3) failures.push('DIFF@' + n + ' new=[' + ra + '] base=[' + rb + ']'); }
  // continuation-turn realism: new hook must never write stdout
  clearLog(NEW_LOG);
  writeMarker(sid, 'pc', { file: 'C:\\real\\replay.jsonl' });
  const c2 = runHook(NEW_HOOK, { session_id: sid, prompt_id: 'pc', stop_hook_active: true, last_assistant_message: text });
  const rc = readRows(NEW_LOG);
  if (c2.out !== '' || c2.code !== 0 || rc.length !== 1 || rc[0].decision !== 'skipped-continuation') contNoise++;
}
ok('R corpus size >= 100', corpus.length >= 100, 'got ' + corpus.length);
ok('R corpus includes block-carrying real messages', blockCarrying >= 5, 'got ' + blockCarrying);
ok('R normal-turn differential: zero differences', diffs === 0, diffs + ' diffs');
ok('R continuation replay: zero stdout / all paired', contNoise === 0, contNoise + ' noisy');

sweepFixtureMarkers(); clearLog(NEW_LOG); clearLog(BASE_LOG);

console.log('PASS ' + pass + ' / FAIL ' + fail + (corpus.length ? '  [realism corpus=' + corpus.length + ', block-carrying=' + blockCarrying + ']' : ''));
for (const f of failures) console.log('FAIL: ' + f);
process.exit(fail === 0 ? 0 : 1);
