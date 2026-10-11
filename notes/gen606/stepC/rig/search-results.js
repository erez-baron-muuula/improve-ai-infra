// How do board-search tool calls come back? Tally is_error and error-looking text per tool, all transcripts.
const fs = require('fs');
const path = require('path');
const root = path.join(process.env.USERPROFILE, '.claude', 'projects');
const RE = /(?:^|__)(notion-search|notion-query-data-sources|notion-query-multiple-data-sources|searchJiraIssuesUsingJql)$/;
const tally = {};
const samples = {};
for (const proj of fs.readdirSync(root)) {
  let files; try { files = fs.readdirSync(path.join(root, proj)).filter(f => f.endsWith('.jsonl')); } catch (e) { continue; }
  for (const f of files) {
    let s; try { s = fs.readFileSync(path.join(root, proj, f), 'utf8'); } catch (e) { continue; }
    const want = new Map();
    for (const line of s.split('\n')) {
      if (!line) continue;
      let e; try { e = JSON.parse(line); } catch (x) { continue; }
      const c = e && e.message && Array.isArray(e.message.content) ? e.message.content : [];
      for (const b of c) {
        if (b && b.type === 'tool_use' && typeof b.name === 'string') { const m = RE.exec(b.name); if (m) want.set(b.id, m[1]); }
        if (b && b.type === 'tool_result' && want.has(b.tool_use_id)) {
          const n = want.get(b.tool_use_id);
          let t = b.content; if (Array.isArray(t)) t = t.filter(x => x && x.type === 'text').map(x => x.text).join('');
          t = String(t || '');
          const errText = /^\s*(?:<tool_use_error>|Error|MCP error|\{"error)/i.test(t);
          const k = n + ' is_error=' + (b.is_error === true) + ' errText=' + errText;
          tally[k] = (tally[k] || 0) + 1;
          if ((b.is_error === true || errText) && !samples[k]) samples[k] = t.slice(0, 160).replace(/\s+/g, ' ');
        }
      }
    }
  }
}
for (const k of Object.keys(tally).sort()) console.log(String(tally[k]).padStart(5), k, samples[k] ? ':: ' + samples[k] : '');
