// GEN-674 headroom step: cross-reference check for the rule moves.
// 1. Every phrase another file quotes from the global CLAUDE.md (a quoted phrase near "global rule",
//    "standing rule", "global CLAUDE.md" etc.) that resolves in the live global file must still resolve
//    in the new one. Phrases that already fail to resolve are listed as pre-existing drift.
// 2. Every moved piece of rule text has landed in its new home.
// Usage: node headroom-xref.js <workDir>   (workDir = headroom-build.js output; omit to check live files)
const fs = require('fs');
const path = require('path');
const HOME = process.env.USERPROFILE;
const C = path.join(HOME, '.claude');
const work = process.argv[2];
const liveGlobal = fs.readFileSync(path.join(C, 'CLAUDE.md'), 'utf8');
const pick = (name, live) => work ? fs.readFileSync(path.join(work, name), 'utf8') : fs.readFileSync(live, 'utf8');
const newGlobal = work ? fs.readFileSync(path.join(work, 'CLAUDE.md'), 'utf8') : liveGlobal;
const norm = s => s.replace(/\*\*|`/g, '').replace(/\s+/g, ' ').toLowerCase();
const NG = norm(newGlobal), LG = norm(liveGlobal);
let fails = 0, oks = 0;
const check = (label, cond) => { if (cond) oks++; else { fails++; console.log('FAIL  ' + label); } };

function walk(dir, out) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/^(node_modules|\.git|synced|backups?)$/i.test(e.name)) walk(p, out); }
    else if (/\.(md|js|ps1)$/i.test(e.name)) out.push(p);
  }
  return out;
}
const files = [];
for (const d of ['skills', 'hooks', 'scripts', 'commands', 'agents']) walk(path.join(C, d), files);
for (const proj of fs.readdirSync(path.join(HOME, 'AI Projects'), { withFileTypes: true })) {
  const f = path.join(HOME, 'AI Projects', proj.name, 'CLAUDE.md');
  if (proj.isDirectory() && fs.existsSync(f)) files.push(f);
}
// Read each citing file from the working copy when this change rewrites it.
const workName = {
  [path.join(C, 'skills', 'vet-ticket', 'SKILL.md')]: 'vet-ticket-SKILL.md',
  [path.join(C, 'skills', 'vet-ticket', 'review.md')]: 'vet-ticket-review.md',
  [path.join(C, 'skills', 'check', 'SKILL.md')]: 'check-SKILL.md',
  [path.join(C, 'skills', 'wrap', 'step1-capture.md')]: 'wrap-step1-capture.md',
  [path.join(HOME, 'AI Projects', 'InvoiceAutomation', 'CLAUDE.md')]: 'InvoiceAutomation-CLAUDE.md',
};
const CITE = /(global (?:`?CLAUDE\.md`? )?(?:rules?|"[^"]*" rule)|standing rules?|global `?CLAUDE\.md`?|the rule)[^"\n]{0,60}"([^"\n]{14,220})"/gi;
const drift = [];
for (const f of files) {
  const t = (work && workName[f]) ? fs.readFileSync(path.join(work, workName[f]), 'utf8') : fs.readFileSync(f, 'utf8');
  let m;
  while ((m = CITE.exec(t))) {
    const q = norm(m[2]).replace(/[.,;:]+$/, '');
    const where = path.relative(HOME, f) + ' "' + m[2].slice(0, 60) + '"';
    if (LG.includes(q)) check('still resolves: ' + where, NG.includes(q));
    else if (!NG.includes(q)) drift.push(where);
  }
}

// 2. Moved text landed.
const vtSkill = norm(pick('vet-ticket-SKILL.md', path.join(C, 'skills', 'vet-ticket', 'SKILL.md')));
const vtReview = norm(pick('vet-ticket-review.md', path.join(C, 'skills', 'vet-ticket', 'review.md')));
const checkSkill = norm(pick('check-SKILL.md', path.join(C, 'skills', 'check', 'SKILL.md')));
const landed = [
  ['status mapping in review.md', vtReview, ["including a decision erez hasn't been asked for → backlog", "awaiting erez's own input on a question already put to him", 'decided against → wont do', 'this supplies the value, not the authority', 'honour any project-specific exception', 'not as an override']],
  ['template in vet-ticket SKILL.md', vtSkill, ['applies the template for its type when one exists']],
  ['template in review.md', vtReview, ['check whether a template exists for the ticket\'s type']],
  ['assignee in review.md', vtReview, ['assignee is the authoritative ownership signal']],
  ['routing detail in review.md item 4', vtReview, ["goes under that platform's epic even when claude does the fix", 'genuinely cross-platform issues']],
  ['naming in review.md item 3', vtReview, ['named by outcome']],
  ['drafting style in /check lens', checkSkill, ['where that keeps the meaning without materially adding length', 'safety, scope limits, hard constraints', 'could instead be stated as a qualifier in prose', 'real-world event that prompted the rule', 'distinctive quoted phrase', 'never by position']],
  ['resident ticket rule', NG, ['when creating a ticket, the status you set or propose is the one actually true of it', 'route a ticket by the domain the problem belongs to, not by who fixes it', 'for a follow-up action item, create a ticket', 'assignee is the authoritative ownership signal', '/vet-ticket holds the full detail']],
  ['resident drafting pointer', NG, ['draft the text to the style the /check rule-check lens checks', 'purely mechanical fix — confined to spelling, punctuation, whitespace, or formatting']],
  ['removed from resident file', { includes: x => !NG.includes(x) }, ['askuserquestion (the popup', 'when creating a team-tasks item', 'when drafting or revising a rule']],
  ['review.md contents line', vtReview, ['contents: step 0b']],
];
for (const [label, text, needles] of landed) for (const n of needles) check(label + ' -> "' + n + '"', text.includes(n));

console.log(oks + ' ok, ' + fails + ' fail');
if (drift.length) console.log('Pre-existing drift (quote resolves in neither the old nor the new file):\n  ' + drift.join('\n  '));
process.exit(fails ? 1 : 0);
