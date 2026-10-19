// GEN-845 step 2: list every sentence of the old vet-code / vet-rule SKILL.md that is not present in
// the new file set. gate-mechanics.md is also rendered with each skill's parameter values, since that
// rendering is what each skill's reader effectively sees.
// Usage: node sentence-diff.js <oldDir> <newDir> [outFile]
const fs = require('fs');
const path = require('path');
const [oldDir, newDir, outFile] = process.argv.slice(2);

const PARAMS = {
  'vet-code': { '[PASS_DIR]': '~/.claude-staging/vetting-passes/', '[RECORD]': 'vetting record',
    '[RECORD_KIND]': 'vetting-record', '[PASS]': 'vetting pass', '[PASS_KIND]': 'vetting',
    '[GUARD]': 'enforceVetting', '[STEP_MINT]': 'Step 6', '[STEP_APPLY]': 'Step 7',
    '[STEP_VERIFY]': 'Step 8', '[STEP_RECOVERY]': 'Step 9' },
  'vet-rule': { '[PASS_DIR]': '~/.claude-staging/check-passes/', '[RECORD]': 'check-record',
    '[RECORD_KIND]': 'check-record', '[PASS]': 'check pass', '[PASS_KIND]': 'check',
    '[GUARD]': 'enforceCheckDue', '[STEP_MINT]': 'Step 4', '[STEP_APPLY]': 'Step 5',
    '[STEP_VERIFY]': 'Step 6', '[STEP_RECOVERY]': 'Step 8' },
};
function render(text, p) {
  for (const [k, v] of Object.entries(p)) text = text.split(k).join(v);
  return text;
}
function norm(s) {
  return s.replace(/\r\n/g, '\n').replace(/\*\*/g, '').replace(/`/g, '')
    .replace(/[ \t]*\n[ \t]*/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}
// Split one file into units: each code-block line is a unit; prose is split into paragraphs / list
// items / headings, then into sentences.
function units(text) {
  const out = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let inCode = false, para = [];
  const flush = () => {
    if (!para.length) return;
    const p = para.join(' ');
    para = [];
    for (const s of p.split(/(?<=[.!?:;)])\s+(?=[A-Z(*`"\[])/)) {
      const t = s.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').trim();
      if (t.length > 0) out.push(t);
    }
  };
  for (const line of lines) {
    if (/^```/.test(line)) { flush(); inCode = !inCode; continue; }
    if (inCode) { if (line.trim()) out.push(line.trim()); continue; }
    if (!line.trim() || /^---\s*$/.test(line)) { flush(); continue; }
    if (/^#{1,6}\s/.test(line) || /^\s*(?:[-*]|\d+\.)\s+/.test(line)) { flush(); }
    para.push(line.trim());
    if (/^#{1,6}\s/.test(line)) flush();
  }
  flush();
  return out;
}
function walk(dir) {
  const r = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) r.push(...walk(f)); else if (f.endsWith('.md')) r.push(f);
  }
  return r;
}
const newTexts = [];
for (const f of newDir.split(',').flatMap(walk)) {
  const t = fs.readFileSync(f, 'utf8');
  newTexts.push(t);
  if (path.basename(f) === 'gate-mechanics.md') for (const p of Object.values(PARAMS)) newTexts.push(render(t, p));
}
const hay = newTexts.map(norm).join(' \u0000 ');
const report = [];
let total = 0, missing = 0;
for (const f of walk(oldDir)) {
  const rel = path.relative(oldDir, f);
  for (const u of units(fs.readFileSync(f, 'utf8'))) {
    const n = norm(u);
    if (n.length < 2) continue;
    total++;
    if (!hay.includes(n)) { missing++; report.push(rel + ' | ' + u); }
  }
}
const summary = 'old units: ' + total + ', missing from new set: ' + missing;
const body = summary + '\n\n' + report.join('\n') + '\n';
if (outFile) fs.writeFileSync(outFile, body);
console.log(summary);
