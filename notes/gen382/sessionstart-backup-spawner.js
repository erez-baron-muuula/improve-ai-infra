// SessionStart hook — GEN-382 Phase B step 1b: backup-sweep spawner.
//
// Every session start, this fires the backup sweep (backup-sweep.ps1) in the
// background so all changed work gets snapshotted+pushed to the hidden backup
// channel on GitHub. It is STRICTLY fire-and-forget: it spawns a detached,
// hidden PowerShell process and returns immediately — it never waits for the
// sweep, never blocks/delays session startup, and never surfaces the sweep's
// result (that is the SEPARATE surfacer hook's job, on the NEXT session start).
//
// WHAT IT SWEEPS (known-roots scan, projects-only per GEN-382 decision):
//   every immediate subfolder of C:\Users\Erez\AI Projects that is a git repo
//   (has a .git entry). ~/.claude is intentionally NOT swept here — it already
//   has its own backup via sync.ps1 (Drive + git-history).
//
// HANDS-OFF CONTRACT:
//   - Fire-and-forget: detached + stdio ignored + unref, so the hook process
//     exits without the sweep as a child; the sweep outlives it.
//   - NO spawner-level lock. Concurrency safety lives entirely in the sweep:
//     it takes a per-repo lock (a second sweep hitting a locked repo skips it,
//     benign+logged) and keeps PER-SESSION snapshot state, so two sessions'
//     sweeps are both correct and independent. A spawner-level single-instance
//     lock would be redundant AND actively harmful — holding it across sessions
//     would suppress a legitimate second session's backup entirely. Worst case
//     without it is two near-simultaneous sweeps of the same repo, where the
//     second no-ops (per-repo lock-skip, or identical-tree skip-if-unchanged).
//   - Fails open: any error → spawn nothing, never disrupt startup — but leave a
//     one-line STDERR breadcrumb (never stdout) so a silent self-failure is
//     detectable. This hook emits NO stdout (no additionalContext) by design.
//   - No -RepoPaths found (no project repos) → do nothing, exit 0 (nothing to back up).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PROJECTS_DIR = 'C:\\Users\\Erez\\AI Projects';

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

// Accumulate stdin (needed both to reach the 'end' event and to read session_id).
let raw = '';
process.stdin.on('data', c => (raw += c));
process.stdin.on('end', () => {
  try {
    const claudeDir = path.join(os.homedir(), '.claude');

    // Session id from the SessionStart payload → passed to the sweep as its
    // per-session ref namespace. Fall back to a stable non-empty label if
    // absent, so the sweep never gets an empty -SessionId (which would fail its
    // mandatory-param bind and shift subsequent args — a known PS 5.1 hazard).
    let sessionId = 'unknown-session';
    try {
      const data = JSON.parse(raw || '{}');
      if (data && typeof data.session_id === 'string' && data.session_id.trim()) {
        sessionId = data.session_id.trim();
      }
    } catch (e) {
      log(`could not parse SessionStart payload, using fallback session id (${e && e.message})`);
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

    // Repo paths + session id are passed via a TEMP JSON FILE, never on the
    // command line. WHY: the launch must survive this hook exiting (see the
    // cmd/start note below), which forces a `cmd.exe` layer; but a repo path
    // (or session id) placed in the command STRING would be re-parsed by cmd's
    // own tokenizer, where `& % ^ | !` are special regardless of any PowerShell
    // quoting — a project folder named e.g. `A&B` (folder names are
    // auto-discovered, unconstrained) could corrupt or truncate the command and
    // silently drop repos. Routing the (unconstrained) values through a file
    // means only FIXED, controlled paths (the sweep script + this temp file,
    // both under our own dirs) ever appear on the command line. Verified: repos
    // named with space, `&`, and `%` all round-trip intact this way.
    const failureQueue = path.join(claudeDir, 'backup-sweep-failures.jsonl');
    const payloadFile = path.join(os.tmpdir(), `backup-spawn-${process.pid}.json`);
    fs.writeFileSync(
      payloadFile,
      JSON.stringify({ sessionId: sessionId, repos: repos }),
      'utf8'
    );

    // The -Command reads the payload file and splats into the sweep's existing
    // -SessionId/-RepoPaths interface. It also self-deletes the temp file. Only
    // psLit-quoted CONTROLLED paths appear here (no user-controlled repo names).
    const psLit = s => "'" + String(s).replace(/'/g, "''") + "'";
    // NOTE @($d.repos): ConvertFrom-Json deserializes a SINGLE-element repos list
    // as a SCALAR string, not an array, which breaks binding to the sweep's
    // [string[]]$RepoPaths (verified: the single-repo case silently failed to
    // launch). @(...) forces an array from either a scalar or an array, so a
    // one-repo project backs up correctly.
    //
    // NEVER-SILENT invariant: if reading/parsing the payload throws BEFORE the
    // sweep starts, the sweep's own failure queue never runs — so the catch here
    // appends a durable 'error' record itself (best-effort), so the next session's
    // surfacer still shows that this session's backup did not launch.
    const psCommand =
      "$ErrorActionPreference='Stop'; " +
      'try { ' +
      '$p = ' + psLit(payloadFile) + '; ' +
      '$d = Get-Content -LiteralPath $p -Raw | ConvertFrom-Json; ' +
      'Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue; ' +
      '& ' + psLit(sweepScript) + ' -SessionId $d.sessionId -RepoPaths @($d.repos) ' +
      '} catch { ' +
      'try { ' +
      '$rec = [ordered]@{ ts=(Get-Date -Format o); machine=' + psLit(os.hostname()) + '; ' +
      'session=' + psLit(sessionId) + '; repo=' + psLit('(spawn)') + '; kind=' + psLit('error') + '; ' +
      "detail=('spawner launch failed before sweep: ' + $_.Exception.Message); surfaced=$false } | ConvertTo-Json -Compress; " +
      '[System.IO.File]::AppendAllText(' + psLit(failureQueue) + ", $rec + [char]10) } catch {}; " +
      'exit 1 }';

    // TRUE fire-and-forget on Windows: a plain `spawn('powershell', {detached})`
    // does NOT survive this hook exiting immediately — the child is torn down
    // before it runs (verified here; matches the known Node/Windows detached-spawn
    // issue). Routing through `cmd /c start "" /b powershell -Command <cmd>` fully
    // DISOWNS the PowerShell process into its own lifecycle so it outlives the
    // hook. `""` is start's (empty) window title; `/b` = no new window.
    // detached+stdio:ignore+unref lets THIS hook exit immediately.
    const child = spawn(
      'cmd.exe',
      [
        '/c', 'start', '', '/b', 'powershell.exe',
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
        '-Command', psCommand,
      ],
      { detached: true, stdio: 'ignore', windowsHide: true }
    );
    child.on('error', err => {
      // Spawn failed (e.g. cmd.exe not on PATH). Fail open + breadcrumb. NOTE:
      // this only catches failure to launch cmd.exe itself; a failure of the
      // detached powershell/sweep downstream is invisible here by design (that
      // is the sweep's own failure-queue's job, surfaced next session).
      log(`spawn failed (${err && err.message})`);
    });
    child.unref();
    log(`spawned sweep for ${repos.length} repo(s), session=${sessionId}`);
  } catch (e) {
    // fail open — never disrupt startup
    log(`failed open (${e && e.message})`);
  }
  // No stdout: this hook contributes no additionalContext. Exit naturally.
  process.exitCode = 0;
});
