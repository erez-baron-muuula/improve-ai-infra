# GEN-508 piece 1 — scoping layer v3 (the rebuild)

**What this is.** The replacement for the "is this call a Team-Tasks ticket write?" layer in
`auto-approve.js`'s `enforceTicketVetting` arm. Everything else in
[`design-converged.md`](design-converged.md) — the pass shape, the `/vet-ticket` flow, the card
approval, the waive lane, the unresolved-page hard-block stance — is unchanged and still governs.
Read that first; this document only replaces the section headed "Scoping — which calls are in
scope", plus the four non-scoping findings listed at the end.

**Why a rebuild rather than five patches.** Two consecutive code-review rounds each found a fresh
silent bypass of the same class: the layer read *specific field paths* taken from the published tool
schema, and real traffic does not always put the fields there. Erez's call (2026-08-02) was to make
payload shape stop mattering, rather than patch the shapes we happened to have seen.

---

## 1. The evidence base — and why the old one was too thin

The previous build was reviewed against `~/.claude/hooks/credential-denials.jsonl`. Two facts about
that corpus, both measured this session:

- **It truncates.** `tool_input` is stored as a string capped at **514 characters** — 168 of the 189
  string captures are exactly 514 long, and the longest is 514. It is a *prefix* corpus: good enough
  to prove a shape exists, useless for anything past the first few hundred bytes.
- **It is small and stale.** 311 lines total, last written 2026-07-30, only ~60 of them Notion.

`deferred-calls.jsonl` (16,725 lines) carries **no payload at all** — only `{ts, tool, command, cwd,
session}`. It can tell you which commands occur, nothing about their shape.

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
| `page_id` given as a full `https://app.notion.com/p/<id>` URL | 5 | blocked as unparsable |
| `page_id` given as a **truncated** uuid (`3806e495-d07c-81b3-8e37-e21aded65`) | 1 | blocked as unparsable |
| inner payload keyed `pageId` (camelCase), **no `command` at all** | 1 | silently approved |
| inner payload as `{pages:[{id, properties, content:{type,edits[]}}]}` — a different schema entirely | 1 | silently approved |
| `commands` seen: `update_properties` 405, `insert_content` 346, `update_content` 274, `replace_content` 10, `apply_template` 3, `insert_content_after` 2, `insert_content_before` 1, **absent** 2 | — | — |

Three of these (`__unparsedToolInput`, `data_source_url`, the alternate inner schema) are **new** —
they are not among the five findings the ticket carries. Same class, found only because the corpus
got better. That is the argument for the rebuild in one line: the old layer's correctness was a
function of how many payload shapes we had happened to look at.

Two incidental confirmations: `notion-move-pages` really is `{page_or_database_ids: [...],
new_parent: {...}}` (finding 2 flagged those names as unverified guesses — now confirmed by a real
call), and the single captured move is `new_parent: {type: "workspace"}` — a **move-out**, the
property-dropping case, which the v2 design had explicitly declined to gate.

---

## 2. The v3 scoping algorithm

Four stages. No stage reads a field path that must be where the schema says it is.

### Stage 1 — normalise (shape stops mattering here)

`ticketNormalise(tool_input)` → `{ok, node, strings}`.

Walk the payload depth-first under a budget. At every node:
- a **string that parses to an object or array** is replaced by the parse and walked (this unwraps
  `{data: "…"}`, `__unparsedToolInput.raw`, and any future wrapper, at any depth, in any nesting);
- every string encountered — parsed or not, key or value — is collected into `strings`;
- objects and arrays are recursed.

Budget: **12 depth, 4,000 nodes, 2 MB of string**, and at most **8 unwrap levels** on any one path.
Exceeding any budget sets `ok = false`.

`ok = false` also when: the input is not an object/array/string at all; a string under a key
literally named `raw` or `data` fails to parse *and* looks like JSON (starts `{` or `[`); or an
`__unparsedToolInput.len` exceeds its `raw.length` (proof the harness truncated the payload — true
in all 3 captured cases).

**`ok = false` is a hard block.** We could not see the whole payload, so we cannot claim it is out
of scope. This is the fail-closed anchor the whole design hangs on: everything downstream is allowed
to conclude "out of scope" *only* because stage 1 guarantees it saw everything.

### Stage 2 — cheap local exemptions (never touch the network)

Read from the normalised tree, at any depth, not from fixed paths:

- **Housekeeping-only property edit.** Exempt when *all* of: exactly one distinct `command`-ish
  value exists in the tree and it is `update_properties`; exactly one `properties` object exists;
  every one of its keys is in the housekeeping deny-list (unchanged from v2: `Status`, `Assignee`,
  `Project`, `Type`, `Reason`, `Due Date`, `Remind me (days before)`, `Date Created`, `ID`,
  `Parent item`, after stripping `date:`/`place:`/`userDefined:` qualifiers); and **no
  content-bearing key appears anywhere in the tree** (`content`, `new_str`, `old_str`,
  `content_updates`, `edits`, `selection_with_ellipsis`, `template_id`, `template_name`).
  Ambiguity — two `command` values, two `properties` objects, a `properties` alongside a
  `content` — is **not** exempt. (The captured `{pages:[{id, properties:{Status}, content:{…edits}}]}`
  payload is caught by exactly this clause: housekeeping properties, but content present.)
- **`update_verification`** — page metadata, exempt, same unambiguity requirement.

Exemptions run **before** any resolution, so a status change can never be blocked by a Notion
outage. (Carried over from v2; the review round that produced it still applies.)

### Stage 3 — marker scan (free, no network)

Search every collected string for a **Team-Tasks marker**: the data-source id
`bd2cd17b-f58f-4993-8b95-468e881272fa` or the database id
`fe198002-6618-48d7-ae04-56f8cee479f3`, matched dash- and case-insensitively, anywhere in the
string. A hit ⇒ **in scope**, with no network call at all.

This single stage covers every create shape in the corpus — top-level `parent`, nested `parent`,
`data_source_url`, `collection://` prefixed, and the truncated `__unparsedToolInput` whose marker
survives inside the unparseable raw text. It is the direct expression of Erez's instruction: look
for the marker in the whole payload rather than at a field path.

### Stage 4 — resolve the remaining ids (network, bounded)

Collect **structural ids**: any 32-hex id (dashed or bare, including inside a URL) that appears as a
string value under a key whose name contains `id` (case-insensitive) — `page_id`, `pageId`, `id`,
`page_or_database_ids`, `template_id`, `data_source_id`, `database_id` — at any depth, arrays
included. Body text, `new_str`, and property values such as `Parent item` are **not** collected:
mentioning a ticket in prose must not make an unrelated page a ticket.

Split them: ids under a **container-ish** key (`data_source_id`, `database_id`, `data_source_url`,
`collection_id`) are compared locally against the marker set and never resolved — they name a
container, and if the container were Team-Tasks stage 3 already fired. Everything else is a
candidate page and gets classified:

`classifyNotionId(id)` → `'team-tasks' | 'other' | 'unknown'`
- `GET /v1/pages/{id}` with the Credential-Manager token, capturing the HTTP status.
- `200` → parent is a Team-Tasks id? `team-tasks` : `other`.
- `404` + `object_not_found` → `other`. (The integration can read the Team-Tasks database, so a row
  in it is never a 404. A data-source id fetched as a page also lands here — which is why an
  ordinary create in a *different* database no longer hard-blocks, as it would have under v2's
  "any non-200 is unknown" rule.)
- `401 / 403 / 429 / 5xx / network error / non-JSON / timeout` → `unknown`.

Verdict: any `team-tasks` ⇒ in scope. Else any `unknown` ⇒ in scope **unresolved** (hard-block, per
Erez's standing call). Else ⇒ out of scope, return without touching the write.

Zero structural ids **and** stage 1 `ok` ⇒ out of scope. That is the parentless workspace-level
create the corpus contains, and the ticket names it as the one legitimate out-of-scope case. It is
safe only because stage 1 proved the payload was fully read.

**Cost bounds (closes finding 3).** One shared wall-clock deadline of **20 s** for all resolution in
a call; per-subprocess timeout **5 s**; the Credential-Manager token fetched **once per process** and
memoised; each id resolved at most once per process; at most **8** ids resolved per call. Deadline
or cap exhausted ⇒ the remaining ids are `unknown` ⇒ block. Worst case is bounded well inside the
hook's 60 s default timeout, so the arm can no longer be killed mid-flight — which under
`defaultMode: "auto"` would have been a silent approve.

On-disk cache stays **positives-only** (v2 decision 8, unchanged): a fresh positive short-circuits,
everything else re-resolves.

---

## 3. The other four findings

**Finding 2 — move arm fails open on a missing or scalar `page_or_database_ids`.** Dissolved rather
than patched: v3 never reads that field. A move payload goes through the same four stages as
everything else — marker in `new_parent` ⇒ in scope; otherwise every id under an id-ish key is
classified, and a Team-Tasks row among them ⇒ in scope (this is the move-**out** case, which the
captured `{type: "workspace"}` call proves is real). Nothing to fail open: a payload we cannot read
fails stage 1.

**Finding 4 — batch-pass consumption is a non-atomic read-modify-write.** Fixed by
**claim-by-rename**: `renameSync(pass, pass + '.claim.<pid>.<n>')` first — atomic on Windows and
POSIX, so exactly one process can win — then rewrite the surviving entries to a temp file and
`renameSync` it into the original name, or rename the claim to `*.consumed.<ts>` when the last entry
goes. A lost race means the pass is gone from under us, so the arm re-searches for another matching
pass and blocks if there is none: fail-closed, no resurrection, no truncation.

**Finding 5 — the GEN-58 carve-out never fires.** The ticket's proposed fix is *also* wrong, and the
corpus proves it. It proposes carving out "true append semantics (each `old_str` preserved as a
prefix of its `new_str`)". All three captured GEN-58 writes are recurrence-counter bumps —
`"seen 9x (last 2026-06-24)"` → `"seen 10x (last 2026-07-02)"`, `"Vol. 4 — 7 write-ups"` →
`"Vol. 4 — 8 write-ups"` — where `old_str` is **not** a prefix of `new_str`. A prefix rule blocks
every real GEN-58 write, exactly as the current command-name rule does.

Root cause of both attempts: the carve-out was written against what a "log append" *ought* to look
like. The logging protocol on GEN-58 actually does two things — append a write-up, and bump the
counters that index it — and both are mandated by the same standing rule to happen immediately and
pause-free.

**Proposed rule instead: exempt every content-bearing write to the GEN-58 page; keep property edits
on it gated normally.** Justification, not convenience: GEN-58 is a log page, and the bar this gate
enforces ("the body stands on its own", "the priority fields are derived") is a *ticket* bar that
does not apply to a log body. Its properties are still ticket properties, so a substance-property
edit on GEN-58 still goes through the gate. This is a decision for Erez, flagged in §5.

**Finding 1 — create arm fails open on a nested parent / the `data` envelope.** Dissolved by stages
1–3, and by the "zero ids ⇒ out of scope only because stage 1 proved we read everything" rule.

---

## 4. What v3 costs

- A create into Team-Tasks: **0** network calls (marker hit). Unchanged from v2.
- A property/body edit on a ticket: **1** page fetch, cached positive for 30 days after.
- A housekeeping-only property edit: **0** — exempt before resolution.
- A create or edit **elsewhere in Notion**: 1 page fetch that returns `404 → other`, where v2 either
  returned early on a field-path read (create) or hard-blocked (v2 treated a non-page id as
  unknown). Slower than v2 by one round-trip on non-ticket Notion writes; correct where v2 was
  either blind or hostile.
- Normalisation and the marker scan are pure CPU on a payload measured in kilobytes.

---

## 5. Decisions this needs from Erez

1. **The GEN-58 carve-out shape** (§3, finding 5) — exempt all content writes to that one log page,
   versus trying again to characterise "append". Recommendation: exempt all content writes; two
   attempts at a semantic rule have now both been falsified by real traffic, and the page is a log.
2. Nothing else. Everything in `design-converged.md` that Erez already settled stands.

---

## 6. Honest limits

- **The corpus is Claude's own history, not a specification.** It is far better evidence than the
  tool schema, but a shape that has never occurred in 1,313 calls can still occur tomorrow. The
  design's answer to that is structural — stage 1 fails closed on anything it cannot fully read —
  not statistical.
- **`notion-duplicate-page` has zero captured payloads.** Its handling rests on the generic id scan,
  so no field-name guess is load-bearing — but it is the one place the general "zero structural ids
  ⇒ out of scope" rule is uncomfortable, because a duplicate necessarily *has* a source id, so
  finding none means we misread the payload rather than that the call is harmless. Carve-out, stated
  rather than inherited: for `notion-duplicate-page`, zero structural ids ⇒ **block**.
- **A page dragged into Team-Tasks through the Notion UI** is resolved correctly on its next edit
  (no negative caching), but a page whose *positive* was cached and which then leaves the database
  stays gated for up to 30 days. Fails in the safe direction.
- **Prose ids are deliberately not resolved.** A tool call that names its target only in free text
  would be missed — no such call exists in the corpus, and none is possible through these four MCP
  tools.
- **The 404 ⇒ `other` inference** assumes the integration can read every Team-Tasks row. If the
  token were ever scoped down, rows would 404 and read as out of scope. A token that cannot read
  Team-Tasks at all is worth detecting directly; the arm's event log records `other` verdicts, so a
  sudden all-`other` run is visible at `/wrap` rather than silent.
- Raw REST/curl Notion writes and all Jira writes remain out of scope for piece 1 (unchanged).
