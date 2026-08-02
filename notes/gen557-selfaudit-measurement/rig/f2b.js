// Finding 2, round 2: require a ROLL-CALL signature (2+ occurrences), per the panel's
// own suggestion. Three variants measured; plus quantify the BLOCK_OPENER_RE heading gap.
const { corpus, reachable, scanText } = require('./lib.js');
const F = require('./fixtures.js');
const rows = corpus();

const UNIT = '\\b(?:done|filed|shipped|applied|resolved)[,;]\\s*(?:and\\s+)?verified\\b';
const BULLET_UNIT = '^[ \\t]*[-*]\\s.*' + UNIT;
const CANDS = {
  'A  bullet x1      ': new RegExp(BULLET_UNIT, 'im'),
  'B  bare x2 (<=400)': new RegExp(UNIT + '[\\s\\S]{0,400}?' + UNIT, 'i'),
  'C  bullet x2      ': new RegExp(BULLET_UNIT + '[\\s\\S]{0,400}?' + BULLET_UNIT, 'im'),
};

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

for (const [name, re] of Object.entries(CANDS)) {
  const hits = [];
  for (let i = 0; i < rows.length; i++) {
    if (!reachable(rows[i].t)) continue;
    const m = firstUnquoted(re, scanText(rows[i].t));
    if (m) hits.push(i);
  }
  const fx = Object.entries(F).map(([k, v]) => k + '=' + !!firstUnquoted(re, v)).join(' ');
  console.log(name + ' fires=' + hits.length + ' turns=' + JSON.stringify(hits));
  console.log('                     ' + fx);
}

// --- side finding: does BLOCK_OPENER_RE see every real "For you" block opener? ---
const OPENER = /^[ \t]{0,3}\*{0,2}\u{1F4CC}[ \t]*\*{0,2}[ \t]*For you/imu;
const LOOSE = /^[^\S\n]{0,3}(?:#{1,6}[ \t]*)?(?:\*{0,2}|_{0,2})[ \t]*\u{1F4CC}[ \t]*\*{0,2}[ \t]*For you/imu;
function stripFences(t) { return t.replace(/```[\s\S]*?(?:```|$)/g, ''); }
let strict = 0, loose = 0, missedByStrict = [];
for (let i = 0; i < rows.length; i++) {
  const s = stripFences(scanText(rows[i].t));
  const a = OPENER.test(s), b = LOOSE.test(s);
  if (a) strict++;
  if (b) loose++;
  if (b && !a) missedByStrict.push(i);
}
console.log('\n--- BLOCK_OPENER_RE coverage ---');
console.log('strict (live regex) matches ' + strict + ' turns; loose (allows a markdown heading prefix) ' + loose);
console.log('block openers the LIVE guard misses: ' + missedByStrict.length + ' turns');
console.log('sample: ' + missedByStrict.slice(0, 8).map(i => 't' + i).join(' '));
for (const i of missedByStrict.slice(0, 3)) {
  const line = scanText(rows[i].t).split('\n').find(l => /\u{1F4CC}/u.test(l) && /For you/i.test(l));
  console.log('   t' + i + ': ' + JSON.stringify(line));
}
