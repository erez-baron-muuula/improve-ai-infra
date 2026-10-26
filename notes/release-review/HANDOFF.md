# GEN-871 Phase 2 — handoff for the testing session (2026-10-15)

Ticket: [GEN-871](https://app.notion.com/p/3fa6e495d07c814297aade075c87b739) (In Progress). Plan: `plan.md`. Phase 1 report: `phase1-report.md`.

## Installed and verified (session c03c2ac6, 2026-10-15) — do not re-install or re-vet
Each piece was installed byte-identical to its reviewed working copy (sha256 checked), and every single-use pass was consumed.
- `~/.claude/skills/release-review/SKILL.md`: the procedure (new). Reviewed by a 4-lens /check panel, converged in 4 rounds. The one material finding (a crash mid-run could duplicate writes) is fixed: findings.jsonl is written ahead of each write, Step 0 reconciles, and `record-run` refuses `ok` while a write-ahead row is unresolved.
- `~/.claude/scripts/list-open-tickets.ps1`: read-only listing (new, /vet-code). Design /check converged. Pass A plus two rounds of an independent Pass B (Opus 5.5), all fixed. Live run: `OK 442 tickets`.
- `~/.claude/skills/vet-ticket/SKILL.md`: the unattended no-card exception extended to the scheduled release-review job (`source: scheduled`). The scheduled lane is also named in Step 0b, Step 2 and item 5.
- `~/.claude/skills/wrap/SKILL.md`: new Step 3j, the release-review readout.
- Global `~/.claude/CLAUDE.md`, "Ticket status" rule: a second exception lets the job move Blocked to To Do. Erez approved the exact wording on 2026-10-15 ("rule approved").
- In this folder:
  - `release-review-tool.js`: collect / verify / installed / readout / pending / record-run.
  - `tests/run-tests.js`: 14 fixtures, all pass.
  - `state.json`: lastReviewedVersion 2.1.300, supervisedPassedUtc null.
  - `findings.jsonl`: seeded with the 26 Phase 1 findings.

## Still to do (in order)
1. **Create the weekly task** from `scheduled-task-prompt.md` with `create_scheduled_task`: taskId `release-review-weekly`, cron `0 9 * * 0` (Sundays 09:00 local), prompt verbatim. Confirm the day and time with Erez first (it was an unconfirmed default). Until `supervisedPassedUtc` is set, a scheduled run only reads (it runs as dry), so creating the task early is safe.
2. **Permissions.** auto-approve.js gives no decision on the job's shell commands: the listing script, `node release-review-tool.js …`, `git -C … add/commit/push` and `date`. Those fall through to auto mode (probe in this session: exit 0, no output). Use "Run now" (`run_scheduled_task`) once and read the run (`list_task_runs`) for any stall or denial. If a call stalls, add an allow rule via `update-config.ps1 -Op add-allow`, which is Erez's call for Bash/PowerShell entries.
3. **Dry run on last week:** `/release-review dry after=2.1.294` (versions 2.1.295, 296, 299, 300; 481 lines after the IDE filter). Compare its candidates with Phase 1's rows for those versions: A2 (2.1.300 transcripts, GEN-872), A3 (2.1.299, UserPromptSubmit before skill expansion, GEN-334), A4 (2.1.299 idle compaction, GEN-208), B2 (2.1.295 onFailure, GEN-835). All four should appear as candidates and then dedupe as already handled in findings.jsonl. Note anything the dry run finds that Phase 1 missed, or the reverse.
4. **Supervised first live run:** `/release-review supervised max-writes=2`, with Erez present. Since lastReviewedVersion is 2.1.300 and no newer version may exist yet, the expected writes are creating the digest ticket and its first section. Check that the gate passes are `*.consumed.*`, that records carry `source`, and that state advances. Then set `supervisedPassedUtc` in state.json. Run `readout` and confirm the /wrap line. Run it again and confirm it files nothing (dedupe).
5. **Update GEN-871** (through /vet-ticket): what was built, the results of steps 3–4, and the scheduled task id. Then Done or Review per the global rule. The first unattended scheduled run is a later verification; scheduling a check on it makes this Review.

## Progress (testing session 593abcdd, 2026-10-15)
- Step 1 done: `release-review-weekly` created, cron `0 9 * * 4` (Erez chose "Thursday at 9:00"), saved in Auto mode.
- Step 2 done: Erez clicked Run now (the classifier refused `run_scheduled_task` from the session). The run succeeded in ~2 min with no stall or denial, ran as dry, recorded a no-op, committed and pushed. It never reached the listing or Notion steps, because there were no new versions.
- Step 3 done: dry run `after=2.1.294`. See `dry-runs/2026-10-15.md`. A2/A3/A4/B2 all deduped. One new would-be ticket (PowerShell sees CLAUDE_ENV_FILE vars from 2.1.296, so `hooks/refs/shell.md` goes stale). The IDE filter wrongly dropped one mods line.
- Step 4 waiting: no Claude Code version after 2.1.300 yet, so a supervised run would be a no-op. Erez's answer to "Wait for the next Claude Code version before the supervised run?" was: "Yes, wait for the next Claude Code version, then do the supervised run with me", and then: "let's run it next Thursday" (= 2026-10-22). The 09:00 scheduled run that day runs as dry and does not advance state, so the supervised run afterwards still sees the new versions. Start it after that run finishes (check `run.lock` is gone).
- Step 4 done (session 7f014f94, 2026-10-26): supervised run on 2.1.301-2.1.310, Erez present. Erez lifted the 2-write cap ("do as many writes as needed"): 3 writes, all reviewed and passes consumed - GEN-959 digest created with its first section, note on GEN-349. `supervisedPassedUtc` 2026-10-26T09:45:15Z, `lastReviewedVersion` 2.1.310, readout line confirmed. Erez answered "release review: yes to 1" (GEN-892 moved to To Do). Dedupe re-check: dry run on the same versions, 0 would-be writes (`dry-runs/2026-10-26.md`). A catch-up scheduled run on 2026-10-25 20:42 UTC had stopped after collecting, leaving a stale `run.lock` and no runs row (cause unknown).
- Step 5 in progress (same session): GEN-892 moved to To Do; GEN-959 item 1 struck and a Decided section added. Scheduled task `gen871-first-unattended-run-check` created as a one-time check for 2026-10-29 14:00 local. Its reviewer found two gaps: a run that starts and dies (as on 25 Oct) would be reported as "did not run", and nothing re-checks after an inconclusive week. Changing the task to a weekly check was refused by the app's auto-mode safety check; waiting on Erez. The GEN-871 closeout note (draft in the session scratchpad) and the move to Review wait on that.

## Known open points
- Commit the new files in this folder; the build session did not commit.
- The sync during install printed BACKUP-COVERAGE warnings for `session-backup-state` and `hooks/sessionstart-session-backup.js`. These belong to GEN-860's session, not this ticket.
- Advisories not acted on: digest "waiting" count is a snapshot as of the last run; the readout may lag up to a week after Erez answers items.
