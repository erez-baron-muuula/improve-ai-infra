// GEN-703: time from the first real user message to the first assistant record, per session transcript.
// Usage: node first-reply-gap.js [sinceISO]   (default: the 25 most recent sessions)
// Baseline before the change (2026-10-20, 25 sessions): median 11.5 s, range 4.6-17.3 s.
const fs = require('fs');
const path = require('path');
const since = process.argv[2] ? Date.parse(process.argv[2]) : null;
const root = path.join(process.env.USERPROFILE, '.claude', 'projects');
const files = [];
for (const d of fs.readdirSync(root)) {
  let ents;
  try { ents = fs.readdirSync(path.join(root, d)); } catch (e) { continue; }
  for (const f of ents) if (f.endsWith('.jsonl')) { const p = path.join(root, d, f); files.push({ p, m: fs.statSync(p).mtimeMs }); }
}
files.sort((a, b) => b.m - a.m);
const out = [];
for (const { p } of files.slice(0, 400)) {
  let firstUser = null, firstAsst = null;
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!l) continue;
    let r; try { r = JSON.parse(l); } catch (e) { continue; }
    if (!r.timestamp) continue;
    if (!firstUser && r.type === 'user' && !r.isMeta && r.message) {
      const c = r.message.content;
      const txt = typeof c === 'string' ? c : (Array.isArray(c) ? c.map(x => x.text || '').join('') : '');
      if (txt && !txt.startsWith('<') && !(Array.isArray(c) && c.some(x => x.type === 'tool_result'))) firstUser = Date.parse(r.timestamp);
    }
    if (firstUser && !firstAsst && r.type === 'assistant') { firstAsst = Date.parse(r.timestamp); break; }
  }
  if (firstUser && firstAsst && (since === null || firstUser >= since)) out.push({ s: path.basename(p).slice(0, 8), at: new Date(firstUser).toISOString().slice(0, 16), gap: Math.round((firstAsst - firstUser) / 100) / 10 });
}
const sel = since === null ? out.slice(0, 25) : out;
sel.forEach(o => console.log(`${o.at} ${o.s} ${o.gap}s`));
const g = sel.map(o => o.gap).sort((a, b) => a - b);
console.log(g.length ? `n=${g.length} median=${g[Math.floor(g.length / 2)]}s min=${g[0]}s max=${g[g.length - 1]}s` : 'n=0');
