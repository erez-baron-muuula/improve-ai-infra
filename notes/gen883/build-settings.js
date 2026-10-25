// Builds a working copy of ~/.claude/settings.json with the two inject-browser-refs.js
// registrations added. Read-only on the live file; writes only the working copy.
const fs = require('fs');
const path = require('path');
const live = 'C:/Users/Erez/.claude/settings.json';
const out = path.join(__dirname, 'settings.working.json');
const raw = fs.readFileSync(live, 'utf8');
const bom = raw.charCodeAt(0) === 0xFEFF;
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
const s = JSON.parse(bom ? raw.slice(1) : raw);
const cmd = 'node "C:/Users/Erez/.claude/hooks/inject-browser-refs.js"';
const PREFIX = 'mcp__(claude-in-chrome|Claude_in_Chrome)__.*';
for (const [ev, matcher] of [['PostToolUse', 'ToolSearch|' + PREFIX], ['PostToolUseFailure', PREFIX]]) {
  s.hooks[ev] = s.hooks[ev] || [];
  if (s.hooks[ev].some((e) => (e.hooks || []).some((h) => h.command === cmd))) throw new Error('already registered in ' + ev);
  s.hooks[ev].push({ matcher, hooks: [{ type: 'command', command: cmd, timeout: 15 }] });
}
// Match the live file's indentation (detect from its second line).
const indent = (/\n( +)\S/.exec(raw) || [, '  '])[1];
let text = JSON.stringify(s, null, indent.length);
if (eol === '\r\n') text = text.replace(/\n/g, '\r\n');
if (raw.endsWith(eol)) text += eol;
fs.writeFileSync(out, (bom ? '\uFEFF' : '') + text);
// Round-trip check: re-stringifying the live file in the same style must reproduce it exactly,
// so the only diff is the two new entries.
let liveRe = JSON.stringify(JSON.parse(bom ? raw.slice(1) : raw), null, indent.length);
if (eol === '\r\n') liveRe = liveRe.replace(/\n/g, '\r\n');
if (raw.endsWith(eol)) liveRe += eol;
console.log('style round-trip identical:', (bom ? '\uFEFF' : '') + liveRe === raw, '| bom', bom, '| eol', JSON.stringify(eol), '| indent', indent.length);
console.log('wrote', out);
