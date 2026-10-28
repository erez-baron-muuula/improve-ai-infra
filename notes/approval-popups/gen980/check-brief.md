# Brief shared by every /check reviewer (round 1; round 2 adds the section at the end)

You did not write this; you have no stake in approving it; do not rubber-stamp; do not invent issues to seem thorough.

## GOAL (verbatim)

Erez (non-technical owner), 2026-10-28: "Yes, design the Tableau data-read and read-only Snowflake run changes next, and bring me the reviewed proposal"

The task as handed to this session by the session Erez said it to (verbatim excerpt): "DESIGN (not build) two changes to the browser safety check `~/.claude/hooks/browser-site-gate.js`: 1. Let Claude's standard Tableau Cloud data reads through without a pop-up: the page scripts that call the Tableau session API (`fetch('/vizportal/api/web/v1/<method>')` with read methods such as getWorkbooks/getDataAlerts, often via a stored `window.__vz` helper). 40 pop-ups in the last 14 days. 2. Let the check itself confirm a Snowflake query run is read-only: a Run click or Ctrl+Return in Snowsight whose editor text the check saw set (by a stored helper call) to read-only SQL only, with nothing else touching that tab in between. About 42 pop-ups in 14 days. ... Measure each with the replay before and after (real rules, real transcripts) ... Build an allowlist of exact shapes the check can read in full, never a list of bad cases (lesson logged 8 times on GEN-58: enumerating bad cases always misses the next one). Every send, delete, payment and access change must still ask. Process: follow /suggest, run /check to convergence, then present Erez ONE plain-words proposal (he is non-technical; the pop-up shows ~3 lines) with each change's measured cut and the risk it adds ... Do not build or install anything."

Erez's standing bar for the safety check (GEN-924): "I don't want to approve everything, and I don't want to give you a blank check".

## Artifact under review

The complete artifact is the file `C:\Users\Erez\AI Projects\Improve AI Infra\notes\approval-popups\gen980\design.md`. Read it in full first; it is the whole proposal.

## Sources (provenance)

- Live gate: `C:\Users\Erez\.claude\hooks\browser-site-gate.js` — RISKY_SCRIPT line 134, typedWrite lines 123-131, harmless/summaryAsks lines 182-232, helper rules lines 233-277, decide() lines 367-485, applyDecision lines 861-876, record() lines 889-928.
- Measurement script (overlay replay of the proposed rules on the live gate): `...\gen980\measure.js`; outputs `out.json` (14 days), `out30.json` (30 days), `flipped.txt` (every waived call, what it did), `norecord.txt` (Snowsight runs with no editor record and what last cleared it). Raw ask dumps: `dump-tableau.txt`, `dump-snow.txt`. Earlier breakdown: `breakdown.txt`.
- Claude's browser notes the build would edit: `C:\Users\Erez\.claude\hooks\refs\browser.md` (lines 38, 45, 46 hold today's Snowsight and Tableau methods).
- Snowflake docs (from a web search result summary this session; page itself not read in full — treat as unverified until you read it): https://docs.snowflake.com/en/user-guide/ui-snowsight/workspaces-working and https://docs.snowflake.com/en/user-guide/ui-snowsight-worksheets (keyboard shortcuts); https://docs.snowflake.com/en/sql-reference/external-functions-introduction and https://docs.snowflake.com/en/developer-guide/external-network-access/creating-using-external-network-access (functions callable from SELECT that reach outside Snowflake).
- Tableau `/vizportal/api/web/v1/` methods: undocumented internal API — unverified by design (stated in the artifact).
- Prior decisions: `C:\Users\Erez\AI Projects\Improve AI Infra\notes\approval-popups\plan-approved-2026-10-25.md` ("Alternatives rejected"); parked per-task approval: `...\gen953-taskpass\design.md`.

Provenance rule: Treat any claim presented as verified that lacks inline provenance — a file/line, command output, or doc URL — as unverified.

MATERIAL = would cause real harm or defeat the user's goal. A preference or nice-to-have is NOT material and must never block.

End your reply with EXACTLY this block:

```
---VERDICT---
STATUS: PASS | REVISE
MATERIAL FINDINGS: (numbered. For each: the flaw + why it is material + a concrete fix. On re-review, tag each finding you carry over as one of: RESOLVED / RECURRENCE / NEW-FROM-REVISION. Write "none" if PASS.)
ADVISORY (non-blocking): (optional notes, including "verify before relying" grounding flags; or "none")
```

## Round 2 (re-review)

The artifact is now design v2 (same file, `design.md`, rewritten). `measure.js` was changed to match it and re-run; `out.json`, `flipped.txt`, `flipped-ceiling.txt`, `norecord.txt` are fresh. The notes drafts are `browser.md.draft` (Tableau only) and `browser.md.both.draft`, built by `make-browser-draft.js`; their size lines come from the size checker run this session.

Re-review is on-scope only: judge whether each of YOUR prior material findings (given in your prompt) is now RESOLVED, and raise a NEW material issue only if the revision introduced it or it changes the recommendation. No fresh wishlist. Tag each carried finding RESOLVED / RECURRENCE / NEW-FROM-REVISION.
