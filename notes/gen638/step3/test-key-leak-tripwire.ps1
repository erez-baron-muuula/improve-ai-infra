# test-key-leak-tripwire.ps1 -- unit tests for key-leak-tripwire.ps1 (GEN-638 step 3).
#
# No real key is involved: the test makes a random value in memory, stores it under its OWN
# test-only Credential Manager entries (claude-tripwire-selftest*), writes it into temp "logs",
# runs the tripwire functions against a one-key test inventory and the temp folder, and
# removes exactly those entries and files at the end. It prints only PASS/FAIL lines -- never
# a value. The existing claude-dummy-test entries are not touched.
#
# Usage (PowerShell tool):  & "<this file>" [-Target <path to key-leak-tripwire.ps1>] [-GitHubRuns 5]
# Keep this file ASCII-only.

param(
  [string]$Target = (Join-Path $PSScriptRoot 'key-leak-tripwire.ps1'),
  [int]$GitHubRuns = 5
)

$ErrorActionPreference = 'Stop'
. $Target
$ErrorActionPreference = 'Stop'

$script:pass = 0
$script:fail = 0
function Check([string]$Label, [bool]$Ok) {
  if ($Ok) { $script:pass++; Write-Output ('PASS ' + $Label) } else { $script:fail++; Write-Output ('FAIL ' + $Label) }
}

function New-RandomToken([int]$Length) {
  $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  $bytes = New-Object byte[] $Length
  $rng = New-Object Security.Cryptography.RNGCryptoServiceProvider
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $sb = New-Object Text.StringBuilder
  foreach ($b in $bytes) { [void]$sb.Append($alphabet[$b % 62]) }
  return $sb.ToString()
}

function Remove-TestEntries($Vault, [string]$Resource) {
  try { foreach ($c in @($Vault.FindAllByResource($Resource))) { $Vault.Remove($c) } } catch { }
}

function Write-TestFile([string]$Path, [string]$Text, $Encoding) {
  $dir = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $dir)) { [void](New-Item -ItemType Directory -Path $dir -Force) }
  [IO.File]::WriteAllText($Path, $Text, $Encoding)
}

$utf8 = New-Object Text.UTF8Encoding($false)
$resLong = 'claude-tripwire-selftest'
$resShort = 'claude-tripwire-selftest-short'
$resMissing = 'claude-tripwire-selftest-missing'
$resTwo = 'claude-tripwire-selftest-two'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('key-tripwire-test-' + [guid]::NewGuid().ToString('N'))
$root = Join-Path $tmp 'logs'
$state = Join-Path $tmp 'state\scans.jsonl'
$allOutput = New-Object Text.StringBuilder   # every JSON the code under test produced
$vault = New-TripwireVault
$secret = 'tw' + (New-RandomToken 38)
$short = New-RandomToken 10
$secretTwo = 'tw' + (New-RandomToken 38)
$secretThree = 'tw' + (New-RandomToken 38)
$lock = $null

try {
  Remove-TestEntries $vault $resLong
  Remove-TestEntries $vault $resShort
  Remove-TestEntries $vault $resMissing
  Remove-TestEntries $vault $resTwo
  $vault.Add([Windows.Security.Credentials.PasswordCredential]::new($resLong, $resLong, $secret))
  $vault.Add([Windows.Security.Credentials.PasswordCredential]::new($resShort, $resShort, $short))

  # --- inventory ---
  $inv = Get-TripwireInventory (Join-Path $env:USERPROFILE '.claude\scripts\set-claude-key.ps1')
  Check 'inventory: real helper yields notion, atlassian, slack in order' ($null -ne $inv -and ((@($inv.Keys) -join ',') -eq 'notion,atlassian,slack'))
  Check 'inventory: real helper maps notion -> claude-notion-token' ($null -ne $inv -and $inv['notion'] -eq 'claude-notion-token')
  Check 'inventory: missing helper -> $null' ($null -eq (Get-TripwireInventory (Join-Path $tmp 'nope.ps1')))
  # A helper whose parameters share names with the inventory code's locals must not retype them
  # (PowerShell names are case-insensitive; the first build broke exactly this way on -List).
  $collide = Join-Path $tmp 'collide-helper.ps1'
  Write-TestFile $collide ("param([string]`$Key, [switch]`$List, [switch]`$Targets, [switch]`$InventoryMap, [switch]`$KeyName, [switch]`$HelperPath)`n`$KeyTargets = [ordered]@{ alpha = 'claude-a'; beta = 'claude-b' }`n") $utf8
  $collided = Get-TripwireInventory $collide
  Check 'inventory: helper params named like the locals do not break the map' ($null -ne $collided -and ((@($collided.Keys) -join ',') -eq 'alpha,beta') -and $collided['beta'] -eq 'claude-b')

  # --- vault reads ---
  $into = New-Object 'System.Collections.Generic.Dictionary[string,string]'
  Check 'vault: missing resource -> not-stored' ((Read-TripwireVaultKey $vault $resMissing 'm' $into) -eq 'not-stored')
  Check 'vault: stored resource -> ok' ((Read-TripwireVaultKey $vault $resLong 'k' $into) -eq 'ok')
  Check 'vault: value read back matches what was stored' ($into.ContainsKey('k') -and $into['k'] -ceq $secret)
  $into.Clear()

  # --- fixture logs ---
  $old = [DateTime]::UtcNow.AddDays(-2)
  $tenMinAgo = [DateTime]::UtcNow.AddMinutes(-10)
  Write-TestFile (Join-Path $root 'p1\s1.jsonl') ('{"type":"user","message":{"content":"here ' + $secret + ' there"}}' + "`n") $utf8
  Write-TestFile (Join-Path $root 'p1\s2.jsonl') ('{"type":"user","message":{"content":"nothing to see"}}' + "`n") $utf8
  Write-TestFile (Join-Path $root 'p1\s1\tool-results\r1.txt') ('prefix' + $secret + 'suffix') ([Text.Encoding]::Unicode)
  Write-TestFile (Join-Path $root 'p2\old.jsonl') ('x ' + $secret + ' y') $utf8
  Write-TestFile (Join-Path $root 'p2\partial.jsonl') ('only half: ' + $secret.Substring(0, 20)) $utf8
  foreach ($f in @('p1\s1.jsonl', 'p1\s2.jsonl', 'p1\s1\tool-results\r1.txt', 'p2\partial.jsonl')) { (Get-Item -LiteralPath (Join-Path $root $f)).LastWriteTimeUtc = $tenMinAgo }
  (Get-Item -LiteralPath (Join-Path $root 'p2\old.jsonl')).LastWriteTimeUtc = $old
  $testInv = [ordered]@{ selftest = $resLong; short = $resShort; absent = $resMissing }
  $missingRoot = Join-Path $tmp 'no-such-root'

  # --- run 1: first run, everything ---
  $r1 = Invoke-KeyTripwire -Inventory $testInv -Roots @($root, $missingRoot) -StatePath $state -GitHost ''
  $j1 = ConvertTo-Json -InputObject $r1 -Depth 6 -Compress
  [void]$allOutput.Append($j1)
  $c1 = @{}; foreach ($e in $r1['checks']) { $c1[$e['key']] = $e }
  Check 'run1: mode first-run' ($r1['mode'] -eq 'first-run')
  Check 'run1: selftest found' ($c1['selftest']['status'] -eq 'found')
  $paths1 = @($c1['selftest']['files'] | ForEach-Object { [IO.Path]::GetFileName($_['path']) } | Sort-Object)
  Check 'run1: found in exactly old.jsonl, r1.txt (UTF-16), s1.jsonl' (($paths1 -join ',') -eq 'old.jsonl,r1.txt,s1.jsonl')
  Check 'run1: partial copy is not a match' ($paths1 -notcontains 'partial.jsonl')
  Check 'run1: short value -> too-short, not a problem' ($c1['short']['status'] -eq 'too-short')
  Check 'run1: missing entry -> not-stored' ($c1['absent']['status'] -eq 'not-stored')
  Check 'run1: complete (missing root skipped, no problems)' ($r1['complete'] -eq $true -and $r1['problems'].Count -eq 0)
  Check 'run1: 5 files scanned' ($r1['filesScanned'] -eq 5)
  Check 'run1: exit code 2' ((Get-TripwireExitCode $r1) -eq 2)
  Check 'state: append succeeds' (Add-TripwireStateLine $state $j1)

  # --- run 2: a run that found a key is never the mark -> the key is reported again ---
  $r2 = Invoke-KeyTripwire -Inventory $testInv -Roots @($root) -StatePath $state -GitHost ''
  $j2 = ConvertTo-Json -InputObject $r2 -Depth 6 -Compress
  [void]$allOutput.Append($j2)
  $c2 = @{}; foreach ($e in $r2['checks']) { $c2[$e['key']] = $e }
  Check 'run2: after a found run there is still no mark (first-run again)' ($r2['mode'] -eq 'first-run' -and $null -eq (Get-TripwireLastCompleteStart $state).last)
  Check 'run2: the still-exposed key is reported again, exit 2' ($c2['selftest']['status'] -eq 'found' -and (Get-TripwireExitCode $r2) -eq 2)
  [void](Add-TripwireStateLine $state $j2)

  # --- runs A-E: the incremental window, with a key whose value is in no log yet ---
  $vault.Add([Windows.Security.Credentials.PasswordCredential]::new($resTwo, $resTwo, $secretTwo))
  $inv2 = [ordered]@{ second = $resTwo }
  $rA = Invoke-KeyTripwire -Inventory $inv2 -Roots @($root) -StatePath $state -GitHost ''
  $jA = ConvertTo-Json -InputObject $rA -Depth 6 -Compress
  [void]$allOutput.Append($jA)
  Check 'runA: no clean mark yet -> first-run, 5 files, clean, exit 0' ($rA['mode'] -eq 'first-run' -and $rA['filesScanned'] -eq 5 -and (Get-TripwireExitCode $rA) -eq 0)
  [void](Add-TripwireStateLine $state $jA)
  $rB = Invoke-KeyTripwire -Inventory $inv2 -Roots @($root) -StatePath $state -GitHost ''
  $jB = ConvertTo-Json -InputObject $rB -Depth 6 -Compress
  [void]$allOutput.Append($jB)
  Check 'runB: mode since, since = runA start - 5 min' ($rB['mode'] -eq 'since' -and $rB['sinceUtc'] -eq (Format-TripwireUtc ([datetime]::ParseExact($rA['startedUtc'], 'yyyy-MM-ddTHH:mm:ssZ', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal).AddMinutes(-5))))
  Check 'runB: files from 10 min / 2 days ago not re-read, exit 0' ($rB['filesScanned'] -eq 0 -and (Get-TripwireExitCode $rB) -eq 0)
  [void](Add-TripwireStateLine $state $jB)
  $markB = (Get-TripwireLastCompleteStart $state).last
  Start-Sleep -Milliseconds 1100   # starts are recorded to the second; keep runs C-E distinguishable from B
  Write-TestFile (Join-Path $root 'p3\new.jsonl') ('{"x":"' + $secretTwo + '"}') $utf8
  $rC = Invoke-KeyTripwire -Inventory $inv2 -Roots @($root) -StatePath $state -GitHost ''
  $jC = ConvertTo-Json -InputObject $rC -Depth 6 -Compress
  [void]$allOutput.Append($jC)
  $cC = @{}; foreach ($e in $rC['checks']) { $cC[$e['key']] = $e }
  Check 'runC: a new log written now is caught (only new.jsonl)' ($cC['second']['status'] -eq 'found' -and (@($cC['second']['files'] | ForEach-Object { [IO.Path]::GetFileName($_['path']) }) -join ',') -eq 'new.jsonl')
  [void](Add-TripwireStateLine $state $jC)
  $rD = Invoke-KeyTripwire -Inventory $inv2 -Roots @($root) -StatePath $state -GitHost ''
  $jD = ConvertTo-Json -InputObject $rD -Depth 6 -Compress
  [void]$allOutput.Append($jD)
  $cD = @{}; foreach ($e in $rD['checks']) { $cD[$e['key']] = $e }
  Check 'runD: next run still covers that log and reports it again; mark unchanged' ($cD['second']['status'] -eq 'found' -and (Get-TripwireLastCompleteStart $state).last -eq $markB)
  [void](Add-TripwireStateLine $state $jD)
  Remove-TestEntries $vault $resTwo
  $vault.Add([Windows.Security.Credentials.PasswordCredential]::new($resTwo, $resTwo, $secretThree))
  Start-Sleep -Milliseconds 1100
  $rE =Invoke-KeyTripwire -Inventory $inv2 -Roots @($root) -StatePath $state -GitHost ''
  $jE = ConvertTo-Json -InputObject $rE -Depth 6 -Compress
  [void]$allOutput.Append($jE)
  Check 'runE: after the key is replaced the same window is clean, exit 0' ($rE['mode'] -eq 'since' -and $rE['filesScanned'] -ge 1 -and (Get-TripwireExitCode $rE) -eq 0)
  [void](Add-TripwireStateLine $state $jE)
  $markAfter3 = (Get-TripwireLastCompleteStart $state).last
  Check 'runE: a clean run becomes the new mark' ($null -ne $markAfter3 -and $markAfter3 -ne $markB)

  # --- mark choice: append order, not the highest start; found runs skipped ---
  $orderState = Join-Path $tmp 'state\order.jsonl'
  $tRecent = [DateTime]::UtcNow.AddMinutes(-10); $tOlder = [DateTime]::UtcNow.AddHours(-3)
  [void](Add-TripwireStateLine $orderState ('{"tool":"key-leak-tripwire","startedUtc":"' + (Format-TripwireUtc $tRecent) + '","complete":true,"checkedKeys":["a"],"checks":[{"key":"a","status":"clean"}],"problems":[]}'))
  [void](Add-TripwireStateLine $orderState ('{"tool":"key-leak-tripwire","startedUtc":"' + (Format-TripwireUtc $tOlder) + '","complete":true,"checkedKeys":["a"],"checks":[{"key":"a","status":"clean"}],"problems":[]}'))
  [void](Add-TripwireStateLine $orderState ('{"tool":"key-leak-tripwire","startedUtc":"' + (Format-TripwireUtc ([DateTime]::UtcNow)) + '","complete":true,"checkedKeys":["a"],"checks":[{"key":"a","status":"found","files":[]}],"problems":[]}'))
  Check 'state: the mark is the last-appended clean run, not the highest start, and never a found run' ((Format-TripwireUtc (Get-TripwireLastCompleteStart $orderState).last) -eq (Format-TripwireUtc $tOlder))

  # --- a file that vanished between listing and reading is skipped, not a problem ---
  $gonePath = Join-Path $tmp 'gone.jsonl'
  Write-TestFile $gonePath 'x' $utf8
  Remove-Item -LiteralPath $gonePath -Force
  Check 'read: a file deleted after listing reads as $null (skipped)' ($null -eq (Read-TripwireFileText $gonePath))

  # --- run 4: a found key AND an unreadable file in one run ---
  $lockedPath = Join-Path $root 'p3\locked.jsonl'
  Write-TestFile $lockedPath 'locked' $utf8
  $lock = [IO.File]::Open($lockedPath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  Start-Sleep -Milliseconds 1100
  $r4 = Invoke-KeyTripwire -Inventory $testInv -Roots @($root) -StatePath $state -GitHost '' -All
  $lock.Dispose(); $lock = $null
  $j4 = ConvertTo-Json -InputObject $r4 -Depth 6 -Compress
  [void]$allOutput.Append($j4)
  $c4 = @{}; foreach ($e in $r4['checks']) { $c4[$e['key']] = $e }
  $codes4 = @($r4['problems'] | ForEach-Object { $_['code'] })
  Check 'run4: -All -> mode all' ($r4['mode'] -eq 'all')
  Check 'run4: found reported' ($c4['selftest']['status'] -eq 'found')
  Check 'run4: file-unreadable reported alongside, with its path' (($codes4 -contains 'file-unreadable') -and (@($r4['problems'] | Where-Object { $_['path'] -eq $lockedPath }).Count -eq 1))
  Check 'run4: not complete' ($r4['complete'] -eq $false)
  Check 'run4: exit code 2 (found wins)' ((Get-TripwireExitCode $r4) -eq 2)
  [void](Add-TripwireStateLine $state $j4)
  Check 'state: an incomplete run does not move the mark' ((Get-TripwireLastCompleteStart $state).last -eq $markAfter3)

  # --- run 5: problems without a found key -> exit 1 ---
  $r5 = Invoke-KeyTripwire -Inventory $null -Roots @($root) -StatePath $state -GitHost ''
  $j5 = ConvertTo-Json -InputObject $r5 -Depth 6 -Compress
  [void]$allOutput.Append($j5)
  Check 'run5: missing key list -> inventory-missing, exit 1' ((@($r5['problems'] | ForEach-Object { $_['code'] }) -contains 'inventory-missing') -and (Get-TripwireExitCode $r5) -eq 1)

  # --- run 6: a vault that cannot be read is a problem, never "not stored" ---
  $brokenVault = New-Object psobject
  $brokenVault | Add-Member -MemberType ScriptMethod -Name FindAllByResource -Value { param($r) throw (New-Object System.UnauthorizedAccessException) }
  $r6 = Invoke-KeyTripwire -Inventory ([ordered]@{ selftest = $resLong }) -Roots @($root) -StatePath $state -GitHost '' -Vault $brokenVault
  $j6 = ConvertTo-Json -InputObject $r6 -Depth 6 -Compress
  [void]$allOutput.Append($j6)
  $c6 = @{}; foreach ($e in $r6['checks']) { $c6[$e['key']] = $e }
  Check 'run6: unreadable vault -> could-not-check + vault-read-failed, exit 1' ($c6['selftest']['status'] -eq 'could-not-check' -and (@($r6['problems'] | ForEach-Object { $_['code'] }) -contains 'vault-read-failed') -and (Get-TripwireExitCode $r6) -eq 1)

  # --- unreadable state file -> problem, full scan ---
  $badState = Join-Path $tmp 'state\locked-state.jsonl'
  Write-TestFile $badState '' $utf8
  $lock = [IO.File]::Open($badState, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  $r7 = Invoke-KeyTripwire -Inventory $testInv -Roots @($root) -StatePath $badState -GitHost ''
  $lock.Dispose(); $lock = $null
  $j7 = ConvertTo-Json -InputObject $r7 -Depth 6 -Compress
  [void]$allOutput.Append($j7)
  Check 'run7: unreadable state -> state-unreadable + full scan' ((@($r7['problems'] | ForEach-Object { $_['code'] }) -contains 'state-unreadable') -and $r7['mode'] -eq 'all' -and $r7['filesScanned'] -ge 6)

  # --- run 8: a key the mark run did not check -> full scan ('new-key') ---
  $invTwo = [ordered]@{ selftest = $resLong; second = $resTwo }
  $r8 = Invoke-KeyTripwire -Inventory $invTwo -Roots @($root) -StatePath $state -GitHost ''
  $j8 = ConvertTo-Json -InputObject $r8 -Depth 6 -Compress
  [void]$allOutput.Append($j8)
  Check 'run8: newly stored key -> mode new-key, every file scanned' ($r8['mode'] -eq 'new-key' -and $null -eq $r8['sinceUtc'] -and $r8['filesScanned'] -ge 7)
  Check 'run8: checkedKeys lists both names' ((@($r8['checkedKeys']) -join ',') -eq 'second,selftest')
  [void](Add-TripwireStateLine $state $j8)
  $r9 = Invoke-KeyTripwire -Inventory $invTwo -Roots @($root) -StatePath $state -GitHost ''
  [void]$allOutput.Append((ConvertTo-Json -InputObject $r9 -Depth 6 -Compress))
  Check 'run9: selftest was found, so it is still unchecked by any clean mark -> new-key again' ($r9['mode'] -eq 'new-key')

  # --- run 10: a mark in the future (clock was wrong) -> full scan ('clock-reset') ---
  $futureState = Join-Path $tmp 'state\future.jsonl'
  [void](Add-TripwireStateLine $futureState ('{"tool":"key-leak-tripwire","version":1,"startedUtc":"' + (Format-TripwireUtc ([DateTime]::UtcNow.AddDays(2))) + '","complete":true,"checkedKeys":["selftest"],"checks":[],"problems":[]}'))
  $r10 = Invoke-KeyTripwire -Inventory ([ordered]@{ selftest = $resLong }) -Roots @($root) -StatePath $futureState -GitHost ''
  [void]$allOutput.Append((ConvertTo-Json -InputObject $r10 -Depth 6 -Compress))
  Check 'run10: future mark -> mode clock-reset, every file scanned' ($r10['mode'] -eq 'clock-reset' -and $r10['filesScanned'] -ge 7)

  # --- run 11: a required log folder that is missing is a problem, never "clean" ---
  $r11 = Invoke-KeyTripwire -Inventory ([ordered]@{ selftest = $resLong }) -Roots @($missingRoot) -RequiredRoots @($missingRoot) -StatePath (Join-Path $tmp 'state\r11.jsonl') -GitHost ''
  [void]$allOutput.Append((ConvertTo-Json -InputObject $r11 -Depth 6 -Compress))
  Check 'run11: missing required root -> root-missing, exit 1' ((@($r11['problems'] | ForEach-Object { $_['code'] }) -contains 'root-missing') -and (Get-TripwireExitCode $r11) -eq 1)

  # --- run 12: a key list entry named 'github' does not collide with the Git login check ---
  $r12 = Invoke-KeyTripwire -Inventory ([ordered]@{ github = $resLong }) -Roots @($root) -StatePath (Join-Path $tmp 'state\r12.jsonl') -GitHost 'example.invalid'
  [void]$allOutput.Append((ConvertTo-Json -InputObject $r12 -Depth 6 -Compress))
  $names12 = @($r12['checks'] | ForEach-Object { $_['key'] + '=' + $_['status'] })
  Check 'run12: inventory github kept, Git login reported as github-login' (($names12 -join ',') -eq 'github=found,github-login=not-stored')

  # --- the script itself, as a separate process, against a fixture profile ---
  $fixture = Join-Path $tmp 'profile'
  Write-TestFile (Join-Path $fixture '.claude\scripts\set-claude-key.ps1') ("`$KeyTargets = [ordered]@{ selftest = '" + $resLong + "' }`n") $utf8
  Write-TestFile (Join-Path $fixture '.claude\projects\p\s.jsonl') ('{"a":"' + $secret + '"}') $utf8
  Write-TestFile (Join-Path $fixture '.claude\projects\p\clean.jsonl') '{"a":"b"}' $utf8
  [void](New-Item -ItemType Directory -Path (Join-Path $fixture 'AppData') -Force)
  $fixtureState = Join-Path $fixture '.claude\hooks\key-tripwire-scans.jsonl'
  $childRuns = @(@{ args = ''; mode = 'first-run' }, @{ args = ''; mode = 'first-run' }, @{ args = ' -All'; mode = 'all' })
  $runIndex = 0
  foreach ($cr in $childRuns) {
    $runIndex++
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')
    $psi.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $Target + '"' + $cr.args
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.EnvironmentVariables['USERPROFILE'] = $fixture
    $psi.EnvironmentVariables['APPDATA'] = (Join-Path $fixture 'AppData')
    $child = [Diagnostics.Process]::Start($psi)
    $outT = $child.StandardOutput.ReadToEndAsync()
    $errT = $child.StandardError.ReadToEndAsync()
    $exited = $child.WaitForExit(180000)
    if ($exited) { $child.WaitForExit() } else { try { $child.Kill() } catch { } }
    [void]$outT.Wait(5000); [void]$errT.Wait(5000)
    $stdout = $outT.Result.Trim()
    $stderr = $errT.Result
    [void]$allOutput.Append($stdout); [void]$allOutput.Append($stderr)
    $parsed = $null
    try { $parsed = ConvertFrom-Json -InputObject $stdout } catch { $parsed = $null }
    $expected = -1
    if ($null -ne $parsed) {
      $expected = 0
      if ($parsed.complete -ne $true) { $expected = 1 }
      if (@($parsed.checks | Where-Object { $_.status -eq 'found' }).Count -gt 0) { $expected = 2 }
    }
    $selftestStatus = $null
    if ($null -ne $parsed) { $selftestStatus = @($parsed.checks | Where-Object { $_.key -eq 'selftest' })[0].status }
    $stateLines = @()
    if (Test-Path -LiteralPath $fixtureState) { $stateLines = @([IO.File]::ReadAllLines($fixtureState) | Where-Object { $_ -ne '' }) }
    Check ('script run ' + $runIndex + ': exits, prints one JSON object, nothing on stderr') ($exited -and $null -ne $parsed -and [string]::IsNullOrWhiteSpace($stderr))
    Check ('script run ' + $runIndex + ': mode ' + $cr.mode + ', selftest found') ($null -ne $parsed -and $parsed.mode -eq $cr.mode -and $selftestStatus -eq 'found')
    Check ('script run ' + $runIndex + ': exit code ' + $child.ExitCode + ' matches the JSON (' + $expected + ')') ($exited -and $child.ExitCode -eq $expected)
    Check ('script run ' + $runIndex + ': the state file gained exactly this JSON as its last line') ($stateLines.Count -eq $runIndex -and $stateLines[-1] -eq $stdout)
    $child.Dispose()
  }
  [void]$allOutput.Append([IO.File]::ReadAllText($fixtureState))

  # --- no value anywhere in what the code produced ---
  $stateText = [IO.File]::ReadAllText($state)
  $produced = $allOutput.ToString() + $stateText
  Check 'leak: no JSON or state line contains the test value' ($produced.IndexOf($secret, [StringComparison]::Ordinal) -lt 0)
  Check 'leak: no JSON or state line contains the short value' ($produced.IndexOf($short, [StringComparison]::Ordinal) -lt 0)
  Check 'leak: no JSON or state line contains even half the value' ($produced.IndexOf($secret.Substring(0, 20), [StringComparison]::Ordinal) -lt 0)
  Check 'leak: no JSON or state line contains the second value' ($produced.IndexOf($secretTwo, [StringComparison]::Ordinal) -lt 0)
  Check 'leak: no JSON or state line contains the replacement value' ($produced.IndexOf($secretThree, [StringComparison]::Ordinal) -lt 0)

  # --- GitHub ---
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $none = Read-TripwireGitKey 'example.invalid' 'g' $into 15000
  $sw.Stop()
  Check ('github: host with no stored login -> not-stored (' + $sw.ElapsedMilliseconds + ' ms)') ($none -eq 'not-stored' -and $sw.ElapsedMilliseconds -lt 15000)
  Check 'github: no value captured for that host' (-not $into.ContainsKey('g'))
  for ($i = 1; $i -le $GitHubRuns; $i++) {
    $into.Clear()
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $got = Read-TripwireGitKey 'github.com' 'github' $into
    $sw.Stop()
    $okLen = $into.ContainsKey('github') -and $into['github'].Length -ge 20
    Check ('github: run ' + $i + ' reads the stored login (' + $got + ', ' + $sw.ElapsedMilliseconds + ' ms)') ($got -eq 'ok' -and $okLen)
  }
  # Tracing switched on in the environment must not reach git: no trace file may appear.
  $traceFiles = @((Join-Path $tmp 'git-trace.txt'), (Join-Path $tmp 'git-trace2.txt'), (Join-Path $tmp 'gcm-trace.txt'))
  $savedEnv = @{ GIT_TRACE = $env:GIT_TRACE; GIT_TRACE2 = $env:GIT_TRACE2; GCM_TRACE = $env:GCM_TRACE; GCM_TRACE_SECRETS = $env:GCM_TRACE_SECRETS }
  try {
    # Positive control: with GIT_TRACE set, a plain git call DOES write a trace file.
    $controlTrace = Join-Path $tmp 'git-trace-control.txt'
    $env:GIT_TRACE = $controlTrace
    & git.exe --version | Out-Null
    Check 'github: control -- GIT_TRACE in the environment makes plain git write a trace file' (Test-Path -LiteralPath $controlTrace)
    Remove-Item -LiteralPath $controlTrace -Force -ErrorAction SilentlyContinue
    $env:GIT_TRACE = $traceFiles[0]; $env:GIT_TRACE2 = $traceFiles[1]; $env:GCM_TRACE = $traceFiles[2]; $env:GCM_TRACE_SECRETS = '1'
    $into.Clear()
    $gotTraced = Read-TripwireGitKey 'github.com' 'github' $into
    Check ('github: with tracing set in the environment the read still works (' + $gotTraced + ') and writes no trace file') ($gotTraced -eq 'ok' -and @($traceFiles | Where-Object { Test-Path -LiteralPath $_ }).Count -eq 0)
  } finally {
    foreach ($k in @($savedEnv.Keys)) { Set-Item -Path ('env:' + $k) -Value $savedEnv[$k] -ErrorAction SilentlyContinue; if ($null -eq $savedEnv[$k]) { Remove-Item -Path ('env:' + $k) -ErrorAction SilentlyContinue } }
    foreach ($tf in $traceFiles) { Remove-Item -LiteralPath $tf -Force -ErrorAction SilentlyContinue }
  }
  $into.Clear()
  Check 'github: no temp input file left behind' (@(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Filter 'key-tripwire-git-*' -ErrorAction SilentlyContinue).Count -eq 0)
} finally {
  if ($null -ne $lock) { try { $lock.Dispose() } catch { } }
  Remove-TestEntries $vault $resLong
  Remove-TestEntries $vault $resShort
  Remove-TestEntries $vault $resMissing
  Remove-TestEntries $vault $resTwo
  try { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue } catch { }
  $secret = $null; $short = $null; $secretTwo = $null; $secretThree = $null
}

$leftover = @($resLong, $resShort, $resTwo | Where-Object { (Read-TripwireVaultKey $vault $_ 'x' (New-Object 'System.Collections.Generic.Dictionary[string,string]')) -ne 'not-stored' })
Check 'cleanup: test vault entries removed' ($leftover.Count -eq 0)
Check 'cleanup: temp folder removed' (-not (Test-Path -LiteralPath $tmp))
Write-Output ('TOTAL: ' + $script:pass + ' passed, ' + $script:fail + ' failed')
if ($script:fail -gt 0) { exit 1 }
exit 0
