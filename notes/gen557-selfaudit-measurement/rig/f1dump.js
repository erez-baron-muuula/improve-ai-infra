const inst = require('./f1-instances.json').filter(x => x.reach && !x.quoted);
const a = parseInt(process.argv[2] || '0', 10), b = parseInt(process.argv[3] || '45', 10);
inst.slice(a, b).forEach((x, i) => {
  console.log('[' + (a + i) + '] t' + x.turn + ' tail=' + x.tailLen);
  console.log('    ...' + x.before + ' >>' + x.hit + '<< ' + x.after);
});
console.log('total=' + inst.length);
