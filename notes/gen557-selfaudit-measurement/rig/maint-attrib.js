// Is the guard-reason fixture failure pre-existing, or introduced by this change?
// Runs the LIVE detector over the claim-linter note text that the fixture flagged.
const fs = require('fs');
const START = 'const SELF_AUDIT_PATTERNS = [';
const END = '// Durable, append-only log of self-audit detections';
function load(f) {
  const s = fs.readFileSync(f, 'utf8');
  return new Function(s.slice(s.indexOf(START), s.indexOf(END)) + '\n; return findSelfAudit;')();
}
const live = load('C:\\Users\\Erez\\.claude\\hooks\\stop-claim-linter.js');
const work = load(require('path').join(__dirname, 'working.js'));

// The exact clause, copied from live hook lines 740-742.
const clause = 'the "\u{1F4CC} For you" block this turn owes -- carried as though the fact ' +
  'had always read that way -- or, where no block is owed or one already went ' +
  'out, stated briefly as ordinary content.';

console.log('live detector on the claim-linter note clause : ' + JSON.stringify(live(clause)));
console.log('working detector on the same clause           : ' + JSON.stringify(work(clause)));
// Confirm the note region itself is untouched by this change. The source stores the
// note as concatenated literals, so compare the SOURCE region, not the assembled string.
const a = fs.readFileSync('C:\\Users\\Erez\\.claude\\hooks\\stop-claim-linter.js', 'utf8');
const b = fs.readFileSync(require('path').join(__dirname, 'working.js'), 'utf8');
function region(s) {
  const i = s.indexOf("      'Claim-linter, automatic: the prior turn stated ' + quoted +");
  const j = s.indexOf('if (noteParts.length > 0)', i);
  return i < 0 || j < 0 ? null : s.slice(i, j);
}
const ra = region(a), rb = region(b);
console.log('note region found in both                    : ' + (!!ra && !!rb));
console.log('note region byte-identical live vs working   : ' + (ra === rb));
