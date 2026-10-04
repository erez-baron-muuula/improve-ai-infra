#!/usr/bin/env pwsh
# key-leak-tripwire.ps1 -- GEN-638 step 3: the end-of-session key-leak tripwire.
#
# Checks whether the VALUE of any key Claude reads from this PC's own store appears in a
# Claude session log on this PC written since the last completed check. The keys are the
# set-claude-key.ps1 inventory (Windows Credential Manager) plus Git's stored GitHub login.
# The logs are every file under ~/.claude/projects and the desktop app's
# %APPDATA%\Claude\local-agent-mode-sessions. Run by /wrap ("Step 0b -- Key check") from
# the PowerShell tool, alone:
#   & "C:\Users\Erez\.claude\scripts\key-leak-tripwire.ps1"
#   & "C:\Users\Erez\.claude\scripts\key-leak-tripwire.ps1" -All    # every log, ignoring the last check
#
# SAFETY (GEN-638 plan step 3; enforced by /vet-code). Keep every rule when editing:
#  - Matching is plain in-memory text matching: String.IndexOf(value, Ordinal). No regex,
#    -match/-like/Select-String, outside search tool, or anything derived from a value.
#  - A value never leaves this process. It is never printed or written, never put in an
#    argument, an environment variable or another program's input, and never passed as a
#    PowerShell command parameter (module logging records parameter values): values live only
#    in the $secrets dictionary and are matched with .NET method calls. The only child
#    processes are cmd.exe -> git ("credential fill", whose input file holds only
#    protocol=https and host=github.com), cmdkey.exe ("/list", names only) and, on a git
#    time-out, taskkill.exe.
#  - Output is an ALLOWLIST: key names, file paths, dates, counts and fixed reason codes.
#    No exception message is ever printed or stored.
#  - Never open a file this reports as "found" to look at it: that copies the key into the
#    session that opens it. Investigate with counts/positions only.
#
# Output: one JSON object on stdout; the same object is appended to the state file.
# Exit: 0 = complete, nothing found; 2 = at least one key found (even if something else also
# failed); 1 = could not complete (a stored key, a folder or a file could not be read, the
# key list is missing, or the state file could not be read or written).
# State: ~/.claude/hooks/key-tripwire-scans.jsonl, one line per run, per PC (sync.ps1 never
# syncs *.jsonl). A run covers files last written at or after (start of the last-appended run
# that had no problems AND found nothing) minus 5 minutes. It covers every file instead with
# -All, when there is no such run, when that run's start is in the future (the clock was
# wrong), or when a key name is checked that that run did not check (a key stored since).
# Because a run that found a key never becomes that mark, a found key is reported again at
# every run until it is replaced. A REPLACED value under the same name is checked only against
# logs written since the mark: run with -All once after replacing a key to check the new value
# against every log.
#
# The key list is read from set-claude-key.ps1, dot-sourced inside its own script block so its
# names stay out of this script's scopes. That file must stay safe to dot-source.
#
# Dot-sourcing THIS file only defines the functions -- used by the tests.
# Keep this file ASCII-only: PS 5.1 reads a BOM-less script as Windows-1252.

param([switch]$All)

Set-PSDebug -Off
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$script:TripwireMinLength = 20      # shorter stored values are not checked (they would false-fire)
$script:TripwireSlackMinutes = 5    # overlap with the previous run, for clock and write timing
$script:TripwireMaxFilesListed = 20 # per found key; the rest are counted, not listed
$script:TripwireGitTimeoutMs = 20000

function Get-TripwireDefaults {
  $projects = Join-Path $env:USERPROFILE '.claude\projects'
  $roots = New-Object 'System.Collections.Generic.List[string]'
  $roots.Add($projects)
  if (-not [string]::IsNullOrEmpty($env:APPDATA)) {
    $roots.Add((Join-Path $env:APPDATA 'Claude\local-agent-mode-sessions'))
  }
  return @{
    HelperPath    = (Join-Path $env:USERPROFILE '.claude\scripts\set-claude-key.ps1')
    Roots         = $roots.ToArray()
    RequiredRoots = @($projects)
    StatePath     = (Join-Path $env:USERPROFILE '.claude\hooks\key-tripwire-scans.jsonl')
  }
}

# The .NET exception underneath PowerShell's MethodInvocationException wrapper.
function Get-TripwireRootException([Exception]$Ex) {
  while ($null -ne $Ex -and $Ex -is [System.Management.Automation.MethodInvocationException] -and $null -ne $Ex.InnerException) {
    $Ex = $Ex.InnerException
  }
  return $Ex
}

function Format-TripwireUtc([datetime]$When) {
  return $When.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ', [Globalization.CultureInfo]::InvariantCulture)
}

# The helper's key list as an ordered name -> Credential Manager resource map, or $null when
# the helper is missing or yields no list. The helper is dot-sourced inside its own script
# block, so its variables (its -Key/-List parameters, $KeyTargets) and functions stay in that
# block's scope: PowerShell names are case-insensitive, so sharing a scope with them would
# silently retype a same-named local.
function Get-TripwireInventory([string]$HelperPath) {
  if ([string]::IsNullOrEmpty($HelperPath) -or -not (Test-Path -LiteralPath $HelperPath -PathType Leaf)) { return $null }
  $targets = $null
  try {
    $targets = & { param($HelperFile) . $HelperFile; ,$KeyTargets } $HelperPath
  } catch {
    return $null
  }
  if ($null -eq $targets -or $targets.Count -eq 0) { return $null }
  $inventoryMap = [ordered]@{}
  foreach ($keyName in @($targets.Keys)) { $inventoryMap[[string]$keyName] = [string]$targets[$keyName] }
  return $inventoryMap
}

function New-TripwireVault {
  return [Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]::new()
}

# Reads the Credential Manager entry whose resource AND user name are $Resource (the shape
# set-claude-key.ps1 stores) into $Into[$Name]. Returns 'ok', 'not-stored' or 'error'.
function Read-TripwireVaultKey($Vault, [string]$Resource, [string]$Name, $Into) {
  $own = @()
  try {
    $own = @($Vault.FindAllByResource($Resource) | Where-Object { $_.UserName -ceq $Resource })
  } catch {
    # FindAllByResource throws "Element not found" (HRESULT 0x80070490) when there is no
    # entry; anything else means the store could not be read, which must not pass as absent.
    $inner = Get-TripwireRootException $_.Exception
    if ($null -ne $inner -and $inner.HResult -eq -2147023728) { return 'not-stored' }
    return 'error'
  }
  if ($own.Count -eq 0) { return 'not-stored' }
  $cred = $null
  try {
    $cred = $Vault.Retrieve($Resource, $Resource)
    $cred.RetrievePassword()
    $Into[$Name] = $cred.Password
    return 'ok'
  } catch {
    return 'error'
  } finally {
    $cred = $null
  }
}

# 'yes' / 'no' / 'error': does cmdkey list a Windows credential for Git's login to $GitHost?
# Names only -- cmdkey never shows a password.
function Test-TripwireGitCredentialName([string]$GitHost) {
  $lines = @()
  try {
    $lines = @(& cmdkey.exe /list 2>$null)
    if ($LASTEXITCODE -ne 0) { return 'error' }
  } catch {
    return 'error'
  }
  $exact = 'git:https://' + $GitHost
  foreach ($line in $lines) {
    $text = [string]$line
    $at = $text.IndexOf('target=git:https://', [StringComparison]::OrdinalIgnoreCase)
    if ($at -lt 0) { continue }
    $target = $text.Substring($at + 'target='.Length).Trim()
    if ($target.Equals($exact, [StringComparison]::OrdinalIgnoreCase)) { return 'yes' }
    if ($target.EndsWith('@' + $GitHost, [StringComparison]::OrdinalIgnoreCase)) { return 'yes' }
  }
  return 'no'
}

# Asks Git for its stored login to $GitHost with every sign-in prompt off, and puts the
# password into $Into[$Name]. Returns 'ok', 'not-stored' or 'error'.
# Git's input comes from a temp file through cmd.exe's byte-exact '<' redirect. Not a
# PowerShell pipe, and not .NET's Process.StandardInput: both encode through this host's
# console input encoding, which here is UTF-8 WITH a byte-order mark, and git then rejects
# the request (hooks/refs/shell.md). The temp file holds only "protocol=https" and
# "host=<GitHost>"; git's answer is read from its output pipe, in this process only.
function Read-TripwireGitKey([string]$GitHost, [string]$Name, $Into, [int]$TimeoutMs = $script:TripwireGitTimeoutMs) {
  $git = $null
  try {
    $git = (Get-Command git.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  } catch {
    $git = $null
  }
  $unsafe = [char[]]'"%^&|<>!'
  $inFile = Join-Path ([IO.Path]::GetTempPath()) ('key-tripwire-git-' + [guid]::NewGuid().ToString('N') + '.txt')
  if (-not [string]::IsNullOrEmpty($git) -and $git.IndexOfAny($unsafe) -lt 0 -and $inFile.IndexOfAny($unsafe) -lt 0 -and $GitHost.IndexOfAny($unsafe) -lt 0) {
    $proc = $null
    $answer = $null
    $value = $null
    try {
      [IO.File]::WriteAllBytes($inFile, [Text.Encoding]::ASCII.GetBytes("protocol=https`nhost=" + $GitHost + "`n`n"))
      $psi = New-Object System.Diagnostics.ProcessStartInfo
      $psi.FileName = (Join-Path $env:SystemRoot 'System32\cmd.exe')
      # Tracing is also switched off through git's own config, which a config file could turn on.
      $psi.Arguments = '/d /s /c ""' + $git + '" -c core.askPass= -c credential.interactive=false -c credential.trace=false -c credential.traceSecrets=false -c trace2.normalTarget=false -c trace2.perfTarget=false -c trace2.eventTarget=false credential fill <"' + $inFile + '""'
      # Run outside any repository, so no repository's own config applies.
      $psi.WorkingDirectory = [IO.Path]::GetTempPath()
      $psi.UseShellExecute = $false
      $psi.CreateNoWindow = $true
      $psi.RedirectStandardOutput = $true
      $psi.RedirectStandardError = $true
      # No sign-in helper, and no tracing: a GIT_TRACE*/GCM_TRACE* setting in the user's
      # environment could write the credential exchange to a trace file.
      foreach ($var in @($psi.EnvironmentVariables.Keys)) {
        $upper = ([string]$var).ToUpperInvariant()
        if ($upper -eq 'GIT_ASKPASS' -or $upper -eq 'SSH_ASKPASS' -or $upper -eq 'DISPLAY' -or $upper -eq 'GIT_CURL_VERBOSE' -or
            $upper.StartsWith('GIT_TRACE', [StringComparison]::Ordinal) -or $upper.StartsWith('GCM_TRACE', [StringComparison]::Ordinal)) {
          $psi.EnvironmentVariables.Remove([string]$var)
        }
      }
      $psi.EnvironmentVariables['GCM_INTERACTIVE'] = 'never'
      $psi.EnvironmentVariables['GCM_GUI_PROMPT'] = 'false'
      $psi.EnvironmentVariables['GIT_TERMINAL_PROMPT'] = '0'
      $proc = [Diagnostics.Process]::Start($psi)
      $outTask = $proc.StandardOutput.ReadToEndAsync()
      $errTask = $proc.StandardError.ReadToEndAsync()
      if (-not $proc.WaitForExit($TimeoutMs)) {
        try { & taskkill.exe /T /F /PID $proc.Id 2>$null | Out-Null } catch { }
        return 'error'
      }
      $proc.WaitForExit()
      [void]$outTask.Wait(5000)
      [void]$errTask.Wait(5000)
      if ($proc.ExitCode -eq 0 -and $outTask.IsCompleted) {
        $answer = $outTask.Result
        foreach ($line in $answer.Split("`n")) {
          if ($line.StartsWith('password=', [StringComparison]::Ordinal)) {
            $value = $line.Substring('password='.Length).TrimEnd("`r")
            break
          }
        }
      }
      if (-not [string]::IsNullOrEmpty($value)) {
        $Into[$Name] = $value
        return 'ok'
      }
    } catch {
      # fall through: classify by whether a stored login exists
    } finally {
      $answer = $null
      $value = $null
      if ($null -ne $proc) { try { $proc.Dispose() } catch { } }
      try { [IO.File]::Delete($inFile) } catch { }
    }
  }
  # No password from git: a stored login we could not read is an error; no login is not-stored.
  $exists = Test-TripwireGitCredentialName $GitHost
  if ($exists -eq 'no') { return 'not-stored' }
  return 'error'
}

# Opens a file with read/write/delete sharing (so a log another session is still writing can
# be read) as UTF-8 unless it starts with a byte-order mark. Returns the text, or $null when the
# file vanished between listing and reading. Throws on any other failure.
function Read-TripwireFileText([string]$Path) {
  try {
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
  } catch {
    $inner = Get-TripwireRootException $_.Exception
    # "Not found" means vanished only if the file really is gone now; otherwise it is a failure.
    if (($inner -is [IO.FileNotFoundException] -or $inner -is [IO.DirectoryNotFoundException]) -and -not (Test-Path -LiteralPath $Path)) { return $null }
    throw
  }
  try {
    $reader = New-Object IO.StreamReader($stream, (New-Object Text.UTF8Encoding($false)), $true)
    try {
      return $reader.ReadToEnd()
    } finally {
      $reader.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

# The files under $Roots last written at or after $SinceUtc (all when $SinceUtc is $null).
# A folder that cannot be listed is added to $Problems. A missing root is skipped -- unless it
# is in $Required (the Claude Code log folder, which always exists where Claude runs), when it
# is a 'root-missing' problem: logs that could not be seen must never pass as clean.
function Get-TripwireFiles([string[]]$Roots, $SinceUtc, $Problems, [string[]]$Required = @()) {
  $files = New-Object 'System.Collections.Generic.List[System.IO.FileInfo]'
  foreach ($root in $Roots) {
    if ([string]::IsNullOrEmpty($root)) { continue }
    if (-not (Test-Path -LiteralPath $root -PathType Container)) {
      if ($Required -contains $root) { $Problems.Add([ordered]@{ code = 'root-missing'; path = $root }) }
      continue
    }
    $listErrors = $null
    $listed = @(Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction SilentlyContinue -ErrorVariable listErrors)
    foreach ($err in @($listErrors)) {
      $inner = Get-TripwireRootException $err.Exception
      $where = [string]$err.TargetObject
      $vanished = ($inner -is [System.Management.Automation.ItemNotFoundException] -or $inner -is [IO.DirectoryNotFoundException] -or $inner -is [IO.FileNotFoundException])
      # "Not found" is skipped only if the item really is gone now (an error naming no item is a problem).
      if ($vanished -and -not [string]::IsNullOrEmpty($where) -and -not (Test-Path -LiteralPath $where)) { continue }
      $Problems.Add([ordered]@{ code = 'folder-unreadable'; path = $where })
    }
    foreach ($file in $listed) {
      if ($null -ne $SinceUtc -and $file.LastWriteTimeUtc -lt $SinceUtc) {
        # A directory listing can show a stale time for a file another process still holds
        # open; re-read the file's own record before skipping it.
        try { $file.Refresh() } catch { }
      }
      if ($null -eq $SinceUtc -or $file.LastWriteTimeUtc -ge $SinceUtc) { $files.Add($file) }
    }
  }
  return ,$files
}

# The last run APPENDED to the state file that had no problems and found nothing:
# @{ ok; last; checked } -- last is its start (UTC) or $null when there is none, checked the key
# names whose values it compared. ok is $false when the state file exists but cannot be read.
#  - Append order, not the highest start time: a start recorded while the clock was wrong must
#    not stay the mark after the clock is fixed. (Two overlapping runs: whichever is appended
#    last, it read every file written up to its own start, so its start minus 5 minutes leaves
#    no gap. Limit: a clock that was wrong by more than 5 minutes and was corrected before the
#    next run can leave files with times older than the mark; -All re-checks everything.)
#  - A run that found a key is never the mark, so later runs keep re-covering the file that
#    holds it and keep reporting it until the key is replaced (the new value no longer matches).
function Get-TripwireLastCompleteStart([string]$StatePath) {
  if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) { return @{ ok = $true; last = $null; checked = @() } }
  $text = $null
  try {
    $text = Read-TripwireFileText $StatePath
  } catch {
    return @{ ok = $false; last = $null; checked = @() }
  }
  if ($null -eq $text) { return @{ ok = $true; last = $null; checked = @() } }
  $last = $null
  $lastChecked = @()
  foreach ($line in $text.Split("`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $rec = $null
    try { $rec = ConvertFrom-Json -InputObject $line } catch { continue }
    if ($null -eq $rec -or $rec.tool -ne 'key-leak-tripwire' -or $rec.complete -ne $true) { continue }
    if (@($rec.checks | Where-Object { $null -ne $_ -and $_.status -eq 'found' }).Count -gt 0) { continue }
    $when = $null
    if ($rec.startedUtc -is [datetime]) {
      $when = $rec.startedUtc.ToUniversalTime()
    } else {
      $parsed = [datetime]::MinValue
      $styles = [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal
      if ([datetime]::TryParseExact([string]$rec.startedUtc, 'yyyy-MM-ddTHH:mm:ssZ', [Globalization.CultureInfo]::InvariantCulture, $styles, [ref]$parsed)) {
        $when = $parsed
      }
    }
    if ($null -ne $when) {
      $last = $when
      $lastChecked = @($rec.checkedKeys | Where-Object { $_ -is [string] })
    }
  }
  return @{ ok = $true; last = $last; checked = $lastChecked }
}

# Appends one line to the state file, retrying briefly if another run holds it. $true on success.
function Add-TripwireStateLine([string]$StatePath, [string]$Json) {
  $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($Json + "`n")
  for ($attempt = 1; $attempt -le 5; $attempt++) {
    try {
      $dir = Split-Path -Parent $StatePath
      if (-not (Test-Path -LiteralPath $dir -PathType Container)) { [void](New-Item -ItemType Directory -Path $dir -Force) }
      $stream = [IO.File]::Open($StatePath, [IO.FileMode]::Append, [IO.FileAccess]::Write, [IO.FileShare]::Read)
      try {
        $stream.Write($bytes, 0, $bytes.Length)
      } finally {
        $stream.Dispose()
      }
      return $true
    } catch {
      Start-Sleep -Milliseconds (150 * $attempt)
    }
  }
  return $false
}

# Runs one check. $Inventory is the ordered name -> resource map ($null = the key list is
# missing). $RequiredRoots are roots that must exist. $GitHost '' skips the GitHub check
# (tests). Returns the result object; never throws.
function Invoke-KeyTripwire {
  param(
    $Inventory,
    [string[]]$Roots,
    [string[]]$RequiredRoots = @(),
    [string]$StatePath,
    [switch]$All,
    [string]$GitHost = 'github.com',
    $Vault = $null
  )
  $startedUtc = [DateTime]::UtcNow
  $problems = New-Object 'System.Collections.Generic.List[object]'
  $order = New-Object 'System.Collections.Generic.List[string]'
  $status = @{}
  $hits = @{}
  $secrets = New-Object 'System.Collections.Generic.Dictionary[string,string]'
  $checkedNames = @()
  $mode = 'all'
  $since = $null
  $scanned = 0
  $scanDone = $false
  try {
    # 1. Keys.
    if ($null -eq $Inventory) {
      $problems.Add([ordered]@{ code = 'inventory-missing' })
    } else {
      if ($null -eq $Vault) {
        try { $Vault = New-TripwireVault } catch { $Vault = $null }
      }
      foreach ($keyName in @($Inventory.Keys)) {
        $order.Add([string]$keyName)
        $got = 'error'
        if ($null -ne $Vault) { $got = Read-TripwireVaultKey $Vault ([string]$Inventory[$keyName]) ([string]$keyName) $secrets }
        if ($got -eq 'ok') { $status[[string]$keyName] = 'pending' }
        elseif ($got -eq 'not-stored') { $status[[string]$keyName] = 'not-stored' }
        else {
          $status[[string]$keyName] = 'could-not-check'
          $problems.Add([ordered]@{ code = 'vault-read-failed'; key = [string]$keyName })
        }
      }
    }
    if (-not [string]::IsNullOrEmpty($GitHost)) {
      # Named 'github' unless the key list already uses that name.
      $gitName = 'github'
      if ($order.Contains($gitName)) { $gitName = 'github-login' }
      $order.Add($gitName)
      $got = Read-TripwireGitKey $GitHost $gitName $secrets
      if ($got -eq 'ok') { $status[$gitName] = 'pending' }
      elseif ($got -eq 'not-stored') { $status[$gitName] = 'not-stored' }
      else {
        $status[$gitName] = 'could-not-check'
        $problems.Add([ordered]@{ code = 'github-read-failed'; key = $gitName })
      }
    }
    foreach ($keyName in @($secrets.Keys)) {
      if ($secrets[$keyName].Length -lt $script:TripwireMinLength) {
        $status[$keyName] = 'too-short'
        $secrets[$keyName] = $null
        [void]$secrets.Remove($keyName)
      } else {
        $hits[$keyName] = New-Object 'System.Collections.Generic.List[System.IO.FileInfo]'
      }
    }
    $checkedNames = @($secrets.Keys | Sort-Object)

    # 2. Which files: those written since the last complete run -- unless there is none, -All
    # was asked, the mark is in the future (the clock was wrong when it was written), or a key
    # is being checked that the last complete run did not check (stored since): then all.
    if (-not $All) {
      $state = Get-TripwireLastCompleteStart $StatePath
      if (-not $state.ok) {
        $problems.Add([ordered]@{ code = 'state-unreadable' })
      } elseif ($null -eq $state.last) {
        $mode = 'first-run'
      } elseif ($state.last -gt $startedUtc.AddMinutes(1)) {
        $mode = 'clock-reset'
      } elseif (@($checkedNames | Where-Object { @($state.checked) -notcontains $_ }).Count -gt 0) {
        $mode = 'new-key'
      } else {
        $mode = 'since'
        $since = $state.last.AddMinutes(-$script:TripwireSlackMinutes)
      }
    }

    # 3. Look for each value in each file.
    if ($secrets.Count -gt 0) {
      $files = Get-TripwireFiles $Roots $since $problems $RequiredRoots
      foreach ($file in $files) {
        $text = $null
        try {
          $text = Read-TripwireFileText $file.FullName
        } catch {
          $problems.Add([ordered]@{ code = 'file-unreadable'; path = $file.FullName })
          continue
        }
        if ($null -eq $text) { continue }
        $scanned++
        foreach ($keyName in @($secrets.Keys)) {
          if ($text.IndexOf($secrets[$keyName], [StringComparison]::Ordinal) -ge 0) { $hits[$keyName].Add($file) }
        }
        $text = $null
      }
    }
    $scanDone = $true
  } catch {
    $problems.Add([ordered]@{ code = 'internal-error' })
  } finally {
    foreach ($keyName in @($secrets.Keys)) { $secrets[$keyName] = $null }
    $secrets.Clear()
  }

  # 4. Report (names, paths, dates and counts only).
  $checks = New-Object 'System.Collections.Generic.List[object]'
  foreach ($keyName in $order) {
    $entry = [ordered]@{ key = $keyName }
    $found = $hits[$keyName]
    if ($null -ne $found -and $found.Count -gt 0) {
      $entry['status'] = 'found'
      $listedFiles = New-Object 'System.Collections.Generic.List[object]'
      foreach ($file in ($found | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First $script:TripwireMaxFilesListed)) {
        $listedFiles.Add([ordered]@{ path = $file.FullName; lastWriteUtc = (Format-TripwireUtc $file.LastWriteTimeUtc) })
      }
      $entry['files'] = $listedFiles
      $entry['moreFiles'] = [Math]::Max(0, $found.Count - $script:TripwireMaxFilesListed)
    } elseif ($status[$keyName] -eq 'pending') {
      # Read, but if the scan stopped early (an internal error) it reached no verdict -- not 'clean'.
      if ($scanDone) { $entry['status'] = 'clean' } else { $entry['status'] = 'could-not-check' }
    } else {
      $entry['status'] = $status[$keyName]
    }
    $checks.Add($entry)
  }
  $sinceText = $null
  if ($null -ne $since) { $sinceText = Format-TripwireUtc $since }
  return [ordered]@{
    tool         = 'key-leak-tripwire'
    version      = 1
    startedUtc   = (Format-TripwireUtc $startedUtc)
    finishedUtc  = (Format-TripwireUtc ([DateTime]::UtcNow))
    mode         = $mode
    sinceUtc     = $sinceText
    filesScanned = $scanned
    checkedKeys  = $checkedNames
    complete     = ($problems.Count -eq 0)
    checks       = $checks
    problems     = $problems
  }
}

function Get-TripwireExitCode($Result) {
  foreach ($entry in $Result['checks']) { if ($entry['status'] -eq 'found') { return 2 } }
  if ($Result['complete'] -ne $true) { return 1 }
  return 0
}

if ($MyInvocation.InvocationName -ne '.') {
  $exitCode = 1
  try {
    $defaults = Get-TripwireDefaults
    $inventory = Get-TripwireInventory $defaults.HelperPath
    $result = Invoke-KeyTripwire -Inventory $inventory -Roots $defaults.Roots -RequiredRoots $defaults.RequiredRoots -StatePath $defaults.StatePath -All:$All
    $json = ConvertTo-Json -InputObject $result -Depth 6 -Compress
    if (-not (Add-TripwireStateLine $defaults.StatePath $json)) {
      $result['problems'].Add([ordered]@{ code = 'state-write-failed' })
      $result['complete'] = $false
      $json = ConvertTo-Json -InputObject $result -Depth 6 -Compress
    }
    Write-Output $json
    $exitCode = Get-TripwireExitCode $result
  } catch {
    Write-Output '{"tool":"key-leak-tripwire","version":1,"complete":false,"checks":[],"problems":[{"code":"internal-error"}]}'
    $exitCode = 1
  }
  exit $exitCode
}
