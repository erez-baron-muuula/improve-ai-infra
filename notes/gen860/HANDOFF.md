# GEN-860 handoff — automatic session backup (written 2026-10-14, session 460fea18)

Ticket: GEN-860 "Make sure no Claude session of Erez's is lost again, and keep a restorable backup" (Notion Team-Tasks, https://app.notion.com/p/3f96e495d07c81678c90ecb5b9695f05). Backup facts and restore steps: `notes/gen860-session-backup.md`.

## Where things stand
- **Gap closed** (2026-10-14 16:56 local) and checked file by file; details in `notes/gen860-session-backup.md` ("Gap closed again").
- **Automatic copy: built and reviewed, NOT installed.** Nothing under `~/.claude` was changed. Build files are in `notes/gen860/build/`:
  - `session-backup.ps1` (new script, target `~/.claude/scripts/session-backup.ps1`)
  - `sessionstart-session-backup.js` (new SessionStart hook, target `~/.claude/hooks/`)
  - `sessionstart-backup-surfacer.js` (edited copy of the live hook; re-diff against live before use, the live file may have changed)
  - `make-settings.js` (builds the `settings.json` working copy from the LIVE file + one SessionStart entry with `"timeout": 60`; rebuild right before applying, another session changed `settings.json` during this one)
  - tests: `test-session-backup.ps1` (66/66 at handoff; uses throwaway folders `...\Claude Session Backup\_vet-test\<tag>-*` on G:), `test-hooks.js` (37/37; fake homes, includes the real failure-queue corpus), `test-pass-consume.js` (6/6 for settings.json and the surfacer), `check-backup-json.ps1` (validates every JSON in the real backup; 3,342 valid at handoff), `probe-shrink-tail.ps1`
  - `design.md` (full design, REVISION 2 and R2b, round-1/2 reviewer outcomes)
- Reviews done this session: `/check` converged twice (round 1: 3 lenses PASS; round 2: 2 lenses PASS); code review Pass A twice (6 findings, all fixed), Pass B twice on Opus 5.5 (round 1: 2 material, fixed; round 2: 1 material, fixed but NOT re-reviewed). Vetting records exist in `~/.claude-staging/vetting-passes/gen860-*.vetting-record.json`, but they cite this session's reviewer transcripts, so a new session must re-run `/check` and both code-review passes on the final code anyway (`/vet-code` Step 6 looks in its own session's folder).

## Open issue to settle FIRST (Erez's call-out, 2026-10-14)
Erez, on being told the last fix was not re-reviewed: "This means we are fixing the symptoms and not the root cause." He is right about one part of the design: the **"session transcripts disappeared" notice** (kind `session-files-dropped`). It was added by Claude, not requested; it infers loss from a file count, which cannot tell Claude Code's own retention cleanup from real loss, and two review rounds each found a new false-alarm case that was then patched (latest patch: count only transcripts active in the last 25 days). Logged on GEN-58 Vol. 10 as Class E `[proxy-alert-patched-not-rederived]`; GEN-227 trigger fired (already To Do, comment added).
Root-cause options for the next session (decide, do not patch further):
1. **Drop the notice** from this version. The requirement is that no session is lost; the add-only backup already keeps every file, and the 24 h staleness line covers a stopped copier.
2. **Re-derive it from the authoritative signal**: a session still listed in the desktop app's session list (`claude-code-sessions\<account>\...\local_*.json`, which holds each session's id) whose transcript file is missing on the PC. That is exactly how the original loss was found (2026-10-14 (1) HISTORY entry), and it cannot fire on routine cleanup of sessions the app no longer lists. Needs a check of how the session list names the transcript (field name) before designing.
Whichever is chosen, re-run the design `/check` on the changed part and a fresh independent code review of the final code before installing. Also re-read the rest of the design for any other added-but-unrequested part (candidates to question: the slow-run line in the surfacer; the once-a-day limit for session-list shrinks).

## Other facts the next session needs
- Copy commands from a Claude shell work if they contain no `$` variables (the copy guard blocks a copy command with a variable, or one naming `~/.claude/hooks` or `~/.claude/scripts`).
- PowerShell gotchas hit here: a helper named `LP` collided with the built-in `lp` alias (Out-Printer) — use Verb-Noun names; `$null` passed to a .NET string argument becomes `""` (use `[NullString]::Value`); a bare `return` at script level exits with code 0 (main body is wrapped in `Invoke-Main`).
- Google Drive for desktop quirk: right after a file on G: is replaced by SHORTER content, local reads (any process) can return the new bytes followed by the old file's tail for a few minutes; the cloud copy was correct every time checked (Drive API), and local reads settle. The tests defer those content checks to the end of the run.
- Drive storage: each replaced copy goes to the Drive Bin (about 30 days). Measure after a week of running.
- Desktop-app transcripts are exempt from `cleanupPeriodDays` (v2.1.248+), per https://code.claude.com/docs/en/claude-directory#cleaned-up-automatically; terminal / `-p` sessions and side files (tool results, subagent transcripts) are not.

## After the automatic copy is installed: GEN-860 steps 2 and 3
- Step 2: Erez already answered "yes" to `cleanupPeriodDays` 90. Per the docs it does NOT govern desktop-app transcripts (they are kept at any age without `desktopSessionCleanupPeriodDays`), but it does keep side files (tool results, subagent transcripts, plans) and terminal sessions 90 days instead of 30. Apply via `update-config.ps1` (locked file); check `/status` or `claude doctor` for settings errors at the next session start.
- Step 3: server copies of the 150 lost sessions with remote ids (check in bulk, start with a small sample) and the 4-14 Oct file-date rewrite (compare file modified times with each transcript's last internal timestamp; changelog entries 2.1.288 / 2.1.293 / 2.1.296 are the only early-October transcript-file changes).

## Prompt for the new session (copy-paste)
```
Project: Improve AI Infra. Continue GEN-860 (Notion Team-Tasks): https://app.notion.com/p/3f96e495d07c81678c90ecb5b9695f05
This must be a local PC session; stop and tell me if it isn't.
Read first: notes/gen860/HANDOFF.md (all of it), notes/gen860-session-backup.md, GEN-860's latest progress section, and the newest GEN-860 entry in HISTORY.md.
Goal, in this order:
1. Settle the open issue in the handoff (the "transcripts disappeared" notice): fix the root cause, not the symptom. Then get the final code reviewed fresh (design /check on what changed, both code-review passes) and show me the install for approval.
2. Install, verify, and arm the 24-hour antivirus re-check.
3. Then GEN-860 steps 2 and 3.
How to work with me:
- Decide yourself anything that doesn't depend on information only I have, and tell me what you decided.
- Where my input would change the outcome, ask me guiding questions, one at a time, not a menu of options.
- Before offering me anything as yes/no, first confirm it can actually run from this session.
- Before writing any script or automation, give me the list of assumptions behind it to confirm.
```
