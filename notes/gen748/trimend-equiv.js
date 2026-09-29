'use strict';
// Prove String.prototype.trimEnd() removes exactly what .replace(/\s+$/, '') removes,
// for every BMP code unit, and compare their cost on a long internal whitespace run.
let same = true;
for (let code = 0; code < 0x10000; code++) {
  const ch = String.fromCharCode(code);
  const s = 'x' + ch + ch;
  if (s.replace(/\s+$/, '') !== s.trimEnd()) { same = false; console.log('DIFF at U+' + code.toString(16)); }
}
console.log('trimEnd === replace(/\\s+$/) for all BMP code units:', same);
const big = 'x \u{1F4CC}' + ' '.repeat(100000) + 'done';
let t = Date.now(); big.trimEnd(); console.log('trimEnd on pin+100K spaces+text:', Date.now() - t, 'ms');
t = Date.now(); big.replace(/\s+$/, ''); console.log('replace(/\\s+$/) on the same:', Date.now() - t, 'ms');
