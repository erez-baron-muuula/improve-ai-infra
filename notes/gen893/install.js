// GEN-893 Part 1 install: write the approved working copy over the live size script, only if the
// live file still matches the baseline the work was built on. Prints sha256 of both after.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const LIVE = 'C:/Users/Erez/.claude/skills/config-health/config-health-scan.ps1';
const WC = path.join(__dirname, 'wc', 'config-health-scan.ps1');
const BASE = path.join(__dirname, 'wc', 'config-health-scan.live-baseline.ps1');
const h = b => crypto.createHash('sha256').update(b).digest('hex');
const live = fs.readFileSync(LIVE), base = fs.readFileSync(BASE), wc = fs.readFileSync(WC);
if (h(live) !== h(base)) { console.log('ABORT: live file changed since the baseline was taken'); process.exit(1); }
fs.writeFileSync(path.join(__dirname, 'wc', 'rollback-config-health-scan.ps1'), live);
fs.writeFileSync(LIVE, wc);
const after = fs.readFileSync(LIVE);
console.log(JSON.stringify({ installed: h(after) === h(wc), sha256: h(after), bytes: after.length }));
process.exit(h(after) === h(wc) ? 0 : 1);
