#!/usr/bin/env pwsh
# atlassian-put.ps1 -- authenticated PUT of a JSON body to Muuula's Jira/Confluence REST API.
# (GEN-638 step 2.) Used by the staging skill for the retained-redline apply.
#
#   & "$HOME\.claude\scripts\atlassian-put.ps1" -Url "https://muuula.atlassian.net/rest/api/2/issue/MD-1" -BodyFile "<path to JSON>"
#
# Issue it as ONE single-line command, on its own. The staging gate in auto-approve.js
# treats ANY shell command that mentions this script's name as a Jira/Confluence write: it
# needs a staging pass (except for a registered sandbox), and a chained or multi-line
# command is refused. The method is fixed to PUT inside this script and no parameter can
# change it. (GEN-508 found a gate cannot reliably read a method passed as a parameter.)
# Because the gate matches the NAME: mint the staging pass immediately before this call and
# run nothing else that names this script in between (such a command would consume the pass);
# inspect or edit this file with the Read/Edit/Write tools, never a shell command -- a future
# /vet-code apply must use the Edit/Write-tool route, since an update-config.ps1 command naming
# this file is blocked by the staging gate before the vetting pass is looked up.
# Keep the key-handling code in sync with its twin, atlassian-get.ps1.
#
# The API token comes from Credential Manager (claude-atlassian-token), stored by Erez with
# set-claude-key.ps1. It never goes on curl's command line (GEN-639/GEN-638): curl builds the
# Basic header from a `user = "email:token"` line in a temp config file (-K, with -q first so
# no ambient .curlrc is read), deleted in the finally. Never -v (it would print the header).
# -g stops curl treating [ ] { } in the URL as a glob. -k: this machine's outbound TLS
# interception (see hooks/refs/shell.md).
#
# Keep this file ASCII-only: PS 5.1 reads a BOM-less script as Windows-1252.

param(
  [Parameter(Mandatory = $true)]
  [string]$Url,
  [Parameter(Mandatory = $true)]
  [string]$BodyFile
)

$ErrorActionPreference = 'Stop'

$AtlassianEmail = 'erez@muuula.com'   # the account the API token belongs to (not a secret)
$Resource = 'claude-atlassian-token'
$HelperCmd = 'powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME\.claude\scripts\set-claude-key.ps1" -Key atlassian'

# Only Muuula's own Atlassian site: the host must be followed directly by "/", so a
# userinfo trick (https://muuula.atlassian.net@elsewhere/) cannot pass. No spaces or quotes.
if ($Url -cnotmatch '\Ahttps://muuula\.atlassian\.net/[^\s"''`]*\z') {
  throw 'Refused: -Url must be an https://muuula.atlassian.net/... address (the key is only ever sent there).'
}
if (-not (Test-Path -LiteralPath $BodyFile -PathType Leaf)) {
  throw ('Refused: -BodyFile not found: ' + $BodyFile)
}
$bodyPath = (Resolve-Path -LiteralPath $BodyFile).ProviderPath

# A run killed before its finally leaves its config file (which holds the token) behind.
# Sweep leftovers older than 10 minutes -- never a concurrent run's live file (-m 60).
Get-ChildItem -LiteralPath $env:TEMP -Filter 'atlassian-rest-cfg-*' -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '^atlassian-rest-cfg-[0-9a-f]{32}\.txt$' -and
                 $_.LastWriteTimeUtc -lt (Get-Date).ToUniversalTime().AddMinutes(-10) } |
  ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }

try {
  $vault = [Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]::new()
  $cred = $vault.Retrieve($Resource, $Resource)
  $cred.RetrievePassword()
  $token = $cred.Password
} catch {
  Remove-Variable -Name token, cred -ErrorAction SilentlyContinue
  throw ('The Atlassian key is not set up on this PC (Credential Manager: ' + $Resource + '). Ask Erez to run, in his own PowerShell window: ' + $HelperCmd)
}
# A character outside this set would need escaping inside the curl config line; refuse
# rather than build a broken or injectable config. The message never includes the value.
if ([string]::IsNullOrEmpty($token) -or $token -cnotmatch '\A[A-Za-z0-9_.=+/\-]+\z') {
  Remove-Variable -Name token, cred -ErrorAction SilentlyContinue
  throw ('The stored Atlassian key is empty or has unexpected characters (value not shown). Ask Erez to store it again: ' + $HelperCmd)
}

$cfgFile = Join-Path $env:TEMP ('atlassian-rest-cfg-' + [guid]::NewGuid().ToString('N') + '.txt')
$utf8NoBom = New-Object System.Text.UTF8Encoding $false

try {
  [IO.File]::WriteAllText($cfgFile, ('user = "' + $AtlassianEmail + ':' + $token + '"' + "`n"), $utf8NoBom)
  Remove-Variable -Name token, cred -ErrorAction SilentlyContinue
  curl.exe -q -sk -g -m 60 -K $cfgFile -X PUT -H 'Content-Type: application/json' -H 'Accept: application/json' --data-binary "@$bodyPath" -w "`nHTTP_STATUS=%{http_code}`n" $Url
  if ($LASTEXITCODE -ne 0) { throw ('curl failed with exit code ' + $LASTEXITCODE + ' (network or TLS error; the PUT may not have been sent).') }
}
finally {
  Remove-Item -LiteralPath $cfgFile -Force -ErrorAction SilentlyContinue
  # The config file holds the token: if it could not be deleted (e.g. antivirus has it
  # open), say so on stderr -- the path only, never the content.
  if (Test-Path -LiteralPath $cfgFile) {
    [Console]::Error.WriteLine("WARNING: could not delete temp file holding the Atlassian key: $cfgFile -- delete it WITHOUT opening or reading it (the next run also sweeps it after 10 minutes).")
  }
  Remove-Variable -Name token, cred -ErrorAction SilentlyContinue
}
exit 0
