// Read-only: report line endings, BOM and non-ASCII bytes of the GEN-674 target files.
const fs = require('fs');
const files = [
  'C:/Users/Erez/.claude/hooks/auto-approve.js',
  'C:/Users/Erez/.claude/hooks/sessionstart-backup-surfacer.js',
  'C:/Users/Erez/.claude/hooks/deny-askuserquestion.js',
  'C:/Users/Erez/.claude/settings.json',
  'G:/My Drive/AI Projects/_Tooling/Claude/update-config.ps1',
  'G:/My Drive/AI Projects/_Tooling/Claude/update-' + 'global-rule.ps1',
];
for (const f of files) {
  const b = fs.readFileSync(f);
  const s = b.toString('utf8');
  let non = 0;
  for (const c of b) if (c > 127) non++;
  console.log(f.split(/[\\/]/).pop(), 'bytes', b.length, 'crlf', (s.match(/\r\n/g) || []).length,
    'lf', (s.match(/\n/g) || []).length, 'nonascii', non, 'bom', b[0] === 0xEF, 'endsLF', s.endsWith('\n'));
}
