# GEN-606 step C — search-first reminder: design v2 (round-2 re-review)

v2 = design-v1.md (same folder) with the changes below. Sections not listed are unchanged. The working copy now implements v2: `scratchpad/working/stop-foryou-nudge.js` (search-first stage: the block starting "// --- Search-first stage (GEN-606 step C)"; handler: `runHook` and `forYouNote`).

## Changes for round-1 MATERIAL finding (pre-mortem 1: Mode B ships with no signal for its known harm and no cheap off-switch)

### C1 Outcome row ("after" row) — measures the duplicate-block risk directly
- At each fire, the stage writes a per-session pending file in the hook's temp state dir naming the fire's `prompt_id` and mode.
- On the next Stop of that session with `stop_hook_active === true` (the Stop that ends the note's continuation), the stage consumes the pending file. If the `prompt_id` matches (prompt_id is stable across a note-driven continuation: stop-foryou-nudge.js header lines 141-143, probe gen450-stop-probe.jsonl), it appends to `search-first-nudges.jsonl`:
  `{ts, kind:"after", session_id, prompt_id, mode, searched, boardLine, boardMatch, blockReissued}`
  - `searched`: a successful board search ran in the continuation (after the last `stop_hook_summary`).
  - `boardLine`: the continuation's reply starts with "Board search:"; `boardMatch`: that line names a GEN id / Notion / Atlassian link.
  - `blockReissued` (Mode B only): the continuation's reply, or any main-chain assistant text in the continuation, carries the For-you marker (re-uses the host's `followupState(...).markerAfter`).
  A pending file for another prompt is just removed. Any error → no row; never affects any note.
- Fire rows become `{ts, kind:"fire", session_id, prompt_id, mode, patterns:[all matching], blockShown, continuation, searchAge}` (`searchAge` = Erez messages since the newest successful search in the tail, -1 none — separates repeat fires within one ticket flow).

### C2 Off-switch without a code change
If a file named `search-first-after-block.off` exists next to the hook (`~/.claude/hooks/`), Mode B never fires; Mode A is unaffected. Creating or deleting that file is not a hook-code edit, so reverting to Option 2 needs no /vet-code pass. (Checked only when a Mode B fire is otherwise due.)

### C3 The /wrap readout carries the decision data and a re-evaluate bar (built after install via /vet-rule, this session — added to the close-out list as a tracked deliverable)
One block of lines, only when it has something to say:
- This session fired (count ≥ 1): "Search-first reminder: N this session (A before the block, B after it), lifetime M; after-block fires led to a search X of Y times, found an existing ticket Z times, re-issued the For-you block W times."
- Re-evaluate bar (shown whenever it holds, even on a quiet session): lifetime `blockReissued` ≥ 2, OR at least 20 after-block fires with 0 matches found → "the after-block reminder is costing more than it finds — switch it off (create `search-first-after-block.off`, one command) unless you want to keep it." Any `blockReissued` row in THIS session → that session's line is flagged as an exception.
- Liveness: no fire for 30 days → "the search-first reminder hasn't fired in 30 days — check it still works" (a dead detector must not look like a quiet month).
- Read-only. The gen467 duplicate scan whose signature list the pre-mortem mentioned is not running (HISTORY.md line 1184: its scheduled task is gone), so the after-row is the duplicate signal for this hook; if that scan is ever re-created, its injector-signature list should gain "Search-first check, automatic:" (recorded as a note for GEN-467, not built here).

## Adopted advisories
- A1 Mode B fires only for the patterns that put a decision to Erez: ask-ticket, ask-followup, ask-file-it, bare-ask, offer-ticket ("I can / happy to / I'd like to" + file … ticket), offer-followup, would-new, go-file, as-ticket, own-ticket, new-ticket-for, chat-draft. Pure commitments ("I'll / I will / let me" + file … ticket), plan steps, "drafts of the new ticket", "and file a ticket" fire only in Mode A (a commitment reaches /vet-ticket, whose Step 0b searches before filing). The old will-ticket / will-followup patterns are split into offer-* (decision) and commit-* (not).
- A2 A tool search counts only once its tool_result came back without `is_error` (an unreachable connector or rejected query is no search). Measured shape of failures in all transcripts: notion-search 3 "server isn't responding" + 2 "No such tool", notion-query-data-sources 7 validation errors + 2 input errors — all `is_error: true`; the one Jira "Error: result exceeds maximum allowed tokens" came back `is_error: false` and was a real (oversized) result, so it correctly counts (scratchpad `search-results.js`). A `vet-ticket` Skill call still counts at once.
- A3 Backtracking: the reply's prose collapses every run of spaces/tabs/NBSP to one space before matching, and as-ticket's whitespace is de-ambiguated (`\s+(?:(?:it|this|…)\s+)?(?:up\s+)?as`). Every per-paragraph pattern is tried at every match (g flag), so an excluded first match no longer hides a later real one. D8 adds verb-plus-150K-whitespace inputs for each verb pattern; perf is re-run on the final in-file code including the 2 MB tail read.
- A4 D7 corrected: the host's watchdog is cleared when stdin ends (line 847), so nothing bounds the stage's run time; "a fault can never remove the For-you note" holds for thrown errors only. The protection against a hang is the pattern design plus the measured adversarial timing; the 2 s check only avoids adding latency to a run that is already slow.
- A5 Test isolation: fixtures run a copy of the hook inside a fixture directory, so `__dirname` (and therefore the log and the off-switch file) resolve inside the fixture, never the live log.
- A6 Note text: the Jira clause is no longer attributed to Step 0b: "search for an existing home (for a Team-Tasks ticket, the search /vet-ticket Step 0b defines; for a Jira ticket, a JQL search of its project)".
- A7 GEN-802: the chat-draft pattern makes a chat draft trigger the search reminder; it does NOT deliver GEN-802's single-ask fix, which stays the text change in /vet-ticket (step A). The close-out will say so.
- A8 D2 prose corrected: the "existing ticket" exclusion applies to the ask / offer / commit / go families (as measured), not to every pattern.
- A9 Independent re-judge at vet-code Step 4 uses two rubrics, both reported: (i) is this a proposal/offer/commitment to create a new ticket or a new-ticket draft; (ii) was the reminder warranted (first mention of this item, no earlier search for it visible, not an echo of Erez's own instruction or a status line). Precision is in-sample (tuned on the same corpus); the readout's after-rows and the first ~20 live fires are the held-out check.

## Re-measured on the working copy's own functions (scratchpad `measure-v2.js`, every transcript on disk, each reply judged on the transcript prefix the hook would see)
- 3,759 end-of-turn replies; 174 match a pattern; 54 had a successful search since Erez's last message (or ran /vet-ticket); 13 are Mode-B non-decision (skipped by A1); **107 fire: 17 Mode A, 90 Mode B**, across 56 sessions. (Mode A is "no block and not a continuation"; a continuation is counted as Mode B, so Mode A ≤ 16%.)
- searchAge of the 107: 39 had no search anywhere in the tail; 20 had one exactly one Erez message earlier; 48 two or more messages earlier.
- The 2026-10-08 incident reply fires (Mode B, bare-ask). The 2026-08-02 paraphrase matches own-ticket.
- Diff vs round 1's 119: 14 dropped (Mode-B commitments, plan steps, "drafts of", "and file" — the A1 narrowing), 1 added ("say go and I'll create it", found by trying every match in a paragraph).

## D4 restated for Erez (Option 1 still recommended)
- Option 1: remind both before and after the block. Catches the 2026-10-08 incident and ~84% of historical cases. Cost: one "Board search:" line under the block, ~1.2 a day historically (107 fires / ~88 days), and a risk the follow-up message repeats the For-you block — in the one earlier measurement of a note after a shown block, the model disobeyed conditional wording 1 time in 3 (n=3, stop-signal-surface.js header). That risk is now counted at every wrap and can be switched off with one file.
- Option 2: remind only before the block. No extra lines, no duplicate risk; would have stayed silent on the 2026-10-08 incident (its proposal was inside the block) and on ~84% of historical cases.

## Accepted limits (additions)
- Out of scope: proposing a note on an EXISTING ticket ("add it to GEN-x"). In round 1 that wording fired 17 times with no search; by the author's reading about half were reports of a note Erez had asked for or notes on the ticket being worked. The 2026-08-02 incident is still caught, but only through its "or file as its own ticket" half, not its "fold into GEN-593" half.
- Repeat fires in one ticket flow: a search one Erez message earlier does not count (20 of the 107 historical fires were that case). Under step A's /vet-ticket flow (card only after Step 0b), re-proposals should be rarer; `searchAge` in the log measures it.
- A false fire uses up that Erez message's one reminder.
- A search run some other way (a script file, a sub-agent) is not seen.
