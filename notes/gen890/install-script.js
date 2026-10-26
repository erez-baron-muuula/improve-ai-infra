// GEN-890: install the vetted checker script (byte copy by read/write) and the seed state file; verify hashes.
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const h = b => crypto.createHash('sha256').update(b).digest('hex');
const wc = path.join(__dirname, 'wc', 'config-health-scan.ps1');
const live = 'C:/Users/Erez/.claude/skills/config-health/config-health-scan.ps1';
const src = fs.readFileSync(wc);
fs.writeFileSync(live, src);
console.log('script', h(fs.readFileSync(live)) === h(src) ? 'installed, hash matches' : 'HASH MISMATCH', src.length + ' bytes');
const state = 'C:/Users/Erez/.claude/.size-sweep-state.json';
if (fs.existsSync(state)) { console.log('state file already exists; left as is'); }
else { fs.writeFileSync(state, fs.readFileSync(path.join(__dirname, 'seed-state.json'))); console.log('state file seeded'); }
