# GEN-460 fixture tests for the sync.ps1 working copy. Builds a throwaway tree (claude\, drive\,
# no git\ so the git layer is skipped) and runs the working copy against it with -RootOverride.
# Never touches the real .claude folder, Drive or git history.
param([string]$Script = (Join-Path $PSScriptRoot 'sync.working.ps1'))

$ErrorActionPreference = 'Continue'
$Script = (Resolve-Path $Script).Path
$root = Join-Path ([IO.Path]::GetTempPath()) ('gen460-fixture\run-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $root -Force | Out-Null
$root = (Resolve-Path $root).Path
$C = Join-Path $root 'claude'
$D = Join-Path $root 'drive'
$pass = 0; $fail = 0
$failures = @()

function New-FixtureFile { param([string]$Path, [string]$Text = 'x')
    $dir = Split-Path $Path -Parent
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding $false))
}
function Invoke-Sync { param([hashtable]$SyncArgs)
    $global:LASTEXITCODE = 0
    $SyncArgs["RootOverride"] = $root
    $out = & $Script @SyncArgs *>&1
    $code = $global:LASTEXITCODE
    $text = ($out | ForEach-Object { [string]$_ }) -join "`n"
    return @{ Code = $code; Text = $text }
}
function Invoke-Decide { param([string]$P, [string]$A, [string]$R = 'fixture test')
    return Invoke-Sync -SyncArgs @{ TriageDecide = $P; As = $A; Reason = $R }
}
function Assert-True { param([string]$Name, [bool]$Cond, [string]$Detail = '')
    if ($Cond) { $script:pass++ } else { $script:fail++; $script:failures += "FAIL: $Name $Detail" }
}
function Assert-Has { param([string]$Name, [string]$Text, [string]$Needle)
    Assert-True $Name ($Text.Contains($Needle)) "-- missing: $Needle"
}
function Assert-Lacks { param([string]$Name, [string]$Text, [string]$Needle)
    Assert-True $Name (-not $Text.Contains($Needle)) "-- unexpectedly present: $Needle"
}

# ---- Build the fixture ----
$patterns = [IO.File]::ReadAllText('C:\Users\Erez\.claude\hooks\secret-patterns.json')
New-FixtureFile (Join-Path $C 'hooks\secret-patterns.json') $patterns
New-FixtureFile (Join-Path $D 'hooks\secret-patterns.json') $patterns
New-FixtureFile (Join-Path $C 'CLAUDE.md') '# rules'
New-FixtureFile (Join-Path $C 'settings.json') '{}'
New-FixtureFile (Join-Path $C 'settings.local.json') '{}'
New-FixtureFile (Join-Path $C '.settings-health-keep.json') '{}'
New-FixtureFile (Join-Path $C 'hooks\a.js') '// hook a'
New-FixtureFile (Join-Path $C 'hooks\b.ps1') '# hook b'
New-FixtureFile (Join-Path $C 'hooks\a.accepted') 'marker'
New-FixtureFile (Join-Path $C 'hooks\x.mjs') '// odd ext'
New-FixtureFile (Join-Path $C 'hooks\.cred-denial-pending-x') 'marker'
New-FixtureFile (Join-Path $C 'hooks\log.jsonl') '{}'
New-FixtureFile (Join-Path $C 'hooks\refs\r.md') 'ref'
New-FixtureFile (Join-Path $C 'hooks\tests\t.sh') 'test'
New-FixtureFile (Join-Path $C 'skills\s\SKILL.md') 'skill'
New-FixtureFile (Join-Path $C 'agents\a.md') 'agent'
New-FixtureFile (Join-Path $C 'commands\c.md') 'cmd'
New-FixtureFile (Join-Path $C 'scripts\s.ps1') '# script'
New-FixtureFile (Join-Path $C 'projects\C--Users-Erez\memory\MEMORY.md') 'mem'
New-FixtureFile (Join-Path $C 'claude-config-pending-sync') 'marker'
New-FixtureFile (Join-Path $C 'policy-limits.json.stamp.json.tmp.ab') '{}'
New-FixtureFile (Join-Path $root '.claude.json.tmp.1.ab') '{}'
New-FixtureFile (Join-Path $root '.claude.weird') 'odd sibling'
New-Item -ItemType Directory -Path (Join-Path $C 'emptyfolder') -Force | Out-Null
New-FixtureFile (Join-Path $C 'lockonly\x.lock') 'l'
New-FixtureFile (Join-Path $C 'jsonfolder\a.json') '{}'
New-Item -ItemType Directory -Path (Join-Path $C 'foo.lock') -Force | Out-Null
New-FixtureFile (Join-Path $C 'mystery.txt') 'what am I'
New-FixtureFile (Join-Path $C '.config-unlock') ''
New-FixtureFile (Join-Path $C '.skip-loggate') 'on'
New-FixtureFile (Join-Path $C '.newswitch') 'on'
New-Item -ItemType Directory -Path (Join-Path $C 'odd[name') -Force | Out-Null
New-FixtureFile (Join-Path $D 'hooks\driveonly.js') '// only on drive'

# ---- T1: dry run reports, writes nothing ----
$r = Invoke-Sync @{ CoverageOnly = $true }
Assert-True 'T1 exit 0' ($r.Code -eq 0) "code=$($r.Code) $($r.Text)"
Assert-Has 'T1 hook a in set' $r.Text "COVERAGE-ONLY file: $C\hooks\a.js"
Assert-Has 'T1 hook b in set' $r.Text "COVERAGE-ONLY file: $C\hooks\b.ps1"
Assert-Has 'T1 drive-only hook in set' $r.Text "COVERAGE-ONLY file: $C\hooks\driveonly.js"
Assert-Has 'T1 marker would skip' $r.Text "would skip 'hooks\a.accepted'"
Assert-Has 'T1 empty folder would skip' $r.Text "would skip 'emptyfolder'"
Assert-Has 'T1 lock-only folder would skip' $r.Text "would skip 'lockonly'"
Assert-Has 'T1 mjs needed' $r.Text "NEEDED: 'hooks\x.mjs'"
Assert-Has 'T1 json folder needed' $r.Text "NEEDED: 'jsonfolder'"
Assert-Has 'T1 root file needed' $r.Text "NEEDED: 'mystery.txt'"
Assert-Has 'T1 sibling needed' $r.Text "NEEDED: '..\.claude.weird'"
Assert-Lacks 'T1 coverage check did not fail' $r.Text "the coverage check itself failed"
Assert-Has 'T1 bracket folder would skip' $r.Text "would skip 'odd[name'"
foreach ($quiet in @('.config-unlock', '.skip-loggate','claude-config-pending-sync','.cred-denial-pending-x', '.claude.json.tmp.1.ab', 'policy-limits.json.stamp.json.tmp.ab', "'foo.lock'", 'log.jsonl')) {
    Assert-Lacks "T1 quiet $quiet" $r.Text $quiet
}
Assert-True 'T1 no local decisions file' (-not (Test-Path (Join-Path $C 'backup-triage.json')))
Assert-True 'T1 nothing pushed' (-not (Test-Path (Join-Path $D 'hooks\a.js')))

# ---- T2: first real From-Claude run records rule skips once ----
$r = Invoke-Sync @{ Direction = 'From-Claude' }
Assert-True 'T2 exit 0' ($r.Code -eq 0) "code=$($r.Code) $($r.Text)"
Assert-Has 'T2 marker skipped' $r.Text "skipped 'hooks\a.accepted'"
Assert-Has 'T2 empty folder skipped' $r.Text "skipped 'emptyfolder'"
Assert-Has 'T2 mystery needed' $r.Text "NEEDED: 'mystery.txt'"
Assert-Has 'T2 drive-only hook noted' $r.Text "Hook on Drive only (the next To-Claude sync brings it here"
Assert-Lacks 'T2 drive-only hook raises no NEEDED' $r.Text "NEEDED: hook"
Assert-True 'T2 hook pushed' (Test-Path (Join-Path $D 'hooks\a.js'))
Assert-True 'T2 ps1 hook pushed' (Test-Path (Join-Path $D 'hooks\b.ps1'))
Assert-True 'T2 local decisions file' (Test-Path (Join-Path $C 'backup-triage.json'))
Assert-True 'T2 drive decisions file' (Test-Path (Join-Path $D 'backup-triage.json'))
$tri = Get-Content -Raw (Join-Path $C 'backup-triage.json') | ConvertFrom-Json
Assert-True 'T2 four rule decisions (marker, empty, lock-only, bracket-named empty folder)' (@($tri.decisions).Count -eq 4) "count=$(@($tri.decisions).Count)"

# ---- T3: second run is silent on the recorded ones ----
$r = Invoke-Sync @{ Direction = 'From-Claude' }
Assert-Lacks 'T3 marker silent' $r.Text "a.accepted"
Assert-Lacks 'T3 empty folder silent' $r.Text "emptyfolder"
Assert-Has 'T3 mystery still needed' $r.Text "NEEDED: 'mystery.txt'"

# ---- T4: recording a decision silences it ----
$r = Invoke-Decide 'mystery.txt' 'skip'
Assert-True 'T4 decide exit 0' ($r.Code -eq 0) "code=$($r.Code) $($r.Text)"
Assert-Has 'T4 recorded line' $r.Text "recorded 'mystery.txt' as skip"
$r = Invoke-Decide '..\.claude.weird' 'skip'
Assert-True 'T4 sibling skip exit 0' ($r.Code -eq 0) "code=$($r.Code) $($r.Text)"
$r = Invoke-Sync @{ CoverageOnly = $true }
Assert-Lacks 'T4 mystery silent' $r.Text "mystery.txt"
Assert-Lacks 'T4 sibling silent' $r.Text ".claude.weird"
$dtri = Get-Content -Raw (Join-Path $D 'backup-triage.json') | ConvertFrom-Json
Assert-True 'T4 decision reached Drive' (@(@($dtri.decisions) | Where-Object { $_.path -eq 'mystery.txt' }).Count -eq 1)

# ---- T5: refusals ----
$fakeKey = 'AKI' + 'A' + ('Q' * 16)
New-FixtureFile (Join-Path $C 'leaky.txt') ("value " + $fakeKey)
New-FixtureFile (Join-Path $C 'mytoken.json') '{}'
New-FixtureFile (Join-Path $C 'notes[old].md') 'bracketed'
New-FixtureFile (Join-Path $C 'trail.txt.') 'x'
New-FixtureFile (Join-Path $C 'empty.txt') ''
New-FixtureFile (Join-Path $C 'switch.off') 'off'
$big = New-Object byte[] (1MB + 10)
[IO.File]::WriteAllBytes((Join-Path $C 'big.bin'), $big)
$refusals = @(
    @('..\outside.txt', 'skip'), @("$C\mystery.txt", 'skip'), @('C:\x.txt', 'skip'), @('sub\..\..\x', 'skip'),
    @('nonexistent.txt', 'skip'), @('hooks\a.js', 'skip'), @('hooks\a.js', 'backup'), @('hooks\driveonly.js', 'skip'),
    @('jsonfolder', 'backup'), @('leaky.txt', 'backup'), @('mytoken.json', 'backup'), @('settings.json', 'skip'),
    @('skills\s\SKILL.md', 'skip'), @('big.bin', 'backup'), @('notes[old].md', 'backup'), @('..\.claude.weird', 'backup'),
    @('backup-triage.json', 'skip'), @('hooks\nothere.js', 'skip'), @('jsonfolder\a.json', 'skip'), @('trail.txt.', 'skip'),
    @('.config-unlock', 'backup'), @('.skip-loggate', 'backup'), @('.newswitch', 'backup'), @('empty.txt', 'backup'), @('switch.off', 'backup'), @('hooks\a.accepted', 'backup')
)
foreach ($pair in $refusals) {
    $r = Invoke-Decide $pair[0] $pair[1]
    Assert-True "T5 refuse $($pair[0]) as $($pair[1])" ($r.Code -eq 1 -and $r.Text.Contains('refused')) "code=$($r.Code) $($r.Text)"
}
# The dropped 'retired' choice is rejected before anything runs.
$bindErr = ''
try { & $Script -RootOverride $root -TriageDecide 'hooks\driveonly.js' -As retired -Reason 'fixture test' *>&1 | Out-Null } catch { $bindErr = $_.Exception.Message }
Assert-True 'T5 retired no longer a choice' ($bindErr.Contains('does not belong to the set')) "-- got: $bindErr"
$tri = Get-Content -Raw (Join-Path $C 'backup-triage.json') | ConvertFrom-Json
Assert-True 'T5 no retired decision recorded' (-not (@($tri.decisions) | Where-Object { $_.decision -eq 'retired' }))
$r = Invoke-Decide 'mystery.txt' 'skip' ("non-ascii " + [char]0x201C)
Assert-True 'T5 refuse non-ASCII reason' ($r.Code -eq 1) "code=$($r.Code)"
$tri = Get-Content -Raw (Join-Path $C 'backup-triage.json') | ConvertFrom-Json
Assert-True 'T5 no refused path recorded' (-not (@($tri.decisions) | Where-Object { $_.path -in @('leaky.txt', 'mytoken.json', 'big.bin', 'notes[old].md') }))

# ---- T6: a clean backup decision is pushed; a later secret keeps it out ----
New-FixtureFile (Join-Path $C 'notes.md') 'shared notes'
$r = Invoke-Decide 'notes.md' 'backup'
Assert-True 'T6 backup accepted' ($r.Code -eq 0) "code=$($r.Code) $($r.Text)"
Assert-Has 'T6 reason printed' $r.Text "recorded 'notes.md' as backup -- fixture test"
$lt = Get-Content -Raw (Join-Path $C 'backup-triage.json') | ConvertFrom-Json
Assert-True 'T6 reason recorded' ((@($lt.decisions) | Where-Object { $_.path -eq 'notes.md' }).reason -eq 'fixture test')
$r = Invoke-Sync @{ Direction = 'From-Claude' }
Assert-True 'T6 notes pushed to triage-backup' (Test-Path (Join-Path $D 'triage-backup\notes.md'))
Assert-True 'T6 notes not at Drive root' (-not (Test-Path (Join-Path $D 'notes.md')))
New-FixtureFile (Join-Path $C 'notes.md') ("now leaky " + $fakeKey)
$r = Invoke-Sync @{ Direction = 'From-Claude' }
Assert-Has 'T6 left out warning' $r.Text "left 'notes.md' out of this backup"
Assert-True 'T6 drive copy not overwritten' (([IO.File]::ReadAllText((Join-Path $D 'triage-backup\notes.md'))) -eq 'shared notes')
New-FixtureFile (Join-Path $C 'notes.md') 'shared notes'

# ---- T7: restore (a hook on Drive comes back, whether added elsewhere or deleted here) ----
# A hook deleted on this PC: From-Claude notes it as Drive-only, with no warning or NEEDED line.
Remove-Item -LiteralPath (Join-Path $C 'hooks\b.ps1') -Force
$r = Invoke-Sync @{ Direction = 'From-Claude' }
Assert-Has 'T7 deleted-here noted as Drive-only' $r.Text "Hook on Drive only (the next To-Claude sync brings it here; to remove it for good, delete it on every PC and on Drive): $C\hooks\b.ps1"
Assert-Lacks 'T7 deleted-here raises no NEEDED' $r.Text "NEEDED: hook"
New-FixtureFile (Join-Path $D 'hooks\restoreme.js') '// new hook from another PC'
$r = Invoke-Sync @{ Direction = 'To-Claude' }
Assert-True 'T7 to-claude exit 0' ($r.Code -eq 0) "code=$($r.Code) $($r.Text)"
Assert-True 'T7 drive-only hook restored' (Test-Path (Join-Path $C 'hooks\restoreme.js'))
Assert-True 'T7 other drive-only hook restored' (Test-Path (Join-Path $C 'hooks\driveonly.js'))
Assert-True 'T7 hook deleted here pulled back' (Test-Path (Join-Path $C 'hooks\b.ps1'))
Assert-Lacks 'T7 pull raises no NEEDED' $r.Text "NEEDED"
Remove-Item -LiteralPath (Join-Path $C 'hooks\a.js') -Force
$r = Invoke-Sync @{ Direction = 'To-Claude'; DiscardLocal = $true }
Assert-True 'T7 discard-local restores hook' (Test-Path (Join-Path $C 'hooks\a.js'))
$r = Invoke-Sync @{ Direction = 'From-Claude' }
Assert-Lacks 'T7 restored hooks not flagged' $r.Text "driveonly.js out"
Assert-Lacks 'T7 no Drive-only line once restored' $r.Text "Hook on Drive only"

# ---- T8: malformed local decisions file is never rewritten ----
$good = [IO.File]::ReadAllText((Join-Path $C 'backup-triage.json'))
$driveBefore = [IO.File]::ReadAllText((Join-Path $D 'backup-triage.json'))
New-FixtureFile (Join-Path $C 'backup-triage.json') '{not json'
New-FixtureFile (Join-Path $C 'newthing.txt') 'new'
$r = Invoke-Sync @{ Direction = 'From-Claude' }
Assert-Has 'T8 malformed warning' $r.Text "could not read the local decisions file"
Assert-True 'T8 local untouched' (([IO.File]::ReadAllText((Join-Path $C 'backup-triage.json'))) -eq '{not json')
Assert-True 'T8 drive untouched' (([IO.File]::ReadAllText((Join-Path $D 'backup-triage.json'))) -eq $driveBefore)
$r = Invoke-Decide 'newthing.txt' 'skip'
Assert-True 'T8 decide refused while malformed' ($r.Code -eq 1) "code=$($r.Code)"
New-FixtureFile (Join-Path $C 'backup-triage.json') $good
Remove-Item -LiteralPath (Join-Path $C 'newthing.txt') -Force

# ---- T9: two-PC merge (skip beats backup; Drive-only entry is kept) ----
$dt = Get-Content -Raw (Join-Path $D 'backup-triage.json') | ConvertFrom-Json
$extra = @(
    [PSCustomObject]@{ path = 'otherpc.txt'; decision = 'skip'; reason = 'from PC2'; decidedBy = 'claude'; date = '2026-01-01T00:00:00Z' },
    [PSCustomObject]@{ path = 'notes.md'; decision = 'skip'; reason = 'PC2 says skip'; decidedBy = 'claude'; date = '2020-01-01T00:00:00Z' }
)
$merged = @(@($dt.decisions) | Where-Object { $_.path -ne 'notes.md' }) + $extra
New-FixtureFile (Join-Path $D 'backup-triage.json') (([PSCustomObject]@{ decisions = $merged }) | ConvertTo-Json -Depth 5)
$r = Invoke-Sync @{ Direction = 'From-Claude' }
$lt = Get-Content -Raw (Join-Path $C 'backup-triage.json') | ConvertFrom-Json
Assert-True 'T9 drive-only entry merged locally' (@(@($lt.decisions) | Where-Object { $_.path -eq 'otherpc.txt' }).Count -eq 1)
Assert-True 'T9 newer Claude backup beats older Claude skip' ((@($lt.decisions) | Where-Object { $_.path -eq 'notes.md' }).decision -eq 'backup')

# ---- T10: rule-skipped folder that gains a real file is raised again ----
New-FixtureFile (Join-Path $C 'emptyfolder\real.md') 'content'
$r = Invoke-Sync @{ Direction = 'From-Claude' }
Assert-Has 'T10 folder raised again' $r.Text "NEEDED: 'emptyfolder' (folder skipped earlier by rule"

# ---- T11: triage lines survive | Out-Null in a separate process (as update-config.ps1 calls it) ----
New-FixtureFile (Join-Path $C 'outnull-probe.txt') 'probe'
$child = powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& '$Script' -RootOverride '$root' -Direction From-Claude | Out-Null" 2>&1
$childText = ($child | ForEach-Object { [string]$_ }) -join "`n"
Assert-Has 'T11 warning survives Out-Null' $childText "NEEDED: 'outnull-probe.txt'"
Assert-Lacks 'T11 normal output discarded' $childText "Copied:"

# ---- T12: code-review fixes (ignore-listed / top-level script backups, Drive edits, merge override) ----
New-FixtureFile (Join-Path $C 'history.jsonl') '{"prompt":"private"}'
New-FixtureFile (Join-Path $C 'tool.ps1') '# local script'
$r = Invoke-Decide 'history.jsonl' 'backup'
Assert-True 'T12 refuse ignore-listed history.jsonl' ($r.Code -eq 1 -and $r.Text.Contains('refused')) "code=$($r.Code) $($r.Text)"
# A 'backup' entry injected into the Drive copy for a top-level script and an ignore-listed file.
$dt = Get-Content -Raw (Join-Path $D 'backup-triage.json') | ConvertFrom-Json
$inject = @(@($dt.decisions)) + @(
    [PSCustomObject]@{ path = 'tool.ps1'; decision = 'backup'; reason = 'injected'; decidedBy = 'claude'; date = '2026-02-01T00:00:00Z' },
    [PSCustomObject]@{ path = 'history.jsonl'; decision = 'backup'; reason = 'injected'; decidedBy = 'claude'; date = '2026-02-01T00:00:00Z' }
)
New-FixtureFile (Join-Path $D 'backup-triage.json') (([PSCustomObject]@{ decisions = $inject }) | ConvertTo-Json -Depth 5)
New-FixtureFile (Join-Path $D 'tool.ps1') 'DRIVE TOOLING'
$r = Invoke-Sync @{ Direction = 'From-Claude' }
Assert-True 'T12 script backup goes to triage-backup' (Test-Path (Join-Path $D 'triage-backup\tool.ps1'))
Assert-Has 'T12 injected jsonl entry ignored' $r.Text "ignored the 'backup' decision for 'history.jsonl'"
Assert-True 'T12 drive tooling not overwritten' (([IO.File]::ReadAllText((Join-Path $D 'tool.ps1'))) -eq 'DRIVE TOOLING')
Assert-True 'T12 history not pushed' (-not (Test-Path (Join-Path $D 'history.jsonl')))
# A malformed Drive copy is not overwritten.
New-FixtureFile (Join-Path $D 'backup-triage.json') '{broken'
$r = Invoke-Sync @{ Direction = 'From-Claude' }
Assert-Has 'T12 drive malformed warning' $r.Text "could not read the Drive decisions file"
Assert-True 'T12 drive malformed untouched' (([IO.File]::ReadAllText((Join-Path $D 'backup-triage.json'))) -eq '{broken')
Copy-Item -LiteralPath (Join-Path $C 'backup-triage.json') -Destination (Join-Path $D 'backup-triage.json') -Force
# Claude's newer 'backup' overrides an older rule skip from another PC.
New-FixtureFile (Join-Path $C 'later.txt') 'later shared'
$lt = Get-Content -Raw (Join-Path $C 'backup-triage.json') | ConvertFrom-Json
$withRule = @(@($lt.decisions)) + @([PSCustomObject]@{ path = 'later.txt'; decision = 'skip'; reason = 'old rule'; decidedBy = 'rule'; date = '2020-01-01T00:00:00Z' })
New-FixtureFile (Join-Path $D 'backup-triage.json') (([PSCustomObject]@{ decisions = $withRule }) | ConvertTo-Json -Depth 5)
$r = Invoke-Decide 'later.txt' 'backup'
Assert-True 'T12 later backup accepted' ($r.Code -eq 0) "code=$($r.Code) $($r.Text)"
$lt = Get-Content -Raw (Join-Path $C 'backup-triage.json') | ConvertFrom-Json
Assert-True 'T12 newer claude backup beats old rule skip' (@(@($lt.decisions) | Where-Object { $_.path -eq 'later.txt' -and $_.decision -eq 'backup' }).Count -eq 1)
# The recorded-line and exit code stay clean (no stray True/False in output).
Assert-Lacks 'T12 no stray boolean output' $r.Text "True"

# ---- T13: a wildcard name cannot make the copy pick up a different (private) file ----
New-FixtureFile (Join-Path $C '.credentials.json') 'PRIVATE'
$lt = Get-Content -Raw (Join-Path $C 'backup-triage.json') | ConvertFrom-Json
$inject = @(@($lt.decisions)) + @(
    [PSCustomObject]@{ path = '.cr[e]dentials.json'; decision = 'backup'; reason = 'injected'; decidedBy = 'claude'; date = '2026-03-01T00:00:00Z' },
    [PSCustomObject]@{ path = 'history.jsonl.'; decision = 'backup'; reason = 'injected'; decidedBy = 'claude'; date = '2026-03-01T00:00:00Z' }
)
New-FixtureFile (Join-Path $D 'backup-triage.json') (([PSCustomObject]@{ decisions = $inject }) | ConvertTo-Json -Depth 5)
$r = Invoke-Sync @{ Direction = 'From-Claude' }
Assert-Has 'T13 bracket entry ignored' $r.Text "ignored the 'backup' decision for '.cr[e]dentials.json'"
Assert-Has 'T13 trailing-dot entry ignored' $r.Text "ignored the 'backup' decision for 'history.jsonl.'"
Assert-True 'T13 no credentials copied' (@(Get-ChildItem -LiteralPath $D -Recurse -Force -File | Where-Object { $_.Name -like '*credentials*' }).Count -eq 0)
Assert-True 'T13 no history copied' (@(Get-ChildItem -LiteralPath $D -Recurse -Force -File | Where-Object { $_.Name -like 'history*' }).Count -eq 0)

# ---- T14: new hook code with a secret is left out of the push ----
New-FixtureFile (Join-Path $C 'hooks\leakhook.js') ("const k = '" + $fakeKey + "';")
$r = Invoke-Sync @{ Direction = 'From-Claude' }
Assert-Has 'T14 secret hook left out' $r.Text "left hook 'hooks\leakhook.js' out of this backup"
Assert-True 'T14 secret hook not on Drive' (-not (Test-Path (Join-Path $D 'hooks\leakhook.js')))
Assert-Lacks 'T14 no NEEDED for the hook' $r.Text "NEEDED: 'hooks\leakhook.js'"
New-FixtureFile (Join-Path $C 'hooks\leakhook.js') '// clean now'
$r = Invoke-Sync @{ Direction = 'From-Claude' }
Assert-True 'T14 clean hook pushed' (Test-Path (Join-Path $D 'hooks\leakhook.js'))

# ---- T15: a 'backup' decision for hook code injected into the Drive copy is ignored with a warning ----
$dt = Get-Content -Raw (Join-Path $D 'backup-triage.json') | ConvertFrom-Json
$inject = @(@($dt.decisions)) + @(
    [PSCustomObject]@{ path = 'hooks\a.js'; decision = 'backup'; reason = 'injected'; decidedBy = 'claude'; date = '2026-04-01T00:00:00Z' },
    [PSCustomObject]@{ path = 'backup-triage.json'; decision = 'backup'; reason = 'injected'; decidedBy = 'claude'; date = '2026-04-01T00:00:00Z' },
    [PSCustomObject]@{ path = 'jsonfolder'; decision = 'backup'; reason = 'injected'; decidedBy = 'claude'; date = '2026-04-01T00:00:00Z' },
    [PSCustomObject]@{ path = '.config-unlock'; decision = 'backup'; reason = 'injected'; decidedBy = 'claude'; date = '2026-04-01T00:00:00Z' },
    # Dated after the local rule skip, so the merge lets this 'backup' win and only the refusal stops it.
    [PSCustomObject]@{ path = 'hooks\a.accepted'; decision = 'backup'; reason = 'injected'; decidedBy = 'claude'; date = '2099-01-01T00:00:00Z' }
)
New-FixtureFile (Join-Path $D 'backup-triage.json') (([PSCustomObject]@{ decisions = $inject }) | ConvertTo-Json -Depth 5)
$r = Invoke-Sync @{ Direction = 'From-Claude' }
Assert-Has 'T15 hook-code backup entry ignored' $r.Text "ignored the 'backup' decision for 'hooks\a.js'"
Assert-True 'T15 hook not copied to triage-backup' (-not (Test-Path (Join-Path $D 'triage-backup\hooks\a.js')))
Assert-True 'T15 hook still pushed by rule' (Test-Path (Join-Path $D 'hooks\a.js'))
Assert-Has 'T15 decisions-file backup entry ignored' $r.Text "ignored the 'backup' decision for 'backup-triage.json'"
Assert-True 'T15 decisions file not in triage-backup' (-not (Test-Path (Join-Path $D 'triage-backup\backup-triage.json')))
Assert-True 'T15 break-glass switch never pushed' (@(Get-ChildItem -LiteralPath $D -Recurse -Force -File | Where-Object { $_.Name -eq '.config-unlock' }).Count -eq 0)
Assert-True 'T15 marker never pushed' (@(Get-ChildItem -LiteralPath $D -Recurse -Force -File | Where-Object { $_.Name -eq 'a.accepted' }).Count -eq 0)
Assert-Has 'T15 marker backup entry ignored' $r.Text "ignored the 'backup' decision for 'hooks\a.accepted'"
Assert-Has 'T15 folder backup entry reported'$r.Text "ignored the 'backup' decision for 'jsonfolder' in backup-triage.json -- it is a folder"

"PASS: $pass  FAIL: $fail"
$failures
"fixture: $root"
