#!/usr/bin/env node
'use strict';
// GEN-812 tests for reviewer-verdict-guard.js. Runs a COPY of the guard inside a fixture dir under the OS
// temp folder, so the real hook log is never touched.
//   node test-guard.js [path-to-guard]          fixtures + readout + real-input corpus replay
// Exit 0 = all pass. The corpus part also prints counts for the /vet-code Step 5 attestation.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const GUARD_SRC = path.resolve(process.argv[2] || path.join(__dirname, 'reviewer-verdict-guard.js'));
const GATE = path.join(os.homedir(), '.claude', 'hooks', 'auto-approve.js');
const FIX = fs.mkdtempSync(path.join(os.tmpdir(), 'gen812-guard-'));
const HOOKS = path.join(FIX, 'hooks');
fs.mkdirSync(HOOKS);
const GUARD = path.join(HOOKS, 'reviewer-verdict-guard.js');
fs.writeFileSync(GUARD, fs.readFileSync(GUARD_SRC));
const LOG = path.join(HOOKS, 'reviewer-verdict-guard.jsonl');
const OFF = path.join(HOOKS, 'reviewer-verdict-guard.off');
const ACCEPTED = path.join(HOOKS, 'reviewer-verdict-guard.accepted');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; } else { fail++; console.log('FAIL: ' + name + (extra ? ' -- ' + extra : '')); }
}

const H1 = 'a'.repeat(64), H2 = 'b'.repeat(63) + 'c';

// ---- fixture transcript builder ---------------------------------------------------------------------
let sessCounter = 0;
function mkSession() {
  const sid = 'sess' + (++sessCounter) + '-0000-0000';
  const sdir = path.join(FIX, 'projects', 'p', sid);
  fs.mkdirSync(path.join(sdir, 'subagents'), { recursive: true });
  return { sid, sdir, main: sdir + '.jsonl' };
}
const userPrompt = text => ({ type: 'user', message: { role: 'user', content: text } });
const resume = text => ({ type: 'user', isMeta: true, origin: { kind: 'coordinator' }, message: { role: 'user', content: [{ type: 'text', text }] } });
const notice = text => ({ type: 'user', isMeta: true, message: { role: 'user', content: [{ type: 'text', text }] } });
const toolRes = id => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'x', is_error: true }] } });
function writeAgent(s, aid, recs, agentType) {
  fs.writeFileSync(path.join(s.sdir, 'subagents', 'agent-' + aid + '.jsonl'), recs.map(r => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(s.sdir, 'subagents', 'agent-' + aid + '.meta.json'), JSON.stringify({ agentType: agentType || 'check-reviewer' }));
}
function run(input) {
  const r = spawnSync(process.execPath, [GUARD], { input: JSON.stringify(input), encoding: 'utf8' });
  let out = null;
  try { out = r.stdout ? JSON.parse(r.stdout) : null; } catch (e) { out = 'unparsable'; }
  const denied = !!(out && out.hookSpecificOutput && out.hookSpecificOutput.permissionDecision === 'deny');
  return { code: r.status, out, denied, stdout: r.stdout, stderr: r.stderr };
}
function hb(s, aid, message, over) {
  return Object.assign({ tool_name: 'SubagentHandback', agent_type: 'check-reviewer', agent_id: aid,
    session_id: s.sid, transcript_path: s.main, tool_input: { message } }, over || {});
}
const logRows = () => { try { return fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map(JSON.parse); } catch (e) { return []; } };
const resetLog = () => { try { fs.unlinkSync(LOG); } catch (e) {} };
const lastEvent = () => { const r = logRows(); return r.length ? r[r.length - 1].event : null; };

const BRIEF_INLINE = 'Review this ticket.\n---VERDICT---\nSTATUS: PASS | REVISE\nTICKET-REVIEW-VERDICT: PASS ' + H1;
const BRIEF_ANGLE = 'Review.\nEnd with: TICKET-REVIEW-VERDICT: <PASS|REVISE> ' + H1;
const BRIEF_SEPARATE = 'contentHash: ' + H1 + '\nReview.\nTICKET-REVIEW-VERDICT: PASS <contentHash>   (or REVISE <contentHash>)';
const GOOD = 'Report...\n---VERDICT---\nSTATUS: PASS\nFINDINGS: none\nNOTES: none\nTICKET-REVIEW-VERDICT: PASS ' + H1;
const BAD = 'Report... all checks pass. Verdict: PASS.';

// ---- fixtures: decisions ------------------------------------------------------------------------------
resetLog();
{
  const s = mkSession();
  for (const [name, brief] of [['inline', BRIEF_INLINE], ['angle', BRIEF_ANGLE], ['separate-line', BRIEF_SEPARATE]]) {
    const aid = 'a' + name.replace(/-/g, '') + '01';
    writeAgent(s, aid, [userPrompt(brief)]);
    let r = run(hb(s, aid, GOOD));
    check(name + ': good report not denied', !r.denied && r.code === 0);
    check(name + ': good report logged ok', lastEvent() === 'ok');
    const aid2 = 'b' + name.replace(/-/g, '') + '01';
    writeAgent(s, aid2, [userPrompt(brief)]);
    r = run(hb(s, aid2, BAD));
    check(name + ': token-less report denied', r.denied, r.stdout);
    check(name + ': deny reason names the line', r.denied && /TICKET-REVIEW-VERDICT: <PASS or REVISE> a{64}/.test(r.out.hookSpecificOutput.permissionDecisionReason));
    check(name + ': bounce logged', lastEvent() === 'bounce');
  }
}
{ // REVISE accepted; wrong hash bounced; uppercase hex accepted; token not last bounced
  const s = mkSession();
  writeAgent(s, 'arev0001', [userPrompt(BRIEF_INLINE)]);
  check('REVISE line not denied', !run(hb(s, 'arev0001', 'r\nTICKET-REVIEW-VERDICT: REVISE ' + H1)).denied);
  writeAgent(s, 'awrong01', [userPrompt(BRIEF_INLINE)]);
  check('wrong hash denied', run(hb(s, 'awrong01', 'r\nTICKET-REVIEW-VERDICT: PASS ' + H2)).denied);
  writeAgent(s, 'aupper01', [userPrompt(BRIEF_INLINE)]);
  check('uppercase hash accepted', !run(hb(s, 'aupper01', 'r\nTICKET-REVIEW-VERDICT: PASS ' + H1.toUpperCase())).denied);
  writeAgent(s, 'aquote01', [userPrompt(BRIEF_INLINE)]);
  check('good token followed by a bare prefix mention is denied (last occurrence rule)',
    run(hb(s, 'aquote01', 'TICKET-REVIEW-VERDICT: PASS ' + H1 + '\n(as the TICKET-REVIEW-VERDICT: line says)')).denied);
  writeAgent(s, 'atrail01', [userPrompt(BRIEF_INLINE)]);
  check('text after the token is fine', !run(hb(s, 'atrail01', 'TICKET-REVIEW-VERDICT: PASS ' + H1 + '\nThanks.')).denied);
}
{ // non-ticket and non-reviewer paths are silent
  const s = mkSession();
  const before = logRows().length;
  writeAgent(s, 'acheck01', [userPrompt('Review this design under the pre-mortem lens. End with ---VERDICT--- STATUS: PASS')]);
  check('/check reviewer not denied', !run(hb(s, 'acheck01', BAD)).denied);
  writeAgent(s, 'agp00001', [userPrompt(BRIEF_INLINE)], 'general-purpose');
  check('other agent type not denied', !run(hb(s, 'agp00001', BAD, { agent_type: 'general-purpose' })).denied);
  check('other tool ignored', !run(Object.assign(hb(s, 'acheck01', BAD), { tool_name: 'Read' })).denied);
  check('non-ticket paths write no log rows', logRows().length === before);
  writeAgent(s, 'anohash1', [userPrompt('Discuss the gate: it needs TICKET-REVIEW-VERDICT: PASS <hash> at the end.')]);
  check('prefix without hash not denied', !run(hb(s, 'anohash1', BAD)).denied);
  check('prefix without hash logged nohash', lastEvent() === 'nohash');
}
{ // sidecar fallback when agent_type is absent
  const s = mkSession();
  writeAgent(s, 'aside001', [userPrompt(BRIEF_INLINE)]);
  const inp = hb(s, 'aside001', BAD); delete inp.agent_type;
  check('missing agent_type -> sidecar says check-reviewer -> denied', run(inp).denied);
  writeAgent(s, 'aside002', [userPrompt(BRIEF_INLINE)], 'general-purpose');
  const inp2 = hb(s, 'aside002', BAD); delete inp2.agent_type;
  check('missing agent_type -> sidecar says other -> not denied', !run(inp2).denied);
}
{ // transcript_path given as the sub-agent's own transcript works too
  const s = mkSession();
  writeAgent(s, 'aown0001', [userPrompt(BRIEF_INLINE)]);
  check('sub-agent transcript_path also resolves', run(hb(s, 'aown0001', BAD, { transcript_path: path.join(s.sdir, 'subagents', 'agent-aown0001.jsonl') })).denied);
}
{ // cap: 2 bounces per turn, then allowed; new turn (SendMessage) resets; notices/tool results don't
  const s = mkSession();
  writeAgent(s, 'acap0001', [userPrompt(BRIEF_INLINE), notice('[handback-send-enforce] call SubagentHandback'), toolRes('t1')]);
  check('cap: 1st denied', run(hb(s, 'acap0001', BAD)).denied);
  check('cap: 2nd denied', run(hb(s, 'acap0001', BAD)).denied);
  check('cap: 3rd allowed', !run(hb(s, 'acap0001', BAD)).denied);
  check('cap: logged cap', lastEvent() === 'cap');
  writeAgent(s, 'acap0001', [userPrompt(BRIEF_INLINE), toolRes('t1'), resume('Please restate the verdict block.')]);
  check('cap: new turn after SendMessage denied again', run(hb(s, 'acap0001', BAD)).denied);
  const rows = logRows().filter(r => r.agent_id === 'acap0001');
  check('cap: turn numbers 1,1,1,2', rows.map(r => r.turn).join(',') === '1,1,1,2', JSON.stringify(rows.map(r => r.turn)));
  check('cap: 4th bounce overall (turn 2) denied', run(hb(s, 'acap0001', BAD)).denied);
  writeAgent(s, 'acap0001', [userPrompt(BRIEF_INLINE), resume('again'), resume('and again')]);
  check('cap: total ceiling of 4 holds in a new turn', !run(hb(s, 'acap0001', BAD)).denied);
  check('cap: total ceiling logged cap', lastEvent() === 'cap');
}
{ // fail-safe: unreadable transcript, bad agent id, non-string message, garbage stdin
  const s = mkSession();
  check('missing transcript not denied', !run(hb(s, 'amissing', BAD)).denied);
  check('missing transcript logged error', lastEvent() === 'error');
  check('bad agent id not denied', !run(hb(s, '../../x', BAD)).denied);
  writeAgent(s, 'anonstr1', [userPrompt(BRIEF_INLINE)]);
  check('non-string message not denied', !run(hb(s, 'anonstr1', 42)).denied);
  const r = spawnSync(process.execPath, [GUARD], { input: 'not json', encoding: 'utf8' });
  check('garbage stdin: exit 0, no output', r.status === 0 && r.stdout === '');
}
{ // kill switch
  const s = mkSession();
  writeAgent(s, 'aoff0001', [userPrompt(BRIEF_INLINE)]);
  fs.writeFileSync(OFF, '');
  const before = logRows().length;
  check('kill switch: not denied', !run(hb(s, 'aoff0001', BAD)).denied);
  check('kill switch: no log row', logRows().length === before);
  fs.unlinkSync(OFF);
}
{ // log unwritable -> no deny (a directory in the log's place makes append and read fail)
  const s = mkSession();
  writeAgent(s, 'anolog01', [userPrompt(BRIEF_INLINE)]);
  const saved = fs.existsSync(LOG) ? fs.readFileSync(LOG) : null;
  resetLog();
  fs.mkdirSync(LOG);
  check('log unusable: token-less report NOT denied', !run(hb(s, 'anolog01', BAD)).denied);
  fs.rmdirSync(LOG);
  if (saved) fs.writeFileSync(LOG, saved);
}
{ // test marker
  const s = mkSession();
  writeAgent(s, 'atest001', [userPrompt(BRIEF_INLINE + '\nGEN812-LIVE-TEST')]);
  run(hb(s, 'atest001', BAD));
  const r = logRows().filter(x => x.agent_id === 'atest001');
  check('test marker: row flagged test', r.length === 1 && r[0].test === true);
}

// ---- readout ------------------------------------------------------------------------------------------
function readoutWith(rows, sid, files) {
  resetLog();
  fs.writeFileSync(LOG, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  for (const f of (files || [])) fs.writeFileSync(f, '');
  const out = spawnSync(process.execPath, [GUARD, '--readout', sid], { encoding: 'utf8' }).stdout;
  for (const f of (files || [])) fs.unlinkSync(f);
  return out;
}
const now = Date.now();
const t = mins => new Date(now - mins * 60000).toISOString();
{
  const S = 'S1';
  const rows = [
    { ts: t(100), session_id: S, agent_id: 'r1', turn: 1, event: 'ok' },                 // first-try
    { ts: t(99), session_id: S, agent_id: 'r2', turn: 1, event: 'bounce' },
    { ts: t(98), session_id: S, agent_id: 'r2', turn: 1, event: 'ok' },                  // auto-fixed
    { ts: t(97), session_id: S, agent_id: 'r3', turn: 1, event: 'bounce' },
    { ts: t(96), session_id: S, agent_id: 'r3', turn: 2, event: 'ok' },                  // manual
    { ts: t(95), session_id: S, agent_id: 'r4', turn: 1, event: 'bounce' },              // abandoned (>30 min)
    { ts: t(5), session_id: S, agent_id: 'r5', turn: 1, event: 'bounce' },               // in progress
    { ts: t(4), session_id: S, agent_id: 'r6', turn: null, event: 'error' },             // unchecked
    { ts: t(3), session_id: S, agent_id: 'r7', turn: 1, event: 'nohash' },
    { ts: t(2), session_id: S, agent_id: 'r8', turn: 1, event: 'bounce', test: true },   // test: ignored
  ];
  const out = readoutWith(rows, S);
  check('readout: session line counts', /of 5 ticket reviews this session, 1 still needed a manual re-ask, 1 were left with no report after a bounce-back, and 1 couldn't be checked \(1 fixed/.test(out), out);
  check('readout: nohash line', /1 reviewer brief\(s\) this session mentioned the verdict line but carried no hash/.test(out), out);
  check('readout: no acceptance line under 10 reviews', !/GEN-812 acceptance/.test(out), out);
  check('readout: other session silent', readoutWith(rows, 'OTHER') === '', readoutWith(rows, 'OTHER'));
}
{
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push({ ts: t(50 - i), session_id: 'S2', agent_id: 'c' + i, turn: 1, event: 'ok' });
  rows.splice(3, 1, { ts: t(47), session_id: 'S2', agent_id: 'c3', turn: 1, event: 'cap' });
  let out = readoutWith(rows, 'OTHER');
  check('readout: acceptance pass line at 9/10 (any session)', /GEN-812 acceptance: 9 of the first 10 .* ready to close GEN-812/.test(out), out);
  out = readoutWith(rows, 'OTHER', [ACCEPTED]);
  check('readout: accepted file retires the line', !/GEN-812 acceptance/.test(out), out);
  rows.splice(4, 1, { ts: t(46), session_id: 'S2', agent_id: 'c4', turn: 1, event: 'cap' });
  rows.push({ ts: t(30), session_id: 'S2', agent_id: 'c10', turn: 1, event: 'ok' });
  out = readoutWith(rows, 'OTHER');
  check('readout: acceptance fail line at 8/10', /8 of the first 10 .* below the bar of 9; reopen GEN-812/.test(out), out);
  out = readoutWith([
    { ts: t(10), session_id: 'S4', agent_id: 'p0', turn: 1, event: 'bounce' },
    ...Array.from({ length: 12 }, (_, i) => ({ ts: t(9 - i * 0.1), session_id: 'S4', agent_id: 'q' + i, turn: 1, event: 'ok' }))
  ], 'OTHER');
  check('readout: a pending review in the window holds the acceptance line back', !/GEN-812 acceptance/.test(out), out);
  out = readoutWith([{ ts: t(3), session_id: 'S5', agent_id: null, turn: null, event: 'error' }], 'S5');
  check('readout: null-agent error row counts as unchecked', /1 couldn't be checked/.test(out), out);
  out = readoutWith(rows, 'OTHER', [OFF]);
  check('readout: kill switch line', /switched off/.test(out), out);
  out = readoutWith([{ ts: t(20 * 24 * 60), session_id: 'S3', agent_id: 'z', turn: 1, event: 'ok' }], 'S3');
  check('readout: stale line after 14 days', /no ticket-review hand-back logged for 20 days/.test(out), out);
}
resetLog();

// ---- real-input corpus replay -------------------------------------------------------------------------
// Every SubagentHandback made by a real check-reviewer on this machine, replayed as the PreToolUse payload
// the guard would have received (transcript truncated to just before that call).
const root = path.join(os.homedir(), '.claude', 'projects');
const corpus = { transcripts: 0, handbacks: 0, ignored: 0, ticket: 0, ok: 0, bounce: 0, cap: 0, nohash: 0, error: 0,
  firstHandbackBounce: 0, ticketReviews: 0, falseFire: 0, gateOkFinalNotOk: 0, gateChecked: 0 };
const falseFires = [];
const bouncedBriefs = [];
for (const proj of fs.readdirSync(root)) {
  let sessions; try { sessions = fs.readdirSync(path.join(root, proj)); } catch (e) { continue; }
  for (const sess of sessions) {
    const sub = path.join(root, proj, sess, 'subagents');
    let files; try { files = fs.readdirSync(sub); } catch (e) { continue; }
    for (const f of files) {
      if (!/^agent-[A-Za-z0-9_-]+\.jsonl$/.test(f)) continue;
      const aid = f.slice(6, -6);
      let meta; try { meta = JSON.parse(fs.readFileSync(path.join(sub, 'agent-' + aid + '.meta.json'), 'utf8').replace(/^﻿/, '')); } catch (e) { continue; }
      if (!meta || meta.agentType !== 'check-reviewer') continue;
      const lines = fs.readFileSync(path.join(sub, f), 'utf8').split('\n').filter(l => l.trim() !== '');
      const recs = lines.map(l => { try { return JSON.parse(l); } catch (e) { return null; } });
      const calls = [];
      recs.forEach((r, i) => {
        const c = r && r.type === 'assistant' && r.message && r.message.content;
        if (Array.isArray(c)) for (const b of c) if (b && b.type === 'tool_use' && b.name === 'SubagentHandback' && b.input) calls.push({ i, message: b.input.message });
      });
      if (!calls.length) continue;
      corpus.transcripts++;
      // fresh fixture session per transcript; fresh log per transcript
      resetLog();
      const s = mkSession();
      const fixAid = aid;
      let results = [];
      for (const call of calls) {
        corpus.handbacks++;
        fs.writeFileSync(path.join(s.sdir, 'subagents', 'agent-' + fixAid + '.jsonl'), lines.slice(0, call.i).join('\n') + '\n');
        fs.writeFileSync(path.join(s.sdir, 'subagents', 'agent-' + fixAid + '.meta.json'), JSON.stringify({ agentType: 'check-reviewer' }));
        const before = logRows().length;
        const r = run(hb(s, fixAid, call.message));
        const rows = logRows();
        const ev = rows.length > before ? rows[rows.length - 1].event : 'ignored';
        results.push({ ev, denied: r.denied, message: call.message });
        if (ev === 'ignored') corpus.ignored++; else { corpus.ticket++; corpus[ev] = (corpus[ev] || 0) + 1; }
        // False fire = denied although the report already carries a well-formed token whose hash the gate
        // would read (any 64-hex after the LAST prefix, PASS or REVISE).
        if (r.denied && typeof call.message === 'string') {
          const at = call.message.lastIndexOf('TICKET-REVIEW-VERDICT:');
          if (at !== -1 && /^\s*(PASS|REVISE)\s+[0-9a-f]{64}/i.test(call.message.slice(at + 22, at + 150))) {
            // well-formed but hash not in prompts? check that separately
            corpus.falseFire++; falseFires.push(path.join(proj, sess, f));
          }
        }
      }
      if (results.length && results[0].ev !== 'ignored') {
        corpus.ticketReviews++;
        if (results[0].ev === 'bounce') {
          corpus.firstHandbackBounce++;
          const b = recs.find(r => r && r.type === 'user');
          const bt = b ? (typeof b.message.content === 'string' ? b.message.content : JSON.stringify(b.message.content)) : '';
          bouncedBriefs.push(sess.slice(0, 8) + '/' + aid + ': ' + bt.replace(/\s+/g, ' ').slice(0, 110));
        }
      }
      // Agreement with the gate: if --ticket-verify says ok for some hash in this transcript, the guard
      // must have passed that reviewer's final hand-back.
      if (results.length && results[0].ev !== 'ignored') {
        const hashes = new Set();
        for (const r of recs) {
          if (r && r.type === 'user' && r.message) {
            const c = r.message.content;
            const txt = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b && b.type === 'text').map(b => b.text).join('\n') : '';
            for (const m of txt.matchAll(/\b([0-9a-f]{64})\b/gi)) hashes.add(m[1].toLowerCase());
          }
        }
        let gateOk = false;
        for (const h of [...hashes].slice(0, 6)) {
          let out = '';
          try { out = execFileSync(process.execPath, [GATE, '--ticket-verify', path.join(sub, f), '--hash', h], { encoding: 'utf8' }); } catch (e) { out = (e.stdout || '') + ''; }
          if (out.trim() === 'ok') { gateOk = true; break; }
        }
        if (gateOk) {
          corpus.gateChecked++;
          if (results[results.length - 1].ev !== 'ok') { corpus.gateOkFinalNotOk++; falseFires.push('gate-ok-but-guard-' + results[results.length - 1].ev + ': ' + path.join(proj, sess, f)); }
        }
      }
    }
  }
}
resetLog();
console.log('CORPUS ' + JSON.stringify(corpus));
if (falseFires.length) console.log('CORPUS-PROBLEMS\n  ' + falseFires.slice(0, 20).join('\n  '));
if (process.env.GEN812_LIST_BOUNCES) console.log('BOUNCED-BRIEFS\n  ' + bouncedBriefs.join('\n  '));
check('corpus: no false fires', corpus.falseFire === 0, String(corpus.falseFire));
check('corpus: every reviewer the gate accepts has an ok final hand-back', corpus.gateOkFinalNotOk === 0, String(corpus.gateOkFinalNotOk));
check('corpus: guard recognised some real ticket reviews', corpus.ticketReviews > 0);

try { fs.rmSync(FIX, { recursive: true, force: true }); } catch (e) {}
console.log('PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
