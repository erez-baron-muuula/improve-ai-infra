# GEN-488 live-verify harness. Pipes real PreToolUse JSON payloads into the working
# copy installed in a fake self-consistent .claude tree (fakehome\.claude\hooks\
# auto-approve.js), so __dirname-derived paths (home, settings, staging, hooks dir)
# resolve to fixtures. Project-root cases use the real hardcoded PROJECT_ROOTS strings
# via cwd (string classification only; nothing is written to real project dirs).
# ASCII-only file. Run via the PowerShell tool.

$ErrorActionPreference = 'Continue'
$scratch = 'C:\Users\Erez\AppData\Local\Temp\claude\C--Users-Erez-AI-Projects-Improve-AI-Infra\e3e00658-0915-4262-a1f9-0dd412ee3cee\scratchpad'
$fakeHome = Join-Path $scratch 'fakehome'
$hookPath = Join-Path $fakeHome '.claude\hooks\auto-approve.js'
$workDir = Join-Path $scratch 'verify-work'
New-Item -ItemType Directory -Force -Path $workDir | Out-Null
$realProject = 'C:\Users\Erez\AI Projects\Improve AI Infra'
$realScratchpad = Join-Path $scratch ''  # session scratchpad itself
$sessionId = 'e3e00658-0915-4262-a1f9-0dd412ee3cee'

$results = @()
$caseNum = 0

function Invoke-HookCase {
    param(
        [string]$CaseName,
        [string]$ToolName,
        [hashtable]$ToolInput,
        [string]$CwdVal,
        [string]$Expect       # FIRE | SILENT | ALLOW | BLOCK
    )
    $script:caseNum++
    $payload = @{ tool_name = $ToolName; tool_input = $ToolInput; cwd = $CwdVal; session_id = $script:sessionId }
    $json = $payload | ConvertTo-Json -Compress -Depth 5
    $pFile = Join-Path $script:workDir ("case" + $script:caseNum + ".json")
    $oFile = Join-Path $script:workDir ("case" + $script:caseNum + ".out")
    $eFile = Join-Path $script:workDir ("case" + $script:caseNum + ".err")
    [IO.File]::WriteAllText($pFile, $json)   # UTF8 no BOM
    & cmd.exe /c "type `"$pFile`" | node `"$script:hookPath`" > `"$oFile`" 2> `"$eFile`""
    $exitCode = $LASTEXITCODE
    $stdout = ''
    if (Test-Path $oFile) { $stdout = [IO.File]::ReadAllText($oFile) }
    $stderrTxt = ''
    if (Test-Path $eFile) { $stderrTxt = [IO.File]::ReadAllText($eFile) }

    $verdict = 'FAIL'
    switch ($Expect) {
        'FIRE'   { if ($exitCode -eq 0 -and $stdout -match 'additionalContext' -and $stdout -match 'Redirect nudge' -and $stdout -notmatch 'permissionDecision') { $verdict = 'PASS' } }
        'SILENT' { if ($exitCode -eq 0 -and $stdout.Trim() -eq '') { $verdict = 'PASS' } }
        'ALLOW'  { if ($exitCode -eq 0 -and $stdout -match '"permissionDecision":"allow"' -and $stdout -notmatch 'Redirect nudge') { $verdict = 'PASS' } }
        'BLOCK'  { if ($exitCode -eq 2 -and $stdout.Trim() -eq '' -and $stderrTxt -match 'Refused') { $verdict = 'PASS' } }
    }
    $script:results += [pscustomobject]@{
        Num = $script:caseNum; Case = $CaseName; Expect = $Expect; Verdict = $verdict
        Exit = $exitCode; StdoutHead = ($stdout -replace '\s+', ' ').Substring(0, [Math]::Min(160, $stdout.Length))
        StderrHead = ($stderrTxt -replace '\s+', ' ').Substring(0, [Math]::Min(120, $stderrTxt.Length))
    }
}

# ---- FIRE cases (nudge expected, exit 0, no permissionDecision) ----
Invoke-HookCase 'PS Out-File to home root' 'PowerShell' @{ command = "Get-Date | Out-File $fakeHome\stray-report.txt" } $realProject 'FIRE'
Invoke-HookCase 'bash > to home root (fwd slashes)' 'Bash' @{ command = ("echo hi > " + ($fakeHome -replace '\\','/') + "/stray.txt") } $realProject 'FIRE'
Invoke-HookCase 'PS relative > in real project root' 'PowerShell' @{ command = 'node build.js > out.bin' } $realProject 'FIRE'
Invoke-HookCase 'bash bare ~/ redirect' 'Bash' @{ command = 'git log --oneline > ~/log-dump.txt' } $realProject 'FIRE'
Invoke-HookCase 'curl -o to home root' 'PowerShell' @{ command = "curl.exe -sk https://example.com -o $fakeHome\out.json" } $realProject 'FIRE'

# ---- SILENT cases (no output at all, exit 0) ----
Invoke-HookCase 'quoted prose > in commit msg' 'Bash' @{ command = 'git commit -m "fix a > b thing"' } $realProject 'SILENT'
Invoke-HookCase 'jq comparison in single quotes' 'Bash' @{ command = "jq '.count > 5' data.json" } $realProject 'SILENT'
Invoke-HookCase 'set -o pipefail (flag operand)' 'Bash' @{ command = 'set -o pipefail' } $realProject 'SILENT'
Invoke-HookCase 'redirect into session scratchpad' 'PowerShell' @{ command = "Get-Date | Out-File $scratch\tmp-probe.txt" } $realProject 'SILENT'
Invoke-HookCase 'redirect into project subfolder' 'PowerShell' @{ command = 'node x.js > notes\out.txt' } $realProject 'SILENT'
Invoke-HookCase 'redirect into home SUBfolder' 'PowerShell' @{ command = "echo x > $fakeHome\Documents\a.txt" } $realProject 'SILENT'
Invoke-HookCase 'multi-line command with >' 'PowerShell' @{ command = "line1`necho x > $fakeHome\x.txt" } $realProject 'SILENT'
Invoke-HookCase 'unbalanced apostrophe fail-open' 'Bash' @{ command = "echo don't care > $fakeHome/x.txt" } $realProject 'SILENT'
Invoke-HookCase 'ssh -o option operand' 'Bash' @{ command = 'ssh -o StrictHostKeyChecking=no host uptime' } $realProject 'SILENT'
Invoke-HookCase 'quoted tilde not expanded (bash)' 'Bash' @{ command = 'some-tool > "~/notes.txt"' } $realProject 'SILENT'
Invoke-HookCase 'mv to home (pattern removed)' 'Bash' @{ command = "mv out.zip $fakeHome/archive" } $realProject 'SILENT'

# ---- Decision regression cases ----
Invoke-HookCase 'read-only git status approve' 'Bash' @{ command = 'git status' } $realProject 'ALLOW'
Invoke-HookCase 'read-only Read tool approve' 'Read' @{ file_path = 'C:\anything.txt' } $realProject 'ALLOW'
Invoke-HookCase 'mixed chain hard-block' 'Bash' @{ command = "echo hi > $fakeHome/x.txt && git push" } $realProject 'BLOCK'
Invoke-HookCase 'protected settings.json edit block' 'Edit' @{ file_path = 'C:\Users\Erez\.claude\settings.json'; old_string = 'a'; new_string = 'b' } $realProject 'BLOCK'
Invoke-HookCase 'vetting lock on fake hook write' 'PowerShell' @{ command = "Set-Content -Path $fakeHome\.claude\hooks\auto-approve.js -Value 'x'" } $realProject 'BLOCK'
Invoke-HookCase 'GEN-485 check lock on fake CLAUDE.md' 'PowerShell' @{ command = "& 'G:\My Drive\AI Projects\_Tooling\Claude\update-global-rule.ps1' -OldText 'x' -NewText 'y'" } $realProject 'BLOCK'

# ---- report ----
$results | Format-Table Num, Case, Expect, Verdict, Exit -AutoSize | Out-String -Width 200
$failed = @($results | Where-Object { $_.Verdict -ne 'PASS' })
"TOTAL: $($results.Count)  PASS: $($results.Count - $failed.Count)  FAIL: $($failed.Count)"
if ($failed.Count -gt 0) {
    "--- FAILURES DETAIL ---"
    $failed | ForEach-Object { "#$($_.Num) $($_.Case) [expect $($_.Expect)] exit=$($_.Exit)`n  stdout: $($_.StdoutHead)`n  stderr: $($_.StderrHead)" }
}
$LASTEXITCODE = 0
exit 0
