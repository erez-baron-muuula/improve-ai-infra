// GEN-890: build the working copy and the rollback copy of the installed config-health-scan.ps1.
const fs = require('fs');
const path = require('path');
const live = 'C:/Users/Erez/.claude/skills/config-health/config-health-scan.ps1';
const wc = path.join(__dirname, 'wc');
fs.mkdirSync(wc, { recursive: true });
const s = fs.readFileSync(live);
fs.writeFileSync(path.join(wc, 'config-health-scan.ps1'), s);
fs.writeFileSync(path.join(wc, 'rollback-config-health-scan.ps1'), s);
console.log('bytes', s.length);
