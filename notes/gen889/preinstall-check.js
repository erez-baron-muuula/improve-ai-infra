// GEN-889 install precondition: every live file this change replaces must still be byte-identical
// to the baseline the working copies were built from (notes/gen889/live-before/). Any difference
// means someone changed it since; the install must stop and the change be rebuilt from the newer
// live text, or that edit would be silently reverted. The two new notes files must not exist yet.
// Run: node preinstall-check.js   (exit 0 = safe to install, 1 = stop)
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const LIVE = 'C:/Users/Erez/.claude/hooks';
const BEFORE = path.join(__dirname, 'live-before');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
let bad = 0;
const pairs = fs.readdirSync(path.join(BEFORE, 'hooks')).map((f) => [path.join(LIVE, f), path.join(BEFORE, 'hooks', f)])
  .concat(fs.readdirSync(path.join(BEFORE, 'refs')).map((f) => [path.join(LIVE, 'refs', f), path.join(BEFORE, 'refs', f)]));
for (const [live, base] of pairs) {
  const same = fs.existsSync(live) && sha(live) === sha(base);
  if (!same) bad++;
  console.log((same ? 'same    ' : 'CHANGED ') + live);
}
for (const f of ['windows-mcp-troubleshooting.md', 'browser-sites.md']) {
  const p = path.join(LIVE, 'refs', f);
  if (fs.existsSync(p)) { bad++; console.log('EXISTS  ' + p + ' (expected new)'); } else console.log('absent  ' + p);
}
console.log(bad ? 'STOP: ' + bad + ' file(s) differ from the baseline' : 'OK: live files match the baseline');
process.exit(bad ? 1 : 0);
