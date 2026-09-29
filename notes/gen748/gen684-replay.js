// GEN-684: old vs new MARKER_RE over every real assistant text block in all main
// transcripts (and sub-agent transcripts, as extra breadth). Regexes are DERIVED
// from source files when given (argv: <file-with-new-regex>), else the proposed literal.
'use strict';
const fs = require('fs');
const path = require('path');
const OLD = /\u{1F4CC}\s*\*{0,2}\s*For you/u;
let NEW = /\u{1F4CC}\uFE0F?\s{0,64}\*{0,2}\s{0,64}For you/u;
if (process.argv[2]) {
  const src = fs.readFileSync(process.argv[2], 'utf8');
  const m = src.match(/const MARKER_RE = (\/.*\/[a-z]*);/);
  NEW = eval(m[1]);
  console.log('NEW derived from', process.argv[2], ':', NEW.toString());
}
const ROOT = 'C:\\Users\\Erez\\.claude\\projects';
const CAP = 300000; // old regex is quadratic on huge whitespace runs; real texts are far below the pathological shape
let texts = 0, oldN = 0, newN = 0, lost = [], gained = [], maxMs = 0, maxLen = 0, files = 0;
function scanFile(p) {
  let data; try { data = fs.readFileSync(p, 'utf8'); } catch (e) { return; }
  files++;
  for (const line of data.split('\n')) {
    if (line.indexOf('"assistant"') === -1) continue;
    let rec; try { rec = JSON.parse(line); } catch (e) { continue; }
    const m = rec && rec.message;
    if (!m || rec.type !== 'assistant' || !Array.isArray(m.content)) continue;
    for (const c of m.content) {
      if (!c || c.type !== 'text' || typeof c.text !== 'string' || !c.text) continue;
      texts++;
      const t = c.text;
      if (t.length > maxLen) maxLen = t.length;
      const o = OLD.test(t.length > CAP ? t.slice(0, CAP) : t);
      const t0 = process.hrtime.bigint();
      const n = NEW.test(t);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      if (ms > maxMs) maxMs = ms;
      if (o) oldN++;
      if (n) newN++;
      if (o && !n) lost.push(path.basename(path.dirname(p)).slice(-20) + '/' + path.basename(p).slice(0, 12));
      if (!o && n) gained.push(path.basename(path.dirname(p)).slice(-20) + '/' + path.basename(p).slice(0, 12) + ' :: ' + JSON.stringify(t.slice(Math.max(0, t.search(/\u{1F4CC}/u) - 10), t.search(/\u{1F4CC}/u) + 40)));
    }
  }
}
function walk(dir, depth) {
  let names; try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const d of names) {
    const p = path.join(dir, d.name);
    if (d.isDirectory() && depth < 3) walk(p, depth + 1);
    else if (d.isFile() && d.name.endsWith('.jsonl')) scanFile(p);
  }
}
walk(ROOT, 0);
console.log(JSON.stringify({ files, texts, oldMatches: oldN, newMatches: newN, lost: lost.length, gained: gained.length, maxNewMs: maxMs.toFixed(3), maxTextLen: maxLen }));
lost.forEach((x) => console.log('LOST', x));
gained.slice(0, 20).forEach((x) => console.log('GAINED', x));
