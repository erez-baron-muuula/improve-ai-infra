// GEN-892: show where the live and working-copy topic hooks differ on one input.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const LIVE = 'C:/Users/Erez/.claude/hooks';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gen892-topic-'));
fs.mkdirSync(path.join(TMP, 'refs'));
for (const f of fs.readdirSync(path.join(__dirname, 'wc', 'hooks'))) fs.writeFileSync(path.join(TMP, f), fs.readFileSync(path.join(__dirname, 'wc', 'hooks', f)));
for (const f of fs.readdirSync(path.join(LIVE, 'refs'))) { const p = path.join(LIVE, 'refs', f); if (fs.statSync(p).isFile()) fs.writeFileSync(path.join(TMP, 'refs', f), fs.readFileSync(p)); }
const run = (dir, sid) => {
  const r = spawnSync(process.execPath, [path.join(dir, 'inject-topic-refs.js'), 'notion-write', 'notion-read'],
    { input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'Notion GEN-892', session_id: sid }), encoding: 'utf8' });
  return JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
};
const a = run(LIVE, 'td' + Date.now() + 'a');
const b = run(TMP, 'td' + Date.now() + 'b');
let i = 0;
while (i < a.length && a[i] === b[i]) i++;
console.log('lengths', a.length, b.length, 'first difference at', i);
console.log('LIVE:', JSON.stringify(a.slice(Math.max(0, i - 150), i + 250)));
console.log('WC  :', JSON.stringify(b.slice(Math.max(0, i - 150), i + 250)));
