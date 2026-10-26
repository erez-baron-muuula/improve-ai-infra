# Weekly size check at /wrap (GEN-890)

Reference for `/config-health` auto mode, which sends you here after the settings nudge. It runs at
most once a week and is fully automatic: Erez sees nothing unless something fails. It is this
skill's one exception to read-only: it files and raises size tickets and writes its own state file
(`~/.claude/.size-sweep-state.json`, written only by the script). Fixes are never applied here.

The script is `C:\Users\Erez\.claude\skills\config-health\config-health-scan.ps1`. Every action
emits JSON; read its `ok` field, not the exit code.

## Steps

1. Run `-Action size-weekly`. `ok:false` -> report it (step 5) and stop. `due:false` -> stop, say
   nothing.
2. Write a scratchpad JSON file of ticket statuses, `{}` when `needStatus` is empty (Step 3 needs
   the file either way). For each page id in `needStatus`, read the ticket live through the Notion
   REST API (`GET /v1/pages/<id>`, token handled as the `notion-ticket-lookup` skill's secure
   recipe shows) and add
   `"<pageId>": { "status": <properties.Status.select.name>, "createdTime": <created_time>, "gain": <properties."Gain ratio".select.name> }`.
   A page that cannot be read is left out; its item then comes back as `error`.
3. Run `-Action size-decide -TicketsJson <that file>` and act on each decision. Before filing, read
   `C:/Users/Erez/.claude/skills/wrap/step1-capture.md` (the unattended flow), again after a
   compaction.
   - `file`: file one Team-Tasks ticket through the unattended `/vet-ticket` flow exactly as `/wrap`
     Step 1 does (`source` `wrap-step1`, one independent reviewer, at most 2 further rounds, no
     card), but skip Step 1's semantic near-duplicate search. First query for an open ticket (any
     status but Done or Wont Do) with exactly the decision's `title`; if one exists, file nothing
     and record that ticket as the link. Otherwise create it: title = `title`; type task; status To Do; unassigned; parent = the
     AI-infra epic from the global Projects Directory table; Urgency Not-urgent, Gain ratio 2,
     Priority Medium. Self-contained body: the problem (the decision's `line`), why it matters
     (Anthropic's or our own limit for that kind of file; going over a hard limit means Claude
     silently loses text), the target (`target`), how to verify (re-run
     `-Action size-check -Target <file>`), the breach key (`key`), and "Filed automatically by
     the weekly size check (GEN-890)."
   - `escalate`: through the same unattended flow, as an update to the decision's `ticket.pageId`, set Urgency to Urgent and Priority
     to the decision's `priority` (`Highest` is the "Highest 🔥" option), and append a dated line
     "Raised by the weekly size check (GEN-890): open more than 4 weeks."
   - `link`, `skip`, `deferred`: nothing (a deferred item is filed next week, over the per-wrap cap).
   - `error`: report it (step 5).
4. Run `-Action size-record -RecordJson <file>` with `filed` (`key`, `pageId`, `ticketId`, and the
   decision's `value`, for each ticket filed or linked by title), `escalated` (the keys raised), `prune` (copied from
   `size-decide`), and `completed: true` only when every `file` and `escalate` decision landed and
   no decision was `error`. Otherwise `completed: false`, so the check runs again at the next wrap.
5. Report under `/wrap`'s "Config-health" sub-heading ONLY failures, one line each:
   - a non-ok result from any action, a Notion read failure, or an `error` decision;
   - a non-empty `sweepErrors` (files the check could not measure), as one line;
   - a filing or raise left unfiled (review-round cap or hard error; a `deferred` decision is
     normal), recorded durably exactly as Step 1's surfaced-not-filed items are;
   - a filing that needed more than one review round.
   On success say nothing: Erez asked for this check to run silently, so it does not surface the
   tickets it files or raises, as other ticket work would. Each filed or raised ticket goes on its own line in the Step 4
   HISTORY.md entry (ID, title, reviewer outcome, rounds); with no project wrapped, the
   ticket-record and the state file are the trace. When the Step 7 report prints in full anyway,
   count these filings in Step 1's tally.

## Notes

- A `CLAUDE.md` size finding this run made a decision on is not repeated from config-health's own
  Step 3 `sizeFindings` in the same wrap.
- Files outside `~/.claude` and the AI Projects folder are skipped on purpose: they are not ours to
  fix.
- If the check stops running, `/wrap` Step 8's `mark-reviewed` returns `ok:false` with "weekly size
  check overdue" (the marker is still written), and Step 8 surfaces that line.
