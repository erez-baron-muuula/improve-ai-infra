// GEN-674 option E live test: is the scratch copy still byte-equal to the real rules file, and how many lines
// do the scratch copy and the real file have? Also confirms no approval record was written. Read-only.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const DIR = 'C:/Users/Erez/AppData/Local/Temp/claude/C--Users-Erez--claude-spares-spare-Y4wyke/fcf033ca-3339-405a-8865-cf04273bee62/scratchpad/live';
const real = fs.readFileSync('C:/Users/Erez/.claude/CLAUDE.md');
const copy = fs.readFileSync(path.join(DIR, 'rules-copy.md'));
const lines = b => { const s = b.toString('utf8'); return (s.match(/\n/g) || []).length + (s.length && !s.endsWith('\n') ? 1 : 0); };
console.log('copy byte-equal to real:', Buffer.compare(copy, real) === 0, '| copy lines', lines(copy), '| real lines', lines(real));
console.log('approval record exists:', fs.existsSync(path.join(os.homedir(), '.claude-staging', 'rules-size', 'record.json')));
