// GEN-460: write the approved sync.ps1 working copy over the live Drive script, byte for byte, but
// only if the live file still equals the baseline the working copy was built from (GEN-655).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const LIVE = 'G:/My Drive/AI Projects/_Tooling/Claude/sync.ps1';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const live = fs.readFileSync(LIVE);
const base = fs.readFileSync(path.join(__dirname, 'sync.live-baseline.ps1'));
if (sha(live) !== sha(base)) { console.error('ABORT: live sync.ps1 changed since the baseline; nothing written'); process.exit(3); }
const wc = fs.readFileSync(path.join(__dirname, 'sync.working.ps1'));
fs.writeFileSync(LIVE, wc);
const after = fs.readFileSync(LIVE);
console.log(sha(after) === sha(wc) ? 'written, bytes identical (' + after.length + ' bytes)' : 'MISMATCH after write');
