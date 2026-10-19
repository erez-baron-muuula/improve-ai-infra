// GEN-845 step 3: confirm every cross-reference into and within the split vet-ticket skill resolves.
// Usage: node xref-check-vet-ticket.js <vetTicketDir> [skillsRoot]
//   <vetTicketDir> = the folder holding the new vet-ticket files (scratch dir before install,
//   C:/Users/Erez/.claude/skills/vet-ticket after install). [skillsRoot] defaults to the live skills
//   folder and is used for the other skills (wrap, vet-code) the files point at.
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
const skills = process.argv[3] || 'C:/Users/Erez/.claude/skills';
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return null; } };
let fails = 0, oks = 0;
function check(label, cond) { if (cond) oks++; else { fails++; console.log('FAIL  ' + label); } }

const run = read(path.join(dir, 'SKILL.md'));
check('SKILL.md exists', run);
const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));

// 1. Citations from OUTSIDE the skill, checked against the runbook (what a caller lands on).
const outside = [
  ['auto-approve.js:3535 Step-0 integrity grep names', ['## Step 0 — Gate self-check', 'enforceTicketVetting', 'findTicketPassFile']],
  ['wrap Step 1/3c: vet-ticket Steps 1, 2, 3-4, 5 card, 6 waive, 8', ['## Step 1 —', '## Step 2 —', '## Step 3 —', '## Step 4 —', '## Step 5 — Show Erez the card', '## Step 6 — The waive lane', '## Step 8 —']],
  ['wrap Step 3d / vet-code Step 8: "Marker-liveness probe" section', ['## Marker-liveness probe']],
  ['wrap / release-review / stop-foryou-nudge: Step 0b', ['## Step 0b — Search for an existing home']],
  ['ticket-gate-readout.js: consume-failed -> Step 9', ['## Step 9 — Recovery', 'consume-failed']],
  ["auto-approve.js: the non-ticket lane / the GEN-58 rollover lane", ['## The non-ticket lane', '## The GEN-58 log-volume rollover lane']],
  ['auto-approve.js: --ticket-hash and --ticket-verify CLIs documented', ['--ticket-hash', '--ticket-verify']],
  ['own description: "see Scope"', ['## Scope — what is gated']],
];
for (const [label, needles] of outside) for (const n of needles) check(label + ' -> "' + n + '"', run && run.includes(n));

// 2. Every step heading the old file had is still a heading in the runbook, in order.
const heads = ['## Scope — what is gated', '## The GEN-58 log-volume rollover lane (single writer of the exempt list)',
  '## The non-ticket lane (a gated write to a genuine non-Team-Tasks page)',
  '## Marker-liveness probe — is the gate still watching the real board?', '## Step 0 — Gate self-check (fail closed)',
  '## Step 0b — Search for an existing home (before drafting a new ticket)', '## Step 1 — Draft the write, then hash it',
  '## Step 2 — Independent review', '## Step 3 — Resolve every note before filing', '## Step 4 — Write the ticket-record',
  '## Step 5 — Show Erez the card, then mint', "## Step 6 — The waive lane (Erez's per-case override)",
  '## Step 7 — Evidence precondition (run immediately before the mint write)',
  '## Step 8 — Apply, verify, and record the event', '## Step 9 — Recovery'];
let last = -1;
for (const h of heads) { const i = run ? run.indexOf(h) : -1; check('runbook has "' + h + '" in order', i > last); if (i > last) last = i; }

// 3. Every full-path pointer names an existing file, and its "(Step X)" label is a heading there.
const ptr = /`C:\/Users\/Erez\/\.claude\/skills\/([a-z-]+)\/([a-z0-9-]+\.md)`(?:\s*\(([^)]*)\))?/g;
for (const f of files) {
  const t = read(path.join(dir, f));
  let m;
  while ((m = ptr.exec(t))) {
    const target = m[1] === 'vet-ticket' ? path.join(dir, m[2]) : path.join(skills, m[1], m[2]);
    const tt = read(target);
    check(f + ' -> ' + m[1] + '/' + m[2] + ' exists', tt);
    const label = m[3];
    if (!label || !tt) continue;
    for (const sm of label.matchAll(/section (\d)/g)) check(f + ' -> ' + m[2] + ' section ' + sm[1], new RegExp('^## ' + sm[1] + '\\. ', 'm').test(tt));
    for (const sm of label.matchAll(/^Step ([0-9]+[a-z]?)$/g)) check(f + ' -> ' + m[2] + ' "Step ' + sm[1] + '"', tt.includes('## Step ' + sm[1] + ' —'));
  }
}
// 4. Bare "`<name>.md`" mentions in the vet-ticket files name a file in the folder (or a known outside file).
const known = new Set(['SKILL.md', 'design-converged.md', 'notion.md', 'notion-write.md']);
for (const f of files) for (const m of read(path.join(dir, f)).matchAll(/`([a-z0-9-]+\.md)`/g))
  check(f + ' -> `' + m[1] + '` resolves', files.includes(m[1]) || known.has(m[1]));
// 5. Outside targets the reference files cite by name.
const wrap = read(path.join(skills, 'wrap', 'SKILL.md'));
check('wrap has the capture sub-step "Check for an existing home before creating"', wrap && wrap.includes('Check for an existing home before creating'));
check('wrap has Step 3i and Step 3d', wrap && /Step 3i/.test(wrap) && /3d/.test(wrap));
const lanes = read(path.join(dir, 'lanes.md')) || '';
check('lanes.md has the "Seed (install-time, done once)" step marker-probe.md cites', lanes.includes('**Seed (install-time, done once):**'));
const mp = read(path.join(dir, 'marker-probe.md')) || '';
check('marker-probe.md keeps the connector-rotation bullet scope.md / apply-recover.md cite', mp.includes('**A connector-UUID rotation.**'));
const rv = read(path.join(dir, 'review.md')) || '';
check('review.md keeps "Where the hook looks, exactly" (cited by record-card-mint.md Step 7)', rv.includes('**Where the hook looks, exactly**'));
const sc = read(path.join(dir, 'scope.md')) || '';
check('scope.md keeps the "NOT gated" practice-page bullet (cited by review.md Step 1)', sc.includes('NOT gated') && sc.includes('**The Notion practice page**'));
// 6. The mint template the contract test pins is still present exactly once as a pass template block.
const rcm = read(path.join(dir, 'record-card-mint.md')) || '';
check('record-card-mint.md holds the Step-5 pass template', rcm.includes('{ "kind": "ticket",\n  "surface": "notion-mcp",'));
console.log('xref: ' + oks + ' ok, ' + fails + ' failed');
process.exitCode = fails ? 1 : 0;
