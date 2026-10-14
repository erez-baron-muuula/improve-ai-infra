param([string]$Mode = 'swap', [int]$WaitSeconds = 8, [switch]$SetMtime)
# Reproduces the suite's title case: a file on G: is replaced by SHORTER content (by a separate
# process, the way session-backup.ps1 does it), then a third process reads it repeatedly.
$ErrorActionPreference = 'Stop'
$P = '\\?\'
$root = 'G:\My Drive\AI Projects\_Tooling\Claude Session Backup\_vet-test\shrinkprobe-' + $Mode + '-' + [guid]::NewGuid().ToString('N').Substring(0, 6)
[IO.Directory]::CreateDirectory($P + $root) | Out-Null
$f = Join-Path $root 'custom-title.json'
[IO.File]::WriteAllText($P + $f, '{"title":"a long original title"}')
Start-Sleep -Seconds $WaitSeconds
$writer = @'
param([string]$f, [string]$mode, [string]$setm)
$P = '\\?\'
$new = '{"title":"a long title"}'
$src = Join-Path $env:TEMP ('shrinksrc-' + [guid]::NewGuid().ToString('N') + '.json'); [IO.File]::WriteAllText($src, $new)
$mt = [IO.File]::GetLastWriteTimeUtc($src)
if ($env:PROBE_READ_OLD -eq '1') { [void][IO.File]::ReadAllBytes($P + $f) }   # like Save-PreviousVersion copying the old backup copy first
if ($mode -eq 'swap') {
  $tmp = $P + $f + '.sbtmp'
  $in = New-Object IO.FileStream($src, 'Open', 'Read', 'ReadWrite'); $out = New-Object IO.FileStream($tmp, 'CreateNew', 'Write', 'None'); $in.CopyTo($out); $out.Flush($true); $out.Dispose(); $in.Dispose()
  if ($setm -eq '1') { [IO.File]::SetLastWriteTimeUtc($tmp, $mt) }
  [IO.File]::Move($P + $f, $P + $f + '.sbold'); [IO.File]::Move($tmp, $P + $f); [IO.File]::Delete($P + $f + '.sbold')
} else {
  [IO.File]::WriteAllText($P + $f, $new)
  if ($setm -eq '1') { [IO.File]::SetLastWriteTimeUtc($P + $f, $mt) }
}
'@
$wf = Join-Path $env:TEMP ('shrink-writer-' + [guid]::NewGuid().ToString('N') + '.ps1'); [IO.File]::WriteAllText($wf, $writer)
$sm = '0'; if ($SetMtime) { $sm = '1' }
& powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File $wf -f $f -mode $Mode -setm $sm
$reader = @'
param([string]$f)
$P = '\\?\'
$want = '{"title":"a long title"}'
$t0 = Get-Date; $log = @(); $prev = $null
while (((Get-Date) - $t0).TotalSeconds -lt 60) {
  $c = [IO.File]::ReadAllText($P + $f); $len = (New-Object IO.FileInfo($P + $f)).Length
  $state = if ($c -eq $want) { 'OK' } else { 'BAD[' + $c + ']' }
  if ($state -ne $prev) { $log += ('{0,6}ms len={1} {2}' -f [int]((Get-Date) - $t0).TotalMilliseconds, $len, $state); $prev = $state }
  Start-Sleep -Milliseconds 250
}
$log
'@
$rf = Join-Path $env:TEMP ('shrink-reader-' + [guid]::NewGuid().ToString('N') + '.ps1'); [IO.File]::WriteAllText($rf, $reader)
"mode=$Mode wait=$WaitSeconds setMtime=$SetMtime"
& powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File $rf -f $f
