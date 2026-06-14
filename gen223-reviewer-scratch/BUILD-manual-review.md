# Build spec — manual "review to convergence" command (ACTIVE GEN-223 plan)

**Status: build-time decisions CONVERGED 2026-06-14 (see "Resolved build-time decisions"
below); NOT yet built.** This is the **active** plan. The automatic-gate
alternative in this same folder (`PHASE2-DESIGN.md`, `README.md`, `.claude/settings.json`,
`reviewer-prompt.txt`) is **deferred** — see `DECISION.md` for why. Read `DECISION.md`
first, then this.

## Goal

Let Erez invoke, on demand, the review loop he used to run by hand — his three questions
(rule-check / pre-mortem / holistic) iterated **to convergence** — so he stops doing the
labor. No automatic gate, no Stop hook: **he decides when** review runs.

## Invocation — two modes

1. **Proactive:** with a request, ask for the answer to be reviewed to convergence
   ("…and review it to convergence").
2. **Retroactive:** after seeing an answer, "review that [last answer] to convergence."

(Exact trigger surface — slash command name, skill, and/or keyword convention — is an open
build-time decision; see below.)

## What it runs — REUSE, don't reinvent

The reviewer **protocol** is already designed and battle-tested. Sources:
- The GEN-223 ticket's **"Reviewer protocol (locked)"** section (canonical Steps 1–4).
- The implemented `reviewer-prompt.txt` in this folder (Phase-1 version).

**Reuse the protocol's substance; DROP the hook-specific plumbing** in
`reviewer-prompt.txt` — the `{"ok":true/false}` output contract, `stop_hook_active`, the
`[[GEN223-REVISE]]` round-marker grepping, the "skip review" off-switch, and the recursion
guard all existed only for the Stop-hook wiring and are irrelevant to an on-demand command.

The checks (run only those that apply):
- **A. Rule** (a rule / `CLAUDE.md` edit is proposed): first read the **live** rules file,
  then check conciseness, clarity, accuracy, generality, non-redundant (name the rules
  compared), non-conflicting (name them), clears-the-bar, effective, right home.
- **B. Course of action:** pre-mortem — concrete failure modes (correctness, cost, time,
  maintenance, edge cases, assumptions/dependencies); each handled?; surface unverified
  assumptions (esp. evidence-based/quantitative claims — verify, don't assert); honest
  residuals; check fixes don't spawn new problems.
- **C. Holistic:** restate goals; is there a solution delivering **all** of them with min
  effort/time/cost and max accuracy; search wider (unconventional/indirect); question the
  machinery (smallest design that meets every goal); conclude "nothing better" only after a
  genuine fresh pass.
- **(Optional) D. Claim-grounding** (the deferred Phase-1.5 idea): is a load-bearing claim
  verified/enumerated or asserted from memory? Include or omit — open decision.

## Independence mechanism (this is what gives the value)

- Spawn **fresh independent reviewer sub-agents** (Agent tool), no memory of the original
  reasoning. Independence is what caught the confident errors this session that self-review
  missed (see GEN-58 instance 2026-06-14 #4).
- For substantial work, use a **panel of distinct lenses.** This session used three —
  adversarial **pre-mortem**, **holistic/proportionality**, **feasibility/soundness** —
  and they caught *complementary* issues. For small work, a single reviewer pass.
- Give each reviewer the artifact under review, and **on re-review** the prior round's
  findings to verify resolution.
- **Brief each reviewer with the original user request/goal verbatim, and designate at
  least one lens to challenge the premises you're treating as settled** (not just the
  proposal). A false premise in the brief propagates to every reviewer and can silently
  undermine the whole review — the panel is only as good as the framing it's handed. (GEN-58
  instance 2026-06-14 #7; promoted to a global `CLAUDE.md` rule.)

## The convergence loop + stop-rule (CRITICAL — learned this session)

Loop: review → if material findings, revise the artifact → **re-review** (judge only:
were prior blocking findings resolved? any genuinely NEW material issue? — **no fresh
wishlist**) → repeat.

- **Converged** = all reviewers return no blocker/material findings. Minors / optional
  notes are listed but do **NOT** block.
- **Discipline (essential):** reviewers *always* find something. Scope them explicitly:
  "**material** = would cause real harm or defeat the goal; not a preference." Tell them
  not to invent issues to seem thorough. Without this, it nitpicks forever.
- **Cap / escalate:** don't loop endlessly. This session took **5 rounds**, with findings
  genuinely narrowing each round (fundamental → operational detail). Rule of thumb: keep
  iterating while findings are material *and* narrowing; if it starts thrashing or a round
  yields only unresolvable/non-material items, **escalate** — surface the standoff and the
  accepted residuals to Erez, and stop. (The locked protocol's "2 REVISE → escalate" cap
  was for the cheap hook; a manual *deep* review legitimately needs more — use judgment
  with a sane upper bound, ~5 rounds, then escalate.)

## Depth scaling — RESOLVED (Decision 5, 2026-06-14): one depth

- **One depth only.** Any user-initiated invocation runs the full independent panel
  iterated to convergence. There is **no** "quick"/single-pass tier and **no** autonomous
  trigger (that's the deferred auto-gate). Want less review → don't invoke.
- `/check` refines only the proposed answer in the conversation; it never edits the user's
  source files in place. So the user can read round-1 findings and stop, with work untouched.
- "Critique-only" (flag once, don't iterate/modify) is a *different axis*, consciously
  deferred — reachable manually (invoke, read first round, stop); clean future add-on
  (`/check --once`) if wanted.
- (This supersedes the earlier "scales down to a single pass for trivial work" framing —
  the approved Decision 2 amendment.)

## Wiring

- A **skill or slash command** in the user's config (cf. the existing `code-review`
  skill). **Not** a Stop hook, **not** a `settings.json` change, **no** cloud infra. Runs
  in the main session; spawns reviewer sub-agents via the Agent tool.

## Resolved build-time decisions (converged 2026-06-14)

All six were run through the tool's own review-to-convergence process (a 3-lens independent
panel — pre-mortem / holistic / soundness — iterated to convergence, dogfooding the design).
Several reversed the first-pass recommendation; notes below record the corrected outcome.

1. **Trigger surface — a SKILL named `/check`.** The skill's *description* (trigger
   phrasing) is the engine; `/check` is the explicit alias. Retroactive ("review that last
   answer") is reliable; proactive ("…and review it to convergence" inside a request) is
   **best-effort** (description match, can be silently missed) with `/check` as the reliable
   fallback. (Originally proposed `/converge`; renamed to `/check`.)

2. **Panel, sized to the work — an adaptive independent panel** of fresh sub-agents:
   pre-mortem + holistic + soundness always; **rule-check only when a rule/`CLAUDE.md` edit
   is the artifact**. Not a single reviewer; not a fixed set. Scope = designs / rules /
   courses of action (code stays with `/code-review`). Unresolved lens disagreement →
   escalate to Erez; the orchestrator may not silently overrule a material finding.

3. **Grounding — folded into the soundness lens as a "show your work" (provenance) check.**
   Flags load-bearing claims with no visible verification as "verify before relying"
   (advisory, **non-blocking**); only "this is false" blocks. Rule: cheaply checkable →
   check it; else if load-bearing + unresolvable-from-here + no provenance → flag. v1 judges
   provenance from the reviewed text (heuristic); the orchestrator-fed "which claims had a
   supporting tool call" hybrid is the true-delivery path, deferred.

4. **Convergence / stop rule.** Converged = every live lens reports zero open material
   findings (advisory flags don't block). Each round: review → revise → re-review, with
   reviewers tagging findings *resolved / recurrence / new-from-revision*; the orchestrator
   only counts tags (can't close a finding a reviewer still holds). Re-review is on-scope
   only (a flaw in the revision, or recommendation-changing — no fresh wishlist). Escalate
   to Erez when: same finding survives two fix attempts, OR lenses irreconcilably conflict,
   OR the **3-round cap** is hit; escalated findings are surfaced still-open.

5. **Depth — one depth** (see "Depth scaling" above). Always full when invoked; no quick
   tier; no autonomous trigger; critique-only consciously deferred.

6. **Reviewer model — flat default: Sonnet** for the reasoning lenses (cheapest model above
   the reasoning floor; Haiku excluded for reasoning lenses). The session model is **not**
   an input — independence comes from fresh context (model-independent), not tier-switching;
   no alternation across rounds. Manual escalation to the top model ("check this hard") is
   the dependable lever; auto-bump on non-convergence at the cap. Honest residuals:
   tier-decorrelation is unmeasured (not relied on); a flat Sonnet panel can unanimously
   miss the hardest reasoning-bound errors (mitigated by manual escalation). (Originally
   proposed Opus-everywhere, then "opposite-tier-per-session" / alternation; both reversed
   to flat Sonnet by the panel.)

## Reference implementation

**This GEN-223 design session ran the loop by hand, end-to-end** (designing then converging
Phase 2): a 3-lens independent panel, 5 rounds, only-material-blocks, converged when all
lenses passed. Read this session's transcript as the worked example before building.
