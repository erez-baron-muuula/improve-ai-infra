// GEN-889 install step 1: writes the four split notes files from notes/gen889/wc/refs/ into
// ~/.claude/hooks/refs/ byte-for-byte -- the two NEW part-2 files first, then the two part-1 files
// (so a new injector never meets a missing part 2) -- and verifies each by SHA-256. Rollback
// copies of the two replaced files are in notes/gen889/live-before/refs/.
// Run: node install-notes.js
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, 'wc', 'refs');
const DST = 'C:/Users/Erez/.claude/hooks/refs';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
let bad = 0;
for (const f of ['windows-mcp-troubleshooting.md', 'browser-sites.md', 'windows-mcp.md', 'browser.md']) {
  const buf = fs.readFileSync(path.join(SRC, f));
  fs.writeFileSync(path.join(DST, f), buf);
  const ok = sha(fs.readFileSync(path.join(DST, f))) === sha(buf);
  if (!ok) bad++;
  console.log((ok ? 'installed ' : 'MISMATCH  ') + f + ' ' + sha(buf).slice(0, 12) + ' ' + buf.length + ' bytes');
}
process.exit(bad ? 1 : 0);
