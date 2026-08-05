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

Four tools are gated — `notion-create-pages`, `notion-update-page`, `notion-duplicate-page`,
`notion-move-pages`. They are the complete set that can create or materially change a Team-Tasks
**row**; the other six mutating Notion tools are scoped out with a per-tool reason in the `GEN-508`
header block in `~/.claude/hooks/auto-approve.js`.

**Do not try to predict the verdict from a field path.** The hook does not read one. It normalises the
whole payload (parsing any embedded JSON, unwrapping envelopes), then looks for a Team-Tasks id
*anywhere* in it, and resolves any remaining page id against the database. That is deliberate: two
earlier field-path versions each silently approved real traffic that put the parent somewhere else.
So a call is gated whenever it touches a Team-Tasks row, however the payload happens to be shaped —
including a move **out**, which de-lists a row and **drops every database property** (body kept), the
most destructive ticket write these tools can make.

NOT gated, and you do not need this skill for them:
- **Housekeeping-only property edits** — `Status`, `Assignee`, `Project`, `Type`, `Reason`,
  `Due Date`, `Remind me (days before)`, `Date Created`, `ID`, `Parent item`. Substance is a
  deny-list: anything NOT in that set counts as substance, so a renamed or new property is gated by
  default rather than silently exempt. The exemption is a closed shape — it applies only to a payload
  whose top level carries nothing but a page id, `command: "update_properties"`, and `properties`
  holding plain values. Anything else about the payload, recognised or not, is gated.
- **Content writes inside the GEN-58 subtree** — the GEN-58 ticket page and its log-volume child
  pages. A standing rule requires reasoning-failure log writes to happen immediately and exempts them
  from the approval pause. A **property** edit on the GEN-58 row is still a ticket-property edit and
  stays gated. (This replaces an earlier command-name rule that covered only 5% of real GEN-58
  writes.)
- Comments, views, attachments, and any page outside Team-Tasks.

**If a page cannot be resolved, the write is blocked, not waved through** (no token, Notion
unreachable, rate-limited, archived, or a target id that is malformed or missing). Minting needs no
Notion access, so the escape is one review plus one mint — not break-glass.

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
  "targets": [ { "target": "<see Step 5 target forms>", "contentHash": "<the line --ticket-hash printed>" } ],
  "reviewerAgentIds": ["<the agentId the Agent tool returned for EACH reviewer run>"],
  "verdict": "PASS",
  "capturedFindings": "<the reviewer's verdict block, copied in so the record is self-contained>",
  "noteResolutions": "<each note and how it was resolved>",
  "waived": false,
  "waiveReason": null,
  "draftedUtc": "<ISO-8601 UTC now>" }
```

### Getting the `contentHash` — never compute it yourself

**Do not reproduce the hash formula here.** Ask the hook for it. It hashes a *normalised* form of the
payload (embedded JSON parsed, single-key envelopes unwrapped, object keys sorted), and that
normaliser is ~100 lines. Any hand-rolled copy of it drifts, and a drifted hash means NO pass ever
matches and only break-glass gets a write through.

1. Write the exact payload you are about to send — the whole `tool_input` object, nothing omitted — to
   a temp `.json` file.
2. Run the hook's own hash mode:

```bash
node "C:\Users\Erez\.claude\hooks\auto-approve.js" --ticket-hash "<that temp .json file>"
```

3. It prints one line: the `contentHash`. Use it verbatim.

That exact invocation is auto-approved (it only reads a file and prints a hash), so it costs no
permission prompt. Both paths must be quoted, and nothing may be appended to the command.

**If it exits non-zero it prints no hash — then STOP and do not mint.** A non-zero exit means the
hook could not read that payload end to end, so it is going to hard-block the call whatever pass
exists. Re-issue the call in the ordinary shape instead of hunting for a pass.

Hash the payload, then send that same object unchanged. If you edit it afterwards — even a
whitespace change in the body — re-hash and re-mint.

Why the whole payload and not a chosen subset: an allow-list leaves every unlisted field unbound, and
the omitted ones were not cosmetic (`apply_template` hashed to a constant, and
`allow_deleting_content` permits deleting child pages).

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

**The hook matches on `contentHash` alone.** `target` is a human-readable label only — it appears in
the refusal message and the audit log, and getting it wrong costs nothing. Write something a person
can recognise: the ticket id, or `create in Team-Tasks`. (Earlier drafts made the hook derive a
canonical target string and match on it, which would have obliged this skill to reproduce the whole
scoping scan; that is now the hash's job.)

Get the timestamp from a read-only `(Get-Date).ToUniversalTime().AddMinutes(15).ToString("o")`
immediately before writing.

ONE pass file covers the whole approved batch. Consumption is per entry, keyed by `contentHash`: the
hook claims the file by renaming it, drops the entry whose hash matched, puts the survivors back
under the original name, and renames the file `*.consumed.<ts>` only when the last entry goes — so a
half-used batch pass still gates whatever it has not authorised yet.

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
- Re-run `--ticket-hash` on each payload and confirm it still prints the `contentHash` in the record
  (nothing edited since review). Re-running it, rather than trusting the recorded value, is the point.
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
