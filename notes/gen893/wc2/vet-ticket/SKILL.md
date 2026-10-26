---
name: vet-ticket
description: "Vet and file a Notion Team-Tasks ticket write (create, duplicate, move-in, body edit, or substance-property edit) through: draft, independent reviewer pass against the ticket bar, resolve every note, show Erez a summary card, mint the single-use ticket pass the auto-approve hook requires, apply, verify. Trigger on /vet-ticket, or when the auto-approve hook blocks a Notion write with a 'ticket-quality gate' refusal (except one that names the Notion practice page or a mismatched Notion connector id — see Scope). Invoke it yourself whenever a pending write is in this skill's gate scope (or the gate blocks one) — never ask Erez whether to activate it; his approval is the Step 5 card (or a Step 6 waive), not a yes/no on running the skill. Start it the moment you are about to propose a gated write — before any chat draft of the ticket or any 'should I file this?' — so its board search (Step 0b) and review run before Erez sees the proposal. Out-of-scope writes proceed directly."
---

# /vet-ticket — gated, independently-reviewed Team-Tasks ticket writes

A Team-Tasks create, duplicate, move-in or substantive edit is hard-blocked by `auto-approve.js`
(GEN-508) unless a valid, single-use **ticket pass** exists; this skill is the only sanctioned way to
mint one. What clears the hook is the independent reviewer's PASS token for this exact payload, not
the mint write. **The hook enforces the gate; this skill enforces the process.** Never hand-mint a
pass to skip the review.

**How to use this runbook.** Each step lists what must not be skipped; where it says "Before doing
this step, read `<file>`", open that file first on every run, even after a compaction. Rationale,
relationships and the honest ceiling: `background.md` in this folder. Editing this skill: keep this
file at 12,000 characters or fewer and under 500 lines (size checker, `/suggest` 4b); new detail goes in a reference
file.

---

## Scope — what is gated

Gated: `notion-create-pages`, `notion-update-page`, `notion-duplicate-page` and `notion-move-pages`
on a Team-Tasks row or on ANY page id the hook cannot match to an exemption (including a move out).
Not gated: housekeeping-only property edits, content writes inside the GEN-58 log subtree, comments /
views / attachments, plain-text edits of the Notion practice page, and `connector-mismatch` refusals
(no review can clear those two refusals; never run this skill for them). In scope → invoke this skill
yourself, never ask; out of scope → write directly.

Before deciding in or out, read `C:/Users/Erez/.claude/skills/vet-ticket/scope.md` — the single
source of the exact field lists and exemptions.

## The GEN-58 log-volume rollover lane (single writer of the exempt list)

Creating the next GEN-58 log volume. Write the urgent log entry to the current volume first; never
pause it for rollover. The lane's order is load-bearing: lane bar review → create → re-verify parent
over the network → append the id as 32 lowercase hex → confirm it registered → only then repoint
"current". Before running this lane, read `C:/Users/Erez/.claude/skills/vet-ticket/lanes.md`.

## The non-ticket lane (a gated write to a genuine non-Team-Tasks page)

Entered only after THIS session reads the target over the network and confirms its parent is not
Team-Tasks; any other outcome falls back to the full checklist. The reviewer checks only for
destructive keys and a move that de-lists a row. Before running this lane, read `C:/Users/Erez/.claude/skills/vet-ticket/lanes.md`.

## Marker-liveness probe — is the gate still watching the real board?

Run by `/vet-code` Step 8 (ticket-gate hook installs) and `/wrap` Step 3d. Outcome is MATCH,
DIVERGENCE or LOOKUP-ERROR; "couldn't check" is never "all clear". Before running it, read
`C:/Users/Erez/.claude/skills/vet-ticket/marker-probe.md` — the single definition.

---

## Step 0 — Gate self-check (fail closed)

Grep `~/.claude/hooks/auto-approve.js` for `enforceTicketVetting` and `findTicketPassFile`. Both
present → proceed. Missing → the gate has a hole: REFUSE, and tell Erez the hook must be fixed first
(via `/vet-code`).

Confirm the Agent tool and the `check-reviewer` sub-agent type are available. If they are not, STOP:
the evidence bar (an independent reviewer) cannot be met, so no pass may be minted. Do not degrade to
reviewing your own draft.

## Step 0b — Search for an existing home (before drafting a new ticket)

For a new ticket (create, duplicate, move-in) or a new finding on a ticket this session picked
itself, on the interactive and scheduled `/release-review` lanes: before drafting, and before Erez
sees any proposal, search the board for an open ticket (Review counts) covering the same behaviour
and root cause. Skip when Erez named the target or a search this session ran chose it, on the GEN-58 / non-ticket lanes, and on `/wrap`'s
unattended lane. Outcomes: confident match → append to it (or no write); a match that DECLINED this
work → ask Erez; no match → create; search failed → "could not check", never "no match". Write a
search summary for the reviewer, the record and the card.

Before doing this step, read `C:/Users/Erez/.claude/skills/vet-ticket/review.md` (Step 0b).

## Step 1 — Draft the write, then hash it

Draft the exact `tool_input` (a Team-Tasks create or material body change carries `Urgency`,
`Gain ratio` and the derived `Priority`). A create also sets the status actually true of it and its
assignee, and applies the template for its Type when one exists (the creation fields in
`review.md`). Write it to a temp `.json` file and get the hash from the hook, never by hand:

```bash
node "C:\Users\Erez\.claude\hooks\auto-approve.js" --ticket-hash "<that temp .json file>" --tool <create|update|duplicate|move>
```

Non-zero exit → STOP, do not mint. Any edit to the payload afterwards → re-hash AND re-review.

Before doing this step, read `C:/Users/Erez/.claude/skills/vet-ticket/review.md` (Step 1).

## Step 2 — Independent review

Spawn ONE `check-reviewer` that did not draft the ticket. Brief it with the full payload, the
`contentHash`, the lane, the Step 0b search summary, and the six-item checklist (stands on its own;
priority fields; named by outcome; right home; not a near-duplicate; parent via its own
`Parent item`). Its final delivered line must be `TICKET-REVIEW-VERDICT: PASS <contentHash>` (all 64
hex), with that prefix nowhere else in that final report. REVISE → fix, re-hash if changed, fresh reviewer. Only
Erez holds the missing information → write a consult file first, then ask him.

Before doing this step, read `C:/Users/Erez/.claude/skills/vet-ticket/review.md` (Step 2).

## Step 3 — Resolve every note before filing

Amend the ticket or dismiss each note with a stated reason, recorded in `noteResolutions`; a PASS
with an unresolved note never files.

Before doing this step, read `C:/Users/Erez/.claude/skills/vet-ticket/record-card-mint.md` (Step 3).

## Step 4 — Write the ticket-record

Write a `"kind": "ticket-record"` file (no `expires`) to `~/.claude-staging/ticket-passes/`.
`reviewerAgentId` is the LAST reviewer, whose token binds the hash; `source` and `lane` take only
their listed exact values and are never copied onto the pass.

Before doing this step, read `C:/Users/Erez/.claude/skills/vet-ticket/record-card-mint.md` (Step 4).

## Step 5 — Show Erez the card, then mint

The card is the only approval and the first time Erez sees the proposal: exactly four fields (title,
one-line summary, epic / parent, derived Priority), led by one line from the search summary; say so
when the reviewer's notes were substantive. A prior explicit approval stands only if the result stays
within it (a Step 0b switch to an append goes beyond it). `/wrap` Steps 1 and 3c and the scheduled
`/release-review` job show no card and have no waive. Run Step 7 first, then mint a flat
`"kind": "ticket"` pass (15-minute expiry) — one pass file per write.

Before doing this step, read `C:/Users/Erez/.claude/skills/vet-ticket/record-card-mint.md` (Step 5).

## Step 6 — The waive lane (Erez's per-case override)

Only on Erez's explicit chat affirmative after seeing the outstanding findings: `waived: true` on the
record AND the pass, no `reviewerAgentId`, `waiveReason` on the record only. Declining is not a
waive.

Before doing this step, read `C:/Users/Erez/.claude/skills/vet-ticket/record-card-mint.md` (Step 6).

## Step 7 — Evidence precondition (run immediately before the mint write)

The reviewer's transcript and `check-reviewer` sidecar are in THIS session's `subagents` folder,
earliest `timestamp` <= `draftedUtc` (you check this; the hook command does not); the hook's check
prints `ok`:

```bash
node "C:\Users\Erez\.claude\hooks\auto-approve.js" --ticket-verify "<that subagents dir>\agent-<id>.jsonl" --hash <contentHash>
```

A re-run `--ticket-hash` still matches; verdict PASS or waived; every note resolved. Any check fails →
REFUSE to mint.

Before doing this step, read `C:/Users/Erez/.claude/skills/vet-ticket/record-card-mint.md` (Step 7).

## Step 8 — Apply, verify, and record the event

Send exactly the hashed payload. Re-fetch and confirm the key properties; confirm the pass was
renamed `*.consumed.<ts>` (a still-live pass is a FAIL). Never append to the events log yourself.
Report a waive or decline in that turn's "📌 For you" block.

Before doing this step, read `C:/Users/Erez/.claude/skills/vet-ticket/apply-recover.md` (Step 8).

## Step 9 — Recovery

A consumed pass is gone: re-mint (re-showing the card) and retry; a changed payload → re-hash AND
re-review. A stuck `consume-failed` pass: delete the `*.json` by hand, re-mint. Break-glass clears
only `internal-error`, `unreadable-payload` and `connector-mismatch`; every other block is
unbreakable, and the Step 6 waive is the only way past it (`practice-page-plain-only` and
`consume-failed` have their own handling, above and in `scope.md`).

Before doing this step, read `C:/Users/Erez/.claude/skills/vet-ticket/apply-recover.md` (Step 9).
