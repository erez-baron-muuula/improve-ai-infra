// GEN-893 Part 2: working copies of the five skill files (read-then-write) plus untouched baselines.
const fs = require('fs');
const path = require('path');
const SK = 'C:/Users/Erez/.claude/skills';
const out = path.join(__dirname, 'wc2');
for (const s of ['suggest', 'vet-rule', 'vet-code', 'vet-ticket', 'check']) {
  const b = fs.readFileSync(path.join(SK, s, 'SKILL.md'));
  fs.mkdirSync(path.join(out, s), { recursive: true });
  fs.mkdirSync(path.join(out, 'baseline', s), { recursive: true });
  fs.writeFileSync(path.join(out, s, 'SKILL.md'), b);
  fs.writeFileSync(path.join(out, 'baseline', s, 'SKILL.md'), b);
  const t = b.toString('utf8');
  console.log(s, b.length, 'bytes', (t.match(/\r\n/g) || []).length ? 'CRLF' : 'LF');
}
