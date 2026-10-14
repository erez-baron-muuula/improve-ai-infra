$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Web.Extensions
$ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$ser.MaxJsonLength = [int]::MaxValue
$root = 'G:\My Drive\AI Projects\_Tooling\Claude Session Backup'
$n = 0; $bad = @(); $lenMismatch = @()
foreach ($sub in 'claude-code-sessions', 'projects') {
  foreach ($f in ([IO.DirectoryInfo]('\\?\' + (Join-Path $root $sub))).EnumerateFiles('*.json', [IO.SearchOption]::AllDirectories)) {
    $n++
    $bytes = [IO.File]::ReadAllBytes($f.FullName)
    if ($bytes.Length -ne $f.Length) { $lenMismatch += ($f.FullName.Substring(4) + " listing=" + $f.Length + " read=" + $bytes.Length) }
    try { [void]$ser.DeserializeObject([Text.Encoding]::UTF8.GetString($bytes)) } catch { $bad += $f.FullName.Substring(4) }
  }
}
"json files in real backup: $n ; invalid JSON: " + $bad.Count + " ; read length differs from listing: " + $lenMismatch.Count
$bad | Select-Object -First 10
$lenMismatch | Select-Object -First 10
