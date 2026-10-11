// Build the real Stop-candidate corpus from every main transcript on this machine.
// A Stop candidate = a main-chain assistant message (reconstructed by message.id) that carries
// text and no tool_use -- the shape of a turn's finished reply (last_assistant_message).
// For each, record: whether a tracker lookup ran since the last real (human) prompt, whether it
// is a hook-opened continuation, whether it carries the For-you marker.
// Output: corpus.jsonl (one row per candidate) in this script's dir.
const fs = require('fs');
const path = require('path');
const root = path.join(process.env.USERPROFILE, '.claude', 'projects');
const MARKER_RE = /\u{1F4CC}️?\s{0,64}\*{0,2}\s{0,64}For you/u;

function isHumanPrompt(e) {
  if (!e || e.type !== 'user' || !e.message || e.isSidechain === true) return false;
  const c = e.message.content;
  if (Array.isArray(c) && c.some(b => b && b.type === 'tool_result')) return false;
  if (e.origin && typeof e.origin === 'object') return e.origin.kind === 'human';
  if (e.isMeta === true || e.isCompactSummary === true) return false;
  const t = typeof c === 'string' ? c : (Array.isArray(c) ? c.filter(b => b && b.type === 'text').map(b => b.text).join('') : '');
  if (/^\s*<(?:local-command-stdout|local-command-caveat|task-notification)>/.test(t)) return false;
  if (/^\s*\[Request interrupted/.test(t)) return false;
  return true;
}

// A SEARCH for an existing home (not a by-id fetch): semantic search, a data-source query/sweep,
// a REST search or database query, a Jira JQL search.
function isLookup(ev) {
  const n = ev.name || '';
  const cmd = ev.input ? String(ev.input.command || '') : '';
  return /notion-(?:search|query-data-sources|query-multiple-data-sources)$/.test(n) ||
    /__searchJiraIssuesUsingJql$/.test(n) ||
    ((n === 'Bash' || n === 'PowerShell') && /api\.notion\.com\/v1\/(?:search|databases\/[^\/\s"']+\/query|data_sources\/[^\/\s"']+\/query)/i.test(cmd));
}

const out = [];
for (const proj of fs.readdirSync(root)) {
  const pdir = path.join(root, proj);
  let files;
  try { files = fs.readdirSync(pdir).filter(f => f.endsWith('.jsonl')); } catch (e) { continue; }
  for (const f of files) {
    let s; try { s = fs.readFileSync(path.join(pdir, f), 'utf8'); } catch (e) { continue; }
    const entries = [];
    for (const line of s.split('\n')) { if (!line) continue; try { entries.push(JSON.parse(line)); } catch (e) {} }
    // Reconstruct assistant messages by id, in order of first appearance; remember their entry span.
    const msgs = new Map();
    const order = [];
    let lastPrompt = -1;
    const events = []; // sequential: {kind:'prompt'|'summary'|'tool', idx, name, input}
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (isHumanPrompt(e)) { events.push({ kind: 'prompt', idx: i }); continue; }
      if (e && e.type === 'system' && e.subtype === 'stop_hook_summary') { events.push({ kind: 'summary', idx: i, ctx: e.hookAdditionalContext }); continue; }
      if (!e || e.type !== 'assistant' || e.isSidechain === true || !e.message || !Array.isArray(e.message.content)) continue;
      const id = e.message.id || ('noid-' + i);
      if (!msgs.has(id)) { msgs.set(id, { id, first: i, last: i, text: '', tools: [], ts: e.timestamp }); order.push(id); }
      const m = msgs.get(id);
      m.last = i;
      for (const c of e.message.content) {
        if (!c) continue;
        if (c.type === 'text' && typeof c.text === 'string') m.text += c.text;
        if (c.type === 'tool_use') { m.tools.push({ name: c.name, input: c.input }); events.push({ kind: 'tool', idx: i, name: c.name, input: c.input }); }
      }
    }
    for (const id of order) {
      const m = msgs.get(id);
      if (!m.text || m.tools.length) continue;
      // window = events after the last prompt before m.first
      let pIdx = -1;
      for (const ev of events) { if (ev.kind === 'prompt' && ev.idx < m.first) pIdx = ev.idx; }
      const win = events.filter(ev => ev.idx > pIdx && ev.idx < m.first);
      // prompts back to the newest tracker lookup (0 = this turn); -1 = none in the file before m
      let searchAge = -1, promptsSeen = 0;
      for (let k = events.length - 1; k >= 0; k--) {
        const ev = events[k];
        if (ev.idx >= m.first) continue;
        if (ev.kind === 'prompt') { promptsSeen++; continue; }
        if (ev.kind === 'tool' && isLookup(ev)) { searchAge = promptsSeen; break; }
      }
      out.push({
        searchAge,
        vetTicket: win.some(ev => ev.kind === 'tool' && ev.name === 'Skill' && ev.input && ev.input.skill === 'vet-ticket'),
        promptUuid: pIdx >= 0 ? (entries[pIdx].uuid || String(pIdx)) : null,
        session: f.replace('.jsonl', ''), project: proj, ts: m.ts, msgId: id,
        marker: MARKER_RE.test(m.text),
        continuation: win.some(ev => ev.kind === 'summary'),
        promptFound: pIdx !== -1,
        tools: win.filter(ev => ev.kind === 'tool').map(ev => ({ name: ev.name, cmd: ev.input && (ev.input.command || ev.input.skill || ev.input.query || ev.input.id || '') })).map(t => ({ name: t.name, cmd: String(t.cmd).slice(0, 300) })),
        text: m.text
      });
    }
  }
}
const dest = path.join(__dirname, 'corpus.jsonl');
fs.writeFileSync(dest, out.map(o => JSON.stringify(o)).join('\n') + '\n');
console.log('candidates:', out.length, 'with marker:', out.filter(o => o.marker).length, 'continuations:', out.filter(o => o.continuation).length, '->', dest);
