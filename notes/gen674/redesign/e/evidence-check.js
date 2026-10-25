// GEN-674 option E, /vet-code Step 6 evidence precondition (read-only). For each gated target: the record
// exists, its contentHash equals the current normalized working copy, checkVerdict is converged, the reviewer
// ids are non-empty, and each reviewer transcript is on disk, is a check-reviewer run, and started at or before
// draftedUtc. Also checks that passBAgentIds is non-empty and each meta is a check-reviewer.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const REC_DIR = path.join(os.homedir(), '.claude-staging', 'vetting-passes');
const SUB = path.join(os.homedir(), '.claude', 'projects', 'C--Users-Erez-AI-Projects-Improve-AI-Infra', 'fcf033ca-3339-405a-8865-cf04273bee62', 'subagents');
const WC = path.join(__dirname, 'wc');
const TARGETS = process.argv.slice(2);
let ok = true;
const fail = m => { ok = false; console.log('FAIL', m); };
for (const name of TARGETS) {
  const recFile = path.join(REC_DIR, 'record-gen674e-' + name.replace(/[^a-z0-9]+/gi, '-') + '.json');
  let rec; try { rec = JSON.parse(fs.readFileSync(recFile, 'utf8')); } catch (e) { fail(name + ': no record'); continue; }
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(WC, name), 'utf8').replace(/\r\n/g, '\n'), 'utf8').digest('hex');
  if (rec.contentHash !== hash) fail(name + ': contentHash differs from the working copy');
  if (rec.checkVerdict !== 'converged') fail(name + ': verdict not converged');
  if (!Array.isArray(rec.checkReviewerAgentIds) || !rec.checkReviewerAgentIds.length) fail(name + ': no reviewer ids');
  if (!Array.isArray(rec.passBAgentIds) || !rec.passBAgentIds.length) fail(name + ': no Pass B ids');
  const drafted = Date.parse(rec.draftedUtc);
  for (const id of rec.checkReviewerAgentIds || []) {
    let meta; try { meta = JSON.parse(fs.readFileSync(path.join(SUB, 'agent-' + id + '.meta.json'), 'utf8')); } catch (e) { fail(name + ': no meta for ' + id); continue; }
    if (meta.agentType !== 'check-reviewer') fail(name + ': ' + id + ' is ' + meta.agentType);
    let min = Infinity;
    for (const ln of fs.readFileSync(path.join(SUB, 'agent-' + id + '.jsonl'), 'utf8').split('\n')) {
      if (!ln.trim()) continue;
      try { const t = Date.parse(JSON.parse(ln).timestamp); if (t < min) min = t; } catch (e) { /* skip */ }
    }
    if (!(min <= drafted)) fail(name + ': ' + id + ' earliest ' + new Date(min).toISOString() + ' is after draftedUtc ' + rec.draftedUtc);
  }
  for (const id of rec.passBAgentIds || []) {
    let meta; try { meta = JSON.parse(fs.readFileSync(path.join(SUB, 'agent-' + id + '.meta.json'), 'utf8')); } catch (e) { fail(name + ': no Pass B meta for ' + id); continue; }
    if (meta.agentType !== 'check-reviewer') fail(name + ': Pass B ' + id + ' is ' + meta.agentType);
  }
  console.log('checked', name, rec.target);
}
console.log(ok ? 'EVIDENCE OK' : 'EVIDENCE FAILED');
process.exit(ok ? 0 : 1);
