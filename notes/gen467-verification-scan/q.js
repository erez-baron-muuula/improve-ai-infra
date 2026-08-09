const r = require('./scan-out.json');
const which = process.argv[2] || 'conventionMiss';
const since = process.argv[3] || '2026-07-28';
const n = parseInt(process.argv[4] || '8', 10);
const c = r[which].filter(x => (x.ts || '') >= since);
console.log(which, 'since', since, 'n=', c.length);
c.slice(0, n).forEach(x => {
  console.log('---', x.ts, '|', require('path').basename(x.file));
  console.log('   prompt:', (x.prompt || '').replace(/\s+/g, ' ').slice(0, 140));
  if (x.tools) console.log('   tools:', x.tools.join(','));
  if (x.lastAsst) console.log('   lastAsst:', x.lastAsst.replace(/\s+/g, ' ').slice(0, 220));
});
