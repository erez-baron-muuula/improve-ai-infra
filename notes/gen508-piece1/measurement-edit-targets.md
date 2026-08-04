# What do Claude's Notion edits actually target? (measured 2026-08-03)

**Why this exists.** Erez asked whether GEN-508's gate could stop trying to work out whether a page
is a ticket, and simply treat every Notion page as one. That question is answerable only with a
number: how much non-ticket Notion editing does Claude actually do? Nobody had measured it. A
round-3 reviewer flagged the same option as missing from the design's option set and noted its cost
"is measurable today from the corpus the author already built". This is that measurement.

Recorded here rather than left in the session scratchpad because two review lenses correctly refused
to accept figures whose extractor and output were not in the repo — `design-scoping-v3.md` §1 names
its own extractor, and this did not.

## Method

Two scripts, source inline below so this is reproducible without the scratchpad.

1. **`measure-targets.js`** — walk every `.jsonl` under `C:/Users/Erez/.claude/projects` (depth ≤ 4),
   pull every `tool_use` block for `notion-update-page` / `notion-duplicate-page`, dedupe on
   `tool + JSON.stringify(input)`, then collect every 32-hex id (dashed or bare) appearing under a
   key whose name matches `/id/i`. Emits distinct target ids with a per-id reference count.
2. **`classify-targets.js`** — fetch the full Team-Tasks row set via REST
   `POST /v1/databases/fe198002-6618-48d7-ae04-56f8cee479f3/query`, `page_size` 100, paged until
   `has_more` is false; intersect with the distinct ids.
3. **`identify-nonrows.js`** — `GET /v1/pages/{id}` on every id that did **not** intersect, to
   identify it by title and parent (and its parent's title where the parent is a page).

Token from Windows Credential Manager target `claude-notion-token`, via the same PowerShell
one-liner `notion-fetch-staleness.js` uses. `curl.exe -sk` (machine TLS trait). No token is printed
by any script.

Step 3 was not cosmetic — it caught a bias in step 2. **A Notion database query omits archived rows
and templates**, so three ids that failed the intersection turned out to be Team-Tasks rows after
all.

> **Corrected 2026-08-04.** This paragraph previously ended "the non-ticket share would have been
> overstated by ~3× on the distinct-id count". That multiplier does not reconstruct from the numbers
> below and is withdrawn — a review lens caught it. The actual effect of step 3, stated without a
> ratio: of the 11 ids that failed the intersection, **3 were Team-Tasks rows after all**, so the
> query-only method reports 11 non-rows where 8 is correct; and of those 8, only **1** is a genuine
> non-ticket page (the others being 4 GEN-58 log volumes and 3 corrupted ids). So step 3's real value
> is not a correction factor on one number — it is that "failed the database query" and "is not a
> ticket" are different sets, and only a per-id identification separates them.

**Unit note** (a second review flag): the *1,093* below is a count of deduped **payloads**, while the
*1,081* in the classification table is a count of **id references** across 318 distinct ids. The two
are close in size and are not the same quantity; neither is a count of calls.

## Raw results

```
scanned 1817 transcript files
unique notion-update-page / notion-duplicate-page payloads: 1093
distinct target ids: 318
by command: update_properties 405, insert_content 373, update_content 287,
            (none) 13, replace_content 10, apply_template 3, insert_content_after 2
Team-Tasks rows fetched: 569 over 6 page(s); complete=true
intersection: 307 of 318 distinct ids are live Team-Tasks rows
```

Concentration: the top id alone is 15.1% of all references; top 10 = 34.2%; top 50 = 57.7%.
The single most-edited page in the entire corpus is GEN-58 (`36d6e495d07c816e9e0cce265d694ab3`) at
163 references.

### The 11 ids that were not live Team-Tasks rows, identified individually

| refs | what it is | parent |
|---|---|---|
| 42 | GEN-58 log — Vol. 5 (archived) | `page_id` → GEN-58 |
| 37 | GEN-58 log — Vol. 4 (archived) | `page_id` → GEN-58 |
| 27 | GEN-58 log — Vol. 3 (archived) | `page_id` → GEN-58 |
| 10 | GEN-58 log — Vol. 6 (current) | `page_id` → GEN-58 |
| 2 | "Prepare Claude config/tooling for Cursor adoption" — `archived=true` | Team-Tasks DB |
| 2 | "Epic Template" — a template row | Team-Tasks DB |
| 1 | "TEST — priority-model verification (delete after check)" — `archived=true` | Team-Tasks DB |
| 1 | "Sweep orphaned transient hook markers…" | **`workspace`** |
| 1 | `object_not_found` — id is a digit-transposition of a real ticket id | — |
| 1 | `object_not_found` | — |
| 1 | `object_not_found` | — |

The transposed id is `39e6e495d07c81d2acbabe6a9ab04d4e` against the real
`39e6e495d07c81d2acbae6a9ab04d4e7` — a live instance of the "malformed target ⇒ block" case
`design-scoping-v3.md` §2 stage 4 specifies.

### Classification of all 1,081 references

| what it is | refs | share |
|---|---|---|
| Team-Tasks rows (live) | 956 | 88.4% |
| Team-Tasks rows the DB query missed (2 archived, 1 template) | 5 | 0.5% |
| GEN-58 log volume pages (4 pages) | 116 | 10.7% |
| Corrupted / deleted ids | 3 | 0.3% |
| **Genuine non-ticket page** | **1** | **0.09%** |

**Confirms independently:** `design-scoping-v3.md` §3 finding 5's claim that the log write-ups live
on child pages of GEN-58 rather than Team-Tasks rows — all four volumes have `parent.type =
page_id`. Also confirms that `update_content` dominates GEN-58 traffic, which is why a
content-*adding*-only carve-out was wrong.

## Limits — read these before quoting the numbers

- **The unit is distinct-payload id references, not calls.** Payloads are deduped on exact input, so
  a mechanically repeated identical edit collapses to one entry. "1 in 1,081" is therefore a rate per
  distinct payload reference, not per call. The qualitative conclusion does not depend on the unit:
  **11 of 318 distinct pages, of which 7 are log volumes or corrupted ids.**
- **The `/id/i` key walk can collect a non-target id.** A relation property serialises as
  `{relation:[{id:"…"}]}`, and that inner key matches `/id/i`. So a `Parent item` / `Children` value
  can be counted as a reference even though it is not the write's target. This slightly inflates the
  ticket-row count (relations point at tickets), which biases *against* the proposal — the real
  non-ticket share is if anything lower. Noted rather than corrected.
- **Counts differ from `design-scoping-v3.md` §1** (1,043 `notion-update-page` payloads there vs
  1,093 for update+duplicate here, from 1,755 vs 1,817 files). Plausibly later sessions the same day
  plus the second tool, but not reconciled line by line.
- **This is past traffic, not a forecast.** The corpus is dominated by this project's own
  ticket-heavy work, which is close to the most favourable possible sample for "almost everything is
  a ticket". If Notion use shifts toward docs, meeting notes or a wiki, the cost rises — and the
  rebuild needed to respond is the machinery this measurement argues for deleting. Any design relying
  on this number needs a drift counter with a concrete bar, not a note.

---

# Part 2 — the two arms Part 1 did not cover (measured 2026-08-04)

Part 1's stated limit was that it "covers edits only — the 269 `notion-create-pages` payloads are
outside it". The collapse review turned that limit into two open findings: the create arm keeps a
local container test whose cost was unpriced, and the GEN-58 exemption comes into scope for the
first time, so the destructive forms it must refuse needed pricing too. Both are measured here.

**Method.** One script, `measure-collapse.js` (source described at the end). Walks the same
transcript corpus, applies the same deep-parse + envelope-hoist normalisation the design specifies,
dedupes on `tool + JSON.stringify(input)`, then classifies. No network, no token.

**Depth correction to Part 1's method.** Part 1's walk capped at depth 4 and therefore scanned
1,817 files. `find` reports **1,845** `.jsonl` files, of which **106 sit two levels deeper** than
Part 1 looked — nested sub-agent directories (`…/subagents/<dir>/<dir>/agent-*.jsonl`). Re-running
at depth 8 scans all 1,845 and returns **byte-identical** create/update counts and classifications,
so the missed files contain no Notion write payloads. Part 1's figures are unaffected; its file
count is understated.

## (A) What does a create actually target? — 263 `notion-create-pages` payloads

| parent shape | count | share | verdict under "treat every page as a ticket" |
|---|---|---|---|
| Team-Tasks marker anywhere in the payload | 255 | 97.0% | **in scope**, free (marker scan, no network) |
| a **page** id as parent | 5 | 1.9% | **gated** — cannot tell locally whether that page is a ticket |
| another **container** id as parent | 2 | 0.8% | out of scope, free (local marker comparison) |
| no parent anywhere (workspace-level create) | 1 | 0.4% | out of scope |
| parent present but **no extractable id** | **0** | 0% | would block — **zero measured cost** |

Two results that settle open design questions:

- **Failing closed on an unrecognised container costs nothing measured.** `review-findings.md`
  finding 11 is a fail-open: a create whose parent names an unrecognised data source is silently
  approved, and the live `notion-create-pages` description warns that a database with more than one
  data source forces the caller to name a specific `data_source_id`. Zero payloads in 263 have an
  unreadable parent, so the fix — block instead of approve — is free.
- **Of the 5 page-parented creates, 4 are the GEN-58 volume rollover** (`parent.page_id` =
  `36d6e495d07c816e9e0cce265d694ab3`), which the GEN-58 exemption covers. The fifth is parented to
  `3716e495d07c814e8293f76fade51ad2` (the GEN-86 epic page). So the create arm's genuinely-new
  gating is **1 payload in 263 — 0.4%**.

The two non-Team-Tasks container creates both name `d3b21172-0c4e-497e-a0fb-ae4b2bcef85d`.

## (B) What forms does a GEN-58 subtree write take? — 273 payloads

Part 1 counted 159 writes whose target was the GEN-58 **page**. This counts the whole **subtree** —
the GEN-58 page plus the four volume pages — which is what the exemption is keyed on.

| command | count |
|---|---|
| `update_content` | 156 |
| `insert_content` | 114 |
| `update_properties` | 2 |
| `insert_content_after` | 1 |
| `replace_content` | **0** |

| notable form | count | share |
|---|---|---|
| `allow_deleting_content` present at all (any value) | **0** | 0% |
| `new_str` empty or whitespace-only | 1 | 0.37% |
| `new_str` shorter than `old_str` | 3 | 1.1% |
| payload carries a non-subtree id under an id-ish key | **0** | 0% |

What each row buys:

- **Refusing `replace_content` and `allow_deleting_content` inside the exemption is free.** Both are
  zero-occurrence across 273 real writes, and `allow_deleting_content` is the exact flag that makes
  finding 3's whole-subtree wipe (including deletion of the volume pages) reachable.
- **Refusing an empty `new_str` costs 1 write in 273.** One real write empties a 6,138-character
  block. That is a legitimate repair, so this is a genuine cost rather than a free win — the escape
  is one `/vet-ticket` run.
- **Refusing a merely-shorter `new_str` would cost 3 in 273**, and shrinking is ordinary editing
  here (Part 1: `new_str` does not start with `old_str` in 132 of 148 pairs), so it is not a
  destruction signal.
- **Requiring that *every* extracted id be exempt — not merely one — is free.** Zero of the 273
  carry an id-ish id outside the subtree. This settles the every-vs-any question empirically: `any`
  would let a payload naming both a volume and a live ticket escape the gate (the shape
  `review-findings.md` finding 21 describes), and `every` costs nothing.
- The 2 `update_properties` writes stay gated per Erez's settled rule, except where the
  housekeeping closed shape already exempts them.

## Limits on Part 2

- **Same unit caveat as Part 1**: distinct deduped payloads, not calls.
- **`findAnyKey` returns the first match depth-first**, so a payload nesting two different
  `command` or `new_str` values would be counted by its first. No gated tool's schema permits that
  shape, and no payload in the corpus has more than one.
- **Counts differ from `design-scoping-v3.md` §1** (263 vs 269 creates, 1,067 vs 1,043 updates).
  Part 1 recorded a similar gap and did not reconcile it either. Files can leave the corpus —
  `cleanup-sweep.ps1` exists and sweeps old state — but that is a plausible cause, **not a verified
  one**. The classifications above are shares, and a ±3% change in the denominator moves none of
  the conclusions.
- **Past traffic, not a forecast** — Part 1's last limit applies unchanged and is the reason the
  design carries a drift counter rather than a note.

<details><summary><code>measure-collapse.js</code></summary>

Walk transcripts to depth 8; for each `notion-create-pages` / `notion-update-page` `tool_use`
block, deep-parse embedded JSON in wrapper positions and hoist a sole envelope key; classify
creates by parent shape (marker scan over every string, then id-ish keys split into
container-vs-page); for updates, keep those whose extracted ids intersect the GEN-58 subtree and
tally `command`, `allow_deleting_content`, `new_str`/`old_str` relationships, and the presence of
any non-subtree id. Prints both tables above.

</details>

---

# Part 1 appendix — what the panel concluded from Part 1

> **SUPERSEDED 2026-08-03, and read as history only.** The recommendation this section reaches — a
> locally-held ticket-id list refreshed at session start — was deleted the same day. Erez asked why
> the list would not be updated on every run that creates a ticket, and following that through
> showed the list **does no work at all**: if an unknown page is gated by default, knowing a page
> *is* a ticket changes no branch, so only gating-**removing** facts are worth holding. What
> survives is a small exemption list. See `design-converged.md` (v6) "The collapse". Left in place
> because the reasoning below about why a *resolver* cannot be made rare is still correct and is
> what forced the collapse.

A three-lens `/check` panel on "gate on tool name, never resolve" returned REVISE from all three,
converging on one finding this measurement does **not** support the way it first appeared to:

**The GEN-58 carve-out cannot be reached without the same network lookup the proposal deletes**,
because nothing in a payload distinguishes a log volume page from an ordinary ticket page. So the
lookup does not become rare — it runs on every non-housekeeping edit lacking a review record, which
is the block path, which is the safety-critical one. `review-findings.md` finding 9 already measured
this in the prior build: the carve-out's resolver ran on 1,043 of 1,313 payloads for exactly this
reason. The "~1 lookup per 25 entries" estimate described how often the exemption *fires*, not how
often the lookup *runs*.

The fix all three lenses pointed toward, from different directions: **hold the id lists locally.**
One paged query — the very technique used above, 569 rows in 6 pages in seconds — snapshots every
Team-Tasks row id plus every GEN-58 subtree id into a local file, refreshed at session start. The
hook then consults only local state: zero network calls on any path, precise scoping, and no
accreting per-fact cache to poison. Erez's "treat it as a ticket" answer becomes the safe default for
the mirror's one blind spot — a page created since the last refresh — where it costs, by the table
above, about one call in a thousand.

## Part 1 scripts

<details><summary><code>measure-targets.js</code></summary>

Walk transcripts, dedupe payloads, collect ids under `/id/i` keys, write
`distinct-target-ids.txt` (`<id>\t<refcount>`), report per-command counts and concentration.

</details>

<details><summary><code>classify-targets.js</code></summary>

Page `POST /v1/databases/<Team-Tasks>/query` to exhaustion into a Set of dash-stripped lowercase row
ids; intersect with `distinct-target-ids.txt`; report distinct-id and reference-weighted shares;
write `non-row-targets.txt`.

</details>

<details><summary><code>identify-nonrows.js</code></summary>

`GET /v1/pages/{id}` per non-matching id; print title, `archived`, parent type/id, and the parent's
title when the parent is a page.

</details>

Full source in the session scratchpad for
`f00041c7-a3bc-4560-8919-615f3ea67d68`; regenerate from the descriptions above if it has been
cleaned up — the method, not the script text, is what matters.
