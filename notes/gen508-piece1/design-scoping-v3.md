# GEN-508 piece 1 — scoping layer v3 (the rebuild)

**Revision state:** round-1 `/check` panel returned 8 material findings across three lenses
(pre-mortem `a98bfab58cf88836c`, holistic `a1d4b5af92413bb9c`, soundness `a7da3dab978482904`). All
eight are resolved in the text below; §7 lists each with its resolution and the evidence used, for
the re-review.

**What this is.** The replacement for the "is this call a Team-Tasks ticket write?" layer in
`auto-approve.js`'s `enforceTicketVetting` arm. It supersedes four sections of
[`design-converged.md`](design-converged.md) — "Scoping — which calls are in scope", "Evaluation
order", "Resolution", and "Carve-out — GEN-58" — plus the pass-matching rule under "Pass shape and
binding" (§5 below), **and step 5 of "Enforcement flow"**, which says an internal scoping error
should "return (fall through to a prompt)". Under `defaultMode: "auto"` a bare return is a silent
approve, which contradicts this document's `ok = false` ⇒ hard-block rule; a scoping throw must
block, as the working copy already does. Everything else there — the `/vet-ticket` flow, the
summary-card approval, the waive lane, the unresolved-page hard-block stance, the batch-pass shape —
is unchanged and still governs.

**Why a rebuild rather than five patches.** Two consecutive code-review rounds each found a fresh
silent bypass of the same class: the layer read *specific field paths* taken from the published tool
schema, and real traffic does not always put the fields there. Erez's call (2026-08-02) was to make
payload shape stop mattering, rather than patch the shapes we happened to have seen.

---

## 1. The evidence base — and why the old one was too thin

The previous build was reviewed against `~/.claude/hooks/credential-denials.jsonl`. Two facts about
that corpus, both measured this session:

- **It truncates.** Its writer `~/.claude/hooks/permission-denied-log.js` caps `tool_input` at
  `MAX = 500` chars and appends `'...[truncated]'`, giving the 514-char ceiling seen in the data
  (168 of 189 string captures are exactly 514; none is longer). It is a *prefix* corpus: enough to
  prove a shape exists, useless past the first few hundred bytes.
- **It is small and stale.** 311 lines, last written 2026-07-30, ~60 of them Notion.

`deferred-calls.jsonl` carries **no payload at all** — only `{ts, tool, command, cwd, session}`. It
can tell you which commands occur, nothing about their shape. (Its line count grows continuously;
nothing here rests on it.)

**The real corpus is the session transcripts.** `~/.claude/projects/**/*.jsonl` — 1,755 files,
502 MB — record every `tool_use` block *complete and untruncated*. Extracted this session:
**1,313 unique payloads** for the four Notion write tools (1,043 `notion-update-page`, 269
`notion-create-pages`, 1 `notion-move-pages`, 0 `notion-duplicate-page`).

Extractor and corpus: `scratchpad/build-corpus.js` → `notion-payload-corpus.jsonl` (regenerate
rather than commit; it contains ticket bodies).

### What the complete corpus shows that the truncated one did not

| Shape | Count | Old layer's verdict |
|---|---|---|
| `{command, page_id, properties}` and friends — the documented shape | ~1,280 | correct |
| `{data: "<whole payload re-serialised as a JSON string>"}` | **13** | silently approved |
| create with `parent` nested in `pages[0]`, no top-level `parent` | **3** | silently approved |
| create with **no parent anywhere** (workspace-level page) | 1 | approved (correct) |
| `{__unparsedToolInput: {raw: "<truncated JSON>", len: N}}` | **3** | silently approved |
| parent as `{data_source_url: "collection://bd2cd17b-…"}` | 3 | silently approved |
| parent as `{database_id: "collection://bd2cd17b-…"}` | 1 | silently approved |
| parent as `{page_id: "placeholder"}` (a literal placeholder string) | 1 | approved |
| `page_id` given as a full `https://app.notion.com/p/<id>` URL | 5 | blocked as unparsable |
| `page_id` given as a **truncated** uuid (`3806e495-d07c-81b3-8e37-e21aded65`) | 1 | blocked as unparsable |
| inner payload keyed `pageId` (camelCase), **no `command` at all** | 1 | silently approved |
| inner payload as `{pages:[{id, properties, content:{type,edits[]}}]}` — a different schema entirely | 1 | silently approved |
| commands: `update_properties` 405, `insert_content` 346, `update_content` 274, `replace_content` 10, `apply_template` 3, `insert_content_after` 2, absent 2, `insert_content_before` 1 | 1,043 | — |

Three of these (`__unparsedToolInput`, `data_source_url`, the alternate inner schema) are **new** —
not among the five findings the ticket carries. Same class, found only because the corpus got
better. That is the argument for the rebuild in one line: the old layer's correctness was a function
of how many payload shapes we had happened to look at.

Two incidental confirmations: `notion-move-pages` really is `{page_or_database_ids: [...],
new_parent: {...}}` (finding 2 flagged those names as unverified guesses), and the single captured
move is `new_parent: {type: "workspace"}` — a **move-out**, the property-dropping case.

### The tool surface, enumerated rather than assumed

The arm dispatches on four tool names. That set is now justified per tool rather than inherited.
The Notion MCP connector exposes **ten** mutating tools (read from this session's live tool list):

| Tool | In piece 1? | Why |
|---|---|---|
| `notion-create-pages` | **gated** | files a ticket row |
| `notion-update-page` | **gated** | edits a ticket's body or properties |
| `notion-duplicate-page` | **gated** | a duplicate of a ticket row *is* a live ticket row |
| `notion-move-pages` | **gated** | move-in files a row; move-out de-lists one and drops every property |
| `notion-update-data-source` | scoped out | **schema only** — its `statements` grammar is `ADD/DROP/RENAME/ALTER COLUMN` plus `title`/`description`/`in_trash`/`is_inline` (live tool schema, read this session). It cannot write a row's values, so it is not a ticket create/edit. Its destructive subset is already `ask`-gated by `notion-schema-guard.js:220-225`; a non-destructive `ADD COLUMN` on Team-Tasks is gated by neither — **named residual**, and it fails safe here (a renamed property drops out of the housekeeping deny-list and becomes substance, i.e. more gating). |
| `notion-create-comment` | scoped out | adds a comment thread to a page; touches neither the ticket body nor its properties, so the ticket bar has nothing to check |
| `notion-create-database` | scoped out | creates a container, not a row |
| `notion-create-view` / `notion-update-view` | scoped out | change how rows are displayed, not their content |
| `notion-create-attachment` | scoped out | attaches a file; not body or property substance |

So the four gated tools are the complete set that can create or materially change a Team-Tasks
**row**, and the six others are scoped out with a stated reason rather than left unnoticed.

---

## 2. The v3 scoping algorithm

Four stages. No stage reads a field path that must be where the schema says it is.

### Stage 1 — normalise (shape stops mattering here)

`ticketNormalise(tool_input)` → `{ok, root, strings, idish}`.

Walk the payload depth-first under a budget. At every node:
- a **string that parses to an object or array** is replaced by the parse and walked (this unwraps
  `{data: "…"}`, `__unparsedToolInput.raw`, and any future wrapper, at any depth, any nesting);
- every string encountered — parsed or not, key or value — is collected into `strings`;
- every string value reached under a key whose name contains `id` (case-insensitive) is also
  recorded in `idish`, tagged with that key name;
- objects and arrays are recursed.

**Envelope hoisting — and why the hash depends on it.** The walk above substitutes *in place*, so a
top-level `{data: "<json>"}` becomes `{data: {…}}` — the wrapper key survives, and the enveloped and
plain forms of the same call do **not** produce the same tree. Scoping does not care (stage 3 and
stage 4 read the whole tree either way), but the pass hash in §5 does. So after the walk, while the
root is an object with **exactly one key** and that key is a known envelope name — `data`, `raw`,
`input`, `arguments`, `__unparsedToolInput` — its value replaces the root. Repeat, bounded by the
same 8-unwrap budget. `root` below always means the hoisted root.

This one list *is* a list of known names. The invariant that makes it safe — and the one a
maintainer must re-check before ever adding a name — is: **the hoist can only ever discard a sole
root key, and no name on the list is a field of any gated tool's schema** (verified against the four
live schemas and all 1,313 corpus payloads: `data` and `raw` occur only as envelopes, `input` and
`arguments` never occur at all). Failing to hoist an unknown future wrapper is the safe direction —
it is still walked, so the marker scan and the id scan see through it as before, and the only cost is
a pass that no longer matches, which blocks and asks for a re-mint. Hoisting something that is *not*
a wrapper is the unsafe direction, because stage 2 reads the hoisted root, and that is what the
invariant above rules out. (Round 3 corrected an earlier, weaker claim here that "nothing about scope
depends on it" — stage 2 is a scope decision and does read the hoisted root.)

`__unparsedToolInput` is on the list for uniformity only: it hoists to `{raw, len}`, which has two
keys and so never reaches the plain form. It buys no hash parity, and all three corpus instances are
`ok = false` regardless.

Budget: **12 depth, 4,000 nodes, 2 MB of total string, 8 unwrap levels on any one path**, and a
**2-second CPU deadline** covering stages 1–3 (the pure-CPU stages). Exceeding any budget sets
`ok = false`.

`ok = false` also when: the input is neither object, array, nor string; an `__unparsedToolInput.len`
exceeds its `raw.length` (proof the harness truncated the payload — true in all 3 captured cases);
or **a string in a wrapper position fails to parse** — meaning the whole `tool_input` itself, or a
value under `data` / `raw` / `input` / `arguments`. A failed parse anywhere *else* is not evidence of
anything: it is just text. Round 3 caught the earlier "any string whose first non-space char is `{`
or `[` must parse" rule doing real damage — five corpus payloads carry ordinary content strings
beginning with a markdown link or a bracketed tag (`"[Vol. 3](https://…)"`,
`"[D recurrence · scope-mis-assignment] 2026-07-15"`), two of them GEN-58 log writes, and that rule
would have hard-blocked every one of them with break-glass as the only escape.

**`ok = false` is a hard block.** We could not see the whole payload, so we cannot claim it is out
of scope. This is the fail-closed anchor the rest of the design hangs on: every later stage is
allowed to conclude "out of scope" *only* because stage 1 guarantees it saw everything.

**Implementation constraints, stated because they are security properties, not style:**
- The traversal **reads** only. Nothing derived from the payload is ever used as a key written into
  a plain object — payload-keyed collections are `Set`/`Map`. `JSON.parse` makes `__proto__` an own
  property rather than polluting `Object.prototype`, but a later `obj[k] = v` on a plain object
  would; there is no such assignment.
- Every regex used on payload text is **fixed-width and non-backtracking** (`/[0-9a-f]{32}/g` on a
  dash-stripped copy; `/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g`). No
  alternation-with-repetition, no nested quantifiers, so no catastrophic backtracking. The 2 MB
  string cap plus the 2 s CPU deadline bound the scan regardless.

### Stage 2 — the housekeeping exemption (closed-shape, no network)

The one path that lets a Team-Tasks write through without a pass, so it is written as a **closed
shape**: the payload is exempt only if it matches this exactly, and *anything* unrecognised gates.

Exempt iff **all** hold on the normalised, **hoisted** root `R` (hoisting matters here too: without
it a `{data: "…"}`-wrapped pure-`Status` edit — 10 real instances in the corpus — would fail clause 1
on the surviving `data` key and pay a resolver call and a mint for nothing):
1. `R` is a plain object and **every key of `R`** is one of `page_id`, `pageId`, `id`, `command`,
   `properties`. (An unknown key anywhere at the root — including one we have never seen — fails.)
2. `R.command`, if present, is exactly `update_properties`.
3. `R.properties` is a plain object, and every key of it, after stripping a leading
   `date:` / `place:` / `userDefined:` qualifier and a trailing `:start` / `:end` / `:is_datetime`
   etc., is in the housekeeping deny-list: `Status`, `Assignee`, `Project`, `Type`, `Reason`,
   `Due Date`, `Remind me (days before)`, `Date Created`, `ID`, `Parent item`.
4. Every value inside `R.properties` is a primitive, `null`, or an array of primitives/`null`. No
   nested object — which is what a content structure looks like. (`null` counts as primitive: the
   corpus contains real housekeeping edits that clear a relation with `"Assignee": null` /
   `"Parent item": null`, and a naive `typeof v !== 'object'` test would exclude them, since
   `typeof null === 'object'`.)

This replaces v3-round-1's "no content-bearing key appears anywhere", which the pre-mortem lens
correctly identified as the same allow-list-of-known-names anti-pattern the rebuild exists to
delete, merely relocated. A closed shape needs no list of dangerous names. The captured
`{pages:[{id, properties:{Status}, content:{…edits}}]}` payload fails clause 1 (root key `pages`)
and is gated, as it must be.

The `update_verification` exemption from `design-converged.md` is **dropped**: zero occurrences in
1,313 payloads, so it is exempt surface with no traffic behind it.

Stage 2 runs **before** any resolution, so a housekeeping status change can never be blocked by a
Notion outage — the round-2 finding from the previous build, still honoured.

### Stage 3 — marker scan (free, no network)

Search every collected string for a **Team-Tasks marker**: the data-source id
`bd2cd17b-f58f-4993-8b95-468e881272fa` or the database id
`fe198002-6618-48d7-ae04-56f8cee479f3`, dash- and case-insensitively, anywhere in the string. A hit
⇒ **in scope**, with no network call.

This one stage covers every create shape in the corpus — top-level `parent`, nested `parent`,
`data_source_url`, `collection://`-prefixed, and the truncated `__unparsedToolInput` whose marker
survives inside unparseable raw text. It is the direct expression of Erez's instruction: look for
the marker in the whole payload rather than at a field path.

### Stage 4 — resolve the remaining ids (network, bounded)

From `idish` (stage 1), extract every 32-hex id, dashed or bare, including inside a URL. Body text,
`new_str`, and property values such as `Parent item` are **not** collected — their keys contain no
`id` — so mentioning a ticket in prose can never make an unrelated page a ticket.

Split by key name:
- **Container-ish keys** (`data_source_id`, `database_id`, `data_source_url`, `collection_id`): the
  value names a container, not a page. Compared locally against the marker set; never resolved. If
  it were Team-Tasks, stage 3 already fired.
- **Everything else** (`page_id`, `pageId`, `id`, `page_or_database_ids`, `template_id`, …): a
  candidate page, resolved.

`classifyNotionId(id)` → `'team-tasks' | 'other' | 'unknown'`, via `GET /v1/pages/{id}` with the
Credential-Manager token, capturing the HTTP status:
- **`200`** → parent is a Team-Tasks id ? `team-tasks` : `other`.
- **Anything else** — 401, 403, **404**, 429, 5xx, network error, non-JSON, timeout → `unknown`.

Round-1 carried a `404 ⇒ other` rule, justified by "the integration can read the Team-Tasks
database, so a row in it is never a 404". Both review lenses rejected it and they were right: a
Notion 404 also covers *no access to this specific page* and *archived/trashed*, so a single
per-page 404 would silently reclassify a real ticket as out-of-scope, on the highest-volume path
(edits are 1,043 of 1,313 payloads). It is dropped. The reason it was tempting — that an ordinary
create in another database would otherwise hard-block — no longer applies, because container ids
are never resolved as pages, and an edit to a non-ticket page the integration *can* read returns
`200` with a non-Team-Tasks parent. A genuine 404 means the page is unreadable or archived, in
which case the MCP write itself would fail; blocking it costs a call that was going to fail anyway.

**Verdict:**
- any `team-tasks` ⇒ **in scope**;
- else any `unknown` ⇒ **in scope, unresolved** ⇒ hard-block (Erez's standing call);
- else ⇒ out of scope, return without touching the write.

**Zero ids is not one case but two** (soundness lens; the current working copy already gets this
right and round 1 regressed it):
- **No id-ish key exists anywhere** in the tree — for `notion-create-pages` this is the parentless
  workspace-level create the corpus contains, and it is genuinely out of scope. For the other three
  tools a target is structurally mandatory, so its absence means we misread the payload ⇒ **block**.
- **An id-ish key exists but yields no valid 32-hex** (`page_id: "placeholder"`, the truncated uuid,
  both real in the corpus) ⇒ **block**, for all four tools. A malformed target is not evidence of
  harmlessness.

**Cost bounds (closes finding 3).** One shared wall-clock deadline of **20 s** for all resolution in
a call; per-subprocess timeout **5 s**; the Credential-Manager token fetched **once per process**
and memoised; each id resolved at most once per process; at most **8** ids resolved per call.
Deadline or cap exhausted ⇒ remaining ids are `unknown` ⇒ block. Worst case sits well inside the
hook's 60 s default timeout, so the arm can no longer be killed mid-flight — which under
`defaultMode: "auto"` would be a silent approve. The deadline is a single monotonic budget checked
before each subprocess, not eight independent 5 s timers.

On-disk cache stays **positives-only** (`design-converged.md` decision 8, unchanged).

---

## 3. The other four findings

**Finding 2 — move arm fails open on a missing or scalar `page_or_database_ids`.** Dissolved rather
than patched: v3 never reads that field. A move goes through the same four stages — marker in
`new_parent` ⇒ in scope; otherwise every id-ish value is classified, and a Team-Tasks row among them
⇒ in scope (the move-**out** case, which the captured `{type: "workspace"}` call proves is real).
A payload we cannot read fails stage 1; a malformed id blocks under the rule above.

**Finding 4 — batch-pass consumption is a non-atomic read-modify-write.** Fixed by
**claim-by-rename**: `renameSync(pass, pass + '.claim.<pid>.<n>')` first — atomic, so exactly one
process can win — then rewrite the surviving entries to a temp file and `renameSync` it back to the
original name, or rename the claim to `*.consumed.<ts>` when the last entry goes. A lost race means
the file vanished from under us, so the arm **re-scans the pass dir (up to 3 attempts, 50 ms apart)
before concluding no-pass** — without the retry, one target of a batch Erez already approved could
be spuriously blocked while another process is mid-rewrite (holistic + pre-mortem advisory). Still
fail-closed: retries exhausted ⇒ block.

**Finding 5 — the GEN-58 carve-out.** Both the ticket's diagnosis and round 1's evidence for it were
wrong, in opposite directions. Measured on the full corpus (159 writes whose *target page* is GEN-58
`36d6e495d07c816e9e0cce265d694ab3`):

| | count |
|---|---|
| `update_content` | 150 |
| `insert_content` | 8 |
| `update_properties` | 1 |
| of the 148 carrying `old_str`/`new_str` pairs: `new_str` starts with `old_str` | 16 |
| … does not | 132 |

So: the ticket's "the carve-out never fires in practice" is **false** — the current command-name
rule exempts the 8 `insert_content` appends. Round 1's "all three captured writes are counter bumps,
so a prefix rule blocks every real write" is **also false** — it was measured on the 3 writes in the
truncated log rather than the 159 in the corpus, the exact mistake this document accuses the old
build of. Corrected finding: **the carve-out fires for new-entry appends and misses the
counter-bump edits that accompany them** — the current rule covers 8 of 159 writes (5%), and the
ticket's proposed `old_str`-is-a-prefix-of-`new_str` rule would cover at most 24 (15%). Both leave
the standing rule that mandates immediate, pause-free GEN-58 writes colliding with a hard block
whose only escape is the global break-glass.

Root cause of both attempts: the carve-out was written against what a "log append" *ought* to look
like. The protocol on GEN-58 does two things — append a write-up, and bump the counters that index
it — and the same standing rule mandates both.

**Where the log actually lives — checked live 2026-08-03, and it changes what the carve-out must
cover.** The 159 writes above are historical. Today the write-ups sit on **child pages** of GEN-58
that roll over every ~25 entries (currently "Vol. 6", `3b06e495-d07c-8114-be75-cd8a65d7fc30`); its
ancestor path is `parent-page → GEN-58 → Team-Tasks`, i.e. its direct parent is the GEN-58 *page*,
not the data source. Two consequences:

- **A volume page is not a Team-Tasks row**, so stage 4 classifies it `other` and it is out of scope
  already — no carve-out needed, and none of the gate's protection ever applied to it. Any statement
  that this gate protects "the log" would be false.
- **The marker scan can still catch a volume write by accident**: a write-up that quotes the
  Team-Tasks data-source id in its text — entirely plausible for a write-up about *this* ticket —
  hits stage 3 and gets gated, colliding with the standing rule that mandates the write be immediate.

So the carve-out must be keyed on the **GEN-58 subtree**, not one hardcoded id: the GEN-58 ticket
page, plus any page whose parent is that page. A volume's parentage is resolved once and cached as a
positive, so only the first write after a rollover pays a round-trip. Residual, stated: a cold cache
during a Notion outage blocks a log write, whose escape is one `/vet-ticket` mint (no Notion access
needed), not break-glass. Hardcoding the volume ids instead was rejected — they change every ~25
entries, and a stale id is a silently dead carve-out.

**Proposed rule: exempt every content-bearing write within the GEN-58 subtree; keep property edits
on the GEN-58 ticket row itself gated normally.** Justification, not convenience: GEN-58 is a log,
and the bar this gate enforces ("the body stands on its own", "the priority fields are derived") is
a *ticket* bar that does not apply to a log body. Its row properties are still ticket properties, so
a substance-property edit on GEN-58 still goes through the gate. Erez's call — §6.

**Finding 1 — create arm fails open on a nested parent / the `data` envelope.** Dissolved by stages
1–3 plus the two-case zero-ids rule.

---

## 4. What v3 costs

- Create into Team-Tasks: **0** network calls (marker hit).
- Property or body edit on a ticket: **1** page fetch; cached positive for 30 days after.
- Housekeeping-only property edit: **0** — exempt before resolution.
- Create elsewhere in Notion: **0** — the parent is a container id, compared locally.
- Edit elsewhere in Notion: **1** fetch returning `200` with a non-Team-Tasks parent.
- Stages 1–3 are pure CPU on a payload measured in kilobytes, under a 2 s deadline.

---

## 5. One change to pass matching (supersedes part of `design-converged.md`)

`design-converged.md` binds a pass on **target + contentHash**, where the hook derives the target
string. v3 rebuilds target derivation, so `/vet-ticket` would have to reproduce the new scan
exactly or every pass would fail to match — the soundness lens flagged this, and
`design-converged.md` itself names that failure mode as the one whose only escape is break-glass.

Two changes remove the problem rather than document it:

1. **Match on `contentHash` alone**, within the ticket-pass dir, with `kind: "ticket"`. One tool call
   is one payload is one hash, so the hash already identifies the write exactly; the target string
   becomes a human-readable label carried for the block message and the audit log, not part of
   matching. This also deletes the "two targets claiming one pass" bookkeeping and its `exclude`
   list.
2. **Hash the NORMALISED, HOISTED payload, not the raw `tool_input`** —
   `sha256Hex(stableStringify(normalise(tool_input).root))`. The corpus shows the same semantic call
   serialised both plainly and inside a `{data: "…"}` envelope; a raw hash minted from the drafted
   object would then fail to match the call as actually emitted, systematically, with break-glass as
   the only way out. The **hoist** step in stage 1 is what makes the two forms produce the same tree
   and therefore the same hash — without it, unwrapping alone leaves `{data: {…}}` ≠ `{…}` and this
   change would not deliver what it promises.

**Two build-time sync obligations this creates, named rather than assumed:**
- `vet-ticket-SKILL.md` Step 4 as checked in today hashes the **raw** `tool_input`, with no
  normalisation. That is a live disagreement with the hook-side formula above, and it would bite on
  exactly the odd-shaped calls this rebuild targets. The skill must call the same shared
  `ticketNormalise` + `stableStringify` definition, cited from the hook header. `/vet-code` Step 4's
  mandatory mint → block-without-pass → approve-and-consume round-trip is the test that catches any
  residual drift; it must be run against an enveloped payload, not only a plain one.
- `design-converged.md`'s batch pass carries `targets: [{target, contentHash}, …]`. With
  content-addressed matching, the arm matches the **entry whose `contentHash` equals this call's
  hash** and consumes that entry; `target` remains as the label shown on the card and in the log.
- `/vet-ticket` must also define what it does when the shared `ticketNormalise` returns
  `ok === false` on the payload it is about to mint for: it cannot mint a hash it could not compute,
  so it stops and says the payload could not be read — the same answer the hook gives, reached before
  Erez is shown a card.

Residual: a payload that differs *semantically* between mint and call (`pageId` vs `page_id`, a
reworded body) still misses, correctly — that is the hash doing its job. To keep that diagnosable
rather than mysterious, when no pass matches the hash **but a pass in the dir carries an overlapping
target id**, the block message says so explicitly: a pass exists for this ticket, the payload
changed, re-mint. Every hard-block still appends its reason to
`~/.claude-staging/ticket-gate-events.jsonl` (`no-pass`, `unresolved`, `scope-error`) — that logging
lives in `enforceTicketVetting`, which v3 does not replace.

---

## 6. Decisions this needs from Erez

1. **The GEN-58 carve-out shape** (§3, finding 5) — exempt all content writes in the GEN-58 subtree,
   versus a third attempt at characterising "append". Recommendation: exempt them. Two semantic
   rules have now been falsified against real traffic (5% and 15% coverage of 159 real writes), the
   pages are a log rather than a ticket, and the cost of getting it wrong is a hard block on a write
   a standing rule mandates be immediate. **This gate cannot be the thing that keeps the log
   intact** — the volumes holding the actual write-ups are not Team-Tasks rows and were never in its
   scope. That protection belongs to
   [GEN-453](https://app.notion.com/p/39e6e495d07c819b9d51ff4428e65e43) (verify-after-write for
   Notion body edits), whose two recorded incidents are both GEN-58 writes that silently did not do
   what they claimed.
2. Nothing else. Everything in `design-converged.md` that Erez already settled stands, except the
   pass-matching change in §5, which is a mechanical consequence of the rebuild rather than a new
   choice.

---

## 7. Round-1 `/check` findings and their resolution

| # | Lens | Finding | Resolution |
|---|---|---|---|
| 1 | pre-mortem | Only 4 of the Notion write tools are dispatched on; the rest are an unnoticed hole | §1 "The tool surface": all 10 enumerated from the live schema, 4 gated, 6 scoped out with a per-tool reason. `notion-update-data-source` verified schema-only (cannot write row values); its non-destructive subset named as a residual |
| 2 | pre-mortem, holistic | `404 ⇒ other` is an unmonitored silent gate-disable, and §6's claim that it would be visible at `/wrap` is false (nothing logs that verdict; the `/wrap` reader is deferred to piece 3) | Rule **dropped**. 404 joins `unknown ⇒ block`. The false monitoring claim is gone with it, not reworded |
| 3 | pre-mortem | CPU/ReDoS cost of the scans unbounded while the network path got a budget | §2 stage 1: 2 s CPU deadline over stages 1–3, fixed-width non-backtracking regexes named explicitly, 2 MB string cap |
| 4 | pre-mortem | "No content-bearing key anywhere" is an allow-list of known-bad names — the anti-pattern being deleted, relocated | §2 stage 2 rewritten as a **closed shape**: root keys must be a subset of five, property values must be primitives. `update_verification` exemption dropped (0 traffic) |
| 5 | soundness | "Zero structural ids ⇒ out of scope" conflates *no target field* with *malformed target field*; the current working copy already blocks the latter | §2 stage 4: split into two cases; malformed ⇒ block for all four tools; absent ⇒ out of scope for create only |
| 6 | soundness | The 404 premise is unsound (404 also means no-access / archived) | Same as #2 — rule dropped |
| 7 | soundness | Finding 5's evidence was drawn from the 3 writes in the truncated log, not the 159 in the corpus; "blocks every real GEN-58 write" is false | §3 finding 5 re-measured on the full corpus and rewritten; the ticket's claim and round 1's claim are both corrected. Recommendation unchanged, now on real numbers |
| 8 | soundness | Nothing says how `/vet-ticket` reproduces the new target derivation; and a raw-payload hash can miss when the same call serialises differently | New §5: match on `contentHash` alone; hash the normalised payload |

**Round 2** (pre-mortem `a3d91fb411d28924f` PASS, holistic `abf6cf6cbfedc19e2` PASS, soundness
`ae5bfecae1ab9daf3` REVISE) raised one new finding, introduced by round 1's own revision:

| # | Lens | Finding | Resolution |
|---|---|---|---|
| 9 | soundness | §5's claim that normalising makes the plain and enveloped forms hash identically is **false** under stage 1's own in-place substitution — `{data:"…"}` becomes `{data:{…}}`, not `{…}` — so the change would not deliver what it promises; and `vet-ticket-SKILL.md` Step 4 as checked in hashes the raw `tool_input`, a live disagreement with the hook-side formula | §2 stage 1 gains an explicit **envelope-hoist** step and defines `root` as the hoisted root; §5 restates the claim in terms of the hoist and names the skill-file sync plus the `/vet-code` Step 4 round-trip against an *enveloped* payload as the test that catches drift. The same hoist also un-breaks stage 2 for the 10 enveloped housekeeping edits in the corpus (holistic advisory) |

**Round 3** (soundness `a91c7d85198117bcb`, Opus) returned **PASS** — finding 9 RESOLVED, verified by
hand-running a real enveloped payload and its plain twin through the walk, the hoist and
`stableStringify`. Its four advisories are folded in rather than filed: the hoist's safety invariant
restated in terms the maintainer can actually re-check (the earlier "scope never depends on it" was
wrong — stage 2 reads the hoisted root); `__unparsedToolInput` marked inert on that list; the
JSON-lookalike parse rule narrowed to wrapper positions after it was shown to hard-block five real
payloads whose text merely begins with a markdown link; and `design-converged.md`'s "Enforcement
flow" step 5 added to the supersession list, since "return on internal error" is a silent approve
under `defaultMode: "auto"`.

Advisories accepted without a design change: the marker scan can over-gate a page that quotes the
Team-Tasks ids in prose (fails safe; this project's own docs do it); a create parented to a ticket
*page* (sub-page nesting) reads as in scope though it carries no ticket properties (fails safe, no
corpus instance); the 5 s subprocess timeout is tighter than `notion-fetch-staleness.js`'s 8 s
(fails safe); stage 1's truncation detector is keyed on `__unparsedToolInput.len`, so a future
wrapper that truncates under a different key would not be detected as truncated — it would fail the
JSON-parse test instead, which also blocks.

**One correction to `design-converged.md` found during this round** (pre-mortem advisory, verified):
its "Seeding" paragraph claims the cache is seeded "on every gated create/duplicate/move"; the
working copy seeds only on **move** (`auto-approve.working.js:1825-1837`). The claim is wrong about
the code, not the code wrong about the design — first-edit-after-create pays one resolver
round-trip. Fold the seeding into create and duplicate at build time, or correct the claim.

---

## 8. Honest limits

- **The corpus is Claude's own history, not a specification.** Far better evidence than the tool
  schema, but a shape absent from 1,313 calls can still occur tomorrow. The answer to that is
  structural — stage 1 fails closed on anything it cannot fully read — not statistical.
- **`notion-duplicate-page` has zero captured payloads.** No field-name guess is load-bearing (the
  id scan is generic), and the "absent target ⇒ block for non-create tools" rule covers a misread.
- **A page dragged into Team-Tasks through the Notion UI** resolves correctly on its next edit (no
  negative caching), but a page whose *positive* was cached and which then leaves the database stays
  gated for up to 30 days. Fails safe.
- **Prose ids are deliberately not resolved.** A call naming its target only in free text would be
  missed; no such call exists in the corpus and none is possible through these four tools.
- **A broken or de-scoped token blocks every ticket edit** rather than waving them through. That is
  the intended direction (Erez: if the gate cannot tell, it stops) and `/vet-ticket` needs no Notion
  access to mint, so the escape is one review plus one mint, never break-glass. It is loud, not
  silent — which is why piece 1 no longer needs the aggregate monitor that round 1 wrongly claimed.
- **Whether PreToolUse hooks fire for sub-agent-originated tool calls is still unverified**
  (`design-converged.md` Honest Limits; unchanged by v3, to be checked at build). If they do not, a
  sub-agent could file an unreviewed ticket.
- Raw REST/curl Notion writes and all Jira writes remain out of scope for piece 1, and the six
  non-gated Notion tools are scoped out per §1.
