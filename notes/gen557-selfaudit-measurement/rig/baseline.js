const { build, corpus, reachable, scanText } = require('./lib.js');
const find = build([], 'none');
const rows = corpus();
let naive = 0, prod = 0, blockCarrying = 0;
for (const r of rows) {
  const t = scanText(r.t);
  const reach = reachable(r.t);
  if (!reach) blockCarrying++;
  const hits = find(t);
  if (hits.length) { naive++; if (reach) prod++; }
}
console.log('turns=' + rows.length);
console.log('block-carrying (detector never runs) = ' + blockCarrying +
            ' (' + (100 * blockCarrying / rows.length).toFixed(1) + '%)');
console.log('baseline fires: naive=' + naive + '  production=' + prod);
