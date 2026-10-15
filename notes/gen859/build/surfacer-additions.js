// GEN-859: one line when the account session sync (hooks/account-session-sync.js) has not completed a run
// for more than 24 h while the session lists kept changing, or when its off switch is set; else null.
// Independent of the sync hook, so a sync that never runs (unregistered, crashing, budget-starved) is still
// noticed. Silent on a PC without the desktop app or with fewer than two accounts' lists.
const ACCOUNT_SYNC_STALE_MS = 24 * 60 * 60 * 1000;
const ACCOUNT_SYNC_IGNORE_RECENT_MS = 10 * 60 * 1000;
function accountSyncStaleLine(claudeDir, now) {
  const root = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude', 'claude-code-sessions');
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  let accounts;
  try {
    accounts = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && UUID_RE.test(d.name)).map(d => d.name);
  } catch (e) {
    return null; // no desktop app session lists on this PC
  }
  if (accounts.length < 2) return null;
  const stateDir = path.join(claudeDir, 'account-session-sync');
  const fmt = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  let off = null;
  try { off = fs.statSync(path.join(stateDir, 'disabled')); } catch (e) { /* not switched off */ }
  if (off) {
    return (
      `ACCOUNT SESSION SYNC — switched OFF since ${fmt(off.mtimeMs)} (~/.claude/account-session-sync/disabled exists), ` +
      "so sessions from one Claude account are not being copied to the other account's list. " +
      'Relay this to Erez at the top of your first response.'
    );
  }
  let lastSuccess = 0;
  try {
    const n = Number(String(fs.readFileSync(path.join(stateDir, 'last-success'), 'utf8')).trim());
    if (Number.isFinite(n) && n > 0 && n <= now) lastSuccess = n;
  } catch (e) {
    /* missing/unreadable -> never succeeded */
  }
  let newest = 0;
  for (const acct of accounts) {
    let orgs = [];
    try { orgs = fs.readdirSync(path.join(root, acct), { withFileTypes: true }).filter(d => d.isDirectory()); } catch (e) { continue; }
    for (const org of orgs) {
      let names = [];
      try { names = fs.readdirSync(path.join(root, acct, org.name)); } catch (e) { continue; }
      for (const n of names) {
        if (!n.startsWith('local_') || !n.endsWith('.json')) continue;
        try {
          const m = fs.statSync(path.join(root, acct, org.name, n)).mtimeMs;
          if (m > newest && m < now - ACCOUNT_SYNC_IGNORE_RECENT_MS) newest = m;
        } catch (e) {
          /* vanished between list and stat */
        }
      }
    }
  }
  newest = Math.min(newest, now);
  if (newest === 0 || newest - lastSuccess <= ACCOUNT_SYNC_STALE_MS) return null;
  const since = lastSuccess ? `since ${fmt(lastSuccess)}` : 'at all (no completed run is recorded)';
  return (
    `ACCOUNT SESSION SYNC — the copy that keeps both Claude accounts' session lists matched has not completed ${since}, ` +
    `but the lists changed after that (newest change ${fmt(newest)}). Sessions may be missing after switching accounts. ` +
    'Relay this to Erez at the top of your first response. Run log: ~/.claude/account-session-sync/changes.log.'
  );
}
