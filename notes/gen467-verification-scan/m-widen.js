// Measure what WIDENING BLOCK_OPENER_RE would do, over real transcripts (mtime > 2026-07-19).
// M1: false-release population -- assistant messages matching the WIDENED opener that are
//     NOT their turn's final block carrier (candidate false releases / early duplicates),
//     with the matched line text for eyeball classification.
// M2: turns whose block-carrying message matches ONLY the widened regex (not the current one)
//     AND got a Phase-1 claim-linter/self-audit note at the same Stop -- the continuations
//     Part 2 would remove.
// M3: distance-from-message-end of the LAST opener match, split by turn-final vs non-final
//     messages -- to size a tail-anchoring window for markReleased.
const fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/Erez/.claude/projects';
const CUTOFF = new Date('2026-07-19T00:00:00Z');
const CURRENT = /^[ \t]{0,3}\*{0,2}\u{1F4CC}[ \t]*\*{0,2}[ \t]*For you/imu;               // live :659
const WIDE = /^[ \t]{0,3}(?:#{1,6}[ \t]*)?\*{0,2}(?:\u{1F4CC}[ \t]*)+\*{0,2}[ \t]*For you/imu; // proposed
const stripFences = t => t.replace(/```[\s\S]*?(?:```|$)/g, '');
function textOf(o) {
  const c = o.message && o.message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(x => (x.type === 'text' ? x.text : '')).join('\n');
  return '';
}
function isTR(o) { const c = o.message && o.message.content; return Array.isArray(c) && c.some(x => x.type === 'tool_result'); }
function isRealPrompt(o) {
  if (o.type !== 'user' || o.isMeta || isTR(o)) return false;
  const t = textOf(o); if (!t) return false;
  return !t.startsWith('<local-command-stdout>') && t.trim() !== '[Request interrupted by user]';
}
let files = [];
for (const r of fs.readdirSync(ROOT)) {
  const rp = path.join(ROOT, r);
  if (!fs.statSync(rp).isDirectory()) continue;
  for (const f of fs.readdirSync(rp)) {
    if (!f.endsWith('.jsonl')) continue;
    const p = path.join(rp, f);
    if (fs.statSync(p).mtime > CUTOFF) files.push(p);
  }
}
const SINCE = '2026-07-28';
const nonFinalMatches = [];           // M1 candidates
const tailFinal = [], tailNonFinal = []; // M3
let m2 = { wideOnlyBlocks: 0, withNote: 0, samples: [] };
const dedupe = new Set();
for (const p of files) {
  const entries = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  let turns = [], cur = null;
  for (const o of entries) {
    if (o.isSidechain) continue;
    if (isRealPrompt(o)) { cur = { ts: o.timestamp, items: [] }; turns.push(cur); continue; }
    if (!cur) continue;
    if (o.type === 'assistant') { const t = textOf(o); if (t.trim()) cur.items.push({ k: 'a', ts: o.timestamp, text: t }); }
    else if (o.type === 'attachment' || (o.type === 'user' && o.isMeta)) {
      const j = o.type === 'attachment' ? JSON.stringify(o.attachment || o) : textOf(o);
      if (/Claim-linter, automatic|Self-audit, automatic/.test(j)) cur.items.push({ k: 'note', ts: o.timestamp });
    }
  }
  for (const t of turns) {
    if (!t.ts || t.ts < SINCE) continue;
    const key = p + '|' + t.ts;
    if (dedupe.has(key)) continue; dedupe.add(key);
    const msgs = t.items.filter(i => i.k === 'a');
    const matched = msgs.map((m, i) => {
      const st = stripFences(m.text);
      return { i, m, st, wide: WIDE.test(st), cur: CURRENT.test(st) };
    }).filter(x => x.wide);
    if (!matched.length) continue;
    const lastMatchIdx = matched[matched.length - 1].i;
    for (const x of matched) {
      // last opener match offset from end (on fence-stripped text)
      const g = new RegExp(WIDE.source, 'gimu');
      let mm, lastOff = -1;
      while ((mm = g.exec(x.st)) !== null) { lastOff = mm.index; if (mm.index === g.lastIndex) g.lastIndex++; }
      const dist = x.st.length - lastOff;
      const isFinalCarrier = (x.i === lastMatchIdx) && (x.i === msgs.length - 1);
      (isFinalCarrier ? tailFinal : tailNonFinal).push(dist);
      if (!isFinalCarrier) {
        const line = (x.st.slice(lastOff).split('\n')[0] || '').trim().slice(0, 90);
        nonFinalMatches.push({ ts: x.m.ts, file: path.basename(p), curAlso: x.cur, line, dist,
          pos: x.i + 1 + '/' + msgs.length });
      }
    }
    // M2: block message recognized ONLY by the widened regex, with a Phase-1 note after it
    const firstWideOnly = matched.find(x => !x.cur);
    if (firstWideOnly) {
      m2.wideOnlyBlocks++;
      const idxInItems = t.items.indexOf(firstWideOnly.m ? t.items.find(i => i === firstWideOnly.m) : null);
      const after = t.items.slice(t.items.findIndex(i => i.text === firstWideOnly.m.text) + 1);
      if (after.some(i => i.k === 'note')) { m2.withNote++; if (m2.samples.length < 8) m2.samples.push(firstWideOnly.m.ts + ' ' + path.basename(p)); }
    }
  }
}
function pct(arr, q) { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; }
console.log('M1: non-final widened-opener matches since', SINCE, '=', nonFinalMatches.length);
for (const n of nonFinalMatches) console.log('  *', n.ts, n.file, 'msg', n.pos, n.curAlso ? '[ALSO-CURRENT]' : '[WIDE-ONLY]', 'dist', n.dist, '::', n.line);
console.log('\nM2: wide-only block messages since', SINCE, '=', m2.wideOnlyBlocks, '| followed by a Phase-1 note (continuation Part 2 removes) =', m2.withNote);
m2.samples.forEach(s => console.log('   note-sample:', s));
console.log('\nM3: last-match distance from message end (fence-stripped chars)');
console.log('  turn-final carriers  n=' + tailFinal.length, 'p50=' + pct(tailFinal, 0.5), 'p90=' + pct(tailFinal, 0.9), 'p99=' + pct(tailFinal, 0.99), 'max=' + (tailFinal.length ? Math.max(...tailFinal) : null));
console.log('  non-final matches    n=' + tailNonFinal.length, 'p50=' + pct(tailNonFinal, 0.5), 'p90=' + pct(tailNonFinal, 0.9), 'min=' + (tailNonFinal.length ? Math.min(...tailNonFinal) : null));
