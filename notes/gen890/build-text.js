// GEN-890 bundle: build working copies of every text file the bundle changes, from the live files.
// Each replacement must match exactly once, or the build stops. Output: notes/gen890/wc/text/<same relative path>.
const fs = require('fs');
const path = require('path');
const SK = 'C:/Users/Erez/.claude/skills/';
const OUT = path.join(__dirname, 'wc', 'text');
const NL = '\n';

const edits = {
  'config-health/SKILL.md': [[
    'AND the settings-health weekly nudge (see',
    'AND the settings-health weekly nudge and the weekly size check (see',
  ], [
    'The expensive verification runs only in the on-demand mode below.' + NL + NL + '### On-demand (`/config-health settings`)',
    'The expensive verification runs only in the on-demand mode below.' + NL + NL +
    '### Auto (at `/wrap`) — the weekly size check (GEN-890)' + NL +
    'After the settings nudge, follow `size-weekly.md` in this folder. It is this skill\'s one exception to read-only: it files and raises size tickets and writes its own state file.' + NL + NL +
    '### On-demand (`/config-health settings`)',
  ]],
  'wrap/SKILL.md': [[
    '(Step 3c\'s filing excepted)',
    '(Step 3c\'s filing and the weekly size check\'s tickets and state file excepted)',
  ]],
  'wrap/step1-capture.md': [[
    'It **overrides, for capture-only filing and for the on-demand ref-file appends in sub-step (3),**',
    'It **overrides, for capture-only filing, for the on-demand ref-file appends in sub-step (3), and for the weekly size check\'s ticket filing and raising (config-health `size-weekly.md`),**',
  ], [
    '**No Erez-facing card:** Steps 1 and 3c carry the standing override',
    '**No Erez-facing card:** Steps 1 and 3c, and the weekly size check (which uses `source` `wrap-step1`), carry the standing override',
  ]],
};

const toc = {
  'notion-ticket-lookup/SECURE-LOOKUP-DESIGN.md': ['# Secure GEN-NNN lookup — design v2 (post-review)',
    '**Contents:** Status / handoff · Goal · Verified facts · Two true constraints · Recommended design (secret store, bootstrap, lookup, zero prompts, touching the store less) · Honest residual risks · What to update once settled · DB-id derivation'],
  'wrap/readouts-3d-3j.md': ['# /wrap Steps 3d to 3j — the readouts: full procedure',
    '**Contents:** 3d marker-liveness probe · 3e grounding-flag readout · 3f model-list readout · 3g search-first reminder readout · 3h verdict-guard readout · 3i ticket-gate readout · 3j release-review readout'],
  'vet-ticket/record-card-mint.md': ['# /vet-ticket — Steps 3 to 7: notes, record, card, mint, waive, evidence check',
    '**Contents:** Step 3 resolve every note · Step 4 write the ticket-record · Step 5 show the card, then mint · Step 6 the waive lane · Step 7 evidence precondition'],
  'vet-code/reviews.md': ['# /vet-code — model check, the two code reviews, and what to attest',
    '**Contents:** Step 0 gate self-check · Step 3 code review (two passes) · Step 5 what to attest · Step 6 Pass B model check'],
  'vet-code/live-verify.md': ['# /vet-code — live-verify (Steps 4, 4a), install check (Step 8) and the antivirus re-check (Step 8a)',
    '**Contents:** Step 4 live-verify (input realism; pass-consumption assertion) · Step 4a antivirus-survival check · Step 8 verify installed · Step 8a arm the checkpoint-2 re-check'],
  'vet-code/gate-mechanics.md': ['# Gate mechanics shared by /vet-code and /vet-rule',
    '**Contents:** Parameters · 1. The record · 2. Evidence precondition, then mint · 3. Apply · 4. Recovery · 5. Break-glass OPEN/CLOSE commands'],
};
for (const [rel, [title, line]] of Object.entries(toc)) {
  edits[rel] = [[title + NL, title + NL + NL + line + NL]];
}

function count(s, sub) { let n = 0, i = 0; while ((i = s.indexOf(sub, i)) !== -1) { n++; i += sub.length; } return n; }
let bad = 0;
for (const [rel, list] of Object.entries(edits)) {
  let s = fs.readFileSync(SK + rel, 'utf8');
  const crlf = s.includes('\r\n');
  if (crlf) s = s.replace(/\r\n/g, '\n');
  for (const [from, to] of list) {
    const n = count(s, from);
    if (n !== 1) { console.log('MATCH ' + n + 'x in ' + rel + ': ' + from.slice(0, 60)); bad++; continue; }
    s = s.replace(from, () => to);
  }
  if (crlf) s = s.replace(/\n/g, '\r\n');
  const dest = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, s, 'utf8');
  console.log('built ' + rel + (crlf ? ' (CRLF kept)' : ''));
}
const sw = path.join(__dirname, 'wc', 'size-weekly.md');
const swDest = path.join(OUT, 'config-health', 'size-weekly.md');
fs.writeFileSync(swDest, fs.readFileSync(sw));
console.log('built config-health/size-weekly.md (new)');
process.exit(bad ? 1 : 0);
