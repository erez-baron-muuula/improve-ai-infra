// Read-only: which tools did Erez answer a prompt for (source user_temporary / reject) in the last N days,
// and which of those match an allow rule in settings.json / settings.local.json.
const fs = require('fs'), path = require('path');
const home = process.env.USERPROFILE, days = +(process.argv[2] || 7);
const root = path.join(home, '.claude', 'projects');
const allow = [];
for (const f of ['settings.json', 'settings.local.json']) {
  try { allow.push(...(JSON.parse(fs.readFileSync(path.join(home, '.claude', f), 'utf8')).permissions.allow || [])); } catch (e) {}
}
const allowed = name => allow.some(r => r === name || (r.endsWith('*') && !r.includes('(') && name.startsWith(r.slice(0, -1))) || (r.endsWith('__*') && name.startsWith(r.slice(0, -1))));
const counts = {}, samples = {};
for (const d of fs.readdirSync(root)) {
  const dir = path.join(root, d);
  let files; try { files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')); } catch (e) { continue; }
  for (const f of files) {
    const p = path.join(dir, f);
    if (Date.now() - fs.statSync(p).mtimeMs > days * 864e5) continue;
    const names = {}; let mode = '';
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      if (!line) continue;
      let j; try { j = JSON.parse(line); } catch (e) { continue; }
      if (j.permissionMode) mode = j.permissionMode;
      const c = j.message && Array.isArray(j.message.content) ? j.message.content : [];
      for (const x of c) if (x.type === 'tool_use') names[x.id] = x.name;
      const pd = j.permissionDecision;
      if (!pd || (pd.source !== 'user_temporary' && pd.decision === 'accept')) continue;
      const id = c.find(x => x.type === 'tool_result');
      const name = id ? names[id.tool_use_id] || '?' : '?';
      const key = name + ' | ' + pd.decision + '/' + pd.source + (allowed(name) ? ' | ALLOW-LISTED' : '');
      counts[key] = (counts[key] || 0) + 1;
      if (allowed(name)) (samples[key] = samples[key] || []).push(d.slice(23, 40) + '/' + f.slice(0, 8) + ' ' + j.timestamp + ' mode=' + mode);
    }
  }
}
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(v, k);
console.log('--- allow-listed samples');
for (const [k, v] of Object.entries(samples)) console.log(k, '\n   ', v.slice(0, 4).join('\n    '));
