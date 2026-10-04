// /vet-code Step 6 evidence precondition (read-only). Usage: node evidence-check.js <record.json> <working copy>
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const [rec, wc] = process.argv.slice(2);
const SUB = 'C:/Users/Erez/.claude/projects/C--Users-Erez-AI-Projects-Improve-AI-Infra/f460f324-f190-412b-aaf8-25a25d989044/subagents';
const r = JSON.parse(fs.readFileSync(rec, 'utf8'));
const hash = crypto.createHash('sha256').update(fs.readFileSync(wc, 'utf8').replace(/\r\n/g, '\n'), 'utf8').digest('hex');
const out = [];
out.push(['contentHash matches working copy', r.contentHash === hash]);
out.push(['checkVerdict converged', r.checkVerdict === 'converged']);
out.push(['checkReviewerAgentIds non-empty', Array.isArray(r.checkReviewerAgentIds) && r.checkReviewerAgentIds.length > 0]);
const drafted = Date.parse(r.draftedUtc);
for (const id of r.checkReviewerAgentIds || []) {
  const meta = path.join(SUB, 'agent-' + id + '.meta.json');
  const jl = path.join(SUB, 'agent-' + id + '.jsonl');
  let okType = false, minTs = Infinity;
  try { okType = JSON.parse(fs.readFileSync(meta, 'utf8')).agentType === 'check-reviewer'; } catch (e) {}
  try {
    for (const line of fs.readFileSync(jl, 'utf8').split('\n')) {
      if (!line) continue; try { const t = Date.parse(JSON.parse(line).timestamp); if (t < minTs) minTs = t; } catch (e) {}
    }
  } catch (e) {}
  out.push(['check-reviewer ' + id + ': type ok, ran before record', okType && minTs <= drafted]);
}
if (r.kind !== 'check-record') out.push(['passBAgentIds non-empty', Array.isArray(r.passBAgentIds) && r.passBAgentIds.length > 0]);
for (const id of r.passBAgentIds || []) {
  let okType = false;
  try { okType = JSON.parse(fs.readFileSync(path.join(SUB, 'agent-' + id + '.meta.json'), 'utf8')).agentType === 'check-reviewer'; } catch (e) {}
  let j = {};
  try { j = JSON.parse(execFileSync(process.execPath, ['C:/Users/Erez/.claude/hooks/stop-foryou-nudge.js', '--agent-transcript', path.join(SUB, 'agent-' + id + '.jsonl')], { encoding: 'utf8' })); } catch (e) { j = { error: String(e.message).slice(0, 80) }; }
  const names = (j.models || []).map(m => m.name);
  const ok = okType && j.error == null && j.allSidechain === true && names.length > 0 && names.every(n => n === 'opus') && (j.class === 'listed-at-above' || j.class === 'newer-in-family');
  out.push(['Pass B ' + id + ': ' + JSON.stringify({ models: (j.models || []).map(m => m.model || m.name), class: j.class }), ok]);
}
let bad = 0;
for (const [n, p] of out) { if (!p) bad++; console.log((p ? 'OK   ' : 'FAIL ') + n); }
console.log(bad ? bad + ' FAILED' : 'ALL OK');
