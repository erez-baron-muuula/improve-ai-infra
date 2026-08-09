// Dump a turn timeline around a given timestamp in a given file
const fs = require('fs');
const file = process.argv[2], anchor = process.argv[3];
const entries = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
const MARKER = /\u{1F4CC}\s*\*{0,2}\s*For you/u;
function textOf(o) {
  const c = o.message && o.message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(x => (x.type === 'text' ? x.text : (x.type === 'tool_use' ? '[TOOL:' + x.name + ']' : (x.type === 'tool_result' ? '[tool_result]' : '')))).join(' ');
  return '';
}
const start = entries.findIndex(o => o.timestamp === anchor);
const from = Math.max(0, start - 3);
for (let i = from; i < Math.min(entries.length, start + 40); i++) {
  const o = entries[i];
  let t = textOf(o) || JSON.stringify(o).slice(0, 300);
  t = t.replace(/\s+/g, ' ').slice(0, 260);
  console.log(`[${i}] ${o.timestamp} ${o.type}${o.isMeta ? '/meta' : ''}${o.promptSource ? '/' + o.promptSource : ''}${MARKER.test(textOf(o)) ? ' <<MARKER>>' : ''} :: ${t}`);
}
