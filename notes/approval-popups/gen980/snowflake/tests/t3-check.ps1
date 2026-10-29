$sp = 'C:\Users\Erez\AppData\Local\Temp\claude\C--Users-Erez-AI-Projects-Improve-AI-Infra\88d16f1c-a32f-4372-b5d7-a53fa190260a\scratchpad\sftests'
$sw = [Diagnostics.Stopwatch]::StartNew()
$out = & 'C:\Users\Erez\AI Projects\Improve AI Infra\notes\approval-popups\gen980\snowflake\snowflake-read.ps1' -SqlFile "$sp\t3-big.sql" 2>&1
"exit=$LASTEXITCODE seconds=" + [int]$sw.Elapsed.TotalSeconds
$last = [string]($out | Select-Object -Last 1)
$last
$csv = $last -replace '^.*All rows: ', ''
$seen = New-Object 'System.Collections.Generic.HashSet[string]'
$n = 0
foreach ($line in [IO.File]::ReadLines($csv)) { $n++; if ($n -gt 1) { [void]$seen.Add($line.Split(',')[0]) } }
"csv lines incl header: $n  distinct i: $($seen.Count)"
