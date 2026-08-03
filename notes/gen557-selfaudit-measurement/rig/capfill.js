// GEN-602 evidence: how often does the 5-hit cap in findSelfAudit actually fill on
// real traffic, with all 16 shipped patterns installed? Uses the harness so the
// detector is the LIVE one sliced out of the hook, not a reimplementation.
//
// Banked 2026-08-03 under GEN-616 from a session scratchpad. Re-baseline before
// comparing to any recorded figure: extract.js rebuilds the corpus and it SHRINKS
// over time as Claude Code prunes transcripts, so old and new numbers are not
// comparable. Run `node extract.js` first, then this.
//   Result on the corpus of 2026-08-03 (files=164 turns=4464 unparsable=0):
//   reachable 2,623; fire 190; distribution {1:172, 2:14, 3:2, 4:1, 5:1};
//   exactly 1 message reached the cap, and all five of its hits were GEN-557 phrases.
const lib = require('./lib.js');

const findSelfAudit = lib.compile(lib.hookSource());
const rows = lib.corpus();

let total = 0, reach = 0, fired = 0, capped = 0;
const dist = {};
const cappedSamples = [];

for (const r of rows) {
  total++;
  if (!lib.reachable(r.t)) continue;
  reach++;
  const hits = findSelfAudit(lib.scanText(r.t));
  if (!hits || !hits.length) continue;
  fired++;
  dist[hits.length] = (dist[hits.length] || 0) + 1;
  if (hits.length >= 5) {
    capped++;
    if (cappedSamples.length < 5) cappedSamples.push({ f: r.f, hits });
  }
}

console.log('corpus messages       :', total);
console.log('reachable (Phase 1)   :', reach);
console.log('messages that fire    :', fired);
console.log('hit-count distribution:', JSON.stringify(
  Object.keys(dist).sort((a, b) => a - b).reduce((o, k) => (o[k] = dist[k], o), {})));
console.log('messages AT the cap   :', capped);
for (const s of cappedSamples) console.log('  capped in', s.f, '->', JSON.stringify(s.hits));
