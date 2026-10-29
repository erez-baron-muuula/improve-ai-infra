// GEN-892: swap the inline PowerShell reader text in make-wc.js for ps-reader-block.txt (one-off edit helper).
'use strict';
const fs = require('fs');
const path = require('path');
const f = path.join(__dirname, 'make-wc.js');
let s = fs.readFileSync(f, 'utf8');
const start = s.indexOf("   '# The new value of the last applied row");
const endMarker = "   '    $lineLimit = $FALLBACK_RULES_LINE_CAP\\r\\n'],";
const end = s.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error('markers not found: ' + start + ' ' + end);
s = s.slice(0, start) +
  "   fs.readFileSync(path.join(__dirname, 'ps-reader-block.txt'), 'utf8')],\r\n".replace(/\r\n/g, s.includes('\r\n') ? '\r\n' : '\n') +
  s.slice(end + endMarker.length).replace(/^\r?\n/, '');
fs.writeFileSync(f, s, 'utf8');
console.log('patched; inline block was', end - start, 'characters');
