# GEN-467 holistic fix — design v4 r3 (2026-08-09; r2 → r3 after round-2 panel: holistic PASS, soundness PASS, pre-mortem REVISE ×2 NEW)

r3 changes: Part 1's positive branch made conditional (round-2 pre-mortem NEW-1 — the unconditional
form was a silent-block-suppression regression); the widening measurement re-run over BOTH arms
with shape classification (NEW-2 — m-widen2.js); out-of-window openers now logged as a guard
event; twelve round-2 advisories folded in (marked ⟨adv⟩ where they landed).

## Goals, each traced to a measured failure

- **G1 — no duplicate "📌 For you" blocks.** 2 post-v2.2 duplicates (Aug-3, Aug-5).
- **G2 — the guard must see every real opener form.** 106/403 block-carrying messages since 07-28
  (26%) use forms `BLOCK_OPENER_RE` (stop-claim-linter.js:659) cannot match: 97 heading form, 9
  doubled-pin. (= GEN-601.)
- **G3 — no Stop injector may steer toward a second block after one is out.** stop-signal-surface.js:219
  says "fold it into the '📌 For you' block this turn owes" unconditionally. Precision: the same
  note already ends with a "do NOT emit a … block merely in response to this note" prohibition
  (:221-222) and the Aug-3 duplicate happened anyway — the defect is an instruction that
  affirmatively presupposes an unsent block, guarded only by a prohibition scoped to "merely in
  response". Wording is mitigation, not guarantee.
- **G4 — resolve the 70% convention-miss deliberately** (795/1,132 single-block turns), by
  decision, not by enforcement machinery that measurement says is net-harmful.
- **G5 — injected note texts must not trip the file's own detectors.** :931 "where no block is
  owed" matches SELF_AUDIT_PATTERNS :342. (= GEN-597.)
- **G6 — recording fidelity** (= GEN-602; hit caps at :311/:613 collection and :634 log-slice;
  exact fix from the ticket body at build time).
- **G7 — every new signal has a designed reader + re-evaluate bar.**
- **G8 — honor the GEN-618 batch decision** (GEN-584+597+601+602, one /vet-code pass; HISTORY.md:1146).

## Evidence (all verified live this session)

- **E1 — claim-linter dual-branch note, exposure record.** Since 07-28: 118 claim-linter turns
  (scan3.js run 2026-08-09 afternoon; the banked README's 114 is the same-day morning run — the
  corpus grows during measurement, rig README:11-17). In **41**, a block was already out when the
  linter fired. 41 is an exposure UPPER BOUND (many were no-op exposures); the "1 failure"
  (Aug-5) was joined manually against the duplicate census. **The one failure was an ATYPICAL
  exposure** — the note fired ON the heading-form block message itself via the Phase-2
  recognition miss, a mechanism Part 2 eliminates. On its intended exposure class the dual-branch
  text is 40/40.
- **E2 — Aug-3 duplicate** (f00041c7, entries 739-768): bold-form block #1 09:44:31 →
  signal-surface additionalContext 09:44:33 → continuation with 6 tool calls (first at 09:45:09)
  → block #2 09:47:02 → arm1-block 09:47:05 → forced plain re-send 09:47:12. A release record
  existed; a mid-turn injector keyed on it would have fired once, at the first tool call, ~2
  minutes before block #2.
- **E3 — Aug-5 duplicate** (761ee711, entries 477-505): heading-form block #1 15:04:54 →
  claim-linter note 15:04:57 (the ONLY injector that fired that turn — all four signatures
  grepped) → continuation with **3** tool calls → heading-form block #2 15:06:52. No release
  record existed, so the proposed mid-turn hook would have taken its fast path and **never
  fired**; under Part 2 the provocation itself disappears (block #1 recognised → release → exit
  at :867 before Phase 1 → no note → no continuation → no block #2).
- **E4 — PostToolUse carrier, load-bearing proof:** a PostToolUse `detect` written INSIDE the
  Aug-3 continuation carries the SAME prompt_id as the originating turn's release record
  (signal-surface-pending.jsonl:25, 09:46:01, prompt `0ed597c4…` = foryou-guard-events.jsonl:278-279).
  Delivery to the model proven by production reactions to the notion-staleness warning
  (HISTORY.md:1837, 2016, 2358). PostToolUse fires in the MAIN session only
  (posttooluse-signal-detect.js:50-53). No PostToolUse registration here yet uses matcher `""`
  (settings.json:142-160; `""` proven on PreToolUse ×3, :86-113) — confirm on PostToolUse at build.
- **E5 — signal-surface exposure record:** 11 `decision:"nudge"` deliveries; **3** co-fired at a
  Stop whose message was simultaneously released (same prompt_id, ms apart): 0ed597c4 (the
  duplicate), 57a913f9, e1291f02. Failure rate on block-already-out exposures: **1/3**, against
  the dual-branch text's 0/40 on its intended class.
- **E6 — widening measured (m-widen.js r1; m-widen2.js r3 re-run over BOTH arms), transcripts
  since 07-28, 407 widened-opener matches (364 turn-final, 43 non-final):**
  (a) **False-release candidates: 0 quote/draft-shaped lines in all 407** (class 1: lines with
  trailing text after "For you" — 0; class 2: bare opener lines not preceded by `---`/message
  start — 2 flagged, both real blocks on inspection, just missing the customary `---`). Scope,
  honestly: for the harmful channel (a false record created BEFORE the turn's real block, which
  Arm 1 would then kill) the non-final arm is a complete population by construction — 0 observed;
  the turn-final arm is measured by line shape, not eyeballed individually — also 0
  quote-shaped. The :156-169 residual is real in principle but unexercised in 12 days.
  (b) **Continuations Part 2 removes: 39 turns since 07-28** whose first wide-only block message
  (heading or doubled-pin form) drew a Phase-1 note at its Stop (~3/day) ⟨adv: turns, not
  messages; wide-only includes doubled-pin⟩. That these would mostly have been FALSE nudges is
  INFERRED from gen557's measurement of the equivalent guard-skipped population (README:179-180 —
  87 would-be fires, every sampled one false), not measured on these 39 ⟨adv⟩. Aug-5 was one of
  them, and it was a real-but-duplicate-producing fire.
  (c) **Tail geometry, union of both arms: last opener match ≤4,523 fence-stripped chars from
  message end in 100% of 407** (union p99 = 4,247; final-arm max 4,523; non-final max 4,483 —
  including Aug-3's block #1, the one Arm 1 caught). Window: 6,000 chars = 1.33× margin over the
  observed max of the COMPLETE population.
  (d) A third blind-spot denominator now exists (39/99 turns) beside 78/4,356 and 106/403 —
  reconcile all three wherever quoted, same pass ⟨adv⟩.

## The fix — seven parts (r3)

**Part 1 — stop-signal-surface.js: state-aware, CONDITIONAL dual-branch instruction (G3).**
Replace the fold-in clause at :219 with: (i) a self-test of its own `last_assistant_message`
against the SHARED anchored opener regex (fence-stripped, tail-windowed — same semantics as
Part 2; named-copy comment both sides; no cross-file state read, hence no Stop-ordering race);
(ii) **if the opener is present, the branch is CONDITIONAL, mirroring Part 3's wording** (r3, was
unconditional in r2): "this message appears to already carry this turn's '📌 For you' block — if
that matches (you already sent it), state the surfacing design briefly as plain prose and do not
emit another block; if you have NOT actually sent a block this turn, that appearance is a false
positive from quoted text: disregard it and fold the design into the block when it is due"; (iii)
if absent → today's fold-in instruction plus the dual-branch tail ("or, where no block is due or
one already went out, state it briefly as ordinary content"). The conditional form is now the
DECIDED, symmetric choice across Parts 1 and 3 ⟨adv: asymmetry resolved deliberately⟩ — E5 shows
firm wording was disobeyed once, and the falsifiable form costs nothing when the state is true.
Near-miss vocabulary only ("no block is due"; fixture asserts the literal); must pass the
reason-self-scan fixture (:739-743). Covers the text-only-continuation residual for
signal-surface-provoked turns — the class Part 3 structurally cannot reach.

**Part 2 — widen `BLOCK_OPENER_RE`; PRIMARILY provocation removal, secondarily Arm-1 sighting (G2/GEN-601).**
Draft regex (the opener-replay fixture is the acceptance criterion, esp. the 9 doubled-pin forms):
`/^[ \t]{0,3}(?:#{1,6}[ \t]*)?\*{0,2}(?:\u{1F4CC}[ \t]*)+\*{0,2}[ \t]*For you/imu`
— keeps line-anchoring, `[ \t]`-only whitespace (ReDoS-load-bearing, :656-658), fence-stripping,
blockquote/indented-code exclusion via the anchor. **Primary effect:** a recognised block-carrying
message exits at Phase 2 before Phase 1 — the 39 measured note-continuations/12 days stop being
provoked; the Aug-5 duplicate class dies at source. **Secondary:** release records exist for all
observed forms → Arm 1 (and Part 3, if built) sighted on 403/403. **Stated openly: this
deliberately removes the Phase-1 claim/self-audit scan from the 26% of block-carrying messages
that currently receive it** — same-direction and same-evidence as Part 6 (gen557 README:179-180;
block content measured clean, 1 flag/65, gen467 rig README:69 ⟨adv: citation added⟩).
**Origin-narrowing (F1):** `markReleased` fires only when the opener sits within the trailing
6,000 fence-stripped chars (E6c, union-sized). **An opener match OUTSIDE the window logs a
distinct guard event (`release-skipped-tail`) instead of releasing** ⟨r3⟩ — the fail-open is
countable by the scheduled scan, not invisible. Build notes: the window is computed on the FULL
`stripFences(input.last_assistant_message)` (per :790-793), never the :777-capped copy ⟨adv⟩;
the tail window gates `markReleased` only, not Phase-2 entry — a quoted opener in a LATER
message of an already-released turn can still draw Arm 1; comment that asymmetry in the built
file ⟨adv⟩. Same-pass doc refresh: stop-claim-linter.js:60-62, :156-169 (whose "can no longer
force the real block into plain prose" is contradicted by arm1Reason() :744-751 — correct it
⟨adv⟩), :563-571, :643-658; gen557 README:253-254; gen467 rig README (+ the three-denominator
reconciliation, E6d); the scheduled scan's SKILL.md step-1 detector AND its step-5 interpretation
(`arm1-block` can now also mean a false record killed a real block — the event needs hand-review,
not auto-classification as "genuine duplicate intercepted") ⟨adv⟩. Sequencing: **Part 2 alone is
net-positive**; ship with Part 1 by preference — the Arm-1 triple-rendition residual applies only
to duplicates whose provocation is not the Phase-1 scan.

**Part 3 — mid-turn released-state note (G1 defense-in-depth) — DECISION FOR EREZ.**
Honest basis: after Parts 1+2, **zero recorded duplicates remain in any class Part 3 covers** —
E2 is prevented by Part 1 (and was caught by Arm 1), E3 by Part 2; Part 3 is inert on
heading-form turns without Part 2's recognition. Its case is defense-in-depth against the
unmeasured classes (a model that disobeys Part 1's note, as it once disobeyed :221-222 — E5's
1/3; or an unprompted second block) — at the cost of the FIRST empty-matcher PostToolUse hook in
this config: one node spawn per tool call, every session (three universal PreToolUse hooks
already exist, so ~+33% on an accepted tax; per-spawn cost unmeasured — measure at build if it
matters). Mechanics if approved: `posttooluse-foryou-released.js`, matcher `""`; skip when
session_id or prompt_id missing (mirror :805-806); sanitisation byte-identical to :779-780; fast
path = one `existsSync` on `guard.<sid>.<pid>.released`; dedup via EXCLUSIVE create
(`flag:'wx'`, the :705-713 pattern); on winning: append `midturn-note` to
foryou-guard-events.jsonl, emit the conditional additionalContext ("a record shows this turn's
block already went out — if that matches this conversation, further material for Erez goes as
brief plain prose, no second block; if you have NOT sent a block this turn, the record is a
false positive from quoted text: disregard entirely and emit the block normally when due");
cleanup ownership: state pruned by stop-claim-linter's pruneState — stated in both files'
comments. F1 honesty: conditional wording REDUCES the false-record blast radius, it does not
eliminate it — when the false record comes from the model's OWN drafted opener, its context is
ambiguous; the tail window narrows that at origin; E6a measured 0 quote-shaped lines in 407.
**Two ship options put to Erez (the one open build decision):**
- **A′ (recommended):** ship Parts 1+2+4+5 now; hold Part 3 designed-but-unbuilt behind Bar 2
  below. Smallest set that kills both recorded causal chains at source; adds no always-on
  process; Part 3 stays one /vet-code away.
- **B:** include Part 3 now. Fully specified; Erez's earlier "include it" was given under the
  pre-correction coverage claim ("would have reached both duplicates"), which is why this is
  re-asked rather than assumed.

**Part 4 — note-text hygiene (G5/GEN-597).** :931 "where no block is owed" → "where no block is
due"; sweep ALL injected strings (arm1Reason, both noteParts, Part 1's new text, Part 3's note if
built) through the reason-self-scan fixture as a batch invariant. Literal standardised: "due".

**Part 5 — recording fidelity (G6/GEN-602).** Enrich what the EXISTING durable log records
(selfaudit-nudges.jsonl; caps at :311/:613/:634). Reader already exists: /wrap Step 3c reads
selfaudit-nudges.jsonl (wrap/SKILL.md:55-59 ⟨adv: corrected citation — :941-943 is the linter's
write site, not the reader⟩) plus measurement sessions via the banked rig — no new signal store,
no new G7 obligation. Exact cap mechanics from the GEN-602 body at build; if the ticket implies a
NEW store, that store needs a named reader before it ships.

**Part 6 — GEN-584 disposition: propose Won't Do, with evidence.** Extending the self-audit
detector to block-carrying messages (a) dies at the `stop_hook_active` gate (:874) for
convention-compliant turns and (b) is measured net-harmful (gen557 README:176,179-180).
Consistency, stated plainly: Part 2 moves 26% of block messages in the SAME direction this
disposition blesses — one decision seen from two sides, presented together.

**Part 7 — the convention decision (G4), put to Erez.** Data: followed ~30%; when followed it
works; the miss-path harm channel is corrections arriving after the block is out (41 linter
exposures/12 days, 1 duplicate — now killed at source). Options: (i) **recommended** — keep the
CLAUDE.md rule as the stated ideal; re-scope the GEN-467 scheduled scan's tripwire from
compliance to harm. Named cost, plainly: a rule violated ~70% of the time stays in the global
file and compliance stops being watched — what remains watched is what the rule protects (Bar 4).
(ii) rewrite/delete the rule — real cost is rule + the hook prompt texts that quote it
(coupling marked at stop-claim-linter.js:915-919) + fixtures, per the approved finish-line
condition (HISTORY.md:288) ⟨adv⟩. (iii) enforcement machinery — rejected on the GEN-557
measurement.

## Signals, readers, bars (G7)

Reader: the `gen467-block-after-check-verify` scheduled scan (SKILL.md updated in this pass:
step-1 detector, step-5 interpretation, these bars) + /wrap guard-event counts. Bars are counted
against EXPOSURES; absence-of-failure is never claimed from elapsed time alone (a
positive-occurrence RATE, as in Bar 3, is legitimate) ⟨adv: header softened⟩. Exposure
denominator, computable from existing logs: signal-surface `deliver` co-firing with
`release-clean` on the same prompt_id (E5's join) + linter block-already-out turns (rig scan3) +
`midturn-note` events if Part 3 ships + `release-skipped-tail` events (r3).
- **Bar 1 (only if Part 3 ships):** any transcript duplicate in a turn WITH a `midturn-note`
  event (join: session id from the transcript filename + prompt window by timestamp) → the note
  failed → redesign discussion.
- **Bar 2 (Part 3's un-defer trigger under A′ ⟨adv: named⟩):** any post-ship duplicate in a turn
  where a tool call sat between the block and the duplicate — the class Part 3 is built to reach
  → build Part 3 (designed; one /vet-code away).
- **Bar 3:** any duplicate in a class Parts 1+2 claim to kill (linter- or signal-surface-
  provoked) → the causal model is wrong again → reopen the design, do not patch.
- **Bar 4 (Part 7-i's watch; computable definition ⟨adv⟩):** the block-already-out exposure count
  per scan window (the E5-style join + scan3's `before>0` census), reported WITH duplicates among
  them — a rising exposure count means the convention is increasingly missed where it matters →
  revisit Part 7; any duplicate among them routes to Bar 2/3.
- **Bar 5:** duplicates with no tool call in the gap, or >1 duplicate/month overall → revisit
  option C (gated delivery channel). Also: any `release-skipped-tail` event on a REAL block
  (hand-review) → re-size the tail window.

## Rollout

One /vet-code batch: stop-claim-linter.js (Parts 2,4,5) + stop-signal-surface.js (Part 1)
[+ posttooluse-foryou-released.js + settings.json registration, iff Erez picks B]. Step 4 input
realism: real transcripts via the banked rig + full foryou-guard-events.jsonl as oracle — NOT
rig/corpus.jsonl. Fixtures: reason-self-scan over all injected strings; opener replay over
regenerated openers.json asserting 0 misses (doubled-pin forms decide the final regex) + the
negative set (blockquote, fenced, indented, beyond-tail-window quotes). Blocked step, stated:
/code-review is user-invocation-only — Erez types it at Step 3; the Step-6 mint prompt is his
gate; nothing installs before that. Presentation to Erez follows the one-decision-at-a-time rule
— the artifact holds three decisions (A′/B, Part 6, Part 7) and they are surfaced sequentially,
never as one approval blob ⟨adv⟩.

## Alternatives (steelmanned)

- **A (bare minimum, Parts 1+2 only):** the two recorded causal chains die at source with two
  file edits. Rejected only because Parts 4+5 ride the same files in the same pass at near-zero
  marginal cost and G8's batch decision covers them.
- **A′ vs B:** Erez's call, framed in Part 3.
- **C (gated MCP delivery channel):** the only architecture that GUARANTEES single emission and
  canonical format. Parked behind Bar 5; disproportionate today.

## Honest residuals

1. A model that emits a second block with no tool call in the gap and despite Part 1's note is
   unreachable by anything here except Arm 1's after-the-fact triple rendition (Bar 5 watches).
2. False-release residual (:156-169): 0 quote-shaped lines in 407 matches/12 days (E6a, both
   arms, shape-classified — turn-final arm not individually eyeballed); narrowed at origin by
   the tail window; blast radius reduced by conditional wording in BOTH notes — not eliminated:
   the model's own drafted opener within the tail window remains ambiguous. The window does NOT
   narrow false Arm-1 on a quoted opener in a post-release message ⟨adv⟩.
3. All prevention is instruction, not enforcement; only option C removes that class.
4. Part 3 (if built) adds a per-tool-call process spawn; per-spawn cost unmeasured.
5. A Stop `decision:"block"` cannot retract a displayed message (:846-848).
6. stop-foryou-nudge.js:196 stays silent whenever its loose MARKER_RE matches — a quoted marker
   can mask a genuinely missing block. Pre-existing; Part 2 changes which turns reach Phase 1
   (stated as its primary effect), not the nudge hook.
7. GEN-602's exact fix is scoped from HISTORY.md:1146's one-liner; ticket body read at build.
8. Figures are same-day snapshots of a growing corpus; re-runs drift (rig README:11-17); bars are
   per-exposure for this reason.
9. ⟨r3⟩ A real block sitting >6,000 stripped chars before message end would no longer be
   release-recorded (today it would be) — Arm 1 inert for that turn, the documented fail-open
   direction. No observed instance in 407 (max 4,523); `release-skipped-tail` makes any future
   instance countable (Bar 5).

## Round-3 advisories (non-blocking; honor at build)

Converged 2026-08-09: holistic PASS + soundness PASS (round 2), pre-mortem PASS (round 3); zero
open material findings after 3 rounds.

1. **Slice-boundary trap for the tail window:** testing the line-anchored regex against
   `stripFences(msg).slice(-6000)` lets `^` match at the slice boundary mid-line — a mid-line
   quote could then release. Either slice to the nearest preceding newline, or match on the FULL
   string and compare the last-match offset (m-widen2.js's semantics). Add a fixture whose
   out-of-window quote lands exactly on the boundary.
2. m-widen2's dedupe key (path + turn timestamp) counts a resumed/forked turn once per session
   file — can inflate the 407 denominator, cannot affect the max or the zero-candidate result.
3. m-widen2's header comment says class 2 excludes a preceding heading line; the code checks only
   `---`/message-start (more inclusive → conservative result). Align the comment when banking.
4. Bar 4 has a computable input but no numeric trip point; fix a per-window number when the
   scan's SKILL.md is edited in this pass.
