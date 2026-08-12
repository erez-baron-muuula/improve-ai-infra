// GEN-508: extract a REAL, COMPLETE payload corpus for the four Notion write tools from the
// session transcripts (the hook logs truncate tool_input at 514 chars, so they prove shape only).
const fs = require('fs');
const path = require('path');

const PROJ = 'C:/Users/Erez/.claude/projects';
const OUT = 'C:/Users/Erez/AppData/Local/Temp/claude/C--Users-Erez-AI-Projects-Improve-AI-Infra/f00041c7-a3bc-4560-8919-615f3ea67d68/scratchpad/notion-payload-corpus.jsonl';
const WRITE_TOOLS = ['notion-create-pages', 'notion-update-page', 'notion-duplicate-page', 'notion-move-pages'];

const files = [];
(function walk(d, depth) {
  if (depth > 4) return;
  let ents = [];
  try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, depth + 1);
    else if (e.name.endsWith('.jsonl')) files.push(p);
  }
})(PROJ, 0);

const seen = new Set();
const out = [];
const stats = {};
let scanned = 0;

for (const f of files) {
  let txt;
  try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
  scanned++;
  if (!WRITE_TOOLS.some(t => txt.includes(t))) continue;
  for (const line of txt.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch (e) { continue; }
    const content = r && r.message && r.message.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || b.type !== 'tool_use') continue;
      const name = String(b.name || '');
      const short = WRITE_TOOLS.find(t => name.endsWith(t));
      if (!short) continue;
      const rec = { tool: name, short: short, input: b.input, file: path.basename(f), ts: r.timestamp || '' };
      const key = short + '|' + JSON.stringify(b.input);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(rec);
      stats[short] = (stats[short] || 0) + 1;
    }
  }
}

fs.writeFileSync(OUT, out.map(o => JSON.stringify(o)).join('\n') + '\n');
console.log(`scanned ${scanned} transcript files`);
console.log(`unique payloads: ${out.length}`);
for (const [k, v] of Object.entries(stats)) console.log(`  ${k}: ${v}`);
console.log(`written to ${OUT}`);

// quick shape census on the real corpus
const census = {};
for (const o of out) {
  const ti = o.input;
  let shape;
  if (typeof ti === 'string') shape = 'STRING';
  else if (!ti || typeof ti !== 'object') shape = String(typeof ti);
  else shape = '{' + Object.keys(ti).sort().join(',') + '}';
  const k = o.short + ' ' + shape;
  census[k] = (census[k] || 0) + 1;
}
console.log('\n=== shape census (complete payloads) ===');
for (const [k, v] of Object.entries(census).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
