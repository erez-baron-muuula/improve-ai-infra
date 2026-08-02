# GEN-557 — self-audit detector widening: measurement rig & findings

**Ticket:** GEN-557 "Widen the GEN-507 self-audit detector to catch
verification-walkthrough narration" — https://app.notion.com/p/3a66e495d07c8108a684e31a824b8eb3

**Target file:** `~/.claude/hooks/stop-claim-linter.js` (vetting-locked → `/vet-code`).
Baseline when last measured: 801 lines, 47,164 bytes on disk, LF, 10 `SELF_AUDIT_PATTERNS`.

**The rig now lives beside this file in `rig/`** (git-tracked, 18 files). The 2026-07-30
session banked only this README and the scripts were lost, costing a full rebuild on
2026-08-02 — hence banking them. Only `corpus.jsonl` (6.6 MB of real transcript text)
and the derived dumps are excluded; regenerate with `rig/extract.js`.

---

## Status (updated 2026-08-02)

`/vet-code` Steps 0–2 done. **Step 1's design panel has now CONVERGED** (2 rounds): the
three findings the 2026-07-30 panel left open are all resolved, and the round-2 verdict
was PASS on every lens. The working copy is built, syntax-clean, and passes acceptance
both as a sliced detector and as a real hook process.

The one design decision that was Erez's — the quote guard's scope — is **settled** (see
"Quote-guard scope" below): he chose all 16 patterns on 2026-08-02, and the working copy
is built that way.

**One thing stands between here and done: `/code-review` must be typed by Erez.** It is
configured `disable-model-invocation`, so **Claude cannot invoke it in any session** — not
a desktop-only limitation, which is a sharper diagnosis than **GEN-546** records.
`/vet-code` Step 0 fails closed without it. Remaining sequence: Erez types `/code-review`
(Pass A) → Pass B independent sub-agent → Step 4 → Step 5 attestation → mint the
single-use vetting pass → apply → verify.

**What Pass A should be pointed at.** `~/.claude/hooks/` is NOT a git repo, so there is no
working-tree diff for the live hook. The reviewable delta is banked as
`rig/proposed.diff` (96 lines, live → working), with the full proposed file at
`rig/working.js`. Both sit untracked in the Improve AI Infra tree, so a working-diff
review can see them.

---

## The three 2026-07-30 findings — all resolved 2026-08-02

**1. `nothing to (correct|fix)` was validated on 4 of ~120 hits. RESOLVED by full
inspection.** Every one of the **125** reachable, unquoted instances in the corpus was
read individually (`rig/f1.js` + `rig/f1dump.js`). **125/125 were the target class** — a
post-nudge clean-audit recital addressed to Erez, e.g. "…all sourced this turn. Nothing to
correct." **Zero false.** So the pattern is deliberately NOT position-anchored and NOT
`needsClean`-gated: both were considered and measured as unnecessary, not skipped.

**2. Ticket shape (a) — the "done, verified" roll-call — had no durable coverage.
RESOLVED with a 2-line signature.** The panel's suggested one-bullet-line anchor was
built and **measured and rejected**: it fires on 2 turns, one of which is a legitimate
"where things stand" status report (`- **GEN-550 — shipped, verified, Done.**`, corpus
t2553). Requiring **two** such bulleted lines within 400 chars is the roll-call signature
a single required status line cannot produce: it fires on **exactly 1 of 2,585** reachable
real turns — the recurrence this ticket was filed for — and passes all five fixtures.
ReDoS probe: 200k-char adversarial near-miss input, ~5 ms (`rig/v3.js`).

**3. `isQuoted` scope was wider than the ticket, and its false-negative direction was
unmeasured. Measurement done; scope decision is Erez's.** Applied to the shipped patterns
in isolation the guard changes 6 turns and fully silences 4 — **all 4 inspected, all 4
genuine quoted references** (the phrase under discussion, not asserted). **No genuine hit
is wrongly suppressed anywhere in the corpus** (`rig/f3.js`). The working copy nonetheless
**defaults to the narrow scope**: the six new patterns carry `isNew: true` and the guard
call is `if (pat.isNew && isQuoted(text, m.index)) continue;`, leaving the 10 shipped
patterns exactly as they behave today. Widening to all 16 is a separate decision about
shipped behaviour — see "Open decision" below.

---

## Settled facts — do not re-derive

### The corpus
**4,356** real turn-final assistant messages rebuilt from **157** on-disk transcripts under
`~/.claude/projects` — the actual `last_assistant_message` values the Stop hook receives
(final assistant text block before each genuine user turn; `isSidechain` lines and `user`
lines carrying a `tool_result` excluded; 0 unparsable). Regenerate with `rig/extract.js`.

**The corpus shrinks over time.** 2026-07-30 measured 4,580 turns / 170 transcripts;
2026-08-02 got 4,356 / 157, because Claude Code prunes old transcripts (158 non-subagent
`.jsonl` files existed on 08-02). Re-baseline rather than comparing to older numbers.

### Numbers (real traffic, production-reachable, 2026-08-02)
| | fires |
|---|---|
| live hook baseline | **77** |
| **working copy as it now stands** (guard on all 16 — Erez's choice) | **188** (+113, −2) |
| narrow-scope alternative, built then set aside (guard on the 6 new only) | 190 (+113, −0) |

Nudge rate on reachable turns: 3.0% → 7.3%. Every one of the 113 added fires was
inspected: 111 via the fully-inspected `nothing to correct|fix`, plus t2590 and t3168 read
individually — all the target class. **Zero false fires on real input**, which is what
`/vet-code` Step 4's input-realism rule (GEN-566) requires.

The 188-vs-190 gap reconciles like this: the guard silences 4 turns when applied to the
shipped patterns alone, but 2 of those 4 also say "Nothing to correct" and so still fire
on a new pattern — net 2, not 4.

### The "For you" blind spot — real, but modest, and NOT the cause of the recurrence
`stop-claim-linter.js` lines 615–678: on any message carrying a "📌 For you" block opener,
every branch of the Phase-2 guard `process.exit(0)`s before Phase 1 reaches `findSelfAudit`
(line 689). The detector never runs on **1,771 of 4,356 turns (40.7%)** — 40.3% when last
measured, i.e. stable.
- `findSelfAudit`'s header comment (~lines 389–395) still claims it flags block-internal
  self-audit "INCLUDING inside a 'For you' block". **Stale** since the Arm-2 content gate
  was removed (GEN-467 v2.2, 2026-07-26). Tracked on **GEN-584**, not here.
- Measured cost is small: only 87 of those turns would have fired at all, and every sampled
  one would have been a FALSE nudge (substantive findings, correctly reported).
- An in-session claim that this blind spot explains the recurrence was made before
  measuring and **does not hold**; logged on GEN-58. Don't repeat it.

### v1 was rejected — keep as regression cases
v1 also had bare `/\bexhaustiveness claim\b/i` and
`/\b(?:done|filed|shipped|applied|resolved)[,;]\s*(?:and\s+)?verified\b/i` (needsClean), and
no quote guard → 156 new fires with three confirmed false-fire classes:
1. **Meta-discussion / quoting** — fired on a message purely because it *quoted*
   `done, verified ✓ closed` and `nothing to correct` while explaining this ticket.
   Structurally the same failure GEN-467 shipped twice.
2. **`applied, verified` inside a required status report** — "the line-79 fix is applied,
   verified, and synced."
3. **`exhaustiveness claim` inside a permitted self-correction announcement** — "I'll
   tighten the wording so it can't be read as an unqualified exhaustiveness claim."

---

## The proposed change (working copy: `rig/working.js`)

Six patterns appended to `SELF_AUDIT_PATTERNS`, each tagged `isNew: true`:

```js
{ re: /✓\s*closed\b/i, isNew: true },
{ re: /\bthat'?s the complete set\b/i, isNew: true },
{ re: /\bholds as written\b/i, isNew: true },
{ re: /\bexhaustiveness claim\b[^.\n]{0,80}?\b(?:holds|stands|is accurate|checks out|survives)\b/i, isNew: true },
{ re: /\bnothing to (?:correct|fix)\b/i, isNew: true },
{ re: /^[ \t]*[-*]\s.*\b(?:done|filed|shipped|applied|resolved)[,;]\s*(?:and\s+)?verified\b[\s\S]{0,400}?^[ \t]*[-*]\s.*\b(?:done|filed|shipped|applied|resolved)[,;]\s*(?:and\s+)?verified\b/im, isNew: true },
```

Plus `isQuoted()` (per-line quote/code-span parity), called first in `findSelfAudit`'s
match loop, gated on `pat.isNew`. `rig/build.js` regenerates the working copy from the
live hook deterministically and **asserts each anchor is unique** — which caught a real
hazard: the zero-width-match guard line is **identical in `findNakedClaims` (line 293) and
`findSelfAudit` (line 403)**, so a whole-file replace would have patched the wrong
detector. The insertion is scoped to `findSelfAudit`'s body.

### Accepted residuals (disclosed in the file's own comments)
- A required status report that bullet-lists 2+ items as "X — shipped, verified" within
  400 chars would fire. The nearest real message (t2553) was one comma short.
- The roll-call pattern is line-start-anchored, so it gets **no** protection from
  `isQuoted` by construction — a fenced or quoted *example* of the shape will fire.
- `isQuoted` is per-line parity only: multi-line quoted blocks, ``` fences, and
  single-quoted spans are not covered. All fail toward firing — the safe direction.

### Acceptance (`rig/verify.js` sliced detector, `rig/livefire.js` real hook process)
- Ticket's verbatim must-FIRE fixture: **fires** (5 hits) where the live hook is **silent**.
- All four must-stay-silent fixtures: **silent**, including the quoting-while-explaining
  text and the ticket's required-status-report counter-example.
- Both confirmed end to end by executing `working.js` as a Stop hook over stdin. Its logs
  are `__dirname`-relative, so running it from the rig dir cannot touch
  `~/.claude/hooks/selfaudit-nudges.jsonl`.
- `node --check` passes.

**Harness gotcha:** the hook dedups per `(session_id, prompt_id)` in a state dir under
`os.tmpdir()` that **persists between runs**. `rig/livefire.js` needs its per-run nonce —
without it, a second run is silently deduped and reads as a false FAIL.

---

## Quote-guard scope — DECIDED 2026-08-02

**Erez chose "all 16": the guard covers the six new patterns AND the 10 that shipped
before GEN-557.** He was shown both options with their measured effects and picked this
one explicitly, so the working copy is built that way — fire count **188**, removing 4
measured false nudges on shipped patterns (net 2), with nothing genuine suppressed
anywhere in the corpus. The narrow `pat.isNew`-gated alternative (fire count 190) was
built and offered alongside it; it is no longer the artifact.

---

## Found on the way — both need their own ticket, neither belongs in GEN-557

1. **`BLOCK_OPENER_RE` does not recognise a markdown-heading block opener.** The regex
   (line 469) allows only spaces/tabs and `**` before the pushpin, so `## 📌 For you` is
   **not** seen as an opener. Measured: **78 of 4,356 real turns** carry a block the live
   guard misses. Consequences: the GEN-467 Arm-1 duplicate-kill never arms for those turns,
   and Phase 1 scans a block-carrying message it was meant to skip. The comment at lines
   453–460 lists three covered forms from a 33-payload log and explicitly excludes only the
   blockquote form — so the heading form is an undocumented gap, not a deliberate choice.
   (This is also why corpus t2553, a genuine For-you block, was reachable at all.)
2. **The claim-linter's own injected note trips a self-audit pattern.** The file's
   MAINTENANCE rule (lines 47–54) says "the guard's own reason strings must never match any
   pattern". Run for the first time on 2026-08-02: `arm1Reason()` PASSES, but the
   claim-linter note text (lines 730–747) contains the literal phrase **"no block is
   owed"**, which matches the pre-existing pattern `/\bno block (?:is|was) owed\b/i`
   (line 334). **Pre-existing** — the live detector matches it too, and the note region is
   byte-identical in the working copy (`rig/maint-attrib.js`). The risk is bounded by the
   note's own "never quoted or restated" instruction, but it violates the file's stated
   invariant and the fixture had never been run.

---

## Also worth knowing
- `/vet-code` Step 4 carries an **input-realism** requirement (**GEN-566**, shipped): a
  guard/detector's live-fire must use real production traffic, report counts in the Step 5
  attestation, and treat any false fire on real input as a FAIL. This rig satisfies it, and
  it is what caught v1's false fires.
- **GEN-575** is real and hit again: the copy/move guard blocks a shell `cp` whose command
  text merely mentions a `.js` file, even between two ordinary project folders. Worked
  around here with an extensionless node copier (`rig/` was banked that way).
- GEN-557's **Priority reads "Highest 🔥", which its own ratings cannot produce**: Gain
  ratio 2 + Not-urgent derives **Medium**. Must be fixed before the ticket closes.
