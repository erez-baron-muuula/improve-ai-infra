// Read-only: run the app-load parser against the REAL app logs for today's known sign-ins.
const { findLoadAfter } = require('./account-session-sync.js');
const root = 'C:\\Users\\Erez\\AppData\\Roaming\\Claude\\claude-code-sessions';
const ORG = '13fa9673-ac05-4484-9d1a-93741a41beed';
const erez = `${root}\\a47791bc-f28c-4025-a47f-f39d0eee57dd\\${ORG}`;
const info = `${root}\\c68119fc-d3d6-4fe0-a413-6ebbed20cbb0\\${ORG}`;
const at = s => new Date(s).getTime(); // local time
for (const [label, folder, since] of [
  ['erez after 14:00', erez, at('2026-10-15T14:00:00')],     // expect 14:33:11 -> 427+9 = 436
  ['erez after 15:00', erez, at('2026-10-15T15:00:00')],     // expect 15:17:39 -> 427+9 = 436
  ['info after 15:30', info, at('2026-10-15T15:30:00')],     // expect 15:44:48 -> 116+1 = 117
  ['info after 2026-10-01', info, at('2026-10-01T00:00:00')],
  ['erez after now', erez, Date.now()],                     // expect not found, covered
]) {
  const r = findLoadAfter(folder, since);
  console.log(label, JSON.stringify({ ...r, at: r.at ? new Date(r.at).toString().slice(0, 24) : null }));
}
