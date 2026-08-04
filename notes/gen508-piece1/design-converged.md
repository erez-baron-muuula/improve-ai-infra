# GEN-508 piece 1 — design (v5, review-corrected 2026-08-03)

> **v5 status — two `/check` rounds, six documents' worth of self-contradiction found.**
>
> **Round 1** (pre-mortem + premise-challenge, holistic/proportionality, soundness+grounding): all
> three lenses REVISE, eight material findings. The three that mattered most: the hook never checked
> the review *verdict* at all, so a `REVISE` record would have been approved; this document had
> silently reversed a decision Erez had already settled about the GEN-58 carve-out, and never once
> cited the companion document that supersedes four of its sections; and "`exit 2` beats every mode"
> — the single sentence the whole design rests on — carried no provenance and is untested for a
> *slow* hook, which this arm is. v4 was that revision.
>
> **Round 2:** all three lenses REVISE again. Two lenses independently found that v4's verdict-token
> fix was defeatable with no forgery at all (a flat substring search cannot separate the reviewer's
> reply from the prompt Claude wrote), and that v4's headline network invariant had been written into
> this document while the *normative* algorithm it was supposed to constrain sits in the companion
> document, untouched. v5 is that revision. Sections changed for v5 are marked `[v5]`.
>
> **v5 retracts two v4 claims outright** rather than patching them: the absolute "no blocking path
> may make a network call" invariant, which is not achievable given a positives-only cache; and v4's
> negative-cache reasoning, which contradicted the normative document — a contradiction introduced
> *by the very revision that was cataloguing three earlier ones*. That is why the structural fix now
> recorded is mechanical: **before editing any section carrying a supersession pointer, read the
> superseding section first.**
>
> **One decision remains open and is Erez's** — see the end of "A blocking decision must never wait
> on the network". It cannot be closed by more review; it needs a measurement first.

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
   sub-agent's `agentId`, and the hook refuses unless the harness's own on-disk evidence for that
   id exists and is the right kind of agent.

   **Use the established GEN-518 mechanism, not a transcript scan.** Each sub-agent is persisted
   as a pair — `agent-<agentId>.jsonl` plus an `agent-<agentId>.meta.json` sidecar — under
   `<session dir>/subagents/`. Verified live 2026-08-03 in this session: 
   `agent-a8ba802e6f032b513.meta.json` reads
   `{"agentType":"general-purpose","description":"Angle A line-by-line diff scan","toolUseId":"toolu_016gfMH2uyTV9YJy2gZ69VRr","spawnDepth":1,"model":"opus"}`.
   This is the same evidence `/vet-rule` Step 4 already uses in production, so the hook should
   reuse it rather than invent a second mechanism. It is also cheaper and stronger: a bounded
   two-file read instead of scanning a session log that is already 600 KB+ per agent, and
   `agentType` is recorded independently, so the hook can require `check-reviewer` rather than
   merely "some agent ran".

   **Deriving the path without a hand-built slug** (GEN-518's other lesson — a hand-derived
   project slug was wrong on Windows): the hook is given `transcript_path`, which is
   `<...>/projects/<slug>/<session-id>.jsonl`. Strip the `.jsonl` and that is the session
   directory; `subagents/` is inside it. Nothing is guessed.

   Claude cannot invent an id whose sidecar also exists on disk; forging one means writing files
   into its own session state — a deliberate act rather than an omission, and one auto mode blocks
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

> `[v4]` **Superseded by `design-scoping-v3.md` §2.** Where the two disagree, that document wins.
> The stage structure, budgets and the two-case zero-ids rule live there; what follows is the
> per-arm intent it implements.

**A1 — create.** Tool = `notion-create-pages`, `parent` resolving to the Team-Tasks data source or
database id (fact 9), matched dash- and case-insensitively. Every such create is in scope. One call
= one target (the whole `pages[]` array is hashed together), so one pass covers a multi-page create.

**A2 — property edit.** Tool = `notion-update-page`, `command === 'update_properties'`, page
resolves to Team-Tasks, and `properties` contains at least one **substance** key. Substance is
defined by DENY-LIST, not allow-list (round-3 hardening): **the deny-list is the one in "Build
detail" immediately below, which is the single source of truth** `[v4]`; **every other key counts
as substance**, including the title and the three priority fields. An allow-list would silently
un-gate a field the moment a Team-Tasks property is
renamed — the round-3 reviewer's point, and it applies to the title especially, whose literal
property name (`Name`) the hook can only match as a string since the payload carries no property
types. The deny-list fails the safe way: an unknown or renamed key is treated as substance and
gated. A call mixing both is in scope.

`[v4]` **Why this paragraph now points at one list.** v3 stated the deny-list twice, ten lines
apart, and the two disagreed: the informal version carried a `url` entry matching no real property
and omitted `Reason` and `Remind me (days before)`, both of which the live schema shows and both of
which Erez's decision 5 exempts as housekeeping. A builder taking the informal list would have
gated two housekeeping fields. Only the schema-verified list below is normative; nowhere else in
this document may restate it.

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
anything OTHER than `update_properties`. Unknown/future commands are treated as content-bearing and
gated — the open-enum stance fact 6 requires.

`[v5]` **The `update_verification` exemption is dropped**, per `design-scoping-v3.md` §2 (zero
occurrences in 1,313 payloads — exempt surface with no traffic behind it). v3/v4 still carried it
here while the normative document had already removed it; a live contradiction with no upside, since
nothing needed the exemption.

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

> **`[v4]` SUPERSEDED — this section is normatively replaced by `design-scoping-v3.md` §3
> finding 5 and §6 decision 1.** Read that, not the v3 text this box replaces. v3 restated a rule
> Erez had already overruled, on the same day, in the companion document. What follows is the
> settled rule.

**The settled rule (Erez, 2026-08-03: "I choose A"): exempt every content-bearing write within the
GEN-58 *subtree*; keep property edits on the GEN-58 ticket row itself gated normally.** The subtree
is the GEN-58 ticket page (fact 10) plus any page whose parent is that page — the rolled-over
volume pages where the write-ups actually live. Not one hardcoded volume id: they change every ~25
entries and a stale id is a silently dead carve-out.

Reason: a standing global rule requires those writes to happen "immediately, as each instance is
identified", explicitly exempts them from the draft-for-approval pause, and requires them to be
narrated as a one-line exception "not a pause for a go-ahead". GEN-58 is a log, and the bar this
gate enforces ("the body stands on its own", "the priority fields are derived") is a *ticket* bar
that does not apply to a log body. Its row properties are still ticket properties, so a
substance-property edit on the GEN-58 row still goes through the gate.

**`[v4]` What v3 got wrong here, and why it mattered.** v3 asserted "exempt content-*adding*
commands only, never a destructive command", justified by "which would permit deleting the
rolled-over log volumes". Both halves fail against measurement in `design-scoping-v3.md` §3
finding 5:

- **Coverage.** Of 159 real writes targeting GEN-58, `update_content` accounts for **150** and
  `insert_content` for 8. A content-*adding*-only rule exempts ~5% of real log writes and
  hard-blocks the rest — colliding head-on with the standing rule that mandates those writes be
  immediate and pause-free. Two successive semantic characterisations of "append" were falsified
  against real traffic (5% and 15% coverage) before Erez chose to stop trying.
- **The protection rationale is void.** The volume pages holding the write-ups are **not
  Team-Tasks rows** (their parent is the GEN-58 page, not the data source), so this gate never had
  them in scope and never protected them. v3's fear of "permitting deletion of the log volumes"
  described a protection that did not exist to lose. Keeping the log intact belongs to
  [GEN-453](https://app.notion.com/p/39e6e495d07c819b9d51ff4428e65e43) (verify-after-write for
  Notion body edits), which was extended on 2026-08-03 to cover a write that lands correctly while
  destroying adjacent content, and which runs immediately after GEN-508 ships.

This was a **third** instance of the failure mode this document already boxes twice: a claim
asserted here while the companion document written the same day refutes it. The `[v3]` tag on the
paragraph makes it worse, not better — it was re-asserted *after* the correcting measurement
existed. Belongs on GEN-58 with the other two.

Residual, stated: a cold cache during a Notion outage blocks a log write; the escape is one
`/vet-ticket` run, not break-glass.

### Evaluation order — cheap local tests first, resolver last (added in round 2)

> `[v4]` **Superseded by `design-scoping-v3.md` §2 for the stage mechanics, and §4 for the measured
> costs** (`[v5]` — v4 cited §2/§3; §3 is the other-findings section). The ordering principle below
> survives; see "A blocking decision must never wait on the network" for the latency ceiling.

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

> `[v4]` **Superseded by `design-scoping-v3.md` §2 stage 4** (`[v5]` — v4 cited §3; the resolution
> algorithm is in §2, and the mis-citation would have sent a builder to the wrong section). Where the
> two disagree, that document wins. See also "A blocking decision must never wait on the network"
> for the latency ceiling that section imposes on stage 4.

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

   `[v5]` **The cache is POSITIVES-ONLY.** `design-scoping-v3.md` §2 states it flatly — "on-disk
   cache stays positives-only" — and that document is normative here. Positive entries: 30 days, a
   ticket stays a ticket. **There are no negative entries at all**, so there is no negative TTL, no
   stale-negative residual, and nothing for the cache-integrity principle to have to exclude.

   > **`[v5]` v4 broke this and must be retracted, not patched.** v3 left the negative-TTL wording
   > self-cancelling ("advisory only" + "bounds a performance window"). v4 "fixed" it by ruling that
   > a cached negative *is* consulted and may route a call to approve — which contradicts the
   > normative document outright. So while v4 was busy cataloguing three earlier instances of this
   > document refuting itself, **it introduced a fourth of its own.** That is the strongest evidence
   > yet that the failure mode is structural and not a lapse of care: the fix for a contradiction was
   > itself written without re-reading the document that governs the section. The rule this yields is
   > narrow and mechanical — *before editing any section carrying a supersession pointer, read the
   > superseding section first* — and it belongs on GEN-58 with the other three.
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

`[v4]` **The unknown case is now reached without a network call, not after one.** Under the invariant
in "A blocking decision must never wait on the network", a cold cache no longer triggers a resolve
before deciding: the arm blocks immediately and the cache is warmed out of band, so the retry
resolves from cache. `null` therefore means "not known locally", and the resolver only ever runs on
paths that end in approve. Everything below about the *stance* is unchanged; only its timing is.

**Hard-block (exit 2)**, message naming `/vet-ticket`. This departs from the siblings'
fall-through stance, deliberately: Erez was asked this exact question in plain terms on 2026-08-02 —
"when the guard can't tell whether a page is a work ticket (say Notion is unreachable), it stops and
asks you rather than waving the edit through" — and answered "go". A `defer()` is silently
auto-approved under bypass-permissions mode (the GEN-562 leak), so defer would not be "stops".

> **`[v3]` v2 contradicted itself here, and three `/check` rounds did not catch it.** The sentence
> above already knew that a fall-through is *silently auto-approved under bypass-permissions* — that
> is the whole argument for hard-blocking. Fact 3 and the cache rationale simultaneously asserted
> that a Claude write to `~/.claude-staging` *always prompts Erez*. Both statements are about the
> same mechanism in the same mode and cannot both be true. The design was built on the false half
> while stating the true half two sections away. Recorded here because the lesson is not "check the
> docs" — it is that a premise repeated in a header goes unre-examined even when the document
> refutes it elsewhere. Belongs on GEN-58.

Round-1 raised that this is only proportionate if the escape is proportionate. It is: **`/vet-ticket`
needs no Notion access** — it reviews the drafted payload and writes a local record. So a Notion
outage costs one review plus one local file write, NOT a break-glass. Global break-glass (which would
suspend all four gates) is never the required escape for this case. `[v3]` Note the reviewed defect
that broke this promise in code: every `scope:'block'` verdict short-circuited *before* the record
directory was read, so an `unresolved` block could not be cleared by a record even though this
paragraph and the skill both promised it could. The rebuild must read the record directory for block
verdicts too, or this escape does not exist.

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

`target` is diagnostic text for a human reading the file and is **never matched on** — v2 bound on
target + hash, and the hook's implementation required a 32-hex id inside `target` while the skill
documented it as free-form, so following the skill permanently disabled a diagnostic. One field,
one purpose.

#### What the hook actually verifies `[v4]` — three bindings, not two

v3 said "binding is `contentHash` alone, plus the `reviewerAgentId` check", and its enforcement
flow matched that exactly: hash match, then sidecar existence. **The `verdict` field was written
into the record and never read by anything.** A record carrying `verdict: "REVISE"` — or a `"PASS"`
typed over a reviewer that actually returned REVISE — passed every check the hook performed. This
is the identical defect the design already found and fixed at the *skill* layer in round 1 ("v1
checked only that a review had *run*, so a REVISE verdict could still get through"), never carried
across to the hook, which is the one layer whose whole purpose is not to trust the skill. It
falsified two headline claims: that refusing-until-a-record-exists is "fully sufficient" against
omission, and that layer 2 "fully covers" the threat.

Worse, the sidecar check as v3 scoped it could not have been extended to fix this: `meta.json`
carries only `agentType`, `description`, `toolUseId`, `spawnDepth`, `model` — never a verdict. And
a second attack needed no forgery at all: cite the `agentId` of a real `check-reviewer` from some
*unrelated* `/check` run earlier in the same session, and both of v3's bindings are satisfied by an
agent that never saw this ticket.

**Both close with one mechanism.** The reviewer is instructed to end its reply with a single
machine-readable token, and the hook verifies that token in the reviewer's own transcript:

```
TICKET-REVIEW-VERDICT: PASS <contentHash>
```

That establishes all three facts at once — this agent ran, it reviewed *this* content, and it
returned PASS — and it cannot be satisfied by an unrelated reviewer, whose transcript carries a
different hash or none.

Verified available, 2026-08-03: a reviewer's returned text does land in its own `agent-<id>.jsonl`.
Checked against this panel's own round-1 soundness reviewer, `agent-a0dc50e30603f019f.jsonl` —
`grep -o 'STATUS: [A-Z]*'` returns `STATUS: PASS` and `STATUS: REVISE`, one each.

#### `[v5]` How that token is checked — and why v4's version was still broken

v4 specified "bounded **substring search** of `agent-<reviewerAgentId>.jsonl`", and defended it with
a documentation rule: the brief must never show the token with `PASS` filled in. Round 2 defeated
that, and reproduced the defeat on the very file cited above: `agent-a0dc50e30603f019f.jsonl` line 1
is `"type":"user"` — the prompt — and contains the literal `STATUS: PASS`, purely because the verdict
template lists both options; line 42 is `"type":"assistant"` and carries the reviewer's actual and
opposite `STATUS: REVISE`. **A whole-file substring search cannot tell those apart.** Two lenses
independently reached the same conclusion.

Three distinct ways v4's version failed, all needing no forgery whatsoever:

1. **Prompt text counts as a match.** The reviewer's brief — which contains the drafted payload
   Claude wrote — is stored in the same file the hook searches. Since the hash is computed *before*
   the review (skill step 3), Claude can place the satisfied token anywhere in the brief or in a
   payload field outside the hashed projection, and a genuinely-REVISE review still approves.
2. **A REVISE reviewer's own prose can contain the PASS form** while explaining why it is not
   emitting it. Ordinary, non-adversarial, and fatal to a naive search.
3. **This project is the worst case for it.** Tickets here routinely quote this document's own
   literal strings, so an entirely innocent GEN-508 ticket could trip it by accident.

The deeper error was mine and is worth naming: **v4 answered a mechanism problem with a
documentation instruction.** A standing rule says to prefer a guard the system actually executes
over prose nobody re-reads, and I wrote prose. The transcript format itself carries the fix.

**`[v5]` The corrected check — structural, not textual:**

- Search **only assistant-authored content** (records with `"type":"assistant"`), never the whole
  file. The role field is present in the format, verified above, so this is available today.
- Collect every occurrence of the prefix `TICKET-REVIEW-VERDICT:` in that content. Require **at
  least one**, and require **the last one** to read exactly `PASS <contentHash>`. Last-occurrence
  rather than any-occurrence is what defeats failure 2: a reviewer explaining itself may mention the
  form, but its verdict is what it ends on.
- **Close the channel at source too** (defence in depth, and the cheaper half): before the brief is
  sent, `/vet-ticket` scans the drafted payload *and* the assembled brief for the prefix
  `TICKET-REVIEW-VERDICT:` / `TICKET-ADJUDICATION:` and refuses to proceed if either appears. Claude
  cannot then place the token where the hook will read it, whatever the hook's parsing does.
- **`TICKET-ADJUDICATION` gets all of the above identically.** v4 hardened the reviewer token and
  left the adjudicator token on the old rule — parity is not optional, it is the same hole twice.
- `/vet-code` must assert each of these three defeats explicitly: a PASS token planted in the
  prompt, a REVISE reviewer whose prose contains the PASS form, and an adjudication token planted
  the same way. A test that only checks the happy path certifies nothing here.

`verdict` and `waived` in the record remain a cheap pre-filter (fail fast before opening a large
transcript) and are **not** the authority; the token is. An `UPHELD` adjudication does not clear the
gate.

Cost, named: one local read of a file that can exceed 600 KB per gated write, now with minimal
per-record JSON parsing to isolate assistant content rather than a flat scan. Cap the read; treat
cap-exceeded as a block. The parsing is the price of the fix — a flat scan is cheaper and does not
work.

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
> `[v5]` **The hash formula is superseded by `design-scoping-v3.md` §5 clause 2.** The four
> per-shape projection bullets that stood here are **deleted, not merely annotated** — leaving them
> visible was itself the defect round 2 found, since a linear reader implements what is in front of
> them and the supersession was only stated 400 lines later.
>
> Normative formula: **`sha256Hex(stableStringify(normalise(tool_input).root))`** — the whole
> normalised, hoisted payload, not a curated projection. Two independent reasons, and only the first
> was in v4:
>
> 1. **It has to match.** The corpus carries the same semantic call both plainly and wrapped in a
>    `{data: "…"}` envelope. Hoisting is what makes both forms produce one tree and therefore one
>    hash; a projection minted from the drafted object would fail to match the call as actually
>    emitted, systematically, with break-glass as the only escape.
> 2. **A projection leaves everything outside it unbound.** Whatever the hash does not cover can be
>    changed after the review while the record still matches — including flags that make a content
>    command destructive (`allow_deleting_content` sat outside every bullet above). Hashing the whole
>    normalised payload means "reviewed" covers the entire call, which is what the record claims.
>
> `stableStringify` (auto-approve.js:829) sorts object keys and preserves array order — verified
> deterministic by the round-1 soundness reviewer. `design-scoping-v3.md` §5 also records the
> resulting build-time sync obligation: the skill as checked in today hashes the **raw** `tool_input`
> with no normalisation, which is a live disagreement with this formula.

**One shared projection definition.** The hook and `/vet-ticket` must compute the hash identically;
any drift makes EVERY record fail to match, so nothing can get through and the only escape left
is the global break-glass. The failure is loud and immediate rather than latent, but the cost of
hitting it is high, so: the projection is written once, in the hook's header comment, and
`/vet-ticket` cites that as its source. `/vet-code` Step 4's mandatory pass-consumption assertion
covers this — it exercises a real write-record -> block-without-record -> approve-and-consume in
the fixture tree, which is exactly the test that would catch a projection mismatch.

### Enforcement flow `[v3]`

> `[v5]` **Step 2's scope computation is `design-scoping-v3.md` §2's four stages — that document is
> normative for it, including the network-latency question.** Step 2 below reads as "resolve, then
> decide", which is what Stage 4 actually does; v4 added an invariant forbidding that without
> updating either this list or Stage 4, so a builder working from these numbered steps would have
> implemented the pattern v4 claimed to have removed. The invariant is retracted in "A blocking
> decision must never wait on the network" and replaced by a latency ceiling plus a measured
> pre-build gate — read that section before implementing step 2. `design-scoping-v3.md` also
> supersedes v2's internal-error stance, which is now step 8.

1. `configUnlocked()` -> return (break-glass, shared accepted residual with the siblings).
2. Compute in-scope targets, applying the in-payload tests first and calling the resolver only for
   a call that survives them (see "Evaluation order"); none -> return (falls through untouched).
3. Find an unexpired record whose `contentHash` matches the normalised payload hash. No match ->
   hard-block, consuming nothing.
4. Cheap pre-filter: `verdict === 'PASS' || waived === true`. Fails -> hard-block. `[v4]`
5. Verify the record's `reviewerAgentId` (and `adjudication`'s id, when present) against
   `<session dir>/subagents/agent-<id>.meta.json`: the sidecar must exist and its `agentType` must
   be `check-reviewer`. Session dir derived from `transcript_path`, not from a built slug. Fails ->
   hard-block, consuming nothing.
6. **Verify the verdict itself** `[v4]` — substring-search `agent-<reviewerAgentId>.jsonl` for the
   literal `TICKET-REVIEW-VERDICT: PASS <contentHash>`; and when `adjudication` is present, for
   `TICKET-ADJUDICATION: OVERTURNED <contentHash>` in the adjudicator's transcript. Absent, or the
   file unreadable, or over the size cap -> hard-block. Skipped only when `waived === true`, where
   Erez's explicit chat answer is the authority instead. See "What the hook actually verifies".
7. `unlink` the record; if the unlink does not remove a hash-matching record, hard-block. Then
   `approve(...)`.
8. **Any internal error anywhere in this arm -> hard-block.** `[v3]`

Step 8 (v3's step 6) is a reversal of v2, which said "fall through to a prompt, same stance as the siblings",
and justified it by an asymmetry: an internal error means the arm is broken and should not become a
wall. That reasoning is now void twice over. First, **there is no prompt to fall through to** — a
fall-through under `bypassPermissions` is a silent approve, so v2's stance was a fail-open wearing
the language of caution. Second, the review found this exact defect already realised in code: the
record-scan half sat outside the arm's own fail-closed `try/catch`, so a record file containing
literal `null` threw and the hook exited with **no decision at all**. The whole arm therefore sits
inside one `try/catch` whose `catch` is `exit 2`.

The cost of step 8 is real and accepted: a bug in this arm becomes a wall rather than a silent
hole. That is the correct direction for a gate, and `configUnlocked()` break-glass remains the
escape — with the standing caveat that break-glass simultaneously disables all four gates.

**`[v4]` The escape is NOT uniform across error classes, and v3 implied it was.** Elsewhere this
document promises that a block's escape is "one review plus one local record write, NOT a
break-glass". That holds for the resolver/network class. It does **not** hold for one specific
class: a bug in the shared normalisation/hashing code. `/vet-ticket` obtains its hash by calling
*this same code* through the hook's `--ticket-hash` CLI mode, and is instructed to STOP without
writing a record if that call exits non-zero. So a normalisation bug breaks the enforcement path
and the escape path identically, and global break-glass — which suspends all four gates at once —
becomes the only door. Split the two classes explicitly:

| error class | block? | escape |
|---|---|---|
| resolver / network / token | yes | one `/vet-ticket` run, no Notion access needed |
| record file malformed or unreadable | yes | re-run `/vet-ticket`, which rewrites it |
| **shared normalisation / hashing bug** | yes | **global break-glass only** |

Mitigation is pre-install, not runtime: `/vet-code` Step 4's mandatory pass-consumption assertion
exercises write-record -> block-without-record -> approve-and-consume against the real normaliser,
which is exactly the test that catches a projection or hashing fault before it can ship. Treat that
assertion as blocking for install, not advisory. Residual after it: a normalisation bug on a payload
shape the fixture does not cover. `review-findings.md` still lists 22 open defects in this layer's
predecessor, so this is a live risk rather than a remote one — and it is the strongest argument for
keeping the normaliser as small as the scoping design allows.

### `[v4]` A blocking decision must never wait on the network — the slow-hook race

The single sentence this whole design rests on is *"`process.exit(2)` overrides `bypassPermissions`
and the allow-list both"*. In v3 it was the only load-bearing claim in the document with **no
provenance at all**, while lesser claims carried live test output. The panel caught that. Splitting
it into what is actually known:

**Verified live, 2026-08-03, this session.** A PreToolUse hook's refusal *does* block under
`bypassPermissions`: `auto-approve.js` refused a chained Bash command of mine with its mixed-risk
message and the command did not execute. The three installed sibling gates block the same way in
production. So for a *fast* hook the claim holds and is now cited.

**Untested, and specifically for this arm.** Every hook proven to block is fast and makes no network
call. This arm spawns PowerShell for the Credential-Manager token plus `curl.exe`, with an 8s
timeout and ~700–1000 ms typical measured in `design-scoping-v3.md`. Nothing establishes that a
*slow* PreToolUse hook's refusal still wins. [claude-code#20946](https://github.com/anthropics/claude-code/issues/20946)
reports exactly this failure — "the command executes immediately while the hook runs asynchronously
in the background", with a hook denial arriving 37 s after the `git commit` it was meant to stop and
five commits landing despite denials. Read directly, not relayed, 2026-08-03. Weight it honestly:
the reported hook took **30–40 s** (shellcheck/ruff/mypy/pytest), an order of magnitude slower than
this arm; it concerns the `--dangerously-skip-permissions` CLI flag, which may or may not be the
same code path as the in-session `bypassPermissions` mode; and it was closed as not-planned and
tagged stale in Jan 2026, which is evidence of neglect rather than of confirmation. It is a credible
report of the right failure mode, not a demonstration that this arm is affected.

**`[v5]` v4's answer was an absolute invariant. Round 2 showed it is not achievable, so it is
retracted.** v4 wrote:

> ~~No code path that ends in a block may depend on a network round-trip.~~

The asymmetry behind it is sound — a slow path ending in *approve* is harmless, because if the race
exists the call was going to run anyway; only a slow path ending in *block* fails silently. What is
false is that the resolver can be kept off the blocking side. Two lenses found this independently,
and checking the normative document settles it:

- `design-scoping-v3.md` §2 Stage 4 resolves **synchronously before returning a verdict**, and
  `unknown` (including deadline-exhausted) feeds straight into a hard-block. Its budget is a **20 s**
  wall-clock ceiling — not the ~700–1000 ms typical figure v4 quoted, which flattered the case.
- The cache is **positives-only**, so a non-ticket page is never cached and *every* edit to one
  resolves. "Block fast on cold cache" would therefore block every non-ticket Notion page edit,
  permanently, not once — v4's "self-healing on retry" assumed a negative would be cached, and none
  is. That option is unworkable, not merely costly.
- v4 wrote the invariant into *this* document while declaring `design-scoping-v3.md` normative for
  resolution, so it never reached the algorithm that will actually ship. A fifth instance of the
  same structural failure, and the reason the pointer-before-editing rule above is being recorded.

**What replaces it — bound the exposure, measure the premise, and name the decision that is not
mine.**

1. **Latency ceiling on any blocking path.** Stage 4's shared budget drops from 20 s to **2 s**
   wall-clock, per-subprocess **1.5 s**. Cheap, strictly better, and independent of whether the race
   exists: it cuts the exposed window by an order of magnitude and moves it far below the 30–40 s
   hook in the only report of the failure. Cost: a slow Notion response now yields `unknown` ->
   block where it previously resolved. That cost lands on exactly the case Erez already answered
   "go" to on 2026-08-02, and its escape is one `/vet-ticket` run needing no Notion access.
2. **Blocking pre-build gate — the premise gets measured, not argued.** Before code is written
   against this design: install the arm in the fixture tree with an artificial multi-second delay on
   the blocking path, issue a real gated Notion write, and confirm the API call did **not** go out —
   not merely that the hook script, invoked standalone, computed `exit 2`. This is the only way to
   know, and it is cheap.
3. **If the race reproduces, there is a decision here that is Erez's, not the design's.** The
   options are genuinely different in what they cost him, and none is free:
   - **Cache negatives too** — removes almost all resolution from the steady state, so blocks
     become fast in practice. Cost: reverses the recorded positives-only decision, and a poisoned
     or stale negative silently un-gates a page. Defensible under the corrected threat model
     (omission, not evasion), which is precisely why positives-only deserves re-examining rather
     than assuming.
   - **Ship only the arms whose scope is decided in-payload** (A1 create, A5 move — parent id is in
     the payload, no resolution needed) and defer the resolver-dependent arms (A2/A3 edits, A4
     duplicate). Cost: edits go ungated in piece 1, which is most of the traffic and much of the
     goal.
   - **Accept the residual** with the 2 s ceiling and no further change. Cost: a small, named,
     unmeasurable-in-advance chance that a gated edit slips through on a slow resolve.

   `[v5]` **This is now the design's one open decision.** It is not resolvable by more review: it
   needs the measurement in (2) first, and then a judgement about risk that belongs to Erez. Stated
   here rather than smoothed over, because v4's habit was to resolve exactly this kind of tension by
   writing a confident sentence.

**Warming mechanism, if negatives are ever cached.** Two candidates, unchanged from v4 and still an
open build decision: (i) a PostToolUse arm that resolves and caches from ordinary `notion-fetch` /
`notion-update-page` traffic — latency there is harmless, the pattern is proven by
`notion-fetch-staleness.js` (fact 7), and the common flow self-warms because a ticket is nearly
always fetched before it is edited; cost is one more hook file. (ii) `/vet-ticket` resolves and
caches during the run a block sends Claude to — no new hook, but it makes that escape need Notion
access, weakening the "an outage costs one local review" promise. This choice only arises under
option (a) above.

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
- The brief carries, separately labelled and verbatim: the original goal, **the disputed drafted
  ticket text itself** `[v4]`, the reviewer's finding, and Claude's counter-argument. Claude does not
  summarise or characterise any of them. This is the standing rule about briefing a delegated
  reviewer with the goal verbatim, applied to the party most able to bias the outcome — Claude.
  `[v4]` v3 required the goal, the finding and the counter-argument but **not the draft**, which
  would have left the adjudicator weighing two pieces of prose *about* a ticket it could not read —
  and most findings at this bar ("the body stands on its own", "the priority fields derive
  correctly") are checkable only against the draft. Omitting it hands Claude control of what the
  judge sees, which is the precise failure adjudication exists to remove.
- **`[v4]` "Round" means one pass of the Step-3 review-fix-re-review loop**, so the bound below is
  two adjudicated findings per review pass, and at most two passes in which adjudication is used at
  all. Stated because v3 left "round" undefined against a loop that has its own iterations.
- **Bounded.** At most two adjudicated findings per round and at most two rounds. If a finding
  survives adjudication, it stands and must be fixed. If adjudication is itself contested past the
  bound, it goes to Erez with both positions stated plainly. Erez is the terminal authority, but
  only in the genuinely contested minority case rather than on every disagreement.
- The adjudicator's `agentId` is recorded in `adjudication` on the record and verified by the same
  transcript check as `reviewerAgentId`, so an adjudication cannot be claimed without having run.
  `[v4]` It ends its reply with `TICKET-ADJUDICATION: <UPHELD|OVERTURNED> <contentHash>`, and the
  hook verifies the `OVERTURNED` literal — so it learns what was *decided*, not merely that someone
  ran. v3 verified only existence, which made "the adjudicator agreed with the reviewer" and "the
  adjudicator agreed with Claude" indistinguishable to the gate.
- **Honest limit:** this does not remove Erez from the loop, it makes his involvement rare and
  well-justified. Anyone terminal must be a human; the design's claim is only that Claude is never
  terminal in its own case.
- **Surfacing, designed in:** adjudication count per session goes into the gate event log and is
  reported at `/wrap`, with a re-evaluate bar — if adjudication fires on more than roughly one in
  four reviews, reviewer #1's brief is too strict and needs re-writing, not more adjudication.

### The `/vet-ticket` skill (writes the review record)

Modelled on `/vet-rule`, the lighter of the two existing record-writing skills:
1. **Step 0 fail-closed self-check**: grep the hook for `enforceTicketVetting` and
   `findTicketPassFile`; missing -> refuse.
2. **Draft** the ticket create/edit payload.
3. **Ask the hook for the hash — BEFORE the review, not after.** `[v4]` Run
   `node "<hook path>" --ticket-hash "<payload .json>"`. **Do not reproduce the normalisation
   here** — it is ~100 lines and any drift makes every record fail to match, leaving break-glass as
   the only escape. Non-zero exit -> STOP, do not write a record.

   `[v4]` v3 had this as step 4, *after* the review. That ordering cannot work now that the
   reviewer must emit the hash in its verdict token: it has to be given the hash to echo it.
4. **Independent review**: spawn a `check-reviewer` sub-agent that did NOT draft the ticket, given
   the drafted payload, the ticket-bar checklist, **and the hash from step 3**, returning PASS /
   REVISE with specific findings and ending its reply with the token
   `TICKET-REVIEW-VERDICT: <PASS|REVISE> <hash>`. `[v4]` The brief must show the token only in that
   placeholder form — never with `PASS` filled in — because the brief is stored in the reviewer's own
   transcript, which is the file the hook searches. See the trap box under "What the hook actually
   verifies".

   Fix what is fixable and re-review; if the bar cannot be met because only Erez holds the missing
   information, STOP and consult him (decision 1). `[v3]` If a finding is disputed rather than
   fixable, run the bounded adjudication above — never override it.

   `[v4]` **A fix changes the content, so it changes the hash.** Re-run step 3 and re-review against
   the new hash; a token carrying the pre-fix hash is worthless to the hook, which is the correct
   behaviour — reviewed-then-edited content has not been reviewed. This makes the
   re-hash/re-review loop mandatory rather than an optimisation, and it is the mechanism by which
   "the record cannot survive an edit to the content it covers" is actually enforced end to end.
5. **Evidence precondition, then write the record.** `[v3]` Verify: `reviewerAgentId` is present
   and non-empty, and both `agent-<id>.jsonl` and `agent-<id>.meta.json` exist under this session's
   `subagents/` dir with `"agentType":"check-reviewer"` (the GEN-518 mechanism, same as `/vet-rule`
   Step 4); the record's `contentHash` still equals the hash from step 3;
   **and `verdict === 'PASS'` OR `waived === true`** (round-1 fix: v1 checked only that a review had
   *run*, so a REVISE verdict could still get through — `/vet-rule` gates on its verdict and this
   must too); `[v4]` **and that the reviewer's transcript actually contains
   `TICKET-REVIEW-VERDICT: PASS <hash>`** — the skill runs the same check the hook will run, so a
   mismatch surfaces here with context rather than as a bare refusal later; and if any finding was
   disputed, `adjudication` names a verified adjudicator whose transcript carries
   `TICKET-ADJUDICATION: OVERTURNED <hash>`. Then
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

   `[v4]` **That amendment collides with the ask's own constraint, and the fix is to pay for it in
   the same piece.** GEN-508's problem statement requires enforcement "without growing the
   always-loaded global CLAUDE.md". The amendment above *adds* a sentence to an always-loaded rule,
   while the offsetting reduction — moving the ticket-bar prose out of the global file and into the
   reviewer's checklist — sat in piece 3, an unfiled follow-up. Piece 1 alone therefore netted
   growth against an explicit constraint, with the tension resolved by this document rather than by
   Erez. Resolution: **the bar-prose move comes forward into piece 1**, so piece 1 is net-neutral or
   net-negative on always-loaded bytes, and no relaxation of the constraint needs to be requested.
   `[v5]` **That net-neutrality is asserted, not measured** — no byte or line count exists for the
   added amendment sentence against the moved-out prose. Measure it when the actual rule diff is
   drafted at the `/vet-rule` step, and if it comes out net-positive, the trade-off goes to Erez
   after all rather than being assumed away.
   Both edits are `CLAUDE.md` changes and travel together through `/check` then `/vet-rule` with
   Erez's explicit confirmation, exactly as the standing rule on rule-edits requires. The cost is
   scope: piece 1 grows by one prose move it would otherwise have deferred. Cheaper than asking to
   weaken the constraint, and it removes piece 3's dependency on a rule edit.
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

**Neither is needed.** There are no prompts, so `/wrap` *can* stay silent and gated: it runs the
reviewer and writes the record without pausing. Enforcement then applies to exactly the filings
GEN-508's §8 records as having gone wrong (a near-duplicate, and a ticket for work an existing
ticket had explicitly declined — both from silent `/wrap` filing, both caught late), with no
interruption added anywhere. This was the only item blocking ship on Erez's sign-off.

> **`[v4]` v3 wrote that as though it were already true. It is not — and left as-is it breaks
> `/wrap` on the first run after install.** `/wrap`'s Step 1 (unresolved-item capture) and Step 3c
> (detector-review ticket) call `notion-create-pages` / `notion-update-page` **directly**, and
> `wrap/SKILL.md` contains no reference to `/vet-ticket` at all (grepped, 2026-08-03). Both steps
> carry an explicit override exempting them from the draft-for-approval gate *specifically so they
> run unattended*. So the next `/wrap` that files a ticket after this hook installs hard-blocks with
> no record present — and because those steps are designed never to pause, there is no consult path
> waiting to catch it. This is a self-inflicted breakage introduced by piece 1, and no piece
> scheduled the fix: piece 3 covers only the separate `/wrap` *aggregate reporting* line.

**`[v4]` The deliverable this adds to piece 1 — and the general form of it.** Rewriting `/wrap`
Steps 1 and 3c to run draft -> review -> record before their Notion call is a **piece-1 ship
requirement**, not a follow-up: shipping the hook without it knowingly breaks a routine Erez relies
on. It is a skill edit, so it goes through `/vet-rule`.

`/wrap` is one instance, and fixing only the instance would leave the class. **Before install,
enumerate every existing routine that writes to Team-Tasks and give each an explicit disposition —
routed through the gate, or exempted with a stated reason.** The enumeration is the deliverable; a
grep of `~/.claude/skills/**` plus the hooks directory for the four Notion write tools is how it is
produced, and it goes in the header comment so a future skill author can see the list. Known
members so far: `/wrap` Steps 1 and 3c (route), the GEN-58 log-write protocol (exempt — carve-out
above), and status-only ticket updates made under the standing status rule (exempt — `Status` is
housekeeping under the A2 deny-list). Anything the grep turns up that is not on this list blocks
install until dispositioned.

The GEN-58 carve-out above is separate and already justified by its own standing rule.

**One genuine cost to name:** `/wrap` gets slower, because each filing now runs a reviewer
sub-agent. Silent, but not free.

## What piece 1 now contains `[v5]`

Listed because the review rounds grew it, and because a scope this size should be seen whole and
signed off before a line is written rather than discovered during the build. Every item traces to a
specific verified defect; none is speculative. That does not make the total the right size to ship
as one change — that judgement is Erez's.

| # | Deliverable | Why it is in piece 1 |
|---|---|---|
| 1 | `enforceTicketVetting` arm in `auto-approve.js` | the gate itself |
| 2 | The scoping layer per `design-scoping-v3.md` §2 | its four stages are how scope is decided |
| 3 | `/vet-ticket` skill, **rebuilt** | the checked-in draft still asserts the refuted "mint prompt IS the gate" premise, the deleted `targets[]` shape, and raw-`tool_input` hashing; no part of the verdict-token mechanism exists in it. Refusal messages name the skill, so hook-without-skill ships dead instructions |
| 4 | Verdict-token verification, assistant-role-scoped | without it a REVISE record clears the gate |
| 5 | The 22 open defects in `review-findings.md` | fail-opens in surviving code |
| 6 | Test-oracle rebuild in `test-gen508.js` | the current sweep cannot detect the bug class it exists for; two tests assert nothing |
| 7 | `/wrap` Steps 1 and 3c rewritten via `/vet-rule` | otherwise the first `/wrap` after install hard-blocks with no consult path |
| 8 | Caller enumeration across `~/.claude/skills/**` + hooks | `/wrap` is one instance of a class; the enumeration is what closes the class |
| 9 | Two global `CLAUDE.md` edits (summary-card amendment + bar-prose move) via `/check` then `/vet-rule` | the amendment resolves a live rule contradiction; the prose move pays for it |
| 10 | The race measurement, before any code | the design's central premise is otherwise unverified |
| 11 | Pieces 2 and 3 filed as sub-tickets | standing rule: a named follow-up is created, not referenced |

**Deliberately NOT in piece 1:** Jira arms, the raw REST/curl Notion arm, the `/wrap` aggregate
reporting line, re-examining the three installed sibling gates' false headers, and any change to the
positives-only cache decision (which only arises if the race measurement forces it).

## Honest limits

- `[v3]` `[v4 — this became true only in v4]` The record proves an independent review RAN on this
  exact content, that the reviewer it names really existed and returned, and that the verdict was
  PASS (or that Erez waived it). In v3 the last of those three was **asserted here and checked
  nowhere** — the hook read no verdict at all. The verdict token closes it. It
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

---

## Review status

**`[v4]` Read this section first if you are about to build from this document.** It is the part v3
got most wrong.

**Companion document — normative for four sections.** `design-scoping-v3.md` **supersedes** this
document's "Scoping — which calls are in scope", "Evaluation order", "Resolution", and "Carve-out —
GEN-58", plus the pass-matching rule. v3 never cited it once (grepped: zero mentions), while
asserting that its own versions of those very sections "survive" validated. Where the two disagree,
`design-scoping-v3.md` wins. The GEN-58 carve-out above is the case that proves the cost of the
omission: v3 restated a rule Erez had overruled the same day, with a justification the companion
document had already measured as false.

**What the three v2 rounds actually validated, corrected.** They validated the *waive semantics* and
the *resolver stance* as stances. They did **not** validate the scoping or evaluation-order
machinery — a later max-effort code review found 27 defects concentrated in exactly that code
(`review-findings.md`; 22 still open), including a create-path fail-open where an unrecognised
container-key id silently approves an unreviewed ticket, which is the worst possible failure for a
design whose central pivot is that the create path can be airtight. v3's claim that "all of that
survives" was false and would have led a builder straight into it.

**v3 was reviewed on 2026-08-03 and did not pass.** A three-lens `/check` panel returned REVISE from
all three lenses, with eight material findings: the hook never checked the verdict; `/wrap` breaks on
first run after install; two contradictory deny-lists; the adjudicator never sees the draft; the
step-8 escape is break-glass-only for hashing bugs; the GEN-58 reversal and the uncited companion
document; and piece 1 netting growth in the always-loaded rules against the ask's own constraint.
The `exit 2` premise was found to be the one load-bearing claim with no provenance at all.

**Round 2 (2026-08-03) also returned REVISE from all three lenses.** Of the eight round-1 findings,
six were confirmed RESOLVED; one recurred (the network invariant never reached the normative
algorithm) and one was resolved in wording but defeated in mechanism (the verdict token). Round 2
added three more: the stale hash-projection bullets, the `update_verification` exemption that
contradicted the companion document, and the unreconciled enforcement-flow steps. **v5 is that
revision.**

**v5 has NOT been re-reviewed** as of this line being written. Round 3 is the panel's cap; if the
open decision at the end of "A blocking decision must never wait on the network" is still open after
it, that is an escalation to Erez rather than a failure to converge — it depends on a measurement no
review can perform.

The filename still says "converged" for continuity of links — it refers to v2, and by the correction
above, only partially to that.

**Sibling-gate consequence, not yet actioned.** `enforceStaging` (GEN-281), `enforceVetting`
(GEN-376) and `enforceCheckDue` (GEN-485) are installed and carry the same
"the write prompts Erez, and that prompt IS the human gate" rationale in their headers. Their
`exit 2` blocking still works, so they are functionally intact, but the guarantee each *claims* is
false and each needs re-examining against what it actually achieves. Tracked as out-of-scope here.
- `[v4]` Raw REST/curl Notion writes are not held to the bar in piece 1 **and are not gated at all**.
  This bullet previously read "only `ask`-gated", contradicting the scoping section two screens
  earlier which had already established that the `ask` is discarded under `bypassPermissions` and
  such writes run silently today. A fourth instance of the same self-refutation, found while
  revising rather than by the panel. Named gap; closing it is piece 2.
- A hollow-but-shape-conforming ticket can still pass a lenient reviewer.
- Hardcoded Team-Tasks ids, the GEN-58 page id, the housekeeping property-name deny-list, and the
  Notion MCP server UUID carry the same latent-rotation risk the sibling Notion hooks already
  document; a maintenance note goes in the header. The deny-list at least rotates SAFELY — a renamed
  housekeeping property starts being treated as substance (more gating), not less.
- `[v5]` ~~A page moved into Team-Tasks can read as out-of-scope for up to 24h (negative-cache
  TTL).~~ **Void — the cache is positives-only, so no negative is ever cached and this residual does
  not exist.** It was a consequence of v3/v4's negative-cache text, which the section above retracts.
- Whether PreToolUse hooks fire for sub-agent-originated tool calls is **unverified**;
  `notion-schema-guard`'s header records the same open question for its own `ask` arm. If they do
  not, a sub-agent could file an unreviewed ticket. To be checked at build; if unfired, it becomes a
  named gap, not a silent one.
