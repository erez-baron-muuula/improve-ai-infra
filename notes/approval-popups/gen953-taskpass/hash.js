// sha256 of a file's normalized content (UTF-8, LF line endings), as the vetting record binds it.
// Usage: node hash.js <file>
'use strict';
const fs = require('fs'), crypto = require('crypto');
const s = fs.readFileSync(process.argv[2], 'utf8').replace(/\r\n/g, '\n');
console.log(crypto.createHash('sha256').update(s, 'utf8').digest('hex'));
