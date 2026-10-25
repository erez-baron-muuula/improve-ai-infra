#!/usr/bin/env node
'use strict';

/*
 * size-approval-prompt.js -- Claude Code PreToolUse hook. (GEN-674)
 *
 * Erez's rule: the always-loaded global ~/.claude/CLAUDE.md may not grow past its line limit unless he
 * explicitly OKs it. update-config.ps1 measures every write to that file on the exact bytes it is about
 * to write, and refuses a crossing (exit 6) unless it runs with -ApproveSizeUpTo <N> AND finds a fresh
 * one-time grant. This hook is the only writer of that grant, and it writes one only in a run where it
 * has also forced Claude Code's own permission prompt for the same call. So a command that uses a grant
 * is a command Erez clicked Allow on.
 *
 * Grants are per session: grant-<session_id>.json. update-config.ps1 reads only the one named by its
 * own CLAUDE_SESSION_ID (exported by sessionstart-loggate.js, which reaches PowerShell commands from
 * Claude Code 2.1.296), so another session's commands neither use nor cancel this session's approval.
 *
 * Every run, in this order:
 *   1. Delete this session's existing grant (and any expired grant of any session). A grant therefore
 *      lives only from the run that wrote it to this session's next hooked call, whose run deletes it
 *      before that call starts: a grant left by a denied or blocked prompt never serves a later command.
 *      On a lock or permission error, retry, then overwrite it with an expired grant; only if even that
 *      fails, block the call (exit 2) and name the file so Erez can delete it.
 *   2. If the call's input mentions "approvesizeupto" anywhere (case-folded), print permissionDecision
 *      "ask" with a plain reason naming the line count. A hook "ask" forces the prompt in auto mode, and
 *      it beats auto-approve.js's "allow" (docs: precedence deny > defer > ask > allow).
 *   3. Then, as the last statement, write the grant {lines, expiresMs}, only when the input names
 *      update-config.ps1, a literal number follows the switch name (the smallest, if several), the call
 *      is not a sub-agent's (no agent_id), the session id is a plain id, and permission_mode is default
 *      or auto (the modes where an "ask" is known to prompt). Otherwise there is no grant, and the
 *      script refuses.
 *
 * A hidden, abbreviated, splatted, positional or wrapper-file switch never reaches step 2, so no grant
 * exists for that command and update-config.ps1 refuses: the stop fails closed. A decoy (the name inside
 * a quoted value, a grep) only adds a prompt; its grant is deleted by the session's next hooked call.
 * Accepted residual (a guard against mistakes, not a wall against a determined script; the same stance
 * as auto-approve.js's PC-control pass guard, GEN-903): a command run outside any hooked call within 10
 * minutes of a denied prompt in the same session could use the grant; so could a same-session call
 * running in parallel while the prompt is still open, if its own switch is hidden from its hook; and so
 * could a run that cannot read its input or cannot even start (an old grant then stays until the next
 * working run or expiry). Each needs the switch hidden from this hook, which no normal command does.
 *
 * Deliberately no onFailure "block" in settings.json: a bug here must not lock Claude out of every
 * shell command.
 *
 * The grant folder is guarded in auto-approve.js against Claude's own tools; its name is built from two
 * parts here so this file never holds it whole.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const GRANT_DIR = path.join(os.homedir(), '.claude-staging', 'rulesize' + '-ok');
const GRANT_TTL_MS = 10 * 60 * 1000;
const GRANT_MODES = new Set(['default', 'auto']);
const SWITCH_NAME = 'approvesizeupto';
const SESSION_ID_RE = /^[A-Za-z0-9-]{1,80}$/; // update-config.ps1 accepts the same shape

function pause(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (e) { /* no wait */ }
}

// True when no usable grant is left at `file`.
function clearGrant(file) {
  for (let i = 0; i < 4; i++) {
    try {
      fs.unlinkSync(file);
      return true;
    } catch (e) {
      if (e && e.code === 'ENOENT') return true;
      if (i < 3) pause(100);
    }
  }
  try {
    fs.writeFileSync(file, JSON.stringify({ lines: 0, expiresMs: 0 }));
    return true;
  } catch (e) {
    return false;
  }
}

// Housekeeping: delete expired grants of any session (best effort; the script checks expiry anyway).
function pruneExpired() {
  let names = [];
  try { names = fs.readdirSync(GRANT_DIR); } catch (e) { return; }
  const now = Date.now();
  for (const n of names) {
    if (!/^grant-.*\.json$/.test(n)) continue;
    const f = path.join(GRANT_DIR, n);
    try {
      const g = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (!(g && Number(g.expiresMs) > now)) fs.unlinkSync(f);
    } catch (e) { /* unreadable or vanished: leave it */ }
  }
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { raw += d; });
process.stdin.on('end', () => {
  let input;
  let folded;
  try {
    input = JSON.parse(raw);
    // Upper- then lower-case, the way auto-approve.js folds look-alike letters.
    folded = JSON.stringify((input && input.tool_input) || {}).toUpperCase().toLowerCase();
  } catch (e) {
    process.exit(0); // cannot read the call: no prompt from here, and no grant written
  }
  const sid = String((input && input.session_id) || '');
  const grantFile = SESSION_ID_RE.test(sid) ? path.join(GRANT_DIR, 'grant-' + sid + '.json') : null;
  if (grantFile && !clearGrant(grantFile)) {
    try {
      process.stderr.write(
        'Refused (rules-file size approval, GEN-674): could not clear the previous one-time size approval (' +
        grantFile + '). Retry the command; if this repeats, Erez should delete that file by hand.\n'
      );
    } catch (e) { /* stderr unavailable */ }
    process.exit(2);
  }
  pruneExpired();
  if (folded.indexOf(SWITCH_NAME) === -1) process.exit(0);

  let lines = null;
  try {
    // A literal number right after the name: "-ApproveSizeUpTo 203", "-ApproveSizeUpTo:203", or with JSON
    // escaping around a quoted value. A variable ($n) or anything else gives no number.
    const re = /approvesizeupto[^0-9a-z$]{0,4}([0-9]{1,6})(?![0-9])/g;
    let m;
    while ((m = re.exec(folded)) !== null) {
      const v = parseInt(m[1], 10);
      if (lines === null || v < lines) lines = v;
    }
  } catch (e) {
    lines = null;
  }

  const reason = lines !== null
    ? 'Claude asks to let your always-loaded rules file (~/.claude/CLAUDE.md) grow to ' + lines + ' lines. ' +
      'Anthropic recommends at most 200, and every line is read at the start of every session. Click Allow ' +
      'once (not "always") only if you agreed to this in the chat.'
    : "Claude's command mentions the rules-file size approval but gives no line count, so update-config.ps1 " +
      'will refuse to grow the file. Allowing it approves nothing beyond the command itself.';
  try {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: reason,
      },
    }));
  } catch (e) {
    process.exit(0); // no prompt could be requested: write no grant
  }

  try {
    const eligible = grantFile !== null && lines !== null && lines > 0 &&
      folded.indexOf('update-config.ps1') !== -1 &&
      !(input && input.agent_id) &&
      GRANT_MODES.has(String((input && input.permission_mode) || ''));
    if (eligible) {
      fs.mkdirSync(GRANT_DIR, { recursive: true });
      fs.writeFileSync(grantFile, JSON.stringify({ lines, expiresMs: Date.now() + GRANT_TTL_MS }));
    }
  } catch (e) {
    /* no grant: the script refuses the crossing */
  }
  process.exit(0);
});
