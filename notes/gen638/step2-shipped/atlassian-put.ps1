#!/usr/bin/env pwsh
# atlassian-put.ps1 -- authenticated PUT of a JSON body to ONE Jira issue or Confluence page on
# Muuula's Atlassian site. (GEN-638 step 2.) Used by the staging skill for the retained-redline apply
# and for drafting on a registered sandbox.
#
#   & "$HOME\.claude\scripts\atlassian-put.ps1" -Jira MD-1234 -BodyFile "C:\path\body.json"
#   & "$HOME\.claude\scripts\atlassian-put.ps1" -ConfluencePage 1182400513 -BodyFile "C:\path\body.json"
#
# It takes NO URL: only a Jira key or a Confluence page id, from which it builds the address itself
#   Jira       -> https://muuula.atlassian.net/rest/api/3/issue/<KEY>          (v3 = ADF body)
#   Confluence -> https://muuula.atlassian.net/wiki/rest/api/content/<pageId>  (v1; the body must carry
#                 version.number = current + 1, plus type, title and body.storage)
# so the staging gate in auto-approve.js can read the target exactly. (A free-form -Url failed review
# three times: the command text differed from what PowerShell and curl used.)
#
# HOW TO CALL IT (the gate enforces this): ONE command, on its own, in the PowerShell tool, exactly in
# the form above -- the key or page id unquoted, the body path in quotes using only letters, digits,
# space and _ . : \ / -. Any other shell command that names this script is refused, with no override.
# A non-sandbox target needs a one-time "rest" staging pass for that exact target (staging skill).
# Never call it from another script, loop or job: a wrapper hides the call from the gate. The script
# refuses when it can see it was called from another script file; it cannot detect every indirect
# call (Invoke-Expression, -EncodedCommand), so this rule is the real protection, not the check.
# Exit status: 0 only for an HTTP 2xx; any HTTP error or curl failure exits 1.
#
# MAINTAINING IT: because the gate refuses any shell command that names this file, inspect it with
# the Read/Grep tools, and apply a future /vet-code change with the Write tool (not update-config.ps1,
# whose command line would name it); hash it by reading the whole scripts folder rather than by name.
# The two target patterns below MUST stay identical to ATLASSIAN_PUT_JIRA_KEY_RE /
# ATLASSIAN_PUT_CONF_PAGE_RE in auto-approve.js (a test fixture compares them).
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

[CmdletBinding(DefaultParameterSetName = 'NoTarget')]
param(
  [Parameter(Mandatory = $true, ParameterSetName = 'Jira')]
  [string]$Jira,
  [Parameter(Mandatory = $true, ParameterSetName = 'Confluence')]
  [string]$ConfluencePage,
  [Parameter(Mandatory = $true, ParameterSetName = 'Jira')]
  [Parameter(Mandatory = $true, ParameterSetName = 'Confluence')]
  [string]$BodyFile
)

$ErrorActionPreference = 'Stop'
Set-PSDebug -Off   # a script trace switched on earlier (e.g. by a profile) would print the key line

$JiraKeyPattern = '\A[A-Z][A-Z0-9]{1,9}-[1-9][0-9]{0,6}\z'
$ConfluencePagePattern = '\A[1-9][0-9]{0,15}\z'

$AtlassianEmail = 'erez@muuula.com'   # the account the API token belongs to (not a secret)
$Resource = 'claude-atlassian-token'
$HelperCmd = 'powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME\.claude\scripts\set-claude-key.ps1" -Key atlassian'

# Called from another script (a wrapper) -> refuse: the gate only sees the outer command. The call-stack
# test also catches Invoke-Expression inside a script file (probed 2026-10-04: a direct PowerShell-tool
# call has no outer script frame; a .ps1 wrapper and an iex-in-.ps1 wrapper each show one).
if (-not [string]::IsNullOrEmpty($MyInvocation.ScriptName) -or
    @(Get-PSCallStack | Select-Object -Skip 1 | Where-Object { $_.ScriptName }).Count -gt 0) {
  throw 'Refused: call atlassian-put.ps1 directly from the PowerShell tool, never from another script (a wrapper hides the call from the staging gate).'
}

if ($PSCmdlet.ParameterSetName -eq 'Jira') {
  if ($Jira -cnotmatch $JiraKeyPattern) { throw 'Refused: -Jira must be an issue key such as MD-1234 (capital letters, a dash, digits).' }
  $Url = 'https://muuula.atlassian.net/rest/api/3/issue/' + $Jira
} elseif ($PSCmdlet.ParameterSetName -eq 'Confluence') {
  if ($ConfluencePage -cnotmatch $ConfluencePagePattern) { throw 'Refused: -ConfluencePage must be a page id: digits only, no leading zero, at most 16 digits.' }
  $Url = 'https://muuula.atlassian.net/wiki/rest/api/content/' + $ConfluencePage
} else {
  throw 'Refused: give exactly one of -Jira <KEY> or -ConfluencePage <pageId>, plus -BodyFile.'
}

# A local file on a drive only: a UNC path (\\host\share) would make Windows send this PC's login hash
# to that host just by testing the path, and a non-file-system path (Env:\PATH) resolves to something
# curl would read from its working directory instead.
if ($BodyFile -match '\A[\\/]{2}' -or $BodyFile -notmatch '\A[A-Za-z]:[\\/]') {
  throw 'Refused: -BodyFile must be a full local path on a drive, e.g. C:\...\body.json (no \\server\share paths).'
}
if (-not (Test-Path -LiteralPath $BodyFile -PathType Leaf)) {
  throw ('Refused: -BodyFile not found: ' + $BodyFile)
}
$resolved = Resolve-Path -LiteralPath $BodyFile
if ($resolved.Provider.Name -ne 'FileSystem' -or $resolved.ProviderPath -notmatch '\A[A-Za-z]:\\') {
  throw 'Refused: -BodyFile must be a local file on a drive.'
}
$bodyPath = $resolved.ProviderPath
if ((Get-Item -LiteralPath $bodyPath).Length -eq 0) { throw 'Refused: -BodyFile is empty.' }

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
$httpStatus = 0

try {
  [IO.File]::WriteAllText($cfgFile, ('user = "' + $AtlassianEmail + ':' + $token + '"' + "`n"), $utf8NoBom)
  Remove-Variable -Name token, cred -ErrorAction SilentlyContinue
  $out = & "$env:SystemRoot\System32\curl.exe" -q -sk -g -m 60 -K $cfgFile -X PUT -H 'Content-Type: application/json' -H 'Accept: application/json' --data-binary "@$bodyPath" -w "`nHTTP_STATUS=%{http_code}`n" $Url
  $curlExit = $LASTEXITCODE
  $out
  if ($curlExit -ne 0) { throw ('curl failed with exit code ' + $curlExit + ' (network/TLS error or timeout). OUTCOME UNKNOWN: the write may or may not have landed -- re-fetch the document before retrying.') }
  # Read the status ONLY from the -w trailer (the last non-empty line), never from anywhere in the
  # response body, which could itself contain the text HTTP_STATUS=200.
  $lastLine = @(@($out) | Where-Object { "$_" -ne '' }) | Select-Object -Last 1
  $m = [regex]::Match("$lastLine", '\AHTTP_STATUS=(\d{3})\s*\z')
  $httpStatus = if ($m.Success) { [int]$m.Groups[1].Value } else { 0 }
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
# An HTTP error (400 bad body, 401/403, 409 stale Confluence version) is a FAILED write: exit 1 so
# the caller cannot mistake it for success. The response body above says why.
if ($httpStatus -lt 200 -or $httpStatus -gt 299) {
  if ($httpStatus -ge 400 -and $httpStatus -le 499) {
    [Console]::Error.WriteLine('PUT rejected: HTTP ' + $httpStatus + ' -- nothing was written; see the response above. A new staging pass is needed to retry.')
  } else {
    [Console]::Error.WriteLine('PUT failed: HTTP ' + $httpStatus + ' (0 = no status received). OUTCOME UNKNOWN: the write may or may not have landed -- re-fetch the document before retrying.')
  }
  exit 1
}
exit 0
