# GEN-557 — self-audit detector widening: measurement rig & findings

Banked 2026-07-30 when the session stopped mid-flow. Everything needed to resume is
here or in GEN-557's Notion body. The live scratchpad copies (session
`75c79316-1b51-43a4-8b25-25b6771c99ec`) are temporary — treat this file as canonical.

**Ticket:** GEN-557 "Widen the GEN-507 self-audit detector to catch
verification-walkthrough narration" — https://app.notion.com/p/3a66e495d07c8108a684e31a824b8eb3

**Target file:** `~/.claude/hooks/stop-claim-linter.js` (vetting-locked → `/vet-code`).
Baseline at time of measurement: 801 lines, 47,164 bytes, LF, 10 `SELF_AUDIT_PATTERNS`.

---

## Status when banked

Design is **not** final. Steps 0–2 of `/vet-code` are done; Step 1's `/check` panel ran
and returned **REVISE** with three findings still to address (below). Step 3 (two code
reviews) has not run.

### Blocker for Step 3
`/code-review` is configured `disable-model-invocation` — Claude **cannot** invoke it in
any session; only Erez can, by typing `/code-review`. `/vet-code` Step 0 fails closed
without it. This is a sharper diagnosis than GEN-546 ("cannot run from a desktop
session") records — it is not desktop-specific.

### Outstanding panel findings (must fix before Step 3)
1. **`nothing to (correct|fix)` under-validated.** It drives ~all new fires but only 4 of
   120 hits were inspected. Sample far more, and/or anchor it to the *closing* position
   the ticket actually describes, and/or gate it like the `needsClean` patterns.
2. **Ticket shape (a) has no durable coverage.** The "done, verified / filed, verified"
   roll-call lost both v1 candidates (dropped for false fires) and nothing replaced them.
   Only `✓ closed` remains — a decorative tick that appeared just twice in 4,580 turns.
   Suggested fix: anchor to a bulleted line, e.g.
   `/^[ \t]*[-*]\s.*\b(?:done|filed|shipped|applied|resolved)[,;]\s*(?:and\s+)?verified\b/im`,
   or require 2+ occurrences in one message (a real roll-call signature that a single
   required status line cannot produce).
3. **`isQuoted` scope.** As drafted it applies to all 10 pre-existing patterns, which is
   wider than "widen the patterns". It is justified by removing 6 measured false fires,
   but the false-NEGATIVE direction was never measured (an unrelated odd `"` or backtick
   on a line silences a genuine hit there). Either scope it to the 5 new patterns, or get
   Erez's explicit sign-off that changing shipped patterns is intended — and add a corpus
   check for wrongly-suppressed hits.

---

## Findings that are settled (do not re-derive)

### The corpus
4,580 real turn-final assistant messages, rebuilt from 170 on-disk transcripts under
`~/.claude/projects/`. These are the actual `last_assistant_message` values the Stop hook
receives: the final assistant text block before each genuine user turn, excluding
`isSidechain` lines and `user` lines carrying a `tool_result`. 0 unparsable lines.
Regenerate with `extract.js` below.

### Numbers (all from real traffic, not fixtures)
| | naive (detector called directly) | production (Phase-2 short-circuit applied) |
|---|---|---|
| current patterns fire on | 161 turns (3.52%) | **77** |
| GEN-557 v2 adds | 120 | **113** (7 phantom) |

### The "For you" blind spot — real, but smaller than it first looks
`stop-claim-linter.js` lines 615–678: when a message carries a "📌 For you" block opener,
**every** branch of the Phase-2 guard `process.exit(0)`s before Phase 1 reaches
`findSelfAudit` (line 689). So the self-audit detector never runs on **1,844 of 4,580
turns (40.3%)**.
- `findSelfAudit`'s own header comment (lines ~389–395) still claims it flags block-internal
  self-audit "wherever it appears, INCLUDING inside a 'For you' block". **That is stale** —
  it stopped being true when the Arm-2 content gate was removed (GEN-467 v2.2, 2026-07-26).
  The comment should be corrected.
- Cost is modest: only 87 of those 1,844 turns would have fired at all, and every sampled
  one would have been a FALSE nudge (e.g. "I checked the actual query", "I verified in the
  code that the retry queue has no limit" — substantive findings, correctly reported).
- **Do not claim this blind spot explains the recurrence GEN-507/GEN-557 track.** That
  claim was made in-session before measuring and does not hold.

### v1 was rejected — three confirmed false-fire classes (keep these as regression cases)
v1 additionally had bare `/\bexhaustiveness claim\b/i` and
`/\b(?:done|filed|shipped|applied|resolved)[,;]\s*(?:and\s+)?verified\b/i` (needsClean),
and no quote guard. 156 new fires, including:
1. **Meta-discussion / quoting.** It fired on this session's own message to Erez purely
   because that message quoted `done, verified ✓ closed` and `nothing to correct` while
   *explaining the ticket*. Structurally the same failure GEN-467 shipped twice.
2. **`applied, verified` inside a required status report** — "the line-79 fix is applied,
   verified, and synced."
3. **`exhaustiveness claim` inside a permitted self-correction announcement** — "I'll
   tighten the wording so it can't be read as an unqualified exhaustiveness claim."

### v2 acceptance (passes, but on a design that still needs the 3 fixes)
- Ticket's verbatim must-FIRE fixture: **fires** (5 hits) where the live hook gives zero.
- Ticket's must-STAY-SILENT counter-example: **silent**.
- The quoting-while-explaining text: **silent**.
- Quote guard also suppresses 6 of the 161 baseline fires — all 6 inspected, all false.
- `node --check` passes.

---

## Scripts

`build557b.js` regenerates the working copy deterministically from the live hook, so the
working copy itself does not need banking. Run `extract.js` first (writes `corpus.jsonl`
next to itself), then the others. All expect to sit in the same directory.

### extract.js — corpus builder (the part worth keeping)
```js
const fs = require('fs');
const path = require('path');
const ROOT = 'C:\\Users\\Erez\\.claude\\projects';
const OUT = path.join(path.dirname(process.argv[1]), 'corpus.jsonl');

function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'subagents') walk(p, acc); }
    else if (e.name.endsWith('.jsonl')) acc.push(p);
  }
  return acc;
}
function isRealUserTurn(o) {
  if (o.type !== 'user' || o.isSidechain) return false;
  const c = o.message && o.message.content;
  if (typeof c === 'string') return c.length > 0;
  if (Array.isArray(c)) return !c.some(b => b && b.type === 'tool_result');
  return false;
}
function assistantText(o) {
  const c = o.message && o.message.content;
  if (!Array.isArray(c)) return null;
  const parts = c.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text);
  return parts.length ? parts.join('\n') : null;
}
const files = walk(ROOT, []);
const out = fs.createWriteStream(OUT);
let turns = 0, skipped = 0;
for (const f of files) {
  let lines;
  try { lines = fs.readFileSync(f, 'utf8').split('\n'); } catch { continue; }
  let pending = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { skipped++; continue; }
    if (o.isSidechain) continue;
    if (o.type === 'assistant') { const t = assistantText(o); if (t !== null) pending = t; }
    else if (isRealUserTurn(o)) {
      if (pending !== null) { out.write(JSON.stringify({ f: path.basename(f), t: pending }) + '\n'); turns++; }
      pending = null;
    }
  }
  if (pending !== null) { out.write(JSON.stringify({ f: path.basename(f), t: pending }) + '\n'); turns++; }
}
out.end();
console.log('files=' + files.length + ' turns=' + turns + ' unparsable=' + skipped);
```

### Loading the live detector verbatim (used by every measuring script)
Do **not** reimplement `findSelfAudit` — slice it out of the hook so the numbers reflect
shipped logic:
```js
const START = 'const SELF_AUDIT_PATTERNS = [';
const END = '// Durable, append-only log of self-audit detections';
function load(file) {
  const s = require('fs').readFileSync(file, 'utf8');
  return new Function(s.slice(s.indexOf(START), s.indexOf(END)) + '\n; return findSelfAudit;')();
}
```
`measure.js` counts fires for a hook file, with `--only-new <baselineHook>` to attribute
new fires. `attribute.js` re-implements the per-pattern gating (window 140, `needsClean`,
`selfAuditCleared`) to report per-pattern new-fire counts and samples. `reachability.js`
additionally slices `BLOCK_OPENER_RE` + `stripFences` out of the hook and splits results
into reachable vs block-carrying. `blindspot.js` counts, among block-carrying turns, how
many the patterns would have flagged. Each is ~30–60 lines of counting; rewrite from the
loader above if lost.

### v2 candidate patterns (appended to `SELF_AUDIT_PATTERNS`)
```js
{ re: /\u2713\s*closed\b/i },
{ re: /\bthat'?s the complete set\b/i },
{ re: /\bholds as written\b/i },
{ re: /\bexhaustiveness claim\b[^.\n]{0,80}?\b(?:holds|stands|is accurate|checks out|survives)\b/i },
{ re: /\bnothing to (?:correct|fix)\b/i },
```

### v2 quote guard — called FIRST in `findSelfAudit`'s match loop
`if (isQuoted(text, m.index)) continue;` inserted immediately before
`const vicinity = ...` / `selfAuditCleared(...)`.
```js
function isQuoted(text, at) {
  const lineStart = text.lastIndexOf('\n', at - 1) + 1;
  const before = text.slice(lineStart, at);
  const straight = (before.match(/"/g) || []).length;
  const ticks = (before.match(/`/g) || []).length;
  const smart = (before.match(/\u201C/g) || []).length - (before.match(/\u201D/g) || []).length;
  return (straight % 2 === 1) || (ticks % 2 === 1) || smart > 0;
}
```
Known limits (disclosed, judged acceptable): per-line parity only, so multi-line quoted
blocks and ``` fences are not covered (the file already has a `stripFences()` helper that
could be reused); single-quoted spans are not covered.

### Acceptance fixtures — must keep passing
- **must FIRE:** GEN-557's verbatim trigger text (the enumerated `— done, verified. ✓ closed`
  roll-call ending `…the exhaustiveness claim holds as written. Nothing to correct.`).
  Confirmed NOT block-carrying, so Phase 1 really reaches it.
- **must STAY SILENT:** `GEN-537 is in Review; I set GEN-554 to Done after verifying the
  schema change landed. Both are now reflected in the tracker.`
- **must STAY SILENT:** any message that merely *quotes* the trigger phrases while
  explaining them.

---

## Also worth knowing
- `/vet-code` Step 4 gained an **input-realism** requirement this session (GEN-566, shipped
  and verified): a guard/detector's live-fire must use real production traffic, report
  counts in the Step 5 attestation, and treat any false fire on real input as a FAIL.
  This rig is what satisfies it for GEN-557 — and it is what caught v1's false fires.
- GEN-575 is real and hit twice here: the copy/move guard blocks any shell `cp` whose
  command text merely mentions a `.js` file or the word `scripts`, even when the
  destination is an ordinary project folder. Use the Write tool instead.
