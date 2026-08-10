// Final corpus replay: regexes DERIVED from the working claim-linter source.
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync('C:\\Users\\Erez\\AI Projects\\Improve AI Infra\\notes\\gen467-recut\\working\\stop-claim-linter.js', 'utf8');
const NARROW = eval(src.match(/const BLOCK_OPENER_RE = (\/.*\/[a-z]*);/)[1]);
const WIDE = eval(src.match(/const WIDE_OPENER_RE = (\/.*\/[a-z]*);/)[1]);
const stripFences = t => t.replace(/```[\s\S]*?(?:```|$)/g, '');
const ROOT = 'C:\\Users\\Erez\\.claude\\projects';
const SINCE = new Date('2026-07-28T00:00:00Z').getTime();
let msgs = 0, narrowN = 0, wideOnly = 0, blockShaped = 0;
const other = [];
for (const slug of fs.readdirSync(ROOT)) {
  const dir = path.join(ROOT, slug);
  let entries; try { entries = fs.readdirSync(dir); } catch (e) { continue; }
  for (const f of entries) {
    if (!f.endsWith('.jsonl')) continue;
    const p = path.join(dir, f);
    let st; try { st = fs.statSync(p); } catch (e) { continue; }
    if (st.mtimeMs < SINCE || !st.isFile()) continue;
    let lines; try { lines = fs.readFileSync(p, 'utf8').split('\n'); } catch (e) { continue; }
    for (const line of lines) {
      if (!line.includes('"assistant"')) continue;
      let rec; try { rec = JSON.parse(line); } catch (e) { continue; }
      const m = rec && rec.message;
      if (!m || m.role !== 'assistant' || !Array.isArray(m.content)) continue;
      for (const c of m.content) {
        if (!c || c.type !== 'text' || typeof c.text !== 'string' || !c.text) continue;
        msgs++;
        const s = stripFences(c.text);
        if (NARROW.test(s)) { narrowN++; continue; }
        const g = new RegExp(WIDE.source, WIDE.flags.includes('g') ? WIDE.flags : WIDE.flags + 'g');
        const mm = g.exec(s);
        if (!mm) continue;
        wideOnly++;
        const before = s.slice(0, mm.index);
        if (/^\s*$/.test(before) || /-{3,}\s*$/.test(before.trimEnd())) blockShaped++;
        else other.push(slug.slice(-15) + '/' + f.slice(0, 8) + ' @' + mm.index + ' [' + before.slice(-60).replace(/\n/g, '~') + ']');
      }
    }
  }
}
console.log(JSON.stringify({ msgs, narrow: narrowN, wideOnly, blockShaped, other: other.length }));
other.forEach(o => console.log('-', o));
