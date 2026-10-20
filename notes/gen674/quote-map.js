// GEN-674 Wave 0: find every file outside the global CLAUDE.md that quotes or cites a rule in it.
// Method: for each non-blank rule line, take its opening words (6 and 4 word windows, markdown
// stripped) plus any extra key phrases listed below, and search them case-insensitively across
// ~/.claude/{skills,hooks,scripts,commands,agents}, settings.json and every project CLAUDE.md.
// Usage: node quote-map.js > quote-map.txt
const fs = require('fs');
const path = require('path');
const HOME = process.env.USERPROFILE;
const CLAUDE = path.join(HOME, '.claude');
const RULES = path.join(CLAUDE, 'CLAUDE.md');
const PROJECTS = path.join(HOME, 'AI Projects');

// Extra phrases for rules that are usually cited by a key term, not their opening words.
const EXTRA = {
  31: ['keep a conversation in its thread'],
  45: ['Ticket status (Notion', 'primary ticket of the session'],
  47: ['Before any ticket goes to Done or Review'],
  57: ['the one actually true'],
  59: ['route by domain', 'Route a ticket by the domain'],
  61: ['Name a ticket by the goal'],
  63: ['template exists for its type', 'standing Team-Tasks rule'],
  65: ['Before creating or materially changing a ticket'],
  67: ['One step at a time'],
  73: ['When the user asks a question'],
  75: ['Never chain shell commands'],
  77: ['QA-layer legend', 'Layer 3', 'Layer 5'],
  79: ['Default to silence on success', 'heartbeat'],
  81: ['three buckets', 'Sort anything you are about to tell Erez'],
  83: ['For you" block', 'block-after-check', 'Structure every turn'],
  85: ['tag rule', 'reasoning-effort level'],
  87: ['Surfacing silent project edits', 'auto-approved-edits.jsonl'],
  99: ['When presenting anything to Erez', 'default to acting rather than asking'],
  101: ['plain terms, not by the internal name'],
  103: ['research the publishing surface'],
  107: ['End of session', 'proactively offer'],
  113: ['Before settling on how to obtain a capability'],
  119: ['ask which parts'],
  123: ['clears the bar', 'Before proposing a new rule'],
  125: ['learning worth keeping', 'hook-injected topic ref'],
  127: ['whose output is a signal'],
  129: ['Before adding or editing a rule in a CLAUDE.md', 'purely mechanical fix'],
  131: ['state the behavior to take', 'distinctive quoted phrase'],
  135: ['surface every assumption'],
  139: ['AskUserQuestion'],
  147: ['derive the ID from the known URL'],
  153: ['what you expect to happen AND what you can'],
  161: ['time-varying facts'],
  167: ['uniqueness or exhaustiveness'],
  173: ['standard deploy step', 'When deploying is part of the current task'],
  177: ['API tokens and keys - AI', 'never open the key sheet'],
  181: ['apply learnings'],
  183: ['content the dev team will read'],
  187: ['On-demand reference notes'],
  189: ['notion-duplicate-page'],
  191: ['GEN-58', 'reasoning failure surfaces'],
  195: ['PowerShell & shell gotchas'],
  200: ['are locked', 'update-global-rule.ps1'],
  202: ['environment readout'],
  204: ["Sub-agents (the Agent tool) can't run"],
  206: ['analytics/data questions'],
};

function strip(s) {
  return s.replace(/\*\*|`|^- |^#+ /g, '').replace(/\s+/g, ' ').trim();
}

function walk(dir, out) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (/^(node_modules|\.git|synced|backups?)$/i.test(e.name)) continue;
      walk(p, out);
    } else if (/\.(md|js|ps1|json|txt)$/i.test(e.name)) out.push(p);
  }
  return out;
}

const files = [];
for (const d of ['skills', 'hooks', 'scripts', 'commands', 'agents']) walk(path.join(CLAUDE, d), files);
files.push(path.join(CLAUDE, 'settings.json'));
for (const proj of fs.readdirSync(PROJECTS, { withFileTypes: true })) {
  if (!proj.isDirectory()) continue;
  const f = path.join(PROJECTS, proj.name, 'CLAUDE.md');
  if (fs.existsSync(f)) files.push(f);
}
const texts = files.map(f => {
  let t = '';
  try { t = fs.readFileSync(f, 'utf8'); } catch {}
  return { f, lines: t.split('\n') };
});

const rules = fs.readFileSync(RULES, 'utf8').split('\n');
rules.forEach((raw, i) => {
  const n = i + 1;
  const s = strip(raw);
  if (s.length < 25) return;
  const words = s.split(' ');
  const needles = new Set();
  if (words.length >= 6) needles.add(words.slice(0, 6).join(' '));
  (EXTRA[n] || []).forEach(x => needles.add(x));
  const hits = [];
  for (const { f, lines } of texts) {
    lines.forEach((ln, j) => {
      const L = ln.toLowerCase();
      for (const nd of needles) {
        if (L.includes(nd.toLowerCase())) { hits.push(path.relative(HOME, f) + ':' + (j + 1) + ' [' + nd + ']'); break; }
      }
    });
  }
  console.log('L' + n + ' (' + s.slice(0, 50) + '): ' + (hits.length ? '\n  ' + hits.join('\n  ') : 'none'));
});
