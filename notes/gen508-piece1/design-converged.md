# GEN-508 piece 1 — design for review (v2, revised after round 1)

**Change:** add a fourth gate arm, `enforceTicketVetting`, to `~/.claude/hooks/auto-approve.js`,
plus a new `/vet-ticket` skill that mints its single-use pass. Scope of piece 1: the **Notion**
write paths only (Jira arms and the CLAUDE.md prose move are pieces 2 and 3).

## Problem being solved (from GEN-508)

When Claude files or edits a Team-Tasks ticket it repeatedly violates our ticket-quality rules —
most often the body is not self-contained ("stand on its own"), and/or the priority-derivation
fields (Urgency + Gain ratio -> Priority) are missing or wrong. A behavioral self-check rule exists
and is skipped under momentum. The ask: make adherence *enforced*, via an independent reviewer,
without growing the always-loaded global CLAUDE.md.

Erez's settled decisions (GEN-508 §2): judge-before-filing; airtight stop on an unverified write
with a per-case waive he controls; both trackers, create AND edit; review every create and every
edit touching body/substance or the priority fields, skip pure housekeeping (status/labels/
assignee); the reviewer must be INDEPENDENT of the drafter.

## Verified facts this design rests on (checked live this session, 2026-08-02)

1. `auto-approve.js` is registered as PreToolUse with matcher `""` (`settings.json` hooks block,
   read this session) — it sees every tool call, so no `settings.json` change is needed.
2. The gate family is three siblings today — `enforceStaging` (auto-approve.js:639),
   `enforceVetting` (953), `enforceCheckDue` (1366) — over one shared pass reader `findPassInDir`
   (577) with thin wrappers (GEN-564, landed). This arm is the fourth sibling and reuses
   `findPassInDir`, `consumePassFile`, `stableStringify` (829), `configUnlocked`, `scanChain`.
3. `~/.claude-staging/` holds `passes/`, `vetting-passes/`, `check-passes/`,
   `config-unlock-passes/`, `sandboxes.json` (`ls`, this session). It is outside the
   `Write(~/.claude/*)` allow-list, so a Claude-issued write there always prompts Erez.
4. `notion-create-pages` tool_input carries `parent` = one of `{page_id}` / `{database_id}` /
   `{data_source_id}` plus `pages[]`, each with `properties` and `content` — read from the live
   tool schema via ToolSearch this session. **The Team-Tasks target is therefore visible in the
   create payload.** Independently corroborated by `notion-schema-guard.js:250-279`, which already
   inspects `pages[].properties` pre-call in production.
5. `notion-update-page` tool_input carries `page_id` + `command` (`update_properties`,
   `update_content`, `replace_content`, `insert_content`, `apply_template`, `update_verification`)
   and, per command, `properties` / `content` / `new_str` / `content_updates` — live tool schema,
   same ToolSearch read. It carries **no** data-source id (confirms GEN-508 §4).
6. Command distribution in `hooks/deferred-calls.jsonl` (grep this session, corrected in round 1 by
   a reviewer who re-ran it): 1,726 logged `notion-update-page` lines; of those, command-tagged:
   `update_properties` 586, `insert_content` 586, `update_content` 501, `replace_content` 26,
   `apply_template` 3, `insert_content_after` 2 (sum 1,704). Counts are point-in-time — the log is
   appended continuously, and a re-grep an hour later returned 1,729/586/588/502/26/3/2. Nothing
   rests on the exact figures; the load-bearing observation is that `insert_content_after` is NOT in
   the published enum — so **treat the command enum as open**.
7. A Node hook CAN make a live Notion REST call from inside a hook process:
   `notion-fetch-staleness.js` reads the Credential-Manager token via a PowerShell one-liner and
   calls `GET /v1/pages/{id}` with `curl.exe -sk`, 8s timeouts. (That hook is registered
   **PostToolUse**, not PreToolUse — corrected in round 1. The capability is the same; only the
   consequence of failure differs, which this design handles explicitly below.)
8. `notion-schema-guard.js` inspects `notion-create-pages` and `notion-update-page` payloads at
   PreToolUse and forces a friction-ADDING `ask` — narrowly, only when a `(Parent item)`-suffixed
   relation key is present (lines 240-247, 261-271; round-3 correction — the earlier wording
   overstated its coverage). It also forces `ask` on any shell write to `api.notion.com`. What this
   fact is load-bearing FOR is unaffected: a PreToolUse hook can and does inspect a Notion CREATE
   payload and act on it before the call runs.
   Its header (lines 68-71) states the architectural split: auto-approve.js owns approve/hard-block;
   `ask` gates live in their own file. This arm is a hard-block gate, so auto-approve.js is right.
9. Team-Tasks ids: data source `bd2cd17b-f58f-4993-8b95-468e881272fa` (from the
   `<parent-data-source url="collection://...">` tag on ticket fetches this session), database
   `fe198002-6618-48d7-ae04-56f8cee479f3` (hardcoded in `scripts/notion-ticket-lookup.ps1:25`).
10. GEN-58 ("QA Layer 5") page id `36d6e495d07c816e9e0cce265d694ab3` — resolved this session via
    `notion-ticket-lookup.ps1 58`.
11. `notion-duplicate-page` tool_input is `{ page_id }` and nothing else; its own description states
    duplication "completes asynchronously, so do not rely on the new page identified by the returned
    ID or URL to be populated immediately" — live tool schema, ToolSearch this session.
12. `notion-move-pages` tool_input is `{ page_or_database_ids: [<id>, ...], new_parent }`, where
    `new_parent` is `{type: 'page_id'|'database_id'|'data_source_id'|'workspace', ...}` — live tool
    schema, same read. (Facts 11-12 were added after round 2: both re-review lenses flagged that A4
    and A5 were specified in intent only, and that a wrong field-name guess would make those arms
    silently fail to match — failing open rather than loud.)

## Deviation from the converged spec — the create path CAN be airtight

GEN-508 §4 and decision 7 assert: "Create-side is NOT airtight — a PreToolUse hook cannot intercept
a create (anchors on pre-existence)", citing the new-FILE-creation limit as "the identical limit",
and therefore chose Option 1 (allow the create, review right after, fix via a gated edit).

**That premise does not hold for a Notion create.** The file-creation limit exists because
`enforceVetting`/`enforceCheckDue` deliberately anchor on the target FILE existing on disk, as their
fail-safe against a mis-resolved path being silently approved — there is no other way to know a
path is a protected target. A Notion create needs no such anchor: the payload itself names the
parent data source (fact 4), and `notion-schema-guard` already gates creates at PreToolUse in
production (fact 8). So the create call can be hard-blocked before it runs.

*Round-1 status: both the pre-mortem and the soundness reviewer independently verified this and
agreed the original premise was false — the soundness reviewer located the original decision text in
`HISTORY.md` (2026-07-23, session d97120f9: "create-side = Option 1 ... since a hook can't gate a
create") and confirmed `notion-schema-guard.js` is a shipped counter-example.*

Consequences, all in the direction Erez asked for: the create path becomes airtight (decision 2 in
full); "judge BEFORE filing" (decision 1) is honoured literally; the Option-1 two-write dance
disappears; the Option-2 orphan-stub failure mode never arises.

## The mechanism

### Scoping — which calls are in scope

**A1 — create.** Tool = `notion-create-pages`, `parent` resolving to the Team-Tasks data source or
database id (fact 9), matched dash- and case-insensitively. Every such create is in scope. One call
= one target (the whole `pages[]` array is hashed together), so one pass covers a multi-page create.

**A2 — property edit.** Tool = `notion-update-page`, `command === 'update_properties'`, page
resolves to Team-Tasks, and `properties` contains at least one **substance** key. Substance is
defined by DENY-LIST, not allow-list (round-3 hardening): the housekeeping keys that pass freely are
`Status`, `Assignee`, `Project`, `Type`, `Due Date`, `Parent item`, `Date Created`, `ID` /
`userDefined:ID`, `url`; **every other key counts as substance**, including the title and the three
priority fields. An allow-list would silently un-gate a field the moment a Team-Tasks property is
renamed — the round-3 reviewer's point, and it applies to the title especially, whose literal
property name (`Name`) the hook can only match as a string since the payload carries no property
types. The deny-list fails the safe way: an unknown or renamed key is treated as substance and
gated. A call mixing both is in scope.

Build detail — the deny-list is written against the LIVE property set, read this session from
`GET /v1/databases/fe198002-6618-48d7-ae04-56f8cee479f3`: `Priority`, `Status`, `Urgency`,
`Date Created`, `Assignee`, `Reason`, `Parent item`, `Attachment`, `Project`, `Type`, `Text`,
`Children`, `Gain ratio`, `Remind me (days before)`, `Due Date`, `ID`, `Name`. Housekeeping =
`Status`, `Assignee`, `Project`, `Type`, `Reason`, `Due Date`, `Remind me (days before)`,
`Date Created`, `ID`, `Parent item`. Everything else is substance — including `Children`, the
inverse-of-parent relation whose write re-parents pages (destructive-op incident class (c)) and
which `notion-schema-guard`'s `(Parent item)`-suffix matcher does NOT match by name. The matcher
must also handle the prefixed payload forms the update tool uses for some types
(`date:Due Date:start`, `userDefined:ID`): compare on the property name after stripping a leading
`date:` / `place:` / `userDefined:` qualifier and any trailing `:start` / `:end` / `:is_datetime`.

**A3 — body edit.** Tool = `notion-update-page`, page resolves to Team-Tasks, and `command` is
anything OTHER than `update_properties` and `update_verification` (verification is page metadata,
not ticket substance). Unknown/future commands are treated as content-bearing and gated — the
open-enum stance fact 6 requires.

**A4 — duplicate (added in round 1).** Tool = `notion-duplicate-page`, `page_id` (fact 11) resolving
to Team-Tasks. Duplicating a ticket spawns a live ticket row (documented in the global CLAUDE.md
Session Learnings), so this is a create path that never touches `notion-create-pages`. Gated; pass
target `duplicate:<source-id32>`. Because duplication is async and returns a not-yet-populated id
(fact 11), the new page cannot be cache-seeded at gate time — the first edit to the copy pays one
resolver round-trip. Accepted; not a bypass.

**A5 — move-into (added in round 1).** Tool = `notion-move-pages`, `new_parent` (fact 12) resolving
to the Team-Tasks data source or database. Re-parenting a page into the database makes it a live
ticket. Gated; pass target `move:<data-source-id32>`, one pass for the call (all
`page_or_database_ids` move to the same parent). Moving a ticket OUT is not gated — that removes a
ticket rather than filing an unreviewed one. A successful move-in also invalidates any cached
negative for the moved ids, so the cache is purged of those entries at gate time.

Out of scope for piece 1, stated as a known gap, not oversold: raw REST/curl Notion writes. They are
already forced to an interactive `ask` by `notion-schema-guard`'s shell arm (fact 8), so they cannot
run silently, but they are not held to the ticket bar. Closing that is piece 2, with Jira.

### Carve-out — GEN-58 reasoning-failure log appends

An append-only write (`insert_content` / `insert_content_after`) to the GEN-58 page (fact 10) is
NOT gated. Reason: a standing global rule requires those writes to happen "immediately, as each
instance is identified", explicitly exempts them from the draft-for-approval pause, and requires
them to be narrated as a one-line exception "not a pause for a go-ahead". A mint prompt is exactly
that pause. GEN-58 is also a log, not a ticket that must stand on its own, so the bar this gate
enforces does not apply to it. Any NON-append command on GEN-58 (a rewrite of the page) is still
gated. Hardcoded page id carries the same maintenance-note treatment as the other ids here.

### Evaluation order — cheap local tests first, resolver last (added in round 2)

**The in-payload tests run BEFORE `isTeamTasksPage` is ever called**, and a call that fails them is
returned on immediately, never reaching the resolver or its hard-block-on-unknown path:
- A2: does `properties` contain a substance key?
- A3: is `command` something other than `update_properties` / `update_verification`?
- A4/A5: is the tool one of the two, and (A5) does `new_parent` name Team-Tasks?

Round 2 caught this: the design said the flow "mirrors `enforceCheckDue`", and that function resolves
target identity first and classifies second. Built that way, a bare `Status` or `Assignee` change —
housekeeping that decision 5 explicitly exempts — would call the resolver, and any transient
credential/network hiccup would then hard-block it. Ordering the cheap local test first means a
housekeeping-only edit passes freely regardless of Team-Tasks membership or resolver health, and the
resolver is reached only for a call that WOULD be gated if membership resolved true.

### Resolution — is this page id a Team-Tasks row?

`isTeamTasksPage(pageId)` returns `true` / `false` / `null` (unknown):
1. Normalize the id (strip dashes, lowercase).
2. Consult the on-disk cache at **`~/.claude-staging/notion-page-parents.json`** — deliberately
   OUTSIDE `~/.claude`, because `settings.json` allow-lists `Write(C:\Users\Erez\.claude\*)`: a
   cache inside that tree could be silently rewritten by a Claude tool call to mark a real ticket
   out-of-scope, with no prompt (round-1 soundness finding). The hook's own `fs` writes are
   unaffected by the allow-list, so nothing is lost by moving it out.
   TTL: positive entries 30 days (a ticket stays a ticket), negative entries 24 hours (limits the
   window in which a page newly moved into Team-Tasks reads as out-of-scope).
3. Miss -> one `GET https://api.notion.com/v1/pages/{id}`, token from Credential Manager
   (`claude-notion-token`), `curl.exe -sk`, 8s timeout, the `notion-fetch-staleness.js` pattern
   (fact 7). Read `parent.data_source_id` / `parent.database_id`. Cache the result.
4. Any failure -> `null`. The catch is total by design: no token, network error, non-JSON,
   unexpected shape, timeout, **and any bug inside the resolver's own code**. Nothing thrown here
   escapes into the caller's "internal scoping error" path, so the two error stances below cannot be
   confused for one another.

**Seeding (round-1 fix):** A1/A4/A5 already know the parent from their own payload, so on every
gated create/duplicate/move the resulting page id — once known — is written to the cache as a
positive. This means the common "file a ticket, then immediately edit it" sequence does not pay a
network round-trip on the edit.

Cost: one PowerShell spawn + one curl per uncached page. The design does NOT rely on a specific
latency figure (the round-1 estimate had no measurement behind it); Step 4 of `/vet-code` will
measure it, and the timeout bounds the worst case at 8s. The resolver is reached only for
`notion-update-page` (A2/A3, after the in-payload tests) and `notion-duplicate-page` (A4) — never
for `notion-create-pages` (A1) or `notion-move-pages` (A5), whose parent is in-payload, and never
for any non-Notion tool call.

**A blocked call records why.** When the arm hard-blocks, it appends the reason to
`~/.claude-staging/ticket-gate-events.jsonl` — `no-pass`, `unresolved`, or `resolver-error`.
Without this, a persistently broken resolver (a renamed Credential-Manager entry, an expired token)
is indistinguishable from a transient outage and shows up only as permanent unexplained friction
(round-3 advisory). The same file carries the skill-side waive/decline events, so one reader covers
both.

### Behaviour on unknown (`null`)

**Hard-block (exit 2)**, message naming `/vet-ticket`. This departs from the siblings' fall-through-
to-prompt stance, deliberately: Erez was asked this exact question in plain terms this session — "when
the guard can't tell whether a page is a work ticket (say Notion is unreachable), it stops and asks
you rather than waving the edit through" — and answered "go". A `defer()` is silently auto-approved
under bypass-permissions mode (the GEN-562 leak), so defer would not be "stops".

Round-1 raised that this is only proportionate if the escape is proportionate. It is: **`/vet-ticket`
needs no Notion access** — it reviews the drafted payload and mints a local file. So a Notion outage
costs one review + one mint prompt, NOT a break-glass. Global break-glass (which would suspend all
four gates) is never the required escape for this case.

### Pass shape and binding

Dir: `~/.claude-staging/ticket-passes/` — new sibling under the EXISTING `.claude-staging` parent, so
minting prompts Erez (that prompt is the human gate). Distinct dir so ticket passes can never
cross-match staging / vetting / check passes.

```json
{ "kind": "ticket", "surface": "notion",
  "target": "<id32 of the page>  |  create:<ds-id32>  |  duplicate:<src-id32>  |  move:<ds-id32>",
  "contentHash": "<sha256 of the normalized reviewed payload>",
  "expires": "<now + 15 min, ISO-8601 UTC>" }
```

Binding is **target + contentHash**. Accuracy note (round 2): this is NOT what the siblings do at
the hook layer — `enforceVetting` and `enforceCheckDue` match on kind + target only, and
`contentHash` lives purely in their skills' pre-mint freshness check. Putting the hash in the
consumed pass is deliberately stronger than the prior art, because the thing reviewed here IS the
content, so a pass must not survive a change to it.
The hash is over a normalized *semantic projection*, not the raw tool_input, so it does not break on
serialization drift:
- create: `stableStringify(pages.map(p => ({ properties: p.properties, content: p.content })))`
- duplicate/move: `stableStringify({ tool, pageIds, parent })`
- update_properties: `stableStringify(properties)`
- content commands: `stableStringify({ command, content, new_str, content_updates })`

`stableStringify` (auto-approve.js:829) sorts object keys and preserves array order — verified
deterministic by the round-1 soundness reviewer for exactly these shapes.

**One shared projection definition.** The hook and `/vet-ticket` must compute the hash identically;
any drift makes EVERY pass fail to match, so nothing can be minted through and the only escape left
is the global break-glass. The failure is loud and immediate rather than latent, but the cost of
hitting it is high, so: the projection is written once, in the hook's header comment, and
`/vet-ticket` cites that as its source. `/vet-code` Step 4's mandatory pass-consumption assertion
covers this — it exercises a real mint -> block-without-pass -> approve-and-consume round-trip in
the fixture tree, which is exactly the test that would catch a projection mismatch.

### Enforcement flow (mirrors enforceCheckDue)

1. `configUnlocked()` -> return (break-glass, shared accepted residual with the siblings).
2. Compute in-scope targets, applying the in-payload tests first and calling `isTeamTasksPage` only
   for a call that survives them (see "Evaluation order"); none -> return (falls through untouched).
3. For each target, find a distinct unexpired matching pass (`findPassInDir(TICKET_PASS_DIR, ...)`,
   passing the `exclude` list so two targets cannot claim one pass); any miss -> hard-block,
   consuming nothing (all-or-nothing, same as the siblings).
4. All matched -> consume all, then `approve(...)`.
5. Any internal error in scoping -> return (fall through to a prompt), same stance as the siblings.
   (Note the asymmetry with "unknown resolution", which hard-blocks: an internal error means the arm
   itself is broken and should not become a wall; an unresolved page means the arm is working and
   cannot classify — the case Erez chose to stop on.)

Call site: in `main`, immediately after `enforceCheckDue`, before the allow-list check — verified in
round 1 to give the "an allow-list entry cannot bypass it" property.

### The `/vet-ticket` skill (mints the pass)

Modelled on `/vet-rule`, the lighter of the two existing minting skills:
1. **Step 0 fail-closed self-check**: grep the hook for `enforceTicketVetting` and
   `findTicketPassFile`; missing -> refuse.
2. **Draft** the ticket create/edit payload.
3. **Independent review**: spawn a `check-reviewer` sub-agent that did NOT draft the ticket, given
   the drafted payload + the ticket-bar checklist, returning PASS / REVISE with specific findings.
   Fix what is fixable and re-review; if the bar cannot be met because only Erez holds the missing
   information, STOP and consult him (decision 1).
4. **Write a ticket-record** to the pass dir capturing the reviewer's `agentId`, the verdict, the
   `contentHash`, and (if applicable) the waive fields — same self-contained-evidence shape
   `/vet-code` and `/vet-rule` use.
5. **Evidence precondition, then mint.** Verify: `reviewerAgentId` is present and non-empty; the
   reviewer transcript exists on disk under this session's `subagents/` dir with
   `"agentType":"check-reviewer"`; the transcript's earliest line `timestamp` is `<=` the record's
   `draftedUtc` (parity with `/vet-rule`, which has this ordering check — round-2 advisory); the
   record's `contentHash` still equals the current payload hash; **and `verdict === 'PASS'` OR
   `waived === true`** (round-1 fix: v1 checked only that a review had *run*, so a REVISE verdict
   could still be minted — `/vet-rule` gates on its verdict and this must too). Then mint (the write
   prompts Erez). **At every mint prompt — not only a waived one — show Erez a SUMMARY CARD, not the
   drafted body** (Erez's instruction, 2026-08-02): title, a one-line gist, parent, the ticket IDs
   the draft body cross-references, the properties (type, status, assignee, Urgency, Gain ratio,
   derived Priority), the reviewer's verdict and any findings (the pass JSON carries none — round-2
   advisory), and an offer to show the full body on request. Two consequences, accepted
   deliberately: his approval means "file this", not "I endorse this wording" — the body's quality
   now rests wholly on the independent reviewer; and the cross-references line is read out of the
   draft text, not from a stored relation, because the live Team-Tasks schema has exactly two
   relation properties, `Parent item` and its inverse `Children` (verified this session against
   `GET /v1/databases/fe198002-...`), and no generic related-tickets field.

   **Standing-rule conflict this creates (resolve via `/vet-rule`; do not leave implicit).** The
   global CLAUDE.md rule beginning "Before creating or materially changing a ticket in a tracker"
   requires drafting "title, body, and key properties" for Erez's approval. Summary-card approval
   contradicts the "body" half of that for gate-mediated filings. The rule needs an explicit
   amendment: where an independent reviewer has passed the body under this gate, Erez approves the
   card and the body is the reviewer's charge. Until that lands the two contradict each other, so it
   ships WITH piece 1 rather than being deferred to piece 3.
6. **Apply** the Notion call, **verify** the pass was consumed to `*.consumed.<ts>`.

**Batch approval (Erez's choice, 2026-08-02): several pending filings are shown together on one
card list and approved in one action.** Mechanical consequence, decided rather than escalated: a
naive implementation mints one pass file per ticket, so his single "approve" would still raise N
separate permission dialogs — defeating the point. So a batch mints ONE pass file carrying
`targets: [<target>, ...]` (each with its own `contentHash`). Consumption stays per-target: the arm
matches a target within the array, then rewrites the file with that entry removed, renaming it to
`*.consumed.<ts>` only when the last entry goes. This is the one place the fourth gate diverges from
`consumePassFile`'s rename-only semantics, so it needs its own live-verify case in `/vet-code`
Step 4: N targets -> N approvals -> file gone, and a partially-consumed file still gates the
remaining targets. A single-ticket filing keeps the simple one-target shape.

**The per-case waive (round-1 fix — v1 got this backwards).** v1 claimed "Erez declining the mint IS
the waive". That is inverted: declining means no pass, so the write stays blocked — a decline
*reinforces* the stop. Decision 2 asks for a waive that lets a specific write through despite the
stop. So: when the reviewer holds findings that cannot be fixed (or Erez wants it filed anyway),
`/vet-ticket` shows him the outstanding findings in plain terms and asks. On his affirmative, the
record records `waived: true` + `waiveReason` + the outstanding findings, and the pass is minted
normally (the mint prompt is his second, deliberate confirmation). The hook is unchanged — a pass is
a pass. The waive is per-case, scoped to one write, and never touches the global break-glass.

**Signal surfacing, designed in (round-1 fix — not deferred).** Every gate event —
review PASS, REVISE-then-fixed, waived, or Erez declining the mint — is appended by `/vet-ticket` to
`~/.claude-staging/ticket-gate-events.jsonl` `{ts, target, verdict, waived, reason}`. Reaching Erez:
(a) **immediately** — a waive or a decline is reported as a line in that same turn's "📌 For you"
block, in the skill's own instructions, so it never waits for a later routine; (b) **in aggregate**
— a `/wrap` line reporting waive/decline counts, with a re-evaluate bar ("if waives exceed roughly
one in four gated writes, the lane is firing too often — revisit the scope"). (b) edits the `/wrap`
skill, which is a `/vet-rule` change, so it lands in piece 3; (a) needs nothing beyond `/vet-ticket`
itself and ships in piece 1, so the signal has a working reader from day one.

**Pieces 2 and 3 become real tickets, not prose (round-2 advisory).** "Piece 2" (Jira create/edit
arms + the raw REST/curl Notion arm) and "piece 3" (move the bar prose out of the always-loaded
global CLAUDE.md into the reviewer's checklist; the `/wrap` aggregate line; the escalation log for a
consult that would otherwise die with the session) are filed as sub-items of GEN-508, drafted for
Erez's approval, at the end of this build — the standing rule is that a named follow-up is created
immediately rather than merely referenced.

## Open question that needs Erez's sign-off before this ships

**This gate changes two behaviours his standing rules currently specify as silent** (round-1
pre-mortem finding; I am not resolving it unilaterally):
- `/wrap` files learning tickets "automatically and silently, with no in-the-moment approval". With
  the gate, each such filing needs a mint prompt — so wrap-up would stop and ask him once per
  ticket it files.
- The same applies to any ticket Claude would otherwise file without pausing.

Two ways to go, and it is his call: (i) accept the prompts — arguably an improvement, since
GEN-508's own §8 records two incidents where silent `/wrap` filing produced a near-duplicate and a
ticket for work an existing ticket had explicitly declined, both caught late; or (ii) carve `/wrap`
out, keeping wrap-up silent and leaving those filings ungated. The GEN-58 carve-out above is
separate and already justified by its own standing rule.

## Honest limits

- The pass proves an independent review RAN on this exact content and returned PASS (or that Erez
  waived it); it cannot prove the review was competent. Erez's mint-approval is the backstop.
- Raw REST/curl Notion writes are not held to the bar in piece 1 (only `ask`-gated). Named gap.
- A hollow-but-shape-conforming ticket can still pass a lenient reviewer.
- Hardcoded Team-Tasks ids, the GEN-58 page id, the housekeeping property-name deny-list, and the
  Notion MCP server UUID carry the same latent-rotation risk the sibling Notion hooks already
  document; a maintenance note goes in the header. The deny-list at least rotates SAFELY — a renamed
  housekeeping property starts being treated as substance (more gating), not less.
- A page moved into Team-Tasks can read as out-of-scope for up to 24h (negative-cache TTL).
- Whether PreToolUse hooks fire for sub-agent-originated tool calls is **unverified**;
  `notion-schema-guard`'s header records the same open question for its own `ask` arm. If they do
  not, a sub-agent could file an unreviewed ticket. To be checked at build; if unfired, it becomes a
  named gap, not a silent one.
