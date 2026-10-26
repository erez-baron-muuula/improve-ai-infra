// GEN-890 / GEN-966 tests for config-health-scan.ps1: the weekly size check (size-weekly,
// size-decide, size-record, mark-reviewed's overdue alarm) and size-check's unreadable-real-file
// path. Drives the real script (working copy by default, or argv[2]) on a fixture tree.
// Usage: node weekly-test.js [script.ps1]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn, execSync } = require('child_process');

const HERE = __dirname;
const SCRIPT = process.argv[2] || path.join(HERE, 'wc', 'config-health-scan.ps1');
const GUIDE = 'C:/Users/Erez/AI Projects/Improve AI Infra/notes/anthropic-guidelines.json';
const ARROW = String.fromCharCode(0x2192);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gen890-fx-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gen890-out-'));
const D = {
  home: path.join(root, 'home'), ai: path.join(root, 'ai'), drafts: path.join(root, 'drafts'), git: path.join(root, 'git'),
};
D.skills = path.join(D.home, 'skills'); D.commands = path.join(D.home, 'commands'); D.hooks = path.join(D.home, 'hooks');
D.projects = path.join(D.home, 'projects');
for (const d of Object.values(D)) fs.mkdirSync(d, { recursive: true });
const globalClaude = path.join(D.home, 'CLAUDE.md');
const stateFile = path.join(D.home, '.size-sweep-state.json');
const markerFile = path.join(D.home, '.marker');
function put(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, 'utf8'); return p; }
const lines = n => Array.from({ length: n }, (_, i) => 'line ' + i).join('\n') + '\n';

// fixtures
put(globalClaude, lines(150));                                                   // fine
const projClaude = put(path.join(D.ai, 'projA', 'CLAUDE.md'), lines(210));       // breach (recommended)
const hookRef = put(path.join(D.hooks, 'refs', 'notes.md'), 'x'.repeat(9500) + '\n'); // near, hard
put(path.join(D.skills, 'vet-rule', 'SKILL.md'), '---\nname: vet-rule\ndescription: "Gate."\n---\n' + 'y'.repeat(11000) + '\n'); // near, house only
const refNoToc = put(path.join(D.skills, 'big', 'ref.md'), '# Ref\n' + lines(150)); // breach (toc)
put(path.join(D.skills, 'big', 'SKILL.md'), '---\nname: big\ndescription: plain text\n---\nBody\n');
const badDesc = put(path.join(D.skills, 'bad', 'SKILL.md'), '---\nname: bad\ndescription: "a \\$ b"\n---\nBody\n'); // note
const outClaude = put(path.join(outside, 'CLAUDE.md'), lines(300));              // breach, out of scope
put(path.join(D.projects, 'p-out', 'sess.jsonl'), JSON.stringify({ type: 'x', cwd: outside }) + '\n');
// a git repo for mark-reviewed
execSync('git init -q', { cwd: D.git }); put(path.join(D.git, 'a.txt'), 'a');
execSync('git -c user.email=t@t -c user.name=t add -A', { cwd: D.git });
execSync('git -c user.email=t@t -c user.name=t commit -q -m init', { cwd: D.git });

function run(args, extra) {
  const base = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT,
    '-GuidelinesFile', GUIDE, '-SkillsDir', D.skills, '-CommandsDir', D.commands, '-HooksDir', D.hooks,
    '-ClaudeProjectsDir', D.projects, '-ProjectsRoot', D.ai, '-GlobalClaude', globalClaude, '-ClaudeHome', D.home,
    '-SizeStateFile', stateFile, '-GitHistoryRepo', D.git, '-GlobalMarkerFile', markerFile];
  const all = args.concat(extra || []);
  // a parameter given in args/extra replaces the fixture default (PowerShell rejects duplicates)
  for (let i = 0; i < all.length; i++) {
    const at = all[i].startsWith('-') ? base.indexOf(all[i]) : -1;
    if (at > 4) base.splice(at, 2);
  }
  const r = spawnSync('powershell.exe', base.concat(all), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try { return JSON.parse(r.stdout); } catch (e) { return { parseError: String(e), stdout: r.stdout, stderr: r.stderr }; }
}
let pass = 0, fail = 0;
function ok(name, cond, info) { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name + (info ? ' :: ' + JSON.stringify(info).slice(0, 1200) : '')); } }
const arr = x => (x == null ? [] : [].concat(x));
const norm = p => path.resolve(p).toLowerCase();
const keyOf = (file, limitId, measure) => norm(file) + '|' + limitId + '|' + measure;
const K = {
  proj: keyOf(projClaude, 'claude-md-lines', 'lines'),
  hook: keyOf(hookRef, 'hook-injected-text', 'characters'),
  toc: keyOf(refNoToc, 'reference-file-toc', 'lines'),
  note: keyOf(badDesc, 'skill-description-listing', 'readable'),
};
const tjson = obj => put(path.join(D.drafts, 'tickets-' + Math.random().toString(36).slice(2) + '.json'), JSON.stringify(obj));
const rjson = obj => put(path.join(D.drafts, 'record-' + Math.random().toString(36).slice(2) + '.json'), JSON.stringify(obj));
const dec = (r, key) => arr(r.decisions).find(d => d.key === key);
const daysAgo = n => new Date(Date.parse('2026-11-30T12:00:00Z') - n * 86400000).toISOString();
const AS = ['-AsOf', '2026-11-30'];

// 1. no state file: due; candidates = breach/note + hard near, in scope only
let r = run(['-Action', 'size-weekly'], AS);
ok('weekly: due with no state', r.ok === true && r.due === true && r.stateMissing === true, r);
const ck = arr(r.candidates).map(c => c.key);
ok('weekly: 4 candidates', ck.length === 4 && [K.proj, K.hook, K.toc, K.note].every(k => ck.includes(k)), ck);
ok('weekly: house-only near skipped', !ck.some(k => /vet-rule/.test(k)), ck);
ok('weekly: out-of-scope file skipped', !ck.some(k => k.startsWith(norm(outside))), ck);
ok('weekly: order breach, note, near', arr(r.candidates).map(c => c.severity).join(',') === 'breach,breach,note,near', arr(r.candidates).map(c => c.severity));
const hookC = arr(r.candidates).find(c => c.key === K.hook);
ok('weekly: refs title reuses Step 1 title', hookC && hookC.title === 'Keep refs/notes.md under the injection limit', hookC);
ok('weekly: near target below 90%', hookC && /^below 9,000 characters \(90% of the 10,000 limit\)$/.test(hookC.target), hookC);
const projC = arr(r.candidates).find(c => c.key === K.proj);
ok('weekly: title names file and limit', projC && projC.title === 'Keep ai/projA/CLAUDE.md within its claude-md-lines size limit', projC);
const noteC = arr(r.candidates).find(c => c.key === K.note);
ok('weekly: note title says fix the frontmatter', noteC && /^Fix the frontmatter of ~\/\.claude\/skills\/bad\/SKILL\.md so its description can be read$/.test(noteC.title), noteC);
ok('weekly: nothing to fetch', arr(r.needStatus).length === 0, r.needStatus);
ok('weekly: writes nothing', !fs.existsSync(stateFile));

// 2. decide with no links: 3 file + 1 deferred (cap)
r = run(['-Action', 'size-decide', '-TicketsJson', tjson({})], AS);
ok('decide: ok', r.ok === true, r);
ok('decide: cap of 3', r.counts && r.counts.file === 3 && r.counts.deferred === 1, r.counts);
ok('decide: near deferred (lowest rank)', dec(r, K.hook) && dec(r, K.hook).action === 'deferred', dec(r, K.hook));
ok('decide: cap configurable', run(['-Action', 'size-decide', '-TicketsJson', tjson({}), '-SizeFileCap', '4'], AS).counts.file === 4);

// 3. record filings -> state written, lastRun set
r = run(['-Action', 'size-record', '-RecordJson', rjson({ filed: [
  { key: K.proj, pageId: 'p-proj', ticketId: 'GEN-1', value: 210 },
  { key: K.toc, pageId: 'p-toc', ticketId: 'GEN-2', value: 151 },
  { key: K.note, pageId: 'p-note', ticketId: 'GEN-3', value: null }], escalated: [], prune: [], completed: true })], AS);
ok('record: ok, 3 filed, lastRun', r.ok === true && r.filed === 3 && r.lastRun === '2026-11-30' && r.items === 3, r);
let st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
ok('record: state has items + escalated false', st.items[K.proj] && st.items[K.proj].escalated === false && st.items[K.proj].filedValue === 210, st);

// 4. weekly gate: not due within 7 days, due at 7
ok('weekly: not due after 6 days', run(['-Action', 'size-weekly'], ['-AsOf', '2026-12-06']).due === false);
r = run(['-Action', 'size-weekly'], ['-AsOf', '2026-12-07']);
ok('weekly: due at 7 days; needs 3 statuses', r.due === true && arr(r.needStatus).length === 3, r.needStatus);

// 5. decide with statuses
const T = {
  'p-proj': { status: 'To Do', createdTime: daysAgo(30), gain: '2' },
  'p-toc': { status: 'Blocked', createdTime: daysAgo(40), gain: '1' },
  'p-note': { status: 'In Progress', createdTime: daysAgo(10), gain: '1' },
};
r = run(['-Action', 'size-decide', '-TicketsJson', tjson(T)], AS);
ok('decide: open >28d To Do -> escalate High', dec(r, K.proj).action === 'escalate' && dec(r, K.proj).priority === 'High', dec(r, K.proj));
ok('decide: Blocked -> link, no escalation', dec(r, K.toc).action === 'link', dec(r, K.toc));
ok('decide: young In Progress -> link', dec(r, K.note).action === 'link', dec(r, K.note));
ok('decide: unlinked near -> file', dec(r, K.hook).action === 'file', dec(r, K.hook));
r = run(['-Action', 'size-decide', '-TicketsJson', tjson(Object.assign({}, T, { 'p-proj': { status: 'In Progress', createdTime: daysAgo(30), gain: '1' } }))], AS);
ok('decide: Gain 1 escalates to Highest', dec(r, K.proj).priority === 'Highest', dec(r, K.proj));
ok('decide: missing status -> error', dec(run(['-Action', 'size-decide', '-TicketsJson', tjson({ 'p-toc': T['p-toc'], 'p-note': T['p-note'] })], AS), K.proj).action === 'error');
ok('decide: no tickets file -> not ok', run(['-Action', 'size-decide', '-TicketsJson', path.join(D.drafts, 'nope.json')], AS).ok === false);

// 6. escalate once
run(['-Action', 'size-record', '-RecordJson', rjson({ filed: [], escalated: [K.proj], prune: [], completed: false })], AS);
st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
ok('record: escalated flag set, lastRun kept', st.items[K.proj].escalated === true && st.lastRun === '2026-11-30', st);
r = run(['-Action', 'size-decide', '-TicketsJson', tjson(T)], AS);
ok('decide: already escalated -> link', dec(r, K.proj).action === 'link', dec(r, K.proj));

// 7. Wont Do and Done
r = run(['-Action', 'size-decide', '-TicketsJson', tjson(Object.assign({}, T, { 'p-proj': { status: 'Wont Do', createdTime: daysAgo(30), gain: '2' } }))], AS);
ok('decide: Wont Do -> skip', dec(r, K.proj).action === 'skip', dec(r, K.proj));
r = run(['-Action', 'size-decide', '-TicketsJson', tjson(Object.assign({}, T, { 'p-proj': { status: 'Done', createdTime: daysAgo(30), gain: '2' } }))], AS);
ok('decide: Done + breach back -> file', dec(r, K.proj).action === 'file', dec(r, K.proj));

// 8. near + Done: no repeat unless grown
run(['-Action', 'size-record', '-RecordJson', rjson({ filed: [{ key: K.hook, pageId: 'p-hook', ticketId: 'GEN-4', value: 9501 }], completed: false })], AS);
const T2 = Object.assign({}, T, { 'p-hook': { status: 'Done', createdTime: daysAgo(5), gain: '2' } });
r = run(['-Action', 'size-decide', '-TicketsJson', tjson(T2)], AS);
ok('decide: near + Done, not grown -> skip', dec(r, K.hook).action === 'skip', dec(r, K.hook));
put(hookRef, 'x'.repeat(9700) + '\n');
r = run(['-Action', 'size-decide', '-TicketsJson', tjson(T2)], AS);
ok('decide: near + Done, grown -> file', dec(r, K.hook).action === 'file', dec(r, K.hook));
put(hookRef, 'x'.repeat(9500) + '\n');

// 9. prune: a fixed file drops out of the map
put(refNoToc, '# Ref\n**Contents:** a\n' + lines(150));
r = run(['-Action', 'size-decide', '-TicketsJson', tjson(T2)], AS);
ok('decide: fixed file listed for prune', arr(r.prune).includes(K.toc) && !dec(r, K.toc), { prune: r.prune });
run(['-Action', 'size-record', '-RecordJson', rjson({ prune: r.prune, completed: true })], ['-AsOf', '2026-12-07']);
st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
ok('record: pruned + lastRun advanced', !st.items[K.toc] && st.lastRun === '2026-12-07', st);

// 9b. Pass B fixes: bad createdTime is one error, not a crash; Backlog never parses it;
//     an incomplete sweep prunes nothing
// (p-proj is already escalated, so its created time is never read; use p-note)
r = run(['-Action', 'size-decide', '-TicketsJson', tjson(Object.assign({}, T2, { 'p-note': { status: 'In Progress', createdTime: '', gain: '2' } }))], AS);
ok('decide: empty createdTime -> that item error, run ok', r.ok === true && dec(r, K.note).action === 'error' && dec(r, K.proj).action === 'link', r.decisions);
r = run(['-Action', 'size-decide', '-TicketsJson', tjson(Object.assign({}, T2, { 'p-proj': { status: 'Backlog', gain: '2' } }))], AS);
ok('decide: Backlog without createdTime -> link', dec(r, K.proj).action === 'link', dec(r, K.proj));
r = run(['-Action', 'size-decide', '-TicketsJson', tjson(T2), '-ProjectsRoot', path.join(root, 'missing')], AS);
ok('decide: sweep errors -> prune nothing', r.ok === true && arr(r.sweepErrors).length > 0 && arr(r.prune).length === 0, { prune: r.prune, e: r.sweepErrors });

// 10. mark-reviewed overdue alarm
r = run(['-Action', 'mark-reviewed'], ['-AsOf', '2026-12-10']);
ok('mark-reviewed: recent run -> ok', r.ok === true && fs.existsSync(markerFile), r);
fs.rmSync(markerFile);
r = run(['-Action', 'mark-reviewed'], ['-AsOf', '2026-12-14']);
ok('mark-reviewed: 7 days -> not ok, marker written', r.ok === false && r.markerWritten === true && /overdue/.test(r.error) && fs.existsSync(markerFile), r);
const saved = fs.readFileSync(stateFile);
fs.rmSync(stateFile);
r = run(['-Action', 'mark-reviewed'], ['-AsOf', '2026-12-10']);
ok('mark-reviewed: no state file -> not ok', r.ok === false && /no state file/.test(r.error), r);
fs.writeFileSync(stateFile, JSON.stringify({ lastRun: null, items: {} }));
r = run(['-Action', 'mark-reviewed'], ['-AsOf', '2026-12-10']);
ok('mark-reviewed: never completed -> not ok', r.ok === false && /never completed/.test(r.error), r);
fs.writeFileSync(stateFile, JSON.stringify({ lastRun: '2027-01-31', items: {} }));
r = run(['-Action', 'mark-reviewed'], ['-AsOf', '2026-12-10']);
ok('mark-reviewed: future-dated run -> not ok', r.ok === false && /dated in the future/.test(r.error), r);
fs.writeFileSync(stateFile, '{ not json');
r = run(['-Action', 'mark-reviewed'], ['-AsOf', '2026-12-10']);
ok('mark-reviewed: corrupt state -> not ok, marker written', r.ok === false && r.markerWritten === true && /marker written/.test(r.error), r);
ok('record: no temp files left behind', fs.readdirSync(D.home).filter(f => f.endsWith('.tmp')).length === 0, fs.readdirSync(D.home));
fs.writeFileSync(stateFile, saved);

// 11. GEN-966: unreadable real file keeps the draft's measurements
const cmdReal = put(path.join(D.commands, 'real.md'), '---\ndescription: Real one.\n---\nBody\n');
const cmdDraft = put(path.join(D.drafts, 'real-draft.md'), '---\ndescription: A longer draft description.\n---\nBody\n');
const ready = path.join(D.drafts, 'locked.flag');
const ps = 'param($p,$f) $h=[IO.File]::Open($p,"Open","Read","None"); Set-Content -LiteralPath $f -Value x; Start-Sleep -Seconds 60; $h.Close()';
const lockScript = put(path.join(D.drafts, 'lock.ps1'), ps);
const locker = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', lockScript, cmdReal, ready], { stdio: 'ignore' });
const t0 = Date.now();
while (!fs.existsSync(ready) && Date.now() - t0 < 20000) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
r = run(['-Action', 'size-check', '-Target', cmdDraft, '-AsIfPath', cmdReal]);
const L = arr(r.sizeLines);
const valueLines = L.filter(l => !/not measured/.test(l) && !/^size: skipped/.test(l));
ok('unreadable: ok stays true', r.ok === true, r);
ok('unreadable: every value line "now unavailable ->"', valueLines.length === 2 && valueLines.every(l => l.includes('now unavailable ' + ARROW + ' ')), L);
ok('unreadable: draft value kept (27 chars)', L.some(l => / 27 \/ 1,536 characters/.test(l)), L);
ok('unreadable: one error, named', arr(r.errors).length === 1 && /could not measure the real file/.test(arr(r.errors)[0]), r.errors);
ok('unreadable: ERROR line', arr(r.lines).some(l => /^ERROR could not measure/.test(l)), r.lines);
ok('unreadable: no dropped-limit lines', !L.some(l => l.includes(ARROW + 'not measured /')), L);
locker.kill();
r = run(['-Action', 'size-check', '-Target', put(path.join(D.drafts, 'ws.md'), '---\ndescription: "   "\n---\nBody\n'), '-AsIfPath', path.join(D.commands, 'ws.md')]);
ok('whitespace-only description: note', arr(r.sizeLines).length === 1 && /not measured: description not in frontmatter/.test(arr(r.sizeLines)[0]), r.sizeLines);

setTimeout(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); } catch (e) {}
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
