// The Edit tool turns a typed \uXXXX escape into the literal character; this puts the escape text back
// for U+2028 / U+2029 (line separators, which break a regex literal) in the working copy.
'use strict';
const fs = require('fs'), path = require('path');
const f = path.join(__dirname, 'wc', 'browser-site-gate.js');
let s = fs.readFileSync(f, 'utf8');
const bs = String.fromCharCode(92);
const before = s;
s = s.split(String.fromCharCode(0x2028)).join(bs + 'u2028').split(String.fromCharCode(0x2029)).join(bs + 'u2029');
fs.writeFileSync(f, s);
console.log('replaced', before.length !== s.length, 'left', [...s].filter(c => c === String.fromCharCode(0x2028) || c === String.fromCharCode(0x2029)).length);
