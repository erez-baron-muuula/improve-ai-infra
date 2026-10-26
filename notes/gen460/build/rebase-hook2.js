// GEN-460 (2026-10-26): rebuild auto-approve.working.js as (current LIVE hook) + this change's two
// additions, with 'retired' dropped from the allow shape (Erez: "drop it"). Reports whether the live
// hook changed since the previous working copy was built (GEN-655). Exact-text anchors.
const fs = require('fs');
const path = require('path');
const LIVE = 'C:/Users/Erez/.claude/hooks/auto-approve.js';
const WCP = path.join(__dirname, 'auto-approve.working.js');
const live = fs.readFileSync(LIVE, 'utf8');
const oldWc = fs.readFileSync(WCP, 'utf8');
const fnStart = oldWc.indexOf('// GEN-460: exact-match allow for recording ONE backup-triage decision');
const fnEnd = oldWc.indexOf('\n}\n', fnStart) + 3;
if (fnStart < 0 || fnEnd < 3) throw new Error('function not found in old working copy');
const oldFn = oldWc.slice(fnStart, fnEnd);
const fromRe = '(?:skip|backup|retired)';
if (oldFn.split(fromRe).length !== 2) throw new Error('retired alternation not found exactly once');
const fnText = oldFn.replace(fromRe, '(?:skip|backup)');
const anchor1 = "  const re = /^&\\s+(['\"])G:\\\\My Drive\\\\AI Projects\\\\_Tooling\\\\Claude\\\\sync\\.ps1\\1\\s+-Direction\\s+From-Claude(\\s+-CommitMessage\\s+(['\"])[^'\"`$]*\\3)?\\s*$/i;\n  return re.test(command.trim());\n}\n";
const anchor2 = "    if (isSafeSyncFromClaude(cmd)) return approve('Auto-approved: config-sync (From-Claude)');\n";
const call = "    if (isSafeSyncTriageDecide(cmd)) return approve('Auto-approved: backup-triage decision (GEN-460)');\n";
function once(s, a) { const i = s.indexOf(a); if (i < 0 || s.indexOf(a, i + 1) >= 0) throw new Error('anchor not exactly once: ' + a.slice(0, 60)); return i; }
function build(base, fn) {
  let s = base;
  let i = once(s, anchor1) + anchor1.length;
  s = s.slice(0, i) + '\n' + fn + s.slice(i);
  i = once(s, anchor2) + anchor2.length;
  return s.slice(0, i) + call + s.slice(i);
}
// Live unchanged since the old copy was built <=> live + OLD function reproduces the old copy exactly.
console.log('live unchanged since last build:', build(live, oldFn) === oldWc);
const s = build(live, fnText);
fs.writeFileSync(path.join(__dirname, 'auto-approve.live-baseline.js'), live);
fs.writeFileSync(WCP, s);
console.log('rebuilt; live bytes', Buffer.byteLength(live), 'new working copy bytes', Buffer.byteLength(s));
