// GEN-674 size stop: replay every real PowerShell command that INVOKES update-config.ps1 for a file
// other than the global CLAUDE.md, through the fixture hook, and list any the size stop now refuses.
// Those would be false fires of the new fail-closed target detection. Usage:
// node sizestop-corpus-other.js <fixtureRoot built by sizestop-test.js>
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = process.argv[2];
const HOME = process.env.USERPROFILE;
const HOOK = path.join(ROOT, 'home', '.claude', 'hooks', 'auto-approve.js');
const INVOKE = /^\s*(?:&\s*)?(?:"[^"]*|'[^']*|[^\s'"]*)update-config\.ps1/i;
function walk(d, out) {
  let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of ents) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'subagents' && e.name !== 'tool-results') walk(p, out); }
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}
const cmds = new Set();
for (const f of walk(path.join(HOME, '.claude', 'projects'), [])) {
  let text; try { text = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
  if (text.indexOf('update-config.ps1') === -1) continue;
  for (const ln of text.split('\n')) {
    if (ln.indexOf('"tool_use"') === -1) continue;
    let rec; try { rec = JSON.parse(ln); } catch (e) { continue; }
    const content = rec && rec.message && Array.isArray(rec.message.content) ? rec.message.content : [];
    for (const c of content) {
      if (!c || c.type !== 'tool_use' || c.name !== 'PowerShell' || !c.input || typeof c.input.command !== 'string') continue;
      const cmd = c.input.command;
      if (!INVOKE.test(cmd) || /-File\s+["']?CLAUDE\.md["']?(\s|$)/i.test(cmd)) continue;
      cmds.add(cmd);
    }
  }
}
let fires = 0;
for (const cmd of cmds) {
  const input = { tool_name: 'PowerShell', tool_input: { command: cmd }, cwd: path.join(ROOT, 'work') };
  const env = Object.assign({}, process.env); delete env.CLAUDE_CONFIG_UNLOCK;
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), encoding: 'utf8', env });
  if (/size stop/.test(r.stderr || '')) {
    fires++;
    console.log('- ' + (r.stderr || '').trim().slice(0, 140) + '\n    ' + cmd.replace(/\s+/g, ' ').slice(0, 200));
  }
}
console.log(JSON.stringify({ commands: cmds.size, sizeStopFires: fires }));
