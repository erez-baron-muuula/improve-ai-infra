// GEN-892: build the working copy of notes/release-review/release-review-tool.js: header, requires, the
// guidelines-check block (tool-guidelines-block.js), the readout lines and the command table. Exact-text
// replacements, each matching once.
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'release-review', 'release-review-tool.js');
const DST = path.join(__dirname, 'wc', 'notes', 'release-review', 'release-review-tool.js');
const BLOCK = fs.readFileSync(path.join(__dirname, 'tool-guidelines-block.js'), 'utf8');

let text = fs.readFileSync(SRC, 'utf8');
const eol = text.includes('\r\n') ? '\r\n' : '\n';
function rep(from, to) {
  from = from.replace(/\r?\n/g, eol);
  to = to.replace(/\r?\n/g, eol);
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error('expected 1 match, found ' + n + ' for: ' + from.slice(0, 80));
  text = text.replace(from, () => to);
}

rep('// Everything here is read-only except `record-run`, which appends one line to runs.jsonl\n' +
    '// and rewrites state.json (both in this folder). No network call carries a credential.\n',
    '// Everything here is read-only except `record-run`, which appends one line to runs.jsonl\n' +
    '// and rewrites state.json (both in this folder), and `guidelines-check` (GEN-892, below), which\n' +
    '// writes guidelines-state.json and, with --apply, the limits file, its change log and page copies.\n' +
    '// No network call carries a credential.\n');
rep('//   readout\n' +
    '//       The one /wrap line (or nothing when there is nothing to report). Never throws:\n' +
    '//       prints "Release review: readout failed (<reason>)" instead.\n',
    '//   readout\n' +
    '//       The one /wrap line (or nothing when there is nothing to report). Never throws:\n' +
    '//       prints "Release review: readout failed (<reason>)" instead. Also prints the guidelines\n' +
    '//       watch\'s stored warnings and a stalled-watch alarm (GEN-892); a limit change it applied\n' +
    '//       is not shown here (it goes in the weekly digest).\n');
rep('// Sources: https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md\n',
    '//   guidelines-check [--apply] [--pages-dir <dir> --root <dir>]\n' +
    '//       GEN-892. Downloads Anthropic\'s 7 guideline pages and checks every anchored limit in\n' +
    '//       notes/anthropic-guidelines.json (an anchor is the exact words around the number on a page).\n' +
    '//       A plain run writes only release-review/guidelines-state.json (checkUtc, warnings; a found\n' +
    '//       change becomes the warning "change detected, not applied"). --apply (live runs) also sets\n' +
    '//       applyUtc, applies a changed number to the limits file (a row in guidelines-changes.jsonl\n' +
    '//       first, then the file, after the size checker has loaded it), and saves page copies under\n' +
    '//       release-review/docs/ (git-ignored) with their hashes. --root is the notes folder (default:\n' +
    '//       the real one); --pages-dir reads <id>.md test pages instead of downloading and is refused\n' +
    '//       unless --root is outside the project. Prints JSON { ok, apply, pages, unchanged, changes,\n' +
    '//       applied, candidates, textToUpdate, changedParagraphs, strayCopies, warnings }. Never throws;\n' +
    '//       exit 0.\n' +
    '//\n' +
    '// Sources: https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md\n');
rep("const https = require('https');\n",
    "const https = require('https');\n" +
    "const crypto = require('crypto');\n" +
    "const childProcess = require('child_process');\n");
rep("    if (parts.length) console.log(parts.join('\\n'));\n",
    "    parts.push(...guidelinesReadoutLines(now, live));\n" +
    "    if (parts.length) console.log(parts.join('\\n'));\n");
rep('const cmd = process.argv[2];\n', BLOCK.replace(/\r?\n/g, eol) + 'const cmd = process.argv[2];\n');
rep("const table = { collect: cmdCollect, verify: cmdVerify, installed: cmdInstalled, readout: cmdReadout, pending: cmdPending, 'record-run': cmdRecordRun };\n" +
    "if (!table[cmd]) die('usage: release-review-tool.js collect|verify|installed|readout|pending|record-run ...');\n",
    "const table = { collect: cmdCollect, verify: cmdVerify, installed: cmdInstalled, readout: cmdReadout, pending: cmdPending, 'record-run': cmdRecordRun, 'guidelines-check': cmdGuidelinesCheck };\n" +
    "if (!table[cmd]) die('usage: release-review-tool.js collect|verify|installed|readout|pending|record-run|guidelines-check ...');\n");

fs.mkdirSync(path.dirname(DST), { recursive: true });
fs.writeFileSync(DST, text, 'utf8');
console.log('wrote', DST);
