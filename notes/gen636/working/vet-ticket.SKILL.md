---
name: vet-ticket
description: "Vet and file a Notion Team-Tasks ticket write (create, duplicate, move-in, body edit, or substance-property edit) through: draft, independent reviewer pass against the ticket bar, resolve every note, show Erez a summary card, mint the single-use ticket pass the auto-approve hook requires, apply, verify. Trigger on /vet-ticket, or when the auto-approve hook blocks a Notion write with a 'ticket-quality gate' refusal (except one that names the Notion practice page or a mismatched Notion connector id — see Scope). Invoke it yourself whenever a pending write is in this skill's gate scope (or the gate blocks one) — never ask Erez whether to activate it; his approval is the Step 5 card (or a Step 6 waive), not a yes/no on running the skill. Start it the moment you are about to propose a gated write — before any chat draft of the ticket or any 'should I file this?' — so its board search (Step 0b) and review run before Erez sees the proposal. Out-of-scope writes proceed directly."
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
rather than the body, nothing downstream re-reads the text. For an interactive filing, Erez's
card-approval and the "show me the body" escape are the backstops. For the one UNATTENDED lane —
`/wrap` Steps 1 and 3c, which file with no card (GEN-702) — that real-time backstop is absent; its
substitute is weaker and after-the-fact: the independent reviewer PASS still gates every filing, and
`/wrap`'s Step 7 report surfaces a per-run reviewer-outcome tally so a lenient-reviewer pattern is at
least visible after the run. The cross-session ticket-gate readout (`/wrap` Step 3i) catches only
*systemic* leniency, from the re-review rate of attended filings; it leaves unattended filings out of
that rate, so leniency confined to the unattended lane is not detected. The shared break-glass (`CLAUDE_CONFIG_UNLOCK=1` /
`.config-unlock` sentinel) does NOT skip this gate's content decisions — GEN-508 #4 scoped it to the
mechanical blocks only (`internal-error`, `unreadable-payload`), and GEN-834 added the connector tripwire
(`connector-mismatch`), each skip logged and surfaced; see Step 9.

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
- **The Notion practice page** (`NOTION_PRACTICE_PAGE_ID` in `~/.claude/hooks/auto-approve.js`) — a
  plain-text edit of it passes with no review. Anything else aimed at it is refused outright
  (`practice-page-plain-only`), and no review record can clear that refusal, so never run this skill
  for it: send a plain edit directly, or make the change in the Notion app.
- **A `connector-mismatch` refusal** — a Notion write tool from a connector id the gate does not watch
  (see the connector-rotation bullet under "Marker-liveness probe"). No review record can clear it, so
  never run this skill for it: follow the refusal's own fix steps. Break-glass is the escape meanwhile,
  and the writes it lets through get no review at all (Step 9).

**If the payload or its target cannot be read, the write is blocked, not waved through** — no token, a
malformed or missing target id, or an unreadable / over-cap exempt file. The hook makes **no Notion
call on any path**, so reachability, rate limits, and archived-state never enter into it; a block is
always about what the hook could read locally, never about Notion being up. Minting needs no Notion
access, so the escape is one review plus one mint — not break-glass.

Known gaps, stated so they are not mistaken for coverage: **raw REST/curl writes to
`api.notion.com`** and **all Jira writes** are outside this gate (piece 2). A raw REST Notion write is
NOT gated here and is not reliably stopped elsewhere either — `notion-schema-guard.js` *does* coarsely
force an `ask` on a raw REST/curl write to `api.notion.com` (GEN-378), but under Erez's bypassPermissions
mode that `ask` is discarded, so it stops nothing — such a write CAN run silently until piece 2 wires
this arm. Jira/Confluence content edits are separately
hard-blocked by the staging gate. Neither is held to the ticket bar.

**When to run this skill — decide from the scope above, then act; do not ask.** When a pending write is in scope (a gated Team-Tasks write, or any unrecognised page id), invoke `/vet-ticket` yourself — never ask Erez whether to activate it; his approval comes at the Step 5 card (or a Step 6 waive), not as a go-ahead to run the skill. When it is out of scope (the NOT-gated cases above), write directly without invoking the skill. "Needed vs not" is exactly this section's in/out split — read it here rather than re-deriving it or asking. This is the single source of that scope; do not restate the list elsewhere (a second copy drifts — see the 2026-08-05 correction above).

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
   the reviewer sign off against the lane bar above (in place of Step 2's checklist), write the
   ticket-record (Step 4, with `"lane": "gen58-rollover"`), show Erez the card and mint (Step 5), and apply. The lane bar is a closed pass/fail check, so it carries no free-text notes for
   Step 3 to resolve. Capture the **new page id** from the create result.
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

**Entry to this lane is verified, not declared — and the verification is done by THIS `/vet-ticket`
session, before any reviewer is spawned** (`design-converged.md` §8 is the normative spec for this
lane). A round-1 review rejected an earlier "the reviewer confirms the target is not a Team-Tasks row"
phrasing: it never said *how*, and lane selection happens before a reviewer runs — so it was just
"Claude declares this a non-ticket." The confirmation must be a network read, and the `check-reviewer`
sub-agent structurally cannot make one (its tools are Read/Grep/Glob/ToolSearch/WebSearch/WebFetch — no
Notion tool), so it can never be the one to check. Run the lane in this order:

1. **Verify not-a-Team-Tasks-row — this session, before spawning the reviewer.** `notion-fetch` (or
   `GET /v1/pages/{id}`) the target page id. Enter this lane **only if** the read succeeds AND the
   page's parent database / data source is **not** a Team-Tasks marker. **Any other outcome — the read
   fails, times out, is unreadable, the parent IS a Team-Tasks marker, or there is no target id to read
   — falls back to the full Step-2 ticket checklist** (safe; it merely costs one reviewer).
2. **Hash the payload** (Step 1, with the matching `--tool` tag) — the reviewer must echo this hash.
3. **Reviewer signs off on the reduced bar.** Spawn the `check-reviewer` as usual, but its bar is only
   that the payload carries no destructive key — no `archived`, `in_trash`, `allow_deleting_content`,
   and no move that de-lists a row. It does **not** re-confirm the not-a-ticket fact — step 1 already
   did, with the tool it needs — and it ends on `TICKET-REVIEW-VERDICT: PASS <hash>` exactly as Step 2
   requires.
4. **Then Steps 4–8 as normal** — write the record (with `"lane": "non-ticket"`), show Erez the card,
   mint, apply. The lane's bar is
   a closed pass/fail check, so it carries no free-text notes for Step 3 to resolve.

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
  minted a NEW UUID, and this probe still reports **MATCH**, because the board ids it checks are
  unchanged. The hook catches the rotation itself instead (GEN-834): a Notion write tool carrying any
  other connector id is refused as `connector-mismatch`, so a rotation shows up as a refusal on the first
  gated write rather than as a gate that silently stopped firing. The fix is a `NOTION_MCP_PREFIX` update
  through `/vet-code` — ask Erez first, since the id may differ between Claude apps and machines.

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

## Step 0b — Search for an existing home (before drafting a new ticket)

Applies on the interactive lane to a **new** ticket (a create, duplicate, or move-in) and to an edit
that files a new finding on a ticket this session picked itself. Skip it when:
- the target ticket was named by Erez, or already chosen by a search this session ran;
- the write is on the GEN-58 rollover or non-ticket lane (their own bars cover it);
- the write is on `/wrap`'s unattended lane, whose capture step does its own dedupe before drafting.

Before anything is drafted, and before any ticket proposal or destination reaches Erez, search the board
for an open ticket that already covers the same underlying issue: run the semantic search defined in the
`/wrap` capture sub-step titled "Check for an existing home before creating" (`notion-search` on the
issue's behaviour and root cause) — that is the single definition, do not keep a second copy here — with
one difference: a ticket in **Review** counts as a candidate here, because a new finding against a ticket
awaiting verification belongs on it (and may be evidence it should not close). For a duplicate, ignore
the source ticket. This session runs the search; the `check-reviewer` has no Notion tool.

- **Confident match** (same behaviour and same root cause, so working that ticket would also resolve this
  item) → the write becomes an `update` appending the new finding to that ticket under a dated line — or
  no write at all if the ticket already records it (then tell Erez in one line what the search found).
- **A match whose body explicitly DECLINED this work** → neither create nor append; tell Erez and ask
  whether to reopen it.
- **No confident match** → draft the create.
- **The search could not complete** (an error, a rate limit, a truncated result) → record "could not
  check", never treat it as no match, and carry on (one retry is enough); the card leads with it.

Either way, write a short **search summary**: what was searched, and each candidate considered with a
one-line reason it does or does not match. It goes into the reviewer's brief (Step 2, item 5), into the
ticket-record (`searchSummary`, Step 4), and — as one line — to Erez with the card (Step 5). The reviewer
can judge only the summary's queries and calls, not that the search ran or was complete; Erez seeing that
line is the backstop.

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

**If it exits non-zero it prints no hash — then STOP and do not mint**, and do what its message says:
no pass can help. The message names the cause — bad arguments, a payload file it could not read as
JSON, a fault in the gate itself, or a payload aimed at the Notion practice page (see the
practice-page bullet under "NOT gated").

Hash the payload, then send that same object unchanged. If you edit it afterwards — even a whitespace
change in the body — **re-hash AND re-review**. Re-minting alone is not enough any more: the old hash
is baked into the old reviewer's token, so an edited payload has no reviewer token that matches and
the write blocks with `no-token`.

Why the whole payload and not a chosen subset: an allow-list leaves every unlisted field unbound, and
the omitted ones were not cosmetic (`apply_template` hashed to a constant, and
`allow_deleting_content` permits deleting child pages).

## Step 2 — Independent review

Spawn ONE `check-reviewer` sub-agent (Agent tool) that did not draft the ticket. Give it the drafted
payload in full, **the `contentHash` from Step 1**, **which lane this is** (interactive, or `/wrap` unattended), **the Step 0b search summary** (or `Step 0b: skipped — <reason>`), and this checklist, and require the verdict block
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
5. **Not a near-duplicate** — you have no Notion tool, so judge the Step 0b search summary in your
   brief rather than searching: was the search aimed at the underlying issue (behaviour + root cause,
   not just the title), and does each candidate's match / no-match call hold? A confident open match the
   draft ignores is a REVISE (propose appending to that ticket instead), and work an open ticket has
   explicitly DECLINED is a stronger stop than a duplicate. On the interactive lane, a missing summary
   where Step 0b applies is itself a REVISE. (This item does not apply where Step 0b is skipped —
   including `/wrap`'s unattended lane, whose capture step ran its own search before drafting.)
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

- It is the **final line** of its report — its concluding reply, or, when the harness gives it a
  `SubagentHandback` tool, the `message` it hands back: `TICKET-REVIEW-VERDICT: PASS <hash>` or
  `TICKET-REVIEW-VERDICT: REVISE <hash>`.
- `<hash>` is the Step-1 `contentHash`, all 64 hex characters, copied verbatim. A wrong or truncated
  hash reads exactly like no review at all.
- The verdict word must agree with `STATUS`. The hook only accepts `PASS`.
- The reviewer must **not** write the prefix `TICKET-REVIEW-VERDICT:` anywhere else in that final
  report, nor in anything it writes after handing back — not when quoting this instruction, not when
  explaining itself. The hook takes the **last**
  occurrence, so a trailing mention overrides the real verdict and the write blocks.

**Where the hook looks, exactly** (realigned 2026-08-05; hand-back channel added 2026-09-27, GEN-740):
the reviewer's **final delivered report**, judged per turn. The brief starts a turn, and so does each
follow-up message sent to the reviewer (SendMessage); tool results and the harness's own notices to the
reviewer do not. Harness-authored API-error records are ignored throughout. The hook reads the
reviewer's last turn that wrote any text or attempted a hand-back:

- If that turn called the harness's `SubagentHandback` tool, the report is the `message` of its
  **last** such call — but only if the harness confirmed delivery (the paired tool result is not an
  error and reads `{"success":true,…}`; other fields are allowed). A hand-back the harness refused
  means nothing was delivered that turn, and earlier text in the turn no longer counts, so the write
  blocks. Text written after the hand-back never reaches the caller, so it can only make the verdict
  stricter: if it repeats the prefix, the last repetition must also read `PASS` for this hash. (A call
  rejected with exactly "No such tool available" is ignored — that run has no hand-back tool and
  delivers by plain text.)
- Otherwise, the report is the last assistant message in that turn that delivered any text.

This description is for briefing the reviewer. Step 7 checks all of it by asking the hook itself
(`--ticket-verify`), so never re-trace it by hand.

Within the report, the hook takes the **last** occurrence of the prefix. Two consequences worth briefing:

- Only **delivered output** counts. A token that appears solely in the reviewer's internal reasoning, or
  in the arguments of any other tool call, is not a verdict. So a reviewer *may* reason about the token
  format privately without breaking its own sign-off — but nothing it did not deliver will clear the
  gate.
- Only the **final report** counts. A PASS delivered mid-review and then not repeated at the end is not
  a verdict, and a reviewer resumed with a follow-up must restate the verdict in that reply. Brief the
  reviewer to sign off in its concluding report, not along the way.

**The verdict-line guard (GEN-812).** `~/.claude/hooks/reviewer-verdict-guard.js` checks each ticket
reviewer's hand-back before it is delivered. If the last `TICKET-REVIEW-VERDICT:` in the report is
missing or malformed, or its hash is not one from the reviewer's prompts, it bounces the hand-back
back to the reviewer with instructions to re-send it ending with that line (at most twice per turn).
It checks form only; Step 7's `--ticket-verify` stays the authority, and Step 7 says what to do if a
report still arrives without the line.

Why the token rather than the record's own `verdict` field: the hook's whole purpose is not to trust
this skill. The token establishes three facts at once that a skill-written field cannot — this agent
ran, it reviewed *this* content, and it returned PASS — and an unrelated reviewer's transcript carries
a different hash or none. If the token is missing, malformed, or not last, the write blocks with
`no-token`; that is the gate working, not a bug to route around.

`REVISE` → fix and re-review (a fresh agent), **re-hashing first if the payload changed**. If the bar
cannot be met because only Erez holds the missing information, STOP and consult him — inline if the
stuck ticket blocks the task he asked for, otherwise batched at the next natural pause. (On the
unattended `/wrap` lane there is no Erez to consult mid-run, so the item is surfaced-not-filed instead —
see `wrap/SKILL.md` Step 1.)

**Before you stop to consult him, write a consult file** with the Write tool, so a question that never
gets answered is not lost when the session ends — `/wrap` Step 3i reports open ones:
`~/.claude-staging/ticket-passes/consult-<slug>-<yyyymmddHHMM>.json`, where `<slug>` is a few words
naming the ticket, hyphen-joined, `a-z0-9` only, and the timestamp is UTC.

```json
{ "kind": "ticket-consult",
  "target": "<page id, or 'new'>",
  "question": "<the one-line question for Erez>",
  "session": "<$CLAUDE_SESSION_ID, read via the Bash tool; '' if unreadable>",
  "openedUtc": "<ISO-8601 UTC now>",
  "resolved": false }
```

Give it no `expires`, so the hook's pass scan skips it. As soon as Erez answers — in this session or any
later one — Read the file, then overwrite it with `"resolved": true`, or `"resolved": "abandoned"` if he
drops the item, and add `"resolvedUtc"`; do this before going on to file. Overwrite it; never delete it,
so the trail stays. An unattended run (`/wrap` or a scheduled task) writes none — it cannot consult Erez,
and its surfaced-not-filed path covers that case.

## Step 3 — Resolve every note before filing

A `PASS` with notes does not file as-is. For each note, either amend the ticket or dismiss it with a
stated reason, and record that resolution in the ticket-record's `noteResolutions` field (Step 4) — the card no longer shows the notes (Step 5), so the ticket-record is where every note and its resolution live. Notes are where a
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
  "searchSummary": "<Step 0b's search and candidates; 'n/a' where Step 0b was skipped>",
  "waived": false,
  "waiveReason": null,
  "source": "interactive",
  "lane": "ticket",
  "draftedUtc": "<ISO-8601 UTC now>" }
```

**`source` and `lane` feed `/wrap` Step 3i, the ticket-gate readout.** `source` is `interactive` by
default; `/wrap` Steps 1 and 3c set `wrap-step1` / `wrap-step3c`, and any other unattended run — one
with no Erez present to answer a card, such as a scheduled task — sets `scheduled`. `lane` is `ticket`, `non-ticket` (the non-ticket lane) or
`gen58-rollover` (the rollover lane). Use these exact values: the readout counts only them and names any
other value as drift. **Never copy either key into the Step-5 pass** — its keys are closed
(`TICKET_PASS_KEYS`), and the hook refuses an extra one with `unknown-record-key`.

**One reviewer id, singular.** The hook verifies exactly one reviewer — that agent's sidecar
`agentType` and that agent's own PASS token — so `reviewerAgentId` names the reviewer whose token
binds the hash you are about to mint, which after a REVISE round is the LAST reviewer, not the first.
Earlier rounds go in `priorReviewerAgentIds`, which nothing enforces and which exists only so the
history is not lost.

## Step 5 — Show Erez the card, then mint

**The card is the only approval, and the first time Erez sees the proposal.** Bring a ticket write to
him only as this card, after Steps 0b–4 have run — never as a chat draft or a "should I file this?"
beforehand: a chat draft followed by the card asks him twice (GEN-802), and an approval given before
the Step 0b search can land a near-duplicate (GEN-606). If Erez already explicitly approved this write
— he asked for it, or approved a plan step naming its target and purpose — that approval stands: run
the steps, and if the reviewed result stays within what he described, file it and show the card as a
report, not a question; ask only when it goes beyond that, including when Step 0b turned it into an
append to an existing ticket. Lead each card with one line from its Step 0b search
summary — what was searched and the nearest candidate ruled out and why, the match found, or "could
not check" — written above the card, not as a fifth field. When Step 0b turned the write into an
append, the card's title is that ticket's ID and name, and its one-line summary says what is being
added. If Erez asks for changes at the card, revise, re-hash and re-review (Steps 1–2), and show the
revised card — one new approval, for the changed content.

Show a **summary card per ticket — not the body** (Erez's instruction, 2026-08-02; trimmed to four fields 2026-08-17). The card carries **exactly four fields**: the **title**; a **one-line summary** of what the ticket is for; the **epic / parent** — its `Parent item`, named as the epic when that parent is an epic (you set it, and its `Type`/level tells you), otherwise the parent ticket; and the **derived Priority**. Nothing else goes on the card — not the cross-referenced ticket IDs, not the other properties (type, status, assignee, Urgency, Gain ratio), and not the reviewer's verdict or its notes. (The GEN-58 rollover lane and the non-ticket lane file a plain page with no Team-Tasks properties: their card shows the title, the one-line summary, and the parent page, and omits Priority — there is none to show.) Still offer to show the full body on request. Several pending filings are shown together as one card list and approved in one action. **Unattended exception (GEN-702):** `/wrap` Steps 1 and 3c run this whole flow with NO card — a standing override so the wrap does not stop for approval. There this card step is skipped (nothing shown; the mint proceeds silently), the Step 6 waive lane is unavailable (it needs Erez), and a filing that cannot reach a PASS is surfaced in `/wrap`'s report instead of filed — see `wrap/SKILL.md` Step 1 for that lane's bounded-retry (2 rounds) and reporting rules.

His approval means "file this", not "I endorse this wording" — the body's quality rests on the
reviewer. Because the card no longer shows the reviewer's notes, when they were substantive say so in plain terms as you present the card (the resolutions are in the ticket-record for the detail); likewise flag an unusually large card list.

**Before you write the pass, run the Step 7 evidence precondition.** Step 7 is numbered after this step
but executes first: it re-verifies the reviewer's transcript, token, and hash immediately before the
mint. Run pre-mint, its checks read the equivalent fields on the **Step-4 ticket-record** (the pass does
not exist yet — Step 7's "checked on the pass file" wording assumes the ordinary post-mint order).
Minting first risks an unexplained hard-block after the write, when a failed precondition here costs
only a re-review.

Then mint the **ticket pass** into `~/.claude-staging/ticket-passes/` with the Write tool. Do NOT rely
on that write to prompt him — under his bypassPermissions mode it falls through silently — so his
approval must come from the **card you show inline BEFORE the mint** (or the earlier explicit approval described above), never from a file-write dialog
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
- **The token is present, correct, and the reviewer's last delivered word — ask the hook.** Run the
  hook's reviewer-verdict check on that same `.jsonl` (the one in THIS session's `subagents` folder
  located above), with the `contentHash` from Step 1:

  ```bash
  node "C:\Users\Erez\.claude\hooks\auto-approve.js" --ticket-verify "<that subagents dir>\agent-<id>.jsonl" --hash <contentHash>
  ```

  It must print `ok` (exit 0). It runs the same code the gate runs at write time — the sidecar check and
  the full read under "Where the hook looks, exactly" (Step 2) — so it cannot drift from the gate; do not
  re-trace that read by hand. Any other word is the reason the write would block (`no-token`,
  `reviewer-unverified`, `bad-record`, `transcript-too-large`): re-review rather than mint — except a
  `no-token` on a report that reads as a finished review: first SendMessage that same reviewer asking it
  to re-send its full report ending with the verdict block, token last, then re-run this check;
  re-review only if it still isn't `ok`. Like the
  Step 1 hash call, that exact invocation is auto-approved; keep both paths quoted and the hash as the
  last token. The file must be the one under this session's folder: the gate looks only there, so a
  transcript from another session can print `ok` here and still block at write time. The command does
  NOT check the `draftedUtc` ordering — the bullet above still does. (Before 2026-08-05 this step
  scanned all assistant records flat; until 2026-09-27 it re-traced the hook's read in prose, which
  drifted when the hook learned to read hand-backs.)
- Re-run `--ticket-hash` on the payload and confirm it still prints the `contentHash` in the record
  (nothing edited since review). Re-running it, rather than trusting the recorded value, is the point.
- `verdict === 'PASS'` **or** `waived === true`, checked on the pass file.
- Every note has a recorded resolution (Step 3).

Any check fails → REFUSE to mint; say what is missing and re-review rather than forcing it.

Residual, and narrower than the siblings' now that the token carries the hash: this establishes that a
genuine `check-reviewer` run in this session returned PASS for THIS content, which an agent id alone
never proved. What it still cannot show is that the review was *competent* — a lenient reviewer emits
PASS on a hollow ticket, and a reviewer handed a truthful hash can emit the token having barely read
the payload. For an interactive filing, Erez's card-showing mint-approval is the backstop. For the
unattended `/wrap` lane (Steps 1/3c, no card — GEN-702) there is no such real-time backstop: the
reviewer PASS is the only per-filing check, and only `/wrap`'s after-the-fact Step 7 tally can surface
a lenient-reviewer pattern on that lane (its cross-session readout, `/wrap` Step 3i, leaves unattended
filings out of the re-review rate — see the header).

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
routine. The cross-session counts and their bars are `/wrap` Step 3i, the ticket-gate readout (it
counts waives from the events log; declines are not counted).

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
  the ticket gate's content decisions. GEN-508 #4 scoped it to the MECHANICAL blocks only
  (`internal-error`, `unreadable-payload` — a write the gate could not read at all), and GEN-834 added
  `connector-mismatch` (a Notion write tool from a connector id the hook does not watch — see the
  connector-rotation bullet under "Marker-liveness probe"). **Clearing `connector-mismatch` means NO
  content review at all** — the hook never looks for a pass on that write. Use it only to keep working
  through a rotated connector while `NOTION_MCP_PREFIX` is fixed, never to avoid a review you could run.
  Every such skip is
  LOGGED (a `break-glass-skip` row in the ticket-events log) and SURFACED (an advisory injected into the
  turn, to be raised in the "📌 For you" block). **Every other block reason stays UNBREAKABLE** — not
  only the ones named here (`no-pass`, `no-token`, `bad-verdict`, `bad-record`, `reviewer-unverified`,
  `unknown-record-key`, `expiry-too-far`, `stale-content`, `bad-target`, `transcript-too-large`,
  `consume-failed`, `exempt-list-*`) but any content/auth reason the hook can return except those three;
  the
  per-case Step 6 waive is the only way past them. The OPEN/CLOSE commands are in `/vet-code` and
  `/vet-rule`; the staging gate is scoped the same mechanical-only way, while the vetting and check gates
  are still fully suspended by break-glass.
