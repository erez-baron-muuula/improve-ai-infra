#Requires -PSEdition Desktop
# snowflake-read.ps1 -- run ONE look-only query in Snowflake as Claude's own login
# CLAUDE_READER (role CLAUDE_READ, warehouse CLAUDE_WH), outside the browser.
# GEN-980 lever e / GEN-953 step 4. Windows PowerShell 5.1 only (uses the Windows key store).
#
#   & 'C:\Users\Erez\.claude\scripts\snowflake-read.ps1' -SqlFile '<a .sql file under %TEMP%>'
#
# Write the query to a .sql file in the session scratchpad (it is under %TEMP%) first, then run
# this with a tool timeout of at least 480000 ms (the script stops itself within 7.5 minutes:
# up to 6 waiting for the query, the rest for downloading the result).
# Two layers keep a run look-only:
#  1. This script sends only a plain look-up: the statement must start with SELECT, WITH,
#     SHOW, DESC/DESCRIBE or EXPLAIN; every `->>` step after the first must start with SELECT
#     (no comment before it); a WITH may not define or call a procedure; and AI/Cortex (AI_*,
#     SUMMARIZE_AGG, anything naming CORTEX), SYSTEM$, IDENTIFIER() and TO_QUERY() are refused
#     (AI functions bill outside CLAUDE_MONITOR;
#     IDENTIFIER and TO_QUERY can name a function or a query inside a string). Leading comments
#     are removed and NOT sent, so the first word checked is the first word Snowflake reads;
#     control and invisible formatting characters other than tab and newline are refused
#     (Snowflake ends a -- comment at a lone carriage return, which would let a comment hide the
#     real first word; an invisible character could split a function name from its bracket). Snowflake
#     decides a statement's type from its first word, and runs one statement per request.
#  2. Snowflake: role CLAUDE_READ holds USAGE/SELECT grants and three SNOWFLAKE viewer roles,
#     and the user has PREVENT_UNLOAD_TO_INLINE_URL / _INTERNAL_STAGES set. Every role also
#     inherits Snowflake's PUBLIC role, which on this account can create schemas in
#     SNOWFLAKE_LEARNING_DB and use AI functions; layer 1 is what keeps Claude off those.
#
# How: Snowflake's SQL API (POST /api/v2/statements) with key-pair sign-in. The JWT is signed
# here with .NET (RSA, SHA-256); HTTPS uses Windows' own certificate checks, left ON. (The
# Snowflake ODBC driver was tried first: .NET caps its connection string at 1024 characters,
# and the driver's own certificate list rejects the Avast web-shield certificate on this PC.)
# Dates and times come back formatted, in UTC (the account's time zone; the API would otherwise
# use America/Los_Angeles).
#
# Output: the row count and the first 50 rows on screen; ALL rows as CSV in
# %TEMP%\snowflake-read\<time>.csv. Rows are written to <time>.csv.partial and renamed to .csv
# only after every result page arrived and the total matches Snowflake's row count, so a .csv
# is always complete. Result files older than 7 days are deleted at start. The key is read from
# Windows Credential Manager ('claude-snowflake-reader', base64 PKCS#8, stored by
# snowflake-reader-setup.ps1) into memory only; neither the key nor the signed token is ever
# printed, put on a command line, passed as a parameter, or written to a file.
#
# Keep this file ASCII-only: PS 5.1 reads a BOM-less script as Windows-1252.

param(
  [Parameter(Mandatory = $true)][string]$SqlFile
)

Set-PSDebug -Off
$ErrorActionPreference = 'Stop'
$Resource  = 'claude-snowflake-reader'
$Account   = 'IUTDPNK-QL40012'
$BaseUrl   = 'https://iutdpnk-ql40012.snowflakecomputing.com'
$User      = 'CLAUDE_READER'
$Role      = 'CLAUDE_READ'
$Warehouse = 'CLAUDE_WH'
$TimeZone  = 'UTC'
$ShowRows  = 50
$CellMax   = 200
$PollLimitSeconds = 360
$TotalLimitSeconds = 450   # whole run, under the 480 s tool timeout callers are told to use
$script:Deadline = $null
$KeepDays  = 7
$MaxRows   = 2000000
$script:Jwt = $null

Add-Type -AssemblyName System.Web.Extensions
Add-Type -AssemblyName System.Core

function Get-SqlText([string]$Path) {
  $tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
  $full = [IO.Path]::GetFullPath($Path)
  if (-not $full.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw ('The query file must be under ' + $tempRoot + ' (the session scratchpad is).')
  }
  if ([IO.Path]::GetExtension($full) -ne '.sql') { throw 'The query file must end in .sql.' }
  if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw ('No such query file: ' + $full) }
  $item = Get-Item -LiteralPath $full
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'The query file must be a plain file, not a link.' }
  $dir = $item.Directory
  while ($null -ne $dir -and $dir.FullName.Length -ge $tempRoot.Length) {
    if ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'The query file must not be reached through a linked folder.' }
    $dir = $dir.Parent
  }
  if ($item.Length -gt 1MB) { throw 'The query file is larger than 1 MB.' }
  $sql = [IO.File]::ReadAllText($full, [Text.Encoding]::UTF8).Trim()
  if ([string]::IsNullOrWhiteSpace($sql)) { throw 'The query file is empty.' }
  return $sql
}

# Removes leading whitespace and SQL comments (--, //, /* */) so the first word can be read.
# SAFETY: the caller SENDS this function's result, never the original text. This reading of
# comments need not match Snowflake's exactly: whatever it strips is not sent, so the first word
# checked is always the first word Snowflake reads. Sending the original text would undo that.
function Remove-LeadingComments([string]$Text) {
  $s = $Text
  while ($true) {
    $s = $s.TrimStart()
    if ($s.StartsWith('--', [StringComparison]::Ordinal) -or $s.StartsWith('//', [StringComparison]::Ordinal)) {
      $nl = $s.IndexOf("`n", [StringComparison]::Ordinal)
      if ($nl -lt 0) { return '' }
      $s = $s.Substring($nl + 1)
      continue
    }
    if ($s.StartsWith('/*', [StringComparison]::Ordinal)) {
      $end = $s.IndexOf('*/', 2, [StringComparison]::Ordinal)
      if ($end -lt 0) { return '' }
      $s = $s.Substring($end + 2)
      continue
    }
    return $s
  }
}

function Get-FirstWord([string]$Text) {
  $m = [regex]::Match((Remove-LeadingComments $Text), '\A([A-Za-z]+)(?![A-Za-z0-9_$])')
  if ($m.Success) { return $m.Groups[1].Value.ToUpperInvariant() }
  return ''
}

# Whitespace or a comment between two words, as Snowflake reads it once lone carriage returns
# and other line-break characters are refused (a -- or // comment then ends at a newline).
# Each alternative starts differently and a block comment stops at its first */, so a long run
# of comments cannot make the pattern backtrack; Test-LookPattern also caps each match at 2 s.
$script:Gap = '(?:\s|/\*(?:[^*]|\*(?!/))*\*/|--[^\n]*\n|//[^\n]*\n)'

# Case-insensitive match with a time limit; running out of time refuses the query.
function Test-LookPattern([string]$Text, [string]$Pattern) {
  try {
    $opts = [Text.RegularExpressions.RegexOptions]::IgnoreCase -bor [Text.RegularExpressions.RegexOptions]::CultureInvariant
    return [regex]::IsMatch($Text, $Pattern, $opts, [TimeSpan]::FromSeconds(2))
  } catch [Text.RegularExpressions.RegexMatchTimeoutException] {
    throw 'Refused before sending: the look-only check could not read this query in time. Simplify it (fewer comments), or run it in Snowsight with Erez.'
  }
}

# Returns the statement to send (leading comments removed), or throws unless $Sql is a plain
# look-up (see the header, layer 1).
function Get-LookOnlySql([string]$Sql) {
  $refuse = 'Refused before sending: this login only runs plain look-ups (SELECT, WITH, SHOW, DESCRIBE, EXPLAIN). '
  $text = $Sql.Replace("`r`n", "`n")
  if ($text -match '[\x00-\x08\x0B-\x1F\x7F-\x9F\u2028\u2029\p{Cf}]') {
    throw ($refuse + 'The query holds a control or invisible formatting character other than tab and newline (for example a lone carriage return or a zero-width space). Save it as plain text with plain line breaks.')
  }
  $body = Remove-LeadingComments $text
  $steps = $body -split '->>'
  $first = Get-FirstWord $steps[0]
  if (@('SELECT', 'WITH', 'SHOW', 'DESC', 'DESCRIBE', 'EXPLAIN') -notcontains $first) {
    throw ($refuse + 'This statement starts with "' + $first + '". Changes go through Snowsight, with Erez.')
  }
  for ($i = 1; $i -lt $steps.Count; $i++) {
    if ($steps[$i] -notmatch '(?i)\A\s*SELECT(?![A-Za-z0-9_$])') { throw ($refuse + 'Every step after ->> must start with SELECT, with no comment before it.') }
  }
  # An anonymous procedure is `WITH p AS PROCEDURE ... CALL p()`. "AS PROCEDURE/FUNCTION" is
  # refused in every statement (in case one can be nested); CALL only after a leading WITH,
  # because refusing it everywhere wrongly refused 2 of 122 real past look-ups.
  if ((Test-LookPattern $body ('\bAS' + $script:Gap + '+(PROCEDURE|FUNCTION)\b')) -or ($first -eq 'WITH' -and (Test-LookPattern $body '\bCALL\b'))) {
    throw ($refuse + 'A WITH may not define or call a procedure or function.')
  }
  if (Test-LookPattern $body ('\bCORTEX\b|\bSYSTEM\$|\bBULK_PROCESS_DOCUMENT\b|\b(AI_\w+|SUMMARIZE_AGG|IDENTIFIER|TO_QUERY)"?' + $script:Gap + '*\(')) {
    throw ($refuse + 'AI (Cortex), SYSTEM$, IDENTIFIER() and TO_QUERY() are not allowed here: AI functions cost money outside the spending cap, and the other two can hide which function or query runs. Ask Erez first.')
  }
  # Snowflake's own ML, hosted-model (SNOWFLAKE.MODELS), notification, Snowpark Connect and
  # container-service objects (reachable through the PUBLIC role) can bill, send or change state;
  # so can model and service methods such as model!PREDICT(...) or m!"predict"(...).
  if (Test-LookPattern $body ('\bSNOWFLAKE"?' + $script:Gap + '*\.' + $script:Gap + '*"?(ML|MODELS|NOTIFICATION|SNOWPARK_CONNECT|SPCS)\b|!' + $script:Gap + '*"?[A-Za-z_]\w*"?' + $script:Gap + '*\(')) {
    throw ($refuse + 'Snowflake ML, hosted models, notification, Snowpark Connect and container functions, and model or service methods (name!METHOD), are not allowed here. Ask Erez first.')
  }
  return $body
}

function Get-ReaderKeyBytes {
  try {
    $vault = [Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]::new()
  } catch {
    throw ('Could not open Windows Credential Manager (' + $_.Exception.GetType().Name + '). Run this in Windows PowerShell 5.1. The stored key was not touched; do not re-run the setup script.')
  }
  try {
    $c = $vault.Retrieve($Resource, $Resource)
    $c.RetrievePassword()
    $b64 = $c.Password
  } catch {
    $inner = $_.Exception
    while ($inner.InnerException) { $inner = $inner.InnerException }
    # 0x80070490 = element not found: the only case where the key is really missing.
    if ($inner.HResult -eq -2147023728) {
      throw 'The Snowflake reader key is not stored on this PC. Erez runs once, in his own PowerShell window: powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Erez\AI Projects\Improve AI Infra\notes\approval-popups\gen980\snowflake\snowflake-reader-setup.ps1"'
    }
    throw ('Could not read the Snowflake reader key from Windows Credential Manager (HRESULT 0x' + $inner.HResult.ToString('X8') + '). The key is probably still stored: retry, and do not re-run the setup script.')
  } finally {
    Remove-Variable -Name c -ErrorAction SilentlyContinue
  }
  try {
    return ,([Convert]::FromBase64String($b64))
  } catch {
    throw 'The stored Snowflake reader key is damaged (not valid base64). Re-run the setup script with -Replace, then register the new public key on CLAUDE_READER.'
  } finally {
    Remove-Variable -Name b64 -ErrorAction SilentlyContinue
  }
}

# --- DER helpers to rebuild the public key (SubjectPublicKeyInfo) for its fingerprint ---
function Get-DerLength([int]$Len) {
  if ($Len -lt 128) { return ,([byte[]]@($Len)) }
  $b = New-Object System.Collections.Generic.List[byte]
  while ($Len -gt 0) { $b.Insert(0, [byte]($Len -band 0xFF)); $Len = $Len -shr 8 }
  return ,([byte[]](@([byte](0x80 + $b.Count)) + $b.ToArray()))
}
function New-Der([byte]$Tag, [byte[]]$Body) {
  return ,([byte[]](@($Tag) + (Get-DerLength $Body.Length) + $Body))
}
function New-DerInteger([byte[]]$Unsigned) {
  $i = 0
  while ($i -lt $Unsigned.Length - 1 -and $Unsigned[$i] -eq 0) { $i++ }
  $v = [byte[]]$Unsigned[$i..($Unsigned.Length - 1)]
  if ($v[0] -band 0x80) { $v = [byte[]](@([byte]0) + $v) }
  return New-Der 0x02 $v
}
function Get-PublicKeyFingerprint($Rsa) {
  $p = $Rsa.ExportParameters($false)
  $rsaPub = New-Der 0x30 ([byte[]]((New-DerInteger $p.Modulus) + (New-DerInteger $p.Exponent)))
  $algId = [byte[]](0x30,0x0D,0x06,0x09,0x2A,0x86,0x48,0x86,0xF7,0x0D,0x01,0x01,0x01,0x05,0x00)
  $bitString = New-Der 0x03 ([byte[]](@([byte]0) + $rsaPub))
  $spki = New-Der 0x30 ([byte[]]($algId + $bitString))
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return 'SHA256:' + [Convert]::ToBase64String($sha.ComputeHash($spki)) } finally { $sha.Dispose() }
}

function ConvertTo-Base64Url([byte[]]$Bytes) {
  return [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

# Signs a fresh key-pair JWT into $script:Jwt (never returned or passed as a parameter).
function Set-Jwt {
  [byte[]]$keyBytes = Get-ReaderKeyBytes
  try {
    $cng = [Security.Cryptography.CngKey]::Import($keyBytes, [Security.Cryptography.CngKeyBlobFormat]::Pkcs8PrivateBlob)
  } finally {
    [Array]::Clear($keyBytes, 0, $keyBytes.Length)
  }
  $rsa = New-Object Security.Cryptography.RSACng($cng)
  try {
    $fp = Get-PublicKeyFingerprint $rsa
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $ser = New-Object Web.Script.Serialization.JavaScriptSerializer
    $head = ConvertTo-Base64Url ([Text.Encoding]::UTF8.GetBytes('{"alg":"RS256","typ":"JWT"}'))
    $claims = [ordered]@{ iss = ($Account + '.' + $User + '.' + $fp); sub = ($Account + '.' + $User); iat = $now; exp = ($now + 3300) }
    $body = ConvertTo-Base64Url ([Text.Encoding]::UTF8.GetBytes($ser.Serialize($claims)))
    $sig = $rsa.SignData([Text.Encoding]::ASCII.GetBytes($head + '.' + $body),
      [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $script:Jwt = $head + '.' + $body + '.' + (ConvertTo-Base64Url $sig)
  } finally {
    $rsa.Dispose()
    $cng.Dispose()
  }
}

# One HTTPS call to the fixed Snowflake host. Returns @{ Status; Json; Text }.
function Invoke-SnowflakeApi([string]$Method, [string]$PathAndQuery, [string]$JsonBody) {
  $req = [Net.HttpWebRequest]::Create($BaseUrl + $PathAndQuery)
  $req.Method = $Method
  $req.Accept = 'application/json'
  $req.UserAgent = 'claude-snowflake-read/1.0'
  $leftMs = 120000
  if ($null -ne $script:Deadline) {
    $leftMs = [int][Math]::Floor(($script:Deadline - (Get-Date)).TotalMilliseconds)
    if ($leftMs -lt 1000) { throw ('Stopped after ' + $TotalLimitSeconds + ' seconds without a complete result (slow query or very large result). Aggregate, add a LIMIT, or narrow the query.') }
  }
  $req.Timeout = [Math]::Min(120000, $leftMs)
  $req.ReadWriteTimeout = [Math]::Min(300000, $leftMs)
  $req.AllowAutoRedirect = $false
  $req.AutomaticDecompression = [Net.DecompressionMethods]::GZip -bor [Net.DecompressionMethods]::Deflate
  $req.Headers.Add('Authorization', 'Bearer ' + $script:Jwt)
  $req.Headers.Add('X-Snowflake-Authorization-Token-Type', 'KEYPAIR_JWT')
  if ($JsonBody) {
    $req.ContentType = 'application/json'
    $bytes = [Text.Encoding]::UTF8.GetBytes($JsonBody)
    $req.ContentLength = $bytes.Length
    $s = $req.GetRequestStream(); try { $s.Write($bytes, 0, $bytes.Length) } finally { $s.Dispose() }
  }
  try {
    $resp = $req.GetResponse()
  } catch [Net.WebException] {
    $resp = $_.Exception.Response
    if ($null -eq $resp) { throw ('Could not reach Snowflake: ' + $_.Exception.Message) }
  }
  try {
    $code = [int]$resp.StatusCode
    $rd = New-Object IO.StreamReader($resp.GetResponseStream(), [Text.Encoding]::UTF8)
    try { $text = $rd.ReadToEnd() } finally { $rd.Dispose() }
  } finally { $resp.Dispose() }
  if ($code -ge 300 -and $code -lt 400) { throw ('Snowflake answered with a redirect (HTTP ' + $code + '); not followed.') }
  $json = $null
  if ($text) {
    $ser = New-Object Web.Script.Serialization.JavaScriptSerializer
    $ser.MaxJsonLength = [int]::MaxValue
    try { $json = $ser.DeserializeObject($text) } catch { $json = $null }
  }
  return @{ Status = $code; Json = $json; Text = $text }
}

function Get-ApiError($R) {
  if ($R.Json -and $R.Json.ContainsKey('message')) {
    $m = [string]$R.Json['message']
    if ($R.Json.ContainsKey('code')) { $m = $m + ' (code ' + $R.Json['code'] + ')' }
    return $m
  }
  $t = [string]$R.Text
  if ($t.Length -gt 300) { $t = $t.Substring(0, 300) }
  return ('HTTP ' + $R.Status + ' ' + $t)
}

function Get-Handle($R) {
  $h = [string]$R.Json['statementHandle']
  if ($h -cnotmatch '\A[0-9a-fA-F-]{20,}\z') { throw 'Snowflake returned an unexpected statement handle.' }
  return $h
}

function Format-Cell($Value) {
  if ($null -eq $Value) { return '' }
  $s = [string]$Value
  if ($s.Length -gt $CellMax) { $s = $s.Substring(0, $CellMax) + '...' }
  # Control, line-separator and invisible format characters (bidi overrides, zero-width) could
  # hide or reorder what is read on screen; the CSV keeps the exact values.
  return ($s -replace '[\x00-\x1F\x7F-\x9F\p{Zl}\p{Zp}\p{Cf}]+', ' ')
}

function ConvertTo-CsvField($Value) {
  if ($null -eq $Value) { return '' }
  return '"' + ([string]$Value).Replace('"', '""') + '"'
}

function Remove-OldResults([string]$Dir) {
  $cut = (Get-Date).AddDays(-$KeepDays)
  Get-ChildItem -LiteralPath $Dir -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt $cut -and ($_.Name -like '*.csv' -or $_.Name -like '*.csv.partial') } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
}

function Invoke-Read {
  [Console]::OutputEncoding = [Text.Encoding]::UTF8
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $sql = Get-LookOnlySql (Get-SqlText $SqlFile)
  $script:Deadline = (Get-Date).AddSeconds($TotalLimitSeconds)
  $outDir = Join-Path $env:TEMP 'snowflake-read'
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  Remove-OldResults $outDir
  $csvPath = Join-Path $outDir ((Get-Date).ToString('yyyyMMdd-HHmmss-fff') + '.csv')
  $partPath = $csvPath + '.partial'

  Set-Jwt
  try {
    $ser = New-Object Web.Script.Serialization.JavaScriptSerializer
    $req = [ordered]@{
      statement = $sql; timeout = 300; warehouse = $Warehouse; role = $Role
      parameters = [ordered]@{
        MULTI_STATEMENT_COUNT = '1'; QUERY_TAG = 'claude-reader'; TIMEZONE = $TimeZone
        DATE_OUTPUT_FORMAT = 'YYYY-MM-DD'; TIME_OUTPUT_FORMAT = 'HH24:MI:SS.FF3'
        TIMESTAMP_NTZ_OUTPUT_FORMAT = 'YYYY-MM-DD HH24:MI:SS.FF3'
        TIMESTAMP_LTZ_OUTPUT_FORMAT = 'YYYY-MM-DD HH24:MI:SS.FF3 TZHTZM'
        TIMESTAMP_TZ_OUTPUT_FORMAT = 'YYYY-MM-DD HH24:MI:SS.FF3 TZHTZM'
      }
    }
    $r = Invoke-SnowflakeApi 'POST' ('/api/v2/statements?requestId=' + [guid]::NewGuid().ToString()) ($ser.Serialize($req))

    # Stop polling early enough that the cancel request still fits inside the overall limit.
    $deadline = (Get-Date).AddSeconds($PollLimitSeconds)
    if ($deadline -gt $script:Deadline.AddSeconds(-15)) { $deadline = $script:Deadline.AddSeconds(-15) }
    while ($r.Status -eq 202) {
      $handle = Get-Handle $r
      if ((Get-Date) -gt $deadline) {
        try { [void](Invoke-SnowflakeApi 'POST' ('/api/v2/statements/' + $handle + '/cancel') '{}') } catch { }
        throw 'The query was still running after 6 minutes; stopped waiting and asked Snowflake to cancel it.'
      }
      Start-Sleep -Seconds 2
      $r = Invoke-SnowflakeApi 'GET' ('/api/v2/statements/' + $handle) $null
    }
    if ($r.Status -ne 200) { throw ('Snowflake refused the query: ' + (Get-ApiError $r)) }

    $meta = $r.Json['resultSetMetaData']
    $handle = Get-Handle $r
    $names = @($meta['rowType'] | ForEach-Object { [string]$_['name'] })
    $expected = [long]$meta['numRows']
    if ($expected -gt $MaxRows) { throw ('The result has ' + $expected + ' rows, over the ' + $MaxRows + ' limit; nothing was downloaded. Aggregate or add a LIMIT.') }
    $partCount = 1
    if ($meta.ContainsKey('partitionInfo') -and $meta['partitionInfo']) { $partCount = @($meta['partitionInfo']).Count }

    $w = New-Object IO.StreamWriter($partPath, $false, (New-Object Text.UTF8Encoding($false)))
    $rows = 0
    $complete = $false
    $sb = New-Object Text.StringBuilder
    try {
      $w.WriteLine((@($names | ForEach-Object { ConvertTo-CsvField $_ }) -join ','))
      Write-Output ((@($names | ForEach-Object { Format-Cell $_ })) -join "`t")
      for ($p = 0; $p -lt $partCount; $p++) {
        if ($p -eq 0) { $data = $r.Json['data'] } else {
          $pr = Invoke-SnowflakeApi 'GET' ('/api/v2/statements/' + $handle + '?partition=' + $p) $null
          if ($pr.Status -ne 200) { throw ('Fetching result page ' + $p + ' failed: ' + (Get-ApiError $pr)) }
          $data = $pr.Json['data']
        }
        foreach ($row in $data) {
          [void]$sb.Clear()
          $first = $true
          foreach ($v in $row) {
            if (-not $first) { [void]$sb.Append(',') }
            $first = $false
            if ($null -ne $v) { [void]$sb.Append('"').Append(([string]$v).Replace('"', '""')).Append('"') }
          }
          $w.WriteLine($sb.ToString())
          if ($rows -lt $ShowRows) { Write-Output ((@($row | ForEach-Object { Format-Cell $_ })) -join "`t") }
          $rows++
        }
      }
      if ($rows -ne $expected) { throw ('Got ' + $rows + ' rows but Snowflake reported ' + $expected + '; the result is incomplete and was not kept.') }
      $complete = $true
    } finally {
      $w.Dispose()
      if ($complete) { Move-Item -LiteralPath $partPath -Destination $csvPath -Force }
      else { Remove-Item -LiteralPath $partPath -Force -ErrorAction SilentlyContinue }
    }
    Write-Output ''
    $shown = [Math]::Min($rows, $ShowRows)
    Write-Output ('Rows: ' + $rows + ' (showing ' + $shown + '; times in ' + $TimeZone + '). All rows: ' + $csvPath)
  } finally {
    $script:Jwt = $null
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  $priorEncoding = [Console]::OutputEncoding
  try {
    Invoke-Read
  } catch {
    [Console]::Error.WriteLine('ERROR: ' + $_.Exception.Message)
    [Console]::OutputEncoding = $priorEncoding
    exit 1
  }
  [Console]::OutputEncoding = $priorEncoding
  exit 0
}
