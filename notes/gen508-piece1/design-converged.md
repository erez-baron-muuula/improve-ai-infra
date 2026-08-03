# GEN-508 piece 1 — design (v3, premise-corrected 2026-08-03)

**Change:** add a fourth gate arm, `enforceTicketVetting`, to `~/.claude/hooks/auto-approve.js`,
plus a new `/vet-ticket` skill that writes its single-use **review record**. Scope of piece 1: the
**Notion** write paths only (Jira arms and the CLAUDE.md prose move are pieces 2 and 3).

> **v3 changed the foundation of this design. Read "Premise correction" below before anything
> else.** v1/v2 required a *human approval* on the record write and treated the resulting
> permission prompt as the gate. That prompt does not exist in the permission mode Erez works in,
> and it was not doing the work v2 credited it with. The gate now **refuses until a verifiable
> review record exists** and never asks. Sections rewritten for v3 are marked `[v3]`.

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
3. ~~`~/.claude-staging/` holds `passes/`, `vetting-passes/`, `check-passes/`,
   `config-unlock-passes/`, `sandboxes.json` (`ls`, this session). It is outside the
   `Write(~/.claude/*)` allow-list, so a Claude-issued write there always prompts Erez.~~
   **[v3] FALSE — this was the load-bearing error.** The directory listing is correct and the
   allow-list observation is correct, but the conclusion does not follow. Being outside the
   allow-list makes the write a *fall-through*, not a prompt: it reaches `logDeferred(input);
   return defer()`, and what happens next is decided by the permission mode. Measured 2026-08-03:
   every user turn runs under `bypassPermissions`, where a fall-through is silently allowed
   (178 deferred calls in one session, none prompted). **The record's location therefore carries
   no security property whatsoever.** It stays in `~/.claude-staging/ticket-passes/` only for
   consistency with the three sibling gates.
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
   **[v3] Correction to this fact's `ask` half:** `notion-schema-guard`'s `ask` is *silently
   discarded* under `bypassPermissions` — proven 2026-08-03 by feeding the hook the exact payload
   (it returned `permissionDecision:"ask"`) and then running that same command (it executed, no
   prompt). The part of fact 8 this design leans on — that a PreToolUse hook can inspect a Notion
   CREATE payload and act before the call runs — is unaffected, because this arm acts by
   `exit 2`, which does survive every mode. The architectural split still holds and is now
   load-bearing for a second reason: `ask` is unreliable, `exit 2` is not.
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

## Premise correction `[v3]` — the human gate never existed, and was never needed

v1/v2 rested on one sentence, repeated in every gate header: *the record write always prompts
Erez, and that prompt IS the human gate.* Two independent findings retire it.

**1. The prompt does not exist in the mode Erez works in.** Measured 2026-08-03: every user turn
carries `permissionMode: "bypassPermissions"`. Per the Claude Code docs, that mode keeps only
three kinds of prompt — explicit `permissions.ask` rules, org-set connector `ask`, and
`requiresUserInteraction` MCP tools — plus an `rm -rf /` circuit breaker. A **hook-emitted** `ask`
is not on that list, and testing confirmed it is discarded (see the fact-8 correction). An
explicit `permissions.ask` rule placed in a *project* settings file also failed to prompt, while a
`deny` rule from the same file took effect immediately — so `deny` is honoured live and `ask` is
not, at least from project scope. Whether a *user-scope* `ask` rule would prompt is **untested**;
the global settings files are locked, and this design no longer needs the answer.

**2. The approval was not doing the work v2 credited it with** (Erez, 2026-08-03; the argument
holds). The prompt shows a file path and a hash — not the ticket and not the review. Construct the
counterexample: a Claude that ran a sham review, or no review, produces an identical-looking
prompt. So the prompt could never distinguish the failure it existed to catch. And Erez already
approves ticket drafts in chat under a standing rule, so the gate was re-collecting an approval he
gives properly elsewhere, in a strictly worse place. v2's "Honest limits" even conceded this
("it cannot prove the review was competent. Erez's mint-approval is the backstop") without
noticing the backstop was blind.

**The corrected threat model.** This gate exists to stop Claude *skipping* the review — omitting
it under momentum, or losing it across a context compaction. That is what GEN-508's problem
statement actually describes ("a behavioral self-check rule exists and is skipped under
momentum"). It is *not* a defence against a Claude deliberately evading a rule it knows about.
Against omission, a gate that refuses until a review record exists is fully sufficient: the
default path — call `notion-create-pages` directly — hits a wall, and omission cannot
accidentally produce a record.

**Why this is buildable today.** The *refusing* half of every gate works in every mode:
`process.exit(2)` overrides `bypassPermissions` and the allow-list both. Only "stop and ask"
evaporates. So the gate needs no prompt, no change to Erez's locked config, and no dependence on
the active permission mode.

**What replaces the human gate — three layers, none involving Erez:**

1. **Refuse until a record exists**, bound to a content hash of the normalised payload, so the
   record cannot survive an edit to the content it covers.
2. **Verify the record names a reviewer that really ran.** The record carries the reviewer
   sub-agent's `agentId`; the hook opens `transcript_path` (a documented PreToolUse input field)
   and refuses unless that id appears as an agent that completed and returned. Verified available
   2026-08-03: a finished sub-agent's `tool_result` entry carries `agentId`, `agentType`, and the
   returned text — e.g. `agentId: a8ba802e6f032b513`, `agentType: check-reviewer`. Claude cannot
   invent an id that is also present in the session log; forging one means writing to the
   transcript, which is a deliberate act rather than an omission, and which auto mode blocks
   outright.
3. **Adjudicate disagreement rather than resolving it by fiat** — see "Disagreement with the
   reviewer" below.

**Honest limit, stated plainly:** layer 2 raises the cost of deliberate shortcutting; it does not
make it impossible, and nothing here does. It fully covers the threat the gate is for.

**Consequences that simplify the design** (each removes machinery v2 needed only to manage
prompts):

- **The `targets[]` batch array disappears.** Its entire justification was that one Erez
  "approve" must not raise N permission dialogs. With no dialogs, batching needs no array: one
  record per ticket. That in turn removes the per-target partial-consumption path, which is the
  root of four reviewed defects (orphaned `.claim.` files, the survivors-rewrite data-loss path,
  the `claim-lost` event conflating a race with data loss, and the retry loop). Consumption
  becomes a plain `unlink`.
- **Binding drops to `contentHash` alone.** `target` was a label for the human reading a prompt;
  with no prompt it is diagnostic text only, and matching on it caused a live skill/hook
  contradiction.
- **The `/wrap` open question dissolves.** v2 could not reconcile "`/wrap` files learning tickets
  silently" with "every filing needs a mint prompt". There is no prompt, so `/wrap` stays silent
  *and* gated: it runs the reviewer and writes the record without pausing. No carve-out needed,
  and Erez's sign-off is no longer required to ship.
- **The per-case waive loses its second confirmation** but keeps its substance: Erez says yes in
  chat, and the record stores `waived: true` + reason + the outstanding findings.
- **The summary card moves to where the approval actually happens** — the chat draft-approval step
  that the standing rule already requires — instead of a permission dialog that cannot render it.

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

Out of scope for piece 1, stated as a known gap: raw REST/curl Notion writes. ~~They are already
forced to an interactive `ask` by `notion-schema-guard`'s shell arm (fact 8), so they cannot run
silently~~ — **[v3] that mitigation does not exist.** Proven 2026-08-03: the shell arm's `ask` is
discarded under `bypassPermissions`, so a raw REST Notion write runs **silently today**. The gap is
therefore wider than v2 stated, and v2's "not oversold" claim was itself the overselling. Raw REST
writes are neither held to the ticket bar nor reliably gated at all. Closing it is piece 2, with
Jira; until then this is an open hole, not a cushioned one.

### Carve-out — GEN-58 reasoning-failure log appends

An append-only write (`insert_content` / `insert_content_after`) to the GEN-58 page (fact 10) is
NOT gated. Reason: a standing global rule requires those writes to happen "immediately, as each
instance is identified", explicitly exempts them from the draft-for-approval pause, and requires
them to be narrated as a one-line exception "not a pause for a go-ahead". `[v3]` v2 justified the
carve-out by "a mint prompt is exactly that pause"; there is no prompt, so the justification is now
**the review itself** — running a reviewer, and any consult it triggers, is the pause the rule
exempts. The conclusion is unchanged and Erez's Option-A decision stands. GEN-58 is also a log, not a
ticket that must stand on its own, so the bar this gate enforces does not apply to it.

**Any NON-append command on GEN-58 (a rewrite of the page) is still gated.** `[v3]` The design has
always said this; the *code* lost it when the carve-out was re-keyed from command names to subtree
membership, so `replace_content` with `allow_deleting_content:true` became exempt with zero network
calls — which would permit deleting the rolled-over log volumes. The rebuild restores the design's
intent: exempt content-*adding* commands only, never a destructive command, never a property edit.
Hardcoded page id carries the same maintenance-note treatment as the other ids here.

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
2. Consult the on-disk cache at **`~/.claude-staging/notion-page-parents.json`**.
   ~~Deliberately OUTSIDE `~/.claude`, because `settings.json` allow-lists
   `Write(C:\Users\Erez\.claude\*)`: a cache inside that tree could be silently rewritten by a
   Claude tool call to mark a real ticket out-of-scope, with no prompt (round-1 soundness
   finding).~~ **[v3] The same false premise, a second time.** Under `bypassPermissions` a file
   write is silently allowed *anywhere*, so the location gives the cache no integrity protection
   at all — it is equally rewritable in either tree. This is the second independent place v2
   reasoned "outside `~/.claude` ⇒ prompted ⇒ safe"; both are void.

   **The cache is therefore an untrusted input, and the design must stop pretending otherwise.**
   Rather than patch the location, apply a principle that fixes the whole class:
   **the cache may only ever cache a fact that INCREASES gating; any fact that would DECREASE
   gating must be re-derived, never trusted from cache.** Consequences: a cached "this IS a
   Team-Tasks row" is safe to trust (it only adds gating); a cached "this is NOT a row", and a
   cached "this is inside the GEN-58 subtree", both remove gating and so must not short-circuit a
   decision on their own. This resolves at the root two reviewed defects that were otherwise
   separate patches — the `g58` flag acting as a long-lived stale *negative*, and move-seeding
   silently revoking a volume's carve-out — and it makes cache poisoning unable to open the gate,
   only to slow it down.

   TTL: positive (gating-increasing) entries 30 days — a ticket stays a ticket. Negative entries
   are advisory only under the principle above, so their 24-hour TTL now bounds a *performance*
   window rather than a correctness one.
3. Miss -> one `GET https://api.notion.com/v1/pages/{id}`, token from Credential Manager
   (`claude-notion-token`), `curl.exe -sk`, 8s timeout, the `notion-fetch-staleness.js` pattern
   (fact 7). Read `parent.data_source_id` / `parent.database_id`. Cache the result.
4. Any failure -> `null`. The catch is total by design: no token, network error, non-JSON,
   unexpected shape, timeout, **and any bug inside the resolver's own code**. Nothing thrown here
   escapes into the caller's "internal scoping error" path, so the two error stances below cannot be
   confused for one another.

**Seeding — v2 claimed more than is possible `[v3]`.** v2: "A1/A4/A5 already know the parent from
their own payload, so on every gated create/duplicate/move the resulting page id — once known — is
written to the cache as a positive," which would spare the common "file a ticket, then immediately
edit it" sequence a network round-trip.

Correction: **for a create and a duplicate this is impossible, not merely unimplemented.** Notion
assigns the new page id server-side, and this arm is a PreToolUse hook — it runs *before* the call,
so at decision time the id does not yet exist. "Once known" never happens inside the hook. Only
**move** can seed, because its ids are in the payload. So:
- move -> seed the moved ids as gating-increasing positives (safe under the cache principle above).
- create / duplicate -> cannot seed; the first edit of a freshly created ticket pays one resolver
  round-trip. Accepted cost, and it fails in the safe direction (a cache miss resolves, it does not
  exempt).

A PostToolUse hook could seed from the create's *response*, but that is new machinery for a
one-round-trip saving and is explicitly out of scope for piece 1.

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

### Review-record shape and binding `[v3]`

Dir: `~/.claude-staging/ticket-passes/` — a distinct dir so ticket records can never cross-match
staging / vetting / check passes. **The location carries no security property** (see the fact-3
correction); it is there for consistency with the siblings, and could move under `~/.claude/`
without weakening anything.

```json
{ "kind": "ticket", "surface": "notion",
  "contentHash": "<sha256 of the normalized reviewed payload>",
  "reviewerAgentId": "<agentId of the sub-agent that reviewed this exact content>",
  "verdict": "PASS",
  "adjudication": null,
  "waived": false,
  "target": "<human-readable label: the page id, or 'create in Team-Tasks'>",
  "expires": "<now + 15 min, ISO-8601 UTC>" }
```

Binding is **`contentHash` alone**, plus the `reviewerAgentId` transcript check. `target` is
diagnostic text for a human reading the file and is **never matched on** — v2 bound on
target + hash, and the hook's implementation required a 32-hex id inside `target` while the skill
documented it as free-form, so following the skill permanently disabled a diagnostic. One field,
one purpose.

Accuracy note carried from round 2: hash-in-the-consumed-record is stronger than the siblings,
which match on kind + target only and keep `contentHash` in their skills' pre-mint freshness
check. That remains deliberate — the thing reviewed here IS the content, so a record must not
survive a change to it. What is new in v3 is that the hash is now the *only* binding, and that
`reviewerAgentId` is verified rather than merely recorded.

**One record per ticket.** v2 batched N tickets into one file carrying `targets: [...]` purely to
collapse N permission dialogs into one. With no dialogs that reason is gone, so a batch writes N
independent records and consumption is a plain `unlink` of the matched one. Requirement carried
over from the review: **consumption must refuse unless it actually removed a record whose hash
matches** — v2's implementation returned success without checking, so one record could authorise a
second write.
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

### Enforcement flow `[v3]`

1. `configUnlocked()` -> return (break-glass, shared accepted residual with the siblings).
2. Compute in-scope targets, applying the in-payload tests first and calling the resolver only for
   a call that survives them (see "Evaluation order"); none -> return (falls through untouched).
3. Find an unexpired record whose `contentHash` matches the normalised payload hash. No match ->
   hard-block, consuming nothing.
4. Verify the record's `reviewerAgentId` appears in `transcript_path` as an agent that completed
   and returned. Fails -> hard-block, consuming nothing.
5. `unlink` the record; if the unlink does not remove a hash-matching record, hard-block. Then
   `approve(...)`.
6. **Any internal error anywhere in this arm -> hard-block.** `[v3]`

Step 6 is a reversal of v2, which said "fall through to a prompt, same stance as the siblings",
and justified it by an asymmetry: an internal error means the arm is broken and should not become a
wall. That reasoning is now void twice over. First, **there is no prompt to fall through to** — a
fall-through under `bypassPermissions` is a silent approve, so v2's stance was a fail-open wearing
the language of caution. Second, the review found this exact defect already realised in code: the
record-scan half sat outside the arm's own fail-closed `try/catch`, so a record file containing
literal `null` threw and the hook exited with **no decision at all**. The whole arm therefore sits
inside one `try/catch` whose `catch` is `exit 2`.

The cost of step 6 is real and accepted: a bug in this arm becomes a wall rather than a silent
hole. That is the correct direction for a gate, and `configUnlocked()` break-glass remains the
escape — with the standing caveat that break-glass simultaneously disables all four gates.

Call site: in `main`, immediately after `enforceCheckDue`, before the allow-list check — verified in
round 1 to give the "an allow-list entry cannot bypass it" property. `[v3]` This placement now
matters more: under `bypassPermissions` allow rules have no effect anyway, but `exit 2` from here
still wins, which is precisely why the arm blocks rather than defers.

### Disagreement with the reviewer — adjudicate, do not resolve by fiat `[v3]`

**Erez's decision, 2026-08-03.** When the reviewer returns REVISE and Claude disagrees, the
disagreement is settled by **another independent review**, not by Claude overriding and not by an
automatic hard stop.

Two options were put to him and he rejected both, correctly. "Strict" (cannot file until reviewer
#1 passes) assumes reviewer #1 is right, which is unjustified — a pedantic or mistaken reviewer
becomes an unappealable authority, and the cost lands on Erez as an interruption. "Override with a
record" makes Claude the judge in its own case, which is the exact failure this gate exists to
prevent, merely documented. Adjudication assumes neither party is right and asks a third.

Specification:

- The adjudicator is a **fresh** sub-agent with no prior context, briefed on **one specific
  finding**, not asked to re-review the whole ticket. Narrow and answerable — the same shape as
  `/code-review`'s verifier stage, which is proven in this project.
- The brief carries, separately labelled and verbatim: the original goal, the reviewer's finding,
  and Claude's counter-argument. Claude does not summarise or characterise either side. This is the
  standing rule about briefing a delegated reviewer with the goal verbatim, applied to the party
  most able to bias the outcome — Claude.
- **Bounded.** At most two adjudicated findings per round and at most two rounds. If a finding
  survives adjudication, it stands and must be fixed. If adjudication is itself contested past the
  bound, it goes to Erez with both positions stated plainly. Erez is the terminal authority, but
  only in the genuinely contested minority case rather than on every disagreement.
- The adjudicator's `agentId` is recorded in `adjudication` on the record and verified by the same
  transcript check as `reviewerAgentId`, so an adjudication cannot be claimed without having run.
- **Honest limit:** this does not remove Erez from the loop, it makes his involvement rare and
  well-justified. Anyone terminal must be a human; the design's claim is only that Claude is never
  terminal in its own case.
- **Surfacing, designed in:** adjudication count per session goes into the gate event log and is
  reported at `/wrap`, with a re-evaluate bar — if adjudication fires on more than roughly one in
  four reviews, reviewer #1's brief is too strict and needs re-writing, not more adjudication.

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
   information, STOP and consult him (decision 1). `[v3]` If a finding is disputed rather than
   fixable, run the bounded adjudication above — never override it.
4. **Ask the hook for the hash.** `[v3]` Run
   `node "<hook path>" --ticket-hash "<payload .json>"`. **Do not reproduce the normalisation
   here** — it is ~100 lines and any drift makes every record fail to match, leaving break-glass as
   the only escape. Non-zero exit -> STOP, do not write a record.
5. **Evidence precondition, then write the record.** `[v3]` Verify: `reviewerAgentId` is present
   and non-empty and appears in this session's transcript as a completed agent with
   `"agentType":"check-reviewer"`; the record's `contentHash` still equals the hash from step 4;
   **and `verdict === 'PASS'` OR `waived === true`** (round-1 fix: v1 checked only that a review had
   *run*, so a REVISE verdict could still get through — `/vet-rule` gates on its verdict and this
   must too); and if any finding was disputed, `adjudication` names a verified adjudicator. Then
   write the record. **The record write no longer prompts anyone and is not an approval step** — it
   is evidence, and the hook re-verifies all of it independently rather than trusting the skill.

   **Erez's approval happens in chat, before this, and is unchanged.** `[v3]` The standing rule
   requiring a draft for his approval already covers it; v2 tried to re-collect it at the
   permission dialog, which could render only a path and a hash. **Show him a SUMMARY CARD, not the
   drafted body** (his instruction, 2026-08-02): title, a one-line gist, parent, the ticket IDs the
   draft body cross-references, the properties (type, status, assignee, Urgency, Gain ratio, derived
   Priority), the reviewer's verdict and any findings, and an offer to show the full body on
   request. Two consequences, accepted deliberately: his approval means "file this", not "I endorse
   this wording" — the body's quality rests on the independent reviewer; and the cross-references
   line is read out of the draft text, not from a stored relation, because the live Team-Tasks
   schema has exactly two relation properties, `Parent item` and its inverse `Children` (verified
   2026-08-02 against `GET /v1/databases/fe198002-...`), and no generic related-tickets field.

   **Standing-rule conflict this creates (resolve via `/vet-rule`; do not leave implicit).** The
   global CLAUDE.md rule beginning "Before creating or materially changing a ticket in a tracker"
   requires drafting "title, body, and key properties" for Erez's approval. Summary-card approval
   contradicts the "body" half of that for gate-mediated filings. The rule needs an explicit
   amendment: where an independent reviewer has passed the body under this gate, Erez approves the
   card and the body is the reviewer's charge. Until that lands the two contradict each other, so it
   ships WITH piece 1 rather than being deferred to piece 3.
6. **Apply** the Notion call, then **verify the record is gone** (consumption is an `unlink`, so
   the post-write check is "no record for this hash remains", not a `*.consumed.<ts>` rename).
   `[v3]` v2's Step 8 check as written FAILed on every successful filing — it looked for "a
   still-live `*.json` naming this target and hash" in the same directory where the skill's own
   ticket-record lives, and nothing removed it. Check by hash, and only for un-consumed records.

**Batch approval (Erez's choice, 2026-08-02): several pending filings are shown together on one
card list and approved in one action.** `[v3]` **The `targets[]` array is deleted.** Its only
justification was that one "approve" must not raise N permission dialogs; with no dialogs, a batch
simply writes N independent single-hash records, and each is consumed by its own `unlink`. This
removes the divergence from `consumePassFile`'s semantics that v2 had to special-case, and with it
the partial-consumption path behind four reviewed defects. `/vet-code` Step 4's live-verify case
becomes the simpler one: N records -> N writes -> directory empty, and removing one record leaves
the others still gating their own payloads.

**The per-case waive (round-1 fix — v1 got this backwards).** v1 claimed "Erez declining the mint IS
the waive". That is inverted: declining means no record, so the write stays blocked — a decline
*reinforces* the stop. Decision 2 asks for a waive that lets a specific write through despite the
stop. So: when the reviewer holds findings that cannot be fixed — and adjudication has upheld them,
since a *disputed* finding goes to adjudication, not to a waive — `/vet-ticket` shows Erez the
outstanding findings in plain terms and asks. On his affirmative, the record stores `waived: true` +
`waiveReason` + the outstanding findings. The hook is unchanged: a valid record is a valid record.
The waive is per-case, scoped to one write, and never touches the global break-glass.
`[v3]` v2 called the mint prompt "his second, deliberate confirmation" — there is no second
confirmation, so **the waive now rests on a single explicit chat answer**, which must therefore be
an unambiguous yes to a specific named finding, never inferred from a general go-ahead.

**Signal surfacing, designed in (round-1 fix — not deferred).** Every gate event —
review PASS, REVISE-then-fixed, adjudicated (and which side won), waived, or Erez declining at the
card — is appended by `/vet-ticket` to `~/.claude-staging/ticket-gate-events.jsonl`
`{ts, target, verdict, adjudicated, waived, reason}`. Reaching Erez: (a) **immediately** — a waive
or a decline is reported as a line in that same turn's "📌 For you" block, in the skill's own
instructions, so it never waits for a later routine; (b) **in aggregate** — a `/wrap` line
reporting waive / decline / adjudication counts, with two re-evaluate bars: if waives exceed roughly
one in four gated writes the lane is firing too often (revisit the scope), and if adjudication
exceeds roughly one in four reviews then reviewer #1's brief is too strict (rewrite the brief, do
not add more adjudication). (b) edits the `/wrap` skill, which is a `/vet-rule` change, so it lands
in piece 3; (a) needs nothing beyond `/vet-ticket` itself and ships in piece 1, so the signal has a
working reader from day one.
`[v3]` "Erez declining the mint" is now "Erez declining at the summary card" — the event is the
same, its location moved from a permission dialog to the chat approval.

**Pieces 2 and 3 become real tickets, not prose (round-2 advisory).** "Piece 2" (Jira create/edit
arms + the raw REST/curl Notion arm) and "piece 3" (move the bar prose out of the always-loaded
global CLAUDE.md into the reviewer's checklist; the `/wrap` aggregate line; the escalation log for a
consult that would otherwise die with the session) are filed as sub-items of GEN-508, drafted for
Erez's approval, at the end of this build — the standing rule is that a named follow-up is created
immediately rather than merely referenced.

## Open question — RESOLVED by the v3 premise correction `[v3]`

v2 could not reconcile two of Erez's standing rules and escalated it: `/wrap` files learning
tickets "automatically and silently, with no in-the-moment approval", but under v2 each such
filing needed a mint prompt, so wrap-up would have stopped and asked him once per ticket. The two
options were (i) accept the prompts or (ii) carve `/wrap` out and leave those filings ungated —
a choice between more interruptions and less enforcement.

**Neither is needed.** There are no prompts, so `/wrap` stays silent *and* gated: it runs the
reviewer and writes the record without pausing. Enforcement applies to exactly the filings
GEN-508's §8 records as having gone wrong (a near-duplicate, and a ticket for work an existing
ticket had explicitly declined — both from silent `/wrap` filing, both caught late), with no
interruption added anywhere. This was the only item blocking ship on Erez's sign-off.

The GEN-58 carve-out above is separate and already justified by its own standing rule.

**One genuine cost to name:** `/wrap` gets slower, because each filing now runs a reviewer
sub-agent. Silent, but not free.

## Honest limits

- `[v3]` The record proves an independent review RAN on this exact content, that the reviewer it
  names really existed and returned, and that the verdict was PASS (or that Erez waived it). It
  **cannot prove the review was competent.** v2 named "Erez's mint-approval" as the backstop for
  this; that backstop never existed and could not have seen anything if it had. The real backstops
  are the adjudication panel for disputed findings and the reviewer brief's own quality — and if
  reviewer #1 is systematically lenient, nothing in this design detects it. That is a named residual
  and the aggregate `/wrap` counts are the only early-warning available.
- `[v3]` The transcript check on `reviewerAgentId` raises the cost of a deliberately fabricated
  review; it does not make one impossible. A Claude willing to write to its own session transcript
  defeats it. This design targets omission, not evasion, and says so.
- `[v3]` Whether a *user-scope* `permissions.ask` rule would prompt under `bypassPermissions` is
  untested — the global settings files are locked. Nothing in v3 depends on the answer, but it is
  the open question for anyone trying to restore a genuine prompt to any of the four gates.
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
