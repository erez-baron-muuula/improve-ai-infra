# GEN-851 — Never let an open gap end up only in a closed ticket

Converged plan (/suggest + /check, 2 rounds, 2026-10-13, Improving PC Processes session 3dfdaff7). Not yet approved for build: Erez chose to build it in a separate session. Line numbers below were read on 2026-10-13. Re-check them before relying on them.

## Context
On 2026-10-13 Claude closed GEN-839 while writing a still-open gap into its body ("outside this ticket's acceptance"), and told Erez "the ticket notes this gap". Nobody reads a closed ticket, so the gap would have been lost; Erez caught it. GEN-851 asks for a comprehensive fix. The requirement: before a ticket goes to Done, Wont Do or Review, every unresolved item named in its body, sub-items, comments or the closing message is resolved, dismissed by Erez, or linked to an open ticket.

Acceptance (from the ticket):
- **Replay 1:** the GEN-839 close (body edit plus the report) is caught by an enforced layer.
- **Replay 2:** a status-only close is caught, where the gap is only in the chat reply or in an earlier body edit.
- **Jira:** MD closes are covered.
- **False alarms:** at most 1 in 20 real normal closes, and each alarm names the ticket and the phrase.

### What exists today
These facts were checked against the files by the review panel.
- A Status-only close is invisible to every hook:
  - `auto-approve.js` treats it as housekeeping (`ticketIsHousekeepingOnly` :2179, scope-out at :2722) and logs nothing.
  - `notion-write-verify.js` exits quietly on `update_properties` (`NON_CONTENT_CMDS` :45, :466).
  - No close-time hook exists for Jira.
- `notion-write-verify.js` is already registered as both PreToolUse and PostToolUse on `notion-update-page` (`settings.json` ~:175/:204). It already reads the Notion token (`getToken` :103), calls REST (`restGet` :114), and emits PostToolUse notes (`emitPost` :63). Its deadline is 25 s.
- `stop-foryou-nudge.js` is the single home for reply-scanning Stop notes. A fifth Stop hook was rejected because stacked notes caused duplicate For-you blocks (`stop-claim-linter.js` :75-81). It already has:
  - the transcript-tail reader (:499) and the check for Erez's messages (:1054);
  - call/result pairing (:1104);
  - per-prompt slots (`claimSearchFirstSlot` :1153);
  - the Search-first note, its "after" outcome rows (`recordSearchFirstAfter` :1210) and its off-switch file (:889);
  - one combined note per Stop (`runHook` :1277, :1316-1328).
- The global rule beginning "Before any ticket goes to Done or Review" (`CLAUDE.md` :47) checks only the title and description, and does not mention Wont Do. /vet-ticket Step 2 ends at item 6 (`SKILL.md` :389).

## Recommended approach: two advisory checks at close time, an outcome read-out, the rule, and a review item
Neither check blocks the close, which keeps the standing rule that no Stop hook blocks. Each check puts a note in front of Claude naming the exact unresolved phrases. Claude must then resolve each one, get Erez's dismissal, or link it to an existing or newly proposed ticket.

### Shared detector (`C:\Users\Erez\.claude\hooks\lib\close-gap-detect.js`, new)
Both checks use one phrase-and-clearance module, so they cannot drift apart.

**Phrases**
- Always flagged: out of scope, outside (this ticket's) scope or acceptance, deferred, follow-up, TODO, remaining gap or question, still open, not covered.
- Flagged only on Done and Wont Do closes: not tested / untested, not confirmed / unconfirmed, not yet verified. On a Review close these are the required "what to verify" text, so they are exempt.
- Negations are ignored (for example "no follow-up needed").

**What clears a phrase**
- An ID or link to a different ticket in the same paragraph. The closed ticket's own ID or page never clears it.

The final list is tuned against the real corpus.

### 1. Close-time ticket scan (extend `C:\Users\Erez\.claude\hooks\notion-write-verify.js`, PostToolUse)
- **Trigger:** `update_properties` with `Status` Done, Wont Do or Review. Other status values stay quiet, exactly as today.
- **What it reads:** the live ticket.
  - Its blocks, recursing one level into blocks that have children.
  - Its comments.
  - The titles and statuses of its sub-items from the Children relation, capped at 10. Open sub-items count as homes, and closed sub-items count as resolved.
  - It reuses `getToken` and `restGet`.
- **What it emits:** a PostToolUse note listing each uncleared phrase with its sentence and the ticket. The note reaches Claude before the reply is written, so the fix happens before reporting.
- **Time limits:** each REST call has its own timeout, and the whole scan has a total budget well under the hook's 25 s deadline, so a slow Notion response can't stall the close turn. Both are confirmed in the live probe.
- **When a read fails:**
  - On a timeout or network error, a one-line "close check could not read GEN-x" note.
  - On a capability error (for example comments not permitted), the check skips that part quietly and logs it, so it doesn't alarm on every close.

### 2. Close-time reply scan (fold into `C:\Users\Erez\.claude\hooks\stop-foryou-nudge.js`, Stop)
- **Trigger:** the current turn, read from the transcript since Erez's last message, contains a close call. That means any of:
  - a Notion `update_properties` with Status Done, Wont Do or Review;
  - `editJiraIssue` with a status field;
  - `transitionJiraIssue` whose transition id resolves to a done-type status through a `getTransitionsForJiraIssue` result in the transcript. An id that can't be resolved counts as a close, and the false-alarm measurement covers it.
- **What it scans:**
  - the final reply;
  - the final state of this turn's body edits to the closed page (a phrase whose sentence a later edit replaced is dropped);
  - `editJiraIssue` description payloads.
- **Wiring:**
  - One claimed slot per prompt, the same pattern as `claimSearchFirstSlot`.
  - Silent when `stop_hook_active` is true.
  - Silent when the reply already carries the For-you block and the scan finds nothing new.
  - Text is appended to the hook's single combined note, never as a separate note.
  - An off-switch file, the same pattern as `search-first-switch.jsonl`.
- **Why it's needed:**
  - It catches Replay 1, where the parallel body edit can race check 1's read.
  - It catches the reply-only half of Replay 2.
  - It catches Jira closes, whose bodies the hooks don't read.

### 3. Outcome log and read-out (surfacing path)
- **What is logged:** both checks append `fire` rows to `hooks/close-gap-nudges.jsonl`. Each row holds the session, the prompt, the check, the ticket, and each phrase with its sentence.
- **Outcome row:** at the next Stop of the same session, check 2 writes an `after` row, the same pattern as `recordSearchFirstAfter`. It records, per phrase, whether the transcript since the fire shows a home:
  - a ticket created or linked;
  - Erez's dismissal;
  - or a later body edit that removed or linked the phrase.
- **De-duplication:** check 2 skips a phrase check 1 already fired for the same ticket in the session, so each gap fires and counts once.
- **False-alarm marking:** a fire is marked false alarm when, in the transcript after it, Erez dismisses it as not a real gap, or Claude's resolution states it was not an unresolved item. A fire with no later Stop in the session counts as "outcome unknown", not "no home".
- **Read-out:** a new /wrap line in the config-health area: "Close-gap checks: N fired this period, M left with no home, U outcome unknown, K marked false alarm".
- **Re-evaluate bar:**
  - If more than 1 in 20 fires is a false alarm, re-tune the phrases.
  - If 3 of the last 10 fires end with no home, propose the escalation below to Erez.

### 4. Rule (global `C:\Users\Erez\.claude\CLAUDE.md`, via /vet-rule)
Extend the rule beginning "Before any ticket goes to Done or Review":
- It covers Wont Do.
- Before the close, every unresolved item named in the ticket's body, sub-items, comments or the closing message is resolved, explicitly dismissed by Erez, or linked to an existing or newly proposed ticket.
- "Out of scope" and "outside acceptance" are deferrals that need a home.

The hook notes cite this rule by its opening words.

### 5. Review item (`C:\Users\Erez\.claude\skills\vet-ticket\SKILL.md` Step 2, same /vet-rule run)
Add item 7. For a write that closes the ticket, or that edits a ticket being closed in the same turn, every unresolved item has a home, and a REVISE names each one that lacks one. This catches the problem before the write. The GEN-839 reviewer approved the bad wording, and its checklist had no item for this.

### Alternatives considered
- **One Stop-time scan that also fetches the live ticket**, instead of two checks.
  - Strongest case: one code path, no race, one /vet-code cycle.
  - Cost: the note arrives only after the reply is already on screen, so every catch becomes a correction Erez sees. A network fetch also lands inside a Stop hook.
  - The split costs a second build cycle, and in return most catches happen before the reply.
- **Block the close** (first escalation step, only if the outcome read-out shows notes being ignored). The existing PreToolUse arm of `notion-write-verify.js` would refuse a Status close while uncleared phrases remain. A heavier variant makes every close a reviewed, gated write.
  - Strongest case: prevention, not a nudge.
  - Cost: false alarms then block real work, and the gated variant adds a 1–2 minute reviewer round to every close and still misses Jira.

### Left out
- A /wrap sweep of closed tickets. The close-time checks plus the read-out cover it.
- Reading Jira bodies from a hook. That needs Atlassian credentials in a hook.

## Build order (each through its gate)
1. Set GEN-851 to In Progress.
2. **Live probe, read-only:** a REST GET of `/v1/comments?block_id=` and of a ticket's Children relation, run against GEN-839. If comments are not permitted, drop the comments read and record it as a residual.
3. **Extend the corpus tooling** (this folder, `notes/gen851/`):
   - a close-turn extractor over `~/.claude/projects/*.jsonl` that records the close call, the body-edit payloads and the reply;
   - a sample of at least 20 real closes, mixing Done, Wont Do and Review;
   - plus their live ticket bodies, fetched at build time.
4. **Shared detector plus check 2 plus the outcome rows** in `stop-foryou-nudge.js`, via /vet-code:
   - /check;
   - build in a working copy;
   - Pass A and Pass B code reviews;
   - live test on real inputs;
   - Erez approves;
   - mint, apply, verify.
5. **Check 1** in `notion-write-verify.js`, via /vet-code, the same steps.
6. **Rule, review item and /wrap read-out line** via /vet-rule: one /check panel covering the three files, Erez approves the wording, apply, verify.
7. Close GEN-851. Its own close check runs on its body as a final live test.

## Verification
- **Replay 1:** a fixture built from the real GEN-839 turn in session `3dfdaff7-db33-4e8c-b731-cdf2df165ff1` (project folder `C--Users-Erez-AI-Projects-Improving-PC-Processes`): a parallel body edit plus Status Done, and the reply "The ticket notes this gap". Check 2 names "Still unconfirmed and outside this ticket's acceptance".
- **Replay 2a, reply-only:** a status-only close whose reply says "X is still untested" fires. The same reply with a link to another ticket stays quiet. A Review close with "not yet verified" in its verify note stays quiet.
- **Replay 2b, earlier body:** check 1 against GEN-839's old body text (fixture) fires, and against its current body, which links GEN-850, stays quiet.
- **Jira:** a fixture with a done-type `transitionJiraIssue` and "untested" in the reply fires. An In-Progress transition stays quiet.
- **Wiring fixtures:**
  - a close reply that already carries the For-you block;
  - a continuation Stop;
  - the off-switch on;
  - a close where check 1 already flagged the phrase, so check 2 stays silent.
  
  None of these may duplicate a block or a note.
- **False alarms:** both checks over the 20-or-more real-close sample. At most 1 false alarm, and each fire names the ticket and the phrase. Results go to Erez at the /vet-code approval step.
- **Regression:** the existing suites still pass (`notes/gen606/test-search-first.js`, `notes/gen748/run-fixtures.js`, `notes/gen453/`).

## Residual (what this does not solve)
- The checks are advisory. The outcome read-out shows when notes are ignored, and blocking the close is the escalation.
- Phrase matching misses a gap worded in an unusual way.
- A link to a ticket that is itself closed still clears a phrase.
- Not read:
  - Jira ticket bodies;
  - Notion blocks more than one level deep;
  - more than 10 sub-items.
- Closes made by Bash or REST scripts, or by creating a ticket already in Done, bypass both checks.
