const { corpus } = require('./lib.js');
const rows = corpus();
const i = parseInt(process.argv[2], 10);
const n = parseInt(process.argv[3] || '1200', 10);
const t = rows[i].t;
console.log('file=' + rows[i].f + ' len=' + t.length);
console.log(t.slice(0, n));
