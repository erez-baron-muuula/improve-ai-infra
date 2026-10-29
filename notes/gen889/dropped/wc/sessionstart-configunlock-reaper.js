// SessionStart hook — GEN-462: reap a stale/unaccountable break-glass sentinel.
//
// THE PROBLEM (GEN-462): the shared break-glass sentinel ~/.claude/.config-unlock
// disables FOUR locks at once (protected-config, staging, vetting, check-before-present)
// simply by EXISTING (auto-approve.js configUnlocked() honors it via fs.existsSync).
// A sentinel created for a legitimate one-off recovery and then FORGOTTEN silently keeps
// every gate OFF across all future sessions, and nothing surfaces that the gate is down.
//
// THIS HOOK, at every session start, makes that impossible to persist SILENTLY:
//   - LEGITIMATE open: sentinel present AND a matching valid unexpired token exists in
//     ~/.claude-staging/config-unlock-passes/ -> the gate is intentionally open; SAY NOTHING.
//   - FORGOTTEN / UNACCOUNTABLE: sentinel present but NO valid token (expired, or never
//     written — e.g. a bare `touch .config-unlock`) -> best-effort DELETE the sentinel to
//     re-arm the gates; SAY NOTHING (self-heal — success is silent).
//   - PROBLEM: the sentinel should have been reaped but the delete FAILED (still present
//     after the attempt — e.g. a Windows file lock) -> this is the ONLY case that surfaces:
//     a LOUD warning relayed to Erez that a safety switch is on that could not be cleared.
//   - sentinel absent -> nothing.
//
// This encodes Erez's operating principle: success is silent, only a genuine problem
// (an undeletable stuck sentinel) involves him. There is deliberately NO routine
// "the gate is open" note — a legitimately-open gate is success, so it is silent.
//
// WHY A TOKEN IN ~/.claude-staging IS THE TRUST ANCHOR (not the sentinel itself):
// the sentinel lives under ~/.claude, which the auto-approve write-allow-list covers
// (Write/Edit globs are ~/.claude\*), so a session can create it silently. The token
// lives in ~/.claude-staging — a SIBLING of ~/.claude, OUTSIDE that allow-list — exactly
// like the staging (GEN-281) and vetting (GEN-376) passes. Creating anything there forces
// a permission prompt, so a legitimate token cannot be minted without Erez seeing it. That
// is why "sentinel + valid token" means "Erez-sanctioned open" while "sentinel alone" means
// "unaccountable -> reap". RESIDUAL (shared with staging/vetting locks): if a future broad
// allow entry (e.g. Bash(*), Write(C:\Users\Erez\*)) is ever added, silent writes to the
// sibling dir become possible and this property weakens — same caveat those locks carry.
//
// THIS HOOK NEVER OPENS OR HONORS THE GATE. It does not touch configUnlocked() and cannot
// unlock anything — it only READS the sentinel + token and, at most, DELETES the sentinel
// (which makes the gate MORE locked, never less). So its own failure modes are fail-safe
// toward "locked", and it fails open only toward SHOWING a problem, never toward hiding one.
//
// FAIL-OPEN DISCIPLINE (mirrors sessionstart-backup-surfacer.js): any error -> surface
// nothing it wasn't already going to, never disrupt session startup, and leave a one-line
// STDERR breadcrumb (never stdout — stdout is the hookSpecificOutput JSON contract) so a
// hook that chokes on its own is distinguishable from "nothing to report". The ONE thing it
// must never do on error is silently swallow a still-present-but-unreaped sentinel; the
// control flow below decides "surface the alarm" BEFORE attempting the (fallible) delete,
// so a delete that throws still reports the problem.

const fs = require('fs');
const os = require('os');
const path = require('path');

const SENTINEL_NAME = '.config-unlock';
// Expiry grace: a token is "valid" only if unexpired per its own `expires` field (like
// findPassFile in auto-approve.js). We do NOT use file mtime (a restored/copied token can
// carry a stale mtime; a self-declared `expires` written at mint time is the honest clock).

// Drain stdin (needed for 'end' to fire); we key off files, not the SessionStart payload.
let input = '';
process.stdin.on('data', c => (input += c));
process.stdin.on('end', () => {
  let additionalContext = null;
  // Tracks whether we have already established "sentinel present AND not accounted for"
  // BEFORE any fallible operation runs. If an unexpected throw then lands in the outer
  // catch, we use this to fail toward SHOWING the alarm rather than swallowing it —
  // because at that point we KNOW an unaccountable sentinel exists and merely failed to
  // finish handling it. Fails toward showing a problem, never hiding one. (Code-review:
  // makes the outer catch safe-by-construction, not merely safe because every inner op
  // happens to be self-guarded today.)
  let knownUnaccountableSentinel = null;
  try {
    const claudeDir = path.join(os.homedir(), '.claude');
    const sentinel = path.join(claudeDir, SENTINEL_NAME);
    // ~/.claude-staging is a SIBLING of ~/.claude (parent dir + '.claude-staging').
    const stagingDir = path.join(claudeDir, '..', '.claude-staging');
    const tokenDir = path.join(stagingDir, 'config-unlock-passes');

    // Nothing to do unless the sentinel exists. (existsSync never throws; guard anyway.)
    let sentinelPresent = false;
    try { sentinelPresent = fs.existsSync(sentinel); } catch (e) { sentinelPresent = false; }

    if (sentinelPresent) {
      const legit = hasValidToken(tokenDir);
      if (!legit) {
        // From here on an unaccountable sentinel is KNOWN to exist. Record it so the
        // outer catch can still alarm if anything below throws unexpectedly.
        knownUnaccountableSentinel = sentinel;
        // Unaccountable sentinel -> reap it (best-effort). Decide the alarm from the
        // POST-delete state: attempt the delete, then re-check existence. If it's gone,
        // the gate re-armed silently (success). If it's still there, that's the problem
        // case -> surface. Computing the alarm from the actual post-state (not from
        // whether unlink threw) means a delete that "fails" but the file is somehow gone
        // still counts as reaped, and a delete that "succeeds" but the file lingers
        // (odd FS) still alarms — the on-disk truth wins.
        try { fs.unlinkSync(sentinel); } catch (e) { /* fall through to re-check */ }
        let stillThere = true;
        try { stillThere = fs.existsSync(sentinel); } catch (e) { stillThere = true; }
        if (stillThere) {
          additionalContext = buildAlarm(sentinel);
        }
      }
      // legit === true -> gate intentionally open -> SILENT (success). Nothing to emit.
    }
  } catch (e) {
    // Fail toward SHOWING, never hiding. If we had already established that an
    // unaccountable sentinel exists, alarm about it even though handling threw — a
    // still-present unaccountable sentinel must never go unreported. If the throw came
    // BEFORE that point (we don't yet know a problem exists), stay silent (nothing to
    // report). Either way, leave a one-line breadcrumb so a self-broken hook is
    // distinguishable from "nothing to report".
    additionalContext = knownUnaccountableSentinel ? buildAlarm(knownUnaccountableSentinel) : null;
    try {
      process.stderr.write(`configunlock-reaper: failed open (${e && e.message})\n`);
    } catch (e2) { /* stderr itself unavailable — nothing more we can safely do */ }
  }

  if (additionalContext) {
    try {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext,
          },
        })
      );
    } catch (e) {
      try {
        process.stderr.write(`configunlock-reaper: failed to emit alarm (${e && e.message})\n`);
      } catch (e2) { /* stderr unavailable */ }
    }
  }
  // Use exitCode (not process.exit) so a pending stdout write flushes before exit — the
  // alarm write immediately precedes this, and on some platforms process.exit() can
  // truncate an unflushed pipe write, which would HIDE the one problem we must surface.
  // Mirrors sessionstart-backup-surfacer.js.
  process.exitCode = 0;
});

// True iff tokenDir contains at least one readable, parseable, UNEXPIRED token file.
// Mirrors findPassFile in auto-approve.js: a missing dir / unreadable / unparseable /
// expired token all yield "no valid token" (-> the sentinel is unaccountable -> reaped),
// which is the fail-SAFE direction (toward re-locking the gate). A token with a missing or
// unparseable `expires` is treated as INVALID (not as never-expiring) — same posture as
// findPassFile's `if (!exp || exp < now) continue`.
function hasValidToken(tokenDir) {
  let files;
  try { files = fs.readdirSync(tokenDir); } catch (e) { return false; } // no dir -> no token
  const now = Date.now();
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const full = path.join(tokenDir, f);
    let tok;
    try { tok = JSON.parse(fs.readFileSync(full, 'utf8').replace(/^﻿/, '')); }
    catch (e) { continue; } // unreadable/corrupt token -> ignore (does not count as valid)
    const exp = Date.parse(tok && tok.expires);
    if (!exp || exp < now) continue; // missing/invalid/expired -> not valid
    return true; // one valid unexpired token is enough to account for the open gate
  }
  return false;
}

// The ONLY user-facing output: a plain-language alarm relayed at the top of the first
// response. Fired only when an unaccountable sentinel could NOT be reaped (still present
// after the delete attempt). No jargon; states what happened, why it matters, and the one
// fix. Worded as facts, not orders (GEN-889: Anthropic's hooks guidance -- an out-of-band
// "ACTION:" order can read as a prompt injection and be ignored).
function buildAlarm(sentinelPath) {
  return (
    'Safety switch stuck on (sessionstart-configunlock-reaper): a break-glass switch (' + sentinelPath +
    ') is present but is NOT accounted for by any valid authorization, and this hook could not remove ' +
    'it (it may be locked open by another process). While it exists, the config/hook/script safety ' +
    'reviews are DISABLED, so protected edits are auto-approved without the usual check. Deleting the ' +
    'file re-arms them:\n' +
    '  rm "' + sentinelPath + '"\n' +
    'The only reason to keep it is an emergency recovery that is deliberately under way. Erez has not ' +
    'been told; this is the first thing he needs to hear in the session.'
  );
}
