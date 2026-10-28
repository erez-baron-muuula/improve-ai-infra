// sha256 of a file's normalized content (UTF-8, LF line endings), as /vet-code's record binds it.
// Usage: node hash.js <file>
'use strict';
const s = require('fs').readFileSync(process.argv[2], 'utf8').replace(/\r\n/g, '\n');
console.log(require('crypto').createHash('sha256').update(s, 'utf8').digest('hex'));
