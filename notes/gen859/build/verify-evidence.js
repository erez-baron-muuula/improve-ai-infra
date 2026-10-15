// /vet-code Step 6 evidence precondition, read-only: record hash == working copy hash; every cited reviewer
// transcript exists, is a check-reviewer, and started before the record was drafted.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WC = __dirname;
const SUB = process.argv[2];
const REC = path.join(process.env.USERPROFILE, '.claude-staging', 'vetting-passes');
const map = {
  'record-gen859-account-session-sync.json': 'account-session-sync.js',
  'record-gen859-surfacer.json': 'sessionstart-backup-surfacer.js',
  'record-gen859-settings.json': 'settings.json'
};
let ok = true;
for (const [recName, wcName] of Object.entries(map)) {
  const rec = JSON.parse(fs.readFileSync(path.join(REC, recName), 'utf8'));
  const text = fs.readFileSync(path.join(WC, wcName), 'utf8').replace(/\r\n/g, '\n');
  const h = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
  const problems = [];
  if (h !== rec.contentHash) problems.push(`hash mismatch ${h}`);
  if (rec.checkVerdict !== 'converged') problems.push('not converged');
  if (!Array.isArray(rec.checkReviewerAgentIds) || rec.checkReviewerAgentIds.length === 0) problems.push('no reviewers');
  if (!Array.isArray(rec.passBAgentIds) || rec.passBAgentIds.length === 0) problems.push('no pass B');
  const drafted = Date.parse(rec.draftedUtc);
  for (const id of [...(rec.checkReviewerAgentIds || []), ...(rec.passBAgentIds || [])]) {
    const meta = path.join(SUB, `agent-${id}.meta.json`), jl = path.join(SUB, `agent-${id}.jsonl`);
    if (!fs.existsSync(meta) || !fs.existsSync(jl)) { problems.push(`${id}: transcript missing`); continue; }
    if (!/"agentType":"check-reviewer"/.test(fs.readFileSync(meta, 'utf8'))) problems.push(`${id}: not a check-reviewer`);
    let min = Infinity;
    for (const line of fs.readFileSync(jl, 'utf8').split('\n')) { const m = /"timestamp":"([^"]+)"/.exec(line); if (m) min = Math.min(min, Date.parse(m[1])); }
    if (!(min <= drafted)) problems.push(`${id}: started after the record was drafted`);
  }
  if (problems.length) ok = false;
  console.log(recName, problems.length ? 'FAIL ' + problems.join('; ') : 'OK');
}
process.exitCode = ok ? 0 : 1;
