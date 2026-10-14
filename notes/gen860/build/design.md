# Design: automatic add-only session backup to Drive (GEN-860, Part 2)

## Erez's request (verbatim, this session's opening message)
"Goal, in this order:
1. Close the backup gap that opened since 15:16 on 2026-10-14, then check file by file that nothing is missing.
2. Build the automatic recurring copy of my session history to the Drive backup, so the backup stays current without me. Requirements are in GEN-860's progress section.
3. Then GEN-860 steps 2 and 3.
How to work with me:
- Decide yourself anything that doesn't depend on information only I have, and tell me what you decided.
- Where my input would change the outcome, ask me guiding questions, one at a time, not a menu of options.
- Before offering me anything as yes/no, first confirm it can actually run from this session.
- Before writing any script or automation, give me the list of assumptions behind it to confirm."

## Requirements (GEN-860 progress section, verbatim)
"Requirements: handle paths over 260 characters (robocopy does), never delete anything in the backup, never let a damaged or shorter local file replace a good backup copy, keep the startup run short, and tell Erez when the last successful copy is too old. It changes a hook, so it goes through /vet-code (xhigh). Before offering Erez anything, confirm the mechanism can actually run from a session."
Also (backup note, written last session by Claude, not by Erez): "must run without the Claude app (Windows' own scheduler)". Last session Claude told Erez "I'd use Windows' own scheduler"; Erez did not answer that point. This design departs from it (see Trigger).

## Background facts (measured this session)
- Sources: `C:\Users\Erez\.claude\projects` (6,714 files, 1.28 GB, 525 dirs; session transcripts `<proj>\<id>.jsonl`, subagent transcripts, tool-result side files, `memory\*.md`, `custom-title.json`) and `C:\Users\Erez\AppData\Roaming\Claude\claude-code-sessions` (523 files, 146 MB; per-account session-list JSON files ~490 KB each, rewritten by the app on activity).
- Backup root: `G:\My Drive\AI Projects\_Tooling\Claude Session Backup` with `projects\` and `claude-code-sessions\` mirrors (Google Drive for desktop virtual drive G:). Drive adds a `desktop.ini` per folder in the backup.
- Listing both trees with .NET `DirectoryInfo.EnumerateFiles` and the `\\?\` prefix: 0.2 s (C:) + 0.6 s (G:). A full robocopy /XO refresh: ~4 s, copied 111 files / 32.7 MB.
- On G: with `\\?\` paths (PowerShell 5.1 / .NET 4.8): FileStream create + write, `File.SetLastWriteTimeUtc`, `File.Move` work, including a 344-character path. `File.Replace` works when its backup argument is a true null (`[NullString]::Value`); an earlier probe that passed PowerShell `$null` failed with "path is not of a legal form" (see the correction in REVISION 2). Reading a file that another handle holds open for writing works with FileShare.ReadWrite|Delete.
- Transcripts (.jsonl) only grow in normal operation. Other files shrink legitimately: today a `custom-title.json` (session renamed, 46 -> 25 bytes) and 4 session-list JSONs were smaller locally than in the backup.
- 119 new sessions in 21 days; gaps between session starts over 12 h are only overnight/weekend breaks. Erez often runs 3-4 sessions in parallel.
- Existing pattern reused: `~/.claude/hooks/sessionstart-backup-spawner.js` (GEN-382): SessionStart, inline `spawnSync` of powershell.exe attached + `windowsHide` (no window flash; a detached launch flashes a console), throttle file stamped up front, overall deadline + hard timeout, JS-side durable failure record when the child is killed or fails to launch. `~/.claude/hooks/sessionstart-backup-surfacer.js` reads unseen records from the append-only `~/.claude/backup-sweep-failures.jsonl` (shape {ts, machine, session, repo, kind, detail, surfaced}) via a byte cursor and injects them as SessionStart additionalContext ("Relay this to Erez at the top of your first response"). SessionStart hooks run in parallel.
- Avast history: a generated .vbs launched by an earlier spawner was quarantined; current launch avoids cmd/start, wscript, -EncodedCommand, -ExecutionPolicy Bypass (uses RemoteSigned).

## Decisions
1. Trigger: a new SessionStart hook, inline, throttled to one attempt per 30 minutes. NOT a Windows scheduled task: session files change only while Claude runs, so a copy at every session start leaves only the tail of the day's last session uncopied until the next session start; a scheduled PowerShell run would flash a window and adds a Windows task to maintain. No /wrap trigger in this version.
2. Scope: the two source trees above, full trees, no exclusions.
3. Add-only: the script never deletes a backup file and never mirrors local deletions. Only its own temp/swap files (`*.sbtmp`, `*.sbold`) are ever removed.
4. Damaged-file guard (per file that differs in size or modified time):
   - backup copy missing -> copy.
   - local is empty and backup is not -> do not copy; alert once (kind `session-held`).
   - local smaller than backup, OR (for `.jsonl`) the backup's last min(4096, size) bytes differ from the local file's bytes at the same offset -> first copy the backup file to `<root>\_previous-versions\<runStamp yyyyMMdd-HHmmss>\<tree>\<rel path>`; only if that succeeds, replace the backup copy with the local file. For `.jsonl` also alert (kind `session-shrunk`, detail names the file and where the older copy was kept). For other files no alert (normal edits).
   - otherwise (grown/changed normally) -> replace.
   - Unchanged = same length and modified time within 2 s.
5. Replace without ever leaving a truncated backup copy: write the local content to `<dst>.sbtmp` (read with full sharing), set its modified time to the local file's, then `Move(dst, dst.sbold)`, `Move(tmp, dst)`, `Delete(dst.sbold)`. New file: write tmp, `Move(tmp, dst)`. At the start of each run, recovery pass over the backup trees: `x.sbold` with `x` missing -> rename back to `x`; `x.sbold` with `x` present -> delete sbold; `*.sbtmp` -> delete.
6. Long paths: every path used with the `\\?\` prefix; directories created with `Directory.CreateDirectory`.
7. Safety preconditions: the backup root must already exist (never created by the script, so a missing G: or a moved folder cannot cause a new tree to be written elsewhere); each source must exist; otherwise record a failure and stop.
8. Budget: copying stops once 20 s have elapsed (checked between files); the run is then "incomplete" (not success, no failure record; the next run continues). The hook hard-kills the child at 45 s and records a failure.
9. Concurrency: a lock file in the state dir opened FileShare.None; if held, the run exits immediately (benign skip).
10. State: `~/.claude/session-backup-state/` holds `last-attempt` (throttle, epoch ms, written by the hook up front), `last-success` (epoch ms, written by the script only after a complete run with no errors), `runs.log` (one JSON line per run: ts, session, ms, copied, preserved, held, errors, outcome), `held-alerted.txt` (dedupe for `session-held` alerts, key rel|localLen|backupLen).
11. Alerts and failures: appended to `~/.claude/backup-sweep-failures.jsonl` with repo "(session backup)" in the existing record shape, kinds `error`, `session-shrunk`, `session-held`. Errors in a run -> ONE summary record (count + first few paths). Shown by the existing surfacer at the next session start.
12. Staleness signal (the "too old" requirement): the existing surfacer (a different hook from the copier, so a copier that never runs is still caught) reads `last-success` and the newest modified time among top-level transcripts `~/.claude/projects/*/*.jsonl`. If newest - lastSuccess > 24 h (missing last-success counts as 0), it adds one line: the Drive session backup has not succeeded since <date> although sessions changed since; it repeats at every session start until a copy succeeds. Surfacer also gets labels for the two new kinds. Cursor logic unchanged.
13. Exit-code contract script -> hook: 0 complete; 10 problems recorded by the script; 11 lock held (skipped); 12 incomplete (budget). Anything else, a kill, or a launch error -> the hook writes one `error` record itself.
14. Launch: `powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -WindowStyle Hidden -File <script> -SessionId <id>`, spawnSync attached, windowsHide, stdio ignored, timeout 45 s. Session id validated against ^[A-Za-z0-9_-]{1,100}$ (else "unknown-session"). No stdout from the hook.
15. Script parameters for every path (sources, backup root, state dir, failure queue) with real defaults, so tests run on scratch trees.
16. Install seeds `last-success` by running the script once by hand after apply, so the surfacer does not alarm on the first session.

## Files
- NEW `~/.claude/scripts/session-backup.ps1` (ASCII only, PS 5.1).
- NEW `~/.claude/hooks/sessionstart-session-backup.js`.
- EDIT `~/.claude/hooks/sessionstart-backup-surfacer.js` (staleness line + 2 labels).
- EDIT `~/.claude/settings.json` hooks.SessionStart (register the new hook) via update-config.ps1.

## REVISION 2 (after round 1: three lenses PASS, no material findings; advisories folded in). These items SUPERSEDE the matching decisions above.
- CORRECTION to "Background facts": `File.Replace` does NOT fail on G:. The earlier probe passed PowerShell `$null` for the backup-file argument, which PowerShell converts to "" ("path is not of a legal form"). Re-probe with `[NullString]::Value`: "G: long-prefix Replace with NullString: ok -> new content | tmp left: False"; with `$null`: FAILED (same message as before). The two-rename swap is kept anyway (tested; clearer failure semantics: `.sbtmp` = possibly partial, `.sbold` = complete old copy). `[NullString]::Value` is used for the last-success stamp.
- R1 Decide on the bytes actually copied (pre-mortem adv. 2): every change is first written to `<dst>.sbtmp`; its on-disk length is checked against bytes written; the guard (empty / cut-off JSON / shrink / tail mismatch) is evaluated on the temp copy vs the backup copy, so a file changing during the read cannot slip past.
- R2 Damaged-file guard per type (replaces Decision 4 for non-transcripts):
  - `.jsonl`: unchanged rule (shorter or tail mismatch -> save old copy to `_previous-versions` first, replace, alert `session-shrunk`; detail starts with the kept path).
  - any file: empty new copy vs non-empty backup -> do not replace; alert once (`session-held`).
  - `.json`: new copy whose last non-whitespace byte is not `}` or `]` -> do not replace; alert once (`session-held`).
  - other files: shrink to under half the backup size -> keep old copy in `_previous-versions` (silent), replace; smaller shrinks are normal edits -> replace directly. Reason: session-list JSONs (~490 KB each) shrink on ordinary app rewrites (4 of them in 100 minutes today), and keeping every older version would grow the backup by an estimated several GB a year; Drive's own version history also keeps overwritten versions for a limited time.
- R2b (after round 2, pre-mortem adv. 2, which also noted that with the rename swap an overwritten copy goes to the Drive Bin, not to Drive version history): the "under half" rule is REPLACED by "any shrink of a non-transcript keeps the older copy first, at most once per file per day" (literal requirement kept, growth capped). Measured: 4 session-list files shrank between 15:16 and 16:56, 0 of 523 between 16:56 and 17:30. Test: second shrink of the same title the same day is replaced without a second copy (58/58).
- Round-2 pre-mortem adv. 1 (drop notice would fire on routine 30-day age-out) NOT adopted, on evidence: per https://code.claude.com/docs/en/claude-directory#cleaned-up-automatically (relayed by the docs sub-agent this session) "Claude Code keeps the transcript of a session you started or most recently continued in Claude Desktop or Cowork at any age" (v2.1.248+), and since the 2 Aug cutoff no top-level transcript has disappeared (the 13 backup-only files today are tool-result side files). So routine top-level drops should be about 0, and the suggested fix (alert only on files younger than 25 days) would miss exactly the original loss, which hit old sessions.
- R3 Date-only changes (pre-mortem adv. 3): a `.jsonl` with the same length whose first and last 4 KB match the backup copy is "touched" (backup modified time set) instead of recopied. Other file types are recopied (same-length JSON or notes can differ in the middle).
- R4 Drive not reachable (holistic adv. 4): backup root missing -> exit 14, nothing recorded; the hook back-dates its throttle stamp so a session start 5 or more minutes later retries (round-2 soundness adv. 4: an unthrottled retry would spawn PowerShell at every start during an outage). A lasting outage is reported by the 24 h staleness line.
- R5 Per-tree independence (soundness adv. 9): a missing or empty source tree is a recorded problem but the other tree is still copied. An empty source tree counts as a problem (zero-enumeration sanity gate).
- R6 Transient errors (pre-mortem adv. 7): a source file that vanishes between listing and copying is counted, not an error; IOExceptions are retried twice (250 ms); an error summary identical to the last recorded one is not re-recorded (state `last-error.txt`, cleared after a clean run).
- R7 Mass-deletion notice (new, pre-mortem adv. 7 "large drop"): the number of top-level transcripts (`projects\<project>\<id>.jsonl`) is kept in state; a drop of 10 or more since the last run records `session-files-dropped` (informational; does not block success). This is the signal that would have caught the original loss.
- R8 Previous-version copies are written via temp + rename (soundness adv. 8, pre-mortem adv. 2), so `_previous-versions` never holds a truncated file under a real name.
- R9 Hook: stamps the throttle before checking the script exists (soundness adv. 14); removes the script's `:Zone.Identifier` stream before launch (MOTW, soundness adv. 7 / pre-mortem adv. 8); exit 13 contract carried into the spec (soundness adv. 3).
- R10 settings.json registration gets `"timeout": 60` (pre-mortem adv. 1; default is 600 s per https://code.claude.com/docs/en/hooks as relayed by the holistic reviewer).
- R11 Surfacer: staleness check AND a new slow-run check each in their own try/catch after the queue read; slow-run line when each of the last 3 runs in runs.log took > 10 s (pre-mortem adv. 5: signal for "keep the startup run short", bar = 3 consecutive > 10 s); the three session kinds sort right after `secret` under the 25-record cap (pre-mortem adv. 9); labels for `session-held` (empty or cut off) and `session-files-dropped`.
- R12 `-ReportOnly` switch: lists decisions; no temp, backup, queue or state-content writes (it does create the state folder and its empty lock file, so a real run cannot start at the same moment). Real-tree dry run (16:5x local): 7,314 files, 90 changed (all new or grown), 0 kept aside, 0 held, 0 errors, 1.3 s in-script (4.1 s on a first, cold run).
- R13 Performance: unchanged files are filtered inline while listing, before any per-file function call or sort (the first version took 12 s for a no-copy run; now 1.3 s).
- R14 Helper names are Verb-Noun (a short `LP` helper collided with PowerShell's built-in `lp` alias for Out-Printer; found by test; no print job was queued, checked).
- Tests: 57/57 scratch-tree checks pass on the real Drive file system (`_vet-test` folder): new/grown/long-path (358 chars) copies, mtime kept, second run copies 0, unchanged untouched, backup-only file kept, keep-then-replace for shrunk and rewritten transcripts and a halved note, small title shrink replaced, empty and cut-off JSON held and alerted once, date-only touch, same-size JSON with new content replaced, Drive-missing exit 14 with no record, missing source tree -> other tree copied and error recorded once, budget 0 -> exit 12, lock -> exit 11, swap-file repair, file open for writing copied, mass-deletion notice, report-only writes nothing.
- Unchanged decisions: session-start trigger (no Windows scheduled task, no /wrap step in this version); 30-minute throttle; 20 s budget; 45 s kill; 24 h staleness bar; add-only.

## Known residuals (accepted unless review says otherwise)
- Everything changed since the most recent session start (any time of day, in every running session) reaches Drive only at the next session start that is at least 30 minutes after the previous attempt; the end of the day's work typically waits until the next morning. SessionStart fires on startup, resume, clear and compact; the existing spawner logged 1,637 throttled starts in 3 months (~18/day).
- If the PC's disk fails, or something deletes local files, before then, those changes are lost.
- Drive Bin / version churn: each replaced file's old copy goes to the Drive Bin (auto-purged after 30 days); estimated from today's change rate (~37 MB in 100 minutes across 4 parallel sessions) at a few GB rolling. Unmeasured against Erez's Drive quota.
- A session that stays open > 24 h after the last successful copy, with no other session start, can show a one-time stale line that this same start's copy then fixes.
- The 4 KB tail check can miss a rewrite that changes earlier content but leaves the bytes at that exact offset identical (improbable).
- Drive for desktop uploads asynchronously; "copied to G:" means "in Drive's local cache", not "confirmed in the cloud".
