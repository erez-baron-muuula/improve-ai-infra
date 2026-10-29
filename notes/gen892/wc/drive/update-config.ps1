# update-config.ps1 -- Atomic, OS-locked edit of any managed Claude config file. (GEN-103)
#
# Generalizes update-global-rule.ps1 (which was CLAUDE.md-only) to every shared
# config file. A SINGLE global lock serializes all config edits on this machine,
# so no two sessions can interleave a read-change-write. Before editing it pulls
# the latest from Drive; after editing it pushes back to Drive + git history.
#
# Why one global lock (not per-file): sync.ps1 copies and commits the WHOLE managed
# set on every push, so two concurrent edits to different files would still clobber
# each other through the whole-set sync. One lock removes that race entirely.
#
# The pre-edit pull (Step 2) is now non-destructive to any other in-session local
# edit not yet pushed (GEN-355) -- sync.ps1's To-Claude direction compares each
# file's content against a local baseline rather than blindly overwriting. See
# sync.ps1's header for the full mechanism.
#
# Operations:
#   text-replace   : find OldText, replace with NewText (markdown / rules files)
#   add-allow      : add an entry to permissions.allow in a JSON file (idempotent)
#   remove-allow   : remove an entry from permissions.allow in a JSON file (idempotent)
#   write-file     : overwrite the whole target with the contents of -ContentFile
#
# Usage:
#   .\update-config.ps1 -File <pathOrName> -Op text-replace -OldText "..." -NewText "..."
#   .\update-config.ps1 -File settings.json -Op add-allow    -Entry "Bash(npm test:*)"
#   .\update-config.ps1 -File settings.json -Op remove-allow -Entry "Bash(npm test:*)"
#   .\update-config.ps1 -File <pathOrName> -Op write-file -ContentFile "C:\tmp\new.md"
#
# -File accepts a short logical name (CLAUDE.md, settings.json, settings.local.json,
# auto-approve.js, MEMORY.md, user_profile.md, feedback_behavior.md) or a full path.
#
# Exit codes:
#   0 = success
#   1 = another session holds the lock (after retries)
#   2 = target not found / OldText not found / bad arguments
#   3 = no change made (OldText == NewText, or JSON entry already in desired state)
#   4 = sync to/from Drive failed (includes sync.ps1 exit 6 -- gave up waiting on ITS
#       OWN concurrency lock; treat identically to any other sync failure: nothing
#       was pulled/pushed, so the edit was correctly aborted rather than proceeding
#       on stale state -- GEN-353)
#   5 = pending-sync marker found: a previous edit was written locally but never pushed to Drive
#   6 = size stop (GEN-674): the write would take the global CLAUDE.md over its line limit without
#       Erez's approval; nothing was written
#
# -SizeApproval "ApproveSizeUpTo=<N>" -SizeOkQuote "<Erez's answer>" (GEN-674): needed only when a
# text-replace or write-file would take the always-loaded global CLAUDE.md past its line limit
# (Anthropic's recommended 200 lines; the claude-md-lines entry in Improve AI Infra\notes\
# anthropic-guidelines.json may lower it, never raise it). The value carries the word ApproveSizeUpTo on
# purpose: the permissions "ask" rules in ~/.claude/settings.json match that word in the command, so
# Claude Code shows Erez a prompt before the command runs. Run it directly as its own tool call; a run
# from another script file is refused, because the prompt rule cannot see inside it. Shrinking or
# same-size writes never need it. Example:
#   .\update-config.ps1 -File CLAUDE.md -Op write-file -ContentFile "C:\tmp\new.md" -SizeApproval "ApproveSizeUpTo=203" -SizeOkQuote "yes, 203 is fine"

param(
    [Parameter(Mandatory = $true)]
    [string]$File,

    [Parameter(Mandatory = $true)]
    [ValidateSet("text-replace", "add-allow", "remove-allow", "write-file")]
    [string]$Op,

    [string]$OldText,
    [string]$NewText,
    [string]$Entry,
    [string]$ContentFile,
    [string]$VersionMessage = "",

    [string]$SizeApproval = "",

    [string]$SizeOkQuote = ""
)

$ClaudeBase   = "C:\Users\Erez\.claude"
$MemoryBase   = Join-Path $ClaudeBase "projects\C--Users-Erez\memory"
$LockFile     = Join-Path $ClaudeBase "claude-config.lock"
$PendingSync  = Join-Path $ClaudeBase "claude-config-pending-sync"
$SyncScript   = "G:\My Drive\AI Projects\_Tooling\Claude\sync.ps1"
$JsonEditor   = "G:\My Drive\AI Projects\_Tooling\Claude\config-json-edit.js"

# ---- GEN-674: rules-file size stop ----------------------------------------------------------------
# The always-loaded global CLAUDE.md may not grow past its line limit unless Erez OKs it in chat and then
# clicks Yes on the Claude Code prompt that the settings ask rules force for any command holding the word
# ApproveSizeUpTo. Measured here, on the exact bytes about to be written, so the wording of the command
# plays no part in the measurement. A target is "the rules file" when its current bytes equal the global
# CLAUDE.md's (both read after the Drive pull), which also covers every other path to the same file
# (.\CLAUDE.md, a trailing dot, an 8.3 name, a hard link) and the Drive copy. A guard against mistakes,
# not a wall against a determined script (the same stance as auto-approve.js's PC-control pass guard).
$RulesFile      = Join-Path $ClaudeBase "CLAUDE.md"
$FALLBACK_RULES_LINE_CAP = 200
$UserHome       = Split-Path $ClaudeBase -Parent
$GuidelinesFile = Join-Path $UserHome "AI Projects\Improve AI Infra\notes\anthropic-guidelines.json"
$GuidelinesLog  = Join-Path $UserHome "AI Projects\Improve AI Infra\notes\release-review\guidelines-changes.jsonl"
$SizeRecordDir  = Join-Path (Join-Path $UserHome ".claude-staging") "rules-size"
$SizeRecordFile = Join-Path $SizeRecordDir "record.json"
$script:RulesWrite = $null
# The script file that ran this one, if any: empty when Claude Code's shell tool ran it directly. Read
# here at script level, where frame 1 of the call stack is the caller (inside a function it is not).
$SizeCallerScript = ""
try {
    $sizeCallStack = @(Get-PSCallStack)
    if ($sizeCallStack.Count -gt 1) { $SizeCallerScript = [string]$sizeCallStack[1].ScriptName }
} catch { }

# UTF-8 text of a byte array with a leading BOM dropped (the same reading as config-health-scan.ps1
# Read-SizeText).
function Get-RulesText([byte[]]$Data) {
    $decoded = [System.Text.Encoding]::UTF8.GetString($Data)
    if ($decoded.Length -gt 0 -and $decoded[0] -eq [char]0xFEFF) { $decoded = $decoded.Substring(1) }
    return $decoded
}

# Same rule as config-health-scan.ps1 Get-LineCount and hooks\sessionstart-backup-surfacer.js
# rulesFileSizeLine: 0 for empty text, else the number of LF characters, plus one when the text does not
# end in LF. Keep the three in step.
function Get-RulesLineCount([string]$Body) {
    if (-not $Body) { return 0 }
    $lfCount = $Body.Split([char]10).Length - 1
    if ($Body[$Body.Length - 1] -ne [char]10) { $lfCount++ }
    return $lfCount
}

# The new value of the last applied row for this limit and field in the weekly guidelines watch's change log
# (GEN-892), ignoring rows whose changeId was later marked not-applied; $null when there is none or the log
# cannot be read. A malformed line is skipped. Same rules as hooks\guidelines-limits.js loggedValue.
function Get-LoggedLimitValue([string]$LimitId, [string]$FieldName) {
    $logLines = $null
    try { $logLines = [System.IO.File]::ReadAllLines($GuidelinesLog, [System.Text.Encoding]::UTF8) } catch { return $null }
    $logRows = New-Object System.Collections.ArrayList
    foreach ($logLine in $logLines) {
        if (-not $logLine -or -not $logLine.Trim()) { continue }
        try { $logRow = $logLine | ConvertFrom-Json; if ($logRow -is [System.Management.Automation.PSCustomObject]) { [void]$logRows.Add($logRow) } } catch { }
    }
    $notAppliedIds = @{}
    foreach ($logRow in $logRows) { if ($logRow.status -eq 'not-applied' -and $logRow.changeId) { $notAppliedIds[[string]$logRow.changeId] = $true } }
    for ($rowIndex = $logRows.Count - 1; $rowIndex -ge 0; $rowIndex--) {
        $logRow = $logRows[$rowIndex]
        $rowField = if ($logRow.field) { [string]$logRow.field } else { 'value' }
        if ($logRow.status -ne 'applied' -or $logRow.limit -ne $LimitId -or $rowField -ne $FieldName) { continue }
        if ($logRow.changeId -and $notAppliedIds.ContainsKey([string]$logRow.changeId)) { continue }
        return $logRow.new
    }
    return $null
}

# The line limit (GEN-892): the claude-md-lines value in the size-limits file when it is a whole number from 50
# to 800 and either at or below 200, or above 200 and equal to the last applied claude-md-lines row in the
# weekly guidelines watch's change log. Anything else, or any read or parse problem, leaves 200, so a hand edit
# of the limits file can lower the limit but not raise it. Same rules as hooks\guidelines-limits.js: keep the
# two in step.
function Get-RulesLineLimit {
    $lineLimit = $FALLBACK_RULES_LINE_CAP
    try {
        $limitsJson = [System.IO.File]::ReadAllText($GuidelinesFile, [System.Text.Encoding]::UTF8)
        if ($limitsJson.Length -gt 0 -and $limitsJson[0] -eq [char]0xFEFF) { $limitsJson = $limitsJson.Substring(1) }
        foreach ($limitEntry in @(($limitsJson | ConvertFrom-Json).limits)) {
            if ($limitEntry.id -eq 'claude-md-lines') {
                $limitValue = $limitEntry.value
                # Any whole number counts, however JSON wrote it (190, 190.0, 1.9e2), as in the
                # session-start check's Number.isInteger.
                if ($limitValue -is [int] -or $limitValue -is [long] -or $limitValue -is [decimal] -or $limitValue -is [double]) {
                    $limitNumber = [double]$limitValue
                    if ($limitNumber -eq [Math]::Floor($limitNumber) -and $limitNumber -ge 50 -and $limitNumber -le 800) {
                        if ($limitNumber -le $FALLBACK_RULES_LINE_CAP) {
                            $lineLimit = [int]$limitNumber
                        } else {
                            $loggedLimit = Get-LoggedLimitValue 'claude-md-lines' 'value'
                            if ($null -ne $loggedLimit -and [double]$loggedLimit -eq $limitNumber) { $lineLimit = [int]$limitNumber }
                        }
                    }
                }
            }
        }
    } catch { }
    return $lineLimit
}

# Lower-case hex SHA-256 of a byte array (the session-start check hashes the file the same way).
function Get-BytesSha256([byte[]]$Data) {
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hasher.ComputeHash($Data)) -replace '-', '').ToLowerInvariant() }
    finally { $hasher.Dispose() }
}

# Refuse with exit 6. Runs before the pending-sync marker and the write, inside the main try, so the
# finally below still releases the lock (as exit 5 does).
function Stop-RulesSize([string]$Why, [string[]]$Guidance) {
    Write-Output "SIZE STOP (GEN-674): $Why Nothing was written."
    foreach ($guideLine in $Guidance) { Write-Output $guideLine }
    # Not Write-Error: under a caller's $ErrorActionPreference = 'Stop' that would throw before the exit.
    [Console]::Error.WriteLine("SIZE STOP (GEN-674): refused; see the lines above.")
    exit 6
}

# Measure a text-replace or write-file before anything is written. Returns when the write may go ahead,
# leaving $script:RulesWrite set when the target is the rules file; otherwise exits 6.
function Invoke-RulesSizeStop([string]$TargetAbs, [byte[]]$NewBytes) {
    $script:RulesWrite = $null
    # Read both whole (no FileInfo length shortcut: for a symlink it gives the link's own size).
    $targetBytes = $null
    $rulesBytes = $null
    try { $targetBytes = [System.IO.File]::ReadAllBytes($TargetAbs) } catch { }
    try { $rulesBytes = [System.IO.File]::ReadAllBytes($RulesFile) } catch { }
    if ($null -eq $targetBytes -or $null -eq $rulesBytes) {
        $leafName = ([System.IO.Path]::GetFileName($TargetAbs)).TrimEnd('.', ' ')
        if ($leafName -ieq 'CLAUDE.md') {
            Stop-RulesSize "could not read the target or the global CLAUDE.md to measure this change." @()
        }
        return
    }
    $preSha = Get-BytesSha256 $targetBytes
    if ($targetBytes.Length -ne $rulesBytes.Length -or $preSha -ne (Get-BytesSha256 $rulesBytes)) { return }

    $existingText = Get-RulesText $targetBytes
    $proposedText = Get-RulesText $NewBytes
    if ($proposedText -match "`r(?!`n)") {
        Stop-RulesSize "the new text of the global CLAUDE.md holds a carriage return that is not followed by a line feed, which would make its line count wrong. Use LF (or CRLF) line endings." @()
    }
    $existingLines = Get-RulesLineCount $existingText
    $proposedLines = Get-RulesLineCount $proposedText
    $lineLimit = Get-RulesLineLimit
    $approvedCrossing = $false
    $approvalQuote = ""
    if ($proposedLines -gt $lineLimit -and $proposedLines -gt $existingLines) {
        $codePoints = 0
        foreach ($oneChar in $proposedText.ToCharArray()) { if (-not [char]::IsLowSurrogate($oneChar)) { $codePoints++ } }
        $what = "this change takes the always-loaded rules file ~/.claude/CLAUDE.md from $existingLines to $proposedLines lines ($codePoints characters); its limit is $lineLimit lines."
        if (-not $SizeApproval) {
            Stop-RulesSize $what @(
                "To go ahead:",
                "  1. Ask Erez in plain words whether the file may grow to $proposedLines lines, offering a version at or",
                "     under $lineLimit lines first. A /vet-rule card approval is not this OK. Revised text restarts /check.",
                "  2. If he says yes, re-run update-config.ps1 directly, as its own tool call (update-global-rule.ps1 has",
                "     no approval option, and a run from inside another script file is refused), as one single-line command",
                "     (put multi-line text in a file and use -Op write-file -ContentFile), spelling ApproveSizeUpTo exactly so:",
                "       & `"$PSCommandPath`" -File `"CLAUDE.md`" -Op $Op -SizeApproval 'ApproveSizeUpTo=$proposedLines' -SizeOkQuote '<his answer, word for word, on one line>' <the same other arguments>",
                "     (single quotes keep his words as typed; write each ' in them as '').",
                "     Claude Code then shows Erez a permission prompt; he clicks Yes once (not 'don't ask again'). Say in",
                "     the tool call's description, in plain words, that the rules file grows to $proposedLines lines as he agreed.",
                "  3. The check pass this run used is spent (a No on the prompt spends the next one too): re-mint it per",
                "     /vet-rule recovery first."
            )
        }
        # Exact letter case: the settings ask rules are written as ApproveSizeUpTo, and only the PowerShell
        # rule match is documented as case-insensitive.
        $approvalMatch = [regex]::Match($SizeApproval, '^\s*ApproveSizeUpTo\s*=\s*(\d{1,6})\s*$')
        if (-not $approvalMatch.Success) {
            Stop-RulesSize "$what -SizeApproval must be exactly `"ApproveSizeUpTo=<line count>`"." @()
        }
        $approvedLines = [int]$approvalMatch.Groups[1].Value
        if ($approvedLines -lt $proposedLines) {
            Stop-RulesSize "$what ApproveSizeUpTo=$approvedLines is below the $proposedLines lines this change makes." @(
                "Ask Erez about $proposedLines lines and re-run with -SizeApproval `"ApproveSizeUpTo=$proposedLines`"."
            )
        }
        if ($SizeCallerScript) {
            Stop-RulesSize "$what The approval came from inside another script file ($SizeCallerScript), where Claude Code's prompt rule cannot see it." @(
                "Run update-config.ps1 directly, as its own tool call."
            )
        }
        $approvalQuote = [string]$SizeOkQuote
        if (-not $approvalQuote.Trim() -or $approvalQuote -match "[`r`n]" -or $approvalQuote.Length -gt 200) {
            Stop-RulesSize "$what -SizeOkQuote must hold Erez's answer word for word, on one line, at most 200 characters." @()
        }
        $approvedCrossing = $true
        Write-Output "Size stop: going ahead to $proposedLines lines (limit $lineLimit); Erez's OK as given: `"$approvalQuote`"."
    }
    # The approval record follows writes to the real file only, never to a copy that merely matches it.
    $isCanonical = $false
    try { $isCanonical = ([System.IO.Path]::GetFullPath($TargetAbs) -ieq [System.IO.Path]::GetFullPath($RulesFile)) } catch { }
    $script:RulesWrite = @{
        NewLines  = $proposedLines
        Limit     = $lineLimit
        Approved  = $approvedCrossing
        Quote     = $approvalQuote
        PreSha    = $preSha
        NewSha    = (Get-BytesSha256 $NewBytes)
        Canonical = $isCanonical
    }
}

# Keep the approval record in step with a write to the rules file: none is needed at or under the limit;
# an approved crossing records the new text's hash, Erez's quoted OK and notified=false (the session-start
# check then tells him once); a later trim or same-size write that stays over the limit carries the record
# forward only when it covered the text before the write. The session-start check
# (hooks\sessionstart-backup-surfacer.js) flags an over-limit file whose hash the record lacks.
function Update-RulesSizeRecord {
    $written = $script:RulesWrite
    if ($null -eq $written -or -not $written.Canonical) { return }
    try {
        if ($written.NewLines -le $written.Limit) {
            Remove-Item -LiteralPath $SizeRecordFile -Force -ErrorAction SilentlyContinue
            return
        }
        $approvedOn = $null
        $recordQuote = ""
        $recordNotified = $false
        if ($written.Approved) {
            $approvedOn = (Get-Date).ToUniversalTime().ToString('o')
            $recordQuote = [string]$written.Quote
        } else {
            try {
                $oldRecord = [System.IO.File]::ReadAllText($SizeRecordFile, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
                if ($oldRecord.sha256 -eq $written.PreSha) {
                    $approvedOn = [string]$oldRecord.approvedOn
                    $recordQuote = [string]$oldRecord.quote
                    $recordNotified = ($oldRecord.notified -eq $true)
                }
            } catch { }
        }
        if ($null -eq $approvedOn) { return }
        New-Item -ItemType Directory -Force -Path $SizeRecordDir | Out-Null
        $recordJson = [ordered]@{
            lines      = [int]$written.NewLines
            sha256     = [string]$written.NewSha
            approvedOn = $approvedOn
            quote      = $recordQuote
            notified   = $recordNotified
        } | ConvertTo-Json -Compress
        [System.IO.File]::WriteAllText($SizeRecordFile, $recordJson, (New-Object System.Text.UTF8Encoding $false))
    } catch {
        Write-Output "Note: could not update the rules-file size record ($_); the next session start may flag the file."
    }
}

# Map short logical names to absolute local paths.
$ManagedFiles = @{
    "CLAUDE.md"            = Join-Path $ClaudeBase "CLAUDE.md"
    "settings.json"        = Join-Path $ClaudeBase "settings.json"
    "settings.local.json"  = Join-Path $ClaudeBase "settings.local.json"
    "auto-approve.js"      = Join-Path $ClaudeBase "hooks\auto-approve.js"
    "MEMORY.md"            = Join-Path $MemoryBase "MEMORY.md"
    "user_profile.md"      = Join-Path $MemoryBase "user_profile.md"
    "feedback_behavior.md" = Join-Path $MemoryBase "feedback_behavior.md"
}

if ($ManagedFiles.ContainsKey($File)) {
    $TargetPath = $ManagedFiles[$File]
} else {
    $TargetPath = $File
}

# ---- Step 1: Acquire the single global lock. ----
# Retry window widened (GEN-219): the lock is held across a full Drive pull+edit+push,
# which can now also include sync.ps1 waiting on ITS OWN concurrency lock (GEN-353,
# up to ~120s) if another sync is mid-flight. Sized to comfortably exceed that nested
# worst case rather than a bare network round trip. Heartbeat output every ~10s so a
# long wait is visibly progressing rather than looking hung.
$lockStream = $null
$maxAttempts = 60
$retryDelayMs = 3000
for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    try {
        $lockStream = [System.IO.File]::Open(
            $LockFile,
            [System.IO.FileMode]::OpenOrCreate,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None
        )
        break
    } catch [System.IO.IOException] {
        if ($attempt -lt $maxAttempts) {
            if ($attempt -eq 1 -or ($attempt % 5) -eq 0) {
                $elapsedApprox = [Math]::Round(($attempt - 1) * $retryDelayMs / 1000)
                Write-Output "Config lock held by another session; retrying (${attempt}/${maxAttempts}, ~${elapsedApprox}s elapsed)..."
            }
            Start-Sleep -Milliseconds $retryDelayMs
        } else {
            Write-Error "Another Claude session is editing config (lock held) after ~$([Math]::Round($maxAttempts * $retryDelayMs / 1000))s. Try again in a moment."
            exit 1
        }
    }
}

try {
    Write-Output "Lock acquired."

    # ---- Pending-sync guard (GEN-306): block the pre-edit pull if a previous run wrote
    # a local edit but never finished pushing it to Drive. ----
    if (Test-Path -LiteralPath $PendingSync) {
        Write-Error "PENDING SYNC DETECTED: a previous edit was written locally but was never pushed to Drive."
        Write-Output "Marker file: $PendingSync"
        Write-Output ""
        Write-Output "Recovery options:"
        Write-Output "  1. Re-run the push manually: & '$SyncScript' -Direction From-Claude"
        Write-Output "     This pushes the pending local edit to Drive and removes the marker."
        Write-Output "  2. If you want to DISCARD the local edit and take Drive's copy instead:"
        Write-Output "     Delete the marker file ($PendingSync), then run:"
        Write-Output "     & '$SyncScript' -Direction To-Claude -DiscardLocal"
        Write-Output "     (Deleting the marker alone is not enough -- sync.ps1's non-destructive"
        Write-Output "     pull (GEN-355) would otherwise keep your local edit since it still"
        Write-Output "     differs from Drive. -DiscardLocal forces Drive's copy to win.)"
        exit 5
    }

    # ---- Step 2: Pull latest from Drive. ----
    Write-Output "Pulling latest from Drive..."
    try {
        & $SyncScript -Direction To-Claude | Out-Null
        if ($LASTEXITCODE -ne $null -and $LASTEXITCODE -ne 0) { throw "sync To-Claude exit $LASTEXITCODE" }
    } catch {
        Write-Error "Pull from Drive failed: $_"
        exit 4
    }

    if (-not (Test-Path $TargetPath)) {
        Write-Error "Target file not found: $TargetPath. Edit aborted."
        exit 2
    }

    # ---- Step 3: Apply the requested operation. ----
    switch ($Op) {
        "text-replace" {
            if (-not $PSBoundParameters.ContainsKey('OldText') -or -not $PSBoundParameters.ContainsKey('NewText')) {
                Write-Error "text-replace requires -OldText and -NewText."
                exit 2
            }
            $content = Get-Content -Raw -Path $TargetPath -Encoding UTF8
            # Strip any pre-existing leading BOM so already-BOM'd files self-heal on next edit
            if ($content.Length -gt 0 -and $content[0] -eq [char]0xFEFF) { $content = $content.Substring(1) }
            if (-not $content.Contains($OldText)) {
                Write-Error "OldText not found in $TargetPath. Edit aborted (file unchanged)."
                exit 2
            }
            $newContent = $content.Replace($OldText, $NewText)
            if ($newContent -eq $content) {
                Write-Error "Replacement made no change (OldText equals NewText?). Edit aborted."
                exit 3
            }
            # Write UTF-8 WITHOUT a BOM (PS 5.1 'Set-Content -Encoding UTF8' prepends a BOM, which corrupts JS/JSON). GEN-214
            # Resolve to an absolute LiteralPath first: WriteAllText resolves a relative path against .NET's cwd (not $PWD),
            # and -LiteralPath stops [ ] * ? in the path being treated as wildcards. Existence already checked above.
            $absPath = (Resolve-Path -LiteralPath $TargetPath).Path
            # GEN-674 size stop: measured on the exact bytes WriteAllText writes below.
            Invoke-RulesSizeStop $absPath ((New-Object System.Text.UTF8Encoding $false).GetBytes($newContent))
            # Marker written before the file write so any interruption or push failure leaves it in place. (GEN-306)
            [IO.File]::WriteAllText($PendingSync, "$TargetPath`n$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')", (New-Object System.Text.UTF8Encoding $false))
            [IO.File]::WriteAllText($absPath, $newContent, (New-Object System.Text.UTF8Encoding $false))
            Write-Output "Applied text-replace to $TargetPath."
        }
        { $_ -in @("add-allow", "remove-allow") } {
            if (-not $Entry) {
                Write-Error "$Op requires -Entry."
                exit 2
            }
            # Pass the entry via env, not argv: PowerShell 5.1 mangles embedded
            # double-quotes when passing arguments to a native program (node.exe).
            $env:CFG_ENTRY = $Entry
            # Marker written before the file write so any interruption or push failure leaves it in place. (GEN-306)
            [IO.File]::WriteAllText($PendingSync, "$TargetPath`n$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')", (New-Object System.Text.UTF8Encoding $false))
            try {
                & node $JsonEditor $TargetPath $Op
                $code = $LASTEXITCODE
            } finally {
                Remove-Item Env:\CFG_ENTRY -ErrorAction SilentlyContinue
            }
            if ($code -eq 3) {
                # No file was written; remove the marker we pre-emptively created. (GEN-306)
                Remove-Item -LiteralPath $PendingSync -ErrorAction SilentlyContinue
                Write-Output "No change needed; entry already in desired state."
                exit 3
            } elseif ($code -ne 0) {
                # Node editor failed before writing; remove the marker. (GEN-306)
                Remove-Item -LiteralPath $PendingSync -ErrorAction SilentlyContinue
                Write-Error "JSON edit failed (exit $code)."
                exit 2
            }
            Write-Output "Applied $Op to $TargetPath."
        }
        "write-file" {
            if (-not $ContentFile -or -not (Test-Path -LiteralPath $ContentFile)) {
                Write-Error "write-file requires -ContentFile pointing to an existing file."
                exit 2
            }
            # Copy the source onto the target, stripping a leading UTF-8 BOM if the source has one, so
            # write-file cannot re-introduce the GEN-214 corruption on JS/JSON targets. Byte-level (not a
            # text re-encode) to avoid mangling content / line-endings / non-UTF-8 sources. GEN-216
            # Guard A: pin both paths to absolute LiteralPaths -- ReadAllBytes/WriteAllBytes resolve a
            # relative path against .NET's cwd (not $PWD), and -LiteralPath stops [ ] * ? being wildcards.
            $srcAbs = (Resolve-Path -LiteralPath $ContentFile).Path
            $dstAbs = (Resolve-Path -LiteralPath $TargetPath).Path
            $bytes  = [IO.File]::ReadAllBytes($srcAbs)
            if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
                # Guard B: [Array]::Copy handles the BOM-only (length==3 -> empty) case cleanly, avoiding
                # PowerShell's descending-range quirk on $bytes[3..($bytes.Length-1)].
                $stripped = New-Object byte[] ($bytes.Length - 3)
                [Array]::Copy($bytes, 3, $stripped, 0, $bytes.Length - 3)
                $bytes = $stripped
            }
            # GEN-674 size stop: measured on the exact bytes WriteAllBytes writes below.
            Invoke-RulesSizeStop $dstAbs $bytes
            # Marker written before the file write so any interruption or push failure leaves it in place. (GEN-306)
            [IO.File]::WriteAllText($PendingSync, "$TargetPath`n$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')", (New-Object System.Text.UTF8Encoding $false))
            [IO.File]::WriteAllBytes($dstAbs, $bytes)
            Write-Output "Overwrote $TargetPath from $ContentFile (BOM stripped if present)."
        }
    }

    # GEN-674: keep the size approval record in step with what was just written, before the push, so a
    # push failure cannot leave an approved over-limit file without its record.
    Update-RulesSizeRecord

    # ---- Step 4: Push back to Drive + git history. ----
    Write-Output "Pushing to Drive..."
    $commitMsg = if ($VersionMessage) { $VersionMessage } else { "Config edit ($Op $File) at $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }
    try {
        & $SyncScript -Direction From-Claude -CommitMessage $commitMsg | Out-Null
        if ($LASTEXITCODE -ne $null -and $LASTEXITCODE -ne 0) { throw "sync From-Claude exit $LASTEXITCODE" }
    } catch {
        Write-Error "Push to Drive failed: $_  LOCAL FILE WAS UPDATED but Drive may be out of sync."
        exit 4
    }

    # Step 4 succeeded: remove the pending-sync marker. (GEN-306)
    Remove-Item -LiteralPath $PendingSync -ErrorAction SilentlyContinue

    Write-Output ""
    Write-Output "Done. $File updated and synced."
} finally {
    if ($lockStream) {
        $lockStream.Close()
        $lockStream.Dispose()
        Remove-Item -Path $LockFile -ErrorAction SilentlyContinue
        Write-Output "Lock released."
    }
}
