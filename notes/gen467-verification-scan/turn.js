// Print the compressed structure of the turn containing a given prompt timestamp
const fs = require('fs'), path = require('path');
const file = process.argv[2], anchor = process.argv[3];
const LOOSE = /\u{1F4CC}\s*\*{0,2}\s*For you/u;
const OPENER = /^[ \t]{0,3}#{0,4}[ \t]*\*{0,2}\u{1F4CC}[ \t]*\*{0,2}[ \t]*For you/imu;
const stripFences = t => t.replace(/```[\s\S]*?(?:```|$)/g, '');
const entries = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
function textOf(o) {
  const c = o.message && o.message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(x => (x.type === 'text' ? x.text : '')).join('\n');
  return '';
}
function tools(o) { const c = o.message && o.message.content; return Array.isArray(c) ? c.filter(x => x.type === 'tool_use').map(x => x.name) : []; }
function isTR(o) { const c = o.message && o.message.content; return Array.isArray(c) && c.some(x => x.type === 'tool_result'); }
function isRealPrompt(o) {
  if (o.type !== 'user' || o.isMeta || isTR(o)) return false;
  const t = textOf(o); if (!t) return false;
  return !t.startsWith('<local-command-stdout>') && t.trim() !== '[Request interrupted by user]';
}
let start = -1, end = entries.length;
for (let i = 0; i < entries.length; i++) {
  if (isRealPrompt(entries[i])) {
    if (start === -1 && entries[i].timestamp === anchor) start = i;
    else if (start !== -1 && i > start) { end = i; break; }
  }
}
if (start === -1) { console.log('anchor not found'); process.exit(0); }
console.log('TURN prompt:', textOf(entries[start]).replace(/\s+/g, ' ').slice(0, 200));
for (let i = start + 1; i < end; i++) {
  const o = entries[i];
  const tx = textOf(o);
  const tags = [];
  if (OPENER.test(stripFences(tx))) tags.push('OPENER');
  else if (LOOSE.test(tx)) tags.push('loose-mention');
  const j = JSON.stringify(o);
  if (o.type === 'attachment' && /hook_additional_context|hook_blocking_error/.test(j)) {
    const m = j.match(/(For-you check, automatic|Claim-linter, automatic|Self-audit, automatic|For-you guard, automatic)/);
    tags.push('HOOK:' + (m ? m[1] : 'other'));
  }
  if (o.type === 'user' && o.isMeta) tags.push('META');
  const tl = tools(o);
  if (tl.length) tags.push('tools=' + tl.join(','));
  if (o.type === 'assistant' && !tl.length && !tx) continue;
  if (o.type === 'attachment' && !tags.some(t => t.startsWith('HOOK'))) continue;
  if (o.type !== 'assistant' && o.type !== 'attachment' && o.type !== 'user') continue;
  if (o.type === 'user' && isTR(o)) continue;
  console.log(`[${i}] ${o.timestamp} ${o.type} {${tags.join(' ')}} :: ${(tx || '').replace(/\s+/g, ' ').slice(0, 180)}`);
}
