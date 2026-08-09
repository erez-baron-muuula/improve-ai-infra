// Show a claim-linter turn end-to-end: pre-block reply tail, linter note, continuation block.
const fs = require('fs');
const file = process.argv[2], anchor = process.argv[3];
const LOOSE = /\u{1F4CC}\s*\*{0,2}\s*For you/u;
const entries = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
function textOf(o) { const c = o.message && o.message.content; if (typeof c === 'string') return c; if (Array.isArray(c)) return c.map(x => (x.type === 'text' ? x.text : '')).join('\n'); return ''; }
function isTR(o) { const c = o.message && o.message.content; return Array.isArray(c) && c.some(x => x.type === 'tool_result'); }
function isRealPrompt(o) { if (o.type !== 'user' || o.isMeta || isTR(o)) return false; const t = textOf(o); return !!t && !t.startsWith('<local-command-stdout>') && t.trim() !== '[Request interrupted by user]'; }
let s = -1, e = entries.length;
for (let i = 0; i < entries.length; i++) if (isRealPrompt(entries[i])) { if (s === -1 && entries[i].timestamp === anchor) s = i; else if (s !== -1 && i > s) { e = i; break; } }
console.log('PROMPT:', textOf(entries[s]).replace(/\s+/g, ' ').slice(0, 200), '\n');
for (let i = s + 1; i < e; i++) {
  const o = entries[i];
  const j = JSON.stringify(o);
  if (o.type === 'attachment' && /Claim-linter, automatic/.test(j)) {
    const m = j.match(/Claim-linter, automatic: the prior turn stated ([^]{0,400}?)with no source nearby/);
    console.log('>>> CLAIM-LINTER FIRED @', o.timestamp, '\n    claims:', m ? m[1].replace(/\\"/g, '"') : '(parse fail)', '\n');
  }
  if (o.type !== 'assistant') continue;
  const t = textOf(o); if (!t.trim()) continue;
  if (LOOSE.test(t)) { console.log('=== BLOCK @', o.timestamp, '===\n' + t.slice(0, 2600) + '\n'); }
  else console.log('--- reply @', o.timestamp, ':', t.replace(/\s+/g, ' ').slice(0, 500));
}
