// Finding 2: durable coverage for ticket shape (a) — the "done, verified" roll-call.
const { corpus, reachable, scanText } = require('./lib.js');
const F = require('./fixtures.js');

const BARE = /\b(?:done|filed|shipped|applied|resolved)[,;]\s*(?:and\s+)?verified\b/i;              // v1 (rejected)
const BULLET = /^[ \t]*[-*]\s.*\b(?:done|filed|shipped|applied|resolved)[,;]\s*(?:and\s+)?verified\b/im; // cand A
const rows = corpus();

function count(re, text) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let n = 0, m; while ((m = g.exec(text)) !== null) { n++; if (m.index === g.lastIndex) g.lastIndex++; }
  return n;
}
function isQuoted(text, at) {
  const ls = text.lastIndexOf('\n', at - 1) + 1;
  const b = text.slice(ls, at);
  return ((b.match(/"/g) || []).length % 2 === 1) || ((b.match(/`/g) || []).length % 2 === 1) ||
         ((b.match(/“/g) || []).length - (b.match(/”/g) || []).length) > 0;
}
function firstUnquoted(re, text) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m; while ((m = g.exec(text)) !== null) { if (!isQuoted(text, m.index)) return m; if (m.index === g.lastIndex) g.lastIndex++; }
  return null;
}

const res = { bare: [], bullet: [], twoPlus: [] };
for (let i = 0; i < rows.length; i++) {
  const t = scanText(rows[i].t);
  if (!reachable(rows[i].t)) continue;
  if (firstUnquoted(BARE, t)) res.bare.push(i);
  const mb = firstUnquoted(BULLET, t);
  if (mb) res.bullet.push({ i, s: t.slice(mb.index, mb.index + 130).replace(/\s+/g, ' ') });
  if (count(BARE, t) >= 2) res.twoPlus.push(i);
}
console.log('reachable turns=' + rows.filter(r => reachable(r.t)).length);
console.log('BARE (v1, rejected)   fires on ' + res.bare.length + ' turns');
console.log('BULLET (cand A)       fires on ' + res.bullet.length + ' turns');
console.log('2+ BARE (cand B)      fires on ' + res.twoPlus.length + ' turns');
console.log('--- cand A hits ---');
res.bullet.forEach(x => console.log('  t' + x.i + ': ' + x.s));
console.log('--- fixtures (raw pattern level) ---');
for (const [k, v] of Object.entries(F)) {
  console.log('  ' + k + ': bullet=' + !!firstUnquoted(BULLET, v) + ' bareCount=' + count(BARE, v) +
              ' 2+=' + (count(BARE, v) >= 2));
}
