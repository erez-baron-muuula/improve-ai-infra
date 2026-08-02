const fs = require('fs');
const path = require('path');
const ROOT = 'C:\\Users\\Erez\\.claude\\projects';
const OUT = path.join(path.dirname(process.argv[1]), 'corpus.jsonl');

function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'subagents') walk(p, acc); }
    else if (e.name.endsWith('.jsonl')) acc.push(p);
  }
  return acc;
}
function isRealUserTurn(o) {
  if (o.type !== 'user' || o.isSidechain) return false;
  const c = o.message && o.message.content;
  if (typeof c === 'string') return c.length > 0;
  if (Array.isArray(c)) return !c.some(b => b && b.type === 'tool_result');
  return false;
}
function assistantText(o) {
  const c = o.message && o.message.content;
  if (!Array.isArray(c)) return null;
  const parts = c.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text);
  return parts.length ? parts.join('\n') : null;
}
const files = walk(ROOT, []);
const out = fs.createWriteStream(OUT);
let turns = 0, skipped = 0;
for (const f of files) {
  let lines;
  try { lines = fs.readFileSync(f, 'utf8').split('\n'); } catch { continue; }
  let pending = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { skipped++; continue; }
    if (o.isSidechain) continue;
    if (o.type === 'assistant') { const t = assistantText(o); if (t !== null) pending = t; }
    else if (isRealUserTurn(o)) {
      if (pending !== null) { out.write(JSON.stringify({ f: path.basename(f), t: pending }) + '\n'); turns++; }
      pending = null;
    }
  }
  if (pending !== null) { out.write(JSON.stringify({ f: path.basename(f), t: pending }) + '\n'); turns++; }
}
out.end();
console.log('files=' + files.length + ' turns=' + turns + ' unparsable=' + skipped);
