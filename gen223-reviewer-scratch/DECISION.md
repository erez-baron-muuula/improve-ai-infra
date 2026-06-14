# Decision record — review automation: manual-trigger over the automatic gate

**Decision (June 2026):** Adopt a **manually-triggered** "review until convergence"
capability. Do **not** build the automatic Stop-hook reviewer (the GEN-223 auto-gate) at
this time. The automatic-gate work is **deferred, not discarded** — fully documented here
and in the sibling files so a future session can act on it cold.

---

## What we chose: manual-trigger

A user-invoked "answer + review until convergence" (and a retroactive "review that last
answer"). One command runs the three review questions — rule-check / pre-mortem / holistic
— and iterates to convergence for you, using the existing reviewer protocol and stop-rule
(only *material* findings block; cap then escalate). **No Stop hooks, no gate, no
always-on machinery.** Depth scales to the task: a quick single pass for small things, the
full independent-panel-until-convergence (as demonstrated live in the June 2026 session)
for big design/rules work.

**Build spec (cold-start plan to build this): `BUILD-manual-review.md`** in this folder —
what to reuse, the convergence discipline learned this session, and the open build-time
decisions.

### Why
- It automates Erez's **original, literal** GEN-223 pain — repeating the three questions
  and iterating to convergence by hand. One command now does that.
- It dissolves the entire hard/fragile apparatus the auto-gate required: per-reply cost &
  latency, cheap-gate calibration, miss-rate measurement, heartbeat / fire-drill
  reliability, and the **experimental Stop-hook dependency.**
- It's simple, robust, and already proven — the review-until-convergence loop was run by
  hand in this session.

### The trade-off accepted (the one real loss)
Manual triggering makes **"no review" the default**, so it only catches what Erez *thinks
to flag*. It will **not** catch errors he doesn't recognize — which was the deepest value
of an automatic gate. (Same self-defeating property as the "skip review" off-switch.)
Erez judged that automating the *labor* is enough; catching *unflagged* errors is not a
current requirement.

---

## What we passed on (preserved for future revival): the automatic gate

A Stop-hook reviewer that fires on every turn-end and decides — without being asked —
whether to run the three questions to convergence, sending the assistant back to fix a
flawed answer.

Preserved artifacts, all in this folder unless noted:
- **Phase 1 — built & sandbox-verified** (single-model reviewer): `.claude/settings.json`
  + `reviewer-prompt.txt`, documented in `README.md`. Verified firing/PASS/REVISE/
  ESCALATE/off-switch via headless `claude --settings`.
- **Phase 2 — design converged, NOT built** (two-tier cheap-gate + sharp reviewer, plus a
  session-start reliability layer): `PHASE2-DESIGN.md` (rev 5). Converged through five
  independent-review rounds; carries its own list of platform verifications + a cost-gate
  measurement that could itself conclude "don't build it."
- **Canonical ticket:** GEN-223 (Notion Team-Tasks).

## When to revive the automatic gate (the revisit-trigger)

Revive it if, in practice, **meaningful errors slip through because Erez didn't think to
trigger a review** — i.e. the coverage gap above actually bites. At that point:
1. Start from `PHASE2-DESIGN.md` (build-ready pending its owed verifications), and/or the
   working Phase-1 build as a simpler fallback.
2. Re-run the cost-gate measurement first — it may still say the two-tier isn't worth it,
   in which case the Phase-1 single-model gate on a cheap model is the fallback.

## Key reasoning lesson from the design process (for whoever revisits)

The auto-gate's entire complexity existed to answer one question — *"when should review
fire, automatically, cheaply, without missing things?"* The manual-trigger decision
dissolves that question by letting the human decide *when*. If you're reviving the
auto-gate, that means you've decided the human-decides-when answer is no longer good
enough — design accordingly.
