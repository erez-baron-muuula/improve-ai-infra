// Hash every .ps1 in ~/.claude/scripts (normalized: UTF-8, LF) without naming any file on the command line.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const dir = 'C:/Users/Erez/.claude/scripts';
for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.ps1')).sort()) {
  const buf = fs.readFileSync(path.join(dir, f));
  const h = crypto.createHash('sha256').update(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8').digest('hex');
  console.log(h + '  ' + f + '  nonascii=' + buf.filter(b => b > 127).length + (buf[0] === 0xEF ? ' BOM' : ''));
}
