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

## Known open points
- Commit the new files in this folder; the build session did not commit.
- The sync during install printed BACKUP-COVERAGE warnings for `session-backup-state` and `hooks/sessionstart-session-backup.js`. These belong to GEN-860's session, not this ticket.
- Advisories not acted on: digest "waiting" count is a snapshot as of the last run; the readout may lag up to a week after Erez answers items.
