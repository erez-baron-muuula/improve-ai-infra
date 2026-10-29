// GEN-889 / GEN-958 / GEN-990: builds the split notes files in notes/gen889/wc/refs/ from the
// LIVE refs files, moving whole blocks byte-for-byte (no rewording here), then checks that
// every original block appears exactly once across the two parts.
// Run: node make-split.js
const fs = require('fs');
const path = require('path');

const LIVE = 'C:/Users/Erez/.claude/hooks/refs';
const OUT = path.join(__dirname, 'wc', 'refs');
fs.mkdirSync(OUT, { recursive: true });

// Top-level blocks: the header line(s), each "- " bullet with its continuation lines, each
// "**...**" section line (with any blank line after it).
function blocks(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const starts = /^- /.test(line) || /^\*\*/.test(line) || out.length === 0;
    if (starts) out.push(line); else out[out.length - 1] += '\n' + line;
  }
  return out;
}

const cp = (s) => [...s].length;

function split(name, isPart2, part1Lead, part2Head) {
  const text = fs.readFileSync(path.join(LIVE, name + '.md'), 'utf8');
  const all = blocks(text);
  const head = all[0];
  const rest = all.slice(1);
  const p1 = rest.filter((b) => !isPart2(b));
  const p2 = rest.filter((b) => isPart2(b));
  return { text, all, head, p1, p2 };
}

// ---- windows-mcp: part 2 = troubleshooting after the first call ran ----
const W2_KEYS = ['**Pop-up dialogs are invisible to Snapshot.**', '**Stuck add-on (GEN-920/933).**', '**The add-on works in every folder.**'];
const w = split('windows-mcp', (b) => W2_KEYS.some((k) => b.startsWith('- ' + k)));
const wHead = w.head.replace(/\n+$/, '');
const wPart1 = wHead + ' Part 1 of 2; part 2, `C:/Users/Erez/.claude/hooks/refs/windows-mcp-troubleshooting.md` (pop-up dialogs Snapshot misses, a stuck add-on, use from any folder), arrives with the next PC-control call.\n\n' + w.p1.join('\n') + '\n';
const wPart2 = 'PC control (Windows-MCP add-on), part 2 of 2: troubleshooting. Part 1, `refs/windows-mcp.md`, arrived earlier in this session.\n\n' + w.p2.join('\n').replace(/\n+$/, '') + '\n';

// ---- browser: part 2 = the "Site notes" section ----
const b = (() => {
  const text = fs.readFileSync(path.join(LIVE, 'browser.md'), 'utf8');
  const all = blocks(text);
  const idx = all.findIndex((x) => x.startsWith('**Site notes.**'));
  return { text, all, head: all.slice(0, 2), p1: all.slice(2, idx), p2: all.slice(idx) };
})();
// b.head = [title line, "- Not Comet..." bullet]; keep both in part 1.
const bTitle = b.head[0].replace(/\n+$/, '');
const bPart1 = bTitle + ' Part 1 of 2; part 2, `C:/Users/Erez/.claude/hooks/refs/browser-sites.md` (notes for Gmail, Google Cloud, Apps Script, Google Admin, Snowsight, Tableau, JavaScript results), arrives with the next browser call.\n' + b.head.slice(1).concat(b.p1).join('\n').replace(/\n+$/, '') + '\n';
const bPart2 = 'Browser work, part 2 of 2: site notes. Part 1, `refs/browser.md`, arrived earlier in this session.\n\n' + b.p2.slice(1).join('\n').replace(/\n+$/, '') + '\n';

// Two cross-references that pointed at a neighbouring block now in the other part. These are the
// only wording changes inside moved blocks; each must match exactly once.
function fixRef(text, from, to) {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error('cross-reference fix expected 1 match, got ' + n + ': ' + from);
  return text.split(from).join(to);
}
const wPart1Fixed = fixRef(wPart1, 'No countdown may mean a stuck add-on (next item).', 'No countdown may mean a stuck add-on ("Stuck add-on" in part 2, `refs/windows-mcp-troubleshooting.md`).');
const bPart1Fixed = fixRef(bPart1, 'Insert through the editor\'s own view instead (below).', 'Insert through the editor\'s own view instead (Snowsight, in part 2, `refs/browser-sites.md`).');

const files = {
  'windows-mcp.md': wPart1Fixed,
  'windows-mcp-troubleshooting.md': wPart2,
  'browser.md': bPart1Fixed,
  'browser-sites.md': bPart2,
};
for (const [n, t] of Object.entries(files)) fs.writeFileSync(path.join(OUT, n), t, 'utf8');

// ---- coverage: every original block (minus the header lines, which are rewritten) appears
// exactly once across the two parts of its file.
function coverage(label, origBlocks, partsText) {
  let bad = 0;
  for (const blk of origBlocks) {
    const t = blk.replace(/\n+$/, '');
    if (!t.trim()) continue;
    const n = partsText.split(t).length - 1;
    if (n !== 1) { bad++; console.log('COVERAGE FAIL', label, n, JSON.stringify(t.slice(0, 60))); }
  }
  console.log(label, 'blocks checked:', origBlocks.length, bad ? 'FAIL ' + bad : 'all present exactly once');
  return bad;
}
// Coverage runs on the parts BEFORE the two cross-reference fixes (which are listed above).
let covFail = 0;
covFail += coverage('windows-mcp', w.all.slice(1), wPart1 + '\n' + wPart2);
covFail += coverage('browser', b.all.slice(1).filter((x) => !x.startsWith('**Site notes.**')), bPart1 + '\n' + bPart2);
if (covFail) process.exitCode = 1;

for (const [n, t] of Object.entries(files)) console.log(n, cp(t), 'characters');
console.log('originals: windows-mcp', cp(w.text), 'browser', cp(b.text));
