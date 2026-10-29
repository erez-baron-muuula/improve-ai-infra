// GEN-892 install, part 1 (after Erez's OK, 2026-10-29): rollback copies of every live target, then the
// targets no pass gate covers: the new shared reader and the two new skill files (create-only), the size
// checker, the weekly tool and the limits file (overwrite). Byte-exact node read/write; hash-checks each.
// The 6 hooks, update-config.ps1 and SKILL.md go through passes separately. Usage: node install-prep.js
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WC = path.join(__dirname, 'wc');
const RB = path.join(__dirname, 'rollback');
const H = 'C:/Users/Erez/.claude/hooks/';
const SK = 'C:/Users/Erez/.claude/skills/';
const NOTES = path.join(__dirname, '..');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

const ALL = [
  ['hooks/inject-notion-refs.js', H + 'inject-notion-refs.js'],
  ['hooks/inject-shell-refs.js', H + 'inject-shell-refs.js'],
  ['hooks/inject-topic-refs.js', H + 'inject-topic-refs.js'],
  ['hooks/inject-browser-refs.js', H + 'inject-browser-refs.js'],
  ['hooks/sessionstart-backup-surfacer.js', H + 'sessionstart-backup-surfacer.js'],
  ['hooks/sessionstart-skill-restore.js', H + 'sessionstart-skill-restore.js'],
  ['drive/update-config.ps1', 'G:/My Drive/AI Projects/_Tooling/Claude/update-config.ps1'],
  ['skills/config-health-scan.ps1', SK + 'config-health/config-health-scan.ps1'],
  ['notes/release-review/release-review-tool.js', path.join(NOTES, 'release-review', 'release-review-tool.js')],
  ['notes/anthropic-guidelines.json', path.join(NOTES, 'anthropic-guidelines.json')],
  ['skills/release-review/SKILL.md', SK + 'release-review/SKILL.md'],
];
const CREATE = [
  ['hooks/guidelines-limits.js', H + 'guidelines-limits.js'],
  ['skills/release-review/guidelines-watch.md', SK + 'release-review/guidelines-watch.md'],
  ['skills/release-review/writes-and-digest.md', SK + 'release-review/writes-and-digest.md'],
];
const OVERWRITE = ['skills/config-health-scan.ps1', 'notes/release-review/release-review-tool.js', 'notes/anthropic-guidelines.json'];

// 1. Rollback copies (refuse to run twice: the first copies are the real before-state).
if (fs.existsSync(RB)) throw new Error('rollback folder already exists; not overwriting it: ' + RB);
for (const [rel, live] of ALL) {
  const b = fs.readFileSync(live);
  const dst = path.join(RB, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, b);
  if (sha(fs.readFileSync(dst)) !== sha(b)) throw new Error('rollback copy mismatch: ' + rel);
}
for (const [, live] of CREATE) if (fs.existsSync(live)) throw new Error('expected absent before create: ' + live);
console.log('rollback: ' + ALL.length + ' copies in ' + RB + '; new targets absent');

// 2. Create-only, then the ungated overwrites.
const put = (rel, live, flag) => {
  const b = fs.readFileSync(path.join(WC, rel));
  fs.writeFileSync(live, b, { flag });
  const ok = sha(fs.readFileSync(live)) === sha(b);
  console.log((ok ? 'OK   ' : 'FAIL ') + live + ' ' + sha(b).slice(0, 12));
  if (!ok) process.exitCode = 1;
};
for (const [rel, live] of CREATE) put(rel, live, 'wx');
for (const rel of OVERWRITE) put(rel, ALL.find(x => x[0] === rel)[1], 'w');
