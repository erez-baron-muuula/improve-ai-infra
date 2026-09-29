# Unit test of set-claude-key.ps1's replace branches with a FAKE vault (no Credential Manager
# writes). Covers the paths a PC where PasswordVault.Add overwrites never reaches.
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $dir 'set-claude-key.ps1')

$script:results = @()
function Check([string]$name, [bool]$ok) { $script:results += ($(if ($ok) { 'PASS ' } else { 'FAIL ' }) + $name) }

# mode: 'overwrite' (normal), 'addThrows' (every Add throws), 'firstAddNoop' (first Add silently
# keeps the old value), 'neverMatch' (Add stores something else)
function New-FakeVault([string]$Mode, [hashtable]$Seed) {
  $o = [pscustomobject]@{ Mode = $Mode; Store = $Seed; AddCalls = 0 }
  $o | Add-Member ScriptMethod Add {
    param($cred)
    $this.AddCalls++
    $k = $cred.Resource + '|' + $cred.UserName
    switch ($this.Mode) {
      'addThrows'    { throw 'fake: add refused' }
      'firstAddNoop' { if ($this.AddCalls -eq 1 -and $this.Store.ContainsKey($k)) { return }; $this.Store[$k] = $cred.Password }
      'neverMatch'   { $this.Store[$k] = 'something-else-entirely-000' }
      default        { $this.Store[$k] = $cred.Password }
    }
  }
  $o | Add-Member ScriptMethod Remove { param($c) [void]$this.Store.Remove($c.Resource + '|' + $c.UserName) }
  $o | Add-Member ScriptMethod FindAllByResource {
    param($r)
    $hits = @($this.Store.Keys | Where-Object { $_.Split('|')[0] -ceq $r } | ForEach-Object { [pscustomobject]@{ Resource = $_.Split('|')[0]; UserName = $_.Split('|')[1] } })
    if ($hits.Count -eq 0) { throw 'fake: element not found' }
    return $hits
  }
  $o | Add-Member ScriptMethod Retrieve {
    param($r, $u)
    $k = $r + '|' + $u
    if (-not $this.Store.ContainsKey($k)) { throw 'fake: element not found' }
    $c = [pscustomobject]@{ Password = $this.Store[$k] }
    $c | Add-Member ScriptMethod RetrievePassword { }
    return $c
  }
  return $o
}

$R = 'claude-fake-key'
$NEW = 'newValue-1234567890abcdefghij'
function Run([string]$mode, [hashtable]$seed) {
  $script:fake = New-FakeVault $mode $seed
  function script:New-Vault { return $script:fake }
  try { return @{ ok = $true; out = (Save-VaultSecret $R $NEW) } } catch { return @{ ok = $false; out = $_.Exception.Message } }
}

$a = Run 'addThrows' @{ ($R + '|' + $R) = 'oldValue-aaaaaaaaaaaaaaaaaaaa' }
Check 'Add refused + own entry existed -> throws "old ... removed ... NOT stored"' ((-not $a.ok) -and $a.out -match 'old .* removed and the new key was NOT stored')
Check '  ...and the message omits the new value' (-not $a.out.Contains($NEW))

$b = Run 'addThrows' @{}
Check 'Add refused + no entry -> throws "refused ... Nothing was changed"' ((-not $b.ok) -and $b.out -match 'refused to store .* Nothing was changed')

$c = Run 'firstAddNoop' @{ ($R + '|' + $R) = 'oldValue-bbbbbbbbbbbbbbbbbbbb' }
Check 'first Add silently kept old value -> replaced -> stored-after-replace' ($c.ok -and $c.out -eq 'stored-after-replace')
Check '  ...and the store now holds the new value' ($script:fake.Store[$R + '|' + $R] -ceq $NEW)

$d = Run 'neverMatch' @{}
Check 'read-back never matches -> throws "no match"' ((-not $d.ok) -and $d.out -match 'no match')

$e = Run 'firstAddNoop' @{ ($R + '|' + $R) = 'oldValue-cccccccccccccccccccc'; ($R + '|probe') = 'foreign-dddddddddddddddddddd' }
Check 'replace removes only the own entry, not a foreign-username entry' ($e.ok -and $script:fake.Store.ContainsKey($R + '|probe'))

$f = Run 'overwrite' @{}
Check 'normal Add -> stored' ($f.ok -and $f.out -eq 'stored')

$script:results
