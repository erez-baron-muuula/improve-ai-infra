// GEN-467 verification re-scan
const fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/Erez/.claude/projects';
const CUTOFF = new Date('2026-07-19T00:00:00Z');
const V22 = new Date('2026-07-26T00:00:00Z');
// Tolerant marker from the task brief (used only for reporting the loose count).
const LOOSE = /\u{1F4CC}\s*\*{0,2}\s*For you/u;
// The guard's own opener test, plus the "## <pin> For you" heading form the guard
// does not recognise. Line-start anchored + fence-stripped => excludes the
// quoted/discussed markers that dominate this project's transcripts.
const OPENER = /^[ \t]{0,3}#{0,4}[ \t]*\*{0,2}\u{1F4CC}[ \t]*\*{0,2}[ \t]*For you/imu;
const stripFences = t => t.replace(/```[\s\S]*?(?:```|$)/g, '');
const MARKER = { test: t => OPENER.test(stripFences(t || '')) };

let files = [];
for (const r of fs.readdirSync(ROOT)) {
  const rp = path.join(ROOT, r);
  if (!fs.statSync(rp).isDirectory()) continue;
  for (const f of fs.readdirSync(rp)) {
    if (!f.endsWith('.jsonl')) continue;
    const p = path.join(rp, f);
    if (fs.statSync(p).mtime > CUTOFF) files.push(p);
  }
}

function textOf(o) {
  const c = o.message && o.message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(x => (x.type === 'text' ? x.text : '')).join('\n');
  return '';
}
function toolsOf(o) {
  const c = o.message && o.message.content;
  if (!Array.isArray(c)) return [];
  return c.filter(x => x.type === 'tool_use').map(x => x.name);
}
function isToolResult(o) {
  const c = o.message && o.message.content;
  return Array.isArray(c) && c.some(x => x.type === 'tool_result');
}
// A real user prompt = turn boundary
function isRealPrompt(o) {
  if (o.type !== 'user') return false;
  if (o.isMeta) return false;
  if (isToolResult(o)) return false;
  const t = textOf(o);
  if (!t) return false;
  if (t.startsWith('<local-command-stdout>')) return false;
  if (t.trim() === '[Request interrupted by user]') return false;
  return true;
}

const MUTATORS = /^(Edit|Write|NotebookEdit|Bash|PowerShell)$|update-page|create-pages|update-data-source|move-pages|duplicate-page|create-comment|editJiraIssue|createJiraIssue|transitionJiraIssue|updateConfluencePage|createConfluencePage|slack_send|send_message|create_event|update_event|create_scheduled_task|update_scheduled_task/;

const results = { dup: [], missing: [], conventionMiss: [], correctPath: [], linterTurns: [], totalTurns: 0, blockTurns: 0 };

for (const p of files) {
  let lines;
  try { lines = fs.readFileSync(p, 'utf8').split('\n'); } catch (e) { continue; }
  const entries = [];
  for (const l of lines) { if (!l) continue; try { entries.push(JSON.parse(l)); } catch (e) {} }

  let turn = null;
  const turns = [];
  for (const o of entries) {
    if (isRealPrompt(o)) {
      turn = { file: p, prompt: textOf(o).slice(0, 200), ts: o.timestamp, items: [] };
      turns.push(turn);
      continue;
    }
    if (!turn) continue;
    if (o.type === 'assistant') {
      const t = textOf(o);
      turn.items.push({ kind: 'asst', ts: o.timestamp, marker: MARKER.test(t), text: t, tools: toolsOf(o), uuid: o.uuid });
    } else if (o.type === 'user' && o.isMeta) {
      turn.items.push({ kind: 'meta', ts: o.timestamp, text: textOf(o) });
    } else if (o.type === 'user' && isToolResult(o)) {
      turn.items.push({ kind: 'tres', ts: o.timestamp });
    } else if (o.type === 'attachment') {
      turn.items.push({ kind: 'attach', ts: o.timestamp, text: JSON.stringify(o) });
    }
  }

  for (const t of turns) {
    results.totalTurns++;
    const asstMarked = t.items.filter(i => i.kind === 'asst' && i.marker);
    const mutated = t.items.some(i => i.kind === 'asst' && i.tools.some(n => MUTATORS.test(n)));
    const anyTool = t.items.some(i => i.kind === 'asst' && i.tools.length);
    // hook feedback entries within the turn
    const hookIdx = t.items.map((i, ix) => ({ i, ix }))
      .filter(({ i }) => (i.kind === 'meta' || i.kind === 'attach') &&
        /Stop hook feedback|For-you check, automatic|Claim-linter, automatic|Self-audit, automatic|For-you guard, automatic|Claim-check \(GEN-450/.test(i.text || ''))
      .map(({ ix }) => ix);
    const linterFired = t.items.some(i => /Claim-linter, automatic|Claim-check \(GEN-450/.test(i.text || ''));

    if (asstMarked.length) results.blockTurns++;
    if (asstMarked.length >= 2) {
      results.dup.push({ file: t.file, ts: t.ts, prompt: t.prompt, n: asstMarked.length,
        excerpts: asstMarked.map(m => ({ ts: m.ts, uuid: m.uuid, snip: m.text.slice(Math.max(0, m.text.search(LOOSE) - 200), m.text.search(LOOSE) + 400) })) });
    }
    if (asstMarked.length === 1) {
      const mi = t.items.indexOf(asstMarked[0]);
      const hookBefore = hookIdx.some(ix => ix < mi);
      if (hookBefore) results.correctPath.push({ file: t.file, ts: t.ts, linterFired });
      else results.conventionMiss.push({ file: t.file, ts: t.ts, prompt: t.prompt });
    }
    if (asstMarked.length === 0 && mutated) {
      results.missing.push({ file: t.file, ts: t.ts, prompt: t.prompt,
        tools: [...new Set(t.items.flatMap(i => i.tools || []))].slice(0, 12),
        lastAsst: (t.items.filter(i => i.kind === 'asst' && i.text).slice(-1)[0] || {}).text?.slice(0, 500) || '' });
    }
    if (linterFired) {
      const mi = asstMarked.length ? t.items.indexOf(asstMarked[0]) : -1;
      const li = t.items.findIndex(i => /Claim-linter, automatic|Claim-check \(GEN-450/.test(i.text || ''));
      results.linterTurns.push({ file: t.file, ts: t.ts, hasBlock: asstMarked.length, blockAfterLinter: mi > li,
        blockText: mi >= 0 ? t.items[mi].text.slice(t.items[mi].text.search(LOOSE) - 50 < 0 ? 0 : t.items[mi].text.search(LOOSE) - 50, t.items[mi].text.search(LOOSE) + 1800) : '' });
    }
  }
}

const out = {
  filesScanned: files.length,
  totalTurns: results.totalTurns,
  turnsWithBlock: results.blockTurns,
  duplicates: results.dup.length,
  conventionMisses: results.conventionMiss.length,
  correctPath: results.correctPath.length,
  missingCandidates: results.missing.length,
  linterTurns: results.linterTurns.length,
};
console.log(JSON.stringify(out, null, 2));
fs.writeFileSync(process.argv[2] || 'scan-out.json', JSON.stringify(results, null, 2));
