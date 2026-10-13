// GEN-834 /vet-code Step 4 input realism: replay every DISTINCT real tool name ever called on this PC
// (tool_use blocks in ~/.claude/projects/**/*.jsonl) through the hook working copy, with an empty
// tool_input, and count connector-mismatch refusals. Expected: 0 (the only Notion write prefix ever used
// is the watched one). Read-only apart from the working copy's own isolated staging log.
// Usage: node tool-name-replay.js [hookPath] [projectsDir]
const fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');
const HOOK = path.resolve(process.argv[2] || path.join(__dirname, '..', 'gen508-piece1', 'auto-approve.working.js'));
const root = process.argv[3] || path.join(os.homedir(), '.claude', 'projects');
const names = new Set();
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.jsonl')) {
      for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        if (line.indexOf('tool_use') < 0) continue;
        let o; try { o = JSON.parse(line); } catch (_) { continue; }
        const c = o && o.message && o.message.content;
        if (Array.isArray(c)) for (const b of c) if (b && b.type === 'tool_use' && typeof b.name === 'string') names.add(b.name);
      }
    }
  }
})(root);
let fires = 0, crashes = 0;
const fired = [];
for (const n of names) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: n, tool_input: {}, cwd: os.tmpdir(), session_id: 'replay' }), encoding: 'utf8' });
  if ((r.stderr || '').indexOf('comes from connector id') !== -1) { fires++; fired.push(n); }
  if (r.status === 1) crashes++;
}
console.log('distinct real tool names:', names.size, '| connector-mismatch refusals:', fires, '| exit-1 crashes:', crashes);
if (fired.length) console.log('fired on:', fired.join(', '));
