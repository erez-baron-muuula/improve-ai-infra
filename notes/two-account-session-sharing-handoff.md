# Two-account session sharing: handoff (written 2026-10-14)

## Goal (Erez's words)
Erez has two Claude accounts on this PC and switches between them in the **Claude desktop app (Code tab)**. He has no terminal use. He wants to move between accounts seamlessly, sharing all data (folders, sessions, files). His sessions run on this PC or on his Android phone (Claude mobile app); he continues PC sessions from the phone AND starts new sessions from the phone.

Erez approved attempting to make both accounts show all local sessions, to be run in a new session on Opus at high effort.

## Verified facts (this session)
- Local transcripts live in `C:\Users\Erez\.claude\projects` (about 1.3 GB, 11 project folders), shared by both accounts. Signing out and in did not change its size.
- The desktop app keeps a **per-account session index** under `C:\Users\Erez\AppData\Roaming\Claude\claude-code-sessions\<account-id>\<id>\local_*.json`:
  - `a47791bc-f28c-4025-a47f-f39d0eee57dd` - 400 entries, contains the sessions of the account used in this session (e.g. "Redis password change: daily check").
  - `c68119fc-d3d6-4fe0-a413-6ebbed20cbb0` - 95 entries, contains the second account's sessions (e.g. "Windows 11 language transfer to Hebrew", "Token regeneration").
  - Both contain a subfolder `13fa9673-ac05-4484-9d1a-93741a41beed`. Which folder is which account is inferred from title matches, not from an account lookup.
- The second account's sessions do NOT show in the first account's list: the 20 titles in Erez's screenshot were absent from this account's 300 most recent sessions (24 Jun to 14 Oct 2026). The transcript of at least one of them (custom title "Windows 11 language transfer to Hebrew") exists under `projects\C--Users-Erez-AI-Projects-Improve-AI-Infra\` (id a7f71e16-8e00-433e-bdf3-910bd39b6275, has `custom-title.json`).
- Erez signed out, signed in to the second account, "copied the session I see there", and signed back in. Not checked: what that copy produced.
- Backup state: `sync.ps1` copies config/hooks/scripts/memory to Drive and explicitly excludes `sessions\`, `backups\`, `plans\` and `*.jsonl` transcripts. `backup-sweep.ps1` pushes project repos to hidden GitHub branches. **Session transcripts (1.3 GB) are not backed up anywhere.**

## Docs findings (via claude-code-guide agent; not independently verified)
- Local sessions are private to the user on the PC; cloud sessions can be shared at Team visibility (Team/Enterprise only); Projects are not shareable.
- `/logout` + `/login` replace only the credentials file; docs do not say local data is touched.
- Docs do not mention multi-account switching in the desktop app, nor whether the desktop app honors `CLAUDE_CONFIG_DIR`.
- Cloud sessions and claude.ai chats/Projects are per account and cannot be merged.

## Plan Erez approved in principle (not yet started - nothing has been changed)
1. Back up the two index folders (small files) to `notes\` in this project (Erez was asked to confirm this location; not yet answered, so confirm or ask).
2. Copy the 95 index entries from the second account's folder into the first account's folder, **never overwriting** an existing file. Check that the sessions appear in the app.
3. If duplicates, errors or missing sessions appear, delete only the added files. Do the reverse direction only after step 2 works.

## Unknowns to settle before editing
- Whether the app reads copied entries correctly, rewrites the folder on launch, or needs to be closed during the copy (closing the app ends the running session).
- What the `local_*.json` entries contain (look at one before copying: ids, account fields, any account binding that would make a copy invalid).
- Whether the first-account index folder is really this account (confirm by checking that the current session's id has an entry there).
- Phone-started sessions most likely run in the cloud and stay with their account; not verified.

## Other open items
- Optional backup of `C:\Users\Erez\.claude\projects` (1.3 GB); location not chosen. Do not put it on Drive without asking.
- No files other than this note were changed in this session.
