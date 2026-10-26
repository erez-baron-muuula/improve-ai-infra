# sync.ps1 -- Sync Claude Code config between local .claude folder and Drive.
#
# Usage:
#   .\sync.ps1 -Direction From-Claude                         # copy local .claude/*  ->  Drive  (+ git commit/push)
#   .\sync.ps1 -Direction From-Claude -CommitMessage "..."    # same, with custom commit message
#   .\sync.ps1 -Direction To-Claude                           # copy Drive            ->  local .claude/  (non-destructive; GEN-355)
#   .\sync.ps1 -Direction To-Claude -DiscardLocal             # force Drive to win even over an in-session local edit (recovery path)
#
# Files synced:
#   - CLAUDE.md (global rules)
#   - settings.json
#   - settings.local.json
#   - memory\   (entire folder -- memory index + all memory files; GEN-140)
#   - hooks\*.js, hooks\*.ps1  (every hook's code, found on EITHER side -- this PC or Drive -- so a
#     new hook needs no edit here and a To-Claude pull restores every hook; GEN-460. What each hook
#     does is in its own header comment and its settings.json registration. A hook deleted on
#     this PC but still on Drive is pulled back by the next To-Claude sync (inert unless
#     settings.json registers it); to remove a hook for good, delete it on every PC and on Drive.
#     update-config.ps1 runs a To-Claude before every config edit, so a hook deleted only here comes
#     back silently at the next edit, and a PC that still has it pushes it back to Drive.)
#   - hooks\secret-patterns.json  (shared secret-scan patterns; GEN-233)
#   - backup-triage.json  (GEN-460 backup-triage decisions; merged across PCs, not hash-synced --
#     see "Backup triage" below)
#   - skills\   (entire folder -- /check and any future skills; GEN-223)
#   - agents\   (entire folder -- check-reviewer and any future agents; GEN-232)
#   - commands\ (entire folder -- /loghistory and any future slash commands)
#   - hooks\tests\ (entire folder -- gate regression tests, e.g. gen309-gate-test.sh)
#   - hooks\refs\ (entire folder -- injection-hook reference notes shell.md/notion.md read at runtime)
#   - scripts\  (entire folder -- notion-ticket-lookup.ps1 and future sanctioned scripts; GEN-140)
#   - .settings-health-keep.json  (GEN-290 settings-health judgment-candidate keep-list -- adjudicated-KEEP entries so they aren't re-reviewed)
#
# NOT synced (intentionally excluded for safety / noise):
#   - hooks\deferred-calls.jsonl  (per-machine learning log; append-only, would conflict across machines)
#   - .credentials.json  (auth tokens -- never sync)
#   - ..\.claude.json and ..\.claude.json.backup  (harness-managed machine state,
#     rewritten every session -- backing it up would churn git on every sync; carries
#     oauthAccount identity data; low restore value. Deliberately NOT backed up, as a
#     documented decision -- the coverage check below watches the .claude* sibling
#     class so any FUTURE sibling config file warns; GEN-140)
#   - cache\, sessions\, tasks\, shell-snapshots\, backups\, downloads\, plans\, session-env\
#   - any per-project transcript files (*.jsonl)
#   - sync-baseline.json, sync.lock  (per-machine sync state; GEN-355/GEN-353 -- see below)
#
# After every successful From-Claude push, the same files are also copied into
# C:\Users\Erez\.claude-git-history\ and committed/pushed to the private GitHub
# repo erez-baron-muuula/claude-config-history. This is the cross-machine
# version history / recovery layer. Git failures DO NOT block the Drive sync --
# they only emit a warning, so being offline doesn't break anything.
#
# ---- Non-destructive To-Claude pull (GEN-355 / GEN-248 bug 1) --------------
# The old behavior did an unconditional Drive->local overwrite on every To-Claude
# pull, silently destroying any in-session local edit that hadn't been pushed yet
# (two real incidents: 2026-06-15, 2026-07-06). Google Drive File Stream mtimes
# are not trustworthy as a "which side changed" signal (its mount is known to
# rewrite/lag timestamps independent of real edits), so this does NOT use
# LastWriteTime. Instead sync.ps1 keeps a local, per-machine manifest of the
# SHA-256 of every synced file as of its last successful sync (sync-baseline.json).
# On every To-Claude pull, per file:
#   - local content == Drive content              -> no-op (or copy if missing), refresh baseline
#   - local == baseline, Drive differs             -> local is unedited since last sync -> normal
#                                                      freshness pull (overwrite with Drive), update baseline
#   - local differs from baseline, Drive == baseline -> in-session edit, not yet pushed -> KEEP LOCAL,
#                                                      warn ("kept local, edited this session"); baseline
#                                                      is deliberately NOT updated, so the next pull still
#                                                      recognizes this file as unpushed
#   - local differs from baseline AND Drive differs from baseline -> both sides changed -> KEEP LOCAL,
#                                                      loud CONFLICT warning (Drive's version is not lost --
#                                                      it stays on Drive + git history; only local's window
#                                                      is protected here)
#   - no baseline entry (first run / brand-new file) -> if local==Drive, seed the baseline; if they differ,
#                                                      conservatively KEEP LOCAL + warn (never destroy on
#                                                      an unknown baseline)
# A malformed/unreadable manifest degrades to "no baseline for any file" (the same
# conservative keep-local-and-warn path per file) rather than failing the sync.
# Local-only files (present locally, absent from Drive) are never deleted by a pull.
#
# -DiscardLocal restores the old blind-overwrite behavior for the one legitimate
# case that wants it: update-config.ps1's pending-sync recovery flow (Option 2 --
# discard an edit that was written locally but never pushed).
#
# ---- Concurrency guard (GEN-353) -------------------------------------------
# sync.ps1 takes its own OS-level lock (sync.lock, separate from update-config.ps1's
# config lock -- update-config.ps1 calls sync.ps1 while ALREADY holding the config
# lock, so reusing that lock here would deadlock on reentry). Lock ordering is
# strictly config -> sync, never the reverse (sync.ps1 never touches the config
# lock), so no deadlock is possible between the two. The lock is a FileShare::None
# file handle -- it auto-releases if the process dies, no stale-lock cleanup needed.
#
# The git pull/push network calls are wrapped in a background job with a bounded
# timeout so a stalled network operation (e.g. a hung `/wrap` push) cannot hold the
# lock indefinitely and starve every other session's config edits (git failures are
# already a warn-only, self-healing layer here -- see the NOT-synced/git-history
# section below -- so timing one out and moving on is consistent with that design).
# A second sync run that cannot acquire the lock within its retry budget gives up
# with a DISTINCT exit code (6) rather than silently succeeding -- see Exit codes.
#
# ---- Backup triage (GEN-460) -------------------------------------------------
# A From-Claude run sorts every path under .claude that is not in the backup set, so a new file
# never has to be sorted by hand:
#   - hook code (hooks\*.js, hooks\*.ps1) is always backed up (see "Files synced" above);
#   - a hook's marker file (<hook name>.accepted / .off / .on / .testonly / .disabled / .bak / .orig),
#     and a new top-level folder that is empty or holds only ignore-listed files (locks, temp saves,
#     logs), is skipped by rule: recorded in backup-triage.json and reported ONCE as a
#     "BACKUP-TRIAGE: skipped ..." warning (a rule-skipped folder that later gains other files is
#     raised again);
#   - anything else gets a "BACKUP-TRIAGE NEEDED" warning telling the session's Claude to find what
#     wrote it and record a decision with -TriageDecide (below) in the same turn.
# All triage output goes to the WARNING stream, because update-config.ps1 runs this script with
# | Out-Null, which discards normal output but not warnings.
#
#   .\sync.ps1 -TriageDecide '<path under .claude>' -As skip|backup -Reason '<why>'
#       records one decision (no sync). 'backup' is for one plainly named file shared across PCs,
#       stored on Drive and in git under triage-backup\; it is refused for credential-like or
#       ignore-listed names, files over 1 MB, or content that matches hooks\secret-patterns.json.
#       Hook code takes no decision (it is always backed up). A file beside the .claude folder is
#       named '..\.claude<rest>' and can only be skipped.
#   Every push re-checks hook code and Claude-chosen backups: a file over 1 MB or matching a secret
#   pattern is left out of that push with a warning.
#   .\sync.ps1 -CoverageOnly    runs the triage and prints the backup set; changes no file (it does
#                               take the sync lock, so it waits while another sync runs).
#   -RootOverride <dir>         tests only: <dir>\claude, <dir>\drive and <dir>\git replace the real paths.
#
# Exit codes:
#   0 = success (sync completed; a subordinate git push warning does not change this -- GEN-237)
#   1 = -TriageDecide refused the decision (nothing recorded)
#   5 = secret-scan abort, OR the secret-patterns file is missing/unreadable (fail-closed)
#   6 = gave up waiting for the sync lock (another sync is running); NOTHING was synced -- treat like a failure

[CmdletBinding(DefaultParameterSetName = 'Sync')]
param(
    [Parameter(Mandatory = $true, ParameterSetName = 'Sync')]
    [ValidateSet("To-Claude", "From-Claude")]
    [string]$Direction,

    [Parameter(ParameterSetName = 'Sync')]
    [string]$CommitMessage = "",

    [Parameter(ParameterSetName = 'Sync')]
    [switch]$DiscardLocal,

    [Parameter(Mandatory = $true, ParameterSetName = 'Coverage')]
    [switch]$CoverageOnly,

    [Parameter(Mandatory = $true, ParameterSetName = 'Triage')]
    [string]$TriageDecide,

    [Parameter(Mandatory = $true, ParameterSetName = 'Triage')]
    [ValidateSet("skip", "backup")]
    [string]$As,

    [Parameter(Mandatory = $true, ParameterSetName = 'Triage')]
    [string]$Reason,

    [string]$RootOverride = ""
)

if ($RootOverride) {
    $DriveBase   = Join-Path $RootOverride "drive"
    $ClaudeBase  = Join-Path $RootOverride "claude"
    $GitHistory  = Join-Path $RootOverride "git"
} else {
    $DriveBase   = "G:\My Drive\AI Projects\_Tooling\Claude"
    $ClaudeBase  = "C:\Users\Erez\.claude"
    $GitHistory  = "C:\Users\Erez\.claude-git-history"
}
$MemoryBase  = Join-Path $ClaudeBase "projects\C--Users-Erez\memory"
$SyncLockFile = Join-Path $ClaudeBase "sync.lock"
$BaselineFile = Join-Path $ClaudeBase "sync-baseline.json"
$TriageFileName = "backup-triage.json"

$FileMap = @(
    @{ Drive = Join-Path $DriveBase "CLAUDE.md";                   Claude = Join-Path $ClaudeBase "CLAUDE.md";    Git = Join-Path $GitHistory "CLAUDE.md" },
    @{ Drive = Join-Path $DriveBase "settings.json";               Claude = Join-Path $ClaudeBase "settings.json"; Git = Join-Path $GitHistory "settings.json" },
    @{ Drive = Join-Path $DriveBase "settings.local.json";         Claude = Join-Path $ClaudeBase "settings.local.json"; Git = Join-Path $GitHistory "settings.local.json" },
    @{ Drive = Join-Path $DriveBase ".settings-health-keep.json";  Claude = Join-Path $ClaudeBase ".settings-health-keep.json"; Git = Join-Path $GitHistory ".settings-health-keep.json" },
    @{ Drive = Join-Path $DriveBase "hooks\secret-patterns.json";  Claude = Join-Path $ClaudeBase "hooks\secret-patterns.json"; Git = Join-Path $GitHistory "hooks\secret-patterns.json" }
)

# Whole-folder syncs -- every file under these dirs is backed up, so new skills/agents are
# covered automatically with no per-file list to maintain. Additive: new/changed files are
# mirrored; files deleted locally are NOT removed from the backup (safer -- no accidental loss).
$DirMap = @(
    @{ Drive = Join-Path $DriveBase "skills"; Claude = Join-Path $ClaudeBase "skills"; Git = Join-Path $GitHistory "skills" },
    @{ Drive = Join-Path $DriveBase "agents"; Claude = Join-Path $ClaudeBase "agents"; Git = Join-Path $GitHistory "agents" },
    @{ Drive = Join-Path $DriveBase "commands"; Claude = Join-Path $ClaudeBase "commands"; Git = Join-Path $GitHistory "commands" },
    @{ Drive = Join-Path $DriveBase "hooks\tests"; Claude = Join-Path $ClaudeBase "hooks\tests"; Git = Join-Path $GitHistory "hooks\tests" },
    @{ Drive = Join-Path $DriveBase "hooks\refs"; Claude = Join-Path $ClaudeBase "hooks\refs"; Git = Join-Path $GitHistory "hooks\refs" },
    @{ Drive = Join-Path $DriveBase "memory";  Claude = $MemoryBase;                        Git = Join-Path $GitHistory "memory" },
    @{ Drive = Join-Path $DriveBase "scripts"; Claude = Join-Path $ClaudeBase "scripts";    Git = Join-Path $GitHistory "scripts" }
)

# ---- Per-project memory backup (GEN-428) -----------------------------------
# The harness gives each project its own memory store at projects\<slug>\memory\,
# but the static DirMap entry above backs up only the shared un-suffixed store
# (projects\C--Users-Erez\memory). Enumerate every OTHER project's memory dir and
# append a DirMap entry mapping it to its own project-memory\<slug>\ area on Drive
# and in git-history, so no project overwrites another. Backup-only; additive;
# the shared store keeps its own entry above and is skipped here to avoid a
# duplicate second copy. Reuses the existing Get-AllManagedFiles walk unchanged.
$SharedProjectName = Split-Path (Split-Path $MemoryBase -Parent) -Leaf   # single source of truth for the skip
$ProjectsRoot = Join-Path $ClaudeBase "projects"
if (Test-Path -LiteralPath $ProjectsRoot) {
    foreach ($proj in (Get-ChildItem -LiteralPath $ProjectsRoot -Directory -Force)) {
        if ($proj.Name -eq $SharedProjectName) { continue }   # shared store: already covered by the static entry
        $projMem = Join-Path $proj.FullName "memory"
        if (-not (Test-Path -LiteralPath $projMem)) { continue }   # skip projects with no memory dir

        $projDrive = Join-Path $DriveBase   (Join-Path "project-memory" $proj.Name)
        $projGit   = Join-Path $GitHistory  (Join-Path "project-memory" $proj.Name)

        # Windows MAX_PATH guard: the copy loop below has no per-entry try/catch, so a
        # target path over ~260 chars would throw and abort the ENTIRE sync (the very
        # silent-backup-failure this change exists to prevent). Skip-with-warning any
        # project whose longest projected target would approach the limit, rather than
        # let one long path kill the whole run. Compute against the deepest existing
        # memory file's relative path on both mirror roots (Drive + Git).
        # NB: do NOT suppress enumeration errors here. On PS 5.1 (non-long-path-aware),
        # recursing into an already-over-MAX_PATH subdir throws PathTooLongException per
        # item; swallowing it would drop exactly the deepest files that decide the guard,
        # under-count the length, pass the check, and then let the unguarded copy abort
        # the whole sync. So if the tree can't be fully measured, fail SAFE: skip the
        # project with a warning rather than hand an unmeasurable tree to the copy loop.
        $longestRel = 0
        $enumErrors = $null
        $memFiles = Get-ChildItem -LiteralPath $projMem -Recurse -File -Force -ErrorAction SilentlyContinue -ErrorVariable enumErrors
        if ($enumErrors -and $enumErrors.Count -gt 0) {
            Write-Warning "PROJECT-MEMORY: skipping '$($proj.Name)' -- its memory tree could not be fully read ($($enumErrors.Count) enumeration error(s), possibly a path already over the Windows MAX_PATH limit); back up this project's memory manually. (GEN-428)"
            continue
        }
        foreach ($mf in $memFiles) {
            $rel = $mf.FullName.Substring($projMem.Length).TrimStart('\')
            if ($rel.Length -gt $longestRel) { $longestRel = $rel.Length }
        }
        $projectedDrive = $projDrive.Length + 1 + $longestRel
        $projectedGit   = $projGit.Length   + 1 + $longestRel
        $projected = [Math]::Max($projectedDrive, $projectedGit)
        if ($projected -gt 248) {
            Write-Warning "PROJECT-MEMORY: skipping '$($proj.Name)' -- projected backup path length ($projected) approaches the Windows MAX_PATH limit; back up this project's memory manually or shorten the path. (GEN-428)"
            continue
        }

        $DirMap += @{ Drive = $projDrive; Claude = $projMem; Git = $projGit }
    }
}

# ---- Sync-lock helpers (GEN-353) -------------------------------------------
# Own lock, separate from update-config.ps1's config lock (see header comment for
# why: update-config.ps1 holds the config lock while calling into this script, so
# sharing one lock would deadlock on reentry). Acquired once at the top of the
# script for whichever Direction is running; released in the top-level finally.
function Enter-SyncLock {
    param([string]$LockPath, [int]$MaxWaitSeconds = 120)
    $maxWaitSeconds = $MaxWaitSeconds
    $pollMs = 1000
    $elapsed = 0
    $lastHeartbeat = 0
    while ($true) {
        try {
            $stream = [System.IO.File]::Open($LockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
            return $stream
        } catch [System.IO.IOException] {
            if ($elapsed -ge $maxWaitSeconds) {
                return $null
            }
            if ($elapsed -eq 0 -or ($elapsed - $lastHeartbeat) -ge 10) {
                # Write-Host, not Write-Output: this function's return value ($stream) is
                # captured by the caller, and ANY pipeline output from inside a PowerShell
                # function -- not just its `return` value -- becomes part of that captured
                # result. Write-Output here would silently corrupt $lockStream into an
                # array/string once a heartbeat line fires (found via sandbox testing).
                Write-Host "Waiting for sync lock (another sync is running)... ${elapsed}s elapsed"
                $lastHeartbeat = $elapsed
            }
            Start-Sleep -Milliseconds $pollMs
            $elapsed += ($pollMs / 1000)
        }
    }
}

# ---- Baseline-manifest helpers (GEN-355) -----------------------------------
function Get-FileHashSafe {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try {
        return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    } catch {
        return $null
    }
}

function Load-Baseline {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return @{} }
    try {
        $raw = Get-Content -Raw -LiteralPath $Path -Encoding UTF8
        if (-not $raw) { return @{} }
        $obj = $raw | ConvertFrom-Json
        $ht = @{}
        if ($obj) {
            foreach ($prop in $obj.PSObject.Properties) { $ht[$prop.Name] = $prop.Value }
        }
        return $ht
    } catch {
        Write-Warning "SYNC-BASELINE: could not read/parse $Path ($($_.Exception.Message)) -- treating as empty (conservative: every file will be evaluated as having no baseline)."
        return @{}
    }
}

function Save-Baseline {
    param([string]$Path, [hashtable]$Baseline)
    try {
        ($Baseline | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath $Path -Encoding UTF8
    } catch {
        Write-Warning "SYNC-BASELINE: failed to save $Path ($($_.Exception.Message)); baseline state may be stale next run."
    }
}

# Enumerate every file under the FileMap + DirMap sets, keyed by the local (Claude) path.
function Get-AllManagedFiles {
    $all = @()
    foreach ($pair in $FileMap) {
        $all += [PSCustomObject]@{ Claude = $pair.Claude; Drive = $pair.Drive; Git = $pair.Git }
    }
    foreach ($pair in $DirMap) {
        if (Test-Path -LiteralPath $pair.Claude) {
            foreach ($f in (Get-ChildItem -LiteralPath $pair.Claude -Recurse -File -Force)) {
                $rel = $f.FullName.Substring($pair.Claude.Length).TrimStart('\')
                $all += [PSCustomObject]@{
                    Claude = $f.FullName
                    Drive  = Join-Path $pair.Drive $rel
                    Git    = Join-Path $pair.Git $rel
                }
            }
        }
        # Also walk the Drive side, in case a file exists on Drive but not yet locally.
        if (Test-Path -LiteralPath $pair.Drive) {
            foreach ($f in (Get-ChildItem -LiteralPath $pair.Drive -Recurse -File -Force)) {
                $rel = $f.FullName.Substring($pair.Drive.Length).TrimStart('\')
                $localPath = Join-Path $pair.Claude $rel
                if (-not (Test-Path -LiteralPath $localPath)) {
                    $all += [PSCustomObject]@{
                        Claude = $localPath
                        Drive  = $f.FullName
                        Git    = Join-Path $pair.Git $rel
                    }
                }
            }
        }
    }
    return $all
}

# Non-destructive To-Claude pull (GEN-355). Returns nothing; writes files + updates $Baseline in place.
function Invoke-NonDestructivePull {
    param([hashtable]$Baseline, [bool]$Discard)

    $entries = Get-AllManagedFiles
    $overwrote = @()
    $kept = @()
    $conflicts = @()

    foreach ($e in $entries) {
        $driveHash = Get-FileHashSafe -Path $e.Drive
        if ($null -eq $driveHash) {
            # Nothing on Drive for this file (shouldn't normally happen for a To-Claude pull
            # since Get-AllManagedFiles only includes files seen on at least one side) -- skip.
            continue
        }
        $localHash = Get-FileHashSafe -Path $e.Claude
        $baselineHash = $Baseline[$e.Claude]

        $dstDir = Split-Path $e.Claude -Parent
        if (-not (Test-Path -LiteralPath $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }

        if ($Discard) {
            Copy-Item -LiteralPath $e.Drive -Destination $e.Claude -Force
            $Baseline[$e.Claude] = $driveHash
            continue
        }

        if ($null -eq $localHash) {
            # File doesn't exist locally yet -- safe to bring it down.
            Copy-Item -LiteralPath $e.Drive -Destination $e.Claude -Force
            $Baseline[$e.Claude] = $driveHash
            continue
        }

        if ($localHash -eq $driveHash) {
            # Already in sync -- just make sure the baseline reflects it.
            $Baseline[$e.Claude] = $driveHash
            continue
        }

        if ($null -eq $baselineHash) {
            # No baseline entry (first run / brand-new file) and local != Drive: conservative,
            # never destroy an unknown local state.
            $kept += $e.Claude
            Write-Warning "SYNC-PULL: no baseline for '$($e.Claude)' and it differs from Drive -- kept local, did NOT overwrite. (First sync after this file appeared; baseline seeded on next successful push.)"
            continue
        }

        $localMatchesBaseline = ($localHash -eq $baselineHash)
        $driveMatchesBaseline = ($driveHash -eq $baselineHash)

        if ($localMatchesBaseline -and -not $driveMatchesBaseline) {
            # Local unedited since last sync; Drive has a newer copy -- normal freshness pull.
            Copy-Item -LiteralPath $e.Drive -Destination $e.Claude -Force
            $Baseline[$e.Claude] = $driveHash
            $overwrote += $e.Claude
        } elseif (-not $localMatchesBaseline -and $driveMatchesBaseline) {
            # In-session local edit, Drive unchanged -- keep local, do NOT touch baseline
            # (so the next pull still recognizes this file as unpushed).
            $kept += $e.Claude
            Write-Warning "SYNC-PULL: kept local (edited this session, not yet pushed): $($e.Claude)"
        } elseif (-not $localMatchesBaseline -and -not $driveMatchesBaseline) {
            # Both sides changed since last sync -- keep local (it is not lost: Drive's
            # version remains on Drive + git history), but warn loudly.
            $conflicts += $e.Claude
            Write-Warning "SYNC-PULL CONFLICT -- kept local; Drive version differs too (Drive's copy is still safe on Drive + git history): $($e.Claude)"
        } else {
            # local == baseline == ... already handled above by the localHash -eq driveHash
            # check; this branch is unreachable in practice but kept for completeness.
            $Baseline[$e.Claude] = $driveHash
        }
    }

    if ($overwrote.Count -gt 0)  { Write-Output "Refreshed from Drive (unedited locally): $($overwrote.Count) file(s)." }
    if ($kept.Count -gt 0)       { Write-Output "Kept local, not yet pushed: $($kept.Count) file(s)." }
    if ($conflicts.Count -gt 0)  { Write-Output "CONFLICTS (kept local; see warnings above): $($conflicts.Count) file(s)." }
}

# ---- Git-history job helpers (GEN-353) -------------------------------------
# Each git network operation (pull, push) runs in its own background job so it can
# be bounded by a timeout without hanging the whole script/session. The job is
# self-contained: everything it needs is passed via -ArgumentList, and it returns
# git's own exit code (and captured output) as job output -- never rely on ambient
# $LASTEXITCODE across a job boundary, since each job runs in its own runspace.
function Invoke-GitJob {
    param([string]$RepoPath, [string[]]$GitArgs, [int]$TimeoutSeconds = 90)

    $job = Start-Job -ScriptBlock {
        param($repo, $gitArgs)
        Set-Location -LiteralPath $repo
        $output = & git @gitArgs 2>&1 | Out-String
        [PSCustomObject]@{ ExitCode = $LASTEXITCODE; Output = $output }
    } -ArgumentList $RepoPath, $GitArgs

    $finished = Wait-Job -Job $job -Timeout $TimeoutSeconds
    if (-not $finished) {
        Write-Warning "GIT-TIMEOUT: 'git $($GitArgs -join ' ')' did not finish within ${TimeoutSeconds}s -- stopping it."
        Stop-Job -Job $job -ErrorAction SilentlyContinue
        Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
        Remove-OrphanedGitProcess -RepoPath $RepoPath
        Repair-StaleIndexLock -RepoPath $RepoPath -Context "after timing out '$($GitArgs -join ' ')'"
        return [PSCustomObject]@{ TimedOut = $true; ExitCode = -1; Output = "" }
    }

    $result = Receive-Job -Job $job
    Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
    return [PSCustomObject]@{ TimedOut = $false; ExitCode = $result.ExitCode; Output = $result.Output }
}

# Stop-Job stops the job's own runspace but does not reliably terminate a native
# child process (git.exe) it launched -- kill any git.exe whose command line
# references this specific repo path before touching index.lock, so we never
# delete a lock a still-live process could be writing to.
function Remove-OrphanedGitProcess {
    param([string]$RepoPath)
    try {
        $marker = $RepoPath -replace '\\', '\\\\'
        $procs = Get-CimInstance Win32_Process -Filter "Name = 'git.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -and $_.CommandLine -match [regex]::Escape($RepoPath) }
        foreach ($p in $procs) {
            Write-Warning "GIT-TIMEOUT: killing orphaned git.exe (PID $($p.ProcessId)) still referencing $RepoPath"
            Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        }
    } catch {
        Write-Warning "GIT-TIMEOUT: orphan-process cleanup failed ($($_.Exception.Message)); a stray git.exe may remain."
    }
}

# Defensive check: if index.lock exists and no git.exe is currently running against
# this repo, it's a leftover from a previously interrupted run (a crash between
# Stop-Job and cleanup, or a killed process this script didn't clean up) -- remove
# it so the next git operation (including the "git add -A" self-heal) isn't wedged.
function Repair-StaleIndexLock {
    param([string]$RepoPath, [string]$Context = "routine check")
    $lockPath = Join-Path $RepoPath ".git\index.lock"
    if (-not (Test-Path -LiteralPath $lockPath)) { return }
    try {
        $stillRunning = Get-CimInstance Win32_Process -Filter "Name = 'git.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -and $_.CommandLine -match [regex]::Escape($RepoPath) }
        if ($stillRunning) {
            Write-Warning "GIT-LOCK: index.lock exists and a git.exe is still running against $RepoPath -- leaving it in place."
            return
        }
        Remove-Item -LiteralPath $lockPath -Force -ErrorAction Stop
        Write-Warning "GIT-LOCK: removed stale index.lock ($Context) -- $lockPath"
    } catch {
        Write-Warning "GIT-LOCK: failed to remove stale index.lock ($($_.Exception.Message)); a manual 'del `"$lockPath`"' may be needed."
    }
}

# ---- Secret patterns (GEN-233; shared by the boundary scan and GEN-460 triage) ----
# Throws if the shared patterns file is missing, unreadable or empty -- callers fail closed.
function Get-SecretPatternDefs {
    $patternsFile = Join-Path $ClaudeBase "hooks\secret-patterns.json"
    if (-not (Test-Path -LiteralPath $patternsFile)) { throw "patterns file not found: $patternsFile" }
    $defs = Get-Content -Raw -LiteralPath $patternsFile -Encoding UTF8 | ConvertFrom-Json
    if (-not $defs) { throw "patterns file is empty" }
    return $defs
}

# Returns the name of the first pattern that matches $Text, or $null.
function Find-SecretMatch {
    param([string]$Text, $Defs)
    if (-not $Text) { return $null }
    foreach ($def in $Defs) {
        if ([regex]::Match($Text, $def.regex).Success) { return [string]$def.name }
    }
    return $null
}

# ---- Backup triage decisions (GEN-460) -------------------------------------
# backup-triage.json remembers how each path outside the fixed backup set was sorted, so each one is
# decided -- and reported -- once. It is shared across PCs but deliberately NOT in $FileMap: every run
# merges the local and Drive copies (rules in Merge-TriageMaps: two of Claude's decisions -> the newer
# wins; otherwise keep-out beats backup unless Claude's backup is newer than a rule skip; same kind ->
# newer wins) and writes the merged result locally, and From-Claude also writes it to Drive, so
# neither PC's decisions are lost and the hash-based pull never reports it as a conflict.

function ConvertTo-TriageKey {
    param([string]$RelPath)
    return ($RelPath -replace '/', '\').TrimStart('\').ToLowerInvariant()
}

function Test-IsHookCodeName {
    param([string]$Name)
    return (($Name -like '*.js' -or $Name -like '*.ps1') -and $Name -notlike 'tmp_*' -and $Name -notlike '*.tmp*')
}

function Test-MatchesAnyPattern {
    param([string]$Name, [string[]]$Patterns)
    foreach ($p in $Patterns) { if ($Name -like $p) { return $true } }
    return $false
}

# Reads one copy of the decisions file. Ok=$false means it exists but could not be parsed: the caller
# treats it as empty and must NOT rewrite it (a rewrite would erase decisions it could not read).
function Read-TriageFile {
    param([string]$Path, [string]$Label)
    $result = @{ Ok = $true; Map = @{}; Raw = $null }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $result }
    try {
        $raw = [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)
        $result.Raw = $raw
        if ($raw.Trim()) {
            $obj = $raw | ConvertFrom-Json
            if ($null -eq $obj -or $null -eq $obj.PSObject.Properties['decisions']) { throw "no 'decisions' list" }
            foreach ($d in @($obj.decisions)) {
                if ($null -eq $d -or -not $d.path -or @('skip', 'backup') -notcontains [string]$d.decision) { throw "malformed entry" }
                $key = ConvertTo-TriageKey ([string]$d.path)
                # A path that normalizes to nothing, or carries a drive/stream colon, is never one this
                # script wrote; reject the file rather than let a later path call throw mid-sync.
                if (-not $key -or $key.Contains(':')) { throw "entry with an unusable path" }
                # PowerShell 7's ConvertFrom-Json turns ISO dates into DateTime; keep the ISO string form
                # the newest-wins comparisons in Merge-TriageMaps rely on.
                if ($d.date -is [datetime]) { $d.date = $d.date.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }
                $result.Map[$key] = $d
            }
        }
    } catch {
        $result.Ok = $false
        $result.Map = @{}
        Write-Warning "BACKUP-TRIAGE: could not read the $Label decisions file $Path ($($_.Exception.Message)) -- treating it as empty and NOT rewriting it. Fix or delete that file, then sync again."
    }
    return $result
}

function Merge-TriageMaps {
    param([hashtable]$First, [hashtable]$Second)
    $out = @{}
    foreach ($k in $First.Keys) { $out[$k] = $First[$k] }
    foreach ($k in $Second.Keys) {
        if (-not $out.ContainsKey($k)) { $out[$k] = $Second[$k]; continue }
        $x = $out[$k]
        $y = $Second[$k]
        $xKeepsOut = ([string]$x.decision -ne 'backup')
        $yKeepsOut = ([string]$y.decision -ne 'backup')
        $bothClaude = ([string]$x.decidedBy -eq 'claude' -and [string]$y.decidedBy -eq 'claude')
        if ($xKeepsOut -ne $yKeepsOut -and -not $bothClaude) {
            # One says keep it out, the other says back it up, and they were not both Claude's explicit
            # choices: keeping out wins (the safe side), except that Claude's NEWER 'backup' overrides an
            # older automatic rule skip.
            $out[$k] = if ($xKeepsOut) { $x } else { $y }
            $skipD = $out[$k]
            $backupD = if ($xKeepsOut) { $y } else { $x }
            if ([string]$skipD.decidedBy -eq 'rule' -and [string]$backupD.decidedBy -eq 'claude' -and [string]$backupD.date -gt [string]$skipD.date) {
                $out[$k] = $backupD
            }
            continue
        }
        # Same kind of decision, or two explicit Claude decisions: the newer one wins -- otherwise a PC
        # still holding Claude's old 'skip' would silently undo a later 'backup' made on the other PC.
        # (A 'backup' that wins here is still re-checked on every run before anything is pushed.)
        if ([string]$y.date -gt [string]$x.date) { $out[$k] = $y }
    }
    return $out
}

# Why a 'backup' decision for $Rel must not be pushed to Drive and git, or $null if it may.
# Used both when Claude records the decision and on every run that rebuilds the backup set from
# the merged decisions file -- whose Drive copy anything with Drive access could have edited.
function Get-BackupRefusal {
    param([string]$Rel)
    if (-not $Rel) { return "the path is empty" }
    if (-not ($Rel -match '^[^\\]+$' -or $Rel -match '^hooks\\[^\\]+$')) { return "only a top-level file or a file directly in hooks\ can be added" }
    # Plain names only: no wildcard characters ([ ] * ?), which a -Path copy would expand into OTHER
    # files, and no trailing dot or space, which Windows strips on open so the name checks below would
    # be matching a different name than the file actually read.
    $leaf = $Rel.Split('\')[-1]
    if ($leaf -notmatch '^[A-Za-z0-9._ -]+$' -or $leaf -match '[. ]$' -or $leaf -eq '.' -or $leaf -eq '..') {
        return "the name must be plain letters, digits, dot, dash, underscore or space, not ending in a dot or space"
    }
    if ($Rel -match '^hooks\\' -and (Test-IsHookCodeName $leaf)) { return "hook code is backed up automatically" }
    if ($Rel -ieq $TriageFileName) { return "the decisions file is synced by its own merge" }
    foreach ($pat in @('.credentials*', '*credential*', '*token*', '*secret*', '*password*', '*.key', '*.pem', '*.pfx', '*.p12')) {
        if ($leaf -like $pat) { return "its name looks like a credential file ($pat)" }
    }
    if (Test-MatchesAnyPattern $leaf $BackupIgnorePatterns) { return "its name is on the per-machine ignore list" }
    $full = Join-Path $ClaudeBase $Rel
    if ((Test-Path -LiteralPath $full -PathType Leaf) -and (Get-Item -LiteralPath $full).Length -gt 1MB) { return "it is over 1 MB" }
    return $null
}

function ConvertTo-TriageJson {
    param([hashtable]$Map)
    $list = @()
    foreach ($k in ($Map.Keys | Sort-Object)) {
        $d = $Map[$k]
        $list += [PSCustomObject][ordered]@{
            path      = [string]$d.path
            decision  = [string]$d.decision
            reason    = [string]$d.reason
            decidedBy = [string]$d.decidedBy
            date      = [string]$d.date
        }
    }
    $doc = [PSCustomObject][ordered]@{
        note      = "Backup-triage decisions for sync.ps1 (GEN-460). Change with: sync.ps1 -TriageDecide '<path>' -As skip|backup -Reason '<why>'"
        decisions = $list
    }
    return ($doc | ConvertTo-Json -Depth 5)
}

# Writes via a temp file + replace, so a crash mid-write never leaves a half-written decisions file.
# The temp name matches the '*.json.tmp.*' ignore pattern, so a leftover is never itself flagged.
function Write-TriageFileAtomic {
    param([string]$Path, [string]$Text)
    $dir = Split-Path $Path -Parent
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $tmp = "$Path.tmp." + [guid]::NewGuid().ToString('N')
    try {
        [IO.File]::WriteAllText($tmp, $Text, (New-Object System.Text.UTF8Encoding $false))
        if (Test-Path -LiteralPath $Path) {
            [IO.File]::Replace($tmp, $Path, [NullString]::Value)
        } else {
            [IO.File]::Move($tmp, $Path)
        }
    } finally {
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    }
}

# Saves the merged decisions: to the local file, and to Drive on From-Claude -- never over a copy
# that could not be read (its decisions would be lost). Writes only when the content actually
# changed, so a quiet run touches nothing. Returns $false if the local save failed.
function Save-TriageState {
    param([bool]$ToDrive)
    if (-not $TriageLocal.Ok) { return $false }
    if ($Triage.Count -eq 0 -and $null -eq $TriageLocal.Raw -and $null -eq $TriageDrive.Raw) { return $true }
    $text = ConvertTo-TriageJson -Map $Triage
    try {
        if ($text -ne $TriageLocal.Raw) { Write-TriageFileAtomic -Path $TriageLocalPath -Text $text }
    } catch {
        Write-Warning "BACKUP-TRIAGE: could not save $TriageLocalPath ($($_.Exception.Message)); this run's decisions will be made again next run."
        return $false
    }
    if ($ToDrive -and $TriageDrive.Ok -and $text -ne $TriageDrive.Raw) {
        try {
            if (-not (Test-Path -LiteralPath $DriveBase)) { throw "Drive folder not found: $DriveBase" }
            Copy-Item -LiteralPath $TriageLocalPath -Destination $TriageDrivePath -Force
        } catch {
            Write-Warning "BACKUP-TRIAGE: could not copy the decisions file to Drive ($($_.Exception.Message)); the next From-Claude sync retries."
        }
    }
    return $true
}

# The command a session should run to record a decision (named in every NEEDED warning).
function Get-TriageCommandText {
    param([string]$RelPath, [string]$Choices)
    return "& '" + $PSCommandPath + "' -TriageDecide '" + $RelPath + "' -As " + $Choices + " -Reason '<why, in plain words with no quotes or apostrophes>'"
}

function Write-TriageNeeded {
    param([string]$RelPath, [string]$What, [string]$Choices, [bool]$Folder = $false)
    $folderNote = if ($Folder) { " (A folder that should be backed up needs a sync.ps1 change; raise that with Erez instead.)" } else { "" }
    Write-Warning ("BACKUP-TRIAGE NEEDED: '" + $RelPath + "' (" + $What + ") is new and not in the backup set. " +
        "Claude: find what wrote it (file times, session logs, mentions in our hooks/scripts/skills), decide, record it with: " +
        (Get-TriageCommandText -RelPath $RelPath -Choices $Choices) +
        " -- then tell Erez in one line what you decided and why. Ask Erez only if the evidence cannot settle it." + $folderNote)
}

# GEN-460 rule skips: record (unless a dry run) and report once.
function Add-RuleSkip {
    param([hashtable]$Decisions, [bool]$Record, [string]$RelPath, [string]$Why)
    if ($Record) {
        $Decisions[(ConvertTo-TriageKey $RelPath)] = [PSCustomObject]@{
            path = $RelPath; decision = 'skip'; reason = $Why; decidedBy = 'rule'
            date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        }
        Write-Warning "BACKUP-TRIAGE: skipped '$RelPath' -- $Why. Recorded in $TriageFileName; not shown again."
    } else {
        Write-Warning "BACKUP-TRIAGE (dry run): would skip '$RelPath' -- $Why."
    }
}

# -TriageDecide: validate one decision, then record it. Returns the process exit code (0 or 1).
function Invoke-TriageDecide {
    param([string]$RawPath, [string]$Decision, [string]$Why)
    $refuse = { param($msg) Write-Error "BACKUP-TRIAGE: refused -- $msg Nothing was recorded."; return 1 }

    if (-not $Why -or $Why -match '[^\x20-\x7E]' -or $Why.Length -gt 300) {
        return (& $refuse "-Reason must be plain ASCII text, 1-300 characters.")
    }
    $rel = ([string]$RawPath).Trim() -replace '/', '\'
    $rooted = $true
    try { $rooted = [IO.Path]::IsPathRooted($rel) } catch { $rooted = $true }   # throws on < > | -- treat as unusable
    if (-not $rel -or $rel.Contains(':') -or $rel.StartsWith('\') -or $rooted) {
        return (& $refuse "'$RawPath' must be a path relative to the .claude folder.")
    }
    if (-not $TriageLocal.Ok) {
        return (& $refuse "the local $TriageFileName could not be read; fix or delete it first.")
    }
    $key = ConvertTo-TriageKey $rel
    $prior = $Triage[$key]

    if ($rel.StartsWith('..\')) {
        # A file BESIDE the .claude folder (the sibling class Test-BackupCoverage watches).
        $name = $rel.Substring(3)
        if ($name -notmatch '^\.claude[^\\]+$') { return (& $refuse "a path outside .claude must be '..\.claude<name>' (one file beside the folder).") }
        if ($Decision -ne 'skip') { return (& $refuse "a file beside the .claude folder can only be skipped.") }
        if (-not (Test-Path -LiteralPath (Join-Path (Split-Path $ClaudeBase -Parent) $name) -PathType Leaf)) { return (& $refuse "'$rel' does not exist.") }
    } else {
        foreach ($seg in $rel.Split('\')) {
            if ($seg -eq '' -or $seg -eq '.' -or $seg -eq '..') { return (& $refuse "'$RawPath' has an empty, '.' or '..' part.") }
            # Windows strips a trailing dot or space on open, so the check below would find a file whose
            # real name differs from the key recorded, and the coverage check would never match it.
            if ($seg -match '[. ]$') { return (& $refuse "'$RawPath' has a part ending in a dot or space; use the file's real name.") }
        }
        $full = Join-Path $ClaudeBase $rel
        if ($key -eq (ConvertTo-TriageKey $TriageFileName)) { return (& $refuse "the decisions file itself is backed up already.") }
        foreach ($p in $StaticBackupFiles) { if ($p -ieq $full) { return (& $refuse "'$rel' is already in the fixed backup list.") } }
        foreach ($pair in $DirMap) {
            if ($full -ieq $pair.Claude -or $full -like (Join-Path $pair.Claude '*')) { return (& $refuse "'$rel' is inside a folder that is backed up whole.") }
        }
        $isHookCode = ($rel -match '^hooks\\[^\\]+$') -and (Test-IsHookCodeName (Split-Path $rel -Leaf))

        if ($isHookCode) {
            return (& $refuse "hook code (hooks\<name>.js or .ps1) is always backed up and takes no decision; to remove a hook for good, delete it on every PC and on Drive. A scratch script kept out of the backup belongs outside hooks\ or is named tmp_*.")
        } else {
            if (-not (Test-Path -LiteralPath $full)) { return (& $refuse "'$rel' does not exist under $ClaudeBase.") }
            if ($Decision -eq 'skip') {
                if ($rel.Contains('\') -and -not ($rel -match '^hooks\\[^\\]+$')) {
                    return (& $refuse "only a top-level item or a file directly in hooks\ is triaged; '$rel' is deeper.")
                }
            } else {
                # backup: one file, shared across PCs (stored on Drive and in git under triage-backup\, so
                # it can never land on a tooling file). Every refusal below keeps something private,
                # per-machine or oversized out of Drive and git.
                if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { return (& $refuse "'backup' is for a single file; a folder can only be skipped.") }
                $why = Get-BackupRefusal -Rel $rel
                if ($why) { return (& $refuse "'$rel' cannot be backed up: $why.") }
                try { $defs = Get-SecretPatternDefs } catch { return (& $refuse "the secret patterns could not be loaded ($($_.Exception.Message)), so the file cannot be checked.") }
                try { $text = [IO.File]::ReadAllText($full, [Text.Encoding]::UTF8) } catch { return (& $refuse "'$rel' could not be read for the secret check.") }
                $hit = Find-SecretMatch -Text $text -Defs $defs
                if ($hit) { return (& $refuse "'$rel' contains a value matching the '$hit' secret pattern.") }
            }
        }
    }

    $Triage[$key] = [PSCustomObject]@{
        path = $rel; decision = $Decision; reason = $Why; decidedBy = 'claude'
        date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    }
    if (-not (Save-TriageState -ToDrive $true)) { return (& $refuse "the decisions file could not be saved (see the warning above).") }
    $was = if ($prior) { " (replaces the earlier '" + [string]$prior.decision + "' decision)" } else { "" }
    # Write-Host, not Write-Output: anything written to the output stream here would become part of
    # this function's return value, which the caller uses as the exit code.
    Write-Host "BACKUP-TRIAGE: recorded '$rel' as $Decision$was -- $Why"
    return 0
}

# ==============================================================================
# Main
# ==============================================================================

$SyncLockMaxWaitSeconds = 120
$lockStream = Enter-SyncLock -LockPath $SyncLockFile -MaxWaitSeconds $SyncLockMaxWaitSeconds
if ($null -eq $lockStream) {
    Write-Error "SYNC-LOCK: gave up waiting for the sync lock after ${SyncLockMaxWaitSeconds}s -- another sync is still running. Nothing was synced."
    exit 6
}

try {

# ---- Secret scan at the backup boundary (GEN-233) --------------------------
# Before any file leaves the machine (Drive copy or git push), scan the one file
# that can receive a raw secret via an automated path: settings.local.json (an
# "always allow" can embed a token in a command string). Patterns come from the
# shared secret-patterns.json the hook also uses. Fail CLOSED: if that file is
# missing/malformed, abort -- never push unscanned. On a match, abort BEFORE the
# first Copy-Item so nothing reaches Drive or git. To recover from a bad patterns
# file, fix/recreate secret-patterns.json, then sync again.
if ($Direction -eq "From-Claude") {
    $patternsFile = Join-Path $ClaudeBase "hooks\secret-patterns.json"
    $scanTarget   = Join-Path $ClaudeBase "settings.local.json"

    $patternDefs = $null
    try {
        if (-not (Test-Path $patternsFile)) { throw "patterns file not found: $patternsFile" }
        $patternDefs = Get-Content -Raw -Path $patternsFile -Encoding UTF8 | ConvertFrom-Json
        if (-not $patternDefs) { throw "patterns file is empty" }
    } catch {
        Write-Error "SECRET-SCAN ABORT: cannot load $patternsFile ($($_.Exception.Message)). Sync refused (fail-closed). Recreate the patterns file, then sync again."
        exit 5
    }

    if (Test-Path $scanTarget) {
        $scanText = Get-Content -Raw -Path $scanTarget -Encoding UTF8
        foreach ($def in $patternDefs) {
            $m = [regex]::Match($scanText, $def.regex)
            if ($m.Success) {
                $masked = $m.Value.Substring(0, [Math]::Min(4, $m.Value.Length)) + "****"
                Write-Error "SECRET-SCAN ABORT: a value matching '$($def.name)' ($masked) was found in settings.local.json. Sync refused -- nothing sent to Drive or git. Remove the offending allow entry with update-config.ps1 -Op remove-allow, then sync again."
                exit 5
            }
        }
    }
}

# Per-machine / ephemeral / harness-managed -- deliberately not backed up. One list for
# files and folders alike: Claude Code writes some of these names as either (e.g. its
# '*.lock' lock folders, 2026-10-25).
$BackupIgnorePatterns = @('backup-sweep-state','backups','cache','debug','downloads','file-history','plans','plugins','scheduled-tasks',
                        'session-backup-state','session-env','sessions','shell-snapshots','state','tasks','telemetry',
                        'account-session-sync',
                        'spares',   # empty folder Claude Code creates itself, seen 2026-10-25
                        '.credentials.json','*.jsonl','*.jsonl.bak','tmp_*.json','.loggate-*',
                        '.config-health-global-marker','.last-cleanup','.settings-health-nudge',
                        '*.lock','mcp-needs-auth-cache.json','policy-limits.json','policy-limits.json.stamp.json','*.json.tmp.*','remote-settings.json',
                        'sync-baseline.json','claude-config-pending-sync','.cred-denial-pending-*',
                        'backup-sweep-surfacer-cursor.json',
                        '.last-update-result.json','remote-settings.json.synced-at',   # Claude Code's own update result / settings-fetch timestamp, rewritten automatically (2026-10-18)
                        'policy-limits.json.signature*.json','remote-settings.json.signature*.json',   # Claude Code's signature files for the two ignored files above, rewritten automatically (2026-10-21)
                        '.claude.json')   # stray first-start stub (machine/user IDs only), seen 2026-10-14; real config is the sibling ~/.claude.json

# ---- Backup coverage check (GEN-140; triage GEN-460) -------------------------
# On every From-Claude run, sort any config-relevant file or folder that is neither in
# the backup set ($FileMap/$DirMap) nor on the ignore list nor already decided in
# backup-triage.json: a hook's marker file, or a top-level folder that is empty or holds
# only ignore-listed files, is skipped by rule (recorded, reported once); anything else
# gets a BACKUP-TRIAGE NEEDED warning (see "Backup triage" at the top). Covered-ness
# derives from the live maps -- the ignore list is the only extra data to maintain.
# Warn-only: never blocks the sync, never changes the exit code; an internal error
# degrades to a single warning (fail-open). ALL enumeration uses -Force: PS 5.1 skips
# hidden/system files without it, and dotfiles are exactly the class to watch.
function Test-BackupCoverage {
    param([hashtable]$Decisions, [bool]$Record)
    try {
        $IgnorePatterns = $BackupIgnorePatterns
        # Siblings of .claude -- see the NOT-synced header note for the .claude.json rationale.
        # Wildcards allowed: .claude.json.tmp.* are the harness's transient atomic-write temp files.
        $IgnoreSiblings = @('.claude.json','.claude.json.backup','.claude.json.tmp.*')
        # A hook's own state/switch files are named <hook name>.<one of these> (e.g.
        # reviewer-verdict-guard.accepted / .off / .testonly, GEN-812).
        $MarkerExts = @('accepted','off','on','testonly','disabled','bak','orig')

        $mapFiles = @($FileMap | ForEach-Object { $_.Claude })
        $mapDirs  = @($DirMap  | ForEach-Object { $_.Claude })
        $hooksDir = Join-Path $ClaudeBase 'hooks'
        $hookBases = @()
        if (Test-Path -LiteralPath $hooksDir) {
            $hookBases = @(Get-ChildItem -LiteralPath $hooksDir -File -Force |
                Where-Object { Test-IsHookCodeName $_.Name } |
                ForEach-Object { [IO.Path]::GetFileNameWithoutExtension($_.Name).ToLowerInvariant() })
        }

        # (a) Top-level folders in .claude: covered if any mapped path is the folder
        #     itself or lies under it.
        foreach ($d in (Get-ChildItem -LiteralPath $ClaudeBase -Directory -Force)) {
            $covered = $false
            foreach ($p in ($mapFiles + $mapDirs)) {
                if ($p -eq $d.FullName -or $p -like (Join-Path $d.FullName '*')) { $covered = $true; break }
            }
            if ($covered -or (Test-MatchesAnyPattern $d.Name $IgnorePatterns)) { continue }
            $prior = $Decisions[(ConvertTo-TriageKey $d.Name)]
            if ($prior -and [string]$prior.decidedBy -ne 'rule') { continue }   # Claude's decision stands
            $enumErrors = $null
            $files = @(Get-ChildItem -LiteralPath $d.FullName -Recurse -File -Force -ErrorAction SilentlyContinue -ErrorVariable enumErrors)
            $others = @($files | Where-Object { -not (Test-MatchesAnyPattern $_.Name $IgnorePatterns) })
            if ($enumErrors -and $enumErrors.Count -gt 0) {
                Write-TriageNeeded -RelPath $d.Name -What "folder whose contents could not all be read" -Choices 'skip' -Folder $true
            } elseif ($others.Count -gt 0) {
                $was = if ($prior) { "folder skipped earlier by rule, now holding $($others.Count) other file(s)" } else { "folder holding $($others.Count) file(s) not on the ignore list" }
                Write-TriageNeeded -RelPath $d.Name -What $was -Choices 'skip' -Folder $true
            } elseif (-not $prior) {
                $why = if ($files.Count -eq 0) { "empty folder, nothing to back up" } else { "folder holding only lock, temp or log files ($($files.Count)), per-machine state" }
                Add-RuleSkip -Decisions $Decisions -Record $Record -RelPath $d.Name -Why $why
            }
        }

        # (b) Files in the .claude root and in hooks\ (non-recursive; hooks subfolders
        #     are whole-folder DirMap entries).
        foreach ($sd in @($ClaudeBase, $hooksDir)) {
            if (-not (Test-Path -LiteralPath $sd)) { continue }
            $inHooks = ($sd -eq $hooksDir)
            foreach ($f in (Get-ChildItem -LiteralPath $sd -File -Force)) {
                if ($mapFiles -contains $f.FullName) { continue }
                $inMappedDir = $false
                foreach ($md in $mapDirs) {
                    if ($f.FullName -like (Join-Path $md '*')) { $inMappedDir = $true; break }
                }
                if ($inMappedDir) { continue }
                if ($inHooks -and (Test-IsHookCodeName $f.Name)) { continue }   # rule 1 owns hook code (incl. one left out for a secret)
                if (Test-MatchesAnyPattern $f.Name $IgnorePatterns) { continue }
                if (-not $inHooks -and $f.Name -ieq $TriageFileName) { continue }   # synced by its own merge
                $rel = if ($inHooks) { "hooks\" + $f.Name } else { $f.Name }
                if ($Decisions.ContainsKey((ConvertTo-TriageKey $rel))) { continue }
                if ($inHooks) {
                    $dot = $f.Name.LastIndexOf('.')
                    if ($dot -gt 0) {
                        $base = $f.Name.Substring(0, $dot).ToLowerInvariant()
                        $ext  = $f.Name.Substring($dot + 1).ToLowerInvariant()
                        if ($MarkerExts -contains $ext -and $hookBases -contains $base) {
                            Add-RuleSkip -Decisions $Decisions -Record $Record -RelPath $rel -Why "on/off or state marker of the '$base' hook, per-machine"
                            continue
                        }
                    }
                }
                Write-TriageNeeded -RelPath $rel -What "file" -Choices 'skip|backup'
            }
        }

        # (c) .claude* sibling files beside the .claude folder (e.g. a future
        #     .claude.something config) -- the .claude-rooted scan cannot see these.
        $parentDir = Split-Path $ClaudeBase -Parent
        foreach ($f in (Get-ChildItem -LiteralPath $parentDir -File -Force -Filter '.claude*')) {
            if (Test-MatchesAnyPattern $f.Name $IgnoreSiblings) { continue }
            $rel = "..\" + $f.Name
            if ($Decisions.ContainsKey((ConvertTo-TriageKey $rel))) { continue }
            Write-TriageNeeded -RelPath $rel -What "file beside the .claude folder" -Choices 'skip'
        }
    } catch {
        Write-Warning "BACKUP-COVERAGE: the coverage check itself failed ($($_.Exception.Message)); sync continues unaffected."
    }
}

# ---- Backup triage state + rule-built backup entries (GEN-460) ---------------
$TriageLocalPath = Join-Path $ClaudeBase $TriageFileName
$TriageDrivePath = Join-Path $DriveBase $TriageFileName
$TriageLocal = Read-TriageFile -Path $TriageLocalPath -Label 'local'
$TriageDrive = Read-TriageFile -Path $TriageDrivePath -Label 'Drive'
$Triage = Merge-TriageMaps -First $TriageLocal.Map -Second $TriageDrive.Map
$StaticBackupFiles = @($FileMap | ForEach-Object { $_.Claude })

if ($PSCmdlet.ParameterSetName -eq 'Triage') {
    $triageExit = @(Invoke-TriageDecide -RawPath $TriageDecide -Decision $As -Why $Reason)[-1]
    exit $triageExit
}

# Why a file that is about to be PUSHED must be left out this run (over 1 MB, unreadable, or holding
# a value that matches a secret pattern), or $null. Run on From-Claude for every file the rules or
# Claude's decisions added. (Not run on the fixed list or whole-folder backups; of those, only
# settings.local.json is secret-scanned, by the GEN-233 boundary scan.)
function Get-PushRefusal {
    param([string]$Path)
    try {
        if ((Get-Item -LiteralPath $Path).Length -gt 1MB) { return "it is over 1 MB" }
        if ($null -eq $script:patternDefs) { $script:patternDefs = Get-SecretPatternDefs }
        $hit = Find-SecretMatch -Text ([IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)) -Defs $script:patternDefs
        if ($hit) { return "it contains a value matching the '$hit' secret pattern" }
    } catch {
        return "it could not be checked for secrets ($($_.Exception.Message))"
    }
    return $null
}
$checkPushes = ($Direction -eq 'From-Claude' -or $CoverageOnly)

# Rule 1: every hook's code on EITHER side is in the backup set (so a To-Claude pull restores a
# hook added on another PC). The one exception: when pushing, a hook file that is over 1 MB or
# matches a secret pattern is left out of this push with a warning, like any other file added
# without a person looking at it.
$hookCodeNames = [ordered]@{}
foreach ($hd in @((Join-Path $ClaudeBase 'hooks'), (Join-Path $DriveBase 'hooks'))) {
    if (-not (Test-Path -LiteralPath $hd)) { continue }
    # A read error here (e.g. Drive mid-reconnect) must not end the whole sync, even under a caller's
    # $ErrorActionPreference = 'Stop': warn and carry on with what could be listed.
    $listErrors = $null
    $hookFiles = @(Get-ChildItem -LiteralPath $hd -File -Force -ErrorAction SilentlyContinue -ErrorVariable listErrors)
    if ($listErrors -and $listErrors.Count -gt 0) {
        Write-Warning "BACKUP-TRIAGE: could not fully list $hd ($($listErrors[0].Exception.Message)); hooks found only there are left out of this run."
    }
    foreach ($f in $hookFiles) {
        if ((Test-IsHookCodeName $f.Name) -and -not $hookCodeNames.Contains($f.Name.ToLowerInvariant())) {
            $hookCodeNames[$f.Name.ToLowerInvariant()] = $f.Name
        }
    }
}
foreach ($name in $hookCodeNames.Values) {
    $rel = "hooks\" + $name
    $claudePath = Join-Path $ClaudeBase $rel
    $isLocal = Test-Path -LiteralPath $claudePath -PathType Leaf
    if ($checkPushes -and $isLocal) {
        $why = Get-PushRefusal -Path $claudePath
        if ($why) {
            Write-Warning "BACKUP-TRIAGE: left hook '$rel' out of this backup -- $why. Fix the file; it is backed up again once it passes."
            continue
        }
    }
    $FileMap += @{ Drive = Join-Path $DriveBase $rel; Claude = $claudePath; Git = Join-Path $GitHistory $rel; HookCode = $true }
}

# Files Claude decided to back up ('backup' decisions). They are stored on Drive and in git under
# triage-backup\, so one can never land on a tooling file at the Drive root. Every run re-applies
# the refusals -TriageDecide used (the Drive copy of the decisions file could have been edited);
# every push requires the exact file to exist here and re-checks it for size and secrets.
foreach ($k in @($Triage.Keys | Sort-Object)) {
    $d = $Triage[$k]
    if ([string]$d.decision -ne 'backup') { continue }
    $rel = ([string]$d.path -replace '/', '\').TrimStart('\')
    $claudePath = Join-Path $ClaudeBase $rel
    if ($StaticBackupFiles -contains $claudePath) { continue }
    $refusal = Get-BackupRefusal -Rel $rel
    if ($refusal) {
        Write-Warning "BACKUP-TRIAGE: ignored the 'backup' decision for '$rel' in $TriageFileName -- $refusal. Delete that entry from $TriageFileName both here and on Drive (or, if the file exists here and is not hook code, record it as skip with: $(Get-TriageCommandText -RelPath $rel -Choices 'skip'))."
        continue
    }
    if ($checkPushes) {
        if (-not (Test-Path -LiteralPath $claudePath -PathType Leaf)) {
            if (Test-Path -LiteralPath $claudePath) {
                Write-Warning "BACKUP-TRIAGE: ignored the 'backup' decision for '$rel' in $TriageFileName -- it is a folder, and only a single file can be backed up this way. Record it as skip with: $(Get-TriageCommandText -RelPath $rel -Choices 'skip')"
            }
            continue
        }
        $why = Get-PushRefusal -Path $claudePath
        if ($why) {
            Write-Warning "BACKUP-TRIAGE: left '$rel' out of this backup -- $why. Fix the file, or record it as skip with: $(Get-TriageCommandText -RelPath $rel -Choices 'skip')"
            continue
        }
    }
    $FileMap += @{ Drive = Join-Path $DriveBase "triage-backup\$rel"; Claude = $claudePath; Git = Join-Path $GitHistory "triage-backup\$rel" }
}

if ($CoverageOnly) {
    Test-BackupCoverage -Decisions $Triage -Record $false
    foreach ($pair in $FileMap) { Write-Output "COVERAGE-ONLY file: $($pair.Claude)" }
    foreach ($pair in $DirMap)  { Write-Output "COVERAGE-ONLY folder: $($pair.Claude)" }
    exit 0
}

if ($Direction -eq "From-Claude") {
    Test-BackupCoverage -Decisions $Triage -Record $true
}

$copied = 0
$skipped = 0

if ($Direction -eq "To-Claude") {
    # Non-destructive pull (GEN-355): per-file hash compare against the baseline,
    # replacing the old blind Copy-Item -Force over the whole managed set.
    $Baseline = Load-Baseline -Path $BaselineFile
    Invoke-NonDestructivePull -Baseline $Baseline -Discard:$DiscardLocal.IsPresent
    Save-Baseline -Path $BaselineFile -Baseline $Baseline
    $null = Save-TriageState -ToDrive $false
    $copied = $Baseline.Count
} else {
    # From-Claude (local -> Drive) stays a straightforward overwrite: this machine's
    # local state is always the source of truth when pushing. Cross-machine
    # divergence on the Drive side is out of scope here (GEN-287).
    foreach ($pair in $FileMap) {
        $src = $pair.Claude
        $dst = $pair.Drive

        # -LiteralPath (GEN-460): rule-built entries carry real file names, which may hold [ ] -- a
        # -Path test/copy would treat those as wildcards and could copy a DIFFERENT file.
        if (-not (Test-Path -LiteralPath $src)) {
            if ($pair.HookCode) {
                # On Drive but not here: added on another PC, or deleted on this one. Either way the next
                # To-Claude sync brings it here; removing a hook for good means deleting it on every PC and on Drive.
                Write-Output "Hook on Drive only (the next To-Claude sync brings it here; to remove it for good, delete it on every PC and on Drive): $src"
            } else {
                Write-Warning "Source not found, skipping: $src"
            }
            $skipped++
            continue
        }

        $dstDir = Split-Path $dst -Parent
        if (-not (Test-Path -LiteralPath $dstDir)) {
            New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
        }

        Copy-Item -LiteralPath $src -Destination $dst -Force
        Write-Output "Copied: $src  ->  $dst"
        $copied++
    }

    foreach ($pair in $DirMap) {
        $src = $pair.Claude
        $dst = $pair.Drive

        if (-not (Test-Path $src)) {
            Write-Warning "Source folder not found, skipping: $src"
            $skipped++
            continue
        }
        if (-not (Test-Path $dst)) { New-Item -ItemType Directory -Path $dst -Force | Out-Null }
        Copy-Item -Path (Join-Path $src '*') -Destination $dst -Recurse -Force
        Write-Output "Copied folder: $src  ->  $dst"
        $copied++
    }

    # Refresh the baseline for every file we just pushed, so a subsequent To-Claude
    # pull on this machine correctly sees them as "unedited since last sync".
    $Baseline = Load-Baseline -Path $BaselineFile
    foreach ($e in (Get-AllManagedFiles)) {
        $h = Get-FileHashSafe -Path $e.Claude
        if ($null -ne $h) { $Baseline[$e.Claude] = $h }
    }
    Save-Baseline -Path $BaselineFile -Baseline $Baseline
    $null = Save-TriageState -ToDrive $true
}

Write-Output ""
Write-Output "Done. Direction: $Direction | Files tracked: $copied | Skipped: $skipped"

# ---------- Git history layer (only on From-Claude) ----------
if ($Direction -eq "From-Claude") {
    Write-Output ""
    Write-Output "Updating git history..."

    if (-not (Test-Path $GitHistory)) {
        Write-Warning "Git history folder $GitHistory not found -- skipping commit. Run setup to create it."
        exit 0
    }

    try {
        # Defensive stale-lock sweep before touching the repo at all (GEN-353): closes
        # the gap where a previous run crashed between Stop-Job and its own cleanup.
        Repair-StaleIndexLock -RepoPath $GitHistory -Context "start-of-run check"

        # Pull latest from origin first, in case another machine pushed history.
        # Bounded by a timeout (GEN-353) so a stalled network op can't hold the sync
        # lock indefinitely; a timeout here is warn-only, same as today's failure path.
        $pullResult = Invoke-GitJob -RepoPath $GitHistory -GitArgs @('-c', 'http.sslVerify=false', 'pull', '--rebase', '--autostash', 'origin', 'main') -TimeoutSeconds 90
        if ($pullResult.TimedOut) {
            Write-Warning "git pull timed out -- will commit locally only. Resolve manually next time."
        } elseif ($pullResult.ExitCode -ne 0) {
            Write-Warning "git pull failed (exit $($pullResult.ExitCode)) -- will commit locally only. Resolve manually next time."
        }

        # Mirror the synced files into the git folder.
        foreach ($pair in $FileMap) {
            if (-not (Test-Path -LiteralPath $pair.Claude)) { continue }
            $gitDir = Split-Path $pair.Git -Parent
            if (-not (Test-Path -LiteralPath $gitDir)) {
                New-Item -ItemType Directory -Path $gitDir -Force | Out-Null
            }
            Copy-Item -LiteralPath $pair.Claude -Destination $pair.Git -Force
        }
        if ($TriageLocal.Ok -and (Test-Path -LiteralPath $TriageLocalPath)) {
            Copy-Item -LiteralPath $TriageLocalPath -Destination (Join-Path $GitHistory $TriageFileName) -Force
        }

        # Mirror the whole-folder syncs into the git folder (recursive, additive).
        foreach ($pair in $DirMap) {
            if (-not (Test-Path $pair.Claude)) { continue }
            if (-not (Test-Path $pair.Git)) { New-Item -ItemType Directory -Path $pair.Git -Force | Out-Null }
            Copy-Item -Path (Join-Path $pair.Claude '*') -Destination $pair.Git -Recurse -Force
        }

        # Commit only if there's something to commit.
        Push-Location $GitHistory
        try {
            git add -A 2>&1 | Out-Null
            $status = git status --porcelain
            if (-not $status) {
                # No early 'return' here: at script scope it would exit the whole
                # script and bypass the deterministic exit 0 below (GEN-344/GEN-237).
                Write-Output "Git history: no changes to commit."
            } else {
                $msg = if ($CommitMessage) { $CommitMessage } else { "Sync at $(Get-Date -Format 'yyyy-MM-dd HH:mm') from $env:COMPUTERNAME" }
                git -c user.email="erez@muuula.com" -c user.name="Erez Baron" commit -m $msg 2>&1 | Out-Null
            }
        } finally {
            Pop-Location
        }

        if ($status) {
            $pushResult = Invoke-GitJob -RepoPath $GitHistory -GitArgs @('-c', 'http.sslVerify=false', 'push', 'origin', 'main') -TimeoutSeconds 90
            if ($pushResult.TimedOut) {
                Write-Warning "git push timed out -- commit is local only. Will retry on next sync when online."
            } elseif ($pushResult.ExitCode -ne 0) {
                Write-Warning "git push failed (exit $($pushResult.ExitCode)) -- commit is local only. Will retry on next sync when online."
            } else {
                Write-Output "Git history: committed and pushed ($msg)"
            }
        }
    } catch {
        $errMsg = $_.Exception.Message
        Write-Warning "Git history update failed: $errMsg. Drive sync was successful; only the version history is affected."
    }
}

# Every success path ends here with a deterministic clean exit code, so a non-fatal
# git-backup-push warning (which leaves $LASTEXITCODE non-zero) cannot leak back to
# callers like update-config.ps1 and masquerade as a Drive-sync failure. (GEN-237)
exit 0

} finally {
    if ($lockStream) {
        $lockStream.Close()
        $lockStream.Dispose()
        Remove-Item -Path $SyncLockFile -ErrorAction SilentlyContinue
    }
}
