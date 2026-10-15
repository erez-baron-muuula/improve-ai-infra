# Claude session backup (GEN-860)

Ticket: GEN-860 "Make sure no Claude session of Erez's is lost again, and keep a restorable backup" (Notion Team-Tasks).

## Where it is
- Drive folder: `G:\My Drive\AI Projects\_Tooling\Claude Session Backup`
  (online: https://drive.google.com/drive/folders/1VtGZohhygAJvWwadioxV89vOymIa_nGG, owner erez@muuula.com).
- Contents:
  - `projects\` - copy of `C:\Users\Erez\.claude\projects` (all local session transcripts, both accounts).
  - `claude-code-sessions\` - copy of `C:\Users\Erez\AppData\Roaming\Claude\claude-code-sessions` (the desktop app's per-account session lists; they hold each session's title, remote session ID and model).
  - `_previous-versions\<date-time>\` - older backup copies saved just before a smaller local version replaced them (same relative paths under `projects\` or `claude-code-sessions\`). When restoring a file, check here for an older, longer version.
- Access: owner erez@muuula.com; shared view-only (Viewer) with info@muuula.com (Erez's decision, 2026-10-14; Erez shared it in the Drive website because the Drive connector has no sharing permission; permissions list checked 2026-10-14: exactly these two). The folder holds session transcripts, which can contain secrets, so share it with no one else.
- Lifespan: add-only. Nothing in the backup is deleted automatically (Erez, 2026-10-14).

## First copy (2026-10-14)
- Made by Erez in File Explorer (two folder copies). At the time this was believed necessary because "the auto-approve guard refuses any shell copy whose command text mentions a `~/.claude` path"; that diagnosis was wrong (corrected 2026-10-14, session 460fea18): the guard refused Claude's command because it contained a variable (an exit-code check on its second line). A copy command with no variables runs from a Claude session. The auto-mode classifier also refused opening the break-glass override from the session.
- Checked by comparing every file name and size against the source:
  - `claude-code-sessions`: 516 of 516 files; one session-list file differed in size because the app was updating it during the copy.
  - `projects`: 6,544 of 6,558 files. Missing: 10 files whose full path at the backup location exceeds Windows' 260-character limit (File Explorer cannot copy them), and 4 files created after the copy by a session that was running. Five files differed in size because their sessions were still running (this one included).
  - The 10 long-path files: 2 transcripts from scratch-workspace sessions (`...scratch-2026-09-14-0bf325\05596c00-eaea-46eb-998f-4ea2d3bde4d6.jsonl`, `...scratch-2026-09-27-a3656f\6759f5dd-c3ab-4308-a2dc-7fb670015af5.jsonl`) and 8 side files (subagent and tool-result files) under those sessions. The longest relative path is 266 characters, which is over the limit even before a destination folder is added.
- Restore test: `projects\C--Users-Erez-AI-Projects-Improve-AI-Infra\e0415caa-cb23-4396-8774-813f15588c29.jsonl` copied back out of the backup had the same SHA-256 as the original (7ADA212D...C30FFAD0).

## Gap closed (2026-10-14, 15:16 local)
- Erez ran two `robocopy ... /E /XO /R:1 /W:1 /LOG:...` commands from Windows' Run box (Win+R), one per folder (exact commands under "How to refresh" below). Logs: `C:\Users\Erez\AppData\Local\Temp\robocopy-projects.log` (81 files copied, 0 failed) and `robocopy-sessions.log` (6 copied, 0 failed).
- Re-comparison afterwards: `projects` 0 missing (the 10 long-path files arrived), 3 files differ in size (sessions running at the time); `claude-code-sessions` 518 of 518, 1 differs (app updating it). The backup also holds one `desktop.ini` per folder (added by Windows/Drive; harmless; ignore it in comparisons).
- Drive online search found the 266-character-path file and both scratch-workspace transcripts, so long paths upload to Drive as well.
- A 300-character test path was written and read back on the Drive folder with PowerShell (`\\?\` prefix) before the copy; a Node recursive `mkdir` on a 343-character path hung instead (cause unknown; avoid Node for long paths on G:).

## Gap closed again (2026-10-14, 16:56 local, session 460fea18, run by Claude)
- Before the refresh, five backup files whose local version had become smaller were saved to `_previous-versions\20261014-165610\` (same relative paths): one session title (`custom-title.json`, renamed session, 46 -> 25 bytes) and four session-list entries of the main account (normal rewrites by the app). Rule used, and kept for the automatic copy: never overwrite a backup copy with a smaller file without first saving the older copy there.
- Then the two commands below, run by Claude from its own shell (no variables in the command): `projects` 111 files copied (32.7 MB), `claude-code-sessions` 10 copied (4.2 MB), 0 failed. Logs in that session's scratchpad (`gap-projects.log`, `gap-sessions.log`).
- File-by-file comparison (path + size) right after: `claude-code-sessions` 0 missing, 0 differ. `projects` 0 missing among files that existed when the copy ran (2 files of a running session were created at 16:57:10, after it ended at 16:56:56); 4 files differ in size, all transcripts of sessions running at that moment (modified 16:57:07-16:57:15). 13 files exist only in the backup: tool-result side files of sessions 9cd83202 and 82fce884 that were deleted on the PC after 15:16. The add-only backup kept them.
- A full refresh pass takes about 4 seconds; listing both trees takes under 1 second.

## How to refresh (until the automatic copy exists)
A Claude session can run these two commands itself, as long as the command line contains no variables (the copy guard refuses a copy command with a `$` variable in it). Before running them, check for backup files whose local version is smaller and save those backup copies to `_previous-versions\<date-time>\` first.
Or press Win+R and run each command (they handle long paths and never delete anything in the backup):
`robocopy "C:\Users\Erez\.claude\projects" "G:\My Drive\AI Projects\_Tooling\Claude Session Backup\projects" /E /XO /R:1 /W:1 /LOG:C:\Users\Erez\AppData\Local\Temp\robocopy-projects.log`
`robocopy "C:\Users\Erez\AppData\Roaming\Claude\claude-code-sessions" "G:\My Drive\AI Projects\_Tooling\Claude Session Backup\claude-code-sessions" /E /XO /R:1 /W:1 /LOG:C:\Users\Erez\AppData\Local\Temp\robocopy-sessions.log`
Fallback (File Explorer, cannot copy paths over 260 characters):
Repeat the File Explorer copy: copy `%USERPROFILE%\.claude\projects` and `%APPDATA%\Claude\claude-code-sessions` into the backup folder. When Explorer asks about files that already exist, choose to replace them: session files normally only grow, so the newer copy contains the older one (the exception is a damaged local file, which would overwrite a good backup copy; the automatic copy must guard against that). Tick "Do this for all current items" and Skip on the path-too-long prompt.
The automatic recurring copy is GEN-860's next step. It must handle paths over 260 characters (so the 10 skipped files arrive), must not let a damaged or truncated local file replace a good backup copy, must run without the Claude app (Windows' own scheduler), and must tell Erez when it stops succeeding.

## Leads for the automatic copy (found 2026-10-14, not yet designed or reviewed)
- No Windows scheduled task on this PC was created by Claude (checked `Get-ScheduledTask`, non-Microsoft tasks only: all third-party updaters).
- Existing pattern worth reusing: the GEN-382 project backup runs from a SessionStart hook (`~/.claude/hooks/sessionstart-backup-spawner.js`, inline, throttled to one attempt per 5 minutes, bounded by a deadline), writes failures to an append-only queue, and `~/.claude/hooks/sessionstart-backup-surfacer.js` shows unseen failures at the next session start. Session files only change while Claude sessions run, so a session-start trigger (plus `/wrap`) may cover every change without a Windows scheduled task; a session that runs for days without a new session starting is the gap to check.
- Constraints: any hook or `~/.claude/scripts` change goes through `/vet-code`. (Corrected 2026-10-14: the earlier claim here that Claude's shell cannot run a copy mentioning a `~/.claude` path was wrong; only a copy command containing a variable, or naming the hooks/scripts folders, is refused.) `robocopy` handles paths over 260 characters; File Explorer does not.
- Open design points: guard against a damaged or shorter local file replacing a good backup copy (for example skip a replacement when the new file is smaller, and record it as a failure); keep the inline run short on startup (incremental copy, deadline); surface "last successful copy is older than N days" the same way failures are surfaced.

## How to restore a session
1. Find the session file in the backup under `projects\<project folder>\<session id>.jsonl`. The session list in `claude-code-sessions\<account id>\...\local_*.json` maps a session's title to its id.
2. Copy that file (and its `<session id>` folder, if one exists) back into the same place under `C:\Users\Erez\.claude\projects\`.
3. Check the copy is identical (same size; or compare SHA-256 with `Get-FileHash`).
Whether the desktop app lists a restored session again also depends on its session-list entry; that is not tested yet.

## Automatic copy (installed 2026-10-15)
Every Claude Code session start (at most once per 30 minutes), `~/.claude/hooks/sessionstart-session-backup.js` runs `~/.claude/scripts/session-backup.ps1`, which does the add-only copy above automatically. State and run log: `~/.claude/session-backup-state/` (`runs.log`, `last-success`, `transcript-ids.txt`). Notices appear at the next session start (backup alert): a session still listed in the Claude app that lost its transcript on this PC, a transcript that got shorter (older copy kept under `_previous-versions`), a damaged file held back, or no successful copy for 24 hours. Design: `notes/gen860/build/design.md` (REVISION 3 for the lost-session notice). First run 2026-10-15 10:17 local: 535 files copied, 0 errors.

## Step 3 findings (2026-10-15)
- **Server copies of lost sessions.** 282 listed sessions have no transcript on the PC; 149 carry a server address (`claude.ai/code/<bridgeSessionIds[0]>`): 129 on erez@muuula.com, 20 on the second account. Sample on the main account, 4 of 4 open with the conversation, shown as archived: Gen 380 guiding questions (July, checked 2026-10-14), Documentation (July), Gen 520 (July, marked `transcriptUnavailable` in the app's list), Gen 306 (June). The second account's 20 need that account signed in; not checked. Saving them back as local transcript files: no supported way found.
- **File-date rewrite (4-14 Oct).** 159 of 243 transcripts have a file date more than a day after their last entry. The changes come in bursts, each within one minute: 7 Oct 00:15 (44 files) and 09:30 (68), 14 Oct 00:15 (12) and 09:30 (6) local, the same weekday and times a week apart; plus 8 Oct 08:12 (17), 11 Oct 13:16 (4, the minute Claude Code 2.1.295 was installed) and a few singles. In the 7 Oct 09:30 burst, 47 of 73 files ended with app bookkeeping lines without timestamps (`last-prompt`, `mode`, `custom-title`), 26 did not. Not caused by our key-leak scan (it opens transcripts read-only). No Claude scheduled task or Windows task runs at 00:15 or 09:30 on Wednesdays (checked); nearest are a daily OneDrive report (09:29) and the Windows restore-point task. Cause still unknown; most likely the Claude app itself. Effect on safety: date-only changes; the automatic backup treats a same-size transcript with unchanged start and end as touched, not damaged. Next check: watch Wednesday 21 Oct 00:15 and 09:30.
