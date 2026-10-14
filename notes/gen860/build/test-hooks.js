// Live-verify fixtures for sessionstart-session-backup.js and sessionstart-backup-surfacer.js.
// Each case builds a fake home (USERPROFILE -> os.homedir()) with its own .claude tree, pipes a real-shaped
// SessionStart payload to the hook, and asserts files/records/stdout. Nothing under the real ~/.claude is touched.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const BUILD = __dirname;
const HOOK = path.join(BUILD, 'sessionstart-session-backup.js');
const SURF = path.join(BUILD, 'sessionstart-backup-surfacer.js');
const REAL_QUEUE = 'C:/Users/Erez/.claude/backup-sweep-failures.jsonl';
const results = [];
const check = (name, ok, info = '') => results.push({ name, ok: !!ok, info });
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hooktest-'));

function home(name) {
  const h = path.join(root, name);
  fs.mkdirSync(path.join(h, '.claude', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(h, '.claude', 'projects', 'p1'), { recursive: true });
  return h;
}
function stub(h, body) {
  fs.writeFileSync(path.join(h, '.claude', 'scripts', 'session-backup.ps1'),
    "param([string]$SessionId, [int]$BudgetSeconds)\n" +
    "Add-Content -LiteralPath (Join-Path $env:USERPROFILE 'ran.txt') -Value \"$SessionId $BudgetSeconds\"\n" + body + '\n');
}
function run(file, h, payload) {
  const env = Object.assign({}, process.env, { USERPROFILE: h, HOME: h });
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [file], { input: JSON.stringify(payload), env, encoding: 'utf8', timeout: 120000 });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', ms: Date.now() - t0 };
}
const q = h => { const f = path.join(h, '.claude', 'backup-sweep-failures.jsonl'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []; };
const ran = h => { const f = path.join(h, 'ran.txt'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean) : []; };
const attempt = h => path.join(h, '.claude', 'session-backup-state', 'last-attempt');
const payload = { session_id: 'aaaaaaaa-1111-2222-3333-444444444444', hook_event_name: 'SessionStart', source: 'startup' };

// ---------------- hook
{ const h = home('h-ok'); stub(h, 'exit 0');
  const r = run(HOOK, h, payload);
  check('hook exit0: ran once with session id + budget', ran(h).length === 1 && ran(h)[0] === payload.session_id + ' 20', ran(h).join('|'));
  check('hook exit0: no record, no stdout, exit 0', q(h).length === 0 && r.stdout === '' && r.status === 0, r.stderr);
  check('hook exit0: attempt stamped', fs.existsSync(attempt(h)));
  run(HOOK, h, payload);
  check('hook throttle: second start within 30 min does not run', ran(h).length === 1);
  fs.writeFileSync(attempt(h), String(Date.now() + 3600000));
  run(HOOK, h, payload);
  check('hook throttle: future stamp is ignored (runs)', ran(h).length === 2);
  fs.writeFileSync(attempt(h), 'garbage');
  run(HOOK, h, payload);
  check('hook throttle: unreadable stamp is ignored (runs)', ran(h).length === 3); }
for (const code of [10, 11, 12]) {
  const h = home('h-' + code); stub(h, 'exit ' + code);
  run(HOOK, h, payload);
  check(`hook exit${code}: no hook record`, q(h).length === 0 && ran(h).length === 1);
}
{ const h = home('h-13'); stub(h, 'exit 13');
  run(HOOK, h, payload);
  const rec = q(h);
  check('hook exit13: one record, says could not record', rec.length === 1 && /could not record/.test(rec[0].detail) && rec[0].repo === '(session backup)' && rec[0].kind === 'error' && rec[0].surfaced === false && rec[0].session === payload.session_id, JSON.stringify(rec)); }
{ const h = home('h-14'); stub(h, 'exit 14');
  run(HOOK, h, payload);
  const st = Number(fs.readFileSync(attempt(h), 'utf8'));
  const age = Date.now() - st;
  check('hook exit14: no record; stamp back-dated to retry in about 5 min', q(h).length === 0 && age > 24.5 * 60000 && age < 25.5 * 60000, 'age min=' + (age / 60000).toFixed(2));
  run(HOOK, h, payload);
  check('hook exit14: a start within the 5 minutes does not retry', ran(h).length === 1);
  fs.writeFileSync(attempt(h), String(Date.now() - 30 * 60000 - 1000));
  run(HOOK, h, payload);
  check('hook exit14: a start after the retry window retries', ran(h).length === 2); }
{ const h = home('h-7'); stub(h, 'exit 7');
  run(HOOK, h, payload);
  const rec = q(h);
  check('hook exit7: one record naming the code', rec.length === 1 && /code 7/.test(rec[0].detail), JSON.stringify(rec)); }
{ const h = home('h-parse'); stub(h, 'throw "boom"');
  run(HOOK, h, payload);
  const rec = q(h);
  check('hook script throws: recorded by hook (exit 1)', rec.length === 1 && /code 1\b/.test(rec[0].detail), JSON.stringify(rec)); }
{ const h = home('h-missing');
  run(HOOK, h, payload);
  const rec = q(h);
  check('hook script missing: one record, attempt stamped', rec.length === 1 && /script missing/.test(rec[0].detail) && fs.existsSync(attempt(h)), JSON.stringify(rec));
  run(HOOK, h, payload);
  check('hook script missing: burst does not repeat the record (throttled)', q(h).length === 1); }
{ const h = home('h-badid'); stub(h, 'exit 13');
  run(HOOK, h, { session_id: 'bad id; rm -rf', hook_event_name: 'SessionStart' });
  const rec = q(h);
  check('hook odd session id replaced', rec.length === 1 && rec[0].session === 'unknown-session' && ran(h)[0] === 'unknown-session 20', JSON.stringify(rec)); }
{ const h = home('h-motw'); stub(h, 'exit 0');
  const s = path.join(h, '.claude', 'scripts', 'session-backup.ps1');
  fs.writeFileSync(s + ':Zone.Identifier', '[ZoneTransfer]\r\nZoneId=3\r\n');
  const had = fs.existsSync(s + ':Zone.Identifier');
  run(HOOK, h, payload);
  check('hook MOTW: zone stream removed and script ran', had && !fs.existsSync(s + ':Zone.Identifier') && ran(h).length === 1 && q(h).length === 0, 'had=' + had + ' ran=' + ran(h).length + ' rec=' + JSON.stringify(q(h))); }
{ const h = home('h-motw-control'); stub(h, 'exit 0');
  const s = path.join(h, '.claude', 'scripts', 'session-backup.ps1');
  fs.writeFileSync(s + ':Zone.Identifier', '[ZoneTransfer]\r\nZoneId=3\r\n');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-File', s, '-SessionId', 'x', '-BudgetSeconds', '1'], { env: Object.assign({}, process.env, { USERPROFILE: h }), encoding: 'utf8' });
  check('control: a marked script IS refused under RemoteSigned (so the removal matters)', r.status !== 0 && ran(h).length === 0, 'status=' + r.status); }
{ const h = home('h-kill'); stub(h, 'Start-Sleep -Seconds 70; exit 0');
  const r = run(HOOK, h, payload);
  const rec = q(h);
  check('hook hard kill at 45 s: one record, returned before 60 s', rec.length === 1 && /stopped by the hook after 45s/.test(rec[0].detail) && r.ms < 60000, 'ms=' + r.ms + ' ' + JSON.stringify(rec)); }

// ---------------- surfacer
function surfHome(name) { const h = home(name); return h; }
const stateDir = h => { const d = path.join(h, '.claude', 'session-backup-state'); fs.mkdirSync(d, { recursive: true }); return d; };
const transcript = (h, ageMs) => { const f = path.join(h, '.claude', 'projects', 'p1', 's.jsonl'); fs.writeFileSync(f, '{}\n'); const t = new Date(Date.now() - ageMs); fs.utimesSync(f, t, t); };
const ctx = r => { if (!r.stdout) return ''; return JSON.parse(r.stdout).hookSpecificOutput.additionalContext; };
const H = 3600000;
{ const h = surfHome('s-fresh'); transcript(h, 1 * H); fs.writeFileSync(path.join(stateDir(h), 'last-success'), String(Date.now() - 2 * H));
  const r = run(SURF, h, payload);
  check('surfacer: recent success, no records -> no output', r.stdout === '' && r.status === 0, r.stdout + r.stderr); }
{ const h = surfHome('s-stale'); transcript(h, 1 * H); fs.writeFileSync(path.join(stateDir(h), 'last-success'), String(Date.now() - 48 * H));
  const c = ctx(run(SURF, h, payload));
  check('surfacer: success 48 h old, transcript changed 1 h ago -> stale line', /has not succeeded since/.test(c), c); }
{ const h = surfHome('s-thisstart'); transcript(h, 2 * 60000); fs.writeFileSync(path.join(stateDir(h), 'last-success'), String(Date.now() - 48 * H));
  const r = run(SURF, h, payload);
  check('surfacer: only a change from the last 10 min (this start) -> no line', r.stdout === '', r.stdout); }
{ const h = surfHome('s-away'); transcript(h, 72 * H); fs.writeFileSync(path.join(stateDir(h), 'last-success'), String(Date.now() - 70 * H));
  const r = run(SURF, h, payload);
  check('surfacer: away 3 days (no changes since last success) -> no line', r.stdout === '', r.stdout); }
{ const h = surfHome('s-never'); transcript(h, 1 * H);
  const c = ctx(run(SURF, h, payload));
  check('surfacer: no success recorded -> line says so', /no successful copy is recorded/.test(c), c); }
{ const h = surfHome('s-future'); transcript(h, -48 * H); fs.writeFileSync(path.join(stateDir(h), 'last-success'), String(Date.now() - 1 * H));
  const r = run(SURF, h, payload);
  check('surfacer: future transcript time capped at now -> no line', r.stdout === '', r.stdout); }
{ const h = surfHome('s-slow'); transcript(h, 1 * H); const d = stateDir(h); fs.writeFileSync(path.join(d, 'last-success'), String(Date.now()));
  fs.writeFileSync(path.join(d, 'runs.log'), [12000, 15000, 11000].map(ms => JSON.stringify({ ts: 'x', ms, outcome: 'complete' })).join('\n') + '\n');
  const c = ctx(run(SURF, h, payload));
  check('surfacer: last 3 runs > 10 s -> slow line', /took over 10 s \(latest 11 s\)/.test(c), c);
  fs.appendFileSync(path.join(d, 'runs.log'), JSON.stringify({ ts: 'y', ms: 900, outcome: 'complete' }) + '\n');
  const r2 = run(SURF, h, payload);
  check('surfacer: one fast run breaks the streak -> no slow line', r2.stdout === '', r2.stdout);
  fs.appendFileSync(path.join(d, 'runs.log'), [30000, 30000, 30000].map(ms => JSON.stringify({ ts: 'z', ms, outcome: 'skipped: another run holds the lock' })).join('\n') + '\n');
  const r3 = run(SURF, h, payload);
  check('surfacer: skipped runs do not count as slow', r3.stdout === '', r3.stdout); }
{ // real corpus: the live failure queue (read-only copy) + new session records appended after many unreachables
  const h = surfHome('s-corpus'); transcript(h, 1 * H); fs.writeFileSync(path.join(stateDir(h), 'last-success'), String(Date.now()));
  // The live queue holds 92 historical 'secret' records; by design those fill the 25-line cap first, so
  // the ordering check uses all non-secret real records plus the first 3 real secret records.
  const allReal = fs.readFileSync(REAL_QUEUE, 'utf8').split('\n').filter(Boolean);
  const realLines = allReal.filter(l => !/"kind":"secret"/.test(l)).concat(allReal.filter(l => /"kind":"secret"/.test(l)).slice(0, 3));
  const extra = [
    { ts: '2026-10-14T00:00:00Z', machine: 'X', session: 's', repo: '(session backup)', kind: 'session-shrunk', detail: 'older backup copy kept at G:\\x -- projects\\p\\a.jsonl ...', surfaced: false },
    { ts: '2026-10-14T00:00:01Z', machine: 'X', session: 's', repo: '(session backup)', kind: 'session-files-dropped', detail: '12 session transcripts disappeared', surfaced: false },
  ];
  fs.writeFileSync(path.join(h, '.claude', 'backup-sweep-failures.jsonl'), realLines.concat(extra.map(e => JSON.stringify(e))).join('\n') + '\n');
  const r = run(SURF, h, payload); const c = ctx(r);
  const firstShown = c.split('\n').filter(l => l.startsWith('  •')).slice(0, 4).join(' / ');
  check(`surfacer corpus (${realLines.length} real records + 2 session): header counts all`, new RegExp(`BACKUP SWEEP — ${realLines.length + 2} unseen failures`).test(c), c.slice(0, 200));
  check('surfacer corpus: session notices shown within the 25-record cap, before routine kinds', /many session transcripts disappeared/.test(c) && /got shorter or its earlier content changed/.test(c) && c.indexOf('many session transcripts') < c.indexOf('remote unreachable'), firstShown);
  const secrets = realLines.filter(l => /"kind":"secret"/.test(l)).length;
  check(`surfacer corpus: secret records (${secrets}) still sort first`, secrets === 0 || c.indexOf('SUSPECTED SECRET') < c.indexOf('many session transcripts'));
  const r2 = run(SURF, h, payload);
  check('surfacer corpus: cursor advanced, records not shown twice', r2.stdout === '', r2.stdout.slice(0, 200)); }
{ const h = surfHome('s-both'); transcript(h, 1 * H); fs.writeFileSync(path.join(stateDir(h), 'last-success'), String(Date.now() - 48 * H));
  fs.writeFileSync(path.join(h, '.claude', 'backup-sweep-failures.jsonl'), JSON.stringify({ ts: 't', machine: 'm', session: 's', repo: 'r', kind: 'unreachable', detail: 'd', surfaced: false }) + '\n');
  const c = ctx(run(SURF, h, payload));
  check('surfacer: queue record and stale line together', /1 unseen failure/.test(c) && /has not succeeded since/.test(c), c);
  const c2 = ctx(run(SURF, h, payload));
  check('surfacer: next start shows stale line again but not the record', /has not succeeded since/.test(c2) && !/unseen failure/.test(c2), c2); }
{ const h = surfHome('s-noprojects'); fs.rmSync(path.join(h, '.claude', 'projects'), { recursive: true });
  fs.writeFileSync(path.join(h, '.claude', 'backup-sweep-failures.jsonl'), JSON.stringify({ ts: 't', machine: 'm', session: 's', repo: 'r', kind: 'error', detail: 'd', surfaced: false }) + '\n');
  const r = run(SURF, h, payload);
  check('surfacer: staleness check failing (no projects dir) does not stop records', /1 unseen failure/.test(ctx(r)) && /staleness|check failed/.test(r.stderr), r.stderr); }

for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  -- ' + r.info));
console.log(`PASSED ${results.filter(r => r.ok).length} of ${results.length}`);
console.log('fixtures: ' + root);
