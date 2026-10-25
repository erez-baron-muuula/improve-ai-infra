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
#   - hooks\auto-approve.js  (GEN-76 auto-approval PreToolUse hook)
#   - hooks\secret-patterns.json  (shared secret-scan patterns; GEN-233)
#   - hooks\sessionstart-loggate.js  (compact-gate SessionStart hook)
#   - hooks\precompact-loggate.js    (compact-gate PreCompact hook)
#   - hooks\confirm-send.js  (GEN-242 confirm-before-send Slack gate PreToolUse hook)
#   - hooks\notion-schema-guard.js  (GEN-184 Track A destructive-Notion-schema gate PreToolUse hook)
#   - hooks\permission-denied-log.js  (GEN-316 credential-denial detector PermissionDenied hook)
#   - hooks\stop-cred-denial-surface.js  (GEN-316 credential-denial detector Stop hook)
#   - hooks\stop-foryou-nudge.js  (GEN-422 "For you" block nudge Stop hook)
#   - hooks\stop-claim-linter.js  (GEN-450 unverified-claim linter Stop hook)
#   - hooks\posttooluse-signal-detect.js  (GEN-501 signal-surfacing detector PostToolUse hook)
#   - hooks\stop-signal-surface.js  (GEN-501 signal-surfacing deliverer Stop hook)
#   - hooks\account-session-sync.js  (GEN-859 two-account desktop session-list sync SessionStart + Stop hook)
#   - hooks\inject-notion-refs.js  (GEN-86 Notion reference-injection UserPromptSubmit hook)
#   - hooks\inject-shell-refs.js   (GEN-86 shell reference-injection PreToolUse hook)
#   - hooks\inject-deployment-refs.js  (GEN-673 Invoice-Automation deployment reference-injection PreToolUse hook)
#   - hooks\deny-askuserquestion.js  (GEN-337(c) AskUserQuestion popup block PreToolUse hook)
#   - hooks\pretooluse-effort-tag-gate.js  (GEN-619 effort-level check on next-step boxes + plan approvals, PreToolUse hook)
#   - hooks\inject-edit-refs.js  (GEN-340 file-editing reference-injection PreToolUse hook)
#   - hooks\inject-perk-refs.js  (perk-reminder UserPromptSubmit + PreToolUse(WebSearch) hook; list in hooks\refs\perks.md)
#   - hooks\reviewer-verdict-guard.js  (GEN-812 ticket-reviewer verdict-line bounce PreToolUse hook)
#   - hooks\ticket-gate-readout.js  (GEN-636 ticket-gate aggregate readout CLI for /wrap Step 3i -- not a registered hook)
#   - hooks\windows-mcp-delete-guard.js, windows-mcp-approval.js, windows-mcp-approval.ps1, windows-mcp-approval.test.js
#     (GEN-879 Windows-MCP add-on delete guard + approval window PreToolUse hooks, all folders; .test.js is not registered)
#   - hooks\windows-mcp-delete-guard.test.js  (GEN-885 offline tests for the delete guard -- not a registered hook)
#   - hooks\windows-mcp-point.ps1  (GEN-908 screen-point check run by windows-mcp-approval.js for task passes)
#   - hooks\browser-site-gate.js  (GEN-924 browser-extension site gate: PreToolUse/PostToolUse/PostToolUseFailure)
#   - hooks\inject-browser-refs.js  (GEN-883/GEN-742 browser notes + not-connected diagnosis: PostToolUse/PostToolUseFailure;
#     its notes and account labels live in hooks\refs\)
#   - hooks\prompt-wmcp-miss-reminder.js, inject-windows-mcp-refs.js  (2026-10-18: missed PC-control approval reminder
#     UserPromptSubmit hook; PC-control lessons PostToolUse injector, list in hooks\refs\windows-mcp.md)
#   - hooks\inject-topic-refs.js  (GEN-825 split Notion/shell topic-note injector: UserPromptSubmit + PreToolUse
#     + SessionStart(compact) hook; notes in hooks\refs\notion-*.md and shell-*.md)
#   - hooks\sessionstart-skill-restore.js  (GEN-845 after-compaction skill re-read reminder, SessionStart(compact) hook)
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
# Exit codes:
#   0 = success (sync completed; a subordinate git push warning does not change this -- GEN-237)
#   5 = secret-scan abort, OR the secret-patterns file is missing/unreadable (fail-closed)
#   6 = gave up waiting for the sync lock (another sync is running); NOTHING was synced -- treat like a failure

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("To-Claude", "From-Claude")]
    [string]$Direction,

    [string]$CommitMessage = "",

    [switch]$DiscardLocal
)

$DriveBase   = "G:\My Drive\AI Projects\_Tooling\Claude"
$ClaudeBase  = "C:\Users\Erez\.claude"
$MemoryBase  = Join-Path $ClaudeBase "projects\C--Users-Erez\memory"
$GitHistory  = "C:\Users\Erez\.claude-git-history"
$SyncLockFile = Join-Path $ClaudeBase "sync.lock"
$BaselineFile = Join-Path $ClaudeBase "sync-baseline.json"

$FileMap = @(
    @{ Drive = Join-Path $DriveBase "CLAUDE.md";                   Claude = Join-Path $ClaudeBase "CLAUDE.md";    Git = Join-Path $GitHistory "CLAUDE.md" },
    @{ Drive = Join-Path $DriveBase "settings.json";               Claude = Join-Path $ClaudeBase "settings.json"; Git = Join-Path $GitHistory "settings.json" },
    @{ Drive = Join-Path $DriveBase "settings.local.json";         Claude = Join-Path $ClaudeBase "settings.local.json"; Git = Join-Path $GitHistory "settings.local.json" },
    @{ Drive = Join-Path $DriveBase ".settings-health-keep.json";  Claude = Join-Path $ClaudeBase ".settings-health-keep.json"; Git = Join-Path $GitHistory ".settings-health-keep.json" },
    @{ Drive = Join-Path $DriveBase "hooks\auto-approve.js";       Claude = Join-Path $ClaudeBase "hooks\auto-approve.js"; Git = Join-Path $GitHistory "hooks\auto-approve.js" },
    @{ Drive = Join-Path $DriveBase "hooks\secret-patterns.json";  Claude = Join-Path $ClaudeBase "hooks\secret-patterns.json"; Git = Join-Path $GitHistory "hooks\secret-patterns.json" },
    @{ Drive = Join-Path $DriveBase "hooks\sessionstart-loggate.js"; Claude = Join-Path $ClaudeBase "hooks\sessionstart-loggate.js"; Git = Join-Path $GitHistory "hooks\sessionstart-loggate.js" },
    @{ Drive = Join-Path $DriveBase "hooks\precompact-loggate.js";   Claude = Join-Path $ClaudeBase "hooks\precompact-loggate.js";   Git = Join-Path $GitHistory "hooks\precompact-loggate.js" },
    @{ Drive = Join-Path $DriveBase "hooks\confirm-send.js";         Claude = Join-Path $ClaudeBase "hooks\confirm-send.js";         Git = Join-Path $GitHistory "hooks\confirm-send.js" },
    @{ Drive = Join-Path $DriveBase "hooks\notion-schema-guard.js";  Claude = Join-Path $ClaudeBase "hooks\notion-schema-guard.js";  Git = Join-Path $GitHistory "hooks\notion-schema-guard.js" },
    @{ Drive = Join-Path $DriveBase "hooks\permission-denied-log.js"; Claude = Join-Path $ClaudeBase "hooks\permission-denied-log.js"; Git = Join-Path $GitHistory "hooks\permission-denied-log.js" },
    @{ Drive = Join-Path $DriveBase "hooks\stop-cred-denial-surface.js"; Claude = Join-Path $ClaudeBase "hooks\stop-cred-denial-surface.js"; Git = Join-Path $GitHistory "hooks\stop-cred-denial-surface.js" },
    @{ Drive = Join-Path $DriveBase "hooks\inject-notion-refs.js";    Claude = Join-Path $ClaudeBase "hooks\inject-notion-refs.js";    Git = Join-Path $GitHistory "hooks\inject-notion-refs.js" },
    @{ Drive = Join-Path $DriveBase "hooks\inject-shell-refs.js";     Claude = Join-Path $ClaudeBase "hooks\inject-shell-refs.js";     Git = Join-Path $GitHistory "hooks\inject-shell-refs.js" },
    @{ Drive = Join-Path $DriveBase "hooks\inject-deployment-refs.js"; Claude = Join-Path $ClaudeBase "hooks\inject-deployment-refs.js"; Git = Join-Path $GitHistory "hooks\inject-deployment-refs.js" },
    @{ Drive = Join-Path $DriveBase "hooks\deny-askuserquestion.js";  Claude = Join-Path $ClaudeBase "hooks\deny-askuserquestion.js";  Git = Join-Path $GitHistory "hooks\deny-askuserquestion.js" },
    @{ Drive = Join-Path $DriveBase "hooks\pretooluse-effort-tag-gate.js"; Claude = Join-Path $ClaudeBase "hooks\pretooluse-effort-tag-gate.js"; Git = Join-Path $GitHistory "hooks\pretooluse-effort-tag-gate.js" },
    @{ Drive = Join-Path $DriveBase "hooks\inject-edit-refs.js";      Claude = Join-Path $ClaudeBase "hooks\inject-edit-refs.js";      Git = Join-Path $GitHistory "hooks\inject-edit-refs.js" },
    @{ Drive = Join-Path $DriveBase "hooks\notion-fetch-staleness.js"; Claude = Join-Path $ClaudeBase "hooks\notion-fetch-staleness.js"; Git = Join-Path $GitHistory "hooks\notion-fetch-staleness.js" },
    @{ Drive = Join-Path $DriveBase "hooks\notion-write-verify.js";   Claude = Join-Path $ClaudeBase "hooks\notion-write-verify.js";   Git = Join-Path $GitHistory "hooks\notion-write-verify.js" },
    @{ Drive = Join-Path $DriveBase "hooks\inject-jira-refs.js";      Claude = Join-Path $ClaudeBase "hooks\inject-jira-refs.js";      Git = Join-Path $GitHistory "hooks\inject-jira-refs.js" },
    @{ Drive = Join-Path $DriveBase "hooks\inject-perk-refs.js";      Claude = Join-Path $ClaudeBase "hooks\inject-perk-refs.js";      Git = Join-Path $GitHistory "hooks\inject-perk-refs.js" },
    @{ Drive = Join-Path $DriveBase "hooks\sessionstart-backup-surfacer.js"; Claude = Join-Path $ClaudeBase "hooks\sessionstart-backup-surfacer.js"; Git = Join-Path $GitHistory "hooks\sessionstart-backup-surfacer.js" },
    @{ Drive = Join-Path $DriveBase "hooks\sessionstart-backup-spawner.js"; Claude = Join-Path $ClaudeBase "hooks\sessionstart-backup-spawner.js"; Git = Join-Path $GitHistory "hooks\sessionstart-backup-spawner.js" },
    @{ Drive = Join-Path $DriveBase "hooks\sessionstart-configunlock-reaper.js"; Claude = Join-Path $ClaudeBase "hooks\sessionstart-configunlock-reaper.js"; Git = Join-Path $GitHistory "hooks\sessionstart-configunlock-reaper.js" },
    @{ Drive = Join-Path $DriveBase "hooks\sessionstart-session-backup.js"; Claude = Join-Path $ClaudeBase "hooks\sessionstart-session-backup.js"; Git = Join-Path $GitHistory "hooks\sessionstart-session-backup.js" },
    @{ Drive = Join-Path $DriveBase "hooks\stop-foryou-nudge.js"; Claude = Join-Path $ClaudeBase "hooks\stop-foryou-nudge.js"; Git = Join-Path $GitHistory "hooks\stop-foryou-nudge.js" },
    @{ Drive = Join-Path $DriveBase "hooks\stop-claim-linter.js"; Claude = Join-Path $ClaudeBase "hooks\stop-claim-linter.js"; Git = Join-Path $GitHistory "hooks\stop-claim-linter.js" },
    @{ Drive = Join-Path $DriveBase "hooks\posttooluse-signal-detect.js"; Claude = Join-Path $ClaudeBase "hooks\posttooluse-signal-detect.js"; Git = Join-Path $GitHistory "hooks\posttooluse-signal-detect.js" },
    @{ Drive = Join-Path $DriveBase "hooks\stop-signal-surface.js"; Claude = Join-Path $ClaudeBase "hooks\stop-signal-surface.js"; Git = Join-Path $GitHistory "hooks\stop-signal-surface.js" },
    @{ Drive = Join-Path $DriveBase "hooks\reviewer-verdict-guard.js"; Claude = Join-Path $ClaudeBase "hooks\reviewer-verdict-guard.js"; Git = Join-Path $GitHistory "hooks\reviewer-verdict-guard.js" },
    @{ Drive = Join-Path $DriveBase "hooks\ticket-gate-readout.js"; Claude = Join-Path $ClaudeBase "hooks\ticket-gate-readout.js"; Git = Join-Path $GitHistory "hooks\ticket-gate-readout.js" },
    @{ Drive = Join-Path $DriveBase "hooks\account-session-sync.js"; Claude = Join-Path $ClaudeBase "hooks\account-session-sync.js"; Git = Join-Path $GitHistory "hooks\account-session-sync.js" },
    @{ Drive = Join-Path $DriveBase "hooks\windows-mcp-delete-guard.js"; Claude = Join-Path $ClaudeBase "hooks\windows-mcp-delete-guard.js"; Git = Join-Path $GitHistory "hooks\windows-mcp-delete-guard.js" },
    @{ Drive = Join-Path $DriveBase "hooks\windows-mcp-approval.js"; Claude = Join-Path $ClaudeBase "hooks\windows-mcp-approval.js"; Git = Join-Path $GitHistory "hooks\windows-mcp-approval.js" },
    @{ Drive = Join-Path $DriveBase "hooks\windows-mcp-approval.ps1"; Claude = Join-Path $ClaudeBase "hooks\windows-mcp-approval.ps1"; Git = Join-Path $GitHistory "hooks\windows-mcp-approval.ps1" },
    @{ Drive = Join-Path $DriveBase "hooks\windows-mcp-point.ps1"; Claude = Join-Path $ClaudeBase "hooks\windows-mcp-point.ps1"; Git = Join-Path $GitHistory "hooks\windows-mcp-point.ps1" },
    @{ Drive = Join-Path $DriveBase "hooks\browser-site-gate.js"; Claude = Join-Path $ClaudeBase "hooks\browser-site-gate.js"; Git = Join-Path $GitHistory "hooks\browser-site-gate.js" },
    @{ Drive = Join-Path $DriveBase "hooks\windows-mcp-approval.test.js"; Claude = Join-Path $ClaudeBase "hooks\windows-mcp-approval.test.js"; Git = Join-Path $GitHistory "hooks\windows-mcp-approval.test.js" },
    @{ Drive = Join-Path $DriveBase "hooks\windows-mcp-delete-guard.test.js"; Claude = Join-Path $ClaudeBase "hooks\windows-mcp-delete-guard.test.js"; Git = Join-Path $GitHistory "hooks\windows-mcp-delete-guard.test.js" },
    @{ Drive = Join-Path $DriveBase "hooks\prompt-wmcp-miss-reminder.js"; Claude = Join-Path $ClaudeBase "hooks\prompt-wmcp-miss-reminder.js"; Git = Join-Path $GitHistory "hooks\prompt-wmcp-miss-reminder.js" },
    @{ Drive = Join-Path $DriveBase "hooks\inject-windows-mcp-refs.js"; Claude = Join-Path $ClaudeBase "hooks\inject-windows-mcp-refs.js"; Git = Join-Path $GitHistory "hooks\inject-windows-mcp-refs.js" },
    @{ Drive = Join-Path $DriveBase "hooks\inject-browser-refs.js"; Claude = Join-Path $ClaudeBase "hooks\inject-browser-refs.js"; Git = Join-Path $GitHistory "hooks\inject-browser-refs.js" },
    @{ Drive = Join-Path $DriveBase "hooks\inject-topic-refs.js"; Claude = Join-Path $ClaudeBase "hooks\inject-topic-refs.js"; Git = Join-Path $GitHistory "hooks\inject-topic-refs.js" },
    @{ Drive = Join-Path $DriveBase "hooks\sessionstart-skill-restore.js"; Claude = Join-Path $ClaudeBase "hooks\sessionstart-skill-restore.js"; Git = Join-Path $GitHistory "hooks\sessionstart-skill-restore.js" }
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

# ---- Backup coverage check (GEN-140) ---------------------------------------
# On every From-Claude run, warn about any config-relevant file or folder that is
# neither in the backup set ($FileMap/$DirMap) nor on an explicit ignore list, so
# a new file can never sit silently unprotected. Covered-ness derives from the live
# maps above -- the ignore lists are the only extra data to maintain. Warn-only:
# never blocks the sync, never changes the exit code; an internal error degrades
# to a single warning (fail-open). ALL enumeration uses -Force: PS 5.1 skips
# hidden/system files without it, and dotfiles are exactly the class to watch.
function Test-BackupCoverage {
    try {
        # Per-machine / ephemeral / harness-managed -- deliberately not backed up.
        $IgnoreDirs = @('backup-sweep-state','backups','cache','debug','downloads','file-history','plans','plugins','scheduled-tasks',
                        'session-backup-state','session-env','sessions','shell-snapshots','state','tasks','telemetry',
                        'account-session-sync',
                        'spares')   # empty folder Claude Code creates itself, seen 2026-10-25
        $IgnoreFiles = @('.credentials.json','*.jsonl','*.jsonl.bak','tmp_*.json','.loggate-*',
                         '.config-health-global-marker','.last-cleanup','.settings-health-nudge',
                         '*.lock','mcp-needs-auth-cache.json','policy-limits.json','policy-limits.json.stamp.json','*.json.tmp.*','remote-settings.json',
                         'sync-baseline.json','claude-config-pending-sync','.cred-denial-pending-*',
                         'backup-sweep-surfacer-cursor.json',
                         '.last-update-result.json','remote-settings.json.synced-at',   # Claude Code's own update result / settings-fetch timestamp, rewritten automatically (2026-10-18)
                         'policy-limits.json.signature*.json','remote-settings.json.signature*.json',   # Claude Code's signature files for the two ignored files above, rewritten automatically (2026-10-21)
                         '.claude.json',   # stray first-start stub (machine/user IDs only), seen 2026-10-14; real config is the sibling ~/.claude.json
                         'reviewer-verdict-guard.accepted','reviewer-verdict-guard.off','reviewer-verdict-guard.testonly')
        # Siblings of .claude -- see the NOT-synced header note for the .claude.json rationale.
        # Wildcards allowed: .claude.json.tmp.* are the harness's transient atomic-write temp files.
        $IgnoreSiblings = @('.claude.json','.claude.json.backup','.claude.json.tmp.*')

        $mapFiles = @($FileMap | ForEach-Object { $_.Claude })
        $mapDirs  = @($DirMap  | ForEach-Object { $_.Claude })
        $remedy = 'Add it to $FileMap/$DirMap in sync.ps1 (to back it up) or to the ignore lists in Test-BackupCoverage (to declare it per-machine).'

        # (a) Top-level folders in .claude: covered if any mapped path is the folder
        #     itself or lies under it.
        foreach ($d in (Get-ChildItem -Path $ClaudeBase -Directory -Force)) {
            $covered = $false
            foreach ($p in ($mapFiles + $mapDirs)) {
                if ($p -eq $d.FullName -or $p -like (Join-Path $d.FullName '*')) { $covered = $true; break }
            }
            # '*.lock' folders: Claude Code's transient lock dirs (e.g. policy-limits.json.signature-iat.json.lock), 2026-10-25
            if (-not $covered -and $IgnoreDirs -notcontains $d.Name -and $d.Name -notlike '*.lock') {
                Write-Warning "BACKUP-COVERAGE: top-level folder '$($d.Name)' is not covered by the backup set and not on the ignore list. $remedy"
            }
        }

        # (b) Files in the .claude root and in hooks\ (non-recursive; hooks subfolders
        #     are whole-folder DirMap entries).
        foreach ($sd in @($ClaudeBase, (Join-Path $ClaudeBase 'hooks'))) {
            foreach ($f in (Get-ChildItem -Path $sd -File -Force)) {
                if ($mapFiles -contains $f.FullName) { continue }
                $inMappedDir = $false
                foreach ($md in $mapDirs) {
                    if ($f.FullName -like (Join-Path $md '*')) { $inMappedDir = $true; break }
                }
                if ($inMappedDir) { continue }
                $ignored = $false
                foreach ($pat in $IgnoreFiles) {
                    if ($f.Name -like $pat) { $ignored = $true; break }
                }
                if (-not $ignored) {
                    Write-Warning "BACKUP-COVERAGE: file '$($f.FullName)' is not in the backup set and not on the ignore list. $remedy"
                }
            }
        }

        # (c) .claude* sibling files beside the .claude folder (e.g. a future
        #     .claude.something config) -- the .claude-rooted scan cannot see these.
        $parentDir = Split-Path $ClaudeBase -Parent
        foreach ($f in (Get-ChildItem -Path $parentDir -File -Force -Filter '.claude*')) {
            $ignored = $false
            foreach ($pat in $IgnoreSiblings) {
                if ($f.Name -like $pat) { $ignored = $true; break }
            }
            if (-not $ignored) {
                Write-Warning "BACKUP-COVERAGE: sibling file '$($f.FullName)' is not in the backup set and not on the ignore list. $remedy"
            }
        }
    } catch {
        Write-Warning "BACKUP-COVERAGE: the coverage check itself failed ($($_.Exception.Message)); sync continues unaffected."
    }
}

if ($Direction -eq "From-Claude") {
    Test-BackupCoverage
}

$copied = 0
$skipped = 0

if ($Direction -eq "To-Claude") {
    # Non-destructive pull (GEN-355): per-file hash compare against the baseline,
    # replacing the old blind Copy-Item -Force over the whole managed set.
    $Baseline = Load-Baseline -Path $BaselineFile
    Invoke-NonDestructivePull -Baseline $Baseline -Discard:$DiscardLocal.IsPresent
    Save-Baseline -Path $BaselineFile -Baseline $Baseline
    $copied = $Baseline.Count
} else {
    # From-Claude (local -> Drive) stays a straightforward overwrite: this machine's
    # local state is always the source of truth when pushing. Cross-machine
    # divergence on the Drive side is out of scope here (GEN-287).
    foreach ($pair in $FileMap) {
        $src = $pair.Claude
        $dst = $pair.Drive

        if (-not (Test-Path $src)) {
            Write-Warning "Source not found, skipping: $src"
            $skipped++
            continue
        }

        $dstDir = Split-Path $dst -Parent
        if (-not (Test-Path $dstDir)) {
            New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
        }

        Copy-Item -Path $src -Destination $dst -Force
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
            if (-not (Test-Path $pair.Claude)) { continue }
            $gitDir = Split-Path $pair.Git -Parent
            if (-not (Test-Path $gitDir)) {
                New-Item -ItemType Directory -Path $gitDir -Force | Out-Null
            }
            Copy-Item -Path $pair.Claude -Destination $pair.Git -Force
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
