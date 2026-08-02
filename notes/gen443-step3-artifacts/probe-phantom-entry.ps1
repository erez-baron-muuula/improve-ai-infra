# One-off probe (NOT part of the regression suite): does a column-0 '## <date>' line inside the
# entry body actually produce a phantom entry on a second same-session run? Run against the OLD
# (unmodified) helper to reproduce, and against the fixed one to confirm it is now refused.
param([Parameter(Mandatory=$true)][string]$Helper)
$ErrorActionPreference = "Continue"
$dir = "C:\Users\Erez\AppData\Local\Temp\prepend-log-tests\phantom-$PID"
if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
New-Item -ItemType Directory -Path $dir | Out-Null
$copy = Join-Path $dir "HISTORY.md"
Copy-Item "C:\Users\Erez\AI Projects\Documentation\HISTORY.md" $copy -Force
$e = Join-Path $dir "e.md"
$enc = New-Object System.Text.UTF8Encoding $false

# Run 1: entry whose BODY quotes the mandated heading shape at column 0.
$run1 = "## 2026-07-19 (PH) phantom probe RUN ONE`n`nThe mandated shape is:`n## 2026-07-19 (2) -- quoted example`n`nRUN-ONE-TAIL-MARKER`n"
[IO.File]::WriteAllText($e, $run1, $enc)
& powershell.exe -NoProfile -File $Helper -Path $copy -SessionKey "phsess" -EntryFile $e -TocLine "- 2026-07-19 (PH) phantom probe -- see below" 2>&1 | Out-Null
$rc1 = $LASTEXITCODE

# Run 2: the SAME session revises its entry -- the routine /loghistory-then-/wrap case.
$run2 = "## 2026-07-19 (PH) phantom probe RUN TWO REVISED`n`nThe mandated shape is:`n## 2026-07-19 (2) -- quoted example`n`nRUN-TWO-TAIL-MARKER`n"
[IO.File]::WriteAllText($e, $run2, $enc)
& powershell.exe -NoProfile -File $Helper -Path $copy -SessionKey "phsess" -EntryFile $e -TocLine "- 2026-07-19 (PH) phantom probe REVISED -- see below" 2>&1 | Out-Null
$rc2 = $LASTEXITCODE

$txt = [IO.File]::ReadAllText($copy)
$quotedHeadings = ([regex]::Matches($txt, [regex]::Escape("## 2026-07-19 (2) -- quoted example"))).Count
$run1Tail = ([regex]::Matches($txt, "RUN-ONE-TAIL-MARKER")).Count
$run2Tail = ([regex]::Matches($txt, "RUN-TWO-TAIL-MARKER")).Count
$sessMarkers = ([regex]::Matches($txt, [regex]::Escape("<!-- session:phsess -->"))).Count

Write-Output "helper: $Helper"
Write-Output "run1 exit=$rc1   run2 exit=$rc2"
Write-Output "quoted-example headings in file : $quotedHeadings"
Write-Output "RUN-ONE tail text still present : $run1Tail  (superseded text -- should be 0)"
Write-Output "RUN-TWO tail text present       : $run2Tail"
Write-Output "session markers for phsess      : $sessMarkers"
if ($rc2 -eq 4) {
    Write-Output "RESULT: run 2 REFUSED (exit 4) -- the body-heading entry never got in. Guard works."
} elseif ($run1Tail -gt 0) {
    Write-Output "RESULT: *** CORRUPTION REPRODUCED *** superseded RUN-ONE text survived the replace as an orphan fragment."
} else {
    Write-Output "RESULT: no phantom detected."
}
