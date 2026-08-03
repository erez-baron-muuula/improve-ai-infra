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

const src = lib.hookSource();

// Split the array at the literal comment that opens the GEN-557 block: everything
// before it is the ten pre-GEN-557 patterns, everything from it is the six new ones.
const CUT = '  // -- GEN-557: verification-walkthrough narration.';
const i = src.indexOf(CUT);
if (i === -1) throw new Error('GEN-557 block-start comment not found — re-derive the cut');
const j = src.indexOf('\n];', i);
if (j === -1) throw new Error('array close not found after the cut');
const oldOnly = src.slice(0, i) + src.slice(j + 1);

// NEW-only: keep the six GEN-557 patterns, drop the ten older ones.
const FIRST = '  { re: /\\bI (?:verified';
const first = src.indexOf(FIRST);
if (first === -1) throw new Error('first pre-GEN-557 pattern not found — re-derive the cut');
const newOnly = src.slice(0, first) + src.slice(i);

const findOld = lib.compile(oldOnly);
const findNew = lib.compile(newOnly);
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
