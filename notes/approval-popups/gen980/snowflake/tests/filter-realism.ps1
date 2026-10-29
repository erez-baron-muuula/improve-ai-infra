param(
  [Parameter(Mandatory = $true)][string]$Corpus,
  [string]$Script = 'C:\Users\Erez\AI Projects\Improve AI Infra\notes\approval-popups\gen980\snowflake\snowflake-read.ps1'
)
# Replays the real-statement corpus (made by extract-sql.js) through the look-only filter.
. $Script -SqlFile 'x'
$items = Get-Content -Raw -Encoding UTF8 $Corpus | ConvertFrom-Json
$stats = @{ writeRefused = 0; writeAllowed = 0; readAllowed = 0; readRefused = 0 }
$readRefusedWords = @{}
$refusedReadSamples = New-Object System.Collections.Generic.List[string]
foreach ($c in $items) {
  $allowed = $true
  $why = ''
  try { [void](Get-LookOnlySql $c.sql) } catch { $allowed = $false; $why = $_.Exception.Message }
  $w = Get-FirstWord ($c.sql -split '->>')[0]
  if ($c.gateWrite) {
    if ($allowed) { $stats.writeAllowed++; 'WRITE ALLOWED: ' + ($c.sql.Substring(0, [Math]::Min(120, $c.sql.Length)) -replace '\s+', ' ') } else { $stats.writeRefused++ }
  } else {
    if ($allowed) { $stats.readAllowed++ } else {
      $stats.readRefused++
      $readRefusedWords[$w] = 1 + [int]$readRefusedWords[$w]
      if (@('SELECT', 'WITH', 'SHOW', 'DESC', 'DESCRIBE', 'EXPLAIN') -contains $w) { $refusedReadSamples.Add($w + ' :: ' + ($why -replace '^Refused before sending: [^.]*\. ', '').Substring(0, [Math]::Min(90, ($why -replace '^Refused before sending: [^.]*\. ', '').Length))) }
    }
  }
}
'corpus statements: ' + $items.Count
'gate-classified writes: refused ' + $stats.writeRefused + ', ALLOWED ' + $stats.writeAllowed
'other statements: allowed ' + $stats.readAllowed + ', refused ' + $stats.readRefused
'refused non-writes by first word: ' + (($readRefusedWords.GetEnumerator() | Sort-Object Value -Descending | ForEach-Object { $_.Key + '=' + $_.Value }) -join ', ')
'look-up statements refused (reason only, no SQL): ' + $refusedReadSamples.Count
$refusedReadSamples | Select-Object -First 20
