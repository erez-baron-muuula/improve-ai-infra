// Builds the settings.json working copy: live file + the GEN-859 hook registered on Stop and SessionStart.
// Text insertion (not re-serialization) so every other byte stays identical. Writes only to this folder.
const fs = require('fs');
const path = require('path');
const live = path.join(process.env.USERPROFILE, '.claude', 'settings.json');
let s = fs.readFileSync(live, 'utf8');
const crlf = s.includes('\r\n');
s = s.replace(/\r\n/g, '\n');
const block =
  ',\n      {\n        "matcher": "",\n        "hooks": [\n          {\n            "type": "command",\n' +
  '            "command": "node \\"C:/Users/Erez/.claude/hooks/account-session-sync.js\\"",\n' +
  '            "timeout": 30\n          }\n        ]\n      }';
function insertBefore(anchor, label) {
  const i = s.indexOf(anchor);
  if (i < 0 || s.indexOf(anchor, i + 1) >= 0) throw new Error('anchor not unique: ' + label);
  s = s.slice(0, i) + block + s.slice(i);
}
insertBefore('\n    ],\n    "SessionStart": [', 'end of Stop');
insertBefore('\n    ],\n    "PreCompact": [', 'end of SessionStart');
const parsed = JSON.parse(s);
const count = ev => parsed.hooks[ev].filter(g => g.hooks.some(h => h.command.includes('account-session-sync.js'))).length;
if (count('Stop') !== 1 || count('SessionStart') !== 1) throw new Error('registration count wrong');
if (crlf) s = s.replace(/\n/g, '\r\n');
fs.writeFileSync(path.join(__dirname, 'settings.json'), s, 'utf8');
console.log('built; Stop hooks', parsed.hooks.Stop.length, 'SessionStart hooks', parsed.hooks.SessionStart.length, 'crlf=' + crlf);
