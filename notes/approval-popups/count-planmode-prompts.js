// Read-only: in plan mode over the last N days, how many calls of each named tool ran, and how many asked Erez.
const fs = require('fs'), path = require('path');
const root = path.join(process.env.USERPROFILE, '.claude', 'projects'), days = 14;
const watch = process.argv.slice(2);
const st = {};
for (const d of fs.readdirSync(root)) {
  let files; try { files = fs.readdirSync(path.join(root, d)).filter(f => f.endsWith('.jsonl')); } catch (e) { continue; }
  for (const f of files) {
    const p = path.join(root, d, f);
    if (Date.now() - fs.statSync(p).mtimeMs > days * 864e5) continue;
    let mode = ''; const pending = {};
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      let j; try { j = JSON.parse(line); } catch (e) { continue; }
      if (j.permissionMode) mode = j.permissionMode;
      const c = j.message && Array.isArray(j.message.content) ? j.message.content : [];
      for (const x of c) {
        if (x.type === 'tool_use' && watch.includes(x.name)) pending[x.id] = { name: x.name, mode };
        if (x.type === 'tool_result' && pending[x.tool_use_id]) {
          const t = pending[x.tool_use_id]; const k = t.name + ' | ' + t.mode;
          st[k] = st[k] || { calls: 0, asked: 0 }; st[k].calls++;
          if (j.permissionDecision && j.permissionDecision.source === 'user_temporary') st[k].asked++;
        }
      }
    }
  }
}
for (const [k, v] of Object.entries(st).sort()) console.log(k, 'calls=' + v.calls, 'asked=' + v.asked);
