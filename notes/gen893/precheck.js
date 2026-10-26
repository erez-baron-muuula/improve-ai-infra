// GEN-893 Part 2 /vet-rule Step 4 evidence precondition, for all five targets:
// record exists; contentHash == current working copy; converged; reviewer ids non-empty, each
// transcript + sidecar on disk, agentType check-reviewer, earliest timestamp <= draftedUtc;
// and the live file still equals the baseline the working copy was built from.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const SESSION = 'e7771e49-d097-4cfe-a0b4-e88824f3ce0e';
const projects = path.join(os.homedir(), '.claude', 'projects');
const slug = fs.readdirSync(projects).find(d => fs.existsSync(path.join(projects, d, SESSION)));
const sub = path.join(projects, slug, SESSION, 'subagents');
const dir = path.join(os.homedir(), '.claude-staging', 'check-passes');
const h = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const norm = f => fs.readFileSync(f, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
let bad = 0;
for (const s of ['suggest', 'vet-rule', 'vet-code', 'vet-ticket', 'check']) {
  const recF = fs.readdirSync(dir).filter(f => f.startsWith('record-gen893-' + s + '-') && f.endsWith('.json')).sort().pop();
  const fail = m => { bad++; console.log('FAIL ' + s + ': ' + m); };
  if (!recF) { fail('no record'); continue; }
  const rec = JSON.parse(fs.readFileSync(path.join(dir, recF), 'utf8'));
  if (rec.contentHash !== h(norm(path.join(__dirname, 'wc2', s, 'SKILL.md')))) fail('hash differs from working copy');
  if (rec.checkVerdict !== 'converged') fail('not converged');
  if (!Array.isArray(rec.checkReviewerAgentIds) || !rec.checkReviewerAgentIds.length) fail('no reviewer ids');
  for (const id of rec.checkReviewerAgentIds || []) {
    const j = path.join(sub, 'agent-' + id + '.jsonl'), m = path.join(sub, 'agent-' + id + '.meta.json');
    if (!fs.existsSync(j) || !fs.existsSync(m)) { fail('missing transcript ' + id); continue; }
    if (!/"agentType":"check-reviewer"/.test(fs.readFileSync(m, 'utf8'))) fail('not check-reviewer ' + id);
    const ts = (fs.readFileSync(j, 'utf8').match(/"timestamp":"[^"]+"/g) || []).map(x => x.slice(13, -1)).sort();
    if (!ts.length || ts[0] > rec.draftedUtc.replace('Z', '.999Z')) fail('reviewer ' + id + ' started after draftedUtc');
  }
  const live = path.join(os.homedir(), '.claude', 'skills', s, 'SKILL.md');
  if (h(norm(live)) !== h(norm(path.join(__dirname, 'wc2', 'baseline', s, 'SKILL.md')))) fail('live file changed since baseline');
  console.log((bad ? '' : 'ok   ') + s + ' ' + recF);
}
console.log(bad ? bad + ' FAILED' : 'all ok');
process.exit(bad ? 1 : 0);
