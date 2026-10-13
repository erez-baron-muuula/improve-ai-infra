// GEN-636 baseline counter: reproduces the numbers the readout's bars were calibrated on.
// Read-only. Usage: node baseline.js [stagingDir]   (default: ~/.claude-staging)
// Joins every `approve` event in ticket-gate-events.jsonl to its Step-4 ticket-record
// (kind:"ticket-record", contentHash == event hash) in ticket-passes/. Rate windows use the SAME
// definition as the readout: the 40 most recent MATCHED approves (an unmatched approve has no record,
// so it cannot be classed single- or multi-round; row 10 counts those separately).
const fs = require('fs'), path = require('path'), os = require('os');
const staging = process.argv[2] || path.join(os.homedir(), '.claude-staging');
const W = 40;

const events = fs.readFileSync(path.join(staging, 'ticket-gate-events.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
const recs = {};
for (const f of fs.readdirSync(path.join(staging, 'ticket-passes'))) {
  if (!f.endsWith('.json') || f.includes('.consumed.')) continue;
  let r; try { r = JSON.parse(fs.readFileSync(path.join(staging, 'ticket-passes', f), 'utf8').replace(/^﻿/, '')); } catch (_) { continue; }
  if (r && r.kind === 'ticket-record' && typeof r.contentHash === 'string') recs[r.contentHash.trim().toLowerCase()] = r;
}
const approves = events.filter(e => e.event === 'approve');
const rows = approves.map(e => {
  const r = recs[String(e.hash || '').toLowerCase()];
  return { ts: e.ts, waived: e.waived === true, matched: !!r,
           multi: !!r && Array.isArray(r.priorReviewerAgentIds) && r.priorReviewerAgentIds.filter(Boolean).length > 0 };
});
const sum = (a, k) => a.reduce((n, x) => n + (x[k] ? 1 : 0), 0);
console.log('events', events.length, 'approves', approves.length, 'ticket-records', Object.keys(recs).length);
console.log('lifetime: waived', sum(rows, 'waived'), 'matched', sum(rows, 'matched'), 'multi-round (matched)', sum(rows, 'multi'));
const byEvent = {}, byReason = {};
for (const e of events) { byEvent[e.event] = (byEvent[e.event] || 0) + 1; if (e.event === 'block') byReason[e.reason] = (byReason[e.reason] || 0) + 1; }
console.log('by event', JSON.stringify(byEvent), 'blocks by reason', JSON.stringify(byReason));

function windows(seq, k) { const v = []; for (let i = W; i <= seq.length; i++) v.push(sum(seq.slice(i - W, i), k)); return v; }
const matched = rows.filter(r => r.matched);
for (const [label, seq, k] of [['waived (all approves)', rows, 'waived'], ['multi-round (matched approves)', matched, 'multi']]) {
  const v = windows(seq, k);
  if (!v.length) continue;
  console.log('rolling-' + W + ' ' + label + ': windows', v.length, 'min', Math.min(...v), 'max', Math.max(...v), 'latest', v[v.length - 1]);
  if (k === 'multi') {
    console.log('  windows with > 10 (design 1-in-4 bar):', v.filter(x => x > 10).length,
                '| > 16 (row 7 high bar):', v.filter(x => x > 16).length,
                '| <= 2 (row 8 low bar):', v.filter(x => x <= 2).length);
  }
}
const unm = [];
for (let i = W; i <= rows.length; i++) unm.push(W - sum(rows.slice(i - W, i), 'matched'));
if (unm.length) console.log('rolling-' + W + ' unmatched (all approves): min', Math.min(...unm), 'max', Math.max(...unm), 'latest', unm[unm.length - 1]);
