# GEN-223 Phase 2 — Consolidated design (rev 5)

> **DEFERRED (June 2026) — not the active plan.** Erez chose a manually-triggered review
> instead of this automatic gate. This design is preserved for possible future revival;
> see `DECISION.md` for what was chosen, why, and the revisit-trigger. Read this only if
> reviving the automatic-gate approach.

Status: **design only — not built.** Rev 2: first review (cost premise, calibration,
over-built cloud pipeline) + session-start decision. Rev 3: second review (shadow-audit
→ occasional; cost-gate baseline → Phase-1-as-built; liveness/fire-drill retriggered at
turn-end). Rev 4: third review — corrected the self-detection limit (a dead gate can't
report its own death; only a gate-independent path catches it), honest residual,
shadow-audit as low-cadence (no independent drift signal exists), Sonnet-cost marked as
an assumption, and added the independence + fire-drill-drive verifications. Rev 5: fourth
review — acknowledgement now condition-cleared (a dead-guard alert can't be skimmed away),
fire-drill output excluded from real signals, fire-drill added to the recursion check,
escalation-rate sample must span the session mix, observer-hook common-mode limit stated,
and the stale "on-demand" shadow-audit wording reconciled.

## How this extends the locked design

Locked GEN-223 Phase 2 was reliability-only (logging + heartbeat + decay
tripwires + fire-drill). This widens it to also address per-reply cost/latency.
**The ticket's "Build phasing" needs updating to reflect this — to be drafted for
Erez's approval, not edited unilaterally.**

---

## Goals (reframed honestly after review)

1. **Reduce the cost and wait on the common path** — most replies need no review,
   and shouldn't pay for deep reasoning. NOT "stop paying on every reply": a gate
   still runs on every turn-end, and Phase 1 *already* bails cheaply on trivial
   turns. The honest target is "a cheaper/faster model on the common path, deep
   reasoning only when warranted" — **and only if a measurement shows this nets out
   cheaper** (see Cost gate).
2. **Be sure we'd notice if the guard dies or goes soft** — a silent guardrail is
   worse than none.

---

## Part 1 — Two-tier reviewer

### Shape (core — survived review intact)

- **Gate** (runs on every reply): a **presence-detector**, not a judge. Concrete
  yes/no: does this reply (a) propose/edit a rule, (b) recommend a course of action
  / a choice, or (c) flag it didn't fully deliver? Any → **escalate**; else → let
  the turn end. Designed as *easy detection* + **escalate on "yes or maybe."**
- **Deep reviewer** (only on escalation): the Phase-1 protocol (rule-check /
  pre-mortem / holistic) with its self-escalation valve.
- **Off-switch:** "skip review" bypasses. **Honest note:** this is an unenforceable
  string-match — it cannot tell low-stakes from high-stakes intent, so it is
  *guidance to Erez*, not a guard. Skips are **logged**, so a skipped-then-regretted
  turn is recoverable evidence.
- **Force-review + visible marker:** every answer carries a "reviewed / not
  reviewed" marker; Erez can force a review on a skipped turn. (This is also a
  primary reliability signal — see Part 2.)
- **Only quality dial = model** (effort is not settable via hooks — verified).

### Cost gate (NEW — the first review's blocker)

The two-tier is **not assumed to save money; it must be shown to.** Before building
Part 1 we measure:
- the deep reviewer's **marginal per-turn cost** (isolated from the main answer's
  cost — the earlier ~$0.06/$0.15 figures were *total turn* cost, mostly the main
  answer's cache, not the reviewer), and
- the **escalation rate** (what fraction of real turns the gate flags), obtained by
  running the gate over a sample of logged transcripts offline — using the same
  liberal "yes or maybe → escalate" threshold the live gate will use, so the cost
  estimate isn't biased low. The sample must **span the session mix** — escalation is
  highly session-type-dependent (a design-heavy session escalates on nearly every turn, a
  lookup session almost none) — and the verdict is **revisited if usage shifts**.

Then compare expected per-turn cost of **(Haiku-gate + escalation_rate × deep-review)**
against the **right baseline — Phase 1 as actually built**: the cheapest single model
that holds quality, which *already* fast-bails on trivial turns. (Comparing against a
naive "biggest model on every turn" would rig the result in the two-tier's favour.)
Decision rules:
- If the two-tier doesn't beat that real baseline, **don't build it** — just keep
  Phase 1 on the cheapest model that holds quality.
- The deep-reviewer model (Sonnet vs Opus) is itself a knob set by this arithmetic:
  Opus is sharper but **more expensive per deep review than Sonnet**, so "Opus on
  escalation" only makes sense if escalations are rare enough. Default assumption:
  Opus on the rare deep path, Sonnet-deep compared as the cheaper alternative.

**Latency, honestly:** the gate adds a model round-trip to *every* turn-end (smaller
than today's on the common path, since Haiku < Sonnet); escalated turns run gate +
deep review **in series**, so they are *slower* than a single Phase-1 pass. Net win
is "common path a bit faster, rare path slower," not "faster overall."

### Gate-model validation (NEW approach — replaces live full-coverage calibration)

The first review showed the old plan (run Haiku + Opus on *every* live turn, target
95% recall) was self-defeating (Opus-on-every-turn = the cost we're killing) and
measured the wrong thing (model-vs-model agreement is blind to shared misses, and a
95% recall bar is unmeasurable at one-user volume). Replaced with:

- **Primary signal = the forced-review log (real, human-confirmed misses).** When
  Erez forces a review the gate skipped and it finds a material issue, that's a
  *confirmed* gate miss — ground truth. This is the bar for "is the gate safe,"
  not model agreement.
- **Truth check = an *occasional* shadow-audit, NOT an always-on backbone.** Running
  the full reviewer (observe-only, doesn't block) on skipped turns is the *only* way
  to measure misses the forced-review log can't see — but running it continuously
  would re-spend exactly what the two-tier saves, to measure a residual we've already
  agreed to accept. So it's a **low-cadence standing diagnostic** — a small batch run
  occasionally — not an always-on backbone. (Purely "on-demand when we suspect drift"
  doesn't actually work: the correlated-miss class it targets has no *independent*
  signal that would tell us to look — the audit *is* that signal — so a low cadence is
  what really covers it.) **Size each batch by statistical power** when run (at one-user
  volume a too-small batch detects nothing).
- **Cheap pre-filter = offline Haiku-vs-reference agreement,** run by **replaying
  logged transcripts offline** (free, no live cost). It answers only the weak
  question "does Haiku keep up with a stronger model on easy detection?" — a sanity
  check, explicitly *not* the safety bar.
- **Model choice is binary:** start **Haiku**; if the forced-review log / shadow-audit
  show it missing real proposals, move to **Sonnet** (*assumed* cheap-enough-to-run-
  always — to be confirmed by the cost gate, not presumed). If even Sonnet isn't enough, that's a signal to **re-examine the gate's
  task design before** reaching for a bigger model — though it's *possible* the
  detection task is genuinely hard (e.g. "did this under-deliver?"), so this is a
  prompt to re-think, not an automatic verdict. No Haiku→Sonnet→Opus ceremony.

### Known residual (named, not solved)

Model-vs-model comparison can't see misses *both* models share (same family →
correlated errors). That's exactly why the **event-driven forced-review log** (plus the
**low-cadence shadow-audit**), not agreement, are what we rely on. Residual after those:
a miss that neither Erez nor an occasional audit happens to catch — bounded, accepted
for a personal tool.

---

## Part 2 — "Is it working?" (surfaced at session start — much leaner)

Erez's decision: surface the guard's findings **every time he opens a new session**,
not via a passive log he must check, nor a cloud routine. Because the *reader* is now
the local session at startup, this **eliminates** the cloud routine, the cloud log,
the write-from-the-local-machine dependency (and its TLS workaround), and the standing
autonomous ticket-creation grant — the three pieces the first review called over-built.

### Mechanism

- The guard writes its signals to a **simple local log** (same machine): confirmed
  gate misses (forced reviews that found something), a liveness tick per gate fire
  (timestamp + Claude Code version + **which model id actually fired**), and
  fire-drill results.
- **At session start**, a session-start check (a `SessionStart` **hook** — preferred; a
  startup instruction would itself be an unenforced guard, see verification 6) reads that
  local log and, if anything is pending/unacknowledged, surfaces it at the top of the
  first reply: *"since last session: N possible gate misses / the guard hasn't fired
  since X / last fire-drill failed."* Silent when there's nothing. **Acknowledgement is
  condition-cleared, not display-cleared:** a *liveness* alert (guard dead / drill failed)
  keeps surfacing every session start until the underlying condition is actually resolved
  (the gate fires again / a drill passes) — merely showing it once must NOT clear it, or a
  dead-guard alert skimmed past on a busy morning would vanish, the exact silent failure
  Goal 2 exists to prevent. A *confirmed-miss* item clears once it becomes a ticket (its
  durable record).
- If something warrants action, I **propose a high-priority AI-infra ticket in-session**,
  created with Erez's normal approval (not auto-filed). The ticket is the durable
  work-record; the session-start surfacing is what guarantees he sees it.

### Liveness & sharpness checks

- **Liveness:** *honest limit first* — a fully-dead gate cannot report its own death (a
  dead component can't tick). So liveness detection must come from a path that does NOT
  share fate with the gate. Two such paths: (a) the **session-start check** (an
  independent event — but only fires on a new session), and (b) optionally a **separate
  tiny command hook** that ticks every turn-end independently of the agent gate, so if
  the gate's *own logic* dies while the hook runner still works, the missing gate-tick is
  visible mid-session (honest scope: common-mode failures — a bad `settings.json` edit, a
  Claude Code version bump, the hook runner itself breaking — kill this observer too, so
  it tightens only the narrow "gate logic broke, hooks still run" slice). Each tick records timestamp + Claude Code version + **which model id
  fired**, so the *silently-swapped-but-still-firing* gate is caught too — not just the
  fully-dead one. Net: swapped-but-alive → caught at turn-end; fully-dead → caught at
  next session start (or, only for the narrow "gate logic broke, hooks still run" case,
  by the separate observer hook if we add it).
- **Fire-drill (sharpness):** periodically plant a deliberately-flawed proposal in a
  throwaway session and confirm it's caught — and **rotate the planted flaw across all
  three categories** (rule / course-of-action / under-delivery), since one fixed drill
  can be "passed" by a gate that only still catches that one shape. The drill must
  also confirm it exercised the **gate → deep-review hand-off**, not just a gate "yes."
  A single fixed test does NOT prove the whole chain — it proves one flaw class is
  caught on the day it ran. Cadence: at most once per day, **triggered by elapsed time
  evaluated at turn-end** (NOT session start) — so it still fires inside a long-lived
  session and isn't defeated by never opening a new one. The drill's sub-session output
  is **tagged and excluded** from the real liveness/miss signals — its gate-fires must
  not count as real liveness ticks, nor its planted flaw as a real confirmed miss.

### Honest residual

*Surfacing* to Erez is primarily at session start (plus inline at turn-end when
something urgent is detected). The honest bound: a **swapped-but-alive** gate is caught
at turn-end; a **fully-dead** gate can only be caught by a gate-independent path — the
session-start check — so in a long-lived session a fully-dead gate goes unnoticed
**until the next session start**, which could be far off. (A separate turn-end observer
hook would tighten this; deferred unless that bound proves too loose.) The only truly
unbounded sliver is the *whole hook system* dead **and** no new session for a long time
— rare, and an unused guard on an unused session causes no harm. Named and accepted.

---

## Deferred decisions (set with real data)

- Whether the two-tier earns its keep (the Cost gate above) — **gates the Part 1 build.**
- Deep-reviewer model (Sonnet vs Opus), from the same arithmetic.
- Whether to move the gate Haiku→Sonnet (from the forced-review log / shadow-audit).
- Shadow-audit sample rate (sized by statistical power) and fire-drill cadence.

## Wiring choice (decide after verification)

- **Preferred:** reuse the agent-hook + sub-agent machinery — gate = a cheap agent
  hook; escalation routes the deep review via the existing NEEDS-DEEP-REVIEW valve.
- **Fallback:** a command-hook wrapper (sturdier vs the experimental-hook risk) if the
  in-hook hand-off proves unreliable.

## Platform verifications owed BEFORE any build

1. **Cost measurement** (deep-review marginal cost + escalation rate) — gates whether
   Part 1 is worth building at all.
2. The gate → deep-reviewer **hand-off** fires reliably (escalation loop, end-to-end).
3. **Recursion / self-exclusion:** the gate's, the deep reviewer's, the shadow-audit's,
   **and the fire-drill sub-session's** own turns do not re-trigger the gate; confirm no
   loop and how it interacts with the platform's 8-consecutive-block backstop.
4. **Haiku works as the gate model** (fires as an agent hook; correct model-id form —
   recall the `sonnet` alias was silently dropped; full id required).
5. The **off-switch** behaves in real interactive use.
6. The **session-start check** fires and can read the local log (and degrades quietly
   if the log is missing). Prefer a `SessionStart` **hook** over a startup
   *instruction* — an instruction is itself an unenforced guard, which would defeat the
   "be sure we'd notice" goal.
7. **Liveness-observer independence:** the liveness/fire-drill check runs in a path that
   does NOT share fate with the gate (the session-start check, and/or a separate cheap
   command hook) — a dead component can't report its own death, so a fully-dead gate
   must be detectable from outside it.
8. **Fire-drill drive:** confirm a hook (or an independent trigger) can actually spawn a
   throwaway sub-session (e.g. `claude -p`) with the gate config and read back its
   verdict — the drill mechanism is non-trivial and currently unspecified.

## Ticket status

GEN-223 stays **In Progress**: Phase 1 built & verified in scratch; Phase 2 designed
(this doc), not built; Phase 1.5 (claim-trigger) still pending.
