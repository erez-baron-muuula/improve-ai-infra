# GEN-890: read Status / created_time / Gain ratio for page ids into the size-decide tickets JSON.
param([string[]]$PageIds, [string]$Out)
$vault = [Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]::new()
$cred = $vault.Retrieve('claude-notion-token', 'claude-notion-token')
$cred.RetrievePassword()
$token = $cred.Password
if ($token -cnotmatch '\A[A-Za-z0-9_.\-]+\z') { throw 'Stored token is empty or has unexpected characters (value not shown).' }
$tag = [guid]::NewGuid().ToString('N')
$cfgFile = "$env:TEMP\notion-ticket-lookup-cfg-$tag.txt"
$utf8 = New-Object System.Text.UTF8Encoding $false
$res = [ordered]@{}
try {
    [IO.File]::WriteAllText($cfgFile, ('header = "Authorization: Bearer ' + $token + '"' + "`n"), $utf8)
    foreach ($pg in $PageIds) {
        $raw = curl.exe -q -sk -m 30 -K $cfgFile "https://api.notion.com/v1/pages/$pg" -H "Notion-Version: 2022-06-28"
        $j = ($raw -join "`n") | ConvertFrom-Json
        if (-not $j.id) { Write-Output "could not read $pg"; continue }
        $res[$pg] = [ordered]@{ status = $j.properties.Status.select.name; createdTime = $j.created_time; gain = $j.properties.'Gain ratio'.select.name }
    }
} finally {
    Remove-Item -LiteralPath $cfgFile -Force -ErrorAction SilentlyContinue
}
$json = if ($res.Count) { [pscustomobject]$res | ConvertTo-Json -Depth 4 } else { '{}' }
[IO.File]::WriteAllText($Out, $json, $utf8)
$json
