# GEN-508 piece 1 — design (v7, the single normative document)

> # v7 — Erez's scope decision applied, and three cuts
>
> **Erez settled §12.1 on 2026-08-04: raw REST/curl writes are IN piece 1.** He was shown the three options
> in plain language, labelled in this order — "ship now, cover it later" (B, the standing recommendation),
> "cover it now" (A), and "block that route entirely and force everything through the connector" (C) — and
> answered *"I prefer you cover it now"*, which is the second label verbatim, i.e. Option A. A `/check` lens flagged that "cover" could also be read as Option
> C (the funnel); it cannot, because C was on the same list under its own label and was not the one chosen.
> He also asked
> for **the simplest design that delivers everything needed**, reusing what this project already has
> rather than adding a fourth copy of anything. v7 is that delta, and it is a **net reduction** in
> mechanism despite adding coverage.
>
> | change | effect |
> |---|---|
> | **new §4.5 — the raw REST/curl arm** | reuses `notion-schema-guard`'s existing write-detector (plus two added patterns, so the fixture asserts a superset), binds the record to the command text **plus every referenced body file** — refusing outright when a body cannot be bound — and adds no second input shape to the JSON normaliser, the one cost §12.1 charged against this option |
> | **§9 deleted — the adjudicator role** | the hook already ignored it (v6.3). A disputed finding now goes to a **fresh reviewer**, which was already v6.3's answer for an overturned one. Three failed fix attempts across three rounds are the argument for deleting rather than patching again |
> | **deliverable 4 cut — the PostToolUse volume-id appender** | the skill's GEN-58 lane appends reactively and autonomously anyway; the appender's whole value was avoiding one self-resolving block per ~25 log entries, at the price of a second hook arm, a second writer to the exemption file and its own concurrency property |
> | **deliverable 10's fork resolved — `/wrap` files unattended** | no summary card at wrap time; the reviewer is the gate and `/wrap` reports counts. A card there would reintroduce exactly the interruption this gate is meant not to add |
>
> **The deliverable table still has 14 rows, and saying "14 → 13" was wrong** — a `/check` lens caught the
> arithmetic. Row 4 was *replaced* (appender → REST arm), not removed, and the adjudicator was never its own
> numbered row; it lived inside rows 5 and 6. So: **one row's content swapped, two mechanisms deleted from
> inside other rows, one fork closed.** The count is unchanged; the work is smaller. The document's own
> recurring defect is a number restated in a second place and left stale, so this correction is written where
> the wrong number was.
>
> **What this box replaces.** v6.3 ended in an escalation: the round-3 panel returned REVISE from all
> three lenses at its cap, and the adjudication rewrite written after the panel closed had been reviewed
> by nobody. **v7 deletes that rewrite**, which retires the flag rather than answering it. Three round-3
> advisories remain open and are listed here rather than quietly carried: §4.0.1 still blends Part 4 and
> Part 4a counts in one sentence; §13's "finding 11 is closed" reads against §14's disclosed marker
> fail-open; and Part 4a's `46`/`25` pair is used in two senses. The fourth (§7 step 3 reading as though
> it gated housekeeping edits) is **fixed** in §7.
>
> **Review state: see the round-1 box directly below.**

> ### v7 `/check` round 1 — holistic PASS, pre-mortem REVISE (5), soundness REVISE (2)
>
> Reviewer agent ids, for a future `/vet-code` Step 1b record: pre-mortem `a7ee238379a4af562`, holistic
> `aae03ca6224426b82`, soundness `aaa68b8f281947130` (all `check-reviewer`, Sonnet, 2026-08-04).
>
> **All seven material findings are fixed in the text below.** Three of them were mine, verified against the
> live regexes rather than argued about:
>
> | finding | lens | what changed |
> |---|---|---|
> | a body passed as a PowerShell sub-expression (`-Body (Get-Content -Raw x.json)`) is neither `@file` nor a literal, and `scanChain` returns `NO-CHAIN` — so the hash silently covered the command only and the bytes on the wire were **unbound** | pre-mortem | §4.5 now **refuses** any body argument it cannot classify (`body-source-unrecognised`). There is no command-only fallback |
> | `-T` / `--upload-file` / `-InFile` take **bare** paths, never `@`-prefixed — so the uniform "`@<path>` after a data flag" rule would never have read those bodies at all | pre-mortem | §4.5 now specifies the argument convention **per flag**, in a table |
> | "dropping the client-name gate means an inline `node -e` / `python -c` write is caught" is **false**: the write-signal regexes match CLI-flag syntax only | pre-mortem **and** soundness, independently | claim withdrawn and replaced: the widening is now **two** changes, the second adding native-call patterns that actually match, with "zero corpus instances" stated |
> | the REST GEN-58 exemption covers only the append endpoint, so a REST in-place correction to a log entry gates — possibly against a standing rule | pre-mortem | disclosed with the reason it is **forced** (a block id cannot be mapped to a page without a network call), and the escapes named. Also surfaced the block→page hop the skill's lanes need |
> | the unattended-`/wrap` decision was justified by aggregate `/wrap` counters that cannot see the `/wrap` slice they monitor | pre-mortem | events now carry `source`, and §10 has a `/wrap`-slice row with its own two bars |
> | "Deliverables: 14 → 13" contradicted §12's table, which still has 14 rows | soundness | corrected in both places, with what actually changed |
> | a bearer token inlined in a gated command would be persisted in a reviewer transcript | pre-mortem advisory, adopted | `/vet-ticket` refuses a command carrying a literal token |
>
> Advisories folded in: the Part 4 / Part 4a attribution in §4.5's DELETE counts; the `--ticket-hash-shell`
> equality is now a blocking install assertion (§7.1) rather than an assumption; the Option-A-vs-C reading is
> settled from the labels Erez was shown.
>
> **Holistic passed on the first round**, having checked every reuse claim against the live files, and found
> no smaller design that still delivers content-bound review of raw REST writes.

---

## Earlier round history — v6.3's escalation (kept for the audit trail)

> **What round 3 found, and what v6.3 did:**
>
> | finding | lens | what changed |
> |---|---|---|
> | the "one adjudication per hash" precondition is **unenforceable** — it can only be checked inside `/vet-ticket`, the layer this design says the hook must not trust. Tagged RECURRENCE | pre-mortem **and** soundness, independently | **the substitution mechanism is deleted.** An overturned finding now sends the content back to a **fresh reviewer**; the hook keeps exactly two ways to clear — reviewer PASS, or Erez's waive (§6.2, §9). The `adjudication` record field, the adjudicator-token check and the differing-agentId rule are gone |
> | Option C's recommendation rested on claims its own evidence does not carry, and its answer for block deletions routed them through `allow_deleting_content` — the flag §5.1 refuses outright | holistic + pre-mortem | **corrected with the arithmetic**; destructive verbs now **pass through unchanged** rather than being rerouted; the MCP-outage cost and a monitor were added; **the recommendation changed from C to B** |
> | §10's "complete set" of block reasons was still missing three real block paths, which would have inherited `internal-error` and reported the arm as broken when a corrupt record was the cause | soundness | **each blocking step in §7 now names its own reason**, and §10's list is derived from §7 rather than curated separately |
> | deliverable 13 moves ticket-rule prose into the reviewer's checklist while measuring only byte-neutrality, so a rule that fails the trip stops being enforced anywhere — the gap between "a review ran" and the ticket's word **all** | holistic | **new §12.2** makes enumeration, no-loss and sync binding acceptance criteria, and states the narrow guarantee if they are not met |
>
> **Round-3 advisories** (all non-blocking, none applied at v6.3): §4.0.1 blends Part 4 and Part 4a counts
> in one sentence and undercounts the `/v1/databases` writes; §7 step 3's "read the exemption file here"
> reads as gating housekeeping edits, which §4.2 forbids; §13's "finding 11 is closed" reads against §14's
> disclosed marker fail-open; Part 4a's `46`/`25` pair is used in two senses. **And the adjudication
> redesign above was reviewed by nobody** — written after the panel's cap. **See the v7 box for the
> current disposition of all five** (one fixed, one deleted, three still open).

---

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

**The change:** add a fourth gate arm, `enforceTicketVetting`, to `~/.claude/hooks/auto-approve.js`,
covering both the four Notion MCP write tools and raw REST/curl writes; add a `/vet-ticket` skill that
writes the single-use **review record** the arm demands. **One arm, one record type, one skill** — no
PostToolUse companion, no second hook file. Piece 1 is the **Notion** half; Jira and the cross-tracker rule
set are pieces 2 and 3.

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
drafter; a reviewer/Claude disagreement is settled by **another independent review**, not by either
party's fiat (his 2026-08-03 call — v7 delivers it as one fresh reviewer on the unchanged content, §6.2).

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
*this* content; send a disputed finding to a fresh reviewer rather than letting either party settle it.

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

**DECIDED 2026-08-04 — Erez chose to cover this surface in piece 1.** The arm is specified in **§4.5**;
§12.1, which held the three-way option comparison, records the decision and is otherwise closed.

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

### 4.5 The raw REST/curl arm `[v7]`

**Erez's decision, 2026-08-04: cover this surface in piece 1**, in the smallest shape that delivers it.
What follows is that shape. Everything in it either reuses a mechanism already running on this machine or
closes a specific hole; nothing here is a second copy of anything.

**Detection reuses the detector that already exists.** `notion-schema-guard.js`'s GEN-378 shell-write arm
(`isNotionMutatingHttp` + `pathIsNotionRead`, read 2026-08-04) already solves the hard part: telling a
Notion read from a Notion write when both arrive as `POST`, via a maintained allow-list of read endpoints
(`*/query`, `/v1/search`) rather than a blacklist. **Copy it into `auto-approve.js`** rather than
`require`ing a shared module: `auto-approve.js` is a locked file, and putting a gating-critical decision
in an unlocked one trades tamper-resistance for tidiness. A fixture test over a shared command corpus is
mandatory, and its assertion is **superset, not equality** — every command schema-guard flags, this arm
must flag — because of the widening below.

**Two deliberate widenings, stated precisely because a first draft of this section overstated what one of
them buys** — both `/check` lenses that reviewed v7 caught it independently, by reading the regexes:

1. **Drop the HTTP-client-name requirement.** `notion-schema-guard.js:131`/`:161` require the command to
   name `curl`, `wget`, `iwr`, `irm` or `invoke-*` before anything else fires, which is why
   `measurement-edit-targets.md` Part 4 calls its own totals a floor. This arm drops that gate: the write
   signal alone plus `api.notion.com` is enough. **What this actually buys is narrow** — a client invoked
   through a variable or an unusual path (`& $curlBin -X POST …`) while still using curl-style flags. It is
   free, so it is kept, but it is not the reason coverage improves.
2. **Add native-call write patterns to the write signal** — this is the widening that does the work.
   `WRITE_METHOD_RE` / `PS_METHOD_RE` / `BODY_FLAG_RE` (`notion-schema-guard.js:132`–`134`) match
   **CLI-flag syntax only** (`-X POST`, `-Method Patch`, `--data`). Dropping the client-name gate therefore
   does **nothing** for `node -e "fetch(u,{method:'PATCH'})"` or `python -c "requests.patch(...)"`, and a
   first draft of this section claimed exactly that case as newly caught. It was wrong. So this arm adds two
   patterns of its own: `method\s*:\s*['"](POST|PUT|PATCH|DELETE)` and
   `\.(post|put|patch|delete)\s*\(`, case-insensitive, and treats either as a write signal. **Measured: zero
   instances** — `grep -cE` for both patterns over `~/.claude/hooks/credential-denials.jsonl` and
   `deferred-calls.jsonl` returned `0` and `0` on 2026-08-04, against 8 and 1,349 lines mentioning
   `api.notion.com` respectively. Scope of that measurement, stated because it is narrower than Part 4's: it
   covers the two hook logs, not the full session-transcript corpus Part 4 swept. So this is a
   shape-coverage add, not a measured gap, and the fixture test asserts the patterns fire rather than
   claiming traffic exists.

Reads stay excluded by the same allow-list in both cases. Cost: a command that mentions the URL and carries
a write signal without performing a write would over-gate, at one `/vet-ticket` run; the corpus contains no
such command.

**What the fixture test asserts, therefore, is a superset with a named exception**: every command
`notion-schema-guard`'s matcher flags, this arm flags — plus the two shapes above, which schema-guard does
not flag and is not expected to.

**Scope: every detected write is in scope, with exactly one exemption** — a closed shape mirroring §5.1,
so anything unrecognised gates. Exempt iff **all** hold:

1. the method is `PATCH` or `POST` (never `DELETE`, never `PUT`);
2. the URL path matches `/v1/blocks/<32-hex-or-dashed-id>/children` — the append-children endpoint, which
   is the REST form of a log append. **Only this form**, for a reason given below;
3. **every** 32-hex id appearing anywhere in the command is exempt under §5.1 clause 1 (the hardcoded
   GEN-58 id or a valid line in the exemption file);
4. the command text carries no `archived`, `in_trash` or `allow_deleting_content`.

**Why the REST exemption is narrower than §5.1's, and why that is forced rather than chosen.** §5.1 exempts
four MCP content commands including `update_content` — an in-place edit of an existing block. Its REST
equivalent is `PATCH /v1/blocks/{block-id}` with no `/children`, and **the id in that URL is a block id, not
a page id**. The exemption list holds page ids, and mapping a block to its page needs a network call, which
this arm does not make on any path (§4.4). So an in-place block correction over REST cannot be recognised as
exempt locally, and it gates. Consequences, stated rather than left to be discovered:

- The **append** path — which is what a log write is, and the only form the standing immediate-and-pause-free
  rule covers — **is** exempt, because `/v1/blocks/{page-id}/children` carries the page id.
- A **correction** to an already-written log entry over REST is gated. Its escapes are the MCP tool
  (`update_content`, exempt under §5.1) or one `/vet-ticket` run. This was surfaced by a `/check` lens as a
  possible violation of that standing rule; it is not one, because the rule is about the log write being
  immediate, not about every later edit of it — but the asymmetry is real and belongs in the hook header so
  a future maintainer does not read it as an oversight.
- The same block-id-is-not-a-page-id fact constrains the **skill**, not just the hook: for a REST target
  addressing a block, `/vet-ticket`'s "not a ticket" and GEN-58 lanes must walk `GET /v1/blocks/{id}` →
  `parent` **until the parent is a page** — blocks nest, so this is a bounded loop rather than one hop; cap
  it, and treat exhaustion as "fall back to the full ticket review", which is the safe direction — before
  the page lookup those lanes already do. The skill is off the blocking path, so the network cost is free
  (§8).

**There is no housekeeping lane on this path**, deliberately. §4.2's closed shape reads a parsed object,
and a shell body may not be in the command text at all (see the binding below), so the lane cannot be
evaluated here without reconstructing it from text — which is the fragile-parsing direction this design
refuses everywhere else. The escape for a housekeeping-only REST edit is to make it through
`notion-update-page`, which has the lane, or to run one `/vet-ticket`. **Cost is an inference, not a
measurement:** Part 4 buckets by method and URL and never inspected request bodies, so how many of the 88
`PATCH /v1/pages` calls are housekeeping-only is unknown. If that friction shows up in practice, §10's
counter is what says so.

**Binding: the command text plus every body file it references.** This is the hole the §12.1 write-up
missed, and it is the whole point of the gate:

```
contentHash = sha256Hex(stableStringify({ shell: "<command string, verbatim>",
                                          bodies: ["<file contents, in reference order>"] }))
```

`notion-schema-guard.js`'s own header records that a shell write's body "may live in a temp file via
`--data-binary @file` the hook cannot read", and this project's `notion-howto` skill instructs exactly
that for quoting reasons — so **hashing the command alone would leave the ticket text unbound**, and a
record could authorise content no reviewer ever saw.

**The rule is therefore: the hash must cover the body, or the write is refused. There is no third
outcome** — and that is the fix for the one fail-open a `/check` lens found in v7's first draft, where a
body the extractor did not recognise silently degraded to command-only hashing. Concretely, for every
body-bearing flag in the command, classify its argument:

| flag | argument convention | hashed as |
|---|---|---|
| `-d`, `--data`, `--data-raw`, `--data-urlencode`, `--json`, `--data-binary` | `@<path>` → a file; anything else → a literal | file contents, or the literal text |
| `-T`, `--upload-file` (curl), `-InFile` (PowerShell) | **bare path, never `@`-prefixed** | file contents |
| `-Body` (PowerShell) | a literal quoted string, **or** `@<path>`, **or** anything else | literal text or file contents — *or refusal, see below* |

In every row, "a literal" means **no unescaped `$` or backtick outside a single-quoted span**, and a path
means a **literal** path — see the refusal rule below, which is what makes this table safe rather than
merely descriptive.

The per-flag split matters: a uniform "`@<path>` after a data flag" rule — which this section's first draft
stated — would never have recognised `-T body.json` or `-InFile body.json` at all, and would have hashed
those writes command-only. Second `/check` finding, same root cause as the first.

**Anything not classifiable is a hard block, reason `body-source-unrecognised`.** Two shapes force this,
one found in each `/check` round, and they are the same defect twice:

- **A parenthesised sub-expression.** `Invoke-RestMethod -Uri … -Method Post -Body (Get-Content -Raw
  ticket.json)` — no `@`, no `$`, and `scanChain` returns `NO-CHAIN` because there is no chaining and no
  `$(`/`${`, so nothing else would have caught it either.
- **An unexpanded variable inside an otherwise well-formed argument** — `-Body "$body"`, `-d "$TICKET_BODY"`,
  or `--data-binary "@$bodyFile"`. Round 2 caught this as a residual of the first fix: the argument *looks*
  like a literal string or an `@path`, so a classifier that stopped at shape would hash the **unexpanded
  text** while Notion received the interpolated value. `scanChain` does not help — it flags `$(` and `${`,
  never a bare `$name` (`auto-approve.js:413`–`461`).

**So the classifier's rule is about content, not just shape:** an argument qualifies only if it is a
single-quoted literal, a double-quoted literal containing no unescaped `$` or backtick, or `@` followed by a
literal path containing no `$` or backtick. Anything else — including `@` followed by a variable — is
`body-source-unrecognised`. The refusal text names the fix: **issue the gated write with the body file's
literal path** (`--data-binary "@C:/…/body.json"`), which is one substitution and deterministic.

**This does not conflict with the project's existing idiom, and the distinction matters.**
`scripts/notion-ticket-lookup.ps1:32` uses exactly `--data-binary "@$bodyFile"` — but that call is a
**read** (`POST …/query`, on the read allow-list), so this arm never sees it. The literal-path requirement
applies only to gated *writes*.

A referenced file that is missing or unreadable is likewise a hard block, reason
**`body-file-unreadable`**; files are read under a shared 2 MB cap, and exceeding it blocks too rather than
truncating.

**One safety clause, from a `/check` advisory.** The command text is hashed *and* shown to the reviewer,
whose transcript is persisted to disk — so a command with a bearer token inlined would put that token in a
transcript in plaintext. `/vet-ticket` refuses to proceed when the command text contains a literal Notion
token (`ntn_`/`secret_` prefix, or `Authorization: Bearer` followed by anything other than a variable
reference), directing the caller to the read-into-a-variable form this project already uses
(`scripts/notion-ticket-lookup.ps1:32`). This is a refusal in the skill, not the hook: the hook must not
depend on it, and a token in a command is not itself a gate-evasion.

**The normaliser is untouched, and that answers §12.1's charge against this option.** The stated cost of
covering REST was "the normaliser gains a second input shape, which cuts against §7.1's own argument that
keeping it small is the strongest defence against a residual normalisation bug". It does not gain one: the
JSON walker never sees shell text. The shell path assembles its own hash input in a few lines and shares
only `stableStringify` and the digest. `--ticket-hash` gains a second entry form
(`--ticket-hash-shell <command-file>`) so `/vet-ticket` still never reproduces the formula (§6.1).

**Chain guard, reused — with one deliberate divergence.** `enforceCheckDue` (`auto-approve.js:1381`–`1395`)
hard-blocks a chained command on a gated target, because a smuggled `&& <tail>` would ride the approval
sight-unseen; that ordering hole was found by a code-review panel, so the guard is precedent, not
invention. Same stance here: `CHAINED` → hard block, reason **`rest-chained`**. The divergence:
`enforceCheckDue` *returns* on `AMBIGUOUS`/multiline, which under `bypassPermissions` is a silent approve
(§2). This arm has no fall-through anywhere (§7 step 10), so an unparseable command is also a hard block,
reason **`rest-chain-unreadable`**. The escape for both is to issue the write as its own single call.

**`notion-schema-guard`'s shell arm stays where it is.** It emits `ask`, which is inert under
`bypassPermissions`, so it neither helps nor conflicts — and it is the only mechanism that would resume
working if a genuine prompt were ever restored (§14). Retiring it means editing a second locked file for
no behavioural gain. §12.1's Option C write-up called for retiring it; that was specific to C, where this
arm would have refused the traffic outright.

**What the arm costs.** The 236 raw write commands in the corpus become gated. Among them the destructive
ones are gated **for the first time** — under Option C they would have passed through as ungated as they are
today. Counts, attributed per script because the two detectors differ slightly, and **re-read from
`measurement-edit-targets.md` rather than restated** after a `/check` lens found the previous sentence
undercounting: `DELETE /v1/blocks` is **5** in Part 4a's table and **6** in Part 4's; `DELETE /v1/pages` is
**1** (Part 4 only); and the `/v1/databases` writes are **three**, not two — Part 4a lists `POST`/body
`/v1/databases` 2 **plus** `PATCH /v1/databases` 1, and the earlier "two" silently dropped the schema write.
Nothing operational turns on the count (§4.5's rule is that *every* detected write is in scope, so all of
them gate either way), but the destructive-write enumeration is cited elsewhere and must be right. No network
call and no subprocess: the command is already in hand, and the body files are one bounded local read.

**The residual, stated rather than glossed — and the reason it is not closed by widening further.** A
write whose URL never appears in the command text, because it lives inside a `.js`/`.ps1`/`.py` file the
command merely runs, is still invisible. Extending the match to "the script file this command runs
contains `api.notion.com`" would close it and **must not be adopted**: it cannot distinguish a read from a
write inside a script, and this machine's own `scripts/notion-ticket-lookup.ps1` performs Notion REST
reads on an ordinary ticket lookup — so that rule would gate a routine read every time a skill resolves a
GEN-id. That is the class of defect `review-findings.md` finding 10 flagged as "most likely to make the
installed gate unusable in daily work". So the honest guarantee after v7 is **every Notion write reachable
through the four MCP tools, or named in a shell command** — materially wider than v6.3's "through the MCP
tools", and not the same thing as "every write". Piece 2 owns the script-file case; §10 carries the
counter that says whether it is costing anything.

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

### 5.3 What maintains the volume-id list — one writer, reactive `[v7]`

The volumes roll over roughly every 25 entries, so the list changes. A PreToolUse hook cannot see a tool
response, and "Claude remembers to add the new id" is the exact omission failure this whole gate exists to
remove — so something has to maintain the file.

**The single writer is `/vet-ticket`'s GEN-58 lane** (§8 step 4). When a write to an unlisted volume is
blocked, that lane verifies the page's parent is the GEN-58 page over the network, appends the id, and
re-issues. It is autonomous — no interruption to Erez — and it needs Notion access, which costs nothing
real, because a Notion write is going to fail during an outage anyway.

**v6.3 also proposed a PostToolUse appender as the primary mechanism; v7 cuts it.** Its whole marginal
value was avoiding one self-resolving block per ~25 log entries, and it had to coexist with the reactive
lane regardless — because a volume created by `notion-duplicate-page` (async; its documented return says
not to rely on the new page) or by hand in the Notion UI produces no usable tool response. The price was a
second hook arm, a second writer to the same file, and its own concurrency property. Cutting it also
removes the disclosed over-reach a round-1 advisory extracted: the appender would have exempted *any* page
created under GEN-58, not only a verified rollover volume, because a payload parent is not proof of what
the page is. The reactive lane verifies parentage before appending, so it does not have that property.

Two facts that stand independent of which writer maintains the list:

- **Appends are `O_APPEND`, one id per line — never read-modify-write.** Two sessions run concurrently in
  this setup (there is a concurrent-session incident in this repo's own history), and a read-modify-write
  loses one session's entry silently.
- The create that makes a new volume is itself **free**: its parent page id is exempt, so §4.3's create
  row exempts it with no record. This closes finding 12, in which the rollover create was hard-blocked —
  the one write a standing rule requires to be immediate.

**What the cut costs, stated plainly:** the first write to a newly rolled-over volume is blocked once, and
the block resolves itself in the same turn through the lane above. That is the entire difference.

---

## 6. The review record

Directory: `~/.claude-staging/ticket-passes/` — distinct so ticket records can never cross-match the
sibling gates' passes. The location carries **no security property** (§2); it is there for
consistency and could move under `~/.claude/` without weakening anything.

```json
{ "kind": "ticket", "surface": "notion-mcp | notion-rest",
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

**The shell surface has its own hash input and the same single definition** `[v7]`. A raw REST/curl write
is hashed as `{shell, bodies}` per §4.5, not through the normaliser — the JSON walker never sees shell
text. `/vet-ticket` obtains it from the same file through `--ticket-hash-shell <command-file>`, so the
"one shared definition" property holds on both surfaces for the same reason: there is one implementation
and both callers invoke it. The record's `surface` field (`notion-mcp` | `notion-rest`) records which
input shape produced the hash; it is diagnostic and, like `target`, is never matched on.

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

#### Two ways to clear the gate, and no adjudicator anywhere `[v7]`

**The rule: the reviewer returned PASS on this exact content, or Erez waived it.** There is no third way,
and as of v7 there is no adjudicator role at all.

**Why the role is deleted rather than kept.** Three successive attempts to give an overturned finding a
path through the hook all failed review: v6 had no path, v6.1's token substitution did not compose with
multiple findings, and v6.2's "one live adjudication per hash" precondition was found unenforceable by two
independent round-3 lenses — it could only be checked inside `/vet-ticket`, the layer this section exists
not to trust. v6.3 then removed adjudication as a hook input but kept the role as a Claude-side process,
and that residue was itself never reviewed. A standing rule says that when a third fix becomes necessary,
stop patching and re-derive from scratch. **The re-derivation is that the role has no remaining function:**
v6.3's own answer for an overturned finding was "send the content to a fresh reviewer", and a fresh
reviewer is available without an adjudicator ever running.

**What replaces it, in one line:** the reviewer returns REVISE; Claude either fixes the finding, or — if it
believes the finding is wrong — sends the unchanged content to a **fresh `check-reviewer` with no prior
context**, at most once. If the fresh reviewer also raises it, the finding stands and must be fixed or
waived. That is one mechanism (re-review) instead of two (adjudicate, then re-review).

**This stays inside Erez's 2026-08-03 decision** rather than reversing it, and the difference is worth
stating precisely because it narrows it. He decided that a disagreement is settled **by another
independent review** — not by Claude overriding, and not by an automatic hard stop. A fresh reviewer on
the same content *is* another independent review, so the guarantee he asked for holds. What is lost is the
*focused* second opinion: the adjudicator was briefed on one specific finding, where a fresh reviewer sees
the whole ticket and may raise different findings instead. Two round-3 lenses had already argued that the
whole-content path is the sounder of the two, because a finding-scoped brief is what let a second finding
be silently dropped.

**What this deletes:** the `adjudication` record field, the adjudicator token and its verification, the
differing-agentId rule, the finding-count fallback, the per-ticket bound that nothing could count, §9 in
its entirety, the `adjudicated` event-log field and its `/wrap` line. The reviewer's token
(`TICKET-REVIEW-VERDICT: PASS <contentHash>`, assistant-authored, last occurrence) is the **only** token
the hook parses. The source-side prefix scan (§6.2) keeps covering `TICKET-ADJUDICATION:` as well, at no
cost, so a stale brief carrying the old prefix cannot become a channel.

**One record per ticket**, consumed by `unlink`. **Consumption must refuse unless it actually removed
a record whose hash matches** (finding 7): v2's implementation returned success without checking, so
one record could authorise a second write.

---

## 7. Enforcement flow

1. `configUnlocked()` → return (break-glass; shared accepted residual with the siblings).
2. **Pick the surface, or return** `[v7]`. One of the four MCP tools → the MCP path (step 3). A `Bash` or
   `PowerShell` call → the shell path (step 3s). Anything else → return.
3. **MCP path.** Compute scope: §4.1 → §4.2 → §4.3, no network. `out` → return, untouched.
   Order matters and is the fix for a round-3 advisory: **§4.2's housekeeping exemption runs first and
   returns `out` before the exemption file is opened at all**, so a housekeeping-only property edit can
   never be blocked by anything about that file. The sentence below is about the *remaining* traffic.
   **The exemption file is read here, and its cap is checked here** — a round-2 lens found that §5.1
   promised a distinct `exempt-list-overflow` block while no operative section wired it in, so it would
   have fallen into step 10's generic `internal-error` bucket and lost exactly the loud diagnosis the
   cap fix claimed. If the file has more than 4,096 valid ids, or cannot be read at all, this step
   hard-blocks with reason `exempt-list-overflow` (or `exempt-list-unreadable`) and does **not** fall
   through to the generic catch.
3s. **Shell path** `[v7]`. Run the §4.5 detector. Not a detected Notion write → return, untouched.
   Detected → run the chain guard (`rest-chained` / `rest-chain-unreadable`), then the §4.5 exemption
   shape; exempt → return. Otherwise compute the `{shell, bodies}` hash, hard-blocking on
   `body-source-unrecognised` (a body argument that is neither a literal nor a resolvable file path) or
   `body-file-unreadable` (missing, unreadable, or over the 2 MB cap), and continue at step 4 — every step from here on is shared with the MCP path,
   which is the point: **one record type, one verification, two ways in.**
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
one — **and, since v7, against a raw-REST command whose body is an `@file`, asserting that the hash the
`--ticket-hash-shell` CLI returns equals the one the arm computes at block time.** That equality is
currently a design assertion, not a measured fact (nothing is installed), and a `/check` lens was right to
flag it: two hash-assembly call sites exist even though the normaliser has one implementation, so the
round-trip is what proves they agree. Treat all three assertions as blocking for install. Residual: a normalisation bug on a payload shape
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

**What it reuses rather than rebuilds** `[v7]` — Erez's explicit ask, and each item is a mechanism already
running on this machine:

- **The reviewer is the existing `check-reviewer` agent type**, the same one `/check` spawns: read-only by
  definition, so a reviewer cannot edit the ticket it is judging.
- **One reviewer under one lens — the ticket bar — not a `/check` panel.** `/check` runs three lenses to
  convergence because it reviews designs; a ticket is not an architecture proposal, and Erez's decision 6
  asks for an independent reviewer, not a panel. This is the single biggest size difference between this
  skill and `/check`, and it is deliberate.
- **The evidence path is GEN-518's**, already in production in `/vet-rule` Step 4: sub-agent transcripts at
  `<session dir>/subagents/agent-<id>.jsonl` plus the `.meta.json` sidecar, with the session directory
  derived from `transcript_path`.
- **The record plumbing is the shared one**: `findPassInDir` (`auto-approve.js:577`) and `consumePassFile`
  (`:601`), which GEN-564 already factored out for exactly this reason. No fourth copy.
- **The REST detector is `notion-schema-guard`'s** (§4.5).

Both surfaces run the same seven steps below. For a raw REST write, "the drafted payload" in steps 2–3 is
the command string plus any body file it references, and the hash comes from `--ticket-hash-shell`.

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
   If the bar cannot be met because only Erez holds the missing information, STOP and consult him. If a
   finding is *disputed* rather than unfixable, send the **unchanged** content to one fresh
   `check-reviewer` (§6.2) — at most once — and never override the finding yourself.
6. **Evidence precondition, then write the record.** Verify: `reviewerAgentId` present; both
   `agent-<id>.jsonl` and `agent-<id>.meta.json` exist under this session's `subagents/` with
   `"agentType":"check-reviewer"`; the hash still equals step 3's; `verdict === 'PASS'` **or**
   `waived === true` — those are the only two, since adjudication is no longer a hook input (§6.2) — and
   the reviewer's own transcript carries `TICKET-REVIEW-VERDICT: PASS <hash>` under the assistant-role
   rule. The skill runs the same check the hook will run, so a mismatch surfaces here with context
   instead of as a bare refusal later. **If a fresh reviewer ran after a dispute, the record is that
   reviewer's** — whichever reviewer returned PASS on the exact content being written is the one named.
   Then write the record. The record write prompts nobody and **is not an approval step** — it
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

So: when the reviewer holds findings that cannot be fixed — and any that were *disputed* have already been
re-raised by a fresh reviewer, since a disputed finding gets its one re-review before a waive is proposed;
a finding that is simply unfixable needs no re-review first — `/vet-ticket` shows Erez the outstanding
findings in plain terms and asks. On his affirmative the record stores `waived: true` +
`waiveReason` + the outstanding findings. The hook is unchanged: a valid record is a valid record. The
waive is scoped to one write and never touches the global break-glass. It rests on **a single
explicit chat answer**, which must therefore be an unambiguous yes to a specific named finding, never
inferred from a general go-ahead.

---

## 9. Disagreement with the reviewer — **deleted in v7**

The adjudicator role that stood here is gone. The rule that replaces it is one line and lives in §6.2
("Two ways to clear the gate, and no adjudicator anywhere"): a disputed finding may go to **one fresh
`check-reviewer` on the unchanged content**, and if that reviewer raises it too, it stands. The section
number is kept as a stub only so the cross-references in §8 and §10 resolve; there is no mechanism here to
implement.

**Erez's 2026-08-03 decision is preserved, narrowed:** a disagreement is still settled by another
independent review, never by Claude overriding and never by an automatic hard stop. What is gone is the
finding-scoped brief. §6.2 states the trade-off and why two round-3 lenses independently preferred the
whole-content path.

**Honest limit, carried over unchanged:** this does not remove Erez from the loop; it makes his involvement
rare and well-justified. Anyone terminal must be a human. The claim is only that Claude is never terminal
in its own case.

---

## 10. Signals, and how each one reaches a decision-maker

Every mechanism below produces a signal for a later decision, so each names its reader, its form and
its bar. A signal with no surfacing path is not designed in.

**The event log.** `/vet-ticket` appends every gate event to
`~/.claude-staging/ticket-gate-events.jsonl` — `{ts, target, surface, source, verdict, reReviewed, waived,
notTicket, reason}` — and the hook appends every hard-block with its reason. **`source` records which
routine originated the write** (`interactive`, `wrap-step1`, `wrap-step3c`, or a named caller from §11); a
`/check` lens found that without it the unattended-`/wrap` decision below rests on a monitor that cannot see
the slice it is monitoring.

**How `source` is actually set — named here because a round-2 lens found the field specified with no writer,
which is this document's own worst recurring defect.** `/vet-ticket` takes an explicit `--source <tag>`
argument, defaulting to `interactive` when absent; the rewritten `/wrap` Steps 1 and 3c pass `wrap-step1` and
`wrap-step3c`, and every other caller §11's enumeration turns up passes its own tag. **The hook cannot tag
its own hard-block events** — a PreToolUse hook has no way to know which routine is running — so those
events record `source: "unknown"`, and the `/wrap`-slice counters below are computed from the **skill's**
events, which do carry the tag. That asymmetry is stated rather than left to be discovered when the counter
reads zero. Correct tagging is a blocking acceptance criterion on deliverable 10, on the same footing as
§7.1's hash-equality assertion. The complete reason set, **derived from §7 by walking every blocking step rather
than maintained separately**: `no-pass`, `bad-verdict`, `reviewer-unverified`, `no-token`, `bad-record`,
`transcript-too-large`, `consume-failed`, `unreadable-payload`, `bad-target`, `exempt-list-overflow`,
`exempt-list-unreadable`, `internal-error`, and from §4.5's shell path `rest-chained`,
`rest-chain-unreadable`, `body-source-unrecognised`, `body-file-unreadable`.
**`internal-error` is reserved for a genuine bug in the
arm and must never be inherited by a named condition**; §7 now carries each reason at its own step, which
is the only arrangement that keeps the two in sync. Two consecutive review rounds found this list
incomplete, both times because a block path was added somewhere else — hence deriving it from §7 rather
than curating it here. Without the log, a persistently broken gate is indistinguishable from a transient
one and shows up only as unexplained friction.

| signal | reaches Erez as | bar |
|---|---|---|
| a **waive** or a **decline** at the card | a line in that same turn's "📌 For you" block, per the skill's own instructions — never deferred to a later routine | — |
| waive rate | a `/wrap` line | above ~1 in 4 gated writes, the lane is firing too often — revisit scope |
| **re-review rate** (a finding disputed, then re-reviewed) | a `/wrap` line | above ~1 in 4 reviews, reviewer #1's brief is too strict — rewrite the brief, do not loosen the gate |
| **raw-REST blocks, by reason** `[v7]` | a `/wrap` line | `rest-chained` / `rest-chain-unreadable` / `body-source-unrecognised` / `body-file-unreadable` recurring across two windows means §4.5 is over-gating real work — narrow the shape, do not disable the arm. This is the monitor the arm is held to for the same reason §12.1 demanded one of every option |
| **`/wrap`-originated filings, as their own slice** `[v7]` | a `/wrap` line: count filed, count PASSed with no re-review, count waived | this is the only unattended lane (§12), so its numbers must be separable from interactive traffic rather than averaged into it. **Bar: any waive, or a PASS rate of 100% across a window with more than five filings, gets a line** — the first because a waive on an unattended filing had no human in the loop at all, the second because a reviewer that never finds anything on auto-filed tickets is the lenient-reviewer failure §14 admits nothing else detects |
| **raw-REST writes gated vs MCP writes gated** `[v7]` | a `/wrap` line | the coverage counter: if raw-REST gated writes stay near zero while §4.0.1 measured ~15% of traffic there, the detector has stopped matching and the widening in §4.5 needs re-checking |
| **"not a ticket" rate** — the drift counter | a `/wrap` line | above ~1 in 20 gated writes, the "every page is a ticket" premise has drifted and scoping needs revisiting |
| exemption-file contents | a `/wrap` line: entry count, and any ids added since the last report | two bars: every id should have been added by `/vet-ticket`'s GEN-58 lane after a verified parentage check, so an id with no such event in the log is worth a look; and **above 3,686 of 4,096 entries (90%)** something is appending non-volume ids — find the bug, do not trim the list (§5.1) |
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
| 4 | **The raw REST/curl arm, §4.5** `[v7]` | Erez's 2026-08-04 decision. Reuses the existing detector; adds ~15% of write traffic, and gates the destructive REST calls for the first time |
| 5 | `/vet-ticket` skill, rebuilt, with all three lanes | the checked-in draft still asserts the refuted premise, the deleted `targets[]` shape and raw-`tool_input` hashing; the non-ticket lane is what keeps over-gating off Erez |
| 6 | Verdict-token verification, assistant-role-scoped | without it a REVISE record clears the gate |
| 7 | The 14 surviving `FIX` defects + `CARRY` #7, §13 | fail-opens in code that survives |
| 8 | Test-oracle rebuild in `test-gen508.js` | the current sweep cannot detect the bug class it exists for; two tests assert nothing |
| 9 | Latency + no-subprocess assertions, §7.2 | these are what keep the arm in the class verified to block |
| 10 | `/wrap` Steps 1 and 3c rewritten via `/vet-rule` | otherwise the first `/wrap` after install hard-blocks with no consult path. **Blocking acceptance criterion** `[v7]`: both steps must pass `--source wrap-step1` / `--source wrap-step3c`, or §10's `/wrap`-slice monitor — the sole justification for leaving these filings unattended — reads zero and looks clean |
| 11 | Caller enumeration, widened per §11 | `/wrap` is one instance of a class |
| 12 | The `/wrap` signal lines, §10 | a signal with no reader is not designed in |
| 13 | Two global `CLAUDE.md` edits via `/check` then `/vet-rule` | the amendment resolves a live rule contradiction; the prose move pays for it — **with the acceptance criterion in §12.2, which is not optional** |
| 14 | Pieces 2 and 3 filed as sub-tickets | standing rule: a named follow-up is created, not referenced |

**Both of v6.3's open questions on this list are now closed** `[v7]`, and neither closure is a silent one:

- **The PostToolUse appender is CUT** (was deliverable 4). The reasoning and the exact cost are in §5.3:
  one self-resolving block per ~25 log entries, in exchange for deleting a hook arm, a second writer to the
  exemption file, and a concurrency property. The reactive lane it would have fronted has to exist anyway.
- **Deliverable 10's fork is resolved: the rewritten `/wrap` steps stay UNATTENDED** — no summary card at
  wrap time. A card there would reintroduce exactly the interruption this gate is meant not to add, and
  `/wrap`'s two filing steps carry an explicit standing override *so that* they run without stopping. **The
  cost, stated rather than assumed away:** the filings most likely to need a human eye — auto-filed,
  unattended, and two GEN-508 records of having gone wrong — get the independent reviewer and nothing else.
  §14's honest limit already says the reviewer's competence is unproven, and this is the place that limit
  bites hardest. **The monitor that watches this had to be built for it specifically:** a `/check` lens found
  that §10's aggregate rates could hide a problem confined to `/wrap`'s filings indefinitely, since they are
  a small slice of total traffic. So events now carry a `source` field and §10 has a `/wrap`-slice row with
  its own bars. If that row starts printing, revisit this choice rather than the gate.

**Deliberately not in piece 1:** the Jira arms; re-examining the three installed sibling gates' false
headers; and anything about a parent cache, which no longer exists. **A Notion write whose URL appears only
inside a script file** the command runs is also out — §4.5 states why widening the match to script contents
must not be done, and piece 2 owns it.

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
§14 says so outright: after v7 the real backstops are one optional re-review and "the reviewer brief's own
quality". §8
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

## 12.1 The scope decision — **DECIDED 2026-08-04** (comparison kept for the audit trail)

> **Erez's decision: cover raw REST/curl writes in piece 1** — "I prefer you cover it now" — with the
> simplest design that delivers it. **§4.5 is the only normative statement of that arm. Nothing in the
> comparison below is a specification**, and two of its claims about the chosen option are superseded
> there: the hash covers the command text **plus every referenced body file** (hashing the command alone
> would leave the ticket text unbound), and the normaliser gains **no** second input shape, which was the
> comparison's main charge against this option.
>
> Kept below because the measurements are still load-bearing (§4.5 cites them) and because the
> recommendation moved three times — A, then C, then B — and Erez chose against the standing
> recommendation. That is worth being able to re-read.

Surfaced by measurement during round 1 (§4.0.1). It was a scope trade-off with a real cost either way, so
it was Erez's rather than mine.

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

**What I would have done — recorded as it stood, and NOT what was chosen.** v6.1 recommended A, v6.2 C,
v6.3 B. **Erez chose A** (cover it now). Two of the three reasons v6.3 gave for B are answered by §4.5
rather than merely overruled: A's stated cost — a second normaliser input shape — does not materialise,
because shell text never reaches the JSON walker; and the availability objection was against C, not A, since
raw REST keeps working under A and merely needs a record. The reason that stands unanswered: **the sampling
of the 38 non-overlapping REST calls was never done**, so nobody knows how many of them exist *because* the
MCP tools could not express the operation. Under A that matters much less than it did under C — A does not
reroute anything, it only requires a review — but it is still unmeasured, and §10's over-gating counter is
what will surface it if it bites.

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

**What this means for the ticket's own wording**, stated rather than glossed: under the chosen option,
GEN-508 piece 1 delivers **every Notion create/edit reachable through the four MCP tools or named in a
shell command**. That is wider than "through the MCP tools" and is still not "every Notion create/edit" —
a write whose URL lives only inside a script file the command runs is invisible to it, and §4.5 explains
why closing that particular gap would gate routine reads. **Write that sentence into the ticket** rather
than leaving it to be discovered; §12.2 clause 4 holds the same requirement for the rule-coverage half.

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
  existed and could not have seen anything if it had. After v7 deleted the adjudicator, the real
  backstops are **one optional re-review by a fresh reviewer and the reviewer brief's own quality** — and
  **if reviewer #1 is systematically lenient, nothing in this design detects it.** The `/wrap` aggregate
  counts are the only early warning. This limit bites hardest on `/wrap`'s unattended filings, per §12's
  resolution of deliverable 10.
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
- **Coverage after v7, in one sentence, because the ticket's title says "every"** `[v7]`: every Notion
  create/edit reachable through the four MCP write tools **or named in a shell command**. A write whose URL
  appears only inside a script file the command runs is not covered, and §4.5 records why the obvious
  widening must not be adopted (it would gate routine Notion *reads* performed by an existing script). The
  rule-coverage half of "every" is §12.2's, and it is a separate claim with its own acceptance criteria.
- **Piece 1 is large.** Fourteen deliverable rows (§12), three of which are rule or skill edits needing
  Erez's confirmation. v7 swapped one row and deleted two mechanisms from inside others; it did not make this
  small, and the row count is unchanged. Splitting the install is a live
  option two of three round-3 reviewers recommended; the natural seam is hook + skill first, with the
  `/wrap` and `CLAUDE.md` edits as a second change — except that §11 makes the `/wrap` fix a ship blocker,
  so the seam is narrower than it looks.

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
- **Round 3 on v6.2 (the cap, run on Opus): REVISE from all three lenses.** The soundness lens confirmed
  its round-2 finding RESOLVED and the holistic lens confirmed all three of its round-2 findings RESOLVED,
  but the pre-mortem tagged its round-2 finding **RECURRENCE** and four new material findings arrived
  across the three. **This is an escalation, not convergence** — both the round cap and the
  twice-attempted-finding trigger fired.
- **v6.3 was a post-cap revision reviewed by no one.** Its central change — deleting the adjudication
  substitution mechanism in favour of a fresh reviewer — was a from-scratch re-derivation made because a
  standing rule forbids patching the same mechanism a fourth time.
- **v7 (2026-08-04) is Erez's scope decision plus three cuts, and it retires v6.3's unreviewed residue** by
  deleting the adjudicator role outright rather than keeping a Claude-side process nobody had reviewed.
  The four v6.3 findings stay fixed; §4.5 is new; the appender and the summary-card-at-`/wrap` fork are
  closed by cut and by choice respectively. **The cut of the adjudicator role is the fourth touch of that
  mechanism**, and the standing rule about a third fix is why it is a deletion rather than another
  revision: the role's last remaining function was already available without it.

**The pattern across all three rounds, since it is the most useful thing here.** Every round's worst
finding was the same shape: **a rule stated correctly in one place with no realised path through the place
that enforces it.** Rounds 1–2 found it across two documents; merging them removed the worst instance but
not the class. Round 3 found it twice *within* one document — a block reason promised in §5.1 and absent
from §7/§10, and an adjudication precondition stated in §9 and uncheckable by the hook. The lesson that
survives: **when writing a guarantee, name the layer that will evaluate it, and check that the layer can
see what it needs.** For a guard, a guarantee the enforcing layer cannot evaluate is documentation wearing
a mechanism's vocabulary.

Also corrected in v6.2, and worth naming because it is the same failure family as everything above:
**a promised block reason existed in one section with no path through the sections that drive enforcement
and observability.** That is the third variant of "stated correctly in one place, absent where it is
implemented" in this design's history — the first two were across two documents, this one was within a
single document, which is a reminder that merging the documents removed the *worst* instance of the class,
not the class.

**Provenance of the companion document.** `design-scoping-v3.md` is retired as a normative source but
kept: its §1 corpus-shape table and §3 measurements are cited above and are the evidence base for the
normalisation design. Its algorithm sections are superseded by §4 and §5 of this document.
