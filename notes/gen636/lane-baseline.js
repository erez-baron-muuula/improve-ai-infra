// GEN-636 row-8 calibration: first-pass rate of the unattended /wrap filing lane vs the rest.
// Read-only. Usage: node lane-baseline.js [stagingDir]
// A record is classed /wrap-lane when its searchSummary or filename says so (no source tag exists yet).
const fs = require('fs'), path = require('path'), os = require('os');
const dir = path.join(process.argv[2] || path.join(os.homedir(), '.claude-staging'), 'ticket-passes');
const lanes = { wrapBySummary: [], wrapByName: [], other: [] };
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.json') || f.includes('.consumed.')) continue;
  let r; try { r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8').replace(/^﻿/, '')); } catch (_) { continue; }
  if (!r || r.kind !== 'ticket-record') continue;
  const multi = Array.isArray(r.priorReviewerAgentIds) && r.priorReviewerAgentIds.filter(Boolean).length > 0;
  const s = String(r.searchSummary || '');
  const row = { f, multi, t: r.draftedUtc || '' };
  if (/unattended|\/wrap/i.test(s)) lanes.wrapBySummary.push(row);
  else if (/wrap/i.test(f)) lanes.wrapByName.push(row);
  else lanes.other.push(row);
}
for (const [k, rows] of Object.entries(lanes)) {
  const m = rows.filter(r => r.multi).length;
  console.log(k.padEnd(14), 'records', String(rows.length).padStart(4), 'multi-round', String(m).padStart(3),
    'first-pass rate', rows.length ? (1 - m / rows.length).toFixed(3) : 'n/a');
}
const all = [].concat(...Object.values(lanes));
const m = all.filter(r => r.multi).length;
console.log('all'.padEnd(14), 'records', String(all.length).padStart(4), 'multi-round', String(m).padStart(3), 'first-pass rate', (1 - m / all.length).toFixed(3));
// Low-tail check for the global lenient-reviewer bar: P(X <= k) for X ~ Binomial(40, p_multi).
const p = m / all.length, n = 40;
let cum = 0, c = 1;
for (let k = 0; k <= 4; k++) {
  if (k > 0) c = c * (n - k + 1) / k;
  cum += c * Math.pow(p, k) * Math.pow(1 - p, n - k);
  console.log('P(multi-round <= ' + k + ' of 40 | p=' + p.toFixed(3) + ') =', cum.toExponential(2));
}
