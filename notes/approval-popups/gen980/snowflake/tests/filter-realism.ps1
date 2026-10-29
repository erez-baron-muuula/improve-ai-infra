. 'C:\Users\Erez\AI Projects\Improve AI Infra\notes\approval-popups\gen980\snowflake\snowflake-read.ps1' -SqlFile 'x'
$corpus = Get-Content -Raw 'C:\Users\Erez\AppData\Local\Temp\claude\C--Users-Erez-AI-Projects-Improve-AI-Infra\88d16f1c-a32f-4372-b5d7-a53fa190260a\scratchpad\sql-corpus.json' | ConvertFrom-Json
$stats = @{ writeRefused = 0; writeAllowed = 0; readAllowed = 0; readRefused = 0 }
$readRefusedWords = @{}
foreach ($c in $corpus) {
  $allowed = $true
  try { Assert-LookOnly $c.sql } catch { $allowed = $false }
  $w = Get-FirstWord ($c.sql -split '->>')[0]
  if ($c.gateWrite) {
    if ($allowed) { $stats.writeAllowed++; 'WRITE ALLOWED: ' + ($c.sql.Substring(0, [Math]::Min(120, $c.sql.Length)) -replace '\s+', ' ') } else { $stats.writeRefused++ }
  } else {
    if ($allowed) { $stats.readAllowed++ } else { $stats.readRefused++; $readRefusedWords[$w] = 1 + [int]$readRefusedWords[$w] }
  }
}
'corpus statements: ' + $corpus.Count
'gate-classified writes: refused ' + $stats.writeRefused + ', ALLOWED ' + $stats.writeAllowed
'other statements: allowed ' + $stats.readAllowed + ', refused ' + $stats.readRefused
'refused non-writes by first word: ' + (($readRefusedWords.GetEnumerator() | Sort-Object Value -Descending | ForEach-Object { $_.Key + '=' + $_.Value }) -join ', ')
