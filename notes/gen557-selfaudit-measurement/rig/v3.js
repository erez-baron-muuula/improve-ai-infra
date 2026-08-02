// v3 full measurement: fires added over baseline, per-pattern attribution,
// fixtures, and a ReDoS probe on the new bounded-gap roll-call pattern.
const { build, corpus, reachable, scanText } = require('./lib.js');
const F = require('./fixtures.js');
const rows = corpus();

const UNIT = '\\b(?:done|filed|shipped|applied|resolved)[,;]\\s*(?:and\\s+)?verified\\b';
const BULLET_UNIT = '^[ \\t]*[-*]\\s.*' + UNIT;
const ROLLCALL = BULLET_UNIT + '[\\s\\S]{0,400}?' + BULLET_UNIT;

const NEW = [
  '  { re: /\\u2713\\s*closed\\b/i, isNew: true },',
  '  { re: /\\bthat\'?s the complete set\\b/i, isNew: true },',
  '  { re: /\\bholds as written\\b/i, isNew: true },',
  '  { re: /\\bexhaustiveness claim\\b[^.\\n]{0,80}?\\b(?:holds|stands|is accurate|checks out|survives)\\b/i, isNew: true },',
  '  { re: /\\bnothing to (?:correct|fix)\\b/i, isNew: true },',
  '  { re: /' + ROLLCALL + '/im, isNew: true },',
];

const base = build([], 'none');
for (const scope of ['all', 'new']) {
  const v3 = build(NEW, scope);
  let bFire = 0, vFire = 0, added = [], lost = [];
  for (let i = 0; i < rows.length; i++) {
    if (!reachable(rows[i].t)) continue;
    const t = scanText(rows[i].t);
    const a = base(t).length > 0, b = v3(t).length > 0;
    if (a) bFire++; if (b) vFire++;
    if (!a && b) added.push(i);
    if (a && !b) lost.push(i);
  }
  console.log('=== quote-guard scope: ' + scope + ' ===');
  console.log('  production fires: baseline ' + bFire + ' -> v3 ' + vFire +
              '  (added ' + added.length + ', removed ' + lost.length + ')');
  console.log('  fixtures: ' + Object.entries(F).map(([k, v]) =>
    k + '=' + (v3(v).length > 0 ? 'FIRE(' + v3(v).length + ')' : 'silent')).join('  '));
  if (scope === 'all') {
    require('fs').writeFileSync(require('path').join(__dirname, 'v3-added.json'), JSON.stringify(added));
    console.log('  removed turns: ' + JSON.stringify(lost));
  }
}

// Which added turns are NOT explained by the fully-inspected `nothing to correct`?
const NTC = /\bnothing to (?:correct|fix)\b/i;
const added = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'v3-added.json'), 'utf8'));
const other = added.filter(i => !NTC.test(scanText(rows[i].t)));
console.log('\nadded turns NOT containing "nothing to correct|fix": ' + other.length);
console.log(JSON.stringify(other));

// ReDoS probe on the roll-call pattern: adversarial bullet lines that ALMOST match.
const re = new RegExp(ROLLCALL, 'im');
const evil = ('- ' + 'GEN-1 done, verifie'.repeat(1) + 'x'.repeat(180) + '\n').repeat(2000); // ~200k
const t0 = process.hrtime.bigint();
re.test(evil);
const t1 = process.hrtime.bigint();
const evil2 = '- x' + 'done, '.repeat(30000);
const t2 = process.hrtime.bigint();
re.test(evil2.slice(0, 200000));
const t3 = process.hrtime.bigint();
console.log('\nReDoS probe: 200k near-miss bullets ' + Number(t1 - t0) / 1e6 + 'ms; 200k "done," run ' +
            Number(t3 - t2) / 1e6 + 'ms');
