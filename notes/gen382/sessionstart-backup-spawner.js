// SessionStart hook — GEN-382 Phase B: backup-sweep launcher (Option 2, no-flash).
//
// Every session start, this runs the backup sweep (backup-sweep.ps1) so all changed
// work gets snapshotted+pushed to the hidden backup channel on GitHub.
//
// WHY THIS RUNS INLINE (not detached) — the no-flash design:
//   The flash this replaces was caused by DETACHMENT. On Windows, spawning a child with
//   `detached:true` forces the Win32 DETACHED_PROCESS creation flag, and per Microsoft's
//   documented behavior CREATE_NO_WINDOW (which `windowsHide:true` would set) is IGNORED
//   whenever DETACHED_PROCESS is present — so a detached console app ALWAYS allocates its
//   own console window = the flash. The only way to suppress the window is to run the child
//   ATTACHED (no detach); an attached child honors windowsHide and shows no window. But an
//   attached child must be WAITED for (it does not outlive this hook) — so we run the sweep
//   SYNCHRONOUSLY via spawnSync and let SessionStart block on it (SessionStart hooks block
//   startup synchronously by design). To keep that block short even on a bad network we bound
//   it two ways: (1) a SHORT per-network-call timeout (NET_TIMEOUT_SECONDS) so no single
//   ls-remote/push can stall — the sweep's network work runs under a Start-Job + Wait-Job
//   -Timeout, so a slow/unreachable remote is logged 'unreachable' (work safe locally, retried
//   next sweep) rather than hanging; and (2) an OVERALL wall-clock budget for the whole repo
//   loop (OVERALL_DEADLINE_SECONDS) — once exceeded the sweep skips-and-queues the remaining
//   repos through its normal failure path and exits cleanly. The spawnSync hard timeout
//   (HARD_TIMEOUT_MS) sits above that budget purely as a last-resort backstop.
//   No cmd.exe/start, no wscript, no -EncodedCommand, no -ExecutionPolicy Bypass anywhere in the
//   launch — those are the patterns Avast's IDP.HELU heuristic flags; this launch avoids them.
//
// THROTTLE (collapse frequent/short-lived sessions; Option 2 "attempt" semantics):
//   The desktop app fires SessionStart very often (many short-lived sessions). Without a guard
//   every one would run a sweep. So before doing anything we read a shared timestamp file
//   (THROTTLE_FILE) holding the epoch-ms of the last backup ATTEMPT (from either this hook or
//   the /wrap sweep). If a backup was attempted within THROTTLE_MS, we skip entirely — no sweep,
//   no window, instant. We stamp the timestamp UP FRONT (attempt, not success): the hook does
//   not wait to learn the push outcome, so it records "attempted now". Consequence (accepted,
//   Option 2): a silently-failed push is not retried until the throttle window elapses; the work
//   is never lost (local copy always safe; the sweep snapshots the FULL working tree, so the next
//   non-throttled sweep captures everything then-present) and a real failure is still surfaced via
//   the sweep's own durable failure queue. FAIL TOWARD SWEEPING: a missing/unparseable/future/
//   backward-clock/unreadable timestamp is treated as "not recently backed up" -> sweep.
//
// WHAT IT SWEEPS (known-roots scan, projects-only per GEN-382 decision):
//   every immediate subfolder of C:\Users\Erez\AI Projects that is a git repo (has a .git entry).
//   ~/.claude is intentionally NOT swept here — it has its own backup via sync.ps1.
//
// FAILS OPEN: any error -> spawn nothing / skip, never disrupt startup — but leave a one-line
// STDERR breadcrumb (never stdout) so a silent self-failure is detectable. Emits NO stdout by
// design (contributes no additionalContext).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PROJECTS_DIR = 'C:\\Users\\Erez\\AI Projects';

// Throttle: skip a session-start sweep if a backup was attempted within this window.
const THROTTLE_MS = 5 * 60 * 1000; // 5 minutes (fixed; see header)
// Short per-network-call timeout (seconds) passed to the sweep, bounding a SINGLE ls-remote/push
// so an unreachable remote can't stall one call. 8s: sub-second on a healthy network.
const NET_TIMEOUT_SECONDS = 8;
// Overall wall-clock budget (seconds) passed to the sweep as -OverallDeadlineSeconds. This is the
// PRIMARY bound on how long the inline (blocking) sweep can take: the sweep checks elapsed time
// before each repo and, once exceeded, SKIPS-AND-QUEUES every remaining repo through its normal
// failure-queue path (no leaked temp index / local pin ref — a deadline-skipped repo is never
// entered). So on realistic repo counts the sweep exits cleanly on its own well before the hard
// timeout below ever fires.
const OVERALL_DEADLINE_SECONDS = 25;
// Last-resort hard ceiling on the whole spawnSync call. This is a BACKSTOP, not the primary bound
// (that is OVERALL_DEADLINE_SECONDS, enforced inside the sweep with clean cleanup). It is set
// comfortably ABOVE the internal deadline so the sweep's own clean exit always wins on realistic
// repo counts; this hard kill only trips if the sweep wedges OUTSIDE its own deadline logic (e.g.
// a hung child git that its Start-Job/Wait-Job did not bound). A hard kill is abrupt — the sweep's
// PowerShell is terminated mid-run and cannot write its own failure record — so the JS side writes
// a durable failure record itself when a kill is detected (see the res.signal handling below).
const HARD_TIMEOUT_MS = 60 * 1000;

function log(msg) {
  try {
    process.stderr.write(`backup-spawner: ${msg}\n`);
  } catch (e) {
    /* stderr unavailable — nothing more we can safely do */
  }
}

// Enumerate immediate subfolders of PROJECTS_DIR that are git repos.
function findProjectRepos() {
  const repos = [];
  let entries;
  try {
    entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
  } catch (e) {
    log(`cannot read projects dir (${e && e.message})`);
    return repos; // projects dir missing/unreadable → nothing to sweep
  }
  for (const ent of entries) {
    // Accept real directories AND symlinks/junctions that resolve to a directory.
    // ent.isDirectory() is FALSE for a symlink-to-dir (it reports the entry's own
    // type), so a junctioned project would otherwise be silently skipped — and a
    // silently-unswept repo is exactly the failure this must avoid. For a symlink
    // we stat (follow the link) to decide.
    let isDir = ent.isDirectory();
    if (!isDir && ent.isSymbolicLink()) {
      try {
        isDir = fs.statSync(path.join(PROJECTS_DIR, ent.name)).isDirectory();
      } catch (e) {
        // Dangling/unreadable link — log rather than silently drop.
        log(`skipping unreadable entry ${ent.name} (${e && e.message})`);
      }
    }
    if (!isDir) continue;
    const repoPath = path.join(PROJECTS_DIR, ent.name);
    // A git repo has a .git entry (dir for a normal repo, file for a worktree).
    if (fs.existsSync(path.join(repoPath, '.git'))) {
      repos.push(repoPath);
    }
  }
  return repos;
}

// Read the shared throttle timestamp (epoch ms of the last backup attempt). Returns a finite
// number, or null if the file is missing/unreadable/unparseable. FAIL TOWARD SWEEPING: any
// non-numeric / unreadable result -> null -> caller treats as "not recently backed up".
function readLastAttempt(throttleFile) {
  let raw;
  try {
    raw = fs.readFileSync(throttleFile, 'utf8');
  } catch (e) {
    return null; // missing/unreadable -> sweep
  }
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n)) return null; // unparseable -> sweep
  return n;
}

// Decide whether the throttle should suppress this sweep. Suppress ONLY when we have a valid
// prior timestamp that is in the past by LESS than THROTTLE_MS. A future timestamp (now-last<0,
// clock moved backward or a corrupt future value) is NOT trusted for suppression -> sweep.
function isThrottled(lastAttempt, now) {
  if (lastAttempt === null) return false; // no/invalid record -> sweep
  const delta = now - lastAttempt;
  if (delta < 0) return false;            // future timestamp / backward clock -> sweep
  return delta < THROTTLE_MS;
}

// Atomically write the attempt timestamp: write a temp file then rename over the target, so a
// concurrent reader never observes a half-written value.
function writeAttempt(throttleFile, now) {
  const tmp = throttleFile + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, String(now), 'utf8');
    fs.renameSync(tmp, throttleFile);
  } catch (e) {
    // Non-fatal: if we can't record the attempt, the worst case is the NEXT session sweeps too
    // (extra work, never a skipped backup) — the fail-open direction. Clean up the temp best-effort.
    log(`could not record attempt timestamp (${e && e.message})`);
    try { fs.unlinkSync(tmp); } catch (e2) { /* ignore */ }
  }
}

// Append a one-line note that a session-start sweep was skipped by the throttle. This is a BENIGN,
// expected event (the throttle working as designed) — NOT a failure — so it goes to a low-volume
// debug log, NEVER the durable failure queue the surfacer reads (which is reserved for real
// failures, so it isn't flooded with routine skips). Best-effort; never throws.
function logSkip(stateDir, sessionId, now, lastAttempt) {
  try {
    const line = JSON.stringify({
      ts: new Date(now).toISOString(),
      session: sessionId,
      lastAttemptMsAgo: lastAttempt === null ? null : (now - lastAttempt),
      note: 'session-start sweep skipped by throttle (backup attempted recently)'
    }) + '\n';
    fs.appendFileSync(path.join(stateDir, 'throttle-skips.log'), line, 'utf8');
  } catch (e) {
    // A skip note failing to write is not worth disrupting anything; breadcrumb only.
    log(`could not write throttle-skip note (${e && e.message})`);
  }
}

// Best-effort removal of the temp JSON payload. The psCommand deletes it on the normal path;
// this is the fallback for a hard-kill/crash before that Remove-Item ran, so it can't be
// stranded in temp. Idempotent and silent — a missing file is the expected common case.
function cleanupPayload(payloadFile) {
  try {
    fs.unlinkSync(payloadFile);
  } catch (e) {
    /* already gone (normal) or unremovable — nothing actionable */
  }
}

// Write a durable failure record from the JS side. Used for every failure the child psCommand
// could NOT record itself — a hard-timeout kill (child terminated mid-run) or a launch/engine
// failure before the psCommand body ran (spawn ENOENT, PS host/parse failure). Without this those
// cases would be silent: the throttle was already stamped, so the surfacer would see nothing.
// Record shape MUST match the sweep's own Add-Failure / the psCommand $WriteFail
// (ts/machine/session/repo/kind/detail/surfaced) so the surfacer parses it identically. Best-effort;
// a failure to write here is itself only a stderr breadcrumb.
function recordFailure(failureQueue, sessionId, detail) {
  try {
    const rec = JSON.stringify({
      ts: new Date().toISOString(),
      machine: os.hostname(),
      session: sessionId,
      repo: '(spawn)',
      kind: 'error',
      detail: detail,
      surfaced: false
    }) + '\n';
    fs.appendFileSync(failureQueue, rec, 'utf8');
  } catch (e) {
    log(`could not write hard-kill failure record (${e && e.message})`);
  }
}

// Accumulate stdin (needed both to reach the 'end' event and to read session_id).
let raw = '';
process.stdin.on('data', c => (raw += c));
process.stdin.on('end', () => {
  try {
    const claudeDir = path.join(os.homedir(), '.claude');
    const stateDir = path.join(claudeDir, 'backup-sweep-state');
    const throttleFile = path.join(stateDir, 'last-backup');

    // Session id from the SessionStart payload → passed to the sweep as its per-session ref
    // namespace. Fall back to a stable non-empty label if absent, so the sweep never gets an
    // empty -SessionId (which would fail its mandatory-param bind and shift subsequent args).
    let sessionId = 'unknown-session';
    try {
      const data = JSON.parse(raw || '{}');
      if (data && typeof data.session_id === 'string' && data.session_id.trim()) {
        sessionId = data.session_id.trim();
      }
    } catch (e) {
      log(`could not parse SessionStart payload, using fallback session id (${e && e.message})`);
    }

    // THROTTLE CHECK — before any work. Skip instantly if a backup was attempted recently.
    const now = Date.now();
    const lastAttempt = readLastAttempt(throttleFile);
    if (isThrottled(lastAttempt, now)) {
      logSkip(stateDir, sessionId, now, lastAttempt);
      log(`throttled: last backup attempt ${Math.round((now - lastAttempt) / 1000)}s ago (< ${THROTTLE_MS / 1000}s); skipping`);
      process.exitCode = 0;
      return;
    }

    const sweepScript = path.join(claudeDir, 'scripts', 'backup-sweep.ps1');
    if (!fs.existsSync(sweepScript)) {
      log(`sweep script not found at ${sweepScript}; nothing spawned`);
      return;
    }

    const repos = findProjectRepos();
    if (repos.length === 0) {
      log('no project git repos found; nothing to sweep');
      return;
    }

    // Ensure the state dir exists (for the throttle file + payload). Best-effort; a failure here
    // falls through to the sweep attempt (fail-open) rather than aborting.
    try {
      if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
    } catch (e) {
      log(`could not ensure state dir (${e && e.message})`);
    }

    // Record the attempt UP FRONT (Option 2 "attempt" semantics — see header). We are about to
    // run a sweep; stamping now means a burst of near-simultaneous session starts collapses to
    // one sweep even though we don't wait to learn the push outcome.
    writeAttempt(throttleFile, now);

    // Repo paths + session id are passed via a TEMP JSON FILE, never on the command line. WHY:
    // a repo path placed in the command STRING would be re-parsed by PowerShell/cmd tokenizers
    // where characters like & % ^ | ! are special; a project folder named e.g. `A&B` (folder
    // names are auto-discovered, unconstrained) could corrupt or truncate the command and
    // silently drop repos. Routing the (unconstrained) values through a file means only FIXED,
    // controlled paths (the sweep script + this temp file, both under our own dirs) appear on the
    // command line. Verified previously: repos named with space, `&`, and `%` round-trip intact.
    const failureQueue = path.join(claudeDir, 'backup-sweep-failures.jsonl');
    const payloadFile = path.join(os.tmpdir(), `backup-spawn-${process.pid}.json`);
    fs.writeFileSync(
      payloadFile,
      JSON.stringify({ sessionId: sessionId, repos: repos }),
      'utf8'
    );

    // The -Command reads the payload file and splats into the sweep's existing
    // -SessionId/-RepoPaths interface, passing the SHORT session-start network timeout AND the
    // overall wall-clock budget. It also self-deletes the temp payload file. Only psLit-quoted
    // CONTROLLED paths appear here (no user-controlled repo names). psCommand contains no literal
    // double-quotes (its PowerShell string literals use single quotes) and no newlines.
    const psLit = s => "'" + String(s).replace(/'/g, "''") + "'";
    // NOTE @($d.repos): ConvertFrom-Json deserializes a SINGLE-element repos list as a SCALAR
    // string, not an array, which breaks binding to the sweep's [string[]]$RepoPaths (verified:
    // the single-repo case silently failed to launch). @(...) forces an array from either shape.
    //
    // MOTW DEFENSE (Unblock-File before launch): we run the sweep under -ExecutionPolicy
    // RemoteSigned (chosen over Bypass because Bypass is half of an Avast IDP.HELU trigger). But
    // RemoteSigned FAILS CLOSED on a LOCAL script that carries a Mark-of-the-Web (a Zone.Identifier
    // alternate data stream) — which a Google-Drive sync or a reinstall could stamp onto the sweep
    // script. That would silently block every backup. `Unblock-File` strips any such MOTW; it is a
    // harmless no-op when the script is already clean (the normal case). Wrapped in its own
    // try/catch so a failure to unblock never aborts the launch.
    //
    // NEVER-SILENT invariant — three distinct failure modes, all must leave a trace:
    //   (1) reading/parsing the payload throws BEFORE the sweep starts → the sweep's own failure
    //       queue never runs, so the CATCH here writes a durable record.
    //   (2) the sweep RUNS but exits non-zero on a fail-closed path (2=bad invocation / no repos,
    //       4=secret-patterns load failed). PowerShell's `&` does NOT throw on a native/script
    //       non-zero exit even under $ErrorActionPreference='Stop', and the sweep uses
    //       Write-FatalLine+`exit N` (not Write-Error) on those paths, so the catch never fires
    //       for (2). We therefore check $LASTEXITCODE after the call and write the same durable
    //       record ourselves. (Verified against backup-sweep.ps1: 0=ran, 2/4=fatal.)
    //   (3) the whole PowerShell process is HARD-KILLED by the spawnSync timeout before it can
    //       write anything — a killed process cannot log its own death, so the JS side writes the
    //       durable record after spawnSync returns (see the res.signal handling below). That path
    //       lives in JS, not here, because by definition this psCommand is no longer running then.
    // SENTINEL HANDSHAKE (never-silent, exactly-once):
    //   RECORDED_SENTINEL (77): the psCommand's own $WriteFail wrote a durable record SUCCESSFULLY.
    //     JS trusts this and does NOT self-record — one record, written by the child.
    //   WRITE_FAILED_SENTINEL (78): $WriteFail RAN but its append THREW (queue momentarily
    //     unwritable). The child could not record, so JS MUST self-record. JS writes via its own
    //     process+handle, which can succeed on a transient child-side write failure (a lock the
    //     child hit that has since cleared). If the queue is durably unwritable, neither side can
    //     record — but that is unavoidable for any queue-based design; the handshake at least never
    //     TRUSTS a write that didn't happen.
    //   Any OTHER non-zero exit: the failure happened BEFORE $WriteFail could run (PS engine/host/
    //     parse failure upstream of the psCommand body, or a policy block on -Command) — the
    //     psCommand can't cover it, so JS self-records. Both 77/78 are outside the sweep's own
    //     contract (0/2/4) and common shell codes, so a genuine sweep exit can't be mistaken for a
    //     handshake signal. $WriteFail returns $true/$false; its RETURN VALUE (not $LASTEXITCODE)
    //     picks 77 vs 78 — so a write failure downgrades to "JS please record", never a false 77.
    const RECORDED_SENTINEL = 77;
    const WRITE_FAILED_SENTINEL = 78;
    const psCommand =
      "$ErrorActionPreference='Stop'; " +
      '$WriteFail = { param($k,$dt); try { ' +
      '$rec = [ordered]@{ ts=(Get-Date -Format o); machine=' + psLit(os.hostname()) + '; ' +
      'session=' + psLit(sessionId) + '; repo=' + psLit('(spawn)') + '; kind=$k; ' +
      'detail=$dt; surfaced=$false } | ConvertTo-Json -Compress; ' +
      '[System.IO.File]::AppendAllText(' + psLit(failureQueue) + ', $rec + [char]10); $true } catch { $false } }; ' +
      'try { Unblock-File -LiteralPath ' + psLit(sweepScript) + ' -ErrorAction SilentlyContinue } catch {}; ' +
      'try { ' +
      '$p = ' + psLit(payloadFile) + '; ' +
      '$d = Get-Content -LiteralPath $p -Raw | ConvertFrom-Json; ' +
      'Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue; ' +
      '& ' + psLit(sweepScript) + ' -SessionId $d.sessionId -RepoPaths @($d.repos) -NetTimeoutSeconds ' + NET_TIMEOUT_SECONDS + ' -OverallDeadlineSeconds ' + OVERALL_DEADLINE_SECONDS + '; ' +
      '$ec = $LASTEXITCODE; ' +
      'if ($ec -ne 0) { ' +
      "$ok = (& $WriteFail 'error' ('backup-sweep exited non-zero (' + $ec + '); backup did NOT complete this session')); " +
      'if ($ok) { exit ' + RECORDED_SENTINEL + ' } else { exit ' + WRITE_FAILED_SENTINEL + ' } } ' +
      '} catch { ' +
      "$ok = (& $WriteFail 'error' ('spawner launch failed before sweep: ' + $_.Exception.Message)); " +
      'if ($ok) { exit ' + RECORDED_SENTINEL + ' } else { exit ' + WRITE_FAILED_SENTINEL + ' } }';

    // INLINE, ATTACHED, WINDOWLESS launch — the no-flash core (see header). spawnSync runs
    // powershell.exe DIRECTLY (no cmd/start, no detach). windowsHide:true suppresses the console
    // window (honored because the child is NOT detached). stdio: ALL three streams ignored — the
    // hook branches only on res.status/res.signal, never on the sweep's text output, so there is
    // nothing to read; ignoring stdout/stderr (rather than piping) removes both the buffering cost
    // and the maxBuffer-overflow-kill path (a chatty sweep overflowing a piped buffer would
    // otherwise be SIGKILLed by Node, skipping its own cleanup — the very failure mode we are
    // eliminating). An ignored stream is drained by the OS, so it can never deadlock either.
    // timeout is a last-resort hard ceiling (see HARD_TIMEOUT_MS note); the PRIMARY bound is the
    // sweep's own -OverallDeadlineSeconds. The session-start delay is whatever the local snapshot +
    // short-timeout network push take: sub-second on a healthy network, bounded on a bad one.
    let res;
    try {
      res = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-WindowStyle', 'Hidden',
         '-Command', psCommand],
        {
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'ignore'],
          timeout: HARD_TIMEOUT_MS
        }
      );
    } catch (e) {
      // spawnSync itself failed to even launch (e.g. powershell.exe not found → ENOENT, or an
      // EACCES). The child psCommand never ran, so NOTHING recorded this failure. The throttle was
      // already stamped up-front (writeAttempt above), so without a durable record here the next
      // 5 min of sessions would be throttle-suppressed with the surfacer seeing nothing — a silent
      // backup outage. Write the record ourselves, then fail open. (NEVER-SILENT invariant.)
      log(`spawnSync failed to launch (${e && e.message})`);
      recordFailure(failureQueue, sessionId,
        `backup-sweep failed to launch (${(e && e.message) || 'unknown spawn error'}); ` +
        `backup did NOT run this session`);
      cleanupPayload(payloadFile);
      process.exitCode = 0;
      return;
    }

    // Always best-effort remove the payload file ourselves: the psCommand deletes it on the
    // normal path, but a HARD KILL (timeout/SIGKILL) or a crash before that Remove-Item would
    // strand it in temp. Idempotent — a no-op if the sweep already deleted it.
    cleanupPayload(payloadFile);

    // Failure recording — the NEVER-SILENT invariant. Exactly one side must write a durable record
    // for any failure, never both, never neither. The psCommand exits RECORDED_SENTINEL on every
    // path where its own $WriteFail already wrote the record (a sweep non-zero exit, or a launch
    // failure it caught internally). So:
    //   - killed (hard timeout): the child was terminated before it could write anything → WE
    //     record. (Verified: a spawnSync timeout kill sets BOTH res.signal='SIGTERM' AND
    //     res.error.code='ETIMEDOUT'.)
    //   - res.status === RECORDED_SENTINEL: the psCommand already recorded → breadcrumb only.
    //   - any OTHER non-zero status, OR a non-timeout res.error (e.g. ENOENT): the failure happened
    //     BEFORE $WriteFail could run (PS engine/host/parse failure upstream of the psCommand body,
    //     a policy block on -Command itself, or a spawn error surfaced via res.error not throw) →
    //     nothing recorded it → WE record.
    //   - status 0, no error, no signal: success → breadcrumb only.
    const timedOut =
      (res.error && (res.error.code === 'ETIMEDOUT' || /timed out/i.test(res.error.message || '')));
    const killed = !!res.signal || timedOut;
    if (killed) {
      // Distinguish OUR hard-timeout kill (the expected case: spawnSync sets ETIMEDOUT + SIGTERM
      // when it enforces `timeout`) from a kill by some OTHER external signal, so the durable
      // detail doesn't over-claim "after Ns by the hook" for a kill the hook didn't cause.
      const detail = timedOut
        ? `backup-sweep hard-killed by hook after ${HARD_TIMEOUT_MS / 1000}s ` +
          `(signal=${res.signal || 'timeout'}); backup did NOT complete this session`
        : `backup-sweep terminated by signal ${res.signal}; backup did NOT complete this session`;
      recordFailure(failureQueue, sessionId, detail);
      log(`sweep killed (${timedOut ? 'hard timeout' : 'signal ' + res.signal}); wrote durable failure record`);
    } else if (res.error) {
      // A non-timeout spawn error surfaced on res.error rather than thrown → child never ran →
      // nothing recorded it.
      log(`sweep process error (${res.error.message}); recording durable failure`);
      recordFailure(failureQueue, sessionId,
        `backup-sweep failed to launch (${res.error.message}); backup did NOT run this session`);
    } else if (res.status === RECORDED_SENTINEL) {
      // The psCommand's own $WriteFail wrote the record SUCCESSFULLY — do NOT double-record.
      log(`sweep reported a failure it already recorded (sentinel exit); breadcrumb only`);
    } else if (res.status === WRITE_FAILED_SENTINEL) {
      // The psCommand's $WriteFail RAN but its append threw (queue momentarily unwritable from the
      // child). Retry the durable write from OUR process+handle — it can succeed where a transient
      // child-side lock failed. (If the queue is durably unwritable this also fails, but then no
      // design could record it.)
      log(`sweep tried to record a failure but its write failed; retrying durable write from hook`);
      recordFailure(failureQueue, sessionId,
        `backup-sweep failed and its own failure-queue write failed; ` +
        `backup did NOT complete this session (recorded by hook)`);
    } else if (res.status !== 0) {
      // A non-zero exit that is NEITHER sentinel → the failure occurred upstream of the psCommand
      // body (engine/host/parse failure, policy block), so $WriteFail never ran → WE record.
      log(`sweep exited non-zero without recording (status=${res.status}); recording durable failure`);
      recordFailure(failureQueue, sessionId,
        `backup-sweep exited ${res.status} before it could record a failure; ` +
        `backup did NOT complete this session`);
    } else {
      log(`sweep completed for ${repos.length} repo(s), session=${sessionId}`);
    }
  } catch (e) {
    // fail open — never disrupt startup
    log(`failed open (${e && e.message})`);
  }
  // No stdout: this hook contributes no additionalContext. Exit naturally.
  process.exitCode = 0;
});
