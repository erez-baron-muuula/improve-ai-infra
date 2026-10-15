// Dress rehearsal on a full copy of the real session lists (C:\Users\Erez\.claude-staging\gen859-rehearsal).
// The hook's APPDATA and home are redirected there; ~/.claude/projects is a read-only junction to the real one.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const HOOK = path.join(__dirname, 'account-session-sync.js');
const R = 'C:\\Users\\Erez\\.claude-staging\\gen859-rehearsal';
const ROOT = path.join(R, 'appdata', 'Claude', 'claude-code-sessions');
const ERZ = 'a47791bc-f28c-4025-a47f-f39d0eee57dd', INF = 'c68119fc-d3d6-4fe0-a413-6ebbed20cbb0', ORG = '13fa9673-ac05-4484-9d1a-93741a41beed';
const env = { ...process.env, APPDATA: path.join(R, 'appdata'), USERPROFILE: path.join(R, 'home'), HOME: path.join(R, 'home') };
const setActive = a => fs.writeFileSync(path.join(R, 'appdata', 'Claude', 'config.json'), JSON.stringify({ lastKnownAccountUuid: a }));
const ids = a => new Set(fs.readdirSync(path.join(ROOT, a, ORG)).filter(n => /^local_/.test(n)));
const lastRun = () => { const l = fs.readFileSync(path.join(R, 'home', '.claude', 'account-session-sync', 'changes.log'), 'utf8').trim().split('\n').map(JSON.parse).filter(r => r.outcome); return l[l.length - 1]; };
function run(payload, args) {
  const t = Date.now();
  const r = spawnSync(process.execPath, [HOOK, ...(args || [])], { input: JSON.stringify(payload), env, encoding: 'utf8' });
  return { wall: Date.now() - t, status: r.status, stdout: r.stdout, stderr: r.stderr.trim(), log: lastRun() };
}
const snap = dir => { const m = {}; for (const n of fs.readdirSync(dir)) { const st = fs.statSync(path.join(dir, n)); if (st.isFile()) m[n] = st.size + ':' + Math.round(st.mtimeMs); } return m; };
const same = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => a[k] === b[k]);

console.log('before: erez', ids(ERZ).size, 'info', ids(INF).size);
// 1. info@ active (as now): catch-up info -> erez
setActive(INF);
let infoSnap = snap(path.join(ROOT, INF, ORG));
let r = run({ hook_event_name: 'Stop', session_id: '198ebe68-453e-44e2-8ae9-65ce8ce810dc' }, ['--budget', '600']);
console.log('info->erez catch-up', JSON.stringify(r));
console.log('  info (active) untouched:', same(infoSnap, snap(path.join(ROOT, INF, ORG))));
r = run({ hook_event_name: 'Stop', session_id: '198ebe68-453e-44e2-8ae9-65ce8ce810dc' });
console.log('steady Stop (info active)', JSON.stringify(r));
r = run({ hook_event_name: 'SessionStart', session_id: '198ebe68-453e-44e2-8ae9-65ce8ce810dc', source: 'startup' });
console.log('steady SessionStart', JSON.stringify(r));
// 2. switch: erez@ active: catch-up erez -> info via normal 8 s Stop runs
setActive(ERZ);
const erezSnap = snap(path.join(ROOT, ERZ, ORG));
for (let i = 1; i <= 6; i++) {
  r = run({ hook_event_name: 'Stop', session_id: '198ebe68-453e-44e2-8ae9-65ce8ce810dc' });
  console.log(`erez->info Stop #${i}`, JSON.stringify(r));
  if (r.log.outcome === 'complete') break;
}
console.log('  erez (active) untouched:', same(erezSnap, snap(path.join(ROOT, ERZ, ORG))));
r = run({ hook_event_name: 'Stop', session_id: '198ebe68-453e-44e2-8ae9-65ce8ce810dc' });
console.log('steady Stop (erez active)', JSON.stringify(r));
const e = ids(ERZ), f = ids(INF);
const onlyE = [...e].filter(x => !f.has(x)), onlyI = [...f].filter(x => !e.has(x));
console.log('after: erez', e.size, 'info', f.size, 'only-in-erez', onlyE.length, 'only-in-info', onlyI.length);
// entries only on one side must be dead (no transcript) or tombstoned on the other side
const proj = 'C:\\Users\\Erez\\.claude\\projects';
const names = new Set(); for (const d of fs.readdirSync(proj)) { try { for (const x of fs.readdirSync(path.join(proj, d))) if (x.endsWith('.jsonl')) names.add(x.toLowerCase()); } catch (er) {} }
function why(acct, other, n) {
  const id = n.slice(6, -5);
  if (fs.existsSync(path.join(ROOT, other, ORG, 'deleted_' + id))) return 'tombstoned';
  const head = fs.readFileSync(path.join(ROOT, acct, ORG, n), 'utf8').slice(0, 4096);
  const m = /"cliSessionId"\s*:\s*"([0-9a-f-]{36})"/.exec(head);
  if (!m) return 'no-cli';
  return names.has(m[1] + '.jsonl') ? 'LIVE-NOT-SYNCED' : 'dead';
}
const tally = {};
for (const n of onlyE) { const w = why(ERZ, INF, n); tally['erez:' + w] = (tally['erez:' + w] || 0) + 1; }
for (const n of onlyI) { const w = why(INF, ERZ, n); tally['info:' + w] = (tally['info:' + w] || 0) + 1; }
console.log('one-sided entries by reason', JSON.stringify(tally));
// bridge leakage: any copy made by the sync carrying the other account's ids?
let leaks = 0;
for (const n of [...e].filter(x => f.has(x))) {
  const a = JSON.parse(fs.readFileSync(path.join(ROOT, ERZ, ORG, n), 'utf8')).bridgeSessionIds || [];
  const b = JSON.parse(fs.readFileSync(path.join(ROOT, INF, ORG, n), 'utf8')).bridgeSessionIds || [];
  if (a.some(x => b.includes(x))) leaks++;
}
console.log('entries sharing a phone-link id across accounts:', leaks);
const q = path.join(R, 'home', '.claude', 'backup-sweep-failures.jsonl');
console.log('failure records:', fs.existsSync(q) ? fs.readFileSync(q, 'utf8').trim() : '(none)');
