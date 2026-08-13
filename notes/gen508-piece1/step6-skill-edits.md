# GEN-508 #6 — live-skill edits to apply AT STEP 6 (via `/vet-rule`)

These two edits touch **existing installed skills**, so they are drafted here as working copies and applied
at Step 6 together with the hook+`/vet-ticket` install (via `/vet-rule`, which runs `/check` on them).
**Nothing here is applied yet.** The single source of the probe procedure is the "Marker-liveness probe"
section in `vet-ticket-SKILL.md`; both edits below only *invoke* it — they do not restate the logic.

---

## Edit 1 — `~/.claude/skills/wrap/SKILL.md`: new `## Step 3d`

**Insertion point:** immediately after `## Step 3c — Self-audit-nudge readout + detector-review auto-file
(GEN-540 / GEN-507)` (its block ends at the "Never mutate the log …" line) and before `## Step 4 —
HISTORY.md`. It joins the Step 3b/3c detector-readout family.

```markdown
## Step 3d — Ticket-gate marker-liveness probe (GEN-508 #6)
**Guard:** run only if the ticket-gate hook is installed — grep `~/.claude/hooks/auto-approve.js` for
`enforceTicketVetting`. Absent → the gate is not live; skip this step silently (clean checkmark).
Run the `/vet-ticket` **Marker-liveness probe** (that skill holds the single definition — do NOT re-derive
the logic here): read both ids in the installed hook's `TEAM_TASKS_IDS`, `notion-fetch` them, and require
`{ the one live database's id } ∪ { its data-source id(s) }` to equal `TEAM_TASKS_IDS` exactly. Outcome ∈
{ MATCH, DIVERGENCE, LOOKUP-ERROR }; default to non-MATCH on any incomplete or failed read (never read
"couldn't check" as "all clear").
**Report** — one line, under a "Ticket-gate marker-liveness" sub-heading, only when the outcome is not MATCH:
- DIVERGENCE: e.g. `Ticket-gate marker-liveness: DIVERGENCE — live board data source <id> is not in the
  hook's TEAM_TASKS_IDS; the gate is silently un-watching that board until the hardcoded set is updated by
  hand (a separate /vet-code change).`
- LOOKUP-ERROR: e.g. `Ticket-gate marker-liveness: could NOT verify the board (<reason>) — treat the gate as
  unverified this session.`
- MATCH: the step gets only its checkmark in the roll-up (matching Step 3b/3c's convention).
**Traceability:** a non-MATCH is recorded in the Step 4 HISTORY.md entry body on its own line
(`Ticket-gate marker-liveness: <DIVERGENCE|LOOKUP-ERROR> — <one line>`), so it survives a session that ends
before Step 7, and it counts as "a note the steps require surfacing," forcing the full Step 7 report rather
than the all-clean fast-path. **Read-only** — this step never mutates `TEAM_TASKS_IDS` or any file.
```

**Step 7 interaction (no edit needed):** Step 7 already renders any "📌 For you" sub-heading line and the
all-clean fast-path (Step 3d's non-MATCH is "a note the steps require surfacing", already covered by Step 7's
"no other note … is pending" clause). Add Step 3d to the Step 7 roll-up label list only if the roll-up
enumerates steps explicitly — check at apply time.

---

## Edit 2 — `~/.claude/skills/vet-code/SKILL.md`: one-line pointer in `## Step 8 — Verify installed`

**Insertion point:** append to `## Step 8 — Verify installed`, right after the existing "Also confirm NO
valid vetting pass for this target remains … (that is the GEN-503 defer-instead-of-consume class)." sentence.

```markdown
**Ticket-gate hook only (GEN-508 #6):** if the installed target is `auto-approve.js` and it contains
`enforceTicketVetting`, also run the `/vet-ticket` **Marker-liveness probe** against the just-installed hook.
A `DIVERGENCE` or `LOOKUP-ERROR` is an install FAILURE — do NOT report the gate live; surface it and stop
(a gate that cannot confirm its own board must not be switched on). No-op for every other target. The same
probe is exercised pre-apply as a Step 4 live-verify case (MATCH today; plus deliberately-broken DIVERGENCE
and LOOKUP-ERROR inputs) and attested to Erez at Step 5, so the outcome reaches him both before and after
apply.
```

---

## Why these are `/vet-rule`, not part of the hook `/vet-code`

`vet-ticket-SKILL.md`'s probe section installs with the GEN-508 skill deliverable (the hook `/vet-code`).
These two edits change *other* installed skills' text (rule-like content), so they go through `/vet-rule`.
Bundle all of it into the single Step-6 change set so the hook, the `/vet-ticket` skill, the `/wrap` step,
and the `/vet-code` pointer land together — a hook-only or skill-only partial install is exactly the
"points at something unrunnable" hazard the ticket already records.
