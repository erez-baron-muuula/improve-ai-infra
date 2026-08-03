# GEN-557 — self-audit detector widening: measurement rig & findings

**Ticket:** GEN-557 "Widen the GEN-507 self-audit detector to catch
verification-walkthrough narration" — https://app.notion.com/p/3a66e495d07c8108a684e31a824b8eb3

**Target file:** `~/.claude/hooks/stop-claim-linter.js` (vetting-locked → `/vet-code`).

> **GEN-557 SHIPPED on 2026-08-02 — this file's older sections describe the pre-install
> world and are kept as dated history, not as current state.** Corrected 2026-08-03 under
> **GEN-616**; every statement below that survived is either dated or re-verified. Measured
> against the live hook 2026-08-03: **990 lines, 60,977 bytes, LF, 16 `SELF_AUDIT_PATTERNS`**
> (the ten pre-GEN-557 ones at lines 337-352, the six new ones at 370-414). The
> pre-install baseline — 801 lines, 47,164 bytes, 10 patterns — is the 2026-07-30/08-02
> figure and is retained only for reading the older sections in context.

**The rig lives beside this file in `rig/` and is git-tracked** (verified 2026-08-03 via
`git ls-files`: 25 files including `lib.js`, `working.js` and `proposed.diff`). The 2026-07-30
session banked only this README and the scripts were lost, costing a full rebuild on
2026-08-02 — hence banking them. Only `corpus.jsonl` (6.6 MB of real transcript text)
and the derived dumps are excluded; regenerate with `rig/extract.js`.

**Re-baseline, never diff against a printed number.** `extract.js` rebuilds the corpus from
on-disk transcripts and it SHRINKS as Claude Code prunes them, so figures from different
dates are not comparable. The 2026-08-03 corpus was `files=164 turns=4464 unparsable=0`;
earlier sections quote a 4,356- and a 4,580-turn corpus. Always re-run before quoting.

---

## Status — INSTALLED (2026-08-02); section below is the pre-install record

**Current state, verified 2026-08-03 (GEN-616):** the change is LIVE. The live hook carries
all 16 patterns, `buildSuppressionMask`, and both `CORRECTION (GEN-557, 2026-08-02)` comment
blocks. `/code-review` was typed by Erez and the full `/vet-code` gate completed, so the
sequence described in this section as "remaining" is DONE. What is genuinely still open lives
on its own tickets, not here: **GEN-592** (fenced/roll-call quote gap — one attempt built,
measured at a 91% blast radius, and removed; Wont Do is a legitimate outcome), **GEN-597**
(the claim-linter note matches one of this file's own patterns), **GEN-601** (`BLOCK_OPENER_RE`
misses the `## 📌 For you` heading form), **GEN-602** (the 5-hit cap's log representativeness),
and **GEN-584** (the guard exits before the self-audit stage). Per **GEN-618**, decided
2026-08-03, GEN-584/597/601/602 ship together in ONE `/vet-code` pass — do not open a pass for
one of them alone.

### The pre-install record (as written 2026-08-02 — kept for provenance)

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

**3. The quote test's scope was wider than the ticket, and its false-negative direction was
unmeasured. RESOLVED — measured, then decided by Erez.** Applied to the shipped patterns in
isolation the test changes 6 turns and fully silences 4 — **all 4 inspected, all 4 genuine
quoted references** (the phrase under discussion, not asserted). **No genuine hit is
wrongly suppressed anywhere in the corpus** (`rig/f3.js`). A narrow variant was built for
comparison — the six new patterns tagged `isNew: true` and the call gated on that tag — and
**Erez chose the wide scope on 2026-08-02**, so the shipped artifact applies the test to all
16 patterns with no tag. Do not resurrect the tag: see "Quote-guard scope — DECIDED" below.
(The per-match `isQuoted()` function this finding named no longer exists either; code review
replaced it with `buildSuppressionMask` for performance.)

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

**This section describes the post-code-review design.** An earlier draft used a
per-match `isQuoted()` gated on a `pat.isNew` tag, with `/✓\s*closed\b/i` and
`that'?s`; code review killed all three (see "Code review" below). Don't resurrect them.

Six patterns appended to `SELF_AUDIT_PATTERNS`, untagged:

```js
{ re: /✓[ \t]*closed\b/i },
{ re: /\bthat['’]?s the complete set\b/i },
{ re: /\bholds as written\b/i },
{ re: /\bexhaustiveness claim\b[^.\n]{0,80}?\b(?:holds|stands|is accurate|checks out|survives)\b/i },
{ re: /\bnothing to (?:correct|fix)\b/i },
{ re: /^[ \t]*[-*]\s.*\b(?:done|filed|shipped|applied|resolved)[,;]\s*(?:and\s+)?verified\b[\s\S]{0,400}?^[ \t]*[-*]\s.*\b(?:done|filed|shipped|applied|resolved)[,;]\s*(?:and\s+)?verified\b/im },
```

Plus `buildSuppressionMask(text)` — one linear pass per message producing a
`Uint8Array`, consulted as `if (suppressed[m.index] === 1) continue;` for **every**
pattern. A position is suppressed when its own line has odd straight-quote or backtick
parity before it, or an unclosed smart open-quote. The stored/echoed hit also collapses
whitespace, so the roll-call match cannot put a multi-line blob into the nudge or the
durable log.

**Fence handling was built, reviewed, and then dropped** (Erez's call, 2026-08-02) — see
"Fence handling: tried and removed" below. The open problem it was meant to solve is
tracked as [GEN-592](https://app.notion.com/p/3b06e495d07c81f4855dcbdf9021d09f).

`rig/build.js` regenerates the working copy from the live hook deterministically and
**asserts each anchor is unique in its intended scope** — which caught a real hazard:
the zero-width-match guard line is **identical in `findNakedClaims` (line 293) and
`findSelfAudit` (line 403)**, so a whole-file replace would have patched the wrong
detector. All match-loop edits are scoped to `findSelfAudit`'s body.

It also corrects two pre-existing comments that are actively false and sit against the
new code: the `findSelfAudit` header's claim that the stage runs inside "For you" blocks,
and the MAINTENANCE note's forced-redo cost (both dead since GEN-467 v2.2). Noted on
GEN-584 so it isn't done twice.

### Accepted residuals (disclosed in the file's own comments)
- A required status report that bullet-lists 2+ items as "X — shipped, verified" within
  400 chars would fire. The nearest real message (t2553) was one comma short.
- The suppression test cannot tell quoting-to-discuss from quoting-to-say, so scare-quoted
  or inline-code'd narration escapes (`It "came back clean" on both files.`). The corpus
  evidence bounds only shapes that have already occurred, not this one.
- Parity is per line, so a multi-line quoted block, a ``` fenced block, and single-quoted
  spans are all uncovered — every one of those fails toward **firing**.
- **The roll-call pattern gets no quote protection at all**, being line-start-anchored:
  there is never same-line text before the match to count quotes in. So a fenced or
  indented *example* of the roll-call shape fires. This is the sharpest residual and the
  reason [GEN-592](https://app.notion.com/p/3b06e495d07c81f4855dcbdf9021d09f) exists. A
  **blockquoted** example (`> - GEN-1 — done, verified`) does *not* fire, since the anchor
  rejects the `> ` prefix.
- Suppression is tested at the **match start** only.
- The Phase-2 guard is **not** a complete shield for required in-block reports: it skips
  only what `BLOCK_OPENER_RE` recognises, which misses the `## 📌 For you` heading form
  (78 turns) and is bypassed when `session_id`/`prompt_id` is missing.

### Fence handling: tried and removed (2026-08-02)

A version of the mask also suppressed anything inside a ``` fence, to stop fenced
*examples* from firing. It worked for the target case — fenced roll-call examples went
silent, real roll-calls still fired, and it changed **zero** outcomes across the 4,356-message
corpus. Code review rejected it and Erez chose to drop it, because fence state as parity
over line-start markers is fragile in a way the cure could not survive:

- A **single unbalanced marker** — unterminated snippet, typo, or a fenced example that
  itself contains a fence opener — silenced **every** pattern for the rest of the message.
  Measured: one stray marker masked **571 of 625 characters (91%)** of a test message.
  After the drop: **1 of 625**.
- That silencing hit the **10 patterns predating GEN-557**, so a formatting accident could
  switch off detection that already ships.
- A marker indented 4+ spaces also counted as a fence, though Markdown calls that an
  indented code block — a second route to an unbalanced count.
- It added a **second, differently-behaving notion of a fence** to a file that already has
  `stripFences()` (which pairs ``` anywhere, including mid-line, for the Phase-2 blocking
  arm).

Net: the fix's failure mode (silently disabling a whole message's detection) was worse than
the defect it fixed (one dismissible nudge). `rig/maskprobe.js` asserts the post-drop
behaviour in both directions — what the drop fixed *and* what it costs. Constraints for any
future attempt are on GEN-592, not here.

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

## Code review (`/vet-code` Step 3) — status 2026-08-02

**Pass A** (in-session `/code-review`, xhigh, typed by Erez): 8 findings.
**Pass B** (independent cold sub-agent, Opus, two rounds): 1 material, then 2 more.

Fixed as a result — the substantive ones:
1. **The per-match quote test was a 593× performance regression.** Both passes flagged it;
   measured on a 200k single-line message of `"came back clean" ` repeated: **17 ms → 10,145 ms**.
   `isQuoted` was O(line length) per match, called before the clearing gates and before the
   5-hit cap, and suppressed/duplicate matches never increment `hits`, so the call count was
   uncapped. Worse than first thought: **nothing in-process bounds it** — `clearTimeout(watchdog)`
   is the first statement of the stdin `end` handler, so all scanning runs after the 5-second
   watchdog is disarmed, and `settings.json` registers this hook with no timeout. Replaced with
   the one-pass mask: **~15 ms** on the same input. Don't quote a faster-than-before comparison:
   Pass A round 2 found those micro-benchmarks swing run to run (the live side alone measured
   17–73 ms across runs). The durable claim is structural — a masked match short-circuits before
   the vicinity slice and the clearing regexes, so per-match cost is never above the pre-change
   cost and total cost is pre-change plus one linear pass. Worst case measured (nothing masked,
   ~22k live matches in 200k): ~90 ms.
2\. **Whitespace-collapsed hits**, so the two-line roll-call match no longer lands as a multi-line
   blob inside the nudge's quotes and the durable log.
3\. `\s*` → `[ \t]*` in the tick pattern (`\s` spans newlines); `'?` → `['’]` for apostrophe forms.
4\. **Two comment overstatements I wrote were caught by Pass B round 2** and corrected: they said a
   block-carrying message "is never scanned at all", contradicting this session's own 78-turn
   heading-form measurement, and that overstatement was the stated mitigation for the two loosest
   new patterns.
5\. **Fence masking was added and then removed.** It was fix #2 of the first round; Pass A round 2
   then measured its own failure mode (one stray marker silencing 91% of a message) and Erez chose
   to drop it. See "Fence handling: tried and removed" above; open work on GEN-592.

Mask equivalence check: on unfenced text the mask reproduces the original per-match test at
**107,648 positions across 394 real messages, 0 mismatches**.

Deliberately **not** fixed: the six new patterns sit after the ten existing ones, so on a message
that already yields five old-pattern hits they never run. The nudge still fires; only which
phrases it quotes changes. Reordering was judged not worth the extra diff surface.

**Step 3 is now COMPLETE — both passes have run on the shipped diff.** Full sequence: Pass A r1
(8 findings) → Pass B r1 (1 material: the ~600× regression) → fixes → Pass B r2 (that finding
RESOLVED, 2 new) → Pass A r2 (7 findings, incl. the fence blast radius) → **Erez chose to drop
fence handling** → Pass A r3 (7 findings, 2 material: a call-site comment still claiming fence
coverage, and an over-attribution to GEN-584) → Pass B r3 (both prior findings RESOLVED, 2 new
material: the residuals lead-in stated the wrong failure direction, and this README still
described the abandoned narrow design). Every material finding from all six rounds is fixed
except one knowingly skipped (below).

Three of the six rounds found **false statements in comments the author had just written** —
the failure mode to watch on this file, whose comments are unusually load-bearing. The residual
lead-in case is the sharpest: it said every residual fails toward a *missed* nudge, when after
the fence drop several fail toward a *spurious* one.

**Knowingly skipped, not overlooked:** (a) the six new patterns sit after the ten existing ones,
so a message already yielding five old-pattern hits never reaches them — the nudge still fires,
only the quoted examples change; (b) the mask is built on every turn even though ~97% have no
match (≈4 ms worst case, microseconds typically) — a lazy build would make the common case free.

**Remaining before install:** `/vet-code` Step 4 (live-fire attestation — already satisfied by
`rig/livefire.js` + the corpus runs) and Step 5 (write the attestation, mint the single-use
vetting pass, apply, verify). Nothing is installed; the live hook is untouched.

---

## Quote-guard scope — DECIDED 2026-08-02

**Erez chose "all 16": the guard covers the six new patterns AND the 10 that shipped
before GEN-557.** He was shown both options with their measured effects and picked this
one explicitly, so the working copy is built that way — fire count **188**, removing 4
measured false nudges on shipped patterns (net 2), with nothing genuine suppressed
anywhere in the corpus. The narrow `pat.isNew`-gated alternative (fire count 190) was
built and offered alongside it; it is no longer the artifact.

---

## Found on the way — neither belongs in GEN-557

**Filed 2026-08-02:** the fenced/illustrative-example false fire is
[GEN-592](https://app.notion.com/p/3b06e495d07c81f4855dcbdf9021d09f) (Backlog, Medium,
unassigned) — it carries the constraints for a future attempt and the full record of why
fence masking was dropped. The two below still need tickets.

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
