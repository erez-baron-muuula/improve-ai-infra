---
name: vet-ticket
description: "Vet and file a Notion Team-Tasks ticket write (create, duplicate, move-in, body edit, or substance-property edit) through: draft, independent reviewer pass against the ticket bar, resolve every note, show Erez a summary card, mint the single-use ticket pass the auto-approve hook requires, apply, verify. Trigger on /vet-ticket, or when the auto-approve hook blocks a Notion write with a 'ticket-quality gate' refusal."
---

# /vet-ticket — gated, independently-reviewed Team-Tasks ticket writes

Creating, duplicating, moving-into, or substantively editing a Notion **Team-Tasks** ticket is
**hard-blocked** by the `auto-approve.js` PreToolUse hook (GEN-508) unless a valid, single-use
**ticket pass** exists. This skill is the ONLY sanctioned way to mint one: it drafts the write, has
an **independent reviewer** judge it against the ticket bar, resolves every finding, shows Erez a
summary card, mints the pass on his approval (the mint write itself prompts him — that prompt IS the
gate), applies, and verifies.

**The hook enforces the gate; this skill enforces the process.** Never hand-mint a pass to skip the
review.

**Why the reviewer must be independent:** the failure this closes is not ignorance of the ticket
rules, it is *skipping the self-check under momentum* — so a self-certified check is worth nothing
here. The reviewer is a fresh sub-agent that did not draft the ticket.

**Relationship to `/vet-code` and `/vet-rule`:** third sibling on the same pass plumbing, with its
own evidence bar. `/vet-code` guards code with runtime blast radius (two code reviews + live-verify);
`/vet-rule` guards prose whose risk is a wrong judgment (one converged `/check`); `/vet-ticket`
guards a *tracker write* whose risk is a ticket nobody can act on later (one independent reviewer
pass against a fixed checklist). Do NOT run this skill for a hook/script edit (`/vet-code`) or a
rule/skill edit (`/vet-rule`).

The three skills share near-identical record + pass JSON shapes, on-disk transcript verification, and
single-use apply/consume/recovery mechanics. If you change that shared machinery in any one of them,
port it to the others and diff the copies before finalizing — each gate reviews only its own file's
edit, so cross-file consistency is a manual step.

**Honest ceiling (state it, don't oversell):** the pass proves an independent review RAN on this
exact content and returned PASS (or that Erez knowingly waived it). It cannot prove the review was
*competent* — a lenient reviewer passes a hollow ticket, and since Erez approves a summary card
rather than the body, nothing downstream re-reads the text. Erez's mint-approval and the "show me
the body" escape are the backstops. The shared break-glass (`CLAUDE_CONFIG_UNLOCK=1` /
`.config-unlock` sentinel) skips the gate outright, as with the sibling gates.

---

## Scope — what is gated

Gated (the hook's five arms — see the `GEN-508` header block in `~/.claude/hooks/auto-approve.js`):

| Arm | Tool | Condition |
|-----|------|-----------|
| A1 create | `notion-create-pages` | `parent` is the Team-Tasks data source / database |
| A2 property edit | `notion-update-page` | `update_properties` touching any **substance** key |
| A3 body edit | `notion-update-page` | any command except `update_properties` / `update_verification` |
| A4 duplicate | `notion-duplicate-page` | the SOURCE page is a Team-Tasks row |
| A5 move | `notion-move-pages` | `new_parent` is Team-Tasks (move **in**) **or** any moved page is a Team-Tasks row (move **out**) |

Move-out is gated because moving a row to a non-database parent de-lists it and **drops every
database property** (body kept) — the most destructive ticket write these tools can make.

NOT gated, and you do not need this skill for them:
- **Housekeeping-only property edits** — `Status`, `Assignee`, `Project`, `Type`, `Reason`,
  `Due Date`, `Remind me (days before)`, `Date Created`, `ID`, `Parent item`. Substance is a
  deny-list: anything NOT in that set counts as substance, so a renamed or new property is gated by
  default rather than silently exempt.
- **Append-only GEN-58 log writes** (`insert_content` / `insert_content_after` on the GEN-58 page).
  A standing rule requires those to happen immediately and exempts them from the approval pause. A
  non-append rewrite of that page is still gated.
- Comments, views, attachments, and any page outside Team-Tasks.

Known gaps, stated so they are not mistaken for coverage: **raw REST/curl writes to
`api.notion.com`** and **all Jira writes** are outside this gate (piece 2). REST Notion writes are
still forced to an interactive `ask` by `notion-schema-guard.js`, and Jira content edits still need a
staging pass, so neither runs silently — but neither is held to the ticket bar.

---

## Step 0 — Gate self-check (fail closed)

Grep `~/.claude/hooks/auto-approve.js` for `enforceTicketVetting` and `findTicketPassFile`. Both
present → proceed. Missing → the gate has a hole: REFUSE, and tell Erez the hook must be fixed first
(via `/vet-code`).

Confirm the Agent tool and the `check-reviewer` sub-agent type are available. If they are not, STOP:
the evidence bar (an independent reviewer) cannot be met, so no pass may be minted. Do not degrade to
reviewing your own draft.

## Step 1 — Draft the write

Produce the exact payload that will be sent — properties and body for a create; the precise
`properties` object, `content`, `new_str`, or `content_updates` for an edit. For a Team-Tasks create
or a material body change, that includes `Urgency` and `Gain ratio`, and `Priority` derived from
them by the rule in `hooks/refs/notion.md` (a body append counts as material).

## Step 2 — Independent review

Spawn ONE `check-reviewer` sub-agent (Agent tool) that did not draft the ticket. Give it the drafted
payload in full and this checklist, and require the verdict block below verbatim:

1. **Stands on its own** — could someone with no memory of this conversation act on it? Problem and
   why it matters; the background needed to execute (file paths, ids, links, prior decisions); the
   concrete next action or acceptance criteria; who verifies it where that matters. Scale to
   complexity — a one-line fix needs only enough of each.
2. **Priority fields** — `Urgency` and `Gain ratio` both set, and `Priority` correctly derived from
   them (Not-urgent: Gain 1 → High, 2 → Medium, 3 → Low; Urgent: Gain 1 → Highest, else High).
3. **Named by outcome**, not by a presumed solution or technology.
4. **Right home** — routed by the domain the problem belongs to, not by who will fix it.
5. **Not a near-duplicate** — search the tracker for the underlying issue (behaviour + root cause,
   not just the title). If a confident open match exists, say so and propose merging instead. Read
   the matched ticket's body: work an open ticket has explicitly DECLINED is a stronger stop than a
   duplicate.
6. **Parent set** via the ticket's own `Parent item`, never the inverse relation.

```
---VERDICT---
STATUS: PASS | REVISE
FINDINGS: (numbered; each = the flaw + a concrete fix. "none" if PASS.)
NOTES: (non-blocking observations; or "none")
```

`REVISE` → fix and re-review (a fresh agent). If the bar cannot be met because only Erez holds the
missing information, STOP and consult him — inline if the stuck ticket blocks the task he asked for,
otherwise batched at the next natural pause.

## Step 3 — Resolve every note before filing

A `PASS` with notes does not file as-is. For each note, either amend the ticket or dismiss it with a
stated reason, and carry that resolution onto the card in place of the raw note. Notes are where a
reviewer parks a real problem without failing the ticket; an unresolved one must never ride along
inside an approval.

## Step 4 — Write the ticket-record

Write a **ticket-record** into `~/.claude-staging/ticket-passes/` (create the dir if missing):

```json
{ "kind": "ticket-record",
  "targets": [ { "target": "<see Step 5 target forms>", "contentHash": "<sha256 of the projection>" } ],
  "reviewerAgentIds": ["<the agentId the Agent tool returned for EACH reviewer run>"],
  "verdict": "PASS",
  "capturedFindings": "<the reviewer's verdict block, copied in so the record is self-contained>",
  "noteResolutions": "<each note and how it was resolved>",
  "waived": false,
  "waiveReason": null,
  "draftedUtc": "<ISO-8601 UTC now>" }
```

**The content hash must match the hook's exactly** — the definition lives in the `GEN-508` header of
`auto-approve.js` and this skill cites it; if the two ever drift, NO pass will match and only
break-glass gets a write through.

It is `sha256` (hex, UTF-8) of `stableStringify(<the entire tool_input you are about to send>)` —
every arm, no per-arm projection, no field omitted. Deliberately not a hand-picked subset: an
allow-list leaves every unlisted field unbound, and the omitted ones were not cosmetic
(`apply_template` hashed to a constant, and `allow_deleting_content` permits deleting child pages).
So hash the exact payload object, then send that same object unchanged — if you edit it afterwards,
re-hash and re-mint.

`stableStringify` is defined at `auto-approve.js:829` (arrays keep order, object keys sorted,
`undefined` → `null`). Reproduce it exactly, or shell out to a node one-liner that inlines those six
lines, rather than approximating it — a mismatch fails closed but costs a wasted mint to discover.

## Step 5 — Show Erez the card, then mint

Show a **summary card per ticket — not the body** (Erez's instruction, 2026-08-02): title; one line
on what it is for; parent; the ticket IDs the draft cross-references (read out of the draft text —
Team-Tasks has no related-tickets relation, only `Parent item` and its inverse `Children`); the
properties (type, status, assignee, Urgency, Gain ratio, derived Priority); the reviewer's verdict
and every note with its resolution; and an offer to show the full body on request. Several pending
filings are shown together as one card list and approved in one action.

His approval means "file this", not "I endorse this wording" — the body's quality rests on the
reviewer. Say so once when the card list is unusually large or the reviewer's notes were substantive.

Then mint the **ticket pass** into `~/.claude-staging/ticket-passes/` with the Write tool. That dir
is outside `~/.claude`, so the write prompts him — **show the card content inline in that same
moment**, never a bare file-write dialog.

```json
{ "kind": "ticket", "surface": "notion",
  "targets": [ { "target": "<...>", "contentHash": "<...>" } ],
  "expires": "<now + 15 min, ISO-8601 UTC>" }
```

Target forms: `create:<data-source-id32>` · `duplicate:<source-page-id32>` ·
`move:<data-source-id32>` · `<page-id32>` for an edit. All ids dashless lowercase. Get the timestamp
from a read-only `(Get-Date).ToUniversalTime().AddMinutes(15).ToString("o")` immediately before
writing.

ONE pass file covers the whole approved batch. Consumption is per target: the hook removes the used
entry and renames the file `*.consumed.<ts>` only when the last one goes — so a half-used batch pass
still gates whatever it has not authorised yet.

## Step 6 — The waive lane (Erez's per-case override)

When the reviewer holds findings that cannot be fixed and Erez wants it filed anyway: show him the
outstanding findings in plain terms and ask. On his affirmative, set `waived: true` + `waiveReason` +
the outstanding findings in the record, and mint normally — the mint prompt is his second,
deliberate confirmation. **Declining the mint is NOT a waive**: it leaves the write blocked, which is
the gate working. The waive is scoped to this one write and never touches the global break-glass.

## Step 7 — Evidence precondition (run immediately before the mint write)

- `reviewerAgentIds` is present and **non-empty** — a record citing no reviewer is not evidence, and
  an empty array would let a "for EACH" loop pass vacuously.
- For EACH id: `~/.claude/projects/<project-slug>/$CLAUDE_SESSION_ID/subagents/agent-<id>.jsonl` and
  its `.meta.json` both exist; the sidecar reads `"agentType":"check-reviewer"`; and the minimum
  `timestamp` across all lines of the `.jsonl` is `<= draftedUtc`. Read `$CLAUDE_SESSION_ID` via the
  Bash tool (it is not exported to PowerShell), and find the `<project-slug>` folder by listing
  `~/.claude/projects/` for the one containing that session id — do not hand-derive the slug.
- Every `contentHash` still equals the current payload's projection (nothing edited since review).
- `verdict === 'PASS'` **or** `waived === true`.
- Every note has a recorded resolution (Step 3).

Any check fails → REFUSE to mint; say what is missing and re-review rather than forcing it.

Residual, same as the siblings: the agent ids are chosen by the session being vetted, so this proves
the cited transcripts are genuine reviewer runs in this session that pre-date the record — not that
those runs reviewed THIS text. Erez's card-showing mint-approval is the backstop.

## Step 8 — Apply, verify, and record the event

Issue the Notion call. The hook matches the pass, consumes the entry, and approves — no second
prompt. Then:
- Confirm the write landed: re-fetch and check the key properties are what was requested (a `select`
  set at create time can silently not save — see `hooks/refs/notion.md`).
- Confirm the pass entry was consumed. A still-live `*.json` pass entry for this target after a
  successful write is a FAIL, not a pass — retire it and investigate.
- Do NOT write the events log yourself for an ordinary filing. The hook already appends `approve`,
  `block` and `consume-failed` events to `~/.claude-staging/ticket-gate-events.jsonl` from inside the
  hook process, where the `Write` allow-list does not apply. A skill-side append to that path is
  outside the allow-list and would raise a SECOND permission dialog per ticket, on top of the mint —
  defeating the one-approval-per-card-list design. Record a **waive** or a **decline** by putting
  those fields in the ticket-record you are already writing at Step 4 (same dir, same single write);
  they need no separate file.

**Surfacing (do not skip — the signal is worthless unheard):** a **waive** or a **decline** is
reported as a line in that same turn's "📌 For you" block — immediately, not saved for a later
routine. Aggregate counts and a re-evaluate bar at `/wrap` are piece 3.

## Step 9 — Recovery

- A consumed entry is gone — re-mint (re-prompting Erez, re-showing the card) and retry the one call.
- If the payload changed after the record was written, the hash will not match — re-review rather
  than forcing it.
- If NO pass ever matches and the payload is unchanged, suspect a projection drift between this skill
  and the hook header. Do not paper over it with break-glass: fix the mismatch via `/vet-code`.
- Break-glass (`CLAUDE_CONFIG_UNLOCK=1`, or the `.config-unlock` sentinel + reaper token) skips the
  gate entirely — for a wedged session only, never routine. The OPEN/CLOSE commands are in
  `/vet-code` and `/vet-rule`; note it suspends the staging, vetting, check AND ticket gates at once,
  which is why the Step 6 waive exists as the per-case alternative.
