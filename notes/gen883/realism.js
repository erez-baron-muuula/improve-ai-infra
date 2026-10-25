// Step 4 input realism: run reportsNotConnected over every real Claude in Chrome tool result in
// this PC's session transcripts (~/.claude/projects/**/*.jsonl, main sessions and sub-agents).
// Prints counts, and for each fire a redacted 80-char start of its text so a false fire is visible.
const fs = require('fs');
const path = require('path');
const os = require('os');
const mod = require(path.join(__dirname, 'inject-browser-refs.js'));
const root = path.join(os.homedir(), '.claude', 'projects');
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.jsonl')) files.push(p);
  }
})(root);
let calls = 0, fires = 0, errResults = 0;
const fireStarts = {};
const nonFireBanner = [];
for (const f of files) {
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
  if (text.indexOf('claude-in-chrome') < 0 && text.indexOf('Claude_in_Chrome') < 0) continue;
  const names = {};
  for (const line of text.split('\n')) {
    if (!line) continue;
    let o; try { o = JSON.parse(line); } catch (e) { continue; }
    const c = o && o.message && Array.isArray(o.message.content) ? o.message.content : null;
    if (!c) continue;
    for (const b of c) {
      if (b && b.type === 'tool_use' && typeof b.name === 'string') names[b.id] = b.name;
      if (b && b.type === 'tool_result' && names[b.tool_use_id] && /^mcp__(claude-in-chrome|Claude_in_Chrome)__/.test(names[b.tool_use_id])) {
        calls++;
        const content = typeof b.content === 'string' ? [{ type: 'text', text: b.content }] : (Array.isArray(b.content) ? b.content : []);
        const data = { tool_name: names[b.tool_use_id] };
        if (b.is_error) { errResults++; data.error = content.map((x) => x && x.text || '').join('\n'); data.hook_event_name = 'PostToolUseFailure'; }
        else data.tool_response = content;
        if (mod.reportsNotConnected(data)) {
          fires++;
          const first = (content.find((x) => x && typeof x.text === 'string') || {}).text || '';
          const k = (b.is_error ? '[error] ' : '') + first.slice(0, 80).replace(/\s+/g, ' ').replace(/[A-Za-z0-9_\-]{24,}/g, '<redacted>');
          fireStarts[k] = (fireStarts[k] || 0) + 1;
        } else {
          const all = content.map((x) => x && x.text || '').join('\n');
          if (/not connected/i.test(all) && all.length < 3000) nonFireBanner.push((b.is_error ? '[error] ' : '') + all.slice(0, 100).replace(/\s+/g, ' '));
        }
      }
    }
  }
}
console.log('transcript files:', files.length, '| browser tool results:', calls, '| error results:', errResults, '| fires:', fires);
console.log('fire texts (start, count):');
for (const [k, v] of Object.entries(fireStarts).sort((a, b) => b[1] - a[1])) console.log('  ' + v + 'x  ' + k);
console.log('short results mentioning "not connected" that did NOT fire:', nonFireBanner.length);
for (const s of nonFireBanner.slice(0, 15)) console.log('  ' + s);
