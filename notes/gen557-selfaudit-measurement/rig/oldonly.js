// GEN-602 margin measurement: how close do the TEN pre-GEN-557 patterns alone ever
// come to filling the 5-hit cap?
//
// READ THIS BEFORE QUOTING THE OUTPUT. This measures ONE of the two conjuncts a
// crowd-out event needs. A crowd-out requires old hits filling the budget AND a new
// pattern hit that gets starved; this script never looks at the new patterns, so its
// "within 1 of the cap" line is NOT a crowd-out near-miss. On 2026-08-03 it was read
// that way and used to flip a recommendation, before crowdout.js showed the one 4-hit
// message carries zero new-pattern hits and the true worst proximity is 3 of 5.
// Logged on GEN-58 as [proxy-metric-not-operationalizing-the-claim-it-settles].
// Use crowdout.js for any crowd-out claim; use this only for the old-set margin itself.
//
// Banked 2026-08-03 under GEN-616 from a session scratchpad. Re-baseline first
// (`node extract.js`) — the corpus shrinks as transcripts are pruned.
//   Result on the corpus of 2026-08-03 (files=164 turns=4464): fire 75;
//   distribution {1:69, 2:4, 3:1, 4:1}; max 4 of a 5 budget.
const lib = require('./lib.js');

const src = lib.hookSource();
const CUT_START = '  // -- GEN-557: verification-walkthrough narration.';
const i = src.indexOf(CUT_START);
const j = src.indexOf('\n];', i);
if (i === -1 || j === -1) throw new Error('cut anchors not found');
const oldOnly = src.slice(0, i) + src.slice(j + 1); // drop the GEN-557 comment + six patterns

// sanity: the six new pattern sources must be gone, the old ten still present
for (const probe of ['nothing to (?:correct|fix)', 'the complete set', 'holds as written']) {
  if (oldOnly.indexOf(probe) !== -1) throw new Error('new pattern still present: ' + probe);
}
if (oldOnly.indexOf('came back clean') === -1) throw new Error('old patterns lost');

const findOld = lib.compile(oldOnly);
const rows = lib.corpus();

const distOld = {};
let reach = 0, firedOld = 0, maxOld = 0, atRisk = 0, worst = [];
for (const r of rows) {
  if (!lib.reachable(r.t)) continue;
  reach++;
  const t = lib.scanText(r.t);
  const oh = findOld(t) || [];
  if (oh.length) {
    firedOld++;
    distOld[oh.length] = (distOld[oh.length] || 0) + 1;
    if (oh.length > maxOld) { maxOld = oh.length; }
    if (oh.length >= 4) { atRisk++; worst.push({ f: r.f, oh }); }
  }
}
console.log('reachable messages           :', reach);
console.log('fire on OLD ten only         :', firedOld);
console.log('OLD-only hit distribution    :', JSON.stringify(
  Object.keys(distOld).sort((a, b) => a - b).reduce((o, k) => (o[k] = distOld[k], o), {})));
console.log('max OLD-only hits on any msg :', maxOld, '(cap is 5)');
console.log('messages within 1 of the cap :', atRisk, '-- NOT crowd-out near-misses; see crowdout.js');
for (const w of worst.slice(0, 5)) console.log('  ', w.f, JSON.stringify(w.oh));
