// m-widen v2 -- closes the round-2 scope holes (pre-mortem NEW-2):
// * BOTH arms measured (turn-final AND non-final), union tail stats + per-arm max.
// * False-release candidates detected on BOTH arms, two ways:
//   - NON-BARE matched line (text after "For you" beyond ** wrappers) = discussion/quote shape.
//   - BARE line whose preceding non-empty line is NOT `---`/message-start/heading = block-unlike
//     placement, dumped for eyeball.
const fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/Erez/.claude/projects';
const CUTOFF = new Date('2026-07-19T00:00:00Z');
// SYNCED 2026-08-10 to the SHIPPED bounded form ([ \t]{0,16} runs; canonical
// copy: stop-claim-linter.js BLOCK_OPENER_RE) -- the original unbounded [ \t]*
// form measured a SUPERSET population, and the scheduled scan's Bar 5 mandates
// re-running this tool to re-size RELEASE_TAIL_WINDOW, so it must count with
// production's own recogniser. Re-sync on any canonical change. (The banked
// 407-match figures of 2026-08-09 were collected with the unbounded form;
// re-runs re-baseline, never compare.)
const WIDE = /^[ \t]{0,3}(?:#{1,6}[ \t]{0,16})?\*{0,2}(?:\u{1F4CC}[ \t]{0,16})+\*{0,2}[ \t]{0,16}For you/imu;
const BARE_LINE = /^(?:#{1,6}[ \t]{0,16})?\*{0,2}(?:\u{1F4CC}[ \t]{0,16})+\*{0,2}[ \t]{0,16}For you\*{0,2}[ \t]{0,16}$/u;
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
const all = [];       // every widened-opener match on every assistant message
const dedupe = new Set();
for (const p of files) {
  const entries = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  let turns = [], cur = null;
  for (const o of entries) {
    if (o.isSidechain) continue;
    if (isRealPrompt(o)) { cur = { ts: o.timestamp, items: [] }; turns.push(cur); continue; }
    if (!cur) continue;
    if (o.type === 'assistant') { const t = textOf(o); if (t.trim()) cur.items.push({ ts: o.timestamp, text: t }); }
  }
  for (const t of turns) {
    if (!t.ts || t.ts < SINCE) continue;
    const key = p + '|' + t.ts;
    if (dedupe.has(key)) continue; dedupe.add(key);
    t.items.forEach((m, i) => {
      const st = stripFences(m.text);
      if (!WIDE.test(st)) return;
      // last match position + its full line + preceding non-empty line
      const g = new RegExp(WIDE.source, WIDE.flags + 'g'); // flags derived, never retyped
      let mm, lastOff = -1;
      while ((mm = g.exec(st)) !== null) { lastOff = mm.index; if (mm.index === g.lastIndex) g.lastIndex++; }
      const lineEnd = st.indexOf('\n', lastOff);
      const line = st.slice(lastOff, lineEnd < 0 ? st.length : lineEnd).trim();
      const before = st.slice(0, lastOff).split('\n').map(s => s.trim()).filter(Boolean);
      const prev = before.length ? before[before.length - 1] : '(msg-start)';
      all.push({
        ts: m.ts, file: path.basename(p),
        final: i === t.items.length - 1,
        dist: st.length - lastOff,
        bare: BARE_LINE.test(line),
        prevIsHr: prev === '---' || prev === '(msg-start)',
        line: line.slice(0, 90), prev: prev.slice(0, 70)
      });
    });
  }
}
function pct(arr, q) { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; }
const fin = all.filter(a => a.final), non = all.filter(a => a.final === false);
const dAll = all.map(a => a.dist), dFin = fin.map(a => a.dist), dNon = non.map(a => a.dist);
console.log('ALL matches since', SINCE, '=', all.length, '(final', fin.length, '| non-final', non.length, ')');
console.log('tail dist UNION : p50=' + pct(dAll, .5), 'p90=' + pct(dAll, .9), 'p99=' + pct(dAll, .99), 'max=' + Math.max(...dAll));
console.log('tail dist final : max=' + (dFin.length ? Math.max(...dFin) : null), ' non-final: max=' + (dNon.length ? Math.max(...dNon) : null));
const nonBare = all.filter(a => !a.bare);
console.log('\nFALSE-RELEASE CANDIDATES, class 1 (non-bare matched line):', nonBare.length);
nonBare.forEach(a => console.log('  *', a.ts, a.file, a.final ? '[FINAL]' : '[nonfinal]', 'dist', a.dist, '::', a.line));
const oddPlace = all.filter(a => a.bare && !a.prevIsHr);
console.log('\nFALSE-RELEASE CANDIDATES, class 2 (bare line, preceding line not ---/msg-start):', oddPlace.length);
oddPlace.forEach(a => console.log('  *', a.ts, a.file, a.final ? '[FINAL]' : '[nonfinal]', 'dist', a.dist, ':: prev="' + a.prev + '" line="' + a.line + '"'));
