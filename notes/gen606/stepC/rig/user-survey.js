// Survey non-tool_result user entries across all main transcripts: origin kind x isMeta x opener shape.
const fs = require('fs');
const path = require('path');
const root = path.join(process.env.USERPROFILE, '.claude', 'projects');
const counts = {};
const samples = {};
for (const proj of fs.readdirSync(root)) {
  const pdir = path.join(root, proj);
  let files;
  try { files = fs.readdirSync(pdir).filter(f => f.endsWith('.jsonl')); } catch (e) { continue; }
  for (const f of files) {
    const fp = path.join(pdir, f);
    let s; try { s = fs.readFileSync(fp, 'utf8'); } catch (e) { continue; }
    for (const line of s.split('\n')) {
      if (!line || line.indexOf('"type":"user"') === -1) continue;
      let e; try { e = JSON.parse(line); } catch (x) { continue; }
      if (e.type !== 'user' || !e.message) continue;
      const c = e.message.content;
      if (Array.isArray(c) && c.some(b => b && b.type === 'tool_result')) continue;
      let t = typeof c === 'string' ? c : (Array.isArray(c) ? c.filter(b => b && b.type === 'text').map(b => b.text).join('') : '');
      const opener = (t.match(/^\s*(<[a-z-]+>|\[[A-Za-z ]+|Base directory|This session is being continued|Caveat:|[A-Za-z]{0,12})/) || [''])[0].slice(0, 30);
      const key = 'origin=' + (e.origin ? e.origin.kind : 'none') + ' meta=' + !!e.isMeta + ' compact=' + !!e.isCompactSummary + ' sidechain=' + !!e.isSidechain + ' opener=' + (/^[A-Za-z]/.test(opener) && !/^(Base directory|This session|Caveat)/.test(opener) ? '<word>' : opener);
      counts[key] = (counts[key] || 0) + 1;
      if (!samples[key]) samples[key] = f.slice(0, 8) + ': ' + t.slice(0, 140).replace(/\s+/g, ' ');
    }
  }
}
const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
for (const k of keys) console.log(String(counts[k]).padStart(6) + '  ' + k + '\n        ' + samples[k]);
