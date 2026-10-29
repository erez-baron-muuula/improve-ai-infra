// GEN-889: makes working copies of live hooks in notes/gen889/wc/hooks/ (read-then-write, not a
// shell copy) and a pristine baseline in notes/gen889/live-before/ for diffs and rollback.
// Run: node make-wc.js <hook file name> [...]
const fs = require('fs');
const path = require('path');
const LIVE = 'C:/Users/Erez/.claude/hooks';
const WC = path.join(__dirname, 'wc', 'hooks');
const BEFORE = path.join(__dirname, 'live-before', 'hooks');
fs.mkdirSync(WC, { recursive: true });
fs.mkdirSync(BEFORE, { recursive: true });
for (const name of process.argv.slice(2)) {
  const src = path.join(LIVE, name);
  const buf = fs.readFileSync(src);
  const before = name.startsWith('refs/') ? path.join(__dirname, 'live-before', name) : path.join(BEFORE, name);
  fs.mkdirSync(path.dirname(before), { recursive: true });
  fs.writeFileSync(before, buf);
  if (name.startsWith('refs/')) { console.log('baseline only', name); continue; } // notes are built by make-split.js
  const wc = path.join(WC, name);
  fs.mkdirSync(path.dirname(wc), { recursive: true });
  if (fs.existsSync(wc)) { console.log('kept existing working copy', name); continue; }
  fs.writeFileSync(wc, buf);
  console.log('copied', name, buf.length, 'bytes');
}
