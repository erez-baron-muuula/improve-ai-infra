// GEN-674 size stop, option E (2026-10-25): fixture tests through the real code.
// Usage: node sizestop3-test.js <working-copy dir> <fixtureRoot>
// The working-copy dir holds update-config.ps1, auto-approve.js and sessionstart-backup-surfacer.js.
// Builds <fixtureRoot>/home (a stand-in user folder) and <fixtureRoot>/tool (a fixture copy of
// update-config.ps1 whose $ClaudeBase and $SyncScript point into the fixture, a copy of the live
// update-global-rule.ps1, and a sync stub), then runs:
//   S: the script itself, through powershell.exe, on the exact command shapes Claude uses;
//   A: auto-approve.js, through node with real-shaped PreToolUse input;
//   B: the session-start surfacer (size line, one-time notice, stop-intact check);
//   C: the three line counters (config-health, the script, the surfacer) on the same texts.
// The prompt itself is Claude Code's (a permissions ask rule), so it is tested live, not here.
// Never touches the live ~/.claude tree: every path the code derives comes from the fixture home.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const [WCDIR, ROOT] = process.argv.slice(2);
if (!WCDIR || !ROOT) { console.error('usage: node sizestop3-test.js <wc dir> <fixtureRoot>'); process.exit(1); }
const HOME = path.join(ROOT, 'home');
const CL = path.join(HOME, '.claude');
const RULES = path.join(CL, 'CLAUDE.md');
const STAGE = path.join(HOME, '.claude-staging');
const RECDIR = path.join(STAGE, 'rules-size');
const RECORD = path.join(RECDIR, 'record.json');
const CHECK_PASSES = path.join(STAGE, 'check-passes');
const VET_PASSES = path.join(STAGE, 'vetting-passes');
const NOTES = path.join(HOME, 'AI Projects', 'Improve AI Infra', 'notes');
const TOOL = path.join(ROOT, 'tool');
const WORK = path.join(ROOT, 'work');
const UC = path.join(TOOL, 'update-config.ps1');
const UGR = path.join(TOOL, 'update-' + 'global-rule.ps1');
const HOOKS = path.join(CL, 'hooks');
const AA = path.join(HOOKS, 'auto-approve.js');
const SURF = path.join(HOOKS, 'sessionstart-backup-surfacer.js');
const LIVE_UGR = 'G:\\My Drive\\AI Projects\\_Tooling\\Claude\\update-' + 'global-rule.ps1';
const LIVE_UC = 'G:\\My Drive\\AI Projects\\_Tooling\\Claude\\update-config.ps1';
const CONFIG_HEALTH = 'C:\\Users\\Erez\\.claude\\skills\\config-health\\config-health-scan.ps1';
const WORD = 'ApproveSize' + 'UpTo';

// ---- fixture tree ----
fs.rmSync(ROOT, { recursive: true, force: true });
for (const d of [HOOKS, CHECK_PASSES, VET_PASSES, NOTES, TOOL, WORK, path.join(CL, 'skills', 'demo'), path.join(ROOT, 'appdata')]) fs.mkdirSync(d, { recursive: true });
for (const f of ['auto-approve.js', 'sessionstart-backup-surfacer.js']) fs.copyFileSync(path.join(WCDIR, f), path.join(HOOKS, f));
let ucText = fs.readFileSync(path.join(WCDIR, 'update-config.ps1'), 'utf8');
const swap = (s, a, b) => { if (s.split(a).length !== 2) throw new Error('fixture swap did not match once: ' + a); return s.replace(a, () => b); };
ucText = swap(ucText, '$ClaudeBase   = "C:\\Users\\Erez\\.claude"', '$ClaudeBase   = "' + CL + '"');
ucText = swap(ucText, '$SyncScript   = "G:\\My Drive\\AI Projects\\_Tooling\\Claude\\sync.ps1"', '$SyncScript   = "' + path.join(TOOL, 'sync-stub.ps1') + '"');
fs.writeFileSync(UC, ucText);
fs.writeFileSync(UGR, fs.readFileSync(LIVE_UGR));
fs.writeFileSync(path.join(TOOL, 'sync-stub.ps1'), 'param([string]$Direction, [string]$CommitMessage, [switch]$DiscardLocal)\nexit 0\n');
fs.writeFileSync(path.join(CL, 'skills', 'demo', 'SKILL.md'), '# demo\nline\n');
// auto-approve.js gates any settings.json edit it cannot prove leaves the hooks section alone, which
// includes "no settings.json to compare with"; give the fixture one (with the two ask rules).
const ASK_RULES = ['PowerShell(*' + WORD + '*)', 'Bash(*' + WORD + '*)'];
const setSettings = ask => fs.writeFileSync(path.join(CL, 'settings.json'), JSON.stringify({ permissions: Object.assign({ allow: [] }, ask ? { ask } : {}), hooks: {} }, null, 2) + '\n');
setSettings(ASK_RULES);

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
const noRecord = () => fs.rmSync(RECORD, { force: true });
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\ufeff/, '')); } catch (e) { return null; } };
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const markerGone = () => !fs.existsSync(path.join(CL, 'claude-config-pending-sync'));
const lockGone = () => !fs.existsSync(path.join(CL, 'claude-config.lock'));

function ps(command, cwd) {
  const full = command + '\nexit $LASTEXITCODE\n';
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
    Buffer.from(full, 'utf16le').toString('base64')], { cwd: cwd || WORK, encoding: 'utf8', timeout: 120000 });
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
setLimit(null); noRecord();

// S1 text-replace that adds lines, 199 -> 201, no approval
setRules(text(199)); let before = rulesNow();
let r = ps(ucCmd("-File 'CLAUDE.md' -Op text-replace -OldText 'r0005' -NewText \"r0005`nadd1`nadd2\""));
check('S1 text-replace crossing refused', refused6(r), r.out);
check('S1 file unchanged', rulesNow() === before);
check('S1 no marker, lock released', markerGone() && lockGone());
check('S1 no record', !fs.existsSync(RECORD));
check('S1 message names the counts', /from 199 to 201 lines/.test(r.out) && /limit is 200 lines/.test(r.out), r.out);
check('S1 message gives the approval form', r.out.indexOf("-SizeApproval '" + WORD + "=201'") !== -1 && /-SizeOkQuote/.test(r.out) && /not this OK/.test(r.out), r.out);

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
const copyF = cf('copy-of-rules.md', before);
r = ps(ucCmd("-File '" + copyF + "' -Op write-file -ContentFile '" + path.join(WORK, 'c201.md') + "'"));
check('S11d byte-equal copy measured (stricter)', refused6(r), r.out);
fs.mkdirSync(RECDIR, { recursive: true }); fs.writeFileSync(RECORD, '{"lines":1,"sha256":"keep","approvedOn":"x","quote":"q","notified":true}');
r = ps(ucCmd("-File '" + copyF + "' -Op write-file -ContentFile '" + path.join(WORK, 'c200.md') + "'"));
check('S11f a copy written at the limit leaves the real file\'s record', r.code === 0 && (readJson(RECORD) || {}).sha256 === 'keep', r.out);
noRecord();
r = ps("$ErrorActionPreference = 'Stop'\n" + ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + path.join(WORK, 'c201.md') + "'"));
check('S11g exit 6 even under ErrorActionPreference Stop', refused6(r) && rulesNow() === before, r.code + r.out);
const skillF = path.join(CL, 'skills', 'demo', 'SKILL.md');
r = ps(ucCmd("-File '" + skillF + "' -Op write-file -ContentFile '" + cf('big.md', text(400)) + "'"));
check('S11e another file is not measured', r.code === 0 && fs.readFileSync(skillF, 'utf8') === text(400), r.out);

// S12 every command shape reaches the same measurement
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
  'quote without approval': ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + c201 + "' -SizeOkQuote 'yes'"),
};
for (const [name, cmd] of Object.entries(shapes)) {
  r = ps(cmd);
  check('S12 ' + name + ' -> refused, file unchanged', refused6(r) && rulesNow() === before, r.code + ' ' + r.out);
}

// S13 the approval
const appr = (n, quote) => " -SizeApproval '" + WORD + '=' + n + "'" + (quote === undefined ? " -SizeOkQuote 'yes, go to " + n + "'" : quote);
const withAppr = (n, file, quote) => ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + file + "'" + appr(n, quote));
setRules(text(186)); before = rulesNow(); noRecord();
r = ps(ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + c201 + "' -SizeApproval '201' -SizeOkQuote 'yes'"));
check('S13a bare number -> refused (must carry the word)', refused6(r) && /must be exactly/.test(r.out) && rulesNow() === before, r.out);
r = ps(ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + c201 + "' -SizeApproval 'Approve=201' -SizeOkQuote 'yes'"));
check('S13a2 other word -> refused', refused6(r) && rulesNow() === before, r.out);
r = ps(withAppr(200, c201));
check('S13b approval below result -> refused', refused6(r) && /is below the 201 lines/.test(r.out) && rulesNow() === before, r.out);
r = ps(withAppr(201, c201, ''));
check('S13c no quote -> refused', refused6(r) && /SizeOkQuote must/.test(r.out) && rulesNow() === before, r.out);
r = ps(withAppr(201, c201, " -SizeOkQuote '   '"));
check('S13c2 blank quote -> refused', refused6(r) && rulesNow() === before, r.out);
r = ps(withAppr(201, c201, " -SizeOkQuote \"yes`nand more\""));
check('S13c3 two-line quote -> refused', refused6(r) && rulesNow() === before, r.out);
r = ps(withAppr(201, c201, " -SizeOkQuote '" + 'y'.repeat(201) + "'"));
check('S13c4 201-character quote -> refused', refused6(r) && rulesNow() === before, r.out);
const helper = path.join(WORK, 'helper.ps1');
fs.writeFileSync(helper, withAppr(201, c201) + '\nexit $LASTEXITCODE\n');
r = ps("& '" + helper + "'");
check('S13d run from a script file -> refused', refused6(r) && /inside another script file/.test(r.out) && rulesNow() === before, r.out);
r = ps(ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + c201 + "'" + appr(201)) + "\n");
check('S13e valid -> written', r.code === 0 && rulesNow() === text(201), r.out);
let rec = readJson(RECORD);
check('S13e record: lines, hash, quote, notified=false', rec && rec.lines === 201 && rec.sha256 === sha(fs.readFileSync(RULES)) && rec.quote === 'yes, go to 201' && rec.notified === false && /^\d{4}-\d\d-\d\dT/.test(rec.approvedOn), JSON.stringify(rec));
setRules(text(186)); noRecord();
r = ps(ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + c201 + "' -SizeApproval '" + WORD.toLowerCase() + "=201' -SizeOkQuote 'ok'"));
check('S13f0 other letter case -> refused (the Bash ask rule may be case-sensitive)', refused6(r) && /must be exactly/.test(r.out) && rulesNow() === text(186), r.out);
r = ps(ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + c201 + "' -SizeApproval ' " + WORD + " = 205 ' -SizeOkQuote 'ok'"));
check('S13f spaces, higher number -> written', r.code === 0 && rulesNow() === text(201), r.out);
setRules(text(186)); noRecord();
r = ps(ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + c201 + "' -SizeAppr '" + WORD + "=201' -SizeOkQuote 'ok'"));
check('S13g abbreviated parameter name still carries the word -> written', r.code === 0 && rulesNow() === text(201), r.out);
setRules(text(199)); noRecord();
r = ps(ucCmd("-File 'CLAUDE.md' -Op text-replace -OldText 'r0005' -NewText @'\nr0005\nadd1\nadd2\n'@" + appr(201)));
check('S13h multi-line here-string, approval after it -> written', r.code === 0 && /add2/.test(rulesNow()), r.out);
setRules(text(186)); noRecord();
r = ps("powershell -NoProfile -ExecutionPolicy Bypass -File '" + UC + "' -File CLAUDE.md -Op write-file -ContentFile '" + c201 + "'" + appr(201));
check('S13i powershell -File form (the Bash tool way) -> written', r.code === 0 && rulesNow() === text(201), r.out);
setRules(text(186)); noRecord();
r = ps("$p = @{ File = 'CLAUDE.md'; Op = 'write-file'; ContentFile = '" + c201 + "'; SizeApproval = '" + WORD + "=201'; SizeOkQuote = 'ok' }\n& '" + UC + "' @p");
check('S13j splatted in the same command (word still in the command) -> written', r.code === 0 && rulesNow() === text(201), r.out);
setRules(text(199)); before = rulesNow();
r = ps("& '" + UGR + "' -OldText 'r0005' -NewText \"r0005`nadd1`nadd2\" -SizeApproval '" + WORD + "=201' -SizeOkQuote 'ok'");
check('S13k update-global-rule.ps1 has no approval option -> not written', rulesNow() === before && /parameter/i.test(r.out), r.code + ' ' + r.out);

// S14 record lifecycle
setRules(text(186)); noRecord();
r = ps(withAppr(201, c201));
const approvedOn = (readJson(RECORD) || {}).approvedOn;
r = ps(ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + cf('c201b.md', text(200) + 'changed\n') + "'"));
rec = readJson(RECORD);
check('S14a same-size change while over carries the record (quote, notified)', r.code === 0 && rec && rec.sha256 === sha(fs.readFileSync(RULES)) && rec.approvedOn === approvedOn && rec.quote === 'yes, go to 201' && rec.notified === false, JSON.stringify(rec) + r.out);
rec.notified = true; fs.writeFileSync(RECORD, JSON.stringify(rec));
r = ps(withAppr(203, cf('c203.md', text(203)), " -SizeOkQuote 'fine, 203'"));
rec = readJson(RECORD);
check('S14b a second crossing records it, notified reset', r.code === 0 && rec && rec.lines === 203 && rec.quote === 'fine, 203' && rec.notified === false, JSON.stringify(rec) + r.out);
rec.notified = true; fs.writeFileSync(RECORD, JSON.stringify(rec));
r = ps(ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + cf('c202b.md', text(202)) + "'"));
rec = readJson(RECORD);
check('S14c trim 203 -> 202 carries the record, notified kept', r.code === 0 && rec && rec.lines === 202 && rec.sha256 === sha(fs.readFileSync(RULES)) && rec.notified === true && rec.quote === 'fine, 203', JSON.stringify(rec));
setRules(text(204)); // written outside the script
r = ps(ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + path.join(WORK, 'c203.md') + "'"));
rec = readJson(RECORD);
check('S14d trim after an outside write does not carry the record', r.code === 0 && rec && rec.lines === 202 && rec.sha256 !== sha(fs.readFileSync(RULES)), JSON.stringify(rec));
r = ps(ucCmd("-File 'CLAUDE.md' -Op write-file -ContentFile '" + path.join(WORK, 'c200.md') + "'"));
check('S14e back at the limit deletes the record', r.code === 0 && !fs.existsSync(RECORD), r.out);
setRules(text(186)); noRecord();
r = ps(withAppr(201, c201, " -SizeOkQuote 'He said \"yes\" \u2014 go'"));
rec = readJson(RECORD);
check('S14f quote with quotes and a dash survives the record', r.code === 0 && rec && rec.quote === 'He said "yes" \u2014 go', JSON.stringify(rec) + r.out);

// S15 update-global-rule.ps1 passes exit 6 through
setRules(text(199)); before = rulesNow(); noRecord();
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

// S18 add-allow on settings.json still works, unaffected by the new parameters
r = ps(ucCmd("-File 'settings.json' -Op add-allow -Entry 'Bash(ls:*)'"));
check('S18 add-allow unaffected', r.code === 0 && /Bash\(ls:\*\)/.test(fs.readFileSync(path.join(CL, 'settings.json'), 'utf8')), r.out);
setSettings(ASK_RULES);

// =============================== A: auto-approve.js ===============================
function hook(file, input, envExtra) {
  const env = Object.assign({}, process.env, { USERPROFILE: HOME, HOME, APPDATA: path.join(ROOT, 'appdata') }, envExtra || {});
  delete env.CLAUDE_CONFIG_UNLOCK;
  const res = spawnSync(process.execPath, [file], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env, timeout: 30000 });
  let out = null; try { out = JSON.parse(res.stdout).hookSpecificOutput; } catch (e) { /* none */ }
  return { code: res.status, out, stdout: res.stdout || '', stderr: res.stderr || '' };
}
const aa = (tool, ti, cwd) => hook(AA, { tool_name: tool, tool_input: ti, cwd: cwd || WORK, session_id: 's' });
const sh = (command, cwd) => aa('PowerShell', { command }, cwd);
const mintCheck = () => { for (const f of fs.readdirSync(CHECK_PASSES)) fs.rmSync(path.join(CHECK_PASSES, f), { force: true });
  const f = path.join(CHECK_PASSES, 'p.json'); fs.writeFileSync(f, JSON.stringify({ kind: 'check', target: RULES.toLowerCase(), expires: new Date(Date.now() + 900000).toISOString() })); return f; };
const passLive = f => fs.existsSync(f);

let h;
let pf = mintCheck();
for (const s of ['Set-Content -Path "' + RULES + '" -Value x', '"x" > "' + RULES + '"', "[IO.File]::WriteAllText('" + RULES + "', 'x')", 'Add-Content "' + RULES + '" "x"']) {
  h = sh(s);
  check('A4 direct write refused: ' + s.slice(0, 30), h.code === 2 && /rules-file size stop, GEN-674/.test(h.stderr) && passLive(pf), h.stderr);
}
h = sh('"x" > CLAUDE.md', CL);
check('A4b relative direct write refused', h.code === 2 && /GEN-674/.test(h.stderr) && passLive(pf), h.stderr);
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
h = sh("& '" + LIVE_UC + "' -File 'CLAUDE.md' -Op write-file -ContentFile 'C:\\x.md' -SizeApproval '" + WORD + "=201' -SizeOkQuote 'yes'");
check('A5c update-config with the approval and a pass -> hook allows (the ask rule then prompts)', h.code === 0 && h.out && h.out.permissionDecision === 'allow' && !passLive(pf), h.stdout + h.stderr);
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
h = aa('Edit', { file_path: 'G:\\My Drive\\AI Projects\\_Tooling\\Claude\\sync.ps1', old_string: 'a', new_string: 'b' });
check('A7g sync.ps1 is not vetting-locked (accepted residual)', !/vetting lock/.test(h.stderr), h.stderr);
// A9: the /wrap auto-approval scan runs the script through powershell.exe -File; that is running it, not writing it
h = aa('Bash', { command: 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "G:/My Drive/AI Projects/_Tooling/Claude/update-config.ps1" -Op add-allow -Entry "ReadNotifications" -File settings.json' });
check('A9 powershell -File update-config.ps1 ... -File settings.json -> not a vetting target', !/vetting lock/.test(h.stderr) && h.code !== 2, h.code + h.stderr);
h = aa('Bash', { command: 'powershell.exe -NoProfile -File "G:/My Drive/AI Projects/_Tooling/Claude/update-config.ps1" -File "G:/My Drive/AI Projects/_Tooling/Claude/update-config.ps1" -Op write-file -ContentFile x.ps1' });
check('A9b ... -File <the script itself> as the target -> vetting lock', h.code === 2 && /vetting lock/.test(h.stderr), h.stderr);
h = sh("& '" + LIVE_UC + "' -File '" + LIVE_UC + "' -Op write-file -ContentFile 'C:\\x.ps1' -VersionMessage 'note -File foo.md'");
check('A9e a decoy -File in a quoted message does not hide a write to the script', h.code === 2 && /vetting lock/.test(h.stderr), h.stderr);
h = aa('Bash', { command: 'pwsh -NoProfile -File "G:/My Drive/AI Projects/_Tooling/Claude/update-config.ps1" -Op add-allow -Entry "X" -File settings.json' });
check('A9f pwsh form also read as running the script', !/vetting lock/.test(h.stderr) && h.code !== 2, h.code + h.stderr);
h = aa('Bash', { command: "powershell.exe -NoProfile -File \"" + LIVE_UGR.replace(/\\/g, '/') + "\" -OldText 'a' -NewText 'see update-config.ps1 now'" });
check('A9g running the wrapper through powershell -File is not read as a write to it', !/vetting lock/.test(h.stderr), h.code + h.stderr);
h = aa('Bash', { command: "powershell.exe -NoProfile -File \"" + LIVE_UGR.replace(/\\/g, '/') + "\" -OldText 'a' -NewText 'run update-config.ps1 -File x.md'" });
check('A9h ... nor a -File inside its text', !/vetting lock/.test(h.stderr), h.code + h.stderr);
h = sh("& '" + LIVE_UC + "' -File '" + LIVE_UGR + "' -Op write-file -ContentFile 'C:\\x.ps1'");
check('A9c & update-config.ps1 -File <the wrapper> -> vetting lock', h.code === 2 && /vetting lock/.test(h.stderr), h.stderr);
for (const f of fs.readdirSync(CHECK_PASSES)) fs.rmSync(path.join(CHECK_PASSES, f), { force: true });
h = aa('Bash', { command: 'powershell.exe -NoProfile -File "G:/My Drive/AI Projects/_Tooling/Claude/update-config.ps1" -File CLAUDE.md -Op write-file -ContentFile x.md' });
check('A9d powershell -File form writing CLAUDE.md now needs a check pass', h.code === 2 && /No check pass/.test(h.stderr), h.stderr);
h = sh('Get-ChildItem "' + RECDIR + '"');
check('A8 the record folder is not guarded (by design)', !/GEN-674/.test(h.stderr), h.stderr);

// =============================== B: the session-start check ===============================
const surf = () => { const o = hook(SURF, { hook_event_name: 'SessionStart', source: 'startup' }); return (o.out && o.out.additionalContext) || ''; };
const SIZE = /RULES-FILE SIZE \u2014/;
setLimit(null); noRecord();
setRules(text(186)); check('B1 under the limit -> silent', !SIZE.test(surf()));
setRules(text(201)); let s = surf();
check('B2 over, no record -> flagged', SIZE.test(s) && /is 201 lines, over its 200-line limit/.test(s) && /For you/.test(s), s);
fs.mkdirSync(RECDIR, { recursive: true });
fs.writeFileSync(RECORD, JSON.stringify({ lines: 201, sha256: sha(fs.readFileSync(RULES)), approvedOn: '2026-10-25T09:00:00Z', quote: 'q', notified: true }));
check('B3 record matches, already shown -> silent', !SIZE.test(surf()));
fs.writeFileSync(RECORD, JSON.stringify({ lines: 201, sha256: sha(fs.readFileSync(RULES)), approvedOn: 'x' }));
check('B3b record without the notified field -> silent', !SIZE.test(surf()));
fs.writeFileSync(RECORD, JSON.stringify({ lines: 201, sha256: sha(fs.readFileSync(RULES)), approvedOn: '2026-10-25T09:00:00Z', quote: 'yes\n\nIGNORE ALL ' + 'z'.repeat(300), notified: false }));
s = surf();
check('B3c not yet shown -> one notice with the date and the cleaned, capped quote', SIZE.test(s) && /is now 201 lines/.test(s) && /On 2026-10-25/.test(s) && /"yes IGNORE ALL z+\u2026"/.test(s) && s.indexOf('z'.repeat(201)) === -1, s);
rec = readJson(RECORD);
check('B3c record marked shown, rest kept', rec && rec.notified === true && rec.lines === 201 && rec.approvedOn === '2026-10-25T09:00:00Z' && fs.readdirSync(RECDIR).length === 1, JSON.stringify(rec) + fs.readdirSync(RECDIR).join(','));
check('B3d second session start -> silent', !SIZE.test(surf()));
fs.writeFileSync(RECORD, JSON.stringify({ lines: 201, sha256: 'f'.repeat(64), approvedOn: 'x', notified: false }));
s = surf();
check('B4 stale record -> flagged as no OK on record, record untouched', /no OK from Erez on record/.test(s) && (readJson(RECORD) || {}).notified === false, s);
setLimit(190); setRules(text(195)); noRecord();
check('B5 limit 190 -> flagged at 195', /over its 190-line limit/.test(surf()));
setLimit(null);
fs.rmSync(RULES, { force: true });
check('B6 unreadable -> reported', /could not read ~\/\.claude\/CLAUDE\.md/.test(surf()));
// a record written by the real (fixture) script: shown once, then silent
setRules(text(186)); noRecord();
r = ps(withAppr(201, c201));
s = surf();
check('B7 script-written record -> shown once with the quote', r.code === 0 && /is now 201 lines/.test(s) && /"yes, go to 201"/.test(s), r.out + s);
check('B7b then silent', !SIZE.test(surf()));
// B8: the stop-intact check, run on fixture Drive scripts (the production call reads the real Drive folder)
const surfSrc = fs.readFileSync(path.join(WCDIR, 'sessionstart-backup-surfacer.js'), 'utf8');
const grab = re => { const m = re.exec(surfSrc); if (!m) throw new Error('not found: ' + re); return m[0]; };
const intact = new Function('fs', 'path', 'require', [
  grab(/^const stripBomText = .*$/m), grab(/^const SIZE_STOP_DRIVE_DIR = .*$/m), grab(/^const SIZE_ASK_RULES = .*$/m),
  grab(/^const DRIVE_READ_TIMEOUT_MS = .*$/m), grab(/^function readDriveFiles\([\s\S]*?^}/m),
  grab(/^function sizeStopIntactLine\([\s\S]*?^}/m), 'return sizeStopIntactLine;'].join('\n'))(fs, path, require);
const DRV = path.join(ROOT, 'drive'); fs.mkdirSync(DRV, { recursive: true });
fs.writeFileSync(path.join(DRV, 'update-config.ps1'), fs.readFileSync(path.join(WCDIR, 'update-config.ps1')));
fs.writeFileSync(path.join(DRV, 'update-global-rule.ps1'), fs.readFileSync(LIVE_UGR));
setSettings(ASK_RULES);
check('B8a all in place -> silent', intact(CL, 0, DRV) === null, intact(CL, 0, DRV));
const ucWc = fs.readFileSync(path.join(WCDIR, 'update-config.ps1'), 'utf8');
fs.writeFileSync(path.join(DRV, 'update-config.ps1'), ucWc.replace(/^(\s*)Invoke-RulesSizeStop \$dstAbs \$bytes/m, '$1# removed'));
check('B8b one measuring call removed -> flagged', /no longer measures/.test(intact(CL, 0, DRV) || ''));
fs.writeFileSync(path.join(DRV, 'update-config.ps1'), fs.readFileSync(LIVE_UC));
check('B8c the pre-GEN-674 script -> flagged', /no longer measures/.test(intact(CL, 0, DRV) || ''));
fs.writeFileSync(path.join(DRV, 'update-config.ps1'), ucWc);
fs.writeFileSync(path.join(DRV, 'update-global-rule.ps1'), '# edits CLAUDE.md itself now\n');
check('B8d wrapper no longer hands off -> flagged', /no longer hands its edits/.test(intact(CL, 0, DRV) || ''));
fs.writeFileSync(path.join(DRV, 'update-global-rule.ps1'), fs.readFileSync(LIVE_UGR));
setSettings([ASK_RULES[0]]);
check('B8e one ask rule missing -> flagged', /lacks the prompt rule Bash/.test(intact(CL, 0, DRV) || ''), intact(CL, 0, DRV));
setSettings(null);
check('B8f no ask list -> flagged', /lacks the prompt rule PowerShell.*and Bash/.test(intact(CL, 0, DRV) || ''));
setSettings(ASK_RULES.map(x => x.toLowerCase()));
check('B8g ask rules in another letter case -> silent', intact(CL, 0, DRV) === null);
setSettings(ASK_RULES);
check('B8h Drive folder unreadable -> silent', intact(CL, 0, path.join(ROOT, 'no-such-drive')) === null);
fs.writeFileSync(path.join(CL, 'settings.json'), '{broken');
check('B8i settings unreadable -> silent', intact(CL, 0, DRV) === null);
setSettings(ASK_RULES);
s = surf();
check('B8j the production call runs inside the hook (real Drive folder: line present before install)', /RULES-FILE SIZE STOP/.test(s) === !/^function Invoke-RulesSizeStop\b/m.test(fs.readFileSync(LIVE_UC, 'utf8')), s.slice(0, 300));

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
