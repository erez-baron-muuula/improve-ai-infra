// GEN-893 / GEN-926 tests for config-health-scan.ps1: size-check's sizeLines and the command class.
// Drives the real script (working copy by default, or argv[2]) on a fixture tree, and compares the
// findings with the live baseline script on the same inputs (findings must not change).
// Usage: node size-lines-test.js [script.ps1]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const SCRIPT = process.argv[2] || path.join(HERE, 'wc', 'config-health-scan.ps1');
const BASELINE = path.join(HERE, 'wc', 'config-health-scan.live-baseline.ps1');
const GUIDE = 'C:/Users/Erez/AI Projects/Improve AI Infra/notes/anthropic-guidelines.json';
const ARROW = String.fromCharCode(0x2192);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gen893-fx-'));
const D = {
  skills: path.join(root, 'skills'), commands: path.join(root, 'commands'), hooks: path.join(root, 'hooks'),
  projects: path.join(root, 'projects'), aiProjects: path.join(root, 'ai'), drafts: path.join(root, 'drafts'),
};
for (const d of Object.values(D)) fs.mkdirSync(d, { recursive: true });
const globalClaude = path.join(root, 'CLAUDE.md');
function put(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, 'utf8'); return p; }
const lines = n => Array.from({ length: n }, (_, i) => 'line ' + i).join('\n') + '\n';

// fixtures
const vetRule = put(path.join(D.skills, 'vet-rule', 'SKILL.md'), '---\nname: vet-rule\ndescription: "Short gate skill."\n---\n\n# Body\n' + lines(20));
const vetRuleDraft = put(path.join(D.drafts, 'vet-rule-SKILL.md'), '---\nname: vet-rule\ndescription: "Short gate skill, a bit longer."\n---\n\n# Body\n' + lines(25));
const bigSkill = put(path.join(D.skills, 'big', 'SKILL.md'), '---\nname: big\ndescription: plain text\n---\n' + lines(600));
const refNoToc = put(path.join(D.skills, 'big', 'ref.md'), '# Ref\n' + lines(150));
const refToc = put(path.join(D.skills, 'big', 'ref2.md'), '# Ref\n**Contents:** a, b\n' + lines(20));
const cmdOk = put(path.join(D.commands, 'ok.md'), '---\ndescription: Log the session.\n---\nBody\n');
const cmdBig = put(path.join(D.commands, 'big.md'), '---\ndescription: "' + 'x'.repeat(1600) + '"\n---\nBody\n');
const cmdManual = put(path.join(D.commands, 'manual.md'), '---\ndescription: "' + 'y'.repeat(1600) + '"\ndisable-model-invocation: true\n---\nBody\n');
const cmdNoFm = put(path.join(D.commands, 'nofm.md'), 'Just a body, no frontmatter.\n');
const cmdNoDesc = put(path.join(D.commands, 'nodesc.md'), '---\nargument-hint: x\n---\nBody\n');
const hookRef = put(path.join(D.hooks, 'refs', 'notes.md'), 'x'.repeat(9500) + '\n');
const memory = put(path.join(D.projects, 'p1', 'memory', 'MEMORY.md'), '- a\n- b\n');
put(globalClaude, lines(210));
const noLimit = put(path.join(D.drafts, 'plain.txt'), 'hello\n');

function run(script, args) {
  const base = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-GuidelinesFile', GUIDE, '-SkillsDir', D.skills, '-CommandsDir', D.commands, '-HooksDir', D.hooks,
    '-ClaudeProjectsDir', D.projects, '-ProjectsRoot', D.aiProjects, '-GlobalClaude', globalClaude];
  const r = spawnSync('powershell.exe', base.concat(args), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try { return JSON.parse(r.stdout); } catch (e) { return { parseError: String(e), stdout: r.stdout, stderr: r.stderr }; }
}
function runBase(script, args) {
  // the baseline has no -CommandsDir parameter
  const base = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-GuidelinesFile', GUIDE, '-SkillsDir', D.skills, '-HooksDir', D.hooks,
    '-ClaudeProjectsDir', D.projects, '-ProjectsRoot', D.aiProjects, '-GlobalClaude', globalClaude];
  const r = spawnSync('powershell.exe', base.concat(args), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try { return JSON.parse(r.stdout); } catch (e) { return { parseError: String(e), stdout: r.stdout, stderr: r.stderr }; }
}

let pass = 0, fail = 0;
function ok(name, cond, info) { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name + (info ? ' :: ' + JSON.stringify(info).slice(0, 900) : '')); } }
const sl = r => (r && r.sizeLines) ? [].concat(r.sizeLines) : [];
const has = (arr, re) => arr.some(l => re.test(l));

// 1. gate skill, draft vs existing real file: five lines, each now -> proposed
let r = run(SCRIPT, ['-Action', 'size-check', '-Target', vetRuleDraft, '-AsIfPath', vetRule]);
let L = sl(r);
ok('gate skill: 5 lines', L.length === 5, L);
ok('gate skill: every line has an arrow', L.every(l => l.includes(ARROW)), L);
ok('gate skill: runbook cap labelled house', has(L, /\/ 12,000 characters \(house; gate-skill-runbook\)$/), L);
ok('gate skill: compaction in tokens, hard', has(L, /\/ 5,000 tokens \(hard; skill-after-compaction\)$/), L);
ok('gate skill: body lines recommended', has(L, /\/ 500 body lines \(recommended; skill-md-lines\)$/), L);
ok('gate skill: portable note tag', has(L, /\/ 1,024 characters \(recommended, note; skill-description-portable\)$/), L);
ok('gate skill: listing cap', has(L, /\/ 1,536 characters \(hard; skill-description-listing\)$/), L);
const realBody = 21, draftBody = 26; // "# Body" + n lines
ok('gate skill: body line values now -> proposed', has(L, new RegExp(' ' + realBody + ' ' + ARROW + ' ' + draftBody + ' / 500 body lines')), L);
ok('gate skill: description 17 -> 31', has(L, new RegExp(' 17 ' + ARROW + ' 31 / 1,024')), L);
ok('gate skill: no findings (far from limits)', (r.findings || []).length === 0, r.findings);

// 2. new file
const newPath = path.join(D.skills, 'newskill', 'SKILL.md');
r = run(SCRIPT, ['-Action', 'size-check', '-Target', vetRuleDraft, '-AsIfPath', newPath]);
L = sl(r);
ok('new file: 4 lines (not a gate skill)', L.length === 4, L);
ok('new file: every line "new ->"', L.every(l => l.includes(' new ' + ARROW + ' ')), L);

// 3. over-limit skill, same file (no -AsIfPath): no arrow, breach still in findings
r = run(SCRIPT, ['-Action', 'size-check', '-Target', bigSkill]);
L = sl(r);
ok('over-limit: no arrow without a separate real file', L.length > 0 && L.every(l => !l.includes(ARROW)), L);
ok('over-limit: 600 body lines line', has(L, / 600 \/ 500 body lines/), L);
ok('over-limit: breach finding kept', (r.lines || []).some(l => /^BREACH recommended skill-md-lines/.test(l)), r.lines);

// 4. reference files: lines plus contents heading yes/no
r = run(SCRIPT, ['-Action', 'size-check', '-Target', refNoToc]);
L = sl(r);
ok('ref no toc: one line, contents heading no', L.length === 1 && /contents heading: no\)$/.test(L[0]), L);
ok('ref no toc: breach finding kept', (r.lines || []).some(l => /^BREACH recommended reference-file-toc/.test(l)), r.lines);
r = run(SCRIPT, ['-Action', 'size-check', '-Target', refToc]);
L = sl(r);
ok('ref with toc: contents heading yes', L.length === 1 && /contents heading: yes\)$/.test(L[0]), L);

// 5. commands (GEN-926)
r = run(SCRIPT, ['-Action', 'size-check', '-Target', cmdOk]);
L = sl(r);
ok('command ok: class command', r.class === 'command', r.class);
ok('command ok: 2 lines', L.length === 2 && has(L, /1,536 characters/) && has(L, /1,024 characters/), L);
r = run(SCRIPT, ['-Action', 'size-check', '-Target', cmdBig]);
ok('command 1,600 chars: breach', (r.lines || []).some(l => /^BREACH hard skill-description-listing .* 1,600 characters/.test(l)), r.lines);
r = run(SCRIPT, ['-Action', 'size-check', '-Target', cmdManual]);
L = sl(r);
ok('command disable-model-invocation: skipped, no breach', L.length === 1 && /^size: skipped \(.*disable-model-invocation/.test(L[0]) && (r.findings || []).length === 0, { L, f: r.findings });
r = run(SCRIPT, ['-Action', 'size-check', '-Target', cmdNoFm]);
L = sl(r);
ok('command no frontmatter: note, not measured', L.length === 1 && /not measured: description not in frontmatter/.test(L[0]), L);
r = run(SCRIPT, ['-Action', 'size-check', '-Target', cmdNoDesc]);
L = sl(r);
ok('command no description: note', L.length === 1 && /not measured: description not in frontmatter/.test(L[0]), L);

const cmdEmpty = put(path.join(D.drafts, 'empty-desc.md'), '---\ndescription: ""\n---\nBody\n');
r = run(SCRIPT, ['-Action', 'size-check', '-Target', cmdEmpty, '-AsIfPath', path.join(D.commands, 'newcmd.md')]);
L = sl(r);
ok('command empty description: note', L.length === 1 && /not measured: description not in frontmatter/.test(L[0]), L);
r = run(SCRIPT, ['-Action', 'size-check', '-Target', cmdNoFm, '-AsIfPath', cmdOk]);
L = sl(r);
ok('draft drops description: old value still shown', has(L, new RegExp(' 16 ' + ARROW + ' not measured / 1,536 characters')) && has(L, /not measured: description not in frontmatter/), L);

// 6. other classes
r = run(SCRIPT, ['-Action', 'size-check', '-Target', hookRef]);
L = sl(r);
ok('hook ref: one line 9,501 / 10,000', L.length === 1 && / 9,501 \/ 10,000 characters \(hard; hook-injected-text\)$/.test(L[0]), L);
ok('hook ref: near finding kept', (r.lines || []).some(l => /^NEAR hard hook-injected-text/.test(l)), r.lines);
r = run(SCRIPT, ['-Action', 'size-check', '-Target', memory]);
L = sl(r);
ok('memory: lines and bytes', L.length === 2 && has(L, / 2 \/ 200 lines/) && has(L, / 8 \/ 25,000 bytes/), L);
r = run(SCRIPT, ['-Action', 'size-check', '-Target', globalClaude]);
L = sl(r);
ok('global CLAUDE.md: one lines line', L.length === 1 && / 210 \/ 200 lines \(recommended; claude-md-lines\)$/.test(L[0]), L);
r = run(SCRIPT, ['-Action', 'size-check', '-Target', noLimit]);
L = sl(r);
ok('no-limit file: skipped line', L.length === 1 && /^size: skipped \(no size limits apply to /.test(L[0]), L);

// 7. sweep: commands included; everything else identical to the baseline
const sNew = run(SCRIPT, ['-Action', 'size-sweep']);
const sOld = runBase(BASELINE, ['-Action', 'size-sweep']);
const isCmd = f => /[\\/]commands[\\/]/i.test(f.file || '');
const strip = arr => JSON.stringify((arr || []).filter(f => !isCmd(f)).map(f => f.line));
ok('sweep: command breach listed', (sNew.findings || []).some(f => isCmd(f) && /big\.md/.test(f.file) && f.severity === 'breach'), sNew.lines);
ok('sweep: no-frontmatter command note listed', (sNew.findings || []).some(f => isCmd(f) && /nofm\.md/.test(f.file) && f.severity === 'note'), sNew.lines);
ok('sweep: non-command findings identical to baseline', strip(sNew.findings) === strip(sOld.findings), { n: sNew.lines, o: sOld.lines });
ok('sweep: filesMeasured = baseline + 5 commands', sNew.counts && sOld.counts && sNew.counts.filesMeasured === sOld.counts.filesMeasured + 5, { n: sNew.counts, o: sOld.counts });
ok('sweep: no sizeLines / measurements in output', !('sizeLines' in sNew) && !('measurements' in sNew), Object.keys(sNew));

// 8. size-check findings identical to the baseline on non-command files
for (const [name, t, a] of [['gate draft', vetRuleDraft, vetRule], ['big skill', bigSkill, null], ['ref', refNoToc, null], ['hook ref', hookRef, null], ['memory', memory, null], ['global', globalClaude, null]]) {
  const args = ['-Action', 'size-check', '-Target', t].concat(a ? ['-AsIfPath', a] : []);
  const n = run(SCRIPT, args), o = runBase(BASELINE, args);
  ok('size-check findings unchanged: ' + name, JSON.stringify(n.findings) === JSON.stringify(o.findings) && JSON.stringify(n.lines) === JSON.stringify(o.lines) && JSON.stringify(n.counts) === JSON.stringify(o.counts), { n: n.lines, o: o.lines });
}

// 9. scan action: sizeFindings identical to the baseline
for (const t of [globalClaude, bigSkill]) {
  const n = run(SCRIPT, ['-Action', 'scan', '-Target', t]), o = runBase(BASELINE, ['-Action', 'scan', '-Target', t]);
  ok('scan sizeFindings unchanged: ' + path.basename(path.dirname(t)) + '/' + path.basename(t), JSON.stringify(n.sizeFindings) === JSON.stringify(o.sizeFindings) && n.sizeCheckError === o.sizeCheckError, { n: n.sizeFindings, o: o.sizeFindings, ne: n.parseError || n.sizeCheckError });
}

fs.rmSync(root, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
