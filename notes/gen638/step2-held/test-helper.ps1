# Live test of set-claude-key.ps1's store logic against the dummy entry claude-dummy-test.
# Dummy values only -- never a real key. Prints PASS/FAIL lines, never a stored value.
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $dir 'set-claude-key.ps1')

$res = 'claude-dummy-test'
$results = @()
function Check([string]$name, [bool]$ok) { $script:results += ($(if ($ok) { 'PASS ' } else { 'FAIL ' }) + $name) }

# 1. shape validation
$bad = @('', 'short-value', 'has space in it 1234567890', 'quote"inside-1234567890abc')
foreach ($b in $bad) {
  $threw = $false
  try { Assert-KeyShape $b } catch { $threw = $true; $msg = $_.Exception.Message }
  Check ("rejects invalid value (len " + $b.Length + ")") $threw
  if ($threw) { Check 'rejection message omits the value' (-not ($b.Length -gt 0 -and $msg.Contains($b))) }
}
$okShape = $true
try { Assert-KeyShape 'ATATT3xFfGF0-dummy_value.with=allowed+chars/1234' } catch { $okShape = $false }
Check 'accepts a key-shaped dummy' $okShape

# 2. store + read back, then rotate to a second value (the step-4 case)
$v1 = 'dummyValueOne-1234567890abcdefXYZ'
$v2 = 'dummyValueTwo-0987654321zyxwvuABC'
$r1 = Save-VaultSecret $res $v1
Check ('first store returns stored/stored-after-replace (' + $r1 + ')') ($r1 -eq 'stored' -or $r1 -eq 'stored-after-replace')
$vault = New-Vault
Check 'read-back equals first value' (Test-VaultValue $vault $res $v1)
$r2 = Save-VaultSecret $res $v2
Check ('rotation store returns a success value (' + $r2 + ')') ($r2 -eq 'stored' -or $r2 -eq 'stored-after-replace')
Check 'read-back equals SECOND value after rotation' (Test-VaultValue $vault $res $v2)
Check 'first value no longer stored' (-not (Test-VaultValue $vault $res $v1))
Check 'exactly one own entry (user == resource)' (@(Get-OwnEntries $vault $res).Count -eq 1)
Check 'foreign-username entry under the same resource left untouched' (@($vault.FindAllByResource($res) | Where-Object { $_.UserName -ceq 'probe' }).Count -eq 1)
$foreignRes = 'claude-gen638-foreign-only'
$vault.Add([Windows.Security.Credentials.PasswordCredential]::new($foreignRes, 'someone-else', 'foreignDummy-1234567890abc'))
Check 'Test-VaultEntry false when only a foreign-username entry exists' (-not (Test-VaultEntry $vault $foreignRes))
foreach ($x in @($vault.FindAllByResource($foreignRes))) { $vault.Remove($x) }
Check 'foreign test entry cleaned up' (-not (@(try { $vault.FindAllByResource($foreignRes) } catch { @() }).Count -gt 0))
Check 'Test-VaultEntry true when present' (Test-VaultEntry $vault $res)
Check 'Test-VaultEntry false for a missing resource' (-not (Test-VaultEntry $vault 'claude-no-such-entry-gen638'))

$results
Write-Output ('Add behaviour on duplicate on this PC: rotation path returned "' + $r2 + '"')
