// GEN-845 step 2: confirm every cross-reference into and within the split vet-code / vet-rule
// skills resolves. Usage: node xref-check.js <skillsRoot>
//   <skillsRoot> = the folder holding vet-code/ and vet-rule/ (scratch "new" dir before install,
//   C:/Users/Erez/.claude/skills after install).
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const read = rel => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch (e) { return null; } };
let fails = 0, oks = 0;
function check(label, cond) { if (cond) oks++; else { fails++; console.log('FAIL  ' + label); } }

const vc = read('vet-code/SKILL.md'), vr = read('vet-rule/SKILL.md');
check('vet-code/SKILL.md exists', vc); check('vet-rule/SKILL.md exists', vr);

// 1. Citations from OUTSIDE the two skills (hooks, other skills, tickets).
const outside = [
  ['auto-approve.js:760 Step-0 grep names (vet-code)', vc, ['enforceVetting', 'findVettingPassFile', '## Step 0']],
  ['auto-approve.js:760 Step-0 grep names (vet-rule)', vr, ['enforceCheckDue', 'findCheckPassFile', '## Step 0']],
  ["auto-approve.js:1271 /vet-code's Apply step requires single-line", vc, ['## Step 7 — Apply', 'SINGLE LINE']],
  ["auto-approve.js:3720 /vet-code's OPEN/CLOSE commands", vc, ['## Break-glass OPEN/CLOSE commands']],
  ['vet-ticket:251 /vet-code Step 8 carries the marker-probe pointer', vc, ['## Step 8 — Verify installed', 'Marker-liveness probe', 'enforceTicketVetting']],
  ['vet-ticket:253 /vet-code Step 5 attests', vc, ['## Step 5 — Show Erez + approve']],
  ['vet-ticket:731 OPEN/CLOSE commands in /vet-code and /vet-rule', vr, ['## Break-glass OPEN/CLOSE commands']],
  ['GEN-845 ticket: new files follow /vet-rule Step 7', vr, ['## Step 7 — New-file / bootstrap creation']],
  ["vet-rule Step 7 cites /vet-code's Scope for a brand-new hook", vc, ['## Scope', '**NEW files:**']],
  ['wrap 3b/3c: /vet-code stops on an unlisted/unreadable model list', vc, ['--classify', 'Step 3 stops']],
];
for (const [label, text, needles] of outside) for (const n of needles) check(label + ' -> "' + n + '"', text && text.includes(n));

// 2. Every step heading the old files had is still a heading in the new runbook.
const steps = {
  'vet-code/SKILL.md': ['## Scope — what is gated', '## Diagnostic-probe fast-path', '## Step 0 —', '## Step 1 —', '## Step 1b —',
    '## Step 2 —', '## Step 3 —', '## Step 4 —', 'Step 4 input realism', 'Step 4 pass-CONSUMPTION assertion',
    '### Step 4a —', '## Step 5 —', '## Step 6 —', '## Step 7 —', '## Step 8 —', '## Step 8a —', '## Step 9 —',
    '## Break-glass OPEN/CLOSE commands'],
  'vet-rule/SKILL.md': ['## Scope — what is gated', '## When this skill is DUE', '## Step 0 —', '## Step 1 —', '## Step 1b —',
    '## Step 2 —', '## Step 3 —', '## Step 4 —', '## Step 5 —', '## Step 6 —', '## Step 7 —', '## Step 8 —',
    '## Break-glass OPEN/CLOSE commands'],
};
for (const [f, hs] of Object.entries(steps)) { const t = read(f); for (const h of hs) check(f + ' has "' + h + '"', t && t.includes(h)); }

// 3. Every "C:/Users/Erez/.claude/skills/<skill>/<file>.md" pointer in the new files names a file in
//    the set, and every "(... section N ...)" / "(Step X ...)" label it carries exists in that file.
const files = [];
for (const s of ['vet-code', 'vet-rule']) for (const f of fs.readdirSync(path.join(root, s))) if (f.endsWith('.md')) files.push(s + '/' + f);
const sectionHeads = { 1: '## 1. The record', 2: '## 2. Evidence precondition', 3: '## 3. Apply', 4: '## 4. Recovery', 5: '## 5. Break-glass OPEN/CLOSE' };
const stepHeads = {
  'vet-code/reviews.md': { 'Step 0': '## Step 0 —', 'Step 3': '## Step 3 —', 'Step 5': '## Step 5 —', 'Step 6 — Pass B model check': '## Step 6 — Pass B model check' },
  'vet-code/live-verify.md': { 'Step 4': '## Step 4 —', 'Step 4a': '## Step 4a —', 'Step 8': '## Step 8 — Verify installed', 'Step 8a': '## Step 8a —' },
};
const ptr = /`C:\/Users\/Erez\/\.claude\/skills\/(vet-code|vet-rule)\/([a-z0-9-]+\.md)`(?:\s*\(([^)]*)\))?/g;
for (const f of files) {
  const t = read(f);
  let m;
  while ((m = ptr.exec(t))) {
    const target = m[1] + '/' + m[2];
    check(f + ' -> ' + target + ' exists', files.includes(target) || (root.endsWith('skills') && read(target)));
    const label = m[3];
    if (!label) continue;
    const tt = read(target) || '';
    for (const sm of label.matchAll(/section (\d)/g)) check(f + ' -> ' + target + ' section ' + sm[1], tt.includes(sectionHeads[sm[1]]));
    if (/table/.test(label)) check(f + ' -> ' + target + ' table', tt.includes('| `[PASS_DIR]` |'));
    const sh = stepHeads[target];
    if (sh && sh[label]) check(f + ' -> ' + target + ' "' + label + '"', tt.includes(sh[label]));
    else if (sh) check(f + ' -> ' + target + ' label "' + label + '" known', false);
  }
}
// 4. Bare "`<name>.md` in this folder" / "gate-mechanics.md section N" mentions.
for (const f of files) {
  const t = read(f);
  for (const m of t.matchAll(/`([a-z0-9-]+\.md)` in this folder/g)) check(f + ' -> ' + m[1] + ' in this folder', files.includes(f.split('/')[0] + '/' + m[1]));
  for (const m of t.matchAll(/`gate-mechanics\.md` section (\d)/g)) check(f + ' -> gate-mechanics section ' + m[1], read('vet-code/gate-mechanics.md').includes(sectionHeads[m[1]]));
}
// 5. Placeholders used in gate-mechanics.md are all defined in its table.
const gm = read('vet-code/gate-mechanics.md');
const defined = new Set([...gm.matchAll(/^\| `(\[[A-Z_]+\])`/gm)].map(m => m[1]));
for (const m of new Set([...gm.matchAll(/\[[A-Z_]{3,}\]/g)].map(m => m[0]))) check('gate-mechanics placeholder ' + m + ' defined in table', defined.has(m));
console.log('xref: ' + oks + ' ok, ' + fails + ' failed');
process.exitCode = fails ? 1 : 0;
