#!/usr/bin/env node
// Offline tests for windows-mcp-approval.js (no window is shown).
// Run: node windows-mcp-approval.test.js
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { decide, describe, visible, windowResult } = require('./windows-mcp-approval.js');

const HOOK = path.join(__dirname, 'windows-mcp-approval.js');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmcp-approval-test-'));

function req(name, input) {
  return JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'mcp__windows-mcp__' + name, tool_input: input });
}

// Builds fake deps; window(payload, nonce) returns { status, stdout, stderr }.
function deps({ guard = [0, 0], window } = {}) {
  const calls = { guard: 0, window: 0, payloads: [], files: [], shas: [], fileShas: [] };
  return {
    calls,
    tmpDir,
    runGuard() {
      const s = guard[Math.min(calls.guard, guard.length - 1)];
      calls.guard++;
      return { status: s, stderr: s === 0 ? '' : 'Blocked by the Windows-MCP delete guard: test reason.\n' };
    },
    runWindow(file, nonce, sha) {
      calls.window++;
      calls.files.push(file);
      calls.shas.push(sha);
      calls.fileShas.push(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
      const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
      calls.payloads.push(payload);
      return window ? window(payload, nonce) : { status: 0, stdout: 'APPROVED ' + nonce + '\r\n', stderr: '' };
    },
  };
}

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test('malformed input blocks without guard or window', () => {
  const d = deps();
  const r = decide('{not json', d);
  assert.strictEqual(r.action, 'block');
  assert.strictEqual(d.calls.guard + d.calls.window, 0);
});

test('other tools get no decision', () => {
  const d = deps();
  assert.deepStrictEqual(decide(JSON.stringify({ tool_name: 'Bash', tool_input: {} }), d), { action: 'none' });
  assert.strictEqual(d.calls.window, 0);
});

test('guard block stops before the window', () => {
  const d = deps({ guard: [2] });
  const r = decide(req('FileSystem', { mode: 'delete', path: 'C:\\x.txt' }), d);
  assert.strictEqual(r.action, 'block');
  assert.match(r.reason, /delete guard/);
  assert.strictEqual(d.calls.window, 0);
});

test('approve with the right nonce allows, guard checked before and after', () => {
  const d = deps();
  assert.deepStrictEqual(decide(req('Screenshot', {}), d), { action: 'allow' });
  assert.strictEqual(d.calls.guard, 2);
  assert.strictEqual(d.calls.window, 1);
});

test('the window is given the fingerprint of the exact bytes written (GEN-903)', () => {
  const d = deps();
  decide(req('PowerShell', { command: 'Get-ChildItem "C:\\' + String.fromCharCode(0x05E7, 0x05D5) + '"' }), d);
  assert.strictEqual(d.calls.window, 1);
  assert.match(d.calls.shas[0], /^[0-9a-f]{64}$/);
  assert.strictEqual(d.calls.shas[0], d.calls.fileShas[0]);
});

test('exit 0 without the nonce line blocks', () => {
  const d = deps({ window: () => ({ status: 0, stdout: '', stderr: '' }) });
  assert.strictEqual(decide(req('Screenshot', {}), d).action, 'block');
});

test('exit 0 with a different nonce blocks', () => {
  const d = deps({ window: () => ({ status: 0, stdout: 'APPROVED 0123456789abcdef0123456789abcdef\n', stderr: '' }) });
  assert.strictEqual(decide(req('Screenshot', {}), d).action, 'block');
});

test('right nonce but non-zero exit blocks', () => {
  const d = deps({ window: (p, n) => ({ status: 1, stdout: 'APPROVED ' + n + '\n', stderr: '' }) });
  assert.strictEqual(decide(req('Screenshot', {}), d).action, 'block');
});

test('nonce embedded in a longer line blocks', () => {
  const d = deps({ window: (p, n) => ({ status: 0, stdout: 'NOT APPROVED ' + n + '\n', stderr: '' }) });
  assert.strictEqual(decide(req('Screenshot', {}), d).action, 'block');
});

test('window killed by timeout (status null) blocks', () => {
  const d = deps({ window: () => ({ status: null, stdout: '', stderr: '' }) });
  assert.strictEqual(decide(req('Screenshot', {}), d).action, 'block');
});

test('deny reason comes from the window and tells Claude not to retry', () => {
  const d = deps({ window: () => ({ status: 1, stdout: '', stderr: 'Erez clicked Deny\r\nmore detail\r\n' }) });
  const r = decide(req('Screenshot', {}), d);
  assert.strictEqual(r.action, 'block');
  assert.match(r.reason, /Erez clicked Deny/);
  assert.doesNotMatch(r.reason, /more detail/);
  assert.match(r.reason, /Do not retry/);
});

test('guard re-check after approval can still block', () => {
  const d = deps({ guard: [0, 2] });
  const r = decide(req('FileSystem', { mode: 'write', path: 'C:\\new.txt', content: 'x' }), d);
  assert.strictEqual(r.action, 'block');
  assert.strictEqual(d.calls.guard, 2);
});

test('ControlStatus skips the hands-off wait, other tools do not', () => {
  const d = deps();
  decide(req('ControlStatus', {}), d);
  decide(req('Click', { loc: [1, 2] }), d);
  assert.strictEqual(d.calls.payloads[0].skipWait, true);
  assert.strictEqual(d.calls.payloads[1].skipWait, false);
  assert.strictEqual(d.calls.payloads[1].tool, 'Click');
});

test('payload file is removed after the window, even if the window throws', () => {
  const d = deps();
  decide(req('Screenshot', {}), d);
  const thrower = deps({ window: () => { throw new Error('boom'); } });
  assert.throws(() => decide(req('Screenshot', {}), thrower), /boom/);
  for (const f of d.calls.files.concat(thrower.calls.files)) assert.strictEqual(fs.existsSync(f), false);
});

test('details show string values raw and Hebrew intact', () => {
  const heb = String.fromCharCode(0x05E7, 0x05D5, 0x05D1, 0x05E5);
  const text = describe({ command: 'Get-ChildItem "C:\\' + heb + '"\nGet-Date', timeout: 30 });
  assert.match(text, /^command:\n {4}Get-ChildItem "C:\\/);
  assert.ok(text.includes(heb));
  assert.ok(text.includes('\n    Get-Date'));
  assert.ok(text.includes('timeout:\n    30'));
});

test('direction-override and control characters are made visible', () => {
  const rlo = String.fromCharCode(0x202E);
  const esc = String.fromCharCode(0x1B);
  assert.strictEqual(visible('a' + rlo + 'b' + esc + 'c'), 'a<U+202E>b<U+001B>c');
  assert.ok(describe({ path: 'x' + rlo + 'txt.exe' }).includes('<U+202E>'));
  assert.strictEqual(visible('tab\there'), 'tab\there');
});

test('a lone CR starts a new, marked display line (PowerShell treats it as a line break)', () => {
  const text = describe({ command: 'Get-Date # note\rStop-Computer -Force' });
  assert.ok(text.includes('\n    <U+000D>Stop-Computer -Force'));
  assert.ok(!text.includes('\r'));
  assert.ok(describe({ command: 'a\r\nb' }).includes('    a\n    b'));
});

test('long runs of blank characters (spaces, tabs, Unicode spaces) are collapsed into a count', () => {
  assert.ok(describe({ command: 'Get-Date' + ' '.repeat(300) + 'Stop-Computer' }).includes('Get-Date <300 blank characters> Stop-Computer'));
  const ideo = String.fromCharCode(0x3000);
  assert.ok(describe({ command: 'Get-Date' + ideo.repeat(1000) + '; Stop-Computer' }).includes('Get-Date <1000 blank characters> ; Stop-Computer'));
  assert.ok(describe({ command: 'a' + '\t \t'.repeat(10) + 'b' }).includes('a <30 blank characters> b'));
});

test('short runs of non-ASCII spaces are shown as codes, ordinary spaces and tabs are not', () => {
  const nbsp = String.fromCharCode(0x00A0);
  assert.strictEqual(visible('a' + nbsp + 'b c\td'), 'a<U+00A0>b c\td');
});

test('parameter names cannot fake extra lines', () => {
  const text = describe({ ['mode\nnote']: 'x' });
  assert.ok(text.startsWith('mode<U+000A>note:'));
});

test('each Hebrew run is fenced with direction marks; a Hebrew phrase stays one run', () => {
  const lrm = String.fromCharCode(0x200E);
  const heb = String.fromCharCode(0x05E7, 0x05D5, 0x05D1, 0x05E5);
  const heb2 = String.fromCharCode(0x05D9, 0x05E2, 0x05D3);
  assert.ok(describe({ path: 'C:\\' + heb + '\\' + heb2 + '\\b.txt' }).includes('C:\\' + lrm + heb + lrm + '\\' + lrm + heb2 + lrm + '\\b.txt'));
  assert.ok(describe({ command: "Copy-Item '" + heb + "' '" + heb2 + "'" }).includes("'" + lrm + heb + lrm + "' '" + lrm + heb2 + lrm + "'"));
  assert.ok(describe({ text: heb + ' ' + heb2 }).includes(lrm + heb + ' ' + heb2 + lrm));
  assert.ok(!describe({ path: 'C:\\a\\b.txt' }).includes(lrm));
});

test('more invisible characters are made visible (line separator, soft hyphen, tag, filler)', () => {
  const s = String.fromCharCode(0x2028) + String.fromCharCode(0x00AD) + String.fromCodePoint(0xE0041) + String.fromCharCode(0x3164);
  assert.strictEqual(visible(s), '<U+2028><U+00AD><U+E0041><U+3164>');
});

test('details for empty and non-object input', () => {
  assert.strictEqual(describe({}), '(no parameters)');
  assert.strictEqual(describe(undefined), 'null');
});

test('process: malformed stdin exits 2 with nothing on stdout', () => {
  const r = spawnSync(process.execPath, [HOOK], { input: '{bad', encoding: 'utf8' });
  assert.strictEqual(r.status, 2);
  assert.strictEqual(r.stdout, '');
});

test('process: other tool exits 0 with nothing on stdout', () => {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: 'Read', tool_input: {} }), encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
});

test('process: real guard blocks a permanent delete before any window', () => {
  const r = spawnSync(process.execPath, [HOOK], { input: req('FileSystem', { mode: 'delete', path: 'C:\\Users\\Erez\\Desktop\\x.txt' }), encoding: 'utf8', timeout: 30000 });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /delete guard/);
  assert.strictEqual(r.stdout, '');
});

// ---- Announce-first, session label, miss marker (2026-10-18) ----
const missHook = require('./prompt-wmcp-miss-reminder.js');
const injector = require('./inject-windows-mcp-refs.js');
let seq = 0;

// A fake session: a transcript file, a state dir and a controllable clock.
function session(lines) {
  seq++;
  const dir = fs.mkdtempSync(path.join(tmpDir, 's' + seq + '-'));
  const tp = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(tp, (lines || []).map((l) => JSON.stringify(l.sessionId === 'SESSION' ? Object.assign({}, l, { sessionId: 'sess-' + seq }) : l) + '\n').join(''), 'utf8');
  const s = { dir, tp, stateDir: path.join(dir, 'state'), t: 1000000 };
  s.append = (obj) => fs.appendFileSync(tp, JSON.stringify(obj) + '\n', 'utf8');
  s.say = (text, extra) => s.append(Object.assign({ type: 'assistant', message: { content: [{ type: 'text', text }] } }, extra || {}));
  s.req = (name, input, more) => JSON.stringify(Object.assign({
    hook_event_name: 'PreToolUse', tool_name: 'mcp__windows-mcp__' + name, tool_input: input || {},
    session_id: 'sess-' + seq, prompt_id: 'prompt-1', transcript_path: tp, cwd: 'C:\\Users\\Erez\\AI Projects\\Memory Islands Dev',
  }, more || {}));
  s.deps = (opts) => Object.assign(deps(opts), { stateDir: s.stateDir, now: () => s.t, projectDir: 'C:\\Users\\Erez\\AI Projects\\Memory Islands Dev\\' });
  s.denied = () => path.join(s.stateDir, 'denied.sess-' + seq);
  return s;
}
// session() gives TITLE entries this fake session's id, as real transcripts do.
const TITLE = { type: 'custom-title', customTitle: 'Tableau responses in Gmail', sessionId: 'SESSION' };
const SAY = 'I will read your clipboard to copy the query results, because the page has no download.';

test('sub-agent call blocks before guard or window', () => {
  const s = session([TITLE]);
  const d = s.deps();
  const r = decide(s.req('Clipboard', { mode: 'get' }, { agent_id: 'a123', agent_type: 'general-purpose' }), d);
  assert.strictEqual(r.action, 'block');
  assert.match(r.reason, /main session only/);
  assert.strictEqual(d.calls.guard + d.calls.window, 0);
});

test('first call of a turn blocks without a window and records the offset', () => {
  const s = session([TITLE]);
  const d = s.deps();
  const r = decide(s.req('Clipboard', { mode: 'get' }), d);
  assert.strictEqual(r.action, 'block');
  assert.match(r.reason, /not a denial/);
  assert.match(r.reason, /last resort/);
  assert.strictEqual(d.calls.window, 0);
  assert.strictEqual(fs.existsSync(s.denied()), false, 'an announce-block is not a missed window');
  const st = JSON.parse(fs.readFileSync(path.join(s.stateDir, 'announce.sess-' + seq + '.prompt-1.json'), 'utf8'));
  assert.strictEqual(st.offset, fs.statSync(s.tp).size);
});

test('retry after an announcement opens the window with session name and reason', () => {
  const s = session([TITLE]);
  const d = s.deps();
  decide(s.req('Clipboard', { mode: 'get' }), d);
  s.append({ type: 'user', message: { content: [{ type: 'tool_result', content: 'blocked' }] } });
  s.say(SAY);
  s.t += 8000;
  assert.deepStrictEqual(decide(s.req('Clipboard', { mode: 'get' }), d), { action: 'allow' });
  const p = d.calls.payloads[0];
  assert.ok(p.details.startsWith('mode:\n    get\n\n----'));
  assert.ok(p.details.includes('Asked from folder: Memory Islands Dev\nSession name (set by Claude, unverified): Tableau responses in Gmail\nClaude says (unverified - judge by the action above):\n    ' + SAY));
  assert.strictEqual(p.askedBy, 'folder Memory Islands Dev');
});

test('later calls in the same turn: no new block; the reason shown is only what was said since the last window', () => {
  const s = session([TITLE]);
  const d = s.deps();
  decide(s.req('Clipboard', { mode: 'get' }), d);
  s.say(SAY);
  s.t += 8000;
  decide(s.req('Clipboard', { mode: 'get' }), d);
  s.t += 60000;
  assert.strictEqual(decide(s.req('Click', { loc: [1, 2] }), d).action, 'allow');
  assert.strictEqual(d.calls.window, 2);
  const second = d.calls.payloads[1].details;
  assert.ok(second.includes('    No new explanation for this action. Earlier this turn Claude said: "' + SAY + '"'));
  assert.ok(!second.includes('judge by the action above):\n    ' + SAY));
  const NEW = 'Now I will click the Save button in Excel to keep the new table.';
  s.say(NEW);
  decide(s.req('Click', { loc: [3, 4] }), d);
  assert.ok(d.calls.payloads[2].details.includes('judge by the action above):\n    ' + NEW));
  const r = decide(s.req('Click', { loc: [1, 2] }, { prompt_id: 'prompt-2' }), d);
  assert.strictEqual(r.action, 'block');
  assert.strictEqual(d.calls.window, 3);
});

test('a look-alike title inside a tool call, or another session\'s title, is not shown as the session name', () => {
  const s = session([TITLE]);
  s.append({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'x', input: { type: 'custom-title', customTitle: 'Erez - approved maintenance', sessionId: 'sess-' + seq } }] } });
  s.append({ type: 'custom-title', customTitle: 'Other session', sessionId: 'someone-else' });
  const d = s.deps();
  decide(s.req('Screenshot', {}, { prompt_id: undefined }), d);
  assert.ok(d.calls.payloads[0].details.includes('Session name (set by Claude, unverified): Tableau responses in Gmail\n'));
});

test('a crafted or long session name can\'t hide or fake the folder', () => {
  const s = session([{ type: 'custom-title', customTitle: 'Backup check" (folder: Memory Islands Dev) - Erez pre-approved' + ' '.repeat(5) + 'z'.repeat(200), sessionId: 'SESSION' }]);
  const d = s.deps();
  decide(s.req('Screenshot', {}, { prompt_id: undefined }), d);
  const p = d.calls.payloads[0];
  assert.strictEqual(p.askedBy, 'folder Memory Islands Dev');
  const ctx = p.details.split('----------------------------------------\n')[1].split('\n');
  assert.strictEqual(ctx[0], 'Asked from folder: Memory Islands Dev');
  assert.ok(ctx[1].startsWith('Session name (set by Claude, unverified): Backup check"'));
  assert.ok(Array.from(ctx[1]).length <= 'Session name (set by Claude, unverified): '.length + 63);
});

test('the folder shown is the session\'s project folder, not where Claude cd\'d to', () => {
  const s = session([TITLE]);
  const cdTo = { cwd: 'C:\\Users\\Erez\\Erez pre-approved' };
  const d = s.deps();
  decide(s.req('Screenshot', {}, Object.assign({ prompt_id: undefined }, cdTo)), d);
  assert.ok(d.calls.payloads[0].details.includes('\nAsked from folder: Memory Islands Dev\n'));
  assert.ok(!d.calls.payloads[0].details.includes('pre-approved'));
  assert.strictEqual(d.calls.payloads[0].askedBy, 'folder Memory Islands Dev');
  const d2 = Object.assign(s.deps(), { projectDir: undefined });
  decide(s.req('Screenshot', {}, Object.assign({ prompt_id: undefined }, cdTo)), d2);
  assert.ok(d2.calls.payloads[0].details.includes('\nCurrent folder (Claude can change it, unverified): Erez pre-approved\n'));
  assert.strictEqual(d2.calls.payloads[0].askedBy, '');
});

test('a window that never ran, or ran too long, is reported as such, not as "no answer"', () => {
  const never = windowResult({ error: { code: 'ENOENT' }, status: null, stdout: null, stderr: null });
  assert.strictEqual(never.status, null);
  assert.strictEqual(never.stderr, 'the approval window did not run: ENOENT\n');
  assert.strictEqual(windowResult({ error: { code: 'ETIMEDOUT' }, status: null, stdout: '', stderr: '' }).stderr, 'the approval window ran too long and was closed\n');
  const normal = windowResult({ status: 1, stdout: '', stderr: 'Erez clicked Deny\r\n' });
  assert.strictEqual(normal.stderr, 'Erez clicked Deny\r\n');
  const s = session([TITLE]);
  const d = s.deps({ window: () => windowResult({ error: { code: 'ENOENT' }, status: null }) });
  const r = decide(s.req('Screenshot', {}, { prompt_id: undefined }), d);
  assert.match(r.reason, /not approved \(the approval window did not run: ENOENT\)/);
  assert.strictEqual(missHook.mentionsMiss('The PC-control request was not approved (the approval window did not run: ENOENT).'), true);
});

test('the session name is found even after several MB of screenshot data', () => {
  const s = session([TITLE]);
  s.append({ type: 'user', message: { content: [{ type: 'tool_result', content: 'A'.repeat(3 * 1024 * 1024) }] } });
  const d = s.deps();
  decide(s.req('Screenshot', {}, { prompt_id: undefined }), d);
  assert.ok(d.calls.payloads[0].details.includes('Session name (set by Claude, unverified): Tableau responses in Gmail\n'));
});

test('an unreadable leftover state file does not block the turn', () => {
  const s = session([TITLE]);
  const d = s.deps();
  fs.mkdirSync(s.stateDir, { recursive: true });
  const f = path.join(s.stateDir, 'announce.sess-' + seq + '.prompt-1.json');
  fs.writeFileSync(f, '');
  assert.strictEqual(decide(s.req('Clipboard', { mode: 'get' }), d).action, 'block', 'fresh empty file: a parallel call is writing it');
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(f, old, old);
  assert.strictEqual(decide(s.req('Clipboard', { mode: 'get' }), d).action, 'allow');
});

test('text written before the block, short text and sub-agent text do not count', () => {
  const s = session([TITLE]);
  s.say('Earlier narration in this turn that is long enough to count.');
  const d = s.deps();
  decide(s.req('Clipboard', { mode: 'get' }), d);
  s.say('Retrying.');
  s.say('A sub-agent sentence that is long enough to count otherwise.', { isSidechain: true });
  s.t += 8000;
  assert.strictEqual(decide(s.req('Clipboard', { mode: 'get' }), d).action, 'block');
  assert.strictEqual(d.calls.window, 0);
});

test('no announcement after 2 rounds: window opens with no reason given', () => {
  const s = session([TITLE]);
  const d = s.deps();
  assert.strictEqual(decide(s.req('Clipboard', { mode: 'get' }), d).action, 'block');
  s.t += 8000;
  assert.strictEqual(decide(s.req('Clipboard', { mode: 'get' }), d).action, 'block');
  s.t += 8000;
  assert.strictEqual(decide(s.req('Clipboard', { mode: 'get' }), d).action, 'allow');
  assert.ok(d.calls.payloads[0].details.includes('Claude says (unverified - judge by the action above):\n    (no reason given)'));
});

test('parallel calls of one round count as one block', () => {
  const s = session([TITLE]);
  const d = s.deps();
  for (let i = 0; i < 4; i++) { assert.strictEqual(decide(s.req('Clipboard', { mode: 'get' }), d).action, 'block'); s.t += 50; }
  s.t += 8000;
  assert.strictEqual(decide(s.req('Clipboard', { mode: 'get' }), d).action, 'block');
  assert.strictEqual(d.calls.window, 0);
});

test('quick retries with no text still reach the window (no endless blocking)', () => {
  const s = session([TITLE]);
  const d = s.deps();
  let n = 0;
  while (decide(s.req('Clipboard', { mode: 'get' }), d).action === 'block') { n++; s.t += 2000; assert.ok(n < 10, 'blocked too many times'); }
  assert.strictEqual(d.calls.window, 1);
});

test('a heads-up saved as a "narration" block counts; private reasoning does not', () => {
  // Real signature prefixes: narration-tagged (visible status line) and thinking-tagged (private).
  const NARR = 'CAQSswcKEQgSGAI4AUIJbmFycmF0aW9u';
  const PRIV = 'CAQSvwYKEAgSGAI4AUIIdGhpbmtpbmc';
  const PRIVATE = 'My private plan is to read the clipboard quietly without saying so.';
  const think = (text, signature) => ({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: text, signature }] } });
  // A private block after the bounce does not count; a narration block in the SAME round does
  // (so the window opening here is not the two-round fallback).
  const a = session([TITLE]);
  const da = a.deps();
  decide(a.req('Clipboard', { mode: 'get' }), da);
  a.append(think(PRIVATE, PRIV));
  a.t += 8000;
  assert.strictEqual(decide(a.req('Clipboard', { mode: 'get' }), da).action, 'block', 'private reasoning is not a heads-up');
  a.append(think(SAY, NARR));
  a.t += 1000;
  assert.strictEqual(decide(a.req('Clipboard', { mode: 'get' }), da).action, 'allow');
  assert.ok(da.calls.payloads[0].details.includes('judge by the action above):\n    ' + SAY));
  // A private block written AFTER the heads-up is not shown in its place.
  const b = session([TITLE]);
  const db = b.deps();
  decide(b.req('Clipboard', { mode: 'get' }), db);
  b.append(think(SAY, NARR));
  b.append(think(PRIVATE, PRIV));
  b.t += 8000;
  assert.strictEqual(decide(b.req('Clipboard', { mode: 'get' }), db).action, 'allow');
  assert.ok(db.calls.payloads[0].details.includes('judge by the action above):\n    ' + SAY));
  assert.ok(!db.calls.payloads[0].details.includes('private plan'));
});

test('an announcement followed by a short line still counts', () => {
  const s = session([TITLE]);
  const d = s.deps();
  decide(s.req('Clipboard', { mode: 'get' }), d);
  s.say(SAY);
  s.say('Retrying now.');
  s.t += 8000;
  assert.strictEqual(decide(s.req('Clipboard', { mode: 'get' }), d).action, 'allow');
  assert.ok(d.calls.payloads[0].details.includes(SAY));
});

test('turn not trackable (no prompt_id, no transcript) shows the window, with the folder name', () => {
  const s = session([]);
  const d = s.deps();
  assert.strictEqual(decide(s.req('Screenshot', {}, { prompt_id: undefined }), d).action, 'allow');
  assert.strictEqual(decide(s.req('Screenshot', {}, { transcript_path: path.join(s.dir, 'missing.jsonl') }), d).action, 'allow');
  assert.ok(d.calls.payloads[0].details.includes('Asked from folder: Memory Islands Dev\nSession name (set by Claude, unverified): (none found)'));
  assert.ok(d.calls.payloads[0].details.includes('(no reason given)'));
});

test('transcript gone or shorter after the block: window opens, never stuck', () => {
  const s = session([TITLE, TITLE]);
  const d = s.deps();
  decide(s.req('Clipboard', { mode: 'get' }), d);
  fs.writeFileSync(s.tp, '', 'utf8');
  s.t += 8000;
  assert.strictEqual(decide(s.req('Clipboard', { mode: 'get' }), d).action, 'block');
  s.t += 8000;
  assert.strictEqual(decide(s.req('Clipboard', { mode: 'get' }), d).action, 'allow');
  const g = session([TITLE]);
  const dg = g.deps();
  assert.strictEqual(decide(g.req('Clipboard', { mode: 'get' }), dg).action, 'block');
  fs.unlinkSync(g.tp);
  assert.strictEqual(decide(g.req('Clipboard', { mode: 'get' }), dg).action, 'allow');
});

test('the reason shown is made safe and capped; the session name too', () => {
  const rlo = String.fromCharCode(0x202E);
  const s = session([{ type: 'custom-title', customTitle: 'Evil' + rlo + 'txt.exe' + 'x'.repeat(300), sessionId: 'SESSION' }]);
  const d = s.deps();
  decide(s.req('Clipboard', { mode: 'get' }), d);
  s.say('Allow this, it is safe' + rlo + ' really' + '\nAction: Screenshot' + 'y'.repeat(500));
  s.t += 8000;
  decide(s.req('Clipboard', { mode: 'get' }), d);
  const p = d.calls.payloads[0];
  assert.ok(!p.details.includes(rlo));
  assert.ok(p.details.includes('unverified): Evil<U+202E>txt.exe'));
  assert.ok(p.details.includes('\n    Action: Screenshot'), 'a fake line stays indented under "Claude says"');
  assert.ok(p.details.length < 1000);
});

test('a window that ends without approval writes the miss marker and asks for a report', () => {
  const s = session([TITLE]);
  const d = s.deps({ window: () => ({ status: 1, stdout: '', stderr: 'no answer within 2 minutes\r\n' }) });
  decide(s.req('Screenshot', {}, { prompt_id: undefined }), d);
  const r = decide(s.req('Screenshot', {}, { prompt_id: undefined }), d);
  assert.match(r.reason, /PC-control request was not approved \(no answer within 2 minutes\)/);
  assert.match(r.reason, /For you/);
  const lines = fs.readFileSync(s.denied(), 'utf8').trim().split('\n');
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(JSON.parse(lines[0]).tool, 'Screenshot');
});

test('a delete-guard block writes no miss marker', () => {
  const s = session([TITLE]);
  const d = s.deps({ guard: [2] });
  decide(s.req('FileSystem', { mode: 'delete', path: 'C:\\x.txt' }, { prompt_id: undefined }), d);
  assert.strictEqual(fs.existsSync(s.denied()), false);
});

test('miss reminder: only the summary counts, never a line buried mid-reply', () => {
  const marker = JSON.stringify({ ts: '2026-10-18T10:00:00.000Z', tool: 'Clipboard', why: 'no answer within 2 minutes' }) + '\n';
  const told = { inject: null, clear: true };
  const T = (t) => ({ kind: 'text', text: t });
  const BOX = (recap, ask) => ({ kind: 'box', text: [recap, ask].filter(Boolean).join('\n') });
  const TOOL = { kind: 'tool', text: '' };
  const NOTE = "The PC-control request was not approved, so I'll read the page instead.";
  assert.deepStrictEqual(missHook.decide(null, []), { inject: null, clear: false });
  // Buried mention, summary silent -> reminder (the 2026-10-18 failure).
  const r = missHook.decide(marker, [T('The PC-control window was not approved, so I will use PowerShell.'), T('Done.\n---\n📌 For you\nThe backup is ready.')]);
  assert.strictEqual(r.clear, true);
  assert.match(r.inject, /Clipboard \(no answer within 2 minutes\)/);
  assert.match(r.inject, /closing summary/);
  // Reported in the summary block -> silent.
  assert.deepStrictEqual(missHook.decide(marker, [T('Working.'), T('---\n📌 **For you**\nThe PC-control request was not approved (no answer within 2 minutes), so I read the page.')]), told);
  // A summary that continues in a later entry still counts as the summary.
  assert.deepStrictEqual(missHook.decide(marker, [T('📌 For you\nThe backup is ready.'), T('Also, the PC-control request was not approved.')]), told);
  // The LAST summary decides: an earlier summary's mention doesn't cover a later silent one.
  assert.ok(missHook.decide(marker, [T('📌 For you\nThe PC-control request was not approved.'), T('More work.'), T('📌 For you\nAll done.')]).inject);
  // No header, no box: a closing line counts; a line with tool calls after it does not.
  assert.deepStrictEqual(missHook.decide(marker, [T('Checking.'), TOOL, T(NOTE)]), told);
  assert.ok(missHook.decide(marker, [T(NOTE), TOOL, TOOL]).inject, 'buried line followed by silent tool work');
  // Box turns: the box's recap/question and the line written right before the box are the summary.
  assert.ok(missHook.decide(marker, [T(NOTE), TOOL, TOOL, BOX('Here are the results.')]).inject, 'buried line, then a box whose recap omits it');
  assert.deepStrictEqual(missHook.decide(marker, [T('Working.'), TOOL, BOX('The PC-control request was not approved; I read the page instead.')]), told);
  assert.deepStrictEqual(missHook.decide(marker, [TOOL, T(NOTE), BOX('Backup pushed.', 'Archive it?')]), told, 'summary written just before the box (often collapsed by the app)');
  assert.ok(missHook.decide(marker, [T(NOTE), TOOL, BOX('Backup pushed.')]).inject, 'a tool call between the line and the box');
  // Transcript unreadable -> reminder anyway.
  assert.ok(missHook.decide(marker, null).inject);
});

test('miss reminder: reads only what Erez was shown since the miss', () => {
  const s = session([]);
  const text = (t, ts, extra) => s.append(Object.assign({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'text', text: t }] } }, extra || {}));
  const think = (t, ts, sig) => s.append({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'thinking', thinking: t, signature: sig }] } });
  const tool = (name, input, ts) => s.append({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'tool_use', id: 't', name, input }] } });
  text('Before the miss.', '2026-10-18T09:59:59.000Z');
  text('After the miss.', '2026-10-18T10:00:01.000Z');
  text('A sub-agent line.', '2026-10-18T10:00:02.000Z', { isSidechain: true });
  think('Private reasoning.', '2026-10-18T10:00:03.000Z', 'CAQSvwYKEAgSGAI4AUIIdGhpbmtpbmc');
  think('Reworded status line shown in the app.', '2026-10-18T10:00:04.000Z', 'CAQSswcKEQgSGAI4AUIJbmFycmF0aW9u');
  tool('PowerShell', { command: 'x' }, '2026-10-18T10:00:05.000Z');
  tool('mcp__ccd_turn__wrap_up', { recap: 'Recap text.', ask: 'Go?', actions: [] }, '2026-10-18T10:00:06.000Z');
  assert.deepStrictEqual(missHook.shownSince(s.tp, '2026-10-18T10:00:00.000Z'), [
    { kind: 'text', text: 'After the miss.' },
    { kind: 'text', text: 'Reworded status line shown in the app.' },
    { kind: 'tool', text: '' },
    { kind: 'box', text: 'Recap text.\nGo?' },
  ]);
  assert.strictEqual(missHook.shownSince(path.join(s.dir, 'missing.jsonl'), ''), null);
});

test('miss reminder: a refused box is ignored; task-list updates do not separate the summary from the box', () => {
  const s = session([]);
  const text = (t, ts) => s.append({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'text', text: t }] } });
  const tool = (id, name, input, ts) => s.append({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'tool_use', id, name, input }] } });
  const refuse = (id) => s.append({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: 'hook error' }] } });
  const NOTE = 'The PC-control request was not approved, so I read the page instead.';
  text(NOTE, '2026-10-18T10:00:01.000Z');
  tool('u1', 'mcp__ccd_turn__update_plan', { advance: true }, '2026-10-18T10:00:02.000Z');
  tool('b1', 'mcp__ccd_turn__wrap_up', { recap: 'Refused recap that was never shown.' }, '2026-10-18T10:00:03.000Z');
  refuse('b1');
  tool('b2', 'mcp__ccd_turn__wrap_up', { recap: 'Backup pushed.' }, '2026-10-18T10:00:04.000Z');
  const items = missHook.shownSince(s.tp, '2026-10-18T10:00:00.000Z');
  assert.deepStrictEqual(items, [{ kind: 'text', text: NOTE }, { kind: 'box', text: 'Backup pushed.' }]);
  assert.deepStrictEqual(missHook.decide(JSON.stringify({ ts: '2026-10-18T10:00:00.000Z', tool: 'Click', why: 'x' }), items), { inject: null, clear: true });
  // A For-you block written after the box is still the summary.
  const after = [{ kind: 'box', text: 'Recap.' }, { kind: 'text', text: '📌 For you\nThe PC-control request was not approved.' }];
  assert.deepStrictEqual(missHook.decide(JSON.stringify({ ts: 't', tool: 'Click', why: 'x' }), after), { inject: null, clear: true });
});

test('miss reminder and approval gate read "what Erez was shown" the same way', () => {
  const gate = require('./windows-mcp-approval.js');
  const blocks = [
    { type: 'text', text: '  Visible line.  ' },
    { type: 'thinking', thinking: 'Reworded status.', signature: 'CAQSswcKEQgSGAI4AUIJbmFycmF0aW9u' },
    { type: 'thinking', thinking: 'Private reasoning.', signature: 'CAQSvwYKEAgSGAI4AUIIdGhpbmtpbmc' },
    { type: 'tool_use', name: 'x', input: {} }, null,
  ];
  for (const b of blocks) assert.strictEqual(missHook.shownText(b), gate.shownText(b), JSON.stringify(b));
});

test('miss reminder: waits for Erez\'s own message', () => {
  for (const p of [
    '<task-notification>\n<task-id>x</task-id>',
    '<agent-message from="a1">done</agent-message>',
    '  <side-sessions-event>x',
    'Another Claude session sent a message:\n<agent-message from="ac5b19a8bec678e99">\n[Subagent hand-back] ...',
  ]) assert.strictEqual(missHook.isAutomatedPrompt(p), true, p);
  for (const p of ['A', 'why do we need this question box?', '/wrap', 'Another Claude session sent a message: can you check it?']) assert.strictEqual(missHook.isAutomatedPrompt(p), false, p);
});

test('miss reminder: what counts as a mention', () => {
  for (const msg of [
    'The PC-control window was not approved (no answer within 2 minutes), so I read the page instead.',
    'The PC-control request was not approved (another approval window was still open).',
    'Your PC-control prompt timed out, so I downloaded the file instead.',
    'You denied the PC control request.',
    'The PC-control request wasn\'t approved.',
    '3. ControlStatus again: blocked with "This Windows-MCP action was not approved".',
    'The approval window came up and you clicked Deny.',
    '3. **Second status check:** blocked as "Erez clicked Deny", even though it is the same harmless check.',
    'It ended with "no answer within 2 minutes".',
    'Result: not hands-off for 10 seconds within 1 minute.',
    'Erez clicked Cancel.',
    'The PC-control approval window didn\'t run (ENOENT).',
  ]) assert.strictEqual(missHook.mentionsMiss(msg), true, msg);
  for (const msg of [
    'The clipboard read needs your approval, and that prompt timed out.',
    'PC control worked; the Snowflake login was denied earlier.',
    'I clicked Cancel in the Save dialog.',
    'The request to the Notion API was denied.',
    'A pop-up appeared and timed out.',
    'You clicked Deny on the Bash prompt.',
    'The PC-control request was approved; the login was denied.',
    'PC control works; the Notion approval was denied.',
    'You clicked Deny on the login page, so the Windows setting is unchanged.',
  ]) assert.strictEqual(missHook.mentionsMiss(msg), false, msg);
});

test('ref injector: fires for a ToolSearch naming the add-on or returning its tools, and its calls; not for sub-agents', () => {
  assert.strictEqual(injector.shouldInject({ tool_name: 'ToolSearch', tool_input: { query: 'select:mcp__windows-mcp__Clipboard' } }), true);
  assert.strictEqual(injector.shouldInject({ tool_name: 'ToolSearch', tool_input: { query: 'clipboard' }, tool_response: [{ type: 'tool_reference', tool_name: 'mcp__windows-mcp__Clipboard' }] }), true);
  assert.strictEqual(injector.shouldInject({ tool_name: 'ToolSearch', tool_input: { query: 'notion' }, tool_response: [{ tool_name: 'mcp__x__notion-fetch' }] }), false);
  assert.strictEqual(injector.shouldInject({ tool_name: 'mcp__windows-mcp__Click', tool_input: {} }), true);
  assert.strictEqual(injector.shouldInject({ tool_name: 'mcp__windows-mcp__Click', agent_id: 'a1' }), false);
  assert.strictEqual(injector.shouldInject({ tool_name: 'Bash', tool_input: { command: 'windows-mcp' } }), false);
});

test('process: ref injector injects part 1, then part 2 on the next call, then nothing', () => {
  const INJ = path.join(__dirname, 'inject-windows-mcp-refs.js');
  const sid = 'wmcp-test-' + process.pid + '-' + Date.now();
  const inp = JSON.stringify({ session_id: sid, tool_name: 'ToolSearch', tool_input: { query: 'select:mcp__windows-mcp__Clipboard' } });
  try {
    const r1 = spawnSync(process.execPath, [INJ], { input: inp, encoding: 'utf8' });
    assert.strictEqual(r1.status, 0);
    const out = JSON.parse(r1.stdout);
    assert.strictEqual(out.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.match(out.hookSpecificOutput.additionalContext, /Last resort/);
    assert.doesNotMatch(out.hookSpecificOutput.additionalContext, /Stuck add-on \(GEN/);
    const r2 = spawnSync(process.execPath, [INJ], { input: inp, encoding: 'utf8' });
    assert.match(JSON.parse(r2.stdout).hookSpecificOutput.additionalContext, /Stuck add-on \(GEN/);
    const r3 = spawnSync(process.execPath, [INJ], { input: inp, encoding: 'utf8' });
    assert.strictEqual(r3.stdout, '');
  } finally {
    for (const n of [1, 2]) {
      try { fs.unlinkSync(path.join(os.tmpdir(), 'claude-refs-windows-mcp-part' + n + '-' + sid)); } catch (e) { /* none */ }
    }
  }
});

test('process: miss reminder fires once on Erez\'s next message, waits on automated ones, stays silent when told', () => {
  const HOOK2 = path.join(__dirname, 'prompt-wmcp-miss-reminder.js');
  const sid = 'wmcp-test-' + process.pid + '-' + Date.now();
  fs.mkdirSync(missHook.STATE_DIR, { recursive: true });
  const marker = path.join(missHook.STATE_DIR, 'denied.' + sid);
  const s = session([]);
  const run = (prompt) => spawnSync(process.execPath, [HOOK2], { input: JSON.stringify({ session_id: sid, transcript_path: s.tp, prompt }), encoding: 'utf8' });
  try {
    assert.strictEqual(path.join(os.tmpdir(), 'claude-wmcp'), missHook.STATE_DIR);
    assert.strictEqual(run('hello').stdout, '', 'no record: silent');
    fs.writeFileSync(marker, JSON.stringify({ ts: '2026-10-18T10:00:00.000Z', tool: 'Clipboard', why: 'no answer within 2 minutes' }) + '\n');
    s.append({ type: 'assistant', timestamp: '2026-10-18T10:00:05.000Z', message: { content: [{ type: 'text', text: '📌 For you\nThe backup is ready.' }] } });
    const auto = run('<task-notification>\n<task-id>x</task-id>');
    assert.strictEqual(auto.stdout, '');
    assert.strictEqual(fs.existsSync(marker), true, 'kept for Erez\'s next message');
    const r = run('ok, next');
    assert.strictEqual(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.match(out.hookSpecificOutput.additionalContext, /PC-control request was not approved/);
    assert.strictEqual(fs.existsSync(marker), false, 'one reminder per miss');
    assert.strictEqual(run('again').stdout, '');
    fs.writeFileSync(marker, JSON.stringify({ ts: '2026-10-18T10:01:00.000Z', tool: 'Click', why: 'Erez clicked Deny' }) + '\n');
    s.append({ type: 'assistant', timestamp: '2026-10-18T10:01:05.000Z', message: { content: [{ type: 'text', text: '📌 For you\nThe PC-control request was not approved (Erez clicked Deny).' }] } });
    assert.strictEqual(run('thanks').stdout, '', 'told in the summary: silent');
    assert.strictEqual(fs.existsSync(marker), false);
  } finally {
    try { fs.unlinkSync(marker); } catch (e) { /* gone */ }
  }
});

// ---- Task pass (GEN-908) ----
const gate908 = require('./windows-mcp-approval.js');
const DECL = [
  'I will finish the Tableau activation: click the server option and type the address.',
  'PC task: Activate Tableau by signing in to a server',
  'App: tableau.exe',
  'Type: "https://us-west-2b.online.tableau.com"',
  'Type: "erez" + Enter',
  'Type: "x" + clear + Enter',
].join('\n');

// A session with a task pass folder and a fake screen-point check.
function taskSession(opts) {
  const s = session([TITLE]);
  s.passDir = path.join(s.dir, 'passes');
  s.point = opts && 'point' in opts ? opts.point : { ok: true, process: 'Tableau', foreground: 'tableau', approvalOpen: false };
  s.points = [];
  s.tdeps = (o) => Object.assign(s.deps(o), {
    passDir: s.passDir,
    runPoint: (x, y) => { s.points.push([x, y]); return typeof s.point === 'function' ? s.point(x, y) : s.point; },
  });
  s.passPath = () => path.join(s.passDir, 'pass.sess-' + seq + '.prompt-1.json');
  // Bounce, write the heads-up (with or without a task block), then the window is shown.
  s.open = (d, text, name, input) => {
    decide(s.req(name || 'Screenshot', input || {}), d);
    s.say(text === undefined ? DECL : text);
    s.t += 8000;
    return decide(s.req(name || 'Screenshot', input || {}), d);
  };
  return s;
}
const taskApprove = () => (p, n) => ({ status: 0, stdout: (p.taskOffer ? 'APPROVED-TASK ' : 'APPROVED ') + n + '\n', stderr: '' });

test('task block: parsed with its app, texts, Enter and clear', () => {
  const r = gate908.parseTask(DECL);
  assert.deepStrictEqual(r.value, {
    task: 'Activate Tableau by signing in to a server', app: 'tableau',
    texts: [
      { text: 'https://us-west-2b.online.tableau.com', enter: false, clear: false },
      { text: 'erez', enter: true, clear: false },
      { text: 'x', enter: true, clear: true },
    ],
  });
  assert.strictEqual(gate908.parseTask('Just a heads-up with no task block at all.'), null);
  assert.deepStrictEqual(gate908.parseTask('PC task: Look at Tableau\nApp: Tableau\n\nType: "later lines are not part of it"').value.texts, []);
});

test('task block: refused for shells, the desktop, Claude, hidden characters and malformed lines', () => {
  for (const app of ['powershell.exe', 'cmd', 'explorer.exe', 'claude.exe', 'WindowsTerminal', 'Code.exe', 'ApplicationFrameHost.exe', 'SystemSettings']) {
    assert.ok(gate908.parseTask('PC task: x task\nApp: ' + app).error, app);
  }
  assert.ok(gate908.parseTask('PC task: t\nApp: tableau.exe\nType: no quotes here').error);
  assert.ok(gate908.parseTask('PC task: t\nApp: tableau.exe\nType: "a' + String.fromCharCode(0x202E) + 'b"').error);
  assert.ok(gate908.parseTask('PC task: t\nType: "a"').error, 'no App line');
  assert.ok(gate908.parseTask('PC task: t\nApp: a.exe\nApp: b.exe').error);
  assert.ok(gate908.parseTask('PC task: t\nApp: a.exe\n\nPC task: u\nApp: b.exe').error, 'two blocks');
  assert.ok(gate908.parseTask('PC task: t\nApp: a.exe\n' + 'Type: "a"\n'.repeat(6)).error, 'too many texts');
  assert.ok(gate908.parseTask('PC task: t\nApp: a.exe\nType: ""').error, 'empty text');
});

test('task block: refused for web browsers (GEN-908 decision, 2026-10-20)', () => {
  for (const app of ['comet.exe', 'Comet', 'chrome.exe', 'CHROME', 'msedge.exe', 'firefox.exe', 'brave.exe', 'opera.exe', 'vivaldi.exe', 'arc.exe', 'iexplore.exe', 'chromium.exe', 'zen.exe', 'librewolf.exe', 'waterfox.exe', 'floorp.exe', 'thorium.exe']) {
    const r = gate908.parseTask('PC task: x task\nApp: ' + app);
    assert.ok(r && r.error && r.error.indexOf('a task pass cannot be used for') === 0, app);
  }
  assert.ok(gate908.parseTask('PC task: x task\nApp: notepad.exe').value, 'a non-browser program is still accepted');
});

test('task offer: the window shows the parsed block and offers the task button', () => {
  const s = taskSession();
  const d = s.tdeps();
  assert.strictEqual(s.open(d).action, 'allow');
  const p = d.calls.payloads[0];
  assert.strictEqual(p.taskOffer, true);
  assert.ok(p.details.includes('PC TASK, as read by the approval check from Claude\'s message:'));
  assert.ok(p.details.includes('Only inside the program: tableau.exe'));
  assert.ok(p.details.includes('    "erez" (then presses Enter)'));
  assert.ok(p.details.includes('    "x" (first selects ALL the text where it clicks and deletes it) (then presses Enter)'));
  assert.ok(p.details.includes('EVERYTHING on all your screens'));
  assert.strictEqual(fs.existsSync(s.passPath()), false, 'plain Allow writes no pass');
});

test('task offer: a status line written after the task block does not hide it', () => {
  const s = taskSession();
  const d = s.tdeps();
  decide(s.req('Screenshot', {}), d);
  s.say(DECL);
  s.say('Taking a screenshot of the Tableau dialog now.');
  s.t += 8000;
  decide(s.req('Screenshot', {}), d);
  const p = d.calls.payloads[0];
  assert.strictEqual(p.taskOffer, true);
  assert.ok(p.details.includes('judge by the action above):\n    Taking a screenshot of the Tableau dialog now.'));
  assert.ok(p.details.includes('Only inside the program: tableau.exe'));
});

test('task offer: none without a task block, without a turn id, or for an invalid block (which is explained)', () => {
  const a = taskSession();
  const da = a.tdeps();
  a.open(da, SAY);
  assert.strictEqual(da.calls.payloads[0].taskOffer, false);
  assert.ok(!da.calls.payloads[0].details.includes('PC TASK'));
  const b = taskSession();
  const db = b.tdeps();
  decide(b.req('Screenshot', {}, { prompt_id: undefined }), db);
  assert.strictEqual(db.calls.payloads[0].taskOffer, false);
  const c = taskSession();
  const dc = c.tdeps();
  c.open(dc, 'I will click in PowerShell to run the script for you now.\nPC task: run it\nApp: powershell.exe');
  assert.strictEqual(dc.calls.payloads[0].taskOffer, false);
  assert.ok(dc.calls.payloads[0].details.includes('was not accepted (a task pass cannot be used for powershell.exe)'));
});

test('task approval: only "Allow for this task" writes the pass; a task answer that was not offered is refused', () => {
  const s = taskSession();
  const d = s.tdeps({ window: taskApprove() });
  assert.strictEqual(s.open(d).action, 'allow');
  const pass = JSON.parse(fs.readFileSync(s.passPath(), 'utf8'));
  assert.strictEqual(pass.app, 'tableau');
  assert.strictEqual(pass.expires - pass.created, 10 * 60 * 1000);
  const n = taskSession();
  const dn = n.tdeps({ window: (p, nonce) => ({ status: 0, stdout: 'APPROVED-TASK ' + nonce + '\n', stderr: '' }) });
  assert.strictEqual(n.open(dn, SAY).action, 'block', 'APPROVED-TASK without an offer is not an approval');
  assert.strictEqual(fs.existsSync(n.passPath()), false);
});

test('task approval: no pass when the delete guard blocks after the window', () => {
  const s = taskSession();
  // Guard runs: bounced call (before), window call (before), window call (after) -> blocks.
  const d = s.tdeps({ guard: [0, 0, 2], window: taskApprove() });
  assert.strictEqual(s.open(d).action, 'block');
  assert.strictEqual(fs.existsSync(s.passPath()), false);
});

// With a pass in place: which calls run without a window.
function withPass(opts) {
  const s = taskSession(opts);
  const d = s.tdeps({ window: taskApprove() });
  s.open(d);
  s.ids = 0;
  // One call as Claude Code makes it: PreToolUse decision, then (unless held back) the
  // PostToolUse run that ends the call. hold: true leaves the call "still running".
  s.run = (name, input, more, opts) => {
    const before = d.calls.window;
    const id = (more && 'tool_use_id' in more) ? more.tool_use_id : 'toolu_' + (++s.ids);
    const req = s.req(name, input, Object.assign({ tool_use_id: id }, more || {}));
    const r = decide(req, d);
    if (r.action === 'allow' && !(opts && opts.hold)) s.end(name, id, more);
    return { r, windowed: d.calls.window > before, id };
  };
  s.end = (name, id, more, event) => gate908.afterCall(JSON.stringify(Object.assign({
    hook_event_name: event || 'PostToolUse', tool_name: 'mcp__windows-mcp__' + name, session_id: 'sess-' + seq, tool_use_id: id,
  }, more && more.session_id ? { session_id: more.session_id } : {})), d);
  s.d = d;
  return s;
}

test('task pass: covered calls run with no window; each point is checked', () => {
  const s = withPass();
  for (const [name, input] of [
    ['Screenshot', { display: [1] }], ['Snapshot', { use_vision: true }], ['DisplayInventory', {}],
    ['ControlStatus', {}], ['Wait', { duration: 2 }], ['WaitFor', { condition: 'text_exists', text: 'Server' }],
    ['Click', { loc: [700, 400] }], ['Click', { loc: [700, 400], button: 'left', clicks: 2 }], ['Click', { loc: [1, 1], clicks: 0 }],
    ['Scroll', { loc: [700, 400], direction: 'down', wheel_times: 10 }], ['Move', { loc: [-5, -7] }],
    ['Type', { loc: [700, 400], text: 'https://us-west-2b.online.tableau.com' }],
    ['Type', { loc: [700, 400], text: 'erez', press_enter: true }],
    ['Type', { loc: [700, 400], text: 'x', clear: true, press_enter: true, caret_position: 'end' }],
  ]) {
    const { r, windowed } = s.run(name, input);
    assert.strictEqual(r.action, 'allow', name + ' ' + JSON.stringify(input));
    assert.strictEqual(windowed, false, name + ' should not open a window');
  }
  assert.strictEqual(s.points.length, 8);
  assert.deepStrictEqual(s.points[0], [700, 400]);
  const log = fs.readFileSync(path.join(s.passDir, 'log.sess-' + seq + '.jsonl'), 'utf8').trim().split('\n');
  assert.strictEqual(log.length, 14);
  assert.strictEqual(JSON.parse(log[6]).tool, 'Click');
});

test('task pass: anything outside the allowlist still opens the window', () => {
  const s = withPass();
  for (const [name, input] of [
    ['PowerShell', { command: 'Get-Date' }], ['FileSystem', { mode: 'read', path: 'C:\\x.txt' }], ['Clipboard', { mode: 'get' }],
    ['Shortcut', { shortcut: 'enter' }], ['Scrape', { url: 'https://x' }], ['Process', { mode: 'list' }],
    ['MultiEdit', { locs: [[1, 2, 'a']] }], ['App', { mode: 'launch', name: 'Tableau' }], ['App', { mode: 'switch', name: 'Tableau' }],
    ['Click', { label: 3 }], ['Click', { loc: '[700, 400]' }], ['Click', { loc: [700, 400], label: 3 }],
    ['Click', { loc: [700, 400], button: 'right' }], ['Click', { loc: [700, 400], clicks: 3 }], ['Click', { loc: [700.5, 400] }],
    ['Click', { loc: [700, 400], clicks: '2' }], ['Click', { loc: [700, 400, 1] }],
    ['Scroll', { direction: 'down' }], ['Scroll', { loc: [700, 400], wheel_times: 11 }],
    ['Move', { loc: [1, 2], drag: true }], ['Move', { loc: [1, 2], from_loc: [3, 4] }],
    ['Type', { loc: [700, 400], text: 'https://us-west-2b.online.tableau.co' }],
    ['Type', { loc: [700, 400], text: 'https://us-west-2b.online.tableau.com', press_enter: true }],
    ['Type', { loc: [700, 400], text: 'erez', clear: true }],
    ['Type', { loc: [700, 400], text: 'erez', press_enter: 'true' }],
    ['Type', { label: 2, text: 'erez' }], ['Type', { text: 'erez' }],
  ]) {
    const { windowed } = s.run(name, input);
    assert.strictEqual(windowed, true, name + ' ' + JSON.stringify(input) + ' must open a window');
  }
});

test('task pass: typing needs the declared app in front, since keys go to the focused window', () => {
  for (const foreground of ['claude', 'WindowsTerminal', '', undefined]) {
    const s = withPass({ point: { ok: true, process: 'tableau', foreground, approvalOpen: false } });
    assert.strictEqual(s.run('Type', { loc: [700, 400], text: 'erez', press_enter: true }).windowed, true, String(foreground));
    assert.strictEqual(s.run('Click', { loc: [700, 400] }).windowed, false, 'a click needs only the point');
  }
});

test('task pass: one screen action at a time - a second one while the first still runs gets the window', () => {
  const s = withPass();
  const first = s.run('Click', { loc: [700, 400] }, null, { hold: true });
  assert.strictEqual(first.windowed, false);
  assert.strictEqual(s.run('Type', { loc: [700, 400], text: 'erez', press_enter: true }).windowed, true, 'first click still running');
  assert.strictEqual(s.run('Screenshot', {}).windowed, false, 'a look needs no lock');
  s.end('Click', 'toolu_other');
  assert.strictEqual(s.run('Click', { loc: [1, 2] }).windowed, true, 'another call\'s end does not release it');
  s.end('Click', first.id, null, 'PostToolUseFailure');
  assert.strictEqual(s.run('Click', { loc: [1, 2] }).windowed, false, 'released when the first call failed');
  const held = s.run('Click', { loc: [1, 2] }, null, { hold: true });
  assert.strictEqual(held.windowed, false);
  s.t += 6 * 60 * 1000 + 1;
  assert.strictEqual(s.run('Click', { loc: [1, 2] }).windowed, false, 'a lock left by a call that never ended expires after 6 minutes');
  assert.strictEqual(s.run('Click', { loc: [1, 2] }, { tool_use_id: undefined }).windowed, true, 'no call id: cannot be released, so not covered');
  const me = 'sess-' + seq;
  const hold = (sid, id) => path.join(s.passDir, 'hold.' + sid + '.' + id + '.json');
  // A note left by an earlier turn of this session (a cancelled call reports nothing back) does not hold up this one.
  fs.writeFileSync(hold(me, 'toolu_old'), JSON.stringify({ sid: me, id: 'toolu_old', at: s.t, turn: 'prompt-0' }));
  assert.strictEqual(s.run('Click', { loc: [1, 2] }).windowed, false);
  assert.strictEqual(fs.existsSync(hold(me, 'toolu_old')), false, 'the left-behind note was removed');
  fs.writeFileSync(hold(me, 'toolu_now'), JSON.stringify({ sid: me, id: 'toolu_now', at: s.t, turn: 'prompt-1' }));
  assert.strictEqual(s.run('Click', { loc: [1, 2] }).windowed, true, 'same turn: still running');
});

test('task pass: one at a time on the whole PC - another session\'s running call counts', () => {
  const s = withPass();
  const other = path.join(s.passDir, 'hold.other-session.toolu_x.json');
  fs.writeFileSync(other, JSON.stringify({ sid: 'other-session', id: 'toolu_x', at: s.t, turn: 'prompt-0' }));
  assert.strictEqual(s.run('Click', { loc: [1, 2] }).windowed, true, 'another session\'s note is not cleared by our turn rule');
  assert.strictEqual(fs.readdirSync(s.passDir).filter((f) => f.startsWith('hold.')).length, 1, 'our own note was taken back');
  s.t += 6 * 60 * 1000 + 1;
  assert.strictEqual(s.run('Click', { loc: [1, 2] }).windowed, false, 'after 6 minutes even another session\'s left-behind note clears');
});

test('task pass: a damaged note counts while fresh and is cleared once old', () => {
  const s = withPass();
  const bad = path.join(s.passDir, 'hold.other-session.toolu_y.json');
  fs.writeFileSync(bad, '');
  assert.strictEqual(s.run('Click', { loc: [1, 2] }).windowed, true, 'fresh empty file: maybe still being written');
  const old = new Date(Date.now() - 7 * 60 * 1000);
  fs.utimesSync(bad, old, old);
  assert.strictEqual(s.run('Click', { loc: [1, 2] }).windowed, false, 'old empty file: left behind, cleared');
  assert.strictEqual(fs.existsSync(bad), false);
  assert.strictEqual(fs.readdirSync(s.passDir).filter((f) => f.startsWith('hold.')).length, 0, 'our note went when the call ended');
});

test('approval path: the note is left before the window, removed on Deny, and another call\'s note does not stop an approved call', () => {
  const s = withPass();
  const mine = path.join(s.passDir, 'hold.sess-' + seq + '.toolu_ps1.json');
  let seen = null;
  const deny = s.tdeps({ window: () => { seen = fs.existsSync(mine); return { status: 1, stdout: '', stderr: 'Erez clicked Deny\r\n' }; } });
  decide(s.req('PowerShell', { command: 'Get-Date' }, { tool_use_id: 'toolu_ps1' }), deny);
  assert.strictEqual(seen, true, 'present while the window was open');
  assert.strictEqual(fs.existsSync(mine), false, 'removed on Deny');
  const other = path.join(s.passDir, 'hold.other-session.toolu_x.json');
  fs.writeFileSync(other, JSON.stringify({ sid: 'other-session', id: 'toolu_x', at: s.t, turn: 'p' }));
  const r = s.run('PowerShell', { command: 'Get-Date' });
  assert.strictEqual(r.r.action, 'allow', 'approved by Erez: runs even though another call is running');
  assert.strictEqual(fs.existsSync(other), true, 'the other call\'s note is untouched');
  fs.unlinkSync(other);
  const look = s.run('Screenshot', {}, null, { hold: true });
  assert.strictEqual(look.windowed, true, 'the pass ended with the Deny, so the look needs a window');
  assert.strictEqual(fs.readdirSync(s.passDir).filter((f) => f.startsWith('hold.')).length, 0, 'a read-only look leaves no note');
});

test('task offer: not on a window whose own action the task would not cover', () => {
  const s = taskSession();
  const d = s.tdeps();
  s.open(d, DECL, 'PowerShell', { command: 'Get-Date' });
  assert.strictEqual(d.calls.payloads[0].taskOffer, false);
  assert.ok(d.calls.payloads[0].details.includes('was not accepted (this action itself is not one the task would cover)'));
  const t = taskSession();
  const dt = t.tdeps();
  t.open(dt, DECL, 'Click', { loc: [700, 400] });
  assert.strictEqual(dt.calls.payloads[0].taskOffer, true, 'a click the task would cover can carry the offer');
  for (const point of [{ ok: true, process: 'WindowsTerminal', foreground: 'tableau', approvalOpen: false }, null]) {
    const u = taskSession({ point });
    const du = u.tdeps();
    u.open(du, DECL, 'Click', { loc: [700, 400] });
    assert.strictEqual(du.calls.payloads[0].taskOffer, false, JSON.stringify(point));
    assert.ok(du.calls.payloads[0].details.includes('was not accepted (this action\'s screen point is not inside tableau.exe)'));
  }
  const v = taskSession({ point: { ok: true, process: 'tableau', foreground: 'claude', approvalOpen: false } });
  const dv = v.tdeps();
  v.open(dv, DECL, 'Type', { loc: [700, 400], text: 'erez', press_enter: true });
  assert.strictEqual(dv.calls.payloads[0].taskOffer, false, 'typing while another program is in front carries no offer');
});

test('task pass: an approved screen-changing call holds the lock until it ends', () => {
  const s = withPass();
  const ps = s.run('PowerShell', { command: 'Start-Process notepad' }, null, { hold: true });
  assert.strictEqual(ps.windowed, true);
  assert.strictEqual(s.run('Click', { loc: [700, 400] }).windowed, true, 'the approved call is still running');
  s.end('PowerShell', ps.id);
  assert.strictEqual(s.run('Click', { loc: [700, 400] }).windowed, false);
});

test('task pass: Wait is covered only for a whole number of seconds up to 60', () => {
  const s = withPass();
  assert.strictEqual(s.run('Wait', { duration: 60 }).windowed, false);
  assert.strictEqual(s.run('Wait', { duration: 0 }).windowed, false);
  for (const input of [{ duration: 61 }, { duration: 86400 }, {}, { duration: '5' }, { duration: 5, extra: 1 }]) {
    assert.strictEqual(s.run('Wait', input).windowed, true, JSON.stringify(input));
  }
});

test('process: the after-call run prints nothing and exits 0', () => {
  for (const ev of ['PostToolUse', 'PostToolUseFailure']) {
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: ev, tool_name: 'mcp__windows-mcp__Click', session_id: 'wmcp-test-none', tool_use_id: 'toolu_x' }), encoding: 'utf8' });
    assert.strictEqual(r.status, 0, ev);
    assert.strictEqual(r.stdout, '');
    assert.strictEqual(r.stderr, '');
  }
  const bad = spawnSync(process.execPath, [HOOK], { input: '{"hook_event_name":"PostToolUse",', encoding: 'utf8' });
  assert.strictEqual(bad.status, 2, 'unreadable input still goes the PreToolUse way (blocked)');
});

test('task pass: Deny or no answer on a later window ends the pass', () => {
  const s = withPass();
  assert.strictEqual(s.run('Screenshot', {}).windowed, false);
  const deny = s.tdeps({ window: () => ({ status: 1, stdout: '', stderr: 'Erez clicked Deny\r\n' }) });
  assert.strictEqual(decide(s.req('PowerShell', { command: 'Get-Date' }), deny).action, 'block');
  assert.strictEqual(fs.existsSync(s.passPath()), false);
  assert.strictEqual(s.run('Screenshot', {}).windowed, true, 'no pass any more');
});

test('task block: a tab in a text or the task is refused (it is shown as a blank but typed as Tab)', () => {
  assert.ok(gate908.parseTask('PC task: t\nApp: a.exe\nType: "a\tb"').error);
  assert.ok(gate908.parseTask('PC task: t\tx\nApp: a.exe').error);
});

test('task offer: the task section is shown first, above the action', () => {
  const s = taskSession();
  const d = s.tdeps();
  s.open(d);
  assert.ok(d.calls.payloads[0].details.startsWith('========================================\nPC TASK, as read'));
  assert.ok(d.calls.payloads[0].details.includes('========================================\n\n(no parameters)'));
});

test('task pass: a point on another program, an open approval window, or a failed check opens the window', () => {
  for (const point of [
    { ok: true, process: 'comet', foreground: 'tableau', approvalOpen: false },
    { ok: true, process: 'tableau', foreground: 'tableau', approvalOpen: true },
    { ok: true, process: 'claude', foreground: 'tableau', approvalOpen: false },
    { ok: false, error: 'no window at point' },
    null,
  ]) {
    const s = withPass({ point });
    assert.strictEqual(s.run('Click', { loc: [700, 400] }).windowed, true, JSON.stringify(point));
    assert.strictEqual(s.run('Screenshot', {}).windowed, false, 'looks need no point');
  }
});

test('task pass: ends with the turn, after 10 minutes and after 30 actions; never for sub-agents', () => {
  const a = withPass();
  const r = a.run('Screenshot', {}, { prompt_id: 'prompt-2' });
  assert.strictEqual(r.r.action, 'block', 'a new turn has no pass (first call bounced)');
  assert.strictEqual(a.run('Screenshot', {}, { prompt_id: undefined }).windowed, true, 'no turn id: no pass');
  assert.strictEqual(a.run('Screenshot', {}, { agent_id: 'x1' }).r.action, 'block');
  const b = withPass();
  b.t += 10 * 60 * 1000;
  assert.strictEqual(b.run('Screenshot', {}).windowed, true, 'expired');
  const c = withPass();
  for (let i = 0; i < 30; i++) assert.strictEqual(c.run('Screenshot', {}).windowed, false, 'action ' + (i + 1));
  assert.strictEqual(c.run('Screenshot', {}).windowed, true, 'action 31');
});

test('task pass: a pass for another session, or an edited or forged pass, covers nothing', () => {
  const s = withPass();
  const pass = JSON.parse(fs.readFileSync(s.passPath(), 'utf8'));
  // This session's pass copied under another session's file name still names this session.
  fs.writeFileSync(path.join(s.passDir, 'pass.other-session.prompt-1.json'), JSON.stringify(pass));
  assert.strictEqual(s.run('Screenshot', {}, { session_id: 'other-session' }).r.action, 'block', 'other session: its first call is bounced, not covered');
  for (const bad of [
    Object.assign({}, pass, { app: 'powershell' }), Object.assign({}, pass, { app: 'comet' }), Object.assign({}, pass, { app: 'chrome' }),
    Object.assign({}, pass, { expires: pass.created + 60 * 60 * 1000 }),
    Object.assign({}, pass, { pid: 'prompt-9' }), Object.assign({}, pass, { v: 2 }), Object.assign({}, pass, { created: s.t + 1000 }),
  ]) {
    fs.writeFileSync(s.passPath(), JSON.stringify(bad));
    assert.strictEqual(s.run('Screenshot', {}).windowed, true, JSON.stringify(bad));
  }
  const t = taskSession();
  const dt = t.tdeps();
  const odd = { session_id: 'sess/../x' };
  decide(t.req('Screenshot', {}, odd), dt);
  t.say(DECL);
  t.t += 8000;
  decide(t.req('Screenshot', {}, odd), dt);
  assert.strictEqual(dt.calls.payloads[0].taskOffer, false, 'an id that needs cleaning is never used for a pass');
});

test('task pass: a new task in the same turn needs its own approval and gets its own 30 actions', () => {
  const s = withPass();
  for (let i = 0; i < 30; i++) s.run('Screenshot', {});
  assert.strictEqual(s.run('Screenshot', {}).windowed, true);
  s.say('Next I will type a different value into the Tableau server box.\nPC task: Enter the site name\nApp: tableau.exe\nType: "muuula"');
  s.t += 1000;
  s.run('Screenshot', {});
  assert.strictEqual(s.run('Type', { loc: [1, 2], text: 'muuula' }).windowed, false);
  assert.strictEqual(s.run('Type', { loc: [1, 2], text: 'erez' }).windowed, true, 'the old texts went with the old pass');
});

test('process: the command guard refuses Claude writes and commands naming the pass folder', () => {
  const AA = path.join(__dirname, 'auto-approve.js');
  const dir = 'C:\\Users\\Erez\\.claude-staging\\' + 'wmcp-task' + '-passes';
  const run = (tool, input) => spawnSync(process.execPath, [AA], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, cwd: 'C:\\Users\\Erez' }), encoding: 'utf8', timeout: 30000 });
  for (const [tool, input] of [
    ['Write', { file_path: dir + '\\pass.a.b.json', content: '{}' }],
    ['Edit', { file_path: dir.toUpperCase() + '\\pass.a.b.json', old_string: 'a', new_string: 'b' }],
    ['Bash', { command: 'echo {} > ~/.claude-staging/' + 'wmcp-task' + '-passes/pass.a.b.json' }],
    ['PowerShell', { command: 'Remove-Item "' + dir + '\\*"' }],
    ['mcp__windows-mcp__FileSystem', { mode: 'write', path: dir + '\\x.json', content: '{}' }],
  ]) {
    const r = run(tool, input);
    assert.strictEqual(r.status, 2, tool + ' ' + r.stderr);
    assert.match(r.stderr, /task-pass guard/);
  }
  const ok = run('Read', { file_path: dir + '\\log.x.jsonl' });
  assert.doesNotMatch(String(ok.stderr), /task-pass guard/, 'reading is not blocked');
});

// ---- Task block from the "Ready?" message (GEN-908 live check) ----
const BLOCK_ONLY = [
  'Next I will finish the Tableau activation. Ready?',
  'PC task: Activate Tableau by signing in to a server',
  'App: tableau.exe',
  'Type: "https://us-west-2b.online.tableau.com"',
].join('\n');
const HEADSUP = 'Taking a screenshot of the Tableau dialog now, as agreed.';
let msgSeq = 0;
// A session whose transcript has real turn starts (as Claude Code writes them) before this turn.
function priorSession(opts) {
  const s = taskSession(opts);
  s.turn = (pid, kind) => s.append(Object.assign({ type: 'user', promptId: pid, turnOrigin: kind || 'sdk', message: { role: 'user', content: 'go' } },
    kind ? { origin: { kind } } : {}));
  s.close = (text, id) => s.append({ type: 'assistant', message: { id: id || 'msg-' + (++msgSeq), content: [{ type: 'text', text }] } });
  s.tool = (id, name) => s.append({ type: 'assistant', message: { id, content: [{ type: 'tool_use', id: 'tu-' + id, name: name || 'x', input: {} }] } });
  s.bounce = (d, name, input) => decide(s.req(name || 'Screenshot', input || {}), d);
  s.retry = (d, name, input) => { s.say(HEADSUP); s.t += 8000; return decide(s.req(name || 'Screenshot', input || {}), d); };
  return s;
}

test('ready message: its block is offered in the first window of Erez\'s reply turn, and the bounce says so', () => {
  const s = priorSession();
  s.turn('prompt-0', 'human');
  s.close(BLOCK_ONLY);
  s.turn('prompt-1', 'human');
  const d = s.tdeps({ window: taskApprove() });
  const b = s.bounce(d);
  assert.strictEqual(b.action, 'block');
  assert.match(b.reason, /was read \(program: tableau\.exe, 1 text\(s\) to type\)/);
  assert.strictEqual(s.retry(d).action, 'allow');
  const p = d.calls.payloads[0];
  assert.strictEqual(p.taskOffer, true);
  assert.ok(p.details.includes('from Claude\'s last message before your reply\n(your reply may not have been about it):'));
  assert.ok(p.details.includes('    ' + HEADSUP), 'the heads-up is still shown as Claude says');
  assert.strictEqual(JSON.parse(fs.readFileSync(s.passPath(), 'utf8')).app, 'tableau');
});

test('ready message: a task notification or another session\'s turn in between does not hide it', () => {
  for (const kind of ['task-notification', 'peer']) {
    const s = priorSession();
    s.turn('prompt-0', 'human');
    s.close(BLOCK_ONLY);
    s.turn('prompt-n', kind);
    s.close('Still waiting for your answer; nothing new to report.');
    s.turn('prompt-1', 'human');
    const d = s.tdeps();
    s.bounce(d);
    s.retry(d);
    assert.strictEqual(d.calls.payloads[0].taskOffer, true, kind);
  }
});

test('ready message: not used unless this turn is Erez\'s reply, the block closes its message, and it came after his previous message', () => {
  const cases = {
    'turn started by a task notification': (s) => { s.turn('prompt-0', 'human'); s.close(BLOCK_ONLY); s.turn('prompt-1', 'task-notification'); },
    'turn with no origin (first prompt of a side session)': (s) => { s.turn('prompt-0', 'human'); s.close(BLOCK_ONLY); s.turn('prompt-1'); },
    'block followed by a PC-control call (a task already done)': (s) => { s.turn('prompt-0', 'human'); s.close(BLOCK_ONLY, 'm-x'); s.tool('m-y', 'mcp__windows-mcp__Click'); s.turn('prompt-1', 'human'); },
    'block before Erez\'s previous message': (s) => { s.turn('prompt-a', 'human'); s.close(BLOCK_ONLY); s.turn('prompt-b', 'human'); s.close('Done, nothing else to do.'); s.turn('prompt-1', 'human'); },
    'block only in a sub-agent': (s) => { s.turn('prompt-0', 'human'); s.append({ type: 'assistant', isSidechain: true, message: { id: 'sc', content: [{ type: 'text', text: BLOCK_ONLY }] } }); s.turn('prompt-1', 'human'); },
    'no turn start for this turn': (s) => { s.turn('prompt-0', 'human'); s.close(BLOCK_ONLY); },
  };
  for (const [name, build] of Object.entries(cases)) {
    const s = priorSession();
    build(s);
    const d = s.tdeps();
    const b = s.bounce(d);
    assert.match(b.reason, /No "PC task:" block was found/, name);
    s.retry(d);
    assert.strictEqual(d.calls.payloads[0].taskOffer, false, name);
    assert.ok(!d.calls.payloads[0].details.includes('PC TASK'), name);
  }
});

test('ready message: asked through the next-step box (text, then the box call in the same message) is read; a progress note is not', () => {
  // Real shape: one API message saved as several entries sharing its id: thinking, text, box call.
  const boxTurn = (s, prose) => {
    s.turn('prompt-0', 'human');
    s.append({ type: 'assistant', message: { id: 'm-box', content: [{ type: 'thinking', thinking: '', signature: 'x' }] } });
    s.append({ type: 'assistant', message: { id: 'm-box', content: [prose] } });
    s.append({ type: 'assistant', message: { id: 'm-box', content: [{ type: 'tool_use', id: 'tu-box', name: 'mcp__ccd_turn__wrap_up', input: { recap: 'Ready.', ask: 'Start now?' } }] } });
    s.append({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu-box', content: 'Shown in the next-step box.' }] } });
    s.turn('prompt-1', 'human');
  };
  const a = priorSession();
  boxTurn(a, { type: 'text', text: BLOCK_ONLY });
  const da = a.tdeps();
  a.bounce(da);
  a.retry(da);
  assert.strictEqual(da.calls.payloads[0].taskOffer, true);
  const b = priorSession();
  // The same text returned as a reworded progress note (narration-tagged thinking block).
  const sig = Buffer.from('\x42\x09narration' + 'x'.repeat(40), 'latin1').toString('base64');
  boxTurn(b, { type: 'thinking', thinking: 'I will finish the Tableau activation once you say go.\n\n', signature: sig });
  const db = b.tdeps();
  assert.match(b.bounce(db).reason, /No "PC task:" block was found/);
  b.retry(db);
  assert.strictEqual(db.calls.payloads[0].taskOffer, false);
});

test('ready message: offered once per turn - after a Deny the next window does not offer it again', () => {
  const s = priorSession();
  s.turn('prompt-0', 'human');
  s.close(BLOCK_ONLY);
  s.turn('prompt-1', 'human');
  const deny = s.tdeps({ window: () => ({ status: 1, stdout: '', stderr: 'Erez clicked Deny\r\n' }) });
  s.bounce(deny);
  assert.strictEqual(s.retry(deny).action, 'block');
  assert.strictEqual(deny.calls.payloads[0].taskOffer, true);
  const d = s.tdeps();
  s.t += 60000;
  decide(s.req('Screenshot', {}), d);
  assert.strictEqual(d.calls.payloads[0].taskOffer, false, 'not offered a second time');
  assert.strictEqual(fs.existsSync(s.passPath()), false);
});

test('ready message: a first action the task would not cover keeps it for the next window', () => {
  const s = priorSession();
  s.turn('prompt-0', 'human');
  s.close(BLOCK_ONLY);
  s.turn('prompt-1', 'human');
  const d = s.tdeps();
  s.bounce(d, 'App', { mode: 'switch', name: 'Tableau' });
  s.retry(d, 'App', { mode: 'switch', name: 'Tableau' });
  assert.strictEqual(d.calls.payloads[0].taskOffer, false);
  assert.ok(d.calls.payloads[0].details.includes('not one the task would cover'));
  s.t += 60000;
  decide(s.req('Screenshot', {}), d);
  assert.strictEqual(d.calls.payloads[1].taskOffer, true);
});

test('ready message: a block that is not accepted is explained once, and named in the bounce', () => {
  const s = priorSession();
  s.turn('prompt-0', 'human');
  s.close('Ready to run it?\nPC task: run the script\nApp: powershell.exe');
  s.turn('prompt-1', 'human');
  const d = s.tdeps();
  assert.match(s.bounce(d).reason, /was not accepted \(a task pass cannot be used for powershell\.exe\)/);
  s.retry(d);
  assert.ok(d.calls.payloads[0].details.includes('was not accepted (a task pass cannot be used for powershell.exe)'));
  s.t += 60000;
  decide(s.req('Screenshot', {}), d);
  assert.ok(!d.calls.payloads[1].details.includes('PC TASK') && !d.calls.payloads[1].details.includes('not accepted'));
});

test('ready message: a block written in this turn wins over the one from the ready message', () => {
  const s = priorSession();
  s.turn('prompt-0', 'human');
  s.close(BLOCK_ONLY);
  s.turn('prompt-1', 'human');
  const d = s.tdeps();
  s.bounce(d);
  s.say('I will type the site name in Notepad instead.\nPC task: Type the site name\nApp: notepad.exe\nType: "muuula"');
  s.t += 8000;
  s.point = { ok: true, process: 'notepad', foreground: 'notepad', approvalOpen: false };
  decide(s.req('Screenshot', {}), d);
  assert.ok(d.calls.payloads[0].details.includes('Only inside the program: notepad.exe'));
  assert.ok(d.calls.payloads[0].details.includes('from Claude\'s message:'));
});

test('ready message: of several accepted blocks the last wins; a later re-quote that is not accepted does not hide it', () => {
  const s = priorSession();
  s.turn('prompt-0', 'human');
  s.close('Earlier idea.\nPC task: Look at Notepad\nApp: notepad.exe');
  s.close(BLOCK_ONLY);
  s.close('Summary of the plan:\nPC task: as above\nApp: ');
  s.turn('prompt-1', 'human');
  const text = gate908.priorDeclaration(s.tp, 'prompt-1');
  assert.strictEqual(text, BLOCK_ONLY);
  assert.strictEqual(gate908.priorDeclaration(path.join(s.dir, 'missing.jsonl'), 'prompt-1'), null);
});

test('ready message: a "PC task:" line after a Unicode line separator is not a block, and does not break the bounce', () => {
  const s = priorSession();
  s.turn('prompt-0', 'human');
  s.close('Ready?' + String.fromCharCode(0x2028) + 'PC task: Activate Tableau\nApp: tableau.exe');
  s.turn('prompt-1', 'human');
  const d = s.tdeps();
  assert.match(s.bounce(d).reason, /No "PC task:" block was found/);
  s.retry(d);
  assert.strictEqual(d.calls.payloads[0].taskOffer, false);
});

test('ready message: the state file remembers "none" and "offered"; this turn\'s own offer retires the ready message block', () => {
  const st = (s) => JSON.parse(fs.readFileSync(path.join(s.stateDir, 'announce.sess-' + seq + '.prompt-1.json'), 'utf8'));
  const a = priorSession();
  a.turn('prompt-0', 'human');
  a.close('Nothing to declare here.');
  a.turn('prompt-1', 'human');
  const da = a.tdeps();
  a.bounce(da);
  a.retry(da);
  assert.strictEqual(st(a).priorNone, true);
  const b = priorSession();
  b.turn('prompt-0', 'human');
  b.close(BLOCK_ONLY);
  b.turn('prompt-1', 'human');
  const db = b.tdeps();
  b.bounce(db);
  b.say('I will type the site name in Notepad instead.\nPC task: Type the site name\nApp: notepad.exe\nType: "muuula"');
  b.t += 8000;
  decide(b.req('Screenshot', {}), db);
  assert.ok(db.calls.payloads[0].details.includes('notepad.exe'));
  assert.strictEqual(st(b).priorOffered, true);
  b.t += 60000;
  decide(b.req('Screenshot', {}), db);
  assert.ok(!db.calls.payloads[1].details.includes('PC TASK'), 'the ready-message block is not offered after this turn\'s own');
});

test('ready message: found behind several MB of screenshots', () => {
  const s = priorSession();
  s.turn('prompt-0', 'human');
  s.close(BLOCK_ONLY);
  const big = 'A'.repeat(4 * 1024 * 1024);
  for (let i = 0; i < 3; i++) s.append({ type: 'user', message: { content: [{ type: 'tool_result', content: [{ type: 'image', source: { data: big } }] }] } });
  s.turn('prompt-1', 'human');
  assert.strictEqual(gate908.priorDeclaration(s.tp, 'prompt-1'), BLOCK_ONLY);
});

// ---- GEN-917 follow-ups ----
test('ready message: a block followed by a file edit in its own turn was quoted while working, not asked', () => {
  for (const tool of ['Edit', 'Write', 'MultiEdit']) {
    const s = priorSession();
    s.turn('prompt-0', 'human');
    s.close(BLOCK_ONLY, 'm-q');
    s.tool('m-t', tool);
    s.close('Done editing the notes.');
    s.turn('prompt-1', 'human');
    assert.strictEqual(gate908.priorDeclaration(s.tp, 'prompt-1'), '', tool);
  }
  const kept = {
    'an edit before the block': (s) => { s.tool('m-t', 'Edit'); s.close(BLOCK_ONLY); },
    'a read-only shell check after the block (end-of-turn checks)': (s) => { s.close(BLOCK_ONLY, 'm-q'); s.tool('m-t', 'PowerShell'); s.tool('m-u', 'Bash'); },
    'an edit in a later notification turn': (s) => { s.close(BLOCK_ONLY, 'm-q'); s.turn('prompt-n', 'task-notification'); s.tool('m-t', 'Edit'); s.close('Noted.'); },
  };
  for (const [name, build] of Object.entries(kept)) {
    const s = priorSession();
    s.turn('prompt-0', 'human');
    build(s);
    s.turn('prompt-1', 'human');
    assert.strictEqual(gate908.priorDeclaration(s.tp, 'prompt-1'), BLOCK_ONLY, name);
  }
});

test('ready message: once found, the block is kept for the turn, so later windows do not re-read the transcript', () => {
  const s = priorSession();
  s.turn('prompt-0', 'human');
  s.close(BLOCK_ONLY);
  s.turn('prompt-1', 'human');
  const d = s.tdeps();
  s.bounce(d, 'App', { mode: 'switch', name: 'Tableau' });
  s.retry(d, 'App', { mode: 'switch', name: 'Tableau' });
  assert.strictEqual(d.calls.payloads[0].taskOffer, false);
  const st = JSON.parse(fs.readFileSync(path.join(s.stateDir, 'announce.sess-' + seq + '.prompt-1.json'), 'utf8'));
  assert.strictEqual(st.priorText, BLOCK_ONLY);
  // The block disappears from the transcript (same length, so offsets stay valid): only the kept copy can offer it.
  const raw = fs.readFileSync(s.tp, 'utf8');
  fs.writeFileSync(s.tp, raw.split('PC task: Activate').join('xx xxxx: Activate'), 'utf8');
  assert.strictEqual(gate908.priorDeclaration(s.tp, 'prompt-1'), '');
  s.t += 60000;
  decide(s.req('Screenshot', {}), d);
  assert.strictEqual(d.calls.payloads[1].taskOffer, true);
});

test('ready message: a block that is not accepted says it came from the message before Erez\'s reply', () => {
  const s = priorSession();
  s.turn('prompt-0', 'human');
  s.close('Ready to run it?\nPC task: run the script\nApp: powershell.exe');
  s.turn('prompt-1', 'human');
  const d = s.tdeps();
  s.bounce(d);
  s.retry(d);
  assert.ok(d.calls.payloads[0].details.includes('Claude\'s last message before your reply had a "PC task:" block, but it was not accepted (a task pass cannot be used for powershell.exe)'));
  const t = taskSession();
  const dt = t.tdeps();
  t.open(dt, 'I will click in PowerShell to run the script for you now.\nPC task: run it\nApp: powershell.exe');
  assert.ok(dt.calls.payloads[0].details.includes('Claude wrote a "PC task:" block, but it was not accepted'), 'this turn\'s own block keeps the old wording');
});

// ---- Stuck add-on (GEN-920 / GEN-933) ----
// Real readings: GEN-920 (Invoice Automation 09575118, 2026-10-19), GEN-933 (Memory Islands Dev
// 46d40f1e, 2026-10-20), countdown refusals (2026-10-12, 2026-10-14, 2026-10-25 live capture).
const refusal = (code, state, gen, wait) => JSON.stringify({ code, status: { state, generation: gen, wait_seconds: wait } });
const statusText = (state, gen, wait) => JSON.stringify({ state, generation: gen, wait_seconds: wait });
function stuckSession() {
  const s = withPass();
  s.log = path.join(s.dir, 'stuck-log.jsonl');
  s.adeps = { passDir: s.passDir, stateDir: s.stateDir, stuckLog: s.log, now: () => s.t };
  s.fail = (name, error) => gate908.afterCall(JSON.stringify({ hook_event_name: 'PostToolUseFailure', tool_name: 'mcp__windows-mcp__' + name, session_id: 'sess-' + seq, tool_use_id: 'tu-f' + (++s.ids), error }), s.adeps);
  s.ok = (name, response) => gate908.afterCall(JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'mcp__windows-mcp__' + name, session_id: 'sess-' + seq, tool_use_id: 'tu-o' + (++s.ids), tool_response: response }), s.adeps);
  s.status = (state, gen, wait) => s.ok('ControlStatus', statusText(state, gen, wait));
  s.marked = () => { try { return !!JSON.parse(fs.readFileSync(path.join(s.stateDir, 'stuck.sess-' + seq + '.json'), 'utf8')).mark; } catch (e) { return false; } };
  return s;
}

test('stuck: the add-on\'s readings are read only from a failed call\'s error or ControlStatus\'s result', () => {
  const cr = gate908.controlReading;
  const ev = (o) => Object.assign({ tool_name: 'mcp__windows-mcp__Screenshot' }, o);
  assert.deepStrictEqual(cr(ev({ hook_event_name: 'PostToolUseFailure', error: refusal('USER_CONTROL', 'user', 75, 0.0) })),
    { refusal: true, code: 'USER_CONTROL', state: 'user', gen: 75, wait: 0 });
  assert.strictEqual(cr(ev({ hook_event_name: 'PostToolUseFailure', error: 'Error: ' + refusal('USER_CONTROL', 'user', 75, 0) })).gen, 75);
  const cs = { hook_event_name: 'PostToolUse', tool_name: 'mcp__windows-mcp__ControlStatus' };
  assert.deepStrictEqual(cr(Object.assign({ tool_response: statusText('user', 30, 9.9997) }, cs)), { refusal: false, code: '', state: 'user', gen: 30, wait: 9.9997 });
  assert.strictEqual(cr(Object.assign({ tool_response: [{ type: 'text', text: statusText('ready', 3, 0) }] }, cs)).state, 'ready');
  for (const bad of [
    ev({ hook_event_name: 'PostToolUse', tool_response: statusText('user', 1, 0) }),
    ev({ hook_event_name: 'PostToolUseFailure', error: 'Some other failure {"code":"X"}' }),
    ev({ hook_event_name: 'PostToolUseFailure', error: statusText('user', 1, 0) }),
    ev({ hook_event_name: 'PostToolUseFailure', error: refusal('USER_CONTROL', 'user', 1.5, 0) }),
    ev({ hook_event_name: 'PostToolUseFailure', error: refusal('USER_CONTROL', 'user', -1, 0) }),
    ev({ hook_event_name: 'PostToolUseFailure', error: refusal('USER_CONTROL', 'user', 1, '0') }),
    ev({ hook_event_name: 'PostToolUseFailure', error: 'x'.repeat(5000) }),
    Object.assign({ tool_response: refusal('USER_CONTROL', 'user', 1, 0) }, cs),
  ]) assert.strictEqual(cr(bad), null, JSON.stringify(bad).slice(0, 120));
});

test('stuck: the GEN-920 readings mark the session; its calls then get no window, before the task pass', () => {
  const s = stuckSession();
  assert.match(s.fail('Screenshot', refusal('USER_CONTROL', 'user', 75, 0.0)), /no countdown \(wait 0, generation 75\)/);
  assert.strictEqual(s.marked(), false, 'one reading is not enough');
  s.t += 20000;
  const note = s.status('user', 75, 9.169908899988513);
  assert.match(note, /is stuck - it has kept generation 75/);
  assert.match(note, /\(1\) Restart the add-on yourself: run exactly & "C:\/Users\/Erez\/\.claude\/scripts\/windows-mcp-restart\.ps1"/);
  assert.match(note, /ask him whether he is ready/);
  assert.doesNotMatch(note, /Reconnect/, 'the desktop app has no Reconnect button for a connected add-on');
  assert.ok(s.marked());
  const log = fs.readFileSync(s.log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepStrictEqual([log.length, log[0].code, log[0].generation, log[0].session], [1, 'USER_CONTROL', 75, 'sess-' + seq]);
  const slots = () => fs.readdirSync(s.passDir).filter((f) => f.includes('.use.')).length;
  const before = slots();
  const shot = s.run('Screenshot', {});
  assert.strictEqual(shot.r.action, 'block');
  assert.match(shot.r.reason, /without a window: the Windows-MCP add-on in this session is stuck \(frozen at generation 75/);
  assert.strictEqual(shot.windowed, false);
  assert.strictEqual(slots(), before, 'no pass slot used');
  const click = s.run('Click', { loc: [700, 400] });
  assert.strictEqual(click.r.action, 'block');
  assert.strictEqual(s.run('ControlStatus', {}).r.action, 'allow', 'ControlStatus still runs');
  assert.match(s.status('user', 75, 9.21), /still stuck \(generation 75/);
  assert.ok(s.marked());
});

test('stuck: the GEN-933 readings (unavailable, frozen generation) mark the session', () => {
  const s = stuckSession();
  s.fail('Screenshot', refusal('CONTROL_UNAVAILABLE', 'unavailable', 89, 0.0));
  s.t += 25000;
  assert.match(s.fail('Screenshot', refusal('CONTROL_UNAVAILABLE', 'unavailable', 89, 0.0)), /is stuck/);
  assert.ok(s.marked());
});

test('stuck: countdown refusals never mark, even with the same generation later', () => {
  for (const [gen, wait] of [[36, 9.95054420000088], [2, 7.01678650000031], [30, 9.994113399996422]]) {
    const s = stuckSession();
    assert.strictEqual(s.fail('Screenshot', refusal('USER_CONTROL', 'user', gen, wait)), '');
    s.t += 25000;
    assert.strictEqual(s.status('user', gen, 9.99), '');
    assert.strictEqual(s.marked(), false, String(gen));
  }
});

test('stuck: a brief "unavailable" that recovers by itself never marks', () => {
  const s = stuckSession();
  assert.match(s.fail('Screenshot', refusal('CONTROL_PREEMPTED', 'unavailable', 85, 0.0)), /no countdown/);
  s.t += 25000;
  assert.strictEqual(s.status('ready', 87, 0), '');
  assert.strictEqual(s.marked(), false);
  assert.strictEqual(fs.existsSync(path.join(s.stateDir, 'stuck.sess-' + seq + '.json')), false);
  const p = stuckSession();
  assert.strictEqual(p.fail('Click', refusal('CONTROL_PREEMPTED', 'ai', 4, 0)), '', 'preempted while working is not a suspect');
  const u = stuckSession();
  u.fail('Screenshot', refusal('CONTROL_UNAVAILABLE', 'unavailable', 5, 0));
  u.t += 25000;
  assert.match(u.fail('Screenshot', refusal('USER_CONTROL', 'user', 6, 9.97)), /^$/, 'recovered into a countdown: forgotten');
  assert.strictEqual(fs.existsSync(path.join(u.stateDir, 'stuck.sess-' + seq + '.json')), false);
});

test('stuck: a check too soon says how long to wait; a new zero-wait generation starts again', () => {
  const s = stuckSession();
  s.fail('Screenshot', refusal('USER_CONTROL', 'user', 75, 0));
  s.t += 5000;
  assert.match(s.status('user', 75, 9.2), /too soon .* about 15 more seconds/);
  assert.strictEqual(s.marked(), false);
  s.t += 16000;
  assert.match(s.status('user', 75, 9.2), /is stuck/);
  const n = stuckSession();
  n.fail('Screenshot', refusal('USER_CONTROL', 'user', 10, 0));
  n.t += 25000;
  assert.match(n.fail('Screenshot', refusal('USER_CONTROL', 'user', 12, 0)), /no countdown \(wait 0, generation 12\)/);
  assert.strictEqual(n.marked(), false);
});

test('stuck: the mark clears on another generation (higher or lower), on ready, on a call that ran, and after 30 minutes', () => {
  const mark = () => {
    const s = stuckSession();
    s.fail('Screenshot', refusal('USER_CONTROL', 'user', 75, 0));
    s.t += 20000;
    s.status('user', 75, 9.17);
    assert.ok(s.marked());
    return s;
  };
  const higher = mark();
  assert.match(higher.status('user', 77, 9.8), /changed state \(generation 77\)/);
  assert.strictEqual(higher.run('Screenshot', {}).r.action, 'allow');
  const lower = mark();
  lower.status('user', 1, 9.9);
  assert.strictEqual(lower.marked(), false);
  const ready = mark();
  assert.match(ready.status('ready', 75, 0), /working again/);
  assert.strictEqual(ready.marked(), false);
  const ran = mark();
  assert.match(ran.ok('Screenshot', [{ type: 'text', text: 'Cursor Position: None' }]), /working again/);
  assert.strictEqual(ran.marked(), false);
  const old = mark();
  old.t += 30 * 60 * 1000;
  assert.strictEqual(old.run('Screenshot', {}).r.action, 'allow', 'expired after 30 minutes');
  const moved = mark();
  assert.match(moved.fail('Screenshot', refusal('USER_CONTROL', 'user', 80, 0)), /changed state .* no countdown \(wait 0, generation 80\)/);
  assert.strictEqual(moved.marked(), false, 'a new wedge needs its own confirmation');
});

test('stuck: no mark without a session id or state folder; an unreadable mark file opens the window as before', () => {
  const s = stuckSession();
  assert.strictEqual(gate908.afterCall(JSON.stringify({ hook_event_name: 'PostToolUseFailure', tool_name: 'mcp__windows-mcp__Screenshot', error: refusal('USER_CONTROL', 'user', 1, 0) }), s.adeps), '');
  fs.mkdirSync(s.stateDir, { recursive: true });
  fs.writeFileSync(path.join(s.stateDir, 'stuck.sess-' + seq + '.json'), '{not json', 'utf8');
  assert.strictEqual(s.run('Screenshot', {}).r.action, 'allow');
  fs.writeFileSync(path.join(s.stateDir, 'stuck.sess-' + seq + '.json'), JSON.stringify({ mark: { gen: 3, at: s.t + 60000 } }), 'utf8');
  assert.strictEqual(s.run('Screenshot', {}).r.action, 'allow', 'a mark from the future (clock change) is not trusted');
});

test('process: a zero-wait refusal adds a note for Claude; other after-call runs stay silent', () => {
  const sid = 'wmcp-test-' + crypto.randomBytes(6).toString('hex');
  const f = path.join(missHook.STATE_DIR, 'stuck.' + sid + '.json');
  try {
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'PostToolUseFailure', tool_name: 'mcp__windows-mcp__Screenshot', session_id: sid, tool_use_id: 'toolu_x', error: refusal('USER_CONTROL', 'user', 75, 0) }), encoding: 'utf8' });
    assert.strictEqual(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.hookSpecificOutput.hookEventName, 'PostToolUseFailure');
    assert.match(out.hookSpecificOutput.additionalContext, /no countdown/);
    const q = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'PostToolUseFailure', tool_name: 'mcp__windows-mcp__Screenshot', session_id: sid, tool_use_id: 'toolu_y', error: refusal('USER_CONTROL', 'user', 76, 9.5) }), encoding: 'utf8' });
    assert.strictEqual(q.status, 0);
    assert.strictEqual(q.stdout, '', 'a countdown refusal adds nothing');
  } finally {
    try { fs.unlinkSync(f); } catch (e) { /* none */ }
  }
});

// Window script checks that need no clicking (no window is shown).
const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const WINDOW = path.join(__dirname, 'windows-mcp-approval.ps1');

function runWindowScript(args) {
  return spawnSync(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', WINDOW].concat(args), { encoding: 'utf8', timeout: 60000 });
}

test('window script parses and is pure ASCII', () => {
  const check = "$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseFile($env:WMCP_PS1,[ref]$t,[ref]$e);$e.Count";
  const r = spawnSync(PS, ['-NoProfile', '-Command', check], { encoding: 'utf8', env: { ...process.env, WMCP_PS1: WINDOW } });
  assert.strictEqual(r.stdout.trim(), '0', r.stdout + r.stderr);
  assert.ok(fs.readFileSync(WINDOW).every((b) => b > 0 && b < 128));
});

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
function writePayload(name, obj) {
  const bytes = Buffer.from(JSON.stringify(obj), 'utf8');
  const file = path.join(tmpDir, name);
  fs.writeFileSync(file, bytes);
  return { file, sha: sha256(bytes) };
}

test('window script: missing request file exits 1 without approving', () => {
  const r = runWindowScript(['-PayloadFile', path.join(tmpDir, 'missing.json'), '-Nonce', 'abc', '-PayloadSha256', '0'.repeat(64)]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /could not start/);
  assert.doesNotMatch(r.stdout, /APPROVED/);
});

test('window script: launcher already gone exits 1 before any window', () => {
  const gone = spawnSync(process.execPath, ['-e', '0']);
  const p = writePayload('payload.json', { tool: 'Screenshot', details: 'x', skipWait: false });
  const r = runWindowScript(['-PayloadFile', p.file, '-Nonce', 'abc', '-PayloadSha256', p.sha, '-ParentPid', String(gone.pid)]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /cancelled/);
  assert.doesNotMatch(r.stdout, /APPROVED/);
});

test('window script: request rewritten after the hook wrote it exits 1, no window (GEN-903)', () => {
  const gone = spawnSync(process.execPath, ['-e', '0']);
  const p = writePayload('payload-swapped.json', { tool: 'Screenshot', details: 'take a screenshot', skipWait: false });
  fs.writeFileSync(p.file, JSON.stringify({ tool: 'Screenshot', details: 'take a screenshot!', skipWait: false }), 'utf8');
  const r = runWindowScript(['-PayloadFile', p.file, '-Nonce', 'abc', '-PayloadSha256', p.sha, '-ParentPid', String(gone.pid)]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /changed after the hook wrote them/);
  assert.doesNotMatch(r.stderr, /cancelled/);
  assert.doesNotMatch(r.stdout, /APPROVED/);
});

test('window script: an upper-case fingerprint for the right bytes is accepted', () => {
  const gone = spawnSync(process.execPath, ['-e', '0']);
  const p = writePayload('payload-upper.json', { tool: 'Screenshot', details: 'x', skipWait: false });
  const r = runWindowScript(['-PayloadFile', p.file, '-Nonce', 'abc', '-PayloadSha256', p.sha.toUpperCase(), '-ParentPid', String(gone.pid)]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /cancelled/);
});

test('window script: Hebrew request with the right fingerprint gets past the check', () => {
  const gone = spawnSync(process.execPath, ['-e', '0']);
  const heb = String.fromCharCode(0x05E7, 0x05D5, 0x05D1, 0x05E5);
  const p = writePayload('payload-hebrew.json', { tool: 'PowerShell', details: 'Get-ChildItem "C:\\' + heb + '"', skipWait: false });
  const r = runWindowScript(['-PayloadFile', p.file, '-Nonce', 'abc', '-PayloadSha256', p.sha, '-ParentPid', String(gone.pid)]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /cancelled/);
});

test('window script: a wrong-length fingerprint is refused', () => {
  const gone = spawnSync(process.execPath, ['-e', '0']);
  const p = writePayload('payload-short.json', { tool: 'Screenshot', details: 'x', skipWait: false });
  const r = runWindowScript(['-PayloadFile', p.file, '-Nonce', 'abc', '-PayloadSha256', p.sha.slice(0, 63), '-ParentPid', String(gone.pid)]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /changed after the hook wrote them/);
});

const POINT_PS1 = path.join(__dirname, 'windows-mcp-point.ps1');
function runPointScript(x, y) {
  return spawnSync(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', POINT_PS1], { encoding: 'utf8', timeout: 60000, env: { ...process.env, WMCP_POINT_X: x, WMCP_POINT_Y: y } });
}

test('point script parses and is pure ASCII', () => {
  const check = "$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseFile($env:WMCP_PS1,[ref]$t,[ref]$e);$e.Count";
  const r = spawnSync(PS, ['-NoProfile', '-Command', check], { encoding: 'utf8', env: { ...process.env, WMCP_PS1: POINT_PS1 } });
  assert.strictEqual(r.stdout.trim(), '0', r.stdout + r.stderr);
  assert.ok(fs.readFileSync(POINT_PS1).every((b) => b > 0 && b < 128));
});

test('point script: a malformed or missing point exits 1 with ok false', () => {
  for (const [x, y] of [['1e3', '5'], ['5', ''], ['12.5', '3'], ['-', '1'], ['1234567', '1']]) {
    const r = runPointScript(x, y);
    assert.strictEqual(r.status, 1, x + ',' + y);
    assert.strictEqual(JSON.parse(r.stdout.trim()).ok, false);
  }
});

test('point script: a point on no screen is refused', () => {
  const r = runPointScript('-99999', '-99999');
  assert.strictEqual(r.status, 1);
  assert.strictEqual(JSON.parse(r.stdout.trim()).error, 'point not on a screen');
});

test('point script: a real point names a program and reports no open approval window', () => {
  const r = runPointScript('10', '10');
  const out = JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
  if (r.status === 0) {
    assert.strictEqual(out.ok, true);
    assert.match(out.process, /^\S+$/);
    assert.strictEqual(typeof out.foreground, 'string');
    assert.strictEqual(out.approvalOpen, false);
  } else {
    // Only these are acceptable here; 'not DPI aware' would mean the check never works.
    assert.ok(['no window at point', 'point not on a screen'].includes(out.error), out.error);
  }
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); }
}
fs.rmSync(tmpDir, { recursive: true, force: true });
console.log(failed ? failed + ' of ' + tests.length + ' FAILED' : 'all ' + tests.length + ' passed');
process.exit(failed ? 1 : 0);
