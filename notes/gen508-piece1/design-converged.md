# GEN-508 piece 1 — design (v6.2, the single normative document)

> **Round 2 is complete. Both round-1 findings that were carried over are RESOLVED by the reviewers'
> own tags; three new findings arrived and are fixed here. v6.2 is that revision.**
>
> | round-2 finding | lens | resolution |
> |---|---|---|
> | the `OVERTURNED` fix did not compose with the "two adjudicated findings per round" bound — one overturned finding could clear a record while a second finding was never resolved at all | pre-mortem (NEW-FROM-REVISION) | **§9 now permits exactly one live adjudication per hash**; co-occurring findings must be fixed first, which changes the hash and starts a fresh round. §6.2 states it depends on that precondition |
> | `exempt-list-overflow` was promised in §5.1 but wired into no operative section, so it would have fallen into the generic `internal-error` catch | soundness (NEW-FROM-REVISION) | **wired into §7 step 3, §7.1's escape table and §10's reason list**, with a standing rule that a new block path must add its own reason |
> | §4.0.1 built its argument on the smaller REST buckets and never mentioned `PATCH /v1/blocks` — the **largest** one, and the page-body case GEN-508 exists to catch | holistic | **added, and named as the largest slice**; the priority-field claim is now hedged as an inference, since Part 4 never inspected request bodies |
> | §12.1 offered two options and omitted a cheaper third; and Option A's cost list hid its conflict with §7.1 | holistic + pre-mortem advisory | **§12.1 now has three options**, the new one measured in Part 4a, and Option A's tension with §7.1 is disclosed. **My recommendation changed to Option C** |
>
> Round-2 advisories folded in: "labels → `Type`+`Project`" is labelled an interpretation, not a match;
> the 15% figure is labelled order-of-magnitude across differently-deduped populations; `Parent item`'s
> 14-vs-13 count is reconciled; and "exactly two relation properties" is now **verified** from the schema
> fetch (17 properties, exactly two of `type: relation`).
>
> **The open decision in §12.1 is now a three-way choice and my recommendation has changed** — that is
> the one thing needing Erez.

---

## Round 1 (superseded by the box above, kept for the audit trail)

> **Round 1 of the panel on v6 is complete: holistic PASS, pre-mortem REVISE (3 findings), soundness
> REVISE (1 finding). v6.1 is that revision.** What changed:
>
> | finding | resolution |
> |---|---|
> | the housekeeping list exempted 10 properties where Erez named 3 categories, incl. `Reason` (type undocumented) | **measured, then shrunk to 5** (§4.2). `Reason` is a 3-option select — settled by schema, not judgment. Four zero-traffic fields dropped. **`Parent item` moved to substance**, cost 13 payloads of 414 |
> | the 128-id cap on the exemption file had no bar, and once full the escape never terminated | **cap raised to 4,096, overflow made a loud distinct block, a 90% `/wrap` bar added, "prune" defined** (§5.1, §10) |
> | the "not a ticket" lane had no verification mechanism, reopening a self-declaration shortcut | **lane entry is now network-verified** in the skill (§8 lane B), where the lookup is off the blocking path |
> | an **OVERTURNED** adjudication had no path through the enforcement flow — it recreated the "strict" behaviour Erez rejected | **fixed in three places** (§6.2, §7 steps 6–8, §8 step 6): the adjudication token *substitutes for* the reviewer's PASS token |
>
> Advisories folded in: the `exit 2` premise now carries quoted output from two dated live refusals
> (§2); the appender's real scope is disclosed (§5.3); the CLI's non-zero-exit condition is separated
> from the `ok === false` fallback (§6.1); the `/wrap` signal lines are threshold-triggered and silent
> below their bars (§10); a withdrawn "~3×" figure is corrected at source (§3).
>
> **One finding produced a new open decision for Erez rather than a fix:** a lens asked why the raw
> REST/curl hole was the only unquantified boundary. Measuring it showed it is **~15% of all Notion
> write traffic**, including page creates, priority-field updates and the only destructive operations
> in the surface — so whether it belongs in piece 1 is a scope call, not a deferral. See **§12.1**.

> **Read this box before anything else.**
>
> **v6 merges `design-scoping-v3.md` into this file.** That document is no longer normative for
> anything; its header now says so. Three `/check` rounds on v3–v5 ended without converging, and all
> three round-3 lenses reached the same diagnosis: **the two-document split was the defect.**
> Corrections landed correctly where they were written and went stale where a builder would actually
> read them — five separate self-refutations, three of them introduced by the very revisions that
> were cataloguing the first two. One document, one place for each rule.
>
> **v6 is also much smaller than v5, because Erez collapsed the design on 2026-08-03** with two
> questions (see "The collapse"). The hook now makes **no network call on any path**. Deleted
> outright: the id resolver, the parent cache and both its TTLs, the positives-only question, the
> latency budget, the "unknown" stance, the slow-hook race exposure, and the one decision v5
> escalated to Erez. Eight of the 22 open code defects dissolve with them.
>
> **Nothing is installed.** The live `~/.claude/hooks/auto-approve.js` has not been written to.
>
> **The filename is kept deliberately.** "Converged" is inaccurate — v6 has not been reviewed yet —
> but `review-findings.md`, `HISTORY.md`, the plan file and GEN-508 all link to this path, and
> renaming means updating every one of them for no gain.

**The change:** add a fourth gate arm, `enforceTicketVetting`, to `~/.claude/hooks/auto-approve.js`;
add a small PostToolUse companion that maintains one exemption list; add a `/vet-ticket` skill that
writes the single-use **review record** the arm demands. Piece 1 is the **Notion** half; Jira and the
cross-tracker rule set are pieces 2 and 3.

---

## 1. What is being solved

From GEN-508, whose title is *"Enforce all ticket-quality rules on every Notion + Jira create/edit
via an independent-review gate"*: when Claude files or edits a Team-Tasks ticket it repeatedly
violates ticket-quality rules — most often the body is not self-contained, and/or the
priority-derivation fields (Urgency + Gain ratio → Priority) are missing or wrong. A behavioural
self-check rule exists and is skipped under momentum. The ask is to make adherence *enforced*, by an
independent reviewer, **without growing the always-loaded global CLAUDE.md**.

**Erez's settled decisions** (GEN-508 §2, plus 2026-08-02/03 in session): judge before filing;
an airtight stop on an unverified write, with a per-case waive he controls; both trackers; create
**and** edit; review every create and every edit touching body/substance or the priority fields, and
skip pure housekeeping (status / labels / assignee); the reviewer must be **independent** of the
drafter; a reviewer/Claude disagreement is settled by adjudication, not by either party's fiat.

### The threat model, stated once because everything depends on it

This gate exists to stop Claude **skipping** the review — omitting it under momentum, or losing it
across a context compaction. That is what GEN-508's problem statement describes. It is **not** a
defence against a Claude deliberately evading a rule it knows about. Against omission, a gate that
refuses until a verifiable review record exists is sufficient: the default path — call
`notion-create-pages` directly — hits a wall, and omission cannot accidentally produce a record.

Every "is this good enough?" question below is answered against that model, and the places where a
deliberate actor could still get through are named rather than papered over.

---

## 2. The premise correction that produced this design

v1/v2 rested on one sentence, repeated in every gate header: *the record write always prompts Erez,
and that prompt IS the human gate.* Both halves are false.

**The prompt does not exist in the mode Erez works in.** Measured 2026-08-03: every user turn
carries `permissionMode: "bypassPermissions"`. A PreToolUse hook's `permissionDecision: "ask"` is
**silently discarded** in that mode — proven by feeding `notion-schema-guard.js` the exact payload
(it returned `ask`) and then running that same command (it executed, no prompt). A write outside the
allow-list is not a prompt either; it is a *fall-through*, which under this mode is a **silent
approve** (178 deferred calls in one session, none prompted).

**And the approval was not doing the work v2 credited it with.** A permission prompt shows a file
path and a hash — not the ticket and not the review. A Claude that ran a sham review, or none,
produces an identical-looking prompt. So it could never distinguish the failure it existed for. Erez
already approves ticket drafts in chat under a standing rule, so the gate was re-collecting an
approval he gives properly elsewhere, in a strictly worse place.

**Consequences that survive into v6:** the record's on-disk location carries **no security
property**; the `targets[]` batch array is deleted (its only purpose was collapsing N dialogs into
one), and with it the partial-consumption machinery behind four reviewed defects; consumption is a
plain `unlink`; the summary card moves to the chat approval the standing rule already requires; and
`/wrap` can stay silent *and* gated.

**Why the gate is still buildable.** The *refusing* half works in every mode. `process.exit(2)`
overrides `bypassPermissions` and the allow-list both — **verified live, twice, with the output
quoted**, because a round-1 lens correctly noted this was the one load-bearing claim carrying narration
instead of provenance:

- **2026-08-03:** `auto-approve.js` refused a chained Bash command with its mixed-risk message and the
  command did not execute.
- **2026-08-04, reproduced while writing this document:** the same guard refused
  `cd "<scratchpad>" && node measure-collapse.js` with
  `PreToolUse:Bash hook error: [node "C:/Users/Erez/.claude/hooks/auto-approve.js"]: Refused: this
  single line chains a state-changing or unrecognized command (starting at "node
  measure-collapse.js") together with other commands.` The script did not run — it had to be reissued
  as a single command, and only then produced output. Same file, same hook event, same
  `bypassPermissions` session as this arm will run in.

The three installed sibling gates block the same way in production.

**What replaces the human gate — three layers, none involving Erez:** refuse until a record exists,
bound to a content hash; verify the record names a reviewer that really ran *and* returned PASS on
*this* content; adjudicate disagreement rather than letting either party settle it.

---

## 3. The collapse (2026-08-03) — what Erez's two questions deleted

v3–v5 spent most of their machinery answering one question: *is the page this call targets a
Team-Tasks ticket?* Answering it needed a network round-trip, and the round-trip dragged in a cache,
two TTLs, a latency budget, an "unknown" stance, a slow-hook race, and finally a decision v5 could
not close and escalated to Erez.

**Question 1 — "Can we treat Notion pages as tickets?"** The option was missing from v5's set, and a
round-3 reviewer had independently flagged it as missing. It is answerable by measurement, so it was
measured rather than argued. `measurement-edit-targets.md` is the durable artifact; the load-bearing
numbers:

- **318 distinct pages** are targeted by `notion-update-page` / `notion-duplicate-page` across 1,093
  deduped payloads. **307 are live Team-Tasks rows.**
- Of the 11 that are not: **4 are GEN-58 log volumes**, **3 are Team-Tasks rows the database query
  missed** (a Notion DB query omits archived rows and templates), **3 are corrupted or deleted ids**,
  and **1 is a genuine non-ticket page** — 1 reference in 1,081, **0.09%**. Identifying all 11
  individually is what separates "failed the database query" from "is not a ticket": the query-only
  method reports 11 non-rows where 8 is correct, and only 1 of those 8 is a genuine non-ticket page.
  (An earlier draft compressed this into "overstated ~3×". That multiplier does not reconstruct from
  these numbers and is withdrawn — a round-1 lens caught it, and the correction is recorded at source
  in `measurement-edit-targets.md`.)
- On the create side (Part 2 of the same document, measured 2026-08-04): of 263 payloads, **97.0%
  carry a Team-Tasks marker**, 1.9% are parented to a page (4 of those 5 are the GEN-58 volume
  rollover), 0.8% name another container, 0.4% have no parent. **Genuinely-new gating on the create
  arm: 1 payload in 263.**

So treating every Notion page as a ticket costs about one over-gated write in a thousand.

**Question 2 — "Why not update the list on every run where you create a ticket?"** This was aimed at
a proposal to batch-refresh a local ticket-id list at session start. Following it through collapsed
the design further:

> **A list of what *is* a ticket does no work, and is deleted.** If an unknown page is gated by
> default, then learning that a page **is** a ticket changes no branch — it was already going to be
> gated. Only a **gating-removing** fact is worth holding locally.

Traced across all four arms and then attacked by a pre-mortem lens, which confirmed it for the edit
arms and found one genuine counterexample, now built in: **a create's parent container is in the
payload**, so container identity *is* a locally-available gating-removing fact. The create arm keeps
its local test; the edit arms need nothing.

**What is left to hold locally is an *exemption* list** — the GEN-58 log subtree, §5.

**Net effect.** No network call anywhere in the hook. Everything the resolver dragged in is gone,
including v5's escalated decision (cache negatives / ship only the in-payload arms / accept the
residual), which existed only to manage resolver latency on a blocking path.

One thing worth naming: v4 asserted an absolute invariant — *"no code path that ends in a block may
depend on a network round-trip"* — and v5 retracted it as unachievable given a positives-only cache.
The collapse **delivers exactly that invariant**, by removing the round-trip rather than routing
around it. The invariant was right; the machinery it was written against could not satisfy it.

---

## 4. Scope — which calls are gated, decided entirely from the payload

### 4.0 Tool surface, enumerated rather than assumed

The Notion MCP connector exposes ten mutating tools. **Re-verified against the live tool list on
2026-08-04** (a round-1 lens flagged this as carried from a prior session): `notion-create-attachment`,
`notion-create-comment`, `notion-create-database`, `notion-create-pages`, `notion-create-view`,
`notion-duplicate-page`, `notion-move-pages`, `notion-update-data-source`, `notion-update-page`,
`notion-update-view` — ten, with the remaining Notion tools being `fetch`, `search`, the four `query-*`
/ `get-*` readers, `get-async-task` and `download-attachment`. Four of the ten are gated; the other six
are scoped out with a reason:

| Tool | In piece 1? | Why |
|---|---|---|
| `notion-create-pages` | **gated** | files a ticket row |
| `notion-update-page` | **gated** | edits a ticket's body or properties |
| `notion-duplicate-page` | **gated** | a duplicate of a ticket row *is* a live ticket row |
| `notion-move-pages` | **gated** | move-in files a row; move-out de-lists one and drops every property |
| `notion-update-data-source` | out | **schema only** — its `statements` grammar is `ADD`/`DROP`/`RENAME`/`ALTER COLUMN` plus `title`/`description`/`in_trash`/`is_inline` (live schema). It cannot write a row's values. Its destructive subset is `ask`-gated by `notion-schema-guard.js` — which under `bypassPermissions` means **not gated at all**; named residual, closed by piece 2 |
| `notion-create-comment` | out | a comment thread touches neither body nor properties |
| `notion-create-database` | out | creates a container, not a row |
| `notion-create-view` / `notion-update-view` | out | change display, not content |
| `notion-create-attachment` | out | attaches a file; not body or property substance |

### 4.0.1 Raw REST/curl writes — the hole is measured now, and it is not small

v6's first draft called this "an open hole, not a cushioned one" and deferred it to piece 2. A round-1
lens pointed out that it was the only scoping boundary in the document left qualitative while every
other one was quantified from the same corpus, and that measuring it was cheap. It was, and the answer
changes the scope question rather than confirming the deferral (`measurement-edit-targets.md` Part 4):

- **~230–236 raw REST write calls** in the corpus, against 1,330 MCP write payloads: roughly **15% of
  all Notion write traffic**.

  **Which script each figure comes from, because they differ slightly and must not be mixed.** Part 4's
  detector counted 195 unambiguous (`PATCH` 188, `DELETE` 7) plus ~38 probable ≈ 233. Part 4a re-detected
  the same corpus using **`notion-schema-guard`'s own rule** and counted **236**, and its per-bucket table
  is the one the bullets below cite — so those bullets are Part 4a's numbers throughout (`PATCH /v1/blocks`
  101, `PATCH /v1/pages` 88, `POST`/body `/v1/pages` 21), not Part 4's slightly lower ones. The ~1% spread
  is two detection rules on identical data.

  Read the 15% as an order of magnitude, not a precise share: the two populations are deduped differently
  (exact command string vs exact payload), and it is a **floor**, since a write whose URL never appears in
  the shell command is not counted at all.
- **`PATCH /v1/blocks` is the largest single bucket — 101 calls, more than any other** — and v6.1's
  first draft left it out of this list entirely while building the argument on the smaller buckets. A
  round-2 lens caught that, and it matters more than the omission: `/v1/blocks/{page-id}/children` is
  the **append-children** endpoint, so this bucket is *page body content being edited outside the gate*
  — which is GEN-508's headline failure ("the body is not self-contained"), on the largest slice of the
  ungated traffic.
- **`PATCH /v1/pages` (88)** is the same operation as `notion-update-page`. Whether those calls include
  the priority-derivation fields is an **inference, not a measurement** — Part 4 buckets by HTTP method
  and URL path and never inspects request bodies (round-2 flag; the earlier draft stated it as fact).
- **`POST /v1/pages` (21 with body)** is a page create. **`DELETE /v1/blocks` (5)**, **`DELETE /v1/pages`
  (1)** and the two `/v1/databases` writes are destructive or schema-level and have **no equivalent
  anywhere in the gated set**.
- `notion-schema-guard.js` **already detects this whole surface**. Its GEN-378 shell-write arm
  (`isNotionMutatingHttp`, verified by reading the file 2026-08-04) matches any `PUT`/`PATCH`/`DELETE`
  or body-bearing `POST` to `api.notion.com`, with an allow-list excluding `/query` and `/v1/search`
  because Notion reads also POST. It then emits `ask` — which §2 proves is silently discarded under
  `bypassPermissions`. **So the detector for this hole exists, is already scoped correctly, and is
  neutered only by using the permission verb that does not work.** That changes the options in §12.1.

**This is now an open decision for Erez, not a deferral I should make** — see §12.1. It bears directly
on whether piece 1 is worth shipping alone: a gate that covers the MCP tools while ~15% of write traffic
goes ungated is a materially weaker delivery of "every Notion create/edit" than the earlier qualitative
framing implied.

### 4.1 Stage 1 — normalise (this is where payload shape stops mattering)

`ticketNormalise(tool_input)` → `{ok, root, strings, idish}`. Walk depth-first under a budget:

- a **string in a wrapper position that parses to an object or array** is replaced by the parse and
  walked — this unwraps `{data: "…"}`, `__unparsedToolInput.raw`, and any future wrapper, at any
  depth;
- every string encountered, key or value, parsed or not, is collected into `strings`;
- every string value under a key whose name contains `id` (case-insensitive) is recorded in `idish`,
  tagged with that key name;
- objects and arrays are recursed.

**Envelope hoisting.** The walk substitutes in place, so `{data: "<json>"}` becomes `{data: {…}}` —
the wrapper key survives and the enveloped and plain forms of the same call do **not** produce the
same tree. So after the walk, while the root is an object with **exactly one key** and that key is a
known envelope name (`data`, `raw`, `input`, `arguments`, `__unparsedToolInput`), its value replaces
the root; repeat, bounded by the same 8-unwrap budget. `root` below always means the hoisted root.

The one invariant a maintainer must re-check before adding a name to that list: **the hoist can only
ever discard a sole root key, and no name on the list is a field of any gated tool's schema**
(verified against the four live schemas and the corpus: `data` and `raw` occur only as envelopes,
`input` and `arguments` never occur). Failing to hoist an unknown future wrapper is the safe
direction — it is still walked, so §4.3's scans see through it, and the only cost is a hash that no
longer matches, which blocks. Hoisting a non-wrapper is the unsafe direction, because §4.2 reads the
hoisted root, and the invariant rules it out.

**Budgets:** 12 depth, 4,000 nodes, 2 MB total string, 8 unwrap levels on any path, and a **2-second
CPU deadline covering the whole arm**. This is now the *only* deadline — v3's version was consumed by
resolver subprocesses before the scan that read it (`review-findings.md` finding 9), and there are no
subprocesses left to consume it.

**`ok = false`** when: the input is neither object, array nor string; any budget is exceeded; an
`__unparsedToolInput.len` exceeds its `raw.length` (proof the harness truncated the payload — true in
all 3 captured cases); or **a string in a wrapper position fails to parse**.

Two precision requirements, each closing a reviewed defect:

- **Wrapper-position assertion only at the root and at a detected sole-key envelope** — not at every
  depth for every envelope name (finding 14). An ordinary payload carrying `"data": "n/a"` under some
  nested key must not hard-block.
- **A failed parse anywhere else is not evidence of anything** — it is just text. An earlier rule
  ("any string starting `{` or `[` must parse") would have hard-blocked five real payloads whose
  content merely begins with a markdown link or a bracketed tag, two of them GEN-58 log writes.

**`ok = false` is a hard block**, and it is the fail-closed anchor everything else hangs on: later
stages may conclude "out of scope" *only* because stage 1 guarantees it saw the whole payload.

**Implementation constraints — these are security properties, not style.** The traversal reads only;
nothing derived from the payload is used as a key written into a plain object (payload-keyed
collections are `Set`/`Map`). Every regex on payload text is fixed-width and non-backtracking, so
there is no catastrophic backtracking; the 2 MB cap and the CPU deadline bound the scan regardless.

### 4.2 Stage 2 — the housekeeping exemption (closed shape)

The one path that lets a Team-Tasks write through with no record, so it is written as a **closed
shape**: exempt only on an exact match, and *anything* unrecognised gates. Exempt iff **all** hold on
the hoisted root `R`:

1. `R` is a plain object and **every key of `R`** is one of: `page_id`, `pageId`, `id`, `command`,
   `properties`, `icon`, `cover`, `is_skill`, `allow_async`. (The last four are in the live
   `notion-update-page` schema and can be set alongside any command; omitting them made a `Status`
   change plus an icon gate for nothing — finding 17.)
2. `R.command`, if present, is exactly `update_properties`.
3. `R.properties` is a plain object, and every key of it — after stripping a leading
   `date:` / `place:` / `userDefined:` qualifier and a trailing `:start` / `:end` / `:is_datetime` —
   is in the housekeeping list below.
4. Every value inside `R.properties` is a primitive, `null`, or an array of primitives/`null`. No
   nested object, which is what a content structure looks like. (`null` counts as a primitive: real
   housekeeping edits clear a relation with `"Assignee": null`, and `typeof null === 'object'`.)

**The housekeeping list, and the only place it is stated in this document.**

> **HOUSEKEEPING** = `Status`, `Assignee`, `Type`, `Project`, `Reason`. **Everything else is
> substance**, including the title (`Name`), the three priority fields, `Parent item`, `Children`,
> and every property name not in the current schema.

Five fields, not ten. A round-1 review lens found that v6's first draft listed **ten**, while Erez's
settled decision names three categories — "status / labels / assignee" — so seven had been added by my
own judgment and never surfaced to him as a judgment call. The lens was right to refuse the list, and
right to single out `Reason`, whose *name* suggests free text. It proposed asking Erez field by field.
Measurement gave a better answer (`measurement-edit-targets.md` Part 3, and the live data-source
schema fetched 2026-08-04):

- **`Reason` is a `select` with exactly three workflow options** — `not defined`, `Event Pending`,
  `Ticket Pending`. It cannot carry substance. Settled by type, not by judgment, and it is the only
  field on the list Erez did not name.
- **`Due Date`, `Remind me (days before)`, `Date Created` and `ID` are dropped.** All four have **zero
  occurrences** across 414 real property updates — exempt surface with no traffic behind it, which is
  the argument that already retired the `update_verification` exemption. (`Date Created` and `ID` are
  system-managed and not writable at all.)
- **`Parent item` moves to substance.** It is one half of a relation whose other half (`Children`) this
  design already calls substance, and the same graph edge written from either end has the same effect,
  so exempting one and gating the other was indefensible. There is also a recorded destructive-op
  incident class for writing it. Cost: **13 payloads of 414** (3.1%) — eleven `Parent item` alone, two
  `Parent item` + `Status` — each of which now pays one review.
- `Type` and `Project` stay because Erez named them ("labels"), and both carry **zero** traffic, so
  they cost nothing either way.

Net: the exemption covers **188 of 414** property updates (45.4%) rather than 201, the seven
unsanctioned fields are gone, and **no judgment call needs to go to Erez**.

Two things this list must be read with:

- **Match on the base name**, after stripping a leading `date:` / `place:` / `userDefined:` qualifier
  and a trailing `:start` / `:end` / `:is_datetime`. A suffixed relation key such as
  `Related to Team-Tasks (Parent item)` does **not** reduce to `Parent item` and is therefore
  substance — which is correct, and is also the form `notion-schema-guard`'s matcher looks for.
- **It is a deny-list, so it rotates safely — now demonstrated rather than asserted.** `Importance`
  appears in **164 real payloads** and is absent from the current schema, where `Urgency` now sits;
  `Gain Ratio` (capital R) and `title` are further variants. Every one is treated as substance, i.e.
  more gating.

v3 stated this list twice, ten lines apart, and the two disagreed. **No other section of this
document may restate it.**

The closed shape also dissolves a defect that a name-based test kept re-introducing (finding 5): a
key spelled `Properties` or `props` is simply not in clause 1's permitted set, so it gates. There is
no longer any branch anywhere in which an unrecognised key name *reduces* gating.

Stage 2 runs before any other classification, so a housekeeping status change can never be gated by
anything external.

### 4.3 Stage 3 — classify the target, locally

Search every collected string for a **Team-Tasks marker**: data source
`bd2cd17b-f58f-4993-8b95-468e881272fa` or database `fe198002-6618-48d7-ae04-56f8cee479f3`, dash- and
case-insensitively, anywhere. A hit ⇒ **in scope**. This one test covers every create shape in the
corpus — top-level `parent`, nested `parent`, `data_source_url`, `collection://`-prefixed, and the
truncated `__unparsedToolInput` whose marker survives inside unparseable raw text.

Then extract every 32-hex id from `idish`, dashed or bare, **boundary-correctly**: a URL-form id is
taken as the trailing 32-hex run after the last `-` or `/`, and a hex run longer than 32 characters
yields no id rather than two overlapping windows (finding 16 — zero corpus instances, but the corpus
is not a specification and the fix is three lines). Body text, `new_str` and property values are not
collected — their keys contain no `id` — so mentioning a ticket in prose can never make an unrelated
page a ticket.

Split by key name: **container-ish** (`data_source_id`, `database_id`, `data_source_url`,
`collection_id`) name a container; **everything else** (`page_id`, `pageId`, `id`,
`page_or_database_ids`, `template_id`, …) names a page.

Then, per tool:

| tool | condition | verdict |
|---|---|---|
| any | Team-Tasks marker present | **in scope** |
| `notion-create-pages` | a container id present, none matching a marker | out of scope |
| `notion-create-pages` | no container id, but a page id present | **in scope**, unless every page id is exempt (§5) |
| `notion-create-pages` | no id-ish key **and** no `parent` key anywhere | out of scope (workspace-level create; 1 real instance) |
| `notion-create-pages` | `parent` present but **no extractable id** | **block** |
| `notion-update-page`, `notion-duplicate-page` | any page id present | **in scope**, unless every extracted id is exempt (§5) |
| `notion-update-page`, `notion-duplicate-page` | no extractable id | **block** |
| `notion-move-pages` | any id present | **in scope** |
| `notion-move-pages` | no extractable id | **block** |

Three notes on the choices in that table:

- **Unknown container ⇒ block** replaces a measured fail-open (finding 11: a create whose parent
  named an unrecognised data source was silently approved, and the live tool description warns that a
  database with more than one data source forces the caller to name a specific `data_source_id` — so
  the day Team-Tasks gains a second data source, every ticket create was silently approved). **Zero
  of 263 create payloads have an unreadable parent**, so failing closed is free.
- **A malformed id can no longer reduce gating** (finding 6). Under "every page is a ticket" a
  malformed id never matches an exemption entry, and the exemption requires *every* extracted id to
  match, so a malformed id alongside a valid one still gates.
- **All moves are gated**, not just move-in. The corpus contains exactly **one** move payload and it
  is a move-**out** (`new_parent: {type: "workspace"}`), which de-lists a row and drops every
  property. Gating both directions costs one payload in the entire history.

### 4.4 What this costs, in full

| call | network calls | verdict |
|---|---|---|
| create into Team-Tasks | 0 | gated (97.0% of creates) |
| create into another database | 0 | free |
| create parented to an exempt page (GEN-58 volume rollover) | 0 | free |
| create parented to any other page | 0 | gated — 1 payload in 263 |
| any body or property edit on any Notion page | 0 | gated, unless housekeeping (§4.2) or exempt (§5) |
| housekeeping-only property edit | 0 | free |
| edit of a genuine non-ticket page | 0 | gated — ~1 reference in 1,081 |
| GEN-58 log write | 0 | free, subject to §5's closed shape |

**The arm makes no subprocess call and no network call on any path.** Its cost is one bounded local
read of the payload plus, on the record path only, a bounded read of the reviewer's transcript.

---

## 5. The GEN-58 exemption — the one gating-removing fact held on disk

**Erez's settled rule (2026-08-03: "I choose A"): exempt every content-bearing write within the
GEN-58 subtree; keep property edits on the GEN-58 ticket row itself gated normally.** The subtree is
the GEN-58 ticket page (`36d6e495d07c816e9e0cce265d694ab3`) plus the rolled-over volume pages where
the write-ups actually live.

**Why an exemption at all.** A standing global rule requires those writes "immediately, as each
instance is identified", exempts them from the draft-for-approval pause, and requires them to be
narrated as a one-line exception rather than a pause for a go-ahead. GEN-58 is a **log**, and the bar
this gate enforces ("the body stands on its own", "the priority fields are derived") is a *ticket*
bar that does not apply to a log body. Its row properties are still ticket properties, so a substance
property edit on the GEN-58 row still goes through the gate.

Two earlier attempts to characterise "a log append" semantically were both falsified against real
traffic (5% and 15% coverage of 159 writes) before Erez stopped the third attempt. The exemption is
keyed on **page identity**, not on what an append ought to look like.

### 5.1 The list, and the closed shape around it

The GEN-58 page id is **hardcoded in the hook**. The volume ids live in one file,
`~/.claude-staging/ticket-gate-exempt-pages.txt`: one 32-hex id per line, append-only, any line that
is not exactly 32 hex characters ignored.

**The cap, and why the first version of it was a latent deadlock.** v6's first draft capped the file
at 128 ids and ignored the remainder. A round-1 lens found the consequence: once the cap fills, a new
volume silently stops being recognised as exempt, so every write to it is gated — and §5.3's escape
(verify parentage, append the id) would re-append and re-fail forever, because the entry can never
take effect. The design's own escape stops terminating, silently. Three changes:

- **The cap is 4,096 ids**, not 128. At one volume per ~25 log entries that is roughly 100,000 log
  entries of headroom, and 4,096 × 33 bytes is ~135 KB — a trivial local read, so the small cap bought
  nothing.
- **Overflow is loud, never silent.** Exceeding the cap is its own hard-block reason
  (`exempt-list-overflow`) with its own event-log entry, not a quietly truncated read. A gate that
  cannot read its own exemption list must stop, not guess.
- **`/vet-ticket`'s GEN-58 lane must detect "already present"** and refuse to re-append or retry;
  if the id is present and the write is still blocked, the cause is elsewhere and it says so rather
  than looping.
- **A `/wrap` re-evaluate bar** at 90% of the cap — see §10.

Pruning, defined because "prune" is otherwise an instruction with no meaning: **nothing is pruned
automatically.** Old volume ids stay valid (an archived volume is still editable), so removal is a
manual operation, and reaching 90% of a 4,096 cap is a signal that something is appending ids that are
not log volumes — which is a bug to find, not a list to trim.

A write is exempt iff **all** of the following hold — a closed shape, so anything unrecognised gates:

1. **Every** extracted id (§4.3) is either the hardcoded GEN-58 id or a valid line in the file.
   *Every*, not *any*: `any` would let a payload naming both a volume and a live ticket escape the
   gate — the shape finding 21 describes. **Zero of 273 subtree writes carry an id outside the
   subtree**, so `every` is free.
2. `command` is present and is one of `insert_content`, `insert_content_after`,
   `insert_content_before`, `update_content`.
3. No key named `allow_deleting_content` appears anywhere in the normalised payload, with any value.
4. `new_str`, where present, is not empty or whitespace-only.
5. Every root key is in a permitted set (the §4.2 clause-1 set plus the content-command fields).

**What each clause costs, measured over the 273 subtree writes** (`measurement-edit-targets.md`
Part 2):

- Clause 2 refuses `replace_content` — **0 occurrences**. This is the exact form finding 3
  demonstrated: `replace_content` + `new_str: ""` + `allow_deleting_content: true` was approved with
  no record and no network call.
- Clause 3 refuses the flag that **also deletes child pages** — i.e. the volumes holding every
  write-up. **0 occurrences.** Note it refuses the key's mere *presence*, even with the value `false`.
  That is deliberately blunter than necessary and costs nothing today; if a future Notion client starts
  sending `allow_deleting_content: false` defensively, narrow it to truthy values rather than removing
  the clause.
- Clause 4 costs **1 write in 273** (0.37%) — one real write empties a 6,138-character block. That is
  a legitimate repair, so this clause is a genuine cost, not a free win. The escape is one
  `/vet-ticket` run.
- A clause refusing a merely *shorter* `new_str` was considered and **rejected**: 3 occurrences, and
  shrinking is ordinary editing here (`new_str` does not start with `old_str` in 132 of 148 pairs).

**The residual this leaves, stated rather than closed.** Clauses 2–4 refuse the destructive forms
that are *visible in the payload*. They cannot prove a permitted `update_content` does not destroy
adjacent content, because that is not decidable without the page's current body. Detecting it is
[GEN-453](https://app.notion.com/p/39e6e495d07c819b9d51ff4428e65e43)'s job — verify-after-write for
Notion body edits, extended on 2026-08-03 to cover a write that lands correctly while destroying
adjacent content, raised to Urgent, and scheduled to run immediately after GEN-508 ships. Its two
recorded incidents are both GEN-58 writes that silently did not do what they claimed.

### 5.2 This reverses the design's own cache-integrity principle — bounded, not denied

v3 established a principle to fix a whole class of defects at the root: **only ever hold a fact that
*increases* gating; any fact that would *decrease* gating must be re-derived, never trusted from
disk.** The exemption file is precisely a gating-decreasing fact held on disk. That is a deliberate
reversal and it needs bounding rather than restating the principle and ignoring it.

Under `bypassPermissions` a file write is silently allowed anywhere, so **no location gives this file
any integrity protection**; two earlier versions of this design reasoned "outside `~/.claude` ⇒
prompted ⇒ safe" and both were void. The bound is the protection:

- An entry un-gates **content-command writes on exactly the one page it names** — including a real
  ticket, if a wrong id is ever appended. It can never un-gate a property edit, a destructive
  command, or anything on any other page.
- The file is append-only and read-only to the hook; the hook never writes it.
- **Its contents are surfaced, not silent**: `/wrap` reports the entry count and any ids added since
  the last report. An exemption list that grows unexplained is then visible rather than latent.

Under the omission threat model this is acceptable: Claude will not *accidentally* append a wrong id.
A deliberate actor who appends one gets content writes on one page — and the same actor could write
to its own session transcript, which defeats a stronger layer than this one. Named, not hidden.

### 5.3 Nothing appended the volume ids — so something has to (new deliverable)

The volumes roll over roughly every 25 entries, so the list changes. v5 had **no component that
maintains it**: a PreToolUse hook cannot see a tool response, and "Claude remembers to add the new
id" is the exact omission failure this whole gate exists to remove.

**Primary mechanism — a PostToolUse arm.** On a *successful* `notion-create-pages` whose payload
parent is the GEN-58 page (or an already-exempt id), extract the created page id from the tool
**response** and append it. `notion-fetch-staleness.js` is an existing PostToolUse hook that already
does Notion work, so this is a known-good shape rather than a new one.

**Its scope is wider than "a log volume", and that is disclosed rather than implied away** (round-1
advisory): the trigger is *any* page created with `parent.page_id` = an exempt id, not a page verified
to be a rollover volume. A sub-page created under GEN-58 for some other purpose would therefore be
appended and become exempt. Impact is small and bounded — such a page is not a Team-Tasks row, so the
ticket bar does not apply to it, and §5.1's clauses still refuse every destructive form on it — but the
mechanism is broader than the prose, so the prose says so.

- **`O_APPEND`, one id per line — never read-modify-write.** Two sessions run concurrently in this
  setup (there is a concurrent-session incident in this repo's own history), and a read-modify-write
  loses one session's entry silently.
- The create that makes a new volume is itself **free**: its parent page id is exempt, so §4.3's
  create row exempts it with no record. This closes finding 12, in which the rollover create was
  hard-blocked — the one write a standing rule requires to be immediate.

**Two adjacent cases the appender does not handle, and what happens instead:**

- A volume created by `notion-duplicate-page`: duplication is **async** and its documented return
  says not to rely on the new page being populated. The id is still recordable, but if the response
  shape differs nothing is appended.
- A volume created by hand in the Notion UI: there is no tool response at all, so nothing is
  appended.

Both fail toward **more** gating: the first write to an unlisted volume is gated. The escape is
`/vet-ticket`'s GEN-58 branch (§7), which verifies the page's parentage over the network and appends
the id. That branch needs Notion access — which costs nothing real, because a Notion write is going
to fail during an outage anyway.

---

## 6. The review record

Directory: `~/.claude-staging/ticket-passes/` — distinct so ticket records can never cross-match the
sibling gates' passes. The location carries **no security property** (§2); it is there for
consistency and could move under `~/.claude/` without weakening anything.

```json
{ "kind": "ticket", "surface": "notion",
  "contentHash": "<sha256 of the normalised reviewed payload>",
  "reviewerAgentId": "<agentId of the sub-agent that reviewed this exact content>",
  "verdict": "PASS",
  "waived": false,
  "target": "<human-readable label: the page id, or 'create in Team-Tasks'>",
  "expires": "<now + 15 min, ISO-8601 UTC>" }
```

`target` is diagnostic text and is **never matched on**. v2 bound on target + hash, and the hook
required a 32-hex id inside `target` while the skill documented it as free-form — so following the
skill permanently disabled a diagnostic (finding 26).

### 6.1 The hash

**`sha256Hex(stableStringify(normalise(tool_input).root))`** — the whole normalised, hoisted payload.
`stableStringify` (`auto-approve.js:829`, verified present in the live hook today) sorts object keys
and preserves array order.

Two reasons it is the whole payload and not a curated per-shape projection:

1. **It has to match.** The corpus carries the same semantic call both plainly and wrapped in a
   `{data: "…"}` envelope. Hoisting makes both forms produce one tree and therefore one hash; a
   projection minted from the drafted object would fail to match the call as emitted, systematically,
   with break-glass as the only escape.
2. **A projection leaves everything outside it unbound.** Whatever the hash does not cover can be
   changed after the review while the record still matches — including `allow_deleting_content`,
   which sat outside every projection bullet v3 listed. Hashing the whole normalised payload means
   "reviewed" covers the entire call, which is what the record claims.

**When `ok === false`, the hash is taken over the raw parsed input instead**, by the same
`stableStringify`. This matters: v3 emitted `hash: ''` on an unreadable payload, so **no record could
ever match** and break-glass was the only door (finding 9's second half). Both the hook and
`/vet-ticket` obtain the hash from the same `--ticket-hash` CLI entry point, so they agree by
construction and the fallback needs no second implementation.

**What makes the CLI exit non-zero, as distinct from returning the fallback hash** (round-1 advisory —
§8 step 3 says a non-zero exit means STOP, and the two conditions were not separated). `ok === false` is
**not** an error: the CLI returns the raw-input hash and exits 0, because a payload we could not fully
read is still a payload a review can be bound to. The CLI exits non-zero only when it cannot produce any
hash at all — the file is missing or unreadable, the argument is absent, the content is not parseable as
JSON, or the normaliser itself throws. Those are the cases where `/vet-ticket` must stop, because a
record with no hash binds nothing.

**One shared definition.** The hook and `/vet-ticket` must compute the hash identically; any drift
makes *every* record fail to match. The normaliser is written once, in the hook, and `/vet-ticket`
calls it through `--ticket-hash` rather than reproducing ~100 lines that would drift.

### 6.2 What the hook verifies — three facts, not two

v3's binding was `contentHash` + `reviewerAgentId`. **The `verdict` field was written into the record
and read by nothing**, so a record carrying `verdict: "REVISE"` passed every check. That is the
identical defect the design had already found and fixed at the *skill* layer, never carried across to
the hook — the one layer whose whole purpose is not to trust the skill. And a second attack needed no
forgery: cite the `agentId` of a real `check-reviewer` from an unrelated `/check` run earlier in the
same session, and both bindings are satisfied by an agent that never saw this ticket.

**Both close with one mechanism.** The reviewer ends its reply with a machine-readable token, and the
hook verifies it in the reviewer's own transcript:

```
TICKET-REVIEW-VERDICT: PASS <contentHash>
```

That establishes all three facts at once — this agent ran, it reviewed *this* content, and it
returned PASS — and it cannot be satisfied by an unrelated reviewer, whose transcript carries a
different hash or none.

**Where the evidence lives** (the GEN-518 mechanism, already used in production by `/vet-rule`
Step 4, so this reuses rather than invents): each sub-agent is persisted as
`agent-<agentId>.jsonl` plus an `agent-<agentId>.meta.json` sidecar under `<session
dir>/subagents/`. Verified live 2026-08-03: `agent-a8ba802e6f032b513.meta.json` reads
`{"agentType":"general-purpose","description":"Angle A line-by-line diff scan","toolUseId":"toolu_016gfMH2uyTV9YJy2gZ69VRr","spawnDepth":1,"model":"opus"}`.
The sidecar carries `agentType` — so the hook can require `check-reviewer` — and **never a verdict**,
which is why the token is needed. **Derive the session directory from `transcript_path` by stripping
`.jsonl`**, never from a hand-built project slug (GEN-518's other lesson: a hand-derived slug was
wrong on Windows).

#### The trap, and the structural fix

A naive whole-file substring search **cannot work**, and this was reproduced on a real transcript:
`agent-a0dc50e30603f019f.jsonl` line 1 is `"type":"user"` — the prompt — and contains the literal
`STATUS: PASS` purely because the verdict template lists both options; line 42 is
`"type":"assistant"` and carries the reviewer's actual, opposite `STATUS: REVISE`.

Three ways a flat search fails, none needing forgery: the reviewer's **brief** is stored in the same
file the hook searches, and the hash is computed *before* the review, so a satisfied token can be
placed in the brief; a REVISE reviewer's own prose can quote the PASS form while explaining why it is
not emitting it; and tickets in *this* project routinely quote this document's literal strings, so an
innocent GEN-508 ticket could trip it by accident.

v4 answered this with a documentation instruction ("never show the token filled in"). That was the
deeper error: a standing rule says to prefer a guard the system executes over prose nobody re-reads,
and the transcript format itself carries the fix.

**The corrected check:**

- Search **only assistant-authored content** (records with `"type":"assistant"`), never the whole
  file. The role field is present in the format, verified above.
- Collect every occurrence of the prefix `TICKET-REVIEW-VERDICT:` in that content. Require **at least
  one**, and require **the last one** to read exactly `PASS <contentHash>`. Last-occurrence defeats
  the self-explaining-reviewer case: a reviewer may mention the form, but its verdict is what it ends
  on.
- **Close the channel at source too**, the cheaper half: before the brief is sent, `/vet-ticket`
  scans the drafted payload *and* the assembled brief for `TICKET-REVIEW-VERDICT:` /
  `TICKET-ADJUDICATION:` and refuses to proceed if either appears.
- **`TICKET-ADJUDICATION` gets all of the above identically.** Parity is not optional; leaving the
  adjudicator token on the old rule is the same hole twice.
- Cap the transcript read (4 MB) and treat cap-exceeded as a block.

`verdict` and `waived` in the record remain a cheap pre-filter — fail fast before opening a large
file — and are **not** the authority. The token is.

#### Adjudication does not clear the gate — it sends the content back to a fresh reviewer `[v6.3]`

> **This replaces the "substitution" mechanism entirely, after three failed attempts at it.** The
> history is in the Appendix and on GEN-58; the short version is that v6 had no path for an overturned
> finding, v6.1 added a token substitution that did not compose with multiple findings, and v6.2 added a
> precondition that **two round-3 lenses independently found unenforceable** — it could only be checked
> inside `/vet-ticket`, the layer this section itself says the hook must not trust. A standing rule says
> that when a third fix becomes necessary, stop patching and re-derive. This is the re-derivation.

**The rule: the hook has exactly two ways to clear the gate — the reviewer returned PASS on this exact
content, or Erez waived it.** There is no third. Adjudication is a process that changes *what Claude
does*, not *what the hook accepts*:

- The reviewer returns REVISE. Claude disputes one finding. A fresh adjudicator (§9) rules.
- **UPHELD** → the finding stands and must be fixed, exactly as now.
- **OVERTURNED** → the finding is dropped, and the content goes back to a **fresh reviewer** — a new
  `check-reviewer` with no prior context, on the same hash. That reviewer either returns PASS, and the
  gate clears through the ordinary path, or raises findings of its own.

What this buys, and why it is smaller rather than cleverer:

- **The hook's check stays two-valued.** No `adjudication` field to verify, no adjudication token to
  parse, no substitution rule, no differing-agentId requirement, no finding count. Deleted, not fixed.
- **The multi-finding hole cannot exist.** A fresh reviewer sees the whole content and raises whatever
  it raises, so there is no way for a second finding to be silently dropped — the failure both round-3
  lenses reached from different directions.
- **The unenforceable per-ticket bound disappears too.** §9's "at most two adjudications per ticket" was
  uncountable, because records are keyed on hash and `target` is never matched on. The bound is now on
  the loop Claude runs, not on a number the hook pretends to know.
- **It does not restore "strict".** Erez rejected reviewer #1 being unappealable, and it is not: an
  independent adjudicator can overturn its finding. It also does not make Claude terminal. And if the
  fresh reviewer independently re-raises the same finding, that is *stronger* evidence the finding is
  real than one adjudicator's opinion — which is a better outcome than the substitution rule gave.
- **Cost:** one extra reviewer run per successful adjudication. That is the whole price.

**The fallback, if this is ever found unsound:** both round-3 lenses proposed the same minimal patch to
the old mechanism — have the reviewer end its own token with a finding count
(`TICKET-REVIEW-VERDICT: REVISE <hash> FINDINGS:<n>`) and honour a substitution only when the last token
for that hash reads `FINDINGS:1`. It is recorded here because two independent reviewers derived it
independently, which makes it the best-attested alternative. It is not adopted, because deleting the
mechanism beats adding a parsing rule to it.

#### ~~Which token is authoritative when adjudication ran~~ — superseded by the above `[v6.3]`

**Deleted, not annotated.** The substitution rule that stood here — a verified
`TICKET-ADJUDICATION: OVERTURNED <hash>` standing in for the reviewer's PASS token — is gone, along with
the `adjudication` record field, the adjudicator-token verification, the differing-agentId requirement
and the "exactly one live adjudication per hash" precondition that was supposed to make it safe. The
reasoning is in the sub-section above.

It is deleted rather than struck through with a pointer because **leaving superseded mechanism text
visible is itself a defect this document has committed five times** — a linear reader implements what is
in front of them. The only trace kept is the fallback paragraph above, which is a genuine alternative, not
a superseded rule.

**One consequence to carry forward:** the reviewer's verdict token keeps its exact-match rule
(`TICKET-REVIEW-VERDICT: PASS <contentHash>`, assistant-authored, last occurrence), and it is now the
**only** token the hook parses. `TICKET-ADJUDICATION` is no longer a hook input at all — the adjudicator
still emits it, but as a record for a human reading the transcript, so the source-side prefix scan keeps
covering both prefixes.

**One record per ticket**, consumed by `unlink`. **Consumption must refuse unless it actually removed
a record whose hash matches** (finding 7): v2's implementation returned success without checking, so
one record could authorise a second write.

---

## 7. Enforcement flow

1. `configUnlocked()` → return (break-glass; shared accepted residual with the siblings).
2. Tool is not one of the four → return.
3. Compute scope: §4.1 → §4.2 → §4.3, no network. `out` → return, untouched.
   **The exemption file is read here, and its cap is checked here** — a round-2 lens found that §5.1
   promised a distinct `exempt-list-overflow` block while no operative section wired it in, so it would
   have fallen into step 10's generic `internal-error` bucket and lost exactly the loud diagnosis the
   cap fix claimed. If the file has more than 4,096 valid ids, or cannot be read at all, this step
   hard-blocks with reason `exempt-list-overflow` (or `exempt-list-unreadable`) and does **not** fall
   through to the generic catch.
4. **Read the record directory for `block` verdicts too, not only `in`.** Every `scope:'block'`
   short-circuited before the record directory was read (finding 8), so an unreadable-payload or
   malformed-target block could not be cleared by a record even though the refusal text and the skill
   both promised it could — leaving break-glass as the only route. With §6.1's raw-input hash
   fallback, every block now carries a hash a record can match.
5. Find an unexpired record whose `contentHash` matches. None → hard-block, consuming nothing.
6. Cheap pre-filter: `verdict === 'PASS' || waived === true`. Fails → hard-block, reason
   `bad-verdict`. **Two values, not three** — adjudication is no longer a hook input (§6.2).
7. Verify `reviewerAgentId` against `<session dir>/subagents/agent-<id>.meta.json`: the sidecar must
   exist and its `agentType` must be `check-reviewer`. Fails → hard-block with reason
   **`reviewer-unverified`**, consuming nothing.
8. Verify the token per §6.2: the reviewer's last assistant-authored `TICKET-REVIEW-VERDICT:` for this
   hash must read `PASS <contentHash>`. Absent or wrong hash → `no-token`. Transcript unreadable →
   **`bad-record`**. Over the 4 MB read cap → **`transcript-too-large`**, which is a distinct diagnosis
   from a missing token and must not be logged as one. Skipped only when `waived === true`, where
   Erez's explicit chat answer is the authority.
9. `unlink` the record; if that did not remove a hash-matching record, hard-block with reason
   **`consume-failed`**. Then approve.
10. **Any internal error anywhere in this arm → hard-block**, reason `internal-error`.

**Every blocking step above names its own reason, and that is deliberate.** A round-3 lens found that
§10's newly-asserted "complete set" of reasons was missing one for three real block paths — a failed
sidecar check, a corrupt record file, and a failed unlink — so all three would have inherited
`internal-error`, which §10 both reserves for arm bugs *and* monitors as "the arm is broken, not the
traffic". A stale sidecar or a corrupt record would then have reported the hook as broken when the
staging directory was the cause: a false signal on the one channel built to catch real breakage. This is
the second instance of that omission in two rounds, which is why the reason is now written into each
step rather than collected in a list elsewhere.

Step 10 reverses v2, which said "fall through, same stance as the siblings". That is void twice:
there is no prompt to fall through **to** — a fall-through under `bypassPermissions` is a silent
approve, so v2's stance was a fail-open wearing the language of caution — and the review found the
defect already realised in code, with the record-scan half sitting *outside* the arm's own
fail-closed `try/catch`, so a record file containing literal `null` threw and the hook exited with
**no decision at all** (finding 2). The whole arm sits inside one `try/catch` whose `catch` is
`exit 2`.

**Call site:** in `main`, immediately after `enforceCheckDue`, before the allow-list check — so an
allow-list entry cannot bypass it. (`enforceStaging` :639, `enforceVetting` :953, `enforceCheckDue`
:1366, shared `findPassInDir` :577, `consumePassFile` :601, `configUnlocked` :217 — all confirmed
present at those lines in the live hook, 2026-08-04.)

### 7.1 Escape routes, by error class

| error class | blocks? | escape |
|---|---|---|
| no record / expired record | yes | one `/vet-ticket` run |
| record malformed or unreadable | yes | re-run `/vet-ticket`, which rewrites it |
| payload unreadable (`ok = false`) | yes | one `/vet-ticket` run — the raw-input hash makes a record matchable (§6.1) |
| unlisted GEN-58 volume | yes | `/vet-ticket`'s GEN-58 branch, which appends the id (§5.3) |
| exemption list over cap or unreadable | yes | manual — nothing auto-prunes (§5.1). The `/wrap` bar at 90% of cap exists so this state is reached with warning rather than as a surprise |
| **shared normalisation / hashing bug** | yes | **global break-glass only** |

The last row is the one non-uniform class and v3 implied it did not exist. `/vet-ticket` gets its
hash by calling the *same* code through `--ticket-hash`, so a normalisation bug breaks the
enforcement path and the escape path identically. Mitigation is pre-install, not runtime:
`/vet-code` Step 4's mandatory write-record → block-without-record → approve-and-consume round-trip
exercises the real normaliser, and must be run against an **enveloped** payload as well as a plain
one. Treat that assertion as blocking for install. Residual: a normalisation bug on a payload shape
the fixture does not cover — which is the strongest argument for keeping the normaliser as small as
this design allows.

### 7.2 The slow-hook race — why it no longer applies

The concern was real and specific: [claude-code#20946](https://github.com/anthropics/claude-code/issues/20946)
reports "the command executes immediately while the hook runs asynchronously in the background", with
a denial arriving 37 s after the `git commit` it was meant to stop. Read directly, 2026-08-03.
Weighted honestly: the reported hook took **30–40 s** (shellcheck/ruff/mypy/pytest); it concerns the
`--dangerously-skip-permissions` CLI flag, which may or may not be the same code path as the
in-session `bypassPermissions` mode; and it was closed as not-planned and tagged stale in Jan 2026.

**v6's arm is in the class already verified to block.** It spawns no subprocess and makes no network
call; its work is bounded local reads. The live verification in §2 is of `auto-approve.js` itself
refusing and the command not executing — the same file, the same event, the same mode.

Two obligations remain, both cheap, replacing v5's blocking pre-build race measurement:

- **A latency budget asserted in the test suite**, not a note: the arm must complete in **under
  250 ms** on the largest corpus payload with the largest permitted transcript read. Over budget is a
  build failure.
- **No subprocess spawn on any path in the arm**, asserted by the same suite. This is the property
  that keeps it in the verified-fast class, so it needs a test rather than a comment.

**Correction on provenance, recorded because it was my worst error in this design.** v4 and v5 both
cited "~700–1000 ms typical **measured in** `design-scoping-v3.md`". That document contains no
latency measurement at all. The real source is `review-findings.md` finding 9 — "live timings put
PasswordVault at 240–420 ms and curl at 430–560 ms" — measured while reproducing a different defect.
The figures were real; the citation was invented, twice, inside revisions whose subject was exactly
this failure class.

---

## 8. The `/vet-ticket` skill

Modelled on `/vet-rule`, the lighter of the two existing record-writing skills.

1. **Fail-closed self-check.** Grep the hook for `enforceTicketVetting` and its record reader;
   missing → refuse.
2. **Draft** the create/edit payload.
3. **Get the hash from the hook — before the review.** `node "<hook>" --ticket-hash "<payload.json>"`.
   Do not reproduce the normalisation. Non-zero exit → STOP, write no record. (It must come before
   the review because the reviewer has to echo the hash in its token.)
4. **Branch on what the target actually is** — three lanes, because "every page is a ticket" gates
   more than tickets:
   - **A ticket create or edit** — the normal lane. Spawn a `check-reviewer` sub-agent that did not
     draft the ticket, given the drafted payload, the ticket-bar checklist and the hash. It returns
     PASS / REVISE with specific findings and ends its reply with
     `TICKET-REVIEW-VERDICT: <PASS|REVISE> <hash>`. The brief shows the token **only** in placeholder
     form.
   - **Not a ticket** — the target is an ordinary Notion page, so the ticket bar does not apply.
     **Entry to this lane is verified, not declared.** v6's first draft said only that the reviewer
     "confirms the target is not a Team-Tasks row", and a round-1 lens correctly refused it: it never
     said *how*, lane selection happens before any reviewer runs, and an unspecified confirmation is
     exactly the "Claude declares this a non-ticket" shortcut the lane was supposed to avoid.

     The confirmation has to be a network call, and there is no local substitute — for an edit the
     payload carries no container id, so marker-absence is true of *every* edit, ticket or not. That is
     the same fact that forced the collapse. So: `/vet-ticket` calls `GET /v1/pages/{id}` on the target
     and enters this lane **only** if the response is `200` and the parent is not a Team-Tasks id. Any
     other outcome — non-200, unreadable, a Team-Tasks parent, or no network — falls back to the full
     ticket review in the lane above, which is safe and merely costs one reviewer.

     **The lookup the collapse deleted therefore reappears — deliberately, and in the right place.** In
     the hook it sat on the blocking path of every edit, which is what dragged in a cache, two TTLs, a
     latency budget and the slow-hook exposure. Here it is in a skill: off the blocking path, latency
     harmless, no cache, and reached only on the ~1-in-1,000 payload that is not a ticket.

     **This lane is why over-gating does not terminate on Erez** — a gap in v5 that three other
     findings leaned on for their escape. Cost: one page fetch plus one sub-agent per non-ticket write,
     measured at ~1 edit in 1,081 and 1 create in 263.
   - **An unlisted GEN-58 volume** — verify the page's parent is the GEN-58 page via
     `GET /v1/pages/{id}`, append the id to the exemption file (§5.1), and re-issue. No review; a log
     body is not held to the ticket bar. This lane is self-attested and its bound is §5.2's.
5. **Fix, re-hash, re-review.** A fix changes the content, so it changes the hash: re-run step 3 and
   re-review against the new hash. A token carrying the pre-fix hash is worthless to the hook, which
   is correct — reviewed-then-edited content has not been reviewed. This loop is the mechanism by
   which "a record cannot survive an edit to the content it covers" is actually enforced end to end.
   If the bar cannot be met because only Erez holds the missing information, STOP and consult him. If
   a finding is *disputed* rather than unfixable, run the bounded adjudication in §9 — never override
   it.
6. **Evidence precondition, then write the record.** Verify: `reviewerAgentId` present; both
   `agent-<id>.jsonl` and `agent-<id>.meta.json` exist under this session's `subagents/` with
   `"agentType":"check-reviewer"`; the hash still equals step 3's; `verdict === 'PASS'` **or**
   `waived === true` — those are the only two, since adjudication is no longer a hook input (§6.2) — and
   the reviewer's own transcript carries `TICKET-REVIEW-VERDICT: PASS <hash>` under the assistant-role
   rule. The skill runs the same check the hook will run, so a mismatch surfaces here with context
   instead of as a bare refusal later. **If adjudication overturned a finding, the record written here is
   for the FRESH reviewer that ran afterwards**, not for the adjudicator — there is nothing special about
   an adjudicated ticket by the time it reaches the hook. Then write the record. The record write prompts nobody and **is not an approval step** — it
   is evidence, and the hook re-verifies all of it independently.
7. **Apply** the Notion call, then **verify no record for this hash remains**. v2's post-write check
   FAILed on every successful filing (finding 27) because it looked for "a still-live `*.json` naming
   this target and hash" in the directory where its own record lived, and nothing removed it.

### 8.1 Erez's approval, and the rule conflict it creates

Erez's approval happens **in chat, before step 4**, under the standing rule that already requires it.
**Show him a summary card, not the drafted body** (his instruction, 2026-08-02): title, one-line
gist, parent, the ticket IDs the body cross-references, the properties (type, status, assignee,
Urgency, Gain ratio, derived Priority), the reviewer's verdict and any findings, and an offer to show
the full body. Two consequences accepted deliberately: his approval means "file this", not "I endorse
this wording" — the body's quality rests on the independent reviewer; and the cross-references line is
read out of the draft text, because the live schema has exactly two relation properties
(`Parent item` and its inverse `Children`) and no generic related-tickets field.

**The conflict, which must not be left implicit.** The global rule beginning "Before creating or
materially changing a ticket in a tracker" requires drafting "title, body, and key properties" for
approval. Summary-card approval contradicts the "body" half for gate-mediated filings, so the rule
needs an explicit amendment: where an independent reviewer has passed the body under this gate, Erez
approves the card and the body is the reviewer's charge.

**And that amendment collides with the ask's own constraint.** GEN-508 requires enforcement "without
growing the always-loaded global CLAUDE.md", while the amendment *adds* a sentence to an
always-loaded rule. The offsetting reduction — moving the ticket-bar prose out of the global file into
the reviewer's checklist — sat in piece 3. So it **comes forward into piece 1**, and both edits travel
together through `/check` then `/vet-rule` with Erez's explicit confirmation. **The net-neutrality of
that pair is asserted, not measured**: no byte or line count exists yet. Measure it when the actual
rule diff is drafted, and if it comes out net-positive the trade-off goes to Erez rather than being
assumed away.

### 8.2 The per-case waive

v1 had this backwards, claiming "Erez declining the mint IS the waive" — declining means no record,
so the write stays blocked; a decline *reinforces* the stop. The waive is the opposite: it lets a
specific write through despite the stop.

So: when the reviewer holds findings that cannot be fixed — and any that were *disputed* have been
through adjudication and were **upheld**, since a disputed finding goes to adjudication rather than
straight to a waive; a finding that is simply unfixable needs no adjudication first — `/vet-ticket` shows
Erez the
outstanding findings in plain terms and asks. On his affirmative the record stores `waived: true` +
`waiveReason` + the outstanding findings. The hook is unchanged: a valid record is a valid record. The
waive is scoped to one write and never touches the global break-glass. It rests on **a single
explicit chat answer**, which must therefore be an unambiguous yes to a specific named finding, never
inferred from a general go-ahead.

---

## 9. Disagreement with the reviewer — adjudicate

**Erez's decision, 2026-08-03.** When the reviewer returns REVISE and Claude disagrees, the
disagreement is settled by **another independent review** — not by Claude overriding, and not by an
automatic hard stop. Two options were put to him and he rejected both, correctly: "strict" makes a
pedantic or mistaken reviewer an unappealable authority and lands the cost on him as an interruption;
"override with a record" makes Claude the judge in its own case, which is the exact failure this gate
exists to prevent, merely documented.

- The adjudicator is a **fresh** sub-agent with no prior context, briefed on **one specific finding**,
  not asked to re-review the whole ticket.
- The brief carries, separately labelled and verbatim: the original goal, **the disputed drafted
  ticket text itself**, the reviewer's finding, and Claude's counter-argument. Claude does not
  summarise or characterise any of them. v3 omitted the draft, which would have left the adjudicator
  weighing two pieces of prose *about* a ticket it could not read — and findings at this bar ("the
  body stands on its own") are checkable only against the draft. Omitting it hands Claude control of
  what the judge sees, which is the precise failure adjudication exists to remove.
- **An OVERTURNED finding sends the content back to a fresh reviewer; it never clears the gate itself**
  (§6.2). Two earlier attempts to make the hook honour an overturned finding directly both failed
  review, and the second one failed because its guarantee could only be evaluated inside this skill —
  the layer the hook is built not to trust. There is no adjudication field, no adjudication token check,
  and no finding count in the record. What the hook accepts is what it always accepted: a reviewer PASS,
  or Erez's waive.
- **Bounded, and the bound is on the loop rather than on a number the hook pretends to know.** At most
  two adjudications while resolving one ticket, and at most one fresh-review cycle after each. If a
  finding survives adjudication it stands and must be fixed. If the fresh reviewer raises it again, that
  is two independent agents agreeing and it stands. Past the bound it goes to Erez with both positions
  stated plainly. (v6.2 tried "at most two adjudications per ticket in total" as a hook-side bound; a
  round-3 lens pointed out nothing can count *per ticket*, because records are keyed on content hash and
  `target` is never matched on. The bound belongs where it can actually be observed — this skill's own
  loop — and the event log's `adjudicated` field plus a `/wrap` count is what makes it visible.)
- The adjudicator still ends its reply with `TICKET-ADJUDICATION: <UPHELD|OVERTURNED> <contentHash>`,
  and the source-side scan still refuses a brief or payload containing that prefix — but the **hook no
  longer reads it**. It is an audit record for a human reading the transcript and a signal for the event
  log, not a gate input. That is the point of the redesign: the only agent whose word the hook takes is
  the reviewer that returned PASS on the exact content being written.
- **Honest limit:** this does not remove Erez from the loop; it makes his involvement rare and
  well-justified. Anyone terminal must be a human. The claim is only that Claude is never terminal in
  its own case.

---

## 10. Signals, and how each one reaches a decision-maker

Every mechanism below produces a signal for a later decision, so each names its reader, its form and
its bar. A signal with no surfacing path is not designed in.

**The event log.** `/vet-ticket` appends every gate event to
`~/.claude-staging/ticket-gate-events.jsonl` — `{ts, target, verdict, adjudicated, waived, notTicket,
reason}` — and the hook appends every hard-block with its reason. The complete set, **derived from §7 by
walking every blocking step rather than maintained separately**: `no-pass`, `bad-verdict`,
`reviewer-unverified`, `no-token`, `bad-record`, `transcript-too-large`, `consume-failed`,
`unreadable-payload`, `bad-target`, `exempt-list-overflow`, `exempt-list-unreadable`, `internal-error` —
plus `rest-refused` if §12.1's Option C ships. **`internal-error` is reserved for a genuine bug in the
arm and must never be inherited by a named condition**; §7 now carries each reason at its own step, which
is the only arrangement that keeps the two in sync. Two consecutive review rounds found this list
incomplete, both times because a block path was added somewhere else — hence deriving it from §7 rather
than curating it here. Without the log, a persistently broken gate is indistinguishable from a transient
one and shows up only as unexplained friction.

| signal | reaches Erez as | bar |
|---|---|---|
| a **waive** or a **decline** at the card | a line in that same turn's "📌 For you" block, per the skill's own instructions — never deferred to a later routine | — |
| waive rate | a `/wrap` line | above ~1 in 4 gated writes, the lane is firing too often — revisit scope |
| adjudication rate | a `/wrap` line | above ~1 in 4 reviews, reviewer #1's brief is too strict — rewrite the brief, do not add more adjudication |
| **"not a ticket" rate** — the drift counter | a `/wrap` line | above ~1 in 20 gated writes, the "every page is a ticket" premise has drifted and scoping needs revisiting |
| exemption-file contents | a `/wrap` line: entry count, and any ids added since the last report | two bars: any id added by a route other than the appender is worth a look; and **above 3,686 of 4,096 entries (90%)** something is appending non-volume ids — find the bug, do not trim the list (§5.1) |
| repeated `internal-error` blocks | a `/wrap` line | more than one in a session means the arm is broken, not the traffic |

The drift counter is the answer to `measurement-edit-targets.md`'s last limit — the corpus is
dominated by this project's own ticket-heavy work, so it is close to the most favourable possible
sample for "almost everything is a ticket". If Notion use shifts toward docs or a wiki, the cost
rises, and the counter is what says so before the friction is attributed to the gate itself.

**Firing semantics, stated because the wording above admits two readings** (round-1 advisory, and Erez
has a standing preference against added noise in his daily path): the aggregate rows are
**threshold-triggered and silent below their bar** — `/wrap` prints a line only when a rate is above
its bar, or when the exemption file changed since the last report. The one exception is the immediate
waive/decline report, which always prints, because a waive is a decision he made and must see recorded.
A `/wrap` that prints nothing from this gate means every rate is inside its bar.

The `/wrap` lines are a skill edit, so they go through `/vet-rule`. The immediate waive/decline
report needs nothing beyond `/vet-ticket`, so **every signal has a working reader from day one** or a
named deliverable that gives it one.

---

## 11. Callers that already write to Team-Tasks

**`/wrap` breaks on the first run after install unless this is fixed.** Its Step 1 (unresolved-item
capture) and Step 3c (detector-review ticket) call `notion-create-pages` / `notion-update-page`
**directly**, and `wrap/SKILL.md` contains no reference to `/vet-ticket` at all (grepped 2026-08-03).
Both steps carry an explicit override exempting them from the draft-for-approval gate *specifically
so they run unattended* — so they hard-block with no record present and no consult path waiting to
catch it. This is a self-inflicted breakage introduced by piece 1, and rewriting those two steps to
run draft → review → record before their Notion call is a **piece-1 ship requirement**. It is a skill
edit, so it goes through `/vet-rule`.

`/wrap` is one instance, and fixing only the instance leaves the class. **Before install, enumerate
every existing routine that writes to Team-Tasks and give each an explicit disposition** — routed
through the gate, or exempted with a stated reason. Known members: `/wrap` Steps 1 and 3c (route),
the GEN-58 log-write protocol (exempt — §5), and status-only ticket updates under the standing status
rule (exempt — `Status` is housekeeping under §4.2).

**The enumeration must be wider than a grep for four tool names**, and v5's version claimed
completeness it could not have:

- **Raw REST / curl callers**, which name no MCP tool. Grep for `api.notion.com` too.
- **Write obligations that live in prose, not in a skill file** — the global `CLAUDE.md` and the
  memory files mandate ticket writes (the status rule, the GEN-58 protocol, the learning-ticket
  rule). A grep of `~/.claude/skills/**` and `hooks/` cannot see them.
- **Scheduled and cron-triggered runs**, which file tickets with no interactive session.

Anything the enumeration turns up that is not dispositioned **blocks install**. The list goes in the
hook header so a future skill author can see it.

**One genuine cost to name:** `/wrap` gets slower, because each filing now runs a reviewer sub-agent.
Silent, but not free.

---

## 12. What piece 1 contains

Every item traces to a specific verified defect or a measured gap; none is speculative. That does not
make the total the right size to ship as one change — **that judgement is Erez's.**

| # | Deliverable | Why it is in piece 1 |
|---|---|---|
| 1 | `enforceTicketVetting` PreToolUse arm | the gate itself |
| 2 | The local scoping layer, §4 | three stages, no network; this is how scope is decided |
| 3 | The exemption file and its closed shape, §5.1 | the log subtree comes into scope for the first time under "every page is a ticket" |
| 4 | **PostToolUse volume-id appender**, §5.3 | nothing else maintains the list, and "Claude remembers" is the omission failure the gate exists to remove |
| 5 | `/vet-ticket` skill, rebuilt, with all three lanes | the checked-in draft still asserts the refuted premise, the deleted `targets[]` shape and raw-`tool_input` hashing; the non-ticket lane is what keeps over-gating off Erez |
| 6 | Verdict-token verification, assistant-role-scoped | without it a REVISE record clears the gate |
| 7 | The 14 surviving `FIX` defects + `CARRY` #7, §13 | fail-opens in code that survives |
| 8 | Test-oracle rebuild in `test-gen508.js` | the current sweep cannot detect the bug class it exists for; two tests assert nothing |
| 9 | Latency + no-subprocess assertions, §7.2 | these are what keep the arm in the class verified to block |
| 10 | `/wrap` Steps 1 and 3c rewritten via `/vet-rule` | otherwise the first `/wrap` after install hard-blocks with no consult path |
| 11 | Caller enumeration, widened per §11 | `/wrap` is one instance of a class |
| 12 | The `/wrap` signal lines, §10 | a signal with no reader is not designed in |
| 13 | Two global `CLAUDE.md` edits via `/check` then `/vet-rule` | the amendment resolves a live rule contradiction; the prose move pays for it — **with the acceptance criterion in §12.2, which is not optional** |
| 14 | Pieces 2 and 3 filed as sub-tickets | standing rule: a named follow-up is created, not referenced |

**Two items on this list carry an unresolved question each, both raised in round 1 and both recorded
here rather than smoothed over:**

- **Deliverable 4 (the appender) is the one plausible cut.** The reactive fallback in `/vet-ticket`'s
  GEN-58 lane has to exist anyway, for volumes created by duplicate or by hand — and it is autonomous,
  so it costs no interruption. If it exists, the appender's whole marginal value is avoiding one
  self-resolving block per ~25 log entries, in exchange for a new hook arm, a second writer to the
  exemption file, and its own concurrency property. The justification given in §5.3 argues against
  relying on Claude's memory, which is not the alternative on the table. Worth putting to Erez as an
  explicit cut before building it; the design is sound either way.
- **Deliverable 10 (`/wrap` Steps 1 and 3c) has an unpriced fork.** Do the rewritten steps show Erez
  the §8.1 summary card, or stay unattended? Interactive approval reintroduces exactly the interruption
  he said this gate should not add; skipping it removes one of the few named backstops against a lenient
  reviewer, on the filings most likely to need it (auto-filed, unattended, and the two GEN-508 records
  as having gone wrong). The `/vet-rule` step on that edit is the right place to force the choice, and it
  must not be allowed to pass by default.

**Deliberately not in piece 1:** the Jira arms; re-examining the three installed sibling gates' false
headers; and anything about a parent cache, which no longer exists. The raw REST/curl arm was on this
list and has moved to §12.1 as an open decision, because measuring it showed it is ~15% of write
traffic rather than an edge.

**Dropped from v5's list:** the blocking pre-build race measurement. The arm no longer makes a
network call, so it sits in the class already verified to block; deliverable 9 replaces the
measurement with two permanent test assertions, which is stronger than a one-off check.

**Install the hook and the skill together.** Every refusal message names `/vet-ticket`; shipping the
hook alone makes every in-scope write unrunnable except through break-glass, which also disables the
three sibling gates (finding 15).

## 12.2 The reviewer's checklist IS the enforcement — and deliverable 13 can silently delete from it

A round-3 lens found the gap between what this gate mechanically guarantees and the ticket's word **all**,
and it is the most consequential finding of the round after the adjudication rewrite.

**The mechanism guarantees that a review ran.** What that review *checks* is the reviewer's checklist —
§14 says so outright: the real backstops are adjudication and "the reviewer brief's own quality". §8
step 4 refers to "the ticket-bar checklist" without defining it or requiring it to be complete.

**And deliverable 13 pays for the §8.1 rule amendment by moving ticket-bar prose out of the always-loaded
global file and into that checklist**, while §8.1 measures only **byte-neutrality**. So a rule that fails
to make the trip is no longer in the always-loaded file *and* not in the checklist — it stops being
enforced anywhere. The change whose purpose is enforcement can subtract enforcement, and nothing in the
plan would notice. The checked-in draft checklist has six items; the global file's ticket rules are more
numerous than six (the Team-Tasks template check, re-deriving Urgency/Gain after a material edit,
assignee-as-ownership for follow-ups, ID-linking, the Done-versus-Review verification choice, among
others).

**Acceptance criteria for deliverable 13, binding rather than advisory:**

1. **Enumerate the complete current set of ticket-quality rules** from the global `CLAUDE.md` before
   moving anything. The enumeration is an artifact, not a step.
2. **Show the move loses none of them** — every enumerated rule appears in the checklist afterwards.
   Byte-count neutrality is a separate, weaker check and does not substitute.
3. **Keep them in sync.** The global ticket rules change often, so a copied checklist drifts silently.
   The pair must be re-checked whenever a global ticket rule changes; the `/vet-rule` flow that edits
   those rules is where that check belongs.
4. **Say what the gate does and does not cover.** Absent (1)–(3), this design enforces
   body-self-containment and the priority fields — not "all ticket-quality rules" — and the honest
   phrasing has to be the narrow one.

## 12.1 The one open decision — raw REST/curl writes, in or out of piece 1?

Surfaced by measurement during round 1 (§4.0.1). It is a scope trade-off with a real cost either way, so
it is Erez's rather than mine.

**Option A — full parity: gate raw REST writes through the same review record.** Detect the write with
`notion-schema-guard`'s existing matcher, then require a record as for any other gated write; the hash
covers the command string. Cost: piece 1 grows by an arm plus tests; every script or tooling that writes
through REST starts needing a record, widening §11's enumeration; and — the cost v6.1's first draft did
not disclose, caught by a round-2 lens — **the "payload" becomes a shell command rather than a structured
object, so the normaliser gains a second input shape, which cuts directly against §7.1's own statement
that keeping the normaliser small is "the strongest argument" against a residual normalisation bug.**
Option A therefore buys coverage by eroding a safety property this design argues elsewhere.

**Option B — ship piece 1 as specified, close it in piece 2.** Piece 1 stays its current size. Cost:
~15% of Notion write traffic stays ungated after install — including page creates, the largest slice of
which is **page body content edited via `PATCH /v1/blocks`**, and the only destructive operations in the
surface. The gate's guarantee then reads "every create/edit **through the MCP tools**", which is narrower
than the ticket's wording and must be recorded that way rather than as "enforced on every create/edit".
**If B is chosen, the residual needs a monitor, not a note:** the raw-REST write count per session goes
into the event log and gets a `/wrap` line, with a re-evaluate bar — if raw-REST writes exceed roughly
one in ten Notion writes in a `/wrap` window, the deferral is no longer defensible and piece 2 moves up.

**Option C — funnel: refuse raw REST writes outright and route them through the gated MCP tools.**
Raised independently by two round-2 lenses. Reuse `notion-schema-guard`'s existing `isNotionMutatingHttp`
matcher and refuse with `exit 2`; the escape is "do it through `notion-update-page`", which is already
gated properly. This is the cheapest of the three and the only one that *reduces* total mechanism:

- **No second normaliser input shape, no command-string hashing, no record path for shell text** — so
  none of Option A's tension with §7.1.
- The hard part of the detection — telling a Notion read from a write, given that Notion reads also POST
  — is **already written and already carries a maintained read allow-list**.
- Two gated surfaces become one **for the traffic the matcher can see**, which is narrower than "every
  Notion write". `notion-schema-guard.js:161` requires the command to name an HTTP client
  (`curl`/`wget`/`iwr`/`irm`/`invoke-*`) before anything else fires, so a `node` or `python` script that
  makes the same write is not matched — and Part 4's own limits say such calls exist and are why its
  totals are a **floor**. C narrows the hole; it does not close it, and the funnel is not an invariant.
  An earlier draft of this bullet claimed it was; that was an overclaim, caught at the cap.
- **Viability, with the arithmetic rather than a summary** (Part 4a). Of 236 write commands only **102
  carry an id in the URL** at all; of those, the overlap column totals **64 (63%)**, leaving **38
  identifiable calls whose target the MCP path never touches** — 21 of 46 `PATCH /v1/blocks`, 8 of 27
  `PATCH /v1/pages`, 3 of 8 `POST /v1/pages`. And **page-target overlap is not operational
  equivalence**: a `PATCH /v1/blocks/{block-id}` against an individual block has no MCP form regardless
  of which page it sits on. So "the large majority has a direct MCP equivalent" — which an earlier draft
  asserted — is **not supported**; what is supported is that the *page-addressed* writes have one.
- **What it strands, and how the carve-out must work.** `DELETE /v1/blocks` (5), `DELETE /v1/pages` (1)
  and the two `/v1/databases` writes — 8 of 236 — **pass through unchanged, exactly as ungated as they
  are today.** They are not rerouted.

  > **An earlier draft got this dangerously wrong and it is worth recording.** It said the MCP
  > equivalent for `DELETE /v1/blocks` was `replace_content` with `allow_deleting_content` — which is
  > the flag §5.1 clause 3 refuses on mere presence, precisely because it is what makes a whole-subtree
  > wipe (including deletion of the log volumes) reachable. That advice would have converted six
  > precise, narrow block deletions into the broadest destructive call in the entire surface. The claim
  > was also false on its own evidence: §5.1's clause-4 pricing records a real write that emptied a
  > 6,138-character block through an ordinary content command with an empty `new_str` and **no**
  > `allow_deleting_content`. A narrow pass-through allow is strictly safer than any reroute.
- **The MCP-unavailable case, which the earlier draft did not name at all.** Raw REST is today's working
  fallback when the connector errors. Under C that fallback is refused, so a connector outage stops
  *every* Notion write — including the GEN-58 log writes a standing rule requires to be immediate. The
  pass-through allow-list above does not cover that, because the blocked calls would be ordinary page
  writes. This is a real cost of C and it belongs in the comparison.
- **C needs a monitor, on the same standard Option B was held to.** Its own admitted risk is "blocks real
  work", and §10's rule is that a signal with no surfacing path is not designed in. So: count refused
  raw-REST writes in the event log under reason `rest-refused`, with a `/wrap` line and a bar — **if
  refusals recur at all across two `/wrap` windows, the carve-out is too narrow and is blocking work.**
  An earlier draft gave B a monitor and C none, which is exactly backwards for the option being
  recommended.
- **Unmeasured, and the reason the recommendation below changed:** whether any of the 236 REST writes
  exist *because* the MCP tool could not express the operation. The 38 non-overlapping identifiable
  calls are the sample to answer that on, and it has not been done.
- Implementation detail that must be chosen rather than left open: reuse the matcher by **copy into the
  locked `auto-approve.js`** (tamper-resistant, but drifts from the read allow-list it was copied from)
  or by **`require`ing a shared module** (stays in sync, but puts a gating-critical decision in an
  unlocked file). If copied, a fixture test asserting the two matchers agree is mandatory. Also: if C
  ships, §4.0's tool table, §7 step 2, §7.1's escape table and §10's reason list all need the new path
  wired in — the same omission that produced the round-2 `exempt-list-overflow` finding is latent here.
- Retiring `notion-schema-guard`'s shell arm loses nothing behaviourally today, but it is the only
  mechanism that would resume working if a genuine prompt were ever restored (§14's open user-scope
  `permissions.ask` question). Note that in the retirement rather than deleting silently.
- Placement note: the refusal belongs in **this arm**, not by changing `notion-schema-guard`'s `ask` to
  `exit 2`, because that file's own architecture note reserves hard-blocks for `auto-approve.js`. Reuse
  the matcher, not the file. Once this arm refuses the traffic first, schema-guard's shell arm becomes
  dead weight and should be retired in the same change rather than left to look active.

**What I would do — changed twice, and this is the position after round 3 tested it.** v6.1 recommended
A. v6.2 recommended C, on a viability claim the cap round showed the evidence does not carry. **v6.3
recommends B — ship piece 1 with the MCP tools gated, the gap measured, and a monitor with a bar — and
open the REST question as its own ticket whose first step is the missing measurement.**

The reasoning, stated so the change is auditable rather than a drift:

- **A and C both now rest on something unmeasured.** A's cost (a second normaliser input shape) is real
  and works against §7.1. C's benefit is overstated: 63% of *identifiable* calls overlap, page-target
  overlap is not operational equivalence, and the matcher cannot see a `node`/`python` write at all. The
  measurement that would settle both — sampling the 38 non-overlapping calls for whether the MCP tools
  can express them — takes an hour and has not been done. Choosing either now means choosing on the
  evidence that just failed review.
- **C also has an availability cost nothing else has.** It makes the MCP connector a single point of
  failure for *all* Notion writing, including the GEN-58 log writes a standing rule requires to be
  immediate. Today raw REST is the working fallback when the connector errors.
- **B is the only option that does not require a premise I do not have.** Its cost is honest and
  bounded: the guarantee becomes "every create/edit **through the MCP tools**", the largest ungated slice
  is page-body edits via `PATCH /v1/blocks`, and the monitor with its bar is what stops that becoming
  permanent by inattention.

**What this means for the ticket's own wording**, stated rather than glossed: under B, GEN-508 piece 1
does not deliver "every Notion create/edit". It delivers every create/edit through the four MCP tools,
with ~15% of write traffic named, measured, monitored and deferred. That should be written into the
ticket rather than left to be discovered.

**The scope call is Erez's**, and the plain-language version of it is: ship the guard now covering the
tools normally used, with the other route measured and watched — or hold piece 1 until the other route is
handled too, which needs one more measurement first and carries a real risk of blocking legitimate work.

---

## 13. Status of the 27 reviewed code defects

From `review-findings.md` (`/code-review` at max effort, 2026-08-03; 10 finder angles, one verifier
each, then a gap sweep). The collapse dissolves **8** of the 22 that were open.

| status | count | findings |
|---|---|---|
| `FIX` | 14 | 2, 3, 8, 11, 12, 13, 14, 15, 16, 17, 18, 23, 24, 27 |
| `CARRY` | 1 | 7 — consumption must refuse unless it removed a hash-matching record |
| `GONE` | 11 | 4, 5, 6, 9, 10, 19, 20, 21, 22, 25, 26 |
| `RESOLVED` | 1 | 1 — the human-approval premise |

**Newly dissolved by the collapse** (were `FIX`, now `GONE`), each with the reason:

| # | was | why it is gone |
|---|---|---|
| 4 | `g58` cached flag read before the Team-Tasks test, acting as a stale negative | there is no cache |
| 5 | `ticketIsContentOnly` keyed on the literal lowercase `properties` | no branch anywhere reduces gating on a key name; §4.2 and §5.1 are closed shapes |
| 6 | a malformed id silently dropped when a valid id accompanies it | under "every page is a ticket" a malformed id cannot reduce gating, and §5.1 clause 1 requires *every* id to be exempt |
| 9 | the CPU deadline spent by the carve-out's two subprocesses | no subprocesses. The finding's second half — `hash: ''` making a block unmatchable — is closed separately by §6.1 |
| 10 | a 404 from the narrower integration token blocking ordinary work workspace-wide | no token, no HTTP status to misread. This was flagged "most likely finding to make the installed gate unusable in daily work" |
| 20 | `execFileSync` omits `stdio`, leaking child stderr into the refusal text | no child process in the arm |
| 21 | `ticketSeedIds` seeds a 30-day positive on an incidental id | no cache, no seeding |
| 25 | the token-failure path untestable in the harness | no token path to test |

**Corrections to two claims I made in-session about this list**, both verified rather than restated:

- I said findings 6, 9, 10, 11 and 16 "go with the resolver". **11 and 16 do not.** Finding 11 (the
  container fail-open) is closed by a *rule change* — unknown container ⇒ block — which the create
  measurement shows costs zero. Finding 16 (a URL-form id producing two windows) stays a `FIX`; it
  has zero corpus instances but the corpus is not a specification.
- Findings 17 and 18 stay `FIX` with **reduced harm**: both previously ended in a network-dependent
  block, and now merely over-gate.

**Finding 13 gets easier, which is worth stating.** The sweep oracle could not detect fail-opens
because all three of its "legitimate exemption" buckets were computed by calling the very functions
whose fail-open they were meant to catch. Under v6 scope is a **pure function of (payload, exemption
set)** with no network and no cache, so an independent oracle is now writable — and the rebuilt sweep
must be demonstrated to **fail** when a fail-open is deliberately injected. That demonstration is the
acceptance test, not the pass count.

**The withdrawn claim, which must not be restated:** "97/97 tests passing, zero fail-opens across
1,313 payloads" is not evidence of anything. Finding 13 is why.

---

## 14. Honest limits

- **The record proves an independent review ran on this exact content, that the reviewer named really
  existed and returned, and that its verdict was PASS** (or that Erez waived it). It **cannot prove
  the review was competent.** v2 named "Erez's mint-approval" as the backstop; that backstop never
  existed and could not have seen anything if it had. The real backstops are the adjudication panel
  and the reviewer brief's own quality — and **if reviewer #1 is systematically lenient, nothing in
  this design detects it.** The `/wrap` aggregate counts are the only early warning.
- **The transcript and sidecar checks raise the cost of a fabricated review; they do not make one
  impossible.** A Claude willing to write into its own session state defeats them. This design targets
  omission, not evasion, and says so.
- **The exemption file is a gating-decreasing fact on disk** (§5.2). Bounded to content-command writes
  on the pages it names; unbounded in *which* page an appended id could name.
- **A permitted `update_content` inside the exemption can still destroy content.** Payload-shape tests
  cannot decide additivity. GEN-453 is the mechanism; it is the next ticket.
- **The corpus is Claude's own history, not a specification.** Far better evidence than the tool
  schema, but a shape absent from 1,313 calls can occur tomorrow. The structural answer is stage 1
  failing closed on anything it cannot fully read; the statistical answer is §10's drift counter.
- **`notion-duplicate-page` has zero captured payloads.** No field-name guess is load-bearing (the id
  scan is generic), and "no extractable id ⇒ block" covers a misread.
- **A hollow but shape-conforming ticket can still pass a lenient reviewer.**
- **Whether PreToolUse hooks fire for sub-agent-originated tool calls is unverified.**
  `notion-schema-guard`'s header records the same open question. If they do not, a sub-agent could
  file an unreviewed ticket. To be checked at build; if unfired it becomes a named gap, not a silent
  one.
- **Hardcoded ids rot, and the property names already have.** The two Team-Tasks markers, the GEN-58
  page id, the housekeeping property names and the Notion MCP server UUID carry the same latent-rotation
  risk the sibling Notion hooks already document, and a maintenance note goes in the header. The
  housekeeping list rotates **safely**, and this is now demonstrated rather than asserted: `Importance`
  appears in 164 real payloads and no longer exists in the schema (`Urgency` replaced it), and every
  such name is treated as substance — more gating, not less (`measurement-edit-targets.md` Part 3). What
  does **not** rotate safely is the Team-Tasks marker pair: if the data source is ever replaced, the
  marker scan stops firing and creates into the new one read as out of scope. That one needs the
  maintenance note to be specific.
- **Whether a *user-scope* `permissions.ask` rule would prompt under `bypassPermissions` is
  untested** — the global settings files are locked. Nothing here depends on the answer, but it is the
  open question for anyone trying to restore a genuine prompt to any of the four gates.
- **Piece 1 is large.** Fourteen deliverables, three of which are rule or skill edits needing Erez's
  confirmation. Splitting the install is a live option two of three round-3 reviewers recommended;
  the natural seam is hook + skill + appender first, with the `/wrap` and `CLAUDE.md` edits as a
  second change — except that §11 makes the `/wrap` fix a ship blocker, so the seam is narrower than
  it looks.

---

## Appendix — retracted claims and how this document got here

Kept short and separate so the normative text above reads as a specification. Recorded because the
pattern, not any single error, is the lesson.

**Five self-refutations, three of them self-inflicted by the revisions that were cataloguing the
first two.** In each case a rule was corrected in one place and left standing in another, and a
linear reader would have implemented the stale one. v4's mechanical remedy — "before editing a section
carrying a supersession pointer, read the superseding section first" — would not have caught two of
them, because neither edit site carried a pointer. **The real fix is structural and is what v6 does:
one document, and no section that says "see the other document for this rule".**

**Retracted outright:**

- *"No code path that ends in a block may depend on a network round-trip"* (v4) — retracted in v5 as
  unachievable given a positives-only cache, then **delivered** by the collapse, which removes the
  round-trip entirely.
- *A cached negative may route a call to approve* (v4) — contradicted the positives-only decision. Moot:
  no cache exists.
- *The GEN-58 carve-out should exempt content-**adding** commands only* (v3) — falsified by
  measurement (5% coverage of real writes) and its protection rationale was void, because the volume
  pages were never in the gate's scope under the old design. Superseded by Erez's "I choose A" and by
  §5's closed shape, which now protects them for the first time.
- *"~700–1000 ms typical measured in `design-scoping-v3.md`"* (v4, v5) — **fabricated provenance.**
  That document has no latency measurement. Correct source: `review-findings.md` finding 9. See §7.2.
- *Three of the four GEN-58 log volumes are archived and unwritable* (in-session, mine) — wrong. All
  four are `archived=false`; "(archived)" is title text. The exemption list is four pages and grows by
  one per rollover, which is why §5.3 exists.
- *A locally-held list of ticket ids, refreshed at session start* (proposed in-session) — deleted by
  Erez's second question: the list does no work.
- *Findings 6, 9, 10, 11 and 16 all go with the resolver* (mine, in the session log) — corrected in
  §13; 11 and 16 do not.

**Dead ends not worth retrying:** "block fast on cold cache, warm out of band" (assumed a cached
negative that positives-only forbids); a third semantic characterisation of "a log append"; the
`update_verification` exemption (zero occurrences in 1,313 payloads — exempt surface with no traffic
behind it).

**Also corrected in v6.1, by round 1 of the panel on v6** — listed here because each was a claim I made
in v6's first draft, not an inherited one:

- *A ten-property housekeeping exemption* — exceeded Erez's settled three categories by seven fields
  added on my own judgment and never surfaced as a judgment call. Measurement shrank it to five and moved
  `Parent item` to substance; see §4.2.
- *A 128-id cap on the exemption file* — small enough to fill, and filling it made the design's own
  escape route non-terminating. Raised and made loud; see §5.1.
- *"the non-ticket share was overstated ~3×"* — a multiplier that does not reconstruct from the numbers
  it summarised. Withdrawn and corrected at source; see §3.
- *An `OVERTURNED` adjudication clears the gate* — asserted by implication in §6.2 while the enforcement
  flow had no branch for it, so as specified it silently recreated the "strict" behaviour Erez rejected.
  Fixed in three places.

**Review state.** v3, v4 and v5 each drew REVISE from all three `/check` lenses; round 3 hit the
skill's cap and escalated rather than claiming convergence. **v6 was a rewrite, so the round counter
started over.**

- **Round 1 on v6:** holistic PASS, pre-mortem REVISE (3 findings), soundness REVISE (1 finding). All
  four addressed in v6.1; one was promoted to an open decision for Erez (§12.1) rather than resolved by
  me.
- **Round 2 on v6.1:** all four carried-over findings tagged **RESOLVED** by the reviewers themselves.
  Three new findings — one NEW-FROM-REVISION from each of the pre-mortem and soundness lenses, plus the
  holistic lens's re-run after the scope moved. All three fixed in v6.2, and the §12.1 recommendation
  **changed** as a result.
- **Round 3 is the panel's cap.** If it does not converge, that is an escalation to Erez rather than a
  claim of convergence.

Also corrected in v6.2, and worth naming because it is the same failure family as everything above:
**a promised block reason existed in one section with no path through the sections that drive enforcement
and observability.** That is the third variant of "stated correctly in one place, absent where it is
implemented" in this design's history — the first two were across two documents, this one was within a
single document, which is a reminder that merging the documents removed the *worst* instance of the class,
not the class.

**Provenance of the companion document.** `design-scoping-v3.md` is retired as a normative source but
kept: its §1 corpus-shape table and §3 measurements are cited above and are the evidence base for the
normalisation design. Its algorithm sections are superseded by §4 and §5 of this document.
