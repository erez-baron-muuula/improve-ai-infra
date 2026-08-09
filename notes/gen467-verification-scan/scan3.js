// Pass 3: missing-block candidates (broad opener) + claim-linter correction path.
const fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/Erez/.claude/projects';
const CUTOFF = new Date('2026-07-19T00:00:00Z');
const LOOSE = /\u{1F4CC}\s*\*{0,2}\s*For you/u;
const stripFences = t => t.replace(/```[\s\S]*?(?:```|$)/g, '');
function openerForm(raw) {
  const t = stripFences(raw || '');
  if (!/\u{1F4CC}/u.test(t)) return null;
  for (const ln of t.split('\n')) {
    if (!/\u{1F4CC}/u.test(ln)) continue;
    const s = ln.trim();
    if (s.length > 160) continue;
    if (!/^(?:#{1,4}[ \t]*)?(?:\*{0,2})[ \t]*(?:\u{1F4CC}[ \t]*)+/u.test(s)) continue;
    if (!/For you/i.test(s) && !/^(?:#{1,4}\s*)?\*{0,2}(?:\u{1F4CC}\s*)+\*{0,2}[A-Z]/u.test(s)) continue;
    return s.slice(0, 60);
  }
  return null;
}
let files = [];
for (const r of fs.readdirSync(ROOT)) {
  const rp = path.join(ROOT, r);
  if (!fs.statSync(rp).isDirectory()) continue;
  for (const f of fs.readdirSync(rp)) {
    if (!f.endsWith('.jsonl')) continue;
    const p = path.join(rp, f);
    if (fs.statSync(p).mtime > CUTOFF) files.push(p);
  }
}
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
const MUT = /^(Edit|Write|NotebookEdit)$|notion-update-page|notion-create-pages|notion-update-data-source|notion-move-pages|notion-create-comment|editJiraIssue|createJiraIssue|transitionJiraIssue|updateConfluencePage|slack_send/;
const missing = [], linter = [];
const dedupe = new Set();
for (const p of files) {
  const entries = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  let turns = [], cur = null;
  for (const o of entries) {
    if (isRealPrompt(o)) { cur = { file: p, ts: o.timestamp, prompt: textOf(o).slice(0, 160), items: [] }; turns.push(cur); continue; }
    if (!cur) continue;
    if (o.type === 'assistant') cur.items.push({ k: 'a', ts: o.timestamp, text: textOf(o), tools: tools(o) });
    else if (o.type === 'attachment') cur.items.push({ k: 'h', ts: o.timestamp, text: JSON.stringify(o) });
    else if (o.type === 'user' && o.isMeta) cur.items.push({ k: 'h', ts: o.timestamp, text: textOf(o) });
  }
  for (const t of turns) {
    const key = p + '|' + t.ts;
    if (dedupe.has(key)) continue; dedupe.add(key);
    const blocks = t.items.filter(i => i.k === 'a' && openerForm(i.text));
    const mutated = t.items.some(i => i.k === 'a' && i.tools.some(n => MUT.test(n)));
    const last = t.items.filter(i => i.k === 'a' && i.text.trim()).slice(-1)[0];
    if (!blocks.length && mutated) {
      missing.push({ ts: t.ts, file: path.basename(p), prompt: t.prompt.replace(/\s+/g, ' '),
        tools: [...new Set(t.items.flatMap(i => i.tools || []))].filter(n => MUT.test(n)),
        last: (last ? last.text : '').replace(/\s+/g, ' ').slice(0, 300) });
    }
    const li = t.items.findIndex(i => i.k === 'h' && /Claim-linter, automatic|Claim-check \(GEN-450/.test(i.text));
    if (li >= 0) {
      const after = t.items.slice(li + 1).filter(i => i.k === 'a' && openerForm(i.text));
      const before = t.items.slice(0, li).filter(i => i.k === 'a' && openerForm(i.text));
      linter.push({ ts: t.ts, file: path.basename(p), before: before.length, after: after.length,
        blockText: after.length ? after[0].text.slice(Math.max(0, after[0].text.search(LOOSE) - 40), after[0].text.search(LOOSE) + 1400) : '' });
    }
  }
}
const out = process.argv[2];
if (out === 'missing') {
  const rec = missing.filter(m => m.ts >= (process.argv[3] || '2026-07-28'));
  console.log('MISSING (broad opener, state-mutating turns) since', process.argv[3] || '2026-07-28', '=', rec.length, 'of', missing.length, 'all-dates');
  rec.forEach(m => { console.log('---', m.ts, m.file); console.log('   prompt:', m.prompt.slice(0, 120)); console.log('   mutators:', m.tools.join(',')); console.log('   last:', m.last); });
} else {
  const rec = linter.filter(m => m.ts >= '2026-07-28');
  console.log('CLAIM-LINTER turns since 2026-07-28 =', rec.length, '(all dates', linter.length, ')');
  const withAfter = rec.filter(m => m.after > 0);
  console.log('  block emitted AFTER the linter injection:', withAfter.length);
  console.log('  a block already existed BEFORE the injection:', rec.filter(m => m.before > 0).length);
  const NARR = /\b(correction|corrected|I checked|I verified|re-verified|after checking|checked against live|claim-check|verification (?:pass|step)|on re-?read|I re-read)\b/i;
  const narrated = withAfter.filter(m => NARR.test(m.blockText));
  console.log('  of those, block text contains correction/verification narration:', narrated.length);
  narrated.slice(0, 12).forEach(m => console.log('   *', m.ts, m.file, '::', m.blockText.replace(/\s+/g, ' ').slice(0, 260)));
}
