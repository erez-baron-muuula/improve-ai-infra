# GEN-890: size lines for every text working copy, measured as if it were the live file.
$wc = 'C:\Users\Erez\AI Projects\Improve AI Infra\notes\gen890\wc\text'
$scan = 'C:\Users\Erez\.claude\skills\config-health\config-health-scan.ps1'
Get-ChildItem -LiteralPath $wc -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($wc.Length + 1)
    $live = Join-Path 'C:\Users\Erez\.claude\skills' $rel
    $r = & $scan -Action size-check -Target $_.FullName -AsIfPath $live | ConvertFrom-Json
    @($r.sizeLines) | ForEach-Object { $_ }
    @($r.lines) | Where-Object { $_ -match '^(BREACH|NEAR|ERROR)' } | ForEach-Object { '  ! ' + $_ }
}
