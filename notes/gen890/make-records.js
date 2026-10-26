// GEN-890 /vet-rule Step 1b: one check-record per modified skill file, bound to the working copy's hash.
// Verifies the reviewer transcripts exist (agentType check-reviewer, earliest timestamp <= draftedUtc).
// Usage: node make-records.js <sessionId>
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sid = process.argv[2];
if (!sid) { console.log('need session id'); process.exit(1); }
const WC = path.join(__dirname, 'wc', 'text');
const LIVE = 'C:/Users/Erez/.claude/skills/';
const PASS_DIR = 'C:/Users/Erez/.claude-staging/check-passes/';
const SUB = 'C:/Users/Erez/.claude/projects/C--Users-Erez-AI-Projects-Improve-AI-Infra/' + sid + '/subagents/';
const ids = ['ae76dbe9a22234b68', 'ac403b49c097843cd', 'a63ad4a5afaf35152'];
const files = ['config-health/SKILL.md', 'wrap/SKILL.md', 'wrap/step1-capture.md',
  'notion-ticket-lookup/SECURE-LOOKUP-DESIGN.md', 'wrap/readouts-3d-3j.md', 'vet-ticket/record-card-mint.md',
  'vet-code/reviews.md', 'vet-code/live-verify.md', 'vet-code/gate-mechanics.md'];
const drafted = new Date().toISOString();
let bad = 0;
for (const id of ids) {
  const meta = SUB + 'agent-' + id + '.meta.json', jl = SUB + 'agent-' + id + '.jsonl';
  if (!fs.existsSync(meta) || !fs.existsSync(jl)) { console.log('MISSING transcript ' + id); bad++; continue; }
  const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
  let min = null;
  for (const ln of fs.readFileSync(jl, 'utf8').split('\n')) {
    if (!ln.trim()) continue;
    try { const t = JSON.parse(ln).timestamp; if (t && (!min || t < min)) min = t; } catch (e) {}
  }
  const okType = m.agentType === 'check-reviewer', okTime = min && min <= drafted;
  console.log(id + ' agentType=' + m.agentType + ' earliest=' + min + (okType && okTime ? ' OK' : ' FAIL'));
  if (!okType || !okTime) bad++;
}
if (bad) process.exit(1);
const verdicts = 'Text panel for the GEN-890 bundle (8 modified skill files + new config-health/size-weekly.md). ' +
  'Round 1: pre-mortem REVISE (1 material: no instruction when needStatus is empty -> size-decide would fail; fixed by writing {} ); ' +
  'holistic+rule-check PASS (advisories applied: define open, the decision\'s value). ' +
  'Round 2: pre-mortem PASS (finding RESOLVED, no new issues). Converged in 2 rounds.';
fs.mkdirSync(PASS_DIR, { recursive: true });
for (const rel of files) {
  const txt = fs.readFileSync(path.join(WC, rel), 'utf8').replace(/\r\n/g, '\n');
  const hash = crypto.createHash('sha256').update(txt, 'utf8').digest('hex');
  const target = (LIVE + rel).replace(/\//g, '\\').toLowerCase();
  const rec = { kind: 'check-record', target, contentHash: hash, checkReviewerAgentIds: ids, checkVerdict: 'converged', capturedVerdicts: verdicts, draftedUtc: drafted };
  const name = 'gen890-' + rel.replace(/[\/\\.]/g, '-') + '.check-record.json';
  fs.writeFileSync(PASS_DIR + name, JSON.stringify(rec, null, 2));
  console.log('record ' + name + ' ' + hash.slice(0, 12));
}
