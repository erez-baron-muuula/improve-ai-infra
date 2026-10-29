// GEN-892: save the pages downloaded on 2026-10-29 as the test suite's baseline pages (git-ignored).
'use strict';
const fs = require('fs');
const path = require('path');
const from = process.argv[2];
const to = path.join(__dirname, 'test-pages');
const map = { 'memory.md': 'memory.md', 'skills.md': 'skills.md', 'hooks.md': 'hooks.md', 'sub-agents.md': 'sub-agents.md',
  'large-codebases.md': 'large-codebases.md', 'best-practices.md': 'best-practices.md', 'bp.md': 'skill-best-practices.md' };
fs.mkdirSync(to, { recursive: true });
for (const [a, b] of Object.entries(map)) {
  fs.writeFileSync(path.join(to, b), fs.readFileSync(path.join(from, a)));
  console.log(b, fs.statSync(path.join(to, b)).size);
}
