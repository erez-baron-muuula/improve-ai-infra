#!/usr/bin/env pwsh
# snowflake-read.ps1 -- run ONE look-only query in Snowflake as Claude's own login
# CLAUDE_READER (role CLAUDE_READ, warehouse CLAUDE_WH), outside the browser.
# GEN-980 lever e / GEN-953 step 4.
#
#   & 'C:\Users\Erez\.claude\scripts\snowflake-read.ps1' -SqlFile '<a .sql file under %TEMP%>'
#
# Write the query to a .sql file in the session scratchpad (it is under %TEMP%) first, then run
# this. The ROLE is what makes it look-only: CLAUDE_READ has SELECT/USAGE grants and three
# SNOWFLAKE viewer roles, nothing that can change data or run a routine. This script adds no
# statement filter of its own. One statement per run (the driver refuses more by default).
#
# Output: the row count and the first 50 rows on screen; ALL rows as CSV in
# %TEMP%\snowflake-read\<time>.csv. The key is read from Windows Credential Manager
# ('claude-snowflake-reader', stored by snowflake-reader-setup.ps1) into memory only; it is
# never printed, put on a command line, or written to a file.
#
# Keep this file ASCII-only: PS 5.1 reads a BOM-less script as Windows-1252.

param(
  [Parameter(Mandatory = $true)][string]$SqlFile
)

$ErrorActionPreference = 'Stop'
$Resource  = 'claude-snowflake-reader'
$Server    = 'iutdpnk-ql40012.snowflakecomputing.com'
$User      = 'CLAUDE_READER'
$Role      = 'CLAUDE_READ'
$Warehouse = 'CLAUDE_WH'
$ShowRows  = 50
$CellMax   = 200

function Get-SqlText([string]$Path) {
  $tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
  $full = [IO.Path]::GetFullPath($Path)
  if (-not $full.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw ('The query file must be under ' + $tempRoot + ' (the session scratchpad is).')
  }
  if ([IO.Path]::GetExtension($full) -ne '.sql') { throw 'The query file must end in .sql.' }
  if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw ('No such query file: ' + $full) }
  if ((Get-Item -LiteralPath $full).Length -gt 1MB) { throw 'The query file is larger than 1 MB.' }
  $sql = [IO.File]::ReadAllText($full, [Text.Encoding]::UTF8).Trim()
  if ([string]::IsNullOrWhiteSpace($sql)) { throw 'The query file is empty.' }
  return $sql
}

function Get-ReaderKey {
  $vault = [Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]::new()
  try {
    $c = $vault.Retrieve($Resource, $Resource)
    $c.RetrievePassword()
    return $c.Password
  } catch {
    throw 'The Snowflake reader key is not stored on this PC. Erez runs once, in his own PowerShell window: powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Erez\AI Projects\Improve AI Infra\notes\approval-popups\gen980\snowflake\snowflake-reader-setup.ps1"'
  } finally {
    Remove-Variable -Name c -ErrorAction SilentlyContinue
  }
}

function Format-Cell($Value) {
  if ($null -eq $Value -or $Value -is [DBNull]) { return '' }
  $s = [string]$Value
  if ($s.Length -gt $CellMax) { $s = $s.Substring(0, $CellMax) + '...' }
  return ($s -replace "[\r\n\t]+", ' ')
}

function ConvertTo-CsvField($Value) {
  if ($null -eq $Value -or $Value -is [DBNull]) { return '' }
  return '"' + ([string]$Value).Replace('"', '""') + '"'
}

function Invoke-Read {
  [Console]::OutputEncoding = [Text.Encoding]::UTF8
  $sql = Get-SqlText $SqlFile
  $outDir = Join-Path $env:TEMP 'snowflake-read'
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  $csvPath = Join-Path $outDir ((Get-Date).ToString('yyyyMMdd-HHmmss-fff') + '.csv')

  $key = Get-ReaderKey
  $conn = New-Object System.Data.Odbc.OdbcConnection
  try {
    $conn.ConnectionString = 'Driver={SnowflakeDSIIDriver};Server=' + $Server + ';UID=' + $User +
      ';Authenticator=SNOWFLAKE_JWT;PRIV_KEY_BASE64=' + $key + ';Role=' + $Role + ';Warehouse=' + $Warehouse + ';Tracing=0'
    Remove-Variable -Name key
    $conn.Open()

    $tag = $conn.CreateCommand()
    $tag.CommandText = "ALTER SESSION SET QUERY_TAG = 'claude-reader'"
    [void]$tag.ExecuteNonQuery()

    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $sql
    $cmd.CommandTimeout = 330
    $rdr = $cmd.ExecuteReader()
    $w = New-Object IO.StreamWriter($csvPath, $false, (New-Object Text.UTF8Encoding($false)))
    try {
      $n = $rdr.FieldCount
      $names = @(for ($i = 0; $i -lt $n; $i++) { $rdr.GetName($i) })
      $w.WriteLine((@($names | ForEach-Object { ConvertTo-CsvField $_ }) -join ','))
      Write-Output ($names -join "`t")
      $rows = 0
      $vals = New-Object object[] $n
      while ($rdr.Read()) {
        [void]$rdr.GetValues($vals)
        $w.WriteLine((@($vals | ForEach-Object { ConvertTo-CsvField $_ }) -join ','))
        if ($rows -lt $ShowRows) { Write-Output ((@($vals | ForEach-Object { Format-Cell $_ })) -join "`t") }
        $rows++
      }
    } finally {
      $w.Dispose()
      $rdr.Dispose()
    }
    Write-Output ''
    $shown = [Math]::Min($rows, $ShowRows)
    Write-Output ('Rows: ' + $rows + ' (showing ' + $shown + '). All rows: ' + $csvPath)
  } finally {
    Remove-Variable -Name key -ErrorAction SilentlyContinue
    $conn.Dispose()
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  try {
    Invoke-Read
  } catch {
    [Console]::Error.WriteLine('ERROR: ' + $_.Exception.Message)
    exit 1
  }
  exit 0
}
