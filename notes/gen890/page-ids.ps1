# Print GEN id, status and title for page ids (REST GET, read-only).
param([string[]]$PageIds)
$vault = [Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]::new()
$cred = $vault.Retrieve('claude-notion-token', 'claude-notion-token')
$cred.RetrievePassword()
$token = $cred.Password
if ($token -cnotmatch '\A[A-Za-z0-9_.\-]+\z') { throw 'Stored token is empty or has unexpected characters (value not shown).' }
$cfgFile = "$env:TEMP\notion-ticket-lookup-cfg-$([guid]::NewGuid().ToString('N')).txt"
try {
    [IO.File]::WriteAllText($cfgFile, ('header = "Authorization: Bearer ' + $token + '"' + "`n"), (New-Object System.Text.UTF8Encoding $false))
    foreach ($pg in $PageIds) {
        $j = ((curl.exe -q -sk -m 30 -K $cfgFile "https://api.notion.com/v1/pages/$pg" -H "Notion-Version: 2022-06-28") -join "`n") | ConvertFrom-Json
        "GEN-{0} | {1} | {2} | {3}" -f $j.properties.ID.unique_id.number, $j.properties.Status.select.name, $j.properties.Priority.select.name, $j.url
    }
} finally { Remove-Item -LiteralPath $cfgFile -Force -ErrorAction SilentlyContinue }
