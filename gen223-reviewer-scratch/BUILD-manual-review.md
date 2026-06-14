# Build spec — manual "review to convergence" command (ACTIVE GEN-223 plan)

**Status: spec ready, NOT built.** This is the **active** plan. The automatic-gate
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

## Depth scaling

- Small / routine: single quick reviewer pass (or none).
- Big design / rules / architecture: full multi-lens panel iterated to convergence.
- How depth is chosen (explicit from Erez vs inferred from the task) — open decision.

## Wiring

- A **skill or slash command** in the user's config (cf. the existing `code-review`
  skill). **Not** a Stop hook, **not** a `settings.json` change, **no** cloud infra. Runs
  in the main session; spawns reviewer sub-agents via the Agent tool.

## Open build-time decisions (settle at build)

1. Trigger surface + phrasing (command name; the two modes above).
2. Single reviewer vs panel default, and lens count, per depth.
3. Include the claim-grounding check (D) or not.
4. Convergence cap / escalation rule (suggestion above).
5. How depth is chosen (explicit vs inferred).
6. Reviewer model — cost is now on-demand, so quality-first (Opus) is affordable; this
   session used the default sub-agent model.

## Reference implementation

**This GEN-223 design session ran the loop by hand, end-to-end** (designing then converging
Phase 2): a 3-lens independent panel, 5 rounds, only-material-blocks, converged when all
lenses passed. Read this session's transcript as the worked example before building.
