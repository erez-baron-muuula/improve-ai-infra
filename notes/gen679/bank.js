// GEN-679 banking script: byte-copies the session-scratchpad working set into this
// repo folder so a NEW session can pick the /vet-code flow up cold (the scratchpad
// is session-specific and may be cleaned). Run once from anywhere: node bank.js
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = 'C:\\Users\\Erez\\AppData\\Local\\Temp\\claude\\C--Users-Erez-AI-Projects-Improve-AI-Infra\\46d53865-4d29-46cc-af15-9ba2c3d36c0c\\scratchpad\\gen679';
const DST = __dirname;

const items = [
  ['stop-signal-surface.js', 'working\\stop-signal-surface.js'],
  ['gen679.diff', 'working\\gen679.diff'],
  ['doc-edits.md', 'working\\doc-edits.md'],
  ['rig\\livefire.js', 'rig\\livefire.js'],
  ['rig\\consume.js', 'rig\\consume.js'],
  ['rig\\copier.js', 'rig\\copier.js'],
];
const crypto = require('crypto');
for (const [from, to] of items) {
  const dst = path.join(DST, to);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, fs.readFileSync(path.join(SRC, from)));
  console.log(to + '  sha12=' + crypto.createHash('sha256').update(fs.readFileSync(dst)).digest('hex').slice(0, 12));
}
// Normalized (LF) hash of the working hook -- must match the vetting record's contentHash.
const norm = fs.readFileSync(path.join(DST, 'working', 'stop-signal-surface.js'), 'utf8').replace(/\r\n/g, '\n');
console.log('working hook normalized sha256=' + crypto.createHash('sha256').update(Buffer.from(norm, 'utf8')).digest('hex'));
console.log('BANK-OK');
