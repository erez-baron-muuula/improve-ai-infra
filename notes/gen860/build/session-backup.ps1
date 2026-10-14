# session-backup.ps1 -- GEN-860: add-only copy of Claude session history to the Drive backup.
#
# Copies two trees into the Drive backup folder:
#   <ProjectsSource>  (~/.claude/projects: session transcripts, subagent transcripts, side files, memory)
#   <SessionsSource>  (%APPDATA%/Claude/claude-code-sessions: the desktop app's per-account session lists)
# into <BackupRoot>\projects and <BackupRoot>\claude-code-sessions.
#
# Run by the SessionStart hook sessionstart-session-backup.js (throttled there), or by hand.
# -ReportOnly lists what a run would do; it writes no backup, queue or state content (it only creates
# the state folder and its empty run.lock, so a real run cannot start at the same moment).
#
# RULES (GEN-860 requirements):
#   - Add-only. Nothing in the backup is ever deleted and local deletions are never mirrored. The only
#     files this script removes are its own unfinished swap files (*.sbtmp, *.sbold) in the two mirror
#     trees -- see Repair-SwapFiles -- and the superseded old copy at the end of each swap.
#   - Every decision is made on the bytes actually copied (the new content is first written to
#     <dst>.sbtmp and checked there), so a file that changes while it is being read cannot slip past.
#   - A damaged local file never silently replaces a good backup copy:
#       * .jsonl transcripts only grow. If the new copy is shorter than the backup copy, or the backup
#         copy's last 4 KB no longer match the new copy at the same position (earlier content changed),
#         the backup copy is first saved to <BackupRoot>\_previous-versions\<run stamp>\<tree>\<rel path>,
#         then replaced, and Erez is told (kind session-shrunk).
#       * An empty new copy, or a .json file that no longer ends in } or ] (cut off), never replaces a
#         non-empty backup copy; Erez is told once (kind session-held).
#       * Any other file that gets shorter has the backup copy saved to _previous-versions first
#         (silently: renamed titles and edited memory notes shrink normally). In claude-code-sessions
#         (session lists the desktop app rewrites all day) this happens at most once per file per day,
#         so they do not pile up copies; there a second shrink the same day replaces without a copy.
#   - A transcript whose size is unchanged and whose first and last 4 KB match the backup copy is not
#     copied again; only the backup copy's modified time is updated (bulk date changes stay cheap).
#   - A replacement never leaves a truncated backup copy: dst -> dst.sbold, sbtmp -> dst, delete sbold.
#     A kill at any point leaves the full old or the full new content; the next run's Repair-SwapFiles
#     finishes or undoes the swap.
#   - Paths over 260 characters: every file-system call uses the \\?\ prefix.
#   - The backup root must already exist and is never created, so a missing G: drive or a moved folder
#     cannot start a new backup somewhere else. Missing root = exit 14 with no record (Drive is often not
#     mounted yet right after boot); a lasting outage is caught by the surfacer's 24 h staleness line.
#   - Short: copying stops once BudgetSeconds have elapsed (checked between files, newest changes first);
#     the rest is copied next run.
#   - If DropAlertCount or more top-level session transcripts that were active within the last RecentDays
#     days disappear from the PC between two runs, Erez is told (kind session-files-dropped): the backup
#     still holds them, but an unexpected local deletion is exactly the loss GEN-860 exists to catch.
#     Older transcripts are not counted, because Claude Code's own retention cleanup removes them.
#
# Problems are appended to the shared backup failure queue (~/.claude/backup-sweep-failures.jsonl, same
# record shape and append method as backup-sweep.ps1's Add-Failure) and shown at the next session start
# by sessionstart-backup-surfacer.js, which also warns when last-success falls more than 24 h behind the
# newest session transcript change and when recent runs were slow. runs.log holds one line per run.
#
# EXIT CODES (contract with sessionstart-session-backup.js):
#   0  complete; last-success stamped (notices may have been recorded)
#   10 problems found and recorded in the failure queue (or identical to the last recorded summary)
#   11 another run holds the lock; skipped (benign)
#   12 budget reached before every file was checked; not stamped; next run continues (benign)
#   13 a problem was found but could not be recorded -> the hook records it
#   14 backup root not reachable (G: not mounted / folder missing); nothing recorded; the hook back-dates
#      its throttle stamp so a session start 5 or more minutes later retries
#   any other code (PowerShell itself failed, e.g. a blocked script) -> the hook records it
#
# ASCII only (PowerShell 5.1 reads .ps1 files without a BOM as Windows-1252).

[CmdletBinding()]
param(
    [string]$SessionId = 'manual',
    [string]$ProjectsSource = (Join-Path $env:USERPROFILE '.claude\projects'),
    [string]$SessionsSource = (Join-Path $env:APPDATA 'Claude\claude-code-sessions'),
    [string]$BackupRoot = 'G:\My Drive\AI Projects\_Tooling\Claude Session Backup',
    [string]$StateDir = (Join-Path $env:USERPROFILE '.claude\session-backup-state'),
    [string]$FailureQueueFile = (Join-Path $env:USERPROFILE '.claude\backup-sweep-failures.jsonl'),
    [int]$BudgetSeconds = 20,
    [int]$DropAlertCount = 10,
    [int]$RecentDays = 25,
    [switch]$ReportOnly
)

$ErrorActionPreference = 'Stop'
$script:Clock = [System.Diagnostics.Stopwatch]::StartNew()
$script:RecordFailed = $false
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$RunStamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$TailBytes = 4096
$MtimeToleranceSeconds = 2

# NOTE on helper names: PowerShell resolves aliases before functions, so every helper has a Verb-Noun
# name (a short name such as "lp" is the built-in alias of Out-Printer).

function Get-LongPath([string]$p) {
    if ($p.StartsWith('\\?\')) { return $p }
    return '\\?\' + $p
}

function Add-Line([string]$file, [string]$line) {
    # UTF-8 without BOM, write-exclusive open with a short retry, one write per line
    # (same approach and reasons as backup-sweep.ps1 Add-Failure).
    $payload = $script:Utf8NoBom.GetBytes($line + "`n")
    $attempt = 0
    while ($true) {
        try {
            $fs = [System.IO.File]::Open($file, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
            try { $fs.Write($payload, 0, $payload.Length) } finally { $fs.Dispose() }
            return
        } catch [System.IO.IOException] {
            $attempt++
            if ($attempt -ge 50) { throw }
            Start-Sleep -Milliseconds 100
        }
    }
}

function Add-QueueRecord([string]$Kind, [string]$Detail) {
    if ($ReportOnly) { Write-Host "WOULD RECORD [$Kind] $Detail"; return $true }
    try {
        $rec = [ordered]@{
            ts       = (Get-Date -Format 'o')
            machine  = $env:COMPUTERNAME
            session  = $SessionId
            repo     = '(session backup)'
            kind     = $Kind
            detail   = $Detail
            surfaced = $false
        }
        Add-Line $FailureQueueFile ($rec | ConvertTo-Json -Compress -Depth 5)
        return $true
    } catch {
        $script:RecordFailed = $true
        return $false
    }
}

function Write-RunLog([hashtable]$Fields) {
    if ($ReportOnly) { return }
    try {
        $rec = [ordered]@{ ts = (Get-Date -Format 'o'); session = $SessionId; ms = [int]$script:Clock.ElapsedMilliseconds }
        foreach ($k in $Fields.Keys) { $rec[$k] = $Fields[$k] }
        Add-Line (Join-Path $StateDir 'runs.log') ($rec | ConvertTo-Json -Compress -Depth 5)
    } catch { }   # informational only
}

function Write-StateText([string]$name, [string]$text) {
    if ($ReportOnly) { return }
    [System.IO.File]::WriteAllText((Join-Path $StateDir $name), $text, $script:Utf8NoBom)
}

# Lists every file under $root (relative path -> FileInfo). Reparse-point directories (junctions,
# symlinks) are not followed, so a link loop cannot hang the run.
function Get-FileMap([string]$root) {
    $map = @{}
    $prefixLen = (Get-LongPath $root).TrimEnd('\').Length + 1
    $stack = New-Object System.Collections.Stack
    $stack.Push((New-Object System.IO.DirectoryInfo (Get-LongPath $root)))
    while ($stack.Count -gt 0) {
        $dir = $stack.Pop()
        foreach ($f in $dir.EnumerateFiles('*', [System.IO.SearchOption]::TopDirectoryOnly)) {
            $map[$f.FullName.Substring($prefixLen)] = $f
        }
        foreach ($d in $dir.EnumerateDirectories('*', [System.IO.SearchOption]::TopDirectoryOnly)) {
            if (($d.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) { $stack.Push($d) }
        }
    }
    return $map
}

# Finish or undo swaps an earlier run left half-done (process killed between the renames):
#   x.sbold with x missing -> the old copy is the only copy: rename it back.
#   x.sbold with x present -> the new copy landed: the old one is superseded, remove it.
#   x.sbtmp               -> an unfinished copy: remove it.
function Repair-SwapFiles([hashtable]$dstMap, [string]$dstRoot) {
    $changed = $false
    foreach ($rel in @($dstMap.Keys)) {
        $isOld = $rel.EndsWith('.sbold'); $isTmp = $rel.EndsWith('.sbtmp')
        if (-not ($isOld -or $isTmp)) { continue }
        $changed = $true
        if ($ReportOnly) { Write-Host "WOULD REPAIR $rel"; continue }
        $full = Get-LongPath (Join-Path $dstRoot $rel)
        if ($isOld) {
            $base = $rel.Substring(0, $rel.Length - 6)
            if ($dstMap.ContainsKey($base)) { [System.IO.File]::Delete($full) }
            else { [System.IO.File]::Move($full, (Get-LongPath (Join-Path $dstRoot $base))) }
        } else {
            [System.IO.File]::Delete($full)
        }
    }
    return $changed
}

function Read-Range([string]$path, [long]$offset, [int]$count) {
    $buf = New-Object byte[] $count
    $fs = New-Object System.IO.FileStream($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, ([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete))
    try {
        [void]$fs.Seek($offset, [System.IO.SeekOrigin]::Begin)
        $got = 0
        while ($got -lt $count) {
            $n = $fs.Read($buf, $got, $count - $got)
            if ($n -le 0) { break }
            $got += $n
        }
        if ($got -ne $count) { throw "short read ($got of $count bytes) at offset $offset" }
    } finally { $fs.Dispose() }
    return ,$buf
}

function Test-BytesEqual([byte[]]$a, [byte[]]$b) {
    if ($a.Length -ne $b.Length) { return $false }
    for ($i = 0; $i -lt $a.Length; $i++) { if ($a[$i] -ne $b[$i]) { return $false } }
    return $true
}

# True when $newPath still starts with the backup copy's content, judged by the backup's last
# TailBytes bytes at the same position (transcripts only grow; a mismatch means earlier content changed).
function Test-TailMatches([string]$newPath, [long]$newLen, [System.IO.FileInfo]$dst) {
    if ($newLen -lt $dst.Length) { return $false }
    $n = [int][Math]::Min([long]$TailBytes, $dst.Length)
    if ($n -le 0) { return $true }
    $off = $dst.Length - $n
    return (Test-BytesEqual (Read-Range $dst.FullName $off $n) (Read-Range $newPath $off $n))
}

# Same length, first and last TailBytes equal: treated as the same transcript content.
function Test-SameEnds([System.IO.FileInfo]$src, [System.IO.FileInfo]$dst) {
    $n = [int][Math]::Min([long]$TailBytes, $src.Length)
    if ($n -le 0) { return $true }
    if (-not (Test-BytesEqual (Read-Range $src.FullName 0 $n) (Read-Range $dst.FullName 0 $n))) { return $false }
    $off = $src.Length - $n
    return (Test-BytesEqual (Read-Range $src.FullName $off $n) (Read-Range $dst.FullName $off $n))
}

# True when a .json file's last non-whitespace byte is } or ] (a cut-off write usually is not).
function Test-JsonLooksWhole([string]$path, [long]$len) {
    $n = [int][Math]::Min(64L, $len)
    if ($n -le 0) { return $false }
    $tail = Read-Range $path ($len - $n) $n
    for ($i = $n - 1; $i -ge 0; $i--) {
        $c = $tail[$i]
        if ($c -eq 0x20 -or $c -eq 0x09 -or $c -eq 0x0A -or $c -eq 0x0D) { continue }
        return ($c -eq 0x7D -or $c -eq 0x5D)
    }
    return $false
}

# Copies $from (read with full sharing, so a file a running session is writing can be read) to a new
# file $to. Returns the number of bytes written.
function Copy-Bytes([string]$from, [string]$to) {
    $in = New-Object System.IO.FileStream($from, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, ([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete))
    try {
        $out = New-Object System.IO.FileStream($to, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        try { $in.CopyTo($out, 1048576); $out.Flush($true); $written = $out.Length } finally { $out.Dispose() }
    } finally { $in.Dispose() }
    return $written
}

# Writes $fromFull to <toFull>.sbtmp (so an interrupted copy never sits under the real name), checks
# the written length, and returns the temp path.
function Write-ViaTemp([string]$fromFull, [string]$toFull, [DateTime]$mtimeUtc) {
    $tmp = $toFull + '.sbtmp'
    [void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($toFull))
    try {
        $written = Copy-Bytes $fromFull $tmp
        [System.IO.File]::SetLastWriteTimeUtc($tmp, $mtimeUtc)
        $onDisk = (New-Object System.IO.FileInfo($tmp)).Length
        if ($onDisk -ne $written) { throw "temp copy is $onDisk bytes, wrote $written" }
    } catch {
        try { [System.IO.File]::Delete($tmp) } catch { }
        throw
    }
    return $tmp
}

# Swaps a finished temp copy in at $dstFull without ever leaving the backup without a full copy.
function Install-Temp([string]$tmp, [string]$dstFull) {
    $old = $dstFull + '.sbold'
    if ([System.IO.File]::Exists($dstFull)) {
        [System.IO.File]::Move($dstFull, $old)
        try { [System.IO.File]::Move($tmp, $dstFull) }
        catch {
            try { [System.IO.File]::Move($old, $dstFull) } catch { }
            try { [System.IO.File]::Delete($tmp) } catch { }
            throw
        }
        # The new copy is in place; removing the superseded one is best-effort (the next run's
        # Repair-SwapFiles removes a leftover .sbold), so a failure here cannot lose a notice or a retry.
        try { [System.IO.File]::Delete($old) } catch { }
    } else {
        [System.IO.File]::Move($tmp, $dstFull)
    }
}

# Saves the current backup copy under _previous-versions (via a temp file) before it is replaced.
function Save-PreviousVersion([string]$tree, [string]$rel, [System.IO.FileInfo]$dst) {
    $prev = Join-Path (Join-Path (Join-Path (Join-Path $BackupRoot '_previous-versions') $RunStamp) $tree) $rel
    $prevFull = Get-LongPath $prev
    if ([System.IO.File]::Exists($prevFull)) {
        # Kept already by an earlier attempt in this same run (the swap after it failed and was retried).
        if ((New-Object System.IO.FileInfo($prevFull)).Length -eq $dst.Length) { return $prev }
        throw "previous-version path already exists with different content: $prev"
    }
    $tmp = Write-ViaTemp $dst.FullName $prevFull $dst.LastWriteTimeUtc
    if ((New-Object System.IO.FileInfo($tmp)).Length -ne $dst.Length) {
        try { [System.IO.File]::Delete($tmp) } catch { }
        throw "previous-version copy does not match the backup copy's size ($($dst.Length) bytes)"
    }
    [System.IO.File]::Move($tmp, $prevFull)
    return $prev
}

# True when an older copy of this (non-transcript) file was already kept in _previous-versions today,
# so files the app rewrites many times a day (session lists, titles) keep at most one older copy per day.
$script:KeptTodayDirs = $null
function Test-KeptToday([string]$tree, [string]$rel) {
    if ($null -eq $script:KeptTodayDirs) {
        $script:KeptTodayDirs = New-Object System.Collections.ArrayList
        $pv = Get-LongPath (Join-Path $BackupRoot '_previous-versions')
        $today = $RunStamp.Substring(0, 8)
        if ([System.IO.Directory]::Exists($pv)) {
            foreach ($dir in ([System.IO.DirectoryInfo]$pv).EnumerateDirectories($today + '-*')) { [void]$script:KeptTodayDirs.Add($dir.FullName) }
        }
        $own = Get-LongPath (Join-Path (Join-Path $BackupRoot '_previous-versions') $RunStamp)
        if (-not $script:KeptTodayDirs.Contains($own)) { [void]$script:KeptTodayDirs.Add($own) }
    }
    foreach ($dir in $script:KeptTodayDirs) {
        if ([System.IO.File]::Exists([System.IO.Path]::Combine($dir, $tree, $rel))) { return $true }
    }
    return $false
}

function Get-Lines([string]$name) {
    $set = @{}
    $f = Join-Path $StateDir $name
    if ([System.IO.File]::Exists($f)) {
        foreach ($l in [System.IO.File]::ReadAllLines($f)) { if ($l) { $set[$l] = $true } }
    }
    return $set
}

# Runs $action, retrying twice on an IOException (a sharing violation from a writer or from Drive). A
# not-found is retried only while the source still exists (an app replacing the file by rename, or the
# Drive side); a source that is really gone is passed straight up as vanished.
function Invoke-WithRetry([scriptblock]$action, [string]$srcPath) {
    $attempt = 0
    while ($true) {
        try { return (& $action) }
        catch [System.IO.FileNotFoundException], [System.IO.DirectoryNotFoundException] {
            $attempt++
            if ($attempt -ge 3 -or -not [System.IO.File]::Exists($srcPath)) { throw }
            Start-Sleep -Milliseconds 250
        }
        catch [System.IO.IOException] {
            $attempt++
            if ($attempt -ge 3) { throw }
            Start-Sleep -Milliseconds 250
        }
    }
}

# Handles one file. Returns 'skip', 'touched', 'copied', 'preserved' or 'held'.
function Sync-One($w, [hashtable]$heldSeen) {
    $s = $w.src; $d = $w.dst; $rel = $w.rel
    $isTranscript = $rel.EndsWith('.jsonl', [System.StringComparison]::OrdinalIgnoreCase)
    if ($null -ne $d -and $s.Length -eq $d.Length) {
        if ([Math]::Abs(($s.LastWriteTimeUtc - $d.LastWriteTimeUtc).TotalSeconds) -le $MtimeToleranceSeconds) { return 'skip' }
        if ($isTranscript -and (Test-SameEnds $s $d)) {
            if ($ReportOnly) { Write-Host "WOULD TOUCH $($w.tree)\$rel"; return 'touched' }
            [System.IO.File]::SetLastWriteTimeUtc($d.FullName, $s.LastWriteTimeUtc)
            return 'touched'
        }
    }
    $dstFull = Get-LongPath (Join-Path $w.dstRoot $rel)
    if ($ReportOnly) {
        # Decide on the source as it is now (no temp copy is written in report mode).
        $newPath = $s.FullName; $newLen = $s.Length
    } else {
        $newPath = Write-ViaTemp $s.FullName $dstFull $s.LastWriteTimeUtc
        $newLen = (New-Object System.IO.FileInfo($newPath)).Length
    }
    if ($ReportOnly) { return (Get-Decision $w $newPath $newLen $dstFull $heldSeen) }
    # From here on the temp copy exists: whatever happens, it must not be left behind.
    try {
        return (Get-Decision $w $newPath $newLen $dstFull $heldSeen)
    } catch {
        try { if ([System.IO.File]::Exists($newPath)) { [System.IO.File]::Delete($newPath) } } catch { }
        throw
    }
}

# Decides and applies the change for one file whose new content is at $newPath ($newLen bytes).
function Get-Decision($w, [string]$newPath, [long]$newLen, [string]$dstFull, [hashtable]$heldSeen) {
    $d = $w.dst; $rel = $w.rel
    $isTranscript = $rel.EndsWith('.jsonl', [System.StringComparison]::OrdinalIgnoreCase)
    $isJson = $rel.EndsWith('.json', [System.StringComparison]::OrdinalIgnoreCase)
    # The listing said "no backup copy" but one exists now: judge against it, never overwrite it blind.
    if ($null -eq $d -and [System.IO.File]::Exists($dstFull)) { $d = New-Object System.IO.FileInfo($dstFull) }
    if ($null -eq $d) {
        if ($ReportOnly) { Write-Host "WOULD COPY (new) $($w.tree)\$rel"; return 'copied' }
        Install-Temp $newPath $dstFull
        return 'copied'
    }
    $why = $null
    if ($d.Length -gt 0 -and $newLen -eq 0) { $why = 'is empty' }
    elseif ($d.Length -gt 0 -and $isJson -and -not (Test-JsonLooksWhole $newPath $newLen)) { $why = 'looks cut off (does not end in } or ])' }
    if ($why) {
        if (-not $ReportOnly) { try { [System.IO.File]::Delete($newPath) } catch { } }
        $key = $w.tree + '\' + $rel + '|' + $newLen + '|' + $d.Length
        if (-not $heldSeen.ContainsKey($key)) {
            $ok = Add-QueueRecord 'session-held' ("backup copy kept, not replaced: $($w.tree)\$rel $why on this PC ($newLen bytes; backup copy $($d.Length) bytes)")
            if ($ok -and -not $ReportOnly) { Add-Line (Join-Path $StateDir 'held-alerted.txt') $key; $heldSeen[$key] = $true }
        }
        return 'held'
    }
    if ($isTranscript) { $preserve = -not (Test-TailMatches $newPath $newLen $d) }
    elseif ($w.tree -eq 'claude-code-sessions') { $preserve = ($newLen -lt $d.Length) -and -not (Test-KeptToday $w.tree $rel) }
    else { $preserve = ($newLen -lt $d.Length) }
    if ($ReportOnly) {
        if ($preserve) { Write-Host "WOULD KEEP OLDER COPY, THEN REPLACE $($w.tree)\$rel ($newLen bytes now, backup $($d.Length))"; return 'preserved' }
        Write-Host "WOULD REPLACE $($w.tree)\$rel"; return 'copied'
    }
    if ($preserve) {
        $prev = Save-PreviousVersion $w.tree $rel $d
        Install-Temp $newPath $dstFull
        if ($isTranscript) {
            [void](Add-QueueRecord 'session-shrunk' ("older backup copy kept at $prev -- $($w.tree)\$rel on this PC is shorter than its backup copy or its earlier content changed ($newLen bytes now, backup had $($d.Length))"))
        }
        return 'preserved'
    }
    Install-Temp $newPath $dstFull
    return 'copied'
}

# ---------------------------------------------------------------- main
# Main body as a function so that every "return" below still reaches the exit at the end of the file
# (a bare return at script level would end the script with exit code 0).
$script:Code = 0
function Invoke-Main {
    $lock = $null
    $counts = @{ touched = 0; copied = 0; preserved = 0; held = 0; vanished = 0; errors = 0; repaired = 0 }
    $errors = New-Object System.Collections.ArrayList
    $problems = New-Object System.Collections.ArrayList
    $incomplete = $false
    $script:Code = 0
    try {
        try {
            [void][System.IO.Directory]::CreateDirectory($StateDir)
            $lock = [System.IO.File]::Open((Join-Path $StateDir 'run.lock'), [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
        } catch [System.IO.IOException] {
            Write-RunLog @{ outcome = 'skipped: another run holds the lock' }
            $script:Code = 11
            return
        }

        if (-not [System.IO.Directory]::Exists((Get-LongPath $BackupRoot))) {
            Write-RunLog @{ outcome = 'skipped: backup folder not reachable'; detail = $BackupRoot }
            if ($ReportOnly) { Write-Host "backup folder not reachable: $BackupRoot" }
            $script:Code = 14
            return
        }

        $trees = New-Object System.Collections.ArrayList
        foreach ($t in @(
                @{ name = 'projects'; src = $ProjectsSource; dst = (Join-Path $BackupRoot 'projects') },
                @{ name = 'claude-code-sessions'; src = $SessionsSource; dst = (Join-Path $BackupRoot 'claude-code-sessions') })) {
            if ([System.IO.Directory]::Exists((Get-LongPath $t.src))) { [void]$trees.Add($t) }
            else { [void]$problems.Add("source folder not found: $($t.src)") }
        }
        $heldSeen = Get-Lines 'held-alerted.txt'

        # An unfinished keep-older-copy step (killed mid-copy) leaves <name>.sbtmp in _previous-versions;
        # it is never a real older copy, so remove it.
        try {
            $pvRoot = Get-LongPath (Join-Path $BackupRoot '_previous-versions')
            if ([System.IO.Directory]::Exists($pvRoot)) {
                # Only run folders from the last 7 days: an unfinished copy is found by the next run, and
                # the folder only grows, so scanning all of it would slow every run over time.
                $since = (Get-Date).AddDays(-7).ToString('yyyyMMdd-HHmmss')
                foreach ($runDir in ([System.IO.DirectoryInfo]$pvRoot).EnumerateDirectories()) {
                    if ([string]::CompareOrdinal($runDir.Name, $since) -lt 0) { continue }
                    foreach ($f in $runDir.EnumerateFiles('*.sbtmp', [System.IO.SearchOption]::AllDirectories)) {
                        if ($ReportOnly) { Write-Host "WOULD REMOVE unfinished $($f.FullName)" } else { $f.Delete() }
                        $counts.repaired++
                    }
                }
            }
        } catch {
            [void]$problems.Add("could not tidy _previous-versions: $($_.Exception.Message)")
        }

        # Work list across the trees, newest local change first, so a run cut short by the budget has
        # covered the files most likely to be missing from the backup.
        $work = New-Object System.Collections.ArrayList
        $transcripts = $null
        $fileCount = 0
        foreach ($t in $trees) {
            try {
                if (-not $ReportOnly) { [void][System.IO.Directory]::CreateDirectory((Get-LongPath $t.dst)) }
                $srcMap = Get-FileMap $t.src
                if ($srcMap.Count -eq 0) { [void]$problems.Add("source folder is empty: $($t.src)"); continue }
                # A normal run lists the backup side unconditionally (its folder was just created above), so
                # a listing failure throws instead of silently looking like an empty backup.
                $dstMap = @{}
                if (-not $ReportOnly -or [System.IO.Directory]::Exists((Get-LongPath $t.dst))) { $dstMap = Get-FileMap $t.dst }
                if (Repair-SwapFiles $dstMap $t.dst) {
                    $counts.repaired++
                    if (-not $ReportOnly) { $dstMap = Get-FileMap $t.dst }
                }
                if ($t.name -eq 'projects') {
                    $transcripts = @{}
                    foreach ($k in $srcMap.Keys) { if ($k -match '^[^\\]+\\[^\\]+\.jsonl$') { $transcripts[$k] = $srcMap[$k].LastWriteTimeUtc.Ticks } }
                }
                $fileCount += $srcMap.Count
                foreach ($rel in $srcMap.Keys) {
                    # Unchanged files (same size, same modified time) are dropped here, before any
                    # per-file function call or sort -- that is what keeps a run over ~7,000 files short.
                    $s = $srcMap[$rel]; $d = $dstMap[$rel]
                    if ($null -ne $d -and $s.Length -eq $d.Length -and
                        [Math]::Abs(($s.LastWriteTimeUtc - $d.LastWriteTimeUtc).TotalSeconds) -le $MtimeToleranceSeconds) { continue }
                    [void]$work.Add(@{ tree = $t.name; dstRoot = $t.dst; rel = $rel; src = $s; dst = $d })
                }
            } catch {
                [void]$problems.Add("could not list $($t.name): $($_.Exception.Message)")
            }
        }

        # Unexpected local deletion check (top-level transcripts only). Claude Code's own retention cleanup
        # removes transcripts idle for cleanupPeriodDays (30 by default; desktop-app sessions are exempt),
        # so only transcripts active within the last RecentDays count: retention never removes those, and
        # 10 or more of them vanishing between two runs is the kind of loss GEN-860 exists to catch.
        if ($null -ne $transcripts) {
            $listFile = Join-Path $StateDir 'transcripts.txt'
            if ([System.IO.File]::Exists($listFile)) {
                $recentCutoff = [DateTime]::UtcNow.AddDays(-$RecentDays).Ticks
                $gone = 0
                foreach ($line in [System.IO.File]::ReadAllLines($listFile)) {
                    $parts = $line.Split('|')
                    if ($parts.Count -ne 2) { continue }
                    $ticks = 0L
                    if ([long]::TryParse($parts[1], [ref]$ticks) -and $ticks -gt $recentCutoff -and -not $transcripts.ContainsKey($parts[0])) { $gone++ }
                }
                if ($gone -ge $DropAlertCount) {
                    [void](Add-QueueRecord 'session-files-dropped' ("$gone session transcripts active within the last $RecentDays days disappeared from this PC since the last backup run; the Drive backup still holds them"))
                }
            }
            Write-StateText 'transcripts.txt' ((($transcripts.GetEnumerator() | ForEach-Object { $_.Key + '|' + $_.Value }) -join "`n") + "`n")
        }

        $ordered = @($work | Sort-Object -Property @{ Expression = { $_.src.LastWriteTimeUtc }; Descending = $true })
        foreach ($w in $ordered) {
            if ($script:Clock.Elapsed.TotalSeconds -ge $BudgetSeconds) { $incomplete = $true; break }
            try {
                $r = Invoke-WithRetry { Sync-One $w $heldSeen } $w.src.FullName
                if ($r -ne 'skip') { $counts[$r]++ }
            } catch [System.IO.FileNotFoundException], [System.IO.DirectoryNotFoundException] {
                # Only a SOURCE that is really gone counts as vanished (deleted on the PC between listing
                # and copying; the backup keeps its copy). A not-found on the Drive side (Drive restarting,
                # a path the drive rejects) is an error, so the run is not marked a success.
                if (-not [System.IO.File]::Exists($w.src.FullName)) { $counts.vanished++ }
                else {
                    $counts.errors++
                    if ($errors.Count -lt 5) { [void]$errors.Add("$($w.tree)\$($w.rel) ($($_.Exception.Message))") }
                }
            } catch {
                $counts.errors++
                if ($errors.Count -lt 5) { [void]$errors.Add("$($w.tree)\$($w.rel) ($($_.Exception.Message))") }
            }
        }

        $fields = @{ files = $fileCount; changed = $ordered.Count; touched = $counts.touched; copied = $counts.copied; preserved = $counts.preserved; held = $counts.held; vanished = $counts.vanished; errors = $counts.errors; repaired = $counts.repaired }
        if ($ReportOnly) {
            Write-Host ("REPORT: " + (($fields.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join ' ') + " problems=" + ($problems -join '; ') + " incomplete=$incomplete ms=$($script:Clock.ElapsedMilliseconds)")
            $script:Code = 0
            return
        }
        $lastFile = Join-Path $StateDir 'last-error.txt'
        if ($problems.Count -gt 0 -or $counts.errors -gt 0) {
            $summary = @()
            if ($problems.Count -gt 0) { $summary += ($problems -join '; ') }
            if ($counts.errors -gt 0) { $summary += ("$($counts.errors) file(s) could not be copied; first: " + ($errors -join '; ')) }
            $text = 'session backup incomplete: ' + ($summary -join ' | ')
            # The same problem run after run is recorded once; the staleness line keeps reporting it.
            $last = $null
            if ([System.IO.File]::Exists($lastFile)) { $last = [System.IO.File]::ReadAllText($lastFile) }
            if ($last -ne $text) {
                if (Add-QueueRecord 'error' $text) { Write-StateText 'last-error.txt' $text }
            }
            $fields.outcome = 'problems'; $fields.detail = $text
            Write-RunLog $fields
            $script:Code = 10
            return
        }
        if ($incomplete) {
            $fields.outcome = 'incomplete (budget reached)'
            Write-RunLog $fields
            $script:Code = 12
            return
        }

        # Complete: stamp last-success (temp file, then swap; [NullString]::Value because PowerShell turns
        # $null into "" for a string argument, which File.Replace rejects).
        $stampFile = Join-Path $StateDir 'last-success'
        $stampTmp = $stampFile + '.tmp'
        [System.IO.File]::WriteAllText($stampTmp, [string][long]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()), $script:Utf8NoBom)
        if ([System.IO.File]::Exists($stampFile)) { [System.IO.File]::Replace($stampTmp, $stampFile, [NullString]::Value) }
        else { [System.IO.File]::Move($stampTmp, $stampFile) }
        if ([System.IO.File]::Exists($lastFile)) { [System.IO.File]::Delete($lastFile) }   # a clean, complete run ends the dedupe
        $fields.outcome = 'complete'
        Write-RunLog $fields
        $script:Code = 0
    } catch {
        $msg = $_.Exception.Message
        [void](Add-QueueRecord 'error' ('session backup failed: ' + $msg))
        Write-RunLog @{ outcome = 'failed'; detail = $msg }
        if ($ReportOnly) { Write-Host "FAILED: $msg" }
        $script:Code = 10
    } finally {
        if ($null -ne $lock) { $lock.Dispose() }
    }
}

Invoke-Main
if ($script:RecordFailed -and $script:Code -ne 11 -and $script:Code -ne 14) { $script:Code = 13 }
exit $script:Code
