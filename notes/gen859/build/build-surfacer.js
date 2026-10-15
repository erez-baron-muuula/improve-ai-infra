// Builds the surfacer working copy from the live file + the GEN-859 additions. Writes only to this folder.
const fs = require('fs');
const path = require('path');
const live = path.join(process.env.USERPROFILE, '.claude', 'hooks', 'sessionstart-backup-surfacer.js');
let s = fs.readFileSync(live, 'utf8');
const crlf = s.includes('\r\n');
s = s.replace(/\r\n/g, '\n');
function rep(from, to) {
  const i = s.indexOf(from);
  if (i < 0 || s.indexOf(from, i + 1) >= 0) throw new Error('anchor not unique: ' + from.slice(0, 60));
  s = s.replace(from, to);
}
rep('  for (const check of [sessionBackupStaleLine, sessionBackupSlowLine]) {',
    '  for (const check of [sessionBackupStaleLine, sessionBackupSlowLine, accountSyncStaleLine]) {');
rep("    'session-transcript-lost': 'a session still listed in the Claude app lost its transcript on this PC — the detail says whether the Drive backup holds it (reported once)',\n  };",
    "    'session-transcript-lost': 'a session still listed in the Claude app lost its transcript on this PC — the detail says whether the Drive backup holds it (reported once)',\n" +
    "    // GEN-859 account session sync (account-session-sync.js)\n" +
    "    'account-sync-error': \"account session sync problem — the two Claude accounts' session lists may not match; see detail\",\n  };");
rep("  const SESSION_KINDS = new Set(['session-transcript-lost', 'session-shrunk', 'session-held']);",
    "  const SESSION_KINDS = new Set(['session-transcript-lost', 'session-shrunk', 'session-held', 'account-sync-error']);");
rep('// Build the operator-facing message.',
    fs.readFileSync(path.join(__dirname, 'surfacer-additions.js'), 'utf8').replace(/\r\n/g, '\n') + '\n// Build the operator-facing message.');
if (crlf) s = s.replace(/\n/g, '\r\n');
fs.writeFileSync(path.join(__dirname, 'sessionstart-backup-surfacer.js'), s, 'utf8');
console.log('built', s.length, 'chars, crlf=' + crlf);
