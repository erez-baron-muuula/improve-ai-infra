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
- **Housekeeping-only property edits** — `Status`, `Assignee`, `Project`, `Type`, `Reason`. **FIVE
  fields, not ten**: `Due Date`, `Remind me (days before)`, `Date Created`, `ID` and `Parent item` were
  moved to SUBSTANCE in the v8 hook and are gated. (Corrected 2026-08-05 — this list still named all
  ten, so it told you five gated edits were free. The hook fails closed, so the cost was a confusing
  refusal rather than an unreviewed write, but a skill that is looser than its gate sends you round a
  loop.) Substance is a deny-list: anything NOT in that set counts as substance, so a renamed or new
  property is gated by default rather than silently exempt. The exemption is a closed shape — it
  applies only to a `notion-update-page` call whose top level carries nothing but a page id,
  `command: "update_properties"`, and `properties` holding plain values (`icon`, `cover`, `is_skill`
  and `allow_async` may ride along). Anything else about the payload, recognised or not, is gated —
  and it is **tool-scoped**: the same shape sent to `notion-duplicate-page`, `notion-move-pages` or
  `notion-create-pages` IS gated, because a duplicate spawns a live ticket.
- **Content writes inside the GEN-58 subtree** — the GEN-58 ticket page and its log-volume child
  pages. A standing rule requires reasoning-failure log writes to happen immediately and exempts them
  from the approval pause. A **property** edit on the GEN-58 row is still a ticket-property edit and
  stays gated. (This replaces an earlier command-name rule that covered only 5% of real GEN-58
  writes.) The exemption reads the real payload shape: `update_content` carries its edits in
  `content_updates: [{old_str, new_str}]`, and **an edit whose `new_str` is empty or whitespace-only is
  gated wherever it sits in the payload** — emptying existing log text is not a log append.
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

## Step 1 — Draft the write, then hash it

Produce the exact payload that will be sent — properties and body for a create; the precise
`properties` object, `content`, `new_str`, or `content_updates` for an edit. For a Team-Tasks create
or a material body change, that includes `Urgency` and `Gain ratio`, and `Priority` derived from
them by the rule in `hooks/refs/notion.md` (a body append counts as material).

Hash it **now, before the review**. The reviewer has to end its verdict on this exact hash (Step 2),
and the hook reads that token out of the reviewer's own transcript — so a review run without the hash
in hand cannot clear the gate, however good the review was.

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

Hash the payload, then send that same object unchanged. If you edit it afterwards — even a whitespace
change in the body — **re-hash AND re-review**. Re-minting alone is not enough any more: the old hash
is baked into the old reviewer's token, so an edited payload has no reviewer token that matches and
the write blocks with `no-token`.

Why the whole payload and not a chosen subset: an allow-list leaves every unlisted field unbound, and
the omitted ones were not cosmetic (`apply_template` hashed to a constant, and
`allow_deleting_content` permits deleting child pages).

## Step 2 — Independent review

Spawn ONE `check-reviewer` sub-agent (Agent tool) that did not draft the ticket. Give it the drafted
payload in full, **the `contentHash` from Step 1**, and this checklist, and require the verdict block
below verbatim — including its machine-readable last line, which is the part the hook actually reads:

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
TICKET-REVIEW-VERDICT: PASS <contentHash>
```

**The last line is load-bearing and the hook verifies it in the reviewer's own transcript, not in
anything this skill writes.** Brief the reviewer on all four rules:

- It is the **final line** of its reply: `TICKET-REVIEW-VERDICT: PASS <hash>` or
  `TICKET-REVIEW-VERDICT: REVISE <hash>`.
- `<hash>` is the Step-1 `contentHash`, all 64 hex characters, copied verbatim. A wrong or truncated
  hash reads exactly like no review at all.
- The verdict word must agree with `STATUS`. The hook only accepts `PASS`.
- The reviewer must **not** write the prefix `TICKET-REVIEW-VERDICT:` anywhere else in that final
  reply — not when quoting this instruction, not when explaining itself. The hook takes the **last**
  occurrence, so a trailing mention overrides the real verdict and the write blocks.

**Where the hook looks, exactly** (realigned 2026-08-05 — it previously read wider than this, and the
description here read wider still): the reviewer's **final delivered reply** — the last assistant
message in its transcript that delivered any text, skipping harness-authored API-error records — and
within that message, the **last** occurrence of the prefix. Two consequences worth briefing:

- Only **delivered text** counts. A token that appears solely in the reviewer's internal reasoning, or
  in the arguments of a tool call it made, is not a verdict. So a reviewer *may* reason about the token
  format privately without breaking its own sign-off — but nothing it did not say out loud will clear
  the gate.
- Only the **final message** counts. A PASS delivered mid-review and then not repeated at the end is
  not a verdict. Brief the reviewer to sign off in its concluding reply, not along the way.

Why the token rather than the record's own `verdict` field: the hook's whole purpose is not to trust
this skill. The token establishes three facts at once that a skill-written field cannot — this agent
ran, it reviewed *this* content, and it returned PASS — and an unrelated reviewer's transcript carries
a different hash or none. If the token is missing, malformed, or not last, the write blocks with
`no-token`; that is the gate working, not a bug to route around.

`REVISE` → fix and re-review (a fresh agent), **re-hashing first if the payload changed**. If the bar
cannot be met because only Erez holds the missing information, STOP and consult him — inline if the
stuck ticket blocks the task he asked for, otherwise batched at the next natural pause.

## Step 3 — Resolve every note before filing

A `PASS` with notes does not file as-is. For each note, either amend the ticket or dismiss it with a
stated reason, and carry that resolution onto the card in place of the raw note. Notes are where a
reviewer parks a real problem without failing the ticket; an unresolved one must never ride along
inside an approval.

## Step 4 — Write the ticket-record

Write a **ticket-record** into `~/.claude-staging/ticket-passes/` (create the dir if missing). This
file is the audit trail, **not** the thing the hook reads — it carries no `expires`, so the hook's
pass scan skips it entirely. The Step-5 pass is what clears the gate, and every field the hook needs
has to be on that file, flat at its top level.

```json
{ "kind": "ticket-record",
  "target": "<see Step 5 target forms>",
  "contentHash": "<the line --ticket-hash printed>",
  "reviewerAgentId": "<the agentId of the reviewer whose PASS token binds this hash>",
  "priorReviewerAgentIds": ["<any earlier REVISE rounds, for the audit trail>"],
  "verdict": "PASS",
  "capturedFindings": "<the reviewer's verdict block, copied in so the record is self-contained>",
  "noteResolutions": "<each note and how it was resolved>",
  "waived": false,
  "waiveReason": null,
  "draftedUtc": "<ISO-8601 UTC now>" }
```

**One reviewer id, singular.** The hook verifies exactly one reviewer — that agent's sidecar
`agentType` and that agent's own PASS token — so `reviewerAgentId` names the reviewer whose token
binds the hash you are about to mint, which after a REVISE round is the LAST reviewer, not the first.
Earlier rounds go in `priorReviewerAgentIds`, which nothing enforces and which exists only so the
history is not lost.

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
{ "kind": "ticket",
  "surface": "notion-mcp",
  "contentHash": "<the 64-hex line --ticket-hash printed>",
  "reviewerAgentId": "<the same agentId as the record>",
  "verdict": "PASS",
  "waived": false,
  "target": "<human-readable label>",
  "expires": "<now + 15 min, ISO-8601 UTC>" }
```

**Flat, and one hash per file.** The hook reads `kind`, `contentHash`, `verdict`, `waived`,
`reviewerAgentId` and `expires` off the top level of this one file. Nesting any of them — inside a
`targets` array or anywhere else — means the hook never sees them: it finds no matching pass and
hard-blocks with `no-pass`, which looks identical to never having run a review at all. `surface` and
`target` are diagnostic only and are never matched on.

**The hook matches on `contentHash` alone.** `target` is a human-readable label — it appears in the
refusal message and the audit log, and getting it wrong costs nothing. Write something a person can
recognise: the ticket id, or `create in Team-Tasks`. (Earlier drafts made the hook derive a canonical
target string and match on it, which would have obliged this skill to reproduce the whole scoping
scan; that is now the hash's job.)

`verdict` and `waived` are a cheap pre-filter the hook applies before it opens the transcript — they
are not the authority and cannot substitute for the reviewer's token. A pass carrying
`verdict: "REVISE"` and no waive blocks with `bad-verdict`; one carrying `verdict: "PASS"` whose named
reviewer never emitted the token blocks with `no-token`.

Get the timestamp from a read-only `(Get-Date).ToUniversalTime().AddMinutes(15).ToString("o")`
immediately before writing.

**ONE pass file authorises ONE write.** The batch `targets[]` array and its partial-consumption
machinery are gone: the hook consumes a matched pass by renaming the whole file to
`*.consumed.<ts>`, so the first write it authorises retires it completely. A card list covering
several tickets therefore needs one pass file per ticket, each with its own hash and its own reviewer
token, written in the same approved moment.

Known cost, not a design claim: each of those files is a separate Write, so a multi-ticket card list
raises one prompt per ticket rather than the single prompt the batch pass used to give. Do not try to
recover the old behaviour by putting several hashes in one file — the hook cannot read them.

## Step 6 — The waive lane (Erez's per-case override)

When the reviewer holds findings that cannot be fixed and Erez wants it filed anyway: show him the
outstanding findings in plain terms and ask. On his affirmative, set `waived: true` + `waiveReason` +
the outstanding findings in the record, **and set `waived: true` on the pass as well** — the pass is
the only file the hook opens, so a waive recorded solely in the record blocks with `bad-verdict`. Then
mint normally; the mint prompt is his second, deliberate confirmation.

A waive is the ONLY path that skips the reviewer checks: on `waived: true` the hook verifies no
sidecar and looks for no token, so a waived pass needs no `reviewerAgentId` and Erez's explicit chat
answer is the entire evidence base. That is why it is per-write, and why it is never the answer to a
token that merely failed to match — re-review that instead.

**Declining the mint is NOT a waive**: it leaves the write blocked, which is the gate working. The
waive is scoped to this one write and never touches the global break-glass.

## Step 7 — Evidence precondition (run immediately before the mint write)

- `reviewerAgentId` is present and non-empty, unless `waived === true` — a pass citing no reviewer is
  not evidence.
- `~/.claude/projects/<project-slug>/$CLAUDE_SESSION_ID/subagents/agent-<id>.jsonl` and its
  `.meta.json` both exist; the sidecar reads `"agentType":"check-reviewer"`; and the minimum
  `timestamp` across all lines of the `.jsonl` is `<= draftedUtc`. Read `$CLAUDE_SESSION_ID` via the
  Bash tool (it is not exported to PowerShell), and find the `<project-slug>` folder by listing
  `~/.claude/projects/` for the one containing that session id — do not hand-derive the slug.
- **The token is present, correct, and the reviewer's last delivered word.** In that same `.jsonl`,
  find the LAST `"type":"assistant"` record that has a `text` block in `message.content` and is not
  flagged `isApiErrorMessage` — that is the reviewer's final delivered reply. Within that record's
  `text` blocks only (**not** its `thinking` blocks, **not** its `tool_use` arguments), confirm the last
  `TICKET-REVIEW-VERDICT:` occurrence reads `PASS <contentHash>` for this hash. This precondition must
  mirror exactly what the hook does, so failing it here costs a re-review instead of an unexplained
  block after the mint — and a *looser* check here is worse than none, because it reports agreement the
  hook will not honour. (Before 2026-08-05 this step said to scan all assistant records flat, which was
  looser than the hook is now.)
- Re-run `--ticket-hash` on the payload and confirm it still prints the `contentHash` in the record
  (nothing edited since review). Re-running it, rather than trusting the recorded value, is the point.
- `verdict === 'PASS'` **or** `waived === true`, checked on the pass file.
- Every note has a recorded resolution (Step 3).

Any check fails → REFUSE to mint; say what is missing and re-review rather than forcing it.

Residual, and narrower than the siblings' now that the token carries the hash: this establishes that a
genuine `check-reviewer` run in this session returned PASS for THIS content, which an agent id alone
never proved. What it still cannot show is that the review was *competent* — a lenient reviewer emits
PASS on a hollow ticket, and a reviewer handed a truthful hash can emit the token having barely read
the payload. Erez's card-showing mint-approval is the backstop.

## Step 8 — Apply, verify, and record the event

Issue the Notion call. The hook matches the pass on its hash, verifies the reviewer's token, consumes
the pass, and approves — no second prompt. Then:
- Confirm the write landed: re-fetch and check the key properties are what was requested (a `select`
  set at create time can silently not save — see `hooks/refs/notion.md`).
- Confirm the pass was consumed: its file is now named `*.consumed.<ts>`. A still-live `*.json` pass
  for this hash after a successful write is a FAIL, not a pass — retire it and investigate.
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

- A consumed pass is gone — re-mint (re-prompting Erez, re-showing the card) and retry the one call.
  The reviewer's token is still valid as long as the payload is byte-identical, so this needs no
  re-review.
- If the payload changed after the record was written, the hash will not match — re-hash AND re-review
  rather than forcing it. Re-minting alone cannot help: the new hash has no reviewer token behind it.
- If NO pass ever matches and the payload is unchanged, suspect a projection drift between this skill
  and the hook header. Do not paper over it with break-glass: fix the mismatch via `/vet-code`.
- Break-glass (`CLAUDE_CONFIG_UNLOCK=1`, or the `.config-unlock` sentinel + reaper token) skips the
  gate entirely — for a wedged session only, never routine. The OPEN/CLOSE commands are in
  `/vet-code` and `/vet-rule`; note it suspends the staging, vetting, check AND ticket gates at once,
  which is why the Step 6 waive exists as the per-case alternative.
