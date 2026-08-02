# GEN-443 Step 3 regression: the pre-lock INPUT-CONTRACT guard, and the exit-code contract
# around it.
#
# The appender must REJECT a malformed entry/TOC shape loudly (exit 4, recovery file written next
# to the target, target byte-identical) instead of accepting it and silently producing a duplicate
# entry / a second TOC bullet on a later run.
#
# Exit 4 -- NOT 3 -- is the contract-violation code: 3 means the TARGET file's structure was not
# recognized, 4 means the CALLER's own composed text was malformed. The callers branch on the exit
# code alone, so the two must stay distinguishable IN BOTH DIRECTIONS -- hence this file also
# covers exit 3 (malformed target) and exit 2 (bad arguments), not just the new exit 4.
#
# -Helper defaults to the INSTALLED script, deliberately NOT to the sibling prepend-log.dev.ps1
# the older tests use: that copy can drift from the installed file, and once it has been refreshed
# past this point a later regression in the INSTALLED script would still show green here. Nothing
# is at risk in pointing at the real script -- every case operates on a throwaway copy of a
# HISTORY.md under %TEMP% and never on a real project file. A /vet-code live-verify run passes
# -Helper explicitly to exercise a pre-apply working copy.
#
# ASCII only in code (PS 5.1 reads a UTF-8 em-dash as cp1252 and fails to parse) -- README.md.
param(
    [string]$Helper = (Join-Path (Split-Path -Parent $PSScriptRoot) "prepend-log.ps1")
)
$ErrorActionPreference = "Continue"
$helper = $Helper
# $PID in the path so two concurrent runs cannot share a target file or a recovery-file directory
# (the recoveryFiles count assertion below would otherwise see the other run's files).
$dir = "C:\Users\Erez\AppData\Local\Temp\prepend-log-tests\contract-guard-$PID"
if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
New-Item -ItemType Directory -Path $dir | Out-Null
$allPass = $true

$srcHistory = "C:\Users\Erez\AI Projects\Documentation\HISTORY.md"
if (-not (Test-Path $helper)) {
    Write-Output "PREREQUISITE MISSING: helper not found at $helper"
    Write-Output "OVERALL: FAIL"
    exit 1
}
if (-not (Test-Path $srcHistory)) {
    # Fail with a clear prerequisite message rather than an obscure Copy-Item error surfacing
    # later as an unrelated hash mismatch.
    Write-Output "PREREQUISITE MISSING: sample HISTORY.md not found at $srcHistory"
    Write-Output "OVERALL: FAIL"
    exit 1
}

Write-Output "helper under test: $helper"
Write-Output ""

$copy = Join-Path $dir "HISTORY.md"
$e = Join-Path $dir "e.md"

function Reset-Target {
    # Fresh target + clear any recovery/lock artifacts so each case asserts independently.
    Copy-Item $srcHistory $copy -Force
    Get-ChildItem $dir -Filter "HISTORY.pending-*" -ErrorAction SilentlyContinue | Remove-Item -Force
    if (Test-Path "$copy.lock") { Remove-Item "$copy.lock" -Force }
    return (Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash
}

function New-EntryFile([string]$text) {
    [IO.File]::WriteAllText($e, $text, (New-Object System.Text.UTF8Encoding $false))
}

function Count-Recovery { return (Get-ChildItem $dir -Filter "HISTORY.pending-*" -ErrorAction SilentlyContinue | Measure-Object).Count }

function Report([string]$name, [bool]$pass, [string]$detail) {
    Write-Output "$name : $detail"
    Write-Output "  $(if($pass){'PASS'}else{'*** FAIL ***'})"
    if (-not $pass) { $script:allPass = $false }
}

# Contract violation: expect exit 4, target byte-identical, exactly one recovery file, and a
# message naming the contract that was actually broken (so swapping two messages cannot pass).
# $forbidMsg (optional): a substring that must NOT appear. Without a negative assertion the suite
# is blind to a SPURIOUS extra violation -- which is exactly how the round-2 restructure shipped a
# message that both demanded a '## <date>' first line and told the caller to demote the only one
# it had. A caller obeying that is rejected twice, i.e. a blocked wrap. (Pass B round 3.)
function Test-Reject([string]$name, [string]$entryText, [string]$tocLine, [string]$expectMsg, [string]$forbidMsg = "") {
    $before = Reset-Target
    New-EntryFile $entryText
    # Clear the exit code first: a stale 4 from a previous case would let this one pass without
    # the helper having exited 4 at all.
    $global:LASTEXITCODE = 0
    # -Width 4096: PowerShell's error formatter hard-wraps an error record at the host width, and
    # the wrap offset shifts with the helper's file-name length -- so a narrow default can split
    # the expected substring and fail the assertion for no behavioural reason.
    $out = (& powershell.exe -NoProfile -File $helper -Path $copy -SessionKey "cgsess" -EntryFile $e -TocLine $tocLine 2>&1 | Out-String -Width 4096)
    $rc = $LASTEXITCODE
    $after = (Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash
    $rec = Count-Recovery
    $msgOk = $out.Contains($expectMsg)
    $forbidOk = ($forbidMsg -eq "") -or (-not $out.Contains($forbidMsg))
    $pass = ($rc -eq 4) -and ($before -eq $after) -and ($rec -eq 1) -and $msgOk -and $forbidOk
    $forbidNote = if ($forbidMsg -eq "") { "" } else { " noSpuriousViolation=$forbidOk" }
    Report $name $pass "rc=$rc (want 4) untouched=$($before -eq $after) recoveryFiles=$rec (want 1) messageNamesContract=$msgOk$forbidNote"
}

# Accept: expect exit 0, entry + TOC bullet written, no recovery file.
function Test-Accept([string]$name, [string]$entryText, [string]$tocLine) {
    [void](Reset-Target)
    New-EntryFile $entryText
    $global:LASTEXITCODE = 0
    & powershell.exe -NoProfile -File $helper -Path $copy -SessionKey "cgsess" -EntryFile $e -TocLine $tocLine 2>&1 | Out-Null
    $rc = $LASTEXITCODE
    $content = [IO.File]::ReadAllText($copy)
    $rec = Count-Recovery
    $hasEntry = $content.Contains("<!-- session:cgsess -->")
    $hasToc = $content.Contains("<!-- toc-session:cgsess -->")
    $pass = ($rc -eq 0) -and $hasEntry -and $hasToc -and ($rec -eq 0)
    Report $name $pass "rc=$rc (want 0) entryMarker=$hasEntry tocMarker=$hasToc recoveryFiles=$rec (want 0)"
}

$validToc = "- 2026-07-19 (CG) contract-guard test -- see below"
$validEntryLf = "## 2026-07-19 (CG) contract-guard test`n`nbody line.`n"
$msgEntry = "LITERAL first line"
# The extra-heading complaint. Used as a FORBIDDEN substring on the displaced-heading cases: the
# entry's own heading, pushed off line 1, must never be reported as an "extra" to demote.
$msgExtraHeading = "exactly ONE"
$msgTocShape = "must start with '- '"
$msgTocLines = "must be a SINGLE line"

# ---- exit 4: the caller's own composed text is malformed ----

# (a) LEADING BLANK LINE before the heading. This is the case a "first NON-BLANK line" check would
# wrongly accept: the marker is inserted at index 1, i.e. ABOVE the heading, putting it outside
# the block the same-session reconcile scans -> silent duplicate on the next run.
Test-Reject "(a) leading blank line before heading" "`n## 2026-07-19 (CG) leading blank`n`nbody.`n" $validToc $msgEntry $msgExtraHeading

# (b) First line is PROSE -- the original plain-line entry shape that caused the duplicate bug.
Test-Reject "(b) first line is prose (plain-line entry)" "2026-07-19 (CG) plain dated line, no heading`n`nbody.`n" $validToc $msgEntry

# (c) TocLine missing the '- ' bullet prefix. A de-bulleted TOC line is invisible to the TOC
# reconcile, which then inserts a SECOND bullet instead of updating the existing one.
Test-Reject "(c) TocLine without '- ' prefix" $validEntryLf "2026-07-19 (CG) de-bulleted toc line" $msgTocShape

# (d) TocLine has '- ' but NO date token -- exercises the date half of the TOC predicate.
Test-Reject "(d) TocLine with no date token" $validEntryLf "- no date anywhere in this bullet text" $msgTocShape

# (e) First line starts '## ' but the date is malformed -- exercises the date half of the entry
# predicate, not just the '##' half.
Test-Reject "(e) heading with malformed date" "## July 30th, twenty twenty-six`n`nbody.`n" $validToc $msgEntry

# (n) A SECOND column-0 '## <date>' heading inside the body. Accepted, this is the worst case in
# the set: the reconcile reads that line as the start of another entry, so a later same-session run
# REPLACEs only up to it and re-emits the old entry's tail after a fresh '---' -- a phantom entry
# of stale text with no TOC bullet and no session marker, at exit 0, growing every run, invisible
# to the shrink guard because the file grows. Easy to write by accident when the entry quotes the
# mandated heading shape in prose.
Test-Reject "(n) second '## <date>' heading in the body" "## 2026-07-19 (CG) outer heading`n`nThe mandated shape is:`n## 2026-07-19 (2) -- quoted example`n`nmore body.`n" $validToc "exactly ONE"

# (h) TocLine that passes the shape check on its first line but spans TWO lines. The marker is
# appended to its LAST line, so the marker-bearing line is not a recognizable bullet and the next
# same-session run inserts a SECOND bullet.
Test-Reject "(h) multi-line TocLine" $validEntryLf "- 2026-07-19 (CG) first line`nsecond line" $msgTocLines

# (q) TWO violations in one input: a leading blank line before the heading AND a de-bulleted TOC
# line. The callers permit exactly ONE retry, so a guard that reported only the FIRST violation
# would make this a DETERMINISTIC blocked wrap -- the caller fixes what it was told, retries, and
# trips the second check, and a second exit 4 means no commit, no push, compact gate held. Assert
# both are named in ONE message and that only ONE recovery file is written.
# (GEN-443 Step 3 code review, Pass B round 2.)
$beforeQ = Reset-Target
New-EntryFile "`n## 2026-07-19 (CG) two violations at once`n`nbody.`n"
$global:LASTEXITCODE = 0
$outQ = (& powershell.exe -NoProfile -File $helper -Path $copy -SessionKey "cgsess" -EntryFile $e -TocLine "2026-07-19 (CG) de-bulleted toc line" 2>&1 | Out-String -Width 4096)
$rcQ = $LASTEXITCODE
$afterQ = (Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash
$recQ = Count-Recovery
$bothQ = $outQ.Contains($msgEntry) -and $outQ.Contains($msgTocShape)
Report "(q) two violations named in ONE message" (($rcQ -eq 4) -and ($beforeQ -eq $afterQ) -and ($recQ -eq 1) -and $bothQ) "rc=$rcQ (want 4) untouched=$($beforeQ -eq $afterQ) recoveryFiles=$recQ (want 1) bothNamed=$bothQ"

# (r) The recovery file written for a CONTRACT violation must NOT carry the unconditional "add
# this entry to the target by hand" instruction. That path is RETRYABLE, so by the time anyone
# reads the file the corrected entry may already be in the target -- and the text it holds is the
# REJECTED text, which still carries the malformed shape. Following the old instruction would
# plant the very corruption the guard exists to prevent, plus a duplicate session marker.
# (GEN-443 Step 3 code review, Pass B round 2.)
[void](Reset-Target)
New-EntryFile "## 2026-07-19 (CG) recovery advice`n`nThe mandated shape is:`n## 2026-07-19 (2) -- quoted example`n"
$global:LASTEXITCODE = 0
& powershell.exe -NoProfile -File $helper -Path $copy -SessionKey "cgsess" -EntryFile $e -TocLine $validToc 2>&1 | Out-Null
$rcR = $LASTEXITCODE
$recFileR = Get-ChildItem $dir -Filter "HISTORY.pending-*" -ErrorAction SilentlyContinue | Select-Object -First 1
$bodyR = if ($recFileR) { [IO.File]::ReadAllText($recFileR.FullName) } else { "" }
$hasCaution = $bodyR.Contains("CAUTION")
$noBlindAppend = -not $bodyR.Contains("# Add this entry to the target by hand")
Report "(r) contract-violation recovery file warns instead of saying append-by-hand" (($rcR -eq 4) -and $hasCaution -and $noBlindAppend) "rc=$rcR (want 4) caution=$hasCaution noBlindAppendInstruction=$noBlindAppend"

# (s) DISPLACED heading AND a genuine extra one, together. This is the combination the two
# separate heading checks got wrong: the displaced heading must be reported as displaced ("delete
# the lines above it"), and only the genuine second heading reported as an extra to demote. Both
# must arrive in ONE message, and following both must reach a clean state in a single retry.
# (GEN-443 Step 3 code review, Pass B round 3.)
$beforeS = Reset-Target
New-EntryFile "`n## 2026-07-19 (CG) displaced heading`n`nThe mandated shape is:`n## 2026-07-19 (2) -- quoted example`n"
$global:LASTEXITCODE = 0
$outS = (& powershell.exe -NoProfile -File $helper -Path $copy -SessionKey "cgsess" -EntryFile $e -TocLine $validToc 2>&1 | Out-String -Width 4096)
$rcS4 = $LASTEXITCODE
$afterS = (Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash
$recS4 = Count-Recovery
$saysDisplaced = $outS.Contains($msgEntry) -and $outS.Contains("Delete the 1 line(s) above it")
# Each extra is quoted as "line N: '<text>'". The entry's own displaced heading is at line 2, so
# "line 2:" must NOT appear in the extras list -- that was the round-3 defect.
$saysExtra = $outS.Contains($msgExtraHeading) -and $outS.Contains("line 5:")
$noDemoteOwn = -not $outS.Contains("line 2:")
# The remedy must be followable whatever order the caller applies the two bullets in: the
# deletion renumbers everything below it, so the message has to say which to do first.
$saysOrder = $outS.Contains("do these demotions FIRST")
Report "(s) displaced heading + a real extra: each named correctly, in a followable order" (($rcS4 -eq 4) -and ($beforeS -eq $afterS) -and ($recS4 -eq 1) -and $saysDisplaced -and $saysExtra -and $noDemoteOwn -and $saysOrder) "rc=$rcS4 (want 4) untouched=$($beforeS -eq $afterS) recoveryFiles=$recS4 (want 1) displacedNamed=$saysDisplaced extraNamed=$saysExtra ownHeadingNotCalledExtra=$noDemoteOwn orderStated=$saysOrder"

# ---- exit 0: legitimate input must NOT be rejected ----

# (f) CRLF-terminated but otherwise VALID entry: the guard must not mistake a trailing CR for
# malformed input.
Test-Accept "(f) valid entry with CRLF endings" "## 2026-07-19 (CG) crlf entry`r`n`r`nbody line.`r`n" $validToc

# (g) Plain valid LF entry + valid TOC line.
Test-Accept "(g) valid LF entry and TOC line" $validEntryLf $validToc

# (o) and (p) EXERCISE THE REMEDY THE REJECTION MESSAGE ADVISES. Case (n) rejects a second
# column-0 '## <date>' heading and tells the caller to "Indent it or use '###'". Nothing proved
# that either remedy actually passes, so a later loosening of Test-IsEntryHeading (e.g. tolerating
# leading whitespace) would silently make the advice wrong: the caller would follow the message,
# retry, be rejected a second time, and the callers route a SECOND exit 4 to the blocked-wrap
# branch -- no commit, no push, compact gate held. These two cases pin the advice to behaviour.
# (Found by GEN-443 Step 3 code review, Pass A / Pass B independently.)
Test-Accept "(o) remedy: indented '## <date>' in the body is accepted" "## 2026-07-19 (CG) indent remedy`n`nquoting the shape below:`n  ## 2026-07-19 (CG) quoted heading`n" $validToc

Test-Accept "(p) remedy: '### <date>' in the body is accepted" "## 2026-07-19 (CG) h3 remedy`n`nquoting the shape below:`n### 2026-07-19 (CG) quoted heading`n" $validToc

# (i) LONE-CR (classic Mac) entry. Accepted, and the marker must land on the line IMMEDIATELY
# after the heading -- the whole point of normalizing all endings to LF before the guard. Without
# that normalization the entry stays ONE line for the writer and the marker lands after the whole
# body, which is the marker misplacement this guard exists to prevent.
[void](Reset-Target)
New-EntryFile "## 2026-07-19 (CG) cr entry`rbody line.`rmore body.`r"
$global:LASTEXITCODE = 0
& powershell.exe -NoProfile -File $helper -Path $copy -SessionKey "crsess" -EntryFile $e -TocLine "- 2026-07-19 (CG) cr entry -- see below" 2>&1 | Out-Null
$rcI = $LASTEXITCODE
$linesI = [IO.File]::ReadAllLines($copy)
$hIdx = -1; $mIdx = -1
for ($k = 0; $k -lt $linesI.Count; $k++) {
    if ($linesI[$k] -eq "## 2026-07-19 (CG) cr entry") { $hIdx = $k }
    if ($linesI[$k] -eq "<!-- session:crsess -->") { $mIdx = $k }
}
$adjacent = ($hIdx -ge 0) -and ($mIdx -eq $hIdx + 1)
$noCr = -not ([IO.File]::ReadAllText($copy)).Contains("`r")
Report "(i) lone-CR entry normalized, marker after heading" (($rcI -eq 0) -and $adjacent -and $noCr) "rc=$rcI (want 0) headingLine=$($hIdx+1) markerLine=$($mIdx+1) adjacent=$adjacent noStrayCR=$noCr"

# ---- exit 3 must still mean "the TARGET file's structure was not recognized" ----
# Guards the split in the OTHER direction: if a structural failure ever started returning 4, the
# callers would route a genuinely damaged HISTORY.md into their recoverable retry-once branch.
$badTarget = Join-Path $dir "BAD-HISTORY.md"
[IO.File]::WriteAllText($badTarget, "# Just a title`n`nNo TOC bullet run and no dated heading here.`n", (New-Object System.Text.UTF8Encoding $false))
$badBefore = (Get-FileHash -LiteralPath $badTarget -Algorithm SHA256).Hash
Get-ChildItem $dir -Filter "HISTORY.pending-*" -ErrorAction SilentlyContinue | Remove-Item -Force
New-EntryFile $validEntryLf
$global:LASTEXITCODE = 0
& powershell.exe -NoProfile -File $helper -Path $badTarget -SessionKey "structsess" -EntryFile $e -TocLine $validToc 2>&1 | Out-Null
$rcS = $LASTEXITCODE
$badAfter = (Get-FileHash -LiteralPath $badTarget -Algorithm SHA256).Hash
$recS = Count-Recovery
Report "(j) unrecognized TARGET structure still exits 3" (($rcS -eq 3) -and ($badBefore -eq $badAfter) -and ($recS -eq 1)) "rc=$rcS (want 3) untouched=$($badBefore -eq $badAfter) recoveryFiles=$recS (want 1)"

# ---- exit 2 must be reachable for bad arguments (it silently returned 1 before this change) ----
# A terminating Write-Error under $ErrorActionPreference='Stop' used to kill the script before its
# 'exit 2' line ran, so the caller took its exit-1 branch and reported a recovery file that was
# never written. Without these two cases nothing stops that from being reintroduced.
Get-ChildItem $dir -Filter "HISTORY.pending-*" -ErrorAction SilentlyContinue | Remove-Item -Force
New-EntryFile $validEntryLf
$global:LASTEXITCODE = 0
& powershell.exe -NoProfile -File $helper -Path (Join-Path $dir "does-not-exist.md") -SessionKey "argsess" -EntryFile $e -TocLine $validToc 2>&1 | Out-Null
$rcP = $LASTEXITCODE
$recP = Count-Recovery
Report "(k) missing target exits 2, no recovery file" (($rcP -eq 2) -and ($recP -eq 0)) "rc=$rcP (want 2) recoveryFiles=$recP (want 0)"

[void](Reset-Target)
New-EntryFile $validEntryLf
$global:LASTEXITCODE = 0
& powershell.exe -NoProfile -File $helper -Path $copy -SessionKey "argsess2" -EntryFile $e -TocLine "   " 2>&1 | Out-Null
$rcT = $LASTEXITCODE
$recT = Count-Recovery
Report "(l) whitespace-only TocLine exits 2, no recovery file" (($rcT -eq 2) -and ($recT -eq 0)) "rc=$rcT (want 2) recoveryFiles=$recT (want 0)"

# ---- the guard must run BEFORE the lock is acquired ----
# Asserted by behaviour, not by comment: hold the lock from THIS process with FileShare::None, then
# feed a contract violation. A pre-lock guard returns 4 immediately; a guard moved inside the lock
# would burn the ~180s retry budget and then return 1 (lock timeout) instead.
[void](Reset-Target)
New-EntryFile "`n## 2026-07-19 (CG) prelock probe`n`nbody.`n"
$lockHeld = $null
try {
    $lockHeld = [IO.File]::Open("$copy.lock", [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $global:LASTEXITCODE = 0
    & powershell.exe -NoProfile -File $helper -Path $copy -SessionKey "prelock" -EntryFile $e -TocLine $validToc 2>&1 | Out-Null
    $rcL = $LASTEXITCODE
    $sw.Stop()
    $secs = [Math]::Round($sw.Elapsed.TotalSeconds, 1)
    Report "(m) contract violation rejected without waiting for the lock" (($rcL -eq 4) -and ($sw.Elapsed.TotalSeconds -lt 15)) "rc=$rcL (want 4) elapsed=${secs}s (want well under the ~180s lock budget)"
} finally {
    if ($lockHeld) { $lockHeld.Close(); $lockHeld.Dispose() }
    if (Test-Path "$copy.lock") { Remove-Item "$copy.lock" -Force -ErrorAction SilentlyContinue }
}

Write-Output ""
Write-Output "OVERALL: $(if($allPass){'PASS'}else{'FAIL'})"
