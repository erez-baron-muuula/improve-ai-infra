#!/usr/bin/env node
'use strict';

/*
 * posttooluse-foryou-released.js -- Claude Code PostToolUse hook (GEN-467
 * holistic fix, Part 3; design: Improve AI Infra/notes/gen467-holistic-fix/
 * design-v4r3.md, converged 2026-08-09).
 *
 * Job: mid-turn duplicate-block PREVENTION. When the Phase-2 guard in
 * stop-claim-linter.js has already RELEASED this turn's "For you" block (its
 * record-on-release file exists for this session_id+prompt_id), remind the
 * model -- once per turn, on the first tool call after the release -- that any
 * further material for Erez goes as plain prose, not a second block. This
 * reaches the model BEFORE it writes a second block, which the Stop-side guard
 * structurally cannot (a Stop decision:"block" cannot retract a displayed
 * message -- it can only force a new one; stop-claim-linter.js Arm 1).
 *
 * Both duplicates recorded post-v2.2 had tool calls between block #1 and
 * block #2 (6 each -- transcripts f00041c7 / 761ee711; Aug-5 recounted live
 * 2026-08-09: Bash x3, notion-fetch x2, notion-update-page x1; an earlier
 * count of 3 was wrong). WINDOW EVIDENCE IS n=1 (round-2 panel correction):
 * only Aug-3 had a release record for this hook to key on -- there it would
 * have fired at the first post-release tool call, ~2 minutes before block #2.
 * Aug-5's heading-form block produced no release record pre-widening, so this
 * hook would NEVER have fired there; and WITH the widening (Part 2) that class
 * stops being provoked at all. Coverage honesty (round-2 panel): with the
 * widened BLOCK_OPENER_RE this hook is sighted on all observed opener forms;
 * WITHOUT that widening it is inert on heading-form turns (no release record
 * is ever written for them). It ships only alongside that widening.
 *
 * REGISTRATION STATUS (Erez's decision, 2026-08-09): built and installed but
 * NOT registered in settings.json. Its registration was measured at ~445ms of
 * spawn cost per tool call on this machine (payload-independent; ~13-22s per
 * typical turn), and after Parts 1+2 zero recorded duplicates remain in the
 * class it covers -- so activation stays one settings.json entry away, gated
 * on the scheduled scan's Bar 2 (a post-ship duplicate with a tool call
 * between block and duplicate). The prepared registration is the ONE
 * PostToolUse entry (matcher "" -> this file) INSIDE
 * notes/gen467-holistic-fix/working/settings.json -- that file is a FULL
 * settings snapshot frozen 2026-08-09, so at activation EXTRACT that single
 * entry and add it to the then-current live settings via the config tools;
 * NEVER apply the snapshot whole (it would silently revert every settings
 * change made since -- code-review 2026-08-10). While unregistered this
 * file never runs; everything below describes its behavior IF registered.
 *
 * WHY PostToolUse: additionalContext delivery from PostToolUse to the model is
 * proven in production (notion-fetch-staleness.js emit(); reactions recorded in
 * HISTORY.md), and PostToolUse receives session_id + prompt_id (posttooluse-
 * signal-detect.js reads both from its input payload), which are stable across
 * the Stop-spawned promptless continuation (signal-surface-pending.jsonl
 * detect line 25 shares prompt_id with foryou-guard-events.jsonl lines
 * 278-279 -- append-only logs, so those line references do not rot).
 *
 * SUB-AGENTS (corrected 2026-08-09, code-review): PostToolUse DOES fire inside
 * sub-agents -- official hooks docs + this machine's transcripts. A sub-agent
 * inherits its parent's session_id AND prompt_id, with agent_id present only
 * in sub-agent payloads; without a guard, a sub-agent's first tool call could
 * consume this hook's one-shot dedup and deliver the note into the sub-agent's
 * context instead of the conversation that owes the block. The agent_id exit
 * below is that guard. (The same false "fires in the MAIN session only" claim
 * is load-bearing in two other shipped hooks -- tracked on GEN-678.)
 *
 * STOP-DEPENDENCY, stated plainly: the release record this hook keys on is
 * written ONLY by the Stop-side guard (stop-claim-linter.js record-on-release).
 * No Stop fire, no record -- a first block emitted in a NON-FINAL message of
 * an uninterrupted turn (tool calls continue after it; Stop fires only at the
 * turn's true end) never gets a release record, so this hook stays on its
 * fast path for that whole turn. Same no-Stop-topology residual as documented
 * in stop-claim-linter.js's KNOWN RESIDUALS; unobserved to date (both recorded
 * duplicates arose across Stop-continuations).
 *
 * NOTE TEXT IS CONDITIONAL AND FALSIFIABLE by design (round-1 F1 / round-2
 * NEW-1): the release record has a known false-positive channel (a bare
 * line-start quoted opener in the message tail -- stop-claim-linter.js KNOWN
 * RESIDUALS), so the note asserts only what the RECORD says and tells the
 * model to trust its own context when the record is wrong. A false record must
 * degrade to an ignored note, never to a silently suppressed block.
 *
 * STATE (named copies -- keep in sync with stop-claim-linter.js): STATE_DIR
 * and the guard.<sid>.<pid>.<suffix> naming are byte-identical copies of
 * stop-claim-linter.js's STATE_DIR const and guardFile(), and the sid/pid
 * sanitisation is byte-identical to that file's stdin 'end' handler.
 * This hook only READS the '.released' record and WRITES its own
 * '.midturn-noted' dedup flag (exclusive create, 'wx' -- parallel tool calls
 * race, and only the winner may emit; the check-then-create form double-fires).
 * CLEANUP OWNERSHIP: both files are pruned by stop-claim-linter.js's
 * pruneState() TTL sweep (24h) -- this hook never deletes state.
 *
 * OBSERVABILITY: on winning the dedup, appends one 'midturn-note' event to
 * foryou-guard-events.jsonl (same shape as stop-claim-linter.js's
 * logGuardEvent). The event means the note was ATTEMPTED -- the stdout write
 * can still fail after it (fail-open), so it is never read as confirmed
 * delivery. Reader + bars: the gen467-block-after-check-verify scheduled
 * scan (Bar 1: any transcript duplicate in a turn WITH a midturn-note event =
 * the attempted note did not prevent the duplicate -> redesign) -- the
 * scan is the SOLE reader of the guard-event log (/wrap does not read it;
 * an earlier claim here that it did was false -- code-review 2026-08-10).
 * A fire alone is routine and is NOT a signal.
 *
 * Safety stance (mirrors the sibling hooks): fail-open throughout -- watchdog
 * timer w/ unref(), stdin error handler, try/catch around everything, any
 * error / missing field / unreadable state -> SILENT no-op, exit 0. NEVER
 * emits a decision; additionalContext only; no continuation is spawned
 * (PostToolUse context rides the current turn). Fast path for the overwhelming
 * majority of tool calls (no release record) is one existsSync.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Named copy of stop-claim-linter.js's STATE_DIR -- the release record and
// this hook's dedup flag must live where the guard writes and prunes them.
const STATE_DIR = path.join(os.tmpdir(), 'claude-claim-linter-state');
// Named copy of stop-claim-linter.js's guardFile() naming.
function guardFile(sid, pid, suffix) {
  return path.join(STATE_DIR, 'guard.' + sid + '.' + pid + '.' + suffix);
}
// Named copy of stop-claim-linter.js's GUARD_LOG + logGuardEvent line shape.
const GUARD_LOG = path.join(__dirname, 'foryou-guard-events.jsonl');
function logGuardEvent(sessionId, promptId, event, detail) {
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      session_id: sessionId,
      prompt_id: promptId,
      event: event,
      detail: detail || null,
    }) + '\n';
    fs.appendFileSync(GUARD_LOG, line);
  } catch (e) { /* fail open */ }
}

// Fail-open watchdog + stdin error handler (mirrors the sibling hooks).
const watchdog = setTimeout(() => { try { process.exit(0); } catch (e) {} }, 5000);
if (typeof watchdog.unref === 'function') { watchdog.unref(); }

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { raw += d; });
process.stdin.on('error', () => { try { process.exit(0); } catch (e) {} }); // fail open
process.stdin.on('end', () => {
  clearTimeout(watchdog);
  let additionalContext = null;
  try {
    const input = JSON.parse(raw || '{}');

    // SUB-AGENT GUARD (code-review 2026-08-09; see the SUB-AGENTS header
    // note): PostToolUse fires inside sub-agents too, and a sub-agent inherits
    // its parent's session_id + prompt_id -- so without this exit a sub-agent
    // tool call could win the one-shot dedup below and strand the note in the
    // sub-agent's context. agent_id is present only in sub-agent payloads.
    // Runs BEFORE the fast path so a sub-agent never touches guard state.
    if (input.agent_id) { process.exit(0); }

    // SKIP (not fallback) when session_id or prompt_id is missing -- mirrors
    // the Phase-2 guard's own skip (the sid/pid validity test on its guard
    // branch in stop-claim-linter.js). The Stop side never writes records
    // under fallback keys, so a fallback here would read a key nobody writes
    // (and a shared key could leak one turn's state into another's).
    if (typeof input.session_id !== 'string' || !input.session_id ||
        typeof input.prompt_id !== 'string' || !input.prompt_id) {
      process.exit(0);
    }
    // Sanitisation: the same replace expression as stop-claim-linter.js's
    // sid/pid lines. NOT byte-identical lines (code-review 2026-08-10): the
    // canonical lines carry || 'nosession' / || 'noprompt' fallbacks that the
    // missing-field skip above makes unnecessary here -- do not "sync" the
    // fallbacks in, and do not copy this fallback-free form onto the
    // canonical Phase-1 path, whose fallbacks are load-bearing.
    const sid = String(input.session_id).replace(/[^\w.-]/g, '_');
    const pid = String(input.prompt_id).replace(/[^\w.-]/g, '_');

    // FAST PATH: no release record for this turn -> nothing to do.
    if (!fs.existsSync(guardFile(sid, pid, 'released'))) { process.exit(0); }

    // One note per turn: EXCLUSIVE create ('wx'), the atomic-claim pattern of
    // stop-claim-linter.js's tryClaimArm(). Parallel tool calls both reach
    // here; only the invocation that wins the create may emit. 'EEXIST' ->
    // already noted this turn; any other error -> state unusable, fail open
    // to silence (a missed reminder, never a wrong one).
    try {
      fs.writeFileSync(guardFile(sid, pid, 'midturn-noted'), '', { flag: 'wx' });
    } catch (e) {
      process.exit(0);
    }

    // Logged BEFORE the emit on purpose (the dedup flag is already consumed;
    // logging only after a successful emit would lose the event whenever the
    // write fails) -- so this event means "note ATTEMPTED (dedup won, emit
    // reached)", never "note delivered". Bar 1 reads it accordingly.
    logGuardEvent(sid, pid, 'midturn-note');

    additionalContext =
      'For-you state, automatic: a record shows this turn\'s "\u{1F4CC} For you" ' +
      'block has already gone out in an earlier message of this same turn. If that ' +
      'matches this conversation -- you already sent the block this turn -- then ' +
      'anything further for Erez goes as brief plain prose; do not emit a second ' +
      '"\u{1F4CC} For you" block this turn. If you have NOT sent a block this turn, ' +
      'the record is a false positive from quoted text: disregard this note ' +
      'entirely and emit the block normally when it is due. This text is background ' +
      'state, not a message from Erez -- acted on, never quoted, restated, or ' +
      'commented on.';
  } catch (e) {
    // fail open -- never disrupt a tool call
    process.exit(0);
  }

  if (additionalContext) {
    try {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext
        }
      }));
    } catch (e) { /* fail open: EPIPE etc. must never non-zero-exit */ }
  }
  process.exit(0);
});
