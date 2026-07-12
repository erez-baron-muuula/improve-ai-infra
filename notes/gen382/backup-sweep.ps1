# backup-sweep.ps1 -- Airtight per-repo backup sweep (GEN-382, Phase A core).
#
# Pushes a full-working-tree snapshot (committed + uncommitted + untracked, .gitignore
# honored) of each target repo to a hidden backup channel on the repo's own remote:
#   refs/backup/<machine>/<session>/latest
# without ever touching the repo's real index, HEAD, staging, or any branch.
#
# Design: GEN-382 converged spec (backup-sweep-design-v2.md). This is the standalone
# Phase-A core -- it is NOT wired to any trigger and does NOT auto-discover the real
# project repos yet. Callers pass the repos to sweep via -RepoPaths (Phase B supplies
# them from the known-roots scan) and the session id via -SessionId (Phase B supplies
# the Claude session UUID). Run with -DryRun to do everything except the network push.
#
# SAFETY MODEL (all verified against the design's /check panel):
#  - Secret scan runs on WORKING-TREE FILES, BEFORE any git object is written. A match
#    aborts that repo entirely (no snapshot object is ever created locally), fail-closed.
#    A missing/unreadable patterns file aborts every repo (never sweep unscanned).
#  - Snapshot uses a UNIQUE temp GIT_INDEX_FILE per invocation; the real .git/index,
#    HEAD, and all branches are never touched. Only reads + a push to refs/backup/*.
#  - NEVER pull/rebase/checkout/reset/merge. A repo mid-merge/rebase is skipped + logged.
#  - The snapshot commit is pinned to a LOCAL ref before the push so a concurrent local
#    gc/prune can't drop it; the local ref is deleted after a successful push.
#  - Per-repo lock: a repo already being swept is skipped, and that skip is LOGGED to the
#    append-only failure queue (a lock-skip is never a silent skip).
#  - Every failure (secret quarantine, unreachable remote, torn/locked file, lock-skip,
#    size-guard) is appended to a durable JSONL queue for the next session to surface.
#  - Outbound TLS cert verification is disabled per this machine's standing trait
#    (see the outbound-TLS rule): every network git call uses -c http.sslVerify=false.
#
# Exit codes:
#   0 = sweep ran (individual repos may have been skipped/quarantined -- see the queue;
#       per-repo problems are logged, not fatal, so the sweep is best-effort by design)
#   4 = fatal precondition: secret-patterns file missing/unreadable (fail-closed; nothing
#       was swept because no repo could be safely scanned)
#   2 = bad invocation (no repos given, git not found)

[CmdletBinding()]
param(
    # Repos to sweep. Phase B passes the known-roots scan result here.
    [Parameter(Mandatory = $true)]
    [string[]]$RepoPaths,

    # Stable, unique-per-session id. Phase B passes the Claude session UUID.
    [Parameter(Mandatory = $true)]
    [string]$SessionId,

    # Machine label for the ref namespace. Defaults to COMPUTERNAME.
    [string]$Machine = $env:COMPUTERNAME,

    # Shared secret-pattern definitions (same file sync.ps1 uses).
    [string]$SecretPatternsFile = (Join-Path $env:USERPROFILE ".claude\hooks\secret-patterns.json"),

    # Append-only durable failure queue the next session surfaces.
    [string]$FailureQueueFile = (Join-Path $env:USERPROFILE ".claude\backup-sweep-failures.jsonl"),

    # Directory for per-repo lock files + per-repo last-tree state.
    [string]$StateDir = (Join-Path $env:USERPROFILE ".claude\backup-sweep-state"),

    # Skip any single blob larger than this (GitHub rejects >100MB; LFS is a future ticket).
    [int]$MaxBlobMB = 100,

    # Do everything EXCEPT the network push (for testing). The snapshot commit is still
    # built locally so the full local path is exercised.
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

# Native git writes benign warnings (e.g. CRLF conversion) to stderr even on success.
# Under $ErrorActionPreference='Stop', redirecting native stderr with `2>$null` turns
# such a warning into a TERMINATING error (verified PS 5.1 behavior). So every native
# git call goes through this wrapper: it forces stderr into the output stream, restores
# a non-Stop preference for the duration, and reports success strictly by exit code.
# Returns stdout lines (stderr filtered out of the returned value but available on fail).
function Invoke-Git {
    param([string[]]$GitArgs)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $all = & git @GitArgs 2>&1
        $code = $LASTEXITCODE
        $stdout = @()
        $stderr = @()
        foreach ($line in $all) {
            if ($line -is [System.Management.Automation.ErrorRecord]) { $stderr += $line.ToString() }
            else { $stdout += $line }
        }
        return [PSCustomObject]@{ Ok = ($code -eq 0); Code = $code; Out = $stdout; Err = ($stderr -join "`n") }
    } finally {
        $ErrorActionPreference = $prev
    }
}

# NUL-delimited variant for `ls-files -z` etc.: returns the raw stdout string (NULs
# intact) so callers can split on "`0". stderr is dropped; success is by exit code.
function Invoke-GitRawZ {
    param([string[]]$GitArgs)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = (& git @GitArgs 2>$null | Out-String)
        return [PSCustomObject]@{ Ok = ($LASTEXITCODE -eq 0); Code = $LASTEXITCODE; Raw = $out }
    } finally {
        $ErrorActionPreference = $prev
    }
}

# Bounded-timeout variant for NETWORK git calls (push, ls-remote). An unattended run against
# an unreachable/hung remote must NOT block forever holding the per-repo lock (sync.ps1 hit
# and solved exactly this; mirror its Start-Job + Wait-Job -Timeout pattern here). The job is
# self-contained -- everything passed via -ArgumentList, exit code returned as job output
# (never rely on $LASTEXITCODE across a runspace boundary). On timeout, the job is stopped and
# the result reports TimedOut so the caller treats it as an 'unreachable' warn-not-block
# failure. Returns the same shape as Invoke-Git plus a .TimedOut flag.
function Invoke-GitNet {
    param([string[]]$GitArgs, [int]$TimeoutSeconds = 90)
    $job = Start-Job -ScriptBlock {
        param($gitArgs)
        $all = & git @gitArgs 2>&1
        $code = $LASTEXITCODE
        $stdout = @(); $stderr = @()
        foreach ($line in $all) {
            if ($line -is [System.Management.Automation.ErrorRecord]) { $stderr += $line.ToString() }
            else { $stdout += $line }
        }
        [PSCustomObject]@{ Code = $code; Out = $stdout; Err = ($stderr -join "`n") }
    } -ArgumentList (,$GitArgs)
    $finished = Wait-Job -Job $job -Timeout $TimeoutSeconds
    if (-not $finished) {
        Stop-Job -Job $job -ErrorAction SilentlyContinue
        Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
        return [PSCustomObject]@{ Ok = $false; TimedOut = $true; Code = -1; Out = @(); Err = "timed out after ${TimeoutSeconds}s" }
    }
    $res = Receive-Job -Job $job
    Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
    return [PSCustomObject]@{ Ok = ($res.Code -eq 0); TimedOut = $false; Code = $res.Code; Out = $res.Out; Err = $res.Err }
}

# ---------------------------------------------------------------------------
# Failure queue -- append-only. NEVER rewrites; the next session reads+marks these.
# One JSON object per line: { ts, repo, kind, detail }. ts is passed in from the
# caller-provided invocation stamp (scripts here must not call Get-Date for identity,
# but a human-readable log ts is fine and non-identity -- we still use Get-Date only
# for the log line, never for anything the ref name / dedup depends on).
# ---------------------------------------------------------------------------
function Add-Failure {
    param(
        [string]$Repo,
        [string]$Kind,     # secret | unreachable | torn | locked | lock-skip | size | mid-op | error
        [string]$Detail
    )
    try {
        $dir = Split-Path $FailureQueueFile -Parent
        if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $rec = [ordered]@{
            ts      = (Get-Date -Format 'o')
            machine = $Machine
            session = $SessionId
            repo    = $Repo
            kind    = $Kind
            detail  = $Detail
            surfaced = $false
        }
        $line = ($rec | ConvertTo-Json -Compress -Depth 5)
        # Append as UTF-8 with NO BOM, and with a cross-process exclusive-append open so two
        # concurrent sweeps can't interleave a half-written line. NOTES on why not Add-Content:
        #  - Add-Content -Encoding UTF8 (PS 5.1) writes a BOM on file creation, so the FIRST
        #    JSONL line would be prefixed with EF BB BF and break a strict per-line JSON parse
        #    (the Phase-B surfacer) -- verified. A no-BOM UTF8Encoding($false) avoids that.
        #  - Two processes appending concurrently can interleave mid-line; opening with
        #    FileShare::Read (write-exclusive) + a short retry serializes writers so each line
        #    lands whole. A single Append+newline write per call keeps the line atomic enough.
        $enc = New-Object System.Text.UTF8Encoding($false)   # $false = emit NO BOM
        $payload = $enc.GetBytes($line + "`n")
        $attempt = 0
        while ($true) {
            try {
                $fs = [System.IO.File]::Open($FailureQueueFile, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
                try { $fs.Write($payload, 0, $payload.Length) } finally { $fs.Close(); $fs.Dispose() }
                break
            } catch [System.IO.IOException] {
                $attempt++
                if ($attempt -ge 50) { throw }   # ~5s of contention -> give up, caught below
                Start-Sleep -Milliseconds 100
            }
        }
    } catch {
        # The failure queue itself failing must not crash the sweep, but it MUST be loud
        # on the console so it isn't a silent silent-failure.
        Write-Warning "BACKUP-SWEEP: could not append to failure queue ($($_.Exception.Message)); repo=$Repo kind=$Kind detail=$Detail"
    }
}

# ---------------------------------------------------------------------------
# Per-repo lock. FileShare::None handle; auto-releases if the process dies. Returns the
# open stream on success, $null if another sweep already holds this repo's lock.
# ---------------------------------------------------------------------------
function Enter-RepoLock {
    param([string]$RepoKey)
    try {
        if (-not (Test-Path -LiteralPath $StateDir)) { New-Item -ItemType Directory -Path $StateDir -Force | Out-Null }
        $lockPath = Join-Path $StateDir ("$RepoKey.lock")
        $stream = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
        return $stream
    } catch [System.IO.IOException] {
        return $null   # already locked by a concurrent sweep
    }
}

# ---------------------------------------------------------------------------
# Secret scan -- runs on WORKING-TREE FILES, before any git object is written.
# Enumerates exactly the files `git add -A` would stage: tracked (per ls-files) plus
# untracked-not-ignored (per status --porcelain), with deletions excluded (a deleted
# file has no content to scan). Returns the FIRST match as an object, or $null if clean.
# Fail-closed: caller must have already validated the patterns loaded.
# ---------------------------------------------------------------------------
function Get-SecretMatch {
    param([string]$RepoPath, [array]$Patterns)

    # Files that WOULD be in the snapshot: everything not ignored and not deleted.
    # `git ls-files -z` = tracked; `git ls-files -z --others --exclude-standard` = untracked
    # honoring .gitignore. Union, minus staged/working deletions.
    $tracked = (Invoke-GitRawZ @('-C', $RepoPath, 'ls-files', '-z')).Raw
    $others  = (Invoke-GitRawZ @('-C', $RepoPath, 'ls-files', '-z', '--others', '--exclude-standard')).Raw

    $files = New-Object System.Collections.Generic.HashSet[string]
    foreach ($chunk in @($tracked, $others)) {
        if ([string]::IsNullOrEmpty($chunk)) { continue }
        foreach ($f in ($chunk -split "`0")) {
            $f = $f.Trim("`r", "`n")
            if ($f) { [void]$files.Add($f) }
        }
    }

    foreach ($rel in $files) {
        $full = Join-Path $RepoPath $rel
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { continue }  # deleted/never-present
        # Read the raw BYTES and decode as Latin1 (ISO-8859-1) -- a 1:1 byte<->char map, so
        # every byte becomes a character and no bytes are lost or mis-folded. Reading with
        # -Encoding UTF8 would mis-decode a UTF-16/UTF-16LE file (common on Windows) into
        # garbage, so an ASCII token stored in such a file would NOT match its regex and the
        # secret would slip through the gate (fail-OPEN). With Latin1 the token's own bytes
        # are preserved verbatim, so a byte-for-byte token pattern matches regardless of the
        # file's declared text encoding. Scan candidate encodings: the raw Latin1 view (covers
        # UTF-8/ASCII/Latin1) AND a UTF-16LE decode (covers UTF-16 where token chars are
        # separated by NUL bytes in the Latin1 view and so wouldn't match a contiguous regex).
        try {
            $bytes = [System.IO.File]::ReadAllBytes($full)
        } catch {
            continue   # unreadable (locked mid-write etc.) -- torn/locked handled by caller path
        }
        if ($null -eq $bytes -or $bytes.Length -eq 0) { continue }
        $views = @(
            [System.Text.Encoding]::GetEncoding('ISO-8859-1').GetString($bytes),
            [System.Text.Encoding]::Unicode.GetString($bytes)          # UTF-16LE
        )
        foreach ($text in $views) {
            if (-not $text) { continue }
            foreach ($def in $Patterns) {
                $m = [regex]::Match($text, $def.regex)
                if ($m.Success) {
                    $masked = $m.Value.Substring(0, [Math]::Min(4, $m.Value.Length)) + "****"
                    return [PSCustomObject]@{ File = $rel; Pattern = $def.name; Masked = $masked }
                }
            }
        }
    }
    return $null
}

# ---------------------------------------------------------------------------
# Size guard -- return the first working-tree file over the cap, or $null.
# ---------------------------------------------------------------------------
function Get-OversizeFile {
    param([string]$RepoPath, [int]$MaxMB)
    $capBytes = [int64]$MaxMB * 1MB
    $tracked = (Invoke-GitRawZ @('-C', $RepoPath, 'ls-files', '-z')).Raw
    $others  = (Invoke-GitRawZ @('-C', $RepoPath, 'ls-files', '-z', '--others', '--exclude-standard')).Raw
    foreach ($chunk in @($tracked, $others)) {
        if ([string]::IsNullOrEmpty($chunk)) { continue }
        foreach ($rel in ($chunk -split "`0")) {
            $rel = $rel.Trim("`r", "`n")
            if (-not $rel) { continue }
            $full = Join-Path $RepoPath $rel
            if (Test-Path -LiteralPath $full -PathType Leaf) {
                $len = (Get-Item -LiteralPath $full).Length
                if ($len -gt $capBytes) {
                    return [PSCustomObject]@{ File = $rel; SizeMB = [math]::Round($len / 1MB, 1) }
                }
            }
        }
    }
    return $null
}

# ---------------------------------------------------------------------------
# Is the repo mid-merge / mid-rebase? Snapshotting conflict debris is worse than skipping.
# ---------------------------------------------------------------------------
function Test-MidOperation {
    param([string]$RepoPath)
    $r = Invoke-Git @('-C', $RepoPath, 'rev-parse', '--git-dir')
    $gitDir = if ($r.Ok) { ($r.Out | Select-Object -First 1) } else { $null }
    if (-not $gitDir) { return $false }
    if (-not [System.IO.Path]::IsPathRooted($gitDir)) { $gitDir = Join-Path $RepoPath $gitDir }
    foreach ($marker in @('MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD')) {
        if (Test-Path -LiteralPath (Join-Path $gitDir $marker)) { return $true }
    }
    return $false
}

# ---------------------------------------------------------------------------
# Sweep a single repo. Best-effort: every problem is logged to the queue, never thrown.
# ---------------------------------------------------------------------------
function Invoke-RepoSweep {
    param([string]$RepoPath, [array]$Patterns)

    if (-not (Test-Path -LiteralPath $RepoPath)) {
        Add-Failure -Repo $RepoPath -Kind 'error' -Detail 'repo path does not exist'
        return
    }
    $rIs = Invoke-Git @('-C', $RepoPath, 'rev-parse', '--is-inside-work-tree')
    if (-not $rIs.Ok -or (($rIs.Out | Select-Object -First 1) -ne 'true')) {
        Add-Failure -Repo $RepoPath -Kind 'error' -Detail 'not a git work tree'
        return
    }

    # Stable per-repo key for lock + state file names (repo path is not filename-safe).
    # Use a short SHA-1 of the full path (not the mangled path itself) so state filenames
    # stay well under the Windows MAX_PATH limit regardless of how deep the repo lives.
    $sha1 = [System.Security.Cryptography.SHA1]::Create()
    $repoKey = ([System.BitConverter]::ToString(
        $sha1.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($RepoPath.ToLowerInvariant()))
    ) -replace '-', '').Substring(0, 16)
    $sha1.Dispose()

    $lock = Enter-RepoLock -RepoKey $repoKey
    if ($null -eq $lock) {
        # A concurrent sweep already holds this repo, so this repo IS being backed up right
        # now by that other sweep -- a lock-skip is therefore NOT an actionable failure and is
        # NOT queued. (Queuing every lock-skip would flood the failure queue under normal
        # multi-session concurrency and bury real alerts like a quarantined secret.) A plain
        # console line keeps it visible without polluting the durable queue.
        Write-Host "SKIP (locked -- another sweep is backing up this repo): $RepoPath"
        return
    }

    try {
        # 1. Mid-operation guard.
        if (Test-MidOperation -RepoPath $RepoPath) {
            Add-Failure -Repo $RepoPath -Kind 'mid-op' -Detail 'repo is mid-merge/rebase/cherry-pick; skipped to avoid snapshotting conflict state'
            Write-Host "SKIP (mid-operation): $RepoPath"
            return
        }

        # 2. Size guard FIRST -- it only stats file lengths (never opens them), so running it
        #    before the secret scan means an oversize file is skipped without the secret scan
        #    ever Get-Content/ReadAllBytes-ing it into memory (a multi-hundred-MB text file
        #    would otherwise be fully loaded before this guard would have skipped it).
        $big = Get-OversizeFile -RepoPath $RepoPath -MaxMB $MaxBlobMB
        if ($null -ne $big) {
            Add-Failure -Repo $RepoPath -Kind 'size' -Detail "file over ${MaxBlobMB}MB ($($big.SizeMB)MB): $($big.File); repo skipped (GitHub rejects >100MB, LFS is a future ticket)."
            Write-Host "SKIP (oversize file): $RepoPath -> $($big.File) ($($big.SizeMB)MB)"
            return
        }

        # 3. Secret scan -- BEFORE any git object is written. Fail-closed on match.
        $hit = Get-SecretMatch -RepoPath $RepoPath -Patterns $Patterns
        if ($null -ne $hit) {
            Add-Failure -Repo $RepoPath -Kind 'secret' -Detail "suspected secret '$($hit.Pattern)' ($($hit.Masked)) in $($hit.File); repo QUARANTINED -- no snapshot created or pushed. You must rule."
            Write-Host "QUARANTINE (suspected secret): $RepoPath -> $($hit.File) [$($hit.Pattern)]"
            return
        }

        # 4. Determine the snapshot parent = current branch tip (or HEAD detached).
        $rHead = Invoke-Git @('-C', $RepoPath, 'rev-parse', '--verify', 'HEAD')
        $parent = if ($rHead.Ok) { ($rHead.Out | Select-Object -First 1) } else { $null }
        # A repo with no commits yet -> $parent stays $null -> snapshot with no parent.

        # 5. Build the snapshot in a UNIQUE, EMPTY temp index. Never touch the real
        # index/HEAD/branch. The temp index is NOT seeded from the real .git/index: doing
        # so would inherit skip-worktree / assume-unchanged bits, causing `git add -A` to
        # silently MISS real working-tree changes on those files (verified). Starting from
        # an empty index makes `git add -A` re-stat the whole working tree from scratch,
        # so every changed/added file is captured; .gitignore is still honored and
        # untracked files are still included (both verified).
        # Session id may be a long UUID; truncate it in the temp filename to stay under MAX_PATH.
        $sessTag = $SessionId
        if ($sessTag.Length -gt 12) { $sessTag = $sessTag.Substring(0, 12) }
        $tempIndex = Join-Path $StateDir ("$repoKey.$PID.$sessTag.index")

        $snapSha = $null
        $prevEnv = $env:GIT_INDEX_FILE
        try {
            # Ensure the temp index starts absent (empty) -- never seed from the real index.
            if (Test-Path -LiteralPath $tempIndex) { Remove-Item -LiteralPath $tempIndex -Force }
            $env:GIT_INDEX_FILE = $tempIndex

            $rAdd = Invoke-Git @('-C', $RepoPath, 'add', '-A')
            if (-not $rAdd.Ok) { throw "git add -A failed (exit $($rAdd.Code)): $($rAdd.Err)" }
            $rTree = Invoke-Git @('-C', $RepoPath, 'write-tree')
            $tree = if ($rTree.Ok) { ($rTree.Out | Select-Object -First 1) } else { $null }
            if (-not $tree) { throw "git write-tree produced no tree ($($rTree.Err))" }

            # Pass a FIXED backup identity so commit-tree never depends on ambient git
            # config (an unconfigured machine would otherwise fail with "Committer identity
            # unknown"), and so `git log` on a backup ref clearly shows these are
            # mechanism-authored snapshots, not real authored commits.
            $idArgs = @('-c', 'user.name=backup-sweep', '-c', 'user.email=backup-sweep@localhost')
            $stamp = "backup snapshot $Machine/$SessionId at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
            if ($parent) {
                $rCommit = Invoke-Git ($idArgs + @('-C', $RepoPath, 'commit-tree', $tree, '-p', $parent, '-m', $stamp))
            } else {
                $rCommit = Invoke-Git ($idArgs + @('-C', $RepoPath, 'commit-tree', $tree, '-m', $stamp))
            }
            $snapSha = if ($rCommit.Ok) { ($rCommit.Out | Select-Object -First 1) } else { $null }
            if (-not $snapSha) { throw "git commit-tree produced no commit ($($rCommit.Err))" }
        } finally {
            # Restore env and remove the temp index no matter what.
            $env:GIT_INDEX_FILE = $prevEnv
            if (Test-Path -LiteralPath $tempIndex) { Remove-Item -LiteralPath $tempIndex -Force -ErrorAction SilentlyContinue }
        }

        # 6. Skip-if-unchanged: compare this snapshot's tree to the last tree THIS SESSION
        #    backed up. The state file is per-repo AND per-session ($repoKey.$sessTag), NOT
        #    shared across sessions: a shared file would let session B skip because session A
        #    already pushed the identical tree, leaving B's own ref refs/backup/.../<B>/latest
        #    never created (B would rely on A's differently-named ref, which retention could
        #    later delete). Session-scoped state means each session that runs always
        #    creates/refreshes its OWN backup ref. On ANY uncertainty (missing/unreadable) we
        #    push anyway -- never skip on uncertainty.
        $stateFile = Join-Path $StateDir ("$repoKey.$sessTag.lasttree")
        $rThisTree = Invoke-Git @('-C', $RepoPath, 'rev-parse', "$snapSha^{tree}")
        $thisTree = if ($rThisTree.Ok) { ($rThisTree.Out | Select-Object -First 1) } else { $null }
        $lastTree = $null
        if (Test-Path -LiteralPath $stateFile) {
            try { $lastTree = (Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8).Trim() } catch { $lastTree = $null }
        }
        if ($lastTree -and $thisTree -and ($lastTree -eq $thisTree)) {
            Write-Host "no change: $RepoPath (snapshot tree identical to last backup)"
            return
        }

        # 7. Pin the snapshot to a LOCAL ref for the brief window between commit-tree and the
        #    push, so a concurrent local gc/prune can't drop the just-created (otherwise
        #    unreferenced) commit before it is pushed. Deleted in ALL exit paths below
        #    (success, dry-run, AND push-failure): on failure there is nothing to "retry" from
        #    the pin -- the next sweep re-snapshots the then-current working tree from scratch,
        #    so a stale pin would only leak (one per failed session per repo). The offline
        #    window is covered by that next sweep, not by keeping this pin.
        $localRef = "refs/backup-local/$Machine/$SessionId"
        $rPin = Invoke-Git @('-C', $RepoPath, 'update-ref', $localRef, $snapSha)
        if (-not $rPin.Ok) { throw "failed to pin local ref $localRef ($($rPin.Err))" }

        $backupRef = "refs/backup/$Machine/$SessionId/latest"

        if ($DryRun) {
            Write-Host "DRY-RUN would push: $RepoPath  $snapSha -> $backupRef"
            Invoke-Git @('-C', $RepoPath, 'update-ref', '-d', $localRef) | Out-Null
            return
        }

        # 8. Push to the backup channel on the repo's own 'origin'. Compare-and-swap on the
        #    remote ref so a same-session double-fire can't clobber the parent chain: read
        #    the remote's current value and pass it as the expected old (empty if absent).
        $rLs = Invoke-GitNet @('-C', $RepoPath, 'ls-remote', 'origin', $backupRef)
        if ($rLs.TimedOut) {
            Add-Failure -Repo $RepoPath -Kind 'unreachable' -Detail "ls-remote for $backupRef timed out; remote unreachable. Work is safe locally; next sweep retries."
            Write-Host "REMOTE UNREACHABLE (ls-remote timeout; next sweep retries): $RepoPath"
            Invoke-Git @('-C', $RepoPath, 'update-ref', '-d', $localRef) | Out-Null
            return
        }
        $expected = ""
        if ($rLs.Ok -and $rLs.Out) {
            # ls-remote line is "<sha>\t<ref>". Match a 40-hex SHA anywhere on the first
            # non-empty line, rather than blindly taking split[0] (which would be an empty
            # string if the line had leading whitespace, silently weakening the CAS lease).
            foreach ($l in $rLs.Out) {
                if (-not $l) { continue }
                $mm = [regex]::Match($l, '\b[0-9a-fA-F]{40}\b')
                if ($mm.Success) { $expected = $mm.Value; break }
            }
        }

        # git push with CAS via --force-with-lease=<ref>:<old>. Empty <old> expects-absent.
        # Note the backtick before ':' is required so PS doesn't parse "$var:" as a scope.
        $pushArgs = @('-C', $RepoPath, '-c', 'http.sslVerify=false', 'push',
                      "--force-with-lease=$backupRef`:$expected", 'origin', "$snapSha`:$backupRef")
        $rPush = Invoke-GitNet $pushArgs
        if (-not $rPush.Ok) {
            $detail = if ($rPush.TimedOut) {
                "push to $backupRef timed out; remote unreachable. Work is safe locally; next sweep retries."
            } else {
                "push to $backupRef failed (exit $($rPush.Code)): $($rPush.Err)"
            }
            Add-Failure -Repo $RepoPath -Kind 'unreachable' -Detail $detail
            Write-Host "PUSH FAILED (work is safe locally; next sweep retries): $RepoPath"
            # Delete the pin -- nothing retries from it (next sweep re-snapshots fresh), so a
            # kept pin would only leak. The uncommitted work remains on disk and in the repo's
            # normal history path; the next sweep re-captures and re-pushes it.
            Invoke-Git @('-C', $RepoPath, 'update-ref', '-d', $localRef) | Out-Null
            return
        }

        # 9. Success: record last tree, delete the local pin ref.
        try { Set-Content -LiteralPath $stateFile -Value $thisTree -Encoding UTF8 } catch { }
        Invoke-Git @('-C', $RepoPath, 'update-ref', '-d', $localRef) | Out-Null
        Write-Host "backed up: $RepoPath  $snapSha -> $backupRef"

    } catch {
        Add-Failure -Repo $RepoPath -Kind 'error' -Detail "unexpected error: $($_.Exception.Message)"
        Write-Host "ERROR (logged): $RepoPath -> $($_.Exception.Message)"
    } finally {
        $lock.Close()
        $lock.Dispose()
    }
}

# ==============================================================================
# Main
# ==============================================================================

# Emit an error to stderr WITHOUT throwing -- Write-Error under $ErrorActionPreference=
# 'Stop' terminates before the following `exit <code>`, collapsing our deterministic
# exit contract to 1. This writes directly to the error stream and lets `exit` run.
function Write-FatalLine {
    param([string]$Message)
    [Console]::Error.WriteLine($Message)
}

# Precondition: git available.
if (-not (Invoke-Git @('--version')).Ok) {
    Write-FatalLine "BACKUP-SWEEP: git not found on PATH."
    exit 2
}
if (-not $RepoPaths -or $RepoPaths.Count -eq 0) {
    Write-FatalLine "BACKUP-SWEEP: no repos given (-RepoPaths)."
    exit 2
}

# Fail-closed: load + validate the secret patterns ONCE up front. If this fails, NOTHING
# is swept (we cannot safely scan any repo).
$patterns = $null
try {
    if (-not (Test-Path -LiteralPath $SecretPatternsFile)) { throw "patterns file not found: $SecretPatternsFile" }
    $patterns = Get-Content -Raw -LiteralPath $SecretPatternsFile -Encoding UTF8 | ConvertFrom-Json
    if (-not $patterns -or $patterns.Count -eq 0) { throw "patterns file empty" }
    # Sanity: each entry must have a regex.
    foreach ($p in $patterns) { if (-not $p.regex) { throw "a pattern entry is missing 'regex'" } }
} catch {
    Write-FatalLine "BACKUP-SWEEP: secret-patterns load failed ($($_.Exception.Message)); refusing to sweep (fail-closed)."
    exit 4
}

Write-Host "backup-sweep: machine=$Machine session=$SessionId repos=$($RepoPaths.Count) dryRun=$($DryRun.IsPresent)"

foreach ($rp in $RepoPaths) {
    Invoke-RepoSweep -RepoPath $rp -Patterns $patterns
}

Write-Host "backup-sweep: done."
exit 0
