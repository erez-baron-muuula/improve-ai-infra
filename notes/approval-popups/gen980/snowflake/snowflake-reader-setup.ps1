#!/usr/bin/env pwsh
# snowflake-reader-setup.ps1 -- one-time setup of Claude's look-only Snowflake login key
# on THIS PC (GEN-980 lever e / GEN-953 step 4).
#
# Erez runs this in HIS OWN PowerShell window -- never through Claude:
#   powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Erez\AI Projects\Improve AI Infra\notes\approval-popups\gen980\snowflake\snowflake-reader-setup.ps1"
# It lives in the Improve AI Infra repo, not ~/.claude/scripts: it runs once per PC and no
# Claude session runs it.
#
# It makes a new RSA-2048 key pair with Node's built-in crypto, stores the PRIVATE key in
# Windows Credential Manager (resource and user name 'claude-snowflake-reader', one base64
# line of the PKCS#8 DER bytes), reads it back to prove it, and writes ONLY the PUBLIC key
# (not secret) to a text file so it can be registered on the Snowflake user CLAUDE_READER.
# Nothing secret is printed, put on a command line, or written to a file.
# The key has no passphrase: a passphrase stored beside it in the same store adds nothing.
#
# Re-running refuses if a key is already stored; pass -Replace to make a new one (the old
# key must then be removed from the Snowflake user, or it keeps working).
#
# Keep this file ASCII-only: PS 5.1 reads a BOM-less script as Windows-1252.

param(
  [switch]$Replace
)

$ErrorActionPreference = 'Stop'
$Resource = 'claude-snowflake-reader'
$PublicKeyFile = Join-Path $env:TEMP 'snowflake-reader-public-key.txt'

function New-Vault {
  return [Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]::new()
}

function Get-OwnEntries($Vault, [string]$Res) {
  try { return @($Vault.FindAllByResource($Res) | Where-Object { $_.UserName -ceq $Res }) } catch { return @() }
}

# Node prints exactly three lines: base64 PKCS#8 DER private key (secret), base64 SPKI DER
# public key, and the public key's SHA256 fingerprint as Snowflake shows it. Plain lines, so no
# parser or logging cmdlet ever handles the private key.
$NodeJs = @'
const c = require('crypto');
const k = c.generateKeyPairSync('rsa', { modulusLength: 2048 });
const priv = k.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
const pubDer = k.publicKey.export({ type: 'spki', format: 'der' });
const fp = 'SHA256:' + c.createHash('sha256').update(pubDer).digest('base64');
process.stdout.write(priv + '\n' + pubDer.toString('base64') + '\n' + fp + '\n');
'@

function Invoke-Setup {
  if ([Console]::IsInputRedirected) {
    throw 'Run this in your own PowerShell window (input must not be piped in).'
  }
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { throw 'Node.js was not found on this PC. Nothing was stored.' }

  $vault = New-Vault
  $existing = @(Get-OwnEntries $vault $Resource)
  if ($existing.Count -gt 0 -and -not $Replace) {
    throw 'A Snowflake reader key is already stored on this PC. Nothing was changed and nothing more is needed. Use -Replace only if Claude asks you to.'
  }
  Remove-Item -LiteralPath $PublicKeyFile -Force -ErrorAction SilentlyContinue

  $lines = @($NodeJs | & $node.Source -)
  if ($LASTEXITCODE -ne 0 -or $lines.Count -ne 3) { throw 'Making the key failed. Nothing was stored.' }
  $priv = [string]$lines[0]; $pub = [string]$lines[1]; $fp = [string]$lines[2]
  Remove-Variable -Name lines
  if ($priv -cnotmatch '\A[A-Za-z0-9+/=]{1000,}\z' -or $pub -cnotmatch '\A[A-Za-z0-9+/=]{300,}\z' -or $fp -cnotmatch '\ASHA256:[A-Za-z0-9+/=]{40,}\z') {
    throw 'The new key did not have the expected shape. Nothing was stored.'
  }

  try {
    $removedOld = $false
    foreach ($old in $existing) { $vault.Remove($old); $removedOld = $true }
    try {
      $vault.Add([Windows.Security.Credentials.PasswordCredential]::new($Resource, $Resource, $priv))
    } catch {
      if ($removedOld) { throw 'The old key was removed and the new one was NOT stored. Run this again.' }
      throw 'Credential Manager refused to store the key. Nothing was changed. Run this again.'
    }
    $c = $vault.Retrieve($Resource, $Resource)
    $c.RetrievePassword()
    if (-not ($c.Password -ceq $priv)) { throw 'Stored the key but reading it back did not match. Run this again with -Replace.' }
    $len = $priv.Length
  } finally {
    Remove-Variable -Name c, priv -ErrorAction SilentlyContinue
  }

  Write-Output ('Stored the Snowflake reader key on this PC: ' + $len + ' characters, read back and matched. The value was not shown.')
  try {
    Set-Content -LiteralPath $PublicKeyFile -Value @($pub, $fp) -Encoding ASCII
    Write-Output ('Public key (not secret) saved to ' + $PublicKeyFile + '  fingerprint ' + $fp)
  } catch {
    Write-Output 'Could not save the public key file; here it is instead (not secret):'
    Write-Output $pub
    Write-Output $fp
  }
  Write-Output 'Tell Claude it is done.'
}

if ($MyInvocation.InvocationName -ne '.') {
  try {
    Invoke-Setup
  } catch {
    [Console]::Error.WriteLine('ERROR: ' + $_.Exception.Message)
    exit 1
  }
  exit 0
}
