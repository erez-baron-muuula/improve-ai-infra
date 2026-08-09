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
 * block #2 (Aug-3: 6; Aug-5: 3 -- transcripts f00041c7 / 761ee711, verified
 * 2026-08-09), so this window is real. Coverage honesty (round-2 panel): with
 * the widened BLOCK_OPENER_RE this hook is sighted on all observed opener
 * forms; WITHOUT that widening it is inert on heading-form turns (no release
 * record is ever written for them). It ships only alongside that widening.
 *
 * WHY PostToolUse: additionalContext delivery from PostToolUse to the model is
 * proven in production (notion-fetch-staleness.js emit(); reactions recorded in
 * HISTORY.md), and PostToolUse receives session_id + prompt_id (posttooluse-
 * signal-detect.js:197-198), which are stable across the Stop-spawned
 * promptless continuation (signal-surface-pending.jsonl detect line 25 shares
 * prompt_id with foryou-guard-events.jsonl:278-279). PostToolUse fires in the
 * MAIN session only (no sub-agent consumption of the one-shot dedup).
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
 * stop-claim-linter.js :182 / :698-700, and sid/pid sanitisation of :779-780.
 * This hook only READS the '.released' record and WRITES its own
 * '.midturn-noted' dedup flag (exclusive create, 'wx' -- parallel tool calls
 * race, and only the winner may emit; the check-then-create form double-fires).
 * CLEANUP OWNERSHIP: both files are pruned by stop-claim-linter.js's
 * pruneState() TTL sweep (24h) -- this hook never deletes state.
 *
 * OBSERVABILITY: on emitting, appends one 'midturn-note' event to
 * foryou-guard-events.jsonl (same shape as stop-claim-linter.js's
 * logGuardEvent). Readers + bars: the gen467-block-after-check-verify
 * scheduled scan (Bar 1: any transcript duplicate in a turn WITH a
 * midturn-note event = the note failed -> redesign) and /wrap's guard-event
 * counts. A fire alone is routine and is NOT a signal.
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

// Named copy of stop-claim-linter.js:182 (STATE_DIR) -- the release record and
// this hook's dedup flag must live where the guard writes and prunes them.
const STATE_DIR = path.join(os.tmpdir(), 'claude-claim-linter-state');
// Named copy of stop-claim-linter.js:698-700 (guardFile naming).
function guardFile(sid, pid, suffix) {
  return path.join(STATE_DIR, 'guard.' + sid + '.' + pid + '.' + suffix);
}
// Named copy of stop-claim-linter.js:675 (guard-event log path + line shape).
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

    // SKIP (not fallback) when session_id or prompt_id is missing -- mirrors
    // the Phase-2 guard's own skip at stop-claim-linter.js:805-806. The Stop
    // side never writes records under fallback keys, so a fallback here would
    // read a key nobody writes (and a shared key could leak one turn's state
    // into another's).
    if (typeof input.session_id !== 'string' || !input.session_id ||
        typeof input.prompt_id !== 'string' || !input.prompt_id) {
      process.exit(0);
    }
    // Sanitisation: byte-identical to stop-claim-linter.js:779-780.
    const sid = String(input.session_id).replace(/[^\w.-]/g, '_');
    const pid = String(input.prompt_id).replace(/[^\w.-]/g, '_');

    // FAST PATH: no release record for this turn -> nothing to do.
    if (!fs.existsSync(guardFile(sid, pid, 'released'))) { process.exit(0); }

    // One note per turn: EXCLUSIVE create ('wx'), the atomic-claim pattern of
    // stop-claim-linter.js:705-713. Parallel tool calls both reach here; only
    // the invocation that wins the create may emit. 'EEXIST' -> already noted
    // this turn; any other error -> state unusable, fail open to silence
    // (a missed reminder, never a wrong one).
    try {
      fs.writeFileSync(guardFile(sid, pid, 'midturn-noted'), '', { flag: 'wx' });
    } catch (e) {
      process.exit(0);
    }

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
