# notion-fetch MCP cache staleness — findings (GEN-377)

**Status:** Root cause characterized from observed behavior on 2026-07-08. Bug REPRODUCED live this session (not just the day-old GEN-372 report). Mechanism is not inspectable (Notion's hosted MCP server), so the model below is inferred from black-box probes, not from server source.

## The bug (as originally reported, GEN-372)
On 2026-07-08, `notion-fetch` returned a snapshot of GEN-58 pages stamped `as of 2026-07-07T17:25:41Z` on repeated fresh calls, missing real edits (a Vol.3→Vol.4 rollover + recurrence traces). Reads had to be done via raw Notion REST API for the whole session.

## What was tested this session (controlled probes)
Target page: GEN-58 Vol. 4 (`3976e495d07c810ab10ec2da6fd61f32`). Ground truth = Notion REST API (`GET /v1/pages/{id}` → `last_edited_time`; `GET /v1/blocks/{id}/children`).

1. **REST reads live state — VERIFIED TRUE.** Append a marker block → immediate REST re-read shows the block and an advanced `last_edited_time`; delete → count returns. Repeated twice. REST is a trustworthy live oracle. (This was the load-bearing assumption a /check panel flagged as unverified; now verified.)

2. **MCP `notion-fetch` serves a pinned snapshot — REPRODUCED.** Sequence, all same session:
   - Wrote GEN-377 trace via MCP `insert_content` → page `last_edited_time` = **15:23**.
   - First MCP `notion-fetch` after that write → `as of` = **15:23:22.580Z**. Correct at that instant.
   - REST append/delete test → `last_edited_time` advanced to **15:39**, then **15:40** (both verified live via REST).
   - 2nd and 3rd MCP `notion-fetch` of the same page → **still `as of 15:23:22.580Z`, identical to the millisecond**, content frozen at the 15:23 state. Did NOT reflect the 15:39/15:40 edits.

## Characterization (what the `as of` timestamp actually is)
Refined after additional controls (MCP-write vs REST-write, isolated):
- The `as of` stamp on a `notion-fetch` **read** is **NOT** response-generation time and **NOT** the page's live `last_edited_time`. It is the **timestamp of a cached snapshot** the MCP holds for that page's reads.
- **Read responses are served from a snapshot pinned at/near the first read of the page in the session.** Across all read calls this session the stamp stayed frozen at `15:23:22.580Z` (identical to the ms), while REST-verified `last_edited_time` advanced 15:23→15:39→15:40.
- **Out-of-band edits are invisible to the read cache.** Edits made via the REST API (or, by extension, by another user / another client / the Notion UI — the GEN-372 cross-session case) did NOT move the read stamp or update read content.
- **An MCP *write* call returns a fresh inline response** (its own response was stamped 15:45 and showed the just-written block) — but this is the write call's own return path, NOT the cached read path. A subsequent `notion-fetch` **read** reverted to the pinned 15:23 snapshot. So an MCP write does not reliably "refresh" what later reads see; do not rely on "write through MCP then read" as a freshness trick.
- This matches the GEN-372 report: there, the first read of the session snapshotted a day-old state (17:25 the prior evening) and every later read that day returned that pinned snapshot; the edits it missed were made in other sessions (out-of-band to that session's read cache).
- **Invalidation across sessions:** a fresh session gets a fresh first-read snapshot (inferred from the GEN-372→next-day recovery — confounded with elapsed time; not isolated from a possible long TTL). Exact cache key (session vs connection vs process) and TTL remain opaque (hosted server, not inspectable).

**Corrected prior error:** an earlier version of this note (and a /check brief) said the cache is "pinned at first fetch, not invalidated by ANY edits incl. yours." The MCP-write control showed the write path returns fresh data, so "yours (via MCP write)" was wrong as stated. The behavior that matters for the guard is unchanged: **reads can silently lag live state, especially under out-of-band edits.**

## Answers to GEN-377's three questions
- **Nature:** a per-page snapshot cache in Notion's hosted MCP server, pinned at the first fetch of that page in a session; the `as of` field is the snapshot time, so it can look authoritative while being stale.
- **When it invalidates / can it be forced fresh:** not invalidated by edits or repeat fetches within a session; a fresh session gets a fresh snapshot. No client-side cache-bust lever was found. **REST bypasses the cache entirely** and is the reliable force-fresh path.
- **Is a guard needed:** YES — see the guard rule below. The failure is silent (the stamp looks precise) and defeats "verify against live state" for any Notion-backed reasoning that must reconcile against current state.

## Guard (proposed — pending Erez approval, to run through /check)
For time-sensitive Notion reads — reconciling against the CURRENT state of a log/ticket you are about to write to or make a decision from — do not trust `notion-fetch` alone: its `as of` stamp can be a pinned session snapshot, not live. Verify via the REST API (Credential-Manager token; see the notion-ticket-lookup skill's REST pattern), whose `last_edited_time` / block-children reflect live state. Ordinary one-off reads where staleness within a session doesn't matter can still use `notion-fetch`.

**Re-entry trigger for future root-cause depth:** if you observe `notion-fetch` returning a repeated identical `as of` stamp that lags REST's `last_edited_time`, that is this bug — GEN-377 is the durable record; capture the live instance there.

## Not established (honest limits)
- Exact TTL / whether the cache ever refreshes mid-session on its own (never observed to, but not proven never).
- Whether the cache key is per-session, per-connection, or per-MCP-server-process.
- Server-side cause (not inspectable).
