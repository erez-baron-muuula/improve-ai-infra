// Finding 3: isQuoted scope. Measures the SUPPRESSION direction on the 10 shipped
// patterns (what the guard removes) so the false-negative risk is no longer unmeasured.
const { build, corpus, reachable, scanText } = require('./lib.js');
const rows = corpus();
const base = build([], 'none');
const guardAll = build([], 'all');

const changed = [];
for (let i = 0; i < rows.length; i++) {
  if (!reachable(rows[i].t)) continue;
  const t = scanText(rows[i].t);
  const a = base(t), b = guardAll(t);
  if (a.length === b.length && a.every((x, k) => x === b[k])) continue;
  const gone = a.filter(x => !b.includes(x));
  changed.push({ i, before: a.length, after: b.length, gone });
}
console.log('reachable turns where the quote guard changes the SHIPPED patterns: ' + changed.length);
const silenced = changed.filter(c => c.after === 0);
console.log('  ...of which fire -> silent entirely: ' + silenced.length);
console.log('  ...of which only lose some hits (still fires): ' + (changed.length - silenced.length));

// For each fully-silenced turn, show the line the suppressed hit sat on, so the
// suppression can be judged right or wrong.
for (const c of silenced) {
  const t = scanText(rows[c.i].t);
  console.log('\n[t' + c.i + '] suppressed: ' + JSON.stringify(c.gone));
  for (const h of c.gone) {
    const at = t.toLowerCase().indexOf(h.toLowerCase());
    if (at < 0) continue;
    const ls = t.lastIndexOf('\n', at - 1) + 1;
    let le = t.indexOf('\n', at); if (le < 0) le = t.length;
    console.log('    line: ' + JSON.stringify(t.slice(ls, Math.min(le, ls + 300))));
  }
}
