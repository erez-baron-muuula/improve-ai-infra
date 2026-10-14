param(
    [string]$Script = (Join-Path $PSScriptRoot 'session-backup.ps1'),
    [string]$DriveTestRoot = 'G:\My Drive\AI Projects\_Tooling\Claude Session Backup\_vet-test'
)
# Scratch-tree tests for session-backup.ps1. Sources on C: (scratch), backup on the real Drive (G:) in a
# throwaway _vet-test folder, so Drive file-system behaviour is exercised. Never touches the real backup.
$ErrorActionPreference = 'Stop'
$P = '\\?\'
$base = Join-Path $env:TEMP ('sbtest-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$runTag = [guid]::NewGuid().ToString('N').Substring(0, 6)
$results = New-Object System.Collections.ArrayList
function Check([string]$name, [bool]$ok, [string]$info = '') { [void]$results.Add([pscustomobject]@{ test = $name; ok = $ok; info = $info }) }
function TWrite([string]$path, [string]$text) { [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($P + $path)); [IO.File]::WriteAllText($P + $path, $text) }
function TRead([string]$path) { return [IO.File]::ReadAllText($P + $path) }
# Drive's G: can show a just-replaced shorter file with the old file's tail to this process for some
# seconds (cloud copy verified correct); content checks therefore wait up to 30 s for the expected text.
function TReadEq([string]$path, [string]$want) { $t0 = Get-Date; while ($true) { if ((TRead $path) -eq $want) { return $true }; if (((Get-Date) - $t0).TotalSeconds -gt 150) { return $false }; Start-Sleep -Milliseconds 1000 } }
function TExists([string]$path) { return [IO.File]::Exists($P + $path) }
function TMtime([string]$path) { return [IO.File]::GetLastWriteTimeUtc($P + $path) }
function Get-Queue([string]$qf) { if (Test-Path -LiteralPath $qf) { return @(Get-Content -LiteralPath $qf | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json }) } else { return @() } }
function Get-Tree([string]$root) { if (-not [IO.Directory]::Exists($P + $root)) { return @() }; return @(([IO.DirectoryInfo]($P + $root)).EnumerateFiles('*', [IO.SearchOption]::AllDirectories) | ForEach-Object { $_.FullName + '|' + $_.Length + '|' + $_.LastWriteTimeUtc.Ticks } | Sort-Object) }

function New-Case([string]$name) {
    $c = @{
        proj = Join-Path $base "$name\src-projects"
        sess = Join-Path $base "$name\src-sessions"
        root = Join-Path $DriveTestRoot "$runTag-$name"
        state = Join-Path $base "$name\state"
        queue = Join-Path $base "$name\queue.jsonl"
    }
    [void][IO.Directory]::CreateDirectory($c.proj); [void][IO.Directory]::CreateDirectory($c.sess); [void][IO.Directory]::CreateDirectory($P + $c.root)
    return $c
}
function Invoke-Backup($c, [int]$budget = 20, [string]$rootOverride = $null, [int]$drop = 10, [switch]$report) {
    $root = $c.root; if ($rootOverride) { $root = $rootOverride }
    $a = @('-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-File', $Script, '-SessionId', 'test-session', '-ProjectsSource', $c.proj, '-SessionsSource', $c.sess, '-BackupRoot', $root, '-StateDir', $c.state, '-FailureQueueFile', $c.queue, '-BudgetSeconds', $budget, '-DropAlertCount', $drop)
    if ($report) { $a += '-ReportOnly' }
    $script:LastOut = (& powershell.exe @a 2>&1 | Out-String)
    $rcode = $LASTEXITCODE
    # Drive's virtual drive can show ANOTHER process the previous content for a moment right after a
    # rename swap (seen once in five suite runs: the run log showed the copy, the next read was old).
    Start-Sleep -Milliseconds 1500
    return $rcode
}

# ---- A: first run copies everything, including a > 260-char path
$a = New-Case 'A'
$deepRel = 'proj1'; while ($deepRel.Length -lt 250) { $deepRel = Join-Path $deepRel 'abcdefghijklmnopqrstuvwxyz0123456789' }
TWrite (Join-Path $a.proj 'proj1\s1.jsonl') "line1`nline2`n"
TWrite (Join-Path $a.proj 'proj1\s1\custom-title.json') '{"title":"a long original title"}'
TWrite (Join-Path $a.proj 'proj1\memory\note.md') ('x' * 100)
TWrite (Join-Path $a.proj (Join-Path $deepRel 'deep.jsonl')) "deep`n"
TWrite (Join-Path $a.sess 'acct\local_1.json') '{"x":1}'
TWrite (Join-Path $a.sess 'acct\local_2.json') '{"session":"abc","n":1}'
$rc = Invoke-Backup $a
Check 'A exit 0' ($rc -eq 0) "rc=$rc $LastOut"
Check 'A transcript copied' ((TExists (Join-Path $a.root 'projects\proj1\s1.jsonl')) -and (TReadEq (Join-Path $a.root 'projects\proj1\s1.jsonl') "line1`nline2`n"))
$deepDst = Join-Path $a.root (Join-Path 'projects' (Join-Path $deepRel 'deep.jsonl'))
Check 'A long path copied' (TExists $deepDst) ("dst path length " + $deepDst.Length)
Check 'A sessions copied' (TExists (Join-Path $a.root 'claude-code-sessions\acct\local_1.json'))
Check 'A last-success stamped' (Test-Path -LiteralPath (Join-Path $a.state 'last-success'))
Check 'A no queue records' ((Get-Queue $a.queue).Count -eq 0)
$dm = TMtime (Join-Path $a.root 'projects\proj1\s1.jsonl'); $sm = TMtime (Join-Path $a.proj 'proj1\s1.jsonl')
Check 'A mtime preserved' ([Math]::Abs(($sm - $dm).TotalSeconds) -le 2) "src=$($sm.ToString('o')) dst=$($dm.ToString('o'))"
$rc = Invoke-Backup $a
Check 'A second run copies nothing' ($rc -eq 0 -and ((Get-Content -LiteralPath (Join-Path $a.state 'runs.log') | Select-Object -Last 1 | ConvertFrom-Json).copied -eq 0)) "rc=$rc"

# ---- A2: unchanged left alone; backup-only file survives; grown transcript copied
TWrite (Join-Path $a.root 'projects\proj1\deleted-locally.txt') 'keep me'
$before = TMtime (Join-Path $a.root 'claude-code-sessions\acct\local_1.json')
Start-Sleep -Milliseconds 2200
[IO.File]::AppendAllText($P + (Join-Path $a.proj 'proj1\s1.jsonl'), "line3`n")
$rc = Invoke-Backup $a
Check 'A2 exit 0' ($rc -eq 0) "rc=$rc $LastOut"
Check 'A2 grown transcript copied' ((TReadEq (Join-Path $a.root 'projects\proj1\s1.jsonl') "line1`nline2`nline3`n"))
Check 'A2 unchanged file untouched' (((TMtime (Join-Path $a.root 'claude-code-sessions\acct\local_1.json')) - $before).TotalSeconds -eq 0)
Check 'A2 backup-only file kept' (TExists (Join-Path $a.root 'projects\proj1\deleted-locally.txt'))
Check 'A2 no previous-versions' (-not (Test-Path -LiteralPath (Join-Path $a.root '_previous-versions')))

# ---- A3: small title shrink (replace, no keep), big note shrink (keep, silent), shrunk + rewritten
#          transcripts (keep + alert), empty json (held once), cut-off json (held)
Start-Sleep -Milliseconds 2200
TWrite (Join-Path $a.proj 'proj1\s1\custom-title.json') '{"title":"a long title"}'
TWrite (Join-Path $a.proj 'proj1\memory\note.md') 'tiny'
TWrite (Join-Path $a.proj 'proj1\s1.jsonl') "line1`n"
TWrite (Join-Path $a.proj 'proj1\s2.jsonl') "aaaa`nbbbb`n"
$rc = Invoke-Backup $a
Start-Sleep -Milliseconds 2200
TWrite (Join-Path $a.proj 'proj1\s2.jsonl') "XXXX`nbbbb`ncccc`n"
TWrite (Join-Path $a.sess 'acct\local_1.json') ''
TWrite (Join-Path $a.sess 'acct\local_2.json') '{"session":"abc","n":2,"tit'
$rc = Invoke-Backup $a
Check 'A3 exit 0' ($rc -eq 0) "rc=$rc $LastOut"
$prevFiles = @(Get-Tree (Join-Path $a.root '_previous-versions') | ForEach-Object { ($_ -split '\|')[0] })
Check 'A3 kept older copies: s1.jsonl, s2.jsonl, note.md, custom-title.json' ($prevFiles.Count -eq 4 -and ($prevFiles -match 's1\.jsonl$').Count -eq 1 -and ($prevFiles -match 's2\.jsonl$').Count -eq 1 -and ($prevFiles -match 'note\.md$').Count -eq 1 -and ($prevFiles -match 'custom-title\.json$').Count -eq 1) ("prev: " + (($prevFiles | ForEach-Object { Split-Path $_ -Leaf }) -join ','))
Check 'A3 no temp files in previous-versions' (@($prevFiles -match '\.sb(tmp|old)$').Count -eq 0)
$tb = Join-Path $a.root 'projects\proj1\s1\custom-title.json'; $tl = Join-Path $a.proj 'proj1\s1\custom-title.json'
function Describe-Title { "fresh-process=[" + (& powershell.exe -NoProfile -Command ("[IO.File]::ReadAllText('\\?\" + $tb + "')")) + "] backup=[" + (TRead $tb) + "] " + (New-Object IO.FileInfo($P + $tb)).Length + "b " + (TMtime $tb).ToString('HH:mm:ss.fff') + " local=[" + (TRead $tl) + "] " + (TMtime $tl).ToString('HH:mm:ss.fff') + " | " + ((Get-Content -LiteralPath (Join-Path $a.state 'runs.log') | Select-Object -Last 2) -join ' || ') }
# Files replaced by SHORTER content can read wrong on G: for some minutes (Drive shows the new bytes plus
# the old file's tail; cloud copy and later reads are correct -- checked 2026-10-14). Such content checks
# are deferred to the end of the suite.
$script:Deferred = New-Object System.Collections.ArrayList
[void]$script:Deferred.Add(@{ name = 'A3 title shrink replaced after keeping (checked at end)'; path = $tb; want = '{"title":"a long title"}' })
# second shrink of a title the same day uses its own file, so the lag above cannot affect it
$tb2 = Join-Path $a.root 'projects\proj1\s2\custom-title.json'; $tl2 = Join-Path $a.proj 'proj1\s2\custom-title.json'
TWrite $tl2 '{"title":"a long original title"}'
$rc = Invoke-Backup $a
Start-Sleep -Milliseconds 2200
TWrite $tl2 '{"title":"a long title"}'
$rc = Invoke-Backup $a
Start-Sleep -Milliseconds 2200
TWrite $tl2 '{"title":"short"}'
$rc = Invoke-Backup $a
[void]$script:Deferred.Add(@{ name = 'A3 second title shrink same day replaced (checked at end)'; path = $tb2; want = '{"title":"short"}' })
$prev2 = @(Get-Tree (Join-Path $a.root '_previous-versions') | Where-Object { $_ -match 's2\\custom-title\.json\|' })
Check 'A3 projects file shrinking twice the same day: an older copy kept both times' ($prev2.Count -eq 2) ("rc=$rc copies=$($prev2.Count)")
# session-list files (claude-code-sessions) keep at most one older copy per file per day
$sl = Join-Path $a.sess 'acct\local_9.json'; $slb = Join-Path $a.root 'claude-code-sessions\acct\local_9.json'
TWrite $sl '{"session":"x","summary":"a long first summary text"}'
$rc = Invoke-Backup $a
Start-Sleep -Milliseconds 2200
TWrite $sl '{"session":"x","summary":"shorter summary"}'
$rc = Invoke-Backup $a
Start-Sleep -Milliseconds 2200
TWrite $sl '{"session":"x","summary":"short"}'
$rc = Invoke-Backup $a
$prev3 = @(Get-Tree (Join-Path $a.root '_previous-versions') | Where-Object { $_ -match 'local_9\.json\|' })
Check 'A3 session-list file shrinking twice the same day: one older copy kept' ($prev3.Count -eq 1) ("rc=$rc copies=$($prev3.Count)")
[void]$script:Deferred.Add(@{ name = 'A3 session-list second shrink replaced (checked at end)'; path = $slb; want = '{"session":"x","summary":"short"}' })
Check 'A3 note replaced after keeping' ((TReadEq (Join-Path $a.root 'projects\proj1\memory\note.md') 'tiny'))
Check 'A3 shrunk transcript now local content' ((TReadEq (Join-Path $a.root 'projects\proj1\s1.jsonl') "line1`n"))
Check 'A3 rewritten transcript now local content' ((TReadEq (Join-Path $a.root 'projects\proj1\s2.jsonl') "XXXX`nbbbb`ncccc`n"))
Check 'A3 empty json kept backup' ((TReadEq (Join-Path $a.root 'claude-code-sessions\acct\local_1.json') '{"x":1}'))
Check 'A3 cut-off json kept backup' ((TReadEq (Join-Path $a.root 'claude-code-sessions\acct\local_2.json') '{"session":"abc","n":1}'))
Check 'A3 no temp left beside held files' (-not (TExists (Join-Path $a.root 'claude-code-sessions\acct\local_2.json.sbtmp')))
$q = Get-Queue $a.queue
$kinds = ($q | ForEach-Object { $_.kind }) -join ','
Check 'A3 two shrunk alerts (transcripts only)' (@($q | Where-Object { $_.kind -eq 'session-shrunk' }).Count -eq 2) "kinds: $kinds"
Check 'A3 two held alerts' (@($q | Where-Object { $_.kind -eq 'session-held' }).Count -eq 2) "kinds: $kinds"
Check 'A3 no error records' (@($q | Where-Object { $_.kind -eq 'error' }).Count -eq 0) "kinds: $kinds"
Check 'A3 shrunk alert names kept path first' (@($q | Where-Object { $_.kind -eq 'session-shrunk' -and $_.detail -like 'older backup copy kept at *' }).Count -eq 2)
Check 'A3 record shape' (($q | Where-Object { $_.repo -ne '(session backup)' -or $_.surfaced -ne $false -or -not $_.ts -or -not $_.machine -or $_.session -ne 'test-session' }).Count -eq 0)
$rc = Invoke-Backup $a
Check 'A3b repeat run: held alerts not repeated' (@((Get-Queue $a.queue) | Where-Object { $_.kind -eq 'session-held' }).Count -eq 2) "rc=$rc"

# ---- A4: same-size transcript with only a new modified time is touched, not recopied
$t1 = Join-Path $a.root 'projects\proj1\s2.jsonl'
$treeBefore = Get-Tree (Join-Path $a.root 'projects')
Start-Sleep -Milliseconds 2200
[IO.File]::SetLastWriteTimeUtc($P + (Join-Path $a.proj 'proj1\s2.jsonl'), [DateTime]::UtcNow)
$rc = Invoke-Backup $a
$last = Get-Content -LiteralPath (Join-Path $a.state 'runs.log') | Select-Object -Last 1 | ConvertFrom-Json
Check 'A4 date-only change touched, not copied' ($rc -eq 0 -and $last.touched -eq 1 -and $last.copied -eq 0) "rc=$rc touched=$($last.touched) copied=$($last.copied)"
Check 'A4 backup mtime now matches' ([Math]::Abs(((TMtime $t1) - (TMtime (Join-Path $a.proj 'proj1\s2.jsonl'))).TotalSeconds) -le 2)
# same-size JSON with different middle content IS recopied
Start-Sleep -Milliseconds 2200
TWrite (Join-Path $a.sess 'acct\local_3.json') '{"a":"1111","b":"zzzz"}'
$rc = Invoke-Backup $a
Start-Sleep -Milliseconds 2200
TWrite (Join-Path $a.sess 'acct\local_3.json') '{"a":"2222","b":"zzzz"}'
$rc = Invoke-Backup $a
Check 'A4 same-size json with new content replaced' ((TReadEq (Join-Path $a.root 'claude-code-sessions\acct\local_3.json') '{"a":"2222","b":"zzzz"}')) "rc=$rc"

# ---- B: missing backup root -> exit 14, nothing recorded, root not created, no stamp
$b = New-Case 'B'
TWrite (Join-Path $b.proj 'p\x.jsonl') "x`n"
TWrite (Join-Path $b.sess 'acct\l.json') '{}'
$missing = Join-Path $DriveTestRoot "$runTag-B-does-not-exist"
$rc = Invoke-Backup $b 20 $missing
Check 'B exit 14' ($rc -eq 14) "rc=$rc $LastOut"
Check 'B root not created' (-not (Test-Path -LiteralPath $missing))
Check 'B nothing recorded' ((Get-Queue $b.queue).Count -eq 0)
Check 'B no stamp' (-not (Test-Path -LiteralPath (Join-Path $b.state 'last-success')))

# ---- B2: missing source tree -> the other tree is still backed up; error recorded once; exit 10
$b2 = New-Case 'B2'
TWrite (Join-Path $b2.proj 'p\x.jsonl') "x`n"
[IO.Directory]::Delete($b2.sess)
$rc = Invoke-Backup $b2
Check 'B2 exit 10' ($rc -eq 10) "rc=$rc $LastOut"
Check 'B2 other tree still copied' (TExists (Join-Path $b2.root 'projects\p\x.jsonl'))
$rc = Invoke-Backup $b2
Check 'B2 same problem recorded once' (@((Get-Queue $b2.queue) | Where-Object { $_.kind -eq 'error' }).Count -eq 1) "rc=$rc"

# ---- C: budget 0 -> exit 12, nothing stamped, nothing recorded
$c = New-Case 'C'
TWrite (Join-Path $c.proj 'p\x.jsonl') "x`n"
TWrite (Join-Path $c.sess 'acct\l.json') '{}'
$rc = Invoke-Backup $c 0
Check 'C exit 12' ($rc -eq 12) "rc=$rc $LastOut"
Check 'C no stamp' (-not (Test-Path -LiteralPath (Join-Path $c.state 'last-success')))
Check 'C no record' ((Get-Queue $c.queue).Count -eq 0)

# ---- D: lock held -> exit 11
$d = New-Case 'D'
TWrite (Join-Path $d.proj 'p\x.jsonl') "x`n"
TWrite (Join-Path $d.sess 'acct\l.json') '{}'
[void][IO.Directory]::CreateDirectory($d.state)
$lk = [IO.File]::Open((Join-Path $d.state 'run.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
$rc = Invoke-Backup $d
$lk.Dispose()
Check 'D exit 11 while locked' ($rc -eq 11) "rc=$rc"
$rc = Invoke-Backup $d
Check 'D runs after lock released' ($rc -eq 0) "rc=$rc $LastOut"

# ---- E: half-done swaps repaired; a file held open for writing is copied
$e = New-Case 'E'
TWrite (Join-Path $e.proj 'p\keep.jsonl') "k1`nk2`n"
TWrite (Join-Path $e.proj 'p\done.jsonl') "d1`nd2`n"
TWrite (Join-Path $e.proj 'p\busy.jsonl') "b1`n"
TWrite (Join-Path $e.sess 'acct\l.json') '{}'
TWrite (Join-Path $e.root 'projects\p\keep.jsonl.sbold') "k1`n"
TWrite (Join-Path $e.root 'projects\p\done.jsonl') "d1`nd2`n"
TWrite (Join-Path $e.root 'projects\p\done.jsonl.sbold') "d1`n"
TWrite (Join-Path $e.root 'projects\p\junk.jsonl.sbtmp') "partial"
$w = New-Object IO.FileStream(($P + (Join-Path $e.proj 'p\busy.jsonl')), [IO.FileMode]::Append, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite)
$rc = Invoke-Backup $e
$w.Dispose()
Check 'E exit 0' ($rc -eq 0) "rc=$rc $LastOut"
Check 'E sbold restored then updated' ((TReadEq (Join-Path $e.root 'projects\p\keep.jsonl') "k1`nk2`n"))
Check 'E sbold next to finished copy removed' (-not (TExists (Join-Path $e.root 'projects\p\done.jsonl.sbold')))
Check 'E sbtmp removed' (-not (TExists (Join-Path $e.root 'projects\p\junk.jsonl.sbtmp')))
Check 'E no swap files left' (@(Get-Tree (Join-Path $e.root 'projects') | Where-Object { $_ -match '\.sb(tmp|old)\|' }).Count -eq 0)
Check 'E file open for writing copied' ((TReadEq (Join-Path $e.root 'projects\p\busy.jsonl') "b1`n"))

# ---- F: mass local deletion of transcripts -> one notice; backup keeps them
$f = New-Case 'F'
1..4 | ForEach-Object { TWrite (Join-Path $f.proj "p\s$_.jsonl") "s$_`n" }
TWrite (Join-Path $f.sess 'acct\l.json') '{}'
$rc = Invoke-Backup $f 20 $null 3
1..3 | ForEach-Object { [IO.File]::Delete($P + (Join-Path $f.proj "p\s$_.jsonl")) }
$rc = Invoke-Backup $f 20 $null 3
$fq = Get-Queue $f.queue
Check 'F drop notice recorded' (@($fq | Where-Object { $_.kind -eq 'session-files-dropped' -and $_.detail -like '3 session transcripts*' }).Count -eq 1) ("kinds: " + (($fq | ForEach-Object { $_.kind }) -join ','))
Check 'F backup still holds deleted transcripts' ((TExists (Join-Path $f.root 'projects\p\s1.jsonl')) -and (TExists (Join-Path $f.root 'projects\p\s3.jsonl')))
Check 'F run still complete' ($rc -eq 0) "rc=$rc"
# transcripts idle for longer than RecentDays (what retention cleanup removes) do not count
$f2 = New-Case 'F2'
1..4 | ForEach-Object { TWrite (Join-Path $f2.proj "p\old$_.jsonl") "o$_`n"; [IO.File]::SetLastWriteTimeUtc($P + (Join-Path $f2.proj "p\old$_.jsonl"), [DateTime]::UtcNow.AddDays(-40)) }
TWrite (Join-Path $f2.proj 'p\new.jsonl') "n`n"
TWrite (Join-Path $f2.sess 'acct\l.json') '{}'
$rc = Invoke-Backup $f2 20 $null 3
1..4 | ForEach-Object { [IO.File]::Delete($P + (Join-Path $f2.proj "p\old$_.jsonl")) }
$rc = Invoke-Backup $f2 20 $null 3
Check 'F2 retention-age deletions do not raise the notice' (@((Get-Queue $f2.queue) | Where-Object { $_.kind -eq 'session-files-dropped' }).Count -eq 0 -and $rc -eq 0) "rc=$rc"

# ---- G: report-only writes nothing anywhere
$g = New-Case 'G'
TWrite (Join-Path $g.proj 'p\x.jsonl') "x`n"
TWrite (Join-Path $g.sess 'acct\l.json') '{}'
TWrite (Join-Path $g.root 'projects\p\old.sbtmp') 'leftover'
$treeG = Get-Tree $g.root
$rc = Invoke-Backup $g 20 $null 10 -report
Check 'G report exit 0' ($rc -eq 0) "rc=$rc"
Check 'G report printed decisions' ($LastOut -match 'WOULD COPY \(new\)' -and $LastOut -match 'REPORT:') ($LastOut.Substring(0, [Math]::Min(300, $LastOut.Length)))
Check 'G backup tree unchanged' ((Compare-Object $treeG (Get-Tree $g.root)) -eq $null)
Check 'G no queue, no state files' (-not (Test-Path -LiteralPath $g.queue) -and @(Get-ChildItem -LiteralPath $g.state -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'run.lock' }).Count -eq 0)

# ---- H: an unfinished temp left in _previous-versions by a killed keep-older-copy step is removed
$hc = New-Case 'H'
TWrite (Join-Path $hc.proj 'p\x.jsonl') "x`n"
TWrite (Join-Path $hc.sess 'acct\l.json') '{}'
$recentRun = (Get-Date).AddHours(-1).ToString('yyyyMMdd-HHmmss')
TWrite (Join-Path $hc.root "_previous-versions\$recentRun\projects\p\old.jsonl.sbtmp") 'partial'
TWrite (Join-Path $hc.root "_previous-versions\$recentRun\projects\p\kept.jsonl") 'real older copy'
TWrite (Join-Path $hc.root '_previous-versions\20260101-000000\projects\p\ancient.jsonl.sbtmp') 'outside the 7-day scan'
$rc = Invoke-Backup $hc
Check 'H unfinished temp in a recent _previous-versions run removed' ($rc -eq 0 -and -not (TExists (Join-Path $hc.root "_previous-versions\$recentRun\projects\p\old.jsonl.sbtmp"))) "rc=$rc $LastOut"
Check 'H real older copy kept' (TExists (Join-Path $hc.root "_previous-versions\$recentRun\projects\p\kept.jsonl"))
Check 'H run folders older than 7 days are not scanned' (TExists (Join-Path $hc.root '_previous-versions\20260101-000000\projects\p\ancient.jsonl.sbtmp'))

# ---- I: the vanished-file catch works through the same call chain the script uses (a .NET exception
#         thrown inside a function, passed through Invoke-WithRetry's scriptblock, caught by type)
$probe = @'
$ErrorActionPreference = 'Stop'
function Invoke-WithRetry([scriptblock]$action, [string]$srcPath) {
    $attempt = 0
    while ($true) {
        try { return (& $action) }
        catch [System.IO.FileNotFoundException], [System.IO.DirectoryNotFoundException] { $attempt++; if ($attempt -ge 3 -or -not [System.IO.File]::Exists($srcPath)) { throw }; Start-Sleep -Milliseconds 10 }
        catch [System.IO.IOException] { $attempt++; if ($attempt -ge 3) { throw }; Start-Sleep -Milliseconds 10 }
    }
}
function Open-Gone([string]$p) { $fs = New-Object System.IO.FileStream($p, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite); $fs.Dispose() }
function Run-Case([string]$p) {
    try { Invoke-WithRetry { Open-Gone $p } $p ; 'no error' }
    catch [System.IO.FileNotFoundException], [System.IO.DirectoryNotFoundException] { 'vanished' }
    catch { 'error: ' + $_.Exception.GetType().FullName }
}
Run-Case ('\\?\' + $env:TEMP + '\no-such-file-' + [guid]::NewGuid().ToString('N') + '.jsonl')
Run-Case ('\\?\' + $env:TEMP + '\no-such-dir-' + [guid]::NewGuid().ToString('N') + '\x.jsonl')
'@
$pf = Join-Path $base 'vanish-probe.ps1'; [IO.File]::WriteAllText($pf, $probe)
$po = @(& powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File $pf)
Check 'I vanished file and vanished folder are recognised as vanished' ($po.Count -eq 2 -and $po[0] -eq 'vanished' -and $po[1] -eq 'vanished') ($po -join ' | ')

foreach ($dc in $script:Deferred) {
    $t0 = Get-Date; $ok = $false
    while (((Get-Date) - $t0).TotalSeconds -lt 300) { if ((TRead $dc.path) -eq $dc.want) { $ok = $true; break }; Start-Sleep -Seconds 5 }
    Check $dc.name $ok ("waited " + [int]((Get-Date) - $t0).TotalSeconds + " s at end; read=[" + (TRead $dc.path) + "]")
}

$results | Format-Table -AutoSize | Out-String -Width 300
"PASSED " + @($results | Where-Object { $_.ok }).Count + " of " + $results.Count
"scratch: $base ; drive test folders: $DriveTestRoot\$runTag-*"
