// GEN-606 step C -- /vet-code Step 4 fixtures for the search-first stage of stop-foryou-nudge.js.
// Drives the REAL hook file through stdin exactly as the harness does, from a copy placed in a
// fixture dir (so __dirname -- and therefore search-first-nudges.jsonl and the off-switch file --
// resolve there, never in ~/.claude/hooks), with TEMP pointed at a fresh state dir per case.
// Transcripts are synthetic (no real transcript text is kept in the repo).
// Usage: node test-search-first.js <hook under test> <baseline hook (the pre-change live copy)>
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const HOOK_SRC = process.argv[2];
const BASE_SRC = process.argv[3];
if (!HOOK_SRC || !BASE_SRC || !fs.existsSync(HOOK_SRC) || !fs.existsSync(BASE_SRC)) {
  console.log('usage: node test-search-first.js <hook under test> <baseline hook>'); process.exit(1);
}
const FIX = fs.mkdtempSync(path.join(os.tmpdir(), 'gen606-sf-'));
const HDIR = path.join(FIX, 'hooks'); fs.mkdirSync(HDIR);
const BDIR = path.join(FIX, 'base'); fs.mkdirSync(BDIR);
const HOOK = path.join(HDIR, 'stop-foryou-nudge.js'); fs.writeFileSync(HOOK, fs.readFileSync(HOOK_SRC));
const BASE = path.join(BDIR, 'stop-foryou-nudge.js'); fs.writeFileSync(BASE, fs.readFileSync(BASE_SRC));
const LOG = path.join(HDIR, 'search-first-nudges.jsonl');
const OFF = path.join(HDIR, 'search-first-after-block.off'); // the round-1 design's switch file: must NOT be needed
const SWITCH = path.join(HDIR, 'search-first-switch.jsonl');
const M = require(HOOK);
const PIN = '\u{1F4CC}';

let n = 0; const fails = [];
function check(name, cond, detail) {
  n++; if (!cond) fails.push(name);
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '  [' + String(detail || '').slice(0, 300) + ']'));
}
let tmpN = 0;
function freshTmp() { const d = path.join(FIX, 'tmp-' + (tmpN++)); fs.mkdirSync(d); return d; }
function run(hook, payload, tmp) {
  const env = Object.assign({}, process.env, { TEMP: tmp, TMP: tmp, TMPDIR: tmp });
  const t0 = Date.now();
  const r = cp.spawnSync(process.execPath, [hook], { input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8', timeout: 30000, env });
  let ctx = null; try { ctx = r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : null; } catch (e) { ctx = 'UNPARSEABLE:' + r.stdout; }
  return { code: r.status, out: r.stdout || '', ctx, ms: Date.now() - t0 };
}
function logRows() { try { return fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (e) { return []; } }
function clearLog() { try { fs.unlinkSync(LOG); } catch (e) {} }

// --- synthetic transcript entries
let u = 0;
const human = (text) => ({ type: 'user', uuid: 'h-' + (++u), origin: { kind: 'human' }, message: { role: 'user', content: text } });
const humanOld = (text) => ({ type: 'user', uuid: 'o-' + (++u), message: { role: 'user', content: text } });
const notif = () => ({ type: 'user', uuid: 'n-' + (++u), origin: { kind: 'task-notification' }, message: { role: 'user', content: '<task-notification>done</task-notification>' } });
const meta = () => ({ type: 'user', uuid: 'm-' + (++u), isMeta: true, message: { role: 'user', content: [{ type: 'text', text: 'Base directory for this skill: x' }] } });
const tool = (name, input, id) => ({ type: 'assistant', message: { id: 'msg-' + (++u), role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: id, name: name, input: input || {} }] } });
const result = (id, isError) => ({ type: 'user', uuid: 'r-' + (++u), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: isError === true, content: isError ? 'Error' : 'ok' }] } });
const text = (t) => ({ type: 'assistant', message: { id: 'msg-' + (++u), role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: t }] } });
const summary = (ctx) => ({ type: 'system', subtype: 'stop_hook_summary', hookAdditionalContext: ctx || [] });
const NS = 'mcp__46ff9446-421e-4358-809c-6b8b01e661b2__notion-search';
const NF = 'mcp__46ff9446-421e-4358-809c-6b8b01e661b2__notion-fetch';
const NQ = 'mcp__46ff9446-421e-4358-809c-6b8b01e661b2__notion-query-data-sources';
const JQL = 'mcp__9da13451-799f-4bf6-9a8f-58fe25fc6c80__searchJiraIssuesUsingJql';
let tN = 0;
function transcript(entries) { const f = path.join(FIX, 't' + (tN++) + '.jsonl'); fs.writeFileSync(f, entries.map((e) => JSON.stringify(e)).join('\n') + '\n'); return f; }
const pay = (tp, msg, over) => Object.assign({ session_id: 'sess-' + tN, prompt_id: 'p-' + tN, transcript_path: tp, cwd: FIX, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: msg }, over || {});

const ASK = 'I found a gap in the backup step.\n\nShould I file a ticket for it under GEN-86?';
const BLOCK_ASK = 'Done.\n\n---\n' + PIN + ' **For you**\nYou asked me to check the backup. **Decision:** should I file a ticket for the gap? (low)';
const COMMIT_BLOCK = 'Done.\n\n---\n' + PIN + ' **For you**\nYou asked me to check the backup. I\'ll file a follow-up ticket for the gap.';

// ---- 1. Mode A: no block, proposal, no search -> For-you note + SF_NOTE_WITH_BLOCK appended; fire row A
clearLog();
let tp = transcript([human('check the backup'), tool(NF, { id: 'x' }, 't1'), result('t1'), text(ASK)]);
let tmp = freshTmp();
let w = run(HOOK, pay(tp, ASK), tmp); let b = run(BASE, pay(tp, ASK), freshTmp());
check('1 Mode A: working = baseline + SF_NOTE_WITH_BLOCK exactly', w.code === 0 && b.ctx && w.ctx === b.ctx + M.SF_NOTE_WITH_BLOCK, w.ctx);
let rows = logRows();
check('1 Mode A: one fire row, mode A, patterns include ask-ticket, searchAge -1', rows.length === 1 && rows[0].kind === 'fire' && rows[0].mode === 'A' && rows[0].patterns.indexOf('ask-ticket') !== -1 && rows[0].searchAge === -1, JSON.stringify(rows));
check('1 Mode A: notion-fetch alone is not a search (the 2026-10-08 case)', rows.length === 1);
// same Erez message again (e.g. a task-notification turn, new prompt_id) -> capped
let w2 = run(HOOK, pay(tp, ASK, { prompt_id: 'p-other' }), tmp);
check('1b cap: same Erez message, new prompt_id -> no second search-first note', w2.ctx === b.ctx, w2.ctx);

// ---- 2. Mode B: block already in the reply -> SF_NOTE_ALONE only
clearLog();
tp = transcript([human('check the backup'), text(BLOCK_ASK)]);
w = run(HOOK, pay(tp, BLOCK_ASK), freshTmp()); b = run(BASE, pay(tp, BLOCK_ASK), freshTmp());
check('2 Mode B: baseline silent, working emits exactly SF_NOTE_ALONE', b.out === '' && w.ctx === M.SF_NOTE_ALONE, JSON.stringify({ b: b.out, w: w.ctx }));
check('2 Mode B: note does not start with the For-you prefix', w.ctx.indexOf('For-you check, automatic') !== 0);
rows = logRows();
check('2 Mode B: fire row mode B, blockShown true', rows.length === 1 && rows[0].mode === 'B' && rows[0].blockShown === true, JSON.stringify(rows));

// ---- 3. a successful search since Erez's message -> silent (both modes); before it -> fires
for (const [nm, name] of [['notion-search', NS], ['notion-query-data-sources', NQ], ['Jira JQL search', JQL]]) {
  tp = transcript([human('check'), tool(name, { query: 'x' }, 's1'), result('s1'), text(BLOCK_ASK)]);
  w = run(HOOK, pay(tp, BLOCK_ASK), freshTmp());
  check('3 ' + nm + ' after Erez message -> no note', w.out === '', w.out);
}
tp = transcript([human('check'), tool('PowerShell', { command: 'curl.exe -s -X POST "https://api.notion.com/v1/databases/abc123/query" -K cfg' }, 's1'), result('s1'), text(BLOCK_ASK)]);
check('3 REST database query after Erez message -> no note', run(HOOK, pay(tp, BLOCK_ASK), freshTmp()).out === '');
tp = transcript([human('check'), tool('Skill', { skill: 'vet-ticket' }, 's1'), result('s1'), text(BLOCK_ASK)]);
check('3 /vet-ticket ran after Erez message -> no note', run(HOOK, pay(tp, BLOCK_ASK), freshTmp()).out === '');
tp = transcript([human('earlier'), tool(NS, { query: 'x' }, 's0'), result('s0'), text('ok'), human('check'), text(BLOCK_ASK)]);
clearLog();
w = run(HOOK, pay(tp, BLOCK_ASK), freshTmp());
rows = logRows();
check('3 search only BEFORE Erez message -> fires, searchAge 1', w.ctx === M.SF_NOTE_ALONE && rows.length === 1 && rows[0].searchAge === 1, JSON.stringify(rows));
tp = transcript([human('check'), tool(NS, { query: 'x' }, 's1'), result('s1', true), text(BLOCK_ASK)]);
check('3 search that came back is_error -> still fires', run(HOOK, pay(tp, BLOCK_ASK), freshTmp()).ctx === M.SF_NOTE_ALONE);
tp = transcript([human('check'), tool(NS, { query: 'x' }, 's1'), text(BLOCK_ASK)]);
check('3 search with no result in the transcript yet (lag) -> counts as searched, no note', run(HOOK, pay(tp, BLOCK_ASK), freshTmp()).out === '');
tp = transcript([human('check'), tool(NS, { query: 'x' }, 's1'), result('s1'), notif(), meta(), text(BLOCK_ASK)]);
check('3 task-notification / meta entries are not Erez messages (search before them still counts)', run(HOOK, pay(tp, BLOCK_ASK), freshTmp()).out === '');
tp = transcript([humanOld('check'), tool(NS, { query: 'x' }, 's1'), result('s1'), text(BLOCK_ASK)]);
check('3 pre-origin transcript: plain user entry is Erez message; search after it counts', run(HOOK, pay(tp, BLOCK_ASK), freshTmp()).out === '');

// ---- 4. Mode B only for decision patterns; commitments fire only in Mode A
tp = transcript([human('check'), text(COMMIT_BLOCK)]);
check('4 Mode B commitment ("I\'ll file a follow-up ticket") -> no note', run(HOOK, pay(tp, COMMIT_BLOCK), freshTmp()).out === '');
const COMMIT = 'Done. I\'ll file a follow-up ticket for the gap.';
tp = transcript([human('check'), text(COMMIT)]);
w = run(HOOK, pay(tp, COMMIT), freshTmp()); b = run(BASE, pay(tp, COMMIT), freshTmp());
check('4 Mode A commitment -> fires', w.ctx === b.ctx + M.SF_NOTE_WITH_BLOCK, w.ctx);

// ---- 5. off-switch (a switch row in the log; newest wins): Mode B silenced, Mode A unaffected
clearLog();
fs.appendFileSync(SWITCH, JSON.stringify({ ts: 'x', kind: 'switch', afterBlock: 'off' }) + '\n');
tp = transcript([human('check'), text(BLOCK_ASK)]);
check('5 switched off -> Mode B silent', run(HOOK, pay(tp, BLOCK_ASK), freshTmp()).out === '');
tp = transcript([human('check'), text(ASK)]);
w = run(HOOK, pay(tp, ASK), freshTmp()); b = run(BASE, pay(tp, ASK), freshTmp());
check('5 switched off -> Mode A still fires', w.ctx === b.ctx + M.SF_NOTE_WITH_BLOCK);
fs.appendFileSync(SWITCH, JSON.stringify({ ts: 'y', kind: 'switch', afterBlock: 'on' }) + '\n');
tp = transcript([human('check'), text(BLOCK_ASK)]);
check('5 switched back on (newest row wins) -> Mode B fires', run(HOOK, pay(tp, BLOCK_ASK), freshTmp()).ctx === M.SF_NOTE_ALONE);
fs.writeFileSync(SWITCH, 'garbage\n{"kind":"switch","afterBlock":\n');
tp = transcript([human('check'), text(BLOCK_ASK)]);
check('5 unreadable switch rows -> on (Mode B fires)', run(HOOK, pay(tp, BLOCK_ASK), freshTmp()).ctx === M.SF_NOTE_ALONE);
check('5 no off-switch FILE is consulted any more', !fs.existsSync(OFF));

// ---- 6. "after" row: pairing, outcome fields, stale pending, duplicate block
clearLog();
let ctmp = freshTmp();
const sid = 'after-sess';
tp = transcript([human('check'), text(BLOCK_ASK)]);
w = run(HOOK, pay(tp, BLOCK_ASK, { session_id: sid, prompt_id: 'P1' }), ctmp);
check('6 fire for the after-row test', w.ctx === M.SF_NOTE_ALONE);
const BOARD = 'I searched the board: [GEN-218](https://app.notion.com/p/abc) already covers this; I would add it there instead of filing a new ticket.';
let tp2 = transcript([human('check'), text(BLOCK_ASK), summary([M.SF_NOTE_ALONE]), tool(NS, { query: 'backup gap' }, 'q1'), result('q1'), text(BOARD)]);
w = run(HOOK, pay(tp2, BOARD, { session_id: sid, prompt_id: 'P1', stop_hook_active: true }), ctmp);
rows = logRows();
const after = rows.filter((r) => r.kind === 'after');
check('6 continuation Stop: no new note', w.out === '', w.out);
check('6 after row: mode B, anchorOk, searched, resultLine, resultMatch, no re-issue', after.length === 1 && after[0].mode === 'B' && after[0].anchorOk === true && after[0].searched === true && after[0].resultLine === true && after[0].resultMatch === true && after[0].blockReissued === false, JSON.stringify(after));
// bold result sentence still counts; a wrong anchor (summary without this stage's note) shows anchorOk false
clearLog(); ctmp = freshTmp();
run(HOOK, pay(tp, BLOCK_ASK, { session_id: sid, prompt_id: 'P5' }), ctmp);
const BOLD = '**I searched the board** and nothing on it covers this.';
tp2 = transcript([human('check'), text(BLOCK_ASK), summary(['some other hook note']), tool(NS, { query: 'gap' }, 'q5'), result('q5'), text(BOLD)]);
run(HOOK, pay(tp2, BOLD, { session_id: sid, prompt_id: 'P5', stop_hook_active: true }), ctmp);
const after5 = logRows().filter((r) => r.kind === 'after');
check('6 bold result sentence -> resultLine true; wrong anchor -> anchorOk false', after5.length === 1 && after5[0].resultLine === true && after5[0].resultMatch === false && after5[0].anchorOk === false, JSON.stringify(after5));
check('6 pending file consumed', !fs.readdirSync(path.join(ctmp, 'claude-foryou-nudge-state')).some((x) => x.startsWith('searchfirst-after.')));
// duplicate block in the continuation
clearLog(); ctmp = freshTmp();
run(HOOK, pay(tp, BLOCK_ASK, { session_id: sid, prompt_id: 'P2' }), ctmp);
const DUP = 'I searched the board and nothing covers this.\n\n---\n' + PIN + ' **For you**\nShould I file a ticket for the gap?';
tp2 = transcript([human('check'), text(BLOCK_ASK), summary([M.SF_NOTE_ALONE]), tool(NS, { query: 'gap' }, 'q2'), result('q2'), text(DUP)]);
run(HOOK, pay(tp2, DUP, { session_id: sid, prompt_id: 'P2', stop_hook_active: true }), ctmp);
const after2 = logRows().filter((r) => r.kind === 'after');
check('6 re-issued block is recorded (blockReissued true, resultMatch false)', after2.length === 1 && after2[0].blockReissued === true && after2[0].resultMatch === false, JSON.stringify(after2));
// stale pending (other prompt) -> removed, no row
clearLog(); ctmp = freshTmp();
run(HOOK, pay(tp, BLOCK_ASK, { session_id: sid, prompt_id: 'P3' }), ctmp);
run(HOOK, pay(tp2, 'I searched the board; nothing.', { session_id: sid, prompt_id: 'OTHER', stop_hook_active: true }), ctmp);
check('6 stale pending (other prompt_id) -> removed, no after row', logRows().filter((r) => r.kind === 'after').length === 0 && !fs.readdirSync(path.join(ctmp, 'claude-foryou-nudge-state')).some((x) => x.startsWith('searchfirst-after.')));
// Mode A after row: the continuation writes the block (expected); searched recorded
clearLog(); ctmp = freshTmp();
tp = transcript([human('check'), text(ASK)]);
w = run(HOOK, pay(tp, ASK, { session_id: sid, prompt_id: 'P4' }), ctmp);
const BLK = 'I searched the board and nothing covers this.\n\n---\n' + PIN + ' **For you**\nShould I file a ticket for the gap? (low)';
tp2 = transcript([human('check'), text(ASK), summary([w.ctx]), tool(NS, { query: 'gap' }, 'q4'), result('q4'), text(BLK)]);
w2 = run(HOOK, pay(tp2, BLK, { session_id: sid, prompt_id: 'P4', stop_hook_active: true }), ctmp);
const after4 = logRows().filter((r) => r.kind === 'after');
check('6 Mode A after row: mode A, anchorOk, searched, blockReissued false; no note on the block message', after4.length === 1 && after4[0].mode === 'A' && after4[0].anchorOk === true && after4[0].searched === true && after4[0].blockReissued === false && w2.out === '', JSON.stringify(after4) + ' ' + w2.out);

// ---- 7. exclusions and non-proposals -> no note (Mode B setting, so any note would be search-first's)
const NON = [
  ['GEN-58 log', PIN + ' For you\nI logged it to GEN-58. Want me to file it as a ticket too?'],
  ['edit on existing ticket', PIN + ' For you\nShould I file this update on GEN-732?'],
  ['add findings to named ticket', PIN + ' For you\nShould I add these findings to the takeover ticket [GEN-732](https://x)?'],
  ['arrow rule', PIN + ' For you\nIf yes -> file it as a ticket routed to the epic.'],
  ['/vet-ticket card (Title then Summary)', PIN + ' For you\n- **Title:** Fix the gap\n- **Summary:** adds the gap\n- **Parent:** GEN-86\n- **Priority:** High'],
  ['quoted wording', PIN + ' For you\nThe pattern "should I file a ticket" is matched.'],
  ['code span', PIN + ' For you\nThe regex `should I file a ticket` matches.'],
  ['past report', PIN + ' For you\nI filed GEN-812 for the gap.'],
  ['invoice filing', PIN + ' For you\nShould I file it in the March folder?'],
  ['vendor support ticket', PIN + ' For you\nShould I open a support ticket with Azure for the billing transfer?'],
  ['ticket with a vendor', PIN + ' For you\nShould I raise a ticket with Microsoft about it?'],
  ['open an existing ticket to view it', PIN + ' For you\nShould I open the takeover ticket in Notion for you?'],
  ['"Titles" prose, no Title: field', PIN + ' For you\nTitles now match the sheet.\n\nProblem: the export drops a column.'],
];
// recall fixes from Pass A
check('7 asterisk bullet plan step is seen (Mode A only)', M.detectTicketProposals('Next:\n* File a follow-up ticket for the dead guard.').indexOf('plan-step') !== -1);
check('7 inch mark does not swallow the proposal', M.detectTicketProposals('The 24" monitor arrived. Should I file a ticket for the broken stand? "Yes"').indexOf('ask-ticket') !== -1);
check('7 "a ticket with these acceptance criteria" is not a vendor ticket', M.detectTicketProposals("The monitor is unbuilt; I'd file it as a ticket with these acceptance criteria.").indexOf('would-new') !== -1);
check('7 "a ticket with GEN-86 as its parent" is not a vendor ticket', M.detectTicketProposals('Should I file a ticket with GEN-86 as its parent?').indexOf('ask-ticket') !== -1);
check('7 "open the PR" after a real proposal does not hide it', M.detectTicketProposals('Should I file a ticket for this and open the PR?').indexOf('ask-ticket') !== -1);
check('7 "file a ticket to support X" still counts', M.detectTicketProposals('Should I file a ticket to support the new model list?').indexOf('ask-ticket') !== -1);
for (const [nm, msg] of NON) {
  tp = transcript([human('x'), text(msg)]);
  check('7 no note: ' + nm, run(HOOK, pay(tp, msg), freshTmp()).out === '');
}
check('7 empty reply -> same as baseline', (function () { tp = transcript([human('x')]); return run(HOOK, pay(tp, ''), freshTmp()).out === run(BASE, pay(tp, ''), freshTmp()).out; })());

// ---- 8. incident wording
const INC_1008 = 'Next item: the old test file the compaction dropped. File this ticket?\n- **Title:** Make the old suite run again\n- **Where it goes:** under GEN-86';
const INC_0802 = 'This fits the volume-rollover race. I could fold it into GEN-593 or file it as its own ticket.';
check('8 2026-10-08 incident wording matches (bare-ask + chat-draft)', M.detectTicketProposals(INC_1008).indexOf('bare-ask') !== -1 && M.detectTicketProposals(INC_1008).indexOf('chat-draft') !== -1, M.detectTicketProposals(INC_1008));
check('8 2026-08-02 paraphrase matches (own-ticket)', M.detectTicketProposals(INC_0802).indexOf('own-ticket') !== -1, M.detectTicketProposals(INC_0802));

// ---- 9. robustness: missing / malformed / non-string transcript -> no search-first note, For-you unchanged
for (const [nm, tpx] of [['missing transcript', path.join(FIX, 'nope.jsonl')], ['malformed transcript', (function () { const f = path.join(FIX, 'bad.jsonl'); fs.writeFileSync(f, '{not json\n\u0000\u0001garbage'); return f; })()], ['transcript_path not a string', 42]]) {
  w = run(HOOK, pay(tpx, ASK), freshTmp()); b = run(BASE, pay(tpx, ASK), freshTmp());
  check('9 ' + nm + ': Mode A -> the baseline For-you note only (window unreadable)', w.code === 0 && w.out === b.out, w.ctx);
  w = run(HOOK, pay(tpx, BLOCK_ASK), freshTmp());
  check('9 ' + nm + ': Mode B -> silent', w.code === 0 && w.out === '');
}
w = run(HOOK, 'not json at all', freshTmp());
check('9 unparseable payload -> exit 0, no output', w.code === 0 && w.out === '');
// state dir unusable (TEMP points at a FILE): the slot cannot be claimed -> no search-first note
const fileTmp = path.join(FIX, 'tmp-is-a-file'); fs.writeFileSync(fileTmp, 'x');
tp = transcript([human('x'), text(BLOCK_ASK)]);
w = run(HOOK, pay(tp, BLOCK_ASK), fileTmp);
check('9 unusable state dir -> no search-first note, exit 0', w.code === 0 && w.out === '', w.out);

// ---- 10. adversarial timing through the whole hook (long whitespace after each verb; 200K replies)
const ADV = [];
for (const v of ['file', 'capture', 'track', 'record', 'write it up', 'should I file', "I'll file", 'I can file', 'Title:']) ADV.push(v + ' '.repeat(150000) + 'x');
ADV.push('word '.repeat(40000)); ADV.push(('Title: x\n').repeat(20000)); ADV.push('\n'.repeat(200000)); ADV.push('-> '.repeat(60000));
let worst = 0;
for (const a of ADV) { const t0 = Date.now(); M.detectTicketProposals(a); worst = Math.max(worst, Date.now() - t0); }
check('10 detector worst case on adversarial 150K-200K inputs < 1000 ms', worst < 1000, worst + ' ms');
// big transcript: 2 MB+ tail, Erez message outside the tail
const big = [human('start')];
for (let i = 0; i < 3000; i++) big.push(text('padding '.repeat(120)));
big.push(text(BLOCK_ASK));
tp = transcript(big);
w = run(HOOK, pay(tp, BLOCK_ASK), freshTmp());
check('10 2 MB+ transcript, Erez message outside the tail -> fires (whole tail is the window), end-to-end under 3 s (the GEN-748 P-test bar)', w.ctx === M.SF_NOTE_ALONE && w.ms < 3000, w.ms + ' ms ' + String(w.ctx).slice(0, 60));


// ---- 11. Pass-B fixes: switch row survives a big log; double-key cap; REST mention / HTTP error
clearLog();
fs.writeFileSync(SWITCH, JSON.stringify({ ts: 'z', kind: 'switch', afterBlock: 'off' }) + '\n');
fs.writeFileSync(LOG, (JSON.stringify({ kind: 'fire', pad: 'x'.repeat(400) }) + '\n').repeat(2000));
tp = transcript([human('check'), text(BLOCK_ASK)]);
check('11 switch file read even when the log is 800 KB+', run(HOOK, pay(tp, BLOCK_ASK), freshTmp()).out === '');
fs.unlinkSync(SWITCH); clearLog();
tmp = freshTmp();
tp = transcript([human('check'), text(BLOCK_ASK)]);
w = run(HOOK, pay(tp, BLOCK_ASK, { session_id: 'cap', prompt_id: 'PX' }), tmp);
const tpNoMsg = transcript([text('padding'), text(BLOCK_ASK)]);
w2 = run(HOOK, pay(tpNoMsg, BLOCK_ASK, { session_id: 'cap', prompt_id: 'PX', stop_hook_active: true }), tmp);
check('11 cap holds when Erez message leaves the tail (same prompt_id)', w.ctx === M.SF_NOTE_ALONE && w2.out === '', w2.out);
w2 = run(HOOK, pay(tpNoMsg, BLOCK_ASK, { session_id: 'cap2' }), freshTmp());
check('11 no Erez message in tail but a prompt_id -> fires once', w2.ctx === M.SF_NOTE_ALONE);
w2 = run(HOOK, pay(tpNoMsg, BLOCK_ASK, { session_id: 'cap3', prompt_id: null }), freshTmp());
check('11 no message uuid and no prompt_id -> no note (no usable key)', w2.out === '');
tp = transcript([human('check'), tool('Bash', { command: 'grep -n "api.notion.com/v1/search" notes.md' }, 's1'), result('s1'), text(BLOCK_ASK)]);
check('11 a command that only mentions the search URL is not a search', run(HOOK, pay(tp, BLOCK_ASK), freshTmp()).ctx === M.SF_NOTE_ALONE);
const errRes = { type: 'user', uuid: 'r-err', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 's1', is_error: false, content: '{"object":"error","status":401,"code":"unauthorized"}' }] } };
tp = transcript([human('check'), tool('PowerShell', { command: 'curl.exe -s -X POST "https://api.notion.com/v1/search" -K cfg' }, 's1'), errRes, text(BLOCK_ASK)]);
check('11 a REST search that returned a Notion error object is not a search', run(HOOK, pay(tp, BLOCK_ASK), freshTmp()).ctx === M.SF_NOTE_ALONE);
check('11 Mode B note asks for a plain sentence, no label', M.SF_NOTE_ALONE.indexOf('"I searched the board"') !== -1 && M.SF_NOTE_ALONE.indexOf('Board search:') === -1);

// ---- 12. round-2 Pass-B fixes: switch written by PowerShell 5.1 (UTF-16LE / UTF-8 BOM) is honoured
for (const [nm, bytes] of [
  ['UTF-16LE with BOM', Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(JSON.stringify({ kind: 'switch', afterBlock: 'off' }) + '\r\n', 'utf16le')])],
  ['UTF-8 with BOM', Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(JSON.stringify({ kind: 'switch', afterBlock: 'off' }) + '\r\n', 'utf8')])],
]) {
  fs.writeFileSync(SWITCH, bytes);
  tp = transcript([human('check'), text(BLOCK_ASK)]);
  check('12 switch written as ' + nm + ' -> Mode B off', run(HOOK, pay(tp, BLOCK_ASK), freshTmp()).out === '');
}
fs.unlinkSync(SWITCH);
check('12 Mode A text keeps the block\'s opening restatement first', M.SF_NOTE_WITH_BLOCK.indexOf('after its opening restatement') !== -1);

console.log('\n' + (n - fails.length) + '/' + n + ' passed' + (fails.length ? '; FAILED: ' + fails.join(' | ') : ''));
fs.rmSync(FIX, { recursive: true, force: true });
process.exitCode = fails.length ? 1 : 0;
