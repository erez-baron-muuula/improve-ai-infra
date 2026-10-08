# Design — `notion-write-verify.js` (GEN-453 + GEN-593)

## Goal (approved plan, 2026-10-08)
GEN-453: never believe a Notion page-text edit happened when it didn't, or when it destroyed a neighbouring
block. Acceptance (ticket text): "the verification must be able to FAIL on a page where the intended text is
present but a previously-present neighbouring block has gone missing." GEN-593: a GEN-58 log write must not
land on a log volume that rolled over mid-session.

## What the probes showed today (practice page 3f36e495d07c81f0b7c1d2ce5db8d12d, this session)
- REST `GET /v1/blocks/{page}/children` reflects an MCP edit immediately (read right after the call).
- Block ids are STABLE: update_content keeps the edited block's id; replace_content diff-applies (unchanged
  blocks keep ids, a new block is appended with a new id); untouched blocks keep id + last_edited_time.
- A cross-segment edit (old_str spanning inline code) APPLIED correctly — the July silent no-op did not
  reproduce.
- A lone non-matching old_str -> loud 400 "No matches found" (PostToolUseFailure path).
- A BATCH with one non-matching pair -> the WHOLE call 400s and nothing is applied — the 2026-07-30 silent
  partial did not reproduce (server behaviour changed since).
- `allow_async: true` -> returns `{"object":"async_task","status":"queued",...}` immediately; that task later
  ended `failed` (500) — silent unless polled with notion-get-async-task. Per the tool's own description, an
  omitted/false allow_async "may still return a pollable async_task response if queued execution exceeds the
  synchronous wait deadline". Real corpus (994 payloads): 0 explicit allow_async:true, so the live exposure is
  the deadline overflow.
So the live silent-failure surfaces today are: (1) an async/queued edit treated as done; (2) an edit that
lands but removes or rewrites more than intended. The no-op/partial cases are now loud upstream, but a cheap
post-check still guards against their return.

## Mechanism — one hook file, registered for PreToolUse and PostToolUse on notion-update-page only
Reuses notion-fetch-staleness.js's in-process https + Credential-Manager token read (token never in argv),
hard deadlines, silent-on-internal-error stance — EXCEPT that the Post side always emits one line once a
snapshot exists, so silence never means "fine".

PRE (commands update_content / replace_content / insert_content only; others ignored):
1. GEN-593 arm (only insert_content): GET /v1/pages/{target}; if its parent is GEN-58
   (36d6e495d07c816e9e0cce265d694ab3) and its title matches /Reasoning-failure instance log\s+\S+\s+Vol\.\s*(\d+)/:
   read GEN-58's top-level blocks (first page suffices; the pointer is block ~11), find the paragraph starting
   "Current log volume: Vol. N" (VERIFIED this session via REST: the pointer is PLAIN TEXT, one text segment,
   no page mention — the refs-file note saying it carries a mention is stale), and if the target's N != the
   pointer's N -> DENY (permissionDecision deny) naming the current volume ("re-read the pointer and append
   to Vol. N; if the pointer itself is wrong, fix it first"). Any read error / no pointer / no number ->
   allow (fail open) and the Post line notes "volume check skipped (<reason>)". Edits to existing text in old
   volumes (update_content) are not blocked.
2. Snapshot: GET all top-level blocks of the target (paginate, cap 1000 blocks / 8 s). Store
   [{id, type, text, hasChildren}] in os.tmpdir()/notion-write-verify/<tool_use_id>.json. Unreadable (404 =
   not shared with the integration, error, cap) -> store {unreadable: reason}. Sweep snapshot files older
   than 1 h.
POST (PostToolUse; failures go to PostToolUseFailure, which is not registered — a failed call is already loud):
1. If tool_response text contains `"object":"async_task"` -> emit: "Notion edit NOT done yet: it was queued
   as a background task (<task id>). Poll notion-get-async-task until 'succeeded' before relying on it; if it
   'failed', the edit did not happen." (no network). Delete snapshot.
2. Else load the snapshot (missing -> "Notion edit NOT verified (no before-snapshot) — re-read the page"),
   re-read the blocks, and diff by id:
   - removed = ids in before not in after; added = ids in after not in before; changed = same id, text changed.
   - Expected effect per command: update_content -> >=1 changed-or-added-or-removed block; insert_content ->
     >=1 added, 0 removed, 0 changed; replace_content -> anything.
   - Emit exactly one line:
     * "Notion edit verified: <c> changed, <a> added, <r> removed (blocks)." when the effect is as expected and
       r == 0 (for update_content / insert_content), or for replace_content r == 0;
     * "Notion edit CHECK: the call reported success but NOTHING changed on the page — the edit did not land;
       re-read before retrying" when c+a+r == 0;
     * "Notion edit CHECK: <r> block(s) REMOVED: '<first 60 chars>' ... — confirm that was intended" when r > 0
       (always surfaced, for every command — this is the acceptance case);
     * insert_content that changed existing blocks -> list them.
     * "Notion edit NOT verified (<reason>) — check by hand" on any read failure / cap / timeout.
   Nested content (children of blocks) is not compared; if any changed block hasChildren, append "(nested
   content not checked)".
3. Delete the snapshot.

## Surfacing (signal reaches the decision-maker)
The line is injected as PostToolUse additionalContext in the same turn, i.e. read by Claude at the moment it
decides whether the edit is done. The notes-file bullet (hooks/refs/notion.md, injected on Notion turns) says:
read that line after every page-text edit; no line at all = the checker isn't running -> verify by hand and say so.

## Not covered (residuals)
Writes by REST/curl, by sub-agents (hooks fire in the main session only), by notion-create-pages; nested-block
content; edits to pages not shared with the "Muuula 1" integration (reported "NOT verified", not silently passed).

## Registration
settings.json PreToolUse + PostToolUse entries with matcher = the notion-update-page tool name, command
`node "C:/Users/Erez/.claude/hooks/notion-write-verify.js"`; the script tells Pre from Post by
hook_event_name. Timeout: rely on the script's own 10 s deadline (well under the default).
