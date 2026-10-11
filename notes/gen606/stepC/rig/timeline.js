// Where does the For-you block land, by week: in a first-Stop reply (M, not continuation) or a continuation (MC)?
const fs = require('fs');
const path = require('path');
const rows = fs.readFileSync(path.join(__dirname, 'corpus.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const tab = {};
for (const r of rows) {
  if (!r.ts) continue;
  const wk = r.ts.slice(0, 7) + (parseInt(r.ts.slice(8, 10), 10) <= 15 ? 'a' : 'b');
  tab[wk] = tab[wk] || { all: 0, M: 0, MC: 0, C: 0, noPrompt: 0 };
  tab[wk].all++;
  if (r.marker && !r.continuation) tab[wk].M++;
  if (r.marker && r.continuation) tab[wk].MC++;
  if (r.continuation) tab[wk].C++;
  if (!r.promptFound) tab[wk].noPrompt++;
}
for (const k of Object.keys(tab).sort()) console.log(k, JSON.stringify(tab[k]));
