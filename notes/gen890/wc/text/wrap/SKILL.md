---
name: wrap
description: "End-of-session wrap-up procedure. Use ONLY when the user explicitly runs /wrap. Runs the final actions of a working session: a check for any stored API key that leaked into a session log, auto-capturing unresolved items as Notion tickets, a CLAUDE.md config-health pass, the auto-approval scan, the HISTORY.md update + git commit/push, the global config sync, and the active project's own documented closing steps."
---

# /wrap — end-of-session wrap-up

Run as the LAST actions of a session, after all other work is complete. Execute the steps in order. If any step fails, surface the failure immediately in the "📌 For you" block AND continue with the remaining steps that do not depend on the failed one; only stop a step that genuinely needs the failed step's output. Never silently skip a step or hide-retry.

**How to use this runbook.** Each step lists what must not be skipped; where it says "Before doing this step, read `<file>`", open that file first on every run (once per wrap, again after a compaction). Editing this skill: keep this file at 12,000 characters or fewer and under 500 lines; new detail goes in a reference file.

**Reporting rule (every step).** A step with nothing actionable gets only a ✓ in the Step 7 roll-up, no prose. A step that errored, was skipped, warned, or could not tell whether it had anything to report gets ✗, ⚠ or "skipped" plus a one-line reason, never a plain ✓. Anything a step reports goes under its own sub-heading in the "📌 For you" block and forces the full Step 7 report; a HISTORY.md line its file names goes in the Step 4 entry. Readouts never write their own logs or markers; acting on one is a follow-up, not part of the wrap (Step 3c's filing and the weekly size check's tickets and state file excepted).

## Step 0 — Determine the active project
- Identify the active project from the working directory and from which project CLAUDE.md was read this session (projects are listed in the global CLAUDE.md Projects Directory table).
- If the session spans no project (global/cross-project work only), skip every project-specific step and run only the global steps: the config-health pass (global file), the auto-approval scan, and the global config sync.
- If the active project is genuinely ambiguous, ask Erez which project to wrap — one short question.
- If the active project has no documented "end session" closing steps (its SESSION HISTORY section, or equivalent), skip Step 6 and proceed.

## Step 0b — Key check (GEN-638)
Runs in every session and BEFORE Step 1, so a found key becomes a Step 1 item. Run once, from the PowerShell tool: `& "C:\Users\Erez\.claude\scripts\key-leak-tripwire.ps1"`. **Never open a file it reports as `found`**, by any tool or sub-agent; if it is this session's own log, compose Steps 1 and 4 from the in-context summary. Read its JSON whatever the exit code; never a ✓ without readable JSON.

Before doing this step, read `C:/Users/Erez/.claude/skills/wrap/step0b-keys.md`.

## Step 1 — Capture unresolved items (all sessions)
Auto-file every unresolved item this session surfaced as its own Team-Tasks ticket; never ask Erez to weigh in during the wrap. Each write goes through the `/vet-ticket` machinery UNATTENDED (`source` `wrap-step1`, no card, no waive), capped at 2 further review rounds; on the cap, an Erez-only blocker or any hard error, leave the item unfiled, surface it, and record it durably. Sub-steps: (1) decide what's already resolved; (2) identify unresolved items, filing generously; (3) triage each behavioral learning by trigger; (4) triage each to a parent; (5) dedupe by exact title; (6) check for an existing home before creating; (7) create one ticket per item; (8) carry the filed IDs to Steps 4 and 7. After a `/compact`, use the on-disk transcript.

Before doing this step, read `C:/Users/Erez/.claude/skills/wrap/step1-capture.md`.

## Step 2 — Config-health pass (CLAUDE.md drift)
Non-skippable, but **surfaces candidates only — never edits or applies a fix here** (applying an approved fix is a separate `/check` + approval follow-up; this keeps `/wrap` non-interactive).
- Read and execute `C:\Users\Erez\.claude\skills\config-health\SKILL.md` in **auto** mode. It detects whether the global `CLAUDE.md` (changed since the last completed health review — a per-machine marker) and/or the active project's `CLAUDE.md` (changed this session) need checking, scans the changed file(s), and returns drift candidates + drafted fixes. Advancing the global marker happens in Step 8, AFTER the report surfaces the findings.
- **Ordering matters:** this step must run AFTER Step 1 (so the resolved-list and ticket filing are complete before the scan), BEFORE Step 4b's project git commit (so the project change-detection diff is still uncommitted), and BEFORE Step 5's config sync (so the global change-detection diff against git-history HEAD is still intact).
- Put any candidates in the "📌 For you" block under a clearly-labelled "Config-health" sub-heading. If nothing is flagged, it gets only its checkmark in the roll-up — no explanatory line (this governs the presentation of config-health's auto-mode output, overriding config-health's own "say so in one line" convention when called from `/wrap`). Do not apply anything now.

## Step 3 — Auto-approval scan
Read `C:\Users\Erez\.claude\hooks\deferred-calls.jsonl`. Add recurring safe calls via `update-config.ps1 -Op add-allow`; list each one added in the "📌 For you" block. If nothing was added, it gets only its checkmark — no "nothing added" line. Read-only, non-mutating tool-name entries ONLY — never `Bash(...)` / `PowerShell(...)`, writes, sends, deletes, or any other settings.json change. If unsure about an entry, skip it and note it in "📌 For you"; never ask.

## Step 3b — Signal-surface pending scan (GEN-501)
Reconcile `~/.claude/hooks/signal-surface-pending.jsonl`; list each unpaired `detect`, and each unaccounted `skipped-continuation` row, under "Signal-surface (unsurfaced)", plus the 90-day FYIs. Never mutate the log.

Before doing this step, read `C:/Users/Erez/.claude/skills/wrap/readouts-3b-3c.md` (Step 3b).

## Step 3c — Self-audit-nudge readout + detector-review auto-file (GEN-540 / GEN-507)
From `~/.claude/hooks/selfaudit-nudges.jsonl`: only the dead arm (0 this session AND newest real detection over 30 days old) files or appends to the detector-review ticket through Step 1's unattended flow (`source` `wrap-step3c`); otherwise re-surface that ticket if stalled.

Before doing this step, read `C:/Users/Erez/.claude/skills/wrap/readouts-3b-3c.md` (Step 3c).

## Step 3d — Ticket-gate marker-liveness probe (GEN-508 #6)
Only if `~/.claude/hooks/auto-approve.js` contains `enforceTicketVetting` (else "skipped — ticket-gate hook not installed"). Run the probe in `C:/Users/Erez/.claude/skills/vet-ticket/marker-probe.md`; report only a non-MATCH.

Before doing this step, read `C:/Users/Erez/.claude/skills/wrap/readouts-3d-3j.md` (Step 3d).

## Step 3e — Grounding-flag readout (GEN-716)
From `~/.claude/hooks/grounding-nudges.jsonl`: one line, only if it fired this session.

Before doing this step, read `C:/Users/Erez/.claude/skills/wrap/readouts-3d-3j.md` (Step 3e).

## Step 3f — Model-list readout (GEN-705)
Run `node "C:/Users/Erez/.claude/hooks/stop-foryou-nudge.js" --selftest`, then, as its own call, `--classify <model-id>` with this turn's exact model ID.

Before doing this step, read `C:/Users/Erez/.claude/skills/wrap/readouts-3d-3j.md` (Step 3f).

## Step 3g — Search-first reminder readout (GEN-606)
Count from `search-first-nudges.jsonl` and `search-first-switch.jsonl` with a read-only Bash script, never by eye. The switch command runs only on Erez's explicit go.

Before doing this step, read `C:/Users/Erez/.claude/skills/wrap/readouts-3d-3j.md` (Step 3g).

## Step 3h — Verdict-guard readout (GEN-812)
From the Bash tool: `node "C:/Users/Erez/.claude/hooks/reviewer-verdict-guard.js" --readout "$CLAUDE_SESSION_ID"`. Relay each printed line verbatim; a `GEN-812 acceptance` line is a decision for Erez.

Before doing this step, read `C:/Users/Erez/.claude/skills/wrap/readouts-3d-3j.md` (Step 3h).

## Step 3i — Ticket-gate readout (GEN-636)
Runs in every session. From the Bash tool: `node "C:/Users/Erez/.claude/hooks/ticket-gate-readout.js"`. Relay each printed line verbatim under "Ticket gate".

Before doing this step, read `C:/Users/Erez/.claude/skills/wrap/readouts-3d-3j.md` (Step 3i).

## Step 3j — Release-review readout (GEN-871)
Runs in every session. From the Bash tool: `node "C:/Users/Erez/AI Projects/Improve AI Infra/notes/release-review/release-review-tool.js" readout`. Relay each printed line verbatim under "Release review".

Before doing this step, read `C:/Users/Erez/.claude/skills/wrap/readouts-3d-3j.md` (Step 3j).

## Step 4 — HISTORY.md
No project → skip. Prepend ONE entry ONLY through `~/.claude/scripts/prepend-log.ps1`, from the Bash tool; never edit HISTORY.md or pre-read it to check the top entry. Its first line is its `## <date>` heading and its TOC bullet begins `- <date>`. Confirm `$CLAUDE_SESSION_ID` is non-empty first (empty → BLOCKED wrap). Keep the temp entry file until exit 0; branch strictly on the exit code: 0 → release the compact gate, then Step 4b; 4 → fix per the appender's message, retry once; else → BLOCKED wrap (no Step 4b, no gate release). After a `/compact`, use the on-disk transcript.

Before doing this step, read `C:/Users/Erez/.claude/skills/wrap/step4-history-git.md` (Step 4).

## Step 4b — Git commit + push
Only after Step 4 exits 0, in a git repo. Stage only the exact files this wrap touched (never `git add -A` / `.`), commit on the current branch, `git push`. Integrate only after an out-of-date rejection, by what is in the way: a clean tree, only this session's dirty paths (a named stash, popped by name), or another session's (STOP LOUD). Never `--autostash`. Verify the final push's exit status.

Before doing this step, read `C:/Users/Erez/.claude/skills/wrap/step4-history-git.md` (Step 4b).

## Step 5 — Global config sync
Run `sync.ps1 -Direction From-Claude` and surface its full output (the exit code stays 0 even on a push warning — read the output, don't trust the code).

## Step 6 — Project-specific closing steps
Read the active project's SESSION HISTORY "end session" definition and run only the steps UNIQUE to that project that the steps above haven't already done (e.g. a build/deploy step such as `deploy.ps1`). Do NOT repeat HISTORY.md, the config sync, or the Step 1 unresolved-item capture. Re-run an earlier step only if something it depends on changed during these closing steps.

## Step 7 — Report
In the "📌 For you" block: a one-line roll-up in plain-language step labels (✓ / ⚠ / ✗ / "skipped", each non-✓ with its reason), then a detail block of actionable outcomes only, including each Step 1 ticket's ID, name, URL, parent and reviewer outcome, and the filing tally. Only when nothing at all is to report, the whole report is `Wrap: all clean ✓`. No preamble, and no closing narration but a failed step's re-run note.

Before doing this step, read `C:/Users/Erez/.claude/skills/wrap/step7-report.md`.

## Step 8 — Mark the global CLAUDE.md reviewed (config-health high-water mark)
The FINAL action of `/wrap`, AFTER Step 7's report has surfaced any config-health findings (surface-then-advance — never before). Run `config-health-scan.ps1 -Action mark-reviewed` once. This advances the config-health high-water mark to the git-history repo's current HEAD, so the next wrap won't re-flag the global-rule edits already surfaced this session. If `/wrap` is interrupted before this step, the marker stays put and those edits re-surface next wrap (the safe direction). A non-`ok` result is non-fatal — surface it in one line; it only means the next wrap re-checks. (Global file only; project `CLAUDE.md` files use the session-scoped detector and have no marker.)
