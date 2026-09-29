# notion-rest-write.ps1 -- the ONLY route by which a raw Notion REST write may reach the API.
# GEN-508 piece 1. auto-approve.js recognises an anchored invocation of this script and binds a
# review record to {surface, method, url, sha256(body)}. This file's sha256 is pinned in
# auto-approve.js; a mismatch hard-blocks every gated REST write (reason rest-script-mismatch).
#
# MAINTENANCE INVARIANT: every parameter declared HERE must be REQUIRED by the hook's template, so an
# ambient $PSDefaultParameterValues entry can never bind one. (CmdletBinding's own common parameters
# -Verbose/-ErrorAction/... are exempt: none of them can supply a body, a method or a URL. Adding a
# script parameter of our own that is optional re-opens the channel.) Any change to this file must
# update the pinned hash in auto-approve.js in the same change.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('POST','PATCH','DELETE')] [string] $Method,
  [Parameter(Mandatory = $true)][ValidatePattern('^https://api\.notion\.com/v1/')] [string] $Url,
  [Parameter(Mandatory = $true)] [string] $BodyFile
)
$ErrorActionPreference = 'Stop'

# The hook owns the URL grammar. This script's own check is narrower in purpose: it refuses to be
# repurposed as a general HTTP client, so a future template change cannot turn it into one.
if ($BodyFile -ne 'NONE') {
  if (-not [System.IO.Path]::IsPathRooted($BodyFile)) { throw 'BodyFile must be absolute, or NONE.' }
  if (-not (Test-Path -LiteralPath $BodyFile -PathType Leaf)) { throw "BodyFile not found: $BodyFile" }
}

# Token from the Windows Credential Vault, never from the GATED command -- so no command the hook sees
# carries it and no reviewer transcript persists it. It is also never put on curl's command line
# (GEN-639): a process listing can read a command line, and a Node spawn error prints it in full --
# how the token leaked into a session log (GEN-638). It goes into a temp curl config file (-K),
# deleted in the finally. (Piping it to `curl -K -` fails from PS 5.1: PowerShell prefixes a UTF-8 BOM.)
$vault = [Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]::new()
$cred  = $vault.Retrieve('claude-notion-token','claude-notion-token')
$cred.RetrievePassword()
$token = $cred.Password
# A character outside this set would need escaping in the config line; refuse rather than build a
# broken or injectable config. The message never includes the value.
if ($token -cnotmatch '\A[A-Za-z0-9_.\-]+\z') { throw 'Stored Notion token is empty or has unexpected characters (value not shown).' }

# curl by ABSOLUTE path, so a profile-defined `function curl.exe` cannot shadow it, with -q FIRST --
# the only thing that stops curl reading %USERPROFILE%\.curlrc, which accepts `data = @file`.
# -m 60 bounds the call so the finally always gets to run before a caller's timeout.
$curl = 'C:\Windows\System32\curl.exe'
$cfgFile = Join-Path $env:TEMP ('notion-rest-write-cfg-' + [guid]::NewGuid().ToString('N') + '.txt')
$code = 1
try {
  [IO.File]::WriteAllText($cfgFile, ('header = "Authorization: Bearer ' + $token + '"' + "`n"), (New-Object System.Text.UTF8Encoding $false))
  $curlArgs = @('-q','-sS','-m','60','-K',$cfgFile,'-X',$Method,$Url,
                '-H','Notion-Version: 2022-06-28',
                '-H','Content-Type: application/json',
                '-w',"`nHTTP=%{http_code}`n")
  if ($BodyFile -ne 'NONE') { $curlArgs += @('--data-binary', "@$BodyFile") }
  & $curl @curlArgs   # response body + the HTTP= line land on the pipeline; no Write-Output (a profile
                      # function could shadow it) and no redirect
  $code = $LASTEXITCODE
}
finally {
  Remove-Item -LiteralPath $cfgFile -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $cfgFile) {
    [Console]::Error.WriteLine("WARNING: could not delete temp file holding the Notion token: $cfgFile -- delete it WITHOUT opening or reading it.")
  }
  Remove-Variable -Name token, cred, Matches -ErrorAction SilentlyContinue
}
# NOTE for callers: curl without -f exits 0 on a Notion 4xx, so a non-zero exit here means a transport
# failure, NOT a rejected write. Read the HTTP= line to know whether the write was accepted.
exit $code
