// Builds the settings.json working copy: live file + one SessionStart entry for the session backup hook.
const fs = require('fs');
const live = 'C:/Users/Erez/.claude/settings.json';
const out = process.argv[2];
const raw = fs.readFileSync(live, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
const anchor = [
  '      {',
  '        "matcher": "",',
  '        "hooks": [',
  '          {',
  '            "type": "command",',
  '            "command": "node \\"C:/Users/Erez/.claude/hooks/sessionstart-backup-spawner.js\\""',
  '          }',
  '        ]',
  '      },',
].join(eol) + eol;
const add = [
  '      {',
  '        "matcher": "",',
  '        "hooks": [',
  '          {',
  '            "type": "command",',
  '            "command": "node \\"C:/Users/Erez/.claude/hooks/sessionstart-session-backup.js\\"",',
  '            "timeout": 60',
  '          }',
  '        ]',
  '      },',
].join(eol) + eol;
const count = raw.split(anchor).length - 1;
if (count !== 1) throw new Error('anchor found ' + count + ' times');
if (raw.includes('sessionstart-session-backup.js')) throw new Error('already registered');
const next = raw.replace(anchor, anchor + add);
const parsed = JSON.parse(next); // must stay valid JSON
const ss = parsed.hooks.SessionStart.map(b => b.hooks.map(h => h.command + (h.timeout ? ' [timeout ' + h.timeout + ']' : '')).join(','));
fs.writeFileSync(out, next);
console.log('eol', JSON.stringify(eol), 'liveBytes', Buffer.byteLength(raw), 'newBytes', Buffer.byteLength(next));
console.log(ss.join('\n'));
