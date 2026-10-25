// Scan session transcripts modified since a date for turns where the "For you" block
// is written in one assistant message and the same content is repeated in a later
// assistant text message of the same turn (typically after a wrap_up call).
// Usage: node dupscan.js 2026-10-10T00:00:00Z
const fs = require('fs');
const path = require('path');
const root = path.join(process.env.USERPROFILE, '.claude', 'projects');
const since = new Date(process.argv[2] || '2026-10-18T00:00:00Z');
const out = [];
for (const proj of fs.readdirSync(root)) {
  const pdir = path.join(root, proj);
  let files;
  try { files = fs.readdirSync(pdir).filter(f => f.endsWith('.jsonl')); } catch { continue; }
  for (const f of files) {
    const fp = path.join(pdir, f);
    const st = fs.statSync(fp);
    if (st.mtime < since) continue;
    const lines = fs.readFileSync(fp, 'utf8').split('\n');
    // split into turns at real user prompts (string content, not tool results)
    let turn = null; const turns = [];
    for (const ln of lines) {
      if (!ln.trim()) continue;
      let r; try { r = JSON.parse(ln); } catch { continue; }
      if (r.type === 'user' && r.message && typeof r.message.content === 'string' && !r.isMeta) {
        turn = { ts: r.timestamp, prompt: r.message.content.slice(0, 60), items: [] }; turns.push(turn); continue;
      }
      if (!turn || r.type !== 'assistant' || !r.message) continue;
      for (const c of r.message.content || []) {
        if (c.type === 'text' && c.text.trim()) turn.items.push({ k: 'text', t: c.text, ts: r.timestamp });
        if (c.type === 'tool_use' && /wrap_up/.test(c.name)) turn.items.push({ k: 'wrap', ts: r.timestamp });
      }
    }
    for (const t of turns) {
      const texts = t.items.filter(i => i.k === 'text');
      const blockIdx = t.items.findIndex(i => i.k === 'text' && /📌\s*\*?\*?For you/.test(i.t));
      if (blockIdx < 0) continue;
      const after = t.items.slice(blockIdx + 1).filter(i => i.k === 'text' && i.t.length > 300);
      const wrapAfterBlock = t.items.slice(blockIdx + 1).some(i => i.k === 'wrap');
      const blocks = texts.filter(i => /📌\s*\*?\*?For you/.test(i.t)).length;
      if (after.length || blocks > 1) {
        // crude overlap: share of the later text's 6-word phrases that also occur in the block
        const sh = s => { const w = s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean); const set = new Set(); for (let i = 0; i + 6 <= w.length; i++) set.add(w.slice(i, i + 6).join(' ')); return set; };
        const b = sh(t.items[blockIdx].t);
        let best = 0;
        for (const a of after) { const s = sh(a.t); let n = 0; for (const x of s) if (b.has(x)) n++; best = Math.max(best, s.size ? n / s.size : 0); }
        out.push({ proj: proj.replace('C--Users-Erez-', ''), session: f.slice(0, 8), ts: t.ts, prompt: t.prompt.replace(/\s+/g, ' '), blocks, laterLongTexts: after.length, wrapAfterBlock, overlap: Math.round(best * 100) });
      }
    }
  }
}
out.sort((a, b) => (a.ts < b.ts ? -1 : 1));
for (const o of out) console.log([o.ts, o.proj, o.session, 'blocks=' + o.blocks, 'laterLong=' + o.laterLongTexts, 'wrapAfter=' + o.wrapAfterBlock, 'overlap%=' + o.overlap, o.prompt].join(' | '));
console.log('total', out.length);
