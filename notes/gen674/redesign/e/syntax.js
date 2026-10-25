// Read-only syntax checks of the GEN-674 option-E working copies.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const WC = path.join(__dirname, 'wc');
for (const f of ['auto-approve.js', 'sessionstart-backup-surfacer.js', 'deny-askuserquestion.js']) {
  const r = spawnSync(process.execPath, ['--check', path.join(WC, f)], { encoding: 'utf8' });
  console.log(r.status === 0 ? 'ok  ' : 'FAIL', 'node --check', f, (r.stderr || '').trim());
}
try { JSON.parse(fs.readFileSync(path.join(WC, 'settings.json'), 'utf8')); console.log('ok   JSON.parse settings.json'); }
catch (e) { console.log('FAIL JSON.parse settings.json', e.message); }
const ps = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  '$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseFile($env:PSF,[ref]$t,[ref]$e);' +
  'if($e.Count){$e|%{ "$($_.Extent.StartLineNumber): $($_.Message)" }}else{"none"}'],
  { encoding: 'utf8', env: Object.assign({}, process.env, { PSF: path.join(WC, 'update-config.ps1') }) });
console.log('PowerShell parse errors in update-config.ps1:', (ps.stdout || '').trim(), (ps.stderr || '').trim());
const b = fs.readFileSync(path.join(WC, 'update-config.ps1'));
let non = 0; for (const c of b) if (c > 127) non++;
console.log('update-config.ps1 non-ASCII bytes:', non, 'NUL bytes:', b.filter(c => c === 0).length);
for (const f of ['auto-approve.js', 'sessionstart-backup-surfacer.js', 'deny-askuserquestion.js', 'settings.json']) {
  const s = fs.readFileSync(path.join(WC, f), 'utf8');
  console.log(f, 'NUL:', (s.match(/\x00/g) || []).length, 'FEFF:', s.split(String.fromCharCode(0xfeff)).length - 1);
}
