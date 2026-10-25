// GEN-460: rebuild the auto-approve.js working copy as (current LIVE hook) + this change's two
// additions, so a concurrent session's installed change is kept (GEN-655). Exact-text anchors.
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'gen460');
const live = fs.readFileSync('C:/Users/Erez/.claude/hooks/auto-approve.js', 'utf8');
const oldWc = fs.readFileSync(path.join(dir, 'auto-approve.js'), 'utf8');
// Pull the new function text out of the old working copy, so the bytes are the reviewed ones.
const fnStart = oldWc.indexOf('// GEN-460: exact-match allow for recording ONE backup-triage decision');
const fnEnd = oldWc.indexOf('\n}\n', fnStart) + 3;
if (fnStart < 0 || fnEnd < 3) throw new Error('function not found in old working copy');
const fnText = oldWc.slice(fnStart, fnEnd);
const anchor1 = "  const re = /^&\\s+(['\"])G:\\\\My Drive\\\\AI Projects\\\\_Tooling\\\\Claude\\\\sync\\.ps1\\1\\s+-Direction\\s+From-Claude(\\s+-CommitMessage\\s+(['\"])[^'\"`$]*\\3)?\\s*$/i;\n  return re.test(command.trim());\n}\n";
const anchor2 = "    if (isSafeSyncFromClaude(cmd)) return approve('Auto-approved: config-sync (From-Claude)');\n";
const call = "    if (isSafeSyncTriageDecide(cmd)) return approve('Auto-approved: backup-triage decision (GEN-460)');\n";
function once(s, a) { const i = s.indexOf(a); if (i < 0 || s.indexOf(a, i + 1) >= 0) throw new Error('anchor not exactly once: ' + a.slice(0, 60)); return i; }
let s = live;
let i = once(s, anchor1) + anchor1.length;
s = s.slice(0, i) + '\n' + fnText + s.slice(i);
i = once(s, anchor2) + anchor2.length;
s = s.slice(0, i) + call + s.slice(i);
fs.writeFileSync(path.join(dir, 'auto-approve.js.orig'), live);
fs.writeFileSync(path.join(dir, 'auto-approve.js'), s);
console.log('rebased; live bytes', Buffer.byteLength(live), 'new wc bytes', Buffer.byteLength(s));
