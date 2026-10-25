// GEN-674 size stop, redesign (2026-10-21): fixture tests through the real code.
// Usage: node sizestop2-test.js <working-copy dir> <fixtureRoot>
// The working-copy dir holds update-config.ps1, auto-approve.js, sessionstart-backup-surfacer.js and
// size-approval-prompt.js. Builds <fixtureRoot>/home (a stand-in user folder) and <fixtureRoot>/tool (a
// fixture copy of update-config.ps1 whose $ClaudeBase and $SyncScript point into the fixture, a copy of
// the live update-global-rule.ps1, and a sync stub), then runs:
//   S: the script itself, through powershell.exe, on the exact command shapes Claude uses;
//   P: the prompt hook, through node with real-shaped PreToolUse input;
//   A: auto-approve.js, the same way;
//   B: the session-start surfacer;
//   C: the three line counters (config-health, the script, the surfacer) on the same texts.
// Never touches the live ~/.claude tree: every path the code derives comes from the fixture home.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const [WCDIR, ROOT] = process.argv.slice(2);
if (!WCDIR || !ROOT) { console.error('usage: node sizestop2-test.js <wc dir> <fixtureRoot>'); process.exit(1); }
const HOME = path.join(ROOT, 'home');
const CL = path.join(HOME, '.claude');
const RULES = path.join(CL, 'CLAUDE.md');
const STAGE = path.join(HOME, '.claude-staging');
const OKDIR = path.join(STAGE, 'rulesize' + '-ok');
const SID = 'fixture-session-1';
const GRANT = path.join(OKDIR, 'grant-' + SID + '.json');
const RECORD = path.join(OKDIR, 'record.json');
const CHECK_PASSES = path.join(STAGE, 'check-passes');
const VET_PASSES = path.join(STAGE, 'vetting-passes');
const NOTES = path.join(HOME, 'AI Projects', 'Improve AI Infra', 'notes');
const TOOL = path.join(ROOT, 'tool');
const WORK = path.join(ROOT, 'work');
const UC = path.join(TOOL, 'update-config.ps1');
const UGR = path.join(TOOL, 'update-' + 'global-rule.ps1');
const HOOKS = path.join(CL, 'hooks');
const AA = path.join(HOOKS, 'auto-approve.js');
const PROMPT = path.join(HOOKS, 'size-approval-prompt.js');
const SURF = path.join(HOOKS, 'sessionstart-backup-surfacer.js');
const LIVE_UGR = 'G:\\My Drive\\AI Projects\\_Tooling\\Claude\\update-' + 'global-rule.ps1';
const LIVE_UC = 'G:\\My Drive\\AI Projects\\_Tooling\\Claude\\update-config.ps1';
const CONFIG_HEALTH = 'C:\\Users\\Erez\\.claude\\skills\\config-health\\config-health-scan.ps1';

// ---- fixture tree ----
fs.rmSync(ROOT, { recursive: true, force: true });
for (const d of [HOOKS, CHECK_PASSES, VET_PASSES, NOTES, TOOL, WORK, path.join(CL, 'skills', 'demo'), path.join(ROOT, 'appdata')]) fs.mkdirSync(d, { recursive: true });
for (const f of ['auto-approve.js', 'size-approval-prompt.js', 'sessionstart-backup-surfacer.js']) fs.copyFileSync(path.join(WCDIR, f), path.join(HOOKS, f));
let ucText = fs.readFileSync(path.join(WCDIR, 'update-config.ps1'), 'utf8');
const swap = (s, a, b) => { if (s.split(a).length !== 2) throw new Error('fixture swap did not match once: ' + a); return s.replace(a, () => b); };
ucText = swap(ucText, '$ClaudeBase   = "C:\\Users\\Erez\\.claude"', '$ClaudeBase   = "' + CL + '"');
ucText = swap(ucText, '$SyncScript   = "G:\\My Drive\\AI Projects\\_Tooling\\Claude\\sync.ps1"', '$SyncScript   = "' + path.join(TOOL, 'sync-stub.ps1') + '"');
fs.writeFileSync(UC, ucText);
fs.writeFileSync(UGR, fs.readFileSync(LIVE_UGR));
fs.writeFileSync(path.join(TOOL, 'sync-stub.ps1'), 'param([string]$Direction, [string]$CommitMessage, [switch]$DiscardLocal)\nexit 0\n');
fs.writeFileSync(path.join(CL, 'skills', 'demo', 'SKILL.md'), '# demo\nline\n');
// auto-approve.js gates any settings.json edit it cannot prove leaves the hooks section alone, which
// includes "no settings.json to compare with"; give the fixture one.
fs.writeFileSync(path.join(CL, 'settings.json'), JSON.stringify({ permissions: { allow: [] }, hooks: {} }, null, 2) + '\n');

// ---- helpers ----
const L = n => 'r' + String(n).padStart(4, '0');
const text = (n, trailingNl = true) => Array.from({ length: n }, (_, i) => L(i + 1)).join('\n') + (n && trailingNl ? '\n' : '');
const setRules = s => fs.writeFileSync(RULES, s);
const rulesNow = () => fs.readFileSync(RULES, 'utf8');
const cf = (name, s) => { const p = path.join(WORK, name); fs.writeFileSync(p, s); return p; };
// The live size-limits file with only the claude-md-lines value changed (config-health needs the rest).
const LIVE_LIMITS = JSON.parse(fs.readFileSync('C:\\Users\\Erez\\AI Projects\\Improve AI Infra\\notes\\anthropic-guidelines.json', 'utf8'));
const setLimit = v => {
  const f = path.join(NOTES, 'anthropic-guidelines.json');
  if (v === null) { fs.rmSync(f, { force: true }); return; }
  const j = JSON.parse(JSON.stringify(LIVE_LIMITS));
  j.limits.find(x => x.id === 'claude-md-lines').value = v;
  fs.writeFileSync(f, JSON.stringify(j, null, 2));
};
const setGrant = (lines, expiresMs) => { fs.mkdirSync(OKDIR, { recursive: true }); fs.writeFileSync(GRANT, JSON.stringify({ lines, expiresMs })); };
const freshGrant = lines => setGrant(lines, Date.now() + 600000);
const noGrant = () => fs.rmSync(GRANT, { recursive: true, force: true });
const noRecord = () => fs.rmSync(RECORD, { force: true });
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const markerGone = () => !fs.existsSync(path.join(CL, 'claude-config-pending-sync'));
const lockGone = () => !fs.existsSync(path.join(CL, 'claude-config.lock'));

// sid: the CLAUDE_SESSION_ID the command sees (default SID; null = not set).
function ps(command, cwd, sid) {
  const full = command + '\nexit $LASTEXITCODE\n';
  const env = Object.assign({}, process.env);
  delete env.CLAUDE_SESSION_ID;
  const useSid = sid === undefined ? SID : sid;
  if (useSid !== null) env.CLAUDE_SESSION_ID = useSid;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
    Buffer.from(full, 'utf16le').toString('base64')], { cwd: cwd || WORK, encoding: 'utf8', timeout: 120000, env });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const ucCmd = args => "& '" + UC + "' " + args;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) pass++;
  else { fail++; console.log('FAIL ' + name + (detail ? ' :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 400) : '')); }
}
const refused6 = r => r.code === 6 && /SIZE STOP \(GEN-674\)/.test(r.out);

// =============================== S: the script ===============================
setLimit(null); noGrant(); noRecord();

// S1 text-replace that adds lines, 199 -> 201, no switch
setRules(text(199)); let before = rulesNow();
let r = ps(ucCmd("-File 'CLAUDE.md' -Op text-replace -OldText 'r0005' -NewText \"r0005`nadd1`nadd2\""));
check('S1 text-replace crossing refused', refused6(r), r.out);
check('S1 file unchanged', rulesNow() === before);
check('S1 no marker, lock released', markerGone() && lockGone());
check('S1 no record', !fs.existsSync(RECORD));
check('S1 message names the counts', /from 199 to 201 lines/.test(r.out) && /limit is 200 lines/.test(r.out), r.out);

// S2 write-file 186 -> 200 allowed
setRules(text(186));
r = ps(ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + cf('c200.md', text(200)) + "'"));
check('S2 186 -> 200 allowed', r.code === 0 && rulesNow() === text(200), r.out);
check('S2 no record at the limit', !fs.existsSync(RECORD));

// S3 186 -> 201 refused
setRules(text(186)); before = rulesNow();
r = ps(ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + cf('c201.md', text(201)) + "'"));
check('S3 186 -> 201 refused', refused6(r) && rulesNow() === before, r.out);

// S4 200 lines without a final LF counts 200
setRules(text(186));
r = ps(ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + cf('c200n.md', text(200, false)) + "'"));
check('S4 200 lines, no final LF, allowed', r.code === 0 && rulesNow() === text(200, false), r.out);
setRules(text(186));
r = ps(ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + cf('c201n.md', text(201, false)) + "'"));
check('S4b 201 lines, no final LF, refused', refused6(r), r.out);

// S5 BOM + 200 lines allowed, written without the BOM
setRules(text(186));
const bomFile = path.join(WORK, 'cbom.md'); fs.writeFileSync(bomFile, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text(200))]));
r = ps(ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + bomFile + "'"));
check('S5 BOM + 200 allowed, BOM dropped', r.code === 0 && rulesNow() === text(200), r.out);

// S6 bare CR refused (even under the limit)
setRules(text(186));
r = ps(ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + cf('ccr.md', text(150) + 'a\rb\n') + "'"));
check('S6 bare CR refused', refused6(r) && /carriage return/.test(r.out), r.out);
r = ps(ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + cf('ccrlf.md', text(150).replace(/\n/g, '\r\n')) + "'"));
check('S6b CRLF accepted', r.code === 0, r.out);

// S7-S9 an over-limit file: shrink and same size pass, growth refused
setRules(text(210));
r = ps(ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + cf('c205.md', text(205)) + "'"));
check('S7 210 -> 205 allowed (trim while over)', r.code === 0 && rulesNow() === text(205), r.out);
check('S7 no record created by a trim', !fs.existsSync(RECORD));
setRules(text(210));
r = ps(ucCmd("-File 'CLAUDE.md' -Op text-replace -OldText 'r0007' -NewText 'r0007x'"));
check('S8 210 -> 210 same size allowed', r.code === 0 && rulesNow().indexOf('r0007x') !== -1, r.out);
setRules(text(210)); before = rulesNow();
r = ps(ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + cf('c211.md', text(211)) + "'"));
check('S9 210 -> 211 refused', refused6(r) && rulesNow() === before, r.out);

// S10 the limit file can lower the limit, never raise it
setLimit(190); setRules(text(186));
r = ps(ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + cf('c191.md', text(191)) + "'"));
check('S10a limit 190: 186 -> 191 refused', refused6(r) && /limit is 190 lines/.test(r.out), r.out);
r = ps(ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + cf('c190.md', text(190)) + "'"));
check('S10b limit 190: 186 -> 190 allowed', r.code === 0, r.out);
for (const v of [300, 'abc']) {
  setLimit(v); setRules(text(186));
  r = ps(ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + path.join(WORK, 'c201.md') + "'"));
  check('S10c limit ' + v + ' -> still 200', refused6(r) && /limit is 200 lines/.test(r.out), r.out);
}
setLimit(null); setRules(text(186));
r = ps(ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + path.join(WORK, 'c201.md') + "'"));
check('S10d no limit file -> 200', refused6(r) && /limit is 200 lines/.test(r.out), r.out);
setLimit(777);
const limFile = path.join(NOTES, 'anthropic-guidelines.json');
fs.writeFileSync(limFile, fs.readFileSync(limFile, 'utf8').replace('777', '190.0'));
r = ps(ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + path.join(WORK, 'c191.md') + "'"));
check('S10e limit written as 190.0 -> 190', refused6(r) && /limit is 190 lines/.test(r.out), r.out);
setLimit(null);

// S11 other paths to the same file are measured
setRules(text(186)); before = rulesNow();
r = ps(ucCmd("-File '.\\CLAUDE.md' -Op write-file -ContentFile '" + path.join(WORK, 'c201.md') + "'"), CL);
check('S11a .\\CLAUDE.md measured', refused6(r) && rulesNow() === before, r.out);
r = ps(ucCmd("-File '" + RULES + ".' -Op write-file -ContentFile '" + path.join(WORK, 'c201.md') + "'"));
check('S11b trailing dot measured', refused6(r) && rulesNow() === before, r.out);
const hl = path.join(WORK, 'hardlink.md'); fs.rmSync(hl, { force: true }); fs.linkSync(RULES, hl);
r = ps(ucCmd("-File '" + hl + "' -Op write-file -ContentFile '" + path.join(WORK, 'c201.md') + "'"));
check('S11c hard link measured', refused6(r) && rulesNow() === before, r.out);
const sl = path.join(WORK, 'symlink.md'); fs.rmSync(sl, { force: true });
let symlinkOk = true; try { fs.symlinkSync(RULES, sl, 'file'); } catch (e) { symlinkOk = false; }
if (symlinkOk) {
  r = ps(ucCmd("-File '" + sl + "' -Op write-file -ContentFile '" + path.join(WORK, 'c201.md') + "'"));
  check('S11h file symlink measured', refused6(r) && rulesNow() === before, r.out);
} else console.log('note: S11h skipped (this account cannot create file symlinks)');
const copyF = cf('copy-of-rules.md', before);
r = ps(ucCmd("-File '" + copyF + "' -Op write-file -ContentFile '" + path.join(WORK, 'c201.md') + "'"));
check('S11d byte-equal copy measured (stricter)', refused6(r), r.out);
fs.mkdirSync(OKDIR, { recursive: true }); fs.writeFileSync(RECORD, '{"lines":1,"sha256":"keep","approvedOn":"x"}');
r = ps(ucCmd("-File '" + copyF + "' -Op write-file -ContentFile '" + path.join(WORK, 'c200.md') + "'"));
check('S11f a copy written at the limit leaves the real file\'s record', r.code === 0 && (readJson(RECORD) || {}).sha256 === 'keep', r.out);
noRecord();
r = ps("$ErrorActionPreference = 'Stop'\n" + ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + path.join(WORK, 'c201.md') + "'"));
check('S11g exit 6 even under ErrorActionPreference Stop', refused6(r) && rulesNow() === before, r.code + r.out);
const skillF = path.join(CL, 'skills', 'demo', 'SKILL.md');
r = ps(ucCmd("-File '" + skillF + "' -Op write-file -ContentFile '" + cf('big.md', text(400)) + "'"));
check('S11e another file is not measured', r.code === 0 && fs.readFileSync(skillF, 'utf8') === text(400), r.out);

// S12 every command shape the held build refused reaches the same measurement
setRules(text(186)); before = rulesNow();
const c201 = path.join(WORK, 'c201.md');
const shapes = {
  'prefix -Fi': ucCmd("-Fi 'CLAUDE.md' -Op write-file -ContentFile '" + c201 + "'"),
  'colon -File:': ucCmd("-File:'CLAUDE.md' -Op write-file -ContentFile '" + c201 + "'"),
  'positional': ucCmd("'CLAUDE.md' 'write-file' '' '' '' '" + c201 + "'"),
  'decoy add-allow': ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + c201 + "' -VersionMessage 'note -Op add-allow'"),
  'powershell -File wrapper': "powershell -NoProfile -ExecutionPolicy Bypass -File '" + UC + "' -File CLAUDE.md -Op write-file -ContentFile '" + c201 + "'",
  'variable ContentFile': "$c = '" + c201 + "'\n" + ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile $c"),
  'splatting': "$p = @{ File = 'CLAUDE.md'; Op = 'write-file'; ContentFile = '" + c201 + "' }\n& '" + UC + "' @p",
  'backtick-n NewText': ucCmd("-File 'CLAUDE.md' -Op text-replace -OldText 'r0009' -NewText \"r0009`n" + Array.from({ length: 15 }, (_, i) => 'x' + i).join('`n') + "\""),
  'splatted switch, no grant': "$p = @{ File = 'CLAUDE.md'; Op = 'write-file'; ContentFile = '" + c201 + "'; ApproveSizeUpTo = 201 }\n& '" + UC + "' @p",
  'abbreviated switch, no grant': ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + c201 + "' -Approve 201"),
};
noGrant();
for (const [name, cmd] of Object.entries(shapes)) {
  r = ps(cmd);
  check('S12 ' + name + ' -> refused, file unchanged', refused6(r) && rulesNow() === before, r.code + ' ' + r.out);
}

// S13 the grant
const withSwitch = (n, file) => ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + file + "' -ApproveSizeUpTo " + n);
setRules(text(186)); before = rulesNow(); noRecord();
noGrant(); r = ps(withSwitch(201, c201));
check('S13a switch, no grant -> refused', refused6(r) && /not found or has expired/.test(r.out) && rulesNow() === before, r.out);
setGrant(201, Date.now() - 1000); r = ps(withSwitch(201, c201));
check('S13b expired grant -> refused', refused6(r) && rulesNow() === before, r.out);
setGrant(0, 0); r = ps(withSwitch(201, c201));
check('S13c tombstone grant -> refused', refused6(r) && rulesNow() === before, r.out);
freshGrant(200); r = ps(withSwitch(201, c201));
check('S13d grant too low -> refused', refused6(r) && /covers only 200 lines/.test(r.out) && rulesNow() === before, r.out);
freshGrant(205); r = ps(withSwitch(200, c201));
check('S13e switch below result -> refused', refused6(r) && /is below the 201 lines/.test(r.out) && rulesNow() === before, r.out);
freshGrant(201); r = ps(withSwitch(201, c201));
check('S13f valid grant -> written', r.code === 0 && rulesNow() === text(201), r.out);
check('S13f grant consumed', !fs.existsSync(GRANT));
let rec = readJson(RECORD);
check('S13f record matches the written bytes', rec && rec.lines === 201 && rec.sha256 === sha(fs.readFileSync(RULES)) && /^[0-9a-f]{64}$/.test(rec.sha256), JSON.stringify(rec));
r = ps(withSwitch(202, cf('c202.md', text(202))));
check('S13g grant used once only', refused6(r) && rulesNow() === text(201), r.out);
fs.writeFileSync(path.join(OKDIR, 'grant-other-session.json'), JSON.stringify({ lines: 300, expiresMs: Date.now() + 600000 }));
r = ps(withSwitch(202, path.join(WORK, 'c202.md')));
check('S13h another session\'s grant is not used', refused6(r) && rulesNow() === text(201), r.out);
fs.rmSync(path.join(OKDIR, 'grant-other-session.json'), { force: true });
freshGrant(202); r = ps(withSwitch(202, path.join(WORK, 'c202.md')), WORK, null);
check('S13i no session id -> refused', refused6(r) && /session id/.test(r.out) && rulesNow() === text(201), r.out);
noGrant();

// S14 record lifecycle
const approvedOn = rec && rec.approvedOn;
r = ps(ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + cf('c201b.md', text(200) + 'changed\n') + "'"));
rec = readJson(RECORD);
check('S14a same-size change while over carries the record', r.code === 0 && rec && rec.sha256 === sha(fs.readFileSync(RULES)) && rec.approvedOn === approvedOn, JSON.stringify(rec) + r.out);
freshGrant(203); r = ps(withSwitch(203, cf('c203.md', text(203))));
rec = readJson(RECORD);
check('S14b approved crossing to 203 records it', r.code === 0 && rec && rec.lines === 203, r.out);
r = ps(ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + cf('c202b.md', text(202)) + "'"));
rec = readJson(RECORD);
check('S14c trim 203 -> 202 carries the record', r.code === 0 && rec && rec.lines === 202 && rec.sha256 === sha(fs.readFileSync(RULES)), r.out);
setRules(text(204)); // written outside the script
r = ps(ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + path.join(WORK, 'c203.md') + "'"));
rec = readJson(RECORD);
check('S14d trim after an outside write does not carry the record', r.code === 0 && rec && rec.lines === 202 && rec.sha256 !== sha(fs.readFileSync(RULES)), JSON.stringify(rec));
r = ps(ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + path.join(WORK, 'c200.md') + "'"));
check('S14e back at the limit deletes the record', r.code === 0 && !fs.existsSync(RECORD), r.out);

// S15 update-global-rule.ps1 passes exit 6 through
setRules(text(199)); before = rulesNow();
r = ps("& '" + UGR + "' -OldText 'r0005' -NewText \"r0005`nadd1`nadd2\"");
check('S15 update-global-rule.ps1 crossing -> exit 6', refused6(r) && rulesNow() === before, r.out);
r = ps("& '" + UGR + "' -OldText 'r0005' -NewText 'r0005y'");
check('S15b update-global-rule.ps1 same size -> ok', r.code === 0 && rulesNow().indexOf('r0005y') !== -1, r.out);

// S16 rules file unreadable: a target named CLAUDE.md is refused, others go ahead
fs.rmSync(RULES, { force: true });
const projDir = path.join(WORK, 'proj'); fs.mkdirSync(projDir, { recursive: true });
const projRules = path.join(projDir, 'CLAUDE.md'); fs.writeFileSync(projRules, text(10));
r = ps(ucCmd("-File '" + projRules + "' -Op write-file -ContentFile '" + path.join(WORK, 'c200.md') + "'"));
check('S16a no global file + target named CLAUDE.md -> refused', refused6(r) && fs.readFileSync(projRules, 'utf8') === text(10), r.out);
r = ps(ucCmd("-File '" + skillF + "' -Op write-file -ContentFile '" + path.join(WORK, 'c200.md') + "'"));
check('S16b no global file + other target -> ok', r.code === 0, r.out);
setRules(text(186));

// S17 a no-change text-replace still exits 3
r = ps(ucCmd("-File 'CLAUDE.md' -Op text-replace -OldText 'r0003' -NewText 'r0003'"));
check('S17 no-change still exit 3', r.code === 3, r.out);

// =============================== P: the prompt hook ===============================
function hook(file, input, envExtra) {
  const env = Object.assign({}, process.env, { USERPROFILE: HOME, HOME, APPDATA: path.join(ROOT, 'appdata') }, envExtra || {});
  delete env.CLAUDE_CONFIG_UNLOCK;
  const res = spawnSync(process.execPath, [file], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env, timeout: 30000 });
  let out = null; try { out = JSON.parse(res.stdout).hookSpecificOutput; } catch (e) { /* none */ }
  return { code: res.status, out, stdout: res.stdout || '', stderr: res.stderr || '' };
}
const ucLine = n => "& '" + LIVE_UC + "' -File 'CLAUDE.md' -Op write-file -ContentFile 'C:\\x.md' -ApproveSizeUpTo " + n;
const pin = (command, extra) => Object.assign({ hook_event_name: 'PreToolUse', tool_name: 'PowerShell', tool_input: { command }, permission_mode: 'auto', session_id: SID, tool_use_id: 't' }, extra || {});

freshGrant(300);
let h = hook(PROMPT, pin('Get-Date'));
check('P1 no switch -> no decision', h.code === 0 && !h.out, h.stdout + h.stderr);
check('P1 old grant deleted', !fs.existsSync(GRANT));
h = hook(PROMPT, pin(ucLine(203)));
let g = readJson(GRANT);
check('P2 switch -> ask', h.code === 0 && h.out && h.out.permissionDecision === 'ask' && /grow to 203 lines/.test(h.out.permissionDecisionReason), h.stdout);
check('P2 grant written', g && g.lines === 203 && g.expiresMs > Date.now() + 590000 && g.expiresMs <= Date.now() + 600000, JSON.stringify(g));
for (const mode of ['default', 'acceptEdits', 'bypassPermissions', 'plan', undefined]) {
  noGrant();
  h = hook(PROMPT, pin(ucLine(203), { permission_mode: mode }));
  const want = mode === 'default';
  check('P3 mode ' + mode + ' -> ask, grant ' + want, h.out && h.out.permissionDecision === 'ask' && fs.existsSync(GRANT) === want, h.stdout);
}
noGrant(); h = hook(PROMPT, pin(ucLine(203), { agent_id: 'sub1' }));
check('P4 sub-agent -> ask, no grant', h.out && h.out.permissionDecision === 'ask' && !fs.existsSync(GRANT));
noGrant(); h = hook(PROMPT, pin('Write-Output approvesizeupto 5'));
check('P5 no update-config.ps1 -> ask, no grant', h.out && h.out.permissionDecision === 'ask' && !fs.existsSync(GRANT));
noGrant(); h = hook(PROMPT, pin("& '" + LIVE_UC + "' -File CLAUDE.md -Op write-file -ContentFile x -ApproveSizeUpTo $n"));
check('P6 variable value -> ask without a count, no grant', h.out && /no line count/.test(h.out.permissionDecisionReason) && !fs.existsSync(GRANT), h.stdout);
noGrant(); h = hook(PROMPT, pin(ucLine(250) + " -VersionMessage 'see -ApproveSizeUpTo 201'"));
g = readJson(GRANT);
check('P7 several numbers -> the smallest', g && g.lines === 201 && /grow to 201 lines/.test(h.out.permissionDecisionReason), JSON.stringify(g));
noGrant(); h = hook(PROMPT, pin("& '" + LIVE_UC + "' -File CLAUDE.md -Op write-file -ContentFile x -ApproveSizeUpTo:204"));
g = readJson(GRANT);
check('P8 colon form', g && g.lines === 204, JSON.stringify(g));
noGrant(); h = hook(PROMPT, pin("& '" + LIVE_UC + "' -File CLAUDE.md -Op write-file -ContentFile x -APPROVESIZEUPTO \"205\""));
g = readJson(GRANT);
check('P8b upper case, quoted number', g && g.lines === 205, JSON.stringify(g) + h.stdout);
noGrant(); h = hook(PROMPT, { hook_event_name: 'PreToolUse', tool_name: 'Monitor', tool_input: { command: ucLine(206), description: 'x' }, permission_mode: 'auto', session_id: SID });
check('P9 Monitor -> ask + grant', h.out && h.out.permissionDecision === 'ask' && (readJson(GRANT) || {}).lines === 206);
noGrant(); h = hook(PROMPT, { hook_event_name: 'PreToolUse', tool_name: 'mcp__windows-mcp__PowerShell', tool_input: { command: ucLine(207) }, permission_mode: 'auto', session_id: SID });
check('P10 windows-mcp PowerShell -> ask + grant', h.out && h.out.permissionDecision === 'ask' && (readJson(GRANT) || {}).lines === 207);
noGrant(); fs.mkdirSync(GRANT, { recursive: true }); fs.writeFileSync(path.join(GRANT, 'x'), 'x');
h = hook(PROMPT, pin('Get-Date'));
check('P11 grant cannot be cleared -> exit 2', h.code === 2 && /could not clear/.test(h.stderr), h.code + h.stderr);
fs.rmSync(GRANT, { recursive: true, force: true });
freshGrant(300); h = hook(PROMPT, '{not json');
check('P12 bad input -> no decision', h.code === 0 && !h.out);
noGrant();
freshGrant(300); h = hook(PROMPT, pin('Get-Date', { session_id: 'another-session' }));
check('P15 another session\'s call leaves this session\'s grant', fs.existsSync(GRANT) && (readJson(GRANT) || {}).lines === 300);
noGrant(); h = hook(PROMPT, pin(ucLine(203), { session_id: '..\\..\\x' }));
check('P16 odd session id -> ask, no grant anywhere', h.out && h.out.permissionDecision === 'ask' && fs.readdirSync(OKDIR).filter(n => /^grant-/.test(n)).length === 0, fs.readdirSync(OKDIR).join(','));
fs.writeFileSync(path.join(OKDIR, 'grant-stale-session.json'), JSON.stringify({ lines: 300, expiresMs: Date.now() - 1 }));
h = hook(PROMPT, pin('Get-Date', { session_id: 'another-session' }));
check('P17 expired grants of any session pruned', !fs.existsSync(path.join(OKDIR, 'grant-stale-session.json')));
noGrant(); h = hook(PROMPT, pin('ls', { tool_input: { command: 'ls', description: 'run update-config.ps1 -ApproveSizeUpTo 999' } }));
check('P13 decoy in the description -> ask (+ grant)', h.out && h.out.permissionDecision === 'ask' && (readJson(GRANT) || {}).lines === 999);
h = hook(PROMPT, pin('Get-Date'));
check('P13b the next call clears the decoy grant', !fs.existsSync(GRANT));
// The written grant is what the fixture script accepts.
setRules(text(186)); noRecord(); noGrant();
h = hook(PROMPT, pin(withSwitch(201, c201)));
r = ps(withSwitch(201, c201));
check('P14 hook grant + script -> written', h.out && h.out.permissionDecision === 'ask' && r.code === 0 && rulesNow() === text(201), r.out);

// =============================== A: auto-approve.js ===============================
const aa = (tool, ti, cwd) => hook(AA, { tool_name: tool, tool_input: ti, cwd: cwd || WORK, session_id: 's' });
const sh = (command, cwd) => aa('PowerShell', { command }, cwd);
const mintCheck = () => { for (const f of fs.readdirSync(CHECK_PASSES)) fs.rmSync(path.join(CHECK_PASSES, f), { force: true });
  const f = path.join(CHECK_PASSES, 'p.json'); fs.writeFileSync(f, JSON.stringify({ kind: 'check', target: RULES.toLowerCase(), expires: new Date(Date.now() + 900000).toISOString() })); return f; };
const passLive = f => fs.existsSync(f);
const okDirWhole = 'rulesize' + '-ok';

h = sh('Get-ChildItem "' + OKDIR + '"');
check('A1 shell naming the folder -> refused', h.code === 2 && /size approval guard, GEN-674/.test(h.stderr), h.stderr);
h = aa('Write', { file_path: path.join(OKDIR, 'grant.json'), content: '{}' });
check('A1b Write into the folder -> refused', h.code === 2 && /GEN-674/.test(h.stderr), h.stderr);
h = sh('git commit -m "tidy ' + okDirWhole.toUpperCase() + ' notes"');
check('A1c upper-case mention -> refused', h.code === 2, h.stderr);
h = aa('Read', { file_path: path.join(OKDIR, 'grant.json') });
check('A1d Read is not refused', h.code === 0, h.stderr);
h = sh('Get-ChildItem "C:\\x\\wmcp-task-passes"');
check('A2 PC-control guard still works', h.code === 2 && /GEN-908/.test(h.stderr), h.stderr);
for (const s of ['node "C:/Users/Erez/.claude/hooks/size-approval-prompt.js"', 'node "C:\\Users\\Erez\\AI Projects\\Improve AI Infra\\notes\\gen674\\sizestop2-test.js" a b',
  'git commit -m "GEN-674: the size-approval folder, rulesize stop, rules-size notes"', 'Get-Content settings.json']) {
  h = sh(s);
  check('A3 no guard false fire: ' + s.slice(0, 50), !/GEN-674/.test(h.stderr), h.stderr);
}
let pf = mintCheck();
for (const s of ['Set-Content -Path "' + RULES + '" -Value x', '"x" > "' + RULES + '"', "[IO.File]::WriteAllText('" + RULES + "', 'x')", 'Add-Content "' + RULES + '" "x"']) {
  h = sh(s);
  check('A4 direct write refused: ' + s.slice(0, 30), h.code === 2 && /rules-file size stop, GEN-674/.test(h.stderr) && passLive(pf), h.stderr);
}
h = sh('"x" > CLAUDE.md', CL);
check('A4b relative direct write refused', h.code === 2 && /GEN-674/.test(h.stderr) && passLive(pf), h.stderr);
// Shapes the destination patterns miss, caught by the second signal.
for (const s of ['Copy-Item C:\\x\\new.md "' + RULES + '" -Force', 'Set-Content -Value x -Path "' + RULES + '"',
  'Get-Content new.md | Out-File -Encoding utf8 "' + RULES + '"', 'Copy-Item -Path C:\\x\\new.md -Destination "' + RULES + '" -Force',
  'Copy-Item -Destination "' + RULES + '" -Path C:\\x\\new.md', 'Move-Item "' + RULES + '" C:\\x\\gone.md -Force']) {
  h = sh(s);
  check('A4c missed shape refused: ' + s.slice(0, 30), h.code === 2 && /GEN-674/.test(h.stderr) && passLive(pf), h.stderr);
}
const msysRules = RULES.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (m, d) => '/' + d.toLowerCase());
h = aa('Bash', { command: 'cat new.md > ' + msysRules });
check('A4d Bash MSYS-path redirect refused', h.code === 2 && /GEN-674/.test(h.stderr), h.stderr);
h = aa('Bash', { command: 'cat new.md > ~/.claude/CLAUDE.md' });
check('A4e Bash ~ redirect refused', h.code === 2 && /GEN-674/.test(h.stderr), h.stderr);
h = aa('Bash', { command: 'cp -f new.md ~/.claude/CLAUDE.md' });
check('A4e2 Bash cp onto it refused', h.code === 2 && /GEN-674/.test(h.stderr), h.stderr);
h = sh('mv CLAUDE.md old.md', CL);
check('A4e3 moving it away refused', h.code === 2 && /GEN-674/.test(h.stderr), h.stderr);
for (const s of ['Get-Content "' + RULES + '"', 'wc -l ~/.claude/CLAUDE.md', 'Select-String -Path "' + RULES + '" -Pattern x 2>&1',
  'Copy-Item "' + RULES + '" C:\\x\\backup.md', 'Copy-Item -Path "' + RULES + '" -Destination C:\\x\\backup.md -Force',
  'Get-Content "' + RULES + '" > C:\\x\\out.txt', 'Get-Content "' + RULES + '" | Out-File C:\\x\\out.txt',
  'node -e "require(\'fs\').readFileSync(process.argv[1],\'utf8\').split(\'x\').filter(l => l)" "' + RULES + '"']) {
  h = sh(s);
  check('A4f reads not refused: ' + s.slice(0, 40), !/rules-file size stop/.test(h.stderr), h.stderr);
}
h = aa('Bash', { command: 'cp ~/.claude/CLAUDE.md /tmp/work.md' });
check('A4g Bash copy out not refused', !/rules-file size stop/.test(h.stderr), h.stderr);
h = sh("& '" + LIVE_UC + "' -File 'CLAUDE.md' -Op write-file -ContentFile 'C:\\x.md'");
check('A5 update-config with a pass -> allowed, pass consumed', h.code === 0 && h.out && h.out.permissionDecision === 'allow' && !passLive(pf), h.stdout + h.stderr);
for (const f of fs.readdirSync(CHECK_PASSES)) fs.rmSync(path.join(CHECK_PASSES, f), { force: true });
h = sh("& '" + LIVE_UC + "' -File 'CLAUDE.md' -Op write-file -ContentFile 'C:\\x.md'");
check('A5b update-config without a pass -> blocked', h.code === 2 && /No check pass/.test(h.stderr), h.stderr);
pf = mintCheck();
h = sh("& '" + LIVE_UC + "' -File 'CLAUDE.md' -Op text-replace -OldText 'a' -NewText 'see > " + RULES + " now'");
check('A6 quoted redirect fragment refused (documented)', h.code === 2 && /GEN-674/.test(h.stderr) && passLive(pf), h.stderr);
for (const target of [LIVE_UC, LIVE_UGR]) {
  h = aa('Edit', { file_path: target, old_string: 'a', new_string: 'b' });
  check('A7 Edit of ' + path.basename(target) + ' -> vetting lock', h.code === 2 && /vetting lock/.test(h.stderr), h.stderr);
  h = aa('Write', { file_path: target.replace(/\\/g, '/'), content: 'x' });
  check('A7b Write (forward slashes) of ' + path.basename(target) + ' -> vetting lock', h.code === 2 && /vetting lock/.test(h.stderr), h.stderr);
  h = sh("Set-Content -Path '" + target + "' -Value x");
  check('A7c Set-Content on ' + path.basename(target) + ' -> vetting lock', h.code === 2 && /vetting lock/.test(h.stderr), h.stderr);
}
const vf = path.join(VET_PASSES, 'v.json');
fs.writeFileSync(vf, JSON.stringify({ kind: 'vetting', target: LIVE_UC.toLowerCase(), expires: new Date(Date.now() + 900000).toISOString() }));
h = aa('Edit', { file_path: LIVE_UC, old_string: 'a', new_string: 'b' });
check('A7d Edit with a vetting pass -> allowed, consumed', h.code === 0 && h.out && h.out.permissionDecision === 'allow' && !fs.existsSync(vf), h.stdout + h.stderr);
h = sh("& '" + LIVE_UC + "' -File 'settings.json' -Op add-allow -Entry 'Bash(ls:*)'");
check('A7e running the script is not a vetting target', !/vetting lock/.test(h.stderr), h.stderr);
h = aa('Bash', { command: 'echo x > "/g/My Drive/AI Projects/_Tooling/Claude/update-config.ps1"' });
check('A7f Bash-path redirect onto the Drive script -> vetting lock', h.code === 2 && /vetting lock/.test(h.stderr), h.stderr);
for (const target of [LIVE_UC, LIVE_UGR]) {
  h = sh('Copy-Item C:\\x\\old.ps1 "' + target + '" -Force');
  check('A7g Copy-Item -Force onto ' + path.basename(target) + ' -> refused', h.code === 2 && /copy\/move fail-closed/.test(h.stderr), h.stderr);
}
h = aa('Bash', { command: 'cp old.ps1 "/g/My Drive/AI Projects/_Tooling/Claude/update-config.ps1"' });
check('A7g2 Bash cp onto the Drive script -> refused', h.code === 2, h.stderr);
h = sh("& '" + LIVE_UC + "' -File 'settings.json' -Op add-allow -Entry 'Bash(ls:*)' -VersionMessage 'copy and move note'");
check('A7h running the script with a copy word in its message -> not refused by the copy guard', !/copy\/move fail-closed/.test(h.stderr), h.stderr);

// =============================== B: the session-start check ===============================
const surf = () => { const o = hook(SURF, { hook_event_name: 'SessionStart', source: 'startup' }); return (o.out && o.out.additionalContext) || ''; };
setLimit(null); noRecord();
setRules(text(186)); check('B1 under the limit -> silent', !/RULES-FILE SIZE/.test(surf()));
setRules(text(201)); let s = surf();
check('B2 over, no record -> flagged', /RULES-FILE SIZE/.test(s) && /is 201 lines, over its 200-line limit/.test(s) && /For you/.test(s), s);
fs.mkdirSync(OKDIR, { recursive: true });
fs.writeFileSync(RECORD, JSON.stringify({ lines: 201, sha256: sha(fs.readFileSync(RULES)), approvedOn: 'x' }));
check('B3 record matches -> silent', !/RULES-FILE SIZE/.test(surf()));
fs.writeFileSync(RECORD, JSON.stringify({ lines: 201, sha256: 'f'.repeat(64), approvedOn: 'x' }));
check('B4 stale record -> flagged', /RULES-FILE SIZE/.test(surf()));
setLimit(190); setRules(text(195)); noRecord();
check('B5 limit 190 -> flagged at 195', /over its 190-line limit/.test(surf()));
setLimit(null);
fs.rmSync(RULES, { force: true });
check('B6 unreadable -> reported', /could not read ~\/\.claude\/CLAUDE\.md/.test(surf()));
// a record written by the real (fixture) script keeps the check silent
setRules(text(186)); noRecord(); freshGrant(201);
r = ps(withSwitch(201, c201));
check('B7 script-written record silences the check', r.code === 0 && !/RULES-FILE SIZE/.test(surf()), r.out);
freshGrant(300); fs.writeFileSync(path.join(OKDIR, 'grant-other.json'), JSON.stringify({ lines: 300, expiresMs: Date.now() + 600000 }));
surf();
check('B8 session start drops every grant', fs.readdirSync(OKDIR).filter(n => /^grant-/.test(n)).length === 0, fs.readdirSync(OKDIR).join(','));

// =============================== C: the three line counters agree ===============================
const samples = { empty: '', one: 'a', oneNl: 'a\n', two: 'a\nb', crlf: 'a\r\nb\r\n', bom: '\ufeffa\nb\n', twoHundred: text(200), twoHundredNoNl: text(200, false), twoHundredOne: text(201) };
setLimit(1); noRecord();
for (const [name, body] of Object.entries(samples)) {
  const f = path.join(WORK, 'count-' + name + '.md');
  fs.writeFileSync(f, body);
  const want = body.replace(/^\ufeff/, '') === '' ? 0 : (body.replace(/^\ufeff/, '').match(/\n/g) || []).length + (body.endsWith('\n') ? 0 : 1);
  const chRun = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', CONFIG_HEALTH, '-Action', 'size-check',
    '-Target', f, '-AsIfPath', 'C:\\Users\\Erez\\.claude\\CLAUDE.md', '-GuidelinesFile', path.join(NOTES, 'anthropic-guidelines.json')], { encoding: 'utf8', timeout: 120000 });
  const chM = /:\s*(\d+) lines \(limit 1\)/.exec(chRun.stdout || '');
  const ch = want <= 1 ? (chM ? Number(chM[1]) : want) : (chM ? Number(chM[1]) : null);
  const ucRun = ps(". { $ErrorActionPreference = 'Stop'; $src = [IO.File]::ReadAllText('" + UC + "'); " +
    "$m = [regex]::Matches($src, '(?ms)^function (Get-RulesText|Get-RulesLineCount)\\b.*?^}'); foreach ($x in $m) { . ([scriptblock]::Create($x.Value)) }; " +
    "Write-Output ('COUNT=' + (Get-RulesLineCount (Get-RulesText ([IO.File]::ReadAllBytes('" + f + "'))))) }");
  const ucM = /COUNT=(\d+)/.exec(ucRun.out);
  setRules(body);
  const sM = /is (\d+) lines, over its 1-line limit/.exec(surf());
  const sv = sM ? Number(sM[1]) : (want <= 1 ? want : null);
  check('C ' + name + ': config-health ' + ch + ', script ' + (ucM && ucM[1]) + ', surfacer ' + sv + ', expected ' + want,
    ch === want && ucM && Number(ucM[1]) === want && sv === want, ucRun.out + (chRun.stdout || '').slice(0, 300));
}
setLimit(null);

console.log(JSON.stringify({ pass, fail }));
process.exit(fail ? 1 : 0);
