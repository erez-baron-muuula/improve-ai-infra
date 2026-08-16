---
name: vet-ticket
description: "Vet and file a Notion Team-Tasks ticket write (create, duplicate, move-in, body edit, or substance-property edit) through: draft, independent reviewer pass against the ticket bar, resolve every note, show Erez a summary card, mint the single-use ticket pass the auto-approve hook requires, apply, verify. Trigger on /vet-ticket, or when the auto-approve hook blocks a Notion write with a 'ticket-quality gate' refusal."
---

# /vet-ticket — gated, independently-reviewed Team-Tasks ticket writes

Creating, duplicating, moving-into, or substantively editing a Notion **Team-Tasks** ticket is
**hard-blocked** by the `auto-approve.js` PreToolUse hook (GEN-508) unless a valid, single-use
**ticket pass** exists. This skill is the ONLY sanctioned way to mint one: it drafts the write, has
an **independent reviewer** judge it against the ticket bar, resolves every finding, shows Erez a
summary card, mints the pass, applies, and verifies. What actually clears the hook is the independent
reviewer's verified PASS token (Step 2) — NOT the mint write, which under Erez's bypassPermissions mode
falls through silently and does not prompt, so it is no kind of gate on its own.

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
`.config-unlock` sentinel) does NOT skip this gate's content decisions — GEN-508 #4 scoped it to the two
mechanical blocks only (`internal-error`, `unreadable-payload`), logged and surfaced; see Step 9.

---

## Scope — what is gated

Four tools are gated — `notion-create-pages`, `notion-update-page`, `notion-duplicate-page`,
`notion-move-pages`. They are the complete set that can create or materially change a Team-Tasks
**row**; the other six mutating Notion tools are scoped out with a per-tool reason in the `GEN-508`
header block in `~/.claude/hooks/auto-approve.js`.

**Do not try to predict the verdict from a field path.** The hook does not read one. It normalises the
whole payload (parsing any embedded JSON, unwrapping envelopes), then scans for a Team-Tasks marker
*anywhere* in it. It makes **no network call and no database lookup**: when the payload carries a page
id it cannot match to an exemption, it treats that page as a ticket (in scope) rather than resolving
what the page actually is. That is deliberate — two earlier field-path versions each silently approved
real traffic that put the parent somewhere else, and the resolver that once phoned Notion was "the
collapse" this build removed. So a call is gated whenever it touches a Team-Tasks row — or any
unrecognised page id — however the payload happens to be shaped, including a move **out**, which
de-lists a row and **drops every database property** (body kept), the most destructive ticket write
these tools can make.

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
- **Content writes inside the GEN-58 subtree** — the GEN-58 ticket **row** (always, via the hook's
  hardcoded id) and each log-volume **child page once it has been registered** in the exempt list
  `~/.claude-staging/ticket-gate-exempt-pages.txt`. A standing rule requires reasoning-failure log writes
  to happen immediately and exempts them from the approval pause. **A volume child is NOT exempt until its
  id is in that list** — the hook reads the list but never writes it; **the GEN-58 rollover lane (below) is
  its single writer**, registering each new volume as it is created (the current volume is seeded at
  install). A **property** edit on the GEN-58 row is still a ticket-property edit and stays gated. (This
  replaces an earlier command-name rule that covered only 5% of real GEN-58 writes.) The exemption reads the
  real payload shape: `update_content` carries its edits in `content_updates: [{old_str, new_str}]`, and
  **an edit whose `new_str` is empty or whitespace-only is gated wherever it sits in the payload** —
  emptying existing log text is not a log append.
- Comments, views, and attachments — these go through other Notion tools entirely, not the four gated
  above. **There is no "any page outside Team-Tasks" exemption:** with no resolver, the hook cannot tell
  a non-Team-Tasks page apart, so a create/update/duplicate/move on ANY unrecognised page id is gated as
  a ticket (Stage 5, "every page is a ticket"). When the target genuinely is not a Team-Tasks row, clear
  it through the **non-ticket lane** below — never by asserting to the hook that it is out of scope.

**If the payload or its target cannot be read, the write is blocked, not waved through** — no token, a
malformed or missing target id, or an unreadable / over-cap exempt file. The hook makes **no Notion
call on any path**, so reachability, rate limits, and archived-state never enter into it; a block is
always about what the hook could read locally, never about Notion being up. Minting needs no Notion
access, so the escape is one review plus one mint — not break-glass.

Known gaps, stated so they are not mistaken for coverage: **raw REST/curl writes to
`api.notion.com`** and **all Jira writes** are outside this gate (piece 2). A raw REST Notion write is
NOT gated here and is not reliably stopped elsewhere either — `notion-schema-guard.js` covers the MCP
schema tool, not curl, and under Erez's bypassPermissions mode its `ask` would be discarded anyway — so
such a write CAN run silently until piece 2 wires this arm. Jira/Confluence content edits are separately
hard-blocked by the staging gate. Neither is held to the ticket bar.

---

## The GEN-58 log-volume rollover lane (single writer of the exempt list)

Reasoning-failure logs land on the **current** GEN-58 log volume (a child page), which rolls over every
~25 write-ups / ~60k chars into a new child page. Writes to the current volume are exempt (its id is in
`~/.claude-staging/ticket-gate-exempt-pages.txt`); **creating the next volume is a gated
`notion-create-pages` and is what brings you here.** This lane is the ONLY sanctioned way a new volume id
enters the exempt list — the hook reads that file but never writes it.

**Do not pause the urgent write for this.** Write the reasoning-failure entry to the *current* volume
first (it is exempt — no pause; slight overflow is not data loss), then run this lane as a separate,
non-urgent step to roll over. The urgent log write never waits on rollover.

When you roll over, run these steps **in this order** — the order is load-bearing:

1. **Lane evidence bar** (this REPLACES the Step-2 ticket checklist — a log volume is a plain child page
   with none of the Team-Tasks-row properties that checklist assumes). An independent `check-reviewer`
   still signs off, but against THIS bar: the title is `GEN-58 — Reasoning-failure instance log — Vol. N`
   for the next N; no volume with that number already exists; the payload carries no destructive key
   (`archived`, `in_trash`, `allow_deleting_content`); and `parent.page_id` is the GEN-58 row.
2. **Mint the create pass and create the volume.** Hash the create payload (Step 1, `--tool create`), have
   the reviewer sign off against the lane bar above (in place of Step 2's checklist), show Erez the card and
   mint (Step 5), and apply. Capture the **new page id** from the create result.
3. **Re-verify parentage over the network.** Re-fetch the newly-created page and confirm its ACTUAL parent
   is the GEN-58 row — do not trust the draft payload. A wrongly-registered id would un-gate content writes
   on whatever page it names, so this is what keeps the exempt list honest.
4. **Normalize, then append.** Reduce the new id to the hook's exact form — **32 lowercase hex, no dashes**.
   Notion returns dashed ids, and the hook's parser silently IGNORES any line that is not exactly 32
   lowercase hex, so a dashed append is a no-op that looks successful. Append that one line to
   `~/.claude-staging/ticket-gate-exempt-pages.txt` (a plain local file write — not gated).
5. **Confirm it registered.** Re-read the file and confirm the new id is present as a valid 32-hex line.
   Only now is the new volume actually exempt.
6. **Then repoint "current."** Update the GEN-58 index pointer to name the new volume as current **only
   after step 5 confirms it is registered.** Repointing before the append is confirmed makes the next
   reasoning-failure write target a volume the gate has not yet exempted — it hard-blocks, the exact pause
   this lane exists to prevent.

**Seed (install-time, done once):** the current volume's id must already be in the exempt list before the
gate goes live, or the first log write blocks. At install, read the then-current-volume id from the GEN-58
pointer and write it (normalized to 32 lowercase hex, no dashes) as the file's first line.

**If the exempt file is ever lost:** a *missing* file makes the current volume revert to needing a normal
`/vet-ticket` review (a pause, not a bypass) — re-seed the current volume id to restore. Only a *corrupt*
or over-cap file hard-blocks.

---

## The non-ticket lane (a gated write to a genuine non-Team-Tasks page)

Because the hook has no resolver, a `create` / `update` / `duplicate` / `move` on a page that is
genuinely **not** a Team-Tasks row still reaches this gate — Stage 5 treats every unmatched page id as a
ticket. Measured, that is ~1 page reference in 1,081, so it is rare; but it must not force the full
Team-Tasks ticket checklist onto a page that has none of the properties that checklist assumes. This
lane is the sanctioned way to clear such a write, and it is what the hook's Stage-5 comment means when it
says "/vet-ticket's non-ticket lane is what keeps that cost off Erez."

The review is still independent — never self-certified — but it judges a different, minimal bar:

1. **Lane evidence bar** (this REPLACES the Step-2 ticket checklist). An independent `check-reviewer`
   confirms two things and nothing more: (a) the target page is **not** a Team-Tasks row — it does not
   live in the Team-Tasks database and carries none of its ticket properties (the reviewer may
   `notion-fetch` the id to confirm; it runs off the hot path); and (b) the payload carries no
   destructive key — no `archived`, `in_trash`, `allow_deleting_content`, and no move that de-lists a
   row. If either cannot be confirmed, it is not a non-ticket write — fall back to the full Step-2
   checklist (or, for a move-out of a real row, treat it as the destructive ticket write it is).
2. **Then Steps 1 and 4–8 as normal.** Hash the payload (Step 1, with the matching `--tool` tag), have
   the reviewer sign off against the lane bar above in place of Step 2's checklist, ending on
   `TICKET-REVIEW-VERDICT: PASS <hash>` exactly as Step 2 requires, then write the record, show Erez the
   card, mint, and apply.

This lane attests the write is harmless to a non-ticket page; it never applies to a real Team-Tasks row
(that is the full checklist) and never to a destructive move-out.

---

## Marker-liveness probe — is the gate still watching the real board?

The gate recognises a Team-Tasks write ONLY by matching the payload against the two hardcoded ids in
`TEAM_TASKS_IDS` (`~/.claude/hooks/auto-approve.js`): the REST **database** id and the MCP **data-source**
(`collection://`) id. If the live board ever diverges from that pair — the data source is replaced and its id
rotates, or a second data source is added under the board — every write to it reads as out-of-scope and is
**silently approved, unreviewed, with no event-log row.** The §10 drift counter cannot see this (it measures
over-gating on *gated* writes; this is an under-gating escape that logs nothing), so this probe is the only
thing that catches it. It is **detection, not prevention**: it tells you the pair has diverged, but the gate
stays blind to that board until you update `TEAM_TASKS_IDS` by hand.

The probe runs **off the hot hook path** — the hook itself still makes no network call (that is "the
collapse"). It runs at two moments only: at install (below) and at each `/wrap` (Step 3d). It is a plain
read; nothing about it is gated.

**The procedure (the single definition; both callers run exactly this):**
1. Read BOTH ids in `TEAM_TASKS_IDS` from the **installed** hook `~/.claude/hooks/auto-approve.js` (grep the
   `const TEAM_TASKS_IDS = new Set([...])` line). That installed set is the single source of truth — keep no
   second copy of the ids here.
2. `notion-fetch` the two ids to find the live board. **Exactly one** must come back as a database
   (`metadata.type == "database"`); that is the board. (Zero databases → LOOKUP-ERROR if any fetch merely
   failed to reach Notion, DIVERGENCE if a clean fetch shows the id no longer names a database. Two databases
   → DIVERGENCE — the pair no longer describes one board plus its source.)
3. From that one live database, collect its `<data-source url="collection://…">` id(s), each normalised to 32
   lowercase hex, no dashes (the hook's `normNotionId` form). Require
   `{ the database's own id } ∪ { its data-source id(s) }` to **equal `TEAM_TASKS_IDS` exactly** — same
   members, no more, no fewer. An added data source, a removed one, or a changed one all break equality.
4. Decide the outcome:
   - **MATCH** — set equality held and the fetch was clean and complete. The gate is watching the real board.
   - **DIVERGENCE** — the fetch was clean but the sets differ (or step 2 saw zero/two databases as noted).
     Name what changed.
   - **LOOKUP-ERROR** — anything that means you could NOT prove a clean match: a fetch that throws, times out,
     is rate-limited, or returns a truncated / `has_more` / empty / data-source-tag-missing body. **This is
     the default — never read "couldn't check" as "all clear."**

(Optional cheap belt-and-suspenders: also confirm the live database's title contains `Team-Tasks`.)

**Install-time arm (companion to the "Seed (install-time, done once)" step above).** Right after the hook is
installed and the exempt file seeded, run the probe against the just-installed hook. On **MATCH**, report it
and finish the install. On **DIVERGENCE** or **LOOKUP-ERROR**, **STOP the install and tell Erez** — a gate
that cannot confirm its own board must not be switched on. `/vet-code` Step 8 carries the one-line pointer
that triggers this whenever the ticket-gate hook is (re)installed, and the result is attested to Erez at
`/vet-code` Step 5.

**Wrap-up arm.** `/wrap` Step 3d runs this probe every session-end (only when the gate is installed). MATCH is
silent; a DIVERGENCE / LOOKUP-ERROR becomes one line under a "Ticket-gate marker-liveness" sub-heading in the
"📌 For you" block and is recorded in the HISTORY entry so it survives the session.

**What this does NOT catch (say so; do not oversell):**
- A wholly separate *new* Team-Tasks board created elsewhere, with a different database id — the gate
  keys on id, so adopting a new board is a deliberate `TEAM_TASKS_IDS` edit, outside this probe.
- **A connector-UUID rotation.** The hook's four gated-tool names are built from a hardcoded
  `NOTION_MCP_PREFIX` (the Notion connector's UUID). If the connector is removed and re-added, it is
  minted a NEW UUID, so the live tool names no longer equal the hook's constants and `enforceTicketVetting`
  silently stops firing on every Notion write — yet this probe still reports **MATCH**, because the board
  ids it checks are unchanged. So a green probe is not proof the gate is live; it only proves the board
  pair is intact. Catching a rotation needs a separate check that the hook's `NOTION_MCP_PREFIX` still
  matches the connector id the live tools carry (deferred to the hardening ticket).

What it *does* catch, false-positive-free, is the known board's id pair rotating or gaining/losing a data
source.

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
node "C:\Users\Erez\.claude\hooks\auto-approve.js" --ticket-hash "<that temp .json file>" --tool <create|update|duplicate|move>
```

3. It prints one line: the `contentHash`. Use it verbatim.

That exact invocation is auto-approved (it only reads a file and prints a hash), so it costs no
permission prompt. Both paths must be quoted, the `--tool` tag must be exactly one of
`create` / `update` / `duplicate` / `move` (matching the tool you are about to call —
`update` for notion-update-page, `duplicate` for notion-duplicate-page, and so on), and nothing else
may be appended to the command. The tag is folded into the hash, so a record minted for one tool will
NOT clear the same payload under another (a duplicate spawns a live ticket, so an update record must
never be spendable on it).

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
   them **per the derivation table in `hooks/refs/notion.md`** (that ref is authoritative). The inline
   summary here — Not-urgent: Gain 1 → High, 2 → Medium, 3 → Low; Urgent: Gain 1 → Highest, else High —
   is a convenience copy; if it ever disagrees with the ref, the ref wins and this line is what needs
   updating.
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

**Before you write the pass, run the Step 7 evidence precondition.** Step 7 is numbered after this step
but executes first: it re-verifies the reviewer's transcript, token, and hash immediately before the
mint. Minting first risks an unexplained hard-block after the write, when a failed precondition here
costs only a re-review.

Then mint the **ticket pass** into `~/.claude-staging/ticket-passes/` with the Write tool. Do NOT rely
on that write to prompt him — under his bypassPermissions mode it falls through silently — so his
approval must come from the **card you show inline BEFORE the mint**, never from a file-write dialog
that may never appear.

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

Known consequence, not a design claim: each of those files is a separate reviewed pass — its own hash
and its own reviewer token — so a multi-ticket card list is several mints, not one. Do not try to
collapse them by putting several hashes in one file — the hook cannot read them.

## Step 6 — The waive lane (Erez's per-case override)

When the reviewer holds findings that cannot be fixed and Erez wants it filed anyway: show him the
outstanding findings in plain terms and ask. On his affirmative, set `waived: true` + `waiveReason` +
the outstanding findings in the record, **and set `waived: true` on the pass as well** — the pass is
the only file the hook opens, so a waive recorded solely in the record blocks with `bad-verdict`. Then
mint normally. Erez's explicit affirmative in chat (above) is the waive's authority; there is no
separate mint-write confirmation, because under his permission mode that write does not prompt.

The waived pass carries the SAME `TICKET_PASS_KEYS` shape as Step 5's, with `waived: true` and
**`reviewerAgentId` omitted** (a waive cites no reviewer). Keep `waiveReason` and the outstanding
findings in the **ticket-record only** — `waiveReason` is not a `TICKET_PASS_KEYS` member, so copying it
onto the pass makes the hook refuse with `unknown-record-key`:

```json
{ "kind": "ticket",
  "surface": "notion-mcp",
  "contentHash": "<the 64-hex line --ticket-hash printed>",
  "verdict": "PASS",
  "waived": true,
  "target": "<human-readable label>",
  "expires": "<now + 15 min, ISO-8601 UTC>" }
```

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
- A persistent `consume-failed` block means the hook matched a valid pass but could not rename it to
  `*.consumed.<ts>` (a locked or read-only file, a permissions problem), so the write keeps blocking and
  the `*.json` pass stays stuck on disk. Clear it by **deleting the stuck `*.json` pass** in
  `~/.claude-staging/ticket-passes/` by hand, then re-mint and retry. (Do not break-glass it —
  `consume-failed` is unbreakable.)
- Break-glass (`CLAUDE_CONFIG_UNLOCK=1`, or the `.config-unlock` sentinel + reaper token) does NOT clear
  the ticket gate's content decisions. GEN-508 #4 scoped it to the two MECHANICAL blocks only
  (`internal-error`, `unreadable-payload` — a write the gate could not read at all); every such skip is
  LOGGED (a `break-glass-skip` row in the ticket-events log) and SURFACED (an advisory injected into the
  turn, to be raised in the "📌 For you" block). **Every other block reason stays UNBREAKABLE** — not
  only the ones named here (`no-pass`, `no-token`, `bad-verdict`, `bad-record`, `reviewer-unverified`,
  `unknown-record-key`, `expiry-too-far`, `stale-content`, `bad-target`, `consume-failed`,
  `exempt-list-*`) but any content/auth reason the hook can return except those two mechanical ones; the
  per-case Step 6 waive is the only way past them. The OPEN/CLOSE commands are in `/vet-code` and
  `/vet-rule`; the staging gate is scoped the same mechanical-only way, while the vetting and check gates
  are still fully suspended by break-glass.
