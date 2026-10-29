// GEN-892: build the working copy of notes/anthropic-guidelines.json with each watched limit's anchors (the
// exact words around its number on Anthropic's pages) and the reworded _about. Targeted text insertions only;
// the result must parse to the original object plus those two changes.
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'anthropic-guidelines.json');
const DST = path.join(__dirname, 'wc', 'notes', 'anthropic-guidelines.json');

const ANCHORS = {
  'hook-injected-text': [
    { page: 'hooks', before: 'plain stdout, are capped at', after: 'characters' },
    { page: 'hooks', before: 'If a value exceeds', after: 'characters' },
  ],
  'skill-after-compaction': [
    { page: 'skills', before: 'keeping the first', after: 'tokens of each' },
  ],
  'skill-md-lines': [
    { page: 'skills', before: 'Keep `SKILL.md` under', after: 'lines' },
    { page: 'skill-best-practices', before: 'body under', after: 'lines' },
  ],
  'skill-description-listing': [
    { page: 'skills', before: 'is truncated at', after: 'characters in the skill listing' },
  ],
  'skill-description-portable': [
    { page: 'skill-best-practices', before: '`description`: Maximum', after: 'characters' },
  ],
  'claude-md-lines': [
    { page: 'memory', before: 'Files over', after: 'lines consume more context' },
    { page: 'memory', before: 'target under', after: 'lines per CLAUDE.md file' },
  ],
  'memory-md-load': [
    { page: 'memory', before: 'The first', after: 'lines of `MEMORY.md`', field: 'valueLines' },
    { page: 'memory', before: 'or the first', after: 'KB', field: 'valueBytes', scale: 1000 },
  ],
  'reference-file-toc': [
    { page: 'skill-best-practices', before: 'reference files longer than', after: 'lines' },
  ],
};

const ABOUT_OLD = 'Every number the scan uses comes from this file. Change it only in an attended session (Erez present), and re-verify each value against its source when you do.';
const ABOUT_NEW = 'Every number the scan uses comes from this file, and the hooks and the rules-file gate read the hook-injected-text, skill-after-compaction and claude-md-lines values (GEN-892). A limit with anchors (the exact words around its number on Anthropic\'s page) is updated automatically by the weekly guidelines watch (release-review-tool.js guidelines-check --apply), which logs each change in release-review/guidelines-changes.jsonl; the hooks and the gate accept a value above their built-in one only when that log carries it. Change anything else only in an attended session (Erez present), and re-verify each value against its source when you do. To stop or undo an automatic change, edit that limit\'s anchors: a hand edit of an anchored number is redone by the next weekly run.';

let text = fs.readFileSync(SRC, 'utf8');
const eol = text.includes('\r\n') ? '\r\n' : '\n';
const original = JSON.parse(text);

function once(hay, needle, label) {
  const n = hay.split(needle).length - 1;
  if (n !== 1) throw new Error(label + ': expected 1 match, found ' + n);
}

once(text, ABOUT_OLD, '_about');
text = text.replace(ABOUT_OLD, () => ABOUT_NEW);

for (const [id, anchors] of Object.entries(ANCHORS)) {
  const idAt = text.indexOf('"id": "' + id + '"');
  if (idAt < 0) throw new Error('no limit ' + id);
  const verRe = /("verified": "[0-9-]+")(\r?\n)(\s*)\}/g;
  verRe.lastIndex = idAt;
  const m = verRe.exec(text);
  if (!m) throw new Error('no verified line after ' + id);
  const nextId = text.indexOf('"id": "', idAt + 1);
  if (nextId >= 0 && m.index > nextId) throw new Error('verified line for ' + id + ' not inside its object');
  const ind = '      ';
  const lines = anchors.map((a, i) => ind + '  ' + JSON.stringify(a).replace(/":/g, '": ').replace(/,"/g, ', "').replace(/^\{/, '{ ').replace(/\}$/, ' }') + (i < anchors.length - 1 ? ',' : ''));
  const insert = m[1] + ',' + eol + ind + '"anchors": [' + eol + lines.join(eol) + eol + ind + ']' + m[2] + m[3] + '}';
  text = text.slice(0, m.index) + insert + text.slice(m.index + m[0].length);
}

const built = JSON.parse(text);
const expected = JSON.parse(JSON.stringify(original));
expected._about = original._about.replace(ABOUT_OLD, () => ABOUT_NEW);
for (const l of expected.limits) if (ANCHORS[l.id]) l.anchors = ANCHORS[l.id];
if (JSON.stringify(built) !== JSON.stringify(expected)) {
  const a = JSON.stringify(built), b = JSON.stringify(expected);
  let i = 0;
  while (a[i] === b[i]) i++;
  console.log('built   :', a.slice(Math.max(0, i - 80), i + 120));
  console.log('expected:', b.slice(Math.max(0, i - 80), i + 120));
  throw new Error('built file does not equal original + anchors + _about');
}
fs.mkdirSync(path.dirname(DST), { recursive: true });
fs.writeFileSync(DST, text, 'utf8');
console.log('wrote', DST, '- limits with anchors:', built.limits.filter(l => l.anchors).length, 'of', built.limits.length);
