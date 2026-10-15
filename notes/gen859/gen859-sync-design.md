# GEN-859 — account session-list sync: design (for /check)

## Goal
Erez uses the Claude desktop app on one PC with two accounts and wants switching between them to be seamless. Each account has its own sidebar list, stored as files under
`%APPDATA%\Claude\claude-code-sessions\<accountUuid>\<orgUuid>\`. The conversation files themselves are already shared, in `~/.claude/projects`. The approved plan is at `C:\Users\Erez\.claude\plans\i-want-the-move-scalable-bentley.md`.

## Verified facts this design rests on (Phase 0, 2026-10-15)
- **Copied entries are accepted.** A `local_<uuid>.json` entry copied into the other account's folder (while that account was signed out) was loaded and shown at sign-in, and resumed fine.
  - Evidence: main.log "Loaded 427 … (9 archived deferred)" plus in-memory count 433→436, Erez saw them, and this session continued in erez@.
  - `list_sessions` in info@ listed all 16 copied sessions.
- **The app reads every `local_*.json` at sign-in, with no account filter.** Source: app.asar `loadSessionRecords`: `readdir` → `filter(startsWith("local_") && endsWith(".json"))` → `JSON.parse`. The file name is filtered; the account is not.
- **Sign-in does not touch other entries.**
  - Only entries the user opens get rewritten (lastFocusedAt, enabledMcpTools, remoteMcpServersConfig, gitAnchors, promptAppendSnapshot).
  - Other files keep their dates.
  - The inactive account's folder is not written while the other account is signed in: erez@ folder unchanged 12:56→13:37 while info@ was active.
- **Archive state lives in the entry.** A copied entry with `isArchived:true` loaded as archived in an account whose folder had no `archived-sessions.idx`. The app created and maintains that index itself ("hint absent" → index later present). So the sync never touches `archived-sessions.idx`.
- **Deleting a session** (in erez@, via the app):
  - The app removes `local_<id>.json`, writes `deleted_<id>` (content = epoch ms) in the active folder only, and keeps the conversation `.jsonl`.
  - It also logs "Requested CCR delete of 1 Remote Control bridge session(s)". The copied entry carried the other account's `bridgeSessionIds`, so deleting a copy may try to delete the original account's phone link.
  - The other account's list still showed the session until it was removed by hand: deletion does not propagate.
- **Active account.** `%APPDATA%\Claude\config.json` top-level `lastKnownAccountUuid` = the signed-in account. It flipped at each sign-in (14:33, 15:17, 15:44 per main.log "Login-state transition … uuid: X → Y").
- **Entry format.** `sessionId` ("local_<uuid>") and `cliSessionId` (= the hook payload `session_id`), plus `lastActivityAt`, `isArchived`, `bridgeSessionIds`, `envScopeId` (sometimes absent), and so on. Entries are ~450–520 KB each. The erez@ list has ~436 entries; info@ has ~118 after the test.

## Design
**One Node hook file, `~/.claude/hooks/account-session-sync.js`.** It is registered on SessionStart and on Stop, with timeout 30, and spawns no child process. This deviates from the plan's "`.ps1` script" for three reasons: per-turn PowerShell start-up would cost about 0.5 s, Node is already the hook runtime, and it avoids a background-launch pattern.

### Each run
1. **Switch-off.** If `~/.claude/account-session-sync/disabled` exists, exit 0 and do nothing.
2. **Lock.** Take `~/.claude/account-session-sync/lock` (create exclusively, holding pid + time). If it is held and younger than 2 min, exit (the next run catches up). If it is older, take it over. Release it in `finally`.
3. **Active account.**
   - Read `config.json` → `lastKnownAccountUuid`. It must be a UUID and a folder of that name must exist under `claude-code-sessions`. Otherwise record a failure and stop.
   - Cross-check with the payload `session_id`. If an entry with that `cliSessionId` exists in some account folder other than the active one, and NOT in the active folder, the signal disagrees: record a failure and stop. If it isn't found anywhere (first SessionStart, or a non-desktop CLI session), proceed on config alone.
   - Matching needs a parse. To avoid reading ~550 × 500 KB, read only each entry's first 4 KB and regex `"cliSessionId":"…"`; it is the second key in every entry seen. If it isn't in the head, treat the entry as not matched.
4. **Pairs.** For each org subfolder in the active account folder, each other account folder with the same org subfolder is a destination.
   - Inactive accounts are never the source.
   - The sync never writes into the active folder.
5. **Per destination, deletions first (REVISED, state-based, idempotent).** For each source `deleted_<uuid>` with time T (its epoch-ms content; if unreadable, use its mtime):
   - **Destination already has a newer entry.** If the destination has `local_<uuid>.json` and that file's mtime > T + 2 s, the destination was revived or updated after the delete. Skip this marker entirely: no marker copy and no removal.
   - **Otherwise, make both of these true** (each checked on its own every run, so an interrupted run is finished next time):
     - (a) the destination's `local_<uuid>.json` is absent. It is moved, not deleted, into the trash folder `~/.claude/account-session-sync/trash/<YYYY-MM-DD>/<acct8>-local_<uuid>.json`; a missing file (ENOENT) is fine.
     - (b) the destination's `deleted_<uuid>` exists, with T as its content (create-exclusive; EEXIST is fine).
   - Markers that match no `local_` file (the app also writes markers for the conversation ids) are copied the same way. That is harmless and mirrors what the app does.
   - **Safety cap.** At most 10 removals per destination per run. If a run would need more, it does none, records an error, and waits for Erez.
6. **Per destination, copies and updates.** For each source `local_<uuid>.json` (strict UUID name regex):
   - **Destination has `deleted_<uuid>` (marker time T).**
     - If the source mtime > T + 2 s, the session was revived in the source. Move the destination marker to the trash, then treat the session as missing in the destination.
     - Otherwise skip it.
   - **Missing in the destination:** require the conversation file `<cliSessionId>.jsonl` to exist in a top-level `~/.claude/projects/*/` folder (the set is built once per run, only when needed). Otherwise skip it as dead, without reporting; dead entries are pre-existing (GEN-860).
   - **Present in both:** copy only if source mtime > destination mtime + 2 s (tolerance).
   - **Write:**
     - parse the source JSON. If that fails, retry once after 300 ms, then skip. Record a failure only if the same file fails on 2 consecutive runs (tracked in `reported.json`).
     - set `bridgeSessionIds` to the destination's existing value, or remove the key for a new copy;
     - write the result to `.<name>.<pid>.sync.tmp` in the destination folder (the app ignores it: no `local_` prefix);
     - re-parse the temp file to validate it;
     - set its mtime = the source mtime;
     - rename it over `local_<uuid>.json`, retrying 3 × 200 ms on EPERM or EBUSY.
     - Overwritten destination files are not kept; the change is logged. Only removals go to the trash.
   - Each action is appended to `~/.claude/account-session-sync/changes.log` (JSON lines: ts, action, src, dst, id).
   - At the start of each run, delete `.*.sync.tmp` files older than 10 min in both folders.
6b. **Account-switch guard.** Re-read `lastKnownAccountUuid` before every write or delete. If it changed since step 3 (Erez switched accounts mid-run), stop at once without recording an error and log `aborted:account-switched`. This prevents writing into a folder that has just become active.
   - `config.json` is read by regex on `"lastKnownAccountUuid"\s*:\s*"<uuid>"`, never parsed whole and never logged, because it holds token caches. A miss is retried once after 200 ms.
7. **Budget.** 3 s at SessionStart, 8 s at Stop, and an override flag (`--budget <s>`) for the manual catch-up. A run that hits its budget is **incomplete**: it does not write `last-success` and logs `outcome:"incomplete"`. Partial progress is safe because every step is idempotent.
8. **On a complete run,** write epoch ms to `~/.claude/account-session-sync/last-success` (temp + rename).
   - Append a run line to `changes.log`: ts, event, ms, outcome, active uuid, cross-check result, and counts.
   - **Tripwire.** If the active folder has more than 20 files but 0 entries match the expected name and head shape, record an error instead of succeeding. This catches an app format change.
   - **Environment.** If `%APPDATA%\Claude` is absent (another PC), exit silently. If it exists but does not hold exactly 2 account folders, record an error once (de-duplicated) and do nothing.
9. **Never silent.**
   - Any recorded problem appends one record to `~/.claude/backup-sweep-failures.jsonl` in the existing shape: `{ts, machine, session, repo:'(account session sync)', kind:'account-sync-error', detail, surfaced:false}`, with the same 50×100 ms retry as `sessionstart-session-backup.js`.
   - Problems are de-duplicated: the same detail at most once per 24 h, tracked in `~/.claude/account-session-sync/reported.json`.
   - No stdout. Always exit 0, and fail open on any exception, recording it.

### Surfacer change (`hooks/sessionstart-backup-surfacer.js`)
- Add `'account-sync-error'` to KIND_LABEL and to the priority set, so the 25-record cap can't bury it.
- Add `accountSyncStaleLine`, independent of the sync hook:
  - If `last-success` is missing or unreadable, or the newest `local_*.json` mtime in any account folder (ignoring the last 10 min) is more than 24 h newer than `last-success`, show one line asking Claude to relay it to Erez.
  - Skip the check entirely when fewer than two account folders exist.
  - When the `disabled` switch file exists, show instead: "account session sync is switched OFF since <file mtime>". A forgotten switch is then never silent.
- Trash pruning (folders older than 14 days) is done by the sync hook at SessionStart, not by the surfacer.

### One-time catch-up and test-copy cleanup
- First, a fresh backup of `claude-code-sessions` to a durable folder, `C:\Users\Erez\.claude-staging\gen859-backup\sessions-before-phase1` (robocopy). The Drive copy from GEN-860 is a further fallback.
- Then run the hook by hand with `--budget 600`, repeating until a run reports nothing left, to sync the active → inactive direction.
  - The other direction happens over Erez's next message or messages in the other account (8 s per turn).
  - Completion is visible: the run line in `changes.log` reads `outcome:"complete"` with 0 copies pending.
  - Optional speed-up: Erez asks the session to run the manual catch-up there too.
- **Test-copy phone-link cleanup (REVISED: set difference, mtime preserved).** Test copies made during Phase 0 carry the other account's `bridgeSessionIds`:
  - 17 erez→info entries, listed in `%TEMP%\gen859-phase0\phase0-added-to-info.txt`;
  - 1 info→erez entry, `local_fec106f6…`.
  - For each, remove from the copy only the ids that appear in the original account's entry for the same session. Keep any ids the copy's own account added since; for example, info@ added its own id to `local_4449d1d4` and `local_a6d327df`. Remove the key if the list becomes empty. Restore the file's original mtime afterwards.
  - This runs only while the copy's account is inactive: `fec106f6` in erez@ now, the 17 in info@ when erez@ is active. In the meantime the sync's "keep the destination's value" rule leaves them unchanged, so the order doesn't matter.
- `local_2bb8800f…` (this conversation) was used in both accounts. Its bridge ids are left as they are, with the residual noted.

### ADDITION (Erez, 2026-10-15): app-load check, to catch an app update that stops accepting copied entries
Erez's question was whether we should track app updates. The answer: tracking alone tells us *when* to worry, not *whether* copying broke. The desktop app shipped about 18 builds since 2026-08-22 (the `appVersion` lines in main/main1/main2.log), and its Help Center release notes don't describe storage. Erez chose: "Build it into the helper now, before installing".

**Evidence**
- The app logs each list load to `%LOCALAPPDATA%\Claude\Logs\main.log`:
  `YYYY-MM-DD HH:MM:SS [info] Loaded N persisted sessions from <...\claude-code-sessions\<acct>\<org>>[ (K archived deferred, ...)]`
  - This happens at app launch and at sign-in.
  - The parenthetical is absent when K = 0.
  - The format is stable across builds from August (main2.log) to today (main.log): 38 lines found.
- The log rotates at about 10 MB into main1.log and main2.log; main2.log reaches back to 2026-08-22.
- Timestamps are local time with no offset.
- Today's real baseline:
  - erez@: Loaded line 427 + 9 = 436 at 15:17:39 (main.log 8515), against 436 `local_` files at that time (435 now, after one test deletion).
  - info@: 116 + 1 = 117 at 15:44:48 (main.log 9347), against 117 then (119 now, the difference being sessions created since).
  - The gap is about 0, from one day of data, so the threshold of more than 2 is to be confirmed by logging every evaluated check.
- `appVersion: 'X'` lines are logged too.

**Mechanism (in account-session-sync.js)**
1. **Destination snapshot.** At the end of every run that reached the sync step, including an aborted one, record in `~/.claude/account-session-sync/dest-counts.json` the destination folder's `local_<uuid>.json` count and the time: `{ "<acct>\\<org>": { count, ts } }`.
   - Nothing but this hook writes a signed-out account's folder, so `count` is exactly what the app will find there at the next sign-in.
2. **Check, at SessionStart and manual runs only.** For the signed-in account's folder F, take `rec = dest-counts[F]`.
   - Skip if `rec` is missing or already checked (`load-check.json` stores the `rec.ts` last checked).
   - Otherwise find the FIRST "Loaded … from F" line with a time later than `rec.ts`. Search main.log, then main1.log, then main2.log; read only if a check is pending.
   - **Found:** loaded = N + K (K = 0 if there is no parenthetical). If `rec.count − loaded > 2`, report: "after switching to this account, the app loaded L sessions but its list held C … (app version V)".
   - **Not found while F is active** (a switch to F must have caused a load): report it once, as "could not confirm the app loaded this account's list; the app may have changed how it loads it (version V)", unless `rec.ts` is under 2 min old (the load may not be logged yet).
   - Mark `rec.ts` as checked either way.
   - **Only a positive gap alarms.** More loaded than recorded can only mean sessions the app created itself after an app restart; the first-load-after-snapshot rule makes that rare.
3. **Limits** (to state to Erez):
   - It sees only the load step. An app that loads everything but hides copied sessions in the sidebar, or deletes them after loading, isn't caught.
   - A rewording of the log line shows up as a "could not confirm" alert, which is a false alarm in the safe direction.
   - Daylight-saving changeover adds one ambiguous hour a year.

### Out of scope
- `scheduled-tasks.json`, which is Phase 3 and Erez's separate decision.
- `backlog/`, Cowork sessions, and phone- or cloud-started sessions.

### Known limits
- **Sidebar-only actions** (rename, archive, delete) carry over only at the next message or session start in that account.
  - A sidebar-only rename or archive can be **reverted**, not just delayed. That happens if Erez switches before sending a message, then touches the same session in the other account (opening it rewrites it).
- **Before the first message after a switch,** the newly active account shows the other account's state as of the last sync. The latest turn's title may lag one turn if the app writes it after the Stop hook; to be measured in the Phase 1 test.
- **Deleting a session in either account deletes it in both.** The entry goes to the sync's trash for 14 days, and the conversation file is untouched.
- **Alerts catch the sync failing and the app loading fewer entries than the list holds** (app-load check, at the first session start after each switch). They still don't catch an app that loads every entry but hides copies in the sidebar, or deletes them after loading. A glance at the list after switching remains the backstop for that.
- **App re-saves.** The app's loader re-saves an entry when its `autoChosenInApp` flag needs fixing (app.asar `loadSessionRecords`), so a few entries can get a new file date at load. Newest-wins handles it: the re-saved copy flows to the other account at the next run with the same content.
- **Assumptions still resting on observation only:** that the app never writes the signed-out account's folder (about 1.5 h observed), and that a copied phone-link id would be deleted cross-account. Both are low-harm, and the design guards against them anyway.

### Verification additions for Phase 1 (from review)
- **App-load check, first real switch in each direction:** a `changes.log` run line shows `loadCheck` with a gap of about 0.
- **App-load check, fault injection:** raise a `dest-counts` count by 5, switch, and see the alert reach the session-start warning.
- An archived erez@ entry shows as archived in info@, which now has an index file.
- An un-archive in one account carries over.
- A deletion round-trip, using the trash.
- Measure per-run time on real turns.
- Check whether the latest title lags one turn.
