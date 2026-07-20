# GEN-435 — Converged design v1: automate the vet-code checkpoint-2 antivirus-survival re-check

**Ticket:** [GEN-435](https://app.notion.com/p/39e6e495d07c8199a8e5c6757df22a8d) — "Automate the vet-code
antivirus-survival re-check at the next real trigger." Parent epic: GEN-86 (Improve AI Infra).

**Status when written:** design converged via `/check` (2 rounds, 3 lenses each). This is the design input
for the build; nothing is built yet. For Erez's approval before any code/prose is written.

**Chosen approach: Option A — per-change one-time scheduled task.** An earlier design (a new always-on
SessionStart hook + a new append-only queue + a new reader-owned mutable state file) was reviewed and
rejected by the panel for a state-file concurrency race, hard-coding SessionStart against Step 4a's
"Do NOT assume SessionStart," a too-weak file-existence survival signal, and — most decisively — being
net-new machinery when a simpler, already-running mechanism existed. Logged as a reasoning failure on
GEN-58 (Class D, 2026-07-20).

---

## What GEN-435 must do (goal, from vet-code Step 4a)

A **background-launch change** (spawns/detaches a process, drops-and-runs a script, or registers a
scheduled task) can pass every in-session check, install clean, and then be **quarantined by antivirus
minutes-to-days later** — silently killing it in production. vet-code Step 4a therefore requires a
**checkpoint 2**: re-verify the change's artifacts/effect survived after antivirus has had unbounded
real-world time. Today that re-check is carried **manually** by a Review ticket a future session must
remember to act on. GEN-435 removes that human-memory dependency.

---

## The design (Option A)

**No new hook. No new queue. No new state file. No settings.json change.** Instead, reuse the existing
one-time scheduled-task mechanism (`create_scheduled_task`, `fireAt`), which is already the established
idiom on this machine for exactly this kind of delayed follow-up (six one-time task folders live under
`~/.claude/scheduled-tasks/` today, including `gen430-avast-recheck`, which does this precise antivirus
re-check for one past change).

### The change is entirely in vet-code `SKILL.md` prose

1. **Step 4a wording (reconcile with reality).** Lines 244-245 currently promise GEN-435 will "ride the
   SessionStart surfacer." Rewrite that to describe the shipped mechanism: a per-change one-time `fireAt`
   scheduled task. State explicitly **why a wall-clock dwell timer satisfies checkpoint 2**: survival is
   trigger-agnostic — a quarantined artifact is gone regardless of what would have launched it — so a
   dwell-from-apply timer is a valid carrier of "survived unbounded antivirus time" for every trigger
   type (this is the panel's resolution of the "not the own trigger" objection; recorded so a future
   reader doesn't reflexively re-raise it).

2. **New Step 7/8 writer instruction.** For a background-launch change, **after Step 8 confirms the change
   is installed byte-identically** (NOT merely "after apply" — a half-applied change must not get a
   re-check task that would false-alarm), create a one-time `fireAt` scheduled task that:
   - **`fireAt` = now + dwell**, where **dwell is set from the recorded trigger's expected recurrence
     cadence** (default 24h for a per-session/daily-ish trigger; longer for a rare trigger like a
     weekly/monthly task) — so the check never closes out a change before its own trigger has realistically
     recurred. Where the trigger is rare, the prompt must **confirm the trigger actually recurred**, not
     just that time elapsed, before treating survival as conclusive.
   - carries a **fully self-contained prompt** (a future session has no memory of this one), embedding:
     the change summary, the **bare Notion page UUID** of its ticket (not a title/URL, which can drift on
     rename), the recorded real trigger, and the exact artifacts + downstream effect that must have
     survived.
   - **re-checks survival** the gen430 way: artifacts still present AND the downstream effect still holds
     (e.g. scheduled task still registered / backup ref still pushed) AND ask Erez whether any antivirus
     popup/quarantine occurred since apply AND scan the relevant durable failure queue.
   - **distinguishes a kill from a legitimate supersession**: if the artifact changed because a *later
     legitimate* vet-code pass superseded it (checkable against the vetting-pass record / git history),
     that is NOT a kill — do not propose a revert.
   - **on survived** → move the change's ticket Review→Done with a dated note.
     **on kill** → loud alert + propose reverting to the safe baseline; leave the ticket open.

3. **In-session enforcement so a skipped task-creation is caught (not silent).** Step 8 ("verify
   installed") refuses to report a background-launch change complete until the session **names the created
   scheduled task's id + fireAt time**. This is the cheap, hook-free enforcement that closes the one gap
   Option A would otherwise leave (a future session forgetting to create the task) — without reintroducing
   the rejected hook/queue/state-file. Combined with the `create_scheduled_task` approval dialog (a
   real-time forcing function Erez sees at creation) and Step 5's existing "attest next-trigger survival
   PENDING" requirement, the omission is now caught synchronously in the same session.

### What is gated

GEN-435 itself ships **zero gated code** — the only change is vet-code `SKILL.md` prose, which is not a
gated vet-code target (the gate covers `hooks/*.js`, `scripts/*.ps1`, and the settings.json hooks section
only — verified against the skill's own Scope section). So GEN-435 does **not** itself need a `/vet-code`
run. (The per-change scheduled tasks it later causes to be created are data/skill-folders, not gated code.)

---

## Honest residuals (accepted, or to confirm with Erez)

1. **The writer step is still prose a session must execute.** The Step 8 enforcement + approval dialog +
   Step 5 attestation make a *skip* non-silent within the session, but if a session never reaches Step 4a
   at all (skips the whole background-launch classification), the mechanism is skipped. This is a genuine
   ceiling of a prose-driven process and is not fully closed by any option short of gating vet-code's own
   classification — out of scope here. **Surface to Erez in plain terms.**
2. **Dwell (24h default) is not derived from measured Avast latency.** The one real incident killed within
   minutes (well inside 24h), but there is no vendor-confirmed upper bound; idle/scheduled scans can lag.
   Reasonable default, not proven-sufficient — flagged, not hidden.
3. **SKILL.md prose is ungated** — future edits to this safety-critical paragraph escape `/check` +
   code-review. Not a new exposure (all of Step 4a is already ungated prose), but noted.
4. **Scheduled-task folders accumulate** (one per background-launch change, never auto-deleted; fired tasks
   flip to `enabled:false`). Already-tolerated pattern; periodic cleanup if volume grows.
5. Once GEN-435 lands, it **removes the manual carry** that currently blocks routine background-launch
   changes — which is what unblocks GEN-487 to be built next without a manual antivirus-check burden.

---

## Self-verification note (GEN-435's own vet)

GEN-435 ships as SKILL.md prose (ungated), so it needs no `/vet-code` run of its own. But the FIRST time a
background-launch change goes through the revised Step 7/8 after this lands, that change's re-check task is
the live proof the new mechanism works end-to-end — i.e. GEN-435 gets exercised by the next real
background-launch vet, which is the natural verification point.
