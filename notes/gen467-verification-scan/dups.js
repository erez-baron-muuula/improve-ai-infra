const r = require('./scan-out.json');
const path = require('path');
const since = process.argv[2] || '2026-07-28';
const m = {}; r.dup.forEach(x => { const k = (x.ts || '').slice(0, 10); m[k] = (m[k] || 0) + 1; });
console.log('DUPLICATES by date:', JSON.stringify(m, null, 0));
console.log('');
const c = r.dup.filter(x => (x.ts || '') >= since).sort((a, b) => a.ts.localeCompare(b.ts));
console.log('=== duplicates since', since, '=>', c.length, '===');
for (const x of c) {
  console.log('\n########', x.ts, '|', path.basename(x.file), '| n=', x.n);
  console.log('PROMPT:', (x.prompt || '').replace(/\s+/g, ' ').slice(0, 160));
  x.excerpts.forEach((e, i) => {
    console.log(`  --block ${i + 1} @ ${e.ts}: ${(e.snip || '').replace(/\s+/g, ' ').slice(0, 380)}`);
  });
}
