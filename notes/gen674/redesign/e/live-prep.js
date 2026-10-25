// GEN-674 option E live test prep: a byte-equal scratch copy of the real rules file (measured as the rules file
// by update-config.ps1, but not the real file, so no approval record is ever written for it) and a grown version
// with 15 more lines. Read-then-write only; prints line counts and whether the copy is byte-equal.
'use strict';
const fs = require('fs');
const path = require('path');
const DIR = 'C:/Users/Erez/AppData/Local/Temp/claude/C--Users-Erez--claude-spares-spare-Y4wyke/fcf033ca-3339-405a-8865-cf04273bee62/scratchpad/live';
fs.mkdirSync(DIR, { recursive: true });
const real = fs.readFileSync('C:/Users/Erez/.claude/CLAUDE.md');
const copy = path.join(DIR, 'rules-copy.md');
fs.writeFileSync(copy, real);
const grown = real.toString('utf8') + Array.from({ length: 15 }, (_, i) => '- live test line ' + (i + 1)).join('\n') + '\n';
fs.writeFileSync(path.join(DIR, 'rules-grown.md'), grown);
const lines = s => (s.match(/\n/g) || []).length + (s.length && !s.endsWith('\n') ? 1 : 0);
console.log('copy byte-equal:', Buffer.compare(fs.readFileSync(copy), real) === 0, 'lines', lines(real.toString('utf8')), '-> grown', lines(grown));
