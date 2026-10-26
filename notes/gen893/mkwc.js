// Make the GEN-893 working copy of config-health-scan.ps1 (read-then-write, byte-exact) and report its BOM/EOL.
const fs = require('fs');
const path = require('path');
const live = 'C:/Users/Erez/.claude/skills/config-health/config-health-scan.ps1';
const outDir = path.join(__dirname, 'wc');
fs.mkdirSync(outDir, { recursive: true });
const b = fs.readFileSync(live);
fs.writeFileSync(path.join(outDir, 'config-health-scan.ps1'), b);
fs.writeFileSync(path.join(outDir, 'config-health-scan.live-baseline.ps1'), b);
const s = b.toString('utf8');
console.log(JSON.stringify({ bytes: b.length, bom: b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf, crlf: (s.match(/\r\n/g) || []).length, lf: (s.match(/\n/g) || []).length, nonAscii: [...s].filter(c => c.charCodeAt(0) > 127).length }));
