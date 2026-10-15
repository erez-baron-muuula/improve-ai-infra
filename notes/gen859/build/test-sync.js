// Fixture tests for account-session-sync.js. Builds a fake APPDATA + home tree under ./fixture and runs the
// hook through its real entry point (stdin payload, env-redirected paths). Never touches real folders.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, 'account-session-sync.js');
const ROOT = path.join(__dirname, 'fixture');
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const ORG = 'cccccccc-0000-4000-8000-000000000003';
const id = n => `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cli = n => `eeeeeeee-0000-4000-8000-${String(n).padStart(12, '0')}`;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; } else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

const app = () => path.join(ROOT, 'appdata', 'Claude');
const home = () => path.join(ROOT, 'home');
const dirOf = acct => path.join(app(), 'claude-code-sessions', acct, ORG);
const stateDir = () => path.join(home(), '.claude', 'account-session-sync');
const queue = () => path.join(home(), '.claude', 'backup-sweep-failures.jsonl');

function reset(active) {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(dirOf(A), { recursive: true });
  fs.mkdirSync(dirOf(B), { recursive: true });
  fs.mkdirSync(path.join(home(), '.claude', 'projects', 'p1'), { recursive: true });
  setActive(active || A);
}
function setActive(acct) {
  fs.writeFileSync(path.join(app(), 'config.json'), JSON.stringify({ foo: 1, lastKnownAccountUuid: acct, oauth: 'SECRET' }));
}
function entry(acct, n, opts = {}) {
  const f = path.join(dirOf(acct), `local_${id(n)}.json`);
  const obj = { sessionId: `local_${id(n)}`, cliSessionId: cli(n), title: opts.title || `t${n}`, isArchived: !!opts.archived, lastActivityAt: 1 };
  if (opts.bridge) obj.bridgeSessionIds = opts.bridge;
  fs.writeFileSync(f, opts.raw !== undefined ? opts.raw : JSON.stringify(obj));
  if (opts.mtime) fs.utimesSync(f, new Date(opts.mtime), new Date(opts.mtime));
  return f;
}
function transcript(n) { fs.writeFileSync(path.join(home(), '.claude', 'projects', 'p1', `${cli(n)}.jsonl`), '{}\n'); }
function marker(acct, n, t) { fs.writeFileSync(path.join(dirOf(acct), `deleted_${id(n)}`), String(t)); }
const logDir = () => path.join(ROOT, 'localappdata', 'Claude', 'Logs');
const pad = n => String(n).padStart(2, '0');
const logTs = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
function appLog(lines) { fs.mkdirSync(logDir(), { recursive: true }); fs.writeFileSync(path.join(logDir(), 'main.log'), lines.join('\n') + '\n'); }
function run(payload, args = []) {
  const env = { ...process.env, APPDATA: path.join(ROOT, 'appdata'), LOCALAPPDATA: path.join(ROOT, 'localappdata'), USERPROFILE: home(), HOME: home() };
  return spawnSync(process.execPath, [HOOK, ...args], { input: JSON.stringify(payload || { hook_event_name: 'Stop', session_id: 'x' }), env, encoding: 'utf8' });
}
function hashDir(d) {
  const h = crypto.createHash('sha256');
  for (const n of fs.readdirSync(d).sort()) { const p = path.join(d, n); h.update(n); const st = fs.statSync(p); if (st.isFile()) { h.update(fs.readFileSync(p)); h.update(String(Math.round(st.mtimeMs))); } }
  return h.digest('hex');
}
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const exists = f => fs.existsSync(f);
const local = (acct, n) => path.join(dirOf(acct), `local_${id(n)}.json`);
const queueRecs = () => exists(queue()) ? fs.readFileSync(queue(), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const lastRun = () => { const l = fs.readFileSync(path.join(stateDir(), 'changes.log'), 'utf8').trim().split('\n').map(JSON.parse).filter(r => r.outcome); return l[l.length - 1]; };
const T0 = Date.now() - 3600e3;

// 1-3: new copy, dead skip, bridge stripped, update keeps dest bridge, no ping-pong, active never written
reset();
entry(A, 1, { bridge: ['sA1'], mtime: T0 }); transcript(1);
entry(A, 2, { mtime: T0 - 3 * 86400e3 });       // no transcript, old -> dead, silent
entry(A, 3, { title: 'new', bridge: ['sA3'], mtime: T0 + 60e3 }); transcript(3);
entry(B, 3, { title: 'old', bridge: ['sB3'], mtime: T0 });
let hA = hashDir(dirOf(A));
let r = run({ hook_event_name: 'Stop', session_id: cli(1) });
check('exit 0', r.status === 0, r.stderr);
check('stdout empty', r.stdout === '', r.stdout);
check('new copy made', exists(local(B, 1)));
check('new copy has no bridge', exists(local(B, 1)) && !('bridgeSessionIds' in read(local(B, 1))));
check('new copy mtime = source', exists(local(B, 1)) && Math.abs(fs.statSync(local(B, 1)).mtimeMs - T0) < 1000);
check('dead entry skipped', !exists(local(B, 2)));
check('update applied', read(local(B, 3)).title === 'new');
check('update keeps dest bridge', JSON.stringify(read(local(B, 3)).bridgeSessionIds) === '["sB3"]');
check('active folder untouched', hashDir(dirOf(A)) === hA);
check('outcome complete', lastRun().outcome === 'complete', lastRun());
check('crossCheck active', lastRun().crossCheck === 'active', lastRun());
check('last-success stamped', exists(path.join(stateDir(), 'last-success')));
const hB = hashDir(dirOf(B));
run({ hook_event_name: 'Stop', session_id: cli(1) });
check('second run: no ping-pong', hashDir(dirOf(B)) === hB && lastRun().copied === 0 && lastRun().updated === 0, lastRun());
check('config secret not logged', !fs.readFileSync(path.join(stateDir(), 'changes.log'), 'utf8').includes('SECRET'));
// reverse: switch active to B, edit B's copy -> flows back keeping A's bridge
setActive(B);
const f3 = local(B, 3); const o3 = read(f3); o3.title = 'renamed-in-B'; fs.writeFileSync(f3, JSON.stringify(o3));
hA = null;
const hBnow = hashDir(dirOf(B));
run({ hook_event_name: 'Stop', session_id: cli(3) });
check('reverse update', read(local(A, 3)).title === 'renamed-in-B');
check('reverse keeps A bridge', JSON.stringify(read(local(A, 3)).bridgeSessionIds) === '["sA3"]');
check('reverse: B (active) untouched', hashDir(dirOf(B)) === hBnow);

// 4-6: deletions
reset();
entry(A, 10, { mtime: T0 }); transcript(10);
entry(B, 11, { mtime: T0 });                      // deleted in A at T0+10min, B copy older -> remove
marker(A, 11, T0 + 600e3);
entry(B, 12, { mtime: T0 + 1200e3 });             // deleted in A at T0+10min, B revived later -> keep
marker(A, 12, T0 + 600e3);
entry(A, 13, { mtime: T0 + 1800e3 }); transcript(13); // revived in A after B's marker -> copy
marker(B, 13, T0 + 600e3);
entry(A, 14, { mtime: T0 }); transcript(14);     // deleted in B after A's entry -> skip
marker(B, 14, T0 + 600e3);
run({ hook_event_name: 'Stop', session_id: cli(10) });
check('deleted in A -> removed from B', !exists(local(B, 11)));
check('deleted in A -> marker in B', exists(path.join(dirOf(B), `deleted_${id(11)}`)));
check('removed entry is in trash', fs.readdirSync(path.join(stateDir(), 'trash'), { recursive: true }).some(n => String(n).includes(`local_${id(11)}`)));
check('revived in B kept', exists(local(B, 12)));
check('revived in A copied', exists(local(B, 13)) && !exists(path.join(dirOf(B), `deleted_${id(13)}`)));
check('deleted in B not re-copied', !exists(local(B, 14)));
check('deletions outcome complete', lastRun().outcome === 'complete', lastRun());
// convergence: second run changes nothing
const hB2 = hashDir(dirOf(B));
run({ hook_event_name: 'Stop', session_id: cli(10) });
check('deletions converge', hashDir(dirOf(B)) === hB2, lastRun());

// 7: removal cap
reset();
for (let n = 20; n < 32; n++) { entry(B, n, { mtime: T0 }); marker(A, n, T0 + 600e3); }
run({ hook_event_name: 'Stop', session_id: 'x' });
check('cap: nothing removed', [...Array(12).keys()].every(i => exists(local(B, 20 + i))));
check('cap: error reported', queueRecs().some(q => q.kind === 'account-sync-error' && /limit 10/.test(q.detail)));
run({ hook_event_name: 'Stop' }, ['--budget', '60', '--max-removals', '12']);
check('cap override removes', [...Array(12).keys()].every(i => !exists(local(B, 20 + i))));

// 8: cross-check disagreement -> no writes
reset();
entry(B, 40, { mtime: T0 }); entry(A, 41, { mtime: T0 }); transcript(41);
let hBx = hashDir(dirOf(B));
run({ hook_event_name: 'Stop', session_id: cli(40) });  // session listed only under B, config says A
check('crosscheck: B untouched', hashDir(dirOf(B)) === hBx);
check('crosscheck: reported', queueRecs().some(q => /the only one/.test(q.detail)));
check('crosscheck: no last-success', !exists(path.join(stateDir(), 'last-success')));

// 9: disabled
reset(); entry(A, 50, { mtime: T0 }); transcript(50);
fs.mkdirSync(stateDir(), { recursive: true }); fs.writeFileSync(path.join(stateDir(), 'disabled'), '');
run(); check('disabled: nothing copied', !exists(local(B, 50)));

// 10: three accounts
reset(); entry(A, 60, { mtime: T0 }); transcript(60);
fs.mkdirSync(path.join(app(), 'claude-code-sessions', 'ffffffff-0000-4000-8000-000000000009', ORG), { recursive: true });
run(); check('3 accounts: nothing copied', !exists(local(B, 60)));
check('3 accounts: reported', queueRecs().some(q => /exactly 2/.test(q.detail)));

// 11: tripwire
reset(); for (let k = 0; k < 25; k++) fs.writeFileSync(path.join(dirOf(A), `session_${k}.dat`), 'x');
run(); check('tripwire reported', queueRecs().some(q => /may have changed its format/.test(q.detail)));
// tripwire, head-shape half: entries named right but with no readable session id
reset(); for (let n = 200; n < 225; n++) entry(A, n, { raw: '{"sessionId":"x","other":1}', mtime: T0 - 3 * 86400e3 });
run(); check('tripwire (no ids) reported', queueRecs().some(q => /0 with a readable session id/.test(q.detail)));

// 12: budget -> incomplete, no last-success
reset(); for (let n = 70; n < 75; n++) { entry(A, n, { mtime: T0 }); transcript(n); }
run({ hook_event_name: 'Stop' }, ['--budget', '0.001']);
check('budget: incomplete', lastRun().outcome === 'incomplete', lastRun());
check('budget: no last-success', !exists(path.join(stateDir(), 'last-success')));

// 13: corrupt source -> report only on 2nd consecutive run
reset(); entry(A, 80, { raw: '{"sessionId":"local_' + id(80) + '","cliSessionId":"' + cli(80) + '", BROKEN', mtime: T0 }); transcript(80);
run(); check('parse fail 1: not reported', !queueRecs().some(q => /could not be read/.test(q.detail)));
run(); check('parse fail 2: reported', queueRecs().some(q => /could not be read/.test(q.detail)));
check('parse fail: nothing copied', !exists(local(B, 80)));

// 14: no app folder -> silent, no state dir
fs.rmSync(ROOT, { recursive: true, force: true }); fs.mkdirSync(path.join(home(), '.claude'), { recursive: true });
r = run(); check('no app: exit 0, silent', r.status === 0 && r.stdout === '' && !exists(stateDir()), r.stderr);

// 15: SessionStart payload + orphan tmp cleanup
reset(); entry(A, 90, { mtime: T0 }); transcript(90);
const orphan = path.join(dirOf(B), `.local_${id(1)}.json.999.sync.tmp`); fs.writeFileSync(orphan, 'x'); fs.utimesSync(orphan, new Date(T0), new Date(T0));
run({ hook_event_name: 'SessionStart', session_id: cli(90), source: 'startup' });
check('SessionStart copies', exists(local(B, 90)));
check('orphan tmp cleaned', !exists(orphan));
check('SessionStart event logged', lastRun().event === 'SessionStart', lastRun());

// 16: a live long-budget lock is respected; an expired one is taken over
reset(); entry(A, 100, { mtime: T0 }); transcript(100);
fs.mkdirSync(stateDir(), { recursive: true });
fs.writeFileSync(path.join(stateDir(), 'lock'), JSON.stringify({ pid: 1, ts: Date.now() - 300e3, until: Date.now() + 300e3 }));
run(); check('live lock respected', !exists(local(B, 100)) && lastRun().outcome === 'skipped-locked', lastRun());
fs.writeFileSync(path.join(stateDir(), 'lock'), JSON.stringify({ pid: 1, ts: Date.now() - 900e3, until: Date.now() - 600e3 }));
run(); check('expired lock taken over', exists(local(B, 100)) && !exists(path.join(stateDir(), 'lock')), lastRun());

// 17: head cache: second run reuses it (cache file present, results identical)
check('head cache written', exists(path.join(stateDir(), 'head-cache.json')));

// 18: unreadable config -> nothing written, not reported as a switch
reset(); entry(A, 110, { mtime: T0 }); transcript(110);
fs.writeFileSync(path.join(app(), 'config.json'), '{"broken": ');
run(); check('config unreadable: nothing copied', !exists(local(B, 110)));
check('config unreadable: reported', queueRecs().some(q => /could not tell which account/.test(q.detail)));

// 19: --max-removals alone counts as a manual run and is honoured
reset();
for (let n = 120; n < 132; n++) { entry(B, n, { mtime: T0 }); marker(A, n, T0 + 600e3); }
r = run({}, ['--max-removals', '12']);
check('max-removals alone works', [...Array(12).keys()].every(i => !exists(local(B, 120 + i))), lastRun());
check('manual run prints a result line', /"outcome":"complete"/.test(r.stderr), r.stderr);

// 20: recently used session without a conversation file -> reported (assumption broke), old one silent
reset();
entry(A, 140, { mtime: Date.now() - 3600e3 });     // used 1 h ago, no transcript
entry(A, 141, { mtime: T0 - 5 * 86400e3 });        // 5 days old, no transcript
run();
check('live-uncopyable reported', queueRecs().some(q => /recently used session/.test(q.detail) && q.detail.includes(id(140)) && !q.detail.includes(id(141))));
check('live-uncopyable blocks last-success', !exists(path.join(stateDir(), 'last-success')));
// an OLD entry the app merely re-saved (new file date, old lastActivityAt) is not a false alarm
reset();
const resaved = entry(A, 142, { raw: JSON.stringify({ sessionId: `local_${id(142)}`, cliSessionId: cli(142), lastActivityAt: Date.now() - 9 * 86400e3 }), mtime: Date.now() - 3600e3 });
run();
check('re-saved old entry not reported', !queueRecs().some(q => /recently used session/.test(q.detail)) && exists(resaved));

// 21: destination newer than source for the current session -> abort (other account is live)
reset();
entry(A, 150, { mtime: T0 }); transcript(150);
entry(B, 150, { mtime: T0 + 600e3 });
entry(A, 151, { mtime: T0 }); transcript(151);
run({ hook_event_name: 'Stop', session_id: cli(150) });
check('other-newer: nothing copied', !exists(local(B, 151)));
check('other-newer: reported', queueRecs().some(q => /is newer/.test(q.detail)));

// 22: destination unreadable on update -> left alone, reported, not overwritten
reset();
entry(A, 160, { title: 'new', mtime: T0 + 600e3 }); transcript(160);
entry(B, 160, { raw: 'garbage', mtime: T0 });
run();
check('unreadable dest left alone', fs.readFileSync(local(B, 160), 'utf8') === 'garbage');
check('unreadable dest reported once as aggregate', queueRecs().filter(q => /could not be synced this run/.test(q.detail)).length === 1);

// 23: revival with a dead transcript keeps the destination marker
reset();
entry(A, 170, { mtime: T0 + 1800e3 }); marker(B, 170, T0 + 600e3); // no transcript
run();
check('dead revival keeps marker', exists(path.join(dirOf(B), `deleted_${id(170)}`)) && !exists(local(B, 170)));

// 24: source-folder temp leftovers are not touched (rule zero)
reset(); entry(A, 180, { mtime: T0 }); transcript(180);
const srcOrphan = path.join(dirOf(A), `.local_${id(180)}.json.999.sync.tmp`); fs.writeFileSync(srcOrphan, 'x'); fs.utimesSync(srcOrphan, new Date(T0), new Date(T0));
run(); check('source temp leftover untouched', exists(srcOrphan));

// 25-30: app-load check
function loadSetup() {
  reset();
  for (let n = 300; n < 305; n++) { entry(A, n, { mtime: T0 }); transcript(n); }
  run({ hook_event_name: 'Stop', session_id: cli(300) });                  // A active: copies 5 into B, records B count
  const rec = read(path.join(stateDir(), 'dest-counts.json'))[`${B}\\${ORG}`];
  return rec;
}
const bFolder = () => dirOf(B);
let rec = loadSetup();
check('dest count recorded', rec && rec.count === 5, rec);
setActive(B);
appLog([`${logTs(Date.now() - 86400e3)} [info] app start`, `${logTs(rec.ts + 2000)} [info] Loaded 5 persisted sessions from ${bFolder()}`, "  appVersion: '9.9.9',"]);
run({ hook_event_name: 'SessionStart', session_id: cli(300), source: 'startup' });
check('load ok: no report', !queueRecs().some(q => /loaded \d+ sessions/.test(q.detail)) && JSON.stringify(lastRun().loadCheck) === '{"expected":5,"loaded":5,"gap":0,"version":"9.9.9"}', lastRun());

// Cowork lists log a similar line for the same account\org under another folder: it must not count.
rec = loadSetup(); setActive(B);
const cowork = path.join(ROOT, 'appdata', 'Claude', 'local-agent-mode-sessions', B, ORG);
appLog([`${logTs(Date.now() - 86400e3)} [info] app start`, `${logTs(rec.ts + 1000)} [info] Loaded 0 persisted sessions from ${cowork}`, `${logTs(rec.ts + 3000)} [info] Loaded 5 persisted sessions from ${bFolder()}`]);
run({ hook_event_name: 'SessionStart', session_id: cli(300) });
check('cowork line ignored', lastRun().loadCheck && lastRun().loadCheck.loaded === 5 && !queueRecs().some(q => /loaded \d+ sessions/.test(q.detail)), lastRun());

// An unparseable archived-deferred note makes the line not match -> "could not confirm", never a false gap.
rec = loadSetup(); setActive(B);
const dc2 = read(path.join(stateDir(), 'dest-counts.json')); dc2[`${B}\\${ORG}`].ts = Date.now() - 3600e3; fs.writeFileSync(path.join(stateDir(), 'dest-counts.json'), JSON.stringify(dc2));
appLog([`${logTs(Date.now() - 86400e3)} [info] app start`, `${logTs(Date.now() - 1800e3)} [info] Loaded 1 persisted sessions from ${bFolder()} (archived: 4 deferred)`]);
run({ hook_event_name: 'SessionStart', session_id: cli(300) });
check('odd archived note: no false gap', !queueRecs().some(q => /loaded \d+ sessions/.test(q.detail)) && queueRecs().some(q => /could not find|unconfirmed/.test(q.detail)));

rec = loadSetup(); setActive(B);
appLog([`${logTs(Date.now() - 86400e3)} [info] app start`, `${logTs(rec.ts + 2000)} [info] Loaded 1 persisted sessions from ${bFolder()} (1 archived deferred, 1 of them unopened; hint used)`, "  appVersion: '9.9.9',"]);
run({ hook_event_name: 'SessionStart', session_id: cli(300) });
check('load gap reported', queueRecs().some(q => /loaded 2 sessions, but its list held 5/.test(q.detail) && /9\.9\.9/.test(q.detail)));
const before = queueRecs().length;
run({ hook_event_name: 'SessionStart', session_id: cli(300) });
check('load gap checked once only', queueRecs().length === before);

rec = loadSetup(); setActive(B);
const dc = read(path.join(stateDir(), 'dest-counts.json')); dc[`${B}\\${ORG}`].ts = Date.now() - 3600e3; fs.writeFileSync(path.join(stateDir(), 'dest-counts.json'), JSON.stringify(dc));
appLog([`${logTs(Date.now() - 86400e3)} [info] app start`, `${logTs(Date.now() - 1800e3)} [info] something else`]);
run({ hook_event_name: 'SessionStart', session_id: cli(300) });
check('missing Loaded line reported', queueRecs().some(q => /could not find|unconfirmed/.test(q.detail)));

rec = loadSetup(); setActive(B);
const dc3 = read(path.join(stateDir(), 'dest-counts.json')); dc3[`${B}\\${ORG}`].ts = Date.now() - 3600e3; fs.writeFileSync(path.join(stateDir(), 'dest-counts.json'), JSON.stringify(dc3));
appLog([`${logTs(Date.now() - 1800e3)} [info] log rotated, starts after the snapshot`]);
run({ hook_event_name: 'SessionStart', session_id: cli(300) });
check('rotated log: no report', !queueRecs().some(q => /could not find|loaded \d+ sessions/.test(q.detail)) && lastRun().loadCheck === 'log-rotated', lastRun());

// moved log / changed timestamp format must NOT read as "rotated": reported once per app version
function agedSetup() {
  const r0 = loadSetup(); setActive(B);
  const d = read(path.join(stateDir(), 'dest-counts.json')); d[`${B}\\${ORG}`].ts = Date.now() - 3600e3;
  fs.writeFileSync(path.join(stateDir(), 'dest-counts.json'), JSON.stringify(d));
  return r0;
}
agedSetup(); fs.rmSync(logDir(), { recursive: true, force: true });
run({ hook_event_name: 'SessionStart', session_id: cli(300) });
check('no log folder: reported', queueRecs().some(q => /could not find the Claude app's log/.test(q.detail)), queueRecs().map(q => q.detail));
agedSetup();
appLog([`${logTs(Date.now() - 1800e3)}.123 [info] Loaded 5 persisted sessions from ${bFolder()}`, "  appVersion: '7.0.0',"]);
run({ hook_event_name: 'SessionStart', session_id: cli(300) });
check('ms timestamps: reported, not rotated', lastRun().loadCheck === 'not-found' && queueRecs().some(q => /could not find the line/.test(q.detail)), lastRun());
// next switch, same app version: not reported again
const nUnconf = queueRecs().filter(q => /could not find the line/.test(q.detail)).length;
setActive(A); run({ hook_event_name: 'Stop', session_id: cli(300) }); // records a new snapshot of B
const d4 = read(path.join(stateDir(), 'dest-counts.json')); d4[`${B}\\${ORG}`].ts = Date.now() - 3600e3; fs.writeFileSync(path.join(stateDir(), 'dest-counts.json'), JSON.stringify(d4));
fs.rmSync(path.join(stateDir(), 'reported.json'), { force: true }); // even with the 24 h de-dup gone
setActive(B); run({ hook_event_name: 'SessionStart', session_id: cli(300) });
check('same version: not repeated', queueRecs().filter(q => /could not find the line/.test(q.detail)).length === nUnconf);

rec = loadSetup(); setActive(B);
appLog([`${logTs(rec.ts - 5000)} [info] Loaded 2 persisted sessions from ${bFolder()}`, `${logTs(rec.ts + 3000)} [info] Loaded 5 persisted sessions from ${dirOf(A)}`]);
run({ hook_event_name: 'Stop', session_id: cli(300) });
check('Stop runs do not check', !exists(path.join(stateDir(), 'load-check.json')));

console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
