// Finding 1: full inventory of /\bnothing to (?:correct|fix)\b/i on real traffic.
const { corpus, reachable, scanText } = require('./lib.js');
const RE = /\bnothing to (?:correct|fix)\b/i;
const rows = corpus();

function isQuoted(text, at) {
  const lineStart = text.lastIndexOf('\n', at - 1) + 1;
  const before = text.slice(lineStart, at);
  const straight = (before.match(/"/g) || []).length;
  const ticks = (before.match(/`/g) || []).length;
  const smart = (before.match(/“/g) || []).length - (before.match(/”/g) || []).length;
  return (straight % 2 === 1) || (ticks % 2 === 1) || smart > 0;
}

const inst = [];
for (let i = 0; i < rows.length; i++) {
  const t = scanText(rows[i].t);
  const g = new RegExp(RE.source, 'gi');
  let m;
  while ((m = g.exec(t)) !== null) {
    const tail = t.slice(m.index + m[0].length).trim();
    inst.push({
      turn: i,
      reach: reachable(rows[i].t),
      quoted: isQuoted(t, m.index),
      tailLen: tail.length,
      closing: tail.replace(/[.\s)*_"'”—-]/g, '').length === 0,
      before: t.slice(Math.max(0, m.index - 110), m.index).replace(/\s+/g, ' '),
      hit: m[0],
      after: t.slice(m.index + m[0].length, m.index + m[0].length + 70).replace(/\s+/g, ' '),
    });
  }
}
const turnsWith = new Set(inst.map(x => x.turn)).size;
console.log('instances=' + inst.length + '  turns=' + turnsWith);
console.log('reachable instances=' + inst.filter(x => x.reach).length +
            '  in reachable turns=' + new Set(inst.filter(x => x.reach).map(x => x.turn)).size);
console.log('quoted=' + inst.filter(x => x.quoted).length);
console.log('closing (nothing after the phrase)=' + inst.filter(x => x.closing).length);
console.log('reachable & !quoted =' + inst.filter(x => x.reach && !x.quoted).length);
console.log('reachable & !quoted & closing =' + inst.filter(x => x.reach && !x.quoted && x.closing).length);
console.log('--- tailLen distribution (reachable & !quoted) ---');
const buckets = { '0': 0, '1-40': 0, '41-200': 0, '201-1000': 0, '>1000': 0 };
for (const x of inst.filter(y => y.reach && !y.quoted)) {
  const n = x.tailLen;
  if (n === 0) buckets['0']++; else if (n <= 40) buckets['1-40']++;
  else if (n <= 200) buckets['41-200']++; else if (n <= 1000) buckets['201-1000']++;
  else buckets['>1000']++;
}
console.log(JSON.stringify(buckets));
require('fs').writeFileSync(require('path').join(__dirname, 'f1-instances.json'), JSON.stringify(inst, null, 1));
