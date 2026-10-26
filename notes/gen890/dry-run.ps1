# GEN-890: dry run of size-weekly + size-decide on the real files, with a throwaway copy of the seed state.
param([string]$Script = 'C:\Users\Erez\AI Projects\Improve AI Infra\notes\gen890\wc\config-health-scan.ps1', [string]$TicketsJson)
$tmpState = Join-Path $env:TEMP ('gen890-dry-state-' + [guid]::NewGuid().ToString('N') + '.json')
Copy-Item -LiteralPath 'C:\Users\Erez\AI Projects\Improve AI Infra\notes\gen890\seed-state.json' -Destination $tmpState
try {
    $w = & $Script -Action size-weekly -SizeStateFile $tmpState | ConvertFrom-Json
    "weekly: ok=$($w.ok) due=$($w.due) candidates=$(@($w.candidates).Count) needStatus=$(@($w.needStatus) -join ',') sweepErrors=$(@($w.sweepErrors).Count)"
    @($w.candidates) | ForEach-Object { '  {0,-6} {1,-11} {2} -> {3}' -f $_.severity, $_.kind, $_.title, $(if ($_.linked) { $_.linked.ticketId } else { '(none)' }) }
    if ($TicketsJson) {
        $d = & $Script -Action size-decide -SizeStateFile $tmpState -TicketsJson $TicketsJson | ConvertFrom-Json
        "decide: ok=$($d.ok) counts=$($d.counts | ConvertTo-Json -Compress) prune=$(@($d.prune).Count)"
        @($d.decisions) | ForEach-Object { '  {0,-8} {1} ({2})' -f $_.action, $_.title, $_.reason }
    }
} finally {
    Remove-Item -LiteralPath $tmpState -Force -ErrorAction SilentlyContinue
}
