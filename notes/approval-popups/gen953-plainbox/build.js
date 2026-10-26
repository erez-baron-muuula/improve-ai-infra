// Builds the GEN-953 step 1 working copy of pretooluse-effort-tag-gate.js from
// the live hook. Each patch must match exactly once, or the build aborts.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const LIVE = path.join(os.homedir(), '.claude', 'hooks', 'pretooluse-effort-tag-gate.js');
const OUT_DIR = path.join(__dirname, 'wc');
const OUT = path.join(OUT_DIR, 'pretooluse-effort-tag-gate.js');

let s = fs.readFileSync(LIVE, 'utf8');
if (s.indexOf('\r\n') !== -1) throw new Error('live file has CRLF; build expects LF');
fs.writeFileSync(path.join(__dirname, 'live-baseline.js'), s);

function patch(from, to) {
  const n = s.split(from).length - 1;
  if (n !== 1) throw new Error('patch matched ' + n + ' times: ' + from.slice(0, 80));
  s = s.replace(from, () => to);
}

// 1. Header: the new plan check.
patch(
  ' *   - Plan approval: the plan text needs a line like "Effort to execute: xhigh".\n',
  ' *   - Plan approval: the plan text needs a line like "Effort to execute: xhigh".\n' +
  ' *   - Plan approval (GEN-953): the plan opens with a plain-words section for\n' +
  ' *     Erez -- its first section heading after the title names it ("In plain\n' +
  ' *     words (for Erez)", "In plain terms", "How it works for Erez"). Only the\n' +
  ' *     heading is checked; the five things it must say are in the refusal.\n' +
  ' *     A plan missing both gets ONE refusal naming both fixes.\n'
);

// 2. Constants.
patch(
  'const PLAN_EFFORT_HEADING_RE = /^\\s*#{1,6}\\s[^\\n]*\\beffort(?![-\\w])/i;\n',
  'const PLAN_EFFORT_HEADING_RE = /^\\s*#{1,6}\\s[^\\n]*\\beffort(?![-\\w])/i;\n' +
  '\n' +
  '// GEN-953: the heading of a plan\'s plain-words section. Real forms: "In plain\n' +
  '// words (for Erez)", "In plain terms", "Context (plain language)", "How it\n' +
  '// works for Erez". "for Erez\'s OK" / "for Erez to confirm" are not it.\n' +
  'const PLAIN_HEADING_RE = /\\bplain\\b|\\bfor Erez\\b(?![\'\\u2019]s\\b|\\s+to\\b)/i;\n' +
  'const MD_HEADING_RE = /^ {0,3}(#{1,6})[ \\t]+(.+)$/;\n' +
  '// A whole-line bold pseudo-heading counts only when it is itself plain, so\n' +
  '// "**Tickets**" or "**Effort to execute: xhigh**" above the section is ignored.\n' +
  'const BOLD_LINE_RE = /^\\s*\\*\\*(.+?)\\*\\*:?\\s*$/;\n' +
  'const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;\n' +
  'const PLAIN_ASK = \'Put a first section right under the title, headed "## In plain words (for Erez)", that \' +\n' +
  '  \'tells Erez in plain, non-technical words: what changes for him, who is affected, whether it can be \' +\n' +
  '  \'undone, what he must do, and your recommendation. Technical detail goes below it.\';\n'
);

// 3. planOpensPlain, after planHasEffort.
patch(
  'function readPlanText(toolInput) {\n',
  '// true = the first section of the plan (after a "# " title) is a plain-words\n' +
  '// section. Lines inside code fences are ignored. No section at all -> false.\n' +
  'function planOpensPlain(planText) {\n' +
  '  const lines = String(planText).split(/\\r?\\n/);\n' +
  '  let fence = null;\n' +
  '  let titleSeen = false;\n' +
  '  for (let i = 0; i < lines.length; i++) {\n' +
  '    const f = FENCE_RE.exec(lines[i]);\n' +
  '    if (f) {\n' +
  '      if (fence === null) fence = f[1];\n' +
  '      else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;\n' +
  '      continue;\n' +
  '    }\n' +
  '    if (fence !== null) continue;\n' +
  '    const h = MD_HEADING_RE.exec(lines[i]);\n' +
  '    if (h) {\n' +
  '      const plain = PLAIN_HEADING_RE.test(h[2]);\n' +
  '      if (h[1].length === 1 && !titleSeen && !plain) { titleSeen = true; continue; }\n' +
  '      return plain;\n' +
  '    }\n' +
  '    const b = BOLD_LINE_RE.exec(lines[i]);\n' +
  '    if (b && PLAIN_HEADING_RE.test(b[1])) return true;\n' +
  '  }\n' +
  '  return false;\n' +
  '}\n' +
  '\n' +
  'function readPlanText(toolInput) {\n'
);

// 4. planReason: one refusal naming every missing part.
patch(
  'function planReason(guide) {\n' +
  '  return \'Effort-level check (GEN-619): this plan goes to Erez for approval without the effort level needed to \' +\n' +
  '    \'carry it out. Add a line "Effort to execute: <level>" to the plan file (model per the global tag rule), \' +\n' +
  '    \'then call ExitPlanMode again. Pick the level from this guide, not intuition: \' + guide;\n' +
  '}\n',
  'function planReason(missing, guide) {\n' +
  '  const noPlain = missing.indexOf(\'plain\') !== -1;\n' +
  '  const noEffort = missing.indexOf(\'effort\') !== -1;\n' +
  '  const what = noPlain && noEffort ? \'does not open in plain words and has no effort level for carrying it out\'\n' +
  '    : noPlain ? \'does not open in plain words\' : \'has no effort level for carrying it out\';\n' +
  '  const fixes = [];\n' +
  '  if (noPlain) fixes.push(PLAIN_ASK);\n' +
  '  if (noEffort) fixes.push(\'Add a line "Effort to execute: <level>" to the plan file (model per the global tag rule).\');\n' +
  '  return \'Plan check (GEN-619/GEN-953): this plan goes to Erez for approval but \' + what + \'. \' +\n' +
  '    fixes.join(\' \') + \' Then call ExitPlanMode again.\' +\n' +
  '    (noEffort ? \' Pick the level from this guide, not intuition: \' + guide : \'\');\n' +
  '}\n'
);

// 5. decide(): collect what the plan is missing.
patch(
  '  let untagged = [];\n',
  '  let untagged = [];\n' +
  '  const planMissing = [];\n'
);
patch(
  '    missing = !planHasEffort(text);\n' +
  '    reason = () => planReason(shared.guide());\n',
  '    if (!planHasEffort(text)) planMissing.push(\'effort\');\n' +
  '    if (!planOpensPlain(text)) planMissing.push(\'plain\');\n' +
  '    missing = planMissing.length > 0;\n' +
  '    reason = () => planReason(planMissing, shared.guide());\n'
);
patch(
  '  const short = untagged.map((l) => l.slice(0, 40));\n',
  '  const short = untagged.map((l) => l.slice(0, 40));\n' +
  '  const why = tool === PLAN_TOOL ? { missing: planMissing } : {};\n'
);
patch(
  "    log(Object.assign({ outcome: 'passed-after-deny', untagged: short }, base));\n",
  "    log(Object.assign({ outcome: 'passed-after-deny', untagged: short }, why, base));\n"
);
patch(
  "  log(Object.assign({ outcome: 'blocked', untagged: short }, base));\n",
  "  log(Object.assign({ outcome: 'blocked', untagged: short }, why, base));\n"
);

// 6. Exports.
patch(
  '  planHasEffort: planHasEffort,\n',
  '  planHasEffort: planHasEffort,\n' +
  '  planOpensPlain: planOpensPlain,\n' +
  '  planReason: planReason,\n'
);
patch(
  '  PLAN_EFFORT_HEADING_RE: PLAN_EFFORT_HEADING_RE,\n',
  '  PLAN_EFFORT_HEADING_RE: PLAN_EFFORT_HEADING_RE,\n' +
  '  PLAIN_HEADING_RE: PLAIN_HEADING_RE,\n'
);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, s);
console.log('wrote ' + OUT + ' (' + s.length + ' chars)');
