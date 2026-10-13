// GEN-834 evidence: count Notion write-tool names that appear as REAL tool_use calls (not text),
// by connector prefix, across every session transcript on this PC. Read-only.
// Usage: node prefix-scan-tooluse.js [projectsDir]   (default: ~/.claude/projects)
// 2026-10-13 result: 2,147 files, 54,729 tool_use blocks; 1,293 Notion write calls on
// 46ff9446-421e-4358-809c-6b8b01e661b2 and 1 on a garbled id (…-4573-b0c9-81cacb12ca45, 2026-08-10,
// session 46d53865) that names no real tool.
const fs = require('fs'), path = require('path'), os = require('os');
const root = process.argv[2] || path.join(os.homedir(), '.claude', 'projects');
const re = /^mcp__(.+?)__notion-(create-pages|update-page|duplicate-page|move-pages)$/;
const counts = {}; const where = {}; let files = 0, calls = 0;
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.jsonl')) {
      files++;
      for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        if (line.indexOf('tool_use') < 0) continue;
        let o; try { o = JSON.parse(line); } catch (_) { continue; }
        const c = o && o.message && o.message.content;
        if (!Array.isArray(c)) continue;
        for (const b of c) {
          if (!b || b.type !== 'tool_use' || typeof b.name !== 'string') continue;
          calls++;
          const m = re.exec(b.name);
          if (!m) continue;
          counts[m[1]] = (counts[m[1]] || 0) + 1;
          if (m[1] !== '46ff9446-421e-4358-809c-6b8b01e661b2') (where[m[1]] = where[m[1]] || []).push(p + ' @ ' + (o.timestamp || '?'));
        }
      }
    }
  }
})(root);
console.log('files', files, 'tool_use blocks', calls);
console.log(JSON.stringify(counts, null, 1));
console.log(JSON.stringify(where, null, 1));
