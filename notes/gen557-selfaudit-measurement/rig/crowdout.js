// GEN-602 evidence: TRUE crowd-out proximity. A crowd-out event needs BOTH enough
// old-pattern hits to fill the 5-slot budget AND at least one NEW-pattern hit that
// would be starved. Measuring old-only proximity to the cap (see oldonly.js) counts
// only one of those conjuncts and OVERSTATES the risk — that mistake was made on
// 2026-08-03, read as "within one hit of a crowd-out", and used to flip a
// recommendation before this script showed the real figure. Logged on GEN-58 as
// [proxy-metric-not-operationalizing-the-claim-it-settles]. Prefer this script over
// oldonly.js for any statement about crowd-out.
//
// Banked 2026-08-03 under GEN-616 from a session scratchpad. Re-baseline first
// (`node extract.js`) — the corpus shrinks as transcripts are pruned.
//   Result on the corpus of 2026-08-03 (files=164 turns=4464): 11 messages carry hits
//   from BOTH sets; combined distribution {2:10, 3:1}; worst combined 3 of a 5 budget.
//   The one 4-hit old-only message carries ZERO new-pattern hits, so it was never a
//   near-miss at all.
const lib = require('./lib.js');

// REPARTITIONED 2026-08-09 (GEN-467 fix pass): the previous comment-anchor text
// slicing silently fabricated an EMPTY old set once the GEN-602 reorder put the
// GEN-557 patterns first -- this script then reported both=0, a false all-clear.
// lib.patternPartition() splits by compiled pattern-source membership
// (order-independent) and throws loudly unless the counts are exactly 10 old /
// 6 GEN-557.
const { olds, news } = lib.patternPartition();
const findOld = lib.buildFrom(olds);
const findNew = lib.buildFrom(news);
const rows = lib.corpus();

let both = 0, worstCombined = 0, worstRow = null;
const combinedDist = {};
for (const r of rows) {
  if (!lib.reachable(r.t)) continue;
  const t = lib.scanText(r.t);
  const oh = findOld(t) || [], nh = findNew(t) || [];
  if (oh.length && nh.length) {
    both++;
    const c = oh.length + nh.length;
    combinedDist[c] = (combinedDist[c] || 0) + 1;
    if (c > worstCombined) { worstCombined = c; worstRow = { f: r.f, oh, nh }; }
  }
}
console.log('messages with BOTH old and new hits :', both);
console.log('their combined hit-count distribution:', JSON.stringify(combinedDist));
console.log('worst combined (budget is 5)         :', worstCombined);
if (worstRow) console.log('  ', worstRow.f, 'old=' + JSON.stringify(worstRow.oh), 'new=' + JSON.stringify(worstRow.nh));
