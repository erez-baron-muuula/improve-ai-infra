# ROI Triage — ranking the backlog by payoff per unit of effort

A reusable, one-page procedure for answering "what should we work on next?" across the
Improve AI Infra backlog (epic tickets **and** GEN-58 reasoning-failure classes).

Design `/check`-converged 2026-06-24 (3 rounds). The convergence killed an earlier
multiplied/weighted score that was dimensionally unsound — see GEN-58 **Class P**
`[ROI-triage formula]`. This rubric is the sound replacement. **Do not** reintroduce a
single multiplied score; the defects below are structural, not cosmetic.

## Why not a single weighted score
- **No time horizon.** `(Impact x Frequency x Confidence) / Effort` divides a *rate*
  (saving per period) by a *one-time cost* (build effort). The ranking then inverts with
  the unstated horizon — rare-big and frequent-small items swap order arbitrarily.
- **Incommensurable units.** `w*hours + (1-w)*tokens` adds hours to tokens; the weight `w`
  is a hidden token-to-hour exchange rate dressed up as a preference.
- **Wrong kind of quantity.** GEN-58 tallies are cumulative lifetime counts, not rates;
  feeding them into a "frequency" term double-counts history.

The fix: compare **stocks over a fixed horizon**, keep **currencies separate**, and rank on
a **2-D benefit x effort matrix** — no arithmetic that crosses units.

## The procedure

### Step 1 — Pre-filter to ~5-8 live candidates
- Pull the live backlog from the **tracker** (not from HISTORY/memory): AI-project tickets
  whose status is **Backlog / In Progress**, plus GEN-58 classes.
- **Drop** only **Review / Done** tickets (work effectively complete).
- **GEN-58 classes:** keep every class that has an **identified, unbuilt fix**, regardless of
  tally — a high tally is a *buy signal*, never a drop reason. Classes whose fix is already
  built, or where the decision was "accept the residual," are not candidates.
- GEN-58 classes with **no fix designed yet** go to a separate, **recurrence-ordered**
  "needs a fix designed first" list — surfaced, never silently dropped (they are future work,
  just not rankable on effort yet).
- Drop a small item only if it is **Pareto-dominated** (another candidate is both higher
  benefit and lower effort).

### Step 2 — Two estimates per candidate, evidence-backed
- **Benefit = a stock over a fixed 3-month horizon** (total saving across the window, so
  rare-big and frequent-small compare fairly). Not a per-event rate.
- **Default currency = Erez-time saved** (his scarcest resource). This is a *flippable*
  assumption — if a token bill becomes the binding constraint, switch it.
- **Token-payoff items go in a separate, flagged column — never blended** with time.
- **Effort = S / M / L** (rough build cost).
- **Top-3 evidence gate:** any item entering the top 3 must have its **key benefit driver
  verified in-session from source** — a real recurrence count (GEN-58 tally / weeks since the
  class opened), a measured token figure, etc. — **not asserted from memory**, with the raw
  figure printed so Erez can spot-check. An item whose #1-driver is unverified is **speculative**
  and **cannot be ranked #1**.

### Step 3 — Rank on a 2-D benefit x effort matrix
- High-benefit / low-effort wins. No multiplied or weighted single score.
- A genuine **cross-currency tie** (a time item vs a token item, neither dominating) is
  **surfaced for Erez to choose**, not resolved by a hidden exchange rate.

### Step 4 — Blocker check + measurement trigger
- For each top candidate, check for a **blocker / dependency** (is it waiting on another
  ticket, an external state, a decision?). A blocked item can't be #1 however good.
- **Measurement trigger:** if the top two are within ~one effort step of each other, or if #1
  is **speculative** (top-3 evidence gate unmet), do **one cheap measurement** before
  committing, rather than guessing.

### Step 5 — Output
- A short **ranked table** (item | benefit / horizon | currency | effort | evidence
  status | blocker) + a **plain-language recommendation**.
- Erez overrides.

## Notes
- **Run cadence:** run on demand. Promote to a `/roi` skill only if a *second* ROI pass is
  requested (YAGNI until then).
- **Self-check before presenting:** no step crosses units; every top-3 benefit driver cites a
  source read this session; the "needs a fix designed first" list is present and
  recurrence-ordered; blockers checked.
