// SessionStart hook -- GEN-860: automatic add-only backup of Claude session history to Drive.
//
// Runs ~/.claude/scripts/session-backup.ps1, which copies ~/.claude/projects and the desktop app's
// session lists (%APPDATA%/Claude/claude-code-sessions) into the Drive backup folder without ever
// deleting anything there (see the script's header for its rules).
//
// WHY SESSION START: session files only change while Claude runs, so a copy at session start
// (throttled) leaves only what changed since the most recent session start waiting for the next one.
//
// LAUNCH -- same no-flash pattern as sessionstart-backup-spawner.js (GEN-382): powershell.exe is run
// ATTACHED via spawnSync with windowsHide (a detached console child always gets its own window = a
// flash), so session start waits for it (Claude's first reply waits for SessionStart hooks). Bounded
// three ways: the script stops copying after BUDGET_SECONDS (checked between files), spawnSync
// hard-kills it at HARD_TIMEOUT_MS, and the settings.json registration carries its own timeout. No
// cmd/start, wscript, -EncodedCommand or -ExecutionPolicy Bypass (antivirus-heuristic patterns).
// Mark-of-the-Web: -ExecutionPolicy RemoteSigned refuses a local script that carries a Zone.Identifier
// stream, so the hook removes that stream first (same defence as the spawner's Unblock-File).
//
// THROTTLE: one attempt per THROTTLE_MS, stamped up front in last-attempt (attempt, not success), so a
// burst of session starts runs once. Unreadable/future stamps count as "not attempted" (fail toward
// running). The script's own lock covers two hooks that pass the throttle at the same moment. When the
// script reports that the Drive folder is not reachable (exit 14 -- e.g. Google Drive not mounted yet
// right after boot) the stamp is back-dated so a session start 5 or more minutes later tries again.
//
// NEVER SILENT: the script records its own problems in ~/.claude/backup-sweep-failures.jsonl and exits
// 0/10/11/12/14. Any other outcome (launch error, kill, PowerShell failure, script exit 13 = "could not
// record") is recorded here, in the same record shape, so the surfacer shows it at the next session
// start. The surfacer also warns when the last successful copy falls 24 h behind the newest session
// change, which covers this hook not running at all and a Drive folder that stays unreachable.
//
// FAILS OPEN: never blocks or disturbs session start beyond the bounded wait; no stdout.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const THROTTLE_MS = 30 * 60 * 1000;
const BUDGET_SECONDS = 20;
const HARD_TIMEOUT_MS = 45 * 1000;
const HANDLED_EXITS = new Set([0, 10, 11, 12, 14]); // the script recorded, or had nothing to record
const UNREACHABLE_EXIT = 14;
const UNREACHABLE_RETRY_MS = 5 * 60 * 1000;

function log(msg) {
  try { process.stderr.write(`session-backup: ${msg}\n`); } catch (e) { /* nothing more to do */ }
}

// The queue is shared with backup-sweep.ps1 and session-backup.ps1, which open it write-exclusive for a
// moment at session start; retry for up to ~5 s (same budget as their own append) before giving up.
function recordFailure(queueFile, sessionId, detail) {
  const rec = JSON.stringify({
    ts: new Date().toISOString(),
    machine: os.hostname(),
    session: sessionId,
    repo: '(session backup)',
    kind: 'error',
    detail: detail,
    surfaced: false
  }) + '\n';
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 1; ; attempt++) {
    try {
      fs.appendFileSync(queueFile, rec, 'utf8');
      return;
    } catch (e) {
      if (attempt >= 50) {
        log(`could not write failure record (${e && e.message})`);
        return;
      }
      Atomics.wait(pause, 0, 0, 100);
    }
  }
}

function readStamp(file) {
  try {
    const n = Number(String(fs.readFileSync(file, 'utf8')).trim());
    return Number.isFinite(n) ? n : null;
  } catch (e) {
    return null;
  }
}

function writeStamp(file, value) {
  const tmp = file + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, String(value), 'utf8');
    fs.renameSync(tmp, file);
  } catch (e) {
    log(`could not record attempt time (${e && e.message})`);
    try { fs.unlinkSync(tmp); } catch (e2) { /* ignore */ }
  }
}

let raw = '';
process.stdin.on('data', c => (raw += c));
process.stdin.on('end', () => {
  const claudeDir = path.join(os.homedir(), '.claude');
  const queueFile = path.join(claudeDir, 'backup-sweep-failures.jsonl');
  let sessionId = 'unknown-session';
  try {
    try {
      const data = JSON.parse(raw || '{}');
      if (data && typeof data.session_id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(data.session_id)) {
        sessionId = data.session_id;
      }
    } catch (e) {
      log(`could not parse SessionStart payload (${e && e.message})`);
    }

    const stateDir = path.join(claudeDir, 'session-backup-state');
    const attemptFile = path.join(stateDir, 'last-attempt');
    const now = Date.now();
    const last = readStamp(attemptFile);
    if (last !== null && now - last >= 0 && now - last < THROTTLE_MS) {
      return; // attempted recently
    }
    try { fs.mkdirSync(stateDir, { recursive: true }); } catch (e) { log(`could not create state dir (${e && e.message})`); }
    writeStamp(attemptFile, now);

    const script = path.join(claudeDir, 'scripts', 'session-backup.ps1');
    if (!fs.existsSync(script)) {
      recordFailure(queueFile, sessionId, `session backup script missing (${script}); no copy was made`);
      return;
    }
    try { fs.unlinkSync(script + ':Zone.Identifier'); } catch (e) { /* normal: no such stream */ }

    let res;
    try {
      res = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-WindowStyle', 'Hidden',
         '-File', script, '-SessionId', sessionId, '-BudgetSeconds', String(BUDGET_SECONDS)],
        { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'], timeout: HARD_TIMEOUT_MS }
      );
    } catch (e) {
      recordFailure(queueFile, sessionId, `session backup failed to launch (${(e && e.message) || 'unknown error'}); no copy was made`);
      return;
    }

    const timedOut = !!(res.error && (res.error.code === 'ETIMEDOUT' || /timed out/i.test(res.error.message || '')));
    if (res.signal || timedOut) {
      recordFailure(queueFile, sessionId, timedOut
        ? `session backup stopped by the hook after ${HARD_TIMEOUT_MS / 1000}s; the copy did not finish`
        : `session backup terminated by signal ${res.signal}; the copy did not finish`);
    } else if (res.error) {
      recordFailure(queueFile, sessionId, `session backup failed to launch (${res.error.message}); no copy was made`);
    } else if (res.status === UNREACHABLE_EXIT) {
      // Drive folder not reachable (often: not mounted yet). Back-date the stamp so the next session
      // start at least UNREACHABLE_RETRY_MS from now tries again, instead of waiting the full throttle.
      writeStamp(attemptFile, now - THROTTLE_MS + UNREACHABLE_RETRY_MS);
    } else if (!HANDLED_EXITS.has(res.status)) {
      recordFailure(queueFile, sessionId, res.status === 13
        ? 'session backup found a problem but could not record it (failure queue not writable); see ~/.claude/session-backup-state/runs.log'
        : `session backup exited with code ${res.status} (PowerShell or script failure); the copy did not complete`);
    }
  } catch (e) {
    log(`failed open (${e && e.message})`);
  }
  process.exitCode = 0;
});
