#!/usr/bin/env pwsh
# set-claude-key.ps1 -- store one of Claude's API keys in THIS PC's Windows Credential Manager,
# so no Claude session ever needs the key sheet or sees the value. (GEN-638 step 2 / GEN-163.)
#
# Erez runs this in HIS OWN PowerShell window -- never through Claude:
#   powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME\.claude\scripts\set-claude-key.ps1" -Key slack
#   powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME\.claude\scripts\set-claude-key.ps1" -List
#
# The value comes ONLY from a masked prompt: no parameter accepts it, so it is never on a
# command line, in shell history, or in a Claude session. Nothing in this script prints it.
# -List prints key NAMES only, so Claude may run it to see which keys are missing on a PC.
#
# $KeyTargets below is the ONE inventory of the keys Claude reads from Credential Manager
# (the GEN-638 step-3 tripwire reads it). Add a key here, and nowhere else.
# Credential Manager is per PC and per Windows user: run this on every PC Claude is used on.
#
# Keep this file ASCII-only: PS 5.1 reads a BOM-less script as Windows-1252.

param(
  [ValidateSet('notion', 'atlassian', 'slack')]
  [string]$Key,
  [switch]$List
)

$ErrorActionPreference = 'Stop'

# key name -> Credential Manager resource. Resource and user name are the same string,
# matching the existing claude-notion-token entry that the Notion scripts read.
$KeyTargets = [ordered]@{
  notion    = 'claude-notion-token'
  atlassian = 'claude-atlassian-token'
  slack     = 'claude-slack-token'
  # Snowflake look-only login key (GEN-980). Not stored with -Key: its own setup script makes
  # the key pair and stores it (see $SetupCommands below).
  'snowflake-reader' = 'claude-snowflake-reader'
}

# Keys stored by their own setup script instead of -Key (no value to paste).
$SetupCommands = @{
  'snowflake-reader' = 'powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Erez\AI Projects\Improve AI Infra\notes\approval-popups\gen980\snowflake\snowflake-reader-setup.ps1"'
}

function Get-HelperCommand([string]$Name) {
  return 'powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME\.claude\scripts\set-claude-key.ps1" -Key ' + $Name
}

function New-Vault {
  return [Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]::new()
}

# The entries the scripts actually read: resource AND user name both equal $Resource.
# FindAllByResource returns entries WITHOUT loading their passwords, and throws when there
# are none; an entry under the same resource with a different user name is not ours.
function Get-OwnEntries($Vault, [string]$Resource) {
  try { return @($Vault.FindAllByResource($Resource) | Where-Object { $_.UserName -ceq $Resource }) } catch { return @() }
}

function Test-VaultEntry($Vault, [string]$Resource) {
  return (@(Get-OwnEntries $Vault $Resource).Count -gt 0)
}

# True if the stored value for $Resource equals $Secret (case-sensitive). The stored value
# is compared in memory and never printed or returned.
function Test-VaultValue($Vault, [string]$Resource, [string]$Secret) {
  try {
    $c = $Vault.Retrieve($Resource, $Resource)
    $c.RetrievePassword()
    return ($c.Password -ceq $Secret)
  } catch {
    return $false
  } finally {
    Remove-Variable -Name c -ErrorAction SilentlyContinue
  }
}

# Throws a message (never containing the value) unless $Secret is a plausible key.
function Assert-KeyShape([string]$Secret) {
  if ([string]::IsNullOrEmpty($Secret)) { throw 'Nothing was pasted. Nothing was stored.' }
  if ($Secret -cnotmatch '\A[A-Za-z0-9_.=+/\-]+\z') {
    throw 'That value contains a space, quote or other character a key does not have. Paste only the key itself. Nothing was stored.'
  }
  if ($Secret.Length -lt 20) { throw ('That value is only ' + $Secret.Length + ' characters -- too short to be a key. Nothing was stored.') }
}

# Stores $Secret under $Resource and proves it by reading it back. Works whether or not
# PasswordVault.Add overwrites an existing entry (the evidence is mixed), and removes the
# old entry only when Add did not already leave the new value in place. Returns
# 'stored' or 'stored-after-replace'; throws a plain message (never the value) on failure.
function Save-VaultSecret([string]$Resource, [string]$Secret) {
  $vault = New-Vault
  $addThrew = $false
  try {
    $vault.Add([Windows.Security.Credentials.PasswordCredential]::new($Resource, $Resource, $Secret))
  } catch {
    $addThrew = $true
  }
  if (-not $addThrew -and (Test-VaultValue $vault $Resource $Secret)) { return 'stored' }

  # Add refused, or it left a different (old) value in place: replace explicitly.
  $removedOld = $false
  try {
    foreach ($old in @(Get-OwnEntries $vault $Resource)) {
      $vault.Remove($old)
      $removedOld = $true
    }
  } catch {
    if ($removedOld) { throw ('The old ' + $Resource + ' entry was removed and the new key was NOT stored. Run the helper again.') }
    throw ('Credential Manager refused to replace ' + $Resource + '. Nothing was changed. Run the helper again.')
  }
  try {
    $vault.Add([Windows.Security.Credentials.PasswordCredential]::new($Resource, $Resource, $Secret))
  } catch {
    if ($removedOld) { throw ('The old ' + $Resource + ' entry was removed and the new key was NOT stored. Run the helper again.') }
    throw ('Credential Manager refused to store ' + $Resource + '. Nothing was changed. Run the helper again.')
  }
  if (Test-VaultValue $vault $Resource $Secret) { return 'stored-after-replace' }
  throw ('Stored ' + $Resource + ' but reading it back did not match what you pasted (no match). Run the helper again.')
}

function Invoke-List {
  $vault = New-Vault
  foreach ($name in $KeyTargets.Keys) {
    $resource = $KeyTargets[$name]
    if (Test-VaultEntry $vault $resource) {
      Write-Output ($name + ': set up on this PC (' + $resource + ')')
    } else {
      $how = Get-HelperCommand $name
      if ($SetupCommands.ContainsKey($name)) { $how = $SetupCommands[$name] }
      Write-Output ($name + ': NOT set up on this PC -- store it with: ' + $how)
    }
  }
}

function Invoke-Store([string]$Name) {
  if ([Console]::IsInputRedirected) {
    throw 'Run this in your own PowerShell window and paste the key at the hidden prompt (input must not be piped in).'
  }
  $resource = $KeyTargets[$Name]
  $secure = Read-Host -AsSecureString -Prompt ('Paste the ' + $Name + ' key (input is hidden), then press Enter')
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $plain = ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)).Trim()
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
  try {
    Assert-KeyShape $plain
    $how = Save-VaultSecret $resource $plain
    $len = $plain.Length
  } finally {
    Remove-Variable -Name plain, secure -ErrorAction SilentlyContinue
  }
  $note = ''
  if ($how -eq 'stored-after-replace') { $note = ' (replaced the previous value)' }
  Write-Output ('Stored the ' + $Name + ' key on this PC' + $note + ': ' + $len + ' characters, read back and matched. The value was not shown.')
}

# Dot-sourcing (". .\set-claude-key.ps1") only defines the functions -- used by the tests.
if ($MyInvocation.InvocationName -ne '.') {
  try {
    if ($List -and $Key) {
      throw 'Use -Key to store a key, or -List to see which keys are set up -- not both at once. Nothing was stored.'
    } elseif ($List) {
      Invoke-List
    } elseif ($Key) {
      Invoke-Store $Key
    } else {
      Write-Output 'Usage (run in your own PowerShell window):'
      Write-Output ('  ' + (Get-HelperCommand '<notion|atlassian|slack>'))
      Write-Output '  powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME\.claude\scripts\set-claude-key.ps1" -List'
      exit 1
    }
  } catch {
    [Console]::Error.WriteLine('ERROR: ' + $_.Exception.Message)
    exit 1
  }
  exit 0
}
