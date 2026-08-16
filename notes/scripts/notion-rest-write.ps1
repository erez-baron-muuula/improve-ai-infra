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
# carries it and no reviewer transcript persists it. (It does land in this child curl process's argv,
# visible to a local process listing -- unchanged from today's inline-curl practice, and stated so the
# claim is not read as broader than it is.)
$vault = [Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]::new()
$cred  = $vault.Retrieve('claude-notion-token','claude-notion-token')
$cred.RetrievePassword()

# curl by ABSOLUTE path, so a profile-defined `function curl.exe` cannot shadow it, with -q FIRST --
# the only thing that stops curl reading %USERPROFILE%\.curlrc, which accepts `data = @file`.
$curl = 'C:\Windows\System32\curl.exe'
$curlArgs = @('-q','-sS','-X',$Method,$Url,
              '-H',"Authorization: Bearer $($cred.Password)",
              '-H','Notion-Version: 2022-06-28',
              '-H','Content-Type: application/json',
              '-w',"`nHTTP=%{http_code}`n")
if ($BodyFile -ne 'NONE') { $curlArgs += @('--data-binary', "@$BodyFile") }
& $curl @curlArgs   # response body + the HTTP= line land on the pipeline; no Write-Output (a profile
                    # function could shadow it) and no redirect
# NOTE for callers: curl without -f exits 0 on a Notion 4xx, so a non-zero exit here means a transport
# failure, NOT a rejected write. Read the HTTP= line to know whether the write was accepted.
exit $LASTEXITCODE
