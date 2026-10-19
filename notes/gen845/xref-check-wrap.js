// GEN-845 step 4: confirm every cross-reference into and within the split /wrap skill resolves.
// Usage: node xref-check-wrap.js <wrapDir> <oldWrapSkillMd> [vetTicketReviewMd] [skillsRoot]
//   <wrapDir> = the folder holding the new wrap files (scratch dir before install,
//   C:/Users/Erez/.claude/skills/wrap after install). <oldWrapSkillMd> = the pre-split SKILL.md, used
//   for the heading list. [vetTicketReviewMd] defaults to the live vet-ticket/review.md.
const fs = require('fs');
const path = require('path');
const [dir, oldFile, reviewArg, skillsArg] = process.argv.slice(2);
const skills = skillsArg || 'C:/Users/Erez/.claude/skills';
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return null; } };
let fails = 0, oks = 0;
function check(label, cond) { if (cond) oks++; else { fails++; console.log('FAIL  ' + label); } }

const run = read(path.join(dir, 'SKILL.md'));
check('SKILL.md exists', run);
const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
const all = files.map(f => read(path.join(dir, f))).join('\n');

// 1. Every step heading of the old file is still a heading in the runbook, in the same order.
const heads = read(oldFile).split('\n').filter(l => /^## Step /.test(l));
check('old file has 20 step headings', heads.length === 20);
let last = -1;
for (const h of heads) { const i = run ? run.indexOf(h + '\n') : -1; check('runbook has "' + h + '" in order', i > last); if (i > last) last = i; }

// 2. Citations from OUTSIDE the skill, checked against the runbook (what a caller lands on).
const outside = [
  ['key-leak-tripwire.ps1: "Step 0b -- Key check"', ['## Step 0b — Key check']],
  ['auto-approve.js / ticket-gate-readout.js / vet-ticket: Step 3i', ['## Step 3i — Ticket-gate readout']],
  ['auto-approve.js: Step 4 compact-gate marker', ['## Step 4 — HISTORY.md', 'compact gate']],
  ['release-review / vet-ticket / gen636 task: Steps 1 and 3c', ['## Step 1 — Capture unresolved items', '## Step 3c — ']],
  ['vet-ticket marker-probe: Step 3d', ['## Step 3d — Ticket-gate marker-liveness probe']],
  ['effort-model-reference.md: Step 3f', ['## Step 3f — Model-list readout']],
  ['search-first bar line: "the command is in /wrap Step 3g"', ['## Step 3g — ', 'The switch command']],
  ['vet-ticket background: Step 7 report', ['## Step 7 — Report']],
  ['config-health: Step 8 marks the global file reviewed', ['config-health-scan.ps1 -Action mark-reviewed']],
  ['source tags kept', ['`wrap-step1`', '`wrap-step3c`']],
];
for (const [label, needles] of outside) for (const n of needles) if (n) check(label + ' -> "' + n + '"', run && run.includes(n));

// 3. Each runbook pointer names an existing file, and its "(Step X)" label is a heading there.
const ptr = /`C:\/Users\/Erez\/\.claude\/skills\/([a-z-]+)\/([a-z0-9-]+\.md)`(?:\s*\(([^)]*)\))?/g;
for (const f of files) {
  const t = read(path.join(dir, f));
  let m;
  while ((m = ptr.exec(t))) {
    const target = m[1] === 'wrap' ? path.join(dir, m[2]) : path.join(skills, m[1], m[2]);
    const tt = read(target);
    check(f + ' -> ' + m[1] + '/' + m[2] + ' exists', tt);
    if (m[3] && tt) for (const sm of m[3].matchAll(/^Step ([0-9]+[a-z]?)$/g))
      check(f + ' -> ' + m[2] + ' has "## Step ' + sm[1] + ' —"', tt.includes('## Step ' + sm[1] + ' —'));
  }
}
// 4. Every step with detail points at a file holding that step's full section.
const detail = { '0b': 'step0b-keys.md', '1': 'step1-capture.md', '3b': 'readouts-3b-3c.md', '3c': 'readouts-3b-3c.md',
  '3d': 'readouts-3d-3j.md', '3e': 'readouts-3d-3j.md', '3f': 'readouts-3d-3j.md', '3g': 'readouts-3d-3j.md',
  '3h': 'readouts-3d-3j.md', '3i': 'readouts-3d-3j.md', '3j': 'readouts-3d-3j.md', '4': 'step4-history-git.md',
  '4b': 'step4-history-git.md', '7': 'step7-report.md' };
for (const [id, f] of Object.entries(detail)) {
  const sec = run ? run.split('\n## ').find(s => s.startsWith('Step ' + id + ' — ')) : null;
  check('runbook Step ' + id + ' says "Before doing this step, read" ' + f, sec && sec.includes('Before doing this step, read `C:/Users/Erez/.claude/skills/wrap/' + f + '`'));
  check(f + ' holds "## Step ' + id + ' —"', (read(path.join(dir, f)) || '').includes('## Step ' + id + ' — '));
}
// 5. Bare "`<name>.md`" mentions in the wrap files name a file in the folder (or a known outside file).
const known = new Set(['SKILL.md', 'HISTORY.md', 'CLAUDE.md', 'notion.md', 'shell.md', 'effort-model-reference.md']);
for (const f of files) for (const m of read(path.join(dir, f)).matchAll(/`([a-z0-9-]+\.md)`/g))
  check(f + ' -> `' + m[1] + '` resolves', files.includes(m[1]) || known.has(m[1]));
// 6. Names cited inside the moved text still exist where they are cited.
const s1 = read(path.join(dir, 'step1-capture.md')) || '';
for (const n of ["**Decide what's already resolved**", '**Identify unresolved items**', '**Triage each behavioral learning by trigger before filing.**',
  '**Triage each to a parent.**', '**Dedupe before creating.**', '**Check for an existing home before creating (semantic near-duplicate).**',
  '**Create one ticket per item', '**Carry the filed ticket IDs', '**Unsure which branch applies**'])
  check('step1-capture.md keeps ' + n, s1.includes(n));
check('readouts-3b-3c.md keeps "Retiring a known-benign orphan"', (read(path.join(dir, 'readouts-3b-3c.md')) || '').includes('**Retiring a known-benign orphan.**'));
check('readouts-3d-3j.md keeps the switch printf', (read(path.join(dir, 'readouts-3d-3j.md')) || '').includes("printf '{\"kind\":\"switch\""));
check('step7-report.md keeps the full reporting rule', (read(path.join(dir, 'step7-report.md')) || '').includes('**Report only what needs your eyes.**'));
check('step7-report.md keeps the all-clean fast-path', (read(path.join(dir, 'step7-report.md')) || '').includes('**All-clean fast-path:**'));
// 7. vet-ticket's two pointers into /wrap now name step1-capture.md.
const rv = read(reviewArg || path.join(skills, 'vet-ticket', 'review.md')) || '';
check('vet-ticket review.md Step 0b points at wrap/step1-capture.md', rv.includes('`C:/Users/Erez/.claude/skills/wrap/step1-capture.md`, the `/wrap` capture sub-step titled "Check for an existing home before creating"'));
check('vet-ticket review.md Step 2 points at wrap/step1-capture.md (Step 1)', rv.includes('see `C:/Users/Erez/.claude/skills/wrap/step1-capture.md` (Step 1);'));
check('vet-ticket review.md no longer cites wrap/SKILL.md', !rv.includes('`wrap/SKILL.md`'));
// 8. Size limits.
check('runbook <= 12,000 bytes', run && Buffer.byteLength(run) <= 12000);
check('runbook < 500 lines', run && run.split('\n').length < 500);
console.log('xref: ' + oks + ' ok, ' + fails + ' failed');
process.exitCode = fails ? 1 : 0;
