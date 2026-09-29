// GEN-748/684 regression fixtures for stop-foryou-nudge.js + stop-cred-denial-surface.js.
// Run: node run-fixtures.js   (defaults to the INSTALLED hooks; override with HOOK_UNDER_TEST /
// CRED_UNDER_TEST, e.g. a /vet-code working copy). Cuts real transcripts from ~/.claude/projects;
// if Claude Code has pruned one, that case throws "transcript not found" -- rebuild it from a
// newer transcript of the same shape rather than deleting the case.
// GEN-748/684 live-verify fixtures: drive the REAL hook files (working copies,
// or any path given via env HOOK_UNDER_TEST / CRED_UNDER_TEST) through stdin
// exactly as the harness does, with transcripts cut from REAL session files.
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const SP = __dirname;
const HOOK = process.env.HOOK_UNDER_TEST || path.join(require('os').homedir(), '.claude', 'hooks', 'stop-foryou-nudge.js');
const CRED = process.env.CRED_UNDER_TEST || path.join(require('os').homedir(), '.claude', 'hooks', 'stop-cred-denial-surface.js');
const LIVE_HOOK = process.env.BASELINE_HOOK || null; // a pre-GEN-748 copy, for the F1b bug-reproduction check only
const FIX = process.env.GEN748_FIX_DIR || path.join(require('os').tmpdir(), 'gen748-fixtures'); // outside the repo: holds copies of real transcripts
const PROJ = 'C:\\Users\\Erez\\.claude\\projects';
fs.rmSync(FIX, { recursive: true, force: true });
fs.mkdirSync(FIX, { recursive: true });

let n = 0; const fails = [];
function check(name, cond, detail) {
  n++;
  if (!cond) fails.push(name + (detail ? ' :: ' + detail : ''));
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '  [' + (detail || '') + ']'));
}
function findTranscript(slugSuffix, prefix) {
  for (const slug of fs.readdirSync(PROJ)) {
    if (!slug.endsWith(slugSuffix)) continue;
    const f = fs.readdirSync(path.join(PROJ, slug)).find((x) => x.startsWith(prefix) && x.endsWith('.jsonl'));
    if (f) return path.join(PROJ, slug, f);
  }
  throw new Error('transcript not found: ' + slugSuffix + '/' + prefix);
}
function isPromptEntry(e) {
  if (!e || e.type !== 'user' || !e.message) return false;
  const c = e.message.content;
  if (typeof c === 'string') return true;
  if (Array.isArray(c)) return !c.some((b) => b && b.type === 'tool_result');
  return false;
}
// Cut lines [0, uptoLine-1) (1-indexed uptoLine = the follow-up's own Stop summary line,
// which the hook cannot see yet). extra: array of entries appended after the cut.
function cut(src, uptoLine, name, extra) {
  const lines = fs.readFileSync(src, 'utf8').split('\n').slice(0, uptoLine - 1);
  for (const e of (extra || [])) lines.push(JSON.stringify(e));
  const out = path.join(FIX, name + '.jsonl');
  fs.writeFileSync(out, lines.join('\n') + '\n');
  // last main-chain assistant message text (by message.id) + its promptId context
  let lastId = null, text = '', pid = null;
  for (const l of lines) {
    if (!l) continue; let e; try { e = JSON.parse(l); } catch (x) { continue; }
    if (e.promptId) pid = e.promptId;
    if (e.type === 'assistant' && e.isSidechain !== true && e.message && Array.isArray(e.message.content)) {
      const t = e.message.content.filter((c) => c && c.type === 'text').map((c) => c.text).join('');
      if (e.message.id !== lastId) { lastId = e.message.id; text = ''; }
      text += t;
    }
  }
  return { path: out, msg: text, pid: pid };
}
function runHook(hookPath, payload, tmpDir) {
  const env = Object.assign({}, process.env);
  if (tmpDir) { env.TEMP = tmpDir; env.TMP = tmpDir; env.TMPDIR = tmpDir; }
  const t0 = Date.now();
  const r = cp.spawnSync(process.execPath, [hookPath], { input: JSON.stringify(payload), encoding: 'utf8', timeout: 30000, env: env });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', ms: Date.now() - t0 };
}
function freshTmp(name) { const d = path.join(FIX, 'tmp-' + name); fs.mkdirSync(d, { recursive: true }); return d; }
const nudged = (r) => r.code === 0 && r.out.indexOf('For-you check, automatic') !== -1;
const silent = (r) => r.code === 0 && r.out === '';
const payload = (fx, over) => Object.assign({ session_id: 'fixture-sess', prompt_id: fx.pid || 'fixture-prompt', transcript_path: fx.path, cwd: SP, hook_event_name: 'Stop', stop_hook_active: true, last_assistant_message: fx.msg }, over || {});

// ---- F1: the real failure, cut right before its own Stop (line 2014) -> must nudge
const T_FAIL = findTranscript('Memory-Islands-Dev', '0b0f245f');
const f1 = cut(T_FAIL, 2014, 'f1-real-failure');
let tmp = freshTmp('f1');
let r = runHook(HOOK, payload(f1), tmp);
check('F1 real 2026-09-27 failure (36 tools, no block) -> NUDGE', nudged(r), 'code=' + r.code + ' out=' + r.out.slice(0, 120) + ' err=' + r.err.slice(0, 200));
if (LIVE_HOOK) check('F1b same payload through the pre-GEN-748 hook -> silent (the bug reproduced)', silent(runHook(LIVE_HOOK, payload(f1), freshTmp('f1live'))));
else console.log('SKIP  F1b (set BASELINE_HOOK to a pre-GEN-748 copy to run it)');
check('F1c nudge carries the model directive', r.out.indexOf('Model-tag directive, automatic') !== -1);
check('F1d msg is the real final text', f1.msg.indexOf('The wrap-up is complete') === 0, JSON.stringify(f1.msg.slice(0, 60)));

// ---- F6: cap -- same (session, prompt) three times -> nudge, nudge, silent
tmp = freshTmp('f6');
const r6a = runHook(HOOK, payload(f1), tmp), r6b = runHook(HOOK, payload(f1), tmp), r6c = runHook(HOOK, payload(f1), tmp);
check('F6 cap: 1st re-nudge fires', nudged(r6a));
check('F6 cap: 2nd re-nudge fires', nudged(r6b));
check('F6 cap: 3rd in the same prompt is SILENT', silent(r6c), r6c.out.slice(0, 80));
check('F6b a NEW prompt_id gets its own slots', nudged(runHook(HOOK, payload(f1, { prompt_id: 'other-prompt' }), tmp)));
check('F6c missing prompt_id still capped (session-wide noprompt key)', (function () {
  const t = freshTmp('f6c'); const p = payload(f1); delete p.prompt_id;
  return nudged(runHook(HOOK, p, t)) && nudged(runHook(HOOK, p, t)) && silent(runHook(HOOK, p, t));
})());

// ---- F2: real filler follow-up (For-you opened, 0 tools, "Still waiting...") -> silent
const f2 = cut(findTranscript('Improve-AI-Infra', '05b3cc83'), 195, 'f2-filler');
check('F2 real filler follow-up (0 tools) -> silent', silent(runHook(HOOK, payload(f2), freshTmp('f2'))), JSON.stringify(f2.msg.slice(0, 60)));

// ---- F3: real follow-up that did tool work AND wrote the block -> silent
const f3 = cut(findTranscript('C--Users-Erez', 'ba271343'), 504, 'f3-block-written');
check('F3 real follow-up with tools that wrote the block -> silent', silent(runHook(HOOK, payload(f3), freshTmp('f3'))), JSON.stringify(f3.msg.slice(0, 40)));

// ---- F4: real follow-up opened ONLY by the signal-surface note, with a tool call -> silent
const f4 = cut(findTranscript('Improve-AI-Infra', 'f00041c7'), 2521, 'f4-other-hook');
check('F4 real follow-up opened only by another hook (1 tool) -> silent', silent(runHook(HOOK, payload(f4), freshTmp('f4'))));

// ---- F5: block written mid-follow-up, then more tool work, final text without marker -> silent
const markerEntry = { type: 'assistant', isSidechain: false, message: { id: 'fixture-mid-block', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: '---\n\n\u{1F4CC} **For you**\n\nDone.' }] } };
const toolEntry = { type: 'assistant', isSidechain: false, message: { id: 'fixture-tool', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 'toolu_fx', name: 'Bash', input: { command: 'ls' } }] } };
const finalEntry = { type: 'assistant', isSidechain: false, message: { id: 'fixture-final', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Also pushed.' }] } };
const lines1844 = fs.readFileSync(T_FAIL, 'utf8').split('\n').slice(0, 1844).join('\n');
const f5p = path.join(FIX, 'f5-mid-block.jsonl');
fs.writeFileSync(f5p, lines1844 + '\n' + [markerEntry, toolEntry, finalEntry].map((e) => JSON.stringify(e)).join('\n') + '\n');
check('F5 block mid-follow-up then more tools -> silent', silent(runHook(HOOK, payload({ path: f5p, msg: 'Also pushed.', pid: '1bb8899e' }), freshTmp('f5'))));
// F5b: same shape with the variation-selector pin form -> still silent
const vsEntry = JSON.parse(JSON.stringify(markerEntry)); vsEntry.message.content[0].text = '\u{1F4CC}\uFE0F For you\n\nDone.';
const f5bp = path.join(FIX, 'f5b-vs16.jsonl');
fs.writeFileSync(f5bp, lines1844 + '\n' + [vsEntry, toolEntry, finalEntry].map((e) => JSON.stringify(e)).join('\n') + '\n');
check('F5b VS16 pin form mid-follow-up -> silent', silent(runHook(HOOK, payload({ path: f5bp, msg: 'Also pushed.', pid: '1bb8899e' }), freshTmp('f5b'))));
// F5c: final message itself carries the block -> silent
check('F5c final message carries the block -> silent', silent(runHook(HOOK, payload(f1, { last_assistant_message: 'x\n\n\u{1F4CC} **For you**\n\ny' }), freshTmp('f5c'))));

// ---- F7: real text-only follow-up carrying a headerless block / decision -> silent (2b dropped)
const f7 = cut(findTranscript('Improve-AI-Infra', '8c109710'), (function () {
  // the follow-up opened by the summary at line 58 ends at the NEXT stop_hook_summary
  const L = fs.readFileSync(findTranscript('Improve-AI-Infra', '8c109710'), 'utf8').split('\n');
  for (let i = 58; i < L.length; i++) { if (L[i].indexOf('"stop_hook_summary"') !== -1) return i + 1; }
  throw new Error('no summary after line 58');
})(), 'f7-text-only-decision');
check('F7 real text-only decision follow-up (headerless block) -> silent', silent(runHook(HOOK, payload(f7), freshTmp('f7'))), JSON.stringify(f7.msg.slice(0, 50)));

// ---- F8: no stop_hook_summary anywhere in the transcript -> silent
const f8p = path.join(FIX, 'f8-no-summary.jsonl');
fs.writeFileSync(f8p, [toolEntry, finalEntry].map((e) => JSON.stringify(e)).join('\n') + '\n');
check('F8 no summary in tail -> silent', silent(runHook(HOOK, payload({ path: f8p, msg: 'Also pushed.', pid: 'p8' }), freshTmp('f8'))));
check('F8b missing transcript_path -> silent', silent(runHook(HOOK, payload(f1, { transcript_path: undefined }), freshTmp('f8b'))));
check('F8c nonexistent transcript -> silent', silent(runHook(HOOK, payload(f1, { transcript_path: path.join(FIX, 'nope.jsonl') }), freshTmp('f8c'))));

// ---- F9: state dir unusable (TEMP points at a FILE) -> silent (fail toward silence)
const badTmp = path.join(FIX, 'tmp-is-a-file');
fs.writeFileSync(badTmp, 'x');
check('F9 state dir unwritable -> silent', silent(runHook(HOOK, payload(f1), badTmp)));

// ---- F10: empty final message after tool work (the 9320ec4f shape) -> nudge, base text only
check('F10 empty final message after tools -> SILENT (Pass B hardening: an empty payload may hide a lagging block)', silent(runHook(HOOK, payload(f1, { last_assistant_message: '' }), freshTmp('f10'))));
// F13: tail headroom -- the real failure padded with ~1.2 MB of real-shaped filler BEFORE the
// opening summary still re-nudges (anchor inside the 2 MB follow-up window)...
(function () {
  const L = fs.readFileSync(T_FAIL, 'utf8').split('\n');
  const pad = [];
  for (let i = 0; i < 1300; i++) pad.push(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'pad' + i, content: 'x'.repeat(900) }] } }));
  const pBig = path.join(FIX, 'f13-padded.jsonl');
  fs.writeFileSync(pBig, L.slice(0, 1843).concat(pad).join('\n') + '\n' + L.slice(1843, 2013).join('\n') + '\n');
  // put the padding INSIDE the follow-up (after the summary) so the anchor is ~1.5 MB back
  const pIn = path.join(FIX, 'f13-padded-inside.jsonl');
  fs.writeFileSync(pIn, L.slice(0, 1844).concat(pad).join('\n') + '\n' + L.slice(1844, 2013).join('\n') + '\n');
  const sz = fs.statSync(pIn).size;
  check('F13 follow-up of ~1.5 MB (anchor far back, inside 2 MB window) -> NUDGE (' + Math.round(sz / 1024) + ' KB file)', nudged(runHook(HOOK, payload({ path: pIn, msg: f1.msg, pid: f1.pid }), freshTmp('f13'))));
  // ...and one whose anchor lies beyond the 2 MB window -> silent (pre-GEN-748 behaviour)
  const pad2 = []; for (let i = 0; i < 2600; i++) pad2.push(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'pad' + i, content: 'x'.repeat(900) }] } }));
  const pOut = path.join(FIX, 'f13-beyond.jsonl');
  fs.writeFileSync(pOut, L.slice(0, 1844).concat(pad2).join('\n') + '\n' + L.slice(1844, 2013).join('\n') + '\n');
  const r13 = runHook(HOOK, payload({ path: pOut, msg: f1.msg, pid: f1.pid }), freshTmp('f13b'));
  check('F13b anchor beyond the 2 MB window -> silent (' + Math.round(fs.statSync(pOut).size / 1024) + ' KB file, ' + r13.ms + ' ms)', silent(r13));
})();

// ---- F11: stop_hook_active false paths unchanged: marker present -> silent; absent -> nudge
check('F11 first Stop, no marker -> nudge', nudged(runHook(HOOK, payload(f1, { stop_hook_active: false }), freshTmp('f11'))));
check('F11b first Stop, marker -> silent', silent(runHook(HOOK, payload(f1, { stop_hook_active: false, last_assistant_message: '\u{1F4CC} **For you**\n\nx' }), freshTmp('f11b'))));

// ---- F12: malformed stdin -> silent, exit 0
(function () {
  const r12 = cp.spawnSync(process.execPath, [HOOK], { input: '{not json', encoding: 'utf8', timeout: 20000 });
  check('F12 malformed stdin -> silent exit 0', r12.status === 0 && (r12.stdout || '') === '');
})();

// ---- GEN-684 probes: pin + 100K whitespace through both hooks, whole-process time and regex time
(function () {
  const big = 'x \u{1F4CC}' + ' '.repeat(100000) + 'done';
  const wc = require(HOOK);
  let t0 = process.hrtime.bigint(); wc.MARKER_RE.test(big); let ms = Number(process.hrtime.bigint() - t0) / 1e6;
  check('P1 foryou MARKER_RE on pin+100K whitespace < 10 ms (' + ms.toFixed(3) + ' ms)', ms < 10);
  const credSrc = fs.readFileSync(CRED, 'utf8');
  const credRe = eval(credSrc.match(/const MARKER_RE = (\/.*\/[a-z]*);/)[1]);
  t0 = process.hrtime.bigint(); credRe.test(big); ms = Number(process.hrtime.bigint() - t0) / 1e6;
  check('P2 cred-denial MARKER_RE on pin+100K whitespace < 10 ms (' + ms.toFixed(3) + ' ms)', ms < 10);
  check('P3 the two MARKER_RE copies are verbatim identical', credRe.toString() === wc.MARKER_RE.toString(), credRe.toString() + ' vs ' + wc.MARKER_RE.toString());
  const rb = runHook(HOOK, payload(f1, { stop_hook_active: false, last_assistant_message: big }), freshTmp('p4'));
  check('P4 foryou hook end-to-end on pin+100K whitespace: nudges, < 3 s wall (' + rb.ms + ' ms)', nudged(rb) && rb.ms < 3000);
  const vs = '\u{1F4CC}\uFE0F **For you**';
  check('P5 VS16 form recognised; plain/bold/pre-asterisk forms recognised', [vs, '\u{1F4CC} **For you**', '\u{1F4CC} For you', '**\u{1F4CC} For you**'].every((s) => wc.MARKER_RE.test(s)));
  check('P6 boundary: 128 whitespace (64+64) between pin and "For you" recognised; 129 not', wc.MARKER_RE.test('\u{1F4CC}' + ' '.repeat(128) + 'For you') && !wc.MARKER_RE.test('\u{1F4CC}' + ' '.repeat(129) + 'For you'));
  for (const [label, filler] of [['spaces', ' '], ['newlines', '\n'], ['CRLF', '\r\n'], ['tabs', '\t']]) {
    const s = 'x \u{1F4CC}' + filler.repeat(Math.floor(100000 / filler.length)) + 'done';
    const rr = runHook(HOOK, payload(f1, { stop_hook_active: false, last_assistant_message: s }), freshTmp('p7' + label));
    check('P7 foryou hook end-to-end, pin + 100K ' + label + ', first Stop: nudges < 3 s (' + rr.ms + ' ms)', nudged(rr) && rr.ms < 3000);
    const rf = runHook(HOOK, payload(f1, { last_assistant_message: s }), freshTmp('p8' + label));
    check('P8 same on the re-nudge path (stop_hook_active): nudges < 3 s (' + rf.ms + ' ms)', nudged(rf) && rf.ms < 3000);
  }
})();

// ---- Cred-denial hook: real caller in a fixture HOOK_DIR (it keys everything off __dirname)
(function () {
  const d = path.join(FIX, 'credhooks'); fs.mkdirSync(d, { recursive: true });
  const h = path.join(d, 'stop-cred-denial-surface.js');
  fs.writeFileSync(h, fs.readFileSync(CRED));
  const pend = path.join(d, '.cred-denial-pending-credsess');
  const base = { session_id: 'credsess', prompt_id: 'cp', hook_event_name: 'Stop', stop_hook_active: false };
  fs.writeFileSync(pend, '{"x":1}\n');
  let rc = runHook(h, Object.assign({}, base, { last_assistant_message: 'done\n\n\u{1F4CC} **For you**\n\nx' }));
  check('C1 cred: marker present -> defer (silent, pending kept)', rc.code === 0 && rc.out === '' && fs.existsSync(pend));
  rc = runHook(h, Object.assign({}, base, { last_assistant_message: 'done\n\n\u{1F4CC}\uFE0F For you\n\nx' }));
  check('C2 cred: VS16 marker -> defer (silent, pending kept)', rc.code === 0 && rc.out === '' && fs.existsSync(pend));
  rc = runHook(h, Object.assign({}, base, { stop_hook_active: true, last_assistant_message: 'no block' }));
  check('C3 cred: stop_hook_active -> defer', rc.code === 0 && rc.out === '' && fs.existsSync(pend));
  const t0 = Date.now();
  rc = runHook(h, Object.assign({}, base, { last_assistant_message: 'x \u{1F4CC}' + ' '.repeat(100000) + 'done' }));
  check('C4 cred: pin+100K whitespace, no marker -> note emitted fast (' + (Date.now() - t0) + ' ms), pending consumed', rc.code === 0 && rc.out.indexOf('GEN-316 NOTE') !== -1 && !fs.existsSync(pend) && (Date.now() - t0) < 3000);
})();

console.log('\n' + (n - fails.length) + '/' + n + ' passed' + (fails.length ? '\nFAILURES:\n' + fails.join('\n') : ''));
process.exit(fails.length ? 1 : 0);
