#!/usr/bin/env node
'use strict';

/*
 * reviewer-verdict-guard.js -- Claude Code PreToolUse hook, matcher SubagentHandback. (GEN-812)
 *
 * /vet-ticket reviewers (check-reviewer sub-agents) often hand back a complete review WITHOUT the
 * machine-readable last line `TICKET-REVIEW-VERDICT: PASS|REVISE <contentHash>`, so the ticket gate in
 * auto-approve.js blocks with `no-token` and the caller has to ask the reviewer to restate it
 * (observed 4/8 and 3/7 reviews on 2026-10-11; the briefs already ended with the exact block). This
 * hook catches the omission BEFORE delivery: when a ticket reviewer's hand-back lacks a well-formed
 * verdict line, it denies the hand-back with a reason telling the reviewer to re-send the same report
 * ending with that line, so the caller receives the fixed report.
 *
 * Scope: only `check-reviewer` sub-agents whose prompts mention `TICKET-REVIEW-VERDICT:` and carry a
 * 64-hex contentHash somewhere. Callers write briefs freehand, so the hash may sit on the verdict line
 * (`PASS <hash>`, `<PASS|REVISE> <hash>`) or on a line of its own (`contentHash: <hash>`); any standalone
 * 64-hex string in the prompts counts. /check panel reviewers and every other agent pass untouched.
 * It checks FORM, not verdict: REVISE is as acceptable as PASS, and any hash present in the prompts is
 * accepted. The gate (auto-approve.js) stays the only authority on PASS-for-this-hash.
 *
 * Safety stance: this hook only ever DENIES one tool call or defers (no output). It never returns
 * "allow", so it never silences another hook's prompt. Any failure -> defer. It denies at most
 * MAX_BOUNCES times per reviewer turn, counted from its own append-only log, and denies only after the
 * bounce row was written and the log was read cleanly -- otherwise the count can't be trusted, so it
 * defers rather than risk an endless loop. Kill switch: create reviewer-verdict-guard.off next to this
 * file (no /vet-code pass needed) and the guard does nothing.
 *
 * Not covered: a reviewer that delivers plain text (a run with no hand-back tool); the workaround in
 * hooks/refs/notion.md covers that case.
 *
 * Log: reviewer-verdict-guard.jsonl next to this file, one row per decision on a ticket review:
 *   {ts, session_id, agent_id, turn, event[, test]}   event = ok | bounce | cap | error | nohash
 * `turn` counts genuine prompts (brief + SendMessage follow-ups) the way the gate does. No report or
 * brief text is logged. Rows from briefs carrying TEST_MARKER get `test: true` and are left out of the
 * readout.
 *
 * Readout (read-only, used by /wrap): node reviewer-verdict-guard.js --readout <session_id>
 */

const fs = require('fs');
const path = require('path');

const HOOK_DIR = __dirname;
const LOG_FILE = path.join(HOOK_DIR, 'reviewer-verdict-guard.jsonl');
const OFF_FILE = path.join(HOOK_DIR, 'reviewer-verdict-guard.off');
// Created by hand once GEN-812 is closed; retires the acceptance line in the readout.
const ACCEPTED_FILE = path.join(HOOK_DIR, 'reviewer-verdict-guard.accepted');
const TEST_MARKER = 'GEN812-LIVE-TEST';
const TOOL = 'SubagentHandback';
const AGENT_TYPE = 'check-reviewer';
const PREFIX = 'TICKET-REVIEW-VERDICT:';
const MAX_BOUNCES = 2;                         // per (session, reviewer, turn)
const MAX_BOUNCES_TOTAL = 4;                   // per (session, reviewer), whatever `turn` says -- a backstop
const TRANSCRIPT_CAP_BYTES = 4 * 1024 * 1024;  // the gate's own cap (auto-approve.js TICKET_TRANSCRIPT_CAP_BYTES)
const INSTALL_DATE = '2026-10-12';             // readout: the "not working" clock starts here
const STALE_DAYS = 14;
const ABANDONED_MS = 30 * 60 * 1000;           // a bounce with nothing after it for this long = abandoned
const WINDOW = 10;                             // GEN-812 acceptance: the first 10 counted reviews
const WINDOW_BAR = 9;
const HASH_RE = /\b([0-9a-f]{64})\b/gi;
const AGENT_ID_RE = /^[A-Za-z0-9_-]{4,64}$/;

// ---- reads mirrored from auto-approve.js (keep in step; test-guard.js compares them) ----------------

// ticketSessionDir: strip .jsonl, and climb out of `subagents` when the transcript is a sub-agent's,
// so the result is the session dir whichever transcript the harness passed.
function sessionDirOf(transcriptPath) {
  if (typeof transcriptPath !== 'string' || transcriptPath === '') return '';
  const stripped = transcriptPath.replace(/\.jsonl$/i, '');
  if (path.basename(path.dirname(stripped)).toLowerCase() === 'subagents') {
    return path.dirname(path.dirname(stripped));
  }
  return stripped;
}

// ticketIsPrompt: a genuine prompt (the brief, or a SendMessage follow-up) -- a user record with no
// tool_result that is not a harness notice (isMeta without `origin`).
function isPrompt(rec) {
  if (!rec || rec.type !== 'user' || !rec.message) return false;
  const c = rec.message.content;
  if (Array.isArray(c) && c.some(b => b && b.type === 'tool_result')) return false;
  if (rec.isMeta === true && !(rec.origin && typeof rec.origin === 'object')) return false;
  return true;
}

function promptText(rec) {
  const c = rec.message.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n');
}

// ticketLastToken without the verdict/hash comparison: the parsed LAST token, or null.
function lastToken(msg) {
  if (typeof msg !== 'string') return null;
  let last = null;
  let from = 0;
  for (;;) {
    const at = msg.indexOf(PREFIX, from);
    if (at === -1) break;
    last = msg.slice(at + PREFIX.length, at + PREFIX.length + 128);
    from = at + PREFIX.length;
  }
  if (last === null) return null;
  const m = last.match(/^\s*(PASS|REVISE)\s+([0-9a-f]{64})/i);
  return m ? { verdict: m[1].toUpperCase(), hash: m[2].toLowerCase() } : null;
}

// ---- log ----------------------------------------------------------------------------------------------

// A missing log is an empty log; any other read failure throws (the bounce count would be untrustworthy).
function readLog() {
  let text;
  try { text = fs.readFileSync(LOG_FILE, 'utf8'); } catch (e) {
    if (e && e.code === 'ENOENT') return [];
    throw e;
  }
  const rows = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try { const r = JSON.parse(line); if (r && typeof r === 'object') rows.push(r); } catch (e) { /* skip */ }
  }
  return rows;
}

// True only if the row was written.
function appendRow(row) {
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(Object.assign({ ts: new Date().toISOString() }, row)) + '\n');
    return true;
  } catch (e) { return false; }
}

// ---- hook ---------------------------------------------------------------------------------------------

function defer() { process.exit(0); }

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  }));
  process.exit(0);
}

function bounceReason(hashes) {
  const tail = hashes.length === 1 ? hashes[0] : '<the 64-character contentHash from your brief>';
  return 'Your hand-back was NOT delivered: the report is missing its final verdict line. ' +
    'Call SubagentHandback again with your full report unchanged, ending with the ---VERDICT--- block ' +
    'from your brief, whose last line is exactly: ' + PREFIX + ' <PASS or REVISE> ' + tail;
}

// The reviewer's type: the input's agent_type, or -- when the harness omits it -- the sidecar's
// agentType, which is what the gate itself trusts (auto-approve.js ticketReviewerVerified).
function agentTypeOf(input, dir, aid) {
  if (typeof input.agent_type === 'string' && input.agent_type !== '') return input.agent_type;
  if (!dir || typeof aid !== 'string' || !AGENT_ID_RE.test(aid)) return '';
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'subagents', 'agent-' + aid + '.meta.json'), 'utf8')
      .replace(/^\uFEFF/, ''));
    return meta && typeof meta.agentType === 'string' ? meta.agentType : '';
  } catch (e) { return ''; }
}

function decide(input) {
  if (!input || input.tool_name !== TOOL) return defer();
  if (fs.existsSync(OFF_FILE)) return defer();
  const sid = typeof input.session_id === 'string' ? input.session_id : '';
  const aid = input.agent_id;
  const dir = sessionDirOf(input.transcript_path);
  if (agentTypeOf(input, dir, aid) !== AGENT_TYPE) return defer();
  const base = { session_id: sid, agent_id: typeof aid === 'string' ? aid : null };
  const fail = turn => { appendRow(Object.assign(base, { turn: turn === undefined ? null : turn, event: 'error' })); return defer(); };

  if (typeof aid !== 'string' || !AGENT_ID_RE.test(aid)) return fail();
  if (!dir) return fail();
  const file = path.join(dir, 'subagents', 'agent-' + aid + '.jsonl');
  let text;
  try {
    if (fs.statSync(file).size > TRANSCRIPT_CAP_BYTES) return fail();
    text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  } catch (e) { return fail(); }

  let turn = 0;
  let mentions = false;
  let test = false;
  const hashes = new Set();
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let rec;
    try { rec = JSON.parse(line); } catch (e) { continue; }
    if (!isPrompt(rec)) continue;
    turn++;
    const t = promptText(rec);
    if (t.indexOf(PREFIX) !== -1) mentions = true;
    if (t.indexOf(TEST_MARKER) !== -1) test = true;
    HASH_RE.lastIndex = 0;
    let m;
    while ((m = HASH_RE.exec(t)) !== null) hashes.add(m[1].toLowerCase());
  }
  if (!mentions) return defer();           // not a ticket review (e.g. a /check panel reviewer)
  if (test) base.test = true;
  // The prefix with no hash anywhere: a /check review that discusses the gate, or a ticket brief in a
  // shape this can't read. Can't tell which, so log it on its own -- never hide it, never count it.
  if (hashes.size === 0) { appendRow(Object.assign(base, { turn, event: 'nohash' })); return defer(); }

  const msg = input.tool_input && input.tool_input.message;
  if (typeof msg !== 'string') return fail(turn);
  const row = Object.assign(base, { turn });
  const tok = lastToken(msg);
  if (tok && hashes.has(tok.hash)) { appendRow(Object.assign(row, { event: 'ok' })); return defer(); }

  let rows;
  try { rows = readLog(); } catch (e) { return fail(turn); }
  const mine = rows.filter(r => r.event === 'bounce' && r.session_id === sid && r.agent_id === aid);
  const bounces = mine.filter(r => r.turn === turn).length;
  if (bounces >= MAX_BOUNCES || mine.length >= MAX_BOUNCES_TOTAL) {
    appendRow(Object.assign(row, { event: 'cap' }));
    return defer();
  }
  if (!appendRow(Object.assign({}, row, { event: 'bounce' }))) return defer();
  return deny(bounceReason([...hashes]));
}

// ---- readout ------------------------------------------------------------------------------------------

// One review = one (session_id, agent_id). Its outcome comes from its first non-bounce row:
//   ok, no earlier bounce                      -> first-try   (clean)
//   ok, every earlier bounce in the same turn  -> auto-fixed  (clean)
//   ok after a bounce in an earlier turn, cap  -> manual      (a person/caller had to re-ask)
//   error                                      -> unchecked   (not counted)
//   nohash                                     -> nohash      (not counted; reported separately)
// Only bounces, the newest older than ABANDONED_MS -> abandoned (not clean); younger -> in progress.
function outcomes(rows, now) {
  const byReview = new Map();
  for (const r of rows) {
    if (!r || typeof r.agent_id !== 'string' || r.test === true) continue;
    const k = r.session_id + '|' + r.agent_id;
    if (!byReview.has(k)) byReview.set(k, []);
    byReview.get(k).push(r);
  }
  const out = [];
  for (const [k, rs] of byReview) {
    rs.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    const bouncesBefore = [];
    let result = null;
    let ts = null;
    for (const r of rs) {
      if (r.event === 'bounce') { bouncesBefore.push(r); continue; }
      if (r.event === 'nohash') result = 'nohash';
      else if (r.event === 'error') result = 'unchecked';
      else if (r.event === 'cap') result = 'manual';
      else if (r.event === 'ok') {
        if (bouncesBefore.length === 0) result = 'first-try';
        else result = bouncesBefore.every(b => b.turn === r.turn) ? 'auto-fixed' : 'manual';
      } else continue;
      ts = r.ts;
      break;
    }
    if (result === null && bouncesBefore.length > 0) {
      const newest = bouncesBefore[bouncesBefore.length - 1];
      if (now - Date.parse(newest.ts) > ABANDONED_MS) { result = 'abandoned'; ts = newest.ts; }
    }
    if (result !== null) out.push({ key: k, session_id: rs[0].session_id, ts, result });
  }
  out.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  return out;
}

function readout(sessionId, now) {
  const rows = readLog();
  const lines = [];
  const all = outcomes(rows, now);
  const reviews = all.filter(o => o.result !== 'nohash');
  const counted = reviews.filter(o => o.result !== 'unchecked');
  const clean = o => o.result === 'first-try' || o.result === 'auto-fixed';
  const mine = reviews.filter(o => o.session_id === sessionId);
  const n = r => mine.filter(o => o.result === r).length;

  const manual = n('manual'), abandoned = n('abandoned'), unchecked = n('unchecked'), auto = n('auto-fixed');
  if (manual + abandoned + unchecked > 0) {
    lines.push('Verdict guard: of ' + mine.length + ' ticket reviews this session, ' + manual +
      ' still needed a manual re-ask, ' + abandoned + ' were left with no report after a bounce-back, and ' +
      unchecked + " couldn't be checked (" + auto + ' fixed by an automatic bounce-back).');
  }
  const nohash = all.filter(o => o.result === 'nohash' && o.session_id === sessionId).length;
  if (nohash > 0) {
    lines.push('Verdict guard: ' + nohash + ' reviewer brief(s) this session mentioned the verdict line but ' +
      'carried no hash - fine if they were /check reviews of the ticket gate; if they were ticket reviews, ' +
      'the brief wording changed and the guard is not covering them.');
  }

  if (counted.length >= WINDOW && !fs.existsSync(ACCEPTED_FILE)) {
    const j = counted.slice(0, WINDOW).filter(clean).length;
    lines.push('GEN-812 acceptance: ' + j + ' of the first ' + WINDOW + ' ticket reviews since install arrived ' +
      'with a well-formed verdict line and no manual re-ask' + (j >= WINDOW_BAR
        ? ' - ready to close GEN-812 (bar ' + WINDOW_BAR + '). Once it is closed, create ' + ACCEPTED_FILE +
          ' to retire this line.'
        : ' - below the bar of ' + WINDOW_BAR + '; reopen GEN-812 (see the non-ok rows in ' + LOG_FILE + '). ' +
          'Once that is decided, create ' + ACCEPTED_FILE + ' to retire this line.'));
  }

  if (fs.existsSync(OFF_FILE)) {
    lines.push('Verdict guard: switched off (' + OFF_FILE + ' exists) - delete that file to turn it back on.');
    return lines;
  }
  const day = 24 * 3600 * 1000;
  // Only rows that prove the guard actually checked a report count as "alive" -- a stream of error rows
  // (e.g. the harness stopped sending agent_id) must not keep this line quiet.
  const alive = rows.filter(r => r.event === 'ok' || r.event === 'bounce' || r.event === 'cap');
  const newest = alive.reduce((t, r) => Math.max(t, Date.parse(r.ts) || 0), 0);
  const since = newest || Date.parse(INSTALL_DATE + 'T00:00:00Z');
  const days = Math.floor((now - since) / day);
  if (days > STALE_DAYS) {
    lines.push('Verdict guard: no ticket-review hand-back logged for ' + days + ' days - worth checking the ' +
      'hook still fires.');
  }
  return lines;
}

// ---- entry --------------------------------------------------------------------------------------------

if (process.argv[2] === '--readout') {
  try {
    const lines = readout(process.argv[3] || '', Date.now());
    if (lines.length) process.stdout.write(lines.join('\n') + '\n');
  } catch (e) {
    process.stdout.write('Verdict guard: readout failed (' + (e && e.message) + ').\n');
  }
  process.exit(0);
} else {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { raw += d; });
  process.stdin.on('end', () => {
    let input;
    try { input = JSON.parse(raw); } catch (e) { return defer(); }
    try { return decide(input); } catch (e) {
      appendRow({ session_id: input && input.session_id, agent_id: input && input.agent_id, turn: null, event: 'error' });
      return defer();
    }
  });
}
