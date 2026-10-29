// GEN-892 test suite. Runs everything against scratch copies under the OS temp folder; the real files are
// hashed before and after and must be byte-identical. Usage: node test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const WC = path.join(HERE, 'wc');
const WC_TOOL = path.join(WC, 'notes', 'release-review', 'release-review-tool.js');
const WC_LIMITS = path.join(WC, 'notes', 'anthropic-guidelines.json');
const WC_HOOKS = path.join(WC, 'hooks');
const WC_UPDATE_CONFIG = path.join(WC, 'drive', 'update-config.ps1');
const WC_SCAN = path.join(WC, 'skills', 'config-health-scan.ps1');
const LIVE_SCAN = 'C:/Users/Erez/.claude/skills/config-health/config-health-scan.ps1';
const PAGES = path.join(HERE, 'test-pages');
const REAL_NOTES = path.join(HERE, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gen892-test-'));
const TODAY = new Date().toISOString().slice(0, 10);

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (detail !== undefined ? ' -- ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600) : '')); }
}
const sha = f => { try { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); } catch (e) { return 'missing'; } };
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
let seq = 0;

// ---- real files must not change ----
const REAL_WATCH = [
  path.join(REAL_NOTES, 'anthropic-guidelines.json'),
  path.join(REAL_NOTES, 'release-review', 'state.json'),
  path.join(REAL_NOTES, 'release-review', 'runs.jsonl'),
  path.join(REAL_NOTES, 'release-review', 'guidelines-state.json'),
  path.join(REAL_NOTES, 'release-review', 'guidelines-changes.jsonl'),
  'C:/Users/Erez/.claude/CLAUDE.md',
];
const realBefore = REAL_WATCH.map(sha);
const realDocsBefore = fs.existsSync(path.join(REAL_NOTES, 'release-review', 'docs'));

// ---- fixtures ----
// A fixture home holds "AI Projects/Improve AI Infra/notes" (the notes root the tool and readers use).
function mkHome(opts) {
  const o = opts || {};
  const home = path.join(TMP, 'h' + (++seq));
  const notes = path.join(home, 'AI Projects', 'Improve AI Infra', 'notes');
  fs.mkdirSync(path.join(notes, 'release-review'), { recursive: true });
  if (!o.noLimits) fs.writeFileSync(path.join(notes, 'anthropic-guidelines.json'), o.limitsText || fs.readFileSync(WC_LIMITS, 'utf8'));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  return { home, notes, rr: path.join(notes, 'release-review') };
}
function mkPages(mods) {
  const dir = path.join(TMP, 'p' + (++seq));
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(PAGES)) {
    const id = f.replace(/\.md$/, '');
    let text = fs.readFileSync(path.join(PAGES, f), 'utf8');
    const m = mods && mods[id];
    if (m === null) continue; // page left out = failed download
    if (typeof m === 'function') text = m(text);
    fs.writeFileSync(path.join(dir, f), text);
  }
  if (mods && mods.meta) for (const [id, meta] of Object.entries(mods.meta)) fs.writeFileSync(path.join(dir, id + '.meta.json'), JSON.stringify(meta));
  return dir;
}
function swap(text, from, to) {
  const n = text.split(from).length - 1;
  if (n < 1) throw new Error('test page has no "' + from + '"');
  return text.split(from).join(to);
}
function tool(fx, pagesDir, apply, toolPath) {
  const args = [toolPath || WC_TOOL, 'guidelines-check', '--root', fx.notes, '--pages-dir', pagesDir];
  if (apply) args.push('--apply');
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 300000 });
  try { return JSON.parse(r.stdout); } catch (e) { return { parseError: true, stdout: r.stdout, stderr: r.stderr }; }
}
const realWarnings = j => (j.warnings || []).filter(w => !w.startsWith('stray copy of a limit'));
const limitOf = (fx, id) => readJson(path.join(fx.notes, 'anthropic-guidelines.json')).limits.find(l => l.id === id);
const logRows = fx => {
  let lines = [];
  try { lines = fs.readFileSync(path.join(fx.rr, 'guidelines-changes.jsonl'), 'utf8').split('\n').filter(Boolean); } catch (e) { return []; }
  return lines.map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
};
function cloneWithout(obj, keys) { const o = JSON.parse(JSON.stringify(obj)); for (const k of keys) delete o[k]; return o; }

// ---- JS reader and PowerShell reader ----
const reader = require(path.join(WC_HOOKS, 'guidelines-limits.js'));
const RULES = { fallback: 200, min: 50, max: 800 };
const NOTES_CAP = { fallback: 10000, min: 2000, max: 100000 };
function psRulesLimit(fx) {
  const src = fs.readFileSync(WC_UPDATE_CONFIG, 'utf8');
  const a = src.indexOf('# The new value of the last applied row');
  const b = src.indexOf('# Lower-case hex SHA-256');
  if (a < 0 || b < 0) throw new Error('reader functions not found in the update-config.ps1 copy');
  const harness = '$FALLBACK_RULES_LINE_CAP = 200\r\n' +
    "$GuidelinesFile = '" + path.join(fx.notes, 'anthropic-guidelines.json').replace(/'/g, "''") + "'\r\n" +
    "$GuidelinesLog = '" + path.join(fx.rr, 'guidelines-changes.jsonl').replace(/'/g, "''") + "'\r\n" +
    src.slice(a, b) + '\r\nWrite-Output (Get-RulesLineLimit)\r\n';
  const f = path.join(TMP, 'harness' + (++seq) + '.ps1');
  fs.writeFileSync(f, harness, 'utf8');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', f], { encoding: 'utf8', timeout: 60000 });
  return Number(String(r.stdout).trim());
}
function setLimitValue(fx, id, field, value) {
  const f = path.join(fx.notes, 'anthropic-guidelines.json');
  const g = readJson(f);
  g.limits.find(l => l.id === id)[field] = value;
  fs.writeFileSync(f, JSON.stringify(g, null, 2));
}
function appendLog(fx, row) { fs.appendFileSync(path.join(fx.rr, 'guidelines-changes.jsonl'), (typeof row === 'string' ? row : JSON.stringify(row)) + '\n'); }

// ---- hook runners ----
function hookDir(withModule) {
  const dir = path.join(TMP, 'hooks' + (++seq));
  fs.mkdirSync(path.join(dir, 'refs'), { recursive: true });
  for (const f of fs.readdirSync(WC_HOOKS)) if (f.endsWith('.js') && (withModule || f !== 'guidelines-limits.js')) fs.writeFileSync(path.join(dir, f), fs.readFileSync(path.join(WC_HOOKS, f)));
  const big = Array.from({ length: 400 }, (_, i) => 'line ' + i + ' ' + 'x'.repeat(90)).join('\n'); // ~39,000 characters
  for (const r of ['notion.md', 'shell.md']) fs.writeFileSync(path.join(dir, 'refs', r), big);
  fs.writeFileSync(path.join(dir, 'refs', 'browser.md'), Array.from({ length: 120 }, (_, i) => 'browser note ' + i + ' ' + 'y'.repeat(85)).join('\n')); // ~12,000
  return dir;
}
function runHook(dir, file, input, home) {
  const env = Object.assign({}, process.env, { USERPROFILE: home, HOME: home });
  const r = spawnSync(process.execPath, [path.join(dir, file)], { input: JSON.stringify(input), encoding: 'utf8', env, timeout: 60000 });
  let ctx = null;
  try { ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext; } catch (e) { /* no output */ }
  return { ctx, stdout: r.stdout, stderr: r.stderr, status: r.status };
}
function runNodeHelper(code, home) {
  const f = path.join(TMP, 'helper' + (++seq) + '.js');
  fs.writeFileSync(f, code);
  const env = Object.assign({}, process.env, { USERPROFILE: home, HOME: home });
  const r = spawnSync(process.execPath, [f], { encoding: 'utf8', env, timeout: 60000 });
  return r.stdout.trim();
}
const jsStr = s => JSON.stringify(s);

// =========================================================================================================
// 1. Tool: plain run, baseline, unchanged
{
  const fx = mkHome();
  const before = sha(path.join(fx.notes, 'anthropic-guidelines.json'));
  const j = tool(fx, mkPages(), false);
  check('plain/unchanged: ok', j.ok === true, j);
  check('plain/unchanged: 12 anchors unchanged', j.unchanged === 12, j.unchanged);
  check('plain/unchanged: no change, no candidate, no warning', j.changes.length === 0 && j.candidates.length === 0 && realWarnings(j).length === 0, { c: j.changes, k: j.candidates, w: realWarnings(j) });
  check('plain: limits file untouched', sha(path.join(fx.notes, 'anthropic-guidelines.json')) === before);
  check('plain: no log, no page copies', !fs.existsSync(path.join(fx.rr, 'guidelines-changes.jsonl')) && !fs.existsSync(path.join(fx.rr, 'docs')));
  const st = readJson(path.join(fx.rr, 'guidelines-state.json'));
  check('plain: state has checkUtc and sinceUtc, no applyUtc, no hashes', !!st.checkUtc && !!st.sinceUtc && !st.applyUtc && Object.keys(st.pages || {}).length === 0, st);
}

// 2. First live run: baseline only
let baseFx;
{
  const fx = baseFx = mkHome();
  const j = tool(fx, mkPages(), true);
  check('apply/first: nothing applied', j.ok === true && j.applied.length === 0 && j.changes.length === 0, j);
  const st = readJson(path.join(fx.rr, 'guidelines-state.json'));
  check('apply/first: 7 hashes stored', Object.keys(st.pages).length === 7 && Object.values(st.pages).every(p => /^[0-9a-f]{64}$/.test(p.sha256) && p.size > 0), st.pages);
  check('apply/first: applyUtc set', !!st.applyUtc);
  check('apply/first: 7 page copies saved', fs.readdirSync(path.join(fx.rr, 'docs')).length === 7);
  check('apply/first: no changed paragraphs (baseline)', j.changedParagraphs.length === 0, j.changedParagraphs);
}

// 3. One number changed: hooks cap 10,000 -> 12,000 in both anchor sentences
const hooks12k = t => swap(swap(t, 'are capped at 10,000 characters', 'are capped at 12,000 characters'), 'If a value exceeds 10,000 characters', 'If a value exceeds 12,000 characters');
{
  const fx = mkHome();
  const before = sha(path.join(fx.notes, 'anthropic-guidelines.json'));
  const jp = tool(fx, mkPages({ hooks: hooks12k }), false);
  check('plain/change: change found', jp.changes.length === 1 && jp.changes[0].limit === 'hook-injected-text' && jp.changes[0].old === 10000 && jp.changes[0].new === 12000, jp.changes);
  check('plain/change: "change detected, not applied" warning', realWarnings(jp).some(w => w.startsWith('change detected, not applied: hook-injected-text 10000 -> 12000')), realWarnings(jp));
  check('plain/change: limits file untouched, no log', sha(path.join(fx.notes, 'anthropic-guidelines.json')) === before && !fs.existsSync(path.join(fx.rr, 'guidelines-changes.jsonl')));
  const old = readJson(path.join(fx.notes, 'anthropic-guidelines.json'));
  const ja = tool(fx, mkPages({ hooks: hooks12k }), true);
  check('apply/change: applied one row', ja.applied.length === 1 && ja.candidates.length === 0, { a: ja.applied, k: ja.candidates, w: realWarnings(ja) });
  const now = readJson(path.join(fx.notes, 'anthropic-guidelines.json'));
  const l = now.limits.find(x => x.id === 'hook-injected-text');
  check('apply/change: value is the integer 12000, verified today', l.value === 12000 && Number.isInteger(l.value) && l.verified === TODAY, l);
  const exp = JSON.parse(JSON.stringify(old));
  Object.assign(exp.limits.find(x => x.id === 'hook-injected-text'), { value: 12000, verified: TODAY });
  check('apply/change: nothing else in the limits file changed', JSON.stringify(now) === JSON.stringify(exp));
  const rows = logRows(fx);
  check('apply/change: log row applied with changeId, sentence, overLimit', rows.length === 1 && rows[0].status === 'applied' && /^[0-9a-f]{12}$/.test(rows[0].changeId) && rows[0].sentence.includes('12,000') && rows[0].sentence.length <= 300 && Array.isArray(rows[0].overLimit), rows);
  check('apply/change: JS reader accepts the logged raise', reader.readLimit('hook-injected-text', Object.assign({ home: fx.home }, NOTES_CAP)).value === 12000);
  check('apply/change: no "change detected" warning on the live run', !realWarnings(ja).some(w => w.startsWith('change detected')));
  const again = tool(fx, mkPages({ hooks: hooks12k }), true);
  check('apply/change: next run sees it unchanged', again.changes.length === 0 && again.applied.length === 0 && again.unchanged === 12, again);
}

// 4. Rules-file limit raise, both readers, hand edits, not-applied row, malformed line
{
  const fn = mkHome();
  fs.writeFileSync(path.join(fn.rr, 'guidelines-changes.jsonl'), '{"changeId":"ffffffffffff","limit":"x","status":"applied","new":1}');
  tool(fn, mkPages({ hooks: hooks12k }), true);
  check('log without a final newline: the new row starts on its own line', logRows(fn).length === 2 && logRows(fn)[1].limit === 'hook-injected-text', logRows(fn));
}
{
  const fx = mkHome();
  const mem300 = t => swap(swap(t, 'Files over 200 lines consume', 'Files over 300 lines consume'), 'target under 200 lines per', 'target under 300 lines per');
  const ja = tool(fx, mkPages({ memory: mem300 }), true);
  check('rules/apply: claude-md-lines 200 -> 300 applied', ja.applied.length === 1 && limitOf(fx, 'claude-md-lines').value === 300, { a: ja.applied, w: realWarnings(ja), k: ja.candidates });
  check('rules/apply: JS reader 300', reader.readLimit('claude-md-lines', Object.assign({ home: fx.home }, RULES)).value === 300);
  check('rules/apply: PowerShell reader 300', psRulesLimit(fx) === 300);
  setLimitValue(fx, 'claude-md-lines', 'value', 350);
  const r350 = reader.readLimit('claude-md-lines', Object.assign({ home: fx.home }, RULES));
  check('rules/hand raise: JS reader falls back to 200 with a warning', r350.value === 200 && r350.warning && r350.warning.value === 350, r350);
  check('rules/hand raise: PowerShell reader 200', psRulesLimit(fx) === 200);
  setLimitValue(fx, 'claude-md-lines', 'value', 300);
  appendLog(fx, '{this line is not json');
  check('rules/malformed log line: both readers still 300', reader.readLimit('claude-md-lines', Object.assign({ home: fx.home }, RULES)).value === 300 && psRulesLimit(fx) === 300);
  appendLog(fx, { changeId: logRows(fx)[0].changeId, status: 'not-applied', ts: new Date().toISOString() });
  check('rules/not-applied row: both readers 200', reader.readLimit('claude-md-lines', Object.assign({ home: fx.home }, RULES)).value === 200 && psRulesLimit(fx) === 200);
  setLimitValue(fx, 'claude-md-lines', 'value', 150);
  check('rules/lowered: both readers 150', reader.readLimit('claude-md-lines', Object.assign({ home: fx.home }, RULES)).value === 150 && psRulesLimit(fx) === 150);
  setLimitValue(fx, 'claude-md-lines', 'value', 30);
  check('rules/below range: both readers 200', reader.readLimit('claude-md-lines', Object.assign({ home: fx.home }, RULES)).value === 200 && psRulesLimit(fx) === 200);
  setLimitValue(fx, 'claude-md-lines', 'value', 199.5);
  check('rules/not whole: both readers 200', reader.readLimit('claude-md-lines', Object.assign({ home: fx.home }, RULES)).value === 200 && psRulesLimit(fx) === 200);
  const fs1 = mkHome();
  setLimitValue(fs1, 'claude-md-lines', 'value', 300);
  appendLog(fs1, { changeId: 'cccccccccccc', limit: 'claude-md-lines', field: 'value', old: 200, new: '300', status: 'applied' });
  check('rules/string "new" in the log: both readers 200', reader.readLimit('claude-md-lines', Object.assign({ home: fs1.home }, RULES)).value === 200 && psRulesLimit(fs1) === 200);
  const fs2 = mkHome();
  setLimitValue(fs2, 'claude-md-lines', 'value', 300);
  appendLog(fs2, { changeId: 'dddddddddddd', limit: 'CLAUDE-MD-LINES', field: 'value', old: 200, new: 300, status: 'Applied' });
  check('rules/wrong-case limit and status in the log: both readers 200', reader.readLimit('claude-md-lines', Object.assign({ home: fs2.home }, RULES)).value === 200 && psRulesLimit(fs2) === 200);
  const fs4 = mkHome();
  setLimitValue(fs4, 'claude-md-lines', 'value', 300);
  appendLog(fs4, '{"changeId":"abababababab","Limit":"claude-md-lines","Field":"value","Old":200,"New":300,"Status":"applied"}');
  check('rules/wrong-case key names in the log: both readers 200', reader.readLimit('claude-md-lines', Object.assign({ home: fs4.home }, RULES)).value === 200 && psRulesLimit(fs4) === 200);
  const fs5 = mkHome();
  setLimitValue(fs5, 'claude-md-lines', 'value', 300);
  appendLog(fs5, '{"changeId":"acacacacacac","limit":["claude-md-lines"],"field":"value","old":200,"new":[300],"status":["applied"]}');
  check('rules/array values in the log: both readers 200', reader.readLimit('claude-md-lines', Object.assign({ home: fs5.home }, RULES)).value === 200 && psRulesLimit(fs5) === 200);
  const fs3 = mkHome();
  setLimitValue(fs3, 'claude-md-lines', 'value', 300);
  appendLog(fs3, { changeId: 'eeeeeeeeeeee', limit: 'claude-md-lines', field: 'valueLines', old: 200, new: 300, status: 'applied' });
  check('rules/row for another field: both readers 200', reader.readLimit('claude-md-lines', Object.assign({ home: fs3.home }, RULES)).value === 200 && psRulesLimit(fs3) === 200);
  const fy = mkHome({ noLimits: true });
  const ry = reader.readLimit('claude-md-lines', Object.assign({ home: fy.home }, RULES));
  check('rules/no limits file: JS 200 with error, PowerShell 200', ry.value === 200 && !!ry.error && psRulesLimit(fy) === 200, ry);
  const fz = mkHome();
  check('rules/real values: both readers 200 on the unmodified file', reader.readLimit('claude-md-lines', Object.assign({ home: fz.home }, RULES)).value === 200 && psRulesLimit(fz) === 200);
}

// 5. Candidates
{
  const fx = mkHome();
  const j = tool(fx, mkPages({ hooks: t => swap(t, 'plain stdout, are capped at 10,000', 'plain stdout, are limited to 10,000') }), false);
  check('reworded: not-found candidate, no change', j.candidates.length === 1 && j.candidates[0].key === 'guidelines:hook-injected-text:not-found' && j.changes.length === 0, j.candidates);
  const j2 = tool(fx, mkPages({ memory: t => t + '\n\nFiles over 300 lines consume more context too.\n' }), false);
  check('two numbers incl. current: old-and-new', j2.candidates.some(c => c.key === 'guidelines:claude-md-lines:old-and-new'), j2.candidates);
  const j3 = tool(fx, mkPages({ memory: t => swap(t, 'Files over 200 lines consume', 'Files over 300 lines consume') + '\n\nFiles over 400 lines consume more context.\n' }), false);
  check('two other numbers: several-numbers', j3.candidates.some(c => c.key === 'guidelines:claude-md-lines:several-numbers'), j3.candidates);
  const j4 = tool(fx, mkPages({ hooks: t => swap(swap(t, 'are capped at 10,000 characters', 'are capped at 100,000 characters'), 'If a value exceeds 10,000 characters', 'If a value exceeds 100,000 characters') }), false);
  check('10x: out-of-range candidates, no change', j4.candidates.filter(c => c.reason === 'out-of-range').length === 2 && j4.changes.length === 0, j4.candidates);
  const j5 = tool(fx, mkPages({ hooks: t => swap(t, 'are capped at 10,000 characters', 'are capped at 12,000 characters') }), false);
  check('one of two anchors changed: anchors-disagree', j5.candidates.some(c => c.key === 'guidelines:hook-injected-text:anchors-disagree') && j5.changes.length === 0, j5.candidates);
  const j6 = tool(fx, mkPages({ hooks: t => swap(swap(t, 'plain stdout, are capped at', 'plain stdout, top out at'), 'If a value exceeds', 'Should a value pass') }), false);
  check('2 anchors missing on one page: page warning, no candidate', j6.candidates.length === 0 && realWarnings(j6).some(w => w.startsWith('page hooks: 2 anchors not found')), { k: j6.candidates, w: realWarnings(j6) });
  check('hooks anchor ignores the later "2,000 characters" (shortest span)', tool(fx, mkPages(), false).candidates.length === 0);
}

// 6. KB scaling, comma-less number
{
  const fx = mkHome();
  const j = tool(fx, mkPages({ memory: t => swap(t, 'or the first 25KB', 'or the first 30KB') }), true);
  const m = limitOf(fx, 'memory-md-load');
  check('25KB -> 30KB: valueBytes 30000 and display string', j.applied.length === 1 && m.valueBytes === 30000 && m.value === '200 lines or 30KB' && m.valueLines === 200, { m, w: realWarnings(j), k: j.candidates });
  check('25KB -> 30KB: "text to update" lists the overIt that states 25,000', j.textToUpdate.some(t => t.limit === 'memory-md-load' && t.field === 'overIt'), j.textToUpdate);
  const fresh = mkHome();
  const j2 = tool(fresh, mkPages({ skills: t => swap(t, 'is truncated at 1,536 characters', 'is truncated at 1536 characters') }), false);
  check('"1536" without a comma reads as unchanged', j2.changes.length === 0 && j2.candidates.length === 0, { c: j2.changes, k: j2.candidates });
  const j3 = tool(fresh, mkPages({ skills: t => swap(t, 'is truncated at 1,536 characters', 'is truncated at 2048 characters') }), false);
  check('"2048" without a comma reads as a change', j3.changes.length === 1 && j3.changes[0].new === 2048, j3.changes);
}

// 7. Text to update for skill-after-compaction includes the house rule
{
  const fx = mkHome();
  const j = tool(fx, mkPages({ skills: t => swap(t, 'keeping the first 5,000 tokens of each', 'keeping the first 6,000 tokens of each') }), true);
  check('5,000 -> 6,000 tokens applied', j.applied.length === 1 && limitOf(fx, 'skill-after-compaction').value === 6000, { w: realWarnings(j), k: j.candidates });
  check('text to update: the limit\'s own overIt and the gate-skill-runbook house rule', j.textToUpdate.some(t => t.limit === 'skill-after-compaction') && j.textToUpdate.some(t => t.limit === 'gate-skill-runbook'), j.textToUpdate);
  // skill-restore hook follows the logged value
  const hd = hookDir(true);
  const skillDir = path.join(fx.home, '.claude', 'skills', 'demo');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: demo\ndescription: demo\n---\nbody\n');
  const tr = path.join(TMP, 'transcript' + (++seq) + '.jsonl');
  fs.writeFileSync(tr, JSON.stringify({ type: 'user', isMeta: true, message: { content: 'Base directory for this skill: ' + skillDir + '\n\nbody' } }) + '\n');
  const r = runHook(hd, 'sessionstart-skill-restore.js', { source: 'compact', transcript_path: tr }, fx.home);
  check('skill-restore: "about 6,000 tokens each" after the logged change', !!r.ctx && r.ctx.includes('about 6,000 tokens each'), r.ctx || r.stderr);
  const fy = mkHome();
  fs.mkdirSync(path.join(fy.home, '.claude', 'skills', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(fy.home, '.claude', 'skills', 'demo', 'SKILL.md'), 'x');
  fs.writeFileSync(tr, JSON.stringify({ type: 'user', isMeta: true, message: { content: 'Base directory for this skill: ' + path.join(fy.home, '.claude', 'skills', 'demo') + '\n\nbody' } }) + '\n');
  const r2 = runHook(hd, 'sessionstart-skill-restore.js', { source: 'compact', transcript_path: tr }, fy.home);
  check('skill-restore: "about 5,000 tokens each" by default', !!r2.ctx && r2.ctx.includes('about 5,000 tokens each'), r2.ctx || r2.stderr);
}

// 8. Failed download, HTML, small page, changed paragraphs (after the baseline in test 2)
{
  const j = tool(baseFx, mkPages({ hooks: null }), false);
  check('missing page: page warning, its anchors not judged, no candidate', realWarnings(j).some(w => w.startsWith('page hooks: download failed')) && j.candidates.length === 0, { w: realWarnings(j), k: j.candidates });
  const j2 = tool(baseFx, mkPages({ meta: { skills: { type: 'text/html; charset=utf-8' } } }), false);
  check('HTML content type: page warning, no candidate', realWarnings(j2).some(w => w.startsWith('page skills: not markdown')) && j2.candidates.length === 0, realWarnings(j2));
  const j3 = tool(baseFx, mkPages({ skills: t => '<!DOCTYPE html><html>' + t }), false);
  check('HTML body: page warning', realWarnings(j3).some(w => w.startsWith('page skills: an HTML page')), realWarnings(j3));
  const j4 = tool(baseFx, mkPages({ meta: { memory: { status: 404 } } }), false);
  check('HTTP 404: page warning', realWarnings(j4).some(w => w.startsWith('page memory: HTTP 404')), realWarnings(j4));
  const j5 = tool(baseFx, mkPages({ memory: t => t.slice(0, Math.floor(t.length / 3)) }), false);
  check('page under half its stored size: page warning', realWarnings(j5).some(w => w.startsWith('page memory: only')), realWarnings(j5));
  const j6 = tool(baseFx, mkPages({ skills: t => t + '\n\nNew in this release: keep each skill under 400 lines for speed.\n\nUnrelated sentence about nothing at all.\n' }), false);
  const cp = j6.changedParagraphs.find(c => c.page === 'skills');
  check('changed paragraphs: the relevant one shown, the other counted', !!cp && cp.shown.length === 1 && cp.shown[0].includes('400 lines') && cp.notShown === 1, j6.changedParagraphs);
  check('changed paragraphs: a plain run does not overwrite the saved copy', !fs.readFileSync(path.join(baseFx.rr, 'docs', 'skills.md'), 'utf8').includes('400 lines'));
}

// 9. Apply failure leaves everything as it was
{
  const text = fs.readFileSync(WC_LIMITS, 'utf8').replace(/("id": "hook-injected-text"[\s\S]*?)"verified": "[0-9-]+",\s*/, '$1');
  const fx = mkHome({ limitsText: text });
  const before = sha(path.join(fx.notes, 'anthropic-guidelines.json'));
  const j = tool(fx, mkPages({ hooks: hooks12k }), true);
  check('apply-failed: candidate, no log, file unchanged', j.candidates.some(c => c.key === 'guidelines:hook-injected-text:apply-failed') && logRows(fx).length === 0 && sha(path.join(fx.notes, 'anthropic-guidelines.json')) === before, { k: j.candidates, w: realWarnings(j) });
  check('apply-failed: no temp file left', fs.readdirSync(fx.notes).filter(f => f.includes('.tmp-')).length === 0);
}

// 10. --pages-dir inside the project is refused and writes nothing
{
  const proj = path.join(TMP, 'proj' + (++seq));
  const rr = path.join(proj, 'notes', 'release-review');
  fs.mkdirSync(rr, { recursive: true });
  fs.writeFileSync(path.join(rr, 'release-review-tool.js'), fs.readFileSync(WC_TOOL));
  fs.writeFileSync(path.join(proj, 'notes', 'anthropic-guidelines.json'), fs.readFileSync(WC_LIMITS));
  const before = sha(path.join(proj, 'notes', 'anthropic-guidelines.json'));
  const j = tool({ notes: path.join(proj, 'notes') }, mkPages({ hooks: hooks12k }), true, path.join(rr, 'release-review-tool.js'));
  check('pages-dir inside the project: refused', j.ok === false && j.warnings.some(w => w.startsWith('refused')), j);
  const r2 = spawnSync(process.execPath, [WC_TOOL, 'guidelines-check', '--root', '--apply'], { encoding: 'utf8' });
  let j2 = {};
  try { j2 = JSON.parse(r2.stdout); } catch (e) { /* below */ }
  check('--root followed by a flag: refused', j2.ok === false && (j2.warnings || []).some(w => w.includes('--root needs a folder')), r2.stdout.slice(0, 300));
  check('pages-dir inside the project: nothing written', sha(path.join(proj, 'notes', 'anthropic-guidelines.json')) === before && !fs.existsSync(path.join(rr, 'guidelines-state.json')) && !fs.existsSync(path.join(rr, 'guidelines-changes.jsonl')));
}

// 11. Readout (failure lines only)
{
  const dir = path.join(TMP, 'ro' + (++seq));
  fs.mkdirSync(dir, { recursive: true });
  const t = path.join(dir, 'release-review-tool.js');
  fs.writeFileSync(t, fs.readFileSync(WC_TOOL));
  const day = 86400000;
  const iso = ms => new Date(ms).toISOString();
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ lastReviewedVersion: '2.1.312', installedUtc: iso(Date.now() - 30 * day), supervisedPassedUtc: iso(Date.now() - 20 * day) }));
  fs.writeFileSync(path.join(dir, 'runs.jsonl'), JSON.stringify({ run: 'x', mode: 'live', from: '2.1.311', through: '2.1.312', outcome: 'ok', filed: [], appended: [], unblocked: [], waiting: 0, ts: iso(Date.now() - day) }) + '\n');
  const ro = () => spawnSync(process.execPath, [t, 'readout'], { encoding: 'utf8' }).stdout;
  fs.writeFileSync(path.join(dir, 'guidelines-state.json'), JSON.stringify({ sinceUtc: iso(Date.now() - 20 * day), applyUtc: iso(Date.now() - 2 * day), warnings: [] }));
  check('readout: silent when the watch is fine', !ro().includes('Guidelines watch'), ro());
  fs.writeFileSync(path.join(dir, 'guidelines-state.json'), JSON.stringify({ sinceUtc: iso(Date.now() - 20 * day), applyUtc: iso(Date.now() - 2 * day), warnings: ['page hooks: HTTP 500; its anchors were not checked'] }));
  check('readout: a stored warning is shown', ro().includes('⚠ Guidelines watch: page hooks: HTTP 500'), ro());
  fs.writeFileSync(path.join(dir, 'guidelines-state.json'), JSON.stringify({ sinceUtc: iso(Date.now() - 20 * day), applyUtc: iso(Date.now() - 15 * day), checkUtc: iso(Date.now() - day), warnings: [] }));
  check('readout: stalled live check alarms even when plain runs are fresh', /Guidelines watch: no live check .* in 15 days/.test(ro()), ro());
  fs.writeFileSync(path.join(dir, 'guidelines-state.json'), JSON.stringify({ sinceUtc: iso(Date.now() - 12 * day), warnings: [] }));
  check('readout: never applied since install alarms after 10 days', /no live check .* in 12 days \(never\)/.test(ro()), ro());
}

// 12. Hooks follow the cap: notion, shell, topic, browser
{
  const fxRaised = mkHome();
  setLimitValue(fxRaised, 'hook-injected-text', 'value', 15000);
  appendLog(fxRaised, { changeId: 'aaaaaaaaaaaa', limit: 'hook-injected-text', field: 'value', old: 10000, new: 15000, status: 'applied' });
  const fxUnlogged = mkHome();
  setLimitValue(fxUnlogged, 'hook-injected-text', 'value', 15000);
  const fxLow = mkHome();
  setLimitValue(fxLow, 'hook-injected-text', 'value', 5000);
  const fxDefault = mkHome();
  const withMod = hookDir(true);
  const noMod = hookDir(false);
  const notion = (dir, fx) => runHook(dir, 'inject-notion-refs.js', { prompt: 'a Notion question', session_id: 's' + (++seq) }, fx.home);
  let r = notion(withMod, fxDefault);
  check('notion hook: default cap 10,000', !!r.ctx && r.ctx.length <= 10000 && r.ctx.length > 8000 && r.ctx.includes('over the 10,000-character limit'), r.ctx ? r.ctx.length : r.stderr);
  r = notion(withMod, fxRaised);
  check('notion hook: logged raise to 15,000', !!r.ctx && r.ctx.length <= 15000 && r.ctx.length > 13000 && r.ctx.includes('over the 15,000-character limit'), r.ctx ? r.ctx.length : r.stderr);
  r = notion(withMod, fxUnlogged);
  check('notion hook: unlogged raise ignored (10,000)', !!r.ctx && r.ctx.length <= 10000 && r.ctx.length > 8000, r.ctx ? r.ctx.length : r.stderr);
  r = notion(withMod, fxLow);
  check('notion hook: lowered to 5,000', !!r.ctx && r.ctx.length <= 5000 && r.ctx.includes('over the 5,000-character limit'), r.ctx ? r.ctx.length : r.stderr);
  r = notion(noMod, fxRaised);
  check('notion hook: reader missing -> 10,000', !!r.ctx && r.ctx.length <= 10000 && r.ctx.length > 8000, r.ctx ? r.ctx.length : r.stderr);
  r = runHook(withMod, 'inject-shell-refs.js', { tool_name: 'Bash', session_id: 'shell' + (++seq) + Date.now() }, fxRaised.home);
  check('shell hook: logged raise to 15,000', !!r.ctx && r.ctx.length <= 15000 && r.ctx.length > 13000, r.ctx ? r.ctx.length : r.stderr);
  r = runHook(noMod, 'inject-shell-refs.js', { tool_name: 'Bash', session_id: 'shell' + (++seq) + Date.now() }, fxRaised.home);
  check('shell hook: reader missing -> 10,000', !!r.ctx && r.ctx.length <= 10000 && r.ctx.length > 8000, r.ctx ? r.ctx.length : r.stderr);
  const capOf = (dir, fx) => runNodeHelper('const m = require(' + jsStr(path.join(dir, 'inject-topic-refs.js')) + '); console.log(m.CAP + " " + m.KEEP);', fx.home);
  check('topic hook: default CAP 10000, KEEP 9000', capOf(withMod, fxDefault) === '10000 9000', capOf(withMod, fxDefault));
  check('topic hook: logged raise CAP 15000, KEEP 14000', capOf(withMod, fxRaised) === '15000 14000', capOf(withMod, fxRaised));
  check('topic hook: reader missing -> 10000 9000', capOf(noMod, fxRaised) === '10000 9000', capOf(noMod, fxRaised));
  const browser = (dir, fx) => runNodeHelper(
    'const m = require(' + jsStr(path.join(dir, 'inject-browser-refs.js')) + ');' +
    'const out = m.handle({ hook_event_name: "PostToolUse", session_id: "b' + (++seq) + Date.now() + '", tool_name: "mcp__claude-in-chrome__navigate", tool_input: {}, tool_response: "ok" },' +
    ' { tmpDir: ' + jsStr(path.join(TMP, 'btmp' + seq)) + ', hooksDir: ' + jsStr(dir) + ', logDir: ' + jsStr(path.join(TMP, 'nologs')) + ', now: Date.now() });' +
    'console.log(JSON.stringify(out));', fx.home);
  fs.mkdirSync(path.join(TMP, 'nologs'), { recursive: true });
  let b = browser(withMod, fxDefault);
  check('browser hook: 12,000-char notes over the default 9,500 -> read-it-yourself line', b.includes('over the 9500 that fit'), b.slice(0, 300));
  for (let i = 0; i < 1; i++) fs.mkdirSync(path.join(TMP, 'btmp' + (seq + 1)), { recursive: true });
  b = browser(withMod, fxRaised);
  check('browser hook: logged raise (14,500 room) -> notes included', b.includes('browser note 119'), b.slice(0, 300));
}

// 13. Session-start surfacer: rules-file limit and the guidelines lines
{
  const lines250 = Array.from({ length: 250 }, (_, i) => 'rule ' + i).join('\n') + '\n';
  const surf = (dir, fx) => {
    fs.writeFileSync(path.join(fx.home, '.claude', 'CLAUDE.md'), lines250);
    return runHook(dir, 'sessionstart-backup-surfacer.js', { hook_event_name: 'SessionStart', source: 'startup', session_id: 'x' + (++seq) }, fx.home).ctx || '';
  };
  const withMod = hookDir(true);
  const noMod = hookDir(false);
  let c = surf(withMod, mkHome());
  check('surfacer: 250 lines over the default 200, no guidelines line', c.includes('over its 200-line limit') && !c.includes('GUIDELINES LIMITS'), c.slice(0, 400));
  const fx300 = mkHome();
  setLimitValue(fx300, 'claude-md-lines', 'value', 300);
  appendLog(fx300, { changeId: 'bbbbbbbbbbbb', limit: 'claude-md-lines', field: 'value', old: 200, new: 300, status: 'applied' });
  c = surf(withMod, fx300);
  check('surfacer: logged 300 -> 250 lines is fine, no guidelines line', !c.includes('RULES-FILE SIZE') && !c.includes('GUIDELINES LIMITS'), c.slice(0, 400));
  const fxU = mkHome();
  setLimitValue(fxU, 'claude-md-lines', 'value', 300);
  c = surf(withMod, fxU);
  check('surfacer: unlogged 300 -> limit 200 and the mismatch line', c.includes('over its 200-line limit') && c.includes('rules-file limit in the limits file (300) does not match a logged Anthropic change; using 200') && c.includes('Tell Erez'), c.slice(0, 600));
  const fxN = mkHome();
  setLimitValue(fxN, 'hook-injected-text', 'value', 15000);
  c = surf(withMod, fxN);
  check('surfacer: unlogged notes cap -> mismatch line', c.includes('notes cap in the limits file (15000) does not match a logged Anthropic change; using 10,000'), c.slice(0, 600));
  const fxR = mkHome();
  setLimitValue(fxR, 'claude-md-lines', 'value', 900);
  c = surf(withMod, fxR);
  check('surfacer: rules limit outside 50-800 -> out-of-range line, limit 200', c.includes('rules-file limit in the limits file (900) is outside the range the hooks accept; using 200') && c.includes('over its 200-line limit'), c.slice(0, 600));
  c = surf(noMod, mkHome());
  check('surfacer: reader missing -> GUIDELINES LIMITS line, limit 200', c.includes('GUIDELINES LIMITS — the shared reader hooks/guidelines-limits.js could not be loaded') && c.includes('over its 200-line limit'), c.slice(0, 600));
  c = surf(withMod, mkHome({ noLimits: true }));
  check('surfacer: limits file missing -> GUIDELINES LIMITS line', c.includes('GUIDELINES LIMITS — notes/anthropic-guidelines.json could not be read'), c.slice(0, 600));
  const fxL = mkHome();
  setLimitValue(fxL, 'claude-md-lines', 'value', 150);
  fs.writeFileSync(path.join(fxL.home, '.claude', 'CLAUDE.md'), Array.from({ length: 180 }, (_, i) => 'r' + i).join('\n') + '\n');
  c = runHook(withMod, 'sessionstart-backup-surfacer.js', { hook_event_name: 'SessionStart', source: 'startup', session_id: 'x' + (++seq) }, fxL.home).ctx || '';
  check('surfacer: lowered to 150 -> 180 lines is over', c.includes('over its 150-line limit'), c.slice(0, 400));
}

// 14. GEN-969: empty YAML forms in a command file's description
{
  const dir = path.join(TMP, 'cmd' + (++seq));
  fs.mkdirSync(dir, { recursive: true });
  const cases = {
    tilde: { fm: 'description: ~', empty: true },
    nullLower: { fm: 'description: null', empty: true },
    nullTitle: { fm: 'description: Null', empty: true },
    nullUpper: { fm: 'description: NULL', empty: true },
    nullWord: { fm: 'description: nullable things', empty: false },
    comment: { fm: 'description: # todo', empty: true },
    commentCont: { fm: 'description: # note\n  real text on the next line', empty: false },
    text: { fm: 'description: plain words', empty: false },
  };
  const NO_DESC = 'description not in frontmatter';
  for (const [name, c] of Object.entries(cases)) {
    const f = path.join(dir, name + '.md');
    fs.writeFileSync(f, '---\n' + c.fm + '\n---\nBody.\n');
    const run = script => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', 'size-check', '-Target', f, '-AsIfPath', 'C:\\Users\\Erez\\.claude\\commands\\gen969-' + name + '.md'], { encoding: 'utf8', timeout: 120000 }).stdout;
    const out = run(WC_SCAN);
    check('GEN-969 ' + name + ': ' + (c.empty ? 'note' : 'measured'), out.includes(NO_DESC) === c.empty, out.slice(0, 500));
    if (name === 'tilde') check('GEN-969 baseline: the live checker measures "~" as text', !run(LIVE_SCAN).includes(NO_DESC));
  }
}

// ---- real files unchanged ----
const realAfter = REAL_WATCH.map(sha);
check('real files byte-identical after the whole suite', JSON.stringify(realAfter) === JSON.stringify(realBefore), REAL_WATCH.filter((f, i) => realAfter[i] !== realBefore[i]));
check('real release-review/docs not created', fs.existsSync(path.join(REAL_NOTES, 'release-review', 'docs')) === realDocsBefore);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* leave it */ }
process.exit(fail ? 1 : 0);
