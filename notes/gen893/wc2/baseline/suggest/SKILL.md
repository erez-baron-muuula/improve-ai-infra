---
name: suggest
description: "The checklist for FORMING a non-routine recommendation, design, or course-of-action proposal before presenting it to Erez. Trigger on /suggest, or whenever you are about to present a non-routine recommendation or design proposal (the always-loaded global CLAUDE.md pointer names this trigger). This is the FORM step; the independent review of the formed proposal is /check. Not for routine answers, factual lookups, or finished mechanical tasks."
---

# /suggest — form the best proposal the situation calls for

A set of checks for **forming** a non-routine recommendation before it reaches Erez.
`/suggest` **forms** the proposal; `/check` **reviews** the formed proposal independently.

**How to use this: run every check whose "applies when" condition this proposal meets,
skip the ones it doesn't, and know which you ran.** A given proposal might run one check
or all of them — the axis is *relevance*, not importance. Checks marked ALWAYS run on
every proposal; the rest are GATED by a concrete condition. Do not skip a gated check on a
vibe — if its condition is met, it applies; skipping it is a visible choice, not a default.

Some checks are owned here; others CITE an always-loaded global `CLAUDE.md` rule whose
trigger is wider than "forming a proposal" (those rules stay in the global file — this
skill points at them so nothing is duplicated or allowed to drift).

---

## Understand the problem

**1 — Ask guiding questions first (GATED).**
*Applies when* information that would change your proposal is missing.
Ask Erez only the questions that would actually change the answer, each naming the specific
gap it fills; if nothing answer-changing is missing, skip and form directly. Owned by the
always-loaded global rule beginning "When the user asks a question" (the answer-first /
ask-if-missing rule) — cited here, not restated.

**2 — Ground the goal, and check what already exists (GATED).**
*Applies when* the proposal would build, add, or create something new (tool, file, rule,
hook, process, mechanism). First confirm the goal is real and correctly stated (not a
presumed or mis-framed goal) — this half is OWNED here; no global rule anchors it. Then
check what already exists that solves or partly solves it — connected tools, existing
scripts/skills/rules, prior work — and prefer an adequate existing path over new machinery;
this half APPLIES THE PRINCIPLE of the always-loaded rule beginning "Before settling on how
to obtain a capability" (whose own examples are about *accessing* a capability — the same
"check before building" principle extends to building new mechanisms).

**3a — Know the common approaches and documented practice (GATED).**
*Applies by default when the proposal chooses or builds anything; SKIPS only when* the
problem is pure Erez-specific configuration or data with no counterpart outside this
codebase (e.g. a Notion property name, a personal file path) — the narrow, checkable
exception. Do NOT skip on a softer judgment that the problem "feels bespoke" or "too
small." Understand how this kind of problem is commonly solved and what documented best
practice exists, and use it as INPUT to the option set and the smallest-design choice —
**not** as a mandate to adopt the heaviest "best-practice" version (that would defeat this
skill's whole purpose). If the knowledge isn't already solid, look it up from a real
source; never assert best practice from memory (see check 7).

**3b — Read the platform's own account of any behavior the design relies on (GATED).**
*Applies when* the proposal depends on how a platform, vendor tool, or Claude Code itself
behaves — what it honors, ignores, allows, or limits — including a behavior you plan to settle
with a live test; re-run it when the chosen design pulls in a new dependency. Before building on
the behavior, search the vendor's docs for it — every page covering its context (mode, tool
type, event), reading long pages in full and following any page they point to — and search the
changelog, checking entries against the installed version. In the proposal handed to `/check`,
quote the line that states the behavior under your exact conditions (a neighboring behavior
does not count) and say what it implies for your case; if nothing states it, label it
unverified and note where you looked. A live test settles only what those sources leave open:
run it after the search, as the first build step, before anything that rests on it; if it
contradicts the docs, report the conflict to Erez. Applies the principle of the always-loaded
rule beginning "Before committing to an architecture on any platform" to what a platform honors
or ignores.

**3 — Breadth pass before narrowing (GATED, default-on).**
*Applies by default whenever the proposal involves building or choosing anything* (ties to
check 2's trigger). *SKIPS only when* the goal is a fixed fact-lookup with no design freedom
(there is objectively nothing to choose). Do NOT self-certify the skip by deciding up front
"there's only one path" — that is the very thing the breadth pass exists to test. Do a
genuine from-scratch pass for the FULL option space — including unconventional, indirect,
or "hacky" mechanisms — before narrowing to finalists. Don't present the first one or two
that came to mind as if they were the field. **If you skip this check (or check 5), state
in one line why** — "skipped breadth: X" — so the skip is a visible choice, not an
invisible default. Reinforced by the always-loaded exhaustiveness rule ("Don't claim
uniqueness or exhaustiveness without completing the survey first").

## Build the proposal

**4 — Smallest design that meets every goal (ALWAYS).**
Build the minimal thing that meets every stated goal; add nothing no named goal requires.
If a part isn't traceable to a specific goal, cut it. This is where prior art (3a) is pulled
DOWN to the lightest version that still works. This is the anti-over-engineering core and
the reason this skill exists. (Same test as `/check`'s Holistic lens, run here at formation
as the cheap self-pass; `/check` is the independent backstop — keep both wordings in sync.)

**4a — Design the surfacing path for any signal the proposal produces (GATED).**
*Applies when* the proposal builds a mechanism whose output is a signal for a later decision.
Owned by the always-loaded global rule beginning "When you build or propose any mechanism whose
output is a signal" — cited here, not restated: form the proposal with the surfacing path already
designed, not deferred as a residual under check 8.

**4b — Stay within size limits (GATED).**
*Applies when* the proposal creates or grows a file that has a limit in
`C:/Users/Erez/AI Projects/Improve AI Infra/notes/anthropic-guidelines.json`
(its `limits` and `houseRules`; each entry's `appliesTo` names the files). Measure the file now
and as proposed (`LC_ALL=C.UTF-8 wc -l -m -c`; tokens = characters / `charsPerToken`), and design it to stay
within every limit. A change that would cross a `recommended` limit, or grow a file already over
one, goes to Erez as an explicit question in plain words, with the net-shrinking version offered
first. Never present a change that crosses a `hard` limit or grows a file already over one;
redesign it. In the proposal handed to `/check`, carry one line per applicable limit, with units:
`size: <file> <now> → <proposed> / <limit> <unit>`, or `size: skipped (<reason>)`, an
unreadable thresholds file being one reason. Tell Erez the sizes only when one is within 10% of a
limit or crosses it. Owned here.

**5 — Present at least one real alternative, with trade-offs (ALWAYS — the branch varies).**
This check always runs once you've narrowed (it's how the result reaches Erez); the gate
only decides WHICH branch. *If more than one viable option survived the breadth pass:* give
at least one genuine alternative and state what each choice actually costs — no straw-men.
*If genuinely only one viable path:* do NOT invent a fake alternative — say plainly there is
one option AND explain why the alternatives don't work, so Erez can see the reasoning and
push back. (If you reached "only one path" by skipping check 3, that's the skip that needs
its one-line reason.) Owned here.

**6 — Steelman every option you are NOT recommending (GATED).**
*Applies when* you are recommending one option over other real options (check 5 found more
than one). Write down the strongest genuine reason to choose each of the others. If you
can't find a strong reason for one, re-examine that option before dismissing it. Owned here.

## Stand behind it

**7 — Confidence drives your next step, silently (ALWAYS).**
Rate your own confidence in the proposal INTERNALLY. Never narrate your confidence level to
Erez — it drives your next action, it is not a report:
- **Confident** → present it.
- **Not confident, and vetting IS possible** → vet it against real sources BEFORE presenting
  — silently. Do not tell Erez you were unsure or that you checked; just present the vetted
  result.
- **Not confident, and vetting is NOT possible, AND a vetted approach meets all the
  requirements** → don't surface the unvetted one. LOG it (on the relevant Notion ticket if
  the work has one; else in the session `HISTORY.md`) so it's recoverable if the vetted
  approach later fails. Logged is not dropped.
- **Not confident, and vetting is NOT possible, AND it is the ONLY approach that meets all
  the requirements** → surface it, explicitly flagged as unverified (what you could not
  confirm and why). Never dress an unvetted approach as confident.
(These branches are exhaustive: confident, or not-confident-and-vettable, or
not-confident-and-unvettable split by whether a vetted option exists.)
Extends the always-loaded "For any non-routine answer… present it only when you are confident
in it" rule (which is cited, not restated) with the
vet-or-log-or-flag behavior above.

**8 — State the honest residual (ALWAYS).**
Say plainly what the proposal does NOT solve — its limits, what you couldn't predict, the
risks you're accepting. Don't present it as airtight when it has known gaps; "this fully
solves it" is itself a residual claim, so make it explicit. Applies the principle of the
always-loaded "Honesty over confidence" rule (which is proposal-relevant directly) and of
the destructive-op "state what you expect AND what you can't predict" rule (whose own
trigger is execution-time destructive ops — cited here for the SAME expect-vs-can't-predict
discipline at proposal time, not as an exact-scope match). Both stay in the global file.

## Deliver it

**9 — Frame it so Erez can act, then hand off to `/check` (ALWAYS).**
Put each option and its trade-off in plain, real-world terms — what it means and what it
costs him — never as tech/config/implementation detail; if a choice can't be made meaningful
without jargon, translate it or make the call yourself and just tell him. When a design
assumption underlies the recommendation, state it in plain, non-technical language folded into
the decision it affects — let him react to it as part of the choice — never as a separate
technical assumptions list stacked above the decision; that stacked list is exactly what he
skips. Then run the formed
proposal through `/check` before presenting, per the always-loaded "run the /check skill on
the proposed answer before presenting it" rule. Cites the always-loaded plain-terms/approval
rule and the /check bridge; owns neither.

---

## Ownership ledger (so nothing drifts)

CITE-only (the always-loaded global rule stays the single source of truth; this skill only
points): check 1, the "check what already exists" HALF of check 2, signal-surfacing (4a), the
draft/confidence half of 7, check 8, check 9.

OWNED here (no external anchor — do NOT trim these believing a global rule preserves them):
the "confirm the goal is real" HALF of check 2 (no global rule anchors goal-verification),
prior-art (3a), platform behavior (3b), breadth (3), smallest-design (4), size limits (4b), real-alternative (5),
steelman (6), and the vet-or-log-or-flag behavior of (7).

Check 2 is therefore HYBRID: goal-confirmation owned, what-exists cited.

Deliberately NOT in this skill: the one-item-at-a-time presentation rule — its trigger (how
any item goes to Erez for approval) is wider than proposals; it stays always-loaded, uncited.
Also NOT here: a self premise-challenge step — catching a false premise you already believe
is structurally `/check`'s job (its independent pre-mortem lens), not reliable as self-review,
so it is deferred to the `/check` handoff (check 9), not duplicated here. (Check 3b is a source search, not a premise challenge.)
